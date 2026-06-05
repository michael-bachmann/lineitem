import { adapters } from "@/retailers/registry";

/** All payee mappings derived from the registered retailer adapters. */
export const payeeMappings = adapters.flatMap((adapter) => adapter.payees);

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
