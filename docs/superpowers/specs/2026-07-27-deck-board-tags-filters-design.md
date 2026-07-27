# Deck board tags and overview filters

Date: 2026-07-27
Status: approved, not implemented
Scope: Deck 1.17.0, "Todos os quadros" overview screen

## Problem

Deck labels are per-board and card-only. The boards overview lists every board a
user can see with no way to narrow it. A user with 40 boards has to read all 40
to find the three that matter this week.

## Goal

On the boards overview:

1. Boards carry tags, not just cards.
2. Filter the board list by tag.
3. Filter the board list by due date.

Filtering targets **boards**, never cards. The overview stays a board list.

## Non-goals

- Cross-board card lists. Deck's "Upcoming cards" view already exists and is untouched.
- A new tag vocabulary. Tags are Deck labels, reused.
- Filtering inside a single board's card view.

## Model

### Tag identity is the title string

Labels stay board-scoped rows in `deck_labels(board_id, title, color)`, exactly as
today. Two boards each holding a label titled `Cliente X` are two rows that the
filter treats as one tag. Comparison trims surrounding whitespace and ignores case.

### A board carries tag T when either holds

- **Direct**: a label titled T is attached to the board itself.
- **Derived**: a label titled T on that board is assigned to at least one live card.

### Live card

Not archived, `deleted_at = 0`, `done IS NULL`. Archived boards are excluded from
the overview entirely, as they are today.

### Schema delta

One table:

```
deck_board_assigned_labels
  board_id  int, not null
  label_id  int, not null
  unique index (board_id, label_id)
```

Rows are removed when their board or label is deleted. No other schema change.

## Backend

### A dedicated summary endpoint, not an enriched boards index

`GET /api/v1.0/avuz/board-summary` returns, per board the user can see:

```
{ boardId, tags: string[], due: { overdue, today, week, month, none } }
```

- `tags` — union of direct and derived titles, deduplicated by the identity rule
  above.
- `due` — counts of live cards per bucket. The frontend only tests `> 0`; counts
  are returned because the same query produces them for free and a future
  "3 vencidas" badge needs them.

**Why not enrich the existing boards index.** `GET /boards` is not the overview's
private channel — the Deck dashboard widget, the mobile app's sync polling, and
any OCS consumer all hit it. Hanging an aggregate over stacks/cards/labels on
that path taxes every one of those callers for data only one screen reads. It
also collides with Deck's ETag handling on the boards index: our fields would
have to invalidate on card changes, which means depending on `ChangeHelper`
touching board `last_modified` for every duedate and label edit. A separate
endpoint sidesteps both. It is called once when the overview mounts, in parallel
with the board list itself.

The query is one grouped statement across `deck_stacks` / `deck_cards` /
`deck_assigned_labels` / `deck_labels`. `deck_cards` already indexes `stack_id`
and `archived`.

There is **no filter endpoint**. The overview filters client-side. Tags OR
together; the date chip ANDs with the tag set.

### Date buckets

Over live cards only, computed in **the user's timezone** (`IDateTimeZone`), not
UTC. Duedates are stored UTC; at UTC−3 a naive UTC comparison puts anything due
after 21:00 local into tomorrow's bucket. Day and month boundaries resolve in
local time.

| Bucket    | Rule                                          |
| --------- | --------------------------------------------- |
| `overdue` | `duedate < now`                               |
| `today`   | `now <= duedate <= end of today, local`       |
| `week`    | `now <= duedate <= now + 7 days`              |
| `month`   | `now <= duedate <= end of current month, local` |
| `none`    | `duedate IS NULL`                             |

Buckets overlap by design: a card due today counts in `today`, `week`, and
`month`. Past-due cards count only in `overdue` — `today`, `week`, and `month`
look forward from now, so `Hoje` means "due later today", not "late since this
morning".

A board matches a chip when its count for that bucket is greater than zero.

### Tagging endpoint

`PUT /boards/{id}/tags`, body is a list of titles.

For each title the server resolves a label on that board. Missing labels are
created, taking their color from the first same-titled label on any board the
user can read, falling back to Deck's default palette. The board↔label mapping is
then rewritten to exactly the submitted set.

Requires board edit permission via Deck's existing `PermissionService`.

`deck_labels` carries **no unique constraint on `(board_id, title)`** — a board
can legitimately hold two labels named `Urgente`. Resolution therefore picks the
lowest `id` deterministically, and `tags` deduplicates by title so the pair
surfaces as one chip.

### Known behavior: renaming splits a tag

Tag identity is the title, so renaming a label on one board detaches that board
from the shared tag. Direct attachments survive (they key on `label_id`), derived
matching moves to the new title. This is inherent to reusing card labels rather
than introducing a tag entity, and is accepted.

## Frontend

Component paths are confirmed against upstream `src/` when the fork lands; our
tree ships compiled JS only.

### Filter bar

Above the board grid, in the app header area:

- **Tags** — `NcSelect` with chips. Its options are the union of `tags` across the
  boards currently listed, with counts, ordered by count descending then
  alphabetically. No separate vocabulary endpoint: the list is derived from data
  the screen already holds, so it can never offer a tag that matches nothing.
  Multiple selections OR together.
