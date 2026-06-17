import { describe, expect, it } from "vitest";
import { isPageTurnNavigationError } from "./adapter";

describe("isPageTurnNavigationError", () => {
  // A NEXT_PAGE click navigates the tab and tears down the content script
  // mid-reply; Chrome surfaces that teardown as these two messages, which mean
  // "the page turned", not "the scrape failed".
  it("matches the message-channel-closed teardown error", () => {
    expect(
      isPageTurnNavigationError(
        new Error(
          "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received",
        ),
      ),
    ).toBe(true);
  });

  it("matches the receiving-end-does-not-exist error", () => {
    expect(
      isPageTurnNavigationError(new Error("Could not establish connection. Receiving end does not exist.")),
    ).toBe(true);
  });

  it("does NOT match a sendToTab timeout — a genuine hang must still propagate", () => {
    expect(isPageTurnNavigationError(new Error("Tab 7 did not reply to NEXT_PAGE within 30 seconds"))).toBe(false);
  });

  it("does NOT match an unrelated error", () => {
    expect(isPageTurnNavigationError(new Error("boom"))).toBe(false);
    expect(isPageTurnNavigationError("not an error")).toBe(false);
  });
});
