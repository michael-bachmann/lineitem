import { groupBy } from "remeda";
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
  YnabCharge,
  YnabTransaction,
} from "@/lib/types";

export interface BackfillOptions {
  /** ISO date string YYYY-MM-DD. Inclusive lower bound on tx.date. */
  fromDate: string;
  signal?: AbortSignal;
  onProgress?: (event: BackfillProgress) => void;
}

class AbortError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortError();
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

  onProgress?.({ phase: "fetching" });
  throwIfAborted(signal);
  const allTxs = await getTransactionsSince(settings.ynabToken, settings.planId, fromDate);

  const tagged = await filterCandidates(allTxs);
  const total = tagged.length;
  const byRetailer = groupBy(tagged, (e) => e.retailer);

  onProgress?.({ phase: "scraping" });

  // Sequential per retailer — each adapter call owns a browser tab; running
  // them in parallel would open multiple tabs at once. Sync's natural
  // bound of "one retailer per sync cycle" doesn't apply here.
  let aggregate: Omit<BackfillResult, "total"> = {
    matched: 0,
    unmatched: 0,
    failed: 0,
    itemsWritten: 0,
  };
  for (const [retailerId, group] of Object.entries(byRetailer)) {
    throwIfAborted(signal);
    aggregate = sumTotals(aggregate, await runForRetailer(retailerId, group));
  }

  onProgress?.({ phase: "done" });
  return { total, ...aggregate };
}

interface TaggedTx {
  tx: YnabTransaction;
  retailer: string;
}

/** Eligibility filter — approved + outflow + single-category + scrape-strategy
 *  payee + not already processed via sync. Per-tx IDB read keeps it simple;
 *  candidate counts are O(months × txs/month), fine to fan out. */
async function filterCandidates(txs: YnabTransaction[]): Promise<TaggedTx[]> {
  const tagged = await Promise.all(
    txs.map(async (tx): Promise<TaggedTx | null> => {
      if (!tx.approved) return null;
      if (tx.category_id === null) return null;
      if (tx.subtransactions.length > 0) return null;
      if (tx.amount > 0) return null; // refund / inflow
      if (tx.payee_name === null) return null;
      const mapping = getRetailerForPayee(tx.payee_name);
      if (!mapping || mapping.strategy !== "scrape") return null;
      const already = await getAllocatedTransaction(tx.id);
      if (already) return null;
      return { tx, retailer: mapping.retailer };
    }),
  );
  return tagged.filter((t): t is TaggedTx => t !== null);
}

type RetailerTotals = Omit<BackfillResult, "total">;

const ZERO: RetailerTotals = { matched: 0, unmatched: 0, failed: 0, itemsWritten: 0 };

function sumTotals(a: RetailerTotals, b: RetailerTotals): RetailerTotals {
  return {
    matched: a.matched + b.matched,
    unmatched: a.unmatched + b.unmatched,
    failed: a.failed + b.failed,
    itemsWritten: a.itemsWritten + b.itemsWritten,
  };
}

async function runForRetailer(retailerId: string, group: TaggedTx[]): Promise<RetailerTotals> {
  const adapter = getAdapter(retailerId);
  const txById = new Map(group.map((g) => [g.tx.id, g.tx]));
  const charges = group.map((g) => toYnabCharge(g.tx));

  try {
    const { matched, unmatched } = await adapter.scrapeMatchedOrders(charges);

    const folded = matched.reduce<{ totals: RetailerTotals; entries: LearnEntry[] }>(
      (acc, { order, charges: orderCharges }) => {
        // Multi-charge orders can't be cleanly attributed: each charge has its
        // own YNAB category, so there's no single category to tag the items
        // with. Cheaper to skip than to invent a partition.
        if (orderCharges.length !== 1) {
          return {
            ...acc,
            totals: { ...acc.totals, unmatched: acc.totals.unmatched + orderCharges.length },
          };
        }
        const tx = txById.get(orderCharges[0].ynabTransactionId);
        if (!tx || tx.category_id === null) return acc;
        const categoryId = tx.category_id;
        const newEntries = order.items.map(
          (item): LearnEntry => ({ productId: item.productId, title: item.title, categoryId }),
        );
        return {
          totals: {
            ...acc.totals,
            matched: acc.totals.matched + 1,
            itemsWritten: acc.totals.itemsWritten + order.items.length,
          },
          entries: [...acc.entries, ...newEntries],
        };
      },
      { totals: ZERO, entries: [] },
    );

    if (folded.entries.length > 0) {
      await learnFromApproval(retailerId, folded.entries);
    }

    return {
      ...folded.totals,
      unmatched: folded.totals.unmatched + unmatched.length,
    };
  } catch (err) {
    if (err instanceof AbortError) throw err;
    return { ...ZERO, failed: group.length };
  }
}
