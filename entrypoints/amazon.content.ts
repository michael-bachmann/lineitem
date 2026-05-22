import {
  parseTransactionsFromDocument,
  parseItemsFromDocument,
  type RawTransaction,
  type RawItem,
} from "@/retailers/amazon/scraper";
import { AUTH_PAGE_REGEX, SELECTORS } from "@/retailers/amazon/selectors";

interface CheckAuthMessage {
  type: "CHECK_AUTH";
}

interface ScrapeTransactionsMessage {
  type: "SCRAPE_TRANSACTIONS";
  maxPages?: number;
}

interface ScrapeItemsMessage {
  type: "SCRAPE_ITEMS";
}

type ContentMessage =
  | CheckAuthMessage
  | ScrapeTransactionsMessage
  | ScrapeItemsMessage;

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
    case "CHECK_AUTH":
      return checkAuth();
    case "SCRAPE_TRANSACTIONS":
      return scrapeTransactions(Math.max(1, Math.min(message.maxPages ?? 5, 20)));
    case "SCRAPE_ITEMS":
      return scrapeItems();
    default:
      return { error: `Unknown message type: ${(message as { type: string }).type}` };
  }
}

function checkAuth(): { authenticated: boolean } {
  return { authenticated: !AUTH_PAGE_REGEX.test(window.location.href) };
}

function randomDelay(min = 1000, max = 3000): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapeTransactions(
  maxPages: number,
): Promise<{ transactions: RawTransaction[] } | { error: string }> {
  if (AUTH_PAGE_REGEX.test(window.location.href)) {
    return { error: "auth_required" };
  }

  const allTransactions: RawTransaction[] = [];

  for (let page = 0; page < maxPages; page++) {
    const parsed = parseTransactionsFromDocument(document);
    if (parsed.length === 0 && page === 0) {
      return { transactions: [] };
    }

    allTransactions.push(...parsed);

    const hasNext = await loadNextPage();
    if (!hasNext) break;
  }

  return { transactions: allTransactions };
}

async function loadNextPage(): Promise<boolean> {
  const buttons = document.querySelectorAll<HTMLInputElement>(
    SELECTORS.nextPageButton,
  );
  const nextButton = buttons[buttons.length - 1];
  if (!nextButton) return false;

  const labelId = nextButton.getAttribute("aria-labelledby") ?? "";
  const labelEl = labelId ? document.getElementById(labelId) : null;
  if (labelEl?.textContent?.trim() !== "Next Page") return false;

  nextButton.click();
  await randomDelay();
  return true;
}

async function scrapeItems(): Promise<{ items: RawItem[] } | { error: string }> {
  if (AUTH_PAGE_REGEX.test(window.location.href)) {
    return { error: "auth_required" };
  }

  const items = parseItemsFromDocument(document);
  return { items };
}
