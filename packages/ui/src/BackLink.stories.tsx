import type { Meta, StoryObj } from "@storybook/react-vite";
import { BackLink } from "./BackLink";

const meta = {
  title: "Primitives/BackLink",
  component: BackLink,
  decorators: [
    (Story) => (
      <div style={{ width: 384 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BackLink>;
export default meta;
type Story = StoryObj<typeof BackLink>;

export const ToQueue: Story = {};
export const ToSettings: Story = { args: { label: "Back" } };
