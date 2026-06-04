import type { Category, ClassifiedItem } from "@/lib/types";
import { formatCents } from "@/lib/money";
import { Thumb } from "./Thumb";
import { SourceTag, type SourceKind } from "./SourceTag";
import { CategorySelect } from "./CategorySelect";

interface ItemCardProps {
  title: string;
  imageUrl?: string | null;
  unitPriceCents: number;
  quantity: number;
  selectedCategoryId: string | null;
  classificationSource: ClassifiedItem["classificationSource"];
  categories: Category[];
  onCategoryChange: (id: string) => void;
  /** Optional "suggested based on similarity" hint. */
  hint?: string;
}

function sourceKind(
  selected: string | null,
  src: ItemCardProps["classificationSource"],
): SourceKind {
  if (selected === null) return "needs";
  if (src === "embedding") return "embed";
  return "ok";
}

export default function ItemCard({
  title,
  imageUrl,
  unitPriceCents,
  quantity,
  selectedCategoryId,
  classificationSource,
  categories,
  onCategoryChange,
  hint,
}: ItemCardProps) {
  const needs = selectedCategoryId === null;

  return (
    <div
      className={`flex flex-col gap-[11px] rounded-card border bg-surface p-[14px] shadow-card ${
        needs ? "border-attention-line" : "border-line"
      }`}
    >
      <div className="flex items-start gap-[11px]">
        <Thumb src={imageUrl} alt={title} />
        <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
          <div className="line-clamp-2 text-[14px] font-semibold leading-[1.32] tracking-[-0.006em] text-text [text-wrap:pretty]">
            {title}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-[10px]">
            <span className="tabular text-[13px] text-muted">
              {formatCents(unitPriceCents)}
              {quantity > 1 && (
                <>
                  {" "}
                  <span className="text-faint">× {quantity}</span>{" "}
                  <span className="text-faint">= {formatCents(unitPriceCents * quantity)}</span>
                </>
              )}
            </span>
            <SourceTag source={sourceKind(selectedCategoryId, classificationSource)} />
          </div>
        </div>
      </div>

      <CategorySelect
        categories={categories}
        value={selectedCategoryId}
        needs={needs}
        onChange={onCategoryChange}
      />

      {hint && <p className="m-0 pl-px text-[12px] leading-[1.5] text-faint">{hint}</p>}
    </div>
  );
}
