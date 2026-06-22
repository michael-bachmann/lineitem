import { describe, expect, it } from "vitest";
import {
  detectTargetPageKind,
  targetOrderIdFromUrl,
  targetInvoiceIdFromUrl,
  ordersFingerprint,
} from "./page";
import type { RawTargetOrder } from "./scraper";

const B = "https://www.target.com";

describe("detectTargetPageKind", () => {
  it("classifies the orders list", () => {
    expect(detectTargetPageKind(`${B}/orders`)).toBe("orders");
  });

  it("classifies the order detail page (used for the image map)", () => {
    expect(detectTargetPageKind(`${B}/orders/123`)).toBe("order-images");
  });

  it("classifies the invoices list", () => {
    expect(detectTargetPageKind(`${B}/orders/123/invoices`)).toBe("invoices");
  });

  it("classifies the invoice detail page", () => {
    expect(detectTargetPageKind(`${B}/orders/123/invoices/456`)).toBe("invoice-detail");
  });

  it("classifies any sign-in page as login (so a step-up surfaces as a result)", () => {
    expect(detectTargetPageKind(`${B}/login?ref=orders`)).toBe("login");
  });

  it("falls back to other for unrelated pages and bad input", () => {
    expect(detectTargetPageKind(`${B}/cart`)).toBe("other");
    expect(detectTargetPageKind("not a url")).toBe("other");
  });
});

describe("targetOrderIdFromUrl / targetInvoiceIdFromUrl", () => {
  it("extracts the order id from any /orders/{id}/... URL", () => {
    expect(targetOrderIdFromUrl(`${B}/orders/123`)).toBe("123");
    expect(targetOrderIdFromUrl(`${B}/orders/123/invoices/456`)).toBe("123");
  });

  it("extracts the invoice id only from an invoice-detail URL", () => {
    expect(targetInvoiceIdFromUrl(`${B}/orders/123/invoices/456`)).toBe("456");
    expect(targetInvoiceIdFromUrl(`${B}/orders/123/invoices`)).toBe("");
    expect(targetInvoiceIdFromUrl(`${B}/orders/123`)).toBe("");
  });

  it("returns empty string for non-order URLs", () => {
    expect(targetOrderIdFromUrl(`${B}/cart`)).toBe("");
    expect(targetInvoiceIdFromUrl("nonsense")).toBe("");
  });
});

describe("ordersFingerprint", () => {
  const order = (id: string): RawTargetOrder => ({ orderId: id, date: "2026-06-01", orderTotalCents: 1000 });

  it("changes when Load more appends orders (so growth is detectable)", () => {
    const before = [order("A"), order("B")];
    const after = [order("A"), order("B"), order("C")];
    expect(ordersFingerprint(before)).not.toBe(ordersFingerprint(after));
  });

  it("is stable for the same cumulative list (a re-render isn't mistaken for growth)", () => {
    const list = [order("A"), order("B")];
    expect(ordersFingerprint(list)).toBe(ordersFingerprint([...list]));
  });
});
