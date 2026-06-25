// apps/extension/retailers/target/adapter.ts
import type {
  RetailerAdapter, PayeeMapping, ScrapedOrder, ScrapeProgress, YnabCharge,
} from "@/lib/types";
import {
  matchByAmountAndDate, cutoffDateFor, NO_MATCH_REASON, READ_FAILED_REASON, THREE_DAYS_MS,
} from "@/lib/matcher";
import { openRetailerTab, awaitPageResult, clearBufferedPageResult } from "@/background/tabs";
import {
  ordersUrl, orderInvoicesUrl, invoiceDetailUrl, orderDetailUrl,
} from "@/retailers/target/selectors";
import {
  buildPurchaseOrder, buildRefundOrder, cardPaymentCandidates, type TargetCandidate,
} from "@/retailers/target/builders";
import type {
  RawTargetOrder, RawTargetInvoice, RawTargetInvoiceDetail,
} from "@/retailers/target/scraper";
import type { TargetPageResult } from "@/retailers/target/page";

const PAYEES: PayeeMapping[] = [
  { pattern: /target|tgt\b/i, retailer: "target", strategy: "scrape" },
];

const DEFAULT_MAX_PAGES = 10;

const DAY_MS = 24 * 60 * 60 * 1000;
// An order's card charge posts on/after it was placed. Allow a charge from a
// few days before (date-parse slop / auth-vs-placed timing) to well after
// (backordered/late shipments are billed when they ship).
const PREFILTER_BEFORE_MS = 7 * DAY_MS;
const PREFILTER_AFTER_MS = 45 * DAY_MS;

/** Thrown when a gated page (orders list mid-walk, invoices, invoice detail, or
 *  order detail) redirected to Target's step-up sign-in — surfaced to the content
 *  script as a `login` page result. One step-up elevates the whole session, so we
 *  bail the entire walk rather than retry per page, and the adapter converts it
 *  into a single `step_up` block. Propagated past local catches via `instanceof`. */
export class StepUpRequired extends Error {
  /** The gated page whose load triggered the challenge — surfaced as the block's
   *  `url` so "Open Target" lands on the re-auth prompt rather than the soft-tier
   *  orders list. */
  constructor(readonly url?: string) {
    super("step_up_required");
    this.name = "StepUpRequired";
  }
}

/**
 * Whether an order could plausibly contain one of the still-unmatched charges,
 * used to decide if it's worth opening the order's invoices page. A single
 * invoice/charge can't exceed the order total. A *purchase* posts within a
 * generous window of the placed date; a *refund* posts whenever a return is
 * processed — arbitrarily long after — so refunds are not upper-bounded on
 * date. Conservative otherwise (unparsed date or total → don't filter out).
 */
export function orderMightMatch(order: RawTargetOrder, charges: YnabCharge[]): boolean {
  const orderTime = order.date ? new Date(order.date).getTime() : null;
  return charges.some((c) => {
    if (order.orderTotalCents !== null && c.amountCents > order.orderTotalCents) return false;
    if (orderTime === null) return true;
    const delta = new Date(c.date).getTime() - orderTime;
    if (delta < -PREFILTER_BEFORE_MS) return false;
    return c.isRefund || delta <= PREFILTER_AFTER_MS;
  });
}

/**
 * Whether an invoice is worth opening in Phase 3 to check its card payment
 * lines. The card-billed portion can't exceed the invoice total, and the
 * invoice date sits within the match window of the charge. Same isRefund sign.
 */
export function invoiceMightSplitMatch(inv: RawTargetInvoice, charges: YnabCharge[]): boolean {
  const invTime = new Date(inv.date).getTime();
  return charges.some(
    (c) =>
      c.isRefund === inv.isRefund &&
      c.amountCents <= inv.amountCents &&
      Math.abs(new Date(c.date).getTime() - invTime) <= THREE_DAYS_MS,
  );
}

