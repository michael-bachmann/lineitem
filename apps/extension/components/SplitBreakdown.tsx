import type { Category } from "@/lib/types";
import { formatCents } from "@/lib/money";
import { sum } from "remeda";
import { SectionLabel, Icon } from "@lineitem/ui";

interface SplitItem {
  allocatedCents: number;
  categoryId: string | null;
}

interface SplitBreakdownProps {
  items: SplitItem[];
  /** The YNAB transaction amount (always positive cents). */
  totalAmountCents: number;
  categories: Category[];
  /** Refund (inflow) — prefixes "+" on the total. */
  refund?: boolean;
}

export default function SplitBreakdown({
  items,
  totalAmountCents,
  categories,
  refund = false,
}: SplitBreakdownProps) {
  const nameById = new Map(categories.map((c) => [c.id, c.name]));

  const totals = new Map<string, number>();
  for (const it of items) {
    const key = it.categoryId ?? "__uncat";
    totals.set(key, (totals.get(key) ?? 0) + it.allocatedCents);
  }
  const rows = [...totals.entries()].map(([key, amount]) => ({
    key,
    amount,
    label: key === "__uncat" ? "Uncategorized" : (nameById.get(key) ?? key),
    uncategorized: key === "__uncat",
  }));

  // Defensive backstop: AllocatedTransaction guarantees allocations sum to the
  // charge, so this should always match in practice — but surface drift (e.g. a
  // stale re-sync) rather than silently showing a wrong total.
  const matchesTotal = sum(items.map((i) => i.allocatedCents)) === totalAmountCents;

  return (
    <div className="flex flex-col gap-[9px] rounded-card border border-line bg-surface px-[15px] py-[14px] shadow-card">
      <SectionLabel>Split Breakdown</SectionLabel>

      {rows.map((r) => (
        <div key={r.key} className="flex items-baseline justify-between gap-3 text-[14px]">
          <span className={`truncate ${r.uncategorized ? "italic text-faint" : "text-text"}`}>
            {r.label}
          </span>
          <span className="tabular flex-none font-[550] text-text">{formatCents(r.amount)}</span>
        </div>
      ))}

      <div className="my-[3px] h-px bg-line" />

      <div className="flex items-baseline justify-between gap-3 text-[15px]">
        {matchesTotal ? (
          <span className="font-semibold text-muted">Total</span>
        ) : (
          <span className="inline-flex items-center gap-[7px] text-[13px] text-attention [&_svg]:h-[15px] [&_svg]:w-[15px] [&_svg]:flex-none">
            <Icon.warnTri aria-hidden /> Allocations don’t match total
          </span>
        )}
        <span className="tabular flex-none font-[750] text-text">
          {refund ? "+" : ""}
          {formatCents(totalAmountCents)}
        </span>
      </div>
    </div>
  );
}
