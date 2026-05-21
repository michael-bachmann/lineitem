import { browser } from "wxt/browser";

export interface Settings {
  ynabToken: string | null;
  budgetId: string | null;
  budgetName: string | null;
}

const SETTINGS_KEYS = ["ynabToken", "budgetId", "budgetName"] as const;

export async function getSettings(): Promise<Settings> {
  const result = await browser.storage.local.get([...SETTINGS_KEYS]);
  return {
    ynabToken: (result.ynabToken as string) ?? null,
    budgetId: (result.budgetId as string) ?? null,
    budgetName: (result.budgetName as string) ?? null,
  };
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  await browser.storage.local.set(settings);
}

export async function clearSettings(): Promise<void> {
  await browser.storage.local.remove([...SETTINGS_KEYS]);
}
