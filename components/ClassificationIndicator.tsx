import type { ClassifiedItem } from "@/lib/types";

interface Props {
  source: ClassifiedItem["classificationSource"];
}

/**
 * Inline icon distinguishing classification provenance:
 *   product_cache → ✓ green (exact prior match)
 *   embedding     → ✦ blue (similarity suggestion — less confident)
 *   null          → ⚠ yellow (needs user input)
 */
export function ClassificationIndicator({ source }: Props) {
  if (source === "product_cache") {
    return (
      <span className="text-emerald-400 shrink-0" title="Previously categorized">✓</span>
    );
  }
  if (source === "embedding") {
    return (
      <span className="text-sky-400 shrink-0" title="Suggested from similar items">✦</span>
    );
  }
  return (
    <span className="text-yellow-400 shrink-0" title="Needs a category">⚠</span>
  );
}
