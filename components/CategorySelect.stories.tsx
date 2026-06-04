import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { CategorySelect } from "./CategorySelect";
import type { Category } from "@/lib/types";

const CATEGORIES: Category[] = [
  { id: "g1", name: "Groceries", groupName: "Frequent" },
  { id: "g2", name: "Dining Out", groupName: "Frequent" },
  { id: "g3", name: "Coffee Shops", groupName: "Frequent" },
  { id: "g4", name: "Gas & Fuel", groupName: "Frequent" },
  { id: "m1", name: "Rent", groupName: "Monthly Bills" },
  { id: "m2", name: "Electric", groupName: "Monthly Bills" },
  { id: "m3", name: "Internet", groupName: "Monthly Bills" },
  { id: "n1", name: "Household Goods", groupName: "Non-Monthly" },
  { id: "n2", name: "Auto Maintenance", groupName: "Non-Monthly" },
  { id: "n3", name: "Gifts", groupName: "Non-Monthly" },
  { id: "f1", name: "Vacation", groupName: "Just for Fun" },
  { id: "f2", name: "Hobbies", groupName: "Just for Fun" },
];

function Demo({ initial = null, needs = false }: { initial?: string | null; needs?: boolean }) {
  const [value, setValue] = useState<string | null>(initial);
  return <CategorySelect categories={CATEGORIES} value={value} onChange={setValue} needs={needs} />;
}

const meta = {
  title: "Primitives/CategorySelect",
  component: CategorySelect,
  // In the app this sits inside a white item card, not on the bare page canvas —
  // render it that way so the trigger reads with real contrast.
  decorators: [
    (Story) => (
      <div className="rounded-card border border-line bg-surface p-4 shadow-card" style={{ width: 360 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CategorySelect>;
export default meta;
type Story = StoryObj;

export const Empty: Story = { render: () => <Demo /> };
export const Selected: Story = { render: () => <Demo initial="n1" /> };
export const NeedsCategory: Story = { render: () => <Demo needs /> };

// Opens the popover so the filter + grouped list + keyboard nav are visible.
export const Open: Story = {
  render: () => <Demo initial="n1" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Category" }));
    await expect(canvas.getByRole("listbox")).toBeInTheDocument();
  },
};

// Trigger sits near the viewport bottom → opening flips the popover upward.
export const NearBottomEdge: Story = {
  render: () => (
    <div style={{ display: "flex", height: "88vh", alignItems: "flex-end" }}>
      <Demo />
    </div>
  ),
};
