import { describe, expect, it } from "vitest";
import { sum } from "remeda";
import { allocateProportional, assignItemsToCharges } from "./distribution";

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

  it("n > 20 returns null (search-space cap)", () => {
    const items = Array(21).fill(100);
    expect(assignItemsToCharges(items, [2100], 2100, 2100)).toBeNull();
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
