import type { Meta, StoryObj } from "@storybook/react-vite";
import SiteFooter from "./SiteFooter";

const meta = {
  title: "Landing/SiteFooter",
  component: SiteFooter,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SiteFooter>;

export default meta;
type Story = StoryObj<typeof SiteFooter>;

export const Default: Story = {};

// Columns drop to two-up below 620px.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  parameters: { viewport: { defaultViewport: "mobile1" } },
};
