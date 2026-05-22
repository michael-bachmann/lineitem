import { useState } from "react";
import { browser } from "wxt/browser";
import type { YnabPlan } from "@/lib/ynab";

interface OnboardingProps {
  onComplete: (planName: string) => void;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [token, setToken] = useState("");
  const [validatedToken, setValidatedToken] = useState("");
  const [plans, setPlans] = useState<YnabPlan[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleConnect() {
    const trimmed = token.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setPlans(null);

    try {
      const response = await browser.runtime.sendMessage({
        type: "GET_PLANS",
        token: trimmed,
      });
      if (response.error) {
        setError(response.error);
      } else {
        setValidatedToken(trimmed);
        setPlans(response.plans);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch plans");
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectPlan(plan: YnabPlan) {
    setSaving(true);
    setError(null);

    try {
      const response = await browser.runtime.sendMessage({
        type: "SAVE_SETTINGS",
        token: validatedToken,
        planId: plan.id,
        planName: plan.name,
      });
      if (response.error) {
        setError(response.error);
      } else {
        onComplete(plan.name);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4">
      <h1 className="text-lg font-semibold">Itemize</h1>
      <p className="text-sm text-gray-400 mt-4">
        Connect your YNAB account to get started.
      </p>

      <div className="mt-6 space-y-3">
        <label className="block text-sm font-medium text-gray-300">
          Personal Access Token
        </label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleConnect()}
          placeholder="Paste your YNAB token"
          className="w-full rounded-md bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          disabled={loading || saving}
        />
        <a
          href="https://app.ynab.com/settings/developer"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          Get your token from YNAB Developer Settings
        </a>

        <button
          onClick={handleConnect}
          disabled={!token.trim() || loading || saving}
          className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Connecting..." : "Connect"}
        </button>
      </div>

      {error && (
        <p className="mt-4 text-sm text-red-400">{error}</p>
      )}

      {plans && plans.length === 0 && (
        <p className="mt-4 text-sm text-gray-400">
          No plans found. Create a plan in YNAB first.
        </p>
      )}

      {plans && plans.length > 0 && (
        <div className="mt-6 space-y-2">
          <p className="text-sm font-medium text-gray-300">
            Select a plan:
          </p>
          {plans.map((plan) => (
            <button
              key={plan.id}
              onClick={() => handleSelectPlan(plan)}
              disabled={saving}
              className="w-full rounded-md border border-gray-700 bg-gray-900 px-4 py-3 text-left text-sm text-gray-100 hover:bg-gray-800 hover:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {plan.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
