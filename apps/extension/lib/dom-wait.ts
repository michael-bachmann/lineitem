// Content-script readiness primitives. Each retailer page owns its readiness
// check (see each content script's `describe()`); these are the shared building
// blocks. Per the consultant's guidance, prefer observing the DOM settle over
// guessing with a fixed timeout. DOM-only — call from content scripts.

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll `probe` until it returns a truthy value or `timeoutMs` elapses; returns
 * the value, or null on timeout. The general "wait until this condition holds"
 * primitive (used for readiness conditions that aren't a single selector, e.g.
 * "the subtotal has rendered" or "the list grew").
 */
export async function waitUntil<T>(
  probe: () => T | null | undefined | false,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T | null> {
  const { timeoutMs = 10_000, intervalMs = 150 } = opts;
  const start = Date.now();
  for (;;) {
    const v = probe();
    if (v) return v;
    if (Date.now() - start > timeoutMs) return null;
    await delay(intervalMs);
  }
}

/** Wait for an element matching `selector` to exist under `root` (or null on timeout). */
export function waitForElement(
  selector: string,
  opts: { root?: ParentNode; timeoutMs?: number } = {},
): Promise<Element | null> {
  const root = opts.root ?? document;
  return waitUntil(() => root.querySelector(selector), { timeoutMs: opts.timeoutMs });
}

/**
 * Resolve once the DOM under `root` has gone quiet — no mutations for `quietMs`
 * — or `timeoutMs` elapses. More reliable than a fixed delay for "the async
 * render/append has finished settling": a slow append keeps resetting the quiet
 * window instead of being missed by a too-short timeout.
 */
export function waitForQuietDom(
  opts: { root?: Node; quietMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const root = opts.root ?? document.documentElement;
  const quietMs = opts.quietMs ?? 300;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  return new Promise((resolve) => {
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(bump);
    const hardStop = setTimeout(finish, timeoutMs);

    function finish() {
      clearTimeout(hardStop);
      if (quietTimer) clearTimeout(quietTimer);
      observer.disconnect();
      resolve();
    }
    function bump() {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, quietMs);
    }

    observer.observe(root, { childList: true, subtree: true, attributes: true });
    bump(); // start the quiet window even if no mutations ever arrive
  });
}
