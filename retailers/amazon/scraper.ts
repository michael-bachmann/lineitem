import { SELECTORS, ASIN_REGEX } from "./selectors";

// ---------------------------------------------------------------------------
// Raw types — internal to the content-script scraper. The adapter maps these
// into ScrapedOrder / ScrapedItem for the pipeline.
// ---------------------------------------------------------------------------

export interface RawTransaction {
  date: string; // ISO date
  amountCents: number;
  orderId: string | null;
  cardLastFour: string | null;
  isRefund: boolean;
}

export interface RawItem {
  productId: string; // ASIN
  title: string;
  priceCents: number;
  quantity: number;
  imageUrl: string;
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

      let cardLastFour: string | null = null;
      const cardEl = item.querySelector(SELECTORS.cardSpan);
      if (cardEl) {
        const cardMatch = (cardEl.textContent ?? "").match(/\*{3,4}(\d{4})/);
        if (cardMatch) cardLastFour = cardMatch[1];
      }

      results.push({
        date,
        amountCents,
        orderId,
        cardLastFour,
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

  return { productId, title, priceCents, quantity, imageUrl };
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
