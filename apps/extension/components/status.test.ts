import { describe, expect, it } from "vitest";
import { statusInfo } from "./status";
import { Icon } from "@lineitem/ui";

describe("statusInfo", () => {
  it("maps classified → ready", () => {
    expect(statusInfo({ status: "classified" })).toMatchObject({
      kind: "ready",
      tile: "ready",
      glyph: Icon.check,
      text: "Ready to approve",
    });
  });

  it("maps partial with a single item (singular copy)", () => {
    expect(statusInfo({ status: "partial", needs: 1 })).toMatchObject({
      kind: "warn",
      tile: "warn",
      glyph: Icon.warnTri,
      text: "1 item needs a category",
    });
  });

  it("maps partial with multiple items (plural copy)", () => {
    expect(statusInfo({ status: "partial", needs: 3 }).text).toBe(
      "3 items need a category",
    );
  });

  it("defaults partial count to 1 when needs is omitted", () => {
    expect(statusInfo({ status: "partial" }).text).toBe("1 item needs a category");
  });

  it("maps nomatch → neutral", () => {
    expect(statusInfo({ status: "nomatch" })).toMatchObject({
      kind: "neutral",
      tile: "neutral",
      glyph: Icon.search,
      text: "No match found",
    });
  });

  it("maps auth → neutral sign-in", () => {
    expect(statusInfo({ status: "auth" })).toMatchObject({
      kind: "neutral",
      glyph: Icon.lock,
      text: "Sign in to read",
    });
  });

  it("maps error → err", () => {
    expect(statusInfo({ status: "error" })).toMatchObject({
      kind: "err",
      tile: "err",
      glyph: Icon.alertCircle,
      text: "Couldn’t read order",
    });
  });

  it("falls back to a neutral Matched state for unknown status", () => {
    expect(statusInfo({ status: "matched" })).toMatchObject({
      kind: "neutral",
      glyph: Icon.receipt,
      text: "Matched",
    });
  });
});
