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
- [x] Writes: the OCS endpoint `POST …/config/users/avuz_theme/rail_collapsed` (provisioning_api `PreferencesController::setPreference`) returns 400 unless a `BeforePreferenceSetEvent` listener marks the value valid. `lib/Listener/RailPreferenceValidator.php` accepts only `'0'|'1'` for that key, so no custom route is needed. Tests cover the valid values, invalid values, other keys and other apps.
- [ ] Verify on staging (Task 7): a value saved by the OCS endpoint (stored as mixed) reads back through `getValueBool` without a type-conflict exception.

Local run, since there's no phpunit in the repo: `composer install` `vendor-bin/phpunit` into a scratch dir, then `phpunit --bootstrap <scratch>/bootstrap.php apps/avuz_theme/tests/Unit`. That scratch bootstrap requires the main checkout's `3rdparty/autoload.php` (the submodule is empty in worktrees) and then `apps/avuz_theme/tests/bootstrap.php`.

### Task 2 — Rail model (pure JS, unit-tested)
- [x] `js/left-rail-model.js` is a classic script exposing `window.AvuzLeftRail`. It isn't an `.mjs`: a relative module import would skip NC's `?v=` cache buster. Unit-tested in `tests/js/left-rail-model.test.mjs` through `vm`. `splitApps(apps, availableHeight, itemHeight)` returns `{ visible, overflow }`:
  - overflow is non-empty only when the apps don't fit, and "Mais aplicativos" then takes one slot;
  - the active app takes the last visible slot when it would overflow;
  - with no room at all, every app goes to overflow, so none is lost.
- [x] `railToggle(collapsed)` returns `{ label, ariaExpanded, direction }`.
- [x] Tests cover: everything fits; overflow; partial slot; active app in overflow; active app already visible; only the "Mais" slot fits; empty list; no room.

### Task 3 — Rail rendering + toggle (`js/left-rail.js`)
- [x] Renders on every logged-in page (`body#body-user` with the `rail_collapsed` state). No `matchMedia`: the ≥1024px switch lives in CSS (Task 4), so the layout never waits on JS. The script reads the `initial-state-core-apps` / `initial-state-avuz_theme-rail_collapsed` inputs and decodes the base64 as UTF-8.
- [x] Renders `<nav id="avuz-rail" aria-label="Aplicativos">` inside `.header-start`, with these items:
  - the toggle `<button aria-expanded>`;
  - app `<a>` links (icon `<img alt="">`, name `<span class="avuz-rail__label">`, `aria-current="page"` on the active one, a `title` tooltip only when collapsed);
  - "Mais aplicativos", a disclosure `<button aria-expanded aria-controls>`. No `aria-haspopup`, since it isn't a menu widget. It opens `ul#avuz-rail-overflow` and focuses the first link. Escape closes it and returns focus; a click elsewhere also closes it.
- [x] Toggle: flips `html.avuz-rail--collapsed`, then POSTs `configValue=0|1` (OCS-APIRequest + requesttoken). On failure (network or non-2xx) it keeps the UI state and logs a console warning. It doesn't revert.
- [x] Recomputes `splitApps` on resize (rAF-throttled). Item height is 44px.
- [x] Registered in `Application::boot` after `center-header` (the model first). `center-header.js` stays: it still centers the top header below 1024px, and above that `#nextcloud` is hidden by CSS anyway.
- [x] Tests: `tests/js/left-rail.test.mjs` (jsdom from the root `node_modules`), 17 behaviors.

### Task 4 — Rail CSS (`css/left-rail.css`)
- [x] Everything sits inside `@media (min-width: 1024px)`, scoped to `body#body-user`. No JS class gates the layout, so it never waits on a script. Outside the media query there's only `#avuz-rail { display: none }`, guarded by `tests/js/left-rail-css.test.mjs`.
- [x] Layout:
  - `#header` is a fixed column, 220px wide, or 72px when collapsed. `.header-start` stretches. `#nextcloud`, `#header-start__appmenu` and core's `nav.app-menu` (Vue replaces the placeholder and drops its id) are hidden.
  - `.header-end` stacks at the foot, and `.header-menu__wrapper` is re-anchored beside the rail.
  - `body > :is(#content, #content-vue)` is offset by the rail; the nested Talk container is reset.
