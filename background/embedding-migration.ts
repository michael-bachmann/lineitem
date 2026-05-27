import { embedBatch, getCurrentModelVersion } from "./embedder";
import { getAllProductCategories, putProductCategory } from "@/lib/db";
import { getSettings, saveSettings } from "@/lib/settings";

const BATCH_SIZE = 16;

/**
 * If the stored vector model version differs from the active one, re-embed
 * every ProductCategory row from its stored title. Idempotent across crashes
 * (interruption just re-runs the migration on next startup).
 * Rows without a title are skipped — they're legacy and will get titles +
 * embeddings on their next approval.
 */
export async function migrateEmbeddingsIfNeeded(): Promise<void> {
  const settings = await getSettings();
  const current = getCurrentModelVersion();
  if (settings.vectorModelVersion === current) return;

  const allRows = await getAllProductCategories();
  const rowsWithTitle = allRows.filter(
    (r) => typeof r.title === "string" && r.title.length > 0,
  );

  for (let i = 0; i < rowsWithTitle.length; i += BATCH_SIZE) {
    const batch = rowsWithTitle.slice(i, i + BATCH_SIZE);
    const vecs = await embedBatch(batch.map((r) => r.title!));
    const now = new Date().toISOString();
    for (let j = 0; j < batch.length; j++) {
      await putProductCategory({
        ...batch[j],
        embedding: vecs[j],
        embeddedAt: now,
      });
    }
  }

  await saveSettings({ vectorModelVersion: current });
}
