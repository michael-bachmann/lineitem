import type {
  RetailerAdapter,
  ScrapedOrder,
  ScrapedItem,
  YnabCharge,
  PayeeMapping,
} from "@/lib/types";
import { matchByAmountAndDate, cutoffDateFor } from "@/lib/matcher";
import { openRetailerTab, waitForTabLoad } from "@/background/tabs";
import { orderDetailUrl, itemmodUrl } from "@/retailers/amazon/selectors";
import type { RawTransaction, RawItem } from "@/retailers/amazon/scraper";
import { groupBy } from "remeda";

const START_URL = "https://www.amazon.com/cpe/yourpayments/transactions";

const PAYEES: PayeeMapping[] = [
  { pattern: /amazon prime/i, retailer: "amazon", strategy: "skip" },
  { pattern: /amazon tips/i, retailer: "amazon", strategy: "skip" },
  { pattern: /amazon|amzn mktp/i, retailer: "amazon", strategy: "scrape" },
];

export const amazonAdapter: RetailerAdapter = {
  id: "amazon",
  payees: PAYEES,

  async scrapeMatchedOrders(charges, options) {
    const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES;
    const onScrapeProgress = options?.onScrapeProgress;
    const tabResult = await openRetailerTab(START_URL);
    if (!tabResult) {
      return {
        matched: [],
        unmatched: charges.map((c) => ({ charge: c, reason: "Failed to open Amazon tab" })),
      };
    }
    const { tabId, weOpenedTab } = tabResult;

    try {
      // Auth check
      const authResponse = (await browser.tabs.sendMessage(tabId, { type: "CHECK_AUTH" })) as
        | { authenticated: boolean }
        | { error: string };

      if ("error" in authResponse) {
        return {
          matched: [],
          unmatched: charges.map((c) => ({ charge: c, reason: authResponse.error })),
        };
      }

      if (!authResponse.authenticated) {
        await browser.tabs.update(tabId, { active: true });
        return {
          matched: [],
          unmatched: charges.map((c) => ({ charge: c, reason: "Amazon auth required" })),
        };
      }

      // Phase 1: paginate list page and match
      const { matchedPairs, unmatchedCharges, error } = await paginateAndMatch(tabId, charges, maxPages);

      // Phase 2: group by orderId, scrape detail page per order
      const byOrderId = groupBy(matchedPairs, ([_charge, raw]) => raw.orderId!);
      const orderEntries = Object.entries(byOrderId);
      const totalOrders = orderEntries.length;

      const matchedOrders: { order: ScrapedOrder; charges: YnabCharge[] }[] = [];
      const detailFailures: { charge: YnabCharge; reason: string }[] = [];

      for (let i = 0; i < totalOrders; i++) {
        const [orderId, pairs] = orderEntries[i];
        // Emit progress BEFORE the scrape so the UI shows "Scraping order N
        // of T" while N is in flight, not after it lands.
        onScrapeProgress?.({ index: i + 1, total: totalOrders });
        const result = await scrapeOrderItems(tabId, orderId);

        if ("error" in result || result.items.length === 0) {
          const reason = "error" in result ? result.error : "Failed to scrape order items";
          for (const [charge] of pairs) {
            detailFailures.push({ charge, reason });
          }
          continue;
        }

        const order: ScrapedOrder = {
          retailer: "amazon",
          orderId,
          items: result.items,
          displayedItemsSubtotalCents: result.subtotalCents,
        };
        const orderCharges = pairs.map(([charge]) => charge);
        matchedOrders.push({ order, charges: orderCharges });
      }

      const allUnmatched = [
        ...unmatchedCharges.map((c) => ({
          charge: c,
          reason: error ?? "No matching Amazon order found",
        })),
        ...detailFailures,
      ];

      return { matched: matchedOrders, unmatched: allUnmatched };
    } finally {
      if (weOpenedTab) {
        browser.tabs.remove(tabId).catch(() => {});
      }
    }
  },
};

// ----------------------------------------------------------------------------
// Internal: list-page pagination + matching
// ----------------------------------------------------------------------------

/** Default pagination cap for callers that don't pass `options.maxPages`.
 *  Sync's natural cutoff (`cutoffDateFor`) short-circuits well before this. */
const DEFAULT_MAX_PAGES = 10;

interface PaginateResult {
  matchedPairs: [YnabCharge, RawTransaction][];
  unmatchedCharges: YnabCharge[];
  error?: string;
}

