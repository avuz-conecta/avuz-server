# Deck — All-Boards User Filter + Card Start Date — Design

**Date:** 2026-08-18
**Status:** Approved, ready to plan
**Fork:** `avuz-conecta/deck` (branch `avuz`) — version bump **1.17.15 → 1.18.0** (feature release; mandatory `?v` bust — memory `deck-js-cachebust-version-bump`)

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

- **Backend — `lib/Service/BoardSummaryService.php`:** `findForCurrentUser()` currently returns per board `{ boardId, tags, directTags, due }`. Add `users: string[]` — the distinct participant UIDs (`deck_assigned_users.participant` where `type = Assignment::TYPE_USER`) assigned to any non-archived, non-deleted card in that board. One aggregate query joining `deck_cards` → `deck_assigned_users`, scoped to the boards the current user can see (same board scope the tag/due aggregation already uses). Update the method's return-shape docblock.
- **Frontend — `src/store/main.js`:** add `boardUserFilter: []` state + `setBoardUserFilter` mutation (mirrors `boardTagFilter`). Clearing `matchingCards` on filter change must also fire on user-filter change.
- **Frontend — `src/components/boards/BoardFilterBar.vue`:** add a user `NcSelect` (multiselect of assignable users, `user-select`) beside the tag select; bind to `boardUserFilter`; persist in the URL query alongside `tag`/`due` (add a `user` param). Reuse the user list source the board/card assignee pickers already use (`AssignmentSelector` / the board's `users`).
- **Frontend — `src/helpers/boardFilters.js`:** `boardMatchesFilters(summary, { tags, due, users })` — a board matches when `users` is empty OR `summary.users` intersects `users`. The empty-all-filters short-circuit and the count logic in `Boards.vue`/`BoardItem.vue` extend to include `users`.
- **Frontend — `src/components/boards/BoardItem.vue`:** `hasActiveFilter` becomes `tagFilter.length > 0 || dueFilter !== '' || userFilter.length > 0`; add a watcher on `boardUserFilter` that calls `refetchIfExpanded()`.

**1b. Expanded cards scoped to the user**

- **Backend — `lib/Db/MatchingCardMapper.php`:** the query behind `loadMatchingCards` already joins `deck_assigned_labels` for the tag filter. Add an optional assignee constraint: when a user filter is active, `INNER JOIN deck_assigned_users au ON au.card_id = c.id AND au.type = TYPE_USER AND au.participant IN (:users)`. When no user filter is active, behaviour is unchanged.
- **Wiring:** `loadMatchingCards` (store action) and its controller/service pass the active `boardUserFilter` through to `MatchingCardMapper`. The expanded list then shows only cards matching **all active dimensions** (tags AND due AND assignee), consistent with how tag+due already compose.

**Decision — expanded cards filter on the fetch (server), not the returned list.** The endpoint already applies tag/due server-side; adding the assignee join keeps one filter path and avoids fetching then discarding cards.

### Edge cases (Feature 1)

- A board where the user is a **member but has no assigned card** does NOT match (the request is card-assignment based, per the approved decision).
- Group/circle assignments: scope to `type = TYPE_USER` for v1 (direct user assignments only); group-membership expansion is out of scope.
- Archived/deleted cards excluded from both the summary `users` and the expanded list (match the existing tag/due card scope).
- Selecting a user with zero matching boards → empty overview + the existing "no boards match" count/messaging.
- URL round-trip: a shared/bookmarked URL with `user=` rehydrates the filter like `tag`/`due`.

---

## Feature 2 — Card Start Date

### Goal

An optional first-class `startdate` on a card, set via a sidebar picker (clone of the due-date selector) and shown as a badge on the card face (clone of the due-date badge). Always clearable, never required. **When both `startdate` and `duedate` are set, `startdate` ≤ `duedate`.**

### Design

- **Migration — `lib/Migration/VersionNNNNDate...php`:** add column `deck_cards.startdate` (`Type::DATETIME`, nullable, `hasColumn` guard). Mirrors the existing `duedate` column.
- **Entity — `lib/Db/Card.php`:** `protected $startdate;` + `$this->addType('startdate', 'datetime');` (mirrors `duedate` at line 85/113). Serialized in `jsonSerialize` via the base entity like `duedate`.
- **Service/Controller — the card update path** (`CardService::update` and the controller signature the sidebar calls): accept and persist `startdate` alongside `duedate`. Follow whatever shape `duedate` already takes through that path so no consumer regresses.
- **Frontend selector — `src/components/card/StartDateSelector.vue`:** clone of `DueDateSelector.vue` — `NcDateTimePickerNative` bound to a `startdate` computed whose setter dispatches the card update; "Add start date" / clear affordances; no "done/completed" coupling (that's due-date-only). Mounted in `CardSidebarTabDetails.vue` directly above the due-date selector.
- **Frontend badge — `src/components/cards/badges/StartDate.vue`:** clone of `badges/DueDate.vue`, rendered from `CardBadges.vue` when `card.startdate` is set. Neutral styling (no overdue colouring — start date has no overdue semantics).

### Validation — start date ≤ due date

Enforced on **both** edit paths, since either date can violate the constraint:

- **Backend (source of truth) — `CardService::update`:** if both `startdate` and `duedate` are non-null and `startdate > duedate`, throw `BadRequestException` (translated message, e.g. "A data de início não pode ser posterior à data de conclusão"). Applies whether the offending value is the newly-set start date OR a newly-set earlier due date. Covered by a service test for each direction.
- **Frontend (guidance, not the gate):** the start-date picker sets `:max` to the card's `duedate` (when set); the due-date picker sets `:min` to the card's `startdate` (when set). On a rejected save, surface the backend message via `showError` and revert the optimistic value (same reject pattern used elsewhere). The picker bounds are a convenience; the backend check is authoritative.

### Edge cases (Feature 2)

- Only one date set → no constraint.
- Clearing either date → allowed, clears the constraint.
- `startdate === duedate` → allowed (≤, not <).
- Timezone/persistence: store and compare exactly as `duedate` is handled (same `datetime` type + serialization), so no new tz logic.
- Existing cards: `startdate` is null after migration; nothing to backfill.

---

## Non-goals

- Group/circle-based user filtering on All Boards (v1 = direct user assignments).
- Start date on the calendar/CalDAV export, timeline, or dashboard widgets (sidebar picker + card badge only).
- Sorting boards/cards by start date, or a start-date filter dimension.
- Board-membership-based filtering (explicitly card-assignment based).
- Duration/auto-scheduling between start and due.

## Testing

**Feature 1**
- `boardFilters.spec.js`: `boardMatchesFilters` — user dimension (match on intersection, OR across users, empty = pass-through, combines with tags/due).
- `BoardSummaryService` (PHP): summary includes distinct assigned UIDs per board; excludes archived/deleted cards; scoped to visible boards.
- `MatchingCardMapper` (PHP `@group DB`): with a user filter, returns only cards assigned to those users; without it, unchanged.
- Store: `setBoardUserFilter` mutation + URL round-trip.

**Feature 2**
- `CardService` (PHP): rejects `startdate > duedate` (both directions: setting a late start; setting an early due); accepts equal; accepts either-null; persists a valid start date.
- Migration adds the column (guarded).
- Frontend: `StartDateSelector` sets/clears via dispatch; badge renders when set; picker `:max`/`:min` bounds derive from the sibling date.

## Deployment

- Version bump **1.18.0** (mandatory `?v` bust). Migration runs on boot (adds `deck_cards.startdate`). Rebuild `js/`, commit bundle + submodule bump, build staging (amd64), deploy, expect the ~3–5 min php-fpm 502 window, then live-verify: (1) All Boards user filter narrows boards + scopes expanded cards; (2) start-date picker + badge; (3) start > due rejected with the toast.
