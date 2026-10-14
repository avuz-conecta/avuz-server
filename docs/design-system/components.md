# Components

Token names drop the `--avuz-` prefix. In-app, swap each for its theming var ([tokens.md](tokens.md#in-app-mapping-theming-vars)). Live preview: [components.html](components.html).

Shared rules:

- **Focus:** `box-shadow: var(--avuz-focus-ring)` on `:focus-visible`, plus `outline: 2px solid transparent` so the ring shows in Windows high-contrast mode.
- **Disabled:** `disabled-bg` + `disabled-text`, `cursor: not-allowed`, no hover. Use the `disabled` attribute, not only a class.
- **Motion:** 120 ms on color and shadow. None under `prefers-reduced-motion: reduce`.
- **Dark mode:** comes from the tokens. Never branch on theme in component CSS.

## Buttons

Anatomy: optional 16px icon + label (`text-base`, 600) · height `control-height` (44px on touch) · padding `0 space-4` · radius `radius-md` · gap `space-2`. Label is a verb: "Enviar para assinatura", not "OK".

| Variant | Default | Hover | Active | Use |
|---|---|---|---|---|
| Primary | `action` fill, `on-action` label | `action-hover` | `action-active` | One per view |
| Secondary | `surface` fill, `border` 1px, `text` label | `surface-hover` | `border` → `text-muted` | Other actions |
| Ghost | transparent, `link` label | `action-tint` fill | `action-tint` + `action-hover` label | Toolbar, inline, "Cancelar" |
| Danger | `danger` fill, `on-danger` label | `danger-hover` | `danger-hover` | Destructive confirm only ("Excluir quadro") |

- Focus: `focus-ring`, all variants.
- Disabled: shared rule. Ghost disabled = `disabled-text` on transparent.
- Loading: keep width, replace the icon with a 16px spinner in the label color, set `aria-busy="true"` and `disabled`. Label stays ("Enviando…").
- Dark: primary becomes brand fill with dark label (7.08:1). Danger becomes light red with dark label.

## Cards

Anatomy: `surface` fill · 1px `border` · `radius-lg` · `shadow-sm` · padding `space-4` · title `text-lg` Questrial · meta row `text-sm` `text-muted` · optional tags row · optional footer actions (ghost buttons).

- Hover (if clickable): `shadow-md`, border → `text-muted`. Make the whole card one link/button; don't nest buttons inside a clickable card.
- Focus: `focus-ring` on the card.
- Selected: `action-tint` fill, 1px `action` border.
- Loading: skeleton blocks in `surface-hover`, same height as the real card.
- Dark: separation comes from `surface` vs `bg`; the shadow is secondary.

## Tags

Anatomy: `text-xs` 600 · padding `2px space-2` · `radius-pill` · optional 6px status dot.

| Variant | Fill | Text | Example |
|---|---|---|---|
| Neutral | `surface-hover` + 1px `border` | `text` | "Financeiro" |
| Info | `action-tint` | `link` | "Aguardando assinatura" |
| Success | `success-tint` | `success` | "Assinado" |
| Danger | `danger-tint` | `danger` | "Recusado", "Atrasado" |
| New | `accent` | `on-accent` | "Novo" |

- Static by default. A removable tag gets a ghost × button (24px hit area, 44px on touch) with `aria-label="Remover etiqueta Financeiro"`.
- Never color alone: the label says the status.

## Tables

Anatomy: `surface` container, 1px `border`, `radius-lg` · header row `text-sm` 600 `text-muted`, bottom `border` · cells padding `space-3 space-4`, `text-base` · row divider 1px `border`.

- Row hover: `surface-hover`. Selected: `action-tint` + checkbox checked.
- Focus: `focus-ring` inset on the focused row link or control.
- Numbers and dates right-aligned, tabular figures (`font-variant-numeric: tabular-nums`).
- Empty: render the empty state inside the table frame, not a blank table.
- Loading: 3 skeleton rows.
- Under 640px: each row becomes a stacked card (label: value pairs). Use `<th scope="col">` and keep the `<table>` semantics on desktop.

## Forms

Anatomy: label (`text-sm` 600 `text`) above the field · input `control-height`, `surface` fill, 1px `border` (in-app: `--color-border-maxcontrast`), `radius-md`, padding `0 space-3` · hint `text-sm` `text-muted` below · gap `space-2` within a field, `space-4` between fields.

| State | Treatment |
|---|---|
| Default | As above. Placeholder `text-muted`, never instead of a label. |
| Hover | Border → `text-muted` |
| Focus | `focus-ring`, border → `action` |
| Error | Border `danger`, message `text-sm` `danger` below with an icon, `aria-invalid="true"`, `aria-describedby` → message. Say what to fix: "Informe um e-mail válido, ex.: ana@empresa.com.br". |
| Disabled | Shared rule |
| Read-only | `bg` fill, no border change, still selectable |

- Required: "(obrigatório)" in the label text, not a lone asterisk.
- Validate on blur and submit, not per keystroke.

## Empty states

Anatomy: centered in the container, max width 400px · optional 48px Lucide-style icon in `text-muted` · title `text-xl` Questrial · one sentence `text-base` `text-muted` · one primary button. Padding `space-12` vertical.

- Say what the space is for and the one next step: "Nenhum contrato ainda" / "Envie o primeiro documento para assinatura." / [Novo envelope].
- Filtered-empty differs from first-use empty: "Nenhum cartão com a etiqueta Financeiro" + ghost [Limpar filtros].
- Error empty: `danger` icon, what failed, [Tentar novamente].
- No illustrations of people, no jokes.
