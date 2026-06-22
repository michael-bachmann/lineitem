/** Default ceiling for a content-script round-trip. A scrape on an already-
 *  loaded page should take well under a second; this only guards against a
 *  content script that received the message but never replies (e.g. a parser
 *  that hung), which `browser.tabs.sendMessage` alone would wait on forever. */
const MESSAGE_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Page-result coordination — the "page owns readiness" model.
//
// A content script describes the page it's on by sending ONE `PAGE_RESULT` once
// the page is loaded and its meaningful DOM has rendered (it owns readiness and
// parsing). The background never polls for readiness or waits on a reply to an
// action that might navigate; it triggers an action (navigate, or an in-page
// command) and then `awaitPageResult` for the next result matching a predicate.
//
// A navigation that destroys the content script is therefore a non-event:
// whichever content script lands on the resulting page sends the next result,
// and the await resolves on that. Auth walls are ordinary results too (the page
// reports a "login" kind), so a mid-walk step-up never hangs or throws.
// ---------------------------------------------------------------------------

interface PageResultWaiter<T> {
  predicate: (result: T) => boolean;
  resolve: (result: T) => void;
  reject: (err: Error) => void;
}

// The newest result for which no waiter was registered yet — covers a result
// that lands a tick before the adapter's await (the cold-start / fast-load
// race). Single-slot: our walks await one result at a time, so a newer result
// supersedes an unconsumed older one.
const bufferedResult = new Map<number, unknown>();
const pageResultWaiters = new Map<number, PageResultWaiter<unknown>[]>();

/**
 * Deliver a page result to the first waiting `awaitPageResult` whose predicate
 * matches, else buffer it for an imminent one. Exported for tests; production
 * wiring is `initPageResultListener`.
 */
export function deliverPageResult(tabId: number, result: unknown): void {
  const queue = pageResultWaiters.get(tabId);
  if (queue) {
    const i = queue.findIndex((w) => w.predicate(result));
    if (i !== -1) {
      const [waiter] = queue.splice(i, 1);
      waiter.resolve(result);
      return;
    }
  }
  bufferedResult.set(tabId, result);
}

/**
 * Resolve with the next `PAGE_RESULT` from `tabId` whose payload matches
 * `predicate` (or a just-buffered one). Rejects if none arrives within
 * `timeoutMs` — a real "the page never reached the expected state" failure the
 * caller surfaces, rather than a silent hang.
 */
export function awaitPageResult<T>(
  tabId: number,
  predicate: (result: T) => boolean,
  timeoutMs = MESSAGE_TIMEOUT_MS,
): Promise<T> {
  const buffered = bufferedResult.get(tabId);
  if (buffered !== undefined && predicate(buffered as T)) {
    bufferedResult.delete(tabId);
    return Promise.resolve(buffered as T);
  }
  return new Promise<T>((resolve, reject) => {
    const queue = pageResultWaiters.get(tabId) ?? [];
    const waiter: PageResultWaiter<unknown> = {
      predicate: predicate as (r: unknown) => boolean,
      resolve: (r) => {
        clearTimeout(timer);
        resolve(r as T);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    };
    const timer = setTimeout(() => {
      const q = pageResultWaiters.get(tabId);
      const i = q?.indexOf(waiter) ?? -1;
      if (q && i !== -1) q.splice(i, 1);
      reject(new Error(`Tab ${tabId} produced no matching page result within ${timeoutMs / 1000}s`));
    }, timeoutMs);
    queue.push(waiter);
    pageResultWaiters.set(tabId, queue);
  });
}

/** Drop any buffered result and fail any pending waiters for a closed tab. */
export function clearTabPageResults(tabId: number): void {
  bufferedResult.delete(tabId);
  const queue = pageResultWaiters.get(tabId);
  if (queue) {
    pageResultWaiters.delete(tabId);
    for (const w of queue) w.reject(new Error(`Tab ${tabId} was closed`));
  }
}

/**
 * Drop only the buffered (unconsumed) result for a tab, leaving any waiters.
 * An adapter calls this at the start of a scrape so a result left in the buffer
 * by a PREVIOUS run on a reused tab (which is never closed) can't be matched as
 * if it were the current page.
 */
export function clearBufferedPageResult(tabId: number): void {
  bufferedResult.delete(tabId);
}

let pageResultListenerReady = false;

/** Wire `PAGE_RESULT` messages and tab-close cleanup to the coordinator above.
 *  Called once at service-worker startup so the listener is live before any
 *  scrape — a result from the very first page load can't be missed. Idempotent. */
export function initPageResultListener(): void {
  if (pageResultListenerReady) return;
  pageResultListenerReady = true;
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (
      typeof message === "object" &&
      message !== null &&
      (message as { type?: string }).type === "PAGE_RESULT" &&
      sender.tab?.id !== undefined
    ) {
      // `result` is unvalidated here — the adapter recovers its retailer-specific
      // type via awaitPageResult<T>. Safe because the sender is our own extension
      // (content scripts), gated by the extension-id check on the content side.
      deliverPageResult(sender.tab.id, (message as { result: unknown }).result);
    }
  });
  browser.tabs.onRemoved.addListener((tabId) => clearTabPageResults(tabId));
}

/** Readiness handshake budget. A tab reports `status: "complete"` before its
 *  content script has finished injecting (most visibly on Firefox), so callers
 *  that just navigated poll PING until the script answers PONG before sending a
 *  real message — see waitForContentReady. */
