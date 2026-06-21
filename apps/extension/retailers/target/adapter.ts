// apps/extension/retailers/target/adapter.ts
import type {
  RetailerAdapter, PayeeMapping, ScrapedOrder, YnabCharge,
} from "@/lib/types";
import {
  matchByAmountAndDate, cutoffDateFor, NO_MATCH_REASON, READ_FAILED_REASON, THREE_DAYS_MS,
} from "@/lib/matcher";
import { openRetailerTab, navigateTab, sendToTab } from "@/background/tabs";
import {
  ordersUrl, orderInvoicesUrl, invoiceDetailUrl, orderDetailUrl,
} from "@/retailers/target/selectors";
import {
  buildPurchaseOrder, buildRefundOrder, cardPaymentCandidates, type TargetCandidate,
} from "@/retailers/target/builders";
import type {
  RawTargetOrder, RawTargetInvoice, RawTargetInvoiceDetail,
} from "@/retailers/target/scraper";

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

function send<T>(tabId: number, type: string): Promise<T> {
  return sendToTab<T>(tabId, { type });
}

/** Thrown when a gated page (invoice / invoice-detail / order-image) redirected
 *  to Target's step-up sign-in. One step-up elevates the whole session, so we
 *  bail the entire walk rather than retry per page, and the adapter converts it
 *  into a single `step_up` block. Propagated past local catches the way the
 *  abort signal is (see the `instanceof` re-throws below). */
export class StepUpRequired extends Error {
  /** The gated page whose load triggered the challenge — surfaced as the
   *  block's `url` so the "Open Target" button lands on the re-auth prompt
   *  rather than the soft-tier orders list. */
  constructor(readonly url?: string) {
    super("step_up_required");
    this.name = "StepUpRequired";
  }
}

/**
 * Unwrap a content-script scrape response. The content script returns the
 * payload, or `{ error: "auth_required" }` when the page 302'd to Target's
 * step-up sign-in (any gated page — invoices, invoice detail, or order images).
 * Turn that into a StepUpRequired bail; turn any other error shape into a thrown
 * Error so a malformed response degrades the order instead of becoming
 * `undefined` and crashing downstream (e.g. `undefined.filter`).
 *
 * `gatedUrl` is the page we just navigated to — carried onto the StepUpRequired
 * so the block can point "Open Target" at the page that actually challenges.
 */
export function unwrap<T>(resp: T | { error: string }, gatedUrl?: string): T {
  if (resp && typeof resp === "object" && "error" in resp) {
    const { error } = resp as { error: string };
    if (error === "auth_required") throw new StepUpRequired(gatedUrl);
    throw new Error(`Target scrape error: ${error}`);
  }
  return resp as T;
}

/**
 * Run one page read, retrying it once on failure. A failed/hung load or a
 * frozen parser usually recovers on a fresh navigation, so one cheap retry
 * absorbs transient blips. (Cancellation is handled by the loop-level
 * `signal.throwIfAborted()` calls, which sit outside every read.)
 */
export async function readWithRetry<T>(label: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    // A step-up won't clear on retry (the whole session is gated) — propagate
    // it so the adapter can bail the walk to a single sign-in block.
    if (err instanceof StepUpRequired) throw err;
    console.warn(`[target] ${label} failed; retrying once`, err);
    return await read();
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
      const auth = await send<{ authenticated: boolean } | { error: string }>(tabId, "CHECK_AUTH");
      if ("error" in auth || !auth.authenticated) {
        // Signed out — surface a sign-in wall. The resolution card foregrounds
        // the tab on user action; we no longer pop it here mid-sync.
        return { matched: [], unmatched: [], blocked: { reason: "signed_out", charges } };
      }

      // Phase 1: walk the orders list (paginate Load more) until past cutoff.
      const orders = await collectOrders(tabId, charges, maxPages, signal);

      // Phase 2: for orders that could contain a still-unmatched charge, read
      // the invoices list and match charges to invoice TOTALS (single-card
      // invoices). The invoice-list cache lets Phase 3 reuse it without
      // re-fetching.
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
          invoices = await readWithRetry(`invoices ${order.orderId}`, async () => {
            const url = orderInvoicesUrl(order.orderId);
            await navigateTab(tabId, url);
            return unwrap(
              await send<{ invoices: RawTargetInvoice[] } | { error: string }>(tabId, "SCRAPE_INVOICES_LIST"),
              url,
            ).invoices;
          });
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
              detail = await readWithRetry(`invoice detail ${orderId}/${inv.invoiceId}`, async () => {
                const url = invoiceDetailUrl(orderId, inv.invoiceId);
                await navigateTab(tabId, url);
                return unwrap(
                  await send<{ detail: RawTargetInvoiceDetail } | { error: string }>(tabId, "SCRAPE_INVOICE_DETAIL"),
                  url,
                ).detail;
              });
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
          }
        }
      }

      // Phase 4: assemble one ScrapedOrder per matched invoice.
      const detailFailures: { charge: YnabCharge; reason: string }[] = [];
      const imageCache = new Map<string, Record<string, string>>();

      for (let i = 0; i < matchedInvoices.length; i++) {
        signal?.throwIfAborted();
        onScrapeProgress?.({ index: i + 1, total: matchedInvoices.length });
        const mi = matchedInvoices[i];

        let detail: RawTargetInvoiceDetail;
        try {
          detail = mi.detail
            ?? (await readWithRetry(`detail ${mi.orderId}/${mi.invoiceId}`, () =>
              loadDetail(tabId, mi.orderId, mi.invoiceId)));
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
            imageMap = await readWithRetry(`images ${mi.orderId}`, async () => {
              const url = orderDetailUrl(mi.orderId);
              await navigateTab(tabId, url);
              return unwrap(
                await send<{ imageMap: Record<string, string> } | { error: string }>(tabId, "SCRAPE_ORDER_IMAGES"),
                url,
              ).imageMap;
            });
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

async function loadDetail(
  tabId: number, orderId: string, invoiceId: string,
): Promise<RawTargetInvoiceDetail> {
  const url = invoiceDetailUrl(orderId, invoiceId);
  await navigateTab(tabId, url);
  const { detail } = unwrap(
    await send<{ detail: RawTargetInvoiceDetail } | { error: string }>(tabId, "SCRAPE_INVOICE_DETAIL"),
    url,
  );
  return detail;
}

async function collectOrders(
  tabId: number,
  charges: YnabCharge[],
  maxPages: number,
  signal?: AbortSignal,
): Promise<RawTargetOrder[]> {
  const cutoff = cutoffDateFor(charges);
  let orders: RawTargetOrder[] = [];
  for (let page = 0; page < maxPages; page++) {
    signal?.throwIfAborted();
    const { orders: cur } = unwrap(
      await send<{ orders: RawTargetOrder[] } | { error: string }>(tabId, "SCRAPE_ORDERS_LIST"),
    );
    orders = cur; // Load more appends, so each scrape returns the cumulative list
    const oldest = orders.reduce(
      (min, o) => (o.date && o.date < min ? o.date : min),
      orders[0]?.date ?? "9999-12-31",
    );
    if (oldest < cutoff) break;
    // "Load more" is an in-page XHR that appends rows — it does NOT navigate the
    // tab, so (unlike Amazon's pager) there's no content-script teardown to
    // tolerate and no waitForTabLoad needed after it.
    const { hasNext } = unwrap(await send<{ hasNext: boolean } | { error: string }>(tabId, "LOAD_MORE"));
    if (!hasNext) break;
  }
  return orders;
}
