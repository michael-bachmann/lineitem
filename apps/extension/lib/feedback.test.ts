// apps/extension/lib/feedback.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFeedbackForm,
  getBrowserInfo,
  isValidEmail,
  submitFeedback,
  FB_CONFIG,
} from "./feedback";

describe("buildFeedbackForm", () => {
  it("includes access_key, subject, request_type and the primary field per kind", () => {
    const fd = buildFeedbackForm({ kind: "retailer", primary: "Costco", email: "" });
    expect(fd.get("access_key")).toBeTruthy();
    expect(fd.get("subject")).toBe("LineItem · retailer");
    expect(fd.get("request_type")).toBe("retailer");
    expect(fd.get(FB_CONFIG.retailer.primaryName)).toBe("Costco");
  });

  it("uses the issue kind's 'description' primary field name", () => {
    const fd = buildFeedbackForm({ kind: "issue", primary: "It broke", email: "" });
    expect(fd.get("description")).toBe("It broke");
  });

  it("omits email when blank and includes it when present", () => {
    const without = buildFeedbackForm({ kind: "suggestion", primary: "idea", email: "" });
    expect(without.get("email")).toBeNull();
    const wth = buildFeedbackForm({ kind: "suggestion", primary: "idea", email: "a@b.com" });
    expect(wth.get("email")).toBe("a@b.com");
  });

  it("appends context entries (browser + version) for the issue kind", () => {
    const fd = buildFeedbackForm({
      kind: "issue",
      primary: "bug",
      email: "",
      context: { browser: "Chrome 124", version: "1.4.0" },
    });
    expect(fd.get("browser")).toBe("Chrome 124");
    expect(fd.get("version")).toBe("1.4.0");
  });

  it("always sends a botcheck honeypot field — empty by default, the value when set", () => {
    expect(buildFeedbackForm({ kind: "retailer", primary: "x", email: "" }).get("botcheck")).toBe(
      "",
    );
    expect(
      buildFeedbackForm({ kind: "retailer", primary: "x", email: "", botcheck: "i-am-a-bot" }).get(
        "botcheck",
      ),
    ).toBe("i-am-a-bot");
  });
});

describe("isValidEmail", () => {
  it("accepts a normal address", () => {
    expect(isValidEmail("joe@example.com")).toBe(true);
  });

  it("rejects malformed addresses and empty input", () => {
    expect(isValidEmail("joe@@example.com")).toBe(false);
    expect(isValidEmail("joe@example")).toBe(false);
    expect(isValidEmail("not an email")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("submitFeedback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns ok:true when Web3Forms reports success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => ({ success: true }) })),
    );
    expect(await submitFeedback(new FormData())).toEqual({ ok: true });
  });

  it("returns ok:false when Web3Forms reports failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => ({ success: false }) })),
    );
    expect(await submitFeedback(new FormData())).toEqual({ ok: false });
  });

  it("returns ok:false when the request throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await submitFeedback(new FormData())).toEqual({ ok: false });
  });
});

describe("getBrowserInfo", () => {
  it("parses Chrome", () => {
    expect(
      getBrowserInfo(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome 124");
  });

  it("parses Firefox", () => {
    expect(
      getBrowserInfo("Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0"),
    ).toBe("Firefox 125");
  });

  it("parses Edge before Chrome (Edge UA contains 'Chrome')", () => {
    expect(
      getBrowserInfo(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
      ),
    ).toBe("Edge 124");
  });

  it("falls back gracefully on an unknown UA", () => {
    expect(getBrowserInfo("something weird")).toBe("Unknown browser");
  });
});
