import type { Meta, StoryObj } from "@storybook/react-vite";
import PanelMock from "./PanelMock";

const meta = {
  title: "Landing/PanelMock",
  component: PanelMock,
} satisfies Meta<typeof PanelMock>;

export default meta;
type Story = StoryObj<typeof PanelMock>;

export const Default: Story = {};
