import type { Meta, StoryObj } from "@storybook/react-vite";
import FeedbackForm from "./FeedbackForm";

const meta = {
  title: "Components/FeedbackForm",
  component: FeedbackForm,
  decorators: [
    (Story) => (
      <div className="rounded-card border border-line bg-surface" style={{ width: 384 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    active: true,
    onDone: () => {},
    onSubmit: async () => ({ ok: true }),
  },
} satisfies Meta<typeof FeedbackForm>;

export default meta;
type Story = StoryObj<typeof FeedbackForm>;

export const Retailer: Story = { args: { kind: "retailer" } };
export const Suggestion: Story = { args: { kind: "suggestion" } };
export const Issue: Story = {
  args: { kind: "issue", context: { browser: "Chrome 124", version: "1.4.0" } },
};

/** Submitting resolves to a failure → inline error state. */
export const ErrorState: Story = {
  args: { kind: "suggestion", onSubmit: async () => ({ ok: false }) },
};
