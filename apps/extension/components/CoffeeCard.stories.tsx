import type { Meta, StoryObj } from "@storybook/react-vite";
import CoffeeCard from "./CoffeeCard";

const meta = {
  title: "Queue/CoffeeCard",
  component: CoffeeCard,
  decorators: [
    (Story) => (
      <div className="bg-bg p-4" style={{ width: 384 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CoffeeCard>;

export default meta;
type Story = StoryObj<typeof CoffeeCard>;

/** Standing tip jar in Help & About — not dismissible. */
export const Standing: Story = {
  args: { sub: "It’s free and ad-free. A coffee keeps it maintained." },
};

/** Post-approval ask on the queue — dismissible, with the concrete count. */
export const PostApproval: Story = {
  args: {
    sub: (
      <>
        lineitem has categorized <b className="font-semibold text-text">324</b> line items for you so
        far — all free and ad-free.
      </>
    ),
    onDismiss: () => {},
    onCoffeeClick: () => {},
  },
};
