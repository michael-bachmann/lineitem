import { Icon, type IconComponent } from "@lineitem/ui";
import { plural } from "@/lib/intl";

export type StatusKind = "ready" | "warn" | "neutral" | "err";
export type TileKind = "ready" | "ok" | "warn" | "neutral" | "err";

export interface StatusInfo {
  /** Drives the transaction-row dot + status-text color (TransactionCard). */
  kind: StatusKind;
  /** Drives the StatusTile background. A separate axis from `kind` — it carries
   *  an extra `ok` variant — though `statusInfo` currently sets them in step. */
  tile: TileKind;
  text: string;
  glyph?: IconComponent;
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
        text: `${n} ${plural(n, { one: "item needs", other: "items need" })} a category`,
      };
    }
    case "nomatch":
      return {
        kind: "neutral",
        tile: "neutral",
        glyph: Icon.search,
        text: "No match found",
      };
    case "auth":
      // Retailer-neutral: this status is shown for Amazon and Target alike, and
      // the row already names the payee. The retailer-specific call to action
      // lives in the resolution card above the queue.
      return {
        kind: "neutral",
        tile: "neutral",
        glyph: Icon.lock,
        text: "Sign in to read",
      };
    case "error":
      return {
        kind: "err",
        tile: "err",
        glyph: Icon.alertCircle,
        text: "Couldn’t read order",
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
      {Glyph ? <Glyph width={19} height={19} /> : null}
    </div>
  );
}
