import { Money } from "./Money";
import { statusInfo, type StatusKind } from "./status";

export interface TransactionVM {
  id: string;
  /** Merchant / payee, shown as stored (often uppercase). */
  payee: string;
  /** Amount in dollars (display magnitude). */
  amount: number;
  /** Compact date, e.g. "May 20". */
  dateShort: string;
  /** Presentational status (see lib/queue `entryStatus`). */
  status: string;
  /** Uncategorized item count, for the `partial` status text. */
  needs?: number;
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

export default function TransactionCard({
  txn,
  onOpen,
}: {
  txn: TransactionVM;
  onOpen?: () => void;
}) {
  const info = statusInfo({ status: txn.status, needs: txn.needs });
  const openable = txn.status !== "loading";

  return (
    <button
      type="button"
      disabled={!openable}
      onClick={() => openable && onOpen?.()}
      className="flex w-full flex-col gap-[5px] rounded-card border border-line bg-surface px-[14px] py-3 text-left shadow-card transition enabled:hover:border-line-strong enabled:hover:bg-surface-2 enabled:active:translate-y-px disabled:cursor-default"
    >
      <div className="flex items-center gap-[9px]">
        <span className={`h-2 w-2 flex-none rounded-full ${DOT[info.kind]}`} />
        <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold tracking-[-0.006em] text-text">
          {txn.payee}
        </span>
        <Money value={txn.amount} className="flex-none text-[15px] font-semibold text-text" />
      </div>
      <div className="flex items-baseline gap-2 pl-[17px]">
        <span className={`min-w-0 flex-1 truncate text-[13px] font-medium ${STATUS_TEXT[info.kind]}`}>
          {info.text}
        </span>
        <span className="flex-none text-[12.5px] text-faint">{txn.dateShort}</span>
      </div>
    </button>
  );
}
