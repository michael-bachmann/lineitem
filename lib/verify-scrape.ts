import type { ScrapedOrder } from "./types";
import { formatCents } from "./money";

const TOLERANCE_CENTS = 1;

function itemsSumCents(order: ScrapedOrder): number {
  return order.items.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0,
  );
}

/**
 * Verify that our scraped items account for the order's total per Amazon.
 *
 * Compares the sum of scraped item line totals against Amazon's own
 * displayed "Item(s) Subtotal" within a 1-cent tolerance. A mismatch
 * means the scrape is incomplete — the pipeline must surface this as
 * an error rather than feeding partial inputs into distribution.
 *
 * On failure, the message includes both dollar amounts so the user can
 * cross-check against Amazon's page.
 */
export function verifyScrape(
  order: ScrapedOrder,
): { ok: true } | { ok: false; message: string } {
  const itemsSum = itemsSumCents(order);
  if (Math.abs(itemsSum - order.displayedItemsSubtotalCents) <= TOLERANCE_CENTS) {
    return { ok: true };
  }
  return {
    ok: false,
    message: `Scraped items totaled ${formatCents(itemsSum)} but Amazon shows ${formatCents(order.displayedItemsSubtotalCents)} — the scrape may have missed an item. Try resyncing, or categorize manually.`,
  };
}
