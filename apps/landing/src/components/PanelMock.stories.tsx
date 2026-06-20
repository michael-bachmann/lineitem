import type { Meta, StoryObj } from "@storybook/react-vite";
import PanelMock from "./PanelMock";

const meta = {
  title: "Landing/PanelMock",
  component: PanelMock,
} satisfies Meta<typeof PanelMock>;

export default meta;
type Story = StoryObj<typeof PanelMock>;

/** Hero mock: a charge cracked open into itemized, categorized line items. */
export const Detail: Story = {
  args: { variant: "detail" },
};

/** How-it-works mock: the grouped review queue. */
export const Queue: Story = {
  args: { variant: "queue" },
};
