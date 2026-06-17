import type { Meta, StoryObj } from "@storybook/react-vite";
import { Icon } from "@lineitem/ui";
import FeatureItem from "./FeatureItem";

const meta = {
  title: "Landing/FeatureItem",
  component: FeatureItem,
} satisfies Meta<typeof FeatureItem>;

export default meta;
type Story = StoryObj<typeof FeatureItem>;

export const Single: Story = {
  args: {
    icon: <Icon.lock width={19} height={19} />,
    title: "Private by design",
    body: "Order details are matched locally in your browser. The only thing LineItem touches is YNAB.",
  },
};

/** The feature strip — three across. */
export const Grid: StoryObj = {
  render: () => (
    <div className="grid max-w-[920px] grid-cols-1 gap-6 min-[861px]:grid-cols-3">
      <FeatureItem icon={<Icon.wand width={19} height={19} />} title="Learns your categories" body="Backfill the last 12 months and LineItem suggests categories the way you'd assign them." />
      <FeatureItem icon={<Icon.lock width={19} height={19} />} title="Private by design" body="Order details are matched locally in your browser. The only thing LineItem touches is YNAB." />
      <FeatureItem icon={<Icon.help width={19} height={19} />} title="You're always in control" body="Review every match. Nothing is written to your budget until you say so." />
    </div>
  ),
};
