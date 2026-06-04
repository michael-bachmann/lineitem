import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import Onboarding from "@/components/Onboarding";
import BackfillPrompt from "@/components/BackfillPrompt";
import Settings from "@/components/Settings";
import QueueView from "@/components/QueueView";
import DetailView from "@/components/DetailView";
import { isFullyClassified } from "@/lib/queue";
import type { QueueEntry, Category, ApprovalItem } from "@/lib/types";

type View = "loading" | "onboarding" | "backfill_prompt" | "queue" | "settings" | "detail";

export default function App() {
  const [view, setView] = useState<View>("loading");
  const [planName, setPlanName] = useState("");
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<QueueEntry | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    browser.runtime
      .sendMessage({ type: "GET_SETTINGS" })
      .then((response) => {
        if (response.accessToken && response.planId) {
          setPlanName(response.planName ?? "");
          setView("queue");
        } else {
          setView("onboarding");
        }
      })
      .catch(() => setView("onboarding"));
  }, []);

  if (view === "loading") {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 p-4 flex items-center justify-center">
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    );
  }

  if (view === "onboarding") {
    return (
      <Onboarding
        onComplete={(name: string) => {
          setPlanName(name);
          setView("backfill_prompt");
        }}
      />
    );
  }

  if (view === "backfill_prompt") {
    return <BackfillPrompt onContinue={() => setView("queue")} />;
  }

  if (view === "settings") {
    return (
      <Settings
        planName={planName}
        onDisconnect={() => setView("onboarding")}
        onBack={() => setView("queue")}
      />
    );
  }

  // Handlers for the queue view
  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const catResponse = await browser.runtime.sendMessage({ type: "GET_CATEGORIES" });
      if (catResponse?.error) {
        setError(catResponse.error);
        return;
      }
      setCategories(catResponse?.categories ?? []);

      const result = await browser.runtime.sendMessage({ type: "SYNC" });
      if (result?.error) {
        setError(result.error);
        return;
      }
      setQueue(result?.queue ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleApproveAll = async () => {
    const idsToApprove = queue
      .filter(isFullyClassified)
      .map((entry) => entry.ynabTransaction.id);
    if (idsToApprove.length === 0) return;

    setApproving(true);
    setError(null);
    try {
      const result = await browser.runtime.sendMessage({
        type: "APPROVE_BATCH",
        ynabTransactionIds: idsToApprove,
      });
      if (result?.error) {
        setError(result.error);
        return;
      }
      const approvedSet = new Set(idsToApprove);
      setQueue((prev) => prev.filter((entry) => !approvedSet.has(entry.ynabTransaction.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setApproving(false);
    }
  };

  // Detail view
  if (view === "detail" && selectedEntry !== null) {
    const handleApprove = async (ynabTransactionId: string, items: ApprovalItem[]) => {
      const result = await browser.runtime.sendMessage({
        type: "APPROVE_TRANSACTION",
        ynabTransactionId,
        items,
      });
      if (result?.error) throw new Error(result.error);
      setQueue((prev) => prev.filter((e) => e.ynabTransaction.id !== ynabTransactionId));
    };

    return (
      <DetailView
        entry={selectedEntry}
        categories={categories}
        onBack={() => {
          setSelectedEntry(null);
          setView("queue");
        }}
        onApprove={handleApprove}
      />
    );
  }

  // Queue view
  return (
    <QueueView
      queue={queue}
      syncing={syncing}
      approving={approving}
      error={error}
      onSync={handleSync}
      onApproveAll={handleApproveAll}
      onSelectEntry={(entry) => {
        setSelectedEntry(entry);
        setView("detail");
      }}
      onSettings={() => setView("settings")}
    />
  );
}