- [x] Width transitions only run under `html.avuz-rail--animated`, which the toggle adds, so a saved collapsed state never animates on load. `prefers-reduced-motion` disables them.
- [x] Theming vars only. Dark: app icon `<img>`s get `filter: var(--background-invert-if-dark)`, like header.css does.
- [x] Staging hot-patch check (conectahml, 1440×900 and 1440×560, 900×700):
  - all apps fit at 900px tall; at 560 there are 4 + "Mais aplicativos", with the popover beside the rail, on top, focus on its first app;
  - collapse/expand works, the save returns 200 (junk value 400), and the state persists across reloads;
  - <1024 shows the stock top header.
- [ ] Dark theme not checked: staging forces light. Do it in Task 6.

Hot-patch state on staging stack 8, live until the container is recreated. The 5 new avuz_theme files plus a patched `lib/AppInfo/Application.php` were added (the original is kept as `Application.php.pre-rail`; staging runs an older avuz_theme, so the branch's Application.php can't be copied over). To revert: `cp Application.php.pre-rail Application.php`, php-fpm USR2, `occ theming:config name "Avuz Conecta"`.

### Task 5 — ConectaMail frame fit
- [x] Root cause: `apps/conectamail/js/resize.js` sized the iframe to `innerHeight − frame top`. That ignores the card's bottom margin, so the iframe ran 8px past the card and got clipped, under the old top header as well. It now fills down to the bottom of the closest `#content`/`#content-vue`, falling back to the window when neither is found.
- [x] `apps/conectamail/tests/js/resize.test.mjs` (jsdom) covers: rail layout, top-header layout, the `#content-vue` container, and resize.
- [x] Staging hot-patch (`resize.js`, original kept as `resize.js.pre-rail`): frame 8→892 = card 8→892 at 1440×900.

### Task 6 — State matrix (run on staging hot-patch, 2026-10-20)
Instead of a local NC, this ran on staging conectahml with the Task 4/5 hot-patch.

