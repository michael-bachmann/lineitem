import { migrateEmbeddingsIfNeeded } from "./embedding-migration";

let migrationPromise: Promise<void> | null = null;

/**
 * Lazy, memoized trigger for the embedding-vector migration. The first caller
 * within a service-worker lifetime kicks it off; subsequent callers await the
 * same in-flight promise. Steady state (`vectorModelVersion` matches the code
 * constant) returns near-instantly with no work.
 *
 * Lives outside `entrypoints/background.ts` so it can be imported by both the
 * SW entry and other background modules without dragging in WXT's
 * `defineBackground` global at test time.
 */
export function ensureMigrated(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = migrateEmbeddingsIfNeeded().catch((err) => {
      console.warn("Embedding migration failed; will retry on next worker start", err);
      migrationPromise = null;
      throw err;
    });
  }
  return migrationPromise;
}
