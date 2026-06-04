import { useState } from "react";
import type { ApprovalItem, Category, QueueEntry } from "@/lib/types";
import { formatCents, millunitsToCents } from "@/lib/money";
import ItemCard from "@/components/ItemCard";
import SplitBreakdown from "@/components/SplitBreakdown";
import { BackLink } from "@/components/BackLink";
import { Button } from "@/components/Button";
import { SectionLabel } from "@/components/SectionLabel";
import { StatusMessage } from "@/components/StatusMessage";
import { StatusTile, statusInfo } from "@/components/status";
import { Spinner } from "@/components/Spinner";
import { CategorySelect } from "@/components/CategorySelect";
import { Icon } from "@/components/icons";

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

const STATUS_OF = { no_match: "nomatch", auth_required: "auth", error: "error" } as const;

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

  // ---- non-matched states ----
  if (matchStatus.status !== "matched") {
    if (matchStatus.status === "loading") {
      return (
        <div className="flex min-h-screen flex-col gap-3 bg-bg p-4 text-text">
          <BackLink onClick={onBack} />
          <StatusMessage kind="muted">
            <Spinner size={16} /> Loading order match…
          </StatusMessage>
        </div>
      );
    }

    const info = statusInfo({ status: STATUS_OF[matchStatus.status] });
    const ActionIcon = info.action ? Icon[info.action.icon] : null;
    return (
      <div className="flex min-h-screen flex-col gap-3 bg-bg p-4 text-text">
        <BackLink onClick={onBack} />
        <div className="flex flex-col gap-[11px] px-[2px] pt-[14px]">
          <div className="flex items-center gap-[11px]">
            <StatusTile status={STATUS_OF[matchStatus.status]} size={38} />
            <span className="text-[15.5px] font-semibold tracking-[-0.01em] text-text">
              {info.text}
            </span>
          </div>
          {info.reason && (
            <p className="m-0 text-[13.5px] leading-[1.55] text-muted">{info.reason}</p>
          )}
          {info.action && (
            <Button
              variant={matchStatus.status === "auth_required" ? "primary" : "secondary"}
              onClick={onBack}
            >
              {ActionIcon && <ActionIcon aria-hidden width={15} height={15} />} {info.action.label}
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ---- matched ----
  const { order, classifiedItems } = matchStatus;
  const totalCents = millunitsToCents(ynabTransaction.amount);
  const orderId = parseOrderId(order.orderKey);

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
        <StatusTile status="matched" size={44} />
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-[2px]">
          <div className="flex items-baseline gap-[10px]">
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.008em] text-text">
              {ynabTransaction.payee_name ?? "Unknown payee"}
            </span>
            <span className="tabular flex-none text-[18px] font-bold tracking-[-0.01em] text-text">
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

      {uncats > 0 && (
        <div className="flex flex-col gap-[9px] rounded-card border border-[var(--bulk-line)] bg-[var(--bulk-bg)] px-3 py-[11px]">
          <div className="flex items-center gap-[9px]">
            <span className="flex h-[25px] w-[25px] flex-none items-center justify-center rounded-[calc(var(--radius-sm)*0.8)] bg-attention text-white">
              <Icon.wand aria-hidden width={14} height={14} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold tracking-[-0.003em] text-text">
              Apply to all remaining
            </span>
            <span className="tabular min-w-5 flex-none rounded-full border border-attention-line bg-attention-weak px-[6px] py-px text-center text-[11px] font-semibold text-attention">
              {uncats}
            </span>
          </div>
          <CategorySelect
            categories={categories}
            value={null}
            placeholder="Choose a category…"
            label="Bulk category"
            onChange={handleBulkApply}
          />
        </div>
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

      <SplitBreakdown items={splitItems} totalAmountCents={totalCents} categories={categories} />

      <div className="sticky bottom-0 -mx-4 -mb-4 px-4 pt-3 [background:linear-gradient(180deg,transparent,var(--bg)_38%)]">
        <Button
          variant="primary"
          disabled={uncats > 0}
          busy={approving}
          busyLabel="Approving…"
          onClick={handleApprove}
        >
          {uncats > 0
            ? `${uncats} item${uncats === 1 ? "" : "s"} still need${uncats === 1 ? "s" : ""} a category`
            : "Approve & write split"}
        </Button>
      </div>
    </div>
  );
}
