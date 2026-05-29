import { describe, expect, it } from "vitest";
import { scoreEmbedding } from "./embedding-scoring";
import type { ProductEmbedding } from "./types";

function row(id: string, categoryId: string, title: string, vec: Float32Array): ProductEmbedding {
  return {
    id,
    categoryId,
    title,
    embedding: vec,
    lastSeen: "2026-01-01",
  };
}

// cos_sim handles normalization internally, so test fixtures can be raw.
function vec(values: number[]): Float32Array {
  return new Float32Array(values);
}

describe("scoreEmbedding", () => {
  const THRESHOLD = 0.65;

  it("returns null when the pool is empty", () => {
    expect(scoreEmbedding(vec([1, 0, 0]), [], THRESHOLD)).toBeNull();
  });

  it("returns the category whose best vector has the highest cosine, above threshold", () => {
    const pool = [
      row("a:1", "household", "paper towels", vec([1, 0.1, 0])),
      row("a:2", "household", "trash bags", vec([0.2, 1, 0])),
      row("a:3", "groceries", "bread", vec([0, 0, 1])),
    ];
    const result = scoreEmbedding(vec([1, 0, 0]), pool, THRESHOLD);
    expect(result?.categoryId).toBe("household");
    expect(result?.cosine).toBeGreaterThan(THRESHOLD);
    expect(result?.matchedTitle).toBe("paper towels");
  });

  it("returns null when best cosine is below threshold", () => {
    const pool = [row("a:1", "household", "paper towels", vec([0, 1, 0]))];
    expect(scoreEmbedding(vec([1, 0, 0]), pool, THRESHOLD)).toBeNull();
  });

  it("ignores vectors whose dim does not match the query", () => {
    const pool = [row("a:1", "household", "paper towels", vec([1, 0]))];
    expect(scoreEmbedding(vec([1, 0, 0]), pool, THRESHOLD)).toBeNull();
  });
});
