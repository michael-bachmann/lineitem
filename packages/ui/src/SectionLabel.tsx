import type { ReactNode } from "react";

/**
 * Small uppercase section/group header ("NEEDS REVIEW", "ITEMS"). Optional
 * trailing count for queue groups. Uses the sans font (the prototype's
 * font-mono here contradicts the "no monospace" type rule).
 */
export function SectionLabel({
  children,
  count,
  className = "",
}: {
  children: ReactNode;
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={`my-[2px] flex items-center gap-[7px] text-[11px] font-bold uppercase tracking-[0.055em] text-faint ${className}`}
    >
      {children}
      {count != null && <span className="font-semibold opacity-65">{count}</span>}
    </div>
  );
}
