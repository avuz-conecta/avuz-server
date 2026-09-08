# Deck — board-scoped share (limit a recipient to their own cards)

**Status:** design approved 2026-09-08. Next: implementation plan.

## Problem

Today a board share is all-or-nothing: any recipient with READ sees every card.
Some clients need to share a board with a collaborator who should see **only the
cards assigned to them**, not the whole board — while other recipients keep full
visibility. This must be a real access boundary, not a UI filter.

## Goal

Add a **per-share** option: when sharing a board with a user, group, or circle,
mark that grant as **"only assigned cards"**. A recipient whose access resolves to
that state can read only the cards assigned to them (directly or via a group/team
they belong to); every other card on the board is inaccessible to them by any Deck
route. A full-board share behaves exactly as today.

## Decisions (locked during brainstorming)

1. **Enforcement = real Deck access boundary.** Enforced in `PermissionService`
   so a limited user cannot read others' cards through any Deck route: board view,
   direct card link/API, comments, attachments. NOT a UI-only filter.
2. **"Own card" = assigned to the user directly OR to a group the user belongs
   to.** A Deck card can be assigned to a user (`type=user`) or a group
   (`type=group`) — circles are a valid *share* type but not a card assignee, so
   they do not appear on the assignment side. Unassigned cards are hidden from a
   limited user.
3. **Create auto-assigns the creator.** A card a limited user creates is
   automatically assigned to them so it stays visible.
4. **Most-permissive wins.** A user limited by one grant but given the full board
   by another (e.g. a group) sees the whole board. The limit takes effect only
   when *every* READ-granting ACL the user holds is marked "only assigned cards".
5. **Owners and managers are never limited.** The board owner and anyone with
   `PERMISSION_MANAGE` always see the whole board; the toggle is not offered on a
   grant that carries Manage.

## Non-goals (Phase 2 — documented, out of this spec)

Filtering a limited user's view in these *separate* Nextcloud subsystems:
full-text search (`OCA\Deck\Search`), the CalDAV calendar feed
(`OCA\Deck\DAV\CalendarPlugin`), the activity stream, and reminders. These do not
route through Deck's card READ check, so they need their own passes. Out of scope
here; a limited user must not be told the feature is airtight across them.

## Data model

New column on `oc_deck_board_acl`:

- `cards_only_assigned` — boolean, `NOT NULL DEFAULT 0`.

Migration `Version118xxDate20260908xxxxxx` adds the column (idempotent
`hasColumn` guard, like the existing fork migrations). Default `0` = every existing
share keeps full visibility; zero data backfill.

`Acl` entity (`apps/deck/lib/Db/Acl.php`):
- `protected $cardsOnlyAssigned;`
- `$this->addType('cardsOnlyAssigned', 'boolean');`
- Include in the entity's JSON output so the frontend receives it per participant.

## Permission resolution

New method on `PermissionService`
(`apps/deck/lib/Service/PermissionService.php`):

```
isLimitedToAssignedCards(int $boardId, ?string $userId = null): bool
```

Returns `true` only when ALL of:
- the user is **not** the board owner, and
- the user has **no** `PERMISSION_MANAGE` on the board, and
- the user holds at least one ACL that grants READ, and
- **every** ACL the user matches (direct user ACL + each group ACL for their
  groups + each circle ACL for their circles) that grants READ has
  `cardsOnlyAssigned = true`.

Any matched READ-granting ACL with `cardsOnlyAssigned = false` ⇒ returns `false`
(most-permissive, decision 4). Owner/manage short-circuit to `false` (decision 5).

Group/circle matching reuses the existing membership resolution already used by
`userCan`/`getPermissions` (`IGroupManager` + the circles service), so the same
inverse-direction membership logic applies — no new membership path.

This method is the single source of truth; both read choke points and the create
path call it.

## Read enforcement

Deck has exactly two card-read entry points; both must honor the limit.

### Board view — `StackService::findAll(boardId)` → `CardMapper`

When `isLimitedToAssignedCards(boardId, currentUser)` is true, the cards returned
per stack are filtered to those assigned to the user or to a group they belong to.
Implementation: a limited variant of the stack card query that `INNER JOIN`s
`oc_deck_assigned_users` on `card_id` with
`(participant = :userId AND type = TYPE_USER) OR (participant IN (:userGroups…) AND type = TYPE_GROUP)`,
`DISTINCT` on card id. Excludes unassigned cards. Note the existing
`findToMeOrNotAssignedCards` matches only the user-assignment case and includes
unassigned cards — this query is stricter and adds the group-assignment case, so
it is new rather than a reuse. Non-limited users keep the existing unfiltered
query — no behavior change.

