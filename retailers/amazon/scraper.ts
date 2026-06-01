import { SELECTORS, ASIN_REGEX } from "./selectors";

// ---------------------------------------------------------------------------
// Raw types — internal to the content-script scraper. The adapter maps these
// into ScrapedOrder / ScrapedItem for the pipeline.
// ---------------------------------------------------------------------------

export interface RawTransaction {
  date: string; // ISO date
  amountCents: number;
  orderId: string | null;
  isRefund: boolean;
}

export interface RawItem {
  productId: string; // ASIN
  title: string;
  priceCents: number;
  quantity: number;
  imageUrl: string;
  /** Sum of refund markers on this item; 0 when not refunded. */
  refundedAmountCents: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTHS: Record<string, string> = {
  January: "01",
  February: "02",
  March: "03",
  April: "04",
  May: "05",
  June: "06",
  July: "07",
  August: "08",
  September: "09",
  October: "10",
  November: "11",
  December: "12",
};

/**
 * Parse a natural-language date like "May 17, 2026" to ISO "2026-05-17".
 * Returns an empty string if the input cannot be parsed.
 */
export function parseNaturalDate(dateStr: string): string | null {
  const m = dateStr.trim().match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[1]];
  if (!month) return null;
  const day = m[2].padStart(2, "0");
  return `${m[3]}-${month}-${day}`;
}

/**
 * Parse a dollar string like "$42.99" or "+$3.50" to integer cents (4299, 350).
 * Strips everything except digits and the decimal point, then rounds.
 */
export function parseCents(dollarStr: string): number {
  const cleaned = dollarStr.replace(/[^0-9.]/g, "");
  if (!cleaned) return 0;
  return Math.round(parseFloat(cleaned) * 100);
}

// ---------------------------------------------------------------------------
// Transaction parsing (transactions page)
// ---------------------------------------------------------------------------

export function parseTransactionsFromDocument(
  doc: Document,
): RawTransaction[] {
  const results: RawTransaction[] = [];
  let currentDate: string | null = null;

  const dateContainers = doc.querySelectorAll(SELECTORS.dateContainer);
  dateContainers.forEach((dateEl) => {
    const dateSpan = dateEl.querySelector("span");
    if (dateSpan) {
      currentDate = parseNaturalDate(dateSpan.textContent?.trim() ?? "");
    }
    if (!currentDate) return;
    const date = currentDate;

    const sibling = dateEl.nextElementSibling;
    if (!sibling) return;

    sibling.querySelectorAll(SELECTORS.lineItem).forEach((item) => {
      const text = item.textContent ?? "";
      const amountEl = item.querySelector(SELECTORS.amountSpan);
      if (!amountEl) return;
      const amountText = amountEl.textContent?.trim() ?? "";
      const isRefund = /refund/i.test(text) || amountText.startsWith("+");
      const amountCents = parseCents(amountText);

      let orderId: string | null = null;
      const orderLink = item.querySelector(SELECTORS.orderLink);
      if (orderLink) {
        const orderMatch = (orderLink.getAttribute("href") ?? "").match(
          /orderID=([^&]+)/,
        );
        if (orderMatch) orderId = orderMatch[1];
      }

      results.push({
        date,
        amountCents,
        orderId,
        isRefund,
      });
    });
  });

  return results;
}

// ---------------------------------------------------------------------------
// Item parsing (order detail page)
// ---------------------------------------------------------------------------

