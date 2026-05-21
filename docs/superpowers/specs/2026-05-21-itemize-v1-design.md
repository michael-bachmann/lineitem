# Itemize v1 — Design Spec

Chrome extension that matches YNAB transactions to Amazon orders, classifies line items into YNAB categories, and writes splits (or simple categorizations) back to YNAB. Built with wxt + React + TypeScript. Amazon only for v1; designed so additional retailers can be added as content script modules.

## Core Value Proposition

YNAB shows Amazon charges as "AMAZON.COM $87.43" with no detail. Itemize answers "what did I buy?" by matching the charge to the Amazon order, showing the line items, suggesting categories, and writing the result back to YNAB — as a split transaction when items span multiple categories, or a simple category assignment when they don't.

## Stack

- **wxt** — MV3 extension build framework, handles manifest generation, cross-browser builds (Chrome + Firefox), file-based entrypoints
- **React + TypeScript** — side panel UI
- **Tailwind CSS** — styling
- **IndexedDB** — structured data (orders, items, product cache, categories)
- **chrome.storage.local** — settings only (PAT, budget ID)

## UI Surface

Side panel. Both Chrome (`chrome.sidePanel`) and Firefox (`browser.sidebarAction`) support this natively; wxt abstracts the difference. The side panel stays open alongside whatever tab the user is on — no tab switching.

## End-to-End Flow

1. User opens the side panel and clicks **Sync**.
2. Service worker fetches **unapproved** transactions from the YNAB API.
3. Service worker filters transactions by payee against the **payee → retailer mapping**. Only transactions matching a retailer with `strategy: 'scrape'` enter the queue. Others are filtered out.
4. Side panel shows the transaction queue immediately. Amazon scraping begins in the background.
5. Service worker checks IndexedDB for cached orders matching each transaction (exact amount + date ±3 days). Transactions with cached matches resolve immediately.
6. For unmatched transactions, the service worker finds or opens an Amazon tab (background, `active: false`). Messages the content script to scrape.
7. Content script checks auth state. If on a login page, returns `{ error: 'not_logged_in' }` — service worker brings the tab to foreground, side panel shows "Log into Amazon, then try again."
8. Content script scrapes the Amazon transactions page, paginating until it hits a previously cached order or a max of ~5 pages. Caches all scraped charges and their order IDs in IndexedDB.
9. For each matched charge, content script fetches the order detail page (if not already cached) to get line items. Caches the order + items in IndexedDB.
10. Service worker closes the Amazon tab only if it opened it.
11. Service worker matches scraped charges to YNAB transactions by exact amount + date proximity.
12. Service worker runs the classifier on each item: product cache → keyword rules → uncategorized.
13. Side panel updates the queue as results come in. Transactions go from "loading" to "ready."
14. User reviews: each transaction shows its line items with product thumbnails, titles, prices (with quantity), and category dropdowns pre-filled by the classifier. Uncategorized items are flagged visually (yellow border + warning icon) with an empty dropdown.
15. All dropdowns show the full category list regardless of classifier suggestion — user can always override.
16. User can approve individual transactions (all items must have a category) or batch-approve all fully-classified transactions via "Approve All Classified."
17. On approve, the service worker writes to YNAB:
    - **All items same category** → simple `PUT` with `category_id` and `approved: true`
    - **Multiple categories** → split `PUT` with `subtransactions` array and `approved: true`
18. Tax/shipping (charge total minus item total) is distributed proportionally across items. Each item's subtransaction amount includes its proportional share.
19. Queue refreshes; approved transactions disappear.

## Component Architecture

