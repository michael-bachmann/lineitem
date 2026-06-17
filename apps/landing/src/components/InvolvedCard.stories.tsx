import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Icon } from "@lineitem/ui";
import InvolvedCard from "./InvolvedCard";

const meta = {
  title: "Landing/InvolvedCard",
  component: InvolvedCard,
  args: { onClick: fn() },
  decorators: [
    (Story) => (
      <div className="w-[620px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InvolvedCard>;

export default meta;
type Story = StoryObj<typeof InvolvedCard>;

export const Single: Story = {
  args: {
    icon: <Icon.store width={21} height={21} />,
    title: "Request a retailer",
    sub: "Tell us where to expand next",
  },
};

/** The three involve cards stacked, as on the page. */
export const Grid: StoryObj = {
  decorators: [(Story) => <div className="flex w-[620px] max-w-full flex-col gap-[10px]"><Story /></div>],
  render: () => (
    <>
      <InvolvedCard icon={<Icon.store width={21} height={21} />} title="Request a retailer" sub="Tell us where to expand next" onClick={() => {}} />
      <InvolvedCard icon={<Icon.bulb width={21} height={21} />} title="Make a suggestion" sub="Ideas for the roadmap" onClick={() => {}} />
      <InvolvedCard icon={<Icon.bug width={21} height={21} />} title="Report an issue" sub="Something broken? Let us know" onClick={() => {}} />
    </>
  ),
};
