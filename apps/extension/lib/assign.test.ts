import { describe, expect, it } from "vitest";
import { assignByAmountAndDate } from "./matcher";

const c = (date: string, amountCents: number) => ({ date, amountCents });

describe("assignByAmountAndDate", () => {
  it("matches a unique charge/candidate pair", () => {
    const charges = [c("2026-06-08", 1645)];
    const cands = [c("2026-06-07", 1645)];
    expect(assignByAmountAndDate(charges, cands)).toEqual([0]);
  });

  it("resolves a balanced 2x2 ambiguous cluster (the reported bug)", () => {
    // Two $16.45 charges on Jun 8, two $16.45 orders on Jun 7. Both must match.
    const charges = [c("2026-06-08", 1645), c("2026-06-08", 1645)];
    const cands = [c("2026-06-07", 1645), c("2026-06-07", 1645)];
    const result = assignByAmountAndDate(charges, cands);
    expect(result).toHaveLength(2);
    expect(result[0]).not.toBeNull();
    expect(result[1]).not.toBeNull();
    // Distinct candidates — 1:1, no double assignment.
    expect(new Set(result).size).toBe(2);
  });

  it("leaves an unbalanced cluster unmatched (1 charge, 2 same-amount orders)", () => {
    const charges = [c("2026-06-08", 1645)];
    const cands = [c("2026-06-07", 1645), c("2026-06-07", 1645)];
    expect(assignByAmountAndDate(charges, cands)).toEqual([null]);
  });

  it("leaves an unbalanced cluster unmatched (2 charges, 1 order)", () => {
    const charges = [c("2026-06-08", 1645), c("2026-06-08", 1645)];
    const cands = [c("2026-06-07", 1645)];
    expect(assignByAmountAndDate(charges, cands)).toEqual([null, null]);
  });

  it("does not match when amounts differ", () => {
    const charges = [c("2026-06-08", 1645)];
    const cands = [c("2026-06-08", 1646)];
    expect(assignByAmountAndDate(charges, cands)).toEqual([null]);
  });

  it("does not match outside the ±3 day window", () => {
    const charges = [c("2026-06-08", 1645)];
    const cands = [c("2026-06-04", 1645)];
    expect(assignByAmountAndDate(charges, cands)).toEqual([null]);
  });

  it("matches at exactly the ±3 day boundary", () => {
    const charges = [c("2026-06-08", 1645)];
    const cands = [c("2026-06-05", 1645)];
    expect(assignByAmountAndDate(charges, cands)).toEqual([0]);
  });

  it("matches a forced edge in an asymmetric balanced cluster (A-X, B-X, B-Y)", () => {
    // A only fits X (Jun 7); B fits X and Y (Jun 5). Balanced 2x2 → A→X, B→Y.
    const charges = [c("2026-06-08", 500), c("2026-06-06", 500)];
    const cands = [c("2026-06-07", 500), c("2026-06-04", 500)];
    const result = assignByAmountAndDate(charges, cands);
    expect(result[0]).toBe(0); // A forced to X
    expect(result[1]).toBe(1); // B to Y
  });

  it("matches independent unique pairs of differing amounts", () => {
    const charges = [c("2026-06-08", 1645), c("2026-06-08", 5707)];
    const cands = [c("2026-06-07", 5707), c("2026-06-07", 1645)];
    expect(assignByAmountAndDate(charges, cands)).toEqual([1, 0]);
  });

  it("returns all-null for empty candidates", () => {
    expect(assignByAmountAndDate([c("2026-06-08", 1645)], [])).toEqual([null]);
  });
});
