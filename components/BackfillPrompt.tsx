import { useCallback, useState } from "react";
import BackfillCard from "./BackfillCard";
import { Button } from "./Button";
import type { BackfillUiState } from "./BackfillCardView";

interface BackfillPromptProps {
  onContinue: () => void;
}

export default function BackfillPrompt({ onContinue }: BackfillPromptProps) {
  const [running, setRunning] = useState(false);

  // Disable Continue while a backfill is in flight so the user can't navigate
  // away from the only surface that shows progress.
  const handleStateChange = useCallback(
    (state: BackfillUiState) => setRunning(state.kind === "running"),
    [],
  );

  return (
    <div className="flex min-h-screen flex-col gap-3 bg-bg p-4 pt-5 text-text">
      <h1 className="m-0 text-[22px] font-bold tracking-[-0.018em] text-text">You’re connected!</h1>
      <p className="m-0 text-[14px] leading-[1.55] text-muted">
        Learn from your past orders so category suggestions are smarter from day one — or skip and
        run this later from Settings.
      </p>

      <BackfillCard onStateChange={handleStateChange} />

      <Button variant="primary" disabled={running} onClick={onContinue}>
        {running ? "Backfill running…" : "Continue"}
      </Button>
    </div>
  );
}
