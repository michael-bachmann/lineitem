# LineItem UI redesign — design source of truth & carry-forward

Authoritative spec for the side-panel redesign. Read this before any UI PR.

## Source-of-truth ranking (resolve disagreements top-down)

1. **`tokens.css`** (this dir) — the resolved light-theme tokens from Claude Design. If a color sampled off the prototype disagrees, **tokens.css wins.** Already encoded in `entrypoints/sidepanel/style.css`.
2. **`UPDATE.md`** (this dir) — handoff addendum. Two standing rules: surfaces stay warm (`--surface-3 #ece7df`, *not* a neutral gray); disabled buttons are **inert** (no hover/press).
3. **The annotated screenshots + the rendered screen branches** (`screens1.jsx`/`screens2.jsx` in the handoff bundle). The spec for *what exists*.
4. `components.jsx` exports / handoff README primitive list — **over-includes**; verify against rendered screens before building.
5. `lineitem.css` — component *values* only; ignore stage/rail/Tweaks/dark scaffolding.

**Hard rules**
- Do **not** port the Tweaks panel, dark mode, density, or accent presets, or any runtime `color-mix` derivation of surfaces. Light theme only.
- Color-picking the prototype is unreliable (the Tweaks "Card color" control re-derived surfaces toward a cool gray — that's why a sample read `#efeeef` while the token is `#f6f3ee`). Use `tokens.css`.
- Verify every primitive/state against a rendered screen branch (`grep -rn "<Name" reference/*.jsx`), not the export list — that's how we caught the phantom `Chip`/`SourceIcon`.

## Use the existing primitive kit (PR 3) — don't rebuild

`Button` (4 variants + `sm`/`busy`/`disabled`, **disabled is inert** — reuse it, don't hand-roll button styling), `IconButton`, `Icon` (25 glyphs), `Spinner`, `Mark`/`BrandRow`, `Money` (tabular), `Thumb` (swatch + mix-blend), `statusInfo` + `StatusTile`, `SourceTag`, `StatusMessage` (muted/err/ok), `BackLink`, `SectionLabel`. Inventory + evidence: `docs/superpowers/ui-primitive-inventory.md`.

Only remaining primitive: **`CategorySelect`** (PR 4).

### Kit conventions (follow these in new components)

- **Named exports** for every component (no `default` exports).
- **Every presentational leaf accepts `className`** and merges it last (so callers can position it). Follow the existing `` `${BASE} ${className}` `` pattern.
- **Tailwind utilities + tokens by default.** Inline `style` is allowed **only** for runtime-dynamic values (e.g. `Spinner` `size`) or things Tailwind can't express (the `Thumb` gradient/ring). Component-specific color math lives as `--btn-*`-style tokens in `style.css`, not inline `color-mix(...)` walls.
- **`StatusMessage` is the one icon-as-child component** — pass an unsized icon as the first child and it clamps to 16px. Everything else takes explicit props.
- One Storybook story per component showing its states/variants.

## Every screen PR owes ALL its states (24 total)

Build a Storybook story per state, verified against its branch + screenshot.

- **Onboarding** (PR 7): connect · connecting · error
- **Backfill** (PR 7): idle · running · done · done·some-failed · done·run-again · login-required
- **Queue** (PR 5): populated · empty · syncing · sync-error · approving
- **Detail** (PR 6): matched · partial · loading · no-match · auth · scrape-error
- **Settings** (PR 6/8): idle · success · error
- **Help & About** (PR 8): one

## Cross-cutting architecture (agreed)

- **Humble components** for the 3 IO screens (Onboarding, Backfill, Settings): lift state machine + IO into thin containers; presentational components take view-state as props → one story per state, zero browser mocking.
- Typed **`lib/messaging.ts`** seam replaces scattered `browser.runtime.sendMessage({type})` strings.
- `busy` buttons block clicks via `pointer-events-none` (not `disabled`, which would grey them).

## Per-PR notes

**PR 4 — CategorySelect.** Custom dropdown replacing the native `<select>` in `ItemCard.tsx`. Styled trigger + popover: filter input (type-to-filter), grouped options w/ headers, hover/selected from tokens, keyboard nav (↑/↓/Enter/Esc), click-outside dismiss, and **edge-flip** (open upward near the panel bottom). Reuse `Icon.chevD/search/check`.

**PR 5 — Queue + Backfill.** Queue: `BrandRow` + `IconButton`(gear) + `sm` primary Sync (icon, spinner while syncing); summary line; grouped list via `SectionLabel` + count; `TransactionCard` (**quiet**: status dot + plain status text, *no* tile; dot color = status); sticky "Approve N ready" primary. Backfill: `BackfillCard` all states, `StatusMessage` for errors, progress bar (`li-progress`), **result rows use a shared fixed-width icon column** so check/retry icons align, and **reset `<p>` margins** (gap-based spacing). Buttons: secondary "Run again"/"Try again", ghost Cancel, disabled-primary "Continue" while running.

**PR 6 — Detail.** `BackLink` (own row) → txn header card; `ItemCard` (`Thumb`, 2-line title clamp, `Money` `$x.xx × qty = $total`, `SourceTag`, `CategorySelect`); attention-ring on uncategorized cards; bulk-apply row (attention-tinted, solid-rose icon badge + count + `CategorySelect`) when ≥1 uncategorized; `SplitBreakdown` (per-category subtotals + total + mismatch warning); sticky footer = primary "Approve & write split", or **disabled-primary** "N items still need a category" when blocked.

**PR 7 — Onboarding + Backfill (humble split + `lib/messaging.ts`).** Onboarding: brand, explainer, primary "Connect YNAB"; states connect/connecting/saving/error (16px alert icon + brick `StatusMessage`). Backfill prompt + reusable `BackfillCard`.

**PR 8 — Settings + Help & About.** Settings: `BackLink` + title; connected plan; secondary "Refresh Categories from YNAB"; embedded `BackfillCard`; Help nav row; divider; **danger** "Disconnect YNAB" (use `--danger` text on the soft tint). Help & About (new): "Buy me a coffee" brand-tinted hero + primary; FAQ accordion; get-involved rows; links rows; version footer. Copy/URLs in `data.jsx` are placeholders — swap real ones.
