import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import Onboarding from "@/components/Onboarding";
import Settings from "@/components/Settings";

type View = "loading" | "onboarding" | "queue" | "settings";

export default function App() {
  const [view, setView] = useState<View>("loading");
  const [planName, setPlanName] = useState("");

  useEffect(() => {
    browser.runtime
      .sendMessage({ type: "GET_SETTINGS" })
      .then((response) => {
        if (response.ynabToken && response.planId) {
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
        onComplete={() => {
          browser.runtime
            .sendMessage({ type: "GET_SETTINGS" })
            .then((response) => {
              setPlanName(response.planName ?? "");
              setView("queue");
            });
        }}
      />
    );
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

  // Queue view (placeholder)
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Itemize</h1>
        <button
          onClick={() => setView("settings")}
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
      </div>
      <p className="text-sm text-gray-400 mt-4">
        No transactions to review.
      </p>
    </div>
  );
}
