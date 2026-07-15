import { describe, expect, it } from "vitest";
import { sum } from "remeda";
import { allocateProportional, assignItemsToCharges, distributeOrder, matchRefundToItems } from "./distribution";
import type { ScrapedOrder, YnabCharge } from "./types";

describe("allocateProportional", () => {
  it("distributes total proportionally by item subtotal", () => {
    expect(allocateProportional([5000, 3000], 9000)).toEqual([5625, 3375]);
  });

  it("exact-sum guarantee: result always sums to totalCents", () => {
    const result = allocateProportional([100, 100, 100], 1000);
    expect(sum(result)).toBe(1000);
  });

  it("rounding error is absorbed by the last item", () => {
    // 333.33 each → rounded would sum to 999; last item gets +1
    const result = allocateProportional([100, 100, 100], 1000);
    expect(result).toEqual([333, 333, 334]);
  });

  it("zero total returns all zeros", () => {
    expect(allocateProportional([100, 200], 0)).toEqual([0, 0]);
  });

  it("single item gets full total", () => {
    expect(allocateProportional([100], 999)).toEqual([999]);
  });

  it("zero-subtotal items mixed with non-zero", () => {
    // Items with zero subtotal get 0; the rest split the total
    const result = allocateProportional([0, 100, 0], 500);
    expect(sum(result)).toBe(500);
    expect(result[0]).toBe(0);
    expect(result[2]).toBe(0);
    expect(result[1]).toBe(500);
  });

  it("all zero subtotals returns all zeros even with positive total", () => {
    // No basis for proportional allocation; return zeros (caller's bug to send this)
    expect(allocateProportional([0, 0], 1000)).toEqual([0, 0]);
  });
});

