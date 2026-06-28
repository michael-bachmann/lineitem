import {
  parseTransactionsFromDocument,
  parseItemsFromDocument,
  parseItemmodFromDocument,
  isGroceryOrder,
  extractItemsSubtotal,
  parseRefundSummary,
} from "@/retailers/amazon/scraper";
import { SELECTORS } from "@/retailers/amazon/selectors";
import {
  detectAmazonPageKind,
  transactionsFingerprint,
  hasNextPage,
  orderIdFromUrl,
  type AmazonPageResult,
} from "@/retailers/amazon/page";
import { waitUntil, waitForElement, waitForQuietDom } from "@/lib/dom-wait";

/** Actions the adapter triggers on the live page. Neither needs a reply: the
 *  adapter reacts to the PAGE_RESULT the page sends afterwards, not to a return
 *  value — so an action that navigates (and destroys this context) is fine. */
type ContentMessage =
  | { type: "PING" }
  | { type: "DESCRIBE" }
  | { type: "NEXT_PAGE" };

export default defineContentScript({
  matches: ["*://*.amazon.com/*"],
  main() {
    browser.runtime.onMessage.addListener((message: ContentMessage, sender) => {
      if (sender.id !== browser.runtime.id) return;
      // PING is the only message anyone awaits a reply to (the readiness
      // handshake used when opening/navigating a tab); answer it with a Promise.
      // DESCRIBE/NEXT_PAGE are fire-and-forget triggers — the page answers by
      // sending a PAGE_RESULT, so there's no response here.
      if (message.type === "PING") return Promise.resolve({ pong: true });
      if (message.type === "NEXT_PAGE") void turnPage();
      else void describe();
    });

    // Describe this page as soon as it's loaded. This is what makes a navigation
    // (or Firefox's reload-on-page-turn) a non-event: whatever page lands here
    // announces itself, and the adapter's awaitPageResult resolves on it.
    void describe();
  },
});

/** Detect the page, wait for its meaningful DOM, parse, and report one result. */
async function describe(): Promise<void> {
  const kind = detectAmazonPageKind(window.location.href);
  switch (kind) {
    case "login":
      return post({ pageKind: "login" });

    case "transactions": {
      // The list renders asynchronously after load; wait for rows before reading
      // so we never report an empty page and skip real transactions.
      await waitForElement(SELECTORS.lineItem);
      const transactions = parseTransactionsFromDocument(document);
      return post({
        pageKind: "transactions",
        fingerprint: transactionsFingerprint(transactions),
        hasNext: hasNextPage(document),
        transactions,
      });
    }

    case "order-summary": {
      // The subtotal anchors the scrape-completeness check; treat its presence as
      // readiness (`!== null`, so a $0 subtotal still counts). We deliberately
      // don't also race a "login" probe here (no waitForAny): Amazon auth is a
      // URL redirect to /ap/signin, which detectAmazonPageKind catches as `login`
      // on the freshly-loaded page — an order page can't silently become a login
      // wall without navigating. If the subtotal never renders, report null and
      // let the adapter surface the unverifiable scrape (the `missing_subtotal`
      // path), which the per-order retry then reattempts.
      const ready = await waitUntil(() => extractItemsSubtotal(document) !== null);
      const subtotalCents = ready ? extractItemsSubtotal(document) : null;
      const refund = parseRefundSummary(document);
      // The Fresh order-details page (/uff) lists grocery items inline using the
      // itemmod row structure; read them with the grocery parser when present,
      // else use the regular order parser.
      const hasInlineItems = document.querySelector(SELECTORS.itemmodItemRow) !== null;
      // Tripwire: the old layout served grocery items on a separate ?page=itemmod
      // page, and we dropped that fallback after a full backfill confirmed it's no
      // longer used. If a grocery order ever shows no inline rows again (e.g. an
      // A/B layout), it reads empty here and surfaces as a read-failure — flag it.
      if (!hasInlineItems && isGroceryOrder(document)) {
        console.warn(`[amazon] grocery order has no inline items (itemmod fallback removed): ${window.location.href}`);
      }
      const items = hasInlineItems
        ? parseItemmodFromDocument(document)
        : parseItemsFromDocument(document);
      return post({
        pageKind: "order-summary",
        orderId: orderIdFromUrl(window.location.href),
        subtotalCents,
        items,
        refund,
      });
    }

    default:
      // Unrecognized page — nothing awaits an "other" result, so don't post one
      // (it would only sit in the buffer as noise). The adapter's await times out
      // on its own if it ever lands somewhere unexpected.
      // Surface the landing URL: an unclassified page means the adapter's await
      // will time out (we post nothing), so a future Amazon redirect that breaks
      // classification shows up as an actionable log instead of a silent 30s hang.
      console.warn(`[amazon] landed on unclassified page: ${window.location.href}`);
      return;
  }
}

/** Turn Amazon's transactions pager. In Chrome this is an in-page AJAX swap, so
 *  the same context waits for the new rows and re-describes; in Firefox the click
 *  reloads the page, so this context is torn down and the freshly-loaded page
 *  describes itself. Either way the adapter gets the next transactions result. */
async function turnPage(): Promise<void> {
  const nextButton = document.querySelector<HTMLInputElement>(SELECTORS.nextPageButton);
  if (!nextButton) {
    // No next page after all — re-describe so the adapter sees hasNext:false.
    return describe();
  }
  const sentinel = document.querySelector(SELECTORS.lineItem);
  nextButton.click();
  // Wait for the AJAX swap to replace the old rows with new ones (Chrome), then
  // let the new rows finish rendering before we read — same settle contract as
  // Target's Load more, so we never describe a half-swapped page. On a Firefox
  // reload this context is torn down mid-wait and the fresh page describes
  // itself instead — either way the adapter gets the next result.
  if (sentinel) {
    const swapped = await waitUntil(
      () => !sentinel.isConnected && document.querySelector(SELECTORS.lineItem) !== null,
      { timeoutMs: 15_000 },
    );
    if (swapped) await waitForQuietDom({ quietMs: 400, timeoutMs: 4_000 });
  }
  return describe();
}

function post(result: AmazonPageResult): void {
  // Fire-and-forget: the background's PAGE_RESULT listener has no response.
  browser.runtime.sendMessage({ type: "PAGE_RESULT", result }).catch(() => {});
}
