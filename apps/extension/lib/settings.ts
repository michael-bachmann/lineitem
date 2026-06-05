import { browser } from "wxt/browser";

export interface Settings {
  /** OAuth access token (Bearer); rotates every ~2hr via silent refresh. */
  accessToken: string | null;
  /** Long-lived refresh token used to mint new access tokens. */
  refreshToken: string | null;
  /** Unix ms when accessToken expires. Used to refresh proactively or detect
   *  whether a 401 should trigger a refresh vs a re-auth prompt. */
  accessTokenExpiresAt: number | null;
  planId: string | null;
  planName: string | null;
}

const SETTINGS_KEYS = [
  "accessToken",
  "refreshToken",
  "accessTokenExpiresAt",
  "planId",
  "planName",
] as const;

export async function getSettings(): Promise<Settings> {
  const result = await browser.storage.local.get([...SETTINGS_KEYS]);
  return {
    accessToken: (result.accessToken ?? null) as string | null,
    refreshToken: (result.refreshToken ?? null) as string | null,
    accessTokenExpiresAt: (result.accessTokenExpiresAt ?? null) as number | null,
    planId: (result.planId ?? null) as string | null,
    planName: (result.planName ?? null) as string | null,
  };
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  await browser.storage.local.set(settings);
}

export async function clearSettings(): Promise<void> {
  await browser.storage.local.remove([...SETTINGS_KEYS, "ynabToken"]);
}