| Check | Result |
|---|---|
| Expanded / collapsed, reload keeps state | ✅ |
| Few apps (900px tall) / overflow (560px): 4 + "Mais aplicativos", active app kept | ✅ |
| Overflow popover: beside rail, on top, focus to first app, Escape/outside click close | ✅ (Escape/outside in jsdom tests) |
| 1440×900: Painel, Drive, Talk, Calendário, Tarefas, Mail, Contatos, Formulários, Configurações | ✅ nothing under the rail |
| Drive details sidebar | ✅ inside the card, full height |
| Dialog (Drive settings) | ✅ mask covers the rail (z 9998 > 2000) |
| Header-end menus (search modal, notifications, contacts, user menu) | ✅ beside the rail foot |
| Mail iframe fits the card | ✅ 8→892 = card |
| <1024px (900×700) | ✅ stock top header, rail hidden |
| 1024×768 | ⚠️ works, no horizontal scroll, but cramped: 796px of content, Talk main 496px |
| Dark (emulated in-page: staging has `enforce_theme=light` system-wide, so no setting was changed) | ✅ rail text 12.2:1, toggle 8.4:1, app icons inverted, dark pill |
| Keyboard | ✅ skip links → toggle → apps; 2px focus ring |
| 200% zoom | ℹ️ 1440 at 200% = 720 CSS px, below 1024, so it gets the stock top header (core's mobile layout); expected |

Open points:
- [ ] **1024–1279px:** the expanded rail takes 220px of a small screen. Proposal: below 1280px, show the rail collapsed without saving it, unless the user expands it in that session. Patrick decides.
- [ ] The dark-theme bell and contacts glyphs are dim images. Today's top bar has the same widgets and CSS, so this isn't from the rail; it's a possible follow-up.
- [ ] 1920 wide not checked; low risk (more room).

### Task 7 — Staging build (2026-10-20, approved by Patrick)
- [x] Local `avuz-customization` was 23 behind origin. Fast-forwarded it, then `merge --no-ff feat/left-rail-nav` → `f7390d7dd6e` (not pushed). Merged tree: 67 PHP + 109 JS tests pass.
- [x] Stack 8 pulls **`avuzconecta:staging-1`**; plain `:staging` has no consumer (46 = `-2`, 63 = `-3`). Built with `build-push.sh latest staging 1` → `sha256:db25317f…`. Portainer's pull no-op'd, so I auth-pulled on endpoint 3 and then recreated.
- [x] Container `avuz-conecta-app-1` image is `db25317f1345`, healthy. Files match the merged tree, and the pulled commits are present. Browser at 1440×900: rail with 9 apps, server state `rail_collapsed=false`, Mail frame 8→892 = card.
- [ ] Not done: push `avuz-customization`; prod rollout (gated).

## Part 2 — ConectaMail embedded mode (webmail-avuz)

### Task 8 — Embedded helper
- [x] `web/src/embedded.ts` exports `isEmbedded(frameWindow = window)`, tested. `Login.tsx` imports it instead of its local copy. Commit `afddb0b` on webmail-avuz `feat/embedded-mode` (worktree `.claude/worktrees/embedded-mode`, off `origin/main` 5cbed75).

### Task 9 — Search form as a component
- [x] The submit/clear decisions moved to pure `web/src/search-submit.ts` (`planSearchSubmit`, `planSearchInputChange`), with 9 behavior tests. The repo tests pure modules only and doesn't render components.
- [x] `components/SearchForm.tsx` renders the form, and `Mailbox.tsx` uses it in the topbar as before. `ALL_FOLDERS` moved to `search-scope.ts`: the root test runner compiles JSX in classic mode, so a pure module can't import a `.tsx`. The input also gained `aria-label="Pesquisar e-mails"`. Commit `f121408`. Gates: 849 tests, tsc and `vite build` all pass.

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
- [x] Built `registry.avuz.app/admin/webmail-avuz:9c091df` (`sha256:0900787b…`) from `feat/embedded-mode`. Stack 64 `TAG` went f0c4a5e → 9c091df (only that env changed; **rollback = TAG f0c4a5e**). The container was recreated. `/api/health` returns 200, and the live bundle contains the account footer and the `mailbox-account` styles.
- [x] Opened directly (conectamailhml), it shows the standalone login, not embedded.
- [x] Embedded check through staging-3 (conectahmls3, under the old top bar; stack 63 has no rail):
  - 1440×900: a single header (Avuz Conecta's). No ConectaMail brand or bar, no "Sair". "Novo e-mail" sits at the top of the folder column, the search ("Caixa de entrada ▾ | Pesquisar e-mails") in the list header, and the "Caixa de e-mail" footer shows the address + Contatos + Configurações.
  - 780×800 (iframe ≤800): the top bar keeps only ☰ + search; the address, icons and "Sair" are gone; the list-header search is hidden (no duplicate).
  - SSO for this user failed server-side: Zoho IMAP `mail_login_failed` with the stored credentials. This is unrelated to the layout; Patrick logged in with the mailbox password.
- [ ] Interactive checks inside the frame need a person. The built-in browser's synthetic clicks don't reach the cross-origin iframe (even opening a message did nothing), while resize and screenshots do. Still to do: the footer Contatos/Configurações buttons open their dialogs; a search submitted from the list header (folder and "Todas as pastas"); the all-folder results keep the field.
- [ ] Confirm that the Avuz Conecta logout ends the webmail session.
- [ ] **Checkpoint:** Patrick approves. Prod rollout is a separate, gated step.

## Done when

The spec's acceptance criteria 1–8 hold on staging, with evidence (screenshots + the matrix checklist) posted to Patrick.

## Adjustments after Patrick's review (2026-10-21, staging-3 hot-patch)
- [x] Expanded by default on every screen: reverted the <1280px auto-collapse (`b7785c8a561`). Toggles always save.
- [x] Foot widgets were off-center and moved on collapse. A single 36px icon column (`--avuz-rail-icon-center`) now covers the app icons, toggle, "Mais aplicativos" and the foot widgets (`.header-end` left-aligned, padded to the column). Core's global `button` rule was overriding the toggle's padding, margin and width; an id-scoped rule fixes that. Measured at 1100×800: every icon center is x=36 in both states.
- [x] Contacts icon removed from the foot (`#contactsmenu` hidden in rail mode; the Contatos app is in the rail).
- [x] Patrick approved. Merged into `avuz-customization` (`ae92937b3cf`, pushed).
  - `:staging-1` = `sha256:8c597a62…` (from `ae92937b3cf`) → stack 8.
  - `:staging-3` = `sha256:fe29c06f…`, built from a local throwaway merge of `avuz-customization` + `claude/webmail-logout-session-139a32` (avuz-server#23, still open), so staging-3 keeps the logout fix for Bri's QA → stack 63.
  - Both containers were recreated (auth pull) and are healthy. At 1100×800 on both: expanded on load; toggle, apps and foot all at x=36 in both states; contacts hidden. On 63 the Mail frame fits its card and shows the embedded webmail.
  - Once #23 merges, a plain `avuz-customization` build serves `:staging-3` again.
- [ ] Cosmetic, webmail: at ~1100px the footer label "Caixa de e-mail" wraps onto 2 lines and the address truncates (narrow folder column).

