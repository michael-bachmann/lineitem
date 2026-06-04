import { useEffect, useState } from "react";
import { cancelBackfill, onBackfillProgress, startBackfill } from "@/lib/messaging";
import { BackfillCardView, type BackfillUiState } from "./BackfillCardView";

/** Date 12 months before today, formatted YYYY-MM-DD. The Date constructor
 *  handles month-underflow (month: -1 → previous December) so no mutation. */
function defaultFromDate(): string {
  const now = new Date();
  const past = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
  return past.toISOString().slice(0, 10);
}

interface BackfillCardProps {
  /** Fires whenever the internal UI state changes — lets a parent gate its own
   *  controls (e.g. disable an onboarding Continue button while running). */
  onStateChange?: (state: BackfillUiState) => void;
}

/** Container: owns the backfill state machine + IO (start/cancel + progress
 *  broadcasts); renders the presentational BackfillCardView. */
export default function BackfillCard({ onStateChange }: BackfillCardProps = {}) {
  const [state, setState] = useState<BackfillUiState>({ kind: "idle" });

  useEffect(() => {
    onStateChange?.(state);
  }, [state, onStateChange]);

  useEffect(
    () =>
      onBackfillProgress((event) => {
        // Race guard: a late progress event might land after START_BACKFILL
        // already resolved us to "done"/"error" — don't bounce back to running.
        setState((prev) => (prev.kind === "running" ? { kind: "running", progress: event } : prev));
      }),
    [],
  );

  async function start() {
    setState({ kind: "running", progress: { status: "preparing" } });
    try {
      const res = await startBackfill(defaultFromDate());
      if ("error" in res) setState({ kind: "error", message: res.error });
      else setState({ kind: "done", result: res.result });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Backfill failed" });
    }
  }

  function cancel() {
    void cancelBackfill();
  }

  return <BackfillCardView state={state} onStart={start} onCancel={cancel} />;
}
