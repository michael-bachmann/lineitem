import type { YnabTransaction, Category } from "./types";

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

async function ynabFetch(path: string, token: string, options?: RequestInit) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`YNAB API ${response.status}: ${body}`);
  }
  return response.json();
}

export interface YnabPlan {
  id: string;
  name: string;
}

export async function getPlans(token: string): Promise<YnabPlan[]> {
  const data = await ynabFetch("/plans", token);
  return data.data.plans.map((p: { id: string; name: string }) => ({
    id: p.id,
    name: p.name,
  }));
}

export async function getCategories(
  token: string,
  planId: string,
): Promise<Category[]> {
  const data = await ynabFetch(`/plans/${planId}/categories`, token);
  const groups: YnabCategoryGroup[] = data.data.category_groups;

  return groups
    .filter((group: YnabCategoryGroup) => isVisible(group) && group.name !== INTERNAL_CATEGORY_GROUP)
    .flatMap((group: YnabCategoryGroup) =>
      group.categories.filter(isVisible).map((category: YnabCategory) => ({
        id: category.id,
        name: category.name,
        groupName: group.name,
      })),
    );
}

export async function getUnapprovedTransactions(
  token: string,
  planId: string,
): Promise<YnabTransaction[]> {
  const data = await ynabFetch(
    `/plans/${planId}/transactions?type=unapproved`,
    token,
  );
  return data.data.transactions;
}

/**
 * Fetch all transactions on or after `sinceDate` (ISO YYYY-MM-DD). Used by
 * the past-order backfill flow; returns approved and unapproved alike.
 */
export async function getTransactionsSince(
  token: string,
  planId: string,
  sinceDate: string,
): Promise<YnabTransaction[]> {
  const data = await ynabFetch(
    `/plans/${planId}/transactions?since_date=${sinceDate}`,
    token,
  );
  return data.data.transactions;
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

export async function updateTransaction(
  token: string,
  planId: string,
  transactionId: string,
  update: YnabTransactionUpdate,
): Promise<void> {
  await ynabFetch(
    `/plans/${planId}/transactions/${transactionId}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({ transaction: update }),
    },
  );
}
