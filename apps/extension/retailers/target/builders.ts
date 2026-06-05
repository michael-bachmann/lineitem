// apps/extension/retailers/target/builders.ts
import type { ScrapedItem, ScrapedOrder, YnabCharge } from "@/lib/types";
import type { RawTargetInvoiceDetail } from "./scraper";

const RETAILER = "target";

/** A single card payment-line surfaced as a match candidate (gift cards excluded). */
export interface TargetCandidate {
  orderId: string;
  invoiceId: string;
  date: string;
  amountCents: number;
  isRefund: boolean;
}

export function cardPaymentCandidates(
  orderId: string,
  invoiceId: string,
  date: string,
  detail: RawTargetInvoiceDetail,
): TargetCandidate[] {
  return detail.paymentLines
    .filter((p) => !p.isGiftCard && p.amountCents > 0)
    .map((p) => ({ orderId, invoiceId, date, amountCents: p.amountCents, isRefund: detail.isRefund }));
}

function toScrapedItems(
  detail: RawTargetInvoiceDetail,
  imageMap: Record<string, string>,
  refunded: boolean,
): ScrapedItem[] {
  return detail.items.map((it) => ({
    productId: it.productId,
    title: it.title,
    imageUrl: imageMap[it.productId] ?? "",
    unitPriceCents: it.unitPriceCents,
    quantity: it.quantity,
    refundedAmountCents: refunded ? it.amountCents : 0,
  }));
}

/** Gross item sum = sum(unitPrice*qty). Used for verifyScrape reconciliation. */
function grossItemSum(items: ScrapedItem[]): number {
  return items.reduce((s, it) => s + it.unitPriceCents * it.quantity, 0);
}

export function buildPurchaseOrder(
  orderId: string,
  detail: RawTargetInvoiceDetail,
  imageMap: Record<string, string>,
): ScrapedOrder {
  const items = toScrapedItems(detail, imageMap, false);
  return {
    retailer: RETAILER,
    orderId,
    items,
    displayedItemsSubtotalCents: grossItemSum(items),
    refund: null,
  };
}

export function buildRefundOrder(
  orderId: string,
  detail: RawTargetInvoiceDetail,
  cardCharge: YnabCharge,
  imageMap: Record<string, string>,
): ScrapedOrder {
  const items = toScrapedItems(detail, imageMap, true);
  const itemCents = detail.itemSubtotalCents;
  // taxCents is informational; the ratio that matters is totalCents/itemCents,
  // where totalCents is the card-billed refund (the matched charge amount).
  const taxCents = Math.max(0, detail.invoiceTotalCents - itemCents);
  return {
    retailer: RETAILER,
    orderId,
    items,
    displayedItemsSubtotalCents: grossItemSum(items),
    refund: {
      itemCents,
      taxCents,
      totalCents: cardCharge.amountCents,
    },
  };
}