describe("assignItemsToCharges", () => {
  it("single charge returns all items in one bucket with distance 0", () => {
    const result = assignItemsToCharges([1000, 2000], [3000], 3000, 3000);
    expect(result).toEqual({
      indicesPerCharge: [[0, 1]],
      distanceCentsPerCharge: [0],
    });
  });

  it("two charges, exact split, distance 0 for both", () => {
    // Items: $30 (idx 0), $50 (idx 1); Charges: $50, $30
    const result = assignItemsToCharges([3000, 5000], [5000, 3000], 8000, 8000);
    expect(result).not.toBeNull();
    expect(result!.indicesPerCharge[0]).toEqual([1]); // $50 charge → $50 item
    expect(result!.indicesPerCharge[1]).toEqual([0]); // $30 charge → $30 item
    expect(result!.distanceCentsPerCharge).toEqual([0, 0]);
  });

  it("greedy trap: global finds total-error-0 where naive greedy would fail", () => {
    // Items: $10, $20, $30, $40 = $100; Charges: $40, $30, $30
    // Greedy might pick {$10, $30} for the $40 charge (distance 0 locally),
    // leaving {$20, $40} that can't cleanly cover two $30s (error 20).
    // Global finds {$40} | {$30} | {$10, $20} — total error 0.
    const result = assignItemsToCharges(
      [1000, 2000, 3000, 4000],
      [4000, 3000, 3000],
      10000,
      10000,
    );
    expect(result).not.toBeNull();
    expect(sum(result!.distanceCentsPerCharge)).toBe(0);
  });

  it("input charge order does not affect partition's total distance", () => {
    const items = [1000, 2000, 3000];
    const r1 = assignItemsToCharges(items, [3000, 2000, 1000], 6000, 6000);
    const r2 = assignItemsToCharges(items, [1000, 2000, 3000], 6000, 6000);
    expect(sum(r1!.distanceCentsPerCharge)).toBe(sum(r2!.distanceCentsPerCharge));
  });

  it("returns indices in input charge order", () => {
    const items = [1000, 2000, 3000];
    // Input charges: [$20, $40] — result indices[0] is for $20, indices[1] is for $40
    const result = assignItemsToCharges(items, [2000, 4000], 6000, 6000);
    expect(result).not.toBeNull();
    // First bucket corresponds to first input charge ($20)
    const sumOf = (idxs: number[]) => sum(idxs.map((i) => items[i]));
    expect(sumOf(result!.indicesPerCharge[0])).toBe(2000);
    expect(sumOf(result!.indicesPerCharge[1])).toBe(4000);
  });

  it("ratio scaling: items priced below charges still partition correctly", () => {
    // Items total $80, charges total $100 (ratio 1.25 — e.g. 25% tax)
    // Items $40, $40; Charges $50, $50; each subset scaled: {0}=50, {1}=50, {0,1}=100
    // Best partition: {0}|{1} → distances 0, 0
    const result = assignItemsToCharges([4000, 4000], [5000, 5000], 10000, 8000);
    expect(result).not.toBeNull();
    expect(sum(result!.distanceCentsPerCharge)).toBe(0);
  });

  it("multi-charge: n > MAX_ITEMS falls back to a best-effort greedy partition", () => {
    // Past the exact-enumeration cap we no longer fail the order — every item is
    // assigned exactly once and every charge gets at least one item.
    const items = Array(21).fill(100);
    const result = assignItemsToCharges(items, [1050, 1050], 2100, 2100);
    expect(result).not.toBeNull();
    expect(result!.indicesPerCharge).toHaveLength(2);
    expect(result!.indicesPerCharge.every((b) => b.length >= 1)).toBe(true);
    expect(result!.indicesPerCharge.flat().sort((a, b) => a - b)).toEqual(
      items.map((_, i) => i),
    );
  });

  it("greedy fallback keeps big items off the small charge", () => {
    // 21 items so we cross MAX_ITEMS: twenty $10 items + one $200 item, split
    // across a big ($200) and a small ($10) charge. The $200 item must land on
    // the big charge, not the small one.
    const items = [...Array(20).fill(1000), 20000];
    const result = assignItemsToCharges(items, [20000, 1000], 21000, 21000);
    expect(result).not.toBeNull();
    const bigItemIdx = 20;
    const bigChargeBucket = result!.indicesPerCharge[0];
    expect(bigChargeBucket).toContain(bigItemIdx);
  });

  it("greedy fallback repairs an empty bucket so every charge gets an item", () => {
    // Skewed targets that force the repair branch: 21 equal $10 items with a
    // near-all-consuming charge ($209.99) beside a $0.01 charge. Underfilled-
    // first assignment piles all 21 items onto the big charge (its slack never
    // drops below the tiny charge's target), leaving the small charge empty —
    // repair must then move one item over so it isn't left with zero.
    const items = Array(21).fill(1000);
    const result = assignItemsToCharges(items, [20999, 1], 21000, 21000);
    expect(result).not.toBeNull();
    expect(result!.indicesPerCharge.map((b) => b.length)).toEqual([20, 1]);
    expect(result!.indicesPerCharge.flat().sort((a, b) => a - b)).toEqual(
      items.map((_, i) => i),
    );
  });

  it("single-charge: n > MAX_ITEMS still succeeds (no enumeration needed)", () => {
    const items = Array(25).fill(100);
    const result = assignItemsToCharges(items, [2500], 2500, 2500);
    expect(result).not.toBeNull();
    expect(result!.indicesPerCharge).toHaveLength(1);
    expect(result!.indicesPerCharge[0]).toHaveLength(25);
    expect(result!.distanceCentsPerCharge).toEqual([0]);
  });

  it("M > n returns null (cannot give every charge an item)", () => {
    expect(assignItemsToCharges([1000], [500, 500], 1000, 1000)).toBeNull();
  });

  it("each item assigned to exactly one charge", () => {
    const items = [1000, 2000, 3000, 4000];
    const result = assignItemsToCharges(items, [3000, 7000], 10000, 10000);
    expect(result).not.toBeNull();
    const allIndices = result!.indicesPerCharge.flat();
    const expectedIndices = items.map((_, i) => i);
    expect(allIndices.sort()).toEqual(expectedIndices);
  });
});

// ---------------------------------------------------------------------------
// distributeOrder scenario tests
// ---------------------------------------------------------------------------

const mkItem = (productId: string, unitPriceCents: number, quantity = 1) => ({
  productId,
  title: `Product ${productId}`,
  imageUrl: "",
  unitPriceCents,
  quantity,
  refundedAmountCents: 0,
});

