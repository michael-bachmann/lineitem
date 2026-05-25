# Distribution Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the YNAB-to-Amazon sync pipeline into discrete pure phases with a `RetailerAdapter` interface, a globally-optimal item-to-charge partition algorithm, and persisted per-item allocations so display and approval read instead of recompute.

**Architecture:** Six-phase pipeline (identify → scrape+match → distribute → persist → classify → queue). Retailer-specific logic (DOM scraping, list-page matching, order grouping) lives behind `RetailerAdapter`. The algorithm — `distributeOrder` composed of `assignItemsToCharges` (recursive partition with branch-and-bound) and `allocateProportional` — is pure and end-to-end testable. Allocated cents are persisted on `AllocatedItem` so downstream readers don't recompute. Reference: `docs/superpowers/specs/2026-05-24-distribution-pipeline-design.md`.

**Tech Stack:** TypeScript, WXT (browser extension framework), React 19, IndexedDB, vitest (new), remeda (new). Existing `lib/matcher.ts`, `retailers/amazon/scraper.ts`, `background/tabs.ts` retained.

---

## File Structure

**New files:**
- `lib/distribution.ts` — `distributeOrder`, `assignItemsToCharges`, `allocateProportional`
- `lib/distribution.test.ts` — unit + scenario tests
- `retailers/amazon/adapter.ts` — implements `RetailerAdapter` (replaces `background/amazon-scraper.ts`)
- `retailers/registry.ts` — list of registered adapters
- `vitest.config.ts` — vitest configuration

**Modified files:**
- `lib/types.ts` — add `YnabCharge`, `ScrapedOrder`, `ScrapedItem`, `AllocatedTransaction`, `AllocatedItem`, `RetailerAdapter`; simplify `ApprovalItem`; remove `ItemizedTransaction`, `LineItem` (after consumers migrate)
- `lib/db.ts` — redefine v1 schema with `allocatedTransactions` store; rename functions
- `lib/registry.ts` — derive payee mappings from registered adapters
- `lib/money.ts` — remove `findItemSubset` and `distributeRemainder` at the end (kept during transition)
- `background/sync.ts` — rewrite as pipeline composition
- `background/approval.ts` — use `allocatedCents` from persisted record
- `components/SplitBreakdown.tsx` — read `allocatedCents` directly
- `components/DetailView.tsx`, `components/TransactionCard.tsx`, `entrypoints/sidepanel/App.tsx` — type updates
- `package.json` — add `vitest`, `@vitest/coverage-v8`, `remeda` deps; add `test` script

**Deleted files:**
- `background/amazon-scraper.ts` — replaced by `retailers/amazon/adapter.ts`
- `lib/utils.ts` — `groupBy` replaced by `R.groupBy`

---

## Task 1: Set up vitest and remeda

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `lib/distribution.test.ts` (skeleton)

- [ ] **Step 1: Install dependencies**

Run:
```bash
pnpm add remeda
pnpm add -D vitest @vitest/coverage-v8
```

Expected: `package.json` updated; lockfile updated.

- [ ] **Step 2: Add test script to package.json**

In `package.json`, add `"test": "vitest"` and `"test:run": "vitest run"` to the `scripts` block:

```json
"scripts": {
  "dev": "wxt",
  "dev:firefox": "wxt -b firefox",
  "build": "wxt build",
  "build:firefox": "wxt build -b firefox",
  "zip": "wxt zip",
  "zip:firefox": "wxt zip -b firefox",
  "compile": "tsc --noEmit",
  "test": "vitest",
  "test:run": "vitest run",
  "postinstall": "wxt prepare"
}
```

- [ ] **Step 3: Create vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 4: Create a placeholder test that fails**

Create `lib/distribution.test.ts`:

```ts
import { describe, it } from "vitest";

describe("distribution", () => {
  it("placeholder — implement in Task 3", () => {
    throw new Error("not implemented");
  });
});
```

- [ ] **Step 5: Run vitest to confirm setup**

Run: `pnpm test:run`
Expected: 1 test runs, 1 fails with "not implemented". Confirms vitest is configured.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts lib/distribution.test.ts
git commit -m "build: add vitest and remeda; test scaffold for distribution algorithm"
```

---

## Task 2: Add new types to lib/types.ts

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add the new types alongside existing ones**

Add to `lib/types.ts` (keep existing `ItemizedTransaction`, `LineItem`, `ApprovalItem` for now — they're deleted in Task 13 after consumers migrate):

```ts
// ---------------------------------------------------------------------------
// Distribution pipeline types — added for the new sync flow.
// All monetary values are non-negative integer cents.
// ---------------------------------------------------------------------------

/** A YNAB charge normalized for the pipeline. Always positive cents. */
export interface YnabCharge {
  ynabTransactionId: string;
  date: string;              // ISO date (YYYY-MM-DD)
  amountCents: number;       // positive cents, regardless of refund vs purchase
  payeeName: string;
  isRefund: boolean;
  cardLastFour: string | null;
}

/** An order as returned by a RetailerAdapter. */
export interface ScrapedOrder {
  retailer: string;
  orderId: string;           // adapter's notion of "same order"
  items: ScrapedItem[];
  scrapedAt: string;         // ISO datetime
}

/** A line item as scraped — raw per-unit price, no allocation yet. */
export interface ScrapedItem {
  productId: string;
  title: string;
  imageUrl: string;
  unitPriceCents: number;    // raw per-unit price
  quantity: number;
}

/** A persisted transaction with allocations. Replaces ItemizedTransaction. */
export interface AllocatedTransaction {
  ynabTransactionId: string; // primary key
  orderKey: string;          // "{retailer}:{orderId}"
  retailer: string;
  date: string;
  amountCents: number;       // YNAB charge total
  cardLastFour: string | null;
  isRefund: boolean;
  items: AllocatedItem[];    // sum(item.allocatedCents) === amountCents exactly
  scrapedAt: string;
}

/** A scraped item plus its share of the YNAB charge. */
export interface AllocatedItem extends ScrapedItem {
  allocatedCents: number;    // this item's share of the YNAB charge (cents)
}

/** An adapter for scraping a retailer's order data. */
export interface RetailerAdapter {
  id: string;                // e.g. "amazon"
  payees: PayeeMapping[];

  /**
   * Scrape the retailer for orders covering the given YNAB charges, and
   * return the charge → order grouping the adapter discovered.
   *
   * The adapter owns its full lifecycle, including tab opening/closing
   * and cleanup on success and failure paths. The pipeline calls this
   * once per retailer per sync.
   *
   * Returns matched orders with the charges they cover, plus unmatched
   * charges with a reason. No persistence, no classification.
   */
  scrapeMatchedOrders(charges: YnabCharge[]): Promise<{
    matched: { order: ScrapedOrder; charges: YnabCharge[] }[];
    unmatched: { charge: YnabCharge; reason: string }[];
  }>;
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `pnpm compile`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "types: add YnabCharge, ScrapedOrder, AllocatedTransaction, RetailerAdapter"
```

---

## Task 3: Implement and test `allocateProportional`

**Files:**
- Create: `lib/distribution.ts`
- Modify: `lib/distribution.test.ts`

- [ ] **Step 1: Replace the placeholder test with `allocateProportional` tests**

Overwrite `lib/distribution.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sum } from "remeda";
import { allocateProportional } from "./distribution";

