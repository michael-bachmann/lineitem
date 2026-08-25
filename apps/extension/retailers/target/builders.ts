// apps/extension/retailers/target/builders.ts
import type { ScrapedItem, ScrapedOrder, YnabCharge } from "@/lib/types";
import type { RawTargetInvoiceDetail, RawTargetItem, RawTargetStoreDetail, RawTargetStoreSection } from "./scraper";

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
  items: RawTargetItem[],
  imageMap: Record<string, string>,
  refunded: boolean,
): ScrapedItem[] {
  return items.map((it) => ({
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
  const items = toScrapedItems(detail.items, imageMap, false);
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
  const items = toScrapedItems(detail.items, imageMap, true);
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

/**
 * A pure (single-direction) in-store receipt has exactly one section — convert
 * it to the same shape the online-order builders already consume, so
 * `buildPurchaseOrder`/`buildRefundOrder` work unchanged for the case that's
 * already built and tested. Only valid when `detail.sections.length === 1`.
 */
export function toInvoiceDetail(detail: RawTargetStoreDetail): RawTargetInvoiceDetail {
  const [section] = detail.sections;
  return {
    isRefund: section.isRefund,
    items: section.items,
    itemSubtotalCents: section.itemSubtotalCents,
    invoiceTotalCents: detail.invoiceTotalCents,
    paymentLines: detail.paymentLines,
  };
}

/**
 * A mixed in-store receipt's PURCHASE side. Live-verified: the original card
 * charge covers EVERY item on the receipt, including ones later returned —
 * Target's per-section "Purchased"/"Return complete" labels describe an
 * item's current status, not what was billed. So the purchase charge must
 * reconcile against every section's items combined (none marked refunded
 * here — that marking is for the separate refund charge/order, built via
 * `toReturnSectionDetail` below), using the receipt's one blended total,
 * which — confirmed live — IS the real original purchase amount, not an
 * artificial sum of two unrelated transactions.
 */
export function toMixedPurchaseDetail(detail: RawTargetStoreDetail): RawTargetInvoiceDetail {
  const items = detail.sections.flatMap((s) => s.items);
  return {
    isRefund: false,
    items,
    itemSubtotalCents: detail.sections.reduce((sum, s) => sum + s.itemSubtotalCents, 0),
    invoiceTotalCents: detail.invoiceTotalCents,
    paymentLines: detail.paymentLines,
  };
}

/**
 * A mixed receipt's return section, viewed as its own standalone refund order
 * once a specific refund charge has been found for it (see adapter.ts's
 * refund-discovery pass — there's no independently displayed total for just
 * the return, so it can't be matched by total the way the purchase side can).
 * `refundCharge.amountCents` stands in for `invoiceTotalCents` so
 * `buildRefundOrder`'s existing `taxCents = invoiceTotalCents - itemCents`
 * derives the right (real, not estimated) tax from the real matched charge.
 */
export function toReturnSectionDetail(
  section: RawTargetStoreSection,
  refundCharge: YnabCharge,
): RawTargetInvoiceDetail {
  return {
    isRefund: true,
    items: section.items,
    itemSubtotalCents: section.itemSubtotalCents,
    invoiceTotalCents: refundCharge.amountCents,
    paymentLines: [],
  };
}
