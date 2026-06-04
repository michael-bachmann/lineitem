import type { Meta, StoryObj } from "@storybook/react-vite";
import { SectionLabel } from "./SectionLabel";

function SectionLabels() {
  return (
    <div className="flex flex-col gap-3" style={{ width: 320 }}>
      <SectionLabel count={1}>Needs review</SectionLabel>
      <SectionLabel count={3}>Couldn’t match</SectionLabel>
      <SectionLabel>Items</SectionLabel>
    </div>
  );
}

const meta = { title: "Primitives/SectionLabel", component: SectionLabels } satisfies Meta<typeof SectionLabels>;
export default meta;

export const WithAndWithoutCount: StoryObj<typeof SectionLabels> = {};