- **Prazo** — five single-select chips: `Vencidas`, `Hoje`, `Próximos 7 dias`,
  `Este mês`, `Sem prazo`. Clicking the active chip clears it.

Filters apply **within the board section already selected** — Deck's own
board-type navigation (all / shared with you / archived) stays the outer scope,
and the filter bar narrows whatever that shows.

### State lives in the URL

Repeated, URL-encoded params: `?tag=Cliente%20X&tag=Urgente&due=overdue`. Not a
comma-joined list — tag titles are free text and may themselves contain commas.
Reload keeps the view and a filtered overview is a shareable link. No
localStorage.

### Board tiles

Show **direct** tags only, capped at 3 with a `+N` overflow that lists the
remainder on hover and focus. Derived tags drive the filter but never render —
otherwise Deck's four default labels appear on every tile.

### Empty state

"Nenhum quadro com esses filtros" plus a clear-filters button. The result count
sits in an `aria-live="polite"` region.

### Board tagging UI

Board sidebar, section "Tags do quadro": `NcSelect` with `taggable`, autocompleting
over tag titles from every board the user can read. Saves on change. Hidden
without edit permission.

### Accessibility

Chips are `<button>` elements with `aria-pressed`. The filter bar is a labelled
`role="group"`. Everything is tab-reachable with visible focus. Tag color is
decorative — the chip always names its tag in text.

### Localization

Strings land in the fork's `l10n/pt_BR`. The existing
`themes/avuz/apps/deck/l10n/pt_BR.json` Deck→Tarefas override is untouched.

## Delivery

### Fork

`github.com/avuz-conecta/deck`, branch `avuz`, based on tag `v1.17.0`. Built `js/`
is committed to the branch, matching the `integration_openai` precedent — the
Dockerfile cannot run Deck's frontend build reliably. Node version pinned from
Deck's `package.json` engines.

### Wiring

- Submodule at `apps/deck`.
- Deck leaves the CLAUDE.md rsync list and joins the `git submodule update --init` line.
- `docker/overlays/deck/lib/Service/BoardService.php` (board-copy fix) becomes a
  commit on the fork branch.
- `docker/overlays/deck/` and its Dockerfile `cp` line are deleted.

### Version bump

`1.17.0` → `1.17.0.1`, so `avuz_reconcile_app_versions` sees on-disk code ahead of
`installed_version` and runs `app:disable` + `app:enable --force`, which executes
the migration.

Open item for the plan: confirm `info.xsd` accepts a four-part version. Fallback is
`1.17.1`, at the cost of a collision when upstream ships that tag.

### Migration class naming

NC's `MigrationService` discovers migrations by class name and orders them by the
encoded version, so the name cannot simply be `VersionAvuz...`. Proposed:
`Version1170100Date20260727120000`, which sorts after every upstream `1.17.0`
migration and reads as `1.17.0.1`. Two things to confirm before writing it: the
exact name pattern `MigrationService` accepts, and that no upstream Deck migration
already claims that string — a rebase onto a later tag must not land two classes
with the same name.

### Rollback is not symmetric

Redeploying the previous image after this ships leaves `installed_version` at
`1.17.0.1` while the code reports `1.17.0`. NC treats code older than installed as
a broken app and refuses to load it. Recovery is one command:

```
occ config:app:set deck installed_version --value 1.17.0
```

The `deck_board_assigned_labels` table stays behind and is harmless — dropping it
is not part of rollback. Document this in the deploy notes rather than discovering
it during an incident.

### Sentinel

`AVUZ-BOARD-TAGS-V1` in a fork source file, checked by `verify_avuz_patches` at
boot. The check resolves Deck's actual app path rather than assuming `/apps`: a
store-installed Deck in the `custom_apps` volume outranks the fork by version and
would shadow it while a hardcoded check still reports green.

## Verification

### PHP

- Tag resolution by title: trims whitespace, ignores case.
- Missing label is created on the target board, inheriting color from a same-titled
  label elsewhere.
- A board holding two labels with the same title resolves to the lowest `id` and
  reports one tag, not two.
- Tagging without edit permission is rejected.
- Live-card definition excludes `done`, `archived`, and `deleted_at` cards from
  both derived tags and date buckets.
- Bucket boundaries respect the user's timezone: at UTC−3, a card due 22:00 local
  today lands in `today`, not tomorrow.

### JS

- Tag selection ORs; date chip ANDs with the tag set.
- No match renders the empty state.
- URL round-trips: filters survive reload, links reproduce the view, and a tag
  title containing a comma survives the round trip intact.

### Staging

Real boards. `board-summary` response time measured against a realistic board and
card count, so the aggregate query's cost is a number rather than a guess. If it
lands slow, the fallback is a per-board cache keyed on the board's `last_modified`
— not a schema change.

## Risks

- Every Deck upgrade becomes a rebase of the `avuz` branch, including the
  migration class name.
- A store-installed Deck in `custom_apps` can shadow the fork.
- The `board-summary` aggregate query is the one unmeasured performance cost.
- Deck's four default labels appear on nearly every board, so those tag chips
  carry little signal.
- Rolling the image back needs a manual `installed_version` reset (see above).

## Rollout

Staging runs end to end autonomously. Every prod build, deploy, and container
command waits for the user's explicit approval, per action.
