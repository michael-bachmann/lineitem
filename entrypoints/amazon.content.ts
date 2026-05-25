import {
  parseTransactionsFromDocument,
  parseItemsFromDocument,
  parseItemmodFromDocument,
  isGroceryOrder,
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

function scrapeItems():
  | { items: RawItem[] }
  | { requiresItemmod: true }
  | { error: string } {
  if (AUTH_PAGE_REGEX.test(window.location.href)) {
    return { error: "auth_required" };
  }
  if (window.location.search.includes("page=itemmod")) {
    return { items: parseItemmodFromDocument(document) };
  }
  if (isGroceryOrder(document)) {
    return { requiresItemmod: true };
  }
  return { items: parseItemsFromDocument(document) };
}

function randomDelay(min = 1000, max = 3000): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function nextPage(): Promise<{ hasNext: boolean }> {
  const buttons = document.querySelectorAll<HTMLInputElement>(
    SELECTORS.nextPageButton,
  );
  const nextButton = buttons[buttons.length - 1];
  if (!nextButton) return { hasNext: false };

  const labelId = nextButton.getAttribute("aria-labelledby") ?? "";
  const labelEl = labelId ? document.getElementById(labelId) : null;
  if (labelEl?.textContent?.trim() !== "Next Page") return { hasNext: false };

  nextButton.click();
  await randomDelay();
  return { hasNext: true };
}
