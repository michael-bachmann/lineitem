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

/**
 * Find the subset of item indices whose subtotals, scaled by a tax/shipping
 * ratio, match a target charge amount within ±tolerance cents.
 *
 * ratio = orderTotalCents / itemsSubtotalCents (accounts for tax/shipping).
 * Recursively tries include/exclude for each item (2^n subsets, n typically 2-5).
 *
 * Returns the matching indices, or null if no subset matches.
 */
export function findItemSubset(
  itemSubtotals: number[],
  chargeAmountCents: number,
  orderTotalCents: number,
  itemsSubtotalCents: number,
  toleranceCents: number = 2,
): number[] | null {
  const n = itemSubtotals.length;
  if (n === 0 || n > 20) return null;

  const ratio = itemsSubtotalCents > 0 ? orderTotalCents / itemsSubtotalCents : 1;

  // Depth-first search over all subsets. At each item we branch into two paths:
  // one that includes the item, one that excludes it. The call stack forms a
  // binary tree of depth n — each leaf is a unique subset. We check every
  // non-empty subset's scaled total against the charge and return the first match.
  //
  //   i       = index of the next item to decide on
  //   indices = items included so far
  //   sum     = raw subtotal (cents) of included items, before tax/shipping scaling
  function search(i: number, indices: number[], sum: number): number[] | null {
    // Scale the raw subtotal by the tax/shipping ratio and check against the charge
    const expected = Math.round(sum * ratio);
    if (indices.length > 0 && Math.abs(expected - chargeAmountCents) <= toleranceCents) {
      return indices;
    }
    // No more items to branch on — this subset didn't match
    if (i >= n) return null;
    // Try including item i, then (if that didn't match) try excluding it
    return search(i + 1, [...indices, i], sum + itemSubtotals[i])
        ?? search(i + 1, indices, sum);
  }

  return search(0, [], 0);
}

/**
 * Distribute a remainder (taxes/shipping) proportionally across item amounts.
 * Assigns rounding error to the last item so the total is exact.
 */
export function distributeRemainder(itemAmounts: number[], remainder: number): number[] {
  const total = itemAmounts.reduce((sum, a) => sum + a, 0);
  if (total === 0) return itemAmounts.map(() => 0);

  const shares = itemAmounts.map((amount) =>
    Math.round((amount / total) * remainder),
  );

  // Absorb rounding error into the last item
  const correction = remainder - shares.reduce((sum, s) => sum + s, 0);
  return shares.map((s, i) => i === shares.length - 1 ? s + correction : s);
}
