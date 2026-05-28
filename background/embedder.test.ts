import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the transformers package before importing the module under test.
const { pipelineMock } = vi.hoisted(() => ({ pipelineMock: vi.fn() }));
vi.mock("@huggingface/transformers", () => ({
  pipeline: pipelineMock,
}));

import { embed, embedBatch, _resetForTest } from "./embedder";

function makePipelineFn() {
  return vi.fn(async (texts: string | string[], _opts: unknown) => {
    const arr = Array.isArray(texts) ? texts : [texts];
    const tensorData = new Float32Array(arr.length * 384);
    for (let i = 0; i < arr.length; i++) tensorData[i * 384] = 1;
    return { data: tensorData, dims: [arr.length, 384] };
  });
}

beforeEach(() => {
  _resetForTest();
  const pipeFn = makePipelineFn();
  pipelineMock.mockResolvedValue(pipeFn);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("embedder", () => {
  it("embed() returns a 384-dim normalized Float32Array", async () => {
    const v = await embed("paper towels");
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(384);
    expect(v[0]).toBeCloseTo(1, 5);
  });

  it("embedBatch() returns an array of 384-dim vectors", async () => {
    const vs = await embedBatch(["paper towels", "trash bags", "lightbulb"]);
    expect(vs).toHaveLength(3);
    for (const v of vs) {
      expect(v.length).toBe(384);
    }
  });

  it("embed() lazy-loads pipeline once across calls", async () => {
    await embed("a");
    await embed("b");
    await embed("c");
    expect(pipelineMock).toHaveBeenCalledTimes(1);
  });

  it("embedBatch([]) returns [] without calling the model", async () => {
    const vs = await embedBatch([]);
    expect(vs).toEqual([]);
    expect(pipelineMock).not.toHaveBeenCalled();
  });
});
