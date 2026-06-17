import type { Meta, StoryObj } from "@storybook/react-vite";
import { FaqAccordion, FaqItem } from "./FaqAccordion";
import { FAQ } from "@/lib/faq";

const meta = {
  title: "Landing/FaqAccordion",
  component: FaqItem,
  decorators: [
    (Story) => (
      <div className="w-[680px] max-w-full overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FaqItem>;

export default meta;
type Story = StoryObj<typeof FaqItem>;

export const Collapsed: Story = { args: { ...FAQ[0], defaultOpen: false } };
export const Expanded: Story = { args: { ...FAQ[0], defaultOpen: true } };

/** The full accordion (first item open). */
export const FullAccordion: StoryObj = {
  decorators: [(Story) => <div className="w-[680px] max-w-full"><Story /></div>],
  render: () => <FaqAccordion items={FAQ} />,
};
