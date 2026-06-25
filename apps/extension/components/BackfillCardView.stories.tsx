import type { Meta, StoryObj } from "@storybook/react-vite";
import { BackfillCardView } from "./BackfillCardView";

const result = {
  itemsLearned: 137,
  transactionsBackfilled: 42,
  hasUnbackfilled: false,
  failed: 0,
  byRetailer: [
    { retailer: "amazon", matched: 36, failed: 0 },
    { retailer: "target", matched: 6, failed: 0 },
  ],
};

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
  args: { onStart: () => {}, onCancel: () => {}, onOpenRetailer: () => {} },
} satisfies Meta<typeof BackfillCardView>;

export default meta;
type Story = StoryObj<typeof BackfillCardView>;

export const Idle: Story = { args: { state: { kind: "idle" } } };
export const RunningListing: Story = {
  args: { state: { kind: "running", progress: { status: "listing", retailer: "amazon", count: 12 } } },
};
export const RunningMatching: Story = {
  args: { state: { kind: "running", progress: { status: "matching", retailer: "target", count: 4 } } },
};
export const Running: Story = {
  args: { state: { kind: "running", progress: { status: "scraping", retailer: "amazon", index: 3, total: 50 } } },
};
export const RunningLearning: Story = {
  args: { state: { kind: "running", progress: { status: "learning", retailer: "target", index: 80, total: 137 } } },
};
export const Done: Story = { args: { state: { kind: "done", result } } };
export const DoneSomeFailed: Story = {
  args: { state: { kind: "done", result: { ...result, failed: 3 } } },
};
export const DoneRunAgain: Story = {
  args: { state: { kind: "done", result: { ...result, hasUnbackfilled: true } } },
};
export const DoneRetailerSignedOut: Story = {
  args: {
    state: {
      kind: "done",
      result: {
        ...result,
        hasUnbackfilled: true,
        byRetailer: [
          { retailer: "amazon", matched: 195, failed: 0 },
          { retailer: "target", matched: 0, failed: 0, blocked: "signed_out" },
        ],
      },
    },
  },
};
export const LoginRequired: Story = {
  args: { state: { kind: "error", message: "Amazon login required." } },
};
