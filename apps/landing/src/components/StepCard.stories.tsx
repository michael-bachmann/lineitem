import type { Meta, StoryObj } from "@storybook/react-vite";
import { Icon } from "@lineitem/ui";
import StepCard from "./StepCard";

const meta = {
  title: "Landing/StepCard",
  component: StepCard,
} satisfies Meta<typeof StepCard>;

export default meta;
type Story = StoryObj<typeof StepCard>;

export const Single: Story = {
  args: {
    n: 1,
    icon: <Icon.sync width={22} height={22} />,
    title: "Sync",
    body: "lineitem finds your recent retailer charges in YNAB and matches each one to the order behind it.",
  },
};

/** The three how-it-works steps in their grid. */
export const ThreeSteps: StoryObj = {
  render: () => (
    <ol style={{ maxWidth: 920 }} className="grid grid-cols-1 gap-[18px] min-[861px]:grid-cols-3">
      <StepCard n={1} icon={<Icon.sync width={22} height={22} />} title="Sync" body="lineitem finds your recent retailer charges in YNAB and matches each one to the order behind it." />
      <StepCard n={2} icon={<Icon.wand width={22} height={22} />} title="Review" body="Every line item gets a category — suggested from your own history. Adjust anything, or apply one category to the lot." />
      <StepCard n={3} icon={<Icon.check width={22} height={22} />} title="Approve" body="One tap writes the split back to YNAB. Nothing changes in your budget until you approve it." />
    </ol>
  ),
};
