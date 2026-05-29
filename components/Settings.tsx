import { useState } from "react";
import { browser } from "wxt/browser";
import BackfillCard from "./BackfillCard";

interface SettingsProps {
  planName: string;
  onDisconnect: () => void;
  onBack: () => void;
}

export default function Settings({ planName, onDisconnect, onBack }: SettingsProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleRefreshCategories() {
    setRefreshing(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await browser.runtime.sendMessage({
        type: "REFRESH_CATEGORIES",
      });
      if (response.error) {
        setError(response.error);
      } else {
        setSuccess("Categories refreshed.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to refresh categories");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    setError(null);
    setSuccess(null);

    try {
      await browser.runtime.sendMessage({ type: "CLEAR_SETTINGS" });
      onDisconnect();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to disconnect");
      setDisconnecting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4">
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={onBack}
          className="text-sm text-gray-400 hover:text-gray-200"
        >
          &larr; Back
        </button>
        <h1 className="text-lg font-semibold">Settings</h1>
      </div>

      <div className="space-y-6">
        <div>
          <p className="text-sm text-gray-400">Connected plan</p>
          <p className="text-sm font-medium text-gray-100 mt-1">{planName}</p>
        </div>

        <button
          onClick={handleRefreshCategories}
          disabled={refreshing || disconnecting}
          className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm font-medium text-gray-100 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {refreshing ? "Refreshing..." : "Refresh Categories from YNAB"}
        </button>

        <BackfillCard />

        <button
          onClick={handleDisconnect}
          disabled={refreshing || disconnecting}
          className="w-full rounded-md bg-red-900 border border-red-800 px-3 py-2 text-sm font-medium text-red-100 hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {disconnecting ? "Disconnecting..." : "Disconnect YNAB"}
        </button>

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}
        {success && (
          <p className="text-sm text-green-400">{success}</p>
        )}
      </div>
    </div>
  );
}
