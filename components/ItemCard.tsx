import type { Category } from "@/lib/types";
import { formatCents } from "@/lib/money";

interface ItemCardProps {
  title: string;
  imageUrl: string;
  price: number; // cents per unit
  quantity: number;
  selectedCategoryId: string | null;
  categories: Category[];
  onCategoryChange: (categoryId: string) => void;
}

export default function ItemCard({
  title,
  imageUrl,
  price,
  quantity,
  selectedCategoryId,
  categories,
  onCategoryChange,
}: ItemCardProps) {
  const uncategorized = selectedCategoryId === null;

  // Build a map of groupName → categories for rendering <optgroup> elements.
  const groups = categories.reduce<Map<string, Category[]>>((acc, cat) => {
    const group = acc.get(cat.groupName) ?? [];
    group.push(cat);
    acc.set(cat.groupName, group);
    return acc;
  }, new Map());

  const cardBorderClass = uncategorized ? "border-yellow-500" : "border-gray-700";
  const dropdownBorderClass = uncategorized ? "border-yellow-500" : "border-gray-600";

  return (
    <div className={`flex gap-3 rounded-md bg-gray-900 border ${cardBorderClass} px-3 py-2.5`}>
      {/* Thumbnail */}
      <div className="shrink-0 w-12 h-12 rounded bg-gray-800 flex items-center justify-center overflow-hidden">
        {imageUrl ? (
          <img src={imageUrl} alt={title} className="w-full h-full object-cover" />
        ) : (
          <span className="text-2xl" role="img" aria-label="product">📦</span>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
        {/* Title */}
        <div className="flex items-center gap-1 min-w-0">
          {uncategorized && (
            <span className="text-yellow-400 shrink-0" title="Needs a category">⚠</span>
          )}
          <span className="text-sm font-medium text-gray-100 truncate">{title}</span>
        </div>

        {/* Price */}
        <div className="text-xs text-gray-400">
          {quantity > 1 ? (
            <>
              {formatCents(price)}{" "}
              <span className="text-gray-500">
                × {quantity} = {formatCents(price * quantity)}
              </span>
            </>
          ) : (
            formatCents(price)
          )}
        </div>

        {/* Category dropdown */}
        <select
          value={selectedCategoryId ?? ""}
          onChange={(e) => onCategoryChange(e.target.value)}
          className={`w-full rounded bg-gray-950 border ${dropdownBorderClass} px-2 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500`}
        >
          <option value="" disabled>— Select category —</option>
          {[...groups.entries()].map(([groupName, groupCategories]) => (
            <optgroup key={groupName} label={groupName}>
              {groupCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
    </div>
  );
}