```
Side Panel (React)
  - Transaction queue view (list with status indicators)
  - Transaction detail view (items, categories, split preview)
  - Settings / onboarding
  - Communicates with service worker via chrome.runtime.sendMessage

Service Worker (background.ts)
  - YNAB API client (fetch transactions, write splits/categories, get categories/budgets)
  - Scraper orchestrator (find/open retailer tab, message content script, close tab)
  - Classifier (product cache → keyword rules → uncategorized)
  - Retailer registry (payee pattern → retailer module + strategy)
  - Message router between side panel and content scripts
  - Transaction ↔ order matcher

Content Script (amazon.content.ts, runs on *.amazon.com)
  - Auth state detection (login page check)
  - Scrape transactions page (charges with order IDs)
  - Scrape order detail pages (items with titles, prices, quantities, ASINs, images)
  - Parse HTML with native DOMParser
  - Return structured data to service worker
```

## Data Model (IndexedDB)

### `charges`

| Field | Type | Notes |
|---|---|---|
| id | string | `{retailer}:{chargeDate}-{amountCents}-{orderId}` |
| retailer | string | `amazon` |
| chargeDate | string | ISO date |
| amountCents | number | Cents (positive) |
| orderId | string \| null | Retailer's order ID linked to this charge |
| cardLastFour | string \| null | |
| isRefund | boolean | |
| scrapedAt | string | ISO datetime |

### `orders`

| Field | Type | Notes |
|---|---|---|
| id | string | `{retailer}:{orderId}` e.g. `amazon:112-456-789` |
| retailer | string | `amazon` |
| orderId | string | Retailer's native order ID |
| orderDate | string | ISO date |
| total | number | Cents |
| items | LineItem[] | Nested array |
| scrapedAt | string | ISO datetime |

### `LineItem` (nested in order)

| Field | Type | Notes |
|---|---|---|
| productId | string | ASIN, DPCI, etc. |
| title | string | |
| imageUrl | string | Product thumbnail URL |
| price | number | Cents, per unit |
| quantity | number | |

### `productCache`

| Field | Type | Notes |
|---|---|---|
| id | string | `{retailer}:{productId}` e.g. `amazon:B0XXXXXXXX` |
| categoryId | string | YNAB category UUID |
| confirmedByUser | boolean | |
| timesSeen | number | |
| lastSeen | string | ISO datetime |

### `categories`

| Field | Type | Notes |
|---|---|---|
| id | string | YNAB category UUID |
| name | string | Display name |
| groupName | string | YNAB category group |

### `chrome.storage.local` (settings only)

| Key | Value |
|---|---|
| ynabToken | YNAB Personal Access Token |
| budgetId | Selected YNAB budget UUID |
| budgetName | Display name for selected budget |

### Money

Integer cents everywhere internally. Conversion to YNAB milliunits (`cents × -10` for outflows) happens only at the API boundary.

## Payee → Retailer Mapping

Each YNAB transaction's `payee_name` is matched against hardcoded patterns in the retailer registry to determine which retailer module handles it.

```ts
// Hardcoded in registry.ts
const payeeMappings = [
  { pattern: /amazon\.com|amzn mktp/i, retailer: 'amazon', strategy: 'scrape' },
  { pattern: /amazon prime/i,          retailer: 'amazon', strategy: 'skip' },
  { pattern: /amazon tips/i,           retailer: 'amazon', strategy: 'skip' },
];
```

Transactions matching `scrape` go through the full flow. Transactions matching `skip` are filtered out. Transactions matching no pattern are filtered out. User-editable payee mappings can be added as a future enhancement when needed.

## Retailer Module Interface

For v1 only Amazon is implemented. The structure supports adding retailers as new content scripts without modifying existing code.

```ts
interface RetailerModule {
  id: string;                       // 'amazon'
  payeePatterns: RegExp[];          // [/amazon\.com/i, /amzn mktp/i]
  contentScriptMatches: string[];   // ['*://*.amazon.com/*']
  scrapeOrders(message): Promise<ScrapedOrder[]>;
  checkAuth(): Promise<{ authenticated: boolean }>;
}
```

Each retailer is a content script that knows how to scrape its own site. The service worker doesn't know site-specific details — it just routes messages to the right content script based on the retailer.

## Amazon Scraping

The content script runs on `*.amazon.com` and handles two pages:

### Transactions Page (`/cpe/yourpayments/transactions`)

Scrapes card-level charges: amount, date, card last-4, order ID. Paginated via AJAX.

