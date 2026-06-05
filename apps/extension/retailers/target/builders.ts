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
    // detail.itemSubtotalCents is the sum of per-item line amounts the scraper
    // parsed. The pipeline's verifyScrape compares Σ(unitPrice*qty) against this,
    // which catches a per-line unit×qty ≠ Amount discrepancy. NOTE: it does NOT
    // catch a fully-missed item the way Amazon's guard does — Target's invoice
    // detail only shows a post-promo "Item subtotal", so there is no promo-free
    // independent total to reconcile gross items against. This is an accepted v1
    // limitation (see the design doc's "Known limitations").
    displayedItemsSubtotalCents: detail.itemSubtotalCents,
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
    // see note above
    displayedItemsSubtotalCents: detail.itemSubtotalCents,
    refund: {
      itemCents,
      taxCents,
      totalCents: cardCharge.amountCents,
    },
  };
}
