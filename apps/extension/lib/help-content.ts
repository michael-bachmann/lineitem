// Help & About copy + links.
// TODO: these URLs are design-handoff placeholders — swap in the real ones
// before shipping the Help screen.
export const LINKS = {
  coffee: "https://ko-fi.com/mbachmann",
  retailer: "https://lineitem.app/request-retailer",
  suggest: "https://lineitem.app/suggest",
  issue: "https://github.com/bachmann/lineitem/issues/new",
  website: "https://lineitem.app",
  readme: "https://github.com/bachmann/lineitem#readme",
};

export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ: FaqItem[] = [
  {
    q: "How does LineItem match orders?",
    a: "When you sync, LineItem looks at recent YNAB transactions from Amazon and finds the order with the closest amount and date. You confirm each match before anything is written back.",
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
    a: "LineItem reads order details from your logged-in Amazon session. If you’ve been signed out, open Amazon in a tab, sign in, and sync again.",
  },
  {
    q: "Is my data sent anywhere?",
    a: "Order details are matched locally in your browser. LineItem only talks to YNAB to read categories and write the splits you approve.",
  },
];
