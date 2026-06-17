import type { Meta, StoryObj } from "@storybook/react-vite";
import { Chip } from "./Chip";

const meta = {
  title: "Primitives/Chip",
  component: Chip,
  decorators: [
    (Story) => (
      <div className="rounded-card border border-line bg-surface p-4 shadow-card">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof Chip>;

export const Live: Story = { args: { tone: "ok", dot: true, children: "Live" } };
export const Planned: Story = { args: { tone: "neutral", children: "Planned" } };
