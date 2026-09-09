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

    out.push({ invoiceId: idMatch[1]!, date, amountCents, isRefund });
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
      productId: labelMatch[1]!,
      title: labelMatch[2]!,
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
  if (paymentLines.length === 1 && paymentLines[0]!.amountCents === 0) {
    paymentLines[0]!.amountCents = invoiceTotalCents;
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
    const orderId = idMatch[1]!;
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
    if (src) map[idMatch[1]!] = src;
  }
  return map;
}

// ----------------------------------------------------------------------------
// In-store purchases (/orders, "In-store" tab; /orders/stores/{receiptId})
// ----------------------------------------------------------------------------

const STORE_RECEIPT_ID_RE = /\/orders\/stores\/([\w-]+)(?:[/?#]|$)/;
// Used for a SECTION's own heading on the detail page (e.g. "Return complete").
// Broader than the online path's `\brefund\b` (which wouldn't match "Refunded").
const STORE_REFUND_RE = /refund|return/i;
// Live-verified: EVERY in-store list card says "Purchased" — even one for a
// receipt that was later partially returned, whose card also says "Return
// complete" (see `RawTargetStoreDetail`'s mixed-receipt case). The card's own
// total is the FULL original purchase amount in that case too, not a netted
// figure. So "Purchased" present is the reliable purchase/refund signal for
// the LIST level — unlike STORE_REFUND_RE above, "return" text alone doesn't
// mean this list entry is itself a refund. No standalone refund-only list
// entry has been observed live; this only matters if one ever exists.
const STORE_LIST_PURCHASED_RE = /purchased/i;

export interface RawTargetStoreOrder {
  receiptId: string;
  /** ISO YYYY-MM-DD. */
  date: string;
  /** Absolute cents from the list card, or null if not shown. For a receipt
   *  that was later partially returned, this is still the full ORIGINAL
   *  purchase amount — Target doesn't net the two together. */
  totalCents: number | null;
  isRefund: boolean;
}

/** Parse the in-store tab of /orders into one entry per purchase (deduped by
 *  receiptId). Same card shape as `parseOrdersFromDocument`: a
 *  `[data-test="store-order-details-link"]` div wraps the real
 *  `<a href="/orders/stores/{receiptId}">` anchor. */
export function parseStoreOrdersFromDocument(doc: Document): RawTargetStoreOrder[] {
  const out: RawTargetStoreOrder[] = [];
  const seen = new Set<string>();
  for (const card of doc.querySelectorAll<HTMLElement>(SELECTORS.storeOrderCard)) {
    const link = card.querySelector<HTMLAnchorElement>(SELECTORS.storeOrderCardLink);
    const idMatch = link?.getAttribute("href")?.match(STORE_RECEIPT_ID_RE);
    if (!idMatch) continue;
    const receiptId = idMatch[1]!;
    if (seen.has(receiptId)) continue;

    const text = card.textContent ?? "";
    const date = parseTargetDate(text);
    const money = text.match(MONEY_RE);
    const totalCents = money ? parseCents(money[0]) : null;
    const isRefund = !STORE_LIST_PURCHASED_RE.test(text);
    seen.add(receiptId);
    out.push({ receiptId, date, totalCents, isRefund });
  }
  return out;
}

const QTY_RE = /^qty\.?\s*(\d+)/i;

/** Labels for the page-level "Purchased on {date}" / "Refund issued on {date}"
 *  lines — live-verified to always carry the full date INCLUDING YEAR (e.g.
 *  "Purchased on April 7, 2026 6:23 PM"), unlike each section's own heading
 *  block (e.g. "Apr 7, 6:21 PM", no year). These lines sit outside the section
 *  markup itself (found via a document-wide scan, same as `fieldAfter`
 *  elsewhere), so they're read once per document and paired to a section by
 *  that section's own direction (isRefund), not by DOM containment. */
const STORE_PURCHASED_ON_LABEL = "Purchased on";
const STORE_REFUND_ISSUED_ON_LABEL = "Refund issued on";

export interface RawTargetStoreSection {
  isRefund: boolean;
  /** ISO YYYY-MM-DD — this section's own timestamp. Distinct per section on a
   *  mixed receipt (a return can post weeks after the original purchase), so
   *  this — not the list card's one date — is what matching must use. */
  date: string;
  items: RawTargetItem[];
  /** Sum of absolute item line amounts (gross, pre-promo) for this section. */
  itemSubtotalCents: number;
}

export interface RawTargetStoreDetail {
  /** One entry per direction section. Length 1 for an ordinary (pure)
   *  receipt; 2 for a mixed purchase+return receipt — the only mixed shape
   *  seen live (one "Purchased" section, one "Return complete" section). */
  sections: RawTargetStoreSection[];
  /** The one blended Subtotal/Tax/Total block Target renders for the whole
   *  receipt, even when it covers two unrelated real transactions summed
   *  together (not netted). */
  invoiceTotalCents: number;
  paymentLines: RawTargetPaymentLine[];
}

function parseStoreSectionItems(section: Element): { items: RawTargetItem[]; itemSubtotalCents: number } {
  const items: RawTargetItem[] = [];
  for (const wrapper of section.querySelectorAll<HTMLElement>(SELECTORS.storeItemWrapper)) {
    const title = wrapper.querySelector<HTMLElement>(SELECTORS.orderItemTitle);
    const idMatch = title?.id.match(ITEM_ID_RE);
    if (!title || !idMatch) continue;
    const priceText = wrapper.querySelector<HTMLElement>(SELECTORS.storeItemPrice)?.textContent ?? "";
    const unitPriceCents = parseCents(priceText);
    // Skip $0 stub cards, same as the online invoice-detail path.
    if (unitPriceCents === 0) continue;
    const qtyText = [...wrapper.querySelectorAll("p")]
      .map((p) => (p.textContent ?? "").trim())
      .find((t) => QTY_RE.test(t));
    const quantity = qtyText ? parseInt(qtyText.match(QTY_RE)![1]!, 10) : 1;
    items.push({
      productId: idMatch[1]!,
      title: (title.textContent ?? "").trim(),
      unitPriceCents,
      quantity,
      amountCents: unitPriceCents * quantity,
    });
  }
  const itemSubtotalCents = items.reduce((s, it) => s + it.amountCents, 0);
  return { items, itemSubtotalCents };
}

/**
 * Parse a single in-store receipt page (/orders/stores/{receiptId}). Unlike an
 * online order — which splits into per-shipment invoices fetched from separate
 * pages — an in-store purchase is one register transaction: items, totals, and
 * payment tender all render on this one page. A receipt can also be *mixed*: a
 * return bundled with a purchase under the same URL, each in its own
 * `storePackageSection` with its own `<h2>` and items, but sharing the page's
 * one blended total. The item cards reuse the same component as the online
 * order-detail image map (`orderItemTitle`), so `productId` stays consistent
 * across channels for the same product.
 */
export function parseStorePurchaseDetailFromDocument(doc: Document): RawTargetStoreDetail {
  const purchasedOnDate = parseTargetDate(fieldAfter(doc.body, STORE_PURCHASED_ON_LABEL));
  const refundIssuedOnDate = parseTargetDate(fieldAfter(doc.body, STORE_REFUND_ISSUED_ON_LABEL));

  const sections: RawTargetStoreSection[] = [
    ...doc.querySelectorAll<HTMLElement>(SELECTORS.storePackageSection),
  ].map((sectionEl) => {
    const headingText = sectionEl.querySelector("h2")?.textContent ?? "";
    const isRefund = STORE_REFUND_RE.test(headingText);
    return {
      isRefund,
      date: isRefund ? refundIssuedOnDate : purchasedOnDate,
      ...parseStoreSectionItems(sectionEl),
    };
  });

  const invoiceTotalCents = parseCents(
    doc.querySelector<HTMLElement>(SELECTORS.storeGrandTotal)?.textContent ?? "",
  );

  // Payment lines: each child of the card-list container is one tender row
  // (card label + amount). Structural (by position, not a guessed hashed
  // class) since only the container's class was confirmed live.
  const paymentLines: RawTargetPaymentLine[] = [];
  const cardList = doc.querySelector<HTMLElement>(SELECTORS.storePaymentCardList);
  if (cardList) {
    for (const row of cardList.children) {
      const text = (row.textContent ?? "").trim();
      if (!text) continue;
      const m = text.match(MONEY_RE);
      const cardLabel = m ? text.slice(0, text.indexOf(m[0])).trim() : text;
      if (!cardLabel) continue;
      paymentLines.push({
        cardLabel,
        isGiftCard: /gift\s*card/i.test(cardLabel),
        amountCents: m ? parseCents(m[0]) : 0,
      });
    }
  }
  // Single payment line with no explicit amount bills the whole total.
  if (paymentLines.length === 1 && paymentLines[0]!.amountCents === 0) {
    paymentLines[0]!.amountCents = invoiceTotalCents;
  }

  return { sections, invoiceTotalCents, paymentLines };
}
