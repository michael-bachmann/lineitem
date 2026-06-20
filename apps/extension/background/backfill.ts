import { groupBy, sumBy } from "remeda";
import { READ_FAILED_REASON } from "@/lib/matcher";
import { getSettings } from "@/lib/settings";
import { getTransactionsSince } from "@/lib/ynab";
import { getAllocatedTransaction, putAllocatedTransactions } from "@/lib/db";
import { getRetailerForPayee } from "@/lib/registry";
import { getAdapter } from "@/retailers/registry";
import { millunitsToCents } from "@/lib/money";
import { verifyScrape } from "@/lib/verify-scrape";
import { distributeOrder } from "@/lib/distribution";
import { learnFromApproval, type LearnEntry } from "./approval";
import type {
  AllocatedTransaction,
  BackfillProgress,
  BackfillResult,
  BackfillRetailerProgress,
  RetailerBlockReason,
  ScrapedOrder,
  YnabCharge,
  YnabTransaction,
} from "@/lib/types";

/** Pagination cap we ask the retailer adapter to walk during backfill —
 *  higher than sync's default so we can reach orders ~12 months back. */
const BACKFILL_MAX_PAGES = 30;

export interface BackfillOptions {
  /** ISO date string YYYY-MM-DD. Inclusive lower bound on tx.date. */
  fromDate: string;
  signal?: AbortSignal;
  onProgress?: (event: BackfillProgress) => void;
}

function toYnabCharge(tx: YnabTransaction): YnabCharge {
  return {
    ynabTransactionId: tx.id,
    date: tx.date,
    amountCents: millunitsToCents(tx.amount),
    payeeName: tx.payee_name ?? "",
    isRefund: tx.amount > 0,
  };
}

/**
 * Walk approved YNAB transactions since `fromDate`, scrape their orders,
 * persist them through the same pipeline pieces sync uses (`verifyScrape`,
 * `distributeOrder`, `putAllocatedTransactions`), then feed the items into
 * `learnFromApproval` to bootstrap the embedding pool.
 *
 * `AllocatedTransaction` serves as the "we've processed this tx" marker —
 * shared with sync. Re-running skips anything already in that store, which
 * makes the multi-Amazon-account workflow work: charges that didn't match
 * the first Amazon login have no AllocatedTransaction row and get re-
 * attempted on the next run with a different login.
 *
 * Result counts are cumulative: `transactionsBackfilled` and `itemsLearned`
 * include both this run's new matches and the pre-existing allocations
 * already in IDB. That lets the UI keep growing numbers across multi-account
 * re-runs instead of resetting to "0 of N" each time.
 */
export async function runBackfill(options: BackfillOptions): Promise<BackfillResult> {
  const { fromDate, signal, onProgress } = options;

  const settings = await getSettings();
  if (!settings.accessToken || !settings.planId) throw new Error("Not connected to YNAB");

  signal?.throwIfAborted();
  onProgress?.({ status: "preparing" });
  const allTxs = await getTransactionsSince(settings.planId, fromDate);

  const assessment = await assessCandidates(allTxs);
  const byRetailer = groupBy(assessment.pending, (e) => e.retailer);

  // Sequential per retailer — each adapter call owns a browser tab; running
  // them in parallel would open multiple tabs at once. Sync's natural
  // bound of "one retailer per sync cycle" doesn't apply here.
  let aggregate: RetailerTotals = { matched: 0, unmatched: 0, failed: 0, itemsWritten: 0 };
  const runByRetailer = new Map<string, RetailerTotals>();
  for (const [retailerId, group] of Object.entries(byRetailer)) {
    signal?.throwIfAborted();
    const r = await runForRetailer(retailerId, group, { signal, onProgress });
    runByRetailer.set(retailerId, r);
    aggregate = {
      matched: aggregate.matched + r.matched,
      unmatched: aggregate.unmatched + r.unmatched,
      failed: aggregate.failed + r.failed,
      itemsWritten: aggregate.itemsWritten + r.itemsWritten,
    };
  }

  const alreadyBackfilledCount = assessment.totalEligible - assessment.pending.length;
  const transactionsBackfilled = alreadyBackfilledCount + aggregate.matched;
  const itemsLearned = assessment.alreadyBackfilledItems + aggregate.itemsWritten;
  const hasUnbackfilled = transactionsBackfilled < assessment.totalEligible;

  // Per-retailer breakdown for the done card. `matched` is cumulative
  // (pre-existing allocations + this run's matches); retailers fully backfilled
  // before this run have no `runByRetailer` entry and contribute only their
  // already-allocated count.
  const byRetailerProgress: BackfillRetailerProgress[] = [...assessment.perRetailer]
    .map(([retailer, counts]) => {
      const run = runByRetailer.get(retailer);
      return {
        retailer,
        matched: counts.alreadyMatched + (run?.matched ?? 0),
        failed: run?.failed ?? 0,
        ...(run?.blocked ? { blocked: run.blocked } : {}),
      };
    });

  // Debug breakdown — surface internal counters that the UI deliberately hides.
  console.log("[backfill] done", {
    totalEligible: assessment.totalEligible,
    alreadyBackfilled: alreadyBackfilledCount,
    newlyMatched: aggregate.matched,
    unmatched: aggregate.unmatched,
    failed: aggregate.failed,
  });

  return {
    transactionsBackfilled,
    itemsLearned,
    hasUnbackfilled,
    failed: aggregate.failed,
    byRetailer: byRetailerProgress,
  };
}

