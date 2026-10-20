# Left rail navigation + embedded webmail — implementation plan

> **For agentic workers:** use superpowers:executing-plans (or subagent-driven-development) task by task. Steps use checkboxes. Stop at every **Checkpoint** for Patrick.

**Spec:** [2026-10-20-left-rail-nav-design.md](../specs/2026-10-20-left-rail-nav-design.md) · **Canvas:** artboard F of https://claude.ai/artifact/Qp1q5eV6bmT1pLk5vizLL6

**Goal:** In Avuz Conecta, the top app bar becomes a collapsible left rail (≥1024px). When framed, ConectaMail drops its own top bar: search moves atop the list, and the account row moves to the folder footer.

## Global constraints

- **Part 1 lives in avuz-server.** Branch `feat/left-rail-nav`, off `avuz-customization`, in worktree `.claude/worktrees/webmail-header-overlap-69b526`. Everything goes in `apps/avuz_theme` plus a check in `apps/conectamail/js/resize.js`. No core edits.
- **Part 2 lives in webmail-avuz** (`~/work/avuz/webmail-avuz`). Make a new worktree off `origin/main` (the local `main` is 37 behind), branch `feat/embedded-mode`. The Roundcube fork stays untouched.
- **Gates:**
  - avuz_theme: `node --test apps/avuz_theme/tests/js/*.test.mjs`, plus PHPUnit for any PHP.
  - webmail-avuz: its `npm test`, typecheck, lint and build scripts. Check `package.json` for the exact names.
- **House rules:** TypeScript with no `any` and almost no `as`. Named exports. Early returns. Hash maps over switch. No magic strings. Tests describe behavior in 3rd person, no "should". Commits use conventional messages with no AI attribution.
- **UI loop:** check the state matrix locally, then preview on staging by hot-patch, with no build. Build images only after Patrick approves. Prod is gated per action.
- **Copy:** pt_BR in the UI, using "Avuz Conecta" (never "Nextcloud"). Strings: "Recolher menu", "Expandir menu", "Mais aplicativos", "Pesquisar", "Notificações", "Perfil e sair", "Caixa de e-mail".

## Part 1 — Avuz Conecta rail (avuz-server)

### Task 0 — Spike on staging (decides the header-end approach)
- [x] On default staging (avuz-conecta, stack 8), hot-patch a throwaway CSS that turns `#header` into a fixed 220px left column. Hide `#header-start__appmenu`. Stack `.header-end` vertically at the bottom. Shift `#content` (left = rail width, top = 0).
- [x] Open unified search, notifications, contacts menu and user menu from the column. Record which popovers clip or mis-position.
- [x] Grep `--header-height` / `$header-height` uses (`core/css`, `apps/*/css`, deck, spreed, calendar dist CSS). Visit Painel, Drive, Talk, Agenda, Tarefas, Assinaturas, E-mail and Settings. List the broken offsets.
- [x] **Checkpoint:** report findings, then choose the full rail or the fallback (a 48px strip holding only the header-end widgets). Revert the hot-patch.

#### Task 0 findings (2026-10-20, conectahml, 1440×900, injected in-page — nothing changed on the server)

**Decision: full rail, no fallback strip.** The core widgets (unified search, notifications, contacts, user menu) work stacked at the rail foot.

