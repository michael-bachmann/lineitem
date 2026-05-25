# Distribution pipeline redesign

**Status:** Draft
**Date:** 2026-05-24
**Supersedes:** BAC-111 (originally scoped as a `findItemSubset` rewrite; expanded after design conversation to a full pipeline refactor)
**Tracks:** BAC-111

## Summary

Replace the current scrape-and-match flow with a clean, composable pipeline. Introduce a `RetailerAdapter` interface so additional retailers can plug in without touching the algorithm or persistence. Replace the tolerance-based per-charge subset-sum with a globally-optimal partition that minimizes total per-charge distance, and expose it as one pure end-to-end function (`distributeOrder`) that production uses and tests exercise directly. Store per-item allocated amounts on persisted records so display and approval are dumb readers rather than re-derivers.

Burn down the current `scrapeItemsForMatches`, `ItemizedTransaction`/`LineItem` shapes, and the tolerance-based `findItemSubset`. Clear IndexedDB; the app has no shipped users.

## Motivation

The current sync flow tangles scraping, matching, classification, and IndexedDB writes inside one loop (`scrapeItemsForMatches`). This has three concrete problems:

1. **Partial writes.** If anything fails mid-loop, IndexedDB is left in an inconsistent state.
2. **Duplicated allocation math.** `distributeRemainder` is recomputed at approval time (`buildSubtransactions`) and again at display time (`SplitBreakdown.tsx`). The same derivation lives in two places with no single source of truth.
3. **Retailer coupling.** Amazon-specific assumptions (group by `orderId`, paginate a specific URL) leak into general code paths. Adding a second retailer would require duplicating or rewriting the loop.

A separate algorithm-level problem (BAC-111): `findItemSubset` returns the first subset within a ±2-cent tolerance, which fails on orders with non-proportional adjustments (per-charge shipping, item-level discounts, gift cards applied to one charge).

## Goals

