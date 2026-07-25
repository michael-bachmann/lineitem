import { beforeEach, describe, expect, it, vi } from "vitest";
import { switchPlan } from "./plan";
import { getCategories } from "@/lib/ynab";
import { getSettings, saveSettings } from "@/lib/settings";
import { putCategories } from "@/lib/db";
import { resetActiveSync } from "./sync";

vi.mock("@/lib/ynab", () => ({
  getCategories: vi.fn(async () => [{ id: "cat-1", name: "Groceries", groupName: "Everyday" }]),
}));

vi.mock("@/lib/settings", () => ({
  getSettings: vi.fn(async () => ({ planId: "plan-a", planName: "Budget A" })),
  saveSettings: vi.fn(async () => {}),
}));

vi.mock("@/lib/db", () => ({
  putCategories: vi.fn(async () => {}),
}));

vi.mock("./sync", () => ({
  resetActiveSync: vi.fn(),
}));

const mocked = {
  getCategories: vi.mocked(getCategories),
  getSettings: vi.mocked(getSettings),
  saveSettings: vi.mocked(saveSettings),
  putCategories: vi.mocked(putCategories),
  resetActiveSync: vi.mocked(resetActiveSync),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("switchPlan fetches before committing", () => {
  it("persists nothing when the new plan's categories can't be fetched", async () => {
    mocked.getCategories.mockRejectedValueOnce(new Error("YNAB API 500: down"));

    await expect(switchPlan("plan-b", "Budget B")).rejects.toThrow("YNAB API 500");

    expect(mocked.saveSettings).not.toHaveBeenCalled();
    expect(mocked.putCategories).not.toHaveBeenCalled();
  });

  it("commits settings only after the categories store is replaced", async () => {
    await switchPlan("plan-b", "Budget B");

    expect(mocked.putCategories).toHaveBeenCalledWith([
      { id: "cat-1", name: "Groceries", groupName: "Everyday" },
    ]);
    expect(mocked.saveSettings).toHaveBeenCalledWith({ planId: "plan-b", planName: "Budget B" });
    const putOrder = mocked.putCategories.mock.invocationCallOrder[0];
    const saveOrder = mocked.saveSettings.mock.invocationCallOrder[0];
    expect(putOrder).toBeLessThan(saveOrder);
  });
});

describe("switchPlan stops old-plan work on an actual change", () => {
  // Learned data is plan-scoped in the db layer, so switching never clears
  // it — these tests cover what a change still has to do: stop in-flight
  // old-plan work before committing the new plan.

  it("aborts backfill and resets sync", async () => {
    const abortBackfill = vi.fn();

    await switchPlan("plan-b", "Budget B", { abortBackfill });

    expect(abortBackfill).toHaveBeenCalledOnce();
    expect(mocked.resetActiveSync).toHaveBeenCalledOnce();
  });

  it("waits for the aborted backfill to settle before committing", async () => {
    const order: string[] = [];
    const abortBackfill = vi.fn(() =>
      Promise.resolve().then(() => {
        order.push("backfill-settled");
      }),
    );
    mocked.putCategories.mockImplementationOnce(async () => {
      order.push("commit");
    });

    await switchPlan("plan-b", "Budget B", { abortBackfill });

    expect(order).toEqual(["backfill-settled", "commit"]);
  });

  it("treats the aborted backfill's rejection as a normal settle", async () => {
    // An aborted run settles by rejecting with AbortError — that's the
    // expected outcome, not a switch failure.
    const abortBackfill = vi.fn(() => Promise.reject(new Error("aborted")));

    await expect(switchPlan("plan-b", "Budget B", { abortBackfill })).resolves.toBeUndefined();
    expect(mocked.saveSettings).toHaveBeenCalledWith({ planId: "plan-b", planName: "Budget B" });
  });

  it("leaves running work alone when re-saving the already-connected plan", async () => {
    const abortBackfill = vi.fn();

    await switchPlan("plan-a", "Budget A", { abortBackfill });

    expect(abortBackfill).not.toHaveBeenCalled();
    expect(mocked.resetActiveSync).not.toHaveBeenCalled();
    expect(mocked.saveSettings).toHaveBeenCalledWith({ planId: "plan-a", planName: "Budget A" });
  });

  it("leaves running work alone on the first connect (no previous plan)", async () => {
    const abortBackfill = vi.fn();
    mocked.getSettings.mockResolvedValueOnce({ planId: null, planName: null } as never);

    await switchPlan("plan-b", "Budget B", { abortBackfill });

    expect(abortBackfill).not.toHaveBeenCalled();
    expect(mocked.saveSettings).toHaveBeenCalledWith({ planId: "plan-b", planName: "Budget B" });
  });
});
