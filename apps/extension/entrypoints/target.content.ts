// apps/extension/entrypoints/target.content.ts
import {
  parseOrdersFromDocument,
  parseInvoicesListFromDocument,
  parseInvoiceDetailFromDocument,
  parseOrderImageMap,
} from "@/retailers/target/scraper";
import { isLoginUrl } from "@/retailers/target/selectors";

type ContentMessage =
  | { type: "CHECK_AUTH" }
  | { type: "SCRAPE_ORDERS_LIST" }
  | { type: "LOAD_MORE" }
  | { type: "SCRAPE_INVOICES_LIST" }
  | { type: "SCRAPE_INVOICE_DETAIL" }
  | { type: "SCRAPE_ORDER_IMAGES" };

export default defineContentScript({
  matches: ["*://*.target.com/*"],
  main() {
    browser.runtime.onMessage.addListener((message: ContentMessage, sender, sendResponse) => {
      if (sender.id !== browser.runtime.id) return;
      handleMessage(message).then(sendResponse);
      return true;
    });
  },
});

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll until `fn()` returns truthy or timeout; tolerates SPA lazy-render. */
async function waitFor<T>(fn: () => T | null | undefined, timeoutMs = 8000): Promise<T | null> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) return null;
    await delay(200);
  }
}

async function handleMessage(message: ContentMessage): Promise<unknown> {
  if (isLoginUrl(window.location.href)) {
    return message.type === "CHECK_AUTH" ? { authenticated: false } : { error: "auth_required" };
  }
  switch (message.type) {
    case "CHECK_AUTH":
      return { authenticated: true };
    case "SCRAPE_ORDERS_LIST": {
      await waitFor(() => document.querySelector("a[data-test='order-details-link']"));
      return { orders: parseOrdersFromDocument(document) };
    }
    case "LOAD_MORE": {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        /load more/i.test(b.textContent ?? ""),
      );
      if (!btn) return { hasNext: false };
      const before = document.querySelectorAll("a[data-test='order-details-link']").length;
      btn.click();
      await waitFor(
        () => document.querySelectorAll("a[data-test='order-details-link']").length > before,
      );
      return { hasNext: true };
    }
    case "SCRAPE_INVOICES_LIST": {
      await waitFor(() => document.querySelector(".styles_invoiceListGrid__B_fTC"));
      return { invoices: parseInvoicesListFromDocument(document) };
    }
    case "SCRAPE_INVOICE_DETAIL": {
      await waitFor(() => document.querySelector(".styles_infoRow__k6eLr"));
      return { detail: parseInvoiceDetailFromDocument(document) };
    }
    case "SCRAPE_ORDER_IMAGES": {
      await waitFor(() => document.querySelector("h3[id^='item-']"));
      return { imageMap: parseOrderImageMap(document) };
    }
    default:
      return { error: `Unknown message type: ${(message as { type: string }).type}` };
  }
}
