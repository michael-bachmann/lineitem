import type { Meta, StoryObj } from "@storybook/react-vite";
import CoffeeBand from "./CoffeeBand";

const meta = {
  title: "Landing/CoffeeBand",
  component: CoffeeBand,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CoffeeBand>;

export default meta;
type Story = StoryObj<typeof CoffeeBand>;

export const Default: Story = {};
