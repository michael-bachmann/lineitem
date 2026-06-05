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

export interface RawTargetPaymentLine {
  cardLabel: string;
  isGiftCard: boolean;
  /** Absolute cents charged to / refunded onto this payment method. */
  amountCents: number;
}

export interface RawTargetItem {
  productId: string;
  title: string;
  /** Absolute per-unit price in cents. */
  unitPriceCents: number;
  quantity: number;
  /** Absolute line amount (unit*qty) in cents. */
  amountCents: number;
}

export interface RawTargetInvoiceDetail {
  isRefund: boolean;
  items: RawTargetItem[];
  /** Sum of absolute item line amounts (gross, pre-promo). */
  itemSubtotalCents: number;
  /** "Invoice total" (purchase) or "Total refund" (refund), absolute cents. */
  invoiceTotalCents: number;
  paymentLines: RawTargetPaymentLine[];
}

const ITEM_LABEL_RE = /^\s*(\d+)\s*-\s*(.+?)\s*$/s;

function fieldAfter(container: Element, label: string): string {
  // Find the deepest (last in traversal) child whose text starts with `label`
  // and return the remaining text. Using the last match avoids picking up an
  // ancestor whose textContent includes both the label and sibling content.
  let result = "";
  for (const el of container.querySelectorAll("*")) {
    const t = (el.textContent ?? "").trim();
    if (t.startsWith(label) && t.length > label.length) {
      result = t.slice(label.length).trim();
    }
  }
  return result;
}

export function parseInvoiceDetailFromDocument(doc: Document): RawTargetInvoiceDetail {
  const headingText = doc.querySelector("h2")?.textContent ?? "";
  const isRefund = /\brefund\b/i.test(headingText);

  const items: RawTargetItem[] = [];
  for (const row of doc.querySelectorAll<HTMLElement>(SELECTORS.invoiceItemRow)) {
    const labelEl = row.querySelector("b p") ?? row.querySelector("p");
    const labelMatch = (labelEl?.textContent ?? "").replace(/\s+/g, " ").trim().match(ITEM_LABEL_RE);
    if (!labelMatch) continue;
    const qtyText = fieldAfter(row, "Qty.") || "1";
    const quantity = parseInt(qtyText.replace(/[^0-9]/g, ""), 10) || 1;
    const unitPriceCents = parseCents(fieldAfter(row, "Unit price"));
    const amountCents = parseCents(fieldAfter(row, "Amount"));
    items.push({
      productId: labelMatch[1],
      title: labelMatch[2],
      unitPriceCents,
      quantity,
      amountCents: amountCents || unitPriceCents * quantity,
    });
  }

  const itemSubtotalCents = items.reduce((s, it) => s + it.amountCents, 0);

  // Invoice/refund total: the detail row labeled "Invoice total" or "Total refund".
  let invoiceTotalCents = 0;
  for (const row of doc.querySelectorAll<HTMLElement>(SELECTORS.invoiceDetailRow)) {
    const t = (row.textContent ?? "").replace(/\s+/g, " ");
    if (/invoice total|total refund/i.test(t)) {
      const m = t.match(MONEY_RE);
      if (m) invoiceTotalCents = parseCents(m[0]);
    }
  }

  // Payment lines: each row carrying a payment icon + card label. The amount is
  // in the same row when split; when there is a single line and no amount, it
  // bills the full invoice total.
  const paymentLines: RawTargetPaymentLine[] = [];
  for (const label of doc.querySelectorAll<HTMLElement>(SELECTORS.invoiceCardLabel)) {
    const cardLabel = (label.textContent ?? "").trim();
    if (!cardLabel) continue;
    const row = label.closest(SELECTORS.invoiceDetailRow) ?? label.parentElement!;
    const rowText = (row.textContent ?? "").replace(cardLabel, "");
    const m = rowText.match(MONEY_RE);
    const isGiftCard = /gift\s*card/i.test(cardLabel);
    paymentLines.push({
      cardLabel,
      isGiftCard,
      amountCents: m ? parseCents(m[0]) : 0,
    });
  }
  // Single payment line with no explicit amount bills the whole invoice total.
  if (paymentLines.length === 1 && paymentLines[0].amountCents === 0) {
    paymentLines[0].amountCents = invoiceTotalCents;
  }

  return { isRefund, items, itemSubtotalCents, invoiceTotalCents, paymentLines };
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
