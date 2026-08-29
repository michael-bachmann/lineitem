import { describe, expect, it } from "vitest";
import { closestSubset } from "./subset-sum";

/** Sum the values the returned indices point at. */
const sumOf = (values: number[], indices: number[]) =>
  indices.reduce((s, i) => s + values[i]!, 0);

describe("closestSubset", () => {
  it("finds an exact hit", () => {
    const values = [190, 369, 649, 1598];
    const result = closestSubset(values, 1208);
    expect(result.sum).toBe(1208);
    expect(result.indices).toEqual([0, 1, 2]);
  });

  it("reports indices that actually sum to the reported sum", () => {
    const values = [790, 190, 369, 664, 500, 1196, 549, 472, 599, 1598];
    for (const target of [0, 1, 500, 1208, 3000, 6927, 99999]) {
      const { indices, sum } = closestSubset(values, target);
      expect(sumOf(values, indices)).toBe(sum);
    }
  });

  it("returns indices ascending and without repeats", () => {
    const values = [790, 190, 369, 664, 500, 1196, 549, 472];
    const { indices } = closestSubset(values, 2000);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("uses each item at most once even when values repeat", () => {
    const values = [434, 434, 434];
    const { indices, sum } = closestSubset(values, 868);
    expect(sum).toBe(868);
    expect(indices).toHaveLength(2);
    expect(new Set(indices).size).toBe(2);
  });

  it("never exceeds the total, and saturates there for an unreachable target", () => {
    const values = [100, 250, 375];
    const result = closestSubset(values, 10_000);
    expect(result.sum).toBe(725);
    expect(result.indices).toEqual([0, 1, 2]);
  });

  it("falls to the nearest reachable sum when the target is unreachable", () => {
    // Reachable: 0, 300, 500, 800. 610 is nearest to 500.
    const values = [300, 500];
    expect(closestSubset(values, 610).sum).toBe(500);
  });

  it("resolves ties to the smaller sum, deterministically", () => {
    // Reachable: 0, 400, 600, 1000. Target 500 is equidistant from 400 and 600.
    const values = [400, 600];
    const first = closestSubset(values, 500);
    expect(first.sum).toBe(400);
    expect(closestSubset(values, 500)).toEqual(first);
  });

  it("returns the empty subset for a target of zero", () => {
    expect(closestSubset([100, 250], 0)).toEqual({ indices: [], sum: 0 });
  });

  it("handles an empty input", () => {
    expect(closestSubset([], 500)).toEqual({ indices: [], sum: 0 });
  });

  it("never selects a zero-valued item", () => {
    const values = [0, 500, 0, 300];
    const { indices, sum } = closestSubset(values, 800);
    expect(sum).toBe(800);
    expect(indices).toEqual([1, 3]);
  });

  it("terminates and stays exact when every value is zero", () => {
    expect(closestSubset([0, 0, 0], 100)).toEqual({ indices: [], sum: 0 });
  });

  it("agrees with brute force across randomised cases", () => {
    // Deterministic LCG — a seeded generator keeps a failure reproducible.
    let seed = 20260801;
    const next = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);

    const bruteForceBest = (values: number[], target: number): number => {
      let best = 0;
      for (let mask = 0; mask < 1 << values.length; mask++) {
        const s = values.reduce((acc, v, i) => (mask & (1 << i) ? acc + v : acc), 0);
        if (Math.abs(s - target) < Math.abs(best - target)) best = s;
      }
      return best;
    };

    for (let trial = 0; trial < 200; trial++) {
      const values = Array.from({ length: 1 + next(9) }, () => next(900) + 1);
      const target = next(values.reduce((a, b) => a + b, 0) + 200);
      const { indices, sum } = closestSubset(values, target);
      expect(sumOf(values, indices)).toBe(sum);
      expect(Math.abs(sum - target)).toBe(Math.abs(bruteForceBest(values, target) - target));
    }
  });

  it("resolves a 37-item order without enumerating its subsets", () => {
    const values = [
      790, 190, 369, 664, 500, 1196, 549, 472, 599, 1598, 1180, 779, 929, 599,
      899, 469, 529, 649, 434, 1198, 379, 434, 799, 469, 699, 477, 799, 359,
      279, 579, 699, 1070, 643, 549, 899, 719, 699,
    ];
    const started = performance.now();
    const { sum } = closestSubset(values, 1208);
    const elapsed = performance.now() - started;
    expect(sum).toBe(1208);
    // A smoke test against exponential blowup, not a proof of the bound: 2^37
    // subsets would take hours, and the measured cost here is under a
    // millisecond. The margin is enormous so it won't flake, but it would not
    // notice a merely-quadratic regression.
    expect(elapsed).toBeLessThan(250);
  });
});
