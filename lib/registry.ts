import type { PayeeMapping } from "./types";

/** Ordered by specificity — more specific patterns (e.g. "amazon prime") must come before broad ones. */
export const payeeMappings: PayeeMapping[] = [
  { pattern: /amazon prime/i, retailer: "amazon", strategy: "skip" },
  { pattern: /amazon tips/i, retailer: "amazon", strategy: "skip" },
  { pattern: /amazon|amzn mktp/i, retailer: "amazon", strategy: "scrape" },
];

/** Match a YNAB payee name to a retailer. Returns the first matching pattern. */
export function getRetailerForPayee(
  payeeName: string,
): { retailer: string; strategy: "scrape" | "skip" } | null {
  for (const mapping of payeeMappings) {
    if (mapping.pattern.test(payeeName)) {
      return { retailer: mapping.retailer, strategy: mapping.strategy };
    }
  }
  return null;
}

/** The transactions page URL for each supported retailer. */
export const retailerStartUrls: Record<string, string> = {
  amazon: "https://www.amazon.com/cpe/yourpayments/transactions",
};
