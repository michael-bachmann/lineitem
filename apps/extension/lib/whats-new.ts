import { browser } from "wxt/browser";

/** Storage key for the last version whose release notes the user has seen (or
 *  was seeded with at install). Deliberately outside SETTINGS_KEYS so
 *  disconnecting YNAB can't resurrect old notes. */
const LAST_SEEN_VERSION_KEY = "lastSeenVersion";

/**
 * Whether the queue should show the what's-new card: `version` has release
 * notes and the user hasn't seen them yet. Fresh installs are seeded at
 * install time (background onInstalled), so only updaters ever see notes —
 * and only the running version's; skipped versions don't queue.
 */
export async function shouldShowWhatsNew(
  version: string,
  notes: Record<string, unknown>,
): Promise<boolean> {
  if (!(version in notes)) return false;
  const flags = await browser.storage.local.get(LAST_SEEN_VERSION_KEY);
  return flags[LAST_SEEN_VERSION_KEY] !== version;
}

/** Record `version` as seen — on dismiss, and as the fresh-install seed. */
export async function markVersionSeen(version: string): Promise<void> {
  await browser.storage.local.set({ [LAST_SEEN_VERSION_KEY]: version });
}
