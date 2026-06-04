import type { Meta, StoryObj } from "@storybook/react-vite";
import DetailView from "./DetailView";
import type {
  AllocatedTransaction,
  Category,
  ClassifiedItem,
  OrderMatchStatus,
  QueueEntry,
} from "@/lib/types";

const CATEGORIES: Category[] = [
  { id: "g1", name: "Groceries", groupName: "Frequent" },
  { id: "g2", name: "Dining Out", groupName: "Frequent" },
  { id: "m1", name: "Internet", groupName: "Monthly Bills" },
  { id: "n1", name: "Household Goods", groupName: "Non-Monthly" },
];

const PHOTO =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='white'/%3E%3Crect x='30' y='44' width='60' height='14' rx='4' fill='%235c7c86'/%3E%3Ccircle cx='60' cy='80' r='14' fill='%23b5838d'/%3E%3C/svg%3E";

function item(
  productId: string,
  title: string,
  cents: number,
  suggested: string | null,
  source: ClassifiedItem["classificationSource"],
): ClassifiedItem {
  return {
    productId,
    title,
    imageUrl: PHOTO,
    unitPriceCents: cents,
    quantity: 1,
    refundedAmountCents: 0,
    allocatedCents: cents,
    suggestedCategoryId: suggested,
    classificationSource: source,
  } as ClassifiedItem;
}

const PARTIAL = [
  item("p1", "USB-C Charging Cable (3-pack), 6ft Braided", 2999, "n1", "product_cache"),
  item("p2", "Mystery Gadget Nobody Recognizes", 1300, null, null),
];
const READY = [
  item("p1", "USB-C Charging Cable (3-pack), 6ft Braided", 2999, "n1", "product_cache"),
  item("p2", "HDMI Cable 4K, 6ft", 1300, "g1", "embedding"),
];

const order = {
  ynabTransactionId: "t1",
  orderKey: "amazon:113-2298810-7741200",
  retailer: "amazon",
  date: "2026-05-20",
  amountCents: 4299,
  isRefund: false,
  items: PARTIAL,
} as AllocatedTransaction;

const matched = (items: ClassifiedItem[]): OrderMatchStatus => ({
  status: "matched",
  order,
  classifiedItems: items,
});

function entry(matchStatus: OrderMatchStatus): QueueEntry {
  return {
    ynabTransaction: {
      id: "t1",
      payee_name: "AMAZON GROCERY",
      amount: -42990,
      date: "2026-05-20",
    } as QueueEntry["ynabTransaction"],
    retailer: "amazon",
    matchStatus,
  };
}

const meta = {
  title: "Detail/DetailView",
  component: DetailView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ width: 384 }}>
        <Story />
      </div>
    ),
  ],
  args: { categories: CATEGORIES, onBack: () => {}, onApprove: async () => {} },
} satisfies Meta<typeof DetailView>;

export default meta;
type Story = StoryObj<typeof DetailView>;

export const MatchedPartial: Story = { args: { entry: entry(matched(PARTIAL)) } };
export const MatchedReady: Story = { args: { entry: entry(matched(READY)) } };
export const Loading: Story = { args: { entry: entry({ status: "loading" }) } };
export const NoMatch: Story = { args: { entry: entry({ status: "no_match" }) } };
export const AuthRequired: Story = { args: { entry: entry({ status: "auth_required" }) } };
export const ScrapeError: Story = { args: { entry: entry({ status: "error", message: "parse failed" }) } };
