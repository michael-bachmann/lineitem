import type { RawTransaction, RawItem } from "./scraper";
import { AUTH_PAGE_REGEX, SELECTORS } from "./selectors";

/** Order-level refund totals (see ScrapedOrder.refund). */
export type RefundSummary = { itemCents: number; taxCents: number; totalCents: number } | null;

/**
 * What an Amazon content script reports about the page it's on, once that page
 * is loaded AND its meaningful DOM has rendered. The content script owns this:
 * it detects the page kind, waits for readiness, parses, and sends exactly one
 * of these as a PAGE_RESULT. The adapter drives the walk by navigating (or
 * triggering an in-page page turn) and awaiting the kind it expects next.
 *
 * `login` is reported for any auth/step-up page, so a sign-in wall hit mid-walk
 * surfaces as an ordinary result instead of a lost reply or a timeout.
 */
export type AmazonPageResult =
  | { pageKind: "login" }
  | {
      pageKind: "transactions";
      /** Identifies this page's content so the adapter can tell a real page turn
       *  from a re-render of the same page. */
      fingerprint: string;
      /** False once there is nothing more to load — the adapter stops paginating
       *  then. On the scrolling list, true means "may have more", not "has more"
       *  (scrolling is how we find out). */
      hasNext: boolean;
      /** The rows not yet reported for this tab: the whole list on the first
       *  read, then only what each scroll appended (legacy layout: the page). */
      transactions: RawTransaction[];
    }
  | {
      pageKind: "order-summary";
      orderId: string;
      /** Null when the subtotal couldn't be read — the adapter treats that as an
       *  unverifiable scrape, the same as the old `missing_subtotal` error. */
      subtotalCents: number | null;
      /** Items read inline from the order-details page — grocery (itemmod rows)
       *  and regular alike. */
      items: RawItem[];
      refund: RefundSummary;
    }
  | { pageKind: "other" };

export type AmazonPageKind = AmazonPageResult["pageKind"];

/**
 * Classify an Amazon URL into the page kind a content script should report.
 * Pure and URL-only so it's unit-testable and identical in the content script
 * and (for the adapter's await predicates) the background. DOM-dependent
 * details (e.g. grocery vs regular) are decided by the content script after
 * this returns "order-summary".
 */
export function detectAmazonPageKind(url: string): AmazonPageKind {
  if (AUTH_PAGE_REGEX.test(url)) return "login";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "other";
  }
  if (u.pathname.startsWith("/cpe/yourpayments/transactions")) return "transactions";
  // Amazon Fresh / Whole Foods orders live under `/uff/your-account/order-details`
  // — the order-details page carries the subtotal AND the grocery line items
  // inline. (`/gp/css/summary/edit` redirects here for grocery orders.)
  if (
    u.pathname.includes("/uff/your-account/order-details") ||
    u.pathname.includes("/css/summary/edit")
  )
    return "order-summary";
  return "other";
}

/** A stable-ish signature of a transactions result's rows, used to detect that a
 *  scroll actually advanced (vs re-reported the same rows). Order-linked rows
 *  carry an orderId; fall back to date+amount for the rest. */
export function transactionsFingerprint(transactions: RawTransaction[]): string {
  return transactions.map((t) => t.orderId ?? `${t.date}:${t.amountCents}`).join("|");
}

/** The `orderID` query param of an order-summary / itemmod URL, or "" if absent. */
export function orderIdFromUrl(url: string): string {
  try {
    return new URL(url).searchParams.get("orderID") ?? "";
  } catch {
    return "";
  }
}

/** Legacy layout only: whether the paged list shows an enabled next-page button.
 *  TODO(2026-12-24): remove with the rest of the legacy layout. */
export function hasNextPage(doc: Document): boolean {
  return doc.querySelector(SELECTORS.legacyNextPageButton) !== null;
}
