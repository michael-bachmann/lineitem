import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigateTab } from "./tabs";

/** Minimal browser.tabs mock with a controllable onUpdated event. `get` returns
 *  a STALE "complete" status to mimic Firefox reporting the previous page as
 *  loaded right after a navigation — navigateTab must not resolve on that. */
function makeTabsMock() {
  const updateListeners = new Set<(id: number, info: { status?: string }) => void>();
  const removeListeners = new Set<(id: number) => void>();
  return {
    update: vi.fn(async () => {}),
    get: vi.fn(async () => ({ status: "complete" })),
    onUpdated: {
      addListener: (f: (id: number, info: { status?: string }) => void) => updateListeners.add(f),
      removeListener: (f: (id: number, info: { status?: string }) => void) =>
        updateListeners.delete(f),
    },
    onRemoved: {
      addListener: (f: (id: number) => void) => removeListeners.add(f),
      removeListener: (f: (id: number) => void) => removeListeners.delete(f),
    },
    fireUpdated: (id: number, info: { status?: string }) =>
      updateListeners.forEach((f) => f(id, info)),
  };
}

let tabs: ReturnType<typeof makeTabsMock>;

beforeEach(() => {
  tabs = makeTabsMock();
  vi.stubGlobal("browser", { tabs });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Flush pending microtasks so any premature resolve would have settled. */
const flush = () => Promise.resolve().then(() => Promise.resolve());

describe("navigateTab", () => {
  it("does not resolve on the stale pre-navigation status; waits for the new page's complete event", async () => {
    let resolved = false;
    const p = navigateTab(7, "https://example.com/").then(() => {
      resolved = true;
    });

    await flush();
    // Even though browser.tabs.get reports "complete" (the OLD page), navigateTab
    // must still be pending — this is the Firefox regression guard.
    expect(resolved).toBe(false);
    expect(tabs.update).toHaveBeenCalledWith(7, { url: "https://example.com/" });

    tabs.fireUpdated(7, { status: "complete" });
    await p;
    expect(resolved).toBe(true);
  });

  it("ignores complete events for other tabs", async () => {
    let resolved = false;
    const p = navigateTab(7, "https://example.com/").then(() => {
      resolved = true;
    });

    tabs.fireUpdated(99, { status: "complete" });
    tabs.fireUpdated(7, { status: "loading" });
    await flush();
    expect(resolved).toBe(false);

    tabs.fireUpdated(7, { status: "complete" });
    await p;
    expect(resolved).toBe(true);
  });
});
