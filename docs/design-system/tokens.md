# Tokens

Source of truth: [`tokens.css`](tokens.css). Every name below is a CSS custom property prefixed `--avuz-`.

## Colors

### Brand (same in light and dark)

| Token | Value | Use |
|---|---|---|
| `brand` | `#2bb5e3` | Brand dot, accents, focus ring, large decorative fills. **Never** as a fill behind white text, never as small text on light. |
| `accent` / `accent-hover` | `#d2e314` / `#bccf00` | "Novo" badges, highlights. Always a fill, text on it is `on-accent`. |
| `error-fill` / `success-fill` | `#ef4444` / `#22c55e` | Status dots and icons only (non-text). Text uses `danger` / `success`. |

Rule: blue and olive never both appear as text colors. One is the fill or accent of the other.

### Semantic

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#f2f6fb` | `#0f1e2e` | Page background |
| `surface` | `#ffffff` | `#16283b` | Cards, modals, tables, inputs |
| `surface-hover` | `#eef2f7` | `#1d3349` | Row and secondary-button hover |
| `border` | `#d9d9d9` | `#2c4157` | Card, input and table borders, dividers |
| `text` | `#1a2b3c` | `#e6edf5` | Headings, body |
| `text-muted` | `#5a6a7a` | `#9fb0c2` | Labels, metadata, placeholders |
| `link` | `#00679e` | `#5cc8ee` | Links, ghost-button text |
| `action` | `#00679e` | `#2bb5e3` | Primary-button fill |
| `action-hover` | `#004f7a` | `#5cc8ee` | Primary hover |
| `action-active` | `#003d5e` | `#8fdaf4` | Primary pressed |
| `on-action` | `#ffffff` | `#0f1e2e` | Label on `action` |
| `action-tint` | `#e3f4fb` | `#143a52` | Selected row, info tag, ghost hover |
| `danger` / `danger-hover` | `#b91c1c` / `#991b1b` | `#f87171` / `#fca5a5` | Error text, danger-button fill |
| `on-danger` | `#ffffff` | `#0f1e2e` | Label on `danger` |
| `danger-tint` | `#fee2e2` | `#3a1d24` | Error tag, error banner |
| `success` | `#15803d` | `#4ade80` | Success text |
| `success-tint` | `#dcfce7` | `#12352a` | Success tag |
| `on-accent` | `#1a2b3c` | `#0f1e2e` | Text on `accent` |
| `disabled-bg` / `disabled-text` | `#d9d9d9` / `#5a6a7a` | `#2c4157` / `#9fb0c2` | Disabled controls |
| `focus` / `focus-edge` | `#2bb5e3` / `#00679e` | `#2bb5e3` / `#2bb5e3` | Focus ring colors |
| `focus-ring` | 2px `focus-edge` + 2px `focus` | same | Box shadow on `:focus-visible` |

In dark mode the primary button flips: brand fill `#2bb5e3` with dark label `#0f1e2e` (7.08:1).

### In-app mapping (theming vars)

Inside Avuz Conecta apps, read the theming vars, not the hex values. The instance derives them from the primary color and picks the label color for contrast. Dark mode comes for free. Use the `--avuz-` hex values only outside the app shell (site, emails, static pages).

| Avuz token | In-app variable |
|---|---|
| `action` | `var(--color-primary-element)` |
| `action-hover` | `var(--color-primary-element-hover)` |
| `on-action` | `var(--color-primary-element-text)` |
| `action-tint` | `var(--color-primary-element-light)` |
| text on `action-tint` | `var(--color-primary-element-light-text)` |
| `action-tint` hover | `var(--color-primary-element-light-hover)` |
| `link`, `focus` | `var(--color-primary-element)`. Measure it on `--color-main-background` on the tenant; it needs 4.5:1. |
| `surface` | `var(--color-main-background)` |
| `bg` | `var(--color-background-dark)` |
| `surface-hover` | `var(--color-background-hover)` |
| `border` | `var(--color-border)` (inputs: `var(--color-border-maxcontrast)`) |
| `text` / `text-muted` | `var(--color-main-text)` / `var(--color-text-maxcontrast)` |
| `danger` (fill / text) | `var(--color-error)` / `var(--color-error-text)` |
| `success` (fill / text) | `var(--color-success)` / `var(--color-success-text)` |
| `radius-md` / `radius-lg` / `radius-pill` | `var(--border-radius-element)` / `var(--border-radius-container)` / `var(--border-radius-pill)` |
| `space-1` | `var(--default-grid-baseline)` (4px) |
| `font-body` | `var(--font-face)` |
| `text-base` | `var(--default-font-size)` (15px) |

