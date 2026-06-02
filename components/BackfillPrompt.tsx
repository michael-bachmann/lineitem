import { useCallback, useState } from "react";
import BackfillCard from "./BackfillCard";

interface BackfillPromptProps {
  onContinue: () => void;
}

export default function BackfillPrompt({ onContinue }: BackfillPromptProps) {
  const [backfillRunning, setBackfillRunning] = useState(false);

  // Disable Continue while a backfill is in flight so the user can't
  // accidentally navigate away from the only surface that shows progress.
  const handleStateChange = useCallback(
    (state: { kind: string }) => setBackfillRunning(state.kind === "running"),
    [],
  );

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4">
      <h1 className="text-lg font-semibold">You're connected!</h1>
      <p className="text-sm text-gray-400 mt-2">
        Learn from your past orders so category suggestions are smarter from day one — or skip
        and run this later from Settings.
      </p>

      <div className="mt-6">
        <BackfillCard onStateChange={handleStateChange} />
      </div>

      <button
        onClick={onContinue}
        disabled={backfillRunning}
        className="w-full mt-4 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Continue
      </button>
    </div>
  );
}
