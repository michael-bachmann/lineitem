// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from "vitest";
import { parseTargetDate, parseCents, isLoginUrl } from "./selectors";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("parseTargetDate", () => {
  it("parses abbreviated month", () => {
    expect(parseTargetDate("Jun 4, 2026")).toBe("2026-06-04");
  });
  it("parses full month", () => {
    expect(parseTargetDate("June 4, 2026")).toBe("2026-06-04");
  });
  it("parses weekday-prefixed date", () => {
    expect(parseTargetDate("Thu, Jun 4, 2026")).toBe("2026-06-04");
  });
  it("strips the Invoice date label", () => {
    expect(parseTargetDate("Invoice date: August 23, 2025")).toBe("2025-08-23");
  });
  it("returns empty string when unparseable", () => {
    expect(parseTargetDate("yesterday")).toBe("");
  });
});

describe("parseCents", () => {
  it("parses a positive dollar amount", () => {
    expect(parseCents("$18.59")).toBe(1859);
  });
  it("parses a negative amount as absolute cents", () => {
    expect(parseCents("$-40.00")).toBe(4000);
  });
});

describe("isLoginUrl", () => {
  it("detects the Target login redirect", () => {
    expect(isLoginUrl("https://www.target.com/login?client_id=ecom-web-1.0.0")).toBe(true);
  });
  it("returns false for the orders page", () => {
    expect(isLoginUrl("https://www.target.com/orders")).toBe(false);
  });
});

import {
  parseOrdersFromDocument, parseInvoicesListFromDocument, parseInvoiceDetailFromDocument, parseOrderImageMap,
  parseStoreOrdersFromDocument, parseStorePurchaseDetailFromDocument,
} from "./scraper";

describe("parseOrdersFromDocument", () => {
  // Mirrors the REAL Target /orders markup: `order-details-link` is a <div>
  // card wrapper (not an <a>); the order anchor lives inside it, the date is a
  // <p>, and the "#{orderId}" line also appears in the card text.
  it("extracts orderId and date for each order card", () => {
    document.body.innerHTML = `
      <div id="912003510147483">
        <div class="styles_orderCard__AT6kC">
          <div data-test="order-details-link">
            <div class="h-display-flex">
              <p class="h-text-bold h-text-lg">Jun 4, 2026</p>
              <a aria-label="View purchase made on Jun 4, 2026 for $37.18"
                 href="/orders/912003510147483">View purchase</a>
            </div>
            <p>$37.18 · 2 packages</p>
            <p>#912003510147483</p>
          </div>
        </div>
      </div>
      <div id="902003493044907">
        <div class="styles_orderCard__AT6kC">
          <div data-test="order-details-link">
            <div class="h-display-flex">
              <p class="h-text-bold h-text-lg">May 25, 2026</p>
              <a aria-label="View purchase made on May 25, 2026 for $12.00"
                 href="/orders/902003493044907">View purchase</a>
            </div>
            <p>$12.00 · 1 package</p>
            <p>#902003493044907</p>
          </div>
        </div>
      </div>
    `;
    expect(parseOrdersFromDocument(document)).toEqual([
      { orderId: "912003510147483", date: "2026-06-04", orderTotalCents: 3718 },
      { orderId: "902003493044907", date: "2026-05-25", orderTotalCents: 1200 },
    ]);
  });

  it("dedupes if the same order card appears twice; null total when none shown", () => {
    document.body.innerHTML = `
      <div data-test="order-details-link">
        <p class="h-text-bold h-text-lg">Jun 4, 2026</p>
        <a href="/orders/111">View purchase</a>
      </div>
      <div data-test="order-details-link">
        <p class="h-text-bold h-text-lg">Jun 4, 2026</p>
        <a href="/orders/111">View purchase</a>
      </div>
    `;
    expect(parseOrdersFromDocument(document)).toEqual([
      { orderId: "111", date: "2026-06-04", orderTotalCents: null },
    ]);
  });
});

