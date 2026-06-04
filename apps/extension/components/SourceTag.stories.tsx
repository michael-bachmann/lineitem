import type { Meta, StoryObj } from "@storybook/react-vite";
import { SourceTag } from "./SourceTag";

function SourceTags() {
  return (
    <div className="flex flex-col items-start gap-2">
      <SourceTag source="ok" />
      <SourceTag source="embed" />
      <SourceTag source="needs" />
    </div>
  );
}

const meta = { title: "Primitives/SourceTag", component: SourceTags } satisfies Meta<typeof SourceTags>;
export default meta;

export const Kinds: StoryObj<typeof SourceTags> = {};