describe("allocateProportional", () => {
  it("distributes total proportionally by item subtotal", () => {
    expect(allocateProportional([5000, 3000], 9000)).toEqual([5625, 3375]);
  });

  it("exact-sum guarantee: result always sums to totalCents", () => {
    const result = allocateProportional([100, 100, 100], 1000);
    expect(sum(result)).toBe(1000);
  });

  it("rounding error is absorbed by the last item", () => {
    // 333.33 each → rounded would sum to 999; last item gets +1
    const result = allocateProportional([100, 100, 100], 1000);
    expect(result).toEqual([333, 333, 334]);
  });

  it("zero total returns all zeros", () => {
    expect(allocateProportional([100, 200], 0)).toEqual([0, 0]);
  });

  it("single item gets full total", () => {
    expect(allocateProportional([100], 999)).toEqual([999]);
  });

  it("zero-subtotal items mixed with non-zero", () => {
    // Items with zero subtotal get 0; the rest split the total
    const result = allocateProportional([0, 100, 0], 500);
    expect(sum(result)).toBe(500);
    expect(result[0]).toBe(0);
    expect(result[2]).toBe(0);
    expect(result[1]).toBe(500);
  });

  it("all zero subtotals returns all zeros even with positive total", () => {
    // No basis for proportional allocation; return zeros (caller's bug to send this)
    expect(allocateProportional([0, 0], 1000)).toEqual([0, 0]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm test:run`
Expected: all 7 tests fail with module-not-found error for `./distribution`.

- [ ] **Step 3: Implement `allocateProportional`**

Create `lib/distribution.ts`:

```ts
import { sum } from "remeda";

/**
 * Distribute totalCents across items proportionally by their subtotals.
 * Rounding error from per-item rounding is absorbed by the last item, so
 * the returned array always sums to exactly totalCents.
 *
 * When all subtotals are zero there is no basis for proportional allocation,
 * so we return zeros — calling with this input is a caller-side bug.
 */
export function allocateProportional(
  itemSubtotalsCents: number[],
  totalCents: number,
): number[] {
  const subtotalSum = sum(itemSubtotalsCents);
  if (subtotalSum === 0 || totalCents === 0) {
    return itemSubtotalsCents.map(() => 0);
  }

  const shares = itemSubtotalsCents.map((subtotal) =>
    Math.round((subtotal / subtotalSum) * totalCents),
  );

  // Absorb rounding error into the last item so sum(shares) === totalCents exactly
  const correction = totalCents - sum(shares);
  return shares.map((share, i) =>
    i === shares.length - 1 ? share + correction : share,
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm test:run`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/distribution.ts lib/distribution.test.ts
git commit -m "feat(distribution): allocateProportional — proportional split with exact-sum guarantee"
```

---

## Task 4: Implement and test `assignItemsToCharges`

The core algorithm: globally-optimal partition of items across charges via recursive search with branch-and-bound.

**Files:**
- Modify: `lib/distribution.ts`
- Modify: `lib/distribution.test.ts`

- [ ] **Step 1: Add `assignItemsToCharges` tests**

Append to `lib/distribution.test.ts`:

```ts
import { assignItemsToCharges } from "./distribution";

describe("assignItemsToCharges", () => {
  it("single charge returns all items in one bucket with distance 0", () => {
    const result = assignItemsToCharges([1000, 2000], [3000], 3000, 3000);
    expect(result).toEqual({
      indicesPerCharge: [[0, 1]],
      distanceCentsPerCharge: [0],
    });
  });

  it("two charges, exact split, distance 0 for both", () => {
    // Items: $30 (idx 0), $50 (idx 1); Charges: $50, $30
    const result = assignItemsToCharges([3000, 5000], [5000, 3000], 8000, 8000);
    expect(result).not.toBeNull();
    expect(result!.indicesPerCharge[0]).toEqual([1]); // $50 charge → $50 item
    expect(result!.indicesPerCharge[1]).toEqual([0]); // $30 charge → $30 item
    expect(result!.distanceCentsPerCharge).toEqual([0, 0]);
  });

  it("greedy trap: global finds total-error-0 where naive greedy would fail", () => {
    // Items: $10, $20, $30, $40 = $100; Charges: $40, $30, $30
    // Greedy might pick {$10, $30} for the $40 charge (distance 0 locally),
    // leaving {$20, $40} that can't cleanly cover two $30s (error 20).
    // Global finds {$40} | {$30} | {$10, $20} — total error 0.
    const result = assignItemsToCharges(
      [1000, 2000, 3000, 4000],
      [4000, 3000, 3000],
      10000,
      10000,
    );
    expect(result).not.toBeNull();
    expect(sum(result!.distanceCentsPerCharge)).toBe(0);
  });

  it("input charge order does not affect partition's total distance", () => {
    const items = [1000, 2000, 3000];
    const r1 = assignItemsToCharges(items, [3000, 2000, 1000], 6000, 6000);
    const r2 = assignItemsToCharges(items, [1000, 2000, 3000], 6000, 6000);
    expect(sum(r1!.distanceCentsPerCharge)).toBe(sum(r2!.distanceCentsPerCharge));
  });

  it("returns indices in input charge order", () => {
    const items = [1000, 2000, 3000];
    // Input charges: [$20, $40] — result indices[0] is for $20, indices[1] is for $40
    const result = assignItemsToCharges(items, [2000, 4000], 6000, 6000);
    expect(result).not.toBeNull();
    // First bucket corresponds to first input charge ($20)
    const sumOf = (idxs: number[]) => sum(idxs.map((i) => items[i]));
    expect(sumOf(result!.indicesPerCharge[0])).toBe(2000);
    expect(sumOf(result!.indicesPerCharge[1])).toBe(4000);
  });

  it("ratio scaling: items priced below charges still partition correctly", () => {
    // Items total $80, charges total $100 (ratio 1.25 — e.g. 25% tax)
    // Items: $30, $50; Charges: $37.50→$38, $62.50→$62
    // Wait — let's do an easier one with clean ratio.
    // Items $40, $40; Charges $50, $50; ratio = 100/80 = 1.25
    // Each subset scaled: {0}=50, {1}=50, {0,1}=100
    // Best partition: {0}|{1} → distances 0, 0
    const result = assignItemsToCharges([4000, 4000], [5000, 5000], 10000, 8000);
    expect(result).not.toBeNull();
    expect(sum(result!.distanceCentsPerCharge)).toBe(0);
  });

  it("n > 20 returns null (search-space cap)", () => {
    const items = Array(21).fill(100);
    expect(assignItemsToCharges(items, [2100], 2100, 2100)).toBeNull();
  });

  it("M > n returns null (cannot give every charge an item)", () => {
    expect(assignItemsToCharges([1000], [500, 500], 1000, 1000)).toBeNull();
  });

  it("each item assigned to exactly one charge", () => {
    const items = [1000, 2000, 3000, 4000];
    const result = assignItemsToCharges(items, [3000, 7000], 10000, 10000);
    expect(result).not.toBeNull();
    const allIndices = result!.indicesPerCharge.flat();
    const expectedIndices = items.map((_, i) => i);
    expect(allIndices.sort()).toEqual(expectedIndices);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm test:run`
Expected: 9 tests fail (assignItemsToCharges not exported).

- [ ] **Step 3: Implement `assignItemsToCharges`**

Append to `lib/distribution.ts`:

```ts
const MAX_ITEMS = 20;

/**
 * Globally partition items across charges to minimize the sum of per-charge
 * distances, where each distance is |sum(subset) × ratio − chargeAmount|.
 *
 * ratio = orderTotalCents / itemsSubtotalCents accounts for tax/shipping/
 * discounts/gift-cards spread proportionally across items by price.
 *
 * Implementation: recursive partition with branch-and-bound. For each
 * charge in turn, enumerate subsets of remaining items, recurse on the
 * remainder. Prune any branch whose accumulated distance already exceeds
 * the best total found so far.
 *
 * Returns indices per charge in input charge order, plus the per-charge
 * distance contributed by that bucket. Returns null when n > MAX_ITEMS
 * (search-space cap) or M > n (structurally impossible).
 */
export function assignItemsToCharges(
  itemSubtotalsCents: number[],
  chargeAmountsCents: number[],
  orderTotalCents: number,
  itemsSubtotalCents: number,
): { indicesPerCharge: number[][]; distanceCentsPerCharge: number[] } | null {
  const n = itemSubtotalsCents.length;
  const m = chargeAmountsCents.length;

  if (n === 0 || n > MAX_ITEMS) return null;
  if (m > n) return null;
  if (m === 0) return null;

  const ratio = itemsSubtotalCents > 0 ? orderTotalCents / itemsSubtotalCents : 1;

  // Scaled subset sum and per-charge distance helper.
  const scaledSum = (indices: number[]): number =>
    Math.round(indices.reduce((s, i) => s + itemSubtotalsCents[i], 0) * ratio);

  const distanceForCharge = (indices: number[], chargeIdx: number): number =>
    Math.abs(scaledSum(indices) - chargeAmountsCents[chargeIdx]);

  // Track best total distance found so far. Best partition is recorded as
  // a parallel array of index-lists, one per charge, in input order.
  let bestTotalDistance = Infinity;
  let bestPartition: number[][] | null = null;
  let bestDistances: number[] | null = null;

  // DFS over partitions:
  //   chargeIdx          — which charge we are currently assigning to
  //   remainingItems     — item indices not yet assigned to a charge
  //   currentPartition   — buckets already chosen for charges [0..chargeIdx-1]
  //   currentDistances   — distances for those buckets
  //   accumulatedDist    — sum of currentDistances (avoids re-summing)
  function recurse(
    chargeIdx: number,
    remainingItems: number[],
    currentPartition: number[][],
    currentDistances: number[],
    accumulatedDist: number,
  ): void {
    // Prune: accumulated distance already ≥ best total
    if (accumulatedDist >= bestTotalDistance) return;

    // Base case: last charge takes all remaining items
    if (chargeIdx === m - 1) {
      const dist = distanceForCharge(remainingItems, chargeIdx);
      const total = accumulatedDist + dist;
      if (total < bestTotalDistance) {
        bestTotalDistance = total;
        bestPartition = [...currentPartition, remainingItems];
        bestDistances = [...currentDistances, dist];
      }
      return;
    }

    // Need at least (m - chargeIdx) items remaining so each later charge
    // can have at least one item.
    const chargesLeft = m - chargeIdx;
    if (remainingItems.length < chargesLeft) return;

    // Each remaining charge after this one needs >=1 item, so this charge
    // can take between 1 and (remainingItems.length - (chargesLeft - 1)) items.
    const maxSubsetSize = remainingItems.length - (chargesLeft - 1);

    // Enumerate non-empty subsets of remainingItems with size in [1, maxSubsetSize].
    enumerateSubsets(remainingItems, maxSubsetSize, (subset, complement) => {
      const dist = distanceForCharge(subset, chargeIdx);
      // Prune before recursing
      if (accumulatedDist + dist >= bestTotalDistance) return;
      recurse(
        chargeIdx + 1,
        complement,
        [...currentPartition, subset],
        [...currentDistances, dist],
        accumulatedDist + dist,
      );
    });
  }

  recurse(0, Array.from({ length: n }, (_, i) => i), [], [], 0);

  if (bestPartition === null || bestDistances === null) return null;
  return {
    indicesPerCharge: bestPartition,
    distanceCentsPerCharge: bestDistances,
  };
}

/**
 * Enumerate non-empty subsets of `items` with size 1..maxSize, invoking
 * callback with (subset, complement). DFS include/exclude per item.
 */
function enumerateSubsets(
  items: number[],
  maxSize: number,
  callback: (subset: number[], complement: number[]) => void,
): void {
  function search(i: number, included: number[], excluded: number[]): void {
    if (i === items.length) {
      if (included.length >= 1 && included.length <= maxSize) {
        callback(included, excluded);
      }
      return;
    }
    // Include items[i]
    if (included.length < maxSize) {
      search(i + 1, [...included, items[i]], excluded);
    }
    // Exclude items[i]
    search(i + 1, included, [...excluded, items[i]]);
  }
  search(0, [], []);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm test:run`
Expected: all 16 tests pass (7 from Task 3 + 9 new).

- [ ] **Step 5: Commit**

```bash
git add lib/distribution.ts lib/distribution.test.ts
git commit -m "feat(distribution): assignItemsToCharges — global partition with branch-and-bound"
```

---

## Task 5: Implement and test `distributeOrder` with scenario coverage

**Files:**
- Modify: `lib/distribution.ts`
- Modify: `lib/distribution.test.ts`

- [ ] **Step 1: Add `distributeOrder` scenario tests**

Append to `lib/distribution.test.ts`:

```ts
import { distributeOrder } from "./distribution";
import type { ScrapedOrder, YnabCharge } from "./types";

const mkItem = (productId: string, unitPriceCents: number, quantity = 1) => ({
  productId,
  title: `Product ${productId}`,
  imageUrl: "",
  unitPriceCents,
  quantity,
});

const mkCharge = (
  ynabTransactionId: string,
  amountCents: number,
  overrides: Partial<YnabCharge> = {},
): YnabCharge => ({
  ynabTransactionId,
  date: "2026-05-24",
  amountCents,
  payeeName: "AMAZON",
  isRefund: false,
  cardLastFour: null,
  ...overrides,
});

const mkOrder = (orderId: string, items: ScrapedOrder["items"]): ScrapedOrder => ({
  retailer: "amazon",
  orderId,
  items,
  scrapedAt: "2026-05-24T00:00:00Z",
});

describe("distributeOrder", () => {
  it("single charge: all items go to the one charge; allocations sum to chargeAmount", () => {
    const order = mkOrder("o1", [mkItem("A", 5000), mkItem("B", 3000)]);
    const charges = [mkCharge("tx1", 8800)]; // includes $8 tax
    const result = distributeOrder(order, charges);
    expect(result).toHaveLength(1);
    expect(result[0].ynabTransactionId).toBe("tx1");
    expect(result[0].amountCents).toBe(8800);
    expect(sum(result[0].items.map((i) => i.allocatedCents))).toBe(8800);
    expect(result[0].items.map((i) => i.productId).sort()).toEqual(["A", "B"]);
  });

  it("split shipment (HEADLINE): partitions items, one AllocatedTransaction per charge", () => {
    const order = mkOrder("o1", [mkItem("H", 5000), mkItem("C", 3000)]);
    const charges = [mkCharge("tx1", 5500), mkCharge("tx2", 3000)];
    const result = distributeOrder(order, charges);
    expect(result).toHaveLength(2);
    const tx1 = result.find((r) => r.ynabTransactionId === "tx1")!;
    const tx2 = result.find((r) => r.ynabTransactionId === "tx2")!;
    expect(tx1.items.map((i) => i.productId)).toEqual(["H"]);
    expect(tx1.items[0].allocatedCents).toBe(5500);
    expect(tx2.items.map((i) => i.productId)).toEqual(["C"]);
    expect(tx2.items[0].allocatedCents).toBe(3000);
  });

  it("invariant: every charge's allocations sum to exactly amountCents", () => {
    const order = mkOrder("o1", [
      mkItem("A", 1234),
      mkItem("B", 5678),
      mkItem("C", 999),
    ]);
    const charges = [mkCharge("tx1", 5000), mkCharge("tx2", 3000)];
    const result = distributeOrder(order, charges);
    for (const at of result) {
      expect(sum(at.items.map((i) => i.allocatedCents))).toBe(at.amountCents);
    }
  });

  it("invariant: every item appears in exactly one AllocatedTransaction", () => {
    const order = mkOrder("o1", [mkItem("A", 1000), mkItem("B", 2000), mkItem("C", 3000)]);
    const charges = [mkCharge("tx1", 1500), mkCharge("tx2", 4500)];
    const result = distributeOrder(order, charges);
    const seenIds = result.flatMap((at) => at.items.map((i) => i.productId));
    expect(seenIds.sort()).toEqual(["A", "B", "C"]);
  });

  it("item quantity > 1: subtotal scales by quantity", () => {
    // $20 × 3 = $60 line; alone in a $66 charge (10% tax)
    const order = mkOrder("o1", [mkItem("A", 2000, 3)]);
    const charges = [mkCharge("tx1", 6600)];
    const result = distributeOrder(order, charges);
    expect(result[0].items[0].allocatedCents).toBe(6600);
    expect(result[0].items[0].quantity).toBe(3);
    expect(result[0].items[0].unitPriceCents).toBe(2000); // raw price preserved
  });

  it("refund: isRefund flag carried through; amountCents stays positive", () => {
    const order = mkOrder("o1", [mkItem("A", 5000)]);
    const charges = [mkCharge("tx1", 5000, { isRefund: true })];
    const result = distributeOrder(order, charges);
    expect(result[0].isRefund).toBe(true);
    expect(result[0].amountCents).toBe(5000);
  });

  it("multi-charge proportional tax: clean partition, exact totals", () => {
    // Items $40, $60 = $100; Order total = $110 (10% tax); two charges sum $110
    // Charges: $44, $66
    const order = mkOrder("o1", [mkItem("A", 4000), mkItem("B", 6000)]);
    const charges = [mkCharge("tx1", 4400), mkCharge("tx2", 6600)];
    const result = distributeOrder(order, charges);
    expect(sum(result.find((r) => r.ynabTransactionId === "tx1")!.items.map((i) => i.allocatedCents))).toBe(4400);
    expect(sum(result.find((r) => r.ynabTransactionId === "tx2")!.items.map((i) => i.allocatedCents))).toBe(6600);
  });

  it("metadata propagation: orderKey, retailer, date, cardLastFour all set", () => {
    const order = mkOrder("114-XYZ", [mkItem("A", 1000)]);
    const charges = [mkCharge("tx1", 1000, { date: "2026-05-20", cardLastFour: "1234" })];
    const result = distributeOrder(order, charges);
    expect(result[0].orderKey).toBe("amazon:114-XYZ");
    expect(result[0].retailer).toBe("amazon");
    expect(result[0].date).toBe("2026-05-20");
    expect(result[0].cardLastFour).toBe("1234");
    expect(result[0].scrapedAt).toBe("2026-05-24T00:00:00Z");
  });

  it("returns empty array when order has no items", () => {
    const order = mkOrder("o1", []);
    const charges = [mkCharge("tx1", 1000)];
    expect(distributeOrder(order, charges)).toEqual([]);
  });

  it("returns empty array when assignment fails (M > n)", () => {
    const order = mkOrder("o1", [mkItem("A", 1000)]);
    const charges = [mkCharge("tx1", 500), mkCharge("tx2", 500)];
    expect(distributeOrder(order, charges)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm test:run`
Expected: 10 new tests fail (distributeOrder not exported).

- [ ] **Step 3: Implement `distributeOrder`**

Append to `lib/distribution.ts`:

```ts
import type {
  ScrapedOrder,
  YnabCharge,
  AllocatedTransaction,
  AllocatedItem,
} from "./types";
import { sum } from "remeda";

/**
 * The full distribution algorithm: take a scraped order and its YNAB
 * charges, return one AllocatedTransaction per charge with items
 * partitioned across charges and per-item allocated amounts that sum
 * exactly to each charge's amountCents.
 *
 * Returns an empty array if the partition cannot be computed (no items,
 * M > n, or n exceeds the cap). Callers should treat that as an error
 * for the affected charges.
 */
export function distributeOrder(
  order: ScrapedOrder,
  charges: YnabCharge[],
): AllocatedTransaction[] {
  if (order.items.length === 0) return [];

  const itemSubtotals = order.items.map((item) => item.unitPriceCents * item.quantity);
  const chargeAmounts = charges.map((c) => c.amountCents);
  const orderTotal = sum(chargeAmounts);
  const itemsSubtotal = sum(itemSubtotals);

  const partition = assignItemsToCharges(
    itemSubtotals,
    chargeAmounts,
    orderTotal,
    itemsSubtotal,
  );
  if (partition === null) return [];

  // Log per-charge distance for debugging — not persisted.
  const totalDist = sum(partition.distanceCentsPerCharge);
  if (totalDist > 0) {
    console.debug(
      `[distributeOrder] order=${order.orderId} total_distance_cents=${totalDist} ` +
        `per_charge=${partition.distanceCentsPerCharge.join(",")}`,
    );
  }

  return charges.map((charge, chargeIdx) => {
    const itemIndices = partition.indicesPerCharge[chargeIdx];
    const subsetItems = itemIndices.map((i) => order.items[i]);
    const subsetSubtotals = itemIndices.map((i) => itemSubtotals[i]);
    const allocatedAmounts = allocateProportional(subsetSubtotals, charge.amountCents);

    const items: AllocatedItem[] = subsetItems.map((item, i) => ({
      ...item,
      allocatedCents: allocatedAmounts[i],
    }));

    return {
      ynabTransactionId: charge.ynabTransactionId,
      orderKey: `${order.retailer}:${order.orderId}`,
      retailer: order.retailer,
      date: charge.date,
      amountCents: charge.amountCents,
      cardLastFour: charge.cardLastFour,
      isRefund: charge.isRefund,
      items,
      scrapedAt: order.scrapedAt,
    };
  });
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm test:run`
Expected: all 26 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/distribution.ts lib/distribution.test.ts
git commit -m "feat(distribution): distributeOrder — end-to-end algorithm + scenario tests"
```

---

## Task 6: Update IndexedDB layer

**Files:**
- Modify: `lib/db.ts`

- [ ] **Step 1: Redefine schema with `allocatedTransactions` store**

Replace `lib/db.ts` with:

```ts
import type { AllocatedTransaction, ProductCategory, Category } from "./types";

const DB_NAME = "itemize";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;

      // allocatedTransactions: primary key = ynabTransactionId, secondary index = orderKey
      const txStore = db.createObjectStore("allocatedTransactions", { keyPath: "ynabTransactionId" });
      txStore.createIndex("orderKey", "orderKey", { unique: false });

      db.createObjectStore("productCategories", { keyPath: "id" });
      db.createObjectStore("categories", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

async function getStore(
  storeName: string,
  mode: IDBTransactionMode = "readonly",
): Promise<IDBObjectStore> {
  const db = await openDB();
  return db.transaction(storeName, mode).objectStore(storeName);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// --- Allocated Transactions (primary key: ynabTransactionId) ---

export async function getAllocatedTransaction(
  ynabTransactionId: string,
): Promise<AllocatedTransaction | undefined> {
  const store = await getStore("allocatedTransactions");
  return requestToPromise(store.get(ynabTransactionId));
}

/** Atomic batch put — all-or-nothing for an entire sync's allocated transactions. */
export async function putAllocatedTransactions(
  transactions: AllocatedTransaction[],
): Promise<void> {
  if (transactions.length === 0) return;
  const db = await openDB();
  const tx = db.transaction("allocatedTransactions", "readwrite");
  const store = tx.objectStore("allocatedTransactions");
  for (const at of transactions) {
    store.put(at);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Product Categories (learned from user approvals) ---

export async function getProductCategory(
  id: string,
): Promise<ProductCategory | undefined> {
  const store = await getStore("productCategories");
  return requestToPromise(store.get(id));
}

export async function putProductCategory(entry: ProductCategory): Promise<void> {
  const store = await getStore("productCategories", "readwrite");
  await requestToPromise(store.put(entry));
}

// --- Categories ---

export async function getAllCategories(): Promise<Category[]> {
  const store = await getStore("categories");
  return requestToPromise(store.getAll());
}

/** Replace all categories atomically. */
export async function putCategories(categories: Category[]): Promise<void> {
  const db = await openDB();
  const tx = db.transaction("categories", "readwrite");
  const store = tx.objectStore("categories");
  store.clear();
  for (const cat of categories) {
    store.put(cat);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `pnpm compile`
Expected: errors in any file importing `getItemizedTransaction` / `putItemizedTransaction` / `ItemizedTransaction`. Note the file paths — those are the consumers we fix in subsequent tasks (`background/sync.ts`, `background/approval.ts`).

- [ ] **Step 3: Commit**

```bash
git add lib/db.ts
git commit -m "db: redefine v1 schema with allocatedTransactions store"
```

Note: leaves the codebase in a non-compiling state. Subsequent tasks fix consumers; the burn-down is a single coherent branch.

---

## Task 7: Implement Amazon RetailerAdapter

**Files:**
- Create: `retailers/amazon/adapter.ts`

This task moves the list-pagination + match + detail-scrape logic from `background/amazon-scraper.ts` into the adapter, with the new return shape. `background/amazon-scraper.ts` is not deleted yet (Task 13) so any code still importing it keeps compiling.

- [ ] **Step 1: Create the Amazon adapter**

Create `retailers/amazon/adapter.ts`:

```ts
import type {
  RetailerAdapter,
  ScrapedOrder,
  ScrapedItem,
  YnabCharge,
  PayeeMapping,
} from "@/lib/types";
import { matchByAmountAndDate, cutoffDateFor } from "@/lib/matcher";
import { openRetailerTab, waitForTabLoad } from "@/background/tabs";
import { orderDetailUrl } from "@/retailers/amazon/selectors";
import type { RawTransaction, RawItem } from "@/retailers/amazon/scraper";
import { groupBy } from "remeda";

const START_URL = "https://www.amazon.com/cpe/yourpayments/transactions";

const PAYEES: PayeeMapping[] = [
  { pattern: /amazon prime/i, retailer: "amazon", strategy: "skip" },
  { pattern: /amazon tips/i, retailer: "amazon", strategy: "skip" },
  { pattern: /amazon|amzn mktp/i, retailer: "amazon", strategy: "scrape" },
];

export const amazonAdapter: RetailerAdapter = {
  id: "amazon",
  payees: PAYEES,

  async scrapeMatchedOrders(charges) {
    const tabResult = await openRetailerTab(START_URL);
    if (!tabResult) {
      return {
        matched: [],
        unmatched: charges.map((c) => ({ charge: c, reason: "Failed to open Amazon tab" })),
      };
    }
    const { tabId, weOpenedTab } = tabResult;

    try {
      // Auth check
      const authResponse = (await browser.tabs.sendMessage(tabId, { type: "CHECK_AUTH" })) as
        | { authenticated: boolean }
        | { error: string };

      if ("error" in authResponse) {
        return {
          matched: [],
          unmatched: charges.map((c) => ({ charge: c, reason: authResponse.error })),
        };
      }

      if (!authResponse.authenticated) {
        await browser.tabs.update(tabId, { active: true });
        return {
          matched: [],
          unmatched: charges.map((c) => ({ charge: c, reason: "Amazon auth required" })),
        };
      }

      // Phase 1: paginate list page and match
      const { matchedPairs, unmatchedCharges, error } = await paginateAndMatch(tabId, charges);

      // Phase 2: group by orderId, scrape detail page per order
      const byOrderId = groupBy(matchedPairs, ([_charge, raw]) => raw.orderId!);

      const matchedOrders: { order: ScrapedOrder; charges: YnabCharge[] }[] = [];
      const detailFailures: { charge: YnabCharge; reason: string }[] = [];

      for (const [orderId, pairs] of Object.entries(byOrderId)) {
        const { items, error: scrapeError } = await scrapeOrderItems(tabId, orderId);

        if (items.length === 0) {
          for (const [charge] of pairs) {
            detailFailures.push({
              charge,
              reason: scrapeError ?? "Failed to scrape order items",
            });
          }
          continue;
        }

        const order: ScrapedOrder = {
          retailer: "amazon",
          orderId,
          items,
          scrapedAt: new Date().toISOString(),
        };
        const orderCharges = pairs.map(([charge]) => charge);
        matchedOrders.push({ order, charges: orderCharges });
      }

      const allUnmatched = [
        ...unmatchedCharges.map((c) => ({
          charge: c,
          reason: error ?? "No matching Amazon order found",
        })),
        ...detailFailures,
      ];

      return { matched: matchedOrders, unmatched: allUnmatched };
    } finally {
      if (weOpenedTab) {
        browser.tabs.remove(tabId).catch(() => {});
      }
    }
  },
};

// ----------------------------------------------------------------------------
// Internal: list-page pagination + matching
// ----------------------------------------------------------------------------

const MAX_PAGES = 10;

interface PaginateResult {
  matchedPairs: [YnabCharge, RawTransaction][];
  unmatchedCharges: YnabCharge[];
  error?: string;
}

async function paginateAndMatch(
  tabId: number,
  charges: YnabCharge[],
): Promise<PaginateResult> {
  // Build a synthetic YnabTransaction-shaped object for cutoffDateFor.
  // cutoffDateFor uses .date only, so this is safe.
  const cutoffIso = cutoffDateFor(charges.map((c) => ({ date: c.date }) as any));
  let candidates: RawTransaction[] = [];
  let remaining = [...charges];
  let allMatched: [YnabCharge, RawTransaction][] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const txResponse = (await browser.tabs.sendMessage(tabId, {
      type: "SCRAPE_TRANSACTIONS",
    })) as { transactions: RawTransaction[] } | { error: string };

    if ("error" in txResponse) {
      return { matchedPairs: allMatched, unmatchedCharges: remaining, error: txResponse.error };
    }

    if (txResponse.transactions.length === 0) break;

    const allCandidates = [...candidates, ...txResponse.transactions];
    const matchedThisPage: [YnabCharge, RawTransaction][] = [];
    const stillUnmatched: YnabCharge[] = [];
    const matchedRaws = new Set<RawTransaction>();

    for (const charge of remaining) {
      const match = matchByAmountAndDate(charge.amountCents, charge.date, allCandidates);
      if (match?.orderId && !matchedRaws.has(match)) {
        matchedThisPage.push([charge, match]);
        matchedRaws.add(match);
      } else {
        stillUnmatched.push(charge);
      }
    }

    allMatched = [...allMatched, ...matchedThisPage];
    remaining = stillUnmatched;
    candidates = allCandidates.filter((c) => !matchedRaws.has(c));

    if (remaining.length === 0) break;

    const oldestOnPage = txResponse.transactions.reduce(
      (min, t) => (t.date < min ? t.date : min),
      txResponse.transactions[0].date,
    );
    if (oldestOnPage < cutoffIso) break;

    const pageResult = (await browser.tabs.sendMessage(tabId, {
      type: "NEXT_PAGE",
    })) as { hasNext: boolean };
    if (!pageResult.hasNext) break;
  }

  return { matchedPairs: allMatched, unmatchedCharges: remaining };
}

// ----------------------------------------------------------------------------
// Internal: detail-page item scrape
// ----------------------------------------------------------------------------

async function scrapeOrderItems(
  tabId: number,
  orderId: string,
): Promise<{ items: ScrapedItem[]; error?: string }> {
  await browser.tabs.update(tabId, { url: orderDetailUrl(orderId) });
  await waitForTabLoad(tabId);

  const response = (await browser.tabs.sendMessage(tabId, {
    type: "SCRAPE_ITEMS",
  })) as { items: RawItem[] } | { error: string };

  if ("error" in response) return { items: [], error: response.error };

  return {
    items: response.items.map(
      (raw): ScrapedItem => ({
        productId: raw.productId,
        title: raw.title,
        imageUrl: raw.imageUrl,
        unitPriceCents: raw.priceCents,
        quantity: raw.quantity,
      }),
    ),
  };
}
```

- [ ] **Step 2: Update `lib/matcher.ts` to accept the new YnabCharge shape**

`matchByAmountAndDate` is already generic over `{ date, amountCents }` — works for `YnabCharge`. The issue is `tryMatchEntries` which is `YnabTransaction`-specific. We replaced its use with inline matching in the adapter above, so `tryMatchEntries` becomes unused (will be removed in Task 13). `cutoffDateFor` only uses `.date` so it works with `YnabCharge` via the synthetic-shape pattern in the adapter.

No edit to `lib/matcher.ts` needed at this point.

- [ ] **Step 3: Verify the adapter compiles**

Run: `pnpm compile`
Expected: errors in `background/sync.ts` and `background/approval.ts` (existing consumers of old types) but no new errors in `retailers/amazon/adapter.ts`.

- [ ] **Step 4: Commit**

```bash
git add retailers/amazon/adapter.ts
git commit -m "feat(retailers): Amazon adapter implementing RetailerAdapter"
```

---

## Task 8: Create retailer registry; derive payee mappings from adapters

**Files:**
- Create: `retailers/registry.ts`
- Modify: `lib/registry.ts`

- [ ] **Step 1: Create `retailers/registry.ts`**

Create `retailers/registry.ts`:

```ts
import type { RetailerAdapter } from "@/lib/types";
import { amazonAdapter } from "./amazon/adapter";

/** All registered retailer adapters. */
export const adapters: RetailerAdapter[] = [amazonAdapter];

/** Look up an adapter by id. Throws if not registered. */
export function getAdapter(id: string): RetailerAdapter {
  const adapter = adapters.find((a) => a.id === id);
  if (!adapter) throw new Error(`No adapter registered for retailer: ${id}`);
  return adapter;
}
```

- [ ] **Step 2: Rewrite `lib/registry.ts` to derive payee mappings from adapters**

Replace `lib/registry.ts`:

```ts
import { adapters } from "@/retailers/registry";

/** All payee mappings derived from the registered retailer adapters. */
export const payeeMappings = adapters.flatMap((adapter) => adapter.payees);

/** Match a YNAB payee name to a retailer. Returns the first matching pattern. */
export function getRetailerForPayee(
  payeeName: string,
): { retailer: string; strategy: "scrape" | "skip" } | null {
  for (const mapping of payeeMappings) {
    if (mapping.pattern.test(payeeName)) {
      return { retailer: mapping.retailer, strategy: mapping.strategy };
    }
  }
  return null;
}
```

- [ ] **Step 3: Verify compilation**

Run: `pnpm compile`
Expected: existing errors in sync.ts/approval.ts remain; no new errors. The hardcoded `retailerStartUrls` export is removed — `background/amazon-scraper.ts` and `background/sync.ts` import it; those go away in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add retailers/registry.ts lib/registry.ts
git commit -m "feat(retailers): adapter registry; derive payee mappings from adapters"
```

---

## Task 9: Rewrite `background/sync.ts` as pipeline composition

**Files:**
- Modify: `background/sync.ts`

- [ ] **Step 1: Rewrite sync orchestration**

Replace `background/sync.ts` with:

```ts
import { getSettings } from "@/lib/settings";
import { getUnapprovedTransactions } from "@/lib/ynab";
import { getAllocatedTransaction, putAllocatedTransactions } from "@/lib/db";
import { getRetailerForPayee } from "@/lib/registry";
import { getAdapter } from "@/retailers/registry";
import { classifyItems } from "@/lib/classifier";
import { distributeOrder } from "@/lib/distribution";
import { millunitsToCents } from "@/lib/money";
import { groupBy } from "remeda";
import type {
  YnabTransaction,
  YnabCharge,
  AllocatedTransaction,
  QueueEntry,
} from "@/lib/types";

/** Deduplicate concurrent sync calls. */
let activeSyncPromise: Promise<{ queue: QueueEntry[] } | { error: string }> | null = null;

export async function performSync(): Promise<{ queue: QueueEntry[] } | { error: string }> {
  if (activeSyncPromise) return activeSyncPromise;
  activeSyncPromise = performSyncInner();
  try {
    return await activeSyncPromise;
  } finally {
    activeSyncPromise = null;
  }
}

async function performSyncInner(): Promise<{ queue: QueueEntry[] } | { error: string }> {
  try {
    const settings = await getSettings();
    if (!settings.ynabToken || !settings.planId) {
      return { error: "Not connected to YNAB" };
    }

    // 1. IDENTIFY: fetch YNAB charges, group by retailer
    const ynabTxs = await getUnapprovedTransactions(settings.ynabToken, settings.planId);

    const taggedCharges = ynabTxs
      .filter((tx) => tx.payee_name !== null)
      .map((tx) => {
        const match = getRetailerForPayee(tx.payee_name!);
        return match?.strategy === "scrape"
          ? { tx, charge: toYnabCharge(tx), retailer: match.retailer }
          : null;
      })
      .filter((x): x is { tx: YnabTransaction; charge: YnabCharge; retailer: string } => x !== null);

    // Fast path: cached transactions skip scraping
    const fastPath: QueueEntry[] = [];
    const needsScraping: typeof taggedCharges = [];

    for (const entry of taggedCharges) {
      const cached = await getAllocatedTransaction(entry.tx.id);
      if (cached) {
        const classifiedItems = await classifyItems(cached.items, entry.retailer);
        fastPath.push({
          ynabTransaction: entry.tx,
          retailer: entry.retailer,
          matchStatus: { status: "matched", order: cached, classifiedItems },
        });
      } else {
        needsScraping.push(entry);
      }
    }

    const chargesByRetailer = groupBy(needsScraping, (e) => e.retailer);

    const allAllocated: AllocatedTransaction[] = [];
    const errorEntries: QueueEntry[] = [];

    for (const [retailerId, retailerEntries] of Object.entries(chargesByRetailer)) {
      const adapter = getAdapter(retailerId);
      const retailerCharges = retailerEntries.map((e) => e.charge);

      // 2. SCRAPE + MATCH (adapter owns tab lifecycle and cleanup)
      const { matched, unmatched } = await adapter.scrapeMatchedOrders(retailerCharges);

      // 3. DISTRIBUTE
      const allocated = matched.flatMap(({ order, charges }) => distributeOrder(order, charges));

      // Map distribution failures (empty result) to error entries
      for (const { order, charges } of matched) {
        const allocatedIds = new Set(
          allocated.filter((a) => a.orderKey === `${order.retailer}:${order.orderId}`)
            .map((a) => a.ynabTransactionId),
        );
        for (const charge of charges) {
          if (!allocatedIds.has(charge.ynabTransactionId)) {
            const tx = retailerEntries.find((e) => e.charge.ynabTransactionId === charge.ynabTransactionId)!.tx;
            errorEntries.push({
              ynabTransaction: tx,
              retailer: retailerId,
              matchStatus: {
                status: "error",
                message: "Could not partition items across charges (too many items or charges > items)",
              },
            });
          }
        }
      }

      allAllocated.push(...allocated);

      // Map unmatched charges to no_match QueueEntries
      for (const { charge, reason } of unmatched) {
        const tx = retailerEntries.find((e) => e.charge.ynabTransactionId === charge.ynabTransactionId)?.tx;
        if (!tx) continue;
        errorEntries.push({
          ynabTransaction: tx,
          retailer: retailerId,
          matchStatus: reason === "No matching Amazon order found"
            ? { status: "no_match" }
            : { status: "error", message: reason },
        });
      }
    }

    // 4. PERSIST (atomic batch write)
    await putAllocatedTransactions(allAllocated);

    // 5. CLASSIFY (post-persist; failures degrade to "no suggestion", not data loss)
    const matchedEntries: QueueEntry[] = [];
    for (const at of allAllocated) {
      const entry = needsScraping.find((e) => e.charge.ynabTransactionId === at.ynabTransactionId);
      if (!entry) continue;
      const classifiedItems = await classifyItems(at.items, entry.retailer);
      matchedEntries.push({
        ynabTransaction: entry.tx,
        retailer: entry.retailer,
        matchStatus: { status: "matched", order: at, classifiedItems },
      });
    }

    // 6. QUEUE
    return { queue: [...fastPath, ...matchedEntries, ...errorEntries] };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Sync failed" };
  }
}

/** Convert a YNAB transaction to a normalized YnabCharge. */
function toYnabCharge(tx: YnabTransaction): YnabCharge {
  return {
    ynabTransactionId: tx.id,
    date: tx.date,
    amountCents: millunitsToCents(tx.amount),
    payeeName: tx.payee_name ?? "",
    isRefund: tx.amount > 0, // YNAB outflows negative; positive amount = refund/inflow
    cardLastFour: null, // not in YNAB API; would come from a card field if present
  };
}
```

- [ ] **Step 2: Verify compilation**

Run: `pnpm compile`
Expected: `background/sync.ts` compiles. `background/approval.ts` still has type errors (uses old `ItemizedTransaction`/`ApprovalItem`). Other consumers may still have errors — those are fixed in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add background/sync.ts
git commit -m "feat(sync): rewrite as pipeline composition over adapter + distributeOrder"
```

---

## Task 10: Simplify `ApprovalItem` and update approval flow

**Files:**
- Modify: `lib/types.ts`
- Modify: `background/approval.ts`
- Modify: `entrypoints/sidepanel/App.tsx` (and any other ApprovalItem producers)

- [ ] **Step 1: Simplify `ApprovalItem`**

In `lib/types.ts`, replace the existing `ApprovalItem`:

```ts
/**
 * The user's category choice for one item in a transaction. Slimmer than
 * the scraped item: price, quantity, title, and allocatedCents all come
 * from the persisted AllocatedTransaction (joined by productId server-side).
 */
export interface ApprovalItem {
  productId: string;
  categoryId: string;
}
```

- [ ] **Step 2: Update `background/approval.ts`**

Replace `background/approval.ts`:

```ts
import { getSettings } from "@/lib/settings";
import { updateTransaction } from "@/lib/ynab";
import { getAllocatedTransaction, getProductCategory, putProductCategory } from "@/lib/db";
import { classifyItems } from "@/lib/classifier";
import type { AllocatedTransaction, ApprovalItem } from "@/lib/types";

/** Check whether all items share the same category. */
function isSingleCategory(items: ApprovalItem[]): boolean {
  return items.length > 0 && items.every((item) => item.categoryId === items[0].categoryId);
}

/**
 * Build YNAB subtransactions by joining the user's category choices to the
 * persisted AllocatedTransaction. Per-item amounts come from item.allocatedCents
 * — no recomputation here.
 */
function buildSubtransactions(
  tx: AllocatedTransaction,
  choices: ApprovalItem[],
): Array<{ amount: number; category_id: string | null; memo: string | null }> {
  const sign = tx.isRefund ? 10 : -10; // YNAB milliunits; outflows negative
  const choiceById = new Map(choices.map((c) => [c.productId, c.categoryId]));

  return tx.items.map((item) => ({
    amount: item.allocatedCents * sign,
    category_id: choiceById.get(item.productId) ?? null,
    memo: item.title,
  }));
}

/** Learn from this approval — save product→category mappings for future classification. */
async function learnFromApproval(retailer: string, choices: ApprovalItem[]): Promise<void> {
  for (const choice of choices) {
    const key = `${retailer}:${choice.productId}`;
    const existing = await getProductCategory(key);
    await putProductCategory({
      id: key,
      categoryId: choice.categoryId,
      confirmedByUser: true,
      timesSeen: (existing?.timesSeen ?? 0) + 1,
      lastSeen: new Date().toISOString(),
    });
  }
}

export async function approveTransaction(
  ynabTransactionId: string,
  items: ApprovalItem[],
): Promise<{ ok: true } | { error: string }> {
  try {
    const settings = await getSettings();
    if (!settings.ynabToken || !settings.planId) {
      return { error: "Not connected to YNAB" };
    }

    const tx = await getAllocatedTransaction(ynabTransactionId);
    if (!tx) {
      return { error: "Transaction not found — try syncing again" };
    }

    const update = isSingleCategory(items)
      ? { category_id: items[0].categoryId, approved: true }
      : { subtransactions: buildSubtransactions(tx, items), approved: true };

    await updateTransaction(settings.ynabToken, settings.planId, ynabTransactionId, update);

    await learnFromApproval(tx.retailer, items);

    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to approve transaction" };
  }
}

export async function approveBatch(
  ynabTransactionIds: string[],
): Promise<{ ok: true; errors: string[] } | { error: string }> {
  const errors: string[] = [];

  for (const ynabTxId of ynabTransactionIds) {
    const tx = await getAllocatedTransaction(ynabTxId);
    if (!tx) {
      errors.push(`${ynabTxId}: transaction not found`);
      continue;
    }

    const classifiedItems = await classifyItems(tx.items, tx.retailer);

    // Skip if any item is uncategorized — partial approval would inflate categorized amounts
    const allCategorized = classifiedItems.every((ci) => ci.suggestedCategoryId !== null);
    if (!allCategorized) {
      errors.push(`${ynabTxId}: not all items have categories assigned`);
      continue;
    }

    const items: ApprovalItem[] = classifiedItems.map((ci) => ({
      productId: ci.productId,
      categoryId: ci.suggestedCategoryId!,
    }));

    const result = await approveTransaction(ynabTxId, items);
    if ("error" in result) {
      errors.push(`${ynabTxId}: ${result.error}`);
    }
  }

  return { ok: true, errors };
}
```

- [ ] **Step 3: Update side-panel approval call sites**

Run: `grep -n "price:\|quantity:" /home/michael/projects/itemize/entrypoints/sidepanel/App.tsx /home/michael/projects/itemize/components/DetailView.tsx | grep -i "approve\|ApprovalItem"`

Find every place that constructs an `ApprovalItem` literal and reduce it to `{ productId, categoryId }`. The compiler will help — `pnpm compile` lists exactly the call sites that pass extra fields.

For each call site, change e.g.:
```ts
{ productId: item.productId, title: item.title, price: item.price, quantity: item.quantity, categoryId }
```
to:
```ts
{ productId: item.productId, categoryId }
```

- [ ] **Step 4: Verify compilation**

Run: `pnpm compile`
Expected: type errors related to old `LineItem.price` may surface in `components/SplitBreakdown.tsx`, `DetailView.tsx`, etc. — fixed in next tasks.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts background/approval.ts entrypoints/sidepanel/App.tsx
git commit -m "feat(approval): simplify ApprovalItem; read allocatedCents from persisted record"
```

(Include any other touched files in the `git add` based on what step 3 revealed.)

---

## Task 11: Update `SplitBreakdown.tsx` to read `allocatedCents`

**Files:**
- Modify: `components/SplitBreakdown.tsx`

- [ ] **Step 1: Rewrite SplitBreakdown to read allocations directly**

Replace `components/SplitBreakdown.tsx`:

```tsx
import type { Category } from "@/lib/types";
import { formatCents } from "@/lib/money";
import { sum } from "remeda";

interface SplitItem {
  allocatedCents: number;
  categoryId: string | null;
}

interface SplitBreakdownProps {
  items: SplitItem[];
  totalAmountCents: number; // the YNAB transaction amount (always positive cents)
  categories: Category[];
}

export default function SplitBreakdown({ items, totalAmountCents, categories }: SplitBreakdownProps) {
  // Aggregate allocated cents by category
  const categoryById = new Map(categories.map((c) => [c.id, c.name]));
  const categoryTotals = items.reduce<Map<string, number>>((acc, item) => {
    const key = item.categoryId ?? "__uncategorized__";
    return new Map(acc).set(key, (acc.get(key) ?? 0) + item.allocatedCents);
  }, new Map());

  const rows = [...categoryTotals.entries()].map(([key, amount]) => ({
    key,
    label: key === "__uncategorized__" ? "Uncategorized" : (categoryById.get(key) ?? key),
    amount,
    isUncategorized: key === "__uncategorized__",
  }));

  // Sanity check: sum of allocations should equal the total. If not, something
  // upstream is wrong — show a small marker but don't crash.
  const allocatedSum = sum(items.map((i) => i.allocatedCents));
  const matchesTotal = allocatedSum === totalAmountCents;

  return (
    <div className="rounded-md bg-gray-900 border border-gray-700 px-3 py-2.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
        Split Breakdown
      </p>

      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-2">
            <span
              className={`text-sm truncate ${row.isUncategorized ? "text-gray-500 italic" : "text-gray-200"}`}
            >
              {row.label}
            </span>
            <span className="text-sm text-gray-200 shrink-0">{formatCents(row.amount)}</span>
          </div>
        ))}
      </div>

      <div className="my-2 border-t border-gray-700" />

      <div className="flex items-center justify-between gap-2">
        {!matchesTotal ? (
          <span className="text-xs text-amber-500" title="Allocation mismatch — re-sync recommended">
            ⚠ Allocations don't match total
          </span>
        ) : (
          <span />
        )}
        <span className="text-sm font-medium text-gray-100 shrink-0">
          {formatCents(totalAmountCents)}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update call sites to pass `allocatedCents`**

Run: `grep -rn "SplitBreakdown" /home/michael/projects/itemize/components /home/michael/projects/itemize/entrypoints --include="*.tsx"`

For each call site, change items shape from `{ price, quantity, categoryId }` to `{ allocatedCents, categoryId }`. With the new `AllocatedItem` type, that field is already on each item — typically just:

```tsx
<SplitBreakdown
  items={order.items.map((item, i) => ({
    allocatedCents: item.allocatedCents,
    categoryId: classifiedItems[i]?.suggestedCategoryId ?? null,
  }))}
  totalAmountCents={order.amountCents}
  categories={categories}
/>
```

- [ ] **Step 3: Verify compilation**

Run: `pnpm compile`
Expected: SplitBreakdown and its callers compile.

- [ ] **Step 4: Commit**

```bash
git add components/SplitBreakdown.tsx
# plus any callers touched in step 2
git commit -m "ui(split-breakdown): read allocatedCents directly; remove distributeRemainder dep"
```

---

## Task 12: Update remaining UI components for new types

**Files:**
- Modify: `components/DetailView.tsx`, `components/TransactionCard.tsx`, `entrypoints/sidepanel/App.tsx`, any others using `LineItem` / `ItemizedTransaction`

- [ ] **Step 1: Find all consumers of removed types**

Run:
```bash
grep -rn "LineItem\|ItemizedTransaction" /home/michael/projects/itemize/components /home/michael/projects/itemize/entrypoints /home/michael/projects/itemize/lib --include="*.ts" --include="*.tsx" | grep -v node_modules
```

- [ ] **Step 2: Update each consumer**

Substitution rules:
- Type `LineItem` → `AllocatedItem` (anywhere a persisted item is read — DetailView, TransactionCard, QueueEntry consumers)
- Type `ItemizedTransaction` → `AllocatedTransaction`
- Field access `item.price` → `item.unitPriceCents` (the per-unit display value, which is what `price` previously meant)
- Field access `item.price * item.quantity` → `item.allocatedCents` if the goal was "this item's share of the charge" (formerly approximated by raw-subtotal); else keep `item.unitPriceCents * item.quantity` if the goal is "what you paid before tax/shipping."

`ItemCard` keeps its existing `price: number` prop shape — callers pass `item.unitPriceCents` as the `price` value (same semantics as today). No prop rename needed.

- [ ] **Step 3: Verify compilation**

Run: `pnpm compile`
Expected: clean compile, no errors.

- [ ] **Step 4: Commit**

```bash
git add components/ entrypoints/sidepanel/
git commit -m "ui: thread AllocatedTransaction/AllocatedItem types through detail + queue views"
```

---

## Task 13: Burn down old code

**Files:**
- Delete: `background/amazon-scraper.ts`
- Delete: `lib/utils.ts`
- Modify: `lib/money.ts` (remove `findItemSubset`, `distributeRemainder`)
- Modify: `lib/types.ts` (remove `ItemizedTransaction`, `LineItem`)
- Modify: `lib/matcher.ts` (remove `tryMatchEntries` if unused after adapter migration)

- [ ] **Step 1: Confirm `background/amazon-scraper.ts` has no remaining importers**

Run: `grep -rn "amazon-scraper" /home/michael/projects/itemize --include="*.ts" --include="*.tsx" | grep -v node_modules`
Expected: no results (or only the file itself).

If any importers remain, fix them before proceeding.

- [ ] **Step 2: Delete `background/amazon-scraper.ts`**

Run: `rm /home/michael/projects/itemize/background/amazon-scraper.ts`

- [ ] **Step 3: Confirm `lib/utils.ts` has no remaining importers**

Run: `grep -rn "from \"@/lib/utils\"\|from \"./utils\"\|from \"../lib/utils\"" /home/michael/projects/itemize --include="*.ts" --include="*.tsx" | grep -v node_modules`
Expected: no results.

If any remain, replace with `import { groupBy } from "remeda"` (note: `R.groupBy` returns a `Record`, not a `Map` — update call sites accordingly).

- [ ] **Step 4: Delete `lib/utils.ts`**

Run: `rm /home/michael/projects/itemize/lib/utils.ts`

- [ ] **Step 5: Strip `findItemSubset` and `distributeRemainder` from `lib/money.ts`**

Replace `lib/money.ts` with currency helpers only:

```ts
/** Convert YNAB milliunits to absolute cents. Milliunits are signed (negative = outflow). */
export function millunitsToCents(milliunits: number): number {
  return Math.abs(Math.round(milliunits / 10));
}

/** Format integer cents as a dollar string, e.g. 4299 → "$42.99". */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Parse a dollar string like "$42.99" to integer cents (4299). Strips non-numeric characters. */
export function parseDollarsToCents(dollars: string): number {
  const value = parseFloat(dollars.replace(/[^0-9.-]/g, ""));
  if (isNaN(value)) return 0;
  return Math.abs(Math.round(value * 100));
}
```

- [ ] **Step 6: Remove `ItemizedTransaction` and `LineItem` from `lib/types.ts`**

In `lib/types.ts`, delete the `ItemizedTransaction` interface and the `LineItem` interface. (Other types referring to them — `OrderMatchStatus`, `ClassifiedItem`, `QueueEntry` — need to use `AllocatedTransaction` and `AllocatedItem` instead.)

Update `OrderMatchStatus`:
```ts
export type OrderMatchStatus =
  | { status: "loading" }
  | { status: "matched"; order: AllocatedTransaction; classifiedItems: ClassifiedItem[] }
  | { status: "no_match" }
  | { status: "auth_required" }
  | { status: "error"; message: string };
```

Update `ClassifiedItem`:
```ts
/** An AllocatedItem enriched with the classifier's suggestion. */
export interface ClassifiedItem extends AllocatedItem {
  suggestedCategoryId: string | null;
  classificationSource: "product_cache" | null;
}
```

- [ ] **Step 7: Check if `tryMatchEntries` is still used**

Run: `grep -rn "tryMatchEntries" /home/michael/projects/itemize --include="*.ts" --include="*.tsx" | grep -v node_modules`

If only the definition appears, delete it from `lib/matcher.ts`. If it's used elsewhere, leave it.

- [ ] **Step 8: Verify everything still compiles and tests pass**

Run:
```bash
pnpm compile
pnpm test:run
```
Expected: clean compile, all 26 distribution tests pass.

- [ ] **Step 9: Commit**

```bash
git add lib/money.ts lib/types.ts lib/matcher.ts
git rm background/amazon-scraper.ts lib/utils.ts
git commit -m "refactor: delete burned-down code (old scraper, utils, tolerance-based matching)"
```

---

## Task 14: Manual end-to-end verification

The unit test suite covers the algorithm exhaustively but does not exercise the DOM-scraping path. Manual verification against real data is the integration check.

- [ ] **Step 1: Clear the existing IndexedDB so the new schema takes effect**

Open the extension's side panel in Chrome → DevTools (right-click → Inspect on the side panel) → Application → IndexedDB → right-click `itemize` → Delete database.

- [ ] **Step 2: Run a sync**

Reload the side panel, click Sync. Expect to see your unapproved YNAB transactions populate, with Amazon orders scraping items.

- [ ] **Step 3: Inspect a single-charge order**

Pick a transaction backed by a single Amazon charge. Verify in the side panel:
- Items display with their per-unit price (`unitPriceCents`)
- The Split Breakdown total matches the YNAB amount exactly
- Allocated amounts (visible in DevTools IDB inspector under `allocatedTransactions`) sum to the charge total

- [ ] **Step 4: Inspect a split-shipment order**

Find an order that produced two YNAB charges. Verify:
- Two separate QueueEntries appear, one per charge
- Items are partitioned between them (no double-counting)
- Each entry's Split Breakdown sums to its YNAB amount
- IDB has two `AllocatedTransaction` records sharing the same `orderKey`

- [ ] **Step 5: Approve a multi-category transaction**

Pick a transaction with items spanning multiple categories. Approve it. Verify in YNAB:
- The transaction has subtransactions
- Subtransaction amounts sum exactly to the YNAB transaction amount
- Categories match what you selected

- [ ] **Step 6: Re-sync (fast path)**

Click Sync again. Verify that previously-synced transactions appear instantly (fast path from IDB cache) and that the side panel state is unchanged.

- [ ] **Step 7: (Optional) Test an edge case if you have one available**

If you have a recent order with a gift card, item-level discount, or per-charge shipping, sync it and inspect. The totals should always match exactly; item attribution may have minor swaps for the asymmetric-adjustment cases (acceptable per the design).

- [ ] **Step 8: No commit needed**

Manual verification doesn't produce code changes. If something fails, file a bug and iterate; otherwise the branch is ready to merge.

---

## Done

After Task 14 passes, the branch is ready for review and merge to `main`.
