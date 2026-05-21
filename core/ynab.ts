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
  const categories: Category[] = [];
  for (const group of data.data.category_groups) {
    if (group.hidden || group.name === "Internal Master Category") continue;
    for (const cat of group.categories) {
      if (cat.hidden || cat.deleted) continue;
      categories.push({
        id: cat.id,
        name: cat.name,
        groupName: group.name,
      });
    }
  }
  return categories;
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
  memo?: string;
  subtransactions?: Array<{
    amount: number;
    category_id: string;
    memo: string;
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
