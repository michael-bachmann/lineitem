import type { Meta, StoryObj } from "@storybook/react-vite";
import SplitBreakdown from "./SplitBreakdown";
import type { Category } from "@/lib/types";

const CATEGORIES: Category[] = [
  { id: "n1", name: "Household Goods", groupName: "Non-Monthly" },
  { id: "g1", name: "Groceries", groupName: "Frequent" },
];

const meta = {
  title: "Detail/SplitBreakdown",
  component: SplitBreakdown,
  decorators: [
    (Story) => (
      <div className="bg-bg p-4" style={{ width: 384 }}>
        <Story />
      </div>
    ),
  ],
  args: { categories: CATEGORIES, totalAmountCents: 4299 },
} satisfies Meta<typeof SplitBreakdown>;

export default meta;
type Story = StoryObj<typeof SplitBreakdown>;

export const Matches: Story = {
  args: {
    items: [
      { allocatedCents: 2999, categoryId: "n1" },
      { allocatedCents: 1300, categoryId: "g1" },
    ],
  },
};
export const WithUncategorized: Story = {
  args: {
    items: [
      { allocatedCents: 2999, categoryId: "n1" },
      { allocatedCents: 1300, categoryId: null },
    ],
  },
};
export const Mismatch: Story = {
  args: { items: [{ allocatedCents: 2999, categoryId: "n1" }] },
};
