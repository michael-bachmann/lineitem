// apps/extension/retailers/target/adapter.ts
import type {
  RetailerAdapter, PayeeMapping, ScrapedOrder, YnabCharge,
} from "@/lib/types";
import { matchByAmountAndDate, cutoffDateFor, NO_MATCH_REASON } from "@/lib/matcher";
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
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function send<T>(tabId: number, type: string): Promise<T> {
  return browser.tabs.sendMessage(tabId, { type }) as Promise<T>;
}

/** True when an order's date is within ±3 days of any charge still unmatched. */
function nearAnyCharge(orderDate: string, charges: YnabCharge[]): boolean {
  if (!orderDate) return true; // unparsed date → don't pre-filter it out
  const od = new Date(orderDate).getTime();
  return charges.some((c) => Math.abs(od - new Date(c.date).getTime()) <= THREE_DAYS_MS);
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

      // Phase 2: for orders near an unmatched charge, read their invoices list
      // and match charges to invoice TOTALS (handles single-card invoices).
      let remaining = [...charges];
      const matchedInvoices: MatchedInvoice[] = [];

      for (const order of orders) {
        if (remaining.length === 0) break;
        signal?.throwIfAborted();
        if (!nearAnyCharge(order.date, remaining)) continue;

        await navigateTab(tabId, orderInvoicesUrl(order.orderId));
        const { invoices } = await send<{ invoices: RawTargetInvoice[] }>(tabId, "SCRAPE_INVOICES_LIST");

        const stillRemaining: YnabCharge[] = [];
        for (const charge of remaining) {
          const cand = invoices.filter((inv) => inv.isRefund === charge.isRefund);
          const hit = matchByAmountAndDate(charge.amountCents, charge.date, cand);
          if (hit) matchedInvoices.push({ orderId: order.orderId, invoiceId: hit.invoiceId, charge });
          else stillRemaining.push(charge);
        }
        remaining = stillRemaining;
      }

      // Phase 3: for charges still unmatched, the invoice may be a payment
      // split (total != card amount). Re-read nearby invoices' DETAILS and
      // match on card payment-line amounts.
      if (remaining.length > 0) {
        for (const order of orders) {
          if (remaining.length === 0) break;
          signal?.throwIfAborted();
          if (!nearAnyCharge(order.date, remaining)) continue;

          await navigateTab(tabId, orderInvoicesUrl(order.orderId));
          const { invoices } = await send<{ invoices: RawTargetInvoice[] }>(tabId, "SCRAPE_INVOICES_LIST");

          for (const inv of invoices) {
            if (remaining.length === 0) break;
            await navigateTab(tabId, invoiceDetailUrl(order.orderId, inv.invoiceId));
            const { detail } = await send<{ detail: RawTargetInvoiceDetail }>(tabId, "SCRAPE_INVOICE_DETAIL");
            const candidates: TargetCandidate[] = cardPaymentCandidates(order.orderId, inv.invoiceId, inv.date, detail);

            const stillRemaining: YnabCharge[] = [];
            for (const charge of remaining) {
              const cand = candidates.filter((c) => c.isRefund === charge.isRefund);
              const hit = matchByAmountAndDate(charge.amountCents, charge.date, cand);
              if (hit) matchedInvoices.push({ orderId: order.orderId, invoiceId: hit.invoiceId, charge, detail });
              else stillRemaining.push(charge);
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
