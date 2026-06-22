// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { waitUntil, waitForElement, waitForQuietDom } from "./dom-wait";

describe("waitUntil", () => {
  it("returns the value as soon as the probe is truthy", async () => {
    let n = 0;
    const v = await waitUntil(() => (++n >= 3 ? n : null), { intervalMs: 1 });
    expect(v).toBe(3);
  });

  it("returns null on timeout", async () => {
    expect(await waitUntil(() => false, { timeoutMs: 20, intervalMs: 5 })).toBeNull();
  });
});

describe("waitForElement", () => {
  it("resolves once a matching element appears", async () => {
    document.body.innerHTML = "";
    setTimeout(() => {
      document.body.innerHTML = `<div class="row">hi</div>`;
    }, 10);
    const el = await waitForElement(".row", { timeoutMs: 500 });
    expect(el?.textContent).toBe("hi");
  });

  it("returns null when the element never appears", async () => {
    document.body.innerHTML = "";
    expect(await waitForElement(".never", { timeoutMs: 20 })).toBeNull();
  });
});

describe("waitForQuietDom", () => {
  it("resolves quickly when the DOM is already quiet", async () => {
    document.body.innerHTML = "<div>stable</div>";
    const start = Date.now();
    await waitForQuietDom({ quietMs: 30, timeoutMs: 500 });
    expect(Date.now() - start).toBeLessThan(300);
  });

  it("waits out a burst of mutations, then resolves after they stop", async () => {
    document.body.innerHTML = "";
    // Append rows over time; waitForQuietDom should not resolve until they stop.
    let appended = 0;
    const timer = setInterval(() => {
      document.body.appendChild(document.createElement("div"));
      if (++appended >= 3) clearInterval(timer);
    }, 15);
    await waitForQuietDom({ quietMs: 40, timeoutMs: 1000 });
    expect(document.body.children.length).toBe(3); // all appends landed before we resolved
  });
});