export const targetAdapter: RetailerAdapter = {
  id: "target",
  payees: PAYEES,
  startUrl: ordersUrl(),

  async scrapeMatchedOrders(charges, options) {
    const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES;
    const signal = options?.signal;
    const onScrapeProgress = options?.onScrapeProgress;

    const tabResult = await openRetailerTab(ordersUrl());
    if (!tabResult) {
      return {
        matched: [],
        unmatched: charges.map((c) => ({ charge: c, reason: "Failed to open Target tab" })),
      };
    }
    const { tabId, weOpenedTab } = tabResult;

    // Hoisted so the step-up catch can return whatever was assembled before the
    // walk hit a sign-in wall (partial results survive).
    const matched: { order: ScrapedOrder; charges: YnabCharge[] }[] = [];

    try {
      // First read: the orders list. A `login` (or a list that never described)
      // means we can't read anything — surface a sign-in wall.
      clearBufferedPageResult(tabId);
      describe(tabId);
      const first = await awaitOrders(tabId, null);
      if (!first || first.pageKind !== "orders") {
        // login, or the list never described in time — nothing is readable.
        return { matched: [], unmatched: [], blocked: { reason: "signed_out", charges } };
      }

      // Phase 1: walk the orders list (paginate Load more) until past cutoff.
      const orders = await collectOrders(tabId, first, charges, maxPages, signal, onScrapeProgress);
      console.info(`[target] phase 1: ${orders.length} orders in the window`);

      // Phase 2: for orders that could contain a still-unmatched charge, read the
      // invoices list and match charges to invoice TOTALS (single-card invoices).
      // The invoice-list cache lets Phase 3 reuse it without re-fetching.
      let remaining = [...charges];
      const matchedInvoices: MatchedInvoice[] = [];
      const consumedInvoices = new Set<string>(); // `${orderId}/${invoiceId}`
      const invoiceListCache = new Map<string, RawTargetInvoice[]>(); // orderId → invoices

      for (const order of orders) {
        if (remaining.length === 0) break;
        signal?.throwIfAborted();
        if (!orderMightMatch(order, remaining)) continue;

        let invoices: RawTargetInvoice[];
        try {
          invoices = await readWithRetry(`invoices ${order.orderId}`, () =>
            readInvoices(tabId, order.orderId));
        } catch (err) {
          if (err instanceof StepUpRequired) throw err;
          // Couldn't read this order's invoices — skip it; its charges stay
          // unmatched and a re-run will reattempt.
          console.warn(`[target] skipping order ${order.orderId}: invoices unreadable`, err);
          continue;
        }
        invoiceListCache.set(order.orderId, invoices);

        const stillRemaining: YnabCharge[] = [];
        for (const charge of remaining) {
          const cand = invoices.filter(
            (inv) => inv.isRefund === charge.isRefund
              && !consumedInvoices.has(`${order.orderId}/${inv.invoiceId}`),
          );
          const hit = matchByAmountAndDate(charge.amountCents, charge.date, cand);
          if (hit) {
            consumedInvoices.add(`${order.orderId}/${hit.invoiceId}`);
            matchedInvoices.push({ orderId: order.orderId, invoiceId: hit.invoiceId, charge });
          } else {
            stillRemaining.push(charge);
          }
        }
        remaining = stillRemaining;
        // Liveness during the (long, per-order) invoice walk: charges matched
        // to an invoice so far. These become the detail-scrape total.
        onScrapeProgress?.({ phase: "matching", count: matchedInvoices.length });
      }

      // Phase 3: a still-unmatched charge may be a payment split (invoice total
      // != card-billed amount). Re-check the cached invoices, but only open the
      // detail page for invoices that could actually contain a remaining charge
      // (total >= charge, date in window) — otherwise this fans out to every
      // invoice of every order whenever an in-store charge stays unmatched.
      if (remaining.length > 0) {
        for (const [orderId, invoices] of invoiceListCache) {
          if (remaining.length === 0) break;
          signal?.throwIfAborted();

          for (const inv of invoices) {
            if (remaining.length === 0) break;
            if (consumedInvoices.has(`${orderId}/${inv.invoiceId}`)) continue;
            if (!invoiceMightSplitMatch(inv, remaining)) continue;

            let detail: RawTargetInvoiceDetail;
            try {
              detail = await readWithRetry(`invoice detail ${orderId}/${inv.invoiceId}`, () =>
                readInvoiceDetail(tabId, orderId, inv.invoiceId));
            } catch (err) {
              if (err instanceof StepUpRequired) throw err;
              // Couldn't read this invoice's detail — skip it; the charge stays
              // unmatched and a re-run will reattempt.
              console.warn(`[target] skipping invoice ${orderId}/${inv.invoiceId}: detail unreadable`, err);
              continue;
            }
            const candidates: TargetCandidate[] = cardPaymentCandidates(orderId, inv.invoiceId, inv.date, detail);

            const stillRemaining: YnabCharge[] = [];
            for (const charge of remaining) {
              const cand = candidates.filter((c) => c.isRefund === charge.isRefund);
              const hit = matchByAmountAndDate(charge.amountCents, charge.date, cand);
              if (hit) {
                consumedInvoices.add(`${orderId}/${hit.invoiceId}`);
                matchedInvoices.push({ orderId, invoiceId: hit.invoiceId, charge, detail });
              } else {
                stillRemaining.push(charge);
              }
            }
            remaining = stillRemaining;
            onScrapeProgress?.({ phase: "matching", count: matchedInvoices.length });
          }
        }
      }

      // Phase 4: assemble one ScrapedOrder per matched invoice.
      const detailFailures: { charge: YnabCharge; reason: string }[] = [];
      const imageCache = new Map<string, Record<string, string>>();

      for (let i = 0; i < matchedInvoices.length; i++) {
        signal?.throwIfAborted();
        onScrapeProgress?.({ phase: "scraping", index: i + 1, total: matchedInvoices.length });
        const mi = matchedInvoices[i];

        let detail: RawTargetInvoiceDetail;
        try {
          detail = mi.detail
            ?? (await readWithRetry(`detail ${mi.orderId}/${mi.invoiceId}`, () =>
              readInvoiceDetail(tabId, mi.orderId, mi.invoiceId)));
        } catch (err) {
          if (err instanceof StepUpRequired) throw err;
          // This charge matched an invoice but its detail page couldn't be read —
          // surface it as a read failure (counts toward "couldn't be read") so a
          // re-run reattempts it, rather than tanking the whole scrape.
          console.warn(`[target] couldn't read detail for ${mi.orderId}/${mi.invoiceId}`, err);
          detailFailures.push({ charge: mi.charge, reason: READ_FAILED_REASON });
          continue;
        }
        if (detail.items.length === 0) {
          detailFailures.push({ charge: mi.charge, reason: "Target invoice had no parseable items" });
          continue;
        }

        let imageMap = imageCache.get(mi.orderId);
        if (!imageMap) {
          try {
            imageMap = await readWithRetry(`images ${mi.orderId}`, () =>
              readOrderImages(tabId, mi.orderId));
          } catch (err) {
            if (err instanceof StepUpRequired) throw err;
            console.warn(`[target] couldn't read order images for ${mi.orderId}`, err);
            detailFailures.push({ charge: mi.charge, reason: READ_FAILED_REASON });
            continue;
          }
          imageCache.set(mi.orderId, imageMap);
        }

        const order = detail.isRefund
          ? buildRefundOrder(mi.orderId, detail, mi.charge, imageMap)
          : buildPurchaseOrder(mi.orderId, detail, imageMap);
        matched.push({ order, charges: [mi.charge] });
      }

      const unmatched = [
        ...remaining.map((c) => ({ charge: c, reason: NO_MATCH_REASON })),
        ...detailFailures,
      ];
      console.info(`[target] done: ${matched.length} matched, ${detailFailures.length} read-failed of ${matchedInvoices.length} matched invoices`);
      return { matched, unmatched };
    } catch (err) {
      if (err instanceof StepUpRequired) {
        // The walk hit Target's step-up sign-in. Keep whatever we assembled
        // before the wall; everything not yet matched becomes one sign-in block.
        // One step-up elevates the session, so a re-sync after sign-in reads the
        // rest (genuinely unmatchable charges then fall to no_match).
        const done = new Set(matched.flatMap((m) => m.charges.map((c) => c.ynabTransactionId)));
        const blockedCharges = charges.filter((c) => !done.has(c.ynabTransactionId));
        return {
          matched,
          unmatched: [],
          blocked: {
            reason: "step_up",
            charges: blockedCharges,
            ...(err.url ? { url: err.url } : {}),
          },
        };
      }
      throw err;
    } finally {
      if (weOpenedTab) browser.tabs.remove(tabId).catch(() => {});
    }
  },
};

