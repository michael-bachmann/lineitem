import { groupBy, sumBy } from "remeda";
import { getSettings } from "@/lib/settings";
import { getTransactionsSince } from "@/lib/ynab";
import { getAllocatedTransaction } from "@/lib/db";
import { getRetailerForPayee } from "@/lib/registry";
import { getAdapter } from "@/retailers/registry";
import { millunitsToCents } from "@/lib/money";
import { learnFromApproval, type LearnEntry } from "./approval";
import type {
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

  onProgress?.({ status: "preparing" });
  signal?.throwIfAborted();
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
    const r = await runForRetailer(retailerId, group, onProgress);
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
 *  dedup against AllocatedTransaction so each concern is independently
 *  readable. Per-tx IDB read keeps it simple; candidate counts are
 *  O(months × txs/month), fine to fan out. */
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

/** One matched order's contribution to the retailer's rolling counts. */
interface OrderContribution {
  matched: 0 | 1;
  unmatched: number;
  itemsWritten: number;
  entries: LearnEntry[];
}

const EMPTY_CONTRIBUTION: OrderContribution = {
  matched: 0,
  unmatched: 0,
  itemsWritten: 0,
  entries: [],
};

/** Convert one matched-order entry into its contribution. Skips with
 *  zero-everything when the order can't be cleanly attributed (multi-charge,
 *  missing tx, or missing category). */
function processMatchedOrder(
  matchedEntry: { order: ScrapedOrder; charges: YnabCharge[] },
  txById: Map<string, YnabTransaction>,
): OrderContribution {
  const { order, charges: orderCharges } = matchedEntry;
  // Multi-charge orders can't be cleanly attributed: each charge has its
  // own YNAB category, so there's no single category to tag the items
  // with. Cheaper to skip than to invent a partition.
  if (orderCharges.length !== 1) {
    return { ...EMPTY_CONTRIBUTION, unmatched: orderCharges.length };
  }
  const tx = txById.get(orderCharges[0].ynabTransactionId);
  if (!tx || tx.category_id === null) return EMPTY_CONTRIBUTION;
  const categoryId = tx.category_id;
  const entries = order.items.map(
    (item): LearnEntry => ({ productId: item.productId, title: item.title, categoryId }),
  );
  return { matched: 1, unmatched: 0, itemsWritten: order.items.length, entries };
}

async function runForRetailer(
  retailerId: string,
  group: TaggedTx[],
  onProgress?: (event: BackfillProgress) => void,
): Promise<RetailerTotals> {
  const adapter = getAdapter(retailerId);
  const txById = new Map(group.map((g) => [g.tx.id, g.tx]));
  const charges = group.map((g) => toYnabCharge(g.tx));

  try {
    const { matched, unmatched } = await adapter.scrapeMatchedOrders(charges, {
      maxPages: BACKFILL_MAX_PAGES,
      onScrapeProgress: (event) => onProgress?.({ status: "scraping", ...event }),
    });

    const contribs = matched.map((m) => processMatchedOrder(m, txById));
    const entries = contribs.flatMap((c) => c.entries);

    if (entries.length > 0) await learnFromApproval(retailerId, entries);

    return {
      matched: sumBy(contribs, (c) => c.matched),
      unmatched: sumBy(contribs, (c) => c.unmatched) + unmatched.length,
      failed: 0,
      itemsWritten: sumBy(contribs, (c) => c.itemsWritten),
    };
  } catch (err) {
    // Re-throw abort so runBackfill stops the per-retailer loop instead of
    // recording the cancellation as a "scrape failure" for this batch.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { matched: 0, unmatched: 0, failed: group.length, itemsWritten: 0 };
  }
}
