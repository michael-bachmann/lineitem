import { useState } from "react";
import type { ApprovalItem, Category, QueueEntry } from "@/lib/types";
import { formatCents, millunitsToCents } from "@/lib/money";
import { plural } from "@/lib/intl";
import ItemCard from "@/components/ItemCard";
import SplitBreakdown from "@/components/SplitBreakdown";
import { BulkApply } from "@/components/BulkApply";
import { BackLink, Button, SectionLabel } from "@lineitem/ui";
import { StatusTile } from "@/components/status";

interface DetailViewProps {
  entry: QueueEntry;
  categories: Category[];
  onBack: () => void;
  onApprove: (ynabTransactionId: string, items: ApprovalItem[]) => Promise<void>;
}

/** Parse the order id from an orderKey like "amazon:112-1234567-1234567". */
function parseOrderId(orderKey: string): string {
  const i = orderKey.indexOf(":");
  return i >= 0 ? orderKey.slice(i + 1) : orderKey;
}

export default function DetailView({ entry, categories, onBack, onApprove }: DetailViewProps) {
  const { ynabTransaction, matchStatus } = entry;

  const [selectedCategories, setSelectedCategories] = useState<Map<number, string>>(() => {
    if (matchStatus.status !== "matched") return new Map();
    return matchStatus.classifiedItems.reduce((acc, item, i) => {
      if (item.suggestedCategoryId !== null) acc.set(i, item.suggestedCategoryId);
      return acc;
    }, new Map<number, string>());
  });
  const [approving, setApproving] = useState(false);

  // Only matched entries open the detail screen — non-matched states resolve
  // inline on the queue (sign-in via the resolution card; no_match/error are
  // non-interactive). This guard just narrows the union for the render below.
  if (matchStatus.status !== "matched") return null;

  // ---- matched ----
  const { order, classifiedItems } = matchStatus;
  const totalCents = millunitsToCents(ynabTransaction.amount);
  const orderId = parseOrderId(order.orderKey);
  const isRefund = ynabTransaction.amount > 0;

  const handleCategoryChange = (index: number, categoryId: string) => {
    setSelectedCategories((prev) => {
      const next = new Map(prev);
      if (categoryId) next.set(index, categoryId);
      else next.delete(index);
      return next;
    });
  };

  const handleBulkApply = (categoryId: string) => {
    if (!categoryId) return;
    setSelectedCategories((prev) => {
      const next = new Map(prev);
      classifiedItems.forEach((_, i) => {
        if (!next.has(i)) next.set(i, categoryId);
      });
      return next;
    });
  };

  const uncats = classifiedItems.filter((_, i) => !selectedCategories.has(i)).length;

  const handleApprove = async () => {
    if (uncats > 0 || approving) return;
    const items: ApprovalItem[] = classifiedItems.map((item, i) => ({
      productId: item.productId,
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

  const splitItems = classifiedItems.map((item, i) => ({
    allocatedCents: item.allocatedCents,
    categoryId: selectedCategories.get(i) ?? null,
  }));

  return (
    <div className="flex min-h-screen flex-col gap-3 bg-bg p-4 text-text">
      <BackLink onClick={onBack} />

      <div className="flex items-start gap-3 rounded-card border border-line bg-surface px-[14px] py-[13px] shadow-card">
        <span aria-hidden className="contents">
          <StatusTile status="matched" size={44} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-[2px]">
          <div className="flex items-baseline gap-[10px]">
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.008em] text-text">
              {ynabTransaction.payee_name ?? "Unknown payee"}
            </span>
            <span className="tabular flex-none text-[18px] font-bold tracking-[-0.01em] text-text">
              {isRefund ? "+" : ""}
              {formatCents(totalCents)}
            </span>
          </div>
          <div className="flex items-baseline gap-[10px]">
            <span className="tabular min-w-0 flex-1 truncate text-[12px] text-faint">
              Order {orderId}
            </span>
            <span className="tabular flex-none text-[12px] text-faint">{ynabTransaction.date}</span>
          </div>
        </div>
      </div>

      <SectionLabel>Items</SectionLabel>

      {uncats > 1 && (
        <BulkApply count={uncats} categories={categories} onApply={handleBulkApply} />
      )}

      <div className="flex flex-col gap-3">
        {classifiedItems.map((item, i) => (
          <ItemCard
            key={item.productId}
            title={item.title}
            imageUrl={item.imageUrl}
            unitPriceCents={item.unitPriceCents}
            quantity={item.quantity}
            selectedCategoryId={selectedCategories.get(i) ?? null}
            classificationSource={item.classificationSource}
            categories={categories}
            onCategoryChange={(id) => handleCategoryChange(i, id)}
            hint={
              item.classificationSource === "embedding" && item.matchedSource
                ? `Suggested based on similarity to your past “${item.matchedSource.title}”.`
                : undefined
            }
          />
        ))}
      </div>

      <SplitBreakdown
        items={splitItems}
        totalAmountCents={totalCents}
        categories={categories}
        refund={isRefund}
      />

      <div className="sticky bottom-0 -mx-4 -mb-4 px-4 pb-4 pt-3 [background:linear-gradient(180deg,transparent,var(--bg)_38%)]">
        <Button
          variant="primary"
          disabled={uncats > 0}
          busy={approving}
          busyLabel="Approving…"
          onClick={handleApprove}
        >
          {uncats > 0
            ? `${uncats} ${plural(uncats, { one: "item still needs", other: "items still need" })} a category`
            : "Approve & write split"}
        </Button>
      </div>
    </div>
  );
}
