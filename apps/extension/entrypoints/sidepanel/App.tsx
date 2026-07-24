import { useCallback, useEffect, useRef, useState } from "react";
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
  openRetailer,
  sync,
  type PlanInfo,
} from "@/lib/messaging";
import type { QueueEntry, Category, ApprovalItem, BlockedRetailer } from "@/lib/types";

type View = "loading" | "onboarding" | "backfill_prompt" | "queue" | "settings" | "detail" | "help";

export default function App() {
  const [view, setView] = useState<View>("loading");
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [blocked, setBlocked] = useState<BlockedRetailer[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<QueueEntry | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCoffee, setShowCoffee] = useState(false);
  const [coffeeClassified, setCoffeeClassified] = useState(0);

  // Bumped on plan switch. A sync that started before the bump discards its
  // result — the background's dedup slot is reset on switch, so a slow old-plan
  // run can settle late and must not overwrite the new plan's queue.
  const syncEpoch = useRef(0);

  const handleSync = useCallback(async () => {
    const epoch = syncEpoch.current;
    const isCurrent = () => epoch === syncEpoch.current;
    setSyncing(true);
    setError(null);
    try {
      const catResponse = await getCategories();
      if (!isCurrent()) return;
      if (catResponse?.error) {
        setError(catResponse.error);
        return;
      }
      setCategories(catResponse?.categories ?? []);

      const result = await sync();
      if (!isCurrent()) return;
      if (result?.error) {
        setError(result.error);
        return;
      }
      setQueue(result?.queue ?? []);
      setBlocked(result?.blocked ?? []);
      setShowCoffee(false);
    } catch (e) {
      if (isCurrent()) setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      if (isCurrent()) setSyncing(false);
    }
  }, []);

  useEffect(() => {
    getSettings()
      .then((response) => {
        if (response.accessToken && response.planId) {
          setPlan({ id: response.planId, name: response.planName ?? "" });
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
        onComplete={(connected) => {
          setPlan(connected);
          setView("backfill_prompt");
        }}
      />
    );
  }

  if (view === "backfill_prompt") {
    return <BackfillPrompt onContinue={() => setView("queue")} />;
  }

  if (view === "settings" && plan !== null) {
    return (
      <Settings
        plan={plan}
        onPlanChange={(next) => {
          setPlan(next);
          // Everything below was synced from the previous plan — drop it and
          // resync so the queue can't offer old-plan transactions/categories
          // for approval against the new plan. The epoch bump makes any
          // still-running old-plan sync discard its late result.
          syncEpoch.current += 1;
          setQueue([]);
          setBlocked([]);
          setSelectedEntry(null);
          void handleSync();
        }}
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

  // Open/focus a retailer tab so the user can sign in; they tap Sync to resume.
  // `url` (a step-up block's gated page) targets the page that forces the
  // challenge — the orders list alone renders as already signed in.
  const handleOpenRetailer = (retailer: string, url?: string) => {
    void openRetailer(retailer, url);
  };

  // Handlers for the queue view
  const handleApproveAll = async () => {
    const approvableEntries = queue.filter(isFullyClassified);
    const idsToApprove = approvableEntries.map((entry) => entry.ynabTransaction.id);
    if (idsToApprove.length === 0) return;

    setApproving(true);
    setError(null);
    try {
      const result = await approveBatch(idsToApprove);
      if (result?.error) {
        setError(result.error);
        return;
      }
      // Only entries YNAB actually accepted leave the queue; failures stay
      // visible and retryable instead of being silently dropped as "approved".
      const approvedSet = new Set(result.approvedIds ?? []);
      const approvedEntries = approvableEntries.filter((e) => approvedSet.has(e.ynabTransaction.id));
      const itemCount = approvedEntries.reduce(
        (n, entry) =>
          n + (entry.matchStatus.status === "matched" ? entry.matchStatus.classifiedItems.length : 0),
        0,
      );
      if (itemCount > 0) {
        const { showCoffee: show, cumulativeClassified } = await recordClassified(itemCount);
        setCoffeeClassified(cumulativeClassified);
        setShowCoffee(show);
      }
      setQueue((prev) => prev.filter((entry) => !approvedSet.has(entry.ynabTransaction.id)));
      const failedCount = result.errors?.length ?? 0;
      if (failedCount > 0) {
        setError(
          `${failedCount} of ${idsToApprove.length} couldn't be approved — they're still in the queue.`,
        );
      }
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
      blocked={blocked}
      onOpenRetailer={handleOpenRetailer}
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
