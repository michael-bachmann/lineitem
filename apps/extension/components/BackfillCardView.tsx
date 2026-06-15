import type { BackfillProgress, BackfillResult } from "@/lib/types";
import { retailerLabel } from "@/lib/registry";
import { Button, Spinner, StatusMessage, Icon } from "@lineitem/ui";

export type BackfillUiState =
  | { kind: "idle" }
  | { kind: "running"; progress: BackfillProgress }
  | { kind: "done"; result: BackfillResult }
  | { kind: "error"; message: string };

function progressLabel(p: BackfillProgress): string {
  if (p.status === "preparing") return "Preparing…";
  if (p.status === "learning") return `Learning from item ${p.index} of ${p.total}…`;
  return `Scraping order ${p.index} of ${p.total}…`;
}

/** Rough 0–100 fill: scraping fills the first ~60%, learning the rest. */
function progressPct(p: BackfillProgress): number {
  if (p.status === "preparing") return 6;
  const frac = p.total > 0 ? p.index / p.total : 0;
  return p.status === "scraping" ? Math.round(6 + frac * 54) : Math.round(60 + frac * 40);
}

/** "Target 15 of 29 · Amazon 4 of 6" — per-retailer matched/eligible. */
function retailerSummary(byRetailer: BackfillResult["byRetailer"]): string {
  return byRetailer
    .filter((r) => r.eligible > 0)
    .map((r) => `${retailerLabel(r.retailer)} ${r.matched} of ${r.eligible}`)
    .join(" · ");
}

interface BackfillCardViewProps {
  state: BackfillUiState;
  onStart: () => void;
  onCancel: () => void;
}

/** Presentational backfill card — all states, no IO. */
export function BackfillCardView({ state, onStart, onCancel }: BackfillCardViewProps) {
  return (
    <div className="flex flex-col gap-[11px] rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center gap-[10px]">
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-control bg-brand-weak text-brand">
          <Icon.history aria-hidden width={17} height={17} />
        </span>
        <h2 className="m-0 text-[16.5px] font-bold tracking-[-0.018em] text-text">
          Backfill from past orders
        </h2>
      </div>
      <p className="m-0 text-[13px] leading-[1.55] text-muted">
        Walk your last 12 months of categorized YNAB transactions and learn from the orders behind
        them. Improves category suggestions for future items.
      </p>

      {state.kind === "idle" && (
        <Button variant="secondary" onClick={onStart}>
          Backfill last 12 months
        </Button>
      )}

      {state.kind === "running" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-[9px] text-[13px] text-muted">
            <Spinner size={15} /> {progressLabel(state.progress)}
          </div>
          <div
            role="progressbar"
            aria-valuenow={progressPct(state.progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={progressLabel(state.progress)}
            className="h-[6px] overflow-hidden rounded-full bg-surface-3"
          >
            <div
              className="h-full rounded-full bg-ink transition-[width] duration-[400ms]"
              style={{ width: `${progressPct(state.progress)}%` }}
            />
          </div>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}

      {state.kind === "done" && (
        <div className="flex flex-col gap-2">
          {/* Shared 21px icon column so the check + retry icons align with the
              first line of text; m-0 on the <p>s keeps the rows flush. */}
          <div className="flex items-start gap-[9px]">
            <span className="flex h-[21px] w-[21px] flex-none items-center justify-center rounded-full bg-ok-weak text-ok-text">
              <Icon.check aria-hidden width={13} height={13} />
            </span>
            <p className="m-0 text-[13.5px] leading-[21px] text-text">
              Learned <b className="font-bold">{state.result.itemsLearned} items</b> from{" "}
              <b className="font-bold">{state.result.transactionsBackfilled} transactions</b>.
            </p>
          </div>
          {state.result.byRetailer.some((r) => r.eligible > 0) && (
            <div className="flex items-start gap-[9px]">
              <span className="h-[21px] w-[21px] flex-none" aria-hidden />
              <p className="m-0 text-[12.5px] leading-[21px] text-muted">
                {retailerSummary(state.result.byRetailer)}
              </p>
            </div>
          )}
          {state.result.failed > 0 && (
            <div className="flex items-start gap-[9px]">
              <span className="flex h-[21px] w-[21px] flex-none items-center justify-center text-faint">
                <Icon.refresh aria-hidden width={15} height={15} />
              </span>
              <p className="m-0 text-[12.5px] leading-[21px] text-faint">
                {state.result.failed} couldn’t be read — run again to retry them.
              </p>
            </div>
          )}
          {state.result.hasUnbackfilled && (
            <>
              <p className="m-0 text-[13px] leading-[1.55] text-muted">
                Some charges won’t match — in-store purchases, or orders paid on a card not in YNAB.
                If you shop on another account, sign in to it and run again.
              </p>
              <Button variant="secondary" onClick={onStart}>
                Run again
              </Button>
            </>
          )}
        </div>
      )}

      {state.kind === "error" && (
        <>
          <StatusMessage kind="err" role="alert">
            <Icon.alertCircle aria-hidden /> Backfill failed: {state.message}
          </StatusMessage>
          <Button variant="secondary" onClick={onStart}>
            Try again
          </Button>
        </>
      )}
    </div>
  );
}
