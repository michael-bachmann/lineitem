import { BrandRow } from "./Mark";
import { Button } from "./Button";
import { StatusMessage } from "./StatusMessage";
import { Spinner } from "./Spinner";
import { Icon } from "./icons";

export type OnboardingPhase = "connect" | "connecting" | "saving" | "error";

interface OnboardingViewProps {
  phase: OnboardingPhase;
  error?: string | null;
  onConnect: () => void;
}

/** Presentational onboarding screen — state in, callback out. */
export function OnboardingView({ phase, error, onConnect }: OnboardingViewProps) {
  return (
    <div className="flex min-h-screen flex-col gap-[18px] bg-bg p-4 pt-5 text-text">
      <BrandRow size={34} />
      <p className="m-0 text-[14px] leading-[1.55] text-muted">
        Connect your YNAB account to get started. You’ll be redirected to YNAB to authorize
        lineitem.
      </p>

      {(phase === "connect" || phase === "error") && (
        <Button variant="primary" onClick={onConnect}>
          Connect YNAB
        </Button>
      )}
      {phase === "connecting" && (
        <StatusMessage kind="muted">
          <Spinner size={16} /> Waiting for YNAB authorization…
        </StatusMessage>
      )}
      {phase === "saving" && (
        <StatusMessage kind="muted">
          <Spinner size={16} /> Setting up your workspace…
        </StatusMessage>
      )}
      {phase === "error" && error && (
        <StatusMessage kind="err">
          <Icon.alertCircle /> {error}
        </StatusMessage>
      )}
    </div>
  );
}
