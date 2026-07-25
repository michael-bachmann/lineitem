import type { ReactNode } from "react";
import { BackLink, Button, Row, StatusMessage, Icon } from "@lineitem/ui";

export type SettingsState = "idle" | "refreshing" | "disconnecting" | "success" | "error";

interface SettingsViewProps {
  state: SettingsState;
  errorMsg?: string;
  /** The budget switcher (a container) — injected so the view stays storiable. */
  budget: ReactNode;
  /** The backfill card (a container) — injected so the view stays storiable. */
  backfill: ReactNode;
  onRefresh: () => void;
  onDisconnect: () => void;
  onOpenHelp: () => void;
  onBack: () => void;
}

export function SettingsView({
  state,
  errorMsg,
  budget,
  backfill,
  onRefresh,
  onDisconnect,
  onOpenHelp,
  onBack,
}: SettingsViewProps) {
  return (
    <div className="flex min-h-screen flex-col gap-3 bg-bg p-4 text-text">
      <div className="flex flex-col items-start gap-[7px]">
        <BackLink onClick={onBack} label="Back" />
        <h1 className="m-0 text-[20px] font-bold tracking-[-0.018em] text-text">Settings</h1>
      </div>

      {budget}

      <Button
        variant="secondary"
        busy={state === "refreshing"}
        busyLabel="Refreshing…"
        disabled={state === "disconnecting"}
        onClick={onRefresh}
      >
        <Icon.refresh aria-hidden width={16} height={16} /> Refresh Categories from YNAB
      </Button>

      {backfill}

      <Row
        accent
        icon={<Icon.help />}
        title="Help & About"
        sub="FAQ, links, support the project"
        onClick={onOpenHelp}
      />

      <div className="my-1 h-px bg-line" />

      <Button
        variant="danger"
        busy={state === "disconnecting"}
        busyLabel="Disconnecting…"
        disabled={state === "refreshing"}
        onClick={onDisconnect}
      >
        Disconnect YNAB
      </Button>

      {state === "success" && (
        <StatusMessage kind="ok" role="status">
          <Icon.check aria-hidden /> Categories refreshed.
        </StatusMessage>
      )}
      {state === "error" && (
        <StatusMessage kind="err" role="alert">
          <Icon.alertCircle aria-hidden /> {errorMsg || "Could not reach YNAB. Check your connection."}
        </StatusMessage>
      )}
    </div>
  );
}
