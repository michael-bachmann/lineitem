// apps/extension/retailers/target/scraper.ts
import { SELECTORS, parseTargetDate, parseCents } from "./selectors";

export interface RawTargetOrder {
  orderId: string;
  /** ISO YYYY-MM-DD. */
  date: string;
  /** Order total in cents from the list card, or null if not shown. A single
   *  invoice/charge can never exceed this, so it bounds which orders to open. */
  orderTotalCents: number | null;
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

const ITEM_LABEL_RE = /^\s*(\d+)\s*-\s*(.+?)\s*$/;

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
    // Target wraps the "{id} - {title}" label in <b><p>; fall back to a bare <p> if <b> is absent.
    const labelEl = row.querySelector("b p") ?? row.querySelector("p");
    const labelMatch = (labelEl?.textContent ?? "").replace(/\s+/g, " ").trim().match(ITEM_LABEL_RE);
    if (!labelMatch) continue;
    const qtyText = fieldAfter(row, "Qty.") || "1";
    const quantity = parseInt(qtyText.replace(/[^0-9]/g, ""), 10) || 1;
    const unitPriceCents = parseCents(fieldAfter(row, "Unit price"));
    const amountCents = parseCents(fieldAfter(row, "Amount"));
    const lineAmountCents = amountCents || unitPriceCents * quantity;
    // Skip $0 stub cards (e.g. "PAPER_BAG" with a $0 Amount whose only cost is a
    // "Bag fee" sub-row). The fee itself rides into the invoice-total gap and is
    // distributed across real items downstream like every other fee/tax, so the
    // transaction still balances; the stub would only add a $0 line to categorize.
    if (lineAmountCents === 0) continue;
    items.push({
      productId: labelMatch[1],
      title: labelMatch[2],
      unitPriceCents,
      quantity,
      amountCents: lineAmountCents,
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

/** Parse the /orders list into one entry per order (deduped by orderId).
 *
 *  Each order is a `[data-test="order-details-link"]` card <div> containing an
 *  `<a href="/orders/{id}">` (the orderId) and a date-shaped string (e.g.
 *  "Jun 4, 2026"). */
export function parseOrdersFromDocument(doc: Document): RawTargetOrder[] {
  const out: RawTargetOrder[] = [];
  const seen = new Set<string>();
  for (const card of doc.querySelectorAll<HTMLElement>(SELECTORS.orderCard)) {
    const link = card.querySelector<HTMLAnchorElement>(SELECTORS.orderCardLink);
    const idMatch = link?.getAttribute("href")?.match(ORDER_ID_RE);
    if (!idMatch) continue;
    const orderId = idMatch[1];
    if (seen.has(orderId)) continue;

    // parseTargetDate extracts the first date-shaped substring from the card
    // text (other text like the "#{orderId}" line is ignored).
    const text = card.textContent ?? "";
    const date = parseTargetDate(text);
    // First money in the card's TEXT is the order total ("$37.18 · 2 packages").
    // The anchor's "...for $37.18" aria-label also has money but lives in an
    // attribute, so textContent excludes it — keep that true if this changes.
    const money = text.match(MONEY_RE);
    const orderTotalCents = money ? parseCents(money[0]) : null;
    seen.add(orderId);
    out.push({ orderId, date, orderTotalCents });
  }
  return out;
}

const ITEM_ID_RE = /^item-(\d+)$/;

/**
 * The image belonging to `title`'s item: the one that most-recently precedes the
 * title in document order. Each item card lays out its picture before the title,
 * so the nearest preceding image is this item's — and unlike "first image in the
 * nearest ancestor", this stays correct whether the picture is nested in a
 * per-item wrapper or a flat sibling of the title. `imgs` must be in document
 * order (i.e. `querySelectorAll` order).
 */
function precedingImg(title: HTMLElement, imgs: HTMLImageElement[]): HTMLImageElement | null {
  let best: HTMLImageElement | null = null;
  for (const img of imgs) {
    // imgs are in document order, so once one is no longer before the title,
    // none of the rest are either.
    if (!(title.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_PRECEDING)) break;
    best = img;
  }
  return best;
}

/** Map productId -> image URL from the order detail page.
 *
 *  A `package-card-item-row` is a whole PACKAGE that can hold many items, so a
 *  per-package image lookup would give every item the first picture. Pair each
 *  item title with the image that precedes it instead (see `precedingImg`). */
export function parseOrderImageMap(doc: Document): Record<string, string> {
  const map: Record<string, string> = {};
  const imgs = [...doc.querySelectorAll<HTMLImageElement>("img")];
  for (const title of doc.querySelectorAll<HTMLElement>(SELECTORS.orderItemTitle)) {
    const idMatch = title.id.match(ITEM_ID_RE);
    if (!idMatch) continue;
    const src = precedingImg(title, imgs)?.getAttribute("src") ?? "";
    if (src) map[idMatch[1]] = src;
  }
  return map;
}
