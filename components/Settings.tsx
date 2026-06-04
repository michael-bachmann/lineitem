import { useState } from "react";
import { clearSettings, refreshCategories } from "@/lib/messaging";
import BackfillCard from "./BackfillCard";
import { SettingsView, type SettingsState } from "./SettingsView";

interface SettingsProps {
  planName: string;
  onDisconnect: () => void;
  onBack: () => void;
  onOpenHelp: () => void;
}

/** Container: owns the refresh/disconnect IO + state; renders SettingsView with
 *  the BackfillCard container injected. */
export default function Settings({ planName, onDisconnect, onBack, onOpenHelp }: SettingsProps) {
  const [state, setState] = useState<SettingsState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleRefresh() {
    setState("refreshing");
    try {
      const res = await refreshCategories();
      if (res?.error) {
        setErrorMsg(res.error);
        setState("error");
      } else {
        setState("success");
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to refresh categories");
      setState("error");
    }
  }

  async function handleDisconnect() {
    setState("disconnecting");
    try {
      await clearSettings();
      onDisconnect();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to disconnect");
      setState("error");
    }
  }

  return (
    <SettingsView
      state={state}
      errorMsg={errorMsg}
      planName={planName}
      backfill={<BackfillCard />}
      onRefresh={handleRefresh}
      onDisconnect={handleDisconnect}
      onOpenHelp={onOpenHelp}
      onBack={onBack}
    />
  );
}
