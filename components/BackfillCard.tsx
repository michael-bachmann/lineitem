import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import type { BackfillProgress, BackfillResult } from "@/lib/types";
import SecondaryButton from "./SecondaryButton";

type BackfillUiState =
  | { kind: "idle" }
  | { kind: "running"; progress: BackfillProgress }
  | { kind: "done"; result: BackfillResult }
  | { kind: "error"; message: string };

/** Date 12 months before today, formatted YYYY-MM-DD. The Date constructor
 *  handles month-underflow (month: -1 → previous December) so no mutation. */
function defaultFromDate(): string {
  const now = new Date();
  const past = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
  return past.toISOString().slice(0, 10);
}

function isBackfillProgressMessage(
  msg: unknown,
): msg is { type: "BACKFILL_PROGRESS"; event: BackfillProgress } {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as { type?: unknown }).type === "BACKFILL_PROGRESS"
  );
}

function progressLabel(p: BackfillProgress): string {
  if (p.status === "preparing") return "Preparing…";
  return `Scraping order ${p.index} of ${p.total}…`;
}

export default function BackfillCard() {
  const [state, setState] = useState<BackfillUiState>({ kind: "idle" });

  useEffect(() => {
    const listener = (msg: unknown) => {
      if (!isBackfillProgressMessage(msg)) return;
      // Race guard: a late progress event might land after the START_BACKFILL
      // response already resolved us to "done" or "error". Don't bounce
      // those terminal states back to "running".
      setState((prev) =>
        prev.kind === "running" ? { kind: "running", progress: msg.event } : prev,
      );
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  async function start() {
    setState({ kind: "running", progress: { status: "preparing" } });
    try {
      const response = (await browser.runtime.sendMessage({
        type: "START_BACKFILL",
        fromDate: defaultFromDate(),
      })) as { ok: true; result: BackfillResult } | { error: string };

      if ("error" in response) {
        setState({ kind: "error", message: response.error });
      } else {
        setState({ kind: "done", result: response.result });
      }
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Backfill failed" });
    }
  }

  async function cancel() {
    await browser.runtime.sendMessage({ type: "CANCEL_BACKFILL" });
  }

  return (
    <div className="rounded-md border border-gray-800 bg-gray-900 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-gray-100">Backfill from past orders</p>
        <p className="text-xs text-gray-400 mt-1">
          Walk your last 12 months of categorized YNAB transactions and learn from the orders
          behind them. Improves category suggestions for future items.
        </p>
      </div>

      {state.kind === "idle" && (
        <SecondaryButton onClick={start}>Backfill last 12 months</SecondaryButton>
      )}

      {state.kind === "running" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
            <p className="text-xs text-gray-300">{progressLabel(state.progress)}</p>
          </div>
          <SecondaryButton onClick={cancel}>Cancel</SecondaryButton>
        </div>
      )}

      {state.kind === "done" && (
        <div className="space-y-2">
          <p className="text-xs text-gray-300">
            Learned {state.result.itemsLearned} items from {state.result.transactionsBackfilled}{" "}
            transactions.
          </p>
          {state.result.failed > 0 && (
            <p className="text-xs text-amber-400">
              {state.result.failed} failed — try again later.
            </p>
          )}
          {/* "Run again" appears whenever eligible transactions remain without
              order data — typically because they're on a different Amazon
              account. We deliberately don't surface the count to avoid making
              "12 still pending" read as failure. */}
          {state.result.hasUnbackfilled && (
            <>
              <p className="text-xs text-gray-400">
                If you have other Amazon accounts, sign in and run again.
              </p>
              <SecondaryButton onClick={start}>Run again</SecondaryButton>
            </>
          )}
        </div>
      )}

      {state.kind === "error" && (
        <div className="space-y-2">
          <p className="text-xs text-red-400">{state.message}</p>
          <SecondaryButton onClick={start}>Try again</SecondaryButton>
        </div>
      )}
    </div>
  );
}