Stack card counts and any board-level card aggregation reflect only the visible
set for a limited viewer (they consume the same filtered list).

### Single card — `PermissionService::checkPermission(cardMapper, cardId, READ)`

When the resolved permission is READ via a limited grant, additionally require the
card to be assigned to the user (direct user assignment or a group they belong to).
If not ⇒ deny
(the existing `NoPermissionException` / 403 path). Because comment, attachment,
and single-card endpoints all call `checkPermission` on the card mapper with
`PERMISSION_READ`, this one gate covers direct card link, comments, and
attachments with no per-endpoint change.

`checkPermission` gains an internal helper `cardAssignedToUser(cardId, userId)`
(reuses the assignment + membership resolution). The extra assignment check runs
only when the user is limited on that card's board, so full-board readers pay
nothing.

## Create behavior

`CardService::create(...)`: after the card is inserted, if
`isLimitedToAssignedCards(boardId, currentUser)` is true, assign the creating user
to the new card (same path as a normal user assignment, so activity/notifications
stay consistent). Guarantees decision 3 — a limited user never loses a card they
just made. If they later unassign themselves it disappears from their view, which
is intended.

## API + UI

**Backend API.** The board ACL create/update endpoints
(`BoardService::addAcl` / `updateAcl` and their controller) accept a
`cardsOnlyAssigned` boolean and persist it on the `Acl`. It is accepted only when
the grant does not carry `PERMISSION_MANAGE`; a request that sets both is rejected
with 400 (managers can't be limited, decision 5).

**Frontend.** `apps/deck/src/components/board/SharingTabSidebar.vue` (the
"Compartilhar" tab): each participant row that is not a manager/owner gets a toggle
**"Apenas cards atribuídos"** (checkbox/switch), bound to that ACL's
`cardsOnlyAssigned`, dispatched through the existing ACL-update action. Hidden when
Manage is enabled for the row. pt_BR strings added to the theme l10n
(`themes/avuz/apps/deck/l10n/pt_BR.json`) and the deck fork l10n.

## Edge cases

- **Owner opens their own board:** never limited (decision 5).
- **Limited user with edit:** may edit/move their visible cards (governed by the
  existing EDIT permission); create auto-assigns (decision 3).
- **Card reassigned away from a limited user:** disappears from their view on next
  load; a direct fetch returns 403 — correct.
- **User both in a full-board group and a restricted direct share:** sees the whole
  board (decision 4).
- **Toggling a share from full → limited:** takes effect on next board load / card
  fetch; no data migration.
- **Deleting the last assignee (unassigning self):** card leaves their view; not an
  error.

## Testing (behavior)

- `PermissionService::isLimitedToAssignedCards`: owner ⇒ false; manager ⇒ false;
  single restricted user ACL ⇒ true; restricted direct + full group ⇒ false
  (most-permissive); restricted direct + restricted group ⇒ true; no ACL ⇒ false.
- `CardMapper` limited query: returns only cards assigned to the user or to a
  group they belong to; excludes unassigned and others' cards; DISTINCT (no dup
  when assigned by both user and group).
- `checkPermission` on a card: limited user + own card ⇒ allowed; limited user +
  others' card ⇒ 403; full reader ⇒ allowed regardless of assignment.
- `CardService::create` by a limited user ⇒ new card assigned to creator.
- API: setting `cardsOnlyAssigned` with Manage ⇒ 400; without Manage ⇒ persisted.

## Files touched (deck fork `apps/deck`)

- `lib/Migration/Version118xxDate20260908xxxxxx.php` (new column)
- `lib/Db/Acl.php` (field + type + JSON)
- `lib/Service/PermissionService.php` (`isLimitedToAssignedCards`,
  `cardAssignedToUser`, gate in `checkPermission`)
- `lib/Db/CardMapper.php` (limited stack-card query)
- `lib/Service/StackService.php` (use limited query when limited)
- `lib/Service/CardService.php` (auto-assign on create)
- `lib/Service/BoardService.php` + ACL controller (accept/validate/persist flag)
- `src/components/board/SharingTabSidebar.vue` (+ store ACL action) (toggle)
- l10n (deck fork + `themes/avuz/apps/deck/l10n/pt_BR.json`)
- version bump `appinfo/info.xml`

## Rollout

Ships via the standard deck deploy (`scripts/deploy-deck.sh`) with a version bump.
Default-false column = safe for the existing fleet on redeploy.
