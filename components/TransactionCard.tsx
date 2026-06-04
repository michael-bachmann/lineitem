import type { ReactNode } from "react";
import type { QueueDisplayStatus } from "@/lib/queue";
import { Money } from "./Money";
import { statusInfo, type StatusKind } from "./status";

export interface TransactionVM {
  id: string;
  /** Merchant / payee, shown as stored (often uppercase). */
  payee: string;
  /** Amount in dollars (magnitude; `refund` adds the +/“Refund ·” treatment). */
  amount: number;
  /** Compact date, e.g. "May 20". */
  dateShort: string;
  /** Presentational status (see lib/queue `entryStatus`). */
  status: QueueDisplayStatus;
  /** Uncategorized item count, for the `partial` status text. */
  needs?: number;
  /** YNAB inflow (refund) — shows a + amount and a "Refund ·" status prefix. */
  refund?: boolean;
}

// The card is intentionally quiet: a single status dot carries the color, the
// status text stays neutral-to-semantic. Dot/text color come from statusInfo.kind.
const DOT: Record<StatusKind, string> = {
  ready: "bg-ok",
  warn: "bg-attention",
  err: "bg-danger",
  neutral: "bg-faint",
};
const STATUS_TEXT: Record<StatusKind, string> = {
  ready: "text-muted",
  warn: "text-attention",
  err: "text-danger",
  neutral: "text-muted",
};

const CARD =
  "flex w-full flex-col gap-[5px] rounded-card border border-line bg-surface px-[14px] py-3 text-left shadow-card transition enabled:hover:border-line-strong enabled:hover:bg-surface-2 enabled:active:translate-y-px";

export default function TransactionCard({
  txn,
  onOpen,
}: {
  txn: TransactionVM;
  onOpen?: () => void;
}) {
  const info = statusInfo({ status: txn.status, needs: txn.needs });
  const loading = txn.status === "loading";

  const body: ReactNode = (
    <>
      <div className="flex items-center gap-[9px]">
        <span aria-hidden className={`h-2 w-2 flex-none rounded-full ${DOT[info.kind]}`} />
        <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold tracking-[-0.006em] text-text">
          {txn.payee}
        </span>
        <Money
          value={txn.amount}
          refund={txn.refund}
          className="flex-none text-[15px] font-semibold text-text"
        />
      </div>
      <div className="flex items-baseline gap-2 pl-[17px]">
        <span className={`min-w-0 flex-1 truncate text-[13px] font-medium ${STATUS_TEXT[info.kind]}`}>
          {txn.refund ? `Refund · ${info.text}` : info.text}
        </span>
        <span className="flex-none text-[12.5px] text-faint">{txn.dateShort}</span>
      </div>
    </>
  );

  // A still-resolving row isn't a disabled action — render it as a non-interactive
  // element marked aria-busy, not a <button disabled> (which AT skips).
  if (loading) {
    return (
      <div className={CARD} aria-busy="true">
        {body}
      </div>
    );
  }

  return (
    <button type="button" onClick={() => onOpen?.()} className={CARD}>
      {body}
    </button>
  );
}
