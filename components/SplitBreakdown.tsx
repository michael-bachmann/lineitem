import type { Category } from "@/lib/types";
import { formatCents, distributeRemainder } from "@/lib/money";

interface SplitItem {
  price: number; // cents per unit
  quantity: number;
  categoryId: string | null;
}

interface SplitBreakdownProps {
  items: SplitItem[];
  totalAmountCents: number; // the YNAB transaction amount (always positive cents)
  categories: Category[];
}

export default function SplitBreakdown({ items, totalAmountCents, categories }: SplitBreakdownProps) {
  // Step 1: compute per-item amounts
  const itemAmounts = items.map((item) => item.price * item.quantity);

  // Step 2: sum item amounts and compute remainder (taxes/shipping/discounts)
  const itemsTotal = itemAmounts.reduce((sum, a) => sum + a, 0);
  const remainder = totalAmountCents - itemsTotal;

  // Step 3: distribute remainder proportionally across items
  const adjustments = distributeRemainder(itemAmounts, remainder);

  // Step 4: build a categoryId → name lookup
  const categoryById = new Map(categories.map((c) => [c.id, c.name]));

  // Step 5: aggregate totals by category (null → "Uncategorized")
  const categoryTotals = items.reduce<Map<string, number>>((acc, item, i) => {
    const key = item.categoryId ?? "__uncategorized__";
    acc.set(key, (acc.get(key) ?? 0) + itemAmounts[i] + adjustments[i]);
    return acc;
  }, new Map());

  // Render rows: named categories first, then uncategorized if present
  const rows = [...categoryTotals.entries()].map(([key, amount]) => ({
    key,
    label: key === "__uncategorized__" ? "Uncategorized" : (categoryById.get(key) ?? key),
    amount,
    isUncategorized: key === "__uncategorized__",
  }));

  return (
    <div className="rounded-md bg-gray-900 border border-gray-700 px-3 py-2.5">
      {/* Section header */}
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
        Split Breakdown
      </p>

      {/* Category rows */}
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

      {/* Divider */}
      <div className="my-2 border-t border-gray-700" />

      {/* Footer row */}
      <div className="flex items-center justify-between gap-2">
        {remainder !== 0 ? (
          <span className="text-xs text-gray-500">Tax/shipping distributed proportionally</span>
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
