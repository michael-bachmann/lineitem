import { getSettings, clearSettings } from "@/lib/settings";
import { getPlans, getCategories } from "@/lib/ynab";
import { putCategories, getAllCategories } from "@/lib/db";
import { performSync } from "@/background/sync";
import { approveTransaction, approveBatch } from "@/background/approval";
import { ensureModelLoaded } from "@/background/embedder";
import { runBackfill } from "@/background/backfill";
import type { MessageBroadcast, MessageRequest } from "@/lib/types";

/** Single in-flight backfill controller. Held at module scope so a
 *  CANCEL_BACKFILL message arriving while START_BACKFILL is still pending
 *  can abort it. */
let backfillController: AbortController | null = null;

/** Service worker entry point — routes messages from the side panel to domain handlers. */
export default defineBackground(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  // Pre-warm the embedder model cache on every SW startup so the first sync
  // doesn't pay a download tax. Fire-and-forget; errors are non-fatal.
  ensureModelLoaded().catch((err) => {
    console.warn("Initial embedder load failed; will retry on first use", err);
  });

  browser.runtime.onMessage.addListener(
    (message: MessageRequest | MessageBroadcast, _sender, sendResponse) => {
      // Broadcasts (e.g. our own BACKFILL_PROGRESS, which fan out to every
      // extension page including this one) don't expect a response.
      if (message.type === "BACKFILL_PROGRESS") return false;
      handleMessage(message).then(sendResponse);
      // Return true to keep the message channel open for the async response
      return true;
    },
  );
});

async function handleMessage(message: MessageRequest): Promise<unknown> {
  switch (message.type) {
    case "GET_SETTINGS": {
      try {
        return await getSettings();
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Failed to load settings" };
      }
    }

    case "GET_PLANS": {
      try {
        const plans = await getPlans(message.token);
        return { plans };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Failed to fetch plans" };
      }
    }

    case "SAVE_SETTINGS":
      return { error: "Use START_OAUTH to connect — PAT setup is no longer supported" };

    case "REFRESH_CATEGORIES": {
      try {
        const settings = await getSettings();
        if (!settings.accessToken || !settings.planId) {
          return { error: "Not connected to YNAB" };
        }
        const categories = await getCategories(settings.accessToken, settings.planId);
        await putCategories(categories);
        return { ok: true };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Failed to refresh categories" };
      }
    }

    case "GET_CATEGORIES": {
      try {
        const categories = await getAllCategories();
        return { categories };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Failed to load categories" };
      }
    }

    case "CLEAR_SETTINGS": {
      try {
        await clearSettings();
        return { ok: true };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Failed to clear settings" };
      }
    }

    case "SYNC":
      return performSync();

    case "APPROVE_TRANSACTION":
      return approveTransaction(message.ynabTransactionId, message.items);

    case "APPROVE_BATCH":
      return approveBatch(message.ynabTransactionIds);

    case "START_BACKFILL": {
      if (backfillController) return { error: "Backfill already running" };
      backfillController = new AbortController();
      try {
        const result = await runBackfill({
          fromDate: message.fromDate,
          signal: backfillController.signal,
          onProgress: (event) => {
            const broadcast: MessageBroadcast = { type: "BACKFILL_PROGRESS", event };
            // Side panel may be closed; sendMessage rejects with no
            // receiver — swallow it.
            browser.runtime.sendMessage(broadcast).catch(() => {});
          },
        });
        return { ok: true, result };
      } catch (e) {
        const reason = e instanceof Error ? e.message : "Backfill failed";
        return { error: reason };
      } finally {
        backfillController = null;
      }
    }

    case "CANCEL_BACKFILL": {
      backfillController?.abort();
      return { ok: true };
    }

    default:
      return { error: `Unknown message type: ${(message as { type: string }).type}` };
  }
}
