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
    await browser.tabs.update(tab.id, { url: startUrl });
    await waitForTabLoad(tab.id);
  }

  return { tabId: tab.id, weOpenedTab: false };
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