const READY_PING_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 15_000;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Tab navigation + readiness handshake.
//
// Both retailer adapters now drive pages through the page-result model above.
// These remain because openRetailerTab still has to bring a tab to its start URL
// and confirm the content script is live (PING/PONG) before the first describe;
// the adapters' own navigations go through browser.tabs.update + awaitPageResult.
// ---------------------------------------------------------------------------

/**
 * Resolve once the tab's content script answers a PING — i.e. it's injected and
 * listening. The load event (`status: "complete"`) fires before content scripts
 * inject, so navigating then immediately messaging the page races the
 * injection. Polling an idempotent PING (no side effects, unlike retrying a real
 * scrape message) closes that gap deterministically for every navigation, which
 * is why the navigation primitives below await it before returning.
 */
export async function waitForContentReady(
  tabId: number,
  timeoutMs = READY_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let waited = false;
  for (;;) {
    try {
      const res = await browser.tabs.sendMessage(tabId, { type: "PING" });
      if ((res as { pong?: boolean } | undefined)?.pong) {
        // Surface only when readiness actually lagged the load event — proof the
        // handshake did real work, without a line per poll.
        if (waited) console.info(`[tabs] tab ${tabId} content script ready after wait`);
        return;
      }
    } catch {
      // No receiver yet — content script still injecting. Fall through and retry.
    }
    if (Date.now() >= deadline) {
      throw new Error(`Tab ${tabId} content script not ready within ${timeoutMs / 1000}s`);
    }
    waited = true;
    await delay(READY_PING_INTERVAL_MS);
  }
}

/** Find or create a tab for the given retailer URL. Reuses existing tabs on the same domain. */
export async function openRetailerTab(
  startUrl: string,
): Promise<{ tabId: number; weOpenedTab: boolean } | null> {
  const domain = new URL(startUrl).hostname;
  const existingTabs = await browser.tabs.query({ url: `*://*.${domain}/*` });
  const tab = existingTabs[0];

  if (!tab) {
    const newTab = await browser.tabs.create({ url: startUrl, active: false });
    if (!newTab.id) return null;
    await waitForTabLoad(newTab.id);
    return { tabId: newTab.id, weOpenedTab: true };
  }

  if (!tab.id) return null;

  if (tab.url !== startUrl || tab.status !== "complete") {
    await navigateTab(tab.id, startUrl); // includes the readiness handshake
  } else {
    // Already at the target URL and loaded — confirm the content script is live
    // (it normally is, but a reused tab could still be mid-(re)injection).
    await waitForContentReady(tab.id);
  }

  return { tabId: tab.id, weOpenedTab: false };
}

/**
 * Navigate an existing tab to `url` and resolve once the NEW page finishes
 * loading. The load listener is attached BEFORE the navigation is issued, and
 * there is deliberately no "already complete?" short-circuit — right after
 * `tabs.update` a tab can still report the previous page's `status: "complete"`
 * (consistently on Firefox), which would otherwise resolve immediately and let
 * us scrape the old page. We only resolve on a `complete` event that arrives
 * after we start navigating.
 */
export function navigateTab(tabId: number, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(updateListener);
      browser.tabs.onRemoved.removeListener(removeListener);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Tab ${tabId} did not finish loading ${url} within 30 seconds`));
    }, 30_000);

    const updateListener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        cleanup();
        // "complete" fires before the content script injects — resolve only once
        // the readiness handshake confirms it's listening, so the caller's next
        // message can't race the injection.
        waitForContentReady(tabId).then(resolve, reject);
      }
    };

    const removeListener = (removedTabId: number) => {
      if (removedTabId === tabId) {
        cleanup();
        reject(new Error(`Tab ${tabId} was closed while waiting for it to load`));
      }
    };

    // Attach BEFORE navigating: the new page's "complete" can't be missed, and
    // the old page's lingering "complete" is never observed.
    browser.tabs.onUpdated.addListener(updateListener);
    browser.tabs.onRemoved.addListener(removeListener);
    browser.tabs.update(tabId, { url }).catch((err) => {
      cleanup();
      reject(err);
    });
  });
}

/**
 * Wait for a tab to reach "complete" status. Attaches listeners before
 * checking current status to avoid a race where the tab finishes loading
 * between the navigation call and listener registration.
 */
export function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(updateListener);
      browser.tabs.onRemoved.removeListener(removeListener);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Tab ${tabId} did not finish loading within 30 seconds`));
    }, 30_000);

    const updateListener = (
      updatedTabId: number,
      changeInfo: { status?: string },
    ) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        cleanup();
        waitForContentReady(tabId).then(resolve, reject);
      }
    };

    const removeListener = (removedTabId: number) => {
      if (removedTabId === tabId) {
        cleanup();
        reject(new Error(`Tab ${tabId} was closed while waiting for it to load`));
      }
    };

    // Attach listeners first to avoid missing the "complete" event
    browser.tabs.onUpdated.addListener(updateListener);
    browser.tabs.onRemoved.addListener(removeListener);

    // Check if the tab already finished loading before listeners were attached
    browser.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        cleanup();
        waitForContentReady(tabId).then(resolve, reject);
      }
    }).catch(() => {
      cleanup();
      reject(new Error(`Tab ${tabId} no longer exists`));
    });
  });
}