Key selectors (from existing Playwright scraper):
- `.apx-transaction-date-container` — date group containers
- `.apx-transactions-line-item-component-container` — charge line items
- `a[href*='orderID=']` — order ID links
- `.a-span3 span, .a-text-right span` — amounts
- `.a-span9 span` — card last four

Pagination: click the "Next Page" button or fetch the AJAX endpoint. Stop when all entries on a page are already cached in IndexedDB, or after ~5 pages max.

### Order Detail Page (`/gp/css/summary/edit.html?orderID={id}`)

Fetched for each order not already cached. Extracts line items.

Key selectors (from existing Playwright scraper):
- `.a-fixed-left-grid.item-box` or `[class*='od-item'], .yo-item` — item containers (two fallback strategies)
- `a[href*='/dp/']` — product links (ASIN extraction via `/dp/([A-Z0-9]{10})`)
- `.a-color-price` — item prices
- `Qty:` text pattern — quantities
- `img` elements — product thumbnails

### Caching Strategy

- All scraped charges and orders are cached in IndexedDB immediately.
- On sync, check IndexedDB for existing matches before scraping.
- When scraping, stop paginating when we hit a previously cached charge.
- Never re-scrape a cached order's detail page.
- Closing and reopening the extension triggers no scraping if cached data covers all current YNAB transactions.

### Tab Management

- Service worker looks for an existing `*.amazon.com` tab first.
- If none found, opens one in background (`active: false`).
- Content script detects login pages (`/ap/signin`, `/ap/challenge`). On auth failure: service worker brings tab to foreground, side panel shows login prompt.
- Service worker closes the tab only if it opened it. Pre-existing Amazon tabs are left alone.

## Matching Heuristic

Match YNAB transaction to Amazon charge by:
1. **Exact amount** — YNAB milliunits converted to cents must match Amazon charge amount exactly
2. **Date proximity** — within ±3 days (YNAB posting can lag)

Cases:
- **One match** → auto-select, show in review queue with items
- **No match** → flag as "no match found" in the queue
- **Multiple matches** → flag similarly; user can't resolve in v1 (unlikely edge case since exact cents must match)

## Classifier

Tiered, stops at first confident result:

### Tier 1 — Product Cache

Exact match on `{retailer}:{productId}` in the `productCache` IndexedDB store. If found and `confirmedByUser` is true, use that category.

### Tier 2 — Keyword Rules

~20 hardcoded regex rules in code. Each rule maps an item title pattern to a **category name pattern** (not a UUID). At runtime, the classifier matches the category name pattern against the user's actual YNAB categories. If no matching category exists in the user's budget, the rule is skipped.

Examples:
- `/dog food|cat food|pet treat/i` → category name matching `/pet/i`
- `/diaper|wipes|formula/i` → category name matching `/kid|baby|child/i`
- `/USB|cable|adapter|charger/i` → category name matching `/electronics|tech/i`
- `/shampoo|soap|toothpaste/i` → category name matching `/personal|health/i`

First match wins. No priority system, no user editing in v1. Rules that don't match any of the user's categories are silently skipped.

### Tier 3 — Uncategorized

Item gets no suggested category. Dropdown is empty, item is flagged visually.

### Product Cache Updates

When a user confirms a category (approves a transaction), all items in that transaction are upserted into the product cache with `confirmedByUser: true`. This means repeat purchases are auto-classified on future syncs.

## Split Construction

When writing back to YNAB:

1. Check if all items resolve to the same category.
   - **Same category** → simple update: `PUT` with `category_id`, `approved: true`, memo with item title(s).
   - **Multiple categories** → split (continue below).
