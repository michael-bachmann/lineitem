import { useState } from "react";
import { browser } from "wxt/browser";
import type { YnabPlan } from "@/lib/ynab";

interface OnboardingProps {
  onComplete: (planName: string) => void;
}

type Phase = "connect" | "connecting" | "selecting_plan" | "saving";

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [phase, setPhase] = useState<Phase>("connect");
  const [plans, setPlans] = useState<YnabPlan[] | null>(null);
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
    setPlans(plansResp.plans);
    setPhase("selecting_plan");
  }

  async function handleSelectPlan(plan: YnabPlan) {
    setError(null);
    setPhase("saving");
    const resp = await browser.runtime.sendMessage({
      type: "SAVE_PLAN",
      planId: plan.id,
      planName: plan.name,
    });
    if (resp?.error) {
      setError(resp.error);
      setPhase("selecting_plan");
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

      {phase === "selecting_plan" && plans && (
        <div className="mt-6 space-y-2">
          <p className="text-sm font-medium text-gray-300">Select a plan:</p>
          {plans.length === 0 && (
            <p className="text-sm text-gray-400">No plans found. Create a plan in YNAB first.</p>
          )}
          {plans.map((plan) => (
            <button
              key={plan.id}
              onClick={() => handleSelectPlan(plan)}
              className="w-full rounded-md border border-gray-700 bg-gray-900 px-4 py-3 text-left text-sm text-gray-100 hover:bg-gray-800 hover:border-gray-600"
            >
              {plan.name}
            </button>
          ))}
        </div>
      )}

      {phase === "saving" && (
        <p className="mt-6 text-sm text-gray-400">Saving…</p>
      )}

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </div>
  );
}
