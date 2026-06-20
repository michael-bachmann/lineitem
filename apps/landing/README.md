# LineItem landing page

The public marketing site for LineItem (lineitem.dev) — a static **Vite + React**
SPA. It reuses the shared design tokens and components from `@lineitem/ui`, so the
site and the extension never drift.

## Develop

```bash
pnpm --filter landing dev          # local dev server
pnpm --filter landing storybook    # component workbench (port 6007)
pnpm --filter landing compile      # type-check (tsc --noEmit)
pnpm --filter landing build        # production build → dist/
```

## Deploy (Cloudflare Workers — static assets)

Deployed as a static-assets Worker (no script): the Vite build in `dist/` is
served straight from Cloudflare's edge. No SSR, no functions — the feedback form
posts directly to Web3Forms. Config lives in `wrangler.toml`.

Manual deploy from the repo:

```bash
pnpm --filter landing build
pnpm --filter landing deploy   # wrangler deploy → lineitem-landing
```

Connected to Git via **Workers Builds** (Workers & Pages → `lineitem-landing` →
Settings → Builds), which auto-deploys `main`:

- **Build command:** `pnpm --filter landing build`
- **Deploy command:** `pnpm --filter landing exec wrangler deploy`
- **Root directory:** repo root (so pnpm resolves the `@lineitem/ui`
  `workspace:*` link from source)

Custom domain `lineitem.dev` is attached under the Worker's **Domains & Routes**.
A SPA fallback isn't needed — this is a single anchor-scrolled page with no
client-side routing.

## Environment

- `VITE_WEB3FORMS_KEY` — Web3Forms access key for the feedback forms (wired in a
  later PR). Web3Forms keys are publishable; a working fallback ships in the code.
