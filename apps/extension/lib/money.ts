/** Convert YNAB milliunits to absolute cents. Milliunits are signed (negative = outflow). */
export function millunitsToCents(milliunits: number): number {
  return Math.abs(Math.round(milliunits / 10));
}

/** Format integer cents as a dollar string, e.g. 4299 → "$42.99". */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