interface MatchedInvoice {
  orderId: string;
  invoiceId: string;
  charge: YnabCharge;
  detail?: RawTargetInvoiceDetail; // present when matched in Phase 3
}

// ----------------------------------------------------------------------------
// Internal: page reads (navigate → await the page's result)
// ----------------------------------------------------------------------------

/**
 * Run one page read, retrying it once on failure. A failed/hung load usually
 * recovers on a fresh navigation, so one cheap retry absorbs transient blips. A
 * step-up won't clear on retry (the whole session is gated), so it propagates.
 * (Cancellation is handled by the loop-level `signal.throwIfAborted()` calls.)
 */
export async function readWithRetry<T>(label: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof StepUpRequired) throw err;
    console.warn(`[target] ${label} failed; retrying once`, err);
    return await read();
  }
}

async function readInvoices(tabId: number, orderId: string): Promise<RawTargetInvoice[]> {
  const url = orderInvoicesUrl(orderId);
  navigate(tabId, url);
  const r = await awaitPageResult<TargetPageResult>(
    tabId,
    (x) => x.pageKind === "login" || (x.pageKind === "invoices" && x.orderId === orderId),
  );
  if (r.pageKind === "login") throw new StepUpRequired(url);
  if (r.pageKind !== "invoices") throw new Error(`Target invoices ${orderId}: got ${r.pageKind}`);
  return r.invoices;
}

