import { useState } from "react";
import { getPlans, savePlan, type PlanInfo } from "@/lib/messaging";
import { YNAB_RECONNECT } from "@/lib/messages";
import { BudgetSwitcherView, type BudgetSwitcherMode } from "./BudgetSwitcherView";

interface BudgetSwitcherProps {
  current: PlanInfo;
  /** Fires after a successful switch so the parent can drop plan-scoped state. */
  onChanged: (plan: PlanInfo) => void;
}

/** Branded copy per failed step; the reauth message passes through verbatim
 *  because its instruction (disconnect + reconnect) is the actual fix. */
function errorText(failed: "load" | "save", raw: string | undefined): string {
  if (raw === YNAB_RECONNECT) return raw;
  return failed === "load"
    ? "Couldn't load your budgets. Check your connection and try again."
    : "Couldn't switch budgets. Check your connection and try again.";
}

/** Container for the Connected budget section: owns the load → pick → save IO.
 *  `plans` and the selection live outside the mode so they survive an error —
 *  Retry re-runs just the failed step (reload the list, or re-save the pick). */
export default function BudgetSwitcher({ current, onChanged }: BudgetSwitcherProps) {
  const [mode, setMode] = useState<BudgetSwitcherMode>({ kind: "idle" });
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [selectedId, setSelectedId] = useState(current.id);

  async function load() {
    setMode({ kind: "loading" });
    try {
      const res = await getPlans();
      if (res.error || !res.plans) {
        return setMode({ kind: "error", failed: "load", message: errorText("load", res.error) });
      }
      setPlans(res.plans);
      setSelectedId(current.id);
      setMode({ kind: "picking" });
    } catch (e) {
      setMode({
        kind: "error",
        failed: "load",
        message: errorText("load", e instanceof Error ? e.message : undefined),
      });
    }
  }

  async function save() {
    const chosen = plans.find((p) => p.id === selectedId);
    if (!chosen || chosen.id === current.id) return;
    setMode({ kind: "saving" });
    try {
      const res = await savePlan(chosen.id, chosen.name);
      if (res?.error) {
        return setMode({ kind: "error", failed: "save", message: errorText("save", res.error) });
      }
      onChanged(chosen);
      setMode({ kind: "idle" });
    } catch (e) {
      setMode({
        kind: "error",
        failed: "save",
        message: errorText("save", e instanceof Error ? e.message : undefined),
      });
    }
  }

  function cancel() {
    setSelectedId(current.id);
    setMode({ kind: "idle" });
  }

  return (
    <BudgetSwitcherView
      current={current}
      plans={plans}
      selectedId={selectedId}
      mode={mode}
      onChange={load}
      onSelect={setSelectedId}
      onSave={save}
      onCancel={cancel}
      onRetry={mode.kind === "error" && mode.failed === "save" ? save : load}
    />
  );
}
