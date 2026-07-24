import { beforeEach, describe, expect, it, vi } from "vitest";
import { switchPlan } from "./plan";
import { getCategories } from "@/lib/ynab";
import { getSettings, saveSettings } from "@/lib/settings";
import { clearLearnedData, putCategories } from "@/lib/db";
import { resetActiveSync } from "./sync";

vi.mock("@/lib/ynab", () => ({
  getCategories: vi.fn(async () => [{ id: "cat-1", name: "Groceries", groupName: "Everyday" }]),
}));

vi.mock("@/lib/settings", () => ({
  getSettings: vi.fn(async () => ({ planId: "plan-a", planName: "Budget A" })),
  saveSettings: vi.fn(async () => {}),
}));

vi.mock("@/lib/db", () => ({
  clearLearnedData: vi.fn(async () => {}),
  putCategories: vi.fn(async () => {}),
}));

vi.mock("./sync", () => ({
  resetActiveSync: vi.fn(),
}));

const mocked = {
  getCategories: vi.mocked(getCategories),
  getSettings: vi.mocked(getSettings),
  saveSettings: vi.mocked(saveSettings),
  clearLearnedData: vi.mocked(clearLearnedData),
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
    expect(mocked.clearLearnedData).not.toHaveBeenCalled();
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

describe("switchPlan clears plan-scoped state on an actual change", () => {
  it("aborts backfill, resets sync, and clears learned data", async () => {
    const abortBackfill = vi.fn();

    await switchPlan("plan-b", "Budget B", { abortBackfill });

    expect(abortBackfill).toHaveBeenCalledOnce();
    expect(mocked.resetActiveSync).toHaveBeenCalledOnce();
    expect(mocked.clearLearnedData).toHaveBeenCalledOnce();
  });

  it("waits for the aborted backfill to settle before clearing learned data", async () => {
    // The backfill's learn phase doesn't observe the abort signal — its writes
    // must land before the clear, or old-plan rows survive the switch.
    const order: string[] = [];
    const abortBackfill = vi.fn(() =>
      Promise.resolve().then(() => {
        order.push("backfill-settled");
      }),
    );
    mocked.clearLearnedData.mockImplementationOnce(async () => {
      order.push("clear");
    });

    await switchPlan("plan-b", "Budget B", { abortBackfill });

    expect(order).toEqual(["backfill-settled", "clear"]);
  });

  it("treats the aborted backfill's rejection as a normal settle", async () => {
    // An aborted run settles by rejecting with AbortError — that's the
    // expected outcome, not a switch failure.
    const abortBackfill = vi.fn(() => Promise.reject(new Error("aborted")));

    await expect(switchPlan("plan-b", "Budget B", { abortBackfill })).resolves.toBeUndefined();
    expect(mocked.clearLearnedData).toHaveBeenCalledOnce();
    expect(mocked.saveSettings).toHaveBeenCalledWith({ planId: "plan-b", planName: "Budget B" });
  });

  it("keeps learned data when re-saving the already-connected plan", async () => {
    const abortBackfill = vi.fn();

    await switchPlan("plan-a", "Budget A", { abortBackfill });

    expect(abortBackfill).not.toHaveBeenCalled();
    expect(mocked.resetActiveSync).not.toHaveBeenCalled();
    expect(mocked.clearLearnedData).not.toHaveBeenCalled();
    expect(mocked.saveSettings).toHaveBeenCalledWith({ planId: "plan-a", planName: "Budget A" });
  });

  it("keeps learned data on the first connect (no previous plan)", async () => {
    mocked.getSettings.mockResolvedValueOnce({ planId: null, planName: null } as never);

    await switchPlan("plan-b", "Budget B");

    expect(mocked.clearLearnedData).not.toHaveBeenCalled();
    expect(mocked.saveSettings).toHaveBeenCalledWith({ planId: "plan-b", planName: "Budget B" });
  });
});
