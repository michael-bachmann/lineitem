import type { Category } from "@/lib/types";
import { CategorySelect } from "./CategorySelect";
import { Icon } from "@lineitem/ui";

/** Attention-tinted helper that sets a category for all still-uncategorized
 *  items in one pick. Shown on the detail screen when ≥1 item needs a category. */
export function BulkApply({
  count,
  categories,
  onApply,
}: {
  count: number;
  categories: Category[];
  onApply: (categoryId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-[9px] rounded-card border border-[var(--bulk-line)] bg-[var(--bulk-bg)] px-3 py-[11px]">
      <div className="flex items-center gap-[9px]">
        <span className="flex h-[25px] w-[25px] flex-none items-center justify-center rounded-[calc(var(--radius-sm)*0.8)] bg-attention text-white">
          <Icon.wand aria-hidden width={14} height={14} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold tracking-[-0.003em] text-text">
          Apply to all remaining
        </span>
        <span
          aria-label={`${count} remaining`}
          className="tabular min-w-5 flex-none rounded-full border border-attention-line bg-attention-weak px-[6px] py-px text-center text-[11px] font-semibold text-attention"
        >
          {count}
        </span>
      </div>
      <CategorySelect
        categories={categories}
        value={null}
        placeholder="Choose a category…"
        label="Bulk category"
        onChange={onApply}
      />
    </div>
  );
}
