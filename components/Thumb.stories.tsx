import type { Meta, StoryObj } from "@storybook/react-vite";
import { Thumb } from "./Thumb";

// A product image with a baked-in white background — demonstrates the
// mix-blend-multiply framing that merges the white into the swatch.
const WHITE_BG_PHOTO =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='white'/%3E%3Ccircle cx='60' cy='52' r='30' fill='%23b5838d'/%3E%3Crect x='40' y='70' width='40' height='12' rx='3' fill='%235c7c86'/%3E%3C/svg%3E";

function ThumbRow() {
  return (
    <div className="flex items-start gap-4 text-text">
      <div className="flex flex-col items-center gap-1">
        <Thumb src={WHITE_BG_PHOTO} alt="Product" />
        <span className="text-[11px] text-faint">photo</span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <Thumb src={null} />
        <span className="text-[11px] text-faint">no photo</span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <Thumb src="https://example.invalid/missing.png" />
        <span className="text-[11px] text-faint">broken url</span>
      </div>
    </div>
  );
}

const meta = { title: "Primitives/Thumb", component: ThumbRow } satisfies Meta<typeof ThumbRow>;
export default meta;

export const Swatches: StoryObj<typeof ThumbRow> = {};