describe("parseInvoicesListFromDocument", () => {
  it("parses purchase and refund rows with id, date, amount, and isRefund", () => {
    document.body.innerHTML = `
      <div>
        <div class="styles_invoiceListGrid__B_fTC">
          <div class="h-text-bold">Invoice 1 of 2</div>
          <div>Invoice date: July 28, 2025</div>
          <span class="h-text-bold">$23.04</span>
          <a href="/orders/902002727679794/invoices/111">View invoice</a>
        </div>
        <div class="styles_invoiceListGrid__B_fTC">
          <div class="h-text-bold">Refund 1 of 1</div>
          <div>Invoice date: August 23, 2025</div>
          <span class="h-text-bold">$43.90</span>
          <a href="/orders/902002727679794/invoices/5235329400738320">View invoice</a>
        </div>
      </div>
    `;
    expect(parseInvoicesListFromDocument(document)).toEqual([
      { invoiceId: "111", date: "2025-07-28", amountCents: 2304, isRefund: false },
      { invoiceId: "5235329400738320", date: "2025-08-23", amountCents: 4390, isRefund: true },
    ]);
  });
});

describe("parseInvoiceDetailFromDocument", () => {
  it("parses a single-card purchase invoice", () => {
    document.body.innerHTML = `
      <div>
        <h2>Invoice 1 of 2</h2>
        <div class="styles_infoRow__k6eLr">
          <div><p>Item</p><b><p>90571485 - Esembly Cloth Diaper Outer - Size 2</p></b></div>
          <div class="styles_spaceBetweenDiv__bpE2M">
            <div data-test="item-quantity"><div>Qty.</div><div><b>1</b></div></div>
            <div>Unit price<b>$18.59</b></div>
            <div>Amount<b>$18.59</b></div>
          </div>
        </div>
        <div class="styles_detailsRowWrapper__QJjoS"><div><b>Invoice total</b></div><p><b>$18.59</b></p></div>
        <div class="styles_detailsRowWrapper__QJjoS">
          <div class="styles_paymentIconWrapper__vGppy"></div>
          <div class="styles_cardNumberWrapper__vHhvb">American Express*1014</div>
        </div>
      </div>
    `;
    expect(parseInvoiceDetailFromDocument(document)).toEqual({
      isRefund: false,
      items: [
        { productId: "90571485", title: "Esembly Cloth Diaper Outer - Size 2",
          unitPriceCents: 1859, quantity: 1, amountCents: 1859 },
      ],
      itemSubtotalCents: 1859,
      invoiceTotalCents: 1859,
      paymentLines: [
        { cardLabel: "American Express*1014", isGiftCard: false, amountCents: 1859 },
      ],
    });
  });

  it("parses a refund invoice split across a card and a gift card", () => {
    document.body.innerHTML = `
      <div>
        <h2>Refund 1 of 1</h2>
        <div class="styles_infoRow__k6eLr">
          <div><p>Item</p><b><p>93891638 - Crinkle Maternity Swimsuit Black XL</p></b></div>
          <div class="styles_spaceBetweenDiv__bpE2M">
            <div data-test="item-quantity"><div>Qty.</div><div><b>1</b></div></div>
            <div>Unit price<b>$-40.00</b></div>
            <div>Amount<b>$-40.00</b></div>
          </div>
        </div>
        <div class="styles_detailsRowWrapper__QJjoS"><div>Total refund</div><p><b>$43.90</b></p></div>
        <div class="styles_detailsRowWrapper__QJjoS">
          <div class="styles_paymentIconWrapper__vGppy"></div>
          <div class="styles_cardNumberWrapper__vHhvb">Visa*6523</div><span>$28.90</span>
        </div>
        <div class="styles_detailsRowWrapper__QJjoS">
          <div class="styles_paymentIconWrapper__vGppy"></div>
          <div class="styles_cardNumberWrapper__vHhvb">Target GiftCard</div><span>$15.00</span>
        </div>
      </div>
    `;
    expect(parseInvoiceDetailFromDocument(document)).toEqual({
      isRefund: true,
      items: [
        { productId: "93891638", title: "Crinkle Maternity Swimsuit Black XL",
          unitPriceCents: 4000, quantity: 1, amountCents: 4000 },
      ],
      itemSubtotalCents: 4000,
      invoiceTotalCents: 4390,
      paymentLines: [
        { cardLabel: "Visa*6523", isGiftCard: false, amountCents: 2890 },
        { cardLabel: "Target GiftCard", isGiftCard: true, amountCents: 1500 },
      ],
    });
  });

  it("drops a $0 stub item card but keeps its fee in the invoice-total gap", () => {
    // Target attaches a "Bag fee" to a $0 "PAPER_BAG" item card. The card parses
    // as a $0 line; we drop it (it would only add a $0 line to categorize). The
    // $0.30 fee lives outside the parsed item amount, so it stays in the gap
    // between itemSubtotalCents and invoiceTotalCents and rides onto real items.
    document.body.innerHTML = `
      <div>
        <h2>Invoice 1 of 1</h2>
        <div class="styles_infoRow__k6eLr">
          <div><b><p>12952961 - Sprite Zero Soda - 12pk/12 fl oz Cans</p></b></div>
          <div class="styles_spaceBetweenDiv__bpE2M">
            <div data-test="item-quantity"><div>Qty.</div><div><b>1</b></div></div>
            <div>Unit price<b>$8.89</b></div>
            <div>Amount<b>$8.89</b></div>
          </div>
        </div>
        <div class="styles_infoRow__k6eLr">
          <div><b><p>47750281 - PAPER_BAG</p></b></div>
          <div class="styles_spaceBetweenDiv__bpE2M">
            <div data-test="item-quantity"><div>Qty.</div><div><b>3</b></div></div>
            <div>Unit price<b>$0.00</b></div>
            <div>Amount<b>$0.00</b></div>
          </div>
        </div>
        <div class="styles_detailsWrapper__FxR5V">
          <div class="styles_detailsRowWrapper__QJjoS"><div>Bag fee</div><p>$0.30</p></div>
        </div>
        <div class="styles_detailsRowWrapper__QJjoS"><div><b>Invoice total</b></div><p><b>$9.19</b></p></div>
      </div>
    `;
    const result = parseInvoiceDetailFromDocument(document);
    expect(result.items).toEqual([
      { productId: "12952961", title: "Sprite Zero Soda - 12pk/12 fl oz Cans",
        unitPriceCents: 889, quantity: 1, amountCents: 889 },
    ]);
    expect(result.itemSubtotalCents).toBe(889);
    expect(result.invoiceTotalCents).toBe(919);
  });

  it("parses a promotional-gift-card invoice line item", () => {
    document.body.innerHTML = `
      <div>
        <h2>Invoice 1 of 2</h2>
        <div class="styles_infoRow__k6eLr">
          <div><p>Item</p><b><p>14713509 - Promotional Email GiftCard $10</p></b></div>
          <div class="styles_spaceBetweenDiv__bpE2M">
            <div data-test="item-quantity"><div>Qty.</div><div><b>1</b></div></div>
            <div>Unit price<b>$10.00</b></div>
            <div>Amount<b>$10.00</b></div>
          </div>
        </div>
        <div class="styles_detailsRowWrapper__QJjoS"><div>Invoice total</div><p><b>$10.00</b></p></div>
        <div class="styles_detailsRowWrapper__QJjoS">
          <div class="styles_paymentIconWrapper__vGppy"></div>
          <div class="styles_cardNumberWrapper__vHhvb">Visa*7582</div>
        </div>
      </div>
    `;
    const result = parseInvoiceDetailFromDocument(document);
    expect(result.items).toEqual([
      { productId: "14713509", title: "Promotional Email GiftCard $10",
        unitPriceCents: 1000, quantity: 1, amountCents: 1000 },
    ]);
    expect(result.invoiceTotalCents).toBe(1000);
    expect(result.paymentLines).toEqual([
      { cardLabel: "Visa*7582", isGiftCard: false, amountCents: 1000 },
    ]);
  });
});

