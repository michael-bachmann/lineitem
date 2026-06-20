import { adapters } from "@/retailers/registry";

/** All payee mappings derived from the registered retailer adapters. */
export const payeeMappings = adapters.flatMap((adapter) => adapter.payees);

/** "amazon" → "Amazon". Retailer ids are lowercase; titlecase for display. */
export function retailerLabel(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

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
