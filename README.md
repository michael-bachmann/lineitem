# lineitem

Chrome/Firefox extension that answers **"what did I actually buy?"** for YNAB transactions. Matches an Amazon charge to the order behind it, shows the line items with thumbnails, classifies each item into a YNAB category (cached learning + on-device embeddings), and writes a split transaction back to YNAB — automatically when every item maps to the same category, as a split otherwise.

Tracked in Linear: [bachmann / lineitem](https://linear.app/bachmann/project/lineitem-4a139fb6940b).

---

## What's in the repo

```
.
├── entrypoints/       # WXT entrypoints: side panel UI, background service worker, content scripts
├── components/        # React UI (onboarding, queue, detail view, settings, backfill card, …)
├── lib/               # Domain code: oauth, ynab API, settings, types, distribution, classifier, db, money
├── background/        # Service-worker handlers: sync, backfill, approval, embedder, embedding eviction
├── retailers/         # Per-retailer adapters (Amazon today; Target in BAC-115)
├── worker/            # Cloudflare Worker — holds the YNAB OAuth client_secret
└── wxt.config.ts      # Extension manifest config (permissions, host permissions, pinned key)
```

## Tech stack

- **[WXT](https://wxt.dev/)** — MV3 extension framework, single codebase builds for Chrome + Firefox
- **React 19** + **Tailwind 4** for the side panel UI
- **TypeScript 5.9** in strict mode
- **vitest** + **happy-dom** for tests (142 currently, all colocated as `*.test.ts` next to source)
- **[transformers.js](https://huggingface.co/docs/transformers.js)** with `Xenova/bge-small-en-v1.5` (q8) for on-device item-title embeddings
- **IndexedDB** for persistent storage: categories, learned products, embeddings, allocated transactions
- **Cloudflare Workers** for the OAuth secret proxy at [auth.lineitem.dev](https://auth.lineitem.dev/)
- **[remeda](https://remedajs.com/)** for typed utility helpers (sum, groupBy, partition, sortBy, …)

## Local development

Install deps once:

```bash
pnpm install
```

Dev build with live reload:

```bash
pnpm dev          # Chrome (writes .output/chrome-mv3/)
pnpm dev:firefox  # Firefox (writes .output/firefox-mv2/)
```

Then in `chrome://extensions`: enable Developer mode → **Load unpacked** → pick `.output/chrome-mv3/`. The pinned manifest key gives a stable extension ID (`eahcpeohilmkjagfpdfocfjgaoeghghb`) across machines.

Production build (used for store packaging or tighter CSP than `pnpm dev`):

```bash
pnpm build
pnpm zip          # produces a store-ready zip
```

## Tests

```bash
pnpm test:run     # vitest, extension tests (lib/, background/, retailers/, components/)
pnpm worker:test  # vitest, worker tests (worker/src/)
pnpm compile      # tsc --noEmit (full repo)
```

## OAuth proxy worker

The extension uses YNAB OAuth (Authorization Code Grant with silent refresh). YNAB requires `client_secret` on every `/oauth/token` call — even with PKCE — and a browser extension can't safely embed secrets, so we route token exchanges through a Cloudflare Worker.

The Worker has two endpoints:
- `POST /oauth/exchange` — swaps an authorization code for tokens
- `POST /oauth/refresh` — rotates an access token via the stored refresh token

Both inject `YNAB_CLIENT_ID` + `YNAB_CLIENT_SECRET` from Cloudflare's encrypted env vars and forward to YNAB.

Deploy:

```bash
pnpm wrangler login
pnpm wrangler secret put YNAB_CLIENT_ID --config worker/wrangler.toml
pnpm wrangler secret put YNAB_CLIENT_SECRET --config worker/wrangler.toml
pnpm worker:deploy
```

Then attach the custom domain in the Cloudflare dashboard: **Workers & Pages → `lineitem-oauth` → Settings → Domains & Routes → Add → Custom domain → `auth.lineitem.dev`**. DNS and TLS provisioning are automatic; ~2 minutes to "Active".

Smoke test:

```bash
curl -i -X POST https://auth.lineitem.dev/oauth/exchange \
  -H 'content-type: application/json' \
  -d '{"code":"x","redirect_uri":"y"}'
```

Expected: HTTP 400 with a YNAB error body — proves the chain (domain → worker → YNAB) is wired.

YNAB redirect URI to register on the OAuth app: `https://<extension-id>.chromiumapp.org/`. The extension ID is pinned via `manifest.key` in `wxt.config.ts` so it stays stable across machines.

## Project conventions

- **Currency:** all monetary values are integer cents in code. Conversion to YNAB milliunits happens only at the API boundary (`millunitsToCents` / sign-flip in `buildSubtransactions`).
- **Storage:** IndexedDB store names are stable for migrations — TypeScript-level field renames don't touch the persistence layer. Object stores: `allocatedTransactions`, `learnedProducts`, `productEmbeddings`, `categories`.
- **Retailer adapters:** each adapter owns its full tab lifecycle (open → navigate → scrape → close). Pipeline composes adapters but doesn't manage tabs.
- **Tests:** colocate with the code (`foo.ts` ↔ `foo.test.ts`). Mock at the function boundary, not the network. TDD where the contract is clear; behavioral tests over implementation tests.
- **Functional style:** prefer pure helpers and remeda's `reduce`/`map`/`filter`/`groupBy`/`partition` over mutation. Avoid `push`/`splice` outside of localized hot loops.
- **Comments:** describe *why*, not what. Code identifiers handle the "what."

## Repository

[github.com/michael-bachmann/lineitem](https://github.com/michael-bachmann/lineitem) — private during pre-distribution.
