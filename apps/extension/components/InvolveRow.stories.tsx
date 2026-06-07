import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Icon } from "@lineitem/ui";
import InvolveRow from "./InvolveRow";

const meta = {
  title: "Settings/InvolveRow",
  component: InvolveRow,
  decorators: [
    (Story) => (
      <div className="bg-bg p-4" style={{ width: 384 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InvolveRow>;

export default meta;
type Story = StoryObj<typeof InvolveRow>;

function Interactive({ startOpen }: { startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <InvolveRow
      icon={<Icon.store />}
      title="Request a retailer"
      sub="Tell us where to expand next"
      kind="retailer"
      expanded={open}
      onToggle={() => setOpen((v) => !v)}
    />
  );
}

export const Collapsed: Story = { render: () => <Interactive startOpen={false} /> };
export const Expanded: Story = { render: () => <Interactive startOpen={true} /> };
