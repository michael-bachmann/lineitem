import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsView } from "./SettingsView";
import { BackfillCardView } from "./BackfillCardView";

// Inject the presentational backfill card (idle) so the view needs no browser.
const backfill = <BackfillCardView state={{ kind: "idle" }} onStart={() => {}} onCancel={() => {}} />;

const meta = {
  title: "Settings/SettingsView",
  component: SettingsView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ width: 384 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    planName: "My Budget",
    backfill,
    onRefresh: () => {},
    onDisconnect: () => {},
    onOpenHelp: () => {},
    onBack: () => {},
  },
} satisfies Meta<typeof SettingsView>;

export default meta;
type Story = StoryObj<typeof SettingsView>;

export const Idle: Story = { args: { state: "idle" } };
export const Refreshing: Story = { args: { state: "refreshing" } };
export const Disconnecting: Story = { args: { state: "disconnecting" } };
export const Success: Story = { args: { state: "success" } };
export const ErrorState: Story = {
  args: { state: "error", errorMsg: "Could not reach YNAB. Check your connection." },
};
