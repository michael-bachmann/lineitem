import { sum } from "remeda";
import type {
  ScrapedOrder,
  YnabCharge,
  AllocatedTransaction,
  AllocatedItem,
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
 * distance contributed by that bucket. Returns null when M > n
 * (structurally impossible), or when M > 1 and n > MAX_ITEMS — the cap
 * only applies to the multi-charge path because the single-charge case
 * short-circuits to the base case without subset enumeration.
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
  if (m > 1 && n > MAX_ITEMS) return null;

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

/**
 * Tolerance per item for refund subset matching. Per-item refund amounts
 * are integer cents; the tax-grossed ratio introduces sub-cent rounding.
 * We allow ±1 cent per item summed.
 */
const REFUND_MATCH_TOLERANCE_CENTS_PER_ITEM = 1;

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
 * null when:
 *  - no subset matches,
 *  - more than one distinct subset matches (ambiguous — refuse to guess),
 *  - the refunded-items pool is empty.
 *
 * Branch-and-bound DFS over the indices with nonzero refundedAmounts.
 * Mirrors the cap from `assignItemsToCharges`: we won't enumerate when
 * the refunded pool exceeds MAX_ITEMS (= 20).
 */
export function matchRefundToItems(
  refundedAmounts: number[],
  chargeAmountCents: number,
  ratio: number,
): number[] | null {
  const eligible: number[] = [];
  for (let i = 0; i < refundedAmounts.length; i++) {
    if (refundedAmounts[i] > 0) eligible.push(i);
  }
  if (eligible.length === 0) return null;
  if (eligible.length > MAX_ITEMS) return null;

  let found: number[] | null = null;
  let foundCount = 0;

  function search(i: number, current: number[], currentSum: number): void {
    if (foundCount >= 2) return; // pruning: already ambiguous
    if (i === eligible.length) {
      if (current.length === 0) return;
      const grossed = Math.round(currentSum * ratio);
      const tolerance = REFUND_MATCH_TOLERANCE_CENTS_PER_ITEM * current.length;
      if (Math.abs(grossed - chargeAmountCents) <= tolerance) {
        found = [...current];
        foundCount++;
      }
      return;
    }
    const idx = eligible[i];
    // Include
    search(i + 1, [...current, idx], currentSum + refundedAmounts[idx]);
    // Exclude
    search(i + 1, current, currentSum);
  }

  search(0, [], 0);
  return foundCount === 1 ? found : null;
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
 *  - Refund charges (isRefund=true) run through `matchRefundToItems`
 *    against the refunded items pool, with the order's popover ratio.
 *    Each refund consumes its matched items so a later refund can't
 *    re-use them.
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

  const purchaseCharges = charges.filter((c) => !c.isRefund);
  const refundCharges = charges.filter((c) => c.isRefund);

  const allocated: AllocatedTransaction[] = [];
  const failures: { ynabTransactionId: string; reason: string }[] = [];

  // ---- Refund path: process each refund charge against the refunded pool.
  // Consume matched items so later refunds can't re-use them.
  const refundedAmounts = order.items.map((it) => it.refundedAmountCents);
  const refundConsumed = new Set<number>();
  const ratio =
    order.refund && order.refund.itemCents > 0
      ? order.refund.totalCents / order.refund.itemCents
      : 1;

  for (const charge of refundCharges) {
    if (!order.refund) {
      failures.push({
        ynabTransactionId: charge.ynabTransactionId,
        reason: "Couldn't match refund to specific items (order has no refund data)",
      });
      continue;
    }
    // Mask consumed items as 0 for this matcher invocation.
    const available = refundedAmounts.map((amt, i) =>
      refundConsumed.has(i) ? 0 : amt,
    );
    const subset = matchRefundToItems(available, charge.amountCents, ratio);
    if (subset === null) {
      failures.push({
        ynabTransactionId: charge.ynabTransactionId,
        reason: "Couldn't unambiguously match refund to specific items",
      });
      continue;
    }
    // Allocate the charge across the matched items in proportion to their
    // (item-only) refund amounts.
    const matchedItems = subset.map((i) => order.items[i]);
    const matchedSubtotals = subset.map((i) => refundedAmounts[i]);
    const allocatedAmounts = allocateProportional(matchedSubtotals, charge.amountCents);
    const items: AllocatedItem[] = matchedItems.map((item, i) => ({
      ...item,
      allocatedCents: allocatedAmounts[i],
    }));
    allocated.push({
      ynabTransactionId: charge.ynabTransactionId,
      orderKey: `${order.retailer}:${order.orderId}`,
      retailer: order.retailer,
      date: charge.date,
      amountCents: charge.amountCents,
      isRefund: true,
      items,
    });
    for (const i of subset) refundConsumed.add(i);
  }

  // ---- Purchase path: run existing partition logic over non-refunded items.
  if (purchaseCharges.length > 0) {
    const nonRefundedIndices: number[] = [];
    for (let i = 0; i < order.items.length; i++) {
      if (order.items[i].refundedAmountCents === 0) nonRefundedIndices.push(i);
    }
    const nonRefundedItems = nonRefundedIndices.map((i) => order.items[i]);
    const itemSubtotals = nonRefundedItems.map((it) => it.unitPriceCents * it.quantity);
    const chargeAmounts = purchaseCharges.map((c) => c.amountCents);
    const orderTotal = sum(chargeAmounts);
    const itemsSubtotal = sum(itemSubtotals);

    const partition = assignItemsToCharges(
      itemSubtotals,
      chargeAmounts,
      orderTotal,
      itemsSubtotal,
    );

    if (partition === null) {
      for (const c of purchaseCharges) {
        failures.push({
          ynabTransactionId: c.ynabTransactionId,
          reason: "Could not partition items across purchase charges (too many items or charges > items)",
        });
      }
    } else {
      // Log per-charge distance for debugging — not persisted.
      const totalDist = sum(partition.distanceCentsPerCharge);
      if (totalDist > 0) {
        console.debug(
          `[distributeOrder] order=${order.orderId} total_distance_cents=${totalDist} ` +
            `per_charge=${partition.distanceCentsPerCharge.join(",")}`,
        );
      }
      for (let chargeIdx = 0; chargeIdx < purchaseCharges.length; chargeIdx++) {
        const charge = purchaseCharges[chargeIdx];
        const localIndices = partition.indicesPerCharge[chargeIdx];
        const subsetItems = localIndices.map((i) => nonRefundedItems[i]);
        const subsetSubtotals = localIndices.map((i) => itemSubtotals[i]);
        const allocatedAmounts = allocateProportional(subsetSubtotals, charge.amountCents);
        const items: AllocatedItem[] = subsetItems.map((item, i) => ({
          ...item,
          allocatedCents: allocatedAmounts[i],
        }));
        allocated.push({
          ynabTransactionId: charge.ynabTransactionId,
          orderKey: `${order.retailer}:${order.orderId}`,
          retailer: order.retailer,
          date: charge.date,
          amountCents: charge.amountCents,
          isRefund: false,
          items,
        });
      }
    }
  }

  return { allocated, failures };
}
