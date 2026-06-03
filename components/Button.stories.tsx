import type { Meta, StoryObj } from "@storybook/react-vite";
import Button from "./Button";
import { Icon } from "./icons";

const meta = {
  title: "Primitives/Button",
  component: Button,
  args: { children: "Button" },
  // Constrain to the panel's reference width so full-width buttons read right.
  decorators: [
    (Story) => (
      <div style={{ width: 384 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = { args: { variant: "primary", children: "Approve 1 ready" } };
export const Secondary: Story = { args: { variant: "secondary", children: "Refresh Categories from YNAB" } };
export const Ghost: Story = { args: { variant: "ghost", children: "Cancel" } };
export const Danger: Story = { args: { variant: "danger", children: "Disconnect YNAB" } };
export const DisabledPrimary: Story = {
  args: { variant: "primary", disabled: true, children: "2 items still need a category" },
};

// The `sm` (compact, auto-width) variant exists for the top-bar Sync button.
export const Sync: Story = {
  args: {
    variant: "primary",
    sm: true,
    children: (
      <>
        <Icon.sync width={15} height={15} /> Sync
      </>
    ),
  },
};
export const SyncBusy: Story = {
  args: { variant: "primary", sm: true, busy: true, busyLabel: "Syncing…", children: "Sync" },
};
