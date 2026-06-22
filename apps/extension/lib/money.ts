import type { YnabTransaction, YnabCharge } from "./types";

/** Convert YNAB milliunits to absolute cents. Milliunits are signed (negative = outflow). */
export function millunitsToCents(milliunits: number): number {
  return Math.abs(Math.round(milliunits / 10));
}

/** Convert a YNAB transaction to a normalized YnabCharge (always positive cents). */
export function toYnabCharge(tx: YnabTransaction): YnabCharge {
  return {
    ynabTransactionId: tx.id,
    date: tx.date,
    amountCents: millunitsToCents(tx.amount),
    payeeName: tx.payee_name ?? "",
    isRefund: tx.amount > 0, // YNAB outflows negative; positive amount = refund/inflow
  };
}

/** Format integer cents as a dollar string, e.g. 4299 → "$42.99". */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
