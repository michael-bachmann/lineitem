import { sortBy, unique } from "remeda";
import type { ProductCategory } from "@/lib/types";

export interface EvictionPlan {
  toDelete: readonly string[];
}

export const PER_CATEGORY_CAP = 50;

/**
 * Decide which existing rows to evict to keep each category at or below cap
 * after a batch of writes lands.
 *
 * For each category targeted by an incoming row, count what the category will
 * hold after the writes:
 *   existing rows in that category, minus those being overwritten,
 *   plus incoming rows targeting that category.
 * If that exceeds cap, evict the oldest existing (non-overwritten) rows by
 * `lastSeen` until it doesn't.
 *
 * Incoming rows themselves are never evicted — `lastSeen = now` makes them
 * the freshest anyway.
 */
export function planEviction(
  existing: readonly ProductCategory[],
  incoming: readonly ProductCategory[],
  cap: number,
): EvictionPlan {
  const writeIds = new Set(incoming.map((r) => r.id));
  const targetCategories = unique(incoming.map((r) => r.categoryId));

  const toDelete = targetCategories.flatMap((categoryId) => {
    const existingInCat = existing.filter(
      (r) => r.categoryId === categoryId && !writeIds.has(r.id),
    );
    const incomingInCat = incoming.filter((r) => r.categoryId === categoryId).length;
    const overflow = existingInCat.length + incomingInCat - cap;
    if (overflow <= 0) return [];
    return sortBy(existingInCat, [(r) => r.lastSeen, "asc"])
      .slice(0, overflow)
      .map((r) => r.id);
  });

  return { toDelete };
}
