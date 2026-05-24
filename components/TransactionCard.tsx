import type { QueueEntry } from "@/lib/types";
import { formatCents, millunitsToCents } from "@/lib/money";

interface TransactionCardProps {
  entry: QueueEntry;
  categoryNames: Map<string, string>; // categoryId → display name
  onClick: () => void;
}

/** Format ISO date (YYYY-MM-DD) to a compact locale string, e.g. "Jan 5". */
function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function TransactionCard({ entry, categoryNames, onClick }: TransactionCardProps) {
  const { ynabTransaction, matchStatus } = entry;
  const payee = ynabTransaction.payee_name ?? "Unknown payee";
  const amount = formatCents(millunitsToCents(ynabTransaction.amount));
  const date = formatDate(ynabTransaction.date);

  // Determine left-border color class and status content based on matchStatus.
  let borderClass = "border-l-gray-700";
  let statusContent: React.ReactNode = null;

  if (matchStatus.status === "loading") {
    borderClass = "border-l-gray-700";
    statusContent = (
      <span className="text-xs text-gray-500 flex items-center gap-1">
        {/* Simple animated spinner using Tailwind's animate-spin */}
        <span className="inline-block h-3 w-3 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
        Loading…
      </span>
    );
  } else if (matchStatus.status === "matched") {
    const { classifiedItems } = matchStatus;
    const itemCount = classifiedItems.length;
    const needsCategory = classifiedItems.filter((item) => item.suggestedCategoryId === null);

    if (needsCategory.length === 0) {
      // Fully classified — green border, show category name tags
      borderClass = "border-l-green-500";
      // Collect unique category IDs from classified items
      const categoryIds = [
        ...new Set(
          classifiedItems
            .map((item) => item.suggestedCategoryId)
            .filter((id): id is string => id !== null)
        ),
      ];
      statusContent = (
        <div className="flex flex-wrap gap-1 mt-1">
          {categoryIds.map((id) => (
            <span
              key={id}
              className="rounded px-1.5 py-0.5 text-xs bg-green-900 text-green-300 border border-green-700"
            >
              {categoryNames.get(id) ?? id}
            </span>
          ))}
          <span className="text-xs text-gray-500 self-center">{itemCount} item{itemCount !== 1 ? "s" : ""}</span>
        </div>
      );
    } else {
      // Partially classified — yellow border
      borderClass = "border-l-yellow-500";
      statusContent = (
        <span className="text-xs text-yellow-400">
          {itemCount} item{itemCount !== 1 ? "s" : ""} &middot; {needsCategory.length} need{needsCategory.length === 1 ? "s" : ""} a category
        </span>
      );
    }
  } else if (matchStatus.status === "no_match") {
    borderClass = "border-l-gray-600";
    statusContent = <span className="text-xs text-gray-500">No match found</span>;
  } else if (matchStatus.status === "auth_required") {
    borderClass = "border-l-gray-600";
    statusContent = <span className="text-xs text-gray-500">Login required</span>;
  } else if (matchStatus.status === "error") {
    borderClass = "border-l-red-600";
    statusContent = <span className="text-xs text-red-400">{matchStatus.message}</span>;
  }

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-md bg-gray-900 border border-gray-700 border-l-4 ${borderClass} px-3 py-2.5 hover:bg-gray-800 transition-colors`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-100 truncate">{payee}</span>
        <span className="text-sm font-medium text-gray-100 shrink-0">{amount}</span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-0.5">
        <span className="text-xs text-gray-400">{date}</span>
      </div>
      {statusContent && <div className="mt-1">{statusContent}</div>}
    </button>
  );
}
