import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { Icon } from "./icons";
import { SectionLabel } from "./SectionLabel";

const meta = {
  title: "Primitives/Button",
  component: Button,
  args: { children: "Button" },
  // Render on a white surface card at panel width — matches how these sit in
  // the app, so the pale variants (secondary/ghost/disabled) read with proper
  // contrast instead of washing out against the warm page canvas.
  decorators: [
    (Story) => (
      <div className="rounded-card border border-line bg-surface p-4 shadow-card" style={{ width: 384 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof Button>;

// ---- the 5 distinct looks, labeled, for 1:1 mapping against the design ----
const ROWS: { label: string; node: ReactNode }[] = [
  { label: "primary", node: <Button variant="primary">Approve 1 ready</Button> },
  {
    label: "primary · disabled (blocked action)",
    node: (
      <Button variant="primary" disabled>
        Backfill running…
      </Button>
    ),
  },
  {
    label: "secondary",
    node: (
      <Button variant="secondary">
        <Icon.refresh width={16} height={16} /> Refresh Categories from YNAB
      </Button>
    ),
  },
  { label: "ghost", node: <Button variant="ghost">Cancel</Button> },
  { label: "danger", node: <Button variant="danger">Disconnect YNAB</Button> },
];

export const AllVariants: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4">
      {ROWS.map((r) => (
        <div key={r.label} className="flex flex-col gap-1">
          <SectionLabel>{r.label}</SectionLabel>
          {r.node}
        </div>
      ))}
    </div>
  ),
};

// ---- individual variants (exact reference labels) ----
export const Primary: Story = { args: { variant: "primary", children: "Approve 1 ready" } };

export const Secondary: Story = {
  args: {
    variant: "secondary",
    children: (
      <>
        <Icon.refresh width={16} height={16} /> Refresh Categories from YNAB
      </>
    ),
  },
};

export const Ghost: Story = { args: { variant: "ghost", children: "Cancel" } };

export const Danger: Story = { args: { variant: "danger", children: "Disconnect YNAB" } };

export const DisabledPrimary: Story = {
  args: { variant: "primary", disabled: true, children: "Backfill running…" },
};

// ---- the `sm` (compact) variant: the top-bar Sync button ----
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
