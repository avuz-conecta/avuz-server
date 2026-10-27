# Left rail navigation + embedded webmail — design

Date: 2026-10-20 · Status: draft · Design canvas: https://claude.ai/artifact/Qp1q5eV6bmT1pLk5vizLL6 (artboard F)

## Problem

Opening ConectaMail inside Avuz Conecta stacks two headers: the Avuz Conecta app bar (64px) and the webmail's own bar (logo, folder + search pill, contacts, settings, mailbox email, "Sair"). 128px of chrome, a duplicate logo, and a second logout that only ends the webmail session.

## Decision

Option F from the canvas, in two independent parts:

1. **Avuz Conecta:** the top app bar becomes a left rail, expanded (220px, icon + label) or collapsed (72px, icon only). The user's choice persists.
   - **Revised 2026-10-26:** icons only, for now. Patrick asked for the rail always collapsed (72px), with no toggle. Each app's name is its tooltip and stays in the link for screen readers; the "Mais aplicativos" list stays labelled. The toggle, the expanded layout and the saved `rail_collapsed` preference (listener, validator, OCS save) are gone; restore them from git history if the toggle comes back. Saved values stay in `oc_preferences`, unread.
2. **Webmail (ConectaMail only, not the Roundcube fork):** when framed inside Avuz Conecta, it hides its top bar. Search moves atop the message list. Mailbox email, contacts and settings move to the folder column footer. "Sair" and the ConectaMail logo go away.

Each part ships alone. Part 2 removes the double header even with the old top bar; part 1 helps every app.

## Non-goals

- Phones and tablets. Below 1024px the current top header stays as is.
- Changing app order or visibility. The rail shows the same apps, in the same order, as today's header (`core/apps` initial state, which already honors the user's order from Theming settings).
- Restyling the app pages themselves (Drive, Deck, Talk…), beyond fixing offsets the move breaks.
- Mail search in the Avuz Conecta chrome (options B/E). Search stays inside the webmail.

## Part 1 — Avuz Conecta left rail

### Anatomy (top to bottom)

| Slot | Expanded | Collapsed |
|---|---|---|
| Toggle | double chevron `«` + "Recolher menu" | `»` only, `aria-label="Expandir menu"` |
| Apps | icon + name, active app = surface pill + 4px left marker in `--color-primary-element` | icon only, same active marker; name in a tooltip |
| Overflow | "Mais aplicativos" opens a popover with the apps that don't fit the height | same |
| Spacer | — | — |
| Unified search | icon + "Pesquisar" | icon |
| Notifications | icon + "Notificações" + unread badge | icon + badge |
| Contacts menu | hidden (Contatos is in the rail) | hidden |
| User menu | avatar + display name + "Perfil e sair" | avatar |

No logo tile. The home link stays reachable as the "Painel" (dashboard) entry. The contacts menu keeps its current behavior; the user menu covers everything else.

### Behavior

- **Toggle** flips between expanded and collapsed and animates width (200ms; `prefers-reduced-motion` disables it).
- **Persistence:** stored per user in user config `avuz_theme / rail_collapsed` via `POST ocs/v2.php/apps/provisioning_api/api/v1/config/users/avuz_theme/rail_collapsed`. The server injects the value as initial state so the first paint has the right width (no flash). Default: expanded.
- **Default (revised 2026-10-21):** expanded on every screen width. No narrow-screen auto-collapse: Patrick reviewed it on staging-3 and wants the saved choice everywhere, expanded until the user collapses it.
- **Icon column:** app icons, the toggle, "Mais aplicativos" and the foot widgets all center at 36px from the left edge, expanded or collapsed, so nothing shifts when the rail toggles.
- **Overflow:** the rail computes how many apps fit its height; the rest go to "Mais aplicativos". Today's AppMenu computes this from width, so the rail renders its own list instead of reusing core's AppMenu.
- **Content offset:** `#content` starts after the rail on the left and at the top of the page. Every place core and apps use `--header-height` for a top offset (app-navigation, sidebars, modals, popover max-heights) must look right with no top bar. The plan audits these.
- **Breakpoint:** at <1024px viewport width, the rail hides and core's top header comes back unchanged.

### Implementation shape

Inside `apps/avuz_theme`, no core file edits:

- `js/left-rail.js`: builds the rail `<nav>` from `loadState('core','apps')` and the `avuz_theme/rail_collapsed` initial state. It renders inside `#header`, which becomes a fixed left column. Core's `#header-start__appmenu` is hidden. The `.header-end` widgets (unified search, notifications, contacts, user menu) are Vue mounts: CSS restacks them vertically at the rail's foot. They don't get re-implemented.
- `css/left-rail.css` holds the rail layout, the states, dark theme (theming vars only, per `docs/design-system`), and the `--header-height` overrides.
- A listener/initial-state provider for `rail_collapsed`.
- `center-header.js` and the centering rules in `header.css` retire when the rail is active (≥1024px).

