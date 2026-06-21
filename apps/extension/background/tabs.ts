/** Default ceiling for a content-script round-trip. A scrape on an already-
 *  loaded page should take well under a second; this only guards against a
 *  content script that received the message but never replies (e.g. a parser
 *  that hung), which `browser.tabs.sendMessage` alone would wait on forever. */
const MESSAGE_TIMEOUT_MS = 30_000;

/** Readiness handshake budget. A tab reports `status: "complete"` before its
 *  content script has finished injecting (most visibly on Firefox), so callers
 *  that just navigated poll PING until the script answers PONG before sending a
 *  real message — see waitForContentReady. */
const READY_PING_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 15_000;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Send a message to a tab's content script, rejecting if no reply arrives
 * within `timeoutMs`. `browser.tabs.sendMessage` never times out on its own, so
 * a hung scraper would otherwise freeze the whole flow; this turns that hang
 * into a catchable error the caller can retry or skip.
 *
 * Callers reach here only after openRetailerTab/navigateTab/waitForTabLoad have
 * confirmed the content script is live (waitForContentReady), so "Receiving end
 * does not exist" is no longer the common outcome — when it does occur the
 * script went away after the handshake (e.g. a page that navigated out from
 * under a multi-message sequence, like a mid-walk step-up redirect).
 */
export function sendToTab<T>(
  tabId: number,
  message: object,
  timeoutMs = MESSAGE_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const type = (message as { type?: string }).type ?? "message";
    const timer = setTimeout(() => {
      reject(new Error(`Tab ${tabId} did not reply to ${type} within ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
    browser.tabs.sendMessage(tabId, message).then(
      (res) => {
        clearTimeout(timer);
        resolve(res as T);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

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
