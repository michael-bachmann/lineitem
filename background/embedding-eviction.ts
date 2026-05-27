import type { ProductCategory } from "@/lib/types";

export interface EvictionPlan {
  toDelete: string[];
}

export const PER_CATEGORY_CAP = 50;

/**
 * Decide which rows to evict before writing a new entry into a category.
 * If the incoming id already exists, it overwrites in place (no eviction).
 * Otherwise, if the destination category is at cap, evict the oldest by lastSeen.
 */
export function planEviction(
  existing: ProductCategory[],
  destinationCategoryId: string,
  incomingId: string,
  cap: number,
): EvictionPlan {
  const incomingExists = existing.some((r) => r.id === incomingId);
  if (incomingExists) return { toDelete: [] };

  const inCategory = existing.filter((r) => r.categoryId === destinationCategoryId);
  if (inCategory.length < cap) return { toDelete: [] };

  const oldest = inCategory.reduce((a, b) => (a.lastSeen < b.lastSeen ? a : b));
  return { toDelete: [oldest.id] };
}
