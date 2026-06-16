import type { Meta, StoryObj } from "@storybook/react-vite";
import SiteNav from "./SiteNav";

const meta = {
  title: "Landing/SiteNav",
  component: SiteNav,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SiteNav>;

export default meta;
type Story = StoryObj<typeof SiteNav>;

export const Default: Story = {};

export const Scrolled: Story = { args: { scrolled: true } };

// Links collapse below 620px — narrow the viewport to see only brand + CTA.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  parameters: { viewport: { defaultViewport: "mobile1" } },
};
