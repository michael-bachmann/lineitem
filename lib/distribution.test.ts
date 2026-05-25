import { describe, expect, it } from "vitest";
import { sum } from "remeda";
import { allocateProportional } from "./distribution";

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
