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

/**
 * Assign a batch of charges to candidates by exact amount + date proximity
 * (±3 days), 1:1. Returns, aligned to `charges`, the matched candidate index or
 * null for each charge.
 *
 * Resolves the "balanced" ambiguity that `matchByAmountAndDate` leaves
 * unmatched: when N charges of the same amount line up with exactly N
 * candidates of that amount, they're paired in date order — the pairing is
 * arbitrary among equal-amount siblings, but the set is exhausted so the
 * allocations are exhaustive and correct. A group is left entirely unmatched
 * when the counts differ (a genuine guess) or any date-ordered pair falls
 * outside the ±3-day window (not a clean 1:1 set).
 */
export function assignByAmountAndDate(
  charges: { date: string; amountCents: number }[],
  candidates: { date: string; amountCents: number }[],
): (number | null)[] {
  const result: (number | null)[] = charges.map(() => null);

  // Group charge indices by exact amount; candidates are looked up per amount.
  const chargesByAmount = new Map<number, number[]>();
  charges.forEach((c, i) => {
    const group = chargesByAmount.get(c.amountCents);
    if (group) group.push(i);
    else chargesByAmount.set(c.amountCents, [i]);
  });

  const byDate = (idxs: number[], src: { date: string }[]) =>
    [...idxs].sort((a, b) => src[a].date.localeCompare(src[b].date));

  for (const [amount, chargeIdxs] of chargesByAmount) {
    const candIdxs = candidates
      .map((_, j) => j)
      .filter((j) => candidates[j].amountCents === amount);

    // Only auto-assign when each charge has its own candidate to pair with —
    // unequal counts mean a genuine guess, so leave the whole group unmatched.
    if (candIdxs.length !== chargeIdxs.length) continue;

    // Pair in date order and accept only if every pair is within the window.
    // A single out-of-window pair means this isn't a clean 1:1 set; stay
    // conservative and leave them all for manual matching.
    const sortedCands = byDate(candIdxs, candidates);
    const pairs = byDate(chargeIdxs, charges).map(
      (ci, k) => [ci, sortedCands[k]] as const,
    );
    const allWithinWindow = pairs.every(
      ([ci, dj]) =>
        Math.abs(
          new Date(charges[ci].date).getTime() - new Date(candidates[dj].date).getTime(),
        ) <= THREE_DAYS_MS,
    );
    if (!allWithinWindow) continue;

    for (const [ci, dj] of pairs) result[ci] = dj;
  }

  return result;
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

/** Reason string an adapter returns for a charge whose page couldn't be read
 *  (failed/hung load or parse) even after a retry. Distinct from NO_MATCH_REASON
 *  so backfill counts it as a "couldn't be read" failure rather than a genuine
 *  no-match, and so re-running the scrape reattempts it. */
export const READ_FAILED_REASON = "Couldn't read the page";
