import type { YnabTransaction, Category } from "./types";
import { getValidAccessToken, NeedsReauthError } from "./oauth";
import { saveSettings } from "./settings";

const BASE_URL = "https://api.ynab.com/v1";
const INTERNAL_CATEGORY_GROUP = "Internal Master Category";

interface YnabCategoryGroup {
  name: string;
  hidden: boolean;
  deleted: boolean;
  categories: YnabCategory[];
}

interface YnabCategory {
  id: string;
  name: string;
  hidden: boolean;
  deleted: boolean;
}

function isVisible(item: { hidden: boolean; deleted: boolean }): boolean {
  return !item.hidden && !item.deleted;
}

/** Shape YNAB wraps every response in. Each endpoint's `data` differs, so
 *  callers specialize via the generic. */
type YnabApiResponse<T> = { data: T };

/** Thrown for non-2xx YNAB responses. Carries the HTTP status so handlers can
 *  map specific failures (e.g. 404 from /plans/default) to friendly copy. */
export class YnabApiError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`YNAB API ${status}: ${body}`);
  }
}

async function ynabFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  // First attempt with the (possibly cached) access token.
  let token = await getValidAccessToken();
  let response = await sendRequest(path, token, options);

  // YNAB-side expiry can race our cached expiresAt — one forced refresh + retry.
  if (response.status === 401) {
    // Force refresh by clearing the cached expiry, then re-fetching the token.
    // `getValidAccessToken` will hit /oauth/refresh because expiresAt < now.
    await saveSettings({ accessTokenExpiresAt: 0 });
    token = await getValidAccessToken();
    response = await sendRequest(path, token, options);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new YnabApiError(response.status, body);
  }
  return response.json() as Promise<T>;
}

async function sendRequest(path: string, token: string, options?: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
}

export interface YnabPlan {
  id: string;
  name: string;
}

/**
 * Resolve the single budget the user chose on YNAB's consent screen.
 *
 * Relies on the OAuth app having "default plan selection" enabled: YNAB then
 * prompts the user to pick a default plan at authorization and accepts the
 * literal `default` in place of a plan id. We must NOT list `/plans` and pick
 * one ourselves — that endpoint returns *every* budget the token can see, in an
 * order unrelated to the user's choice, so taking `[0]` silently connects the
 * wrong budget for anyone with more than one. We resolve `default` to its
 * concrete id/name and store that, pinning to the chosen budget.
 */
export async function getDefaultPlan(): Promise<YnabPlan> {
  const { data } = await ynabFetch<YnabApiResponse<{ plan: YnabPlan }>>("/plans/default");
  return { id: data.plan.id, name: data.plan.name };
}

/**
 * Every budget the OAuth token can access. Used only by the Settings budget
 * switcher, where the user *explicitly* picks one — unlike onboarding, which
 * must never enumerate and auto-pick (that was the wrong-budget bug). The token
 * spans all budgets even with default plan selection enabled, so this lets a
 * user correct or change their connected budget in place.
 */
export async function getPlans(): Promise<YnabPlan[]> {
  const { data } = await ynabFetch<YnabApiResponse<{ plans: YnabPlan[] }>>("/plans");
  return data.plans.map((p) => ({ id: p.id, name: p.name }));
}

export async function getCategories(planId: string): Promise<Category[]> {
  const { data } = await ynabFetch<YnabApiResponse<{ category_groups: YnabCategoryGroup[] }>>(
    `/plans/${planId}/categories`,
  );
  return data.category_groups
    .filter((g) => isVisible(g) && g.name !== INTERNAL_CATEGORY_GROUP)
    .flatMap((g) => g.categories.filter(isVisible).map((c) => ({ id: c.id, name: c.name, groupName: g.name })));
}

export async function getUnapprovedTransactions(planId: string): Promise<YnabTransaction[]> {
  const { data } = await ynabFetch<YnabApiResponse<{ transactions: YnabTransaction[] }>>(
    `/plans/${planId}/transactions?type=unapproved`,
  );
  return data.transactions;
}

/**
 * Fetch all transactions on or after `sinceDate` (ISO YYYY-MM-DD). Used by
 * the past-order backfill flow; returns approved and unapproved alike.
 */
export async function getTransactionsSince(planId: string, sinceDate: string): Promise<YnabTransaction[]> {
  const { data } = await ynabFetch<YnabApiResponse<{ transactions: YnabTransaction[] }>>(
    `/plans/${planId}/transactions?since_date=${sinceDate}`,
  );
  return data.transactions;
}

export interface YnabTransactionUpdate {
  category_id?: string | null;
  approved?: boolean;
  memo?: string | null;
  subtransactions?: Array<{
    amount: number;
    category_id: string | null;
    memo: string | null;
  }>;
}

export async function updateTransaction(planId: string, transactionId: string, update: YnabTransactionUpdate): Promise<void> {
  await ynabFetch(`/plans/${planId}/transactions/${transactionId}`, {
    method: "PUT",
    body: JSON.stringify({ transaction: update }),
  });
}

// Re-export NeedsReauthError so handlers in background.ts can catch it.
export { NeedsReauthError } from "./oauth";
