import { getCategories } from "@/lib/ynab";
import { getSettings, saveSettings } from "@/lib/settings";
import { putCategories } from "@/lib/db";
import { resetActiveSync } from "./sync";

/**
 * Switch the connected plan as one deep operation. The data layer was built
 * assuming planId is set once at onboarding; this seam owns everything that
 * assumption touched:
 *
 * 1. Fetch the new plan's categories FIRST — a network failure persists
 *    nothing, so the old plan stays fully intact (no settings/store split).
 * 2. On an actual change, stop old-plan work: an in-flight sync's queue and a
 *    running backfill's progress stream belong to the old plan. Learned rows
 *    are plan-scoped (see lib/db.ts), so they stay put — the old plan's rows
 *    go dormant and are reused on switch-back.
 * 3. Only then commit the categories store and settings.
 *
 * AllocatedTransactions stay: keyed by YNAB transaction id they're inert
 * across plans, and still valid if the user switches back.
 */
export async function switchPlan(
  planId: string,
  planName: string,
  opts: { abortBackfill?: () => Promise<unknown> | void } = {},
): Promise<void> {
  const { planId: prevPlanId } = await getSettings();
  const categories = await getCategories(planId);

  if (prevPlanId !== null && prevPlanId !== planId) {
    // Abort any running backfill and WAIT for it to settle, so the switch
    // resolves only after old-plan work has fully stopped and a post-switch
    // START_BACKFILL can't collide with the dying run. The rejection
    // (AbortError) is the expected way an aborted run settles; swallow it.
    await Promise.resolve(opts.abortBackfill?.()).catch(() => {});
    resetActiveSync();
  }

  await putCategories(categories);
  await saveSettings({ planId, planName });
}
