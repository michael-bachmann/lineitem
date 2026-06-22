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
      /** Whether a (non-disabled) next-page button exists — the adapter stops
       *  paginating when it doesn't. */
      hasNext: boolean;
      transactions: RawTransaction[];
    }
  | {
      pageKind: "order-summary";
      orderId: string;
      /** Null when the subtotal couldn't be read — the adapter treats that as an
       *  unverifiable scrape, the same as the old `missing_subtotal` error. */
      subtotalCents: number | null;
      /** Grocery orders list items on a separate itemmod page; when true the
       *  adapter navigates there next and `items` here is empty. */
      requiresItemmod: boolean;
      items: RawItem[];
      refund: RefundSummary;
    }
  | { pageKind: "itemmod"; orderId: string; items: RawItem[]; refund: RefundSummary }
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
  if (u.searchParams.get("page") === "itemmod") return "itemmod";
  if (u.pathname.includes("/css/summary/edit")) return "order-summary";
  return "other";
}

/** A stable-ish signature of a transactions page's rows, used to detect that a
 *  page turn actually advanced (vs re-rendered the same page). Order-linked rows
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

/** Whether the transactions page shows an enabled next-page button. */
export function hasNextPage(doc: Document): boolean {
  return doc.querySelector(SELECTORS.nextPageButton) !== null;
}
