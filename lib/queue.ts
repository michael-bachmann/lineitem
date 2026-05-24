import type { QueueEntry } from "./types";

/** Returns true when a queue entry is fully classified (matched with all items having a category). */
export function isFullyClassified(entry: QueueEntry): boolean {
  return (
    entry.matchStatus.status === "matched" &&
    entry.matchStatus.classifiedItems.every((item) => item.suggestedCategoryId !== null)
  );
}
