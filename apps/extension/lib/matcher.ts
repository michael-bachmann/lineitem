export const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Match a YNAB transaction to a scraped retailer transaction by exact amount
 * and date proximity (±3 days). Returns null if zero or multiple candidates
 * match — ambiguous matches are left unresolved rather than guessed.
 */
export function matchByAmountAndDate<T extends { date: string; amountCents: number }>(
  amountCents: number,
  ynabDate: string,
  candidates: T[],
): T | null {
  const txDate = new Date(ynabDate);

  const matches = candidates.filter((c) => {
    if (c.amountCents !== amountCents) return false;
    const cDate = new Date(c.date);
    return Math.abs(txDate.getTime() - cDate.getTime()) <= THREE_DAYS_MS;
  });

  if (matches.length === 1) return matches[0];
  return null;
}

/** Earliest date in the set, minus 3 days. Used to stop paginating. */
export function cutoffDateFor(items: { date: string }[]): string {
  if (items.length === 0) return "1970-01-01";
  const earliest = items.reduce(
    (min, item) => (item.date < min ? item.date : min),
    items[0].date,
  );
  const cutoff = new Date(earliest);
  cutoff.setDate(cutoff.getDate() - 3);
  return cutoff.toISOString().slice(0, 10);
}

/** Reason string an adapter returns for a charge it found no order/invoice for.
 *  sync.ts maps exactly this reason to the `no_match` status. */
export const NO_MATCH_REASON = "No matching order found";
