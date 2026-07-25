import { getCategories } from "@/lib/ynab";
import { getSettings, saveSettings } from "@/lib/settings";
import { clearLearnedData, putCategories } from "@/lib/db";
import { resetActiveSync } from "./sync";

/**
 * Switch the connected plan as one deep operation. The data layer was built
 * assuming planId is set once at onboarding; this seam owns everything that
 * assumption touched:
 *
 * 1. Fetch the new plan's categories FIRST — a network failure persists
 *    nothing, so the old plan stays fully intact (no settings/store split).
 * 2. On an actual change, stop old-plan work (a running backfill would keep
 *    learning the old plan's category ids; an in-flight sync's queue belongs
 *    to the old plan) and clear the learning stores — learned rows are keyed
 *    by product (plan-agnostic), so old-plan category ids would otherwise be
 *    suggested, and rejected by YNAB, on the new plan.
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
    // Abort any running backfill and WAIT for it to settle — its learn phase
    // doesn't observe the signal, so clearing before it finishes would let
    // old-plan rows land after the clear. The rejection (AbortError) is the
    // expected way an aborted run settles; swallow it.
    await Promise.resolve(opts.abortBackfill?.()).catch(() => {});
    resetActiveSync();
    await clearLearnedData();
  }

  await putCategories(categories);
  await saveSettings({ planId, planName });
}
