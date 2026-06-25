import { describe, expect, it } from "vitest";
import {
  detectAmazonPageKind,
  transactionsFingerprint,
  orderIdFromUrl,
} from "./page";
import type { RawTransaction } from "./scraper";

describe("detectAmazonPageKind", () => {
  it("classifies the transactions list", () => {
    expect(detectAmazonPageKind("https://www.amazon.com/cpe/yourpayments/transactions")).toBe(
      "transactions",
    );
  });

  it("classifies the order summary page", () => {
    expect(
      detectAmazonPageKind("https://www.amazon.com/gp/css/summary/edit.html?orderID=111-222"),
    ).toBe("order-summary");
  });

  it("classifies the itemmod page (grocery items) even though it also carries orderID", () => {
    expect(
      detectAmazonPageKind(
        "https://www.amazon.com/uff/your-account/order-details?orderID=111-222&page=itemmod",
      ),
    ).toBe("itemmod");
  });

  it("classifies the Fresh (/uff) order-details page as the order summary", () => {
    // Grocery orders redirect here from /gp/css/summary/edit; the page carries
    // the subtotal and the line items inline.
    expect(
      detectAmazonPageKind(
        "https://www.amazon.com/uff/your-account/order-details/ref=ppx_hzod_rd_dt_b_fresh_uff_rd?_encoding=UTF8&orderID=111-222",
      ),
    ).toBe("order-summary");
  });

  it("classifies the Fresh /item-details subpath as the itemmod item list", () => {
    expect(
      detectAmazonPageKind(
        "https://www.amazon.com/uff/your-account/order-details/item-details?orderID=111-222",
      ),
    ).toBe("itemmod");
  });

  it("classifies any auth/step-up page as login, regardless of other path matches", () => {
    expect(detectAmazonPageKind("https://www.amazon.com/ap/signin?openid=...")).toBe("login");
    expect(detectAmazonPageKind("https://www.amazon.com/ap/challenge")).toBe("login");
  });

  it("falls back to other for unrelated pages and unparseable input", () => {
    expect(detectAmazonPageKind("https://www.amazon.com/dp/B0XXXX")).toBe("other");
    expect(detectAmazonPageKind("not a url")).toBe("other");
  });
});

describe("transactionsFingerprint", () => {
  const tx = (over: Partial<RawTransaction>): RawTransaction => ({
    date: "2026-06-01",
    amountCents: 1000,
    orderId: null,
    isRefund: false,
    ...over,
  });

  it("changes when the page's rows change (so a real page turn is detectable)", () => {
    const page1 = [tx({ orderId: "A" }), tx({ orderId: "B" })];
    const page2 = [tx({ orderId: "C" }), tx({ orderId: "D" })];
    expect(transactionsFingerprint(page1)).not.toBe(transactionsFingerprint(page2));
  });

  it("is stable for the same rows (so a re-render isn't mistaken for a new page)", () => {
    const rows = [tx({ orderId: "A" }), tx({ orderId: "B" })];
    expect(transactionsFingerprint(rows)).toBe(transactionsFingerprint([...rows]));
  });

  it("distinguishes order-less rows by date+amount", () => {
    const a = [tx({ date: "2026-06-01", amountCents: 500 })];
    const b = [tx({ date: "2026-06-02", amountCents: 500 })];
    expect(transactionsFingerprint(a)).not.toBe(transactionsFingerprint(b));
  });
});

describe("orderIdFromUrl", () => {
  it("extracts the orderID query param", () => {
    expect(orderIdFromUrl("https://www.amazon.com/gp/css/summary/edit.html?orderID=111-222")).toBe(
      "111-222",
    );
  });

  it("returns empty string when absent or unparseable", () => {
    expect(orderIdFromUrl("https://www.amazon.com/cpe/yourpayments/transactions")).toBe("");
    expect(orderIdFromUrl("nonsense")).toBe("");
  });
});
