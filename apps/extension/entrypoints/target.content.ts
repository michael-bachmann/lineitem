// apps/extension/entrypoints/target.content.ts
import {
  parseOrdersFromDocument,
  parseInvoicesListFromDocument,
  parseInvoiceDetailFromDocument,
  parseOrderImageMap,
  parseStoreOrdersFromDocument,
  parseStorePurchaseDetailFromDocument,
} from "@/retailers/target/scraper";
import { SELECTORS } from "@/retailers/target/selectors";
import {
  detectTargetPageKind,
  targetOrderIdFromUrl,
  targetInvoiceIdFromUrl,
  targetReceiptIdFromUrl,
  ordersFingerprint,
  storeOrdersFingerprint,
  type TargetPageResult,
} from "@/retailers/target/page";
import { waitUntil, waitForElement, waitForQuietDom } from "@/lib/dom-wait";

/** Actions the adapter triggers on the live page. Neither needs a reply: the
 *  adapter reacts to the PAGE_RESULT the page sends afterwards. */
type ContentMessage =
  | { type: "PING" }
  | { type: "DESCRIBE" }
  | { type: "DESCRIBE_STORE_ORDERS" }
  | { type: "LOAD_MORE" };

/** The "orders" URL (/orders) covers both tabs — switching is client-side, no
 *  navigation — so `describe()` can't tell them apart from the URL alone.
 *  Set once by `describeStoreOrders()` and read by `describe()`/`loadMore()`
 *  for as long as this content-script instance lives (i.e. until a real
 *  navigation reinjects it back to "online"). */
let listMode: "online" | "store" = "online";

export default defineContentScript({
  matches: ["*://*.target.com/*"],
  main() {
    browser.runtime.onMessage.addListener((message: ContentMessage, sender) => {
      if (sender.id !== browser.runtime.id) return;
      // PING is the only awaited reply (the readiness handshake). DESCRIBE and
      // LOAD_MORE are fire-and-forget triggers — the page answers with a
      // PAGE_RESULT, so a LOAD_MORE that redirects to step-up never hangs.
      if (message.type === "PING") return Promise.resolve({ pong: true });
      if (message.type === "LOAD_MORE") void loadMore();
      else if (message.type === "DESCRIBE_STORE_ORDERS") void describeStoreOrders();
      else void describe();
    });

    // Announce this page as soon as it's loaded — what makes a navigation (or a
    // step-up redirect) a non-event for the adapter.
    void describe();
  },
});

/** Detect the page, wait for its meaningful DOM, parse, and report one result. */
async function describe(): Promise<void> {
  const href = window.location.href;
  switch (detectTargetPageKind(href)) {
    case "login":
      return post({ pageKind: "login" });

    case "orders": {
      if (listMode === "store") {
        await waitForElement(SELECTORS.storeOrderCard);
        const orders = parseStoreOrdersFromDocument(document);
        return post({
          pageKind: "store-orders",
          orders,
          hasMore: loadMoreButton() !== null,
          fingerprint: storeOrdersFingerprint(orders),
        });
      }
      await waitForElement(SELECTORS.orderCard);
      const orders = parseOrdersFromDocument(document);
      return post({
        pageKind: "orders",
        orders,
        hasMore: loadMoreButton() !== null,
        fingerprint: ordersFingerprint(orders),
      });
    }

    case "invoices": {
      await waitForElement(SELECTORS.invoiceRow);
      return post({
        pageKind: "invoices",
        orderId: targetOrderIdFromUrl(href),
        invoices: parseInvoicesListFromDocument(document),
      });
    }

    case "invoice-detail": {
      await waitForElement(SELECTORS.invoiceItemRow);
      return post({
        pageKind: "invoice-detail",
        orderId: targetOrderIdFromUrl(href),
        invoiceId: targetInvoiceIdFromUrl(href),
        detail: parseInvoiceDetailFromDocument(document),
      });
    }

    case "order-images": {
      await waitForElement(SELECTORS.orderItemTitle);
      return post({
        pageKind: "order-images",
        orderId: targetOrderIdFromUrl(href),
        imageMap: parseOrderImageMap(document),
      });
    }

    case "store-purchase-detail": {
      await waitForElement(SELECTORS.storeItemWrapper);
      return post({
        pageKind: "store-purchase-detail",
        receiptId: targetReceiptIdFromUrl(href),
        detail: parseStorePurchaseDetailFromDocument(document),
        imageMap: parseOrderImageMap(document),
      });
    }

    default:
      // Unrecognized page — nothing awaits it, so don't post (avoids buffer noise).
      return;
  }
}

/** Switch to the in-store tab (if not already there), wait for its list to
 *  render, and describe it. `listMode` then stays "store" for as long as this
 *  content-script instance lives, so a subsequent LOAD_MORE/DESCRIBE on this
 *  same /orders page keeps reading the in-store list. */
async function describeStoreOrders(): Promise<void> {
  listMode = "store";
  const tab = document.querySelector<HTMLElement>(SELECTORS.tabInstore);
  if (tab && tab.getAttribute("aria-selected") !== "true") tab.click();
  return describe();
}

/** "Load more" appends rows in-page (no navigation). Click it, wait for the list
 *  to grow, then re-describe so the adapter gets the larger orders list. If a
 *  step-up redirect fires instead, the freshly-loaded login page describes
 *  itself and the adapter's await resolves on that. */
async function loadMore(): Promise<void> {
  const btn = loadMoreButton();
  if (!btn) return describe(); // no more pages — re-describe shows hasMore:false
  const cardSelector = listMode === "store" ? SELECTORS.storeOrderCard : SELECTORS.orderCard;
  const before = document.querySelectorAll(cardSelector).length;
  btn.click();
  // Wait for the append to actually land (generously — Firefox's append can lag
  // a few seconds), THEN let the list settle before reading. Reporting a stale
  // list because we gave up too early is what truncated the walk on slow runs.
  const grew = await waitUntil(
    () => document.querySelectorAll(cardSelector).length > before,
    { timeoutMs: 20_000 },
  );
  if (grew) await waitForQuietDom({ quietMs: 400, timeoutMs: 4_000 });
  return describe();
}

function loadMoreButton(): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>(SELECTORS.loadMoreButton)].find((b) =>
      /load more/i.test(b.textContent ?? ""),
    ) ?? null
  );
}

function post(result: TargetPageResult): void {
  browser.runtime.sendMessage({ type: "PAGE_RESULT", result }).catch(() => {});
}
