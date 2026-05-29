export const SELECTORS = {
  // Transactions page
  dateContainer: ".apx-transaction-date-container",
  lineItem: ".apx-transactions-line-item-component-container",
  amountSpan: ".a-span3 span, .a-text-right span",
  orderLink: "a[href*='orderID=']",
  nextPageButton:
    'span.a-button:not(.a-button-disabled) input[type="submit"][aria-labelledby]',

  // Order detail page (summary)
  itemBoxPrimary: ".a-fixed-left-grid-inner",
  itemBoxFallback: ".a-fixed-left-grid.item-box, .shipment .a-fixed-left-grid, [class*='od-item'], .yo-item",
  productLink: "a[href*='/dp/'], a[href*='/gp/product/']",
  priceEl: "[data-component='unitPrice'] .a-offscreen, .a-color-price",
  priceFallback: ".a-text-price .a-offscreen, [class*='price']",
  quantityFallback: "[data-component='quantity'], [class*='quantity'], [class*='qty']",

  // Grocery order detection (on summary page)
  groceryProgressTracker: "#f3_food_ProgressTracker",

  // Itemmod page (grocery item list).
  // Each item row is `<div id="<ASIN>-item-grid-row" role="row">`; the line
  // total is `<span id="<ASIN>-item-total-price">`. The id-ends-with form
  // skips the column-header row (which lacks an id) and the divider <hr>
  // elements (which end with `-item-grid-divider`).
  itemmodItemRow: "[id$='-item-grid-row']",
  itemmodLineTotal: "[id$='-item-total-price']",
} as const;

export const ASIN_REGEX = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/;
export const AUTH_PAGE_REGEX = /\/ap\/(signin|challenge|cvf)\//i;

export const TRANSACTIONS_URL =
  "https://www.amazon.com/cpe/yourpayments/transactions";

export function orderDetailUrl(orderId: string): string {
  return `https://www.amazon.com/gp/css/summary/edit.html?orderID=${encodeURIComponent(orderId)}`;
}

export function itemmodUrl(orderId: string): string {
  return `https://www.amazon.com/uff/your-account/order-details?orderID=${encodeURIComponent(orderId)}&page=itemmod`;
}
