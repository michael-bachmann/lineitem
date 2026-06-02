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

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<void> {
  const body: OAuthExchangeRequest = { code, redirect_uri: redirectUri };
  const r = await fetch(`${WORKER_URL}/oauth/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`OAuth exchange failed: ${r.status} ${await r.text()}`);
  }
  const tokens = (await r.json()) as OAuthTokenResponse;
  await saveSettings({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
  });
}

/** Build the YNAB authorize URL for Authorization Code Grant. */
export function buildAuthorizeUrl(): string {
  const redirectUri = browser.identity.getRedirectURL();
  const params = new URLSearchParams({
    client_id: YNAB_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
  });
  return `${YNAB_AUTHORIZE_URL}?${params}`;
}

/** Parse the `code` query parameter from a redirect URL like
 *  `https://<id>.chromiumapp.org/?code=ABC`. */
export function parseCodeFromRedirect(redirectUrl: string): string {
  const code = new URL(redirectUrl).searchParams.get("code");
  if (!code) throw new Error(`No code in redirect: ${redirectUrl}`);
  return code;
}

/** Run the full OAuth consent flow: launch the consent popup, wait for the
 *  redirect, exchange the code for tokens, persist them. Throws if the user
 *  cancels the popup or the exchange fails. */
export async function runOAuthFlow(): Promise<void> {
  const authorizeUrl = buildAuthorizeUrl();
  const redirectUri = browser.identity.getRedirectURL();

  // `interactive: true` shows the consent popup; required for the first
  // grant. Resolves with the final redirect URL or undefined on user cancel.
  const resultUrl = await browser.identity.launchWebAuthFlow({
    url: authorizeUrl,
    interactive: true,
  });
  if (!resultUrl) throw new Error("Sign-in cancelled");

  const code = parseCodeFromRedirect(resultUrl);
  await exchangeCodeForTokens(code, redirectUri);
}
