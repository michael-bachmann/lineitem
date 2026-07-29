import { beforeEach, describe, expect, it, vi } from "vitest";
import { markVersionSeen, shouldShowWhatsNew } from "./whats-new";

const storageState: Record<string, unknown> = {};
vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in storageState ? { [key]: storageState[key] } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(storageState, items);
        }),
      },
    },
  },
}));

const NOTES = { "1.1.0": ["note"], "1.2.0": ["note"] };

beforeEach(() => {
  for (const key of Object.keys(storageState)) delete storageState[key];
});

describe("shouldShowWhatsNew", () => {
  it("shows for an updater — the version has notes and no marker is stored", async () => {
    await expect(shouldShowWhatsNew("1.1.0", NOTES)).resolves.toBe(true);
  });

  it("hides when the running version has no notes entry", async () => {
    await expect(shouldShowWhatsNew("1.1.1", NOTES)).resolves.toBe(false);
  });

  it("hides once the version is marked seen (dismiss, or the install seed)", async () => {
    await markVersionSeen("1.1.0");
    await expect(shouldShowWhatsNew("1.1.0", NOTES)).resolves.toBe(false);
  });

  it("shows again for a later version with notes after an earlier one was seen", async () => {
    await markVersionSeen("1.1.0");
    await expect(shouldShowWhatsNew("1.2.0", NOTES)).resolves.toBe(true);
  });
});
