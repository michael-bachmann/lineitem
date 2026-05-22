import type { LineItem, ClassifiedItem } from "./types";
import { getProductCategory } from "./db";

/**
 * Classify a line item into a YNAB category using the product cache.
 * Returns the cached category if the product has been seen and approved
 * before, otherwise returns null (user must assign manually).
 */
export async function classifyItem(
  item: LineItem,
  retailer: string,
): Promise<{ categoryId: string | null; source: ClassifiedItem["classificationSource"] }> {
  const key = `${retailer}:${item.productId}`;
  const entry = await getProductCategory(key);
  if (entry) {
    return { categoryId: entry.categoryId, source: "product_cache" };
  }

  return { categoryId: null, source: null };
}

/** Classify all line items in parallel. */
export function classifyItems(items: LineItem[], retailer: string): Promise<ClassifiedItem[]> {
  return Promise.all(
    items.map(async (item) => {
      const { categoryId, source } = await classifyItem(item, retailer);
      return { ...item, suggestedCategoryId: categoryId, classificationSource: source };
    }),
  );
}
