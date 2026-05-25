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

  async scrapeMatchedOrders(charges) {
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
      const { matchedPairs, unmatchedCharges, error } = await paginateAndMatch(tabId, charges);

      // Phase 2: group by orderId, scrape detail page per order
      const byOrderId = groupBy(matchedPairs, ([_charge, raw]) => raw.orderId!);

      const matchedOrders: { order: ScrapedOrder; charges: YnabCharge[] }[] = [];
      const detailFailures: { charge: YnabCharge; reason: string }[] = [];

      for (const [orderId, pairs] of Object.entries(byOrderId)) {
        const { items, error: scrapeError } = await scrapeOrderItems(tabId, orderId);

        if (items.length === 0) {
          for (const [charge] of pairs) {
            detailFailures.push({
              charge,
              reason: scrapeError ?? "Failed to scrape order items",
            });
          }
          continue;
        }

        const order: ScrapedOrder = {
          retailer: "amazon",
          orderId,
          items,
          scrapedAt: new Date().toISOString(),
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

const MAX_PAGES = 10;

interface PaginateResult {
  matchedPairs: [YnabCharge, RawTransaction][];
  unmatchedCharges: YnabCharge[];
  error?: string;
}

async function paginateAndMatch(
  tabId: number,
  charges: YnabCharge[],
): Promise<PaginateResult> {
  const cutoffIso = cutoffDateFor(charges);
  let candidates: RawTransaction[] = [];
  let remaining = [...charges];
  let allMatched: [YnabCharge, RawTransaction][] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
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

async function scrapeOrderItems(
  tabId: number,
  orderId: string,
): Promise<{ items: ScrapedItem[]; error?: string }> {
  await browser.tabs.update(tabId, { url: orderDetailUrl(orderId) });
  await waitForTabLoad(tabId);

  let response = (await browser.tabs.sendMessage(tabId, {
    type: "SCRAPE_ITEMS",
  })) as { items: RawItem[] } | { requiresItemmod: true } | { error: string };

  if ("requiresItemmod" in response) {
    await browser.tabs.update(tabId, { url: itemmodUrl(orderId) });
    await waitForTabLoad(tabId);
    response = (await browser.tabs.sendMessage(tabId, {
      type: "SCRAPE_ITEMS",
    })) as { items: RawItem[] } | { error: string };
  }

  if ("error" in response) return { items: [], error: response.error };

  return {
    items: response.items.map(
      (raw): ScrapedItem => ({
        productId: raw.productId,
        title: raw.title,
        imageUrl: raw.imageUrl,
        unitPriceCents: raw.priceCents,
        quantity: raw.quantity,
      }),
    ),
  };
}
