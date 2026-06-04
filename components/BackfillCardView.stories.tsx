import type { Meta, StoryObj } from "@storybook/react-vite";
import { BackfillCardView } from "./BackfillCardView";

const result = { itemsLearned: 137, transactionsBackfilled: 42, hasUnbackfilled: false, failed: 0 };

const meta = {
  title: "Onboarding/BackfillCard",
  component: BackfillCardView,
  decorators: [
    (Story) => (
      <div className="bg-bg p-4" style={{ width: 384 }}>
        <Story />
      </div>
    ),
  ],
  args: { onStart: () => {}, onCancel: () => {} },
} satisfies Meta<typeof BackfillCardView>;

export default meta;
type Story = StoryObj<typeof BackfillCardView>;

export const Idle: Story = { args: { state: { kind: "idle" } } };
export const Running: Story = {
  args: { state: { kind: "running", progress: { status: "scraping", index: 3, total: 50 } } },
};
export const Done: Story = { args: { state: { kind: "done", result } } };
export const DoneSomeFailed: Story = {
  args: { state: { kind: "done", result: { ...result, failed: 3 } } },
};
export const DoneRunAgain: Story = {
  args: { state: { kind: "done", result: { ...result, hasUnbackfilled: true } } },
};
export const LoginRequired: Story = {
  args: { state: { kind: "error", message: "Amazon login required." } },
};