function parseItemFromElement(item: Element): RawItem | null {
  const productLinks = item.querySelectorAll(SELECTORS.productLink);
  let titleEl: Element | null = null;
  let title = "";
  for (const link of productLinks) {
    const text = link.textContent?.trim() ?? "";
    if (text) {
      titleEl = link;
      title = text;
      break;
    }
  }
  if (!title) return null;

  let productId = "";
  const href = titleEl?.getAttribute("href") ?? "";
  const asinMatch = href.match(ASIN_REGEX);
  if (asinMatch) productId = asinMatch[1];
  if (!productId) return null;

  const imgEl = item.querySelector("img");
  const imageUrl = imgEl?.getAttribute("src") ?? "";

  let priceCents = 0;
  const priceEl = item.querySelector(SELECTORS.priceEl);
  if (priceEl) {
    priceCents = parseCents(priceEl.textContent ?? "0");
  } else {
    const priceFallbackEl = item.querySelector(SELECTORS.priceFallback);
    if (priceFallbackEl) {
      priceCents = parseCents(priceFallbackEl.textContent ?? "0");
    }
  }

  let quantity = 1;
  const qtyMatch = (item.textContent ?? "").match(/Qty:\s*(\d+)/i);
  if (qtyMatch) {
    quantity = parseInt(qtyMatch[1], 10);
  } else {
    const qtyEl = item.querySelector(SELECTORS.quantityFallback);
    if (qtyEl) {
      const qtyNum = parseInt(qtyEl.textContent?.trim() ?? "", 10);
      if (!isNaN(qtyNum) && qtyNum > 0) quantity = qtyNum;
    }
  }

  // Shipment-level refund detection: walk up to the enclosing shipment
  // container and look at its status header. Edge case noted on BAC-122:
  // when only some items in a shipment are returned, Amazon's regular-order
  // detail UI may not show per-item refund markers — this conservative
  // "whole shipment is refunded" rule will over-mark in that case. The
  // grocery itemmod path uses real per-item markers and is not affected.
  let refundedAmountCents = 0;
  const shipmentRoot = item.closest(SELECTORS.shipmentRoot);
  if (shipmentRoot) {
    const statusEl = shipmentRoot.querySelector(SELECTORS.shipmentStatusText);
    const statusText = statusEl?.textContent?.trim() ?? "";
    if (/^Refunded/i.test(statusText)) {
      refundedAmountCents = priceCents * quantity;
    }
  }

  return { productId, title, priceCents, quantity, imageUrl, refundedAmountCents };
}

export function parseItemsFromDocument(doc: Document): RawItem[] {
  let itemElements = doc.querySelectorAll(SELECTORS.itemBoxPrimary);
  if (itemElements.length === 0) {
    itemElements = doc.querySelectorAll(SELECTORS.itemBoxFallback);
  }
  return Array.from(itemElements).reduce<RawItem[]>((acc, el) => {
    const item = parseItemFromElement(el);
    return item ? [...acc, item] : acc;
  }, []);
}

// ---------------------------------------------------------------------------
// Grocery / itemmod parsing
// ---------------------------------------------------------------------------

/**
 * True when the current document is the order summary for a grocery order
 * (Whole Foods Market, Amazon Fresh). Used to route the adapter to the
 * separate itemmod URL where the items actually live.
 */
export function isGroceryOrder(doc: Document): boolean {
  return doc.querySelector(SELECTORS.groceryProgressTracker) !== null;
}

function parseItemmodElement(item: Element): RawItem | null {
  // Skip out-of-stock items. The row still shows a line price but Amazon
  // includes a matching negative credit in the same container, so the
  // customer wasn't charged and Item(s) Subtotal excludes it. Counting it
  // would inflate our sum past Amazon's and trip verify-scrape.
  if (/Out of stock/i.test(item.textContent ?? "")) return null;

  const productLinks = item.querySelectorAll(SELECTORS.productLink);
  let titleEl: Element | null = null;
  let title = "";
  for (const link of productLinks) {
    const text = link.textContent?.trim() ?? "";
    if (text) {
      titleEl = link;
      title = text;
      break;
    }
  }
  if (!title) return null;

  const href = titleEl?.getAttribute("href") ?? "";
  const asinMatch = href.match(ASIN_REGEX);
  if (!asinMatch) return null;
  const productId = asinMatch[1];

  const imgEl = item.querySelector("img");
  const imageUrl = imgEl?.getAttribute("src") ?? "";

  // Itemmod shows the line total directly, not per-unit price.
  const lineTotalEl = item.querySelector(SELECTORS.itemmodLineTotal);
  const priceCents = parseCents(lineTotalEl?.textContent ?? "0");
  if (priceCents === 0) return null;

  // Per-item refund marker. Text reads e.g. " -$15.00 ". parseCents strips
  // the sign and returns absolute cents, which is what we store.
  const refundEl = item.querySelector(SELECTORS.itemmodItemRefundPrice);
  const refundedAmountCents = refundEl
    ? parseCents(refundEl.textContent ?? "0")
    : 0;

  return {
    productId,
    title,
    priceCents,
    quantity: 1,
    imageUrl,
    refundedAmountCents,
  };
}