The spike settled this (2026-10-20). The header-end widgets work stacked in the rail, with their menus re-anchored beside the rail foot, so no fallback strip is needed. The CSS facts are in the plan, under the Task 0 findings.

### Accessibility

- The rail is `<nav aria-label="Aplicativos">`. App entries are links with visible names (expanded) or `aria-label` + tooltip (collapsed). The active entry gets `aria-current="page"`.
- The toggle is a `<button>` with `aria-expanded` and an action label ("Recolher menu" / "Expandir menu").
- Every target is ≥44px. Focus stays visible. Skip links still land on `#app-content` / `#app-navigation`.
- Contrast is AA in light and dark.

## Part 2 — Webmail embedded mode (ConectaMail only)

Scope: the new webmail, repo `avuz-conecta/webmail-avuz` (React + Vite, `web/src`). The Roundcube fork that the other tenants still frame stays untouched.

- **Detection:** `window.self !== window.top`. `Login.tsx` already uses this check, and the server's CSP `frame-ancestors` (`server/src/security-headers.ts`) limits framing to Avuz Conecta. Extract it to a shared helper (e.g. `web/src/embedded.ts`). `Mailbox.tsx` adds an `embedded` class on `.app`. No change in `apps/conectamail`.
- **Hidden when embedded, above 800px** (the webmail's mobile breakpoint): the whole `header.topbar` in `Mailbox.tsx` (search form, contacts, settings, `user-email`, "Sair"), and `BrandHeader` in `Sidebar.tsx`. The grid's `top` area collapses.
- **Moved:**
  - Search: the same `<form className="search">` (FolderPicker scope + input + submit logic) renders at the top of the message-list column, under the folder title. One component, two slots. The submit logic leaves `Mailbox.tsx` inline code and becomes a shared handler, not a copy.
  - Mailbox email + contacts + settings: a footer row at the bottom of `Sidebar` ("Caixa de e-mail" label, address, Contatos + Configurações icon buttons, 44px each). Contatos keeps its `contactsEnabled` gate.
- **"Sair":** hidden in embedded mode, including the mobile `sidebar-logout`. The Avuz Conecta logout already ends the webmail session (`apps/conectamail` `UserLoggedOutListener`). Verify this during the work.
- **≤800px embedded:** keep the mobile topbar (☰ + search), since the sidebar still needs its toggle. Hide only "Sair" and the email.
- **Standalone** (conectamail.avuz.app opened directly): pixel-identical to today.
- **Avuz Conecta side:** `apps/conectamail/js/resize.js` sizes the iframe from its own top offset. With the rail that offset becomes 0. Check that it still fills the card.
- **Deploy:** staging stack 64 (`deploy/stack.yml`), image `registry.avuz.app/admin/webmail-avuz:<sha>`, always tagged by commit. Prod gated.

## Acceptance criteria

1. ≥1024px: no top bar. The rail is on the left in every app (Painel, Drive, Talk, Agenda, E-mail, Tarefas, Assinaturas, settings pages).
2. Toggle works. Reloading keeps the state. A second browser shows the same state for the same user.
3. Apps beyond the rail height land in "Mais aplicativos". None are lost.
4. Search, notifications, contacts and user-menu popovers open fully visible and usable from the rail.
5. ConectaMail inside Avuz Conecta: one chrome. Webmail search sits atop the list. Account/settings sit in the folder footer. No "Sair".
6. ConectaMail standalone looks exactly as before.
7. <1024px: everything looks as it does today.
8. Light and dark themes, keyboard-only navigation, 200% zoom: all usable.

## Verification

Follow the UI hot-patch loop. Check the full state matrix locally (expanded/collapsed × light/dark × apps list short/long × viewport 1024/1440/1920 × <1024). Preview on default staging (avuz-conecta, stack 8) via hot-patch. Build the image only after approval. Prod stays gated.

## Risks

- **Core layout assumptions:** some app or modal may hard-code a top offset. Mitigation: the plan audits `--header-height` / `$header-height` uses and checks each first-party app.
- **Upstream upgrades:** header markup changes on NC upgrades can break the rail. Mitigation: add the rail to the upgrade-verify checklist.
- **Two repos** (part 2): coordinate deploys. Each part works alone, so order doesn't matter.
- **Roundcube tenants:** tenants still on Roundcube keep the double header until they move to ConectaMail. Accepted.
