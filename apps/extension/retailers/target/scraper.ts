// apps/extension/retailers/target/scraper.ts
import { SELECTORS, parseTargetDate, parseCents } from "./selectors";

export interface RawTargetOrder {
  orderId: string;
  /** ISO YYYY-MM-DD. */
  date: string;
}

const ORDER_ID_RE = /\/orders\/(\d+)(?:[/?#]|$)/;

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
