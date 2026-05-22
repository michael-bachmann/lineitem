import type { YnabTransaction, Category } from "./types";

const BASE_URL = "https://api.ynab.com/v1";

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

export interface YnabBudget {
  id: string;
  name: string;
}

export async function getBudgets(token: string): Promise<YnabBudget[]> {
  const data = await ynabFetch("/budgets", token);
  return data.data.budgets.map((b: { id: string; name: string }) => ({
    id: b.id,
    name: b.name,
  }));
}

export async function getCategories(
  token: string,
  budgetId: string,
): Promise<Category[]> {
  const data = await ynabFetch(`/budgets/${budgetId}/categories`, token);
  return data.data.category_groups
    .filter(
      (g: { hidden: boolean; deleted: boolean; name: string }) =>
        !g.hidden && !g.deleted && g.name !== "Internal Master Category",
    )
    .flatMap((g: { name: string; categories: Array<{ id: string; name: string; hidden: boolean; deleted: boolean }> }) =>
      g.categories
        .filter((c) => !c.hidden && !c.deleted)
        .map((c) => ({ id: c.id, name: c.name, groupName: g.name })),
    );
}

export async function getUnapprovedTransactions(
  token: string,
  budgetId: string,
): Promise<YnabTransaction[]> {
  const data = await ynabFetch(
    `/budgets/${budgetId}/transactions?type=unapproved`,
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
  budgetId: string,
  transactionId: string,
  update: YnabTransactionUpdate,
): Promise<void> {
  await ynabFetch(
    `/budgets/${budgetId}/transactions/${transactionId}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({ transaction: update }),
    },
  );
}