Pattern, as in Assinaturas: `--av-action: var(--color-primary-element);`. Fixed exceptions: `brand` (the dot) and `accent`.

## Contrast

WCAG 2.x relative-luminance ratio. AA: 4.5:1 for body text, 3:1 for non-text (focus ring, icons). Computed with:

```python
def lum(h):
    c = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

def ratio(a, b):
    hi, lo = sorted((lum(a), lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)
```

### Failing pairs (do not use)

| Pair | Ratio | Needs | Result |
|---|---|---|---|
| `#ffffff` on `#2bb5e3` (white on brand) | 2.38 | 4.5 | **FAIL** |
| `#ef4444` on `#ffffff` (raw error as text) | 3.76 | 4.5 | **FAIL** |
| `#22c55e` on `#ffffff` (raw success as text) | 2.28 | 4.5 | **FAIL** |
| `#2bb5e3` on `#ffffff` (brand ring alone) | 2.38 | 3 | **FAIL**. Fixed by the `#00679e` inner edge. |
| `#2bb5e3` on `#f2f6fb` (brand ring alone) | 2.19 | 3 | **FAIL**. Same fix. |

### Light

| Text / element | Background | Ratio | AA |
|---|---|---|---|
| `text` `#1a2b3c` | `surface` `#ffffff` | 14.44 | Pass |
| `text` `#1a2b3c` | `bg` `#f2f6fb` | 13.30 | Pass |
| `text` `#1a2b3c` | `surface-hover` `#eef2f7` | 12.84 | Pass |
| `text` `#1a2b3c` | `action-tint` `#e3f4fb` | 12.79 | Pass |
| `text-muted` `#5a6a7a` | `#ffffff` | 5.56 | Pass |
| `text-muted` `#5a6a7a` | `#f2f6fb` | 5.12 | Pass |
| `text-muted` `#5a6a7a` | `#eef2f7` | 4.95 | Pass |
| `link` `#00679e` | `#ffffff` | 6.12 | Pass |
| `link` `#00679e` | `#f2f6fb` | 5.64 | Pass |
| `link` `#00679e` | `action-tint` `#e3f4fb` | 5.42 | Pass |
| `on-action` `#ffffff` | `action` `#00679e` | 6.12 | Pass |
| `#ffffff` | `action-hover` `#004f7a` | 8.75 | Pass |
| `#ffffff` | `action-active` `#003d5e` | 11.48 | Pass |
| `danger` `#b91c1c` | `#ffffff` | 6.47 | Pass |
| `danger` `#b91c1c` | `#f2f6fb` | 5.96 | Pass |
| `danger` `#b91c1c` | `danger-tint` `#fee2e2` | 5.30 | Pass |
| `#ffffff` | `danger` `#b91c1c` | 6.47 | Pass |
| `#ffffff` | `danger-hover` `#991b1b` | 8.31 | Pass |
| `success` `#15803d` | `#ffffff` | 5.02 | Pass |
| `success` `#15803d` | `#f2f6fb` | 4.62 | Pass |
| `success` `#15803d` | `success-tint` `#dcfce7` | 4.57 | Pass (tight) |
| `on-accent` `#1a2b3c` | `accent` `#d2e314` | 10.13 | Pass |
| `on-accent` `#1a2b3c` | `accent-hover` `#bccf00` | 8.29 | Pass |
| `text` `#1a2b3c` | `border` `#d9d9d9` (neutral tag) | 10.23 | Pass |
| `focus-edge` `#00679e` (non-text) | `#ffffff` | 6.12 | Pass (3:1) |
| `disabled-text` `#5a6a7a` | `disabled-bg` `#d9d9d9` | 3.94 | Exempt (disabled) |

### Dark

