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

### Boards index gains two computed fields

The existing boards-index response carries, per board:

- `avuzTags: string[]` — union of direct and derived tag titles, deduplicated by
  the identity rule above.
- `avuzDue: { overdue, today, week, month, none }` — counts of live cards in each
  bucket.

Both come from one grouped query across `deck_stacks` / `deck_cards` /
`deck_assigned_labels` / `deck_labels`. `deck_cards` already indexes `stack_id`
and `archived`.

There is **no filter endpoint**. The overview loads boards once and filters
client-side. Tags OR together; the date chip ANDs with the tag set.

### Date buckets

Relative to request time, over live cards only:

| Bucket    | Rule                                |
| --------- | ----------------------------------- |
| `overdue` | `duedate < now`                     |
| `today`   | `duedate` within the current day    |
| `week`    | `duedate` within the next 7 days    |
| `month`   | `duedate` within the current month  |
| `none`    | `duedate IS NULL`                   |

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

## Frontend

Component paths are confirmed against upstream `src/` when the fork lands; our
tree ships compiled JS only.

### Filter bar

Above the board grid, in the app header area:

- **Tags** — `NcSelect` with chips, listing every distinct tag title across the
  user's boards with its count. Multiple selections OR together.
- **Prazo** — five single-select chips: `Vencidas`, `Hoje`, `Próximos 7 dias`,
  `Este mês`, `Sem prazo`. Clicking the active chip clears it.

### State lives in the URL

`?tags=cliente-x,urgente&due=overdue`. Reload keeps the view and a filtered
overview is a shareable link. No localStorage.

### Board tiles

Show **direct** tags only, capped at 3 with a `+N` overflow. Derived tags drive
the filter but never render — otherwise Deck's four default labels appear on
every tile.

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
- Tagging without edit permission is rejected.
- Live-card definition excludes `done`, `archived`, and `deleted_at` cards from
  both derived tags and date buckets.

### JS

- Tag selection ORs; date chip ANDs with the tag set.
- No match renders the empty state.
- URL round-trips: filters survive reload, links reproduce the view.

### Staging

Real boards. Boards-index timing measured before and after, so the aggregate
query's cost is a number rather than a guess.

## Risks

- Every Deck upgrade becomes a rebase of the `avuz` branch.
- A store-installed Deck in `custom_apps` can shadow the fork.
- The per-load aggregate query is the one unmeasured performance cost.
- Deck's four default labels appear on nearly every board, so those tag chips
  carry little signal.

## Rollout

Staging runs end to end autonomously. Every prod build, deploy, and container
command waits for the user's explicit approval, per action.
