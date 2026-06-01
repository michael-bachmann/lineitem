import { describe, expect, it } from "vitest";
import { sum } from "remeda";
import { allocateProportional, assignItemsToCharges, distributeOrder } from "./distribution";
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

  it("multi-charge: n > MAX_ITEMS returns null (subset-enumeration cap)", () => {
    const items = Array(21).fill(100);
    expect(assignItemsToCharges(items, [1050, 1050], 2100, 2100)).toBeNull();
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

const mkOrder = (orderId: string, items: ScrapedOrder["items"]): ScrapedOrder => ({
  retailer: "amazon",
  orderId,
  items,
  displayedItemsSubtotalCents: items.reduce((s, it) => s + it.unitPriceCents * it.quantity, 0),
  refund: null,
});

describe("distributeOrder", () => {
  it("single charge: all items go to the one charge; allocations sum to chargeAmount", () => {
    const order = mkOrder("o1", [mkItem("A", 5000), mkItem("B", 3000)]);
    const charges = [mkCharge("tx1", 8800)]; // includes $8 tax
    const result = distributeOrder(order, charges);
    expect(result).toHaveLength(1);
    expect(result[0].ynabTransactionId).toBe("tx1");
    expect(result[0].amountCents).toBe(8800);
    expect(sum(result[0].items.map((i) => i.allocatedCents))).toBe(8800);
    expect(result[0].items.map((i) => i.productId).sort()).toEqual(["A", "B"]);
  });

  it("split shipment (HEADLINE): partitions items, one AllocatedTransaction per charge", () => {
    const order = mkOrder("o1", [mkItem("H", 5000), mkItem("C", 3000)]);
    const charges = [mkCharge("tx1", 5500), mkCharge("tx2", 3000)];
    const result = distributeOrder(order, charges);
    expect(result).toHaveLength(2);
    const tx1 = result.find((r) => r.ynabTransactionId === "tx1")!;
    const tx2 = result.find((r) => r.ynabTransactionId === "tx2")!;
    expect(tx1.items.map((i) => i.productId)).toEqual(["H"]);
    expect(tx1.items[0].allocatedCents).toBe(5500);
    expect(tx2.items.map((i) => i.productId)).toEqual(["C"]);
    expect(tx2.items[0].allocatedCents).toBe(3000);
  });

  it("invariant: every charge's allocations sum to exactly amountCents", () => {
    const order = mkOrder("o1", [
      mkItem("A", 1234),
      mkItem("B", 5678),
      mkItem("C", 999),
    ]);
    const charges = [mkCharge("tx1", 5000), mkCharge("tx2", 3000)];
    const result = distributeOrder(order, charges);
    for (const at of result) {
      expect(sum(at.items.map((i) => i.allocatedCents))).toBe(at.amountCents);
    }
  });

  it("invariant: every item appears in exactly one AllocatedTransaction", () => {
    const order = mkOrder("o1", [mkItem("A", 1000), mkItem("B", 2000), mkItem("C", 3000)]);
    const charges = [mkCharge("tx1", 1500), mkCharge("tx2", 4500)];
    const result = distributeOrder(order, charges);
    const seenIds = result.flatMap((at) => at.items.map((i) => i.productId));
    expect(seenIds.sort()).toEqual(["A", "B", "C"]);
  });

  it("item quantity > 1: subtotal scales by quantity", () => {
    // $20 × 3 = $60 line; alone in a $66 charge (10% tax)
    const order = mkOrder("o1", [mkItem("A", 2000, 3)]);
    const charges = [mkCharge("tx1", 6600)];
    const result = distributeOrder(order, charges);
    expect(result[0].items[0].allocatedCents).toBe(6600);
    expect(result[0].items[0].quantity).toBe(3);
    expect(result[0].items[0].unitPriceCents).toBe(2000); // raw price preserved
  });

  it("refund: isRefund flag carried through; amountCents stays positive", () => {
    const order = mkOrder("o1", [mkItem("A", 5000)]);
    const charges = [mkCharge("tx1", 5000, { isRefund: true })];
    const result = distributeOrder(order, charges);
    expect(result[0].isRefund).toBe(true);
    expect(result[0].amountCents).toBe(5000);
  });

  it("multi-charge proportional tax: clean partition, exact totals", () => {
    // Items $40, $60 = $100; Order total = $110 (10% tax); two charges sum $110
    // Charges: $44, $66
    const order = mkOrder("o1", [mkItem("A", 4000), mkItem("B", 6000)]);
    const charges = [mkCharge("tx1", 4400), mkCharge("tx2", 6600)];
    const result = distributeOrder(order, charges);
    expect(sum(result.find((r) => r.ynabTransactionId === "tx1")!.items.map((i) => i.allocatedCents))).toBe(4400);
    expect(sum(result.find((r) => r.ynabTransactionId === "tx2")!.items.map((i) => i.allocatedCents))).toBe(6600);
  });

  it("metadata propagation: orderKey, retailer, date all set", () => {
    const order = mkOrder("114-XYZ", [mkItem("A", 1000)]);
    const charges = [mkCharge("tx1", 1000, { date: "2026-05-20" })];
    const result = distributeOrder(order, charges);
    expect(result[0].orderKey).toBe("amazon:114-XYZ");
    expect(result[0].retailer).toBe("amazon");
    expect(result[0].date).toBe("2026-05-20");
  });

  it("returns empty array when order has no items", () => {
    const order = mkOrder("o1", []);
    const charges = [mkCharge("tx1", 1000)];
    expect(distributeOrder(order, charges)).toEqual([]);
  });

  it("returns empty array when assignment fails (M > n)", () => {
    const order = mkOrder("o1", [mkItem("A", 1000)]);
    const charges = [mkCharge("tx1", 500), mkCharge("tx2", 500)];
    expect(distributeOrder(order, charges)).toEqual([]);
  });
});
