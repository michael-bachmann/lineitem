import { describe, expect, it, beforeEach, vi } from "vitest";

const settingsStore: Record<string, unknown> = {};
const { getSettingsMock, saveSettingsMock, fetchSpy } = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  saveSettingsMock: vi.fn(async (patch: Record<string, unknown>) => Object.assign(settingsStore, patch)),
  fetchSpy: vi.fn(),
}));

vi.mock("./settings", () => ({
  getSettings: getSettingsMock,
  saveSettings: saveSettingsMock,
}));

import { getValidAccessToken, NeedsReauthError } from "./oauth";

beforeEach(() => {
  for (const k of Object.keys(settingsStore)) delete settingsStore[k];
  getSettingsMock.mockReset();
  saveSettingsMock.mockClear();
  vi.spyOn(globalThis, "fetch").mockImplementation(fetchSpy);
  fetchSpy.mockReset();
});

describe("getValidAccessToken", () => {
  it("returns the stored access token when not expired", async () => {
    getSettingsMock.mockResolvedValue({
      accessToken: "current",
      refreshToken: "rt",
      accessTokenExpiresAt: Date.now() + 60_000,
    });
    expect(await getValidAccessToken()).toBe("current");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refreshes via the Worker when expired and persists the new tokens", async () => {
    getSettingsMock.mockResolvedValue({
      accessToken: "stale",
      refreshToken: "rt",
      accessTokenExpiresAt: Date.now() - 1_000,
    });
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        access_token: "fresh",
        refresh_token: "rt2",
        token_type: "Bearer",
        expires_in: 7200,
      }), { status: 200 }),
    );

    expect(await getValidAccessToken()).toBe("fresh");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/oauth/refresh");
    expect(JSON.parse(init!.body as string)).toEqual({ refresh_token: "rt" });

    expect(saveSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "fresh", refreshToken: "rt2" }),
    );
  });

  it("throws NeedsReauthError when refresh returns 4xx", async () => {
    getSettingsMock.mockResolvedValue({
      accessToken: null,
      refreshToken: "rt",
      accessTokenExpiresAt: 0,
    });
    fetchSpy.mockResolvedValue(new Response('{"error":"invalid_grant"}', { status: 400 }));
    await expect(getValidAccessToken()).rejects.toBeInstanceOf(NeedsReauthError);
  });

  it("throws NeedsReauthError when no refresh token is stored", async () => {
    getSettingsMock.mockResolvedValue({ accessToken: null, refreshToken: null, accessTokenExpiresAt: null });
    await expect(getValidAccessToken()).rejects.toBeInstanceOf(NeedsReauthError);
  });
});

describe("exchangeCodeForTokens", () => {
  it("POSTs code + redirect_uri to the Worker and persists returned tokens", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        access_token: "at",
        refresh_token: "rt",
        token_type: "Bearer",
        expires_in: 7200,
      }), { status: 200 }),
    );

    const { exchangeCodeForTokens } = await import("./oauth");
    const before = Date.now();
    await exchangeCodeForTokens("CODE", "https://ext.example/");
    const after = Date.now();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/oauth/exchange");
    expect(JSON.parse(init!.body as string)).toEqual({
      code: "CODE",
      redirect_uri: "https://ext.example/",
    });

    expect(saveSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "at",
        refreshToken: "rt",
        accessTokenExpiresAt: expect.any(Number),
      }),
    );
    const { accessTokenExpiresAt } = saveSettingsMock.mock.calls[0][0];
    expect(accessTokenExpiresAt).toBeGreaterThanOrEqual(before + 7200_000);
    expect(accessTokenExpiresAt).toBeLessThanOrEqual(after + 7200_000);
  });

  it("throws on 4xx", async () => {
    fetchSpy.mockResolvedValue(new Response('{"error":"invalid_grant"}', { status: 400 }));
    const { exchangeCodeForTokens } = await import("./oauth");
    await expect(exchangeCodeForTokens("bad", "https://ext/")).rejects.toThrow();
  });
});

describe("parseCodeFromRedirect", () => {
  it("extracts the code query parameter", async () => {
    const { parseCodeFromRedirect } = await import("./oauth");
    expect(parseCodeFromRedirect("https://abc.chromiumapp.org/?code=XYZ")).toBe("XYZ");
  });

  it("throws when code is missing", async () => {
    const { parseCodeFromRedirect } = await import("./oauth");
    expect(() => parseCodeFromRedirect("https://abc.chromiumapp.org/?error=denied"))
      .toThrow(/No code/);
  });
});
