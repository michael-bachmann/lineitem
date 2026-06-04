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
}: {
  kind?: StatusMessageKind;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 text-[13.5px] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:flex-none ${KIND[kind]} ${className}`}
    >
      {children}
    </span>
  );
}
