import type {
  RetailerAdapter,
  ScrapedOrder,
  ScrapedItem,
  YnabCharge,
  PayeeMapping,
} from "@/lib/types";
import { assignByAmountAndDate, cutoffDateFor, NO_MATCH_REASON, READ_FAILED_REASON } from "@/lib/matcher";
import { openRetailerTab, navigateTab, sendToTab, waitForTabLoad } from "@/background/tabs";
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
  startUrl: START_URL,

  async scrapeMatchedOrders(charges, options) {
    const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES;
    const onScrapeProgress = options?.onScrapeProgress;
    const signal = options?.signal;
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
      const authResponse = (await sendToTab(tabId, { type: "CHECK_AUTH" })) as
        | { authenticated: boolean }
        | { error: string };

      if ("error" in authResponse) {
        return {
          matched: [],
          unmatched: charges.map((c) => ({ charge: c, reason: authResponse.error })),
        };
      }

      if (!authResponse.authenticated) {
        // Signed out — nothing is readable. Surface a sign-in wall; the side
        // panel's resolution card foregrounds the tab on user action (we no
        // longer pop it here, which was intrusive on a background sync).
        return {
          matched: [],
          unmatched: [],
          blocked: { reason: "signed_out", charges },
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
        // Honor cancellation between detail-page scrapes — the long phase
        // the user actually sees the spinner spinning through.
        signal?.throwIfAborted();
        const [orderId, pairs] = orderEntries[i];
        // Emit progress BEFORE the scrape so the UI shows "Scraping order N
        // of T" while N is in flight, not after it lands.
        onScrapeProgress?.({ index: i + 1, total: totalOrders });

        // A hung/failed detail page (e.g. a sendToTab timeout) throws rather
        // than returning {error}. Isolate it to this order so one bad page
        // skips just its charges instead of tanking the whole batch; they're
        // not persisted, so a re-run reattempts them.
        let result: Awaited<ReturnType<typeof scrapeOrderItems>>;
        try {
          result = await scrapeOrderItems(tabId, orderId);
        } catch (err) {
          console.warn(`[amazon] couldn't read order ${orderId}`, err);
          for (const [charge] of pairs) {
            detailFailures.push({ charge, reason: READ_FAILED_REASON });
          }
          continue;
        }

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
          refund: result.refund,
        };
        const orderCharges = pairs.map(([charge]) => charge);
        matchedOrders.push({ order, charges: orderCharges });
      }

      const allUnmatched = [
        ...unmatchedCharges.map((c) => ({
          charge: c,
          reason: error ?? NO_MATCH_REASON,
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

/** Turning the pager drops the content-script message channel, so the NEXT_PAGE
 *  reply is lost and the send rejects with one of these. The exact cause in
 *  Firefox is NOT pinned down: the URL never changes and the amazon.com console
 *  persists across turns, which argues against a full reload — it may be the
 *  AJAX swap transiently dropping/re-injecting the content script rather than a
 *  navigation. What we DO know empirically: the page turns (pagination
 *  advances), so treat this rejection as "the page turned" and re-sync rather
 *  than fail. A genuine hang trips sendToTab's reply timeout instead, which we
 *  let propagate. (TODO: instrument to confirm the mechanism — see BAC-146.) */
export function isPageTurnChannelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /message channel closed|receiving end does not exist/i.test(msg);
}

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
    const txResponse = (await sendToTab(tabId, {
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

    // Only order-linked rows are matchable (we need the orderId to scrape the
    // detail page). Assign charges to them 1:1, resolving balanced ambiguity.
    const eligible = allCandidates.filter((c) => c.orderId);
    const assignments = assignByAmountAndDate(remaining, eligible);

    remaining.forEach((charge, i) => {
      const j = assignments[i];
      if (j !== null) {
        const raw = eligible[j];
        matchedThisPage.push([charge, raw]);
        matchedRaws.add(raw);
      } else {
        stillUnmatched.push(charge);
      }
    });

    allMatched = [...allMatched, ...matchedThisPage];
    remaining = stillUnmatched;
    candidates = allCandidates.filter((c) => !matchedRaws.has(c));

    if (remaining.length === 0) break;

    const oldestOnPage = txResponse.transactions.reduce(
      (min, t) => (t.date < min ? t.date : min),
      txResponse.transactions[0].date,
    );
    if (oldestOnPage < cutoffIso) break;

    // Turn the pager. The content script clicks Amazon's pager button.
    //  - If NEXT_PAGE resolves (Chrome's in-place AJAX swap; content script
    //    stayed alive and confirmed the new rows), loop and scrape.
    //  - If it rejects because the page-turn dropped the message channel (see
    //    isPageTurnChannelError), the page still turned — re-sync via
    //    waitForTabLoad (which re-establishes content-script readiness) and keep
    //    going. Any other rejection is a real failure: keep what we matched and
    //    stop.
    try {
      const { hasNext } = (await sendToTab(tabId, { type: "NEXT_PAGE" })) as { hasNext: boolean };
      if (!hasNext) break;
    } catch (err) {
      if (!isPageTurnChannelError(err)) {
        console.warn("[amazon] NEXT_PAGE failed; stopping pagination", err);
        break;
      }
      await waitForTabLoad(tabId);
    }
  }

  return { matchedPairs: allMatched, unmatchedCharges: remaining };
}

// ----------------------------------------------------------------------------
// Internal: detail-page item scrape
// ----------------------------------------------------------------------------

type SummaryResponse =
  | { items: RawItem[]; subtotalCents: number; refund: ScrapedOrder["refund"] }
  | { requiresItemmod: true; subtotalCents: number; refund: ScrapedOrder["refund"] }
  | { error: string };

type ItemmodResponse =
  | { items: RawItem[]; refund: ScrapedOrder["refund"] }
  | { error: string };

async function fetchItems(
  tabId: number,
  orderId: string,
  summaryResp:
    | { items: RawItem[]; subtotalCents: number; refund: ScrapedOrder["refund"] }
    | { requiresItemmod: true; subtotalCents: number; refund: ScrapedOrder["refund"] },
): Promise<{ items: RawItem[]; refund: ScrapedOrder["refund"] } | { error: string }> {
  if (!("requiresItemmod" in summaryResp)) {
    return { items: summaryResp.items, refund: summaryResp.refund };
  }

  await navigateTab(tabId, itemmodUrl(orderId));
  const itemmodResp = (await sendToTab(tabId, {
    type: "SCRAPE_ITEMS",
  })) as ItemmodResponse;
  if ("error" in itemmodResp) {
    return { error: amazonErrorMessage(itemmodResp.error) };
  }
  // Prefer itemmod's refund (has per-item markers) over the summary page's
  // when both exist. They should be equivalent but itemmod is authoritative.
  return { items: itemmodResp.items, refund: itemmodResp.refund ?? summaryResp.refund };
}

async function scrapeOrderItems(
  tabId: number,
  orderId: string,
): Promise<
  | { items: ScrapedItem[]; subtotalCents: number; refund: ScrapedOrder["refund"] }
  | { error: string }
> {
  await navigateTab(tabId, orderDetailUrl(orderId));

  const summaryResp = (await sendToTab(tabId, {
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
        refundedAmountCents: raw.refundedAmountCents,
      }),
    ),
    subtotalCents: summaryResp.subtotalCents,
    refund: itemsResp.refund,
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
