import { useState } from "react";
import { getDefaultPlan, savePlan, startOAuth, type PlanInfo } from "@/lib/messaging";
import { OnboardingView, type OnboardingPhase } from "./OnboardingView";

interface OnboardingProps {
  onComplete: (plan: PlanInfo) => void;
}

/** Container: owns the OAuth → plans → save state machine + IO; renders the
 *  presentational OnboardingView. */
export default function Onboarding({ onComplete }: OnboardingProps) {
  const [phase, setPhase] = useState<OnboardingPhase>("connect");
  const [error, setError] = useState<string | null>(null);

  function fail(message: string) {
    setError(message);
    setPhase("error");
  }

  async function handleConnect() {
    setError(null);
    setPhase("connecting");

    try {
      const oauth = await startOAuth();
      if (oauth?.error) return fail(oauth.error);

      // Connect the budget the user selected on YNAB's consent screen ("default
      // plan selection"), resolved via the `default` alias. We deliberately
      // don't list /plans and take [0] — that returns every budget the token
      // can see and would connect an arbitrary one for multi-budget users.
      // (Switching later happens in Settings, no reconnect needed.)
      const { plan, error: planError } = await getDefaultPlan();
      if (planError) return fail(planError);
      if (!plan) return fail("Couldn't load your budget from YNAB. Try again.");

      setPhase("saving");
      const saved = await savePlan(plan.id, plan.name);
      if (saved?.error) return fail(saved.error);

      onComplete(plan);
    } catch (e) {
      // A dropped message channel (extension reloaded, service worker torn
      // down mid-request) rejects sendMessage — surface it instead of leaving
      // the connecting spinner up forever.
      fail(e instanceof Error ? e.message : "Connection failed. Try again.");
    }
  }

  return <OnboardingView phase={phase} error={error} onConnect={handleConnect} />;
}
