import type {
  RetailerAdapter,
  ScrapedOrder,
  ScrapedItem,
  ScrapeProgress,
  YnabCharge,
  PayeeMapping,
} from "@/lib/types";
import { assignByAmountAndDate, cutoffDateFor, NO_MATCH_REASON, READ_FAILED_REASON } from "@/lib/matcher";
import { dlog, isDebugEnabled } from "@/lib/debug";
import { openRetailerTab, awaitPageResult, clearBufferedPageResult } from "@/background/tabs";
import { orderDetailUrl, TRANSACTIONS_URL } from "@/retailers/amazon/selectors";
import type { AmazonPageResult } from "@/retailers/amazon/page";
import type { RawTransaction, RawItem } from "@/retailers/amazon/scraper";
import { groupBy } from "remeda";

const PAYEES: PayeeMapping[] = [
  { pattern: /amazon prime/i, retailer: "amazon", strategy: "skip" },
  { pattern: /amazon tips/i, retailer: "amazon", strategy: "skip" },
  { pattern: /amazon|amzn mktp/i, retailer: "amazon", strategy: "scrape" },
];

export const amazonAdapter: RetailerAdapter = {
  id: "amazon",
  payees: PAYEES,
  startUrl: TRANSACTIONS_URL,

  async scrapeMatchedOrders(charges, options) {
    const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES;
    const onScrapeProgress = options?.onScrapeProgress;
    const signal = options?.signal;

    const tabResult = await openRetailerTab(TRANSACTIONS_URL);
    if (!tabResult) {
      return {
        matched: [],
        unmatched: charges.map((c) => ({ charge: c, reason: "Failed to open Amazon tab" })),
      };
    }
    const { tabId, weOpenedTab } = tabResult;

    try {
      // Phase 1: paginate the transactions list and match charges to order-linked
      // rows. A `login` result here means the session is signed out.
      const { matchedPairs, unmatchedCharges, signedOut } = await paginateAndMatch(
        tabId,
        charges,
        maxPages,
        onScrapeProgress,
      );
      if (signedOut) {
        return { matched: [], unmatched: [], blocked: { reason: "signed_out", charges } };
      }

      // Phase 2: one detail-page scrape per matched order.
      const byOrderId = groupBy(matchedPairs, ([_charge, raw]) => raw.orderId!);
      const orderEntries = Object.entries(byOrderId);
      const totalOrders = orderEntries.length;

      const matchedOrders: { order: ScrapedOrder; charges: YnabCharge[] }[] = [];
      const detailFailures: { charge: YnabCharge; reason: string }[] = [];

      for (let i = 0; i < totalOrders; i++) {
        signal?.throwIfAborted();
        const [orderId, pairs] = orderEntries[i];
        // Emit progress BEFORE the scrape so the UI shows "Scraping order N of T"
        // while N is in flight, not after it lands.
        onScrapeProgress?.({ phase: "scraping", index: i + 1, total: totalOrders });

        let result: ScrapeOrderResult;
        try {
          result = await scrapeOrderWithRetry(tabId, orderId);
        } catch (err) {
          // A page that never reached the expected state (awaitPageResult timed
          // out). Isolate it to this order; its charges stay unpersisted so a
          // re-run reattempts them.
          console.warn(`[amazon] couldn't read order ${orderId}`, err);
          for (const [charge] of pairs) detailFailures.push({ charge, reason: READ_FAILED_REASON });
          continue;
        }

        if (result.kind === "signed_out") {
          // The session dropped mid-walk. Keep what we assembled; everything not
          // yet matched becomes one sign-in wall (a re-run reads the rest).
          const done = new Set(matchedOrders.flatMap((m) => m.charges.map((c) => c.ynabTransactionId)));
          const blockedCharges = charges.filter((c) => !done.has(c.ynabTransactionId));
          return { matched: matchedOrders, unmatched: [], blocked: { reason: "signed_out", charges: blockedCharges } };
        }
        if (result.kind === "error") {
          console.warn(`[amazon] order ${orderId} not scraped: ${result.reason}`);
          for (const [charge] of pairs) detailFailures.push({ charge, reason: result.reason });
          continue;
        }

        matchedOrders.push({
          order: {
            retailer: "amazon",
            orderId,
            items: result.items,
            displayedItemsSubtotalCents: result.subtotalCents,
            refund: result.refund,
          },
          charges: pairs.map(([charge]) => charge),
        });
      }

      const allUnmatched = [
        ...unmatchedCharges.map((c) => ({ charge: c, reason: NO_MATCH_REASON })),
        ...detailFailures,
      ];
      console.info(`[amazon] detail scrape: ${matchedOrders.length} of ${totalOrders} orders OK, ${detailFailures.length} failed`);
      return { matched: matchedOrders, unmatched: allUnmatched };
    } finally {
      if (weOpenedTab) {
        browser.tabs.remove(tabId).catch(() => {});
      }
    }
  },
};

