import { useState } from "react";
import type { QueueEntry, Category, ApprovalItem } from "@/lib/types";
import { formatCents, millunitsToCents } from "@/lib/money";
import ItemCard from "@/components/ItemCard";
import SplitBreakdown from "@/components/SplitBreakdown";

interface DetailViewProps {
  entry: QueueEntry;
  categories: Category[];
  onBack: () => void;
  onApprove: (ynabTransactionId: string, items: ApprovalItem[]) => Promise<void>;
}

// Parse the order ID from an orderKey like "amazon:112-1234567-1234567" → "112-1234567-1234567"
function parseOrderId(orderKey: string): string {
  const colonIndex = orderKey.indexOf(":");
  return colonIndex >= 0 ? orderKey.slice(colonIndex + 1) : orderKey;
}

export default function DetailView({ entry, categories, onBack, onApprove }: DetailViewProps) {
  const { ynabTransaction, matchStatus } = entry;

  const [selectedCategories, setSelectedCategories] = useState<Map<number, string>>(() => {
    if (matchStatus.status !== "matched") return new Map();
    return matchStatus.classifiedItems.reduce((acc, item, i) => {
      if (item.suggestedCategoryId !== null) {
        acc.set(i, item.suggestedCategoryId);
      }
      return acc;
    }, new Map<number, string>());
  });

  const [approving, setApproving] = useState(false);

  // Non-matched states: show back button + status message
  if (matchStatus.status !== "matched") {
    const message =
      matchStatus.status === "loading"
        ? "Loading order match..."
        : matchStatus.status === "no_match"
        ? "No matching order found."
        : matchStatus.status === "auth_required"
        ? "Authentication required to fetch order."
        : matchStatus.message;

    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 p-4 flex flex-col gap-4">
        <button
          onClick={onBack}
          className="text-sm text-blue-400 hover:text-blue-300 text-left w-fit"
        >
          ← Back to queue
        </button>
        <p className="text-sm text-gray-400">{message}</p>
      </div>
    );
  }

  const { order, classifiedItems } = matchStatus;

  const handleCategoryChange = (index: number, categoryId: string) => {
    setSelectedCategories((prev) => {
      const next = new Map(prev);
      if (categoryId) {
        next.set(index, categoryId);
      } else {
        next.delete(index);
      }
      return next;
    });
  };

  const uncategorizedCount = classifiedItems.filter((_, i) => !selectedCategories.has(i)).length;
  const allCategorized = uncategorizedCount === 0;

  const handleApprove = async () => {
    if (!allCategorized || approving) return;
    const items: ApprovalItem[] = classifiedItems.map((item, i) => ({
      productId: item.productId,
      title: item.title,
      price: item.price,
      quantity: item.quantity,
      // allCategorized guarantees every index is present
      categoryId: selectedCategories.get(i)!,
    }));
    setApproving(true);
    try {
      await onApprove(ynabTransaction.id, items);
      onBack();
    } finally {
      setApproving(false);
    }
  };

  const totalCents = millunitsToCents(ynabTransaction.amount);
  const orderId = parseOrderId(order.orderKey);

  // Build SplitBreakdown items from current selections
  const splitItems = classifiedItems.map((item, i) => ({
    price: item.price,
    quantity: item.quantity,
    categoryId: selectedCategories.get(i) ?? null,
  }));

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 flex flex-col gap-4">
      {/* Back link */}
      <button
        onClick={onBack}
        className="text-sm text-blue-400 hover:text-blue-300 text-left w-fit"
      >
        ← Back to queue
      </button>

      {/* Transaction header */}
      <div className="rounded-md bg-gray-900 border border-gray-700 px-3 py-2.5 flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-base font-semibold text-gray-100">
            {formatCents(totalCents)}
          </span>
          <span className="text-xs text-gray-400">{ynabTransaction.date}</span>
        </div>
        {ynabTransaction.payee_name && (
          <span className="text-sm text-gray-300">{ynabTransaction.payee_name}</span>
        )}
        <span className="text-xs text-gray-500">Order {orderId}</span>
      </div>

      {/* Items section */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Items</p>
        {classifiedItems.map((item, i) => (
          <ItemCard
            key={item.productId}
            title={item.title}
            imageUrl={item.imageUrl}
            price={item.price}
            quantity={item.quantity}
            selectedCategoryId={selectedCategories.get(i) ?? null}
            categories={categories}
            onCategoryChange={(categoryId) => handleCategoryChange(i, categoryId)}
          />
        ))}
      </div>

      {/* Split breakdown */}
      <SplitBreakdown
        items={splitItems}
        totalAmountCents={totalCents}
        categories={categories}
      />

      {/* Approve button */}
      <button
        onClick={handleApprove}
        disabled={!allCategorized || approving}
        className="w-full rounded-md px-4 py-2.5 text-sm font-medium transition-colors
          disabled:opacity-50 disabled:cursor-not-allowed
          bg-blue-600 hover:bg-blue-500 text-white
          disabled:bg-blue-600"
      >
        {approving
          ? "Approving..."
          : allCategorized
          ? "Approve"
          : `Approve (${uncategorizedCount} item${uncategorizedCount !== 1 ? "s" : ""} uncategorized)`}
      </button>
    </div>
  );
}
