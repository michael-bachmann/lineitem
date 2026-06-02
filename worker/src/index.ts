interface Env {
  YNAB_CLIENT_ID: string;
  YNAB_CLIENT_SECRET: string;
}

const YNAB_TOKEN_URL = "https://app.ynab.com/oauth/token";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/oauth/exchange") {
      return exchange(req, env);
    }
    if (req.method === "POST" && url.pathname === "/oauth/refresh") {
      return refresh(req, env);
    }
    return new Response("not found", { status: 404 });
  },
};

async function exchange(req: Request, env: Env): Promise<Response> {
  const { code, redirect_uri } = (await req.json()) as { code: string; redirect_uri: string };
  return forwardToYnab({
    client_id: env.YNAB_CLIENT_ID,
    client_secret: env.YNAB_CLIENT_SECRET,
    code,
    redirect_uri,
    grant_type: "authorization_code",
  });
}

async function refresh(req: Request, env: Env): Promise<Response> {
  const { refresh_token } = (await req.json()) as { refresh_token: string };
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
