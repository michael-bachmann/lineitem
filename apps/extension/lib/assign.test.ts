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

  it("resolves each amount group independently (one balanced, one unbalanced)", () => {
    // Two $5.00 charges pair with two $5.00 orders; the lone $9.99 charge has no
    // candidate and must stay null without disturbing the matched group.
    const charges = [c("2026-06-08", 500), c("2026-06-08", 500), c("2026-06-08", 999)];
    const cands = [c("2026-06-07", 500), c("2026-06-07", 500)];
    const result = assignByAmountAndDate(charges, cands);
    expect(result[2]).toBeNull();
    expect(new Set([result[0], result[1]])).toEqual(new Set([0, 1]));
  });

  it("an out-of-window group stays null while another in-window group matches", () => {
    const charges = [c("2026-06-08", 500), c("2026-06-08", 700)];
    const cands = [c("2026-06-07", 500), c("2026-06-01", 700)]; // 700 is 7 days off
    expect(assignByAmountAndDate(charges, cands)).toEqual([0, null]);
  });

  // Amounts are grouped via a numeric key that round-trips through a string
  // (groupBy → Object.entries → Number). Lock the edge values of that round-trip.
  it("matches a zero-amount charge", () => {
    expect(assignByAmountAndDate([c("2026-06-08", 0)], [c("2026-06-07", 0)])).toEqual([0]);
  });

  it("matches a negative (refund) amount", () => {
    expect(assignByAmountAndDate([c("2026-06-08", -500)], [c("2026-06-07", -500)])).toEqual([0]);
  });
});