export function parseItemmodFromDocument(doc: Document): RawItem[] {
  const itemElements = doc.querySelectorAll(SELECTORS.itemmodItemRow);
  return Array.from(itemElements).reduce<RawItem[]>((acc, el) => {
    const item = parseItemmodElement(el);
    return item ? [...acc, item] : acc;
  }, []);
}

// ---------------------------------------------------------------------------
// Order-summary subtotal extraction (for scrape completeness guard)
// ---------------------------------------------------------------------------

const SUBTOTAL_LABEL_REGEX = /^Item\(s\)\s+Subtotal:?$/i;
const DOLLAR_VALUE_REGEX = /\$([0-9,]+\.[0-9]{2})/;

/**
 * Extract Amazon's displayed "Item(s) Subtotal" value from the order
 * summary page, returned as integer cents.
 *
 * Strategy: find the element whose trimmed text is the subtotal label,
 * then walk up to its enclosing `.a-row` (Amazon's UI-library row class,
 * present on every order-summary line — Whole Foods and regular Amazon
 * alike). The row's textContent contains the matching `$X.XX` value.
 *
 * Returns null if the label, the row, or the dollar value cannot be
 * located.
 */
export function extractItemsSubtotal(doc: Document): number | null {
  const labelEl = Array.from(doc.querySelectorAll("span, dt, label"))
    .find((el) => SUBTOTAL_LABEL_REGEX.test((el.textContent ?? "").trim()));
  if (!labelEl) return null;

  const row = labelEl.closest(".a-row");
  if (!row) return null;

  const match = (row.textContent ?? "").match(DOLLAR_VALUE_REGEX);
  return match ? parseCents(match[0]) : null;
}

// ---------------------------------------------------------------------------
// Refund summary popover
// ---------------------------------------------------------------------------

const REFUND_ITEM_REGEX = /Item\(s\)\s*refund[\s\S]*?\$([0-9,]+\.[0-9]{2})/i;
const REFUND_TAX_REGEX = /Tax\s*refund[\s\S]*?\$([0-9,]+\.[0-9]{2})/i;
const REFUND_TOTAL_REGEX = /Refund\s*Total[\s\S]*?\$([0-9,]+\.[0-9]{2})/i;

/**
 * Extract Amazon's refund-summary popover totals from an order detail page.
 *
 * Amazon emits a JSON-encoded popover via `data-a-popover` on the "Refund
 * Total" trigger. Two field names occur in the wild: `inlineContent`
 * (regular orders) and `content` (Whole Foods). Both wrap a small HTML
 * fragment we regex over to pull out `Item(s) refund`, `Tax refund`
 * (absent on grocery), and `Refund Total`.
 *
 * Returns null when no popover on the page mentions "Refund Total" — that's
 * the signal that the order has no refunds.
 */
export function parseRefundSummary(
  doc: Document,
): { itemCents: number; taxCents: number; totalCents: number } | null {
  const triggers = doc.querySelectorAll(SELECTORS.refundSummaryTrigger);
  for (const trigger of triggers) {
    const raw = trigger.getAttribute("data-a-popover");
    if (!raw || !raw.includes("Refund Total")) continue;
    let parsed: { inlineContent?: string; content?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // malformed; try next popover
    }
    const body = parsed.inlineContent ?? parsed.content ?? "";
    const totalMatch = body.match(REFUND_TOTAL_REGEX);
    if (!totalMatch) continue;
    const itemMatch = body.match(REFUND_ITEM_REGEX);
    const taxMatch = body.match(REFUND_TAX_REGEX);
    return {
      itemCents: itemMatch ? parseCents(itemMatch[1]) : 0,
      taxCents: taxMatch ? parseCents(taxMatch[1]) : 0,
      totalCents: parseCents(totalMatch[1]),
    };
  }
  return null;
}