const mkCharge = (
  ynabTransactionId: string,
  amountCents: number,
  overrides: Partial<YnabCharge> = {},
): YnabCharge => ({
  ynabTransactionId,
  date: "2026-05-24",
  amountCents,
  payeeName: "AMAZON",
  isRefund: false,
  ...overrides,
});

const mkOrder = (items: ScrapedOrder["items"], orderId = "o1"): ScrapedOrder => ({
  retailer: "amazon",
  orderId,
  items,
  displayedItemsSubtotalCents: items.reduce((s, it) => s + it.unitPriceCents * it.quantity, 0),
  refund: null,
});

describe("distributeOrder", () => {
  it("single charge: all items go to the one charge; allocations sum to chargeAmount", () => {
    const order = mkOrder([mkItem("A", 5000), mkItem("B", 3000)]);
    const charges = [mkCharge("tx1", 8800)]; // includes $8 tax
    const result = distributeOrder(order, charges);
    expect(result.allocated).toHaveLength(1);
    expect(result.allocated[0].ynabTransactionId).toBe("tx1");
    expect(result.allocated[0].amountCents).toBe(8800);
    expect(result.allocated[0].isRefund).toBe(false);
    expect(sum(result.allocated[0].items.map((i) => i.allocatedCents))).toBe(8800);
    expect(result.allocated[0].items.map((i) => i.productId).sort()).toEqual(["A", "B"]);
    expect(result.failures).toEqual([]);
  });

  it("split shipment (HEADLINE): partitions items, one AllocatedTransaction per charge", () => {
    const order = mkOrder([mkItem("H", 5000), mkItem("C", 3000)]);
    const charges = [mkCharge("tx1", 5500), mkCharge("tx2", 3000)];
    const result = distributeOrder(order, charges);
    expect(result.allocated).toHaveLength(2);
    const tx1 = result.allocated.find((r) => r.ynabTransactionId === "tx1")!;
    const tx2 = result.allocated.find((r) => r.ynabTransactionId === "tx2")!;
    expect(tx1.items.map((i) => i.productId)).toEqual(["H"]);
    expect(tx1.items[0].allocatedCents).toBe(5500);
    expect(tx2.items.map((i) => i.productId)).toEqual(["C"]);
    expect(tx2.items[0].allocatedCents).toBe(3000);
    expect(result.failures).toEqual([]);
  });

  it("large grocery order split across 3 charges (30 items) allocates instead of failing", () => {
    // Regression for BAC "Couldn't read order": a 30-item Whole Foods order that
    // YNAB split into three charges used to trip the exact partitioner's
    // n > MAX_ITEMS cap (m > 1), failing all three charges. It now partitions
    // best-effort so every charge allocates and its split sums exactly.
    const items = Array.from({ length: 30 }, (_, i) => mkItem(`P${i}`, 700));
    const order = mkOrder(items, "113-9595876-1111455");
    const charges = [
      mkCharge("tx1", 21502),
      mkCharge("tx2", 787),
      mkCharge("tx3", 583),
    ];
    const result = distributeOrder(order, charges);
    expect(result.failures).toEqual([]);
    expect(result.allocated).toHaveLength(3);
    for (const at of result.allocated) {
      expect(sum(at.items.map((i) => i.allocatedCents))).toBe(at.amountCents);
    }
    const totalItems = result.allocated.reduce((acc, at) => acc + at.items.length, 0);
    expect(totalItems).toBe(30);
  });

  it("invariant: every charge's allocations sum to exactly amountCents", () => {
    const order = mkOrder([
      mkItem("A", 1234),
      mkItem("B", 5678),
      mkItem("C", 999),
    ]);
    const charges = [mkCharge("tx1", 5000), mkCharge("tx2", 3000)];
    const result = distributeOrder(order, charges);
    for (const at of result.allocated) {
      expect(sum(at.items.map((i) => i.allocatedCents))).toBe(at.amountCents);
    }
  });

  it("invariant: every item appears in exactly one AllocatedTransaction", () => {
    const order = mkOrder([mkItem("A", 1000), mkItem("B", 2000), mkItem("C", 3000)]);
    const charges = [mkCharge("tx1", 1500), mkCharge("tx2", 4500)];
    const result = distributeOrder(order, charges);
    const seenIds = result.allocated.flatMap((at) => at.items.map((i) => i.productId));
    expect(seenIds.sort()).toEqual(["A", "B", "C"]);
  });

  it("item quantity > 1: subtotal scales by quantity", () => {
    // $20 × 3 = $60 line; alone in a $66 charge (10% tax)
    const order = mkOrder([mkItem("A", 2000, 3)]);
    const charges = [mkCharge("tx1", 6600)];
    const result = distributeOrder(order, charges);
    expect(result.allocated[0].items[0].allocatedCents).toBe(6600);
    expect(result.allocated[0].items[0].quantity).toBe(3);
    expect(result.allocated[0].items[0].unitPriceCents).toBe(2000); // raw price preserved
  });

  it("multi-charge proportional tax: clean partition, exact totals", () => {
    // Items $40, $60 = $100; Order total = $110 (10% tax); two charges sum $110
    // Charges: $44, $66
    const order = mkOrder([mkItem("A", 4000), mkItem("B", 6000)]);
    const charges = [mkCharge("tx1", 4400), mkCharge("tx2", 6600)];
    const result = distributeOrder(order, charges);
    expect(sum(result.allocated.find((r) => r.ynabTransactionId === "tx1")!.items.map((i) => i.allocatedCents))).toBe(4400);
    expect(sum(result.allocated.find((r) => r.ynabTransactionId === "tx2")!.items.map((i) => i.allocatedCents))).toBe(6600);
  });

  it("metadata propagation: orderKey, retailer, date all set", () => {
    const order = mkOrder([mkItem("A", 1000)], "114-XYZ");
    const charges = [mkCharge("tx1", 1000, { date: "2026-05-20" })];
    const result = distributeOrder(order, charges);
    expect(result.allocated[0].orderKey).toBe("amazon:114-XYZ");
    expect(result.allocated[0].retailer).toBe("amazon");
    expect(result.allocated[0].date).toBe("2026-05-20");
  });

  it("returns empty allocated + per-charge failures when order has no items", () => {
    const order = mkOrder([]);
    const charges = [mkCharge("tx1", 1000)];
    const result = distributeOrder(order, charges);
    expect(result.allocated).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].ynabTransactionId).toBe("tx1");
  });

  it("returns empty allocated + failures when assignment fails (M > n)", () => {
    const order = mkOrder([mkItem("A", 1000)]);
    const charges = [mkCharge("tx1", 500), mkCharge("tx2", 500)];
    const result = distributeOrder(order, charges);
    expect(result.allocated).toEqual([]);
    expect(result.failures).toHaveLength(2);
  });
});

