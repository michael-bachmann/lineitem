import type { RawTargetOrder, RawTargetInvoice, RawTargetInvoiceDetail } from "./scraper";
import { isLoginUrl } from "./selectors";

/**
 * What a Target content script reports about the page it's on, once that page is
 * loaded and its meaningful DOM has rendered. The content script detects the kind
 * from the URL, waits for readiness, parses, and sends one of these as a
 * PAGE_RESULT; the adapter drives the walk by navigating (or triggering Load
 * more) and awaiting the kind it expects.
 *
 * `login` is reported for any sign-in / step-up page, so a step-up hit mid-walk
 * (the case that used to hang LOAD_MORE) surfaces as an ordinary result.
 */
export type TargetPageResult =
  | { pageKind: "login" }
  | {
      pageKind: "orders";
      orders: RawTargetOrder[];
      /** Whether a "Load more" button is present — the adapter stops paginating
       *  when it isn't. */
      hasMore: boolean;
      /** Identifies the current (cumulative) list so the adapter can tell a real
       *  Load-more growth from a re-render of the same list. */
      fingerprint: string;
    }
  | { pageKind: "invoices"; orderId: string; invoices: RawTargetInvoice[] }
  | { pageKind: "invoice-detail"; orderId: string; invoiceId: string; detail: RawTargetInvoiceDetail }
  | { pageKind: "order-images"; orderId: string; imageMap: Record<string, string> }
  | { pageKind: "other" };

export type TargetPageKind = TargetPageResult["pageKind"];

function segments(url: string): string[] | null {
  try {
    return new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * Classify a Target URL into the page kind a content script should report. Pure
 * and URL-only so it's unit-testable and shared by the content script (to label
 * itself) and the adapter (for await predicates). Order paths nest by depth:
 *   /orders                              → orders (list)
 *   /orders/{id}                         → order-images (order detail page)
 *   /orders/{id}/invoices                → invoices
 *   /orders/{id}/invoices/{invoiceId}    → invoice-detail
 */
export function detectTargetPageKind(url: string): TargetPageKind {
  if (isLoginUrl(url)) return "login";
  const seg = segments(url);
  if (!seg || seg[0] !== "orders") return "other";
  if (seg.length === 1) return "orders";
  if (seg.length === 2) return "order-images";
  if (seg.length === 3 && seg[2] === "invoices") return "invoices";
  if (seg.length === 4 && seg[2] === "invoices") return "invoice-detail";
  return "other";
}

/** The order id from any `/orders/{id}/...` URL, or "" if absent. */
export function targetOrderIdFromUrl(url: string): string {
  const seg = segments(url);
  return seg && seg[0] === "orders" ? (seg[1] ?? "") : "";
}

/** The invoice id from an `/orders/{id}/invoices/{invoiceId}` URL, or "". */
export function targetInvoiceIdFromUrl(url: string): string {
  const seg = segments(url);
  return seg && seg[0] === "orders" && seg[2] === "invoices" ? (seg[3] ?? "") : "";
}

/** Signature of the cumulative orders list, to detect that Load more grew it.
 *  Relies on Target rendering the list in a stable order (newest-first, append
 *  on Load more) — true today; if that ever changes, a reorder would read as a
 *  new page. The growth is what we care about, so the orderId join is enough. */
export function ordersFingerprint(orders: RawTargetOrder[]): string {
  return orders.map((o) => o.orderId).join("|");
}