CSS facts the real implementation needs:
1. Theming re-declares every var on `body[data-theme-light|dark]`, not only on `:root`. So the override must live on `html.avuz-rail body { --header-height: 0px; --body-height: calc(100% - env(safe-area-inset-bottom) - 2 * var(--body-container-margin)); }`. With `--header-height: 0`, every app's `calc(100vh - var(--header-height))` and `top: var(--header-height)` goes full height without per-app fixes.
2. Restore `--header-height: 50px` inside `#header`, which sizes the header-end buttons.
3. The page container is `#content` on legacy pages but `#content-vue` on Vue apps (Drive). Target `body > :is(#content, #content-vue)`.
4. Talk nests a `#content-vue` inside `#content`. The nested one needs `position: relative; inset: auto; margin: 0; width: 100%; height: 100%`, or it double-offsets (nav at x=440).
5. Header menus position the `.header-menu__wrapper` (not `__content`): `position: fixed; top: var(--header-height); right`. Override to `top: auto; right: auto; left: calc(rail + 4px); bottom: 8px`. Notifications (701px tall), contacts and user menu then open beside the rail foot, fully on screen. Unified search is a centered modal and needs nothing.
6. ConectaMail: `resize.js` sets the iframe height to `innerHeight − top` = 892. With the 8px top margin the iframe ends 8px below the card and gets clipped (Task 5 fix: height from the card's bottom, or CSS `height: 100%`). Staging conectahml frames `webmail-staging.avuz.app`, which answers Task 12's question.

Checked OK: Painel, Drive, Talk, Calendário, Tarefas (board scrolls horizontally inside, as today), Mail, Configurações pessoais, expanded and collapsed. Not checked: Contatos, Formulários, dark theme, app sidebars (details pane), modals. Those are for Task 6.

### Task 1 — Collapsed-state persistence (PHP)
- [x] Failing PHPUnit test: for a logged-in user with `avuz_theme/rail_collapsed = '1'`, the listener provides initial state `rail_collapsed: true`. With no value it provides `false`. A guest page gets no state.
- [x] `lib/Listener/RailStateListener.php` listens on `BeforeTemplateRenderedEvent` (logged-in only). It reads `IUserConfig::getValueBool(uid, 'avuz_theme', 'rail_collapsed')` (`IConfig::getUserValue` is deprecated in 33) and provides `rail_collapsed`. Registered in `Application::register`.
- [x] Writes: the OCS endpoint `PUT …/config/users/avuz_theme/rail_collapsed` (provisioning_api `PreferencesController::setPreference`) returns 400 unless a `BeforePreferenceSetEvent` listener marks the value valid. `lib/Listener/RailPreferenceValidator.php` accepts only `'0'|'1'` for that key, so no custom route is needed. Tests cover the valid values, invalid values, other keys and other apps.
- [ ] Verify on staging (Task 7): a value saved by the OCS endpoint (stored as mixed) reads back through `getValueBool` without a type-conflict exception.

Local run, since there's no phpunit in the repo: `composer install` `vendor-bin/phpunit` into a scratch dir, then `phpunit --bootstrap <scratch>/bootstrap.php apps/avuz_theme/tests/Unit`. That scratch bootstrap requires the main checkout's `3rdparty/autoload.php` (the submodule is empty in worktrees) and then `apps/avuz_theme/tests/bootstrap.php`.

### Task 2 — Rail model (pure JS, unit-tested)
- [ ] `js/left-rail-model.mjs`, unit-tested in `tests/js/left-rail-model.test.mjs`. `splitApps(apps, availableHeight, itemHeight)` returns `{ visible, overflow }`. Overflow is non-empty only when the apps don't fit, and it reserves one slot for "Mais aplicativos". The active app always stays visible: if it would overflow, it swaps with the last visible one.
- [ ] `railLabels(collapsed)` returns the toggle `label`, `icon` and `ariaExpanded`.
- [ ] Tests cover: everything fits; overflow; active app in overflow; empty list.

### Task 3 — Rail rendering + toggle (`js/left-rail.js`)
- [ ] Runs only for logged-in pages at ≥1024px (`matchMedia`), and re-evaluates on change. Reads `loadState('core','apps')` and `loadState('avuz_theme','rail_collapsed')` through `OCP.InitialState`.
- [ ] Renders `<nav aria-label="Aplicativos">` inside `.header-start`, with these items:
  - the toggle `<button aria-expanded>`;
  - app `<a>` links (icon `<img>` from the entry, name `<span>`, `aria-current="page"` on the active one, a tooltip with the name when collapsed);
  - "Mais aplicativos", a `<button aria-haspopup="menu">` that opens a simple popover list.
- [ ] Toggle: flips `body.avuz-rail-collapsed`, then PUTs the state. On failure it keeps the UI state and logs a console warning. It doesn't revert.
- [ ] Recomputes `splitApps` on resize (rAF-throttled).
- [ ] Add it to `Application.php` next to `center-header`. `center-header.js` exits early when the rail is active.

### Task 4 — Rail CSS (`css/left-rail.css`)
- [ ] All rules sit inside `@media (min-width: 1024px)` and scope under `body.avuz-rail` (set by left-rail.js). Below 1024px, nothing changes.
- [ ] Layout:
  - `#header` becomes a fixed full-height column, 220px wide, or 72px when collapsed. `#content` gets margins `8px 8px 8px <rail>`.
  - The header-end widgets stack at the bottom, per Task 0's outcome.
  - The width transition is 200ms, and `prefers-reduced-motion` disables it.
- [ ] Use theming vars only (`--color-main-background`, `--color-primary-element`, …). Dark theme follows the existing `header.css` selectors.
- [ ] Apply the `--header-height` overrides from Task 0's list.

### Task 5 — ConectaMail frame fit
- [ ] Check that `apps/conectamail/js/resize.js` still fills the card with top offset 0 and the shifted left edge. Fix only if needed.

### Task 6 — Local state matrix
- [ ] Check the full matrix: expanded/collapsed × light/dark × few/many apps (overflow) × 1024/1440/1920 × <1024. Also keyboard-only, 200% zoom, and a reload that keeps the state.
- [ ] **Checkpoint:** screenshots to Patrick.

### Task 7 — Staging preview
- [ ] Hot-patch avuz_theme files on staging stack 8. Bust the cache by bumping the `avuz_theme` version in `info.xml`. Run php-fpm USR2 if PHP changed. Run the state matrix there.
- [ ] **Checkpoint:** Patrick approves, then merge into `avuz-customization` and build `:staging`. Prod rollout is a separate, gated step.

## Part 2 — ConectaMail embedded mode (webmail-avuz)

### Task 8 — Embedded helper
- [ ] Add `web/src/embedded.ts` exporting `isEmbedded()` (`window.self !== window.top`), with a test. `Login.tsx` imports it instead of its local copy.

### Task 9 — Search form as a component
- [ ] Failing test first:
  - submitting with scope "all folders" runs the all-folder search;
  - submitting with a folder opens that folder with the query;
  - clearing the input resets the search.
- [ ] Extract `<form className="search">` and its submit/clear logic from `Mailbox.tsx` into `components/SearchForm.tsx` (props: folders, current folder, the callbacks). Mailbox renders it in the topbar exactly as today.

### Task 10 — Embedded layout
- [ ] `Mailbox.tsx`: add the `embedded` class on `.app` when `isEmbedded()`. When embedded, render `SearchForm` at the top of the message-list column (under the folder title) instead of in the topbar.
- [ ] `Sidebar.tsx`: when embedded, hide `BrandHeader` and "Sair". Add a footer row with the "Caixa de e-mail" label, `user`, Contatos (gated by `contactsEnabled`) and Configurações, each 44px. Mailbox passes it the existing `setSettingsView` callbacks.
- [ ] `styles.css`: `.app.embedded` drops the `top` grid area above 800px. At ≤800px the topbar stays (☰ + search), with no email and no "Sair".
- [ ] Tests:
  - when embedded, the topbar is absent above 800px and the footer shows the address;
  - standalone renders as today (topbar present, "Sair" present).

### Task 11 — Gates + local check
- [ ] Run every webmail-avuz gate.
- [ ] Run `npm run dev`. Check standalone, and embedded through a local HTML page that iframes `localhost:5173`. Check light/dark, ≤800px and >800px.

### Task 12 — Staging
- [ ] Build `registry.avuz.app/admin/webmail-avuz:<sha>` and deploy it to staging stack 64 with `TAG=<sha>`. Open it inside the Avuz Conecta staging that frames ConectaMail staging. Confirm which stack that is first.
- [ ] Confirm that the Avuz Conecta logout ends the webmail session.
- [ ] **Checkpoint:** Patrick approves. Prod rollout is a separate, gated step.

## Done when

The spec's acceptance criteria 1–8 hold on staging, with evidence (screenshots + the matrix checklist) posted to Patrick.
