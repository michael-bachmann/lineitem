import { classifyItems } from "@/lib/classifier";
import { putItemizedTransaction } from "@/lib/db";
import { findItemSubset } from "@/lib/money";
import { tryMatchEntries, cutoffDateFor } from "@/lib/matcher";
import { retailerStartUrls } from "@/lib/registry";
import { openRetailerTab, waitForTabLoad } from "./tabs";
import { orderDetailUrl } from "@/retailers/amazon/selectors";
import type { RawTransaction, RawItem } from "@/retailers/amazon/scraper";
import type {
  YnabTransaction,
  ItemizedTransaction,
  OrderMatchStatus,
  QueueEntry,
  LineItem,
} from "@/lib/types";

function buildItemizedTransaction(
  retailer: string,
  raw: RawTransaction,
  items: LineItem[],
  ynabTransactionId: string,
): ItemizedTransaction {
  return {
    ynabTransactionId,
    orderKey: `${retailer}:${raw.orderId}`,
    retailer,
    date: raw.date,
    amountCents: raw.amountCents,
    cardLastFour: raw.cardLastFour,
    isRefund: raw.isRefund,
    items,
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Orchestrates auth check, pagination, and item scraping for a single retailer.
 * Phase 1: paginate the transactions list and match by amount+date.
 * Phase 2: navigate to each matched order's detail page to scrape line items.
 * Returns a QueueEntry per YNAB transaction with its match result.
 */
export async function scrapeAndMatch(retailer: string, ynabTxs: YnabTransaction[]): Promise<QueueEntry[]> {
  const makeEntry = (tx: YnabTransaction, matchStatus: OrderMatchStatus): QueueEntry => ({
    ynabTransaction: tx, retailer, matchStatus,
  });

  const startUrl = retailerStartUrls[retailer];
  if (!startUrl) {
    return ynabTxs.map((tx) => makeEntry(tx, { status: "error", message: `No start URL for retailer: ${retailer}` }));
  }

  const tabResult = await openRetailerTab(startUrl);
  if (!tabResult) {
    return ynabTxs.map((tx) => makeEntry(tx, { status: "error", message: "Failed to open retailer tab" }));
  }

  const { tabId, weOpenedTab } = tabResult;

  try {
    const authResponse = await browser.tabs.sendMessage(tabId, { type: "CHECK_AUTH" }) as
      | { authenticated: boolean }
      | { error: string };

    if ("error" in authResponse) {
      return ynabTxs.map((tx) => makeEntry(tx, { status: "error", message: authResponse.error }));
    }

    if (!authResponse.authenticated) {
      await browser.tabs.update(tabId, { active: true });
      return ynabTxs.map((tx) => makeEntry(tx, { status: "auth_required" }));
    }

    // Phase 1: Paginate and match in memory
    const { matched, unmatched, error } = await paginateAndMatch(tabId, ynabTxs);

    // Phase 2: Scrape items for each matched order (tab is free to navigate now)
    const matchedEntries = await scrapeItemsForMatches(tabId, retailer, matched);

    // Unmatched entries: error if scraping failed, no_match otherwise
    const unmatchedEntries = unmatched.map((tx) =>
      makeEntry(tx, error ? { status: "error", message: error } : { status: "no_match" }),
    );

    return [...matchedEntries, ...unmatchedEntries];
  } finally {
    if (weOpenedTab) {
      browser.tabs.remove(tabId).catch(() => {});
    }
  }
}

interface PaginateResult {
  matched: [YnabTransaction, RawTransaction][];
  unmatched: YnabTransaction[];
  error?: string;
}

/**
 * Paginate the retailer's transactions page and match against YNAB transactions.
 * Carries forward unmatched candidates across pages so a scraped order on page 1
 * can still match a YNAB transaction that wasn't tried until page 2's batch.
 */
async function paginateAndMatch(tabId: number, ynabTxs: YnabTransaction[]): Promise<PaginateResult> {
  const cutoffIso = cutoffDateFor(ynabTxs);
  let candidates: RawTransaction[] = [];
  let remaining = ynabTxs;
  let allMatched: [YnabTransaction, RawTransaction][] = [];
  const MAX_PAGES = 10;

  for (let page = 0; page < MAX_PAGES; page++) {
    const txResponse = await browser.tabs.sendMessage(tabId, {
      type: "SCRAPE_TRANSACTIONS",
    }) as { transactions: RawTransaction[] } | { error: string };

    if ("error" in txResponse) {
      return { matched: allMatched, unmatched: remaining, error: txResponse.error };
    }

    if (txResponse.transactions.length === 0) break;

    const { matched, unmatched, remainingCandidates } = tryMatchEntries(
      remaining,
      [...candidates, ...txResponse.transactions],
    );

    allMatched = [...allMatched, ...matched];
    remaining = unmatched;
    candidates = remainingCandidates;

    if (remaining.length === 0) break;

    // Stop paginating once we're past the date window of any unmatched YNAB transaction
    const oldestOnPage = txResponse.transactions.reduce((min, t) =>
      t.date < min ? t.date : min, txResponse.transactions[0].date);
    if (oldestOnPage < cutoffIso) break;

    const pageResult = await browser.tabs.sendMessage(tabId, {
      type: "NEXT_PAGE",
    }) as { hasNext: boolean };
    if (!pageResult.hasNext) break;
  }

  return { matched: allMatched, unmatched: remaining };
}

/** Scrape order detail pages for each matched pair. Saves orders to IndexedDB. */
async function scrapeItemsForMatches(
  tabId: number,
  retailer: string,
  matched: [YnabTransaction, RawTransaction][],
): Promise<QueueEntry[]> {
  // Group by order ID so we scrape each order page only once
  const byOrder = matched.reduce<Map<string, [YnabTransaction, RawTransaction][]>>(
    (acc, pair) => {
      const orderId = pair[1].orderId!;
      acc.set(orderId, [...(acc.get(orderId) ?? []), pair]);
      return acc;
    },
    new Map(),
  );

  const results: QueueEntry[] = [];

  for (const [orderId, pairs] of byOrder) {
    const { items: allItems, error } = await scrapeOrderItems(tabId, orderId);

    if (allItems.length === 0) {
      for (const [ynabTx] of pairs) {
        results.push({
          ynabTransaction: ynabTx,
          retailer,
          matchStatus: { status: "error", message: error ?? "Failed to scrape order items" },
        });
      }
      continue;
    }

    // Single charge for this order — use all items
    if (pairs.length === 1) {
      const [ynabTx, raw] = pairs[0];
      const itemizedTx = buildItemizedTransaction(retailer, raw, allItems, ynabTx.id);
      await putItemizedTransaction(itemizedTx);
      const classifiedItems = await classifyItems(allItems, retailer);
      results.push({ ynabTransaction: ynabTx, retailer, matchStatus: { status: "matched", order: itemizedTx, classifiedItems } });
      continue;
    }

    // Multiple charges for the same order — subset-sum on items.
    // Process charges largest-first so the smaller remainder is easier to match.
    const orderTotalCents = pairs.reduce((sum, [, raw]) => sum + raw.amountCents, 0);
    const itemsSubtotalCents = allItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const sortedPairs = [...pairs].sort(([, a], [, b]) => b.amountCents - a.amountCents);
    let remainingIndices = allItems.map((_, i) => i);

    for (const [ynabTx, raw] of sortedPairs) {
      const remainingSubtotals = remainingIndices.map((i) => allItems[i].price * allItems[i].quantity);
      const matchedPositions = findItemSubset(
        remainingSubtotals,
        raw.amountCents,
        orderTotalCents,
        itemsSubtotalCents,
      );

      if (!matchedPositions) {
        results.push({
          ynabTransaction: ynabTx,
          retailer,
          matchStatus: { status: "error", message: "Could not match items to charge amount" },
        });
        continue;
      }

      const matchedOriginalIndices = matchedPositions.map((p) => remainingIndices[p]);
      const items = matchedOriginalIndices.map((i) => allItems[i]);
      remainingIndices = remainingIndices.filter((i) => !matchedOriginalIndices.includes(i));

      const itemizedTx = buildItemizedTransaction(retailer, raw, items, ynabTx.id);
      await putItemizedTransaction(itemizedTx);
      const classifiedItems = await classifyItems(items, retailer);
      results.push({ ynabTransaction: ynabTx, retailer, matchStatus: { status: "matched", order: itemizedTx, classifiedItems } });
    }
  }

  return results;
}

/** Navigate to an order's detail page and scrape its line items. */
async function scrapeOrderItems(
  tabId: number,
  orderId: string,
): Promise<{ items: LineItem[]; error?: string }> {
  await browser.tabs.update(tabId, { url: orderDetailUrl(orderId) });
  await waitForTabLoad(tabId);

  const response = await browser.tabs.sendMessage(tabId, {
    type: "SCRAPE_ITEMS",
  }) as { items: RawItem[] } | { error: string };

  if ("error" in response) return { items: [], error: response.error };

  return {
    items: response.items.map((raw) => ({
      productId: raw.productId,
      title: raw.title,
      imageUrl: raw.imageUrl,
      price: raw.priceCents,
      quantity: raw.quantity,
    })),
  };
}
