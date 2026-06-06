/** Default ceiling for a content-script round-trip. A scrape on an already-
 *  loaded page should take well under a second; this only guards against a
 *  content script that received the message but never replies (e.g. a parser
 *  that hung), which `browser.tabs.sendMessage` alone would wait on forever. */
const MESSAGE_TIMEOUT_MS = 30_000;

/**
 * Send a message to a tab's content script, rejecting if no reply arrives
 * within `timeoutMs`. `browser.tabs.sendMessage` never times out on its own, so
 * a hung scraper would otherwise freeze the whole flow; this turns that hang
 * into a catchable error the caller can retry or skip.
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
    await navigateTab(tab.id, startUrl);
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
        resolve();
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
        resolve();
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
        resolve();
      }
    }).catch(() => {
      cleanup();
      reject(new Error(`Tab ${tabId} no longer exists`));
    });
  });
}