describe("parseOrderImageMap", () => {
  // Real structure: a `package-card-item-row` is a PACKAGE that can hold many
  // items, each in its own item card (one picture + one h3). The map must bind
  // each item to ITS OWN image, not the first image in the package.
  it("maps each item to its own image when several share one package row", () => {
    document.body.innerHTML = `
      <div data-test="package-card-item-row">
        <div class="styles_packageCardItemWrapper__vGcBI">
          <div class="styles_styledPackageItem__Uez2M">
            <div class="styles_styledMinWidth__VT3Mr">
              <div class="styles_pictureWrapper__nFVTN">
                <picture><img src="https://target.scene7.com/is/image/Target/GUEST_AAA?wid=160" alt="a" /></picture>
              </div>
              <div class="styles_styledMinWidth__VT3Mr"><h3 id="item-90571485">Diaper</h3></div>
            </div>
          </div>
        </div>
        <div class="styles_packageCardItemWrapper__vGcBI">
          <div class="styles_styledPackageItem__Uez2M">
            <div class="styles_styledMinWidth__VT3Mr">
              <div class="styles_pictureWrapper__nFVTN">
                <picture><img src="https://target.scene7.com/is/image/Target/GUEST_BBB?wid=160" alt="b" /></picture>
              </div>
              <div class="styles_styledMinWidth__VT3Mr"><h3 id="item-83710567">Wipes</h3></div>
            </div>
          </div>
        </div>
      </div>
    `;
    expect(parseOrderImageMap(document)).toEqual({
      "90571485": "https://target.scene7.com/is/image/Target/GUEST_AAA?wid=160",
      "83710567": "https://target.scene7.com/is/image/Target/GUEST_BBB?wid=160",
    });
  });

  // Robustness: even if Target flattens the per-item wrapper to bare siblings
  // (image then title, repeated), each title still pairs with its own image.
  it("pairs each item with its preceding image even as flat siblings", () => {
    document.body.innerHTML = `
      <div data-test="package-card-item-row">
        <img src="https://target.scene7.com/is/image/Target/GUEST_AAA?wid=160" alt="a" />
        <h3 id="item-90571485">Diaper</h3>
        <img src="https://target.scene7.com/is/image/Target/GUEST_BBB?wid=160" alt="b" />
        <h3 id="item-83710567">Wipes</h3>
      </div>
    `;
    expect(parseOrderImageMap(document)).toEqual({
      "90571485": "https://target.scene7.com/is/image/Target/GUEST_AAA?wid=160",
      "83710567": "https://target.scene7.com/is/image/Target/GUEST_BBB?wid=160",
    });
  });
});

