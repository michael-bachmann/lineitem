import { groupBy } from "remeda";

export const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

/** Whether two ISO dates fall within the ±3-day match window. */
const withinWindow = (a: string, b: string): boolean =>
  Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= THREE_DAYS_MS;

/** Charge/candidate indices sorted by their date (ascending). */
const sortByDate = (idxs: number[], src: { date: string }[]): number[] =>
  [...idxs].sort((a, b) => src[a].date.localeCompare(src[b].date));

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
  const matches = candidates.filter(
    (c) => c.amountCents === amountCents && withinWindow(ynabDate, c.date),
  );
  return matches.length === 1 ? matches[0] : null;
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
  // Group charge and candidate indices by exact amount (same key on both sides),
  // pair each amount's group 1:1, then scatter the accepted pairs back onto a
  // charge-aligned result. Group iteration order doesn't matter — every charge
  // belongs to exactly one amount, so the pairs are disjoint.
  const candIdxByAmount = groupBy(indicesOf(candidates), (j) => candidates[j].amountCents);
  const chargeIdxByAmount = groupBy(indicesOf(charges), (i) => charges[i].amountCents);

  const pairs = Object.entries(chargeIdxByAmount).flatMap(([amount, chargeIdxs]) =>
    // Object.entries stringifies the numeric amount key; convert back to look up
    // the candidate group keyed by the same amount.
    cleanPairs(chargeIdxs, candIdxByAmount[Number(amount)] ?? [], charges, candidates),
  );

  const candByCharge = new Map(pairs);
  return charges.map((_, i) => candByCharge.get(i) ?? null);
}

const indicesOf = (xs: readonly unknown[]): number[] => xs.map((_, i) => i);

/**
 * Pair an amount group's charge indices to its candidate indices 1:1 in date
 * order, returning the `[chargeIdx, candIdx]` pairs only when the group is clean
 * — equal counts and every date-ordered pair within the window. An unequal count
 * is a genuine guess, and a single out-of-window pair means it isn't a clean 1:1
 * set; either way the whole group is left unmatched (no pairs).
 */
function cleanPairs(
  chargeIdxs: number[],
  candIdxs: number[],
  charges: { date: string }[],
  candidates: { date: string }[],
): (readonly [number, number])[] {
  if (chargeIdxs.length !== candIdxs.length) return [];
  const sortedCands = sortByDate(candIdxs, candidates);
  const pairs = sortByDate(chargeIdxs, charges).map((ci, k) => [ci, sortedCands[k]] as const);
  return pairs.every(([ci, dj]) => withinWindow(charges[ci].date, candidates[dj].date))
    ? pairs
    : [];
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
