# Deck — in-app feature hints (contextual coach-marks)

**Status:** design approved 2026-09-10. Next: implementation plan.

## Problem

When we ship a new Deck feature, end-users don't discover it. A separate
"announcements" destination fails — users won't go there. We need the new
feature to announce *itself*, in context: a small dismissible popover anchored to
the actual new control, appearing while the user is in Deck near that feature,
with an optional "learn more" link.

## Goal

A **feature-hint** system in the Deck fork:
- A dismissible popover **anchored to a real UI control** (share toggle, folder
  "Novo painel", the assignee filter, ...).
- Appears **only when that control is on screen**, at most **one hint at a time**.
- Shown **once per user per revision** (dismissal persists across the user's
  devices).
- Optional **CTA** ("Saiba mais") linking to docs or an in-app route.
- **Dev places the anchor** in code; **admin edits the copy/link, toggles on/off,
  and "Republica" (bumps the revision)** from a settings panel — no deploy for
  those.

## Decisions (locked during brainstorming)

1. **Authoring:** dev anchors in code; admin edits text/link + enable + revision.
2. **Re-show:** dismissal is permanent per revision; bumping a hint's revision
   re-shows it once to everyone.
3. **Surfacing:** contextual — a hint shows only when its control is visible;
   never more than one popover at once (priority-ordered queue).

## Non-goals (v1)

- Cross-app generalization (build Deck-embedded, but keep the engine
  self-contained so it can be extracted to a shared lib later).
- Multi-step guided tours (this is single-feature callouts).
- In-app "jump to a specific tab" CTA — a URL suffices (it can point to an
  in-app route); no special navigation engine.

## Architecture

Four units with clear boundaries.

### 1. Hint registry (code) — src/featureHints.js

A static array, the source of the hint set + defaults: each entry
`{ id, revision, priority, defaultText, defaultLink, defaultCta }`.
`id` = stable key; `revision` = default (admin can bump); `priority` = lower
shows first when several are eligible. The registry holds default
copy/link/revision/priority. The *anchor* (which control) lives at the
`<FeatureHint>` usage, not here.

### 2. Anchor — `v-feature-hint="id"` directive

`src/directives/featureHint.js`. The dev places the directive on the target
element: `<NcActionButton v-feature-hint="'folder-create-board'" ... />`.

Rationale (grilling): a *wrapper* component that puts the control inside an
`NcPopover` trigger slot would restructure the DOM and break components that
require specific direct children — notably `NcActions`, which expects
`NcActionButton`/`NcActionCheckbox` as direct children (and several hinted
controls live exactly there: the folder "Novo painel" action, the share toggle).
A directive attaches a **controlled** popover to the element **by ref** without
restructuring the DOM, so it works inside `NcActions` and never alters the
control's own markup/behavior.

Behavior:
- `bind`/`inserted`: register `{ id, el }` with the hint store; start an
  IntersectionObserver on `el` so the hint counts as "on screen" only while the
  element is actually visible (not merely mounted/scrolled-off).
- The directive owns a single controlled popover (via `@nextcloud/vue`
  `NcPopover` mounted programmatically, or floating-ui) anchored to `el`, shown
  ONLY when the store's `activeId === id`. Content = effective text + optional CTA
  + "Entendi" dismiss.
- `unbind`: disconnect the observer, deregister, tear down the popover.

**Anchor to persistent, visible controls** (toolbar buttons, sidebar tabs/rows).
For a feature buried in a menu, put the directive on the **opener** (the `...`
menu button, the folder row, the Sharing tab) and word the hint as "no menu você
encontra X" — never anchor to a transient item that only exists while a menu is
open.

### 3. Eligibility engine — Vuex module store/featureHints.js

State: `registered` (ids currently mounted/visible), `seen` (`{id: revision}`
from user config), `overrides` (`{id: {enabled, text, link, revision}}` from
appconfig), `activeId` (the one hint currently allowed to show).

An `effectiveHint(id)` getter merges registry default (+) override
(`{text, link, cta, revision, enabled}`).

A hint is **eligible** iff: `enabled !== false` AND it is `registered` (visible)
AND `(seen[id] ?? -1) < effectiveRevision`. `activeId` = the eligible hint with
the lowest `priority` (ties broken by registry order). Recomputed when
`registered`/`seen`/`overrides` change. Only `activeId` renders its popover
(one-at-a-time).

Dismiss or CTA-click -> action `markSeen(id)` sets `seen[id] =
effectiveRevision`, persists (unit 4), recomputes `activeId`.

### 4. Persistence + admin config (backend)

**Per-user "seen"** reuses Deck's existing user config
(`ConfigController` + the `setConfig`/`config` store): a single key
`featureHintsSeen` holding `{ <id>: <revision> }`. Loaded via `loadState('deck',
'config')` on boot; written through the existing `setConfig` action. No new
per-user endpoint.

**Admin overrides** are instance-global, stored in Deck appconfig under
`featureHints` = `{ <id>: { enabled, text, link, revision } }` (JSON). A new OCS
controller `FeatureHintController` (admin-gated) exposes:
- `GET  /api/v1/feature-hints` -> merged list (registry defaults (+) overrides)
  for the admin panel; also delivered to every user's boot state (`initialState`)
  so the frontend has overrides without a round-trip.
- `PUT  /api/v1/feature-hints/{id}` (admin) -> `{ enabled?, text?, link?,
  revision? }` merged into the appconfig entry.