// ----------------------------------------------------------------------------
// Internal: transactions-list pagination + matching
// ----------------------------------------------------------------------------

/** Default pagination cap for callers that don't pass `options.maxPages`.
 *  Sync's natural cutoff (`cutoffDateFor`) short-circuits well before this. */
const DEFAULT_MAX_PAGES = 10;

interface PaginateResult {
  matchedPairs: [YnabCharge, RawTransaction][];
  unmatchedCharges: YnabCharge[];
  /** The transactions list redirected to sign-in — nothing is readable. */
  signedOut?: boolean;
}

async function paginateAndMatch(
  tabId: number,
  charges: YnabCharge[],
  maxPages: number,
  onProgress?: (event: ScrapeProgress) => void,
): Promise<PaginateResult> {
  // This walk state is foundational, not a cleanup target: paginating the
  // transactions list is a stateful loop over a tab. `candidates` carries
  // order-linked rows forward across pages, `remaining` shrinks as charges match
  // (and stops the walk once empty), and `allMatched` accumulates the pairs — all
  // updated across sequential, side-effecting page turns.
  const cutoffIso = cutoffDateFor(charges);
  let candidates: RawTransaction[] = [];
  let remaining = [...charges];
  let allMatched: [YnabCharge, RawTransaction][] = [];

  // Drop anything left in the buffer by a previous run on this (reused, never-
  // closed) tab so a stale page can't be read as the current one. Then kick the
  // tab into describing itself and read the first page. Nothing is awaited from
  // the trigger — the page answers with a PAGE_RESULT, which is what we wait on.
  clearBufferedPageResult(tabId);
  describe(tabId);
  let page = await awaitTransactionsPage(tabId, null);
  let pagesWalked = 0;

  for (let i = 0; i < maxPages; i++) {
    // The page never reached a readable state in time — stop, keeping whatever
    // we already matched (a re-run reattempts the rest) rather than throwing it
    // all away. Log it: a premature stop here is a likely cause of under-matching.
    if (!page) {
      console.warn(`[amazon] pagination stopped after ${pagesWalked} page(s): next page did not arrive in time`);
      break;
    }
    // The await predicate only resolves to a transactions or login page; anything
    // else (login included) means the list isn't readable — surface signed out.
    if (page.pageKind !== "transactions") {
      return { matchedPairs: allMatched, unmatchedCharges: remaining, signedOut: true };
    }
    pagesWalked++;

    // Only order-linked rows are matchable (we need the orderId to scrape the
    // detail page). Assign charges to them 1:1, resolving balanced ambiguity.
    const allCandidates = [...candidates, ...page.transactions];
    const eligible = allCandidates.filter((c) => c.orderId);
    const assignments = assignByAmountAndDate(remaining, eligible);

    const matchedThisPage: [YnabCharge, RawTransaction][] = [];
    const stillUnmatched: YnabCharge[] = [];
    const matchedRaws = new Set<RawTransaction>();
    remaining.forEach((charge, idx) => {
      const j = assignments[idx];
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

    // Debug: every parsed row (with orderId + isRefund) plus the charges still
    // unmatched after this page. Refund charges that never match show up here —
    // and the rows reveal why (a refund row with orderId:null can't be matched;
    // a date-skewed refund falls outside the ±3-day window). Guarded so the
    // payload isn't built in shipped builds.
    if (isDebugEnabled()) {
      dlog("amazon", `transactions page ${pagesWalked}`, {
        rows: page.transactions.map((t) => ({
          date: t.date,
          amountCents: t.amountCents,
          isRefund: t.isRefund,
          orderId: t.orderId,
        })),
        stillUnmatched: remaining.map((c) => ({
          id: c.ynabTransactionId,
          date: c.date,
          amountCents: c.amountCents,
          isRefund: c.isRefund,
        })),
      });
    }

    // Liveness during the list walk: order rows matched so far. No denominator
    // yet — the bar just shows we're working and on which retailer, not a
    // fraction.
    onProgress?.({ phase: "listing", count: allMatched.length });

    if (remaining.length === 0) break;
    if (page.transactions.length === 0) break;
    const oldestOnPage = page.transactions.reduce(
      (min, t) => (t.date < min ? t.date : min),
      page.transactions[0].date,
    );
    if (oldestOnPage < cutoffIso) break;
    if (!page.hasNext) break;

    // Turn the pager and wait for the next page to announce itself. In Chrome
    // that's an in-place AJAX swap; in Firefox the click reloads the page and a
    // fresh content script describes it. Either way we just await the next
    // transactions result whose fingerprint differs (or a login wall).
    const prevFingerprint = page.fingerprint;
    turnPage(tabId);
    // Wait for the next page (AJAX swap in Chrome, full reload in Firefox) at the
    // default timeout. We deliberately don't cap it tighter: dropping later pages
    // silently is worse than a rare slow turn, and a genuine "no next page" is
    // caught by the !page.hasNext break above before we ever turn.
    page = await awaitTransactionsPage(tabId, prevFingerprint);
  }

  console.info(`[amazon] paginated ${pagesWalked} page(s); matched ${allMatched.length} order rows, ${remaining.length} charges unmatched`);
  return { matchedPairs: allMatched, unmatchedCharges: remaining };
}

/**
 * Await the next transactions page (or a login wall). `prevFingerprint` guards
 * against reading the same page twice: pass the page we just processed so a
 * re-render is ignored and only a real page turn (or login) resolves; pass null
 * for the first read. Returns null on timeout — the caller keeps partial matches
 * instead of throwing the batch away.
 */
async function awaitTransactionsPage(
  tabId: number,
  prevFingerprint: string | null,
): Promise<AmazonPageResult | null> {
  try {
    return await awaitPageResult<AmazonPageResult>(
      tabId,
      (r) =>
        r.pageKind === "login" ||
        (r.pageKind === "transactions" && (prevFingerprint === null || r.fingerprint !== prevFingerprint)),
    );
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Internal: detail-page item scrape
// ----------------------------------------------------------------------------

type ScrapeOrderResult =
  | { kind: "ok"; items: ScrapedItem[]; subtotalCents: number; refund: ScrapedOrder["refund"] }
  | { kind: "error"; reason: string }
  | { kind: "signed_out" };

/**
 * Read an order, retrying once on a transient failure. A detail page that didn't
 * paint in time (no subtotal yet, or an await timeout) usually succeeds on a
 * fresh navigation, so one cheap retry absorbs the run-to-run flakiness that
 * otherwise drops a few orders. A `signed_out` result and a successful read both
 * return immediately — only "error"/throw is worth retrying.
 */
async function scrapeOrderWithRetry(tabId: number, orderId: string): Promise<ScrapeOrderResult> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const last = attempt === 2;
    try {
      const result = await scrapeOrder(tabId, orderId);
      if (result.kind !== "error" || last) return result;
      console.warn(`[amazon] order ${orderId} read failed (${result.reason}); retrying`);
    } catch (err) {
      if (last) throw err;
      console.warn(`[amazon] order ${orderId} read threw; retrying`, err);
    }
  }
  // Unreachable: the last attempt either returns or throws above.
  return { kind: "error", reason: READ_FAILED_REASON };
}

async function scrapeOrder(tabId: number, orderId: string): Promise<ScrapeOrderResult> {
  // Each detail scrape navigates to a DIFFERENT URL than the tab is currently on
  // (we arrive from the transactions list or another order), so the navigation
  // always reloads the page and the fresh content script self-describes — no
  // explicit DESCRIBE needed here, unlike the first transactions read.
  navigate(tabId, orderDetailUrl(orderId));
  const summary = await awaitPageResult<AmazonPageResult>(
    tabId,
    (r) => r.pageKind === "login" || (r.pageKind === "order-summary" && r.orderId === orderId),
  );
  if (summary.pageKind === "login") return { kind: "signed_out" };
  if (summary.pageKind !== "order-summary") return { kind: "error", reason: READ_FAILED_REASON };
  if (summary.subtotalCents === null) return { kind: "error", reason: amazonErrorMessage("missing_subtotal") };

  // The order-details page carries the items inline — grocery (itemmod rows) and
  // regular alike — so the content script's order-summary result is complete.
  if (summary.items.length === 0) return { kind: "error", reason: "Failed to scrape order items" };

  return {
    kind: "ok",
    items: summary.items.map(toScrapedItem),
    subtotalCents: summary.subtotalCents,
    refund: summary.refund,
  };
}

function toScrapedItem(raw: RawItem): ScrapedItem {
  return {
    productId: raw.productId,
    title: raw.title,
    imageUrl: raw.imageUrl,
    unitPriceCents: raw.priceCents,
    quantity: raw.quantity,
    refundedAmountCents: raw.refundedAmountCents,
  };
}

/** Fire-and-forget triggers — the page answers with a PAGE_RESULT, not a reply. */
function navigate(tabId: number, url: string): void {
  browser.tabs.update(tabId, { url }).catch(() => {});
}
function describe(tabId: number): void {
  browser.tabs.sendMessage(tabId, { type: "DESCRIBE" }).catch(() => {});
}
function turnPage(tabId: number): void {
  browser.tabs.sendMessage(tabId, { type: "NEXT_PAGE" }).catch(() => {});
}

/**
 * User-readable copy for a content-script error token. (Auth is no longer a
 * token — a signed-out/step-up page is reported as a `login` page result.)
 */
function amazonErrorMessage(token: string): string {
  switch (token) {
    case "missing_subtotal":
      return "Couldn't find Amazon's items subtotal on the page — the page layout may have changed. Try resyncing, or categorize manually in YNAB.";
    default:
      return token;
  }
}
