/** Minimal shape of the Workers Rate Limiting binding (env.RATE_LIMITER).
 *  Declared locally so we don't depend on the binding's type being exported by
 *  the installed @cloudflare/workers-types version. */
interface RateLimiter {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  YNAB_CLIENT_ID: string;
  YNAB_CLIENT_SECRET: string;
  RATE_LIMITER: RateLimiter;
}

const YNAB_TOKEN_URL = "https://app.ynab.com/oauth/token";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const isExchange = req.method === "POST" && url.pathname === "/oauth/exchange";
    const isRefresh = req.method === "POST" && url.pathname === "/oauth/refresh";
    if (!isExchange && !isRefresh) return new Response("not found", { status: 404 });

    // Per-IP rate limit. Both endpoints share one bucket — they hold our YNAB
    // client_secret, so we cap how fast any single client can drive token
    // exchanges against YNAB and get our OAuth app flagged.
    const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) return new Response("rate limit exceeded", { status: 429 });

    const body = await parseJson(req);
    if (!body) return badRequest("invalid JSON body");

    return isExchange ? exchange(body, env) : refresh(body, env);
  },
};

async function exchange(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { code, redirect_uri } = body;
  if (!isNonEmptyString(code)) return badRequest("missing code");
  if (!isHttpsUrl(redirect_uri)) return badRequest("invalid redirect_uri");
  return forwardToYnab({
    client_id: env.YNAB_CLIENT_ID,
    client_secret: env.YNAB_CLIENT_SECRET,
    code,
    redirect_uri,
    grant_type: "authorization_code",
  });
}

async function refresh(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { refresh_token } = body;
  if (!isNonEmptyString(refresh_token)) return badRequest("missing refresh_token");
  return forwardToYnab({
    client_id: env.YNAB_CLIENT_ID,
    client_secret: env.YNAB_CLIENT_SECRET,
    refresh_token,
    grant_type: "refresh_token",
  });
}

async function forwardToYnab(body: Record<string, string>): Promise<Response> {
  const r = await fetch(YNAB_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}

/** Parse a JSON object body, returning null on malformed JSON or non-objects. */
async function parseJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await req.json();
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** True only for well-formed https URLs — keeps us from forwarding arbitrary
 *  attacker-supplied redirect_uri values to YNAB. */
function isHttpsUrl(v: unknown): v is string {
  if (typeof v !== "string") return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}
