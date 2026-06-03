import type { ReactNode } from "react";
import { Icon, type IconComponent, type IconName } from "./icons";
import { Spinner } from "./Spinner";

export type StatusKind = "ready" | "warn" | "neutral" | "err";
export type TileKind = "ready" | "ok" | "warn" | "neutral" | "err";

export interface StatusAction {
  label: string;
  icon: IconName;
}

export interface StatusInfo {
  kind: StatusKind;
  tile: TileKind;
  text: string;
  glyph?: IconComponent;
  spin?: boolean;
  /** One-line "why" shown on failure states. */
  reason?: string;
  action?: StatusAction;
}

export interface StatusInput {
  /** Presentational status vocabulary (screens map domain state onto this). */
  status: string;
  /** Number of items still needing a category, for `partial`. */
  needs?: number;
}

/**
 * Single source of truth mapping a transaction's presentational status to its
 * display metadata. Screens adapt their domain state (match status +
 * categorization completeness) onto this vocabulary.
 */
export function statusInfo({ status, needs }: StatusInput): StatusInfo {
  switch (status) {
    case "classified":
      return { kind: "ready", tile: "ready", glyph: Icon.check, text: "Ready to approve" };
    case "partial": {
      const n = needs ?? 1;
      return {
        kind: "warn",
        tile: "warn",
        glyph: Icon.warnTri,
        text: `${n} item${n > 1 ? "s" : ""} ${n > 1 ? "need" : "needs"} a category`,
      };
    }
    case "loading":
      return { kind: "neutral", tile: "neutral", spin: true, text: "Checking order…" };
    case "nomatch":
      return {
        kind: "neutral",
        tile: "neutral",
        glyph: Icon.search,
        text: "No match found",
        reason: "We couldn’t find an Amazon order near this amount and date.",
        action: { label: "Find order manually", icon: "search" },
      };
    case "auth":
      return {
        kind: "neutral",
        tile: "neutral",
        glyph: Icon.lock,
        text: "Sign in to Amazon",
        reason: "You’re signed out of Amazon, so the order can’t be read.",
        action: { label: "Open Amazon", icon: "ext" },
      };
    case "error":
      return {
        kind: "err",
        tile: "err",
        glyph: Icon.alertCircle,
        text: "Couldn’t read order",
        reason: "Amazon’s order page changed, so the order couldn’t be parsed.",
        action: { label: "Try again", icon: "refresh" },
      };
    default:
      return { kind: "neutral", tile: "neutral", glyph: Icon.receipt, text: "Matched" };
  }
}

const TILE: Record<TileKind, string> = {
  neutral: "bg-surface-3 text-faint",
  ready: "bg-surface-3 text-muted [&_svg]:text-ok-text",
  ok: "bg-ok-weak text-ok-text",
  warn: "bg-attention-weak text-attention",
  err: "bg-danger-weak text-danger",
};

/** Square status/merchant tile anchoring a row (40px). */
export function StatusTile({ status, size = 40 }: { status: string; size?: number }) {
  const info = statusInfo({ status });
  const Glyph = info.glyph;
  return (
    <div
      className={`flex flex-none items-center justify-center rounded-control ${TILE[info.tile]}`}
      style={{ width: size, height: size }}
    >
      {info.spin ? <Spinner size={16} /> : Glyph ? <Glyph width={19} height={19} /> : null}
    </div>
  );
}

const CHIP: Record<TileKind, string> = {
  neutral: "bg-surface-3 text-muted border-line",
  ready: "bg-surface-3 text-muted border-line [&_svg]:text-ok-text",
  ok: "bg-ok-weak text-ok-text border-ok-line",
  warn: "bg-attention-weak text-attention border-attention-line",
  err: "bg-danger-weak text-danger border-danger-line",
};

export function Chip({
  kind = "neutral",
  spin = false,
  children,
}: {
  kind?: TileKind;
  spin?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-[5px] whitespace-nowrap rounded-pill border px-[9px] py-[2px] text-[11.5px] font-semibold leading-[1.55] ${CHIP[kind]}`}
    >
      {spin && <Spinner size={11} />}
      {children}
    </span>
  );
}

/** Inline classification-source icon for an item (✓ history / ✦ suggested / ⚠ needs). */
export function SourceIcon({ source }: { source: "ok" | "embed" | "needs" }) {
  if (source === "ok") {
    return (
      <span className="inline-flex flex-none items-center justify-center text-ok" title="Previously categorized">
        <Icon.check width={15} height={15} />
      </span>
    );
  }
  if (source === "embed") {
    return (
      <span className="inline-flex flex-none items-center justify-center text-link" title="Suggested from similar items">
        <Icon.sparkle width={15} height={15} />
      </span>
    );
  }
  return (
    <span className="inline-flex flex-none items-center justify-center text-attention" title="Needs a category">
      <Icon.warnTri width={15} height={15} />
    </span>
  );
}
