import {
  parseTransactionsFromDocument,
  parseItemsFromDocument,
  type RawTransaction,
  type RawItem,
} from "@/retailers/amazon/scraper";
import {
  AUTH_PAGE_REGEX,
  TRANSACTIONS_URL,
  orderDetailUrl,
} from "@/retailers/amazon/selectors";

interface CheckAuthMessage {
  type: "CHECK_AUTH";
}

interface ScrapeTransactionsMessage {
  type: "SCRAPE_TRANSACTIONS";
  maxPages?: number;
}

interface ScrapeItemsMessage {
  type: "SCRAPE_ITEMS";
  orderId: string;
}

type ContentMessage =
  | CheckAuthMessage
  | ScrapeTransactionsMessage
  | ScrapeItemsMessage;

export default defineContentScript({
  matches: ["*://*.amazon.com/*"],
  main() {
    browser.runtime.onMessage.addListener(
      (message: ContentMessage, _sender, sendResponse) => {
        handleMessage(message).then(sendResponse);
        return true;
      },
    );
  },
});

async function handleMessage(
  message: ContentMessage,
): Promise<unknown> {
  switch (message.type) {
    case "CHECK_AUTH":
      return checkAuth();
    case "SCRAPE_TRANSACTIONS":
      return scrapeTransactions(message.maxPages ?? 5);
    case "SCRAPE_ITEMS":
      return scrapeItems(message.orderId);
    default:
      return { error: `Unknown message type: ${(message as { type: string }).type}` };
  }
}

// ---------------------------------------------------------------------------
// CHECK_AUTH — detect login/challenge pages
// ---------------------------------------------------------------------------

function checkAuth(): { authenticated: boolean } {
  return { authenticated: !AUTH_PAGE_REGEX.test(window.location.href) };
}

// ---------------------------------------------------------------------------
// SCRAPE_TRANSACTIONS — fetch + paginate the transactions page
// ---------------------------------------------------------------------------

async function scrapeTransactions(
  maxPages: number,
): Promise<{ transactions: RawTransaction[] } | { error: string }> {
  try {
    const allTransactions: RawTransaction[] = [];
    let url: string | null = TRANSACTIONS_URL;

    for (let page = 0; page < maxPages && url; page++) {
      const resp = await fetch(url, { credentials: "include" });
      if (!resp.ok) {
        return { error: `Fetch failed: ${resp.status} ${resp.statusText}` };
      }
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, "text/html");

      // Check if we landed on a login page
      if (AUTH_PAGE_REGEX.test(resp.url)) {
        return { error: "auth_required" };
      }

      const parsed = parseTransactionsFromDocument(doc);
      allTransactions.push(...parsed);

      // Look for a next-page button to determine the next URL
      url = findNextPageUrl(doc);
    }

    return { transactions: allTransactions };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to scrape transactions" };
  }
}

/**
 * Find the next-page form action URL from the transactions page.
 * Amazon's pagination uses a form with a submit button; extract the form action.
 */
function findNextPageUrl(doc: Document): string | null {
  const nextButton = doc.querySelector(
    'span.a-button:not(.a-button-disabled) input[type="submit"][aria-labelledby]',
  );
  if (!nextButton) return null;

  const form = nextButton.closest("form");
  if (!form) return null;

  const action = form.getAttribute("action");
  if (!action) return null;

  // Build the full URL from the form action + hidden inputs
  const formData = new URLSearchParams();
  form.querySelectorAll<HTMLInputElement>("input[name]").forEach((input) => {
    formData.set(input.name, input.value);
  });

  try {
    const base = new URL(action, TRANSACTIONS_URL);
    base.search = formData.toString();
    return base.toString();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SCRAPE_ITEMS — fetch a single order detail page
// ---------------------------------------------------------------------------

async function scrapeItems(
  orderId: string,
): Promise<{ items: RawItem[] } | { error: string }> {
  try {
    const url = orderDetailUrl(orderId);
    const resp = await fetch(url, { credentials: "include" });
    if (!resp.ok) {
      return { error: `Fetch failed: ${resp.status} ${resp.statusText}` };
    }
    const html = await resp.text();

    if (AUTH_PAGE_REGEX.test(resp.url)) {
      return { error: "auth_required" };
    }

    const doc = new DOMParser().parseFromString(html, "text/html");
    const items = parseItemsFromDocument(doc);
    return { items };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to scrape items" };
  }
}
