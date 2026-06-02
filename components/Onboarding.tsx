import { useState } from "react";
import { browser } from "wxt/browser";

interface OnboardingProps {
  onComplete: (planName: string) => void;
}

type Phase = "connect" | "connecting" | "saving";

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [phase, setPhase] = useState<Phase>("connect");
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setError(null);
    setPhase("connecting");

    const oauthResp = await browser.runtime.sendMessage({ type: "START_OAUTH" });
    if (oauthResp?.error) {
      setError(oauthResp.error);
      setPhase("connect");
      return;
    }

    const plansResp = await browser.runtime.sendMessage({ type: "GET_PLANS" });
    if (plansResp?.error) {
      setError(plansResp.error);
      setPhase("connect");
      return;
    }

    // YNAB's "default plan selection" scopes the token to the plan the user
    // picked at consent, so /plans returns that one plan. We don't surface
    // multi-plan UX — if a user wanted a different plan they'd disconnect
    // and reconnect, picking it at consent instead.
    const plan = plansResp.plans[0];
    if (!plan) {
      setError("No plans found in your YNAB account. Create one in YNAB, then reconnect.");
      setPhase("connect");
      return;
    }

    setPhase("saving");
    const saveResp = await browser.runtime.sendMessage({
      type: "SAVE_PLAN",
      planId: plan.id,
      planName: plan.name,
    });
    if (saveResp?.error) {
      setError(saveResp.error);
      setPhase("connect");
      return;
    }
    onComplete(plan.name);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4">
      <h1 className="text-lg font-semibold">lineitem</h1>
      <p className="text-sm text-gray-400 mt-4">
        Connect your YNAB account to get started. You'll be redirected to YNAB
        to authorize lineitem.
      </p>

      {phase === "connect" && (
        <button
          onClick={handleConnect}
          className="w-full mt-6 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Connect YNAB
        </button>
      )}

      {phase === "connecting" && (
        <p className="mt-6 text-sm text-gray-400">Waiting for YNAB authorization…</p>
      )}

      {phase === "saving" && (
        <p className="mt-6 text-sm text-gray-400">Setting up…</p>
      )}

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </div>
  );
}