describe("distributeOrder with refunds", () => {
  it("standalone refund: allocates only refunded items (single-item match)", () => {
    const items = [
      { ...mkItem("A", 1000), refundedAmountCents: 0 },
      { ...mkItem("B", 1500), refundedAmountCents: 1500 }, // this one was refunded
      { ...mkItem("C", 2000), refundedAmountCents: 0 },
    ];
    const order: ScrapedOrder = {
      ...mkOrder(items),
      refund: { itemCents: 1500, taxCents: 0, totalCents: 1500 },
    };
    const refundCharge: YnabCharge = {
      ynabTransactionId: "yt-refund",
      date: "2026-05-31",
      amountCents: 1500,
      payeeName: "Amazon",
      isRefund: true,
    };
    const result = distributeOrder(order, [refundCharge]);
    expect(result.allocated).toHaveLength(1);
    expect(result.allocated[0].isRefund).toBe(true);
    expect(result.allocated[0].items.map((i) => i.productId)).toEqual(["B"]);
    expect(result.allocated[0].items[0].allocatedCents).toBe(1500);
    expect(result.failures).toEqual([]);
  });

  it("standalone refund with tax: uses popover ratio to gross up item amount", () => {
    const items = [
      { ...mkItem("OOFOS", 5995), refundedAmountCents: 5995 },
      { ...mkItem("OTHER", 1000), refundedAmountCents: 0 },
    ];
    const order: ScrapedOrder = {
      ...mkOrder(items),
      refund: { itemCents: 5995, taxCents: 585, totalCents: 6580 },
    };
    const refundCharge: YnabCharge = {
      ynabTransactionId: "yt-refund",
      date: "2026-05-31",
      amountCents: 6580,
      payeeName: "Amazon",
      isRefund: true,
    };
    const result = distributeOrder(order, [refundCharge]);
    expect(result.allocated).toHaveLength(1);
    expect(result.allocated[0].items.map((i) => i.productId)).toEqual(["OOFOS"]);
    expect(result.allocated[0].items[0].allocatedCents).toBe(6580);
    expect(result.failures).toEqual([]);
  });

  it("ambiguous refund: fails the charge with a refund-specific reason", () => {
    // Items: two refunded items at $10 each. YNAB refund $10 — could match either.
    const items = [
      { ...mkItem("A", 1000), refundedAmountCents: 1000 },
      { ...mkItem("B", 1000), refundedAmountCents: 1000 },
    ];
    const order: ScrapedOrder = {
      ...mkOrder(items),
      refund: { itemCents: 2000, taxCents: 0, totalCents: 2000 },
    };
    const refundCharge: YnabCharge = {
      ynabTransactionId: "yt-refund",
      date: "2026-05-31",
      amountCents: 1000,
      payeeName: "Amazon",
      isRefund: true,
    };
    const result = distributeOrder(order, [refundCharge]);
    expect(result.allocated).toEqual([]);
    expect(result.failures).toEqual([
      { ynabTransactionId: "yt-refund", reason: expect.stringContaining("refund") },
    ]);
  });

  it("refund with no matching subset: fails the charge", () => {
    const items = [{ ...mkItem("A", 1000), refundedAmountCents: 1000 }];
    const order: ScrapedOrder = {
      ...mkOrder(items),
      refund: { itemCents: 1000, taxCents: 0, totalCents: 1000 },
    };
    const refundCharge: YnabCharge = {
      ynabTransactionId: "yt-refund",
      date: "2026-05-31",
      amountCents: 9999, // doesn't match anything
      payeeName: "Amazon",
      isRefund: true,
    };
    const result = distributeOrder(order, [refundCharge]);
    expect(result.allocated).toEqual([]);
    expect(result.failures).toHaveLength(1);
  });

  it("refund when order has no refund metadata: fails the charge", () => {
    const items = [{ ...mkItem("A", 1000), refundedAmountCents: 0 }];
    const order = mkOrder(items); // refund: null
    const refundCharge: YnabCharge = {
      ynabTransactionId: "yt-refund",
      date: "2026-05-31",
      amountCents: 1000,
      payeeName: "Amazon",
      isRefund: true,
    };
    const result = distributeOrder(order, [refundCharge]);
    expect(result.allocated).toEqual([]);
    expect(result.failures).toHaveLength(1);
  });

  it("refund with per-item markers but no popover (grocery): allocates to the marked items", () => {
    // Regression for "Couldn't read order" on Whole Foods / Fresh refunds: the
    // order has per-item refund markers but no "Refund Total" popover
    // (order.refund: null), so matchOneRefund used to reject it outright.
    const items = [
      { ...mkItem("REFUNDED", 2971), refundedAmountCents: 2971 },
      { ...mkItem("KEPT", 5000), refundedAmountCents: 0 },
    ];
    const order = mkOrder(items); // refund: null — grocery has no popover
    const refundCharge: YnabCharge = {
      ynabTransactionId: "yt-refund",
      date: "2026-07-07",
      amountCents: 2971,
      payeeName: "Amazon",
      isRefund: true,
    };
    const result = distributeOrder(order, [refundCharge]);
    expect(result.failures).toEqual([]);
    expect(result.allocated).toHaveLength(1);
    expect(result.allocated[0].ynabTransactionId).toBe("yt-refund");
    expect(result.allocated[0].isRefund).toBe(true);
    expect(result.allocated[0].items.map((i) => i.productId)).toEqual(["REFUNDED"]);
    expect(sum(result.allocated[0].items.map((i) => i.allocatedCents))).toBe(2971);
  });

  it("regular-order partial refund: over-stated marker, popover total matches charge → attributes to the marked item", () => {
    // Real case (order 113-4472585-9829043): the refunded item's marker is its
    // full line total ($34.95), but Amazon refunded $29.71 (the popover total,
    // which equals the YNAB charge). matchRefundToItems can't subset-match the
    // over-stated marker, so we fall back to the authoritative popover total.
    const items = [
      { ...mkItem("KEPT", 5000), refundedAmountCents: 0 },
      { ...mkItem("REFUNDED", 3495), refundedAmountCents: 3495 },
    ];
    const order: ScrapedOrder = {
      ...mkOrder(items),
      refund: { itemCents: 2971, taxCents: 0, totalCents: 2971 },
    };
    const refundCharge: YnabCharge = {
      ynabTransactionId: "yt-r1", date: "2026-07-06", amountCents: 2971, payeeName: "Amazon", isRefund: true,
    };
    const result = distributeOrder(order, [refundCharge]);
    expect(result.failures).toEqual([]);
    expect(result.allocated).toHaveLength(1);
    expect(result.allocated[0].items.map((i) => i.productId)).toEqual(["REFUNDED"]);
    expect(sum(result.allocated[0].items.map((i) => i.allocatedCents))).toBe(2971);
  });

  it("regular-order refund with tax: over-stated marker, popover total (incl. tax) matches charge", () => {
    // Real case (order 113-6162074-5649818): marker $35.97 (line total); popover
    // item $33.99 + tax $3.51 = $37.50 total = the YNAB charge.
    const items = [{ ...mkItem("REFUNDED", 3597), refundedAmountCents: 3597 }];
    const order: ScrapedOrder = {
      ...mkOrder(items),
      refund: { itemCents: 3399, taxCents: 351, totalCents: 3750 },
    };
    const refundCharge: YnabCharge = {
      ynabTransactionId: "yt-r2", date: "2026-07-06", amountCents: 3750, payeeName: "Amazon", isRefund: true,
    };
    const result = distributeOrder(order, [refundCharge]);
    expect(result.failures).toEqual([]);
    expect(result.allocated).toHaveLength(1);
    expect(result.allocated[0].items.map((i) => i.productId)).toEqual(["REFUNDED"]);
    expect(sum(result.allocated[0].items.map((i) => i.allocatedCents))).toBe(3750);
  });

  it("refund whose charge doesn't match the popover total: still fails (fallback stays guarded)", () => {
    const items = [{ ...mkItem("REFUNDED", 3597), refundedAmountCents: 3597 }];
    const order: ScrapedOrder = {
      ...mkOrder(items),
      refund: { itemCents: 3399, taxCents: 351, totalCents: 3750 },
    };
    const refundCharge: YnabCharge = {
      ynabTransactionId: "yt-r3", date: "2026-07-06", amountCents: 1000, payeeName: "Amazon", isRefund: true,
    };
    const result = distributeOrder(order, [refundCharge]);
    expect(result.allocated).toEqual([]);
    expect(result.failures).toHaveLength(1);
  });

  it("multi-item order, refunded item NOT flagged: identified by list-price subset (multi_item_one_return)", () => {
    // Real case: no shipment shows "Refunded", so every marker is 0. The refunded
    // item is found because its list price equals the popover item refund (5200).
    const items = [
      { ...mkItem("B0DNT6TWWV", 2499), refundedAmountCents: 0 },
      { ...mkItem("B0C77C95K2", 2018), refundedAmountCents: 0 },
      { ...mkItem("B0BLT8SY1X", 5200), refundedAmountCents: 0 },
    ];
    const order: ScrapedOrder = { ...mkOrder(items), refund: { itemCents: 5200, taxCents: 507, totalCents: 5707 } };
    const refund: YnabCharge = { ynabTransactionId: "r", date: "2026-07-06", amountCents: 5707, payeeName: "Amazon", isRefund: true };
    const result = distributeOrder(order, [refund]);
    expect(result.failures).toEqual([]);
    expect(result.allocated[0].items.map((i) => [i.productId, i.allocatedCents])).toEqual([["B0BLT8SY1X", 5707]]);
  });

  it("two items refunded, only one flagged: split across BOTH via list-price subset (one_ship_one_return)", () => {
    // Real case: the shipment flag marked only B01644OCVS, but the popover item
    // refund (2996) = 1699 + 1297, so both refunded items are recovered and the
    // charge is split proportionally.
    const items = [
      { ...mkItem("B07NV7RX7H", 3295), refundedAmountCents: 0 },
      { ...mkItem("B00ZRD99C0", 474), refundedAmountCents: 0 },
      { ...mkItem("B09Y28YM7K", 1699), refundedAmountCents: 0 },
      { ...mkItem("B01644OCVS", 1297), refundedAmountCents: 1297 },
    ];
    const order: ScrapedOrder = { ...mkOrder(items), refund: { itemCents: 2996, taxCents: 292, totalCents: 3288 } };
    const refund: YnabCharge = { ynabTransactionId: "r", date: "2026-07-06", amountCents: 3288, payeeName: "Amazon", isRefund: true };
    const result = distributeOrder(order, [refund]);
    expect(result.failures).toEqual([]);
    expect(result.allocated[0].items).toHaveLength(2);
    const alloc = new Map(result.allocated[0].items.map((i) => [i.productId, i.allocatedCents]));
    expect(alloc.get("B09Y28YM7K")).toBe(1865);
    expect(alloc.get("B01644OCVS")).toBe(1423);
  });

  it("partial refund of the only item, no flag: attributed to that item (partial_refund)", () => {
    // Real case: $22.93 refunded on a $209.99 item, no marker — the single item
    // gets it.
    const items = [{ ...mkItem("B00DJ8HX96", 20999), refundedAmountCents: 0 }];
    const order: ScrapedOrder = { ...mkOrder(items), refund: { itemCents: 2090, taxCents: 203, totalCents: 2293 } };
    const refund: YnabCharge = { ynabTransactionId: "r", date: "2026-07-06", amountCents: 2293, payeeName: "Amazon", isRefund: true };
    const result = distributeOrder(order, [refund]);
    expect(result.failures).toEqual([]);
    expect(result.allocated[0].items.map((i) => [i.productId, i.allocatedCents])).toEqual([["B00DJ8HX96", 2293]]);
  });

  it("refund identified to only $0-priced items: fails cleanly instead of an all-zeros allocation", () => {
    const items = [{ ...mkItem("FREEBIE", 0), refundedAmountCents: 0 }];
    const order: ScrapedOrder = { ...mkOrder(items), refund: { itemCents: 0, taxCents: 500, totalCents: 500 } };
    const refund: YnabCharge = { ynabTransactionId: "r", date: "2026-07-06", amountCents: 500, payeeName: "Amazon", isRefund: true };
    const result = distributeOrder(order, [refund]);
    expect(result.allocated).toEqual([]);
    expect(result.failures).toHaveLength(1);
  });

  it("mixed: purchase charge gets non-refunded items, refund gets refunded items", () => {
    const items = [
      { ...mkItem("A", 1000), refundedAmountCents: 0 }, // purchase
      { ...mkItem("B", 2000), refundedAmountCents: 0 }, // purchase
      { ...mkItem("C", 1500), refundedAmountCents: 1500 }, // refund target
    ];
    const order: ScrapedOrder = {
      ...mkOrder(items),
      refund: { itemCents: 1500, taxCents: 0, totalCents: 1500 },
    };
    const purchase: YnabCharge = {
      ynabTransactionId: "yt-purchase",
      date: "2026-05-31",
      amountCents: 3000,
      payeeName: "Amazon",
      isRefund: false,
    };
    const refund: YnabCharge = {
      ynabTransactionId: "yt-refund",
      date: "2026-05-31",
      amountCents: 1500,
      payeeName: "Amazon",
      isRefund: true,
    };
    const result = distributeOrder(order, [purchase, refund]);
    expect(result.failures).toEqual([]);
    expect(result.allocated).toHaveLength(2);
    const byTx = new Map(result.allocated.map((a) => [a.ynabTransactionId, a]));
    expect(byTx.get("yt-purchase")!.items.map((i) => i.productId).sort()).toEqual(["A", "B"]);
    expect(byTx.get("yt-refund")!.items.map((i) => i.productId)).toEqual(["C"]);
  });

  it("pure-refund order with purchase charge: fails purchase with a specific reason", () => {
    const items = [
      { ...mkItem("A", 1000), refundedAmountCents: 1000 },
      { ...mkItem("B", 1500), refundedAmountCents: 1500 },
    ];
    const order: ScrapedOrder = {
      ...mkOrder(items),
      refund: { itemCents: 2500, taxCents: 0, totalCents: 2500 },
    };
    const purchase: YnabCharge = {
      ynabTransactionId: "yt-purchase",
      date: "2026-05-31",
      amountCents: 2500,
      payeeName: "Amazon",
      isRefund: false,
    };
    const result = distributeOrder(order, [purchase]);
    expect(result.allocated).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toMatch(/refunded/i);
  });

  it("multiple sequential refunds: each consumes its matched items from the pool", () => {
    const items = [
      { ...mkItem("A", 500), refundedAmountCents: 500 },
      { ...mkItem("B", 1500), refundedAmountCents: 1500 },
    ];
    const order: ScrapedOrder = {
      ...mkOrder(items),
      refund: { itemCents: 2000, taxCents: 0, totalCents: 2000 },
    };
    const refund1: YnabCharge = {
      ynabTransactionId: "yt-r1",
      date: "2026-05-31",
      amountCents: 500,
      payeeName: "Amazon",
      isRefund: true,
    };
    const refund2: YnabCharge = {
      ynabTransactionId: "yt-r2",
      date: "2026-05-31",
      amountCents: 1500,
      payeeName: "Amazon",
      isRefund: true,
    };
    const result = distributeOrder(order, [refund1, refund2]);
    expect(result.failures).toEqual([]);
    const byTx = new Map(result.allocated.map((a) => [a.ynabTransactionId, a]));
    expect(byTx.get("yt-r1")!.items.map((i) => i.productId)).toEqual(["A"]);
    expect(byTx.get("yt-r2")!.items.map((i) => i.productId)).toEqual(["B"]);
  });
});

