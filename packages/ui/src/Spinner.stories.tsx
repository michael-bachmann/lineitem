import type { Meta, StoryObj } from "@storybook/react-vite";
import { Spinner } from "./Spinner";

function Spinners() {
  return (
    <div className="flex items-center gap-6 text-text">
      <Spinner size={11} />
      <Spinner size={15} />
      <Spinner size={20} />
      <div className="flex items-center justify-center rounded-control bg-ink p-3">
        <Spinner size={15} onAccent />
      </div>
    </div>
  );
}

const meta = { title: "Primitives/Spinner", component: Spinners } satisfies Meta<typeof Spinners>;
export default meta;

export const Sizes: StoryObj<typeof Spinners> = {};
