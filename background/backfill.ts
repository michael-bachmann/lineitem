import { groupBy, sumBy } from "remeda";
import { getSettings } from "@/lib/settings";
import { getTransactionsSince } from "@/lib/ynab";
import {
  getAllocatedTransaction,
  getBackfilledTransaction,
  putBackfilledTransactions,
} from "@/lib/db";
import { getRetailerForPayee } from "@/lib/registry";
import { getAdapter } from "@/retailers/registry";
import { millunitsToCents } from "@/lib/money";
import { learnFromApproval, type LearnEntry } from "./approval";
import type {
  BackfilledTransaction,
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

const now = (): string => new Date().toISOString();

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
 * Walk approved YNAB transactions since `fromDate` and feed their scraped
 * items into `learnFromApproval` so they bootstrap the embedding pool.
 *
 * Idempotent — re-running skips transactions we've already processed via
 * the sync pipeline (anything in the AllocatedTransaction store). This is
 * also what makes the multi-Amazon-account workflow work: charges that
 * didn't match the first Amazon login simply have no AllocatedTransaction
 * row, so they get re-attempted on the next run with a different login.
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
 *  dedup against AllocatedTransaction (sync's marker) and BackfilledTransaction
 *  (backfill's own marker). Per-tx IDB reads — candidate counts are
 *  O(months × txs/month), fine to fan out. */
async function filterCandidates(txs: YnabTransaction[]): Promise<TaggedTx[]> {
  const tagged = await Promise.all(
    txs.map(async (tx): Promise<TaggedTx | null> => {
      const eligibility = backfillEligibility(tx);
      if (!eligibility) return null;
      const [allocated, backfilled] = await Promise.all([
        getAllocatedTransaction(tx.id),
        getBackfilledTransaction(tx.id),
      ]);
      if (allocated || backfilled) return null;
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
 * The three things that can happen when we try to attribute a matched order
 * to a learnable category:
 *  - `ok`: one charge, with a category — we'll write its items.
 *  - `ambiguous`: multi-charge order. Each charge has its own YNAB category,
 *    so there's no single category to tag the items with. Cheaper to skip
 *    than to invent a partition. Each charge counts as unmatched.
 *  - `skip`: charge present but the looked-up tx has no category (shouldn't
 *    happen post-filter; defensive only). Contributes nothing.
 */
type OrderOutcome =
  | { kind: "ok"; entries: LearnEntry[] }
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
  const tx = txById.get(orderCharges[0].ynabTransactionId);
  if (!tx || tx.category_id === null) return { kind: "skip" };
  const categoryId = tx.category_id;
  const entries = order.items.map(
    (item): LearnEntry => ({ productId: item.productId, title: item.title, categoryId }),
  );
  return { kind: "ok", entries };
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

    const outcomes = matched.map((m) => processMatchedOrder(m, txById));
    const entries = outcomes.flatMap((o) => (o.kind === "ok" ? o.entries : []));

    if (entries.length > 0) await learnFromApproval(retailerId, entries);

    // Mark every adapter-matched tx so re-runs skip them. Includes ambiguous
    // multi-charge orders: re-scraping them produces the same skip; the
    // adapter-unmatched charges are NOT marked, so a second run under a
    // different retailer login picks them up.
    const markers: BackfilledTransaction[] = matched.flatMap(({ charges: cs }) =>
      cs.map((c) => ({ ynabTransactionId: c.ynabTransactionId, backfilledAt: now() })),
    );
    await putBackfilledTransactions(markers);

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