describe("matchRefundToItems", () => {
  // Refunded items represented as (index, refundedAmountCents).
  it("returns the unique single-item subset that matches", () => {
    // YNAB refund $15.00, no tax; one refunded item of $15 → trivial match.
    expect(matchRefundToItems([449, 279, 638, 1500, 739], 1500, 1.0)).toEqual([3]);
  });

  it("returns null when no subset matches", () => {
    // Refunded items sum to $9 max but YNAB refund is $20.
    expect(matchRefundToItems([200, 300, 400], 2000, 1.0)).toBeNull();
  });

  it("returns null when two distinct subsets both match (ambiguous)", () => {
    // Items: 100, 100, 200; YNAB amount 200 — matches {200} OR {100, 100}.
    expect(matchRefundToItems([100, 100, 200], 200, 1.0)).toBeNull();
  });

  it("matches a multi-item subset uniquely", () => {
    // Items: 100, 200, 300. YNAB amount 500 → unique {200, 300}.
    expect(matchRefundToItems([100, 200, 300], 500, 1.0)).toEqual([1, 2]);
  });

  it("applies the tax-grossed ratio when matching", () => {
    // One refunded item of $59.95 item-only. Refund total $65.80 → ratio 65.80/59.95.
    // YNAB refund $65.80 should match the single item.
    const ratio = 6580 / 5995;
    expect(matchRefundToItems([5995], 6580, ratio)).toEqual([0]);
  });

  it("matches within rounding tolerance (per-item-in-subset)", () => {
    // Single refunded item of $5.00. ratio=1.002 → grossed = round(500 * 1.002) = 501.
    // Charge is $5.00 → gap = 1 cent. Tolerance for a 1-item subset = 1 → match.
    expect(matchRefundToItems([500], 500, 1.002)).toEqual([0]);
  });

  it("rejects when grossed sum exceeds tolerance from charge", () => {
    // Single refunded item of $10.00. ratio=1.01 → grossed = 1010. Charge = $10.05.
    // Gap = 5 cents, tolerance for a 1-item subset = 1 → no match.
    expect(matchRefundToItems([1000], 1005, 1.01)).toBeNull();
  });

  it("returns null for an empty refunded-items pool", () => {
    expect(matchRefundToItems([], 100, 1.0)).toBeNull();
  });

  it("ignores items with zero refundedAmountCents in subset enumeration", () => {
    // Mixed: only indices 1 and 3 are refunded. YNAB 700 → unique {1, 3} = 200 + 500.
    expect(matchRefundToItems([0, 200, 0, 500], 700, 1.0)).toEqual([1, 3]);
  });
});
