import type { ClassifiedItem } from "./types";
import { getProductCategory } from "./db";

/**
 * Classify a line item into a YNAB category using the product cache.
 * Returns the cached category if the product has been seen and approved
 * before, otherwise returns null (user must assign manually).
 */
export async function classifyItem(
  item: { productId: string },
  retailer: string,
): Promise<{ categoryId: string | null; source: ClassifiedItem["classificationSource"] }> {
  const key = `${retailer}:${item.productId}`;
  const entry = await getProductCategory(key);
  if (entry) {
    return { categoryId: entry.categoryId, source: "product_cache" };
  }

  return { categoryId: null, source: null };
}

/** Classify all items in parallel. The classifier only reads productId. */
export function classifyItems<T extends { productId: string }>(
  items: T[],
  retailer: string,
): Promise<(T & Pick<ClassifiedItem, "suggestedCategoryId" | "classificationSource">)[]> {
  return Promise.all(
    items.map(async (item) => {
      const { categoryId, source } = await classifyItem(item, retailer);
      return { ...item, suggestedCategoryId: categoryId, classificationSource: source };
    }),
  );
}
