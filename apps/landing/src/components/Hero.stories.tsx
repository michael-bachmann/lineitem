import type { Meta, StoryObj } from "@storybook/react-vite";
import Hero from "./Hero";

const meta = {
  title: "Landing/Hero",
  component: Hero,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Hero>;

export default meta;
type Story = StoryObj<typeof Hero>;

export const Desktop: Story = {};

// ≤860px: copy centers, install buttons + mock stack below.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  parameters: { viewport: { defaultViewport: "mobile1" } },
};
