import { getSettings, saveSettings, clearSettings } from "@/lib/settings";
import { getPlans, getCategories } from "@/lib/ynab";
import { putCategories, getAllCategories } from "@/lib/db";
import { performSync } from "@/background/sync";
import { approveTransaction, approveBatch } from "@/background/approval";
import { ensureModelLoaded } from "@/background/embedder";
import type { MessageRequest } from "@/lib/types";

/** Service worker entry point — routes messages from the side panel to domain handlers. */
export default defineBackground(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  // Pre-warm the embedder model cache on every SW startup so the first sync
  // doesn't pay a download tax. Fire-and-forget; errors are non-fatal.
  ensureModelLoaded().catch((err) => {
    console.warn("Initial embedder load failed; will retry on first use", err);
  });

  // Migration runs lazily — only when sync or approve actually needs vectors
  // (each one awaits ensureMigrated() before reading or writing embeddings).
  // Kicking it off on every SW boot would be wasted work in the steady state
  // (the common case is "no version change since last run").

  browser.runtime.onMessage.addListener(
    (message: MessageRequest, _sender, sendResponse) => {
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

    case "SAVE_SETTINGS": {
      try {
        await saveSettings({
          ynabToken: message.token,
          planId: message.planId,
          planName: message.planName,
        });
        const categories = await getCategories(message.token, message.planId);
        await putCategories(categories);
        return { ok: true };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Failed to save settings" };
      }
    }

    case "REFRESH_CATEGORIES": {
      try {
        const settings = await getSettings();
        if (!settings.ynabToken || !settings.planId) {
          return { error: "Not connected to YNAB" };
        }
        const categories = await getCategories(settings.ynabToken, settings.planId);
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

    default:
      return { error: `Unknown message type: ${(message as { type: string }).type}` };
  }
}
