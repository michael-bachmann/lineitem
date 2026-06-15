import { describe, expect, it, vi } from "vitest";
import {
  orderMightMatch, invoiceMightSplitMatch, readWithRetry, unwrap, StepUpRequired,
} from "./adapter";
import type { RawTargetOrder, RawTargetInvoice } from "./scraper";
import type { YnabCharge } from "@/lib/types";

const charge = (over: Partial<YnabCharge>): YnabCharge => ({
  ynabTransactionId: "tx", date: "2025-07-03", amountCents: 1000,
  payeeName: "TARGET", isRefund: false, ...over,
});

describe("orderMightMatch", () => {
  const order: RawTargetOrder = { orderId: "o1", date: "2025-07-01", orderTotalCents: 5000 };

  it("keeps a purchase charge within the placed-date window and under the total", () => {
    expect(orderMightMatch(order, [charge({ date: "2025-07-03", amountCents: 1000 })])).toBe(true);
  });

  it("skips a purchase charge more than 45 days after the order", () => {
    expect(orderMightMatch(order, [charge({ date: "2025-09-01" })])).toBe(false);
  });

  it("KEEPS a refund posting long after the order (returns process arbitrarily late)", () => {
    // The bug this guards: refunds were upper-bounded like purchases and dropped.
    expect(orderMightMatch(order, [charge({ date: "2025-09-29", isRefund: true })])).toBe(true);
  });

  it("skips a charge larger than the order total", () => {
    expect(orderMightMatch(order, [charge({ amountCents: 6000 })])).toBe(false);
  });

  it("skips a charge more than 7 days before the order was placed", () => {
    expect(orderMightMatch(order, [charge({ date: "2025-06-20" })])).toBe(false);
  });

  it("does not filter on total when the order total is unknown", () => {
    const noTotal: RawTargetOrder = { ...order, orderTotalCents: null };
    expect(orderMightMatch(noTotal, [charge({ amountCents: 999999, date: "2025-07-03" })])).toBe(true);
  });

  it("keeps an order with an unparseable date (can't safely pre-filter)", () => {
    const noDate: RawTargetOrder = { ...order, date: "" };
    expect(orderMightMatch(noDate, [charge({ date: "2025-07-03" })])).toBe(true);
  });
});

describe("invoiceMightSplitMatch", () => {
  const inv: RawTargetInvoice = { invoiceId: "i1", date: "2025-07-28", amountCents: 4390, isRefund: false };

  it("keeps an invoice whose total >= charge, within 3 days, same sign", () => {
    expect(invoiceMightSplitMatch(inv, [charge({ date: "2025-07-27", amountCents: 2890 })])).toBe(true);
  });

  it("skips an invoice whose total is below the charge", () => {
    expect(invoiceMightSplitMatch(inv, [charge({ date: "2025-07-27", amountCents: 5000 })])).toBe(false);
  });

  it("skips an invoice more than 3 days from the charge", () => {
    expect(invoiceMightSplitMatch(inv, [charge({ date: "2025-08-10", amountCents: 2890 })])).toBe(false);
  });

  it("skips on refund-sign mismatch", () => {
    expect(invoiceMightSplitMatch(inv, [charge({ date: "2025-07-27", amountCents: 2890, isRefund: true })])).toBe(false);
  });
});

describe("readWithRetry", () => {
  it("returns the result without retrying when the read succeeds", async () => {
    const read = vi.fn(async () => "ok");
    await expect(readWithRetry("x", read)).resolves.toBe("ok");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("retries once and succeeds when the first read fails (a transient hang)", async () => {
    const read = vi.fn()
      .mockRejectedValueOnce(new Error("hung"))
      .mockResolvedValueOnce("ok");
    await expect(readWithRetry("x", read)).resolves.toBe("ok");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("rethrows after the retry also fails (caller skips this page)", async () => {
    const read = vi.fn(async () => { throw new Error("still hung"); });
    await expect(readWithRetry("x", read)).rejects.toThrow("still hung");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a StepUpRequired (the whole session is gated)", async () => {
    const read = vi.fn(async () => { throw new StepUpRequired(); });
    await expect(readWithRetry("x", read)).rejects.toBeInstanceOf(StepUpRequired);
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("unwrap", () => {
  it("returns the payload for a normal response", () => {
    expect(unwrap({ invoices: [1, 2] })).toEqual({ invoices: [1, 2] });
  });

  it("throws StepUpRequired when the page redirected to step-up sign-in", () => {
    expect(() => unwrap({ error: "auth_required" })).toThrow(StepUpRequired);
  });

  it("throws a plain error (not StepUpRequired) on any other error shape — guards the old undefined.filter crash", () => {
    expect(() => unwrap({ error: "boom" })).toThrow(/Target scrape error/);
    expect(() => unwrap({ error: "boom" })).not.toThrow(StepUpRequired);
  });
});
