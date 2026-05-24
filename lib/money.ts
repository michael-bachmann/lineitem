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
