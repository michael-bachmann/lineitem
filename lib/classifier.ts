import type { ClassifiedItem, ProductEmbedding } from "./types";
import { getAllProductEmbeddings, getLearnedProduct } from "./db";
import { embed } from "@/background/embedder";
import { EMBEDDING_THRESHOLD, scoreEmbedding } from "./embedding-scoring";

interface ClassifyInput {
  productId: string;
  title: string;
}

interface ClassifyResult {
  categoryId: string | null;
  source: ClassifiedItem["classificationSource"];
  matchedSource?: { title: string; cosine: number };
}

/**
 * Classify a line item into a YNAB category.
 * Tier 1: LearnedProduct cache (exact productId match from past approvals).
 * Tier 2: embedding similarity (best-effort; degrades to null on failure).
 */
export async function classifyItem(
  item: ClassifyInput,
  retailer: string,
): Promise<ClassifyResult> {
  const key = `${retailer}:${item.productId}`;
  const entry = await getLearnedProduct(key);
  if (entry) {
    return { categoryId: entry.categoryId, source: "product_cache" };
  }

  // Embedding tier — best-effort. Any failure degrades to null.
  try {
    const pool = await getAllProductEmbeddings();
    return await classifyViaEmbedding(item, pool);
  } catch (err) {
    console.warn("classifyItem: embedding tier failed", err);
    return { categoryId: null, source: null };
  }
}

async function classifyViaEmbedding(
  item: ClassifyInput,
  pool: ProductEmbedding[],
): Promise<ClassifyResult> {
  if (pool.length === 0) return { categoryId: null, source: null };

  const queryVec = await embed(item.title);
  const match = scoreEmbedding(queryVec, pool, EMBEDDING_THRESHOLD);
  if (!match) return { categoryId: null, source: null };

  return {
    categoryId: match.categoryId,
    source: "embedding",
    matchedSource: { title: match.matchedTitle, cosine: match.cosine },
  };
}

/** Classify all items in parallel. */
export function classifyItems<T extends { productId: string; title: string }>(
  items: T[],
  retailer: string,
): Promise<
  (T & Pick<ClassifiedItem, "suggestedCategoryId" | "classificationSource" | "matchedSource">)[]
> {
  return Promise.all(
    items.map(async (item) => {
      const { categoryId, source, matchedSource } = await classifyItem(item, retailer);
      return {
        ...item,
        suggestedCategoryId: categoryId,
        classificationSource: source,
        matchedSource,
      };
    }),
  );
}