async function paginateAndMatch(
  tabId: number,
  charges: YnabCharge[],
  maxPages: number,
): Promise<PaginateResult> {
  const cutoffIso = cutoffDateFor(charges);
  let candidates: RawTransaction[] = [];
  let remaining = [...charges];
  let allMatched: [YnabCharge, RawTransaction][] = [];

  for (let page = 0; page < maxPages; page++) {
    const txResponse = (await browser.tabs.sendMessage(tabId, {
      type: "SCRAPE_TRANSACTIONS",
    })) as { transactions: RawTransaction[] } | { error: string };

    if ("error" in txResponse) {
      return { matchedPairs: allMatched, unmatchedCharges: remaining, error: txResponse.error };
    }

    if (txResponse.transactions.length === 0) break;

    const allCandidates = [...candidates, ...txResponse.transactions];
    const matchedThisPage: [YnabCharge, RawTransaction][] = [];
    const stillUnmatched: YnabCharge[] = [];
    const matchedRaws = new Set<RawTransaction>();

    for (const charge of remaining) {
      const match = matchByAmountAndDate(charge.amountCents, charge.date, allCandidates);
      if (match?.orderId && !matchedRaws.has(match)) {
        matchedThisPage.push([charge, match]);
        matchedRaws.add(match);
      } else {
        stillUnmatched.push(charge);
      }
    }

    allMatched = [...allMatched, ...matchedThisPage];
    remaining = stillUnmatched;
    candidates = allCandidates.filter((c) => !matchedRaws.has(c));

    if (remaining.length === 0) break;

    const oldestOnPage = txResponse.transactions.reduce(
      (min, t) => (t.date < min ? t.date : min),
      txResponse.transactions[0].date,
    );
    if (oldestOnPage < cutoffIso) break;

    const pageResult = (await browser.tabs.sendMessage(tabId, {
      type: "NEXT_PAGE",
    })) as { hasNext: boolean };
    if (!pageResult.hasNext) break;
  }

  return { matchedPairs: allMatched, unmatchedCharges: remaining };
}

// ----------------------------------------------------------------------------
// Internal: detail-page item scrape
// ----------------------------------------------------------------------------

type SummaryResponse =
  | { items: RawItem[]; subtotalCents: number }
  | { requiresItemmod: true; subtotalCents: number }
  | { error: string };

type ItemmodResponse =
  | { items: RawItem[] }
  | { error: string };

async function fetchItems(
  tabId: number,
  orderId: string,
  summaryResp:
    | { items: RawItem[]; subtotalCents: number }
    | { requiresItemmod: true; subtotalCents: number },
): Promise<{ items: RawItem[] } | { error: string }> {
  if (!("requiresItemmod" in summaryResp)) return { items: summaryResp.items };

  await browser.tabs.update(tabId, { url: itemmodUrl(orderId) });
  await waitForTabLoad(tabId);
  const itemmodResp = (await browser.tabs.sendMessage(tabId, {
    type: "SCRAPE_ITEMS",
  })) as ItemmodResponse;
  return "error" in itemmodResp
    ? { error: amazonErrorMessage(itemmodResp.error) }
    : { items: itemmodResp.items };
}

async function scrapeOrderItems(
  tabId: number,
  orderId: string,
): Promise<
  | { items: ScrapedItem[]; subtotalCents: number }
  | { error: string }
> {
  await browser.tabs.update(tabId, { url: orderDetailUrl(orderId) });
  await waitForTabLoad(tabId);

  const summaryResp = (await browser.tabs.sendMessage(tabId, {
    type: "SCRAPE_ITEMS",
  })) as SummaryResponse;

  if ("error" in summaryResp) {
    return { error: amazonErrorMessage(summaryResp.error) };
  }

  const itemsResp = await fetchItems(tabId, orderId, summaryResp);
  if ("error" in itemsResp) return itemsResp;

  return {
    items: itemsResp.items.map(
      (raw): ScrapedItem => ({
        productId: raw.productId,
        title: raw.title,
        imageUrl: raw.imageUrl,
        unitPriceCents: raw.priceCents,
        quantity: raw.quantity,
      }),
    ),
    subtotalCents: summaryResp.subtotalCents,
  };
}

/**
 * Map content-script error tokens to user-readable messages. The content
 * script returns short stable tokens; the user-facing copy lives here
 * alongside the retailer that produces them.
 */
function amazonErrorMessage(token: string): string {
  switch (token) {
    case "missing_subtotal":
      return "Couldn't find Amazon's items subtotal on the page — the page layout may have changed. Try resyncing, or categorize manually in YNAB.";
    case "auth_required":
      return "Amazon auth required";
    default:
      return token;
  }
}
