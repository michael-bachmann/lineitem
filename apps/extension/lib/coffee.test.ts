import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory browser.storage.local, shared with the module under test via hoist.
const { store } = vi.hoisted(() => ({ store: { value: {} as Record<string, unknown> } }));
vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      local: {
        get: async (key: string) => (key in store.value ? { [key]: store.value[key] } : {}),
        set: async (obj: Record<string, unknown>) => {
          Object.assign(store.value, obj);
        },
      },
    },
  },
}));

import { recordItemized, retireCoffee } from "./coffee";

beforeEach(() => {
  store.value = {};
});

describe("recordItemized", () => {
  it("does not show below the first threshold", async () => {
    const r = await recordItemized(249);
    expect(r).toEqual({ showCoffee: false, cumulativeItemized: 249 });
  });

  it("shows when the threshold is crossed and doubles the next one", async () => {
    const r = await recordItemized(250);
    expect(r).toEqual({ showCoffee: true, cumulativeItemized: 250 });
    // Next threshold is now 500: 100 more (350 total) must not show.
    expect(await recordItemized(100)).toEqual({ showCoffee: false, cumulativeItemized: 350 });
    // Crossing 500 shows again.
    expect(await recordItemized(150)).toEqual({ showCoffee: true, cumulativeItemized: 500 });
  });

  it("accumulates across calls", async () => {
    await recordItemized(100);
    const r = await recordItemized(160);
    expect(r.cumulativeItemized).toBe(260);
    expect(r.showCoffee).toBe(true);
  });

  it("never shows once retired", async () => {
    await retireCoffee();
    const r = await recordItemized(1000);
    expect(r).toEqual({ showCoffee: false, cumulativeItemized: 1000 });
  });
});
