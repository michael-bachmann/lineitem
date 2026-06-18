import type { ReactNode } from "react";

/** A "Get involved" card that opens the feedback modal. */
export default function InvolvedCard({
  icon,
  title,
  sub,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-[14px] rounded-control border border-line bg-surface px-[18px] py-4 text-left shadow-card transition hover:border-line-strong hover:bg-surface-2 active:translate-y-px"
    >
      <span
        aria-hidden
        className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] bg-brand-weak text-brand"
      >
        {icon}
      </span>
      <span className="mr-auto flex flex-col gap-[2px]">
        <span className="text-[16px] font-semibold text-text">{title}</span>
        <span className="text-[14px] text-muted">{sub}</span>
      </span>
      <span
        aria-hidden
        className="flex-none text-faint transition-transform group-hover:translate-x-[3px] group-hover:text-brand"
      >
        →
      </span>
    </button>
  );
}
