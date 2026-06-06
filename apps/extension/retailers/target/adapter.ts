// apps/extension/retailers/target/adapter.ts
import type {
  RetailerAdapter, PayeeMapping, ScrapedOrder, YnabCharge,
} from "@/lib/types";
import { matchByAmountAndDate, cutoffDateFor, NO_MATCH_REASON, THREE_DAYS_MS } from "@/lib/matcher";
import { openRetailerTab, navigateTab } from "@/background/tabs";
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
  return browser.tabs.sendMessage(tabId, { type }) as Promise<T>;
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

    try {
      const auth = await send<{ authenticated: boolean } | { error: string }>(tabId, "CHECK_AUTH");
      if ("error" in auth || !auth.authenticated) {
        await browser.tabs.update(tabId, { active: true });
        return {
          matched: [],
          unmatched: charges.map((c) => ({ charge: c, reason: "Target auth required" })),
        };
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

        await navigateTab(tabId, orderInvoicesUrl(order.orderId));
        const { invoices } = await send<{ invoices: RawTargetInvoice[] }>(tabId, "SCRAPE_INVOICES_LIST");
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

            await navigateTab(tabId, invoiceDetailUrl(orderId, inv.invoiceId));
            const { detail } = await send<{ detail: RawTargetInvoiceDetail }>(tabId, "SCRAPE_INVOICE_DETAIL");
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
      const matched: { order: ScrapedOrder; charges: YnabCharge[] }[] = [];
      const detailFailures: { charge: YnabCharge; reason: string }[] = [];
      const imageCache = new Map<string, Record<string, string>>();

      for (let i = 0; i < matchedInvoices.length; i++) {
        signal?.throwIfAborted();
        onScrapeProgress?.({ index: i + 1, total: matchedInvoices.length });
        const mi = matchedInvoices[i];

        const detail = mi.detail ?? (await loadDetail(tabId, mi.orderId, mi.invoiceId));
        if (detail.items.length === 0) {
          detailFailures.push({ charge: mi.charge, reason: "Target invoice had no parseable items" });
          continue;
        }

        let imageMap = imageCache.get(mi.orderId);
        if (!imageMap) {
          await navigateTab(tabId, orderDetailUrl(mi.orderId));
          const res = await send<{ imageMap: Record<string, string> }>(tabId, "SCRAPE_ORDER_IMAGES");
          imageMap = res.imageMap;
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
  await navigateTab(tabId, invoiceDetailUrl(orderId, invoiceId));
  const { detail } = await send<{ detail: RawTargetInvoiceDetail }>(tabId, "SCRAPE_INVOICE_DETAIL");
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
    const { orders: cur } = await send<{ orders: RawTargetOrder[] }>(tabId, "SCRAPE_ORDERS_LIST");
    orders = cur; // Load more appends, so each scrape returns the cumulative list
    const oldest = orders.reduce(
      (min, o) => (o.date && o.date < min ? o.date : min),
      orders[0]?.date ?? "9999-12-31",
    );
    if (oldest < cutoff) break;
    const { hasNext } = await send<{ hasNext: boolean }>(tabId, "LOAD_MORE");
    if (!hasNext) break;
  }
  return orders;
}
