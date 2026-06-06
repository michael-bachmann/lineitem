// apps/extension/retailers/target/selectors.ts

/** Target order-history pages are scraped from the live (rendered) DOM. */
export const SELECTORS = {
  // Orders list (/orders). `order-details-link` is a <div> card wrapper (NOT an
  // <a>); the real order anchor (`<a href="/orders/{id}">`) lives inside it.
  orderCard: "[data-test='order-details-link']",
  orderCardLink: "a[href*='/orders/']",
  loadMoreButton: "button",            // matched by text "Load more" (see content script)

  // Invoices list (/orders/{id}/invoices)
  invoiceRow: ".styles_invoiceListGrid__B_fTC",
  invoiceViewLink: "a[href*='/invoices/']",

  // Invoice detail (/orders/{id}/invoices/{invoiceId})
  invoiceItemRow: ".styles_infoRow__k6eLr",
  invoiceDetailRow: ".styles_detailsRowWrapper__QJjoS",
  invoicePaymentIcon: ".styles_paymentIconWrapper__vGppy", // reserved for payment-row detection (see content script)
  invoiceCardLabel: ".styles_cardNumberWrapper__vHhvb",

  // Order detail (/orders/{id}) — image map only
  orderItemTitle: "h3[id^='item-']",
} as const;

const BASE = "https://www.target.com";

export function ordersUrl(): string {
  return `${BASE}/orders`;
}
export function orderInvoicesUrl(orderId: string): string {
  return `${BASE}/orders/${encodeURIComponent(orderId)}/invoices`;
}
export function invoiceDetailUrl(orderId: string, invoiceId: string): string {
  return `${BASE}/orders/${encodeURIComponent(orderId)}/invoices/${encodeURIComponent(invoiceId)}`;
}
export function orderDetailUrl(orderId: string): string {
  return `${BASE}/orders/${encodeURIComponent(orderId)}`;
}

/** Signed-out Target redirects /orders to /login?... — detect by path prefix. */
export function isLoginUrl(href: string): boolean {
  try {
    return new URL(href).pathname.startsWith("/login");
  } catch {
    return false;
  }
}

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
  jan: "01", feb: "02", mar: "03", apr: "04", jun: "06", jul: "07", aug: "08",
  sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Parse Target date strings to ISO "YYYY-MM-DD". Handles an optional weekday
 * prefix and an optional "Invoice date:" label, and both full and abbreviated
 * month names. Examples: "Jun 4, 2026", "June 4, 2026", "Thu, Jun 4, 2026",
 * "Invoice date: August 23, 2025".
 *
 * Returns "" (empty string) when unparseable — NOT null. (Amazon's equivalent
 * returns null; the difference is intentional.)
 */
export function parseTargetDate(input: string): string {
  const cleaned = input.replace(/invoice date\s*:?/i, "").trim();
  const m = cleaned.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return "";
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return "";
  return `${m[3]}-${month}-${m[2].padStart(2, "0")}`;
}

/** Parse "$18.59" / "$-40.00" / "-$3.00" to ABSOLUTE integer cents (1859, 4000, 300). */
export function parseCents(dollarStr: string): number {
  const cleaned = dollarStr.replace(/[^0-9.]/g, "");
  if (!cleaned) return 0;
  return Math.round(parseFloat(cleaned) * 100);
}
