import type { Meta, StoryObj } from "@storybook/react-vite";
import { Chip, SourceIcon, StatusTile, statusInfo, type TileKind } from "./status";

const STATUSES = ["classified", "partial", "loading", "nomatch", "auth", "error", "matched"];
const CHIP_KINDS: TileKind[] = ["neutral", "ready", "ok", "warn", "err"];

function StatusKit() {
  return (
    <div className="flex flex-col gap-6 text-text" style={{ width: 384 }}>
      <section>
        <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-faint">Status tiles</h3>
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
        <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-faint">Chips</h3>
        <div className="flex flex-wrap gap-2">
          {CHIP_KINDS.map((k) => (
            <Chip key={k} kind={k}>
              {k}
            </Chip>
          ))}
          <Chip kind="neutral" spin>
            syncing
          </Chip>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-faint">Source icons</h3>
        <div className="flex items-center gap-4 text-[13px]">
          <span className="inline-flex items-center gap-1">
            <SourceIcon source="ok" /> From history
          </span>
          <span className="inline-flex items-center gap-1">
            <SourceIcon source="embed" /> Suggested
          </span>
          <span className="inline-flex items-center gap-1">
            <SourceIcon source="needs" /> Needs a category
          </span>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-faint">statusInfo() copy</h3>
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
