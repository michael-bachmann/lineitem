import type { Meta, StoryObj } from "@storybook/react-vite";
import WhatsNewCard, { WHATS_NEW } from "./WhatsNewCard";

const meta = {
  title: "Queue/WhatsNewCard",
  component: WhatsNewCard,
  decorators: [
    (Story) => (
      <div className="bg-bg p-4" style={{ width: 384 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WhatsNewCard>;

export default meta;
type Story = StoryObj<typeof WhatsNewCard>;

/** The live 1.1.0 notes, as an updater sees them above the queue. */
export const Update: Story = {
  args: {
    version: "1.1.0",
    notes: WHATS_NEW["1.1.0"],
    onDismiss: () => {},
  },
};
