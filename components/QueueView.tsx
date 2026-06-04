import type { QueueEntry } from "@/lib/types";
import { entryStatus, isFullyClassified, type QueueDisplayStatus } from "@/lib/queue";
import { millunitsToCents } from "@/lib/money";
import TransactionCard, { type TransactionVM } from "@/components/TransactionCard";
import { BrandRow } from "@/components/Mark";
import { IconButton } from "@/components/IconButton";
import { Button } from "@/components/Button";
import { SectionLabel } from "@/components/SectionLabel";
import { Icon } from "@/components/icons";

interface QueueViewProps {
  queue: QueueEntry[];
  syncing: boolean;
  approving: boolean;
  error: string | null;
  onSync: () => void;
  onApproveAll: () => void;
  onSelectEntry: (entry: QueueEntry) => void;
  onSettings: () => void;
}

const GROUPS: { key: string; label: string; has: (s: QueueDisplayStatus) => boolean }[] = [
  { key: "review", label: "Needs review", has: (s) => s === "partial" },
  { key: "ready", label: "Ready to approve", has: (s) => s === "classified" },
  { key: "working", label: "Checking", has: (s) => s === "loading" },
  { key: "unmatched", label: "Couldn’t match", has: (s) => ["nomatch", "auth", "error"].includes(s) },
];

/** ISO date (YYYY-MM-DD) → compact "May 20". */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function QueueView({
  queue,
  syncing,
  approving,
  error,
  onSync,
  onApproveAll,
  onSelectEntry,
  onSettings,
}: QueueViewProps) {
  const vms = queue.map((entry): TransactionVM & { onOpen: () => void } => {
    const { status, needs } = entryStatus(entry);
    return {
      id: entry.ynabTransaction.id,
      payee: entry.ynabTransaction.payee_name ?? "Unknown payee",
      // Magnitude only for now — refund/inflow sign display needs the design's
      // negative-card treatment (ui-shots/txn-card-negative). TODO: handle sign.
      amount: Math.abs(millunitsToCents(entry.ynabTransaction.amount)) / 100,
      dateShort: formatDate(entry.ynabTransaction.date),
      status,
      needs,
      onOpen: () => onSelectEntry(entry),
    };
  });

  const total = queue.length;
  const readyCount = queue.filter(isFullyClassified).length;
  const empty = total === 0 && !error;
  const groups = GROUPS.map((g) => ({ ...g, items: vms.filter((v) => g.has(v.status)) })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <div className="flex min-h-screen flex-col gap-3 bg-bg p-4 text-text">
      <div className="flex items-center gap-[10px]">
        <div className="mr-auto min-w-0">
          <BrandRow />
        </div>
        <IconButton aria-label="Settings" onClick={onSettings}>
          <Icon.gear aria-hidden width={18} height={18} />
        </IconButton>
        <Button variant="primary" sm busy={syncing} busyLabel="Syncing…" onClick={onSync}>
          {!syncing && <Icon.sync aria-hidden width={15} height={15} />} Sync
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-[9px] rounded-card border border-danger-line bg-danger-weak px-[13px] py-[11px] text-[13px] leading-[1.5] text-danger [&_svg]:mt-px [&_svg]:h-4 [&_svg]:w-4 [&_svg]:flex-none"
        >
          <Icon.alertCircle aria-hidden />
          <span>Sync failed: {error}</span>
        </div>
      )}

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center text-faint">
          <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-line bg-surface">
            <Icon.inbox aria-hidden width={24} height={24} />
          </span>
          <p className="m-0 max-w-[230px] text-[13.5px] leading-[1.5]">
            No transactions to review. Tap <b className="font-semibold text-muted">Sync</b> to check
            for new Amazon charges.
          </p>
        </div>
      ) : (
        <>
          {total > 0 && (
            <div className="text-[13px] text-faint">
              <b className="font-semibold text-muted">{total}</b> transaction{total === 1 ? "" : "s"}
              <span className="mx-1 opacity-50">·</span>
              <b className="font-semibold text-muted">{readyCount}</b> ready
            </div>
          )}

          {groups.map((g) => (
            <div key={g.key} className="flex flex-col gap-3">
              <SectionLabel count={g.items.length}>{g.label}</SectionLabel>
              <div className="flex flex-col gap-3">
                {g.items.map((v) => (
                  <TransactionCard key={v.id} txn={v} onOpen={v.onOpen} />
                ))}
              </div>
            </div>
          ))}

          {readyCount > 0 && (
            <div className="sticky bottom-0 -mx-4 -mb-4 px-4 pt-3 [background:linear-gradient(180deg,transparent,var(--bg)_38%)]">
              <Button variant="primary" busy={approving} busyLabel="Approving…" onClick={onApproveAll}>
                Approve {readyCount} ready
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
