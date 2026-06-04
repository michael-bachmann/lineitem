# Handoff update — addendum (read after README.md)

Two fixes landed in the reference prototype after the initial handoff. Both affect
how you should treat the **design tokens** and the **Button** primitive. The
`reference/` files and `tokens.css` in this bundle already include these fixes.

---

## 1. Tokens are the source of truth — ignore the prototype's "Tweaks" derivations

**What happened:** the prototype shipped with a live "Tweaks" panel (a design-time
tool, NOT part of the product). One of its controls, a **Card color** picker,
re-derived the nested surface shades at runtime like this:

```
--surface-2 = color-mix(in oklab, <card> 93%, var(--text) 7%)
--surface-3 = color-mix(in oklab, <card> 86%, var(--text) 14%)
```

Because `--text` (#2f2a33) is a *cool* plum, mixing white toward it produced a
**cool gray** (~#efeeef) instead of the intended **warm greige** (#ece7df). So a
color-picker sampled on the running prototype reported the wrong value, and the
rendered insets (status tiles, neutral chips, Help row icons, progress track,
button hover) looked grayer than the palette intends.

**Resolution:** the Card tweak now sets **only** `--surface`; the nested insets
`--surface-2` / `--surface-3` stay as their designed warm token values.

**What you should do:**
- Implement **only** the static tokens in `tokens.css`. Do **not** port the Tweaks
  panel or any runtime `color-mix` derivation of surfaces.
- Authoritative inset values (light theme):
  - `--surface-2: #f6f3ee`
  - `--surface-3: #ece7df`  ← warm greige, NOT a neutral gray
- If a value you sample from the prototype ever disagrees with `tokens.css`,
  **`tokens.css` wins.**

> Optional design note: even at the correct `#ece7df`, this inset reads subtly
> "gray" when it sits on a white card (low chroma + simultaneous contrast). That's
> expected. If we later want it visibly warmer we'd bump it toward `#ece3d6` — but
> ship `#ece7df` unless told otherwise.

---

## 2. Button — disabled must not show hover feedback

**What happened:** the light-theme primary-button hover rule
(`filter: brightness(...)`) had no `:disabled` guard and out-specified the disabled
style, so a **disabled** primary button still brightened on hover. A disabled
`<button>` still matches `:hover` in CSS, so the inert control looked interactive.

**Resolution:** every hover/active rule on `.li-btn` (base, `is-primary`,
`is-danger`, and the light-mode primary) is now guarded with `:not(:disabled)`.

**What you should do — Button state matrix to implement:**

| Variant | Default | Hover (enabled only) | Active | Disabled |
|---|---|---|---|---|
| `primary` | ink (`--ink`) bg, white text, pill | slight brightness lift | translateY(1px) | **no hover/press**; flat `--surface-2` bg, `--faint` text, `--border` — reads clearly inert |
| `secondary` | surface bg + border | `--surface-3` bg, stronger border | translateY(1px) | dim (opacity .55), no hover |
| `danger` | soft `--err` tint, `--err` text | slightly stronger tint | translateY(1px) | dim, no hover |
| `ghost` | transparent, `--muted` text | `--surface` bg | — | dim, no hover |

Rules:
- **Disabled = inert.** No brightness, no background change, no translate on hover/active.
- Implement the guard at the component level (e.g. `disabled:` Tailwind variants, or
  `&:not(:disabled):hover`), not as a one-off — it must hold for all variants.
- `busy` state (spinner + label) is visually enabled but should block clicks.

### Where disabled-primary actually appears (so you can test it)
- **Transaction detail** → the Approve footer shows a disabled primary reading
  "N items still need a category" until all items are categorized.
- **Backfill prompt** → "Continue" is a disabled primary while a backfill runs.

---

## Full button inventory (for the primitives PR)
- `Btn` variants: **primary, secondary, danger, ghost**
- Size modifier: **`sm`** (smaller, auto-width — used for the header Sync button)
- Shared states: default · hover *(enabled only)* · active · disabled · busy
- Two specialized buttons (not `Btn` variants):
  - **icon button** — square, for the gear/Settings in the queue header
  - **back link** — text link with arrow ("Back" / "Back to queue"), styled as a
    `--link`, not a button surface
