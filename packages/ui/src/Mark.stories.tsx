import type { Meta, StoryObj } from "@storybook/react-vite";
import { BrandRow, Mark } from "./Mark";

function Brand() {
  return (
    <div className="flex flex-col gap-5 text-text">
      <BrandRow />
      <div className="flex items-end gap-4">
        <Mark size={16} />
        <Mark size={24} />
        <Mark size={40} />
        <Mark size={64} />
      </div>
    </div>
  );
}

const meta = { title: "Primitives/Brand", component: Brand } satisfies Meta<typeof Brand>;
export default meta;

export const MarkAndWordmark: StoryObj<typeof Brand> = {};
