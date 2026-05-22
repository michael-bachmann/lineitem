import { browser } from "wxt/browser";

export interface Settings {
  ynabToken: string | null;
  planId: string | null;
  planName: string | null;
}

const SETTINGS_KEYS = ["ynabToken", "planId", "planName"] as const;

export async function getSettings(): Promise<Settings> {
  const result = await browser.storage.local.get([...SETTINGS_KEYS]);
  return {
    ynabToken: (result.ynabToken ?? null) as string | null,
    planId: (result.planId ?? null) as string | null,
    planName: (result.planName ?? null) as string | null,
  };
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  await browser.storage.local.set(settings);
}

export async function clearSettings(): Promise<void> {
  await browser.storage.local.remove([...SETTINGS_KEYS]);
}
