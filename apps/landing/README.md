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

## Deploy (Cloudflare Pages)

Static build, no SSR and no Pages Functions (the feedback form posts straight to
Web3Forms). Configure the Pages project with:

- **Build command:** `pnpm --filter landing build`
- **Output directory:** `apps/landing/dist`

A `_redirects` SPA fallback isn't needed — this is a single anchor-scrolled page
with no client-side routing.

## Environment

- `VITE_WEB3FORMS_KEY` — Web3Forms access key for the feedback forms (wired in a
  later PR). Web3Forms keys are publishable; a working fallback ships in the code.
