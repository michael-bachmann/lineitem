// apps/extension/lib/matcher.test.ts
import { describe, expect, it } from "vitest";
import { NO_MATCH_REASON } from "./matcher";

describe("NO_MATCH_REASON", () => {
  it("is a stable non-empty string shared by adapters and sync", () => {
    expect(typeof NO_MATCH_REASON).toBe("string");
    expect(NO_MATCH_REASON.length).toBeGreaterThan(0);
  });
});
