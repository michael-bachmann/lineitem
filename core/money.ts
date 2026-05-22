export function centsToMilliunits(cents: number): number {
  return cents * -10;
}

export function millunitsToCents(milliunits: number): number {
  return Math.abs(Math.round(milliunits / 10));
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function parseDollarsToCents(dollars: string): number {
  const value = parseFloat(dollars.replace(/[^0-9.-]/g, ""));
  if (isNaN(value)) return 0;
  return Math.abs(Math.round(value * 100));
}

export function distributeProportionally(
  itemAmounts: number[],
  remainder: number,
): number[] {
  const total = itemAmounts.reduce((sum, a) => sum + a, 0);
  if (total === 0) return itemAmounts.map(() => 0);

  const shares = itemAmounts.map((amount) =>
    Math.round((amount / total) * remainder),
  );

  // Adjust last item to absorb rounding error
  const distributed = shares.reduce((sum, s) => sum + s, 0);
  shares[shares.length - 1] += remainder - distributed;

  return shares;
}
