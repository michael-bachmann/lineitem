import { browser } from "wxt/browser";
import type { BackfillProgress, BackfillResult, MessageRequest } from "./types";

/**
 * Typed client over the background message bus. Container components call these
 * named helpers instead of scattering `browser.runtime.sendMessage({ type })`
 * string literals; presentational views never import this — they take
 * view-state as props.
 *
 * Onboarding + backfill messages live here today; the remaining requests
 * (sync/approve/settings/categories) move over as their screens are converted.
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
