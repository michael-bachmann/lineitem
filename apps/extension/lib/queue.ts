import type { QueueEntry } from "./types";

/** Returns true when a queue entry is fully classified (matched with all items having a category). */
export function isFullyClassified(entry: QueueEntry): boolean {
  return (
    entry.matchStatus.status === "matched" &&
    entry.matchStatus.classifiedItems.every((item) => item.suggestedCategoryId !== null)
  );
}

/** Presentational status vocabulary used by the queue/detail UI (`statusInfo`). */
export type QueueDisplayStatus =
  | "classified"
  | "partial"
  | "nomatch"
  | "auth"
  | "error";

/** Map a queue entry's domain match-status (+ categorization completeness) onto
 *  the presentational status the UI renders. `needs` = items still uncategorized. */
export function entryStatus(entry: QueueEntry): { status: QueueDisplayStatus; needs: number } {
  const m = entry.matchStatus;
  switch (m.status) {
    case "no_match":
      return { status: "nomatch", needs: 0 };
    case "auth_required":
      return { status: "auth", needs: 0 };
    case "error":
      return { status: "error", needs: 0 };
    case "matched": {
      const needs = m.classifiedItems.filter((i) => i.suggestedCategoryId === null).length;
      return needs === 0 ? { status: "classified", needs: 0 } : { status: "partial", needs };
    }
  }
}
