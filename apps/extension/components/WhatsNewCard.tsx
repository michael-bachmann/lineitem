import type { ReactNode } from "react";
import { Icon } from "@lineitem/ui";

/**
 * Release notes per store version, behavior-led — each line says what the user
 * can now do, not what changed inside. A line per change, three max; one
 * semibold key phrase per card. Only the entry matching the running manifest
 * version ever shows (see lib/whats-new), so old entries are history and can
 * be pruned freely.
 */
export const WHATS_NEW: Record<string, ReactNode[]> = {
  "1.2.0": [
    <>
      Your queue now includes <b className="font-semibold text-text">uncategorized transactions</b>,
      even ones YNAB already approved.
    </>,
    <>Approving everything to one category now writes the item-list memo that splits already got.</>,
    <>Amazon grocery orders with partly out-of-stock items now read without erroring.</>,
  ],
  "1.1.0": [
    <>
      You can now <b className="font-semibold text-text">switch budgets</b> in Settings — and
      each one keeps its own learning, ready when you switch back.
    </>,
    <>Connecting now uses the budget you pick during YNAB approval, not just your first one.</>,
    <>Amazon refunds now match back to their original orders more reliably.</>,
  ],
};

interface WhatsNewCardProps {
  /** Running manifest version, shown in the chip. */
  version: string;
  notes: ReactNode[];
  /** Persist the version as seen and hide the card. */
  onDismiss: () => void;
}

/** One-time release-notes card, shown at the top of the queue after an update
 *  until dismissed. CoffeeCard's anatomy with notes as the payload and no CTA. */
export default function WhatsNewCard({ version, notes, onDismiss }: WhatsNewCardProps) {
  return (
    <div
      role="status"
      className="relative flex flex-col gap-3 rounded-card border border-line bg-surface p-[15px] shadow-card"
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-[10px] top-[10px] flex h-[26px] w-[26px] items-center justify-center rounded-control text-faint hover:bg-surface-3 hover:text-muted"
      >
        <Icon.x aria-hidden width={15} height={15} />
      </button>
      <div className="flex items-center gap-[11px]">
        <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-control bg-brand-weak text-brand">
          {/* sparkle's glyph sits ~2 units high in its viewBox; nudge to optical center. */}
          <Icon.sparkle aria-hidden width={20} height={20} className="translate-y-[1.5px]" />
        </span>
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[15px] font-bold tracking-[-0.018em] text-text">What’s new</span>
          <span className="rounded-pill border border-line bg-surface-3 px-[9px] py-[2px] text-[11.5px] font-semibold text-muted">
            v{version}
          </span>
        </div>
      </div>
      <ul className="m-0 flex list-none flex-col gap-[7px] p-0">
        {notes.map((note, i) => (
          <li
            key={i}
            className="relative pl-[15px] text-[12.5px] leading-[1.45] text-muted [text-wrap:pretty]"
          >
            <span
              aria-hidden
              className="absolute left-px top-[6.5px] h-[5px] w-[5px] rounded-full bg-brand"
            />
            {note}
          </li>
        ))}
      </ul>
    </div>
  );
}
