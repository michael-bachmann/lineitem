import type { Meta, StoryObj } from "@storybook/react-vite";
import { BudgetSwitcherView } from "./BudgetSwitcherView";

const current = { id: "1", name: "My Budget" };
const plans = [
  current,
  { id: "2", name: "Household 2026 — Joint Checking & Shared Expenses" },
  { id: "3", name: "Side Business" },
];

const meta = {
  title: "Settings/BudgetSwitcherView",
  component: BudgetSwitcherView,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div style={{ width: 384 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    current,
    plans,
    selectedId: current.id,
    onChange: () => {},
    onSelect: () => {},
    onSave: () => {},
    onCancel: () => {},
    onRetry: () => {},
  },
} satisfies Meta<typeof BudgetSwitcherView>;

export default meta;
type Story = StoryObj<typeof BudgetSwitcherView>;

export const Idle: Story = { args: { mode: { kind: "idle" } } };
export const LongNameIdle: Story = {
  args: {
    mode: { kind: "idle" },
    current: { id: "2", name: "Household 2026 — Joint Checking & Shared Expenses (Archived Copy)" },
  },
};
export const Loading: Story = { args: { mode: { kind: "loading" } } };
export const Picking: Story = { args: { mode: { kind: "picking" } } };
export const PickingChanged: Story = { args: { mode: { kind: "picking" }, selectedId: "2" } };
export const Saving: Story = { args: { mode: { kind: "saving" } } };
export const ErrorLoad: Story = {
  args: {
    mode: {
      kind: "error",
      failed: "load",
      message: "Couldn't load your budgets. Check your connection and try again.",
    },
  },
};
export const ErrorSave: Story = {
  args: {
    mode: {
      kind: "error",
      failed: "save",
      message: "Couldn't switch budgets. Check your connection and try again.",
    },
  },
};
