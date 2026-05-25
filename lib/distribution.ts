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
