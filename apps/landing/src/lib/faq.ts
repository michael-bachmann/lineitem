// Marketing FAQ copy (from the design reference). This is the public-site FAQ;
// the extension ships its own in-app FAQ, which legitimately differs.
export interface FaqEntry {
  q: string;
  a: string;
}

export const FAQ: FaqEntry[] = [
  {
    q: "How does lineitem match orders?",
    a: "When you sync, lineitem looks at recent transactions from supported retailers in YNAB and finds the order with the closest amount and date. You confirm each match before anything is written back.",
  },
  {
    q: "Will it change my budget without asking?",
    a: "No. Nothing is written to YNAB until you press Approve. Splits are only created for transactions you've reviewed.",
  },
  {
    q: 'What does "Backfill" do?',
    a: "It walks your last 12 months of already-categorized YNAB transactions and learns the categories you tend to assign — so suggestions get smarter from day one.",
  },
  {
    q: "Is my data sent anywhere?",
    a: "Order details are matched locally in your browser. lineitem only talks to YNAB to read your categories and write the splits you approve.",
  },
  {
    q: "How much does it cost?",
    a: "lineitem is free and open source. If it saves you time, you can buy the maintainer a coffee — but every feature is free, always.",
  },
];
