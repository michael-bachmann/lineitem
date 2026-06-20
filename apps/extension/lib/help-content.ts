// Help & About copy. Links are the shared canonical set from @lineitem/ui;
// the in-app FAQ below intentionally differs from the marketing-site FAQ.
export { LINKS } from "@lineitem/ui/links";

export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ: FaqItem[] = [
  {
    q: "How does lineitem match orders?",
    a: "When you sync, lineitem looks at recent YNAB transactions from Amazon and finds the order with the closest amount and date. You confirm each match before anything is written back.",
  },
  {
    q: "Will it change my budget without asking?",
    a: "No. Nothing is written to YNAB until you press Approve. Splits are only created for transactions you’ve reviewed.",
  },
  {
    q: "What does “Backfill” do?",
    a: "It walks your last 12 months of already-categorized YNAB transactions and learns the categories you tend to assign — so future suggestions get smarter from day one.",
  },
  {
    q: "Why does an item say “Login required”?",
    a: "lineitem reads order details from your logged-in Amazon session. If you’ve been signed out, open Amazon in a tab, sign in, and sync again.",
  },
  {
    q: "Is my data sent anywhere?",
    a: "Order details are matched locally in your browser. lineitem only talks to YNAB to read categories and write the splits you approve.",
  },
];
