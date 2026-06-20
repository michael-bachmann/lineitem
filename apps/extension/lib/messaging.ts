import { browser } from "wxt/browser";
import type {
  ApprovalItem,
  BackfillProgress,
  BackfillResult,
  BlockedRetailer,
  Category,
  MessageRequest,
  QueueEntry,
} from "./types";
import type { Settings } from "./settings";

/**
 * Typed client over the background message bus. Components call these named
 * helpers instead of scattering `browser.runtime.sendMessage({ type })` string
 * literals; presentational views never import this — they take view-state as
 * props. Covers every `MessageRequest` the side panel sends.
 *
 * Responses are typed for the consumer (optional `error` + the success
 * payload); the background `handleMessage` returns the underlying union.
 */

export interface PlanInfo {
  id: string;
  name: string;
}

/** Request-typed send (the response shape is per-message, asserted by callers). */
function send(message: MessageRequest): Promise<unknown> {
  return browser.runtime.sendMessage(message);
}

export async function startOAuth(): Promise<{ error?: string }> {
  return (await send({ type: "START_OAUTH" })) as { error?: string };
}

export async function getPlans(): Promise<{ error?: string; plans: PlanInfo[] }> {
  return (await send({ type: "GET_PLANS" })) as { error?: string; plans: PlanInfo[] };
}

export async function savePlan(planId: string, planName: string): Promise<{ error?: string }> {
  return (await send({ type: "SAVE_PLAN", planId, planName })) as { error?: string };
}

export type StartBackfillResponse = { ok: true; result: BackfillResult } | { error: string };

export async function startBackfill(fromDate: string): Promise<StartBackfillResponse> {
  return (await send({ type: "START_BACKFILL", fromDate })) as StartBackfillResponse;
}

export async function cancelBackfill(): Promise<void> {
  await send({ type: "CANCEL_BACKFILL" });
}

export async function refreshCategories(): Promise<{ error?: string }> {
  return (await send({ type: "REFRESH_CATEGORIES" })) as { error?: string };
}

export async function clearSettings(): Promise<void> {
  await send({ type: "CLEAR_SETTINGS" });
}

export async function getSettings(): Promise<Partial<Settings> & { error?: string }> {
  return (await send({ type: "GET_SETTINGS" })) as Partial<Settings> & { error?: string };
}

export async function getCategories(): Promise<{ categories?: Category[]; error?: string }> {
  return (await send({ type: "GET_CATEGORIES" })) as { categories?: Category[]; error?: string };
}

export async function sync(): Promise<{ queue?: QueueEntry[]; blocked?: BlockedRetailer[]; error?: string }> {
  return (await send({ type: "SYNC" })) as {
    queue?: QueueEntry[];
    blocked?: BlockedRetailer[];
    error?: string;
  };
}

/** Open/focus the retailer's tab so the user can sign in, then they tap Sync. */
export async function openRetailer(retailer: string): Promise<{ error?: string }> {
  return (await send({ type: "OPEN_RETAILER", retailer })) as { error?: string };
}

export async function approveTransaction(
  ynabTransactionId: string,
  items: ApprovalItem[],
): Promise<{ error?: string }> {
  return (await send({ type: "APPROVE_TRANSACTION", ynabTransactionId, items })) as {
    error?: string;
  };
}

export async function approveBatch(ynabTransactionIds: string[]): Promise<{ error?: string }> {
  return (await send({ type: "APPROVE_BATCH", ynabTransactionIds })) as { error?: string };
}

/** Subscribe to backfill progress broadcasts. Returns an unsubscribe fn. */
export function onBackfillProgress(callback: (event: BackfillProgress) => void): () => void {
  const listener = (msg: unknown) => {
    if (
      typeof msg === "object" &&
      msg !== null &&
      (msg as { type?: unknown }).type === "BACKFILL_PROGRESS"
    ) {
      callback((msg as { event: BackfillProgress }).event);
    }
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}
