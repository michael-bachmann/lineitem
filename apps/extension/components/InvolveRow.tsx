import type { ReactNode } from "react";
import { useId } from "react";
import { Icon } from "@lineitem/ui";
import FeedbackForm from "@/components/FeedbackForm";
import type { FeedbackKind } from "@/lib/feedback";

interface InvolveRowProps {
  icon: ReactNode;
  title: string;
  sub: string;
  kind: FeedbackKind;
  expanded: boolean;
  onToggle: () => void;
  context?: Record<string, string>;
}

/** A Help "Get involved" row that expands inline into a FeedbackForm.
 *  Same max-height accordion mechanism as the FAQ above it. */
export default function InvolveRow({
  icon,
  title,
  sub,
  kind,
  expanded,
  onToggle,
  context,
}: InvolveRowProps) {
  const bodyId = useId();
  return (
    <div
      className={`overflow-hidden rounded-card border bg-surface shadow-card transition-colors ${
        expanded ? "border-[var(--brand-line)]" : "border-line"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className="flex w-full items-center gap-3 px-[14px] py-[13px] text-left transition hover:bg-surface-2 active:translate-y-px"
      >
        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-control bg-brand-weak text-brand [&_svg]:h-[17px] [&_svg]:w-[17px]">
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[14px] font-semibold tracking-[-0.004em] text-text">{title}</span>
          <span className="text-[12px] leading-[1.4] text-faint">{sub}</span>
        </span>
        <span
          className={`flex flex-none transition-transform ${
            expanded ? "rotate-90 text-brand" : "text-faint"
          }`}
        >
          <Icon.chevR aria-hidden width={15} height={15} />
        </span>
      </button>
      <div
        id={bodyId}
        aria-hidden={!expanded}
        className={`overflow-hidden transition-[max-height] duration-[260ms] ${
          expanded ? "max-h-[420px]" : "max-h-0"
        }`}
      >
        <FeedbackForm kind={kind} context={context} onDone={onToggle} active={expanded} />
      </div>
    </div>
  );
}
