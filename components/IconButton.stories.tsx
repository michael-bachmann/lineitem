import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconButton } from "./IconButton";
import { Button } from "./Button";
import { BrandRow } from "./Mark";
import { Icon } from "./icons";

const meta = { title: "Primitives/IconButton", component: IconButton } satisfies Meta<typeof IconButton>;
export default meta;
type Story = StoryObj<typeof IconButton>;

export const Gear: Story = {
  args: { "aria-label": "Settings", children: <Icon.gear width={18} height={18} /> },
};

// How the gear (IconButton) and Sync (Button sm) sit together in the queue header.
export const InTopBar: StoryObj = {
  render: () => (
    <div className="flex items-center gap-[10px] text-text" style={{ width: 384 }}>
      <div className="mr-auto min-w-0">
        <BrandRow />
      </div>
      <IconButton aria-label="Settings">
        <Icon.gear width={18} height={18} />
      </IconButton>
      <Button variant="primary" sm>
        <Icon.sync width={15} height={15} /> Sync
      </Button>
    </div>
  ),
};
