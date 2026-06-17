import type { ReactNode } from "react";

export type ChipTone = "ok" | "neutral";

const TONE: Record<ChipTone, string> = {
  ok: "bg-ok-weak text-ok-text border-ok-line",
  neutral: "bg-surface-3 text-muted border-line",
};

/** Small status pill (e.g. retailer "Live" / "Planned"). */
export function Chip({
  tone = "neutral",
  dot = false,
  children,
}: {
  tone?: ChipTone;
  /** Leading status dot (used by the "Live" pill). */
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-[6px] rounded-pill border px-[10px] py-1 text-[12.5px] font-semibold ${TONE[tone]}`}
    >
      {dot && <span aria-hidden className="h-2 w-2 rounded-full bg-ok" />}
      {children}
    </span>
  );
}
