import { groupBy, sumBy } from "remeda";
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
 */
export async function runBackfill(options: BackfillOptions): Promise<BackfillResult> {
  const { fromDate, signal, onProgress } = options;

  const settings = await getSettings();
  if (!settings.ynabToken || !settings.planId) throw new Error("Not connected to YNAB");

  signal?.throwIfAborted();
  onProgress?.({ status: "preparing" });
  const allTxs = await getTransactionsSince(settings.ynabToken, settings.planId, fromDate);

  const tagged = await filterCandidates(allTxs);
  const total = tagged.length;
  const byRetailer = groupBy(tagged, (e) => e.retailer);

  // Sequential per retailer — each adapter call owns a browser tab; running
  // them in parallel would open multiple tabs at once. Sync's natural
  // bound of "one retailer per sync cycle" doesn't apply here.
  let aggregate: RetailerTotals = { matched: 0, unmatched: 0, failed: 0, itemsWritten: 0 };
  for (const [retailerId, group] of Object.entries(byRetailer)) {
    signal?.throwIfAborted();
    const r = await runForRetailer(retailerId, group, { signal, onProgress });
    aggregate = {
      matched: aggregate.matched + r.matched,
      unmatched: aggregate.unmatched + r.unmatched,
      failed: aggregate.failed + r.failed,
      itemsWritten: aggregate.itemsWritten + r.itemsWritten,
    };
  }

  return { total, ...aggregate };
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

/** Eligibility filter. Split into (a) a sync shape check and (b) an async
 *  dedup against `AllocatedTransaction` (written by both sync and backfill
 *  as a "we've processed this tx" marker). Per-tx IDB read keeps it simple;
 *  candidate counts are O(months × txs/month), fine to fan out. */
async function filterCandidates(txs: YnabTransaction[]): Promise<TaggedTx[]> {
  const tagged = await Promise.all(
    txs.map(async (tx): Promise<TaggedTx | null> => {
      const eligibility = backfillEligibility(tx);
      if (!eligibility) return null;
      const already = await getAllocatedTransaction(tx.id);
      if (already) return null;
      return { tx, retailer: eligibility.retailer };
    }),
  );
  return tagged.filter((t): t is TaggedTx => t !== null);
}

interface RetailerTotals {
  matched: number;
  unmatched: number;
  failed: number;
  itemsWritten: number;
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
  const allocated = distributeOrder(order, [charge]);
  if (allocated.length === 0) return { kind: "skip" };

  const categoryId = tx.category_id;
  const entries = order.items.map(
    (item): LearnEntry => ({ productId: item.productId, title: item.title, categoryId }),
  );
  return { kind: "ok", allocated: allocated[0], entries };
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
    const { matched, unmatched } = await adapter.scrapeMatchedOrders(charges, {
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
    if (entries.length > 0) await learnFromApproval(retailerId, entries);
    if (allocations.length > 0) await putAllocatedTransactions(allocations);

    return {
      matched: outcomes.filter((o) => o.kind === "ok").length,
      unmatched:
        sumBy(outcomes, (o) => (o.kind === "ambiguous" ? o.chargeCount : 0)) + unmatched.length,
      failed: 0,
      itemsWritten: entries.length,
    };
  } catch (err) {
    // Re-throw abort so runBackfill stops the per-retailer loop instead of
    // recording the cancellation as a "scrape failure" for this batch.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { matched: 0, unmatched: 0, failed: group.length, itemsWritten: 0 };
  }
}
