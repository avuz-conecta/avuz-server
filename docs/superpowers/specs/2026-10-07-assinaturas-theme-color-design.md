# Assinaturas — theme color design

Date: 2026-10-07 · Status: approved in brainstorm, awaiting spec review
Part of the pre-pilot feature set (order: theme color → signer contacts → folders and managers → contracts). See also `2026-09-28-assinaturas-zapsign-design.md` §7.

## Goal

Assinaturas buttons and links look like the rest of Avuz Conecta. Today the app's action color is the fixed dark blue `#00679e`; the rest of the instance uses the theme's primary color (`#2bb5e3`).

## Decision

The app's action tokens read Nextcloud's theme variables instead of fixed values, **everywhere** the action color is used today: filled and outline buttons, links (for example "Corrigir e-mail"), focus rings, and the selected placement box.

| App token | Today | New value |
|---|---|---|
| `--av-action` | `#00679e` | `var(--color-primary-element)` |
| `--av-action-hover` | `#004f7a` | `var(--color-primary-element-hover)` |
| `--av-on-fill` (label on a filled action) | white | `var(--color-primary-element-text)` |

- Any other token derived from `--av-action` (tints, outlines) follows it; no new fixed colors.
- Status colors (success, warning, danger) and the brand dot `--av-brand` do not change.
- Dark mode uses Nextcloud's dark theme values automatically.
- Text drawn in the action color on a light background (links, outline buttons) uses `var(--color-primary-element-text-dark)` if Nextcloud provides it for contrast; otherwise the plan measures the contrast of `--color-primary-element` on the panel background and picks the Nextcloud variable that reaches 4.5:1.

## Why theme variables

- Same look as every other Avuz Conecta screen, and a tenant with a different primary color is followed automatically.
- Nextcloud chooses the label color for contrast against the primary (white on `#2bb5e3` would be 2.4:1, below WCAG AA 4.5:1), so the app stays accessible without computing colors itself.

## Out of scope

The Questrial font, icons, layout and illustrations stay as they are.

## Verification

- Before/after screenshots of dashboard, wizard (all four steps), detail page, admin page and Files sidebar tab, in light and dark mode, on staging.
- Measured contrast for: label on filled button, link on panel, outline button text, focus ring against its background (3:1 for non-text).
- Vitest: existing specs pass; a spec asserts the action tokens resolve to the Nextcloud variables (no hard-coded `#00679e` left in `src/`).