describe("parseStoreOrdersFromDocument", () => {
  // Mirrors the REAL Target /orders in-store-tab markup: `store-order-details-link`
  // is a <div> card wrapper (not an <a>), same shape as the online orders list.
  it("extracts receiptId, date, and total for each in-store purchase card", () => {
    document.body.innerHTML = `
      <div class="styles_orderCard__AT6kC">
        <div data-test="store-order-details-link">
          <div class="h-display-flex h-flex-justify-space-between">
            <p class="h-text-bold h-text-lg">Aug 23, 2026</p>
            <a href="/orders/stores/6235-0067-0161-8120">View purchase</a>
          </div>
          <p>$302.11</p>
          <p>Purchased</p>
          <p>Store trip at Plano</p>
        </div>
      </div>
      <div class="styles_orderCard__AT6kC">
        <div data-test="store-order-details-link">
          <div class="h-display-flex h-flex-justify-space-between">
            <p class="h-text-bold h-text-lg">Aug 21, 2026</p>
            <a href="/orders/stores/6235-0065-0138-4471">View purchase</a>
          </div>
          <p>$59.74</p>
          <p>Purchased</p>
          <p>Store trip at North Dallas Colt Road</p>
        </div>
      </div>
    `;
    expect(parseStoreOrdersFromDocument(document)).toEqual([
      { receiptId: "6235-0067-0161-8120", date: "2026-08-23", totalCents: 30211, isRefund: false },
      { receiptId: "6235-0065-0138-4471", date: "2026-08-21", totalCents: 5974, isRefund: false },
    ]);
  });

  it("dedupes if the same card appears twice; null total when none shown", () => {
    document.body.innerHTML = `
      <div class="styles_orderCard__AT6kC">
        <div data-test="store-order-details-link">
          <p class="h-text-bold h-text-lg">Aug 23, 2026</p>
          <a href="/orders/stores/6235-0067-0161-8120">View purchase</a>
        </div>
        <p>Purchased</p>
      </div>
      <div class="styles_orderCard__AT6kC">
        <div data-test="store-order-details-link">
          <p class="h-text-bold h-text-lg">Aug 23, 2026</p>
          <a href="/orders/stores/6235-0067-0161-8120">View purchase</a>
        </div>
        <p>Purchased</p>
      </div>
    `;
    expect(parseStoreOrdersFromDocument(document)).toEqual([
      { receiptId: "6235-0067-0161-8120", date: "2026-08-23", totalCents: null, isRefund: false },
    ]);
  });

  it("keeps isRefund false for a receipt later partially returned (card shows both 'Purchased' and 'Return complete')", () => {
    // Live-verified on /orders/stores/6097-1430-0171-4403: the list card's
    // total is still the FULL original purchase, not netted against the
    // return, so this card must stay on the purchase side for list-total
    // matching — "Return complete" text alone doesn't make the list entry a
    // refund (see STORE_LIST_PURCHASED_RE's comment in scraper.ts).
    document.body.innerHTML = `
      <div class="styles_orderCard__AT6kC">
        <div data-test="store-order-details-link">
          <p class="h-text-bold h-text-lg">Apr 7, 2026</p>
          <a href="/orders/stores/6097-1430-0171-4403">View purchase</a>
        </div>
        <p>$100.65</p>
        <p>Return complete</p>
        <p>Purchased</p>
        <p>Store trip at Richardson Sq Mall</p>
      </div>
    `;
    expect(parseStoreOrdersFromDocument(document)).toEqual([
      { receiptId: "6097-1430-0171-4403", date: "2026-04-07", totalCents: 10065, isRefund: false },
    ]);
  });
});

