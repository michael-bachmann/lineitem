import type { Meta, StoryObj } from "@storybook/react-vite";
import QueueView from "./QueueView";
import type { ClassifiedItem, OrderMatchStatus, QueueEntry } from "@/lib/types";

function entry(id: string, payee: string, dollars: number, match: OrderMatchStatus): QueueEntry {
  return {
    ynabTransaction: {
      id,
      payee_name: payee,
      amount: -Math.round(dollars * 1000),
      date: "2026-05-20",
    } as QueueEntry["ynabTransaction"],
    retailer: "amazon",
    matchStatus: match,
  };
}

const cat = (id: string | null) => ({ suggestedCategoryId: id }) as ClassifiedItem;
const order = {} as Extract<OrderMatchStatus, { status: "matched" }>["order"];
const matched = (items: ClassifiedItem[]): OrderMatchStatus => ({ status: "matched", order, classifiedItems: items });

const QUEUE: QueueEntry[] = [
  entry("1", "AMAZON GROCERY", 42.99, matched([cat(null)])),
  entry("2", "AMAZON.COM", 42.98, matched([cat("a"), cat("b")])),
  entry("3", "AMAZON.COM", 8.99, { status: "no_match" }),
  entry("4", "AMAZON.COM", 15.99, { status: "auth_required" }),
  entry("5", "AMAZON.COM", 5.99, { status: "error", message: "parse failed" }),
];

const noop = () => {};
const handlers = {
  onSync: noop,
  onApproveAll: noop,
  onSelectEntry: noop,
  onSettings: noop,
};

const meta = {
  title: "Queue/QueueView",
  component: QueueView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ width: 384 }}>
        <Story />
      </div>
    ),
  ],
  args: { queue: QUEUE, syncing: false, approving: false, error: null, ...handlers },
} satisfies Meta<typeof QueueView>;

export default meta;
type Story = StoryObj<typeof QueueView>;

export const Populated: Story = {};
export const Empty: Story = { args: { queue: [] } };
export const Syncing: Story = { args: { syncing: true } };
export const SyncError: Story = {
  args: { error: "YNAB rate limit reached. Try again in a minute." },
};
export const Approving: Story = { args: { approving: true } };
export const WithCoffee: Story = {
  args: { showCoffee: true, coffeeItemized: 324, onDismissCoffee: noop, onCoffeeClick: noop },
};
