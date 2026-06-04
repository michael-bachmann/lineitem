import { Icon } from "./icons";

export type SourceKind = "ok" | "embed" | "needs";

const STYLE: Record<SourceKind, string> = {
  ok: "text-faint",
  embed: "text-link",
  needs: "text-attention",
};

const GLYPH = { ok: Icon.check, embed: Icon.sparkle, needs: Icon.warnTri } as const;
const LABEL = { ok: "From history", embed: "Suggested", needs: "Needs a category" } as const;

/**
 * Classification-source tag on an item card: ✓ From history (neutral) /
 * ✦ Suggested (link-blue) / ⚠ Needs a category (attention). Icon + label.
 */
export function SourceTag({ source, className = "" }: { source: SourceKind; className?: string }) {
  const Glyph = GLYPH[source];
  return (
    <span
      className={`inline-flex items-center gap-[5px] whitespace-nowrap text-[11.5px] font-medium ${STYLE[source]} ${className}`}
    >
      <Glyph width={13} height={13} className="flex-none" /> {LABEL[source]}
    </span>
  );
}
