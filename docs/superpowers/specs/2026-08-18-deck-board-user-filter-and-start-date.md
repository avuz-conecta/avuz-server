# Deck — All-Boards User Filter + Card Start Date — Design

**Date:** 2026-08-18
**Status:** Approved (grilled), ready to plan
**Fork:** `avuz-conecta/deck` (branch `avuz`) — version bump **1.17.15 → 1.18.0** (feature release; mandatory `?v` bust — memory `deck-js-cachebust-version-bump`)

## Decisions (locked in grilling)

1. **Group/team assignments count.** A user filter matches cards assigned directly to the user OR to a group/team the user belongs to (assignments resolve to members). Not direct-only.
2. **Candidate picker list = only users who have a card in the current user's visible boards** (derived from the summaries' expanded user sets). No instance-wide directory lookup.
3. **`startdate` is a full `datetime`** (mirrors `duedate`, carries a time). The ≤ check is therefore a strict timestamp compare — a same-day start whose *time* is after the due time is rejected. Accepted tradeoff.
4. **Date-bound UX:** the start picker is hard-capped at the due (`:max = duedate`) so you can't pick a start after the due; the due picker is unbounded (due-first works, no forced order). The backend `start ≤ due` check is the real gate and rejects the rare inversion (due dropped below an existing start) with a toast + revert.
5. **Start-date changes get their own activity event** ("changed start date"), never the due-date event, and have **no** reminder/CalDAV/"done" coupling.
6. **Small-teams assumption:** teams assigned to cards are small (≈5–30). This makes the client-side design (summary carries expanded member UIDs, filter + picker run client-side) cheap. If large groups (100+) ever get assigned to cards, revisit with a server-side board-match endpoint (out of scope now).

## Context

Two small, independent features requested before resuming the P-roadmap:

1. **Filter the "All Boards" (Todos os Painéis) overview by assigned user** — the fork-custom overview already filters boards by tag and due-date (`BoardFilterBar` + `BoardSummaryService` + `MatchingCardMapper`), and expands a board inline to show the cards matching the active filter. Add **user** as a third filter dimension on that same machinery.
2. **A first-class card Start Date** — cards have a first-class `duedate`; add a parallel optional `startdate` with a picker in the card sidebar and a badge on the card face. **Validation: when both are set, start date must be ≤ due date.**

Both mirror existing, well-understood code. No new architecture.

---

## Feature 1 — Filter All Boards by user

### Goal

On the All Boards overview, pick one or more users and:
- **1a.** show only boards that have at least one live card **assigned** to any picked user;
- **1b.** when such a board is expanded, its inline card list shows **only** the picked user(s)' cards.

OR semantics across picked users (a board/card matches if assigned to *any* of them), matching the existing tag filter.

### Design

**1a. Board-level filter**

- **Backend — `lib/Service/BoardSummaryService.php`:** `findForCurrentUser()` currently returns per board `{ boardId, tags, directTags, due }`. Add:
  - `users: {uid: string, displayName: string}[]` — the **expanded** distinct member set who "has" a card in that board: every direct user assignee (`deck_assigned_users` where `type = TYPE_USER`) **plus every member of any group (`TYPE_GROUP`) or team/circle (`TYPE_CIRCLE`) assigned to any live card in the board**, resolved via `IGroupManager` and `CirclesService` (both injected). Excludes archived/deleted cards. Display names resolved once here so the client needn't look them up.
  - Group/circle membership resolution is cached by NC's backends and bounded by the small-teams assumption (Decision 6); still, resolve each distinct assigned group/circle once per request, not per card.
