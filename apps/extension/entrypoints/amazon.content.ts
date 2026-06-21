import {
  parseTransactionsFromDocument,
  parseItemsFromDocument,
  parseItemmodFromDocument,
  isGroceryOrder,
  extractItemsSubtotal,
  parseRefundSummary,
  type RawTransaction,
  type RawItem,
} from "@/retailers/amazon/scraper";
import { AUTH_PAGE_REGEX, SELECTORS } from "@/retailers/amazon/selectors";

interface CheckAuthMessage {
  type: "CHECK_AUTH";
}

interface ScrapeTransactionsMessage {
  type: "SCRAPE_TRANSACTIONS";
}

interface ScrapeItemsMessage {
  type: "SCRAPE_ITEMS";
}

interface NextPageMessage {
  type: "NEXT_PAGE";
}

type ContentMessage =
  | { type: "PING" }
  | CheckAuthMessage
  | ScrapeTransactionsMessage
  | ScrapeItemsMessage
  | NextPageMessage;

export default defineContentScript({
  matches: ["*://*.amazon.com/*"],
  main() {
    browser.runtime.onMessage.addListener(
      (message: ContentMessage, sender, sendResponse) => {
        if (sender.id !== browser.runtime.id) return;
        handleMessage(message).then(sendResponse);
        return true;
      },
    );
  },
});

async function handleMessage(message: ContentMessage): Promise<unknown> {
  switch (message.type) {
    case "PING":
      // Readiness handshake — see waitForContentReady. Side-effect-free.
      return { pong: true };
    case "CHECK_AUTH":
      return { authenticated: !AUTH_PAGE_REGEX.test(window.location.href) };
    case "SCRAPE_TRANSACTIONS":
      return scrapeTransactions();
    case "SCRAPE_ITEMS":
      return scrapeItems();
    case "NEXT_PAGE":
      return nextPage();
    default:
      return { error: `Unknown message type: ${(message as { type: string }).type}` };
  }
}

function scrapeTransactions(): { transactions: RawTransaction[] } | { error: string } {
  if (AUTH_PAGE_REGEX.test(window.location.href)) {
    return { error: "auth_required" };
  }
  return { transactions: parseTransactionsFromDocument(document) };
}

type RefundSummary = { itemCents: number; taxCents: number; totalCents: number } | null;

function scrapeItems():
  | { items: RawItem[]; subtotalCents: number; refund: RefundSummary }
  | { requiresItemmod: true; subtotalCents: number; refund: RefundSummary }
  | { items: RawItem[]; refund: RefundSummary }
  | { error: string }
{
  if (AUTH_PAGE_REGEX.test(window.location.href)) {
    return { error: "auth_required" };
  }
  // Itemmod page: items only — subtotal lives on the order summary page,
  // and was extracted on the prior SCRAPE_ITEMS request from the adapter.
  if (window.location.search.includes("page=itemmod")) {
    return {
      items: parseItemmodFromDocument(document),
      refund: parseRefundSummary(document),
    };
  }
  // Summary page: extract subtotal first. If we can't, the scrape isn't
  // verifiable and the adapter will surface this as a scrape error.
  const subtotalCents = extractItemsSubtotal(document);
  if (subtotalCents === null) {
    return { error: "missing_subtotal" };
  }
  const refund = parseRefundSummary(document);
  if (isGroceryOrder(document)) {
    return { requiresItemmod: true, subtotalCents, refund };
  }
  return { items: parseItemsFromDocument(document), subtotalCents, refund };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(min = 1000, max = 3000): Promise<void> {
  return delay(Math.floor(Math.random() * (max - min + 1)) + min);
}

/** Poll until `fn()` is truthy or timeout; true if it became truthy in time. */
async function waitFor(fn: () => boolean, timeoutMs = 10000): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (fn()) return true;
    if (Date.now() - start > timeoutMs) return false;
    await delay(150);
  }
}

async function nextPage(): Promise<{ hasNext: boolean }> {
  const nextButton = document.querySelector<HTMLInputElement>(SELECTORS.nextPageButton);
  if (!nextButton) return { hasNext: false };

  // The pager swaps the transactions list in place (AJAX POST → JSON → DOM
  // swap) — no navigation. Wait for the swap to actually land before returning,
  // so the adapter's next SCRAPE_TRANSACTIONS reads the new rows instead of
  // racing the swap and re-reading the old page. The swap detaches the current
  // rows, so we track one and wait for it to leave the DOM. (Fixed-settle
  // fallback only if there are no rows to track — which shouldn't happen when a
  // next button exists.)
  const sentinel = document.querySelector(SELECTORS.lineItem);
  nextButton.click();
  if (sentinel) {
    await waitFor(() => !sentinel.isConnected && document.querySelector(SELECTORS.lineItem) !== null);
  } else {
    await randomDelay();
  }
  return { hasNext: true };
}