- Admin-check via the OCS controller's admin guard, mirroring other admin
  endpoints in the app.

### 5. Admin settings panel

A section in Deck's admin settings (extend `DeckAppSettings.vue` /
`lib/Settings/...` admin section): a table of hints (id + effective text), each
row editable — **text**, **link**, **enabled** toggle, and a **"Republicar"**
button that bumps `revision` (via the PUT). Reads from the boot state / GET;
writes via PUT.

## Data flow

1. Boot: `initialState` carries `config.featureHintsSeen` (per user) +
   `featureHints` overrides (instance). Store hydrates both.
2. A hinted control mounts -> `<FeatureHint>` registers its id -> engine
   recomputes `activeId`.
3. If this id is active -> popover shows anchored to the control.
4. User dismisses / clicks CTA -> `markSeen` -> `setConfig({ featureHintsSeen })`
   persists -> popover closes -> engine picks the next eligible hint.
5. Admin edits copy/link/enabled or clicks Republicar -> PUT -> appconfig updated
   -> (next boot for other users; the admin's own view can refetch).

## Edge cases

- **Control not on screen:** hint waits (registered only while mounted+visible).
- **Multiple eligible at once:** only the lowest-priority one shows; others wait.
- **Admin disables a hint:** it stops showing immediately for not-yet-seen users;
  already-seen users are unaffected.
- **Republicar after users dismissed:** revision bump makes `seen < revision`
  again -> shows once more.
- **User with config write disabled / offline:** `markSeen` still updates local
  store so it won't re-pop in the same session; persistence retries on next
  `setConfig`. A failed persist must not loop the popup.
- **Anchor removed in a later release** (control deleted): the registry entry is
  removed with it; a stale `seen` entry is harmless.

## Testing (behavior)

- Engine: eligible only when registered + `seen<revision` + enabled; `activeId`
  respects priority; one-at-a-time (second eligible waits); `markSeen` bumps seen
  to the effective revision and clears active.
- Effective-hint getter: override text/link/enabled/revision win over defaults;
  missing override falls back to defaults.
- `FeatureHint.vue`: renders the slot always; shows the popover only when its id
  is `activeId`; dismiss + CTA both call `markSeen`; CTA opens the link.
- Backend: `FeatureHintController` PUT is admin-only (403 for non-admin);
  persists into appconfig; GET returns merged defaults(+)overrides. Per-user seen
  round-trips through the existing config store.

## Files (deck fork apps/deck)

- `src/featureHints.js` (registry)
- `src/directives/featureHint.js` (`v-feature-hint` anchor directive)
- `src/store/featureHints.js` (engine) + registration in the root store
- `lib/Controller/FeatureHintController.php` (admin OCS)
- admin config read/write in a small service + `initialState` provider
- admin settings section (extend Deck admin settings) + its Vue
- `appinfo/routes.php` (the OCS routes), `appinfo/info.xml` version bump
- l10n: default pt_BR strings (fork + themes/avuz/apps/deck/l10n/pt_BR.json)
- First real usage: place `v-feature-hint` on the assignee-filter toolbar icon,
  the folder-row/menu opener for "Novo painel", and the Sharing tab/share toggle
  (proves the system on the features we just shipped; board-share must be merged
  into this branch first if we want to hint its toggle).

## Rollout

Ships via `scripts/deploy-deck.sh` with a version bump (frontend -> `?v=` must
move). Default: every hint enabled with revision 1 and pt_BR default copy; the
admin can retune per instance without a deploy.

## Grilling resolutions (2026-09-10)

Self-grill outcomes folded into the design above, plus notes the plan must honor:

- **Anchor = directive, not wrapper** (see unit 2) — a wrapper breaks
  `NcActions`-embedded controls; the directive attaches a controlled popover by
  ref without restructuring the DOM. Anchor persistent/visible elements; hint the
  opener for menu-buried features.
- **Per-user "seen" is a structured value.** `featureHintsSeen` is a map
  `{id: revision}`. Deck's config persistence must round-trip it — store it
  JSON-serialized if the config store is string-scalar per key; the plan verifies
  `ConfigController`/`setConfig` behavior for object values before relying on it.
- **Contextual reach is inherent, not a bug.** A user who never opens the UI area
  that hosts a feature will never see its hint (accepted with the contextual model
  over a forced tour). There is no "guaranteed reach"; email/announcement is the
  channel for that if ever needed.
- **Multi-tab staleness** — dismissing in one tab updates config; another open tab
  has a stale store and may re-show once until it reloads. Benign (dismiss again);
  not worth a cross-tab sync in v1.
- **Admin-overridden text is single-string / single-locale.** Tenants are
  single-locale (pt_BR), so an admin override is one string; no per-locale
  override matrix. Defaults ship translated; overrides do not.
- **`markSeen` must never loop the popup on a failed persist** — set local `seen`
  first (closes the popover immediately), then persist; a persist failure retries
  on the next `setConfig` and does not re-open the hint in the same session.
- **Testability boundary** — the engine (eligibility/priority/one-at-a-time/
  markSeen), the effective-hint merge, and the admin controller are unit-tested;
  the actual popover anchoring/visibility is verified on staging (DOM-level, not
  unit-tested).
- **Admin PUT is admin-only (403 otherwise); GET (admin panel) admin-only;** the
  per-user boot delivery of overrides rides `initialState` (non-sensitive:
  enabled/text/link/revision).
