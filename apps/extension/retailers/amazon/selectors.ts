export const SELECTORS = {
  // Transactions page
  dateContainer: ".apx-transaction-date-container",
  lineItem: ".apx-transactions-line-item-component-container",
  amountSpan: ".a-span3 span, .a-text-right span",
  orderLink: "a[href*='orderID=']",
  // Amazon's pagination widget emits an input whose `name` encodes the event
  // (`ppw-widgetEvent:DefaultNextPageNavigationEvent:...`). Stable across pages;
  // `aria-labelledby` is present on page 0 only.
  nextPageButton:
    'span.a-button:not(.a-button-disabled) input[type="submit"][name*="NextPageNavigationEvent"]',

  // Order detail page (summary)
  itemBoxPrimary: ".a-fixed-left-grid-inner",
  itemBoxFallback: ".a-fixed-left-grid.item-box, .shipment .a-fixed-left-grid, [class*='od-item'], .yo-item",
  productLink: "a[href*='/dp/'], a[href*='/gp/product/']",
  priceEl: "[data-component='unitPrice'] .a-offscreen, .a-color-price",
  priceFallback: ".a-text-price .a-offscreen, [class*='price']",
  quantityFallback: "[data-component='quantity'], [class*='quantity'], [class*='qty']",

  // Shipment-level container on regular order detail. Each shipment is a
  // `[data-component="shipmentsLeftGrid"]` block containing one
  // `[data-component="shipmentStatus"]` (the status header) and one
  // `[data-component="purchasedItems"]` (the items).
  shipmentRoot: '[data-component="shipmentsLeftGrid"]',
  shipmentStatusText: '[data-component="shipmentStatus"] .od-status-message',

  // Grocery order detection (on summary page)
  groceryProgressTracker: "#f3_food_ProgressTracker",

  // Itemmod page (grocery item list).
  // Each item row is `<div id="<ASIN>-item-grid-row" role="row">`; the line
  // total is `<span id="<ASIN>-item-total-price">`. The id-ends-with form
  // skips the column-header row (which lacks an id) and the divider <hr>
  // elements (which end with `-item-grid-divider`).
  itemmodItemRow: "[id$='-item-grid-row']",
  itemmodLineTotal: "[id$='-item-total-price']",
  // Per-item refund marker — present in the row when Amazon refunded
  // some quantity of that item. Text content is the negative dollar
  // amount, e.g. " -$15.00 ".
  itemmodItemRefundPrice: ".ufpo-item-status-price",

  // Refund summary popover. The trigger element carries the encoded
  // breakdown in its `data-a-popover` JSON attribute. There are multiple
  // popovers on the page; we identify ours by presence of "Refund Total"
  // in the encoded content.
  refundSummaryTrigger: "[data-a-popover]",
} as const;

export const ASIN_REGEX = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/;
// Amazon's auth URLs appear as `/ap/signin?...` (query, no trailing slash) as
// well as `/ap/signin/...`. Match the segment when followed by `/`, `?`, or
// end-of-string so a logged-out redirect is detected rather than scraped.
export const AUTH_PAGE_REGEX = /\/ap\/(signin|challenge|cvf)(?:[/?]|$)/i;

export const TRANSACTIONS_URL =
  "https://www.amazon.com/cpe/yourpayments/transactions";

export function orderDetailUrl(orderId: string): string {
  return `https://www.amazon.com/gp/css/summary/edit.html?orderID=${encodeURIComponent(orderId)}`;
}
