import { describe, expect, it } from "vitest";
import { cosine, l2Normalize, isNormalized } from "./embeddings";

describe("l2Normalize", () => {
  it("returns a unit vector", () => {
    const v = new Float32Array([3, 4]);
    const out = l2Normalize(v);
    expect(out[0]).toBeCloseTo(0.6, 5);
    expect(out[1]).toBeCloseTo(0.8, 5);
    expect(isNormalized(out)).toBe(true);
  });

  it("returns zero vector unchanged on zero input", () => {
    const v = new Float32Array([0, 0, 0]);
    const out = l2Normalize(v);
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });
});

describe("cosine", () => {
  it("identical normalized vectors → 1.0", () => {
    const v = l2Normalize(new Float32Array([1, 2, 3]));
    expect(cosine(v, v)).toBeCloseTo(1, 5);
  });

  it("orthogonal vectors → 0.0", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(cosine(a, b)).toBeCloseTo(0, 5);
  });

  it("opposite vectors → -1.0", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(cosine(a, b)).toBeCloseTo(-1, 5);
  });

  it("throws if dims mismatch", () => {
    expect(() => cosine(new Float32Array([1]), new Float32Array([1, 2]))).toThrow();
  });
});
