import type { ReactNode } from "react";

export type StatusMessageKind = "muted" | "err" | "ok";

const KIND: Record<StatusMessageKind, string> = {
  muted: "text-faint",
  err: "text-danger",
  ok: "text-ok",
};

/**
 * Inline status / notice line (icon + text) used across onboarding, backfill
 * and settings — e.g. "⚠ Backfill failed: Amazon login required." Pass the
 * icon as the first child; any child svg is clamped to 16px (the design's
 * "status-message icons stay 16px" rule, which prevents unsized icons
 * ballooning).
 */
export function StatusMessage({
  kind = "muted",
  children,
  className = "",
  role,
}: {
  kind?: StatusMessageKind;
  children: ReactNode;
  className?: string;
  /** Set "alert" for error messages that appear on a state transition so AT
   *  announces them; "status" for live-updating progress text. */
  role?: "alert" | "status";
}) {
  return (
    <span
      role={role}
      className={`inline-flex items-center gap-2 text-[13.5px] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:flex-none ${KIND[kind]} ${className}`}
    >
      {children}
    </span>
  );
}
