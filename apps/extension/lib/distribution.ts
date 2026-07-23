import { partition, sum } from "remeda";
import type {
  AllocatedItem,
  AllocatedTransaction,
  ScrapedItem,
  ScrapedOrder,
  YnabCharge,
} from "./types";

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
 * distance contributed by that bucket. Returns null only when M > n
 * (structurally impossible — a charge would get no item). When M > 1 and
 * n > MAX_ITEMS the exact subset enumeration would blow up (2^n), so we fall
 * back to a best-effort greedy partition rather than failing the order — the
 * single-charge case never enumerates and always uses the exact base case.
 */
export function assignItemsToCharges(
  itemSubtotalsCents: number[],
  chargeAmountsCents: number[],
  orderTotalCents: number,
  itemsSubtotalCents: number,
): { indicesPerCharge: number[][]; distanceCentsPerCharge: number[] } | null {
  const n = itemSubtotalsCents.length;
  const m = chargeAmountsCents.length;

  if (n === 0) return null;
  if (m === 0) return null;
  if (m > n) return null;
  if (m > 1 && n > MAX_ITEMS) {
    return assignItemsToChargesGreedy(
      itemSubtotalsCents,
      chargeAmountsCents,
      orderTotalCents,
      itemsSubtotalCents,
    );
  }

  const ratio = itemsSubtotalCents > 0 ? orderTotalCents / itemsSubtotalCents : 1;

  // Scaled subset sum and per-charge distance helper.
  const scaledSum = (indices: number[]): number =>
    Math.round(indices.reduce((s, i) => s + itemSubtotalsCents[i], 0) * ratio);

  const distanceForCharge = (indices: number[], chargeIdx: number): number =>
    Math.abs(scaledSum(indices) - chargeAmountsCents[chargeIdx]);

  // Track best total distance found so far. Best partition is recorded as
  // a parallel array of index-lists, one per charge, in input order.
  //
  // This mutable state is foundational, not a cleanup target: it's the
  // branch-and-bound accumulator. `recurse` reads `bestTotalDistance` to prune
  // branches that can't beat the best found so far, so the running best must be
  // shared and updated in place across the whole DFS — a functional rewrite
  // would either lose the pruning or thread this through every call.
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

/** Index of the largest value; ties resolve to the lowest index. */
function argmax(values: number[]): number {
  return values.reduce((best, v, i) => (v > values[best] ? i : best), 0);
}

/** Total subtotal a bucket of item indices carries, scaled by the tax/fee ratio
 *  into charge space — what its charge would have to cover. */
function scaledBucketCents(bucket: number[], itemSubtotalsCents: number[], ratio: number): number {
  return Math.round(sum(bucket.map((i) => itemSubtotalsCents[i])) * ratio);
}

/**
 * Greedily assign each item to the charge with the largest remaining need
 * (target − assigned so far), largest items first so they land on the big
 * charges. Returns one charge index per item, keyed by item index.
 *
 * A pure fold: the running per-charge sums are threaded through the accumulator,
 * never mutated in place.
 */
function greedyAssignment(itemSubtotalsCents: number[], targets: number[]): number[] {
  const largestFirst = itemSubtotalsCents
    .map((_, i) => i)
    .sort((a, b) => itemSubtotalsCents[b] - itemSubtotalsCents[a]);

  const { chargeOf } = largestFirst.reduce(
    (acc, item) => {
      const charge = argmax(targets.map((t, j) => t - acc.sums[j]));
      return {
        sums: acc.sums.map((s, j) => (j === charge ? s + itemSubtotalsCents[item] : s)),
        chargeOf: { ...acc.chargeOf, [item]: charge },
      };
    },
    { sums: targets.map(() => 0), chargeOf: {} as Record<number, number> },
  );

  return itemSubtotalsCents.map((_, item) => chargeOf[item]);
}

/** Group item indices into one ascending-order bucket per charge. */
function bucketsFromAssignment(chargeOf: number[], chargeCount: number): number[][] {
  return Array.from({ length: chargeCount }, (_, j) =>
    chargeOf.flatMap((charge, item) => (charge === j ? [item] : [])),
  );
}

/**
 * Ensure every charge holds ≥1 item by moving the smallest item out of the
 * fullest bucket into each empty one (n ≥ m guarantees a donor with a spare).
 * A pure fold over the empty charges, rebuilding buckets immutably each step.
 */
function repairEmptyBuckets(buckets: number[][], itemSubtotalsCents: number[]): number[][] {
  const emptyCharges = buckets.flatMap((b, j) => (b.length === 0 ? [j] : []));
  return emptyCharges.reduce((acc, target) => {
    const donor = argmax(acc.map((b) => b.length));
    const smallest = acc[donor].reduce((min, i) =>
      itemSubtotalsCents[i] < itemSubtotalsCents[min] ? i : min,
    );
    return acc.map((b, j) =>
      j === donor ? b.filter((i) => i !== smallest) : j === target ? [...b, smallest] : b,
    );
  }, buckets);
}

/**
 * Best-effort partition for orders too large for the exact branch-and-bound
 * (m > 1 and n > MAX_ITEMS, where enumerating 2^n subsets would hang the
 * worker). Runs in O(n log n) instead, so distributeOrder can still split a
 * large multi-charge grocery order rather than surfacing it as a read failure.
 *
 * The partition is approximate — only item-to-charge attribution, not totals:
 * allocateProportional still scales each charge's items to its exact amount
 * downstream.
 */
function assignItemsToChargesGreedy(
  itemSubtotalsCents: number[],
  chargeAmountsCents: number[],
  orderTotalCents: number,
  itemsSubtotalCents: number,
): { indicesPerCharge: number[][]; distanceCentsPerCharge: number[] } {
  const ratio = itemsSubtotalCents > 0 ? orderTotalCents / itemsSubtotalCents : 1;
  // Targets in item-subtotal space, so charges compare like-for-like with items.
  const targets = chargeAmountsCents.map((a) => a / ratio);

  const indicesPerCharge = repairEmptyBuckets(
    bucketsFromAssignment(
      greedyAssignment(itemSubtotalsCents, targets),
      chargeAmountsCents.length,
    ),
    itemSubtotalsCents,
  );

  return {
    indicesPerCharge,
    distanceCentsPerCharge: indicesPerCharge.map((bucket, j) =>
      Math.abs(scaledBucketCents(bucket, itemSubtotalsCents, ratio) - chargeAmountsCents[j]),
    ),
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

/**
 * Tolerance per item for refund subset matching. Per-item refund amounts
 * are integer cents; the tax-grossed ratio introduces sub-cent rounding.
 * We allow ±1 cent per item summed.
 */
const REFUND_MATCH_TOLERANCE_CENTS_PER_ITEM = 1;

/**
 * How close a single refund charge must sit to the order's popover Refund Total
 * to trigger the popover-total fallback in `matchOneRefund` (which then
 * identifies the refunded items via `identifyRefundedItems`). The charge and the
 * popover describe the same refund, so this is only rounding slack.
 */
const REFUND_TOTAL_TOLERANCE_CENTS = 2;

/**
 * Find the unique subset of refunded items whose grossed-up amounts match
 * the YNAB refund charge.
 *
 * `refundedAmounts[i]` is the per-item refund in cents (0 means "not
 * refunded"; such indices never appear in any returned subset). `ratio`
 * is `refund.totalCents / refund.itemCents` from the order's popover,
 * which grosses item-only refund amounts up to include tax. Use 1.0 when
 * there is no tax line.
 *
 * Returns the matching subset (as item indices in ascending order) when
 * exactly one subset matches the charge amount within tolerance. Returns
 * null when no subset matches, more than one matches, or the pool is
 * empty. The DFS short-circuits as soon as two matches are seen — we only
 * need to distinguish "exactly one" from "zero or many". Capped at
 * MAX_ITEMS = 20.
 */
export function matchRefundToItems(
  refundedAmounts: number[],
  chargeAmountCents: number,
  ratio: number,
): number[] | null {
  const eligible = refundedAmounts.flatMap((amt, i) => (amt > 0 ? [i] : []));
  if (eligible.length === 0 || eligible.length > MAX_ITEMS) return null;

  const matches = findMatchingSubsets(
    eligible,
    refundedAmounts,
    chargeAmountCents,
    ratio,
  );
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Pure recursive DFS returning up to two matching subsets. Two is the cap
 * because callers only need uniqueness — anything past one rules out a
 * unique match. Each recursion returns its own results; nothing mutates a
 * shared accumulator.
 */
function findMatchingSubsets(
  eligible: readonly number[],
  refundedAmounts: readonly number[],
  chargeAmountCents: number,
  ratio: number,
): number[][] {
  function recurse(i: number, current: number[], currentSum: number): number[][] {
    if (i === eligible.length) {
      if (current.length === 0) return [];
      const grossed = Math.round(currentSum * ratio);
      const tolerance = REFUND_MATCH_TOLERANCE_CENTS_PER_ITEM * current.length;
      return Math.abs(grossed - chargeAmountCents) <= tolerance ? [current] : [];
    }
    const idx = eligible[i];
    const include = recurse(i + 1, [...current, idx], currentSum + refundedAmounts[idx]);
    if (include.length >= 2) return include.slice(0, 2);
    const exclude = recurse(i + 1, current, currentSum);
    return [...include, ...exclude].slice(0, 2);
  }
  return recurse(0, [], 0);
}

/**
 * Per-charge outcomes from `distributeOrder`. Either the charge was
 * allocated (entry in `allocated`) or it failed for a specific reason
 * (entry in `failures`). A charge appears in exactly one list.
 */
export interface DistributionResult {
  allocated: AllocatedTransaction[];
  failures: { ynabTransactionId: string; reason: string }[];
}

/**
 * Take a scraped order and its YNAB charges, return per-charge outcomes.
 *
 * The dispatch splits charges by sign:
 *  - Purchase charges (isRefund=false) run through `assignItemsToCharges`
 *    against the order's non-refunded items, exactly as before.
 *  - Refund charges (isRefund=true) run through `matchOneRefund`: accurate
 *    per-item markers subset-match the charge; otherwise, when the charge equals
 *    the popover Refund Total, the refunded items are identified by list-price /
 *    shipment flag and the charge is split proportional to list price. Each
 *    refund consumes its matched items so a later refund can't re-use them.
 *
 * A refund that can't be matched cleanly never falls back to "all items
 * on the refund" — it returns a per-charge failure so the user sees the
 * ambiguity rather than wrong attribution.
 */
export function distributeOrder(
  order: ScrapedOrder,
  charges: YnabCharge[],
): DistributionResult {
  if (order.items.length === 0) {
    return {
      allocated: [],
      failures: charges.map((c) => ({
        ynabTransactionId: c.ynabTransactionId,
        reason: "Order has no scraped items",
      })),
    };
  }

  const [refundCharges, purchaseCharges] = partition(charges, (c) => c.isRefund);

  const refundedAmounts = order.items.map((it) => it.refundedAmountCents);
  const ratio =
    order.refund && order.refund.itemCents > 0
      ? order.refund.totalCents / order.refund.itemCents
      : 1;

  const outcomes = [
    ...allocateRefundCharges(refundCharges, order, refundedAmounts, ratio),
    ...allocatePurchaseCharges(purchaseCharges, order),
  ];

  return collectOutcomes(outcomes);
}

// ---------------------------------------------------------------------------
// Per-charge outcomes — internal helpers
// ---------------------------------------------------------------------------

type ChargeOutcome =
  | { kind: "allocated"; tx: AllocatedTransaction }
  | { kind: "failure"; ynabTransactionId: string; reason: string };

const allocated = (tx: AllocatedTransaction): ChargeOutcome => ({
  kind: "allocated",
  tx,
});

const failed = (charge: YnabCharge, reason: string): ChargeOutcome => ({
  kind: "failure",
  ynabTransactionId: charge.ynabTransactionId,
  reason,
});

function collectOutcomes(outcomes: ChargeOutcome[]): DistributionResult {
  return {
    allocated: outcomes.flatMap((o) => (o.kind === "allocated" ? [o.tx] : [])),
    failures: outcomes.flatMap((o) =>
      o.kind === "failure"
        ? [{ ynabTransactionId: o.ynabTransactionId, reason: o.reason }]
        : [],
    ),
  };
}

function buildAllocatedTx(
  order: ScrapedOrder,
  charge: YnabCharge,
  items: AllocatedItem[],
): AllocatedTransaction {
  return {
    ynabTransactionId: charge.ynabTransactionId,
    orderKey: `${order.retailer}:${order.orderId}`,
    retailer: order.retailer,
    date: charge.date,
    amountCents: charge.amountCents,
    isRefund: charge.isRefund,
    items,
  };
}

function allocateItems(
  items: ScrapedItem[],
  subtotals: number[],
  total: number,
): AllocatedItem[] {
  const amounts = allocateProportional(subtotals, total);
  return items.map((item, i) => ({ ...item, allocatedCents: amounts[i] }));
}

// ---------------------------------------------------------------------------
// Refund path
// ---------------------------------------------------------------------------

/**
 * Reduce over refund charges with a running set of consumed item indices.
 * Each successful match adds its indices to the set so the next charge
 * can't reuse them. The accumulator is rebuilt immutably each step.
 */
function allocateRefundCharges(
  charges: YnabCharge[],
  order: ScrapedOrder,
  refundedAmounts: number[],
  ratio: number,
): ChargeOutcome[] {
  type Step = { outcomes: ChargeOutcome[]; consumed: ReadonlySet<number> };
  const initial: Step = { outcomes: [], consumed: new Set() };
  return charges.reduce<Step>((acc, charge) => {
    const { outcome, newlyConsumed } = matchOneRefund(
      charge,
      order,
      refundedAmounts,
      acc.consumed,
      ratio,
    );
    const consumed =
      newlyConsumed.length === 0
        ? acc.consumed
        : new Set([...acc.consumed, ...newlyConsumed]);
    return { outcomes: [...acc.outcomes, outcome], consumed };
  }, initial).outcomes;
}

function matchOneRefund(
  charge: YnabCharge,
  order: ScrapedOrder,
  refundedAmounts: number[],
  alreadyConsumed: ReadonlySet<number>,
  ratio: number,
): { outcome: ChargeOutcome; newlyConsumed: readonly number[] } {
  // Refund data can come from the order-level popover (`order.refund`) OR the
  // per-item markers (`refundedAmounts`). Grocery orders (Whole Foods / Fresh)
  // carry only the markers — there's no "Refund Total" popover — so gate on
  // BOTH being absent. Gating on the popover alone rejected every grocery
  // refund as "no refund data" even though the per-item markers were scraped.
  const hasRefundData = order.refund != null || refundedAmounts.some((a) => a > 0);
  if (!hasRefundData) {
    return {
      outcome: failed(
        charge,
        "Couldn't match refund to specific items (order has no refund data)",
      ),
      newlyConsumed: [],
    };
  }

  // Mask consumed items as 0 — matchRefundToItems already ignores zeros.
  const available = refundedAmounts.map((amt, i) =>
    alreadyConsumed.has(i) ? 0 : amt,
  );

  // Accurate per-item markers (grocery itemmod): the marker IS the refund amount.
  // Subset-match it to the charge; the consumed set lets several partial refunds
  // on one order each take their own items. Split by the markers themselves.
  const byMarker = matchRefundToItems(available, charge.amountCents, ratio);
  if (byMarker !== null) {
    return allocateRefund(order, charge, byMarker, refundedAmounts);
  }

  return (
    matchByPopoverTotal(order, charge, available, alreadyConsumed) ?? {
      outcome: failed(charge, "Couldn't unambiguously match refund to specific items"),
      newlyConsumed: [],
    }
  );
}

/**
 * Regular-order strategy. The per-item markers are unreliable there — each is
 * the item's full LINE TOTAL, and the shipment "Refunded" flag over-marks,
 * misses items, or is absent. But the popover Refund Total is authoritative:
 * when this single charge equals it, identify the refunded items from the
 * reliable signals and split the charge across them proportional to list price.
 * Returns null — so `matchOneRefund` fails cleanly — unless the popover matches
 * and the items are identifiable.
 */
function matchByPopoverTotal(
  order: ScrapedOrder,
  charge: YnabCharge,
  available: number[],
  alreadyConsumed: ReadonlySet<number>,
): { outcome: ChargeOutcome; newlyConsumed: readonly number[] } | null {
  if (
    !order.refund ||
    Math.abs(charge.amountCents - order.refund.totalCents) > REFUND_TOTAL_TOLERANCE_CENTS
  ) {
    return null;
  }
  const idx = identifyRefundedItems(order, available, alreadyConsumed, order.refund.itemCents);
  if (idx === null) return null;

  const listTotals = order.items.map((it) => it.unitPriceCents * it.quantity);
  return allocateRefund(order, charge, idx, listTotals);
}

/**
 * Which items a regular-order refund covers, from most to least reliable signal.
 * Returns item indices (excluding already-consumed ones), or null when nothing
 * identifies them.
 */
function identifyRefundedItems(
  order: ScrapedOrder,
  available: number[],
  consumed: ReadonlySet<number>,
  itemRefundCents: number,
): number[] | null {
  // 1) The subset of item LIST prices that sums to the popover's item refund.
  //    Reliable exactly when the refund wasn't discounted (list == refund) — the
  //    case the markers miss (no "Refunded" status, or only some items flagged).
  //    Limitation: for a discounted AND unflagged refund whose real item's list
  //    price differs, a coincidental unique subset of other items could match
  //    here instead. matchRefundToItems's uniqueness guard makes that rare; the
  //    refund total is unaffected, only the item split can be off.
  const listPrices = order.items.map((it, i) =>
    consumed.has(i) ? 0 : it.unitPriceCents * it.quantity,
  );
  const byPrice = matchRefundToItems(listPrices, itemRefundCents, 1);
  if (byPrice !== null) return byPrice;

  // 2) Items flagged by the shipment "Refunded" status. Reliable when the refund
  //    WAS discounted (so list != refund and (1) can't match) — the flag still
  //    names the item.
  const marked = available.flatMap((amt, i) => (amt > 0 ? [i] : []));
  if (marked.length > 0) return marked;

  // 3) A single unconsumed item — a partial refund of the only thing in the order.
  const remaining = order.items.flatMap((_, i) => (consumed.has(i) ? [] : [i]));
  return remaining.length === 1 ? remaining : null;
}

/** Allocate a refund charge across `idx`, split proportional to `weights[i]`,
 *  and mark those indices consumed. Fails when the selected weights sum to 0
 *  (e.g. only $0-priced items) — there'd be nothing to split against, and
 *  allocateProportional would emit an all-zeros allocation. */
function allocateRefund(
  order: ScrapedOrder,
  charge: YnabCharge,
  idx: number[],
  weights: number[],
): { outcome: ChargeOutcome; newlyConsumed: readonly number[] } {
  const selected = idx.map((i) => weights[i]);
  if (sum(selected) === 0) {
    return {
      outcome: failed(charge, "Couldn't unambiguously match refund to specific items"),
      newlyConsumed: [],
    };
  }
  const items = allocateItems(
    idx.map((i) => order.items[i]),
    selected,
    charge.amountCents,
  );
  return {
    outcome: allocated(buildAllocatedTx(order, charge, items)),
    newlyConsumed: idx,
  };
}

// ---------------------------------------------------------------------------
// Purchase path
// ---------------------------------------------------------------------------

/**
 * Partition non-refunded items across purchase charges, then map each
 * charge to its allocation. No state carried between charges — once the
 * partition is computed, the per-charge step is pure.
 */
function allocatePurchaseCharges(
  charges: YnabCharge[],
  order: ScrapedOrder,
): ChargeOutcome[] {
  if (charges.length === 0) return [];

  const nonRefundedItems = order.items.filter(
    (it) => it.refundedAmountCents === 0,
  );

  // All items refunded — can happen with split tx where everything came back.
  // assignItemsToCharges would also fail here, but with a confusing reason.
  if (nonRefundedItems.length === 0) {
    return charges.map((c) =>
      failed(
        c,
        "All items in this order have been refunded — purchase charge has nothing to allocate to.",
      ),
    );
  }

  const itemSubtotals = nonRefundedItems.map(
    (it) => it.unitPriceCents * it.quantity,
  );
  const chargeAmounts = charges.map((c) => c.amountCents);
  const assignment = assignItemsToCharges(
    itemSubtotals,
    chargeAmounts,
    sum(chargeAmounts),
    sum(itemSubtotals),
  );

  if (assignment === null) {
    return charges.map((c) =>
      failed(
        c,
        "Could not partition items across purchase charges (too many items or charges > items)",
      ),
    );
  }

  logAssignmentDistance(order, assignment);

  return charges.map((charge, chargeIdx) => {
    const localIndices = assignment.indicesPerCharge[chargeIdx];
    const subsetItems = localIndices.map((i) => nonRefundedItems[i]);
    const subsetSubtotals = localIndices.map((i) => itemSubtotals[i]);
    const items = allocateItems(subsetItems, subsetSubtotals, charge.amountCents);
    return allocated(buildAllocatedTx(order, charge, items));
  });
}

function logAssignmentDistance(
  order: ScrapedOrder,
  assignment: { distanceCentsPerCharge: number[] },
): void {
  const totalDist = sum(assignment.distanceCentsPerCharge);
  if (totalDist === 0) return;
  console.debug(
    `[distributeOrder] order=${order.orderId} total_distance_cents=${totalDist} ` +
      `per_charge=${assignment.distanceCentsPerCharge.join(",")}`,
  );
}
