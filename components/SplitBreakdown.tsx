import type { Category } from "@/lib/types";
import { formatCents } from "@/lib/money";
import { sum } from "remeda";

interface SplitItem {
  allocatedCents: number;
  categoryId: string | null;
}

interface SplitBreakdownProps {
  items: SplitItem[];
  totalAmountCents: number; // the YNAB transaction amount (always positive cents)
  categories: Category[];
}

export default function SplitBreakdown({ items, totalAmountCents, categories }: SplitBreakdownProps) {
  // Aggregate allocated cents by category
  const categoryById = new Map(categories.map((c) => [c.id, c.name]));
  const categoryTotals = items.reduce<Map<string, number>>((acc, item) => {
    const key = item.categoryId ?? "__uncategorized__";
    return new Map(acc).set(key, (acc.get(key) ?? 0) + item.allocatedCents);
  }, new Map());

  const rows = [...categoryTotals.entries()].map(([key, amount]) => ({
    key,
    label: key === "__uncategorized__" ? "Uncategorized" : (categoryById.get(key) ?? key),
    amount,
    isUncategorized: key === "__uncategorized__",
  }));

  // Sanity check: sum of allocations should equal the total. If not, something
  // upstream is wrong — show a small marker but don't crash.
  const allocatedSum = sum(items.map((i) => i.allocatedCents));
  const matchesTotal = allocatedSum === totalAmountCents;

  return (
    <div className="rounded-md bg-gray-900 border border-gray-700 px-3 py-2.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
        Split Breakdown
      </p>

      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-2">
            <span
              className={`text-sm truncate ${row.isUncategorized ? "text-gray-500 italic" : "text-gray-200"}`}
            >
              {row.label}
            </span>
            <span className="text-sm text-gray-200 shrink-0">{formatCents(row.amount)}</span>
          </div>
        ))}
      </div>

      <div className="my-2 border-t border-gray-700" />

      <div className="flex items-center justify-between gap-2">
        {!matchesTotal ? (
          <span className="text-xs text-amber-500" title="Allocation mismatch — re-sync recommended">
            ⚠ Allocations don't match total
          </span>
        ) : (
          <span />
        )}
        <span className="text-sm font-medium text-gray-100 shrink-0">
          {formatCents(totalAmountCents)}
        </span>
      </div>
    </div>
  );
}
