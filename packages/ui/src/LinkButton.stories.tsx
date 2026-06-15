import type { Meta, StoryObj } from "@storybook/react-vite";
import { LinkButton } from "./LinkButton";

const meta = {
  title: "Primitives/LinkButton",
  component: LinkButton,
  args: { href: "#", children: "Add to browser" },
  decorators: [
    (Story) => (
      <div
        className="rounded-card border border-line bg-surface p-4 shadow-card"
        style={{ width: 384 }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LinkButton>;

export default meta;
type Story = StoryObj<typeof LinkButton>;

export const Primary: Story = { args: { variant: "primary" } };
export const Secondary: Story = { args: { variant: "secondary" } };
export const PrimarySm: Story = { args: { variant: "primary", sm: true } };
