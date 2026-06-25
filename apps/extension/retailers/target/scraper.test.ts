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

import { parseOrdersFromDocument, parseInvoicesListFromDocument, parseInvoiceDetailFromDocument, parseOrderImageMap } from "./scraper";

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
