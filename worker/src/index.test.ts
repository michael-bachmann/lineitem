import { describe, expect, it, vi, beforeEach } from "vitest";
import worker from "./index";

const env = { YNAB_CLIENT_ID: "cid", YNAB_CLIENT_SECRET: "csec" };

function req(path: string, body: unknown): Request {
  return new Request(`https://w.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.restoreAllMocks());

describe("POST /oauth/exchange", () => {
  it("forwards code + redirect_uri to YNAB with the secret added", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", token_type: "Bearer", expires_in: 7200 }), { status: 200 }),
    );

    const res = await worker.fetch(
      req("/oauth/exchange", { code: "AUTHCODE", redirect_uri: "https://ext.chromiumapp.org/" }),
      env,
    );

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://app.ynab.com/oauth/token");
    const params = new URLSearchParams(init!.body as string);
    expect(params.get("client_id")).toBe("cid");
    expect(params.get("client_secret")).toBe("csec");
    expect(params.get("code")).toBe("AUTHCODE");
    expect(params.get("redirect_uri")).toBe("https://ext.chromiumapp.org/");
    expect(params.get("grant_type")).toBe("authorization_code");
  });

  it("passes YNAB's error body and status through unchanged", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"error":"invalid_grant"}', { status: 400 }),
    );
    const res = await worker.fetch(req("/oauth/exchange", { code: "bad", redirect_uri: "x" }), env);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('{"error":"invalid_grant"}');
  });
});

describe("POST /oauth/refresh", () => {
  it("forwards refresh_token to YNAB with the secret + grant_type=refresh_token", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "at2", refresh_token: "rt2", token_type: "Bearer", expires_in: 7200 }), { status: 200 }),
    );
    const res = await worker.fetch(req("/oauth/refresh", { refresh_token: "RT" }), env);
    expect(res.status).toBe(200);
    const params = new URLSearchParams(fetchSpy.mock.calls[0][1]!.body as string);
    expect(params.get("client_id")).toBe("cid");
    expect(params.get("client_secret")).toBe("csec");
    expect(params.get("refresh_token")).toBe("RT");
    expect(params.get("grant_type")).toBe("refresh_token");
  });
});

describe("routing", () => {
  it("404s unknown paths", async () => {
    const res = await worker.fetch(req("/bogus", {}), env);
    expect(res.status).toBe(404);
  });

  it("404s on non-POST methods", async () => {
    const res = await worker.fetch(new Request("https://w.example/oauth/exchange"), env);
    expect(res.status).toBe(404);
  });
});
