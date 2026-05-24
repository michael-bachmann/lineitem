import type { QueueEntry, Category } from "@/lib/types";
import { isFullyClassified } from "@/lib/queue";
import TransactionCard from "@/components/TransactionCard";

interface QueueViewProps {
  queue: QueueEntry[];
  categories: Category[];
  syncing: boolean;
  approving: boolean;
  error: string | null;
  onSync: () => void;
  onApproveAll: () => void;
  onSelectEntry: (entry: QueueEntry) => void;
  onSettings: () => void;
}

export default function QueueView({
  queue,
  categories,
  syncing,
  approving,
  error,
  onSync,
  onApproveAll,
  onSelectEntry,
  onSettings,
}: QueueViewProps) {
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const fullyClassifiedCount = queue.filter(isFullyClassified).length;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Itemize</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={onSettings}
            className="text-gray-400 hover:text-gray-200"
            aria-label="Settings"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-5 h-5"
            >
              <path
                fillRule="evenodd"
                d="M8.34 1.804A1 1 0 019.32 1h1.36a1 1 0 01.98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 011.262.125l.962.962a1 1 0 01.125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.295a1 1 0 01.804.98v1.361a1 1 0 01-.804.98l-1.473.295a6.95 6.95 0 01-.587 1.416l.834 1.25a1 1 0 01-.125 1.262l-.962.962a1 1 0 01-1.262.125l-1.25-.834a6.953 6.953 0 01-1.416.587l-.295 1.473a1 1 0 01-.98.804H9.32a1 1 0 01-.98-.804l-.295-1.473a6.957 6.957 0 01-1.416-.587l-1.25.834a1 1 0 01-1.262-.125l-.962-.962a1 1 0 01-.125-1.262l.834-1.25a6.957 6.957 0 01-.587-1.416l-1.473-.295A1 1 0 011 11.18V9.82a1 1 0 01.804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 01.125-1.262l.962-.962A1 1 0 015.38 3.53l1.25.834a6.957 6.957 0 011.416-.587l.295-1.473zM13 10a3 3 0 11-6 0 3 3 0 016 0z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <button
            onClick={onSync}
            disabled={syncing}
            className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncing ? "Syncing..." : "Sync"}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <p className="text-sm text-red-400 bg-red-900/30 border border-red-800 rounded px-3 py-2 mt-3">
          {error}
        </p>
      )}

      {/* Summary bar — only when queue has entries */}
      {queue.length > 0 && (
        <p className="text-sm text-gray-400 mt-3">
          {queue.length} transaction{queue.length !== 1 ? "s" : ""} &middot;{" "}
          {fullyClassifiedCount} fully classified
        </p>
      )}

      {/* Transaction card list */}
      {queue.length > 0 && (
        <div className="flex flex-col gap-2 mt-3">
          {queue.map((entry) => (
            <TransactionCard
              key={entry.ynabTransaction.id}
              entry={entry}
              categoryNames={categoryNames}
              onClick={() => onSelectEntry(entry)}
            />
          ))}
        </div>
      )}

      {/* Approve All button — only when there are fully classified entries */}
      {fullyClassifiedCount > 0 && (
        <button
          onClick={onApproveAll}
          disabled={approving}
          className="w-full mt-4 px-3 py-2 text-sm font-medium rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {approving ? "Approving..." : `Approve All Classified (${fullyClassifiedCount})`}
        </button>
      )}

      {/* Empty state */}
      {queue.length === 0 && !syncing && (
        <p className="text-sm text-gray-400 mt-4">
          No transactions to review. Click Sync to check.
        </p>
      )}
    </div>
  );
}