2. Calculate `items_total = sum(item.price * item.quantity)` for all items.
3. Calculate `remainder = charge_amount - items_total` (tax/shipping).
4. Distribute remainder proportionally: each item's share = `(item_amount / items_total) * remainder`.
5. Round each share to the nearest cent. Adjust the last item so the total matches exactly.
6. Each item's final amount = `(item.price * item.quantity) + proportional_remainder`.
7. Convert to YNAB milliunits: `final_amount_cents * -10`.
8. Build `subtransactions` array: `{ amount, category_id, memo: item.title }`.
9. Validate: `sum(subtransactions.amount)` must equal the YNAB transaction's `amount`. If mismatch, show error, don't write.
10. `PUT /v1/budgets/{id}/transactions/{id}` with `{ transaction: { subtransactions, approved: true } }`.

## YNAB API

Base URL: `https://api.ynab.com/v1`
Auth: `Authorization: Bearer {PAT}`

Endpoints used:
- `GET /budgets` — list budgets (onboarding)
- `GET /budgets/{id}/categories` — fetch categories (onboarding + refresh)
- `GET /budgets/{id}/transactions?type=unapproved` — fetch unapproved transactions
- `PUT /budgets/{id}/transactions/{id}` — write split or simple categorization

All API calls happen in the service worker. The PAT never leaves `chrome.storage.local` / the service worker context.

## Settings & Onboarding

### First-time onboarding (side panel)

1. Side panel detects no PAT → shows onboarding screen.
2. User pastes YNAB Personal Access Token (link provided to YNAB developer settings).
3. Extension validates token via `GET /budgets`.
4. Budget picker shown (most users have 1-2 budgets).
5. User selects budget → extension fetches and caches categories in IndexedDB.
6. Side panel transitions to the main queue view.

### Settings (gear icon)

- View/update YNAB token
- Switch budget
- Refresh categories from YNAB

Nothing else for v1.

## Extension Permissions

```json
{
  "permissions": ["storage", "sidePanel", "tabs"],
  "host_permissions": [
    "https://*.amazon.com/*",
    "https://api.ynab.com/*"
  ]
}
```

Minimal permissions. Add new `host_permissions` only as new retailer modules are added.

## Side Panel UI

### Queue View

- Header: "Itemize" title, settings gear, sync button
- Summary bar: count of uncategorized transactions, count fully classified
- Transaction list: each card shows payee, amount, date, item count, category tags
  - Green left border + green tags: fully classified
  - Yellow left border + yellow "needs category" label: has uncategorized items
  - Loading state while Amazon scrape is in progress
- "Approve All Classified (N)" button at bottom — sends only fully-classified transactions to YNAB

### Detail View (click into a transaction)

- Back button to queue
- Transaction header: amount, date, payee, order ID
- Item cards: product thumbnail, title, price × quantity, category dropdown
  - Dropdown pre-filled by classifier, always shows full category list
  - Uncategorized items: yellow border, warning icon, empty dropdown
- Split breakdown section: shows per-category totals with proportional tax/shipping, total must match charge
- Approve button: disabled until all items have a category, writes to YNAB on click

## Future Enhancements (out of scope for v1)

- OAuth for YNAB (instead of PAT)
- Auto-sync on side panel open / periodic background sync
- Keyword rule management UI
- Embedding classifier (kNN tier trained on user's categorization history)
- Additional retailers (Target, Costco, etc.)
- Payee mapping management UI
- Multiple match resolution UI
- Refund handling
- Multi-account households
- `chrome.storage.sync` for cross-device settings

## File Structure

```
itemize/
  entrypoints/
    sidepanel/              # React side panel UI
      index.html
      main.tsx
      App.tsx
    background.ts           # Service worker
    amazon.content.ts       # Amazon content script
  core/
    ynab.ts                 # YNAB API client
    matcher.ts              # Transaction ↔ order matching
    classifier.ts           # Tiered classifier
    cache.ts                # IndexedDB wrapper
    registry.ts             # Retailer module registry
    money.ts                # Cents ↔ milliunits helpers
  retailers/
    amazon/
      scraper.ts            # Transactions page + order detail parsing
      selectors.ts          # DOM selectors (easy to update when Amazon changes)
  types/
    index.ts                # Shared types (Order, LineItem, RetailerModule, etc.)
  wxt.config.ts
  tailwind.config.ts
  package.json
```
