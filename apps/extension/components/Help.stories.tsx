import type { Meta, StoryObj } from "@storybook/react-vite";
import Help from "./Help";

const meta = {
  title: "Settings/Help",
  component: Help,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ width: 384 }}>
        <Story />
      </div>
    ),
  ],
  args: { onBack: () => {}, version: "1.4.0" },
} satisfies Meta<typeof Help>;

export default meta;

export const Default: StoryObj<typeof Help> = {};