interface TaggedTx {
  tx: YnabTransaction;
  retailer: string;
}

/** Synchronous shape check: is this transaction in principle backfill-able?
 *  Returns the matched retailer when yes, null when not. */
function backfillEligibility(tx: YnabTransaction): { retailer: string } | null {
  if (!tx.approved) return null;
  if (tx.category_id === null) return null;
  if (tx.subtransactions.length > 0) return null;
  if (tx.amount > 0) return null; // refund / inflow
  if (tx.payee_name === null) return null;
  const mapping = getRetailerForPayee(tx.payee_name);
  if (!mapping || mapping.strategy !== "scrape") return null;
  return { retailer: mapping.retailer };
}

interface CandidateAssessment {
  /** Eligible-AND-not-yet-allocated — what we'll actually scrape this run. */
  pending: TaggedTx[];
  /** All eligible-by-shape tx in the window, allocated or not. */
  totalEligible: number;
  /** Items in AllocatedTransactions for eligible tx that were already backfilled
   *  before this run. Added to this run's items for the cumulative total. */
  alreadyBackfilledItems: number;
  /** Per-retailer already-allocated tx count (keyed by every retailer with any
   *  eligible tx), for the done card's per-retailer "learned N orders" line. */
  perRetailer: Map<string, { alreadyMatched: number }>;
}

/** Walk the YNAB tx set once: bucket each into eligible-pending,
 *  eligible-already-allocated, or ineligible. Same per-tx IDB read the old
 *  `filterCandidates` did, but it also captures the pre-existing item count
 *  so the result shape can be cumulative. */
async function assessCandidates(txs: YnabTransaction[]): Promise<CandidateAssessment> {
  type Outcome =
    | { kind: "pending"; tagged: TaggedTx }
    | { kind: "already"; retailer: string; items: number }
    | null;

  const outcomes = await Promise.all(
    txs.map(async (tx): Promise<Outcome> => {
      const eligibility = backfillEligibility(tx);
      if (!eligibility) return null;
      const existing = await getAllocatedTransaction(tx.id);
      if (existing) return { kind: "already", retailer: eligibility.retailer, items: existing.items.length };
      return { kind: "pending", tagged: { tx, retailer: eligibility.retailer } };
    }),
  );

  const eligible = outcomes.filter((o): o is Exclude<Outcome, null> => o !== null);
  const pending = eligible.flatMap((o) => (o.kind === "pending" ? [o.tagged] : []));
  const alreadyBackfilledItems = sumBy(eligible, (o) => (o.kind === "already" ? o.items : 0));

  const perRetailer = new Map<string, { alreadyMatched: number }>();
  for (const o of eligible) {
    const retailer = o.kind === "pending" ? o.tagged.retailer : o.retailer;
    const cur = perRetailer.get(retailer) ?? { alreadyMatched: 0 };
    if (o.kind === "already") cur.alreadyMatched += 1;
    perRetailer.set(retailer, cur);
  }

  return { pending, totalEligible: eligible.length, alreadyBackfilledItems, perRetailer };
}

interface RetailerTotals {
  matched: number;
  unmatched: number;
  failed: number;
  itemsWritten: number;
  /** The retailer hit a sign-in wall this run (its orders were unreadable). */
  blocked?: RetailerBlockReason;
}

/**
 * What we do with one matched order:
 *  - `ok`: single-charge with a category, verified and distributed — we'll
 *    persist the AllocatedTransaction (the marker) AND learn from the items.
 *  - `ambiguous`: multi-charge order. Each charge has its own YNAB category,
 *    so attribution would require splitting items across charges via
 *    distribution; not worth the complexity for backfill. Skipped — re-runs
 *    will reattempt (cheap and accepted).
 *  - `skip`: data unusable (missing tx, missing category, verifyScrape
 *    failed, distributeOrder produced nothing). Contributes nothing; not
 *    marked, so re-runs will reattempt.
 */
