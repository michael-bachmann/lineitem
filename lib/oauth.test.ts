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
