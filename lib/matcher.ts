import type { YnabTransaction } from "./types";
import { millunitsToCents } from "./money";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

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
 * Pure matching step: partitions YNAB transactions into matched/unmatched
 * against scraped candidates. Matched candidates are removed from the pool
 * so one scraped order can't match two YNAB transactions.
 */
export function tryMatchEntries<T extends { date: string; amountCents: number; orderId: string | null }>(
  ynabTxs: YnabTransaction[],
  candidates: T[],
): {
  matched: [YnabTransaction, T][];
  unmatched: YnabTransaction[];
  remainingCandidates: T[];
} {
  return ynabTxs.reduce<{
    matched: [YnabTransaction, T][];
    unmatched: YnabTransaction[];
    remainingCandidates: T[];
  }>(
    (acc, tx) => {
      const amountCents = millunitsToCents(tx.amount);
      const match = matchByAmountAndDate(amountCents, tx.date, acc.remainingCandidates);
      if (match?.orderId) {
        return {
          matched: [...acc.matched, [tx, match]],
          unmatched: acc.unmatched,
          remainingCandidates: acc.remainingCandidates.filter((c) => c !== match),
        };
      }
      return { ...acc, unmatched: [...acc.unmatched, tx] };
    },
    { matched: [], unmatched: [], remainingCandidates: candidates },
  );
}

/** Earliest YNAB date in the set, minus 3 days. Used to stop paginating. */
export function cutoffDateFor(ynabTxs: YnabTransaction[]): string {
  if (ynabTxs.length === 0) return "1970-01-01";
  const earliest = ynabTxs.reduce(
    (min, tx) => (tx.date < min ? tx.date : min),
    ynabTxs[0].date,
  );
  const cutoff = new Date(earliest);
  cutoff.setDate(cutoff.getDate() - 3);
  return cutoff.toISOString().slice(0, 10);
}
