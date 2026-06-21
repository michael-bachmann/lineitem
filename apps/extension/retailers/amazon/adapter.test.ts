import { describe, expect, it } from "vitest";
import { isPageTurnChannelError } from "./adapter";

describe("isPageTurnChannelError", () => {
  // Turning Amazon's pager drops the content-script message channel, so the
  // NEXT_PAGE reply is lost and the send rejects with one of these. That means
  // "the page turned" (re-sync and continue), not "the scrape failed".
  it("matches the message-channel-closed error", () => {
    expect(
      isPageTurnChannelError(
        new Error(
          "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received",
        ),
      ),
    ).toBe(true);
  });

  it("matches the receiving-end-does-not-exist error (observed on Firefox NEXT_PAGE)", () => {
    expect(
      isPageTurnChannelError(new Error("Could not establish connection. Receiving end does not exist.")),
    ).toBe(true);
  });

  it("does NOT match a sendToTab reply timeout — a genuine hang must still propagate", () => {
    expect(isPageTurnChannelError(new Error("Tab 7 did not reply to NEXT_PAGE within 30 seconds"))).toBe(false);
  });

  it("does NOT match an unrelated error", () => {
    expect(isPageTurnChannelError(new Error("boom"))).toBe(false);
    expect(isPageTurnChannelError("not an error")).toBe(false);
  });
});
