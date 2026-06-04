import { useState } from "react";
import { getPlans, savePlan, startOAuth } from "@/lib/messaging";
import { OnboardingView, type OnboardingPhase } from "./OnboardingView";

interface OnboardingProps {
  onComplete: (planName: string) => void;
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

    const oauth = await startOAuth();
    if (oauth?.error) return fail(oauth.error);

    const plans = await getPlans();
    if (plans?.error) return fail(plans.error);

    // YNAB's "default plan selection" scopes the token to the plan the user
    // picked at consent, so /plans returns that one plan. We don't surface
    // multi-plan UX — to switch, the user disconnects and reconnects.
    const plan = plans.plans[0];
    if (!plan) {
      return fail("No plans found in your YNAB account. Create one in YNAB, then reconnect.");
    }

    setPhase("saving");
    const saved = await savePlan(plan.id, plan.name);
    if (saved?.error) return fail(saved.error);

    onComplete(plan.name);
  }

  return <OnboardingView phase={phase} error={error} onConnect={handleConnect} />;
}
