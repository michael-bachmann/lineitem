import { cos_sim } from "@huggingface/transformers";
import { groupBy, mapValues, sortBy } from "remeda";
import type { ProductEmbedding } from "./types";

export const EMBEDDING_THRESHOLD = 0.65;

/** What `scoreEmbedding` returns when something matched. */
export interface EmbeddingMatch {
  categoryId: string;
  cosine: number;
  matchedTitle: string;
}

/**
 * Score an incoming embedding against the stored pool. Per category, keep
 * the best matching vector's cosine. Return the global winner if above
 * threshold, otherwise null.
 */
export function scoreEmbedding(
  query: Float32Array,
  pool: ProductEmbedding[],
  threshold: number,
): EmbeddingMatch | null {
  // cos_sim's .d.ts declares `number[]` parameters even though the runtime
  // accepts any indexable numeric iterable. Cast through unknown to keep
  // Float32Array end-to-end without allocating.
  const cosine = (a: Float32Array, b: Float32Array): number =>
    cos_sim(a as unknown as number[], b as unknown as number[]);

  // Defensive: cos_sim silently truncates on dim mismatch — guard against
  // a stray vector of the wrong shape sneaking in.
  const scored = pool
    .filter((r) => r.embedding.length === query.length)
    .map((r) => ({
      categoryId: r.categoryId,
      cosine: cosine(query, r.embedding),
      title: r.title,
    }));

  if (scored.length === 0) return null;

  // Best-per-category, then the global top.
  const bestPerCategory = mapValues(
    groupBy(scored, (s) => s.categoryId),
    (group) => sortBy(group, [(s) => s.cosine, "desc"])[0],
  );
  const [top] = sortBy(Object.values(bestPerCategory), [(s) => s.cosine, "desc"]);

  if (top.cosine < threshold) return null;
  return {
    categoryId: top.categoryId,
    cosine: top.cosine,
    matchedTitle: top.title,
  };
}
