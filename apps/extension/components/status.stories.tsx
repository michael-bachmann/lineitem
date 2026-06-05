import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusTile, statusInfo } from "./status";
import { SectionLabel } from "@lineitem/ui";

const STATUSES = ["classified", "partial", "loading", "nomatch", "auth", "error", "matched"];

function StatusKit() {
  return (
    <div className="flex flex-col gap-6 text-text" style={{ width: 384 }}>
      <section>
        <SectionLabel className="mb-2">Status tiles</SectionLabel>
        <div className="flex flex-wrap gap-3">
          {STATUSES.map((s) => (
            <div key={s} className="flex flex-col items-center gap-1">
              <StatusTile status={s} />
              <span className="text-[11px] text-faint">{s}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionLabel className="mb-2">statusInfo() copy</SectionLabel>
        <div className="flex flex-col gap-1">
          {STATUSES.map((s) => {
            const info = statusInfo({ status: s, needs: 2 });
            return (
              <div key={s} className="flex items-baseline gap-2 text-[13px]">
                <span className="w-20 shrink-0 text-faint">{s}</span>
                <span className="text-muted">{info.text}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

const meta = { title: "Primitives/Status", component: StatusKit } satisfies Meta<typeof StatusKit>;
export default meta;

export const Kit: StoryObj<typeof StatusKit> = {};
