export const SELECTORS = {
  // Transactions page
  dateContainer: ".apx-transaction-date-container",
  lineItem: ".apx-transactions-line-item-component-container",
  amountSpan: ".a-span3 span, .a-text-right span",
  orderLink: "a[href*='orderID=']",
  cardSpan: ".a-span9 span",
  nextPageButton:
    'span.a-button:not(.a-button-disabled) input[type="submit"][aria-labelledby]',

  // Order detail page
  itemBoxPrimary: ".a-fixed-left-grid.item-box, .shipment .a-fixed-left-grid",
  itemBoxFallback: "[class*='od-item'], .yo-item",
  productLink: "a[href*='/dp/'], a[href*='/gp/product/']",
  priceEl: ".a-color-price",
  priceFallback: "[class*='price'], .a-color-price",
  quantityFallback: "[class*='quantity'], [class*='qty']",
} as const;

export const ASIN_REGEX = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/;
export const AUTH_PAGE_REGEX = /\/ap\/(signin|challenge|cvf)\//i;

export const TRANSACTIONS_URL =
  "https://www.amazon.com/cpe/yourpayments/transactions";

export function orderDetailUrl(orderId: string): string {
  return `https://www.amazon.com/gp/css/summary/edit.html?orderID=${encodeURIComponent(orderId)}`;
}