describe("parseStorePurchaseDetailFromDocument", () => {
  // Real structure confirmed live: an in-store receipt's item cards reuse the
  // exact same "package item" component as the online order-detail image map
  // (`h3[id^="item-"]`), plus an `[data-test="order-price"]` price and a plain
  // "Qty {n}" text line, all inside a `.styles_packageCardItemsSection__wnwnv`
  // section with its own `<h2>` — one section for a pure receipt, two for a
  // mixed purchase+return receipt. A page-level "Purchased on {date, with
  // year}" / "Refund issued on {date, with year}" line (live-verified;
  // outside the section markup) is each section's own date — the section's
  // own heading block never includes a year.
  it("parses a single-item purchase with items, total, one payment line, and its own date", () => {
    document.body.innerHTML = `
      <div class="styles_packageCardItemsSection__wnwnv">
        <h2><span>Purchased</span></h2>
        <div class="styles_styledPackageItem__Uez2M">
          <div class="styles_pictureWrapper__nFVTN">
            <picture><img src="https://target.scene7.com/is/image/Target/GUEST_AAA?wid=160" /></picture>
          </div>
          <h3 id="item-16291865">40ct Tissue Paper White - Spritz&#8482;</h3>
          <p class="h-text-md"><span data-test="order-price">$4.00</span></p>
          <p class="h-text-sm">Qty 1</p>
        </div>
      </div>
      <div class="h-text-sm">Purchased on April 7, 2026 6:23 PM</div>
      <span data-test="grand-total">$4.00</span>
      <div class="styles_cardListWrapper__3Z6EW">
        <div class="h-display-flex">Visa *9961</div>
      </div>
    `;
    expect(parseStorePurchaseDetailFromDocument(document)).toEqual({
      sections: [
        {
          isRefund: false,
          date: "2026-04-07",
          items: [
            { productId: "16291865", title: "40ct Tissue Paper White - Spritz™",
              unitPriceCents: 400, quantity: 1, amountCents: 400 },
          ],
          itemSubtotalCents: 400,
        },
      ],
      invoiceTotalCents: 400,
      paymentLines: [
        { cardLabel: "Visa *9961", isGiftCard: false, amountCents: 400 },
      ],
    });
  });

  it("parses multiple items and multiplies unit price by quantity", () => {
    document.body.innerHTML = `
      <div class="styles_packageCardItemsSection__wnwnv">
        <h2><span>Purchased</span></h2>
        <div class="styles_styledPackageItem__Uez2M">
          <h3 id="item-11111111">Item One</h3>
          <p><span data-test="order-price">$3.00</span></p>
          <p class="h-text-sm">Qty 2</p>
        </div>
        <div class="styles_styledPackageItem__Uez2M">
          <h3 id="item-22222222">Item Two</h3>
          <p><span data-test="order-price">$5.00</span></p>
          <p class="h-text-sm">Qty 1</p>
        </div>
      </div>
      <span data-test="grand-total">$11.00</span>
      <div class="styles_cardListWrapper__3Z6EW">
        <div class="h-display-flex">Visa *9961$11.00</div>
      </div>
    `;
    const result = parseStorePurchaseDetailFromDocument(document);
    expect(result.sections[0].items).toEqual([
      { productId: "11111111", title: "Item One", unitPriceCents: 300, quantity: 2, amountCents: 600 },
      { productId: "22222222", title: "Item Two", unitPriceCents: 500, quantity: 1, amountCents: 500 },
    ]);
    expect(result.sections[0].itemSubtotalCents).toBe(1100);
    expect(result.invoiceTotalCents).toBe(1100);
    expect(result.paymentLines).toEqual([
      { cardLabel: "Visa *9961", isGiftCard: false, amountCents: 1100 },
    ]);
  });

  it("parses a receipt split across a card and a gift card", () => {
    document.body.innerHTML = `
      <div class="styles_packageCardItemsSection__wnwnv">
        <h2><span>Purchased</span></h2>
        <div class="styles_styledPackageItem__Uez2M">
          <h3 id="item-33333333">Split Item</h3>
          <p><span data-test="order-price">$20.00</span></p>
          <p class="h-text-sm">Qty 1</p>
        </div>
      </div>
      <span data-test="grand-total">$20.00</span>
      <div class="styles_cardListWrapper__3Z6EW">
        <div class="h-display-flex">Visa *9961$15.00</div>
        <div class="h-display-flex">Target GiftCard$5.00</div>
      </div>
    `;
    const result = parseStorePurchaseDetailFromDocument(document);
    expect(result.paymentLines).toEqual([
      { cardLabel: "Visa *9961", isGiftCard: false, amountCents: 1500 },
      { cardLabel: "Target GiftCard", isGiftCard: true, amountCents: 500 },
    ]);
  });

  it("skips a $0 stub item card", () => {
    document.body.innerHTML = `
      <div class="styles_packageCardItemsSection__wnwnv">
        <h2><span>Purchased</span></h2>
        <div class="styles_styledPackageItem__Uez2M">
          <h3 id="item-44444444">Real Item</h3>
          <p><span data-test="order-price">$8.89</span></p>
          <p class="h-text-sm">Qty 1</p>
        </div>
        <div class="styles_styledPackageItem__Uez2M">
          <h3 id="item-55555555">Free Bag</h3>
          <p><span data-test="order-price">$0.00</span></p>
          <p class="h-text-sm">Qty 1</p>
        </div>
      </div>
      <span data-test="grand-total">$8.89</span>
    `;
    const result = parseStorePurchaseDetailFromDocument(document);
    expect(result.sections[0].items).toEqual([
      { productId: "44444444", title: "Real Item", unitPriceCents: 889, quantity: 1, amountCents: 889 },
    ]);
  });

  it("marks a refund from the heading (literal 'Refunded')", () => {
    document.body.innerHTML = `
      <div class="styles_packageCardItemsSection__wnwnv">
        <h2><span>Refunded</span></h2>
        <div class="styles_styledPackageItem__Uez2M">
          <h3 id="item-66666666">Returned Item</h3>
          <p><span data-test="order-price">$12.00</span></p>
          <p class="h-text-sm">Qty 1</p>
        </div>
      </div>
      <span data-test="grand-total">$12.00</span>
    `;
    expect(parseStorePurchaseDetailFromDocument(document).sections[0].isRefund).toBe(true);
  });

  it("marks a pure return from the live heading text ('Return complete') and its own dated line", () => {
    document.body.innerHTML = `
      <div class="styles_packageCardItemsSection__wnwnv">
        <h2><span>Return complete</span></h2>
        <div class="styles_styledPackageItem__Uez2M">
          <h3 id="item-77777777">Returned Item</h3>
          <p><span data-test="order-price">$12.00</span></p>
          <p class="h-text-sm">Qty 1</p>
        </div>
      </div>
      <div class="h-text-bold">Refund issued on May 3, 2026</div>
      <span data-test="grand-total">$12.00</span>
    `;
    const result = parseStorePurchaseDetailFromDocument(document);
    expect(result.sections).toEqual([
      {
        isRefund: true,
        date: "2026-05-03",
        items: [
          { productId: "77777777", title: "Returned Item", unitPriceCents: 1200, quantity: 1, amountCents: 1200 },
        ],
        itemSubtotalCents: 1200,
      },
    ]);
  });

  it("parses a MIXED receipt: two sections, own items/dates/directions, one blended total", () => {
    // Shape confirmed live on receipt /orders/stores/6097-1430-0171-4403: a
    // purchase and a later return bundled under one receipt URL, with only
    // one blended Subtotal/Tax/Total for both.
    document.body.innerHTML = `
      <div class="styles_packageCardItemsSection__wnwnv">
        <h2><span>Purchased</span></h2>
        <div class="styles_styledPackageItem__Uez2M">
          <h3 id="item-94854166">6'' Bagel and Lox Plush</h3>
          <p><span data-test="order-price">$2.50</span></p>
          <p class="h-text-sm">Qty 1</p>
        </div>
        <div class="styles_styledPackageItem__Uez2M">
          <h3 id="item-94226156">Graphic T-Shirt</h3>
          <p><span data-test="order-price">$14.00</span></p>
          <p class="h-text-sm">Qty 1</p>
        </div>
      </div>
      <div class="h-text-sm">Purchased on April 7, 2026 6:23 PM</div>
      <div class="styles_packageCardItemsSection__wnwnv">
        <h2><span>Return complete</span></h2>
        <div class="styles_styledPackageItem__Uez2M">
          <h3 id="item-11223344">Returned Widget</h3>
          <p><span data-test="order-price">$62.50</span></p>
          <p class="h-text-sm">Qty 1</p>
        </div>
        <div class="h-text-bold">Refund issued on May 3, 2026</div>
      </div>
      <span data-test="grand-total">$100.65</span>
    `;
    const result = parseStorePurchaseDetailFromDocument(document);
    expect(result.sections).toEqual([
      {
        isRefund: false,
        date: "2026-04-07",
        items: [
          { productId: "94854166", title: "6'' Bagel and Lox Plush", unitPriceCents: 250, quantity: 1, amountCents: 250 },
          { productId: "94226156", title: "Graphic T-Shirt", unitPriceCents: 1400, quantity: 1, amountCents: 1400 },
        ],
        itemSubtotalCents: 1650,
      },
      {
        isRefund: true,
        date: "2026-05-03",
        items: [
          { productId: "11223344", title: "Returned Widget", unitPriceCents: 6250, quantity: 1, amountCents: 6250 },
        ],
        itemSubtotalCents: 6250,
      },
    ]);
    expect(result.invoiceTotalCents).toBe(10065);
  });
});
