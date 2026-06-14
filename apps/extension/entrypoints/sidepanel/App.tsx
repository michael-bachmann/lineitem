import { useCallback, useEffect, useState } from "react";
import { browser } from "wxt/browser";
import Onboarding from "@/components/Onboarding";
import BackfillPrompt from "@/components/BackfillPrompt";
import Settings from "@/components/Settings";
import Help from "@/components/Help";
import QueueView from "@/components/QueueView";
import DetailView from "@/components/DetailView";
import { isFullyClassified } from "@/lib/queue";
import { recordClassified, retireCoffee } from "@/lib/coffee";
import {
  approveBatch,
  approveTransaction,
  getCategories,
  getSettings,
  sync,
} from "@/lib/messaging";
import type { QueueEntry, Category, ApprovalItem } from "@/lib/types";

type View = "loading" | "onboarding" | "backfill_prompt" | "queue" | "settings" | "detail" | "help";

export default function App() {
  const [view, setView] = useState<View>("loading");
  const [planName, setPlanName] = useState("");
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<QueueEntry | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCoffee, setShowCoffee] = useState(false);
  const [coffeeClassified, setCoffeeClassified] = useState(0);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const catResponse = await getCategories();
      if (catResponse?.error) {
        setError(catResponse.error);
        return;
      }
      setCategories(catResponse?.categories ?? []);

      const result = await sync();
      if (result?.error) {
        setError(result.error);
        return;
      }
      setQueue(result?.queue ?? []);
      setShowCoffee(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    getSettings()
      .then((response) => {
        if (response.accessToken && response.planId) {
          setPlanName(response.planName ?? "");
          setView("queue");
          // The queue lives only in React state, so it's lost when the panel
          // closes. Restore it on open by syncing. Already-scraped transactions
          // hit the IndexedDB cache, so this is fast and only scrapes genuinely
          // new charges. App remounts per panel open, so this runs once a session.
          void handleSync();
        } else {
          setView("onboarding");
        }
      })
      .catch(() => setView("onboarding"));
  }, [handleSync]);

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
        onOpenHelp={() => setView("help")}
      />
    );
  }

  if (view === "help") {
    return (
      <Help onBack={() => setView("settings")} version={browser.runtime.getManifest().version} />
    );
  }

  // Handlers for the queue view
  const handleApproveAll = async () => {
    const approvedEntries = queue.filter(isFullyClassified);
    const idsToApprove = approvedEntries.map((entry) => entry.ynabTransaction.id);
    if (idsToApprove.length === 0) return;

    setApproving(true);
    setError(null);
    try {
      const result = await approveBatch(idsToApprove);
      if (result?.error) {
        setError(result.error);
        return;
      }
      const itemCount = approvedEntries.reduce(
        (n, entry) =>
          n + (entry.matchStatus.status === "matched" ? entry.matchStatus.classifiedItems.length : 0),
        0,
      );
      const { showCoffee: show, cumulativeClassified } = await recordClassified(itemCount);
      setCoffeeClassified(cumulativeClassified);
      setShowCoffee(show);
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
      const result = await approveTransaction(ynabTransactionId, items);
      if (result?.error) throw new Error(result.error);
      const { showCoffee: show, cumulativeClassified } = await recordClassified(items.length);
      setCoffeeClassified(cumulativeClassified);
      setShowCoffee(show);
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
      showCoffee={showCoffee}
      coffeeClassified={coffeeClassified}
      onDismissCoffee={() => setShowCoffee(false)}
      onCoffeeClick={() => {
        void retireCoffee();
        setShowCoffee(false);
      }}
    />
  );
}
