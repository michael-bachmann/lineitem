import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import ItemCard from "./ItemCard";
import type { Category, ClassifiedItem } from "@/lib/types";

const CATEGORIES: Category[] = [
  { id: "g1", name: "Groceries", groupName: "Frequent" },
  { id: "g2", name: "Dining Out", groupName: "Frequent" },
  { id: "m1", name: "Internet", groupName: "Monthly Bills" },
  { id: "n1", name: "Household Goods", groupName: "Non-Monthly" },
  { id: "n2", name: "Gifts", groupName: "Non-Monthly" },
];

const PHOTO =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='white'/%3E%3Crect x='30' y='44' width='60' height='14' rx='4' fill='%235c7c86'/%3E%3Ccircle cx='60' cy='80' r='14' fill='%23b5838d'/%3E%3C/svg%3E";

function Demo({
  initial = null,
  source = "product_cache",
  title = "USB-C Charging Cable (3-pack), 6ft Braided",
  unitPriceCents = 2999,
  quantity = 1,
  hint,
}: {
  initial?: string | null;
  source?: ClassifiedItem["classificationSource"];
  title?: string;
  unitPriceCents?: number;
  quantity?: number;
  hint?: string;
}) {
  const [cat, setCat] = useState<string | null>(initial);
  return (
    <div className="bg-bg p-4" style={{ width: 384 }}>
      <ItemCard
        title={title}
        imageUrl={PHOTO}
        unitPriceCents={unitPriceCents}
        quantity={quantity}
        selectedCategoryId={cat}
        classificationSource={source}
        categories={CATEGORIES}
        onCategoryChange={setCat}
        hint={hint}
      />
    </div>
  );
}

const meta = { title: "Detail/ItemCard", component: ItemCard } satisfies Meta<typeof ItemCard>;
export default meta;
type Story = StoryObj;

export const FromHistory: Story = { render: () => <Demo initial="n1" source="product_cache" /> };
export const Suggested: Story = {
  render: () => (
    <Demo
      initial="n1"
      source="embedding"
      hint="Suggested based on similarity to your past “USB-C Cable 6ft”."
    />
  ),
};
export const NeedsCategory: Story = {
  render: () => <Demo initial={null} title="Mystery Gadget Nobody Recognizes" unitPriceCents={1300} />,
};
export const WithQuantity: Story = {
  render: () => <Demo initial="g1" source="product_cache" quantity={3} unitPriceCents={999} />,
};
