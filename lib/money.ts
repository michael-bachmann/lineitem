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
