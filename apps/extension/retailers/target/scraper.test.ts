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

import { parseOrdersFromDocument, parseInvoicesListFromDocument, parseInvoiceDetailFromDocument } from "./scraper";

describe("parseOrdersFromDocument", () => {
  it("extracts orderId and date for each order card", () => {
    document.body.innerHTML = `
      <div>
        <div class="order-card">
          <div>Jun 4, 2026</div>
          <a data-test="order-details-link" href="/orders/912003510147483">View order</a>
        </div>
        <div class="order-card">
          <div>May 25, 2026</div>
          <a data-test="order-details-link" href="/orders/902003493044907">View order</a>
        </div>
      </div>
    `;
    expect(parseOrdersFromDocument(document)).toEqual([
      { orderId: "912003510147483", date: "2026-06-04" },
      { orderId: "902003493044907", date: "2026-05-25" },
    ]);
  });

  it("ignores invoice links and dedupes repeated order links", () => {
    document.body.innerHTML = `
      <div class="order-card">
        <div>Jun 4, 2026</div>
        <a data-test="order-details-link" href="/orders/111">a</a>
        <a data-test="order-details-link" href="/orders/111">b</a>
      </div>
    `;
    expect(parseOrdersFromDocument(document)).toEqual([
      { orderId: "111", date: "2026-06-04" },
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
