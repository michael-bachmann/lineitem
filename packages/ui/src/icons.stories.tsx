import type { Meta, StoryObj } from "@storybook/react-vite";
import { Icon, type IconName } from "./icons";

function IconGrid() {
  const names = Object.keys(Icon) as IconName[];
  return (
    <div className="grid grid-cols-4 gap-3 text-text" style={{ width: 384 }}>
      {names.map((name) => {
        const Glyph = Icon[name];
        return (
          <div
            key={name}
            className="flex flex-col items-center gap-1 rounded-control border border-line bg-surface p-2 shadow-card"
          >
            <Glyph width={22} height={22} />
            <span className="text-[11px] text-faint">{name}</span>
          </div>
        );
      })}
    </div>
  );
}

const meta = { title: "Primitives/Icons", component: IconGrid } satisfies Meta<typeof IconGrid>;
export default meta;

export const All: StoryObj<typeof IconGrid> = {};
