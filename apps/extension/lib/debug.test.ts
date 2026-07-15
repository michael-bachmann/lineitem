import { describe, it, expect, vi, afterEach } from "vitest";
import { dlog, isDebugEnabled, setDebugEnabled } from "./debug";

afterEach(() => setDebugEnabled(false));

describe("dlog", () => {
  it("is a no-op when disabled", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    setDebugEnabled(false);
    dlog("amazon", "hello");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("logs under a scoped prefix when enabled", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    setDebugEnabled(true);
    dlog("amazon", "rows", { count: 2 });
    expect(spy).toHaveBeenCalledWith("[lineitem:amazon]", "rows", { count: 2 });
    spy.mockRestore();
  });
});

describe("setDebugEnabled / isDebugEnabled", () => {
  it("reflects the flag state", () => {
    setDebugEnabled(true);
    expect(isDebugEnabled()).toBe(true);
    setDebugEnabled(false);
    expect(isDebugEnabled()).toBe(false);
  });
});
