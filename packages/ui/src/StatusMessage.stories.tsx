import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusMessage } from "./StatusMessage";
import { Spinner } from "./Spinner";
import { Icon } from "./icons";

function StatusMessages() {
  return (
    <div className="flex flex-col items-start gap-3" style={{ width: 320 }}>
      <StatusMessage kind="muted">
        <Spinner size={16} /> Waiting for YNAB authorization…
      </StatusMessage>
      <StatusMessage kind="ok">
        <Icon.check /> Categories refreshed.
      </StatusMessage>
      <StatusMessage kind="err">
        <Icon.alertCircle /> Backfill failed: Amazon login required.
      </StatusMessage>
    </div>
  );
}

const meta = { title: "Primitives/StatusMessage", component: StatusMessages } satisfies Meta<typeof StatusMessages>;
export default meta;

export const Kinds: StoryObj<typeof StatusMessages> = {};
