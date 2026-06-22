import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  navigateTab,
  waitForContentReady,
  awaitPageResult,
  deliverPageResult,
  clearTabPageResults,
  clearBufferedPageResult,
} from "./tabs";

/** Minimal browser.tabs mock with a controllable onUpdated event. `get` returns
 *  a STALE "complete" status to mimic Firefox reporting the previous page as
 *  loaded right after a navigation — navigateTab must not resolve on that.
 *  `sendMessage` pongs so navigateTab's readiness handshake completes. */
function makeTabsMock() {
  const updateListeners = new Set<(id: number, info: { status?: string }) => void>();
  const removeListeners = new Set<(id: number) => void>();
  return {
    update: vi.fn(async () => {}),
    get: vi.fn(async () => ({ status: "complete" })),
    sendMessage: vi.fn(async () => ({ pong: true })),
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
    // must still be pending — this is the Firefox regression guard. It also must
    // not consult tabs.get at all; doing so is what re-introduces the stale-read.
    expect(resolved).toBe(false);
    expect(tabs.get).not.toHaveBeenCalled();
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

  it("does not resolve on 'complete' until the content script is ready (the handshake gates it)", async () => {
    vi.useFakeTimers();
    let ready = false;
    tabs.sendMessage = vi.fn(async () => {
      if (!ready) throw new Error("Receiving end does not exist.");
      return { pong: true };
    });

    let resolved = false;
    const p = navigateTab(7, "https://example.com/").then(() => {
      resolved = true;
    });

    // The page loaded, but the content script hasn't injected yet — navigateTab
    // must stay pending despite the "complete" event.
    tabs.fireUpdated(7, { status: "complete" });
    await vi.advanceTimersByTimeAsync(300);
    expect(resolved).toBe(false);

    // Script comes alive → the readiness poll pongs → navigateTab resolves.
    ready = true;
    await vi.advanceTimersByTimeAsync(100);
    await p;
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });
});

describe("waitForContentReady", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves immediately when the content script already pongs", async () => {
    const sendMessage = vi.fn(async () => ({ pong: true }));
    vi.stubGlobal("browser", { tabs: { sendMessage } });
    await expect(waitForContentReady(7)).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(7, { type: "PING" });
  });

  it("polls past the injection gap until the script answers", async () => {
    vi.useFakeTimers();
    const noReceiver = new Error("Could not establish connection. Receiving end does not exist.");
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(noReceiver) // still injecting
      .mockRejectedValueOnce(noReceiver)
      .mockResolvedValueOnce({ pong: true }); // ready
    vi.stubGlobal("browser", { tabs: { sendMessage } });

    const p = waitForContentReady(7);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it("throws if the content script never becomes ready within the budget", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("browser", {
      tabs: { sendMessage: vi.fn(async () => { throw new Error("Receiving end does not exist."); }) },
    });
    const p = waitForContentReady(7, 300);
    const assertion = expect(p).rejects.toThrow(/content script not ready within/);
    await vi.advanceTimersByTimeAsync(400);
    await assertion;
  });
});

describe("awaitPageResult", () => {
  // Unique tab ids per test keep the module-level coordinator state isolated.
  it("resolves with the first result matching the predicate", async () => {
    const p = awaitPageResult<{ kind: string }>(101, (r) => r.kind === "want");
    deliverPageResult(101, { kind: "nope" }); // buffered, doesn't match
    deliverPageResult(101, { kind: "want" }); // matches → resolves
    await expect(p).resolves.toEqual({ kind: "want" });
  });

  it("delivers a result that arrived just BEFORE the await (the fast-load race)", async () => {
    deliverPageResult(102, { kind: "early" });
    await expect(awaitPageResult<{ kind: string }>(102, (r) => r.kind === "early")).resolves.toEqual({
      kind: "early",
    });
  });

  it("does not match another tab's result", async () => {
    vi.useFakeTimers();
    const p = awaitPageResult(103, () => true, 1000);
    deliverPageResult(999, { kind: "other-tab" });
    const assertion = expect(p).rejects.toThrow(/no matching page result/);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    vi.useRealTimers();
  });

  it("rejects on timeout when no matching result arrives", async () => {
    vi.useFakeTimers();
    const p = awaitPageResult<{ kind: string }>(104, (r) => r.kind === "never", 500);
    deliverPageResult(104, { kind: "wrong" });
    const assertion = expect(p).rejects.toThrow(/Tab 104 produced no matching page result within/);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    vi.useRealTimers();
  });

  it("clearTabPageResults rejects pending waiters when a tab closes", async () => {
    const p = awaitPageResult(105, () => true);
    clearTabPageResults(105);
    await expect(p).rejects.toThrow(/Tab 105 was closed/);
  });

  // This is the load-bearing guarantee behind "a navigation is a non-event":
  // a buffered result that no waiter matched must not later satisfy a DIFFERENT
  // predicate (e.g. a stale order-A summary resolving the await for order B).
  it("never lets a buffered non-matching result satisfy a later, differently-predicated waiter", async () => {
    const p1 = awaitPageResult<{ id: string }>(106, (r) => r.id === "A");
    deliverPageResult(106, { id: "A" });
    await expect(p1).resolves.toEqual({ id: "A" });

    // A stale "A" lingers in the buffer (nothing matched it).
    deliverPageResult(106, { id: "A" });

    const p2 = awaitPageResult<{ id: string }>(106, (r) => r.id === "B");
    let settled = false;
    void p2.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false); // did NOT resolve on the stale buffered "A"

    deliverPageResult(106, { id: "B" });
    await expect(p2).resolves.toEqual({ id: "B" });
  });

  it("clearBufferedPageResult drops a stale buffered result so the next await ignores it", async () => {
    vi.useFakeTimers();
    deliverPageResult(107, { id: "stale" });
    clearBufferedPageResult(107); // e.g. at the start of a new scrape on a reused tab
    const p = awaitPageResult(107, () => true, 500);
    const assertion = expect(p).rejects.toThrow(/no matching page result/);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    vi.useRealTimers();
  });
});
