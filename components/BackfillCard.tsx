import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import type {
  BackfillPhase,
  BackfillProgress,
  BackfillResult,
} from "@/lib/types";

type BackfillUiState =
  | { kind: "idle" }
  | { kind: "running"; phase: BackfillPhase }
  | { kind: "done"; result: BackfillResult }
  | { kind: "error"; message: string };

/** Date 12 months before today, formatted YYYY-MM-DD. */
function defaultFromDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  return d.toISOString().slice(0, 10);
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

const PHASE_LABEL: Record<BackfillPhase, string> = {
  fetching: "Fetching transactions from YNAB…",
  scraping: "Scraping orders (this can take a few minutes)…",
  done: "Finishing up…",
};

export default function BackfillCard() {
  const [state, setState] = useState<BackfillUiState>({ kind: "idle" });

  useEffect(() => {
    const listener = (msg: unknown) => {
      if (!isBackfillProgressMessage(msg)) return;
      setState((prev) =>
        prev.kind === "running" ? { kind: "running", phase: msg.event.phase } : prev,
      );
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  async function start() {
    setState({ kind: "running", phase: "fetching" });
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
        <button
          onClick={start}
          className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm font-medium text-gray-100 hover:bg-gray-700"
        >
          Backfill last 12 months
        </button>
      )}

      {state.kind === "running" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
            <p className="text-xs text-gray-300">{PHASE_LABEL[state.phase]}</p>
          </div>
          <button
            onClick={cancel}
            className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm font-medium text-gray-100 hover:bg-gray-700"
          >
            Cancel
          </button>
        </div>
      )}

      {state.kind === "done" && (
        <div className="space-y-2">
          <p className="text-xs text-gray-300">
            Backfilled {state.result.itemsWritten} items from {state.result.matched} of{" "}
            {state.result.total} transactions.
          </p>
          {/* "Run again" is only useful when some charges didn't match — typically
              because the matching Amazon order belongs to a different account.
              After a clean run, the button has no real purpose. */}
          {state.result.unmatched > 0 && (
            <>
              <p className="text-xs text-gray-400">
                {state.result.unmatched} couldn't be matched — if some are from a different Amazon
                account, sign into it and try again.
              </p>
              <button
                onClick={start}
                className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm font-medium text-gray-100 hover:bg-gray-700"
              >
                Try a different Amazon account
              </button>
            </>
          )}
        </div>
      )}

      {state.kind === "error" && (
        <div className="space-y-2">
          <p className="text-xs text-red-400">{state.message}</p>
          <button
            onClick={start}
            className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm font-medium text-gray-100 hover:bg-gray-700"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
