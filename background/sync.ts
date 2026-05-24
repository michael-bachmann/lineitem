import { getSettings } from "@/lib/settings";
import { getUnapprovedTransactions } from "@/lib/ynab";
import { getItemizedTransaction } from "@/lib/db";
import { getRetailerForPayee } from "@/lib/registry";
import { classifyItems } from "@/lib/classifier";
import { groupBy } from "@/lib/utils";
import { scrapeAndMatch } from "./amazon-scraper";
import type { YnabTransaction, QueueEntry } from "@/lib/types";

/** Fast path: resolve a YNAB transaction from the IDB cache. */
async function resolveFromCache(
  tx: YnabTransaction,
  retailer: string,
): Promise<QueueEntry | null> {
  const existing = await getItemizedTransaction(tx.id);
  if (!existing) return null;
  const classifiedItems = await classifyItems(existing.items, retailer);
  return {
    ynabTransaction: tx,
    retailer,
    matchStatus: { status: "matched", order: existing, classifiedItems },
  };
}

/** Deduplicates concurrent sync calls — all callers receive the same result. */
let activeSyncPromise: Promise<{ queue: QueueEntry[] } | { error: string }> | null = null;

export async function performSync(): Promise<{ queue: QueueEntry[] } | { error: string }> {
  if (activeSyncPromise) return activeSyncPromise;
  activeSyncPromise = performSyncInner();
  try {
    return await activeSyncPromise;
  } finally {
    activeSyncPromise = null;
  }
}

/**
 * Fetch unapproved YNAB transactions, check the local cache for previously
 * matched orders, and scrape any remaining unmatched transactions by retailer.
 */
async function performSyncInner(): Promise<{ queue: QueueEntry[] } | { error: string }> {
  try {
    const settings = await getSettings();
    if (!settings.ynabToken || !settings.planId) {
      return { error: "Not connected to YNAB" };
    }

    const ynabTransactions = await getUnapprovedTransactions(settings.ynabToken, settings.planId);

    // Filter to scrapeable retailer transactions
    const scrapeable = ynabTransactions
      .filter((tx) => tx.payee_name)
      .map((tx) => ({ tx, match: getRetailerForPayee(tx.payee_name!) }))
      .filter((r) => r.match?.strategy === "scrape")
      .map(({ tx, match }) => ({ tx, retailer: match!.retailer }));

    // Check DB for already-matched orders
    const withCache = await Promise.all(
      scrapeable.map(async ({ tx, retailer }) => ({
        tx,
        retailer,
        cached: await resolveFromCache(tx, retailer),
      })),
    );

    const fastPath = withCache.filter((r) => r.cached).map((r) => r.cached!);
    const needsScraping = withCache.filter((r) => !r.cached);

    // Scrape each retailer and collect results
    const scraped: QueueEntry[] = [];
    for (const [retailer, group] of groupBy(needsScraping, (r) => r.retailer)) {
      const entries = await scrapeAndMatch(retailer, group.map((g) => g.tx));
      scraped.push(...entries);
    }

    return { queue: [...fastPath, ...scraped] };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Sync failed" };
  }
}
