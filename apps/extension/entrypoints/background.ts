import { NOT_CONNECTED, YNAB_RECONNECT } from "@/lib/messages";
import { getSettings, clearSettings } from "@/lib/settings";
import { runOAuthFlow } from "@/lib/oauth";
import { getDefaultPlan, getPlans, getCategories, NeedsReauthError, YnabApiError } from "@/lib/ynab";
import { putCategories, getAllCategories } from "@/lib/db";
import { switchPlan } from "@/background/plan";
import { performSync } from "@/background/sync";
import { approveTransaction, approveBatch } from "@/background/approval";
import { ensureModelLoaded } from "@/background/embedder";
import { runBackfill } from "@/background/backfill";
import { getAdapter } from "@/retailers/registry";
import { openRetailerTab, initPageResultListener } from "@/background/tabs";
import { dlog } from "@/lib/debug";
import type { MessageBroadcast, MessageRequest } from "@/lib/types";

/** Single in-flight backfill controller. Held at module scope so a
 *  CANCEL_BACKFILL message arriving while START_BACKFILL is still pending
 *  can abort it. `backfillRun` is the run's promise — switchPlan awaits it
 *  after aborting, because the learn phase doesn't observe the signal and
 *  its writes must land before the learned stores are cleared. */
let backfillController: AbortController | null = null;
let backfillRun: Promise<unknown> | null = null;

/** Serializes the two categories-store writers (SAVE_PLAN, REFRESH_CATEGORIES).
 *  putCategories is clear-then-put, so an in-flight refresh finishing after a
 *  plan switch would otherwise land the OLD plan's categories under the new
 *  planId. Chained so each writer starts only after the previous settles. */
let categoriesWriteChain: Promise<unknown> = Promise.resolve();
function serializeCategoriesWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = categoriesWriteChain.then(fn, fn);
  categoriesWriteChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** User-facing message for a handler failure — maps the known typed errors. */
function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof NeedsReauthError) return YNAB_RECONNECT;
  return e instanceof Error ? e.message : fallback;
}

/** Service worker entry point — routes messages from the side panel to domain handlers. */
export default defineBackground(() => {
  // Fires on every service-worker startup. If you DON'T see this in the SW
  // console, you're running a non-debug build (or the extension wasn't reloaded
  // after `pnpm build:debug`).
  dlog("boot", "debug logging active");

  // Chrome opens the side panel when its toolbar icon is clicked. Firefox has
  // no sidePanel API — its sidebar_action provides a toolbar toggle button
  // natively — so skip this there to avoid a startup TypeError.
  if (chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }

  // Pre-warm the embedder model cache on every SW startup so the first sync
  // doesn't pay a download tax. Fire-and-forget; errors are non-fatal.
  ensureModelLoaded().catch((err) => {
    console.warn("Initial embedder load failed; will retry on first use", err);
  });

  // Wire content-script page-result messages to the coordinator before any
  // scrape, so a result from the very first page load can't be missed.
  initPageResultListener();

  browser.runtime.onMessage.addListener(
    (message: MessageRequest | MessageBroadcast, _sender, sendResponse) => {
      // Broadcasts (our own BACKFILL_PROGRESS, which fans out to every extension
      // page including this one) and content-script PAGE_RESULT pushes (handled
      // by initPageResultListener) don't expect a response.
      if (message.type === "BACKFILL_PROGRESS" || message.type === "PAGE_RESULT") return false;
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

    case "GET_DEFAULT_PLAN": {
      try {
        const plan = await getDefaultPlan();
        return { plan };
      } catch (e) {
        // /plans/default 404s when the consent step wasn't given a default
        // budget — the one failure with a user-actionable fix, so name it.
        if (e instanceof YnabApiError && e.status === 404) {
          return { error: "No default budget selected in YNAB. Reconnect and pick a budget when prompted." };
        }
        return { error: errorMessage(e, "Failed to fetch plan") };
      }
    }

    case "GET_PLANS": {
      try {
        const plans = await getPlans();
        return { plans };
      } catch (e) {
        return { error: errorMessage(e, "Failed to fetch budgets") };
      }
    }

    case "START_OAUTH": {
      try {
        await runOAuthFlow();
        return { ok: true };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "OAuth failed" };
      }
    }

    case "SAVE_PLAN": {
      try {
        await serializeCategoriesWrite(() =>
          switchPlan(message.planId, message.planName, {
            abortBackfill: () => {
              backfillController?.abort();
              return backfillRun ?? undefined;
            },
          }),
        );
        return { ok: true };
      } catch (e) {
        return { error: errorMessage(e, "Failed to save plan") };
      }
    }

    case "REFRESH_CATEGORIES": {
      try {
        // planId is read INSIDE the serialized section so a refresh queued
        // behind a plan switch fetches the plan the switch just committed.
        return await serializeCategoriesWrite(async () => {
          const settings = await getSettings();
          if (!settings.accessToken || !settings.planId) {
            return { error: NOT_CONNECTED };
          }
          const categories = await getCategories(settings.planId);
          await putCategories(categories);
          return { ok: true };
        });
      } catch (e) {
        return { error: errorMessage(e, "Failed to refresh categories") };
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
      const controller = new AbortController();
      backfillController = controller;
      try {
        // Barrier: let any in-flight plan switch commit its settings before
        // this run reads them, so a backfill can't start against the plan
        // being switched away from. A switch that runs during the wait sees
        // our already-registered controller and aborts it — the check below
        // turns that into a clean cancel.
        await serializeCategoriesWrite(async () => {});
        controller.signal.throwIfAborted();

        const run = runBackfill({
          fromDate: message.fromDate,
          retailers: message.retailers,
          signal: controller.signal,
          onProgress: (event) => {
            const broadcast: MessageBroadcast = { type: "BACKFILL_PROGRESS", event };
            // Side panel may be closed; sendMessage rejects with no
            // receiver — swallow it.
            browser.runtime.sendMessage(broadcast).catch(() => {});
          },
        });
        backfillRun = run;
        const result = await run;
        return { ok: true, result };
      } catch (e) {
        // A user cancel or a plan switch aborting the run is an expected
        // outcome, not a failure — report it so the card resets quietly
        // instead of alarming with the DOMException's raw message.
        if (e instanceof DOMException && e.name === "AbortError") {
          return { canceled: true };
        }
        const reason = e instanceof Error ? e.message : "Backfill failed";
        return { error: reason };
      } finally {
        backfillController = null;
        backfillRun = null;
      }
    }

    case "CANCEL_BACKFILL": {
      backfillController?.abort();
      return { ok: true };
    }

    case "OPEN_RETAILER": {
      try {
        // A step-up block passes the gated page that forces the challenge; fall
        // back to the retailer's normal start URL (signed-out, which redirects
        // to login on its own).
        const destination = message.url ?? getAdapter(message.retailer).startUrl;
        const result = await openRetailerTab(destination);
        // Foreground the tab so the user can sign in. Resume is manual (they tap
        // Sync afterward) — once signed in, the profile-level cookies make any
        // later scrape authed regardless of which tab it uses.
        if (result) await browser.tabs.update(result.tabId, { active: true });
        return { ok: true };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Failed to open retailer" };
      }
    }

    default:
      return { error: `Unknown message type: ${(message as { type: string }).type}` };
  }
}
