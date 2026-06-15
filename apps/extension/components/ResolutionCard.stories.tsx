import type { Meta, StoryObj } from "@storybook/react-vite";
import ResolutionCard from "./ResolutionCard";

const meta = {
  title: "Queue/ResolutionCard",
  component: ResolutionCard,
  decorators: [
    (Story) => (
      <div className="bg-bg p-4" style={{ width: 384 }}>
        <Story />
      </div>
    ),
  ],
  args: { onOpenRetailer: () => {} },
} satisfies Meta<typeof ResolutionCard>;

export default meta;
type Story = StoryObj<typeof ResolutionCard>;

export const SignedOut: Story = {
  args: { blocked: [{ retailer: "amazon", reason: "signed_out", count: 3 }] },
};

export const StepUp: Story = {
  args: { blocked: [{ retailer: "target", reason: "step_up", count: 2 }] },
};

export const Both: Story = {
  args: {
    blocked: [
      { retailer: "amazon", reason: "signed_out", count: 3 },
      { retailer: "target", reason: "step_up", count: 1 },
    ],
  },
};