type OrderOutcome =
  | { kind: "ok"; allocated: AllocatedTransaction; entries: LearnEntry[] }
  | { kind: "ambiguous"; chargeCount: number }
  | { kind: "skip" };

function processMatchedOrder(
  matchedEntry: { order: ScrapedOrder; charges: YnabCharge[] },
  txById: Map<string, YnabTransaction>,
): OrderOutcome {
  const { order, charges: orderCharges } = matchedEntry;
  if (orderCharges.length !== 1) {
    return { kind: "ambiguous", chargeCount: orderCharges.length };
  }
  const charge = orderCharges[0];
  const tx = txById.get(charge.ynabTransactionId);
  if (!tx || tx.category_id === null) return { kind: "skip" };

  // Run the same guards sync uses: items must reconcile to the retailer's
  // displayed subtotal, and distribution must produce a row that sums to
  // the YNAB charge.
  const verification = verifyScrape(order);
  if (!verification.ok) return { kind: "skip" };
  const distribution = distributeOrder(order, [charge]);
  if (distribution.allocated.length === 0) return { kind: "skip" };

  const allocated = distribution.allocated[0];
  const categoryId = tx.category_id;
  // Learn from items that landed on THIS allocated tx, not all order items.
  // For a refund whose allocation only covers a subset, the other items
  // weren't on this YNAB transaction and shouldn't be associated with its
  // category.
  const entries = allocated.items.map(
    (item): LearnEntry => ({ productId: item.productId, title: item.title, categoryId }),
  );
  return { kind: "ok", allocated, entries };
}

interface RetailerCtx {
  signal?: AbortSignal;
  onProgress?: (event: BackfillProgress) => void;
}

async function runForRetailer(
  retailerId: string,
  group: TaggedTx[],
  ctx: RetailerCtx,
): Promise<RetailerTotals> {
  const adapter = getAdapter(retailerId);
  const txById = new Map(group.map((g) => [g.tx.id, g.tx]));
  const charges = group.map((g) => toYnabCharge(g.tx));

  try {
    const { matched, unmatched, blocked } = await adapter.scrapeMatchedOrders(charges, {
      maxPages: BACKFILL_MAX_PAGES,
      signal: ctx.signal,
      onScrapeProgress: ({ index, total }) =>
        ctx.onProgress?.({ status: "scraping", index, total }),
    });

    // The adapter checks the signal between detail-page scrapes but not
    // after the last one returns. Catch the "cancel landed during the
    // final scrape" window before we commit anything downstream.
    ctx.signal?.throwIfAborted();

    const outcomes = matched.map((m) => processMatchedOrder(m, txById));
    const entries = outcomes.flatMap((o) => (o.kind === "ok" ? o.entries : []));
    const allocations = outcomes.flatMap((o) => (o.kind === "ok" ? [o.allocated] : []));

    // Order matters: learn first (best-effort), then persist allocations.
    // AllocatedTransaction is the dedup marker for re-runs — writing it
    // before learn would let a learn failure leave a tx marked "processed"
    // with nothing actually learned.
    if (entries.length > 0) {
      await learnFromApproval(retailerId, entries, ({ index, total }) =>
        ctx.onProgress?.({ status: "learning", index, total }),
      );
    }
    if (allocations.length > 0) await putAllocatedTransactions(allocations);

    // A charge the adapter skipped because its page couldn't be read counts as
    // a "failed" (couldn't-be-read) rather than a genuine no-match, so the UI's
    // "run again to retry them" reflects it. Everything else stays unmatched.
    const readFailed = unmatched.filter((u) => u.reason === READ_FAILED_REASON).length;

    return {
      matched: outcomes.filter((o) => o.kind === "ok").length,
      unmatched:
        sumBy(outcomes, (o) => (o.kind === "ambiguous" ? o.chargeCount : 0)) +
        (unmatched.length - readFailed),
      failed: readFailed,
      itemsWritten: entries.length,
      blocked: blocked?.reason,
    };
  } catch (err) {
    // Re-throw abort so runBackfill stops the per-retailer loop instead of
    // recording the cancellation as a "scrape failure" for this batch.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    console.error("[backfill] retailer", retailerId, "scrape threw:", err);
    return { matched: 0, unmatched: 0, failed: group.length, itemsWritten: 0 };
  }
}