- **Composable pipeline.** Each phase is a pure function of its inputs (or has a clearly bounded side effect). Scraping happens entirely before any persistence; no partial writes.
- **Single source of truth for allocations.** The distribution algorithm runs once at scrape time. Its output is persisted. Approval and display read the stored values; they don't recompute.
- **Retailer-agnostic interior.** All retailer-specific logic lives behind a `RetailerAdapter`. The pipeline composes adapter output with retailer-agnostic distribution, classification, and persistence.
- **Globally-optimal item assignment.** For an order's items and charges, find the partition that minimizes the *sum of per-charge distances* — not the locally-best subset for each charge in isolation. No tolerance threshold; the algorithm always returns its best partition.
- **Algorithm is testable end-to-end.** `distributeOrder` takes scraped data and YNAB charges, returns the final per-charge per-item cent allocations. Tests speak in scenarios; no mocks.
- **Functional utilities via remeda.** Adopt [remeda](https://remedajs.com) for `sum`, `sumBy`, `groupBy`, `partition`, `sortBy`, `zip`, etc. — first-class TypeScript inference, data-first by default. Reduces verbosity and aligns with the existing codebase's functional style preference. The homegrown `lib/utils.ts:groupBy` is replaced by `R.groupBy`.

## Non-goals

- **Confidence/quality signal in the UI.** Mis-assignment from ambiguous structural adjustments (gift cards, item-level discounts not in the scraped price) is acceptable; totals always remain exact via the allocation step. Decision made during design.
- **"Items vastly smaller than charges" sanity check.** Orthogonal scraping-reliability concern; filed as [BAC-113](https://linear.app/bachmann/issue/BAC-113/detect-incomplete-scrapes-items-vastly-smaller-than-charges) as a follow-up.
- **Backwards-compatible IndexedDB migration.** App has no shipped users; clearing IDB on first run of the new code is acceptable.
- **A second retailer adapter.** Define the interface and implement Amazon against it. Future retailers add their own adapter file.

## Pipeline

```
1. IDENTIFY              YNAB transactions → grouped YnabCharge[] per retailer
                         (pure)

2. SCRAPE + MATCH        adapter.scrapeMatchedOrders(charges)
                         → { matched: [{ order, charges }], unmatched }
                         (impure: DOM via browser tab; entirely encapsulated in the adapter)

3. DISTRIBUTE            matched.flatMap(({ order, charges }) => distributeOrder(order, charges))
                         → AllocatedTransaction[]
                         (pure)

4. PERSIST               single IDB transaction: put all AllocatedTransactions atomically
                         (impure but transactional)

5. CLASSIFY              attach classifier suggestions to each item for display
                         → ClassifiedItem[] per transaction
                         (pure given the productCategories cache; not persisted —
                          attached to QueueEntries only)

6. QUEUE                 return QueueEntry[] to side panel
                         (pure)
```

Phases 1, 3, 5, 6 are pure. Phase 2 has a single, clearly-bounded impure call per retailer. Phase 4 is one transactional write. No phase can leave the system in a partial state. Classification runs after persistence so a classifier failure doesn't lose scraped data; classifier output is display-only (suggestions the user can override) and doesn't need to be stored.

## Data model

All amounts are non-negative integer cents unless explicitly noted.

```ts
// ---- INPUT to the pipeline -------------------------------------------------

interface YnabCharge {
  ynabTransactionId: string;
  date: string;              // ISO date
  amountCents: number;       // positive cents, regardless of refund vs purchase
  payeeName: string;
  isRefund: boolean;
  cardLastFour: string | null;
}

// ---- ADAPTER OUTPUT (one ScrapedOrder per discovered order) ----------------

interface ScrapedOrder {
  retailer: string;
  orderId: string;           // adapter's notion of "same order"
  items: ScrapedItem[];
  scrapedAt: string;         // ISO datetime
}

interface ScrapedItem {
  productId: string;
  title: string;
  imageUrl: string;
  unitPriceCents: number;
  quantity: number;
}

// ---- PERSISTED OUTPUT (one per matched YNAB charge) ------------------------

interface AllocatedTransaction {
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

interface AllocatedItem extends ScrapedItem {
  allocatedCents: number;    // this item's share of the YNAB charge
}

// ---- APPROVAL INPUT (one per item in the user's category selections) -------

// Slimmer than today's ApprovalItem: the user only chooses a category per
// item. Price, quantity, title, and allocatedCents all come from the
// persisted AllocatedTransaction (joined by productId on the service worker
// side). Single source of truth — the side panel can't accidentally send
// stale prices.
interface ApprovalItem {
  productId: string;
  categoryId: string;
}
```

Notes:
- `AllocatedTransaction` replaces today's `ItemizedTransaction`. Field set is largely the same; the meaningful addition is `items[i].allocatedCents`.
- `ScrapedItem`/`AllocatedItem` use `unitPriceCents` (not `price`) to make the per-unit semantics explicit and disambiguate from `allocatedCents`.
- Display reads `unitPriceCents` for "what you paid per unit"; YNAB math reads `allocatedCents`. Two fields with two clear purposes.
- Per-charge "distance" from the partition (closest match's deviation) is logged to the console during `distributeOrder` for debugging but is not persisted. Re-derivable if ever needed.

## RetailerAdapter

```ts
interface RetailerAdapter {
  id: string;                            // "amazon"
  payees: PayeeMapping[];                // moved off the global registry

  /**
   * Scrape the retailer for orders covering the given YNAB charges, and
   * return the charge → order grouping the adapter discovered.
   *
   * The adapter owns its full lifecycle, including tab opening/closing,
   * list-page pagination, list-to-charge matching (Amazon: amount+date),
   * order grouping (Amazon: same orderId), and detail-page item scraping.
   * The pipeline calls this once per retailer per sync; the adapter is
   * responsible for cleanup on both success and failure paths.
   *
   * Returns matched orders with the charges they cover, plus unmatched
   * charges that couldn't be tied to an order. The adapter performs no
   * persistence and no classification.
   */
  scrapeMatchedOrders(
    charges: YnabCharge[],
  ): Promise<{
    matched: { order: ScrapedOrder; charges: YnabCharge[] }[];
    unmatched: { charge: YnabCharge; reason: string }[];
  }>;
}
```

The adapter is the single seam between the pipeline and any retailer. Adding a second retailer means writing a new adapter file; the pipeline does not change. The adapter owns whatever resources its scrape strategy requires (a browser tab for DOM-scraping adapters; an HTTP client for API-based adapters; a fixture file for the test double). None of that leaks into the pipeline.

A `retailers/registry.ts` exports an array of registered adapters; `lib/registry.ts` (payee → retailer) becomes a derived view over the adapters' `payees` arrays.

## Distribution algorithm

Lives in `lib/distribution.ts` (split out of `lib/money.ts`; money.ts stays for currency formatting/conversion utils only).

```ts
// THE algorithm. Pure. End-to-end. Production calls this; tests call this.
function distributeOrder(
  order: ScrapedOrder,
  charges: YnabCharge[],
): AllocatedTransaction[]
```

Composed internally from two pure helpers:

```ts
// Globally partition every item across charges.
// - Recursive partition with branch-and-bound: tries every assignment of
//   items to charges, prunes branches whose partial total distance already
//   exceeds the best partition found so far.
// - Each item lands in exactly one charge.
// - The returned partition minimizes the SUM of per-charge distances,
//   where each distance is |sum(subset) × ratio − chargeAmount|.
// - Charges may be processed in any order internally; result is returned
//   in input charge order.
// - n ≤ 20 cap on items per order; returns null if exceeded.
function assignItemsToCharges(
  itemSubtotalsCents: number[],
  chargeAmountsCents: number[],
  orderTotalCents: number,       // sum of all charges
  itemsSubtotalCents: number,    // sum of all item subtotals
): { indicesPerCharge: number[][]; distanceCentsPerCharge: number[] } | null

// Allocate totalCents across items by their relative subtotals.
// Exact-sum guarantee: rounding error absorbed by the last item.
function allocateProportional(
  itemSubtotalsCents: number[],
  totalCents: number,
): number[]                       // returns per-item shares; sum === totalCents
```

### Why global instead of greedy

Greedy (process charges largest-first, pick the closest subset for each in turn) is correct for most inputs but vulnerable to unlucky tie-breaking. Concrete failure: items `[$10, $20, $30, $40]`, charges `[$40, $30, $30]`. For the $40 charge, both `{$40}` and `{$10, $30}` tie at distance 0. If greedy picks `{$10, $30}`, the remaining $20 and $40 can't cleanly cover two $30 charges — total error 20. The globally optimal partition (`{$40} | {$30} | {$10, $20}`) has total error 0.

Global eliminates this class of failure with no observable performance cost on realistic inputs (small N, small M), and without depending on tie-break heuristics that mitigate symptoms rather than root cause. Branch-and-bound keeps the worst case tractable: once a low-error partition is found early, most branches are pruned immediately.

The contract is identical to a greedy implementation — same inputs, same return shape — so the call site is unchanged.

### Behavior in scenarios

**The headline case this redesign exists for: split shipments.** One Amazon `orderId` produces multiple YNAB charges (one per shipment), and the order detail page shows *all* items across all shipments together. The adapter groups list-page rows by `orderId`, scrapes the detail page once, and returns one `{ order, charges: [...] }` entry with all items and all charges. `distributeOrder` partitions items across charges; one `AllocatedTransaction` is emitted per YNAB charge.

All other behavior, for reference:

| Scenario | Behavior |
|---|---|
| Single charge, single order | One bucket; the charge gets all items. `allocateProportional` spreads tax/shipping/discounts proportionally across items. |
| Cached order (already in IDB) | Fast path: skip scrape entirely; reuse stored `AllocatedTransaction`; re-classify items for display. |
| Refund | Same as standard single charge; `isRefund` flag carried through and affects sign only at the YNAB submission boundary. |
| Unmatched charge (no matching retailer order) | Adapter returns the charge in `unmatched` with a reason; becomes a `no_match` QueueEntry. |
| Multi-charge, all proportional adjustments (tax, % discount on subtotal) | Exact partition (distance = 0 modulo rounding) for every charge. |
| Multi-charge, per-charge shipping (asymmetric — e.g. shipping on the non-Prime shipment only) | Distance reflects the asymmetry as a small per-charge offset; partition usually still correct because the partition minimizing *total* distance tends to attribute items correctly. |
| Multi-charge, item-level discount on a separate line (scraped per-unit price doesn't reflect the discount) | Algorithm sees inflated prices; may swap similar-priced items between charges. Totals stay exact via `allocateProportional`. |
| Multi-charge, gift card on one charge | Same as item-level discount; partition may swap similar-priced items; totals stay exact. |
| Multi-charge, multiple optimal partitions tied at minimum total distance | Picks one deterministically (DFS order); any optimal partition is equally correct by definition. |
| M (charges) > n (items) — structurally impossible to give every charge an item | `assignItemsToCharges` returns null; entire order's charges emit errors. |
| n > 20 items in an order (search-space cap) | `assignItemsToCharges` returns null; entire order's charges emit errors. |
| Multiple unrelated orders from the same retailer in one sync | One adapter call paginates and matches all orders; sync loop runs `distributeOrder` per `(order, charges)` pair independently. |
| Orders span multiple retailers | One adapter call per retailer; results concatenated; persistence is one atomic batch across all retailers. |

### Why the model works (and where it doesn't)

The model: `ratio = orderTotalCents / itemsSubtotalCents` spreads tax/shipping/discounts/gift-cards uniformly across items by price. A subset's scaled total approximates "this subset's share of the charge total if adjustments were perfectly proportional." The global partition picks the assignment whose scaled subset totals collectively land nearest the actual charges.

This is exact when adjustments are proportional. It's approximate (and sometimes wrong about *which* items, never wrong about the *total*) when adjustments are per-charge asymmetric. That failure mode is acceptable: `allocateProportional` then redistributes each charge exactly across whatever items the partition landed on, so YNAB sub-transactions always sum to the YNAB amount, and category-level budgeting at the household level averages out.

## File / module organization

```
lib/
  money.ts          ← pure currency helpers only (formatCents, parseDollarsToCents, milliunits)
  distribution.ts   ← distributeOrder, assignItemsToCharges, allocateProportional
  distribution.test.ts
  matcher.ts        ← matchByAmountAndDate (used by adapters; stays generic)
  registry.ts       ← derived from registered adapters' payees arrays
  types.ts          ← YnabCharge, ScrapedOrder, ScrapedItem, AllocatedTransaction, AllocatedItem, RetailerAdapter, QueueEntry, ApprovalItem
  db.ts             ← schema bump to v2 (allocatedTransactions store); old itemizedTransactions store deleted
  classifier.ts     ← unchanged
  ynab.ts           ← unchanged
  queue.ts          ← unchanged
  utils.ts          ← DELETED (homegrown groupBy replaced by R.groupBy)

retailers/
  registry.ts       ← exports the list of registered adapters
  amazon/
    adapter.ts      ← implements RetailerAdapter (was background/amazon-scraper.ts logic)
    scraper.ts      ← unchanged (content-script DOM scraping)
    selectors.ts    ← unchanged

background/
  sync.ts           ← orchestrates the pipeline (replaces current performSync internals)
  approval.ts       ← buildSubtransactions reads item.allocatedCents directly
  tabs.ts           ← unchanged
  amazon-scraper.ts ← DELETED (logic moved into retailers/amazon/adapter.ts)

components/
  SplitBreakdown.tsx ← reads item.allocatedCents directly; distributeRemainder no longer called here
  ItemCard.tsx      ← unchanged (still displays unitPriceCents)
  DetailView.tsx    ← type updates only
  TransactionCard.tsx ← type updates only
  QueueView.tsx     ← unchanged
  Settings.tsx      ← unchanged
  Onboarding.tsx    ← unchanged

entrypoints/
  background.ts     ← unchanged (still routes messages to handlers)
  sidepanel/        ← type updates only
  amazon.content.ts ← unchanged
```

## Sync flow (new `background/sync.ts`)

Pseudocode for the orchestration that replaces today's `performSyncInner` + `scrapeAndMatch` + `scrapeItemsForMatches`:

```ts
async function performSyncInner(): Promise<SyncResult> {
  const settings = await getSettings();
  if (!settings.ynabToken || !settings.planId) return { error: "Not connected to YNAB" };

  // 1. IDENTIFY
  const ynabTxs = await getUnapprovedTransactions(settings.ynabToken, settings.planId);
  const charges = ynabTxs
    .filter(tx => tx.payee_name)
    .map(tx => toYnabCharge(tx, getRetailerForPayee(tx.payee_name!)))
    .filter(c => c.retailer !== null);
  const cached = await loadCachedTransactions(charges);   // fast path
  const needsScraping = charges.filter(c => !cached.has(c.ynabTransactionId));

  const chargesByRetailer = R.groupBy(needsScraping, c => c.retailer);
  const allAllocated: AllocatedTransaction[] = [];
  const allUnmatched: { charge: YnabCharge; reason: string }[] = [];

  for (const [retailerId, retailerCharges] of Object.entries(chargesByRetailer)) {
    const adapter = getAdapter(retailerId);
    // 2. SCRAPE + MATCH (adapter owns tab lifecycle, including cleanup on failure)
    const { matched, unmatched } = await adapter.scrapeMatchedOrders(retailerCharges);

    // 3. DISTRIBUTE
    const allocated = matched.flatMap(({ order, charges }) => distributeOrder(order, charges));
    allAllocated.push(...allocated);
    allUnmatched.push(...unmatched);
  }

  // 4. PERSIST (single transaction)
  await putAllocatedTransactions(allAllocated);

  // 5. CLASSIFY (after persist so failures don't lose scraped data; output is display-only)
  const classifiedByTxId = await classifyBatch(allAllocated);

  // 6. QUEUE
  return { queue: buildQueueEntries(charges, cached, allAllocated, classifiedByTxId, allUnmatched) };
}
```

## IndexedDB schema

Keep `DB_VERSION = 1`. Replace the v1 schema definition in `lib/db.ts` with the new shape:

```ts
// in onupgradeneeded (runs on fresh DB only):
const newStore = db.createObjectStore("allocatedTransactions", { keyPath: "ynabTransactionId" });
newStore.createIndex("orderKey", "orderKey", { unique: false });
db.createObjectStore("productCategories", { keyPath: "id" });
db.createObjectStore("categories", { keyPath: "id" });
```

The old `itemizedTransactions` store is simply omitted from the new v1 definition. Existing browser databases (which know the old v1 schema) need to be deleted once so the new v1 definition takes effect on next open: in Chrome DevTools → Application → IndexedDB → right-click `itemize` → Delete. Acceptable since the app is pre-launch and has no shipped users.

No version bump because no real migration exists — we're not transforming records from one shape to another, we're starting from an empty database with a redefined schema.

## Testing

Add `vitest` + `@vitest/coverage-v8` as devDependencies. Add `remeda` as a runtime dependency. Add `test` script to `package.json`. No global setup file needed; tests are pure.

### Test files

**`lib/distribution.test.ts`** — the meat of the test suite:

- **`distributeOrder` end-to-end scenarios** (one describe block per scenario from BAC-111):
  - Single-charge: standard order with tax
  - Single-charge: order with shipping
  - Single-charge: order with coupon/discount
  - Multi-charge: split shipment, no adjustments
  - Multi-charge: split shipment with proportional tax only
  - Multi-charge: gift card on one charge
  - Multi-charge: item-level coupon (price as scraped reflects discount → works; price as scraped does NOT reflect discount → algorithm may swap items but totals stay exact)
  - Multi-charge: per-item shipping in mixed Prime/non-Prime order
  - Multi-charge: item qty > 1 split across shipments
  - Multi-charge: partial refund (negative charge with subset of items)
  - Subscribe & Save orders
  - Common invariants asserted in every test: every charge's allocations sum to exactly its `amountCents`; every item appears in exactly one charge's allocations.

- **`assignItemsToCharges` unit tests**:
  - Single charge → all items, distance 0
  - Two charges, exact split (distance 0 both)
  - **Greedy-trap case** (the `[$10,$20,$30,$40]` / `[$40,$30,$30]` example from the design): global finds total-error-0 partition that greedy can miss
  - Identical-priced items → swap-invariant (any assignment OK; total distance preserved)
  - Order-of-input independence: input charge order doesn't change the chosen partition's total distance
  - n at the cap (n=20) completes within a reasonable time bound (assertion: <1s)
  - n above cap → returns null

- **`allocateProportional` unit tests**:
  - Exact-sum guarantee with various rounding patterns
  - Zero total → all zeros
  - Single item → gets full total
  - Items with zero subtotal mixed with non-zero (edge case)

### Out of scope for tests

- `RetailerAdapter` Amazon adapter (DOM-dependent, requires fixtures; can be added separately if desired)
- IndexedDB layer (requires fake-indexeddb; out of scope)
- Approval flow (pure functions in `buildSubtransactions` could get a small test, but it becomes nearly trivial once it reads `allocatedCents` — likely not worth a test)

## Migration plan

One branch. Cutover. No staged dual-running of old and new code.

Order of work within the branch:

1. Add `vitest` + `remeda` dependencies + `test` script + an initial `distribution.test.ts` skeleton (red, on purpose).
2. Add new types in `lib/types.ts`: `YnabCharge`, `ScrapedOrder`, `ScrapedItem`, `AllocatedTransaction`, `AllocatedItem`, `RetailerAdapter`. (Must come before `distribution.ts` so it can reference these.)
3. Implement `lib/distribution.ts`: `allocateProportional`, `assignItemsToCharges` (recursive partition with branch-and-bound), `distributeOrder`. Write all unit tests against it; iterate to green.
4. Update `lib/db.ts`: redefine v1 schema to use `allocatedTransactions` store (no version bump — see IndexedDB schema section); rename functions to `putAllocatedTransactions`, `getAllocatedTransaction`.
5. Create `retailers/amazon/adapter.ts` implementing `RetailerAdapter`. Move the list-pagination + match + detail-scrape logic out of `background/amazon-scraper.ts` and into the adapter, refactored to return `ScrapedOrder[]` and the matched/unmatched split. Adapter owns its own tab lifecycle (no `tabId` parameter).
6. Create `retailers/registry.ts` with the adapter list; rewrite `lib/registry.ts` to derive payee mappings from registered adapters.
7. Rewrite `background/sync.ts` to compose the pipeline as shown above. Use `R.groupBy`, `R.partition`, etc. from remeda — do not import the soon-to-be-deleted `lib/utils.ts:groupBy`.
8. Update `background/approval.ts`: simplify `ApprovalItem` to `{ productId, categoryId }`; `buildSubtransactions` looks up the persisted `AllocatedTransaction` by id, joins approval choices to its items by `productId`, and uses `allocatedCents` for sub-transaction amounts.
9. Update `components/SplitBreakdown.tsx`: read `item.allocatedCents` directly; delete `distributeRemainder` import.
10. Type-only updates in `DetailView`, `TransactionCard`, `App`, and anywhere else that referenced `ItemizedTransaction`/`LineItem`. The side panel sends only `{ productId, categoryId }` per item to `APPROVE_TRANSACTION` now.
11. Delete `background/amazon-scraper.ts`. Delete the old `findItemSubset` and `distributeRemainder` from `lib/money.ts`. Delete `lib/utils.ts`.
12. Manual end-to-end test: sync against a real Amazon account; approve a single-charge and a split-shipment order; verify YNAB sub-transaction totals exact.

Each step compiles. The "burn down" step (11) comes last, after the replacements are wired in.

## Risks

- **Manual end-to-end is the only integration validation.** The unit test suite covers the algorithm thoroughly, but the DOM-scrape paths remain unverified by tests. Mitigation: keep the existing Amazon scraper code intact when moving it into the adapter; the move is mechanical, not algorithmic.
- **Allocation semantics are now "frozen" at scrape time.** If the allocation algorithm ever changes, stored records won't reflect the new math without re-scraping. Acceptable today (no shipped users); worth a brief note in the README later.
- **The adapter interface is designed against one retailer (Amazon).** Its shape may need adjustment when a second retailer is added. Acceptable: the interface is small, and refactoring it later is cheap compared to designing speculatively now.

## Open decisions

None outstanding from the design conversation. All listed above as "Goals" or "Non-goals" reflect explicit user decisions.
