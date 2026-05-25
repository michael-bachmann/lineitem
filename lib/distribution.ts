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
