import { browser } from "wxt/browser";
import { getSettings, saveSettings } from "./settings";
import type { OAuthExchangeRequest, OAuthRefreshRequest, OAuthTokenResponse } from "./types";

/** Deployed Cloudflare Worker URL — custom domain `auth.lineitem.dev`
 *  attached via the Cloudflare dashboard (Task A5). Must match the entry
 *  in `wxt.config.ts` host_permissions. */
const WORKER_URL = "https://auth.lineitem.dev";

/** YNAB's public OAuth client_id — safe to ship in extension code. */
const YNAB_CLIENT_ID = "PASTE_FROM_YNAB_DEV_SETTINGS";

const YNAB_AUTHORIZE_URL = "https://app.ynab.com/oauth/authorize";

/** Thrown when the refresh token is invalid or revoked; callers prompt the
 *  user to re-auth via launchWebAuthFlow. */
export class NeedsReauthError extends Error {
  constructor() {
    super("YNAB OAuth refresh failed; user must re-authorize");
  }
}

/** Buffer applied to access-token expiry so a request that takes a few
 *  seconds doesn't land with a just-expired token. */
const EXPIRY_BUFFER_MS = 30_000;

/** Returns a valid access token, refreshing via the Worker if needed.
 *  Throws NeedsReauthError when refresh fails or no refresh token exists. */
export async function getValidAccessToken(): Promise<string> {
  const { accessToken, refreshToken, accessTokenExpiresAt } = await getSettings();

  if (accessToken && accessTokenExpiresAt && accessTokenExpiresAt - EXPIRY_BUFFER_MS > Date.now()) {
    return accessToken;
  }

  if (!refreshToken) throw new NeedsReauthError();

  const body: OAuthRefreshRequest = { refresh_token: refreshToken };
  const r = await fetch(`${WORKER_URL}/oauth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new NeedsReauthError();

  const tokens = (await r.json()) as OAuthTokenResponse;
  await saveSettings({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
  });
  return tokens.access_token;
}