- **Frontend — `src/store/main.js`:** add `boardUserFilter: []` state + `setBoardUserFilter` mutation (mirrors `boardTagFilter`). Clearing `matchingCards` on filter change must also fire on user-filter change.
- **Frontend — `src/components/boards/BoardFilterBar.vue`:** add a user `NcSelect` (`user-select`, multiselect) beside the tag select; bind to `boardUserFilter`; persist in the URL query alongside `tag`/`due` (add a `user` param). **The option list is the union of every visible board summary's `users`** (Decision 2) — deduped by uid — NOT the instance user directory.
- **Frontend — `src/helpers/boardFilters.js`:** `boardMatchesFilters(summary, { tags, due, users })` — a board matches when `users` is empty OR the picked uids intersect the uids in `summary.users`. The empty-all-filters short-circuit and the count logic in `Boards.vue`/`BoardItem.vue` extend to include `users`.
- **Frontend — `src/components/boards/BoardItem.vue`:** `hasActiveFilter` becomes `tagFilter.length > 0 || dueFilter !== '' || userFilter.length > 0`; add a watcher on `boardUserFilter` that calls `refetchIfExpanded()`.

**1b. Expanded cards scoped to the user**

- **Backend — `lib/Db/MatchingCardMapper.php` + its service:** the query behind `loadMatchingCards` already joins `deck_assigned_labels` for the tag filter. Add an assignee constraint driven by the picked uids. Because a card can match a user via a group/team, resolve **each picked user's own memberships server-side** — `{ (uid, TYPE_USER) } ∪ { (groupId, TYPE_GROUP) for each of the user's groups } ∪ { (circleId, TYPE_CIRCLE) for each of the user's circles }` — then `INNER JOIN deck_assigned_users au ON au.card_id = c.id` where `(au.participant, au.type)` is IN that resolved set. `SELECT DISTINCT c.*` so a card assigned to the user via two memberships isn't duplicated. No user filter active → query unchanged.
- **Wiring:** `loadMatchingCards` (store action) and its controller/service pass the active `boardUserFilter` through. The expanded list then shows only cards matching **all active dimensions** (tags AND due AND assignee), consistent with how tag+due already compose.

**Decision — expanded cards filter on the fetch (server), not the returned list.** The endpoint already applies tag/due server-side; adding the assignee join keeps one filter path and avoids fetching then discarding cards.

### Edge cases (Feature 1)

- A board where the user is a **board member but has no assigned card** (directly or via a group/team) does NOT match — the filter is card-assignment based, not membership based.
- **Group/team assignment matches its members** (Decision 1): a card assigned to team "Comercial" matches every Comercial member in both the board filter (via expanded `summary.users`) and the expand query (via the picked user's resolved memberships). A member appearing in the picker despite never being *directly* assigned is intended.
- Archived/deleted cards excluded from both the summary `users` and the expanded list (match the existing tag/due card scope).
- A user assigned to a card via two paths (direct + group) must appear once in the picker and their card once in the expand (`DISTINCT`).
- Selecting a user with zero matching boards → empty overview + the existing "no boards match" count/messaging.
- URL round-trip: a shared/bookmarked URL with `user=` rehydrates the filter like `tag`/`due`. A `user=` uid no longer present in any summary is silently dropped.

---

## Feature 2 — Card Start Date

### Goal

An optional first-class `startdate` on a card, set via a sidebar picker (clone of the due-date selector) and shown as a badge on the card face (clone of the due-date badge). Always clearable, never required. **When both `startdate` and `duedate` are set, `startdate` ≤ `duedate`.**

### Design

- **Migration — `lib/Migration/VersionNNNNDate...php`:** add column `deck_cards.startdate` (`Type::DATETIME`, nullable, `hasColumn` guard). Mirrors the existing `duedate` column.
- **Entity — `lib/Db/Card.php`:** `protected $startdate;` + `$this->addType('startdate', 'datetime');` (mirrors `duedate` at line 85/113). Serialized in `jsonSerialize` via the base entity like `duedate`.
- **Service/Controller — the card update path** (`CardService::update` and the controller signature the sidebar calls): accept and persist `startdate` alongside `duedate`. **Do NOT reuse the due-date activity/reminder path** (Decision 5): setting/clearing `startdate` must fire a **new** activity subject (e.g. `ActivityManager::SUBJECT_CARD_UPDATE_STARTDATE`, "changed start date", with translations), and must not touch reminders, CalDAV, or the "done" flag. Emit the start-date event only when `startdate` actually changed.
- **Frontend selector — `src/components/card/StartDateSelector.vue`:** clone of `DueDateSelector.vue` — `NcDateTimePickerNative` bound to a `startdate` computed whose setter dispatches the card update; "Add start date" / clear affordances; no "done/completed" coupling (that's due-date-only). **`:max` bound to the card's `duedate` when set** (Decision 4) so a start can't be picked after the due. Mounted in `CardSidebarTabDetails.vue` directly above the due-date selector. The due-date selector is left **unbounded** by start (no `:min`) so due-first still works.
- **Frontend badge — `src/components/cards/badges/StartDate.vue`:** clone of `badges/DueDate.vue`, rendered from `CardBadges.vue` when `card.startdate` is set. Neutral styling (no overdue colouring — start date has no overdue semantics).

### Validation — start date ≤ due date

Strict timestamp compare (Decision 3): with both set, `startdate` must be `<=` `duedate` to the second.

- **Backend (the gate) — `CardService::update`:** if both `startdate` and `duedate` are non-null and `startdate > duedate`, throw `BadRequestException` (translated, e.g. "A data de início não pode ser posterior à data de conclusão"). Fires whichever side is being set — a late start OR a due dropped below an existing start. A service test covers **both directions** plus the allowed cases (equal, either-null).
- **Frontend (guidance) — Decision 4:** the start picker is hard-capped (`:max = duedate`) so the common mistake (start after due) can't be entered at all. The due picker is **not** floored by start, so due-first and "shift the due earlier" both work; if that drops due below an existing start, the backend rejects → `showError` with the backend message + optimistic revert (the reject pattern used elsewhere). The backend check remains authoritative for any path the bounds don't cover (API clients, the due-below-start case).

### Edge cases (Feature 2)

- Only one date set → no constraint.
- Clearing either date → allowed, clears the constraint.
- `startdate === duedate` → allowed (≤, not <).
- Timezone/persistence: store and compare exactly as `duedate` is handled (same `datetime` type + serialization), so no new tz logic.
- Existing cards: `startdate` is null after migration; nothing to backfill.

---

## Non-goals

- A **server-side** board-match endpoint for large groups (Decision 6 — only needed if 100+ groups get assigned; not now).
- Start date on the calendar/CalDAV export, reminders, timeline, or dashboard widgets (sidebar picker + card badge only).
- Sorting boards/cards by start date, or a start-date filter dimension on the board (kanban) view.
- Board-membership-based filtering (explicitly card-assignment based, incl. group/team members).
- Duration/auto-scheduling between start and due.

## Testing

**Feature 1**
- `boardFilters.spec.js`: `boardMatchesFilters` — user dimension (match on uid intersection, OR across users, empty = pass-through, combines with tags/due).
- `BoardSummaryService` (PHP): summary `users` includes direct assignees **and** members of assigned groups/teams (expanded), deduped; excludes archived/deleted cards; scoped to visible boards; carries display names.
- `MatchingCardMapper` (PHP `@group DB`): with a user filter, returns only cards assigned to the picked user **directly or via a group/team they belong to** (resolved memberships), `DISTINCT`; without it, unchanged.
- Store: `setBoardUserFilter` mutation + URL round-trip (incl. dropping a stale uid).

**Feature 2**
- `CardService` (PHP): rejects `startdate > duedate` in **both** directions (late start; due dropped below start); accepts equal and either-null; persists a valid start date; fires the start-date activity **only** on change and **not** the due-date event.
- Migration adds the column (guarded).
- Frontend: `StartDateSelector` sets/clears via dispatch and caps `:max` at `duedate`; badge renders when set.

## Deployment

- Version bump **1.18.0** (mandatory `?v` bust). Migration runs on boot (adds `deck_cards.startdate`). Rebuild `js/`, commit bundle + submodule bump, build staging (amd64), deploy, expect the ~3–5 min php-fpm 502 window, then live-verify: (1) All Boards user filter narrows boards + scopes expanded cards; (2) start-date picker + badge; (3) start > due rejected with the toast.
