import { describe, expect, it } from "vitest";
import { statusInfo } from "./status";
import { Icon } from "./icons";

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

  it("maps loading → neutral spinner, no glyph", () => {
    const info = statusInfo({ status: "loading" });
    expect(info).toMatchObject({ kind: "neutral", tile: "neutral", spin: true, text: "Checking order…" });
    expect(info.glyph).toBeUndefined();
  });

  it("maps nomatch → neutral with reason + manual-find action", () => {
    expect(statusInfo({ status: "nomatch" })).toMatchObject({
      kind: "neutral",
      tile: "neutral",
      glyph: Icon.search,
      text: "No match found",
      action: { label: "Find order manually", icon: "search" },
    });
  });

  it("maps auth → neutral with open-Amazon action", () => {
    expect(statusInfo({ status: "auth" })).toMatchObject({
      kind: "neutral",
      glyph: Icon.lock,
      text: "Sign in to Amazon",
      action: { label: "Open Amazon", icon: "ext" },
    });
  });

  it("maps error → err with try-again action", () => {
    expect(statusInfo({ status: "error" })).toMatchObject({
      kind: "err",
      tile: "err",
      glyph: Icon.alertCircle,
      text: "Couldn’t read order",
      action: { label: "Try again", icon: "refresh" },
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
