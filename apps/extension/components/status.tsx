import { Icon, type IconComponent, type IconName, Spinner } from "@lineitem/ui";

export type StatusKind = "ready" | "warn" | "neutral" | "err";
export type TileKind = "ready" | "ok" | "warn" | "neutral" | "err";

export interface StatusAction {
  label: string;
  icon: IconName;
}

export interface StatusInfo {
  /** Drives the transaction-row dot + status-text color (TransactionCard). */
  kind: StatusKind;
  /** Drives the StatusTile background. A separate axis from `kind` — it carries
   *  an extra `ok` variant — though `statusInfo` currently sets them in step. */
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
export function StatusTile({
  status,
  size = 40,
  className = "",
}: {
  status: string;
  size?: number;
  className?: string;
}) {
  const info = statusInfo({ status });
  const Glyph = info.glyph;
  return (
    <div
      className={`flex flex-none items-center justify-center rounded-control ${TILE[info.tile]} ${className}`}
      style={{ width: size, height: size }}
    >
      {info.spin ? <Spinner size={16} /> : Glyph ? <Glyph width={19} height={19} /> : null}
    </div>
  );
}
