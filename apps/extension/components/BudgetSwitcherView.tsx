import { useEffect, useRef } from "react";
import { Button, Icon, Spinner, StatusMessage } from "@lineitem/ui";
import type { PlanInfo } from "@/lib/messaging";

/** UI mode for the Connected budget section. `plans` and the pending selection
 *  live in the container (outside the mode) so they survive error round-trips. */
export type BudgetSwitcherMode =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "picking" }
  | { kind: "saving" }
  | { kind: "error"; failed: "load" | "save"; message: string };

interface BudgetSwitcherViewProps {
  current: PlanInfo;
  plans: PlanInfo[];
  selectedId: string;
  mode: BudgetSwitcherMode;
  /** idle → fetch the budget list and open the picker. */
  onChange: () => void;
  onSelect: (id: string) => void;
  onSave: () => void;
  onCancel: () => void;
  /** error → re-run the step that failed (load or save). */
  onRetry: () => void;
}

const CARD = "overflow-hidden rounded-card border border-line bg-surface shadow-card";

/** Presentational "Connected budget" section (design: ConnectedBudget).
 *  Idle wallet card with a Change link; picking is a single grouped card of
 *  hairline-divided radio rows with select-then-Save actions. */
export function BudgetSwitcherView({
  current,
  plans,
  selectedId,
  mode,
  onChange,
  onSelect,
  onSave,
  onCancel,
  onRetry,
}: BudgetSwitcherViewProps) {
  const changeRef = useRef<HTMLButtonElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);

  // Focus return: when the picker/error closes back to idle, put keyboard focus
  // on Change (the codebase standard — see CategorySelect's close(refocus)).
  // The ref-tracked previous kind keeps the initial mount from stealing focus.
  const prevKind = useRef(mode.kind);
  useEffect(() => {
    const was = prevKind.current;
    prevKind.current = mode.kind;
    if (mode.kind === "idle" && was !== "idle") changeRef.current?.focus();
  }, [mode.kind]);

  // Radio-group keyboard contract: arrows move the selection, and focus rides
  // along with it (roving tabindex — only the selected row is tabbable).
  const onRadioKeyDown = (e: React.KeyboardEvent) => {
    const delta =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? -1
          : 0;
    if (delta === 0) return;
    e.preventDefault();
    const index = plans.findIndex((p) => p.id === selectedId);
    const next = plans[(index + delta + plans.length) % plans.length];
    if (!next) return;
    onSelect(next.id);
    groupRef.current?.querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus();
  };

  return (
    <section aria-label="Connected budget" className="flex flex-col gap-2">
      <span className="text-[12px] tracking-[0.03em] text-faint">Connected budget</span>

      {(mode.kind === "idle" || mode.kind === "saving") && (
        <div className="flex items-center gap-[11px] rounded-card border border-line bg-surface px-[13px] py-[11px] shadow-card">
          <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-control bg-brand-weak text-brand">
            <Icon.wallet aria-hidden width={17} height={17} />
          </span>
          {/* aria-live: the name change after a save is the success signal. */}
          <span
            aria-live="polite"
            className="min-w-0 flex-1 text-[14px] font-semibold leading-[1.3] text-text line-clamp-2"
            title={current.name}
          >
            {current.name}
          </span>
          {mode.kind === "saving" ? (
            <span className="flex flex-none items-center gap-[7px] text-[13px] text-faint">
              <Spinner size={13} /> Saving…
            </span>
          ) : (
            <button
              ref={changeRef}
              type="button"
              onClick={onChange}
              className="flex-none px-[2px] py-1 text-[13.5px] font-semibold text-link hover:underline hover:brightness-110"
            >
              Change
            </button>
          )}
        </div>
      )}

      {mode.kind === "loading" && (
        <div aria-busy="true" className={CARD}>
          <div className="flex items-center gap-[9px] px-[13px] py-3 text-[13px] text-faint">
            <Spinner size={13} /> Loading your budgets…
          </div>
          <div className="h-11 animate-pulse border-t border-line bg-surface-2" />
          <div className="h-11 animate-pulse border-t border-line bg-surface-2" />
        </div>
      )}

      {mode.kind === "picking" && (
        <>
          <div ref={groupRef} role="radiogroup" aria-label="Choose a budget" className={CARD}>
            {plans.map((p, i) => {
              const isSelected = p.id === selectedId;
              const isCurrent = p.id === current.id;
              return (
                <button
                  key={p.id}
                  data-id={p.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => onSelect(p.id)}
                  onKeyDown={onRadioKeyDown}
                  className={`flex w-full items-center gap-[10px] px-[13px] py-3 text-left transition-colors ${
                    i > 0 ? "border-t border-line" : ""
                  } ${
                    isSelected
                      ? "bg-[color-mix(in_oklab,var(--ok)_12%,var(--surface))]"
                      : "hover:bg-surface-2"
                  }`}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-[14px] font-semibold leading-[1.3] text-text [word-break:break-word]">
                      {p.name}
                    </span>
                    {isCurrent && (
                      <span className="self-start rounded-pill bg-surface-3 px-2 py-px text-[11px] font-semibold text-muted">
                        Current
                      </span>
                    )}
                  </span>
                  <span aria-hidden className="flex w-4 flex-none items-center justify-center text-text">
                    {isSelected && <Icon.check width={16} height={16} />}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" sm onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" sm disabled={selectedId === current.id} onClick={onSave}>
              Save
            </Button>
          </div>
        </>
      )}

      {mode.kind === "error" && (
        <>
          <StatusMessage kind="err" role="alert">
            <Icon.alertCircle aria-hidden width={16} height={16} /> {mode.message}
          </StatusMessage>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" sm onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="secondary" sm onClick={onRetry}>
              <Icon.refresh aria-hidden width={15} height={15} /> Retry
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
