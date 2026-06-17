import type { Meta, StoryObj } from "@storybook/react-vite";
import StoreButton from "./StoreButton";

const meta = {
  title: "Landing/StoreButton",
  component: StoreButton,
  args: { href: "#" },
} satisfies Meta<typeof StoreButton>;

export default meta;
type Story = StoryObj<typeof StoreButton>;

export const Chrome: Story = { args: { store: "chrome" } };
export const Firefox: Story = { args: { store: "firefox" } };
