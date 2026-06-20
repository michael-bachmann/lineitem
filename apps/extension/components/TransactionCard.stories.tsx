import type { Meta, StoryObj } from "@storybook/react-vite";
import TransactionCard, { type TransactionVM } from "./TransactionCard";

const base: TransactionVM = {
  id: "1",
  payee: "AMAZON.COM",
  amount: 42.99,
  dateShort: "May 20",
  status: "classified",
};

const meta = {
  title: "Queue/TransactionCard",
  component: TransactionCard,
  // Cards sit on the page canvas (not a white card), so render on --bg.
  decorators: [
    (Story) => (
      <div className="bg-bg p-4" style={{ width: 384 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TransactionCard>;

export default meta;
type Story = StoryObj<typeof TransactionCard>;

export const Ready: Story = { args: { txn: base } };
export const NeedsCategory: Story = {
  args: { txn: { ...base, payee: "AMAZON GROCERY", status: "partial", needs: 1 } },
};
export const NoMatch: Story = { args: { txn: { ...base, amount: 8.99, status: "nomatch" } } };
export const AuthRequired: Story = { args: { txn: { ...base, amount: 15.99, status: "auth" } } };
export const ScrapeError: Story = { args: { txn: { ...base, amount: 5.99, status: "error" } } };
export const Refund: Story = {
  args: { txn: { ...base, payee: "AMAZON.COM", amount: 24.5, status: "classified", refund: true } },
};
