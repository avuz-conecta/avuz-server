# Avuz help + support widget — design

Date: 2026-09-11
Status: approved, code-only (prod deploy gated)

## Goal

Give every authenticated AvuzConecta user a subtle, always-available path to
help: product docs and human support. Subtle and gentle — muted at rest, brand
accent only on hover/focus. Not a loud button.

## Placement

Lives in `apps/avuz_theme` (the theme app already injected on all pages via
`Application::boot()`). No new app, no build step.

- `apps/avuz_theme/js/help-widget.js` — vanilla-JS IIFE, matches the house
  style of the other `js/*.js` files (defensive DOM readiness, no framework).
- `apps/avuz_theme/css/help-widget.css` — all styling.
- `apps/avuz_theme/lib/AppInfo/Application.php` — two lines in `boot()`:
  `Util::addStyle(self::APP_ID, 'help-widget')` and
  `Util::addScript(self::APP_ID, 'help-widget')`.
- `apps/avuz_theme/js/help-widget.preview.html` — standalone dev preview (not
  in the addScript path; commited for visual review).

## Constants

- Docs: `https://ajuda.avuz.app`
- Support (WhatsApp): `https://wa.me/5554993370993?text=` +
  `encodeURIComponent('Olá, preciso de ajuda, vim através do suporte no AvuzConecta')`
- Brand accent (hover/focus only): `#00679e`
- Root id `avuz-help-widget` (double-injection guard).

## UI / interaction

- Launcher: small round `<button>` fixed bottom-right, margin above the bottom
  edge so it clears the app's own bottom-anchored UI. Contains a "?" glyph.
  Resting = muted surface, soft border + faint shadow, reduced opacity. On
  hover/focus it lifts gently to the brand accent.
- Expanded panel: small card above the launcher, two rows (quiet text + small
  leading icon, brand accent on hover only):
  1. Documentação → docs URL
  2. Falar com o suporte → WhatsApp URL
  Both links `target="_blank"` + `rel="noopener noreferrer"`.
- Triggers: expands on hover (desktop) and toggles on click/tap (touch).
  Collapses on outside-click, mouse-leave, and Esc.
- Labels in pt-BR.

## Accessibility

- Real `<button>` with `aria-label="Ajuda e suporte"`, `aria-haspopup="menu"`,
  and `aria-expanded` kept in sync.
- Options are real `<a>` links, keyboard-focusable in order.
- Visible `:focus-visible` outline; Esc closes and returns focus to launcher.
- Hover is an enhancement only — click + keyboard always work.
- Respects `@media (prefers-reduced-motion: reduce)` (no transform/opacity
  transitions).

## Theming / z-index

- Dark-mode aware via NC variables (`--color-main-background`,
  `--color-main-text`, `--color-border`, `--color-background-hover`,
  `--color-text-maxcontrast`). `#00679e` used only for the brand hover accent.
- `z-index: 1500` — above ordinary content, well below NC modals/dialogs
  (~10000+) so it never covers them.

## Scope

In: the launcher, the two static links, the interaction + a11y above.

Out of scope: context-aware links (per-app help), per-user dismiss/hide,
admin toggle, analytics/telemetry.

## Deploy

Code-only on branch `claude/avuz-help-widget`. Docker build and prod/staging
deploy are gated and handled by the parent session.