async function readInvoiceDetail(
  tabId: number, orderId: string, invoiceId: string,
): Promise<RawTargetInvoiceDetail> {
  const url = invoiceDetailUrl(orderId, invoiceId);
  navigate(tabId, url);
  const r = await awaitPageResult<TargetPageResult>(
    tabId,
    (x) =>
      x.pageKind === "login" ||
      (x.pageKind === "invoice-detail" && x.orderId === orderId && x.invoiceId === invoiceId),
  );
  if (r.pageKind === "login") throw new StepUpRequired(url);
  if (r.pageKind !== "invoice-detail") throw new Error(`Target invoice detail ${orderId}/${invoiceId}: got ${r.pageKind}`);
  return r.detail;
}

async function readOrderImages(tabId: number, orderId: string): Promise<Record<string, string>> {
  const url = orderDetailUrl(orderId);
  navigate(tabId, url);
  const r = await awaitPageResult<TargetPageResult>(
    tabId,
    (x) => x.pageKind === "login" || (x.pageKind === "order-images" && x.orderId === orderId),
  );
  if (r.pageKind === "login") throw new StepUpRequired(url);
  if (r.pageKind !== "order-images") throw new Error(`Target order images ${orderId}: got ${r.pageKind}`);
  return r.imageMap;
}

// ----------------------------------------------------------------------------
// Internal: orders-list pagination (Load more, in-page)
// ----------------------------------------------------------------------------

async function collectOrders(
  tabId: number,
  first: TargetPageResult & { pageKind: "orders" },
  charges: YnabCharge[],
  maxPages: number,
  signal?: AbortSignal,
  onProgress?: (event: ScrapeProgress) => void,
): Promise<RawTargetOrder[]> {
  const cutoff = cutoffDateFor(charges);
  let result: TargetPageResult | null = first;
  let orders: RawTargetOrder[] = first.orders;

  for (let page = 0; page < maxPages; page++) {
    signal?.throwIfAborted();
    if (!result) {
      // Load more fired but no larger list arrived in time — the most likely
      // cause of under-collecting. Logged so one run says why.
      console.warn(`[target] phase 1 stop: Load more produced no new orders (timeout) at ${orders.length}`);
      break;
    }
    if (result.pageKind !== "orders") break;
    orders = result.orders; // Load more appends, so each result is the cumulative list

    // Liveness during the list walk: orders collected so far (no denominator —
    // we stop on date cutoff, not a known count).
    onProgress?.({ phase: "listing", count: orders.length });

    // Seed with the max sentinel (not orders[0].date): Target returns "" for an
    // unparseable date, which sorts before every real date — seeding with it
    // would make `oldest` empty and halt pagination after the first page.
    const oldest = orders.reduce(
      (min, o) => (o.date && o.date < min ? o.date : min),
      "9999-12-31",
    );
    if (oldest < cutoff) {
      console.info(`[target] phase 1 stop: reached date cutoff at ${orders.length} orders`);
      break;
    }
    if (!result.hasMore) {
      console.info(`[target] phase 1 stop: no Load-more button at ${orders.length} orders`);
      break;
    }

    const prevFingerprint = result.fingerprint;
    console.info(`[target] Load more (have ${orders.length})`);
    loadMore(tabId);
    result = await awaitOrders(tabId, prevFingerprint);
    // A login here means a step-up fired mid-pagination — bail the walk so the
    // caller surfaces a single sign-in wall (keeping any partial matches).
    if (result?.pageKind === "login") throw new StepUpRequired(ordersUrl());
  }

  return orders;
}

/** Await the next orders list (or a login wall). `prevFingerprint` ignores a
 *  re-render of the same list so only a real Load-more growth resolves; pass null
 *  for the first read. Null on timeout — the caller keeps what it has. */
async function awaitOrders(
  tabId: number,
  prevFingerprint: string | null,
): Promise<TargetPageResult | null> {
  try {
    return await awaitPageResult<TargetPageResult>(
      tabId,
      (r) =>
        r.pageKind === "login" ||
        (r.pageKind === "orders" && (prevFingerprint === null || r.fingerprint !== prevFingerprint)),
    );
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Internal: fire-and-forget triggers — the page answers with a PAGE_RESULT.
// ----------------------------------------------------------------------------

function navigate(tabId: number, url: string): void {
  browser.tabs.update(tabId, { url }).catch(() => {});
}
function describe(tabId: number): void {
  browser.tabs.sendMessage(tabId, { type: "DESCRIBE" }).catch(() => {});
}
function loadMore(tabId: number): void {
  browser.tabs.sendMessage(tabId, { type: "LOAD_MORE" }).catch(() => {});
}
