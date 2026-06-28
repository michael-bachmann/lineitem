import { describe, expect, it } from "vitest";
import { mapSeries } from "./async";

describe("mapSeries", () => {
  it("maps in order and passes the index", async () => {
    const result = await mapSeries(["a", "b", "c"], async (item, i) => `${i}:${item}`);
    expect(result).toEqual(["0:a", "1:b", "2:c"]);
  });

  it("awaits each call before starting the next (no overlap)", async () => {
    const events: string[] = [];
    const defer = (ms: number) => new Promise((r) => setTimeout(r, ms));

    await mapSeries([30, 10, 0], async (ms, i) => {
      events.push(`start ${i}`);
      await defer(ms);
      events.push(`end ${i}`);
    });

    // If they ran concurrently the shorter delays would finish first and
    // interleave; sequential execution keeps every start/end strictly paired.
    expect(events).toEqual([
      "start 0", "end 0",
      "start 1", "end 1",
      "start 2", "end 2",
    ]);
  });

  it("returns an empty array for empty input", async () => {
    expect(await mapSeries([], async (x) => x)).toEqual([]);
  });

  it("rejects and stops the series when a call rejects", async () => {
    const seen: number[] = [];
    await expect(
      mapSeries([1, 2, 3], async (n) => {
        seen.push(n);
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
    // The throw propagates and later items never run (sequential short-circuit).
    expect(seen).toEqual([1, 2]);
  });
});