| Text / element | Background | Ratio | AA |
|---|---|---|---|
| `text` `#e6edf5` | `bg` `#0f1e2e` | 14.29 | Pass |
| `text` `#e6edf5` | `surface` `#16283b` | 12.70 | Pass |
| `text` `#e6edf5` | `surface-hover` `#1d3349` | 10.97 | Pass |
| `text` `#e6edf5` | `border` `#2c4157` (neutral tag) | 8.89 | Pass |
| `text-muted` `#9fb0c2` | `#0f1e2e` | 7.60 | Pass |
| `text-muted` `#9fb0c2` | `#16283b` | 6.76 | Pass |
| `text-muted` `#9fb0c2` | `#1d3349` | 5.83 | Pass |
| `link` `#5cc8ee` | `#0f1e2e` | 8.79 | Pass |
| `link` `#5cc8ee` | `#16283b` | 7.82 | Pass |
| `link` `#5cc8ee` | `#1d3349` | 6.75 | Pass |
| `link` `#5cc8ee` | `action-tint` `#143a52` | 6.23 | Pass |
| `on-action` `#0f1e2e` | `action` `#2bb5e3` | 7.08 | Pass |
| `#0f1e2e` | `action-hover` `#5cc8ee` | 8.79 | Pass |
| `#0f1e2e` | `action-active` `#8fdaf4` | 10.84 | Pass |
| `danger` `#f87171` | `#16283b` | 5.42 | Pass |
| `danger` `#f87171` | `#0f1e2e` | 6.10 | Pass |
| `danger` `#f87171` | `danger-tint` `#3a1d24` | 5.50 | Pass |
| `on-danger` `#0f1e2e` | `danger` `#f87171` | 6.10 | Pass |
| `#0f1e2e` | `danger-hover` `#fca5a5` | 8.88 | Pass |
| `success` `#4ade80` | `#16283b` | 8.60 | Pass |
| `success` `#4ade80` | `#0f1e2e` | 9.68 | Pass |
| `success` `#4ade80` | `success-tint` `#12352a` | 7.68 | Pass |
| `on-accent` `#0f1e2e` | `accent` `#d2e314` | 11.83 | Pass |
| `focus` `#2bb5e3` (non-text) | `#16283b` | 6.30 | Pass (3:1) |
| `focus` `#2bb5e3` (non-text) | `#0f1e2e` | 7.08 | Pass (3:1) |
| `disabled-text` `#9fb0c2` | `disabled-bg` `#2c4157` | 4.73 | Pass |

## Type

| Token | Value | Use |
|---|---|---|
| `font-heading` | Questrial (self-hosted, `apps/avuz_theme/fonts/`; one weight, 400), then system UI fonts | Headings |
| `font-body` | Inter, falling back to system UI fonts | Body. In-app: `var(--font-face)` |

| Size token | Line-height token | Size / line height | Weight | Font | Use |
|---|---|---|---|---|---|
| `text-2xl` | `leading-2xl` | 28 / 36 | 400 | `font-heading` | Page title |
| `text-xl` | `leading-xl` | 22 / 30 | 400 | `font-heading` | Section title, empty-state title |
| `text-lg` | `leading-lg` | 18 / 26 | 400 | `font-heading` | Card title, modal title |
| `text-base` | `leading-base` | 15 / 22 | 400, 600 | `font-body` | Body, buttons, inputs |
| `text-sm` | `leading-sm` | 13 / 18 | 400, 600 | `font-body` | Labels, table headers, metadata |
| `text-xs` | `leading-xs` | 12 / 16 | 600 | `font-body` | Tags, counters |

Weights: `weight-regular` 400, `weight-semibold` 600. No bold body paragraphs; emphasis = semibold.

## Spacing

4px base: `space-1` 4, `space-2` 8, `space-3` 12, `space-4` 16, `space-6` 24, `space-8` 32, `space-12` 48, `space-16` 64.
Inside a control: 8–12. Between related items: 8–16. Between sections: 32–48. When in doubt, go one step bigger.

## Radius

`radius-sm` 4 (tags inside dense tables) · `radius-md` 8 (buttons, inputs) · `radius-lg` 12 (cards, modals) · `radius-pill` 999 (tags, avatars).

## Shadows

| Token | Light | Dark | Use |
|---|---|---|---|
| `shadow-sm` | `0 1px 2px` 8% navy | `0 1px 2px` 40% black | Cards at rest |
| `shadow-md` | `0 4px 12px` 10% navy | `0 4px 12px` 45% black | Hovered card, dropdown |
| `shadow-lg` | `0 12px 32px` 16% navy | `0 12px 32px` 55% black | Modal |

In dark mode, separate layers with the `surface` / `surface-hover` steps first; shadows barely show.

## Sizing

`control-height` 36px (in-app: `--default-clickable-area` is 34px). `tap-target` 44px minimum on touch layouts.
