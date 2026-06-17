import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import RetailerRow from "./RetailerRow";

const meta = {
  title: "Landing/RetailerRow",
  component: RetailerRow,
  decorators: [
    (Story) => (
      <div className="w-[480px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RetailerRow>;

export default meta;
type Story = StoryObj<typeof RetailerRow>;

export const Live: Story = { args: { variant: "live", name: "Amazon" } };
export const Planned: Story = { args: { variant: "planned", name: "Walmart" } };
export const Request: Story = {
  args: { variant: "request", name: "Request a retailer", onClick: fn() },
};
