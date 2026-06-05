// apps/extension/retailers/target/scraper.ts
import { SELECTORS, parseTargetDate, parseCents } from "./selectors";

export interface RawTargetOrder {
  orderId: string;
  /** ISO YYYY-MM-DD. */
  date: string;
}

const ORDER_ID_RE = /\/orders\/(\d+)(?:[/?#]|$)/;

export interface RawTargetInvoice {
  invoiceId: string;
  /** ISO YYYY-MM-DD. */
  date: string;
  /** Displayed invoice/refund total in cents (absolute). */
  amountCents: number;
  isRefund: boolean;
}

const INVOICE_ID_RE = /\/invoices\/(\d+)(?:[/?#]|$)/;
const MONEY_RE = /\$-?[\d,]+\.\d{2}/;

export function parseInvoicesListFromDocument(doc: Document): RawTargetInvoice[] {
  const out: RawTargetInvoice[] = [];
  for (const row of doc.querySelectorAll<HTMLElement>(SELECTORS.invoiceRow)) {
    const link = row.querySelector<HTMLAnchorElement>(SELECTORS.invoiceViewLink);
    const idMatch = link?.getAttribute("href")?.match(INVOICE_ID_RE);
    if (!idMatch) continue;

    const text = row.textContent ?? "";
    const isRefund = /\brefund\b/i.test(text);
    const date = parseTargetDate(text);
    const moneyMatch = text.match(MONEY_RE);
    const amountCents = moneyMatch ? parseCents(moneyMatch[0]) : 0;

    out.push({ invoiceId: idMatch[1], date, amountCents, isRefund });
  }
  return out;
}

/** Parse the /orders list into one entry per order (deduped by orderId). */
export function parseOrdersFromDocument(doc: Document): RawTargetOrder[] {
  const out: RawTargetOrder[] = [];
  const seen = new Set<string>();
  for (const link of doc.querySelectorAll<HTMLAnchorElement>(SELECTORS.orderLink)) {
    const href = link.getAttribute("href") ?? "";
    const idMatch = href.match(ORDER_ID_RE);
    if (!idMatch) continue;
    const orderId = idMatch[1];
    if (seen.has(orderId)) continue;

    // The order card holds a visible date; find the nearest ancestor that also
    // contains a date-shaped string.
    const card = link.closest("div");
    const dateText = card?.textContent ?? "";
    const date = parseTargetDate(dateText);
    seen.add(orderId);
    out.push({ orderId, date });
  }
  return out;
}
