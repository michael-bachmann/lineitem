import { BrandRow, Button, StatusMessage, Spinner, Icon } from "@lineitem/ui";
import { LINKS } from "@lineitem/ui/links";

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
      {(phase === "connect" || phase === "error") && (
        <p className="-mt-[6px] text-[12.5px] text-faint">
          We respect your privacy.{" "}
          <a
            href={LINKS.privacy}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted underline hover:text-link"
          >
            Privacy Policy
          </a>
        </p>
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
        <StatusMessage kind="err" role="alert">
          <Icon.alertCircle aria-hidden /> {error}
        </StatusMessage>
      )}
    </div>
  );
}
