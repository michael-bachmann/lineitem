import { getSettings, saveSettings, clearSettings } from "@/core/settings";
import { getPlans, getCategories } from "@/core/ynab";
import { putCategories } from "@/core/db";
import type { MessageRequest } from "@/core/types";

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (message: MessageRequest, _sender, sendResponse) => {
      handleMessage(message).then(sendResponse);
      return true;
    },
  );
});

async function handleMessage(message: MessageRequest): Promise<unknown> {
  switch (message.type) {
    case "GET_SETTINGS": {
      return getSettings();
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

    case "CLEAR_SETTINGS": {
      try {
        await clearSettings();
        return { ok: true };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Failed to clear settings" };
      }
    }

    default:
      return { error: `Unknown message type: ${(message as { type: string }).type}` };
  }
}
