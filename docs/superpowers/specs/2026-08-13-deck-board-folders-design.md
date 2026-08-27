# Deck Board Folders (Espaços) — Design (Phase P6)

**Date:** 2026-08-13
**Status:** Approved, ready for implementation plan
**Fork:** `avuz-conecta/deck` (branch `avuz`) at `apps/deck` — target version bump **1.17.2 → 1.17.3**

## Context

Second phase of the Deck→product evolution (memory `deck-product-evolution`). This is the
Raíven spec's **Item 1 ("Estrutura Geral")**: organizing boards into **Espaços → pastas →
subpastas** (e.g. Orçamentos Raíven › Orçamento › PEB/PBA/PBL/OMT; Melhorias; Projetos Raíven;
Direção). Deck today shows a **flat list** of boards (grouped only by owner/shared) — no nesting.

This adds a **shared, recursive folder hierarchy** for boards.

Roadmap position (reprioritized): P1 custom fields (DONE) → **P6 folders (this)** → P9 styling →
P4 subtasks → P5 views → P3 time → P8 migration → P2 export → P7 auto-fill.

### Decisions locked in brainstorming

- **Shared org structure** — one folder tree the whole team sees (like ClickUp Espaços), NOT
  per-user personal folders.
- **Arbitrary nesting** — one recursive `folder` concept (folder contains sub-folders and boards
  at any depth). Top-level folders act as "Espaços". No fixed level types.
- **A board sits in at most one folder** (nullable `folder_id`); boards with no folder show at root.
- **Permissions** (agreed, no new folder-ACL system):
  - Move a board in/out/between folders → **board MANAGE** (inherited from the board).
  - Create / rename / nest a folder → **any user** (the tree is shared; folders hold no data).
  - Delete a folder → **only when empty** (no boards, no sub-folders). Removing a non-empty folder
    means first moving its boards out, each of which already requires board MANAGE — so it is
    impossible to delete a board you don't manage via folder ops.
  - **Visibility**: the folder tree is shared/visible to **all authenticated users** (folder
    titles are org-wide metadata, like ClickUp space/folder names — acceptable because each Raíven
    tenant is its own single-tenant NC instance). Boards inside still respect their existing board
    ACL: you only see/open boards shared with you, so a folder may display with some boards hidden.
    **No per-user folder pruning** — this avoids (a) leaking-by-pretense (titles are on the wire
    regardless once returned) and (b) a just-created empty folder vanishing from its own creator.
    (Grill fix 2026-08-13; earlier draft pruned empty-for-user folders — dropped.)

## Goals

- A recursive, shared folder tree that boards can be placed into.
- Full folder + placement management via **menu actions** (create/rename/delete folder, "move board
  to folder").
- End-to-end type safety and test coverage, mirroring existing Deck patterns (Label/Board).

## Non-goals (fast-follow, explicitly NOT in this phase)

- **Drag-and-drop** (drag board into folder, drag folders to nest/reorder) — menu actions cover the
  full functionality in v1; DnD is pure UX sugar, added later.
- **Manual folder reordering UI** — v1 sorts folders by `title` (an `order` column is added now so
  the reorder feature is a later frontend-only change).
- Per-folder ACL / folder ownership-based permissions (deliberately avoided — see decisions).
- Moving whole folders *including their boards* in one action beyond simple re-parenting.

## Data model

Two changes. **No DB foreign keys** (Deck convention — cascade/guards are in app code).

### `oc_deck_folders` (new)

| column | type | notes |
|---|---|---|
| `id` | integer | PK autoincrement |
| `title` | string(255) | notnull |
| `parent_id` | integer | nullable → NULL = top-level ("Espaço"); index `deck_folders_parent_idx` |
| `owner` | string(64) | creator uid — record only, NOT used for permission |
| `order` | integer | notnull default 0 — manual sort within parent (reorder UI is fast-follow) |
| `last_modified` | integer | nullable |

### `oc_deck_boards` — add column

| column | type | notes |
|---|---|---|
| `folder_id` | integer | nullable → NULL = board at root; index `deck_boards_folder_idx` |

**Migration:** `lib/Migration/Version11703Date20260813120000.php`, class matching filename, extends
`SimpleMigrationStep`, use `OCP\DB\Types`, guard `createTable`/`addColumn` with
`hasTable`/`hasColumn`. Version integer must be > 11702.

## Backend architecture (mirror Board/Label patterns)

### Db layer
- `lib/Db/Folder.php` — `RelationalEntity`; props `title, parentId, owner, order, lastModified`;
  `addType('parentId','integer')` (nullable ok), `addType('order','integer')`,
  `addType('lastModified','integer')`; `getETag()`.
- `lib/Db/FolderMapper.php` — `extends DeckMapper<Folder>`:
  - `findAll(): Folder[]` — the whole tree is shared, so return all folders (frontend prunes
    empty-for-user branches). Ordered by `parent_id`, `order`, `title`.
  - `findChildren(int $parentId): Folder[]`, `find(int $id): Folder`.
  - `hasChildren(int $id): bool` (any folder with `parent_id = id`).
  - `insert`/`update` stamp `lastModified` (same idiom as LabelMapper, using **`array_key_exists`**
    on `getUpdatedFields()`, NOT the buggy `in_array`).
- `Board` entity: add scalar prop **`folderId`** with `addType('folderId','integer')`. It is a real
  column, so it serializes automatically (no `addRelation`). `BoardMapper` reads/writes it via the
  normal Board insert/update.

### Service layer
- `lib/Service/FolderService.php`:
  - `findAll(): Folder[]` — any authenticated user (shared tree).
  - `create(string $title, ?int $parentId): Folder` — any user; validate title non-empty; if
    `parentId` set, it must exist; set `owner` = current uid; set `order` = (max `order` among
    siblings under the same `parentId`) + 1; insert. **Sibling folders with identical titles are
    ALLOWED** (like ClickUp; not enforced) — deliberate, not an oversight.
  - `rename(int $id, string $title): Folder` — any user; validate.
  - `move(int $id, ?int $parentId): Folder` — any user; **cycle prevention**: reject if `parentId`
    equals `id` or is a descendant of `id` (walk up from the target parent to root; if we hit `id`,
    reject with `BadRequestException`). If `parentId` set, it must exist.
  - `delete(int $id): void` — any user, but **only when empty**: reject with `BadRequestException`
    if `boardMapper->findInFolder(id)` is non-empty OR `folderMapper->hasChildren(id)`.
    (Requires a new `BoardMapper::findInFolder(int $folderId): Board[]` — a `WHERE folder_id = ?`
    query; `FolderService` depends on `BoardMapper` for this guard.)
- `lib/Service/BoardService.php` → `setFolder(int $boardId, ?int $folderId): Board` — gate on
  **board MANAGE** (`permissionService->checkPermission($boardMapper, $boardId, Acl::PERMISSION_MANAGE)`);
  if `folderId` set, verify the folder exists; set `board->setFolderId($folderId)`; update.
- `lib/Validators/FolderServiceValidator.php` — `title` not_empty/not_null/not_false/max:255.

### Controller + routes
- `lib/Controller/FolderController.php` (`#[NoAdminRequired]`, sentinel `AVUZ-BOARD-FOLDERS-V1`):
  - `index()` → `service->findAll()`
  - `create(string $title, ?int $parentId)`
  - `rename(int $folderId, string $title)`
  - `move(int $folderId, ?int $parentId)`
  - `delete(int $folderId)`
- `lib/Controller/BoardController.php` → `setFolder(int $boardId, ?int $folderId)`.
- `appinfo/routes.php`:
  - `GET    /folders`                          → `folder#index`
  - `POST   /folders`                          → `folder#create`
  - `PUT    /folders/{folderId}`               → `folder#rename`
  - `PUT    /folders/{folderId}/parent`        → `folder#move`
  - `DELETE /folders/{folderId}`               → `folder#delete`
  - `PUT    /boards/{boardId}/folder`          → `board#setFolder` (body `{ folderId }`, nullable)

### Serialization / how the tree reaches the SPA
- `GET /folders` returns ALL folders (shared, visible to all authenticated users). Boards already
  come ACL-filtered from the existing boards list, each now carrying `folderId`. **The frontend
  builds the tree** from (all folders + the user's accessible boards): every folder is placed by
  `parent_id`, and each board is nested under its `folderId` (or at root when null). **No pruning**
  — folders always render (empty ones included, so you can place boards into a folder you just
  created); boards you can't access simply aren't in the list. ACL stays single-sourced (the boards
  list is the authority).

## Frontend / UX

### Sidebar tree
- The boards sidebar renders a **collapsible tree**: top-level folders (nestable) → their boards;
  un-foldered boards at root. Folders sort by `order` then `title`; boards within a folder keep the
  existing board sort.
- Expanded/collapsed state per folder is a **local/persisted UI preference** (does not mutate the
  shared model).

### Interactions (v1 = menu actions, no DnD)
- **Board menu** gains **"Mover para pasta…"** → a picker of the folder tree (+ "Raiz/None" to
  remove from folder). Dispatches `setBoardFolder(boardId, folderId)`. Visible only when the user
  can MANAGE that board (the backend also enforces it).
- **Sidebar** gains **"Nova pasta"** (create at root or under a folder), and each folder gets a menu
  with **Renomear** and **Excluir** (Excluir disabled/blocked when the folder is non-empty, matching
  the backend rule — show a clear message if attempted).

### Store + API service
- `src/services/FolderApi.js` — `getFolders`, `createFolder`, `renameFolder`, `moveFolder`,
  `deleteFolder`, `setBoardFolder` (axios wrappers, mirror `BoardApi`/`CustomFieldApi`).
- Store: a `folders` module (state = all folders; actions create/rename/move/delete + set-board-
  folder; getter builds the pruned tree from folders + `boards`). Mirror the existing board/label
  store patterns; no magic strings.

## Edge cases

- **Cycle prevention** on folder move — reject re-parenting a folder into itself or a descendant.
- **Delete guard** — folder delete refuses when it holds boards or sub-folders (same rule as the
  permission model; enforced in `FolderService::delete`).
- **Board clone** — the cloned board goes to **root** (`folder_id = null`) by default (a clone is a
  new board; the user places it).
- **Board delete** — no folder side effects (the board row is removed; folders untouched).
- **Deleting a board's folder membership is not board deletion** — `setFolder(boardId, null)` just
  moves it to root.
- **Empty folders** — always shown (needed so you can place boards into a folder you just created).
- **Folder with boards you can't access** — the folder still shows (shared metadata), just without
  the boards you lack access to.

## Testing

- **PHP (phpunit via `~/deck-test.sh`)**: `FolderMapperTest` (findAll ordering, findChildren,
  hasChildren, insert stamps lastModified), `FolderServiceTest` (create/rename; **cycle-prevention on
  move**; **delete-refuses-when-non-empty**; delete-ok-when-empty), `FolderServiceValidatorTest`,
  `FolderControllerTest` (thin passthrough), and a `BoardServiceTest` case for `setFolder` (board
  MANAGE gate + sets folderId). Behavior tests, not implementation.
- **JS (jest)**: `FolderApi.spec.js` (URL/verb/payload for each method) + a store test for the
  tree-building/pruning getter (folders + boards → pruned tree).

## Deployment notes (carried from the fork's known gotchas)

- Bump `appinfo/info.xml` to **1.17.3**; migration runs on upgrade. After deploy, WAIT for boot to
  finish (~40–60s), then verify `installed_version == 1.17.3` AND the new table/column exist (list
  via `\OC::$server->getDatabaseConnection()->createSchema()->getTables()`, NOT `occ db:show-tables`
  which is not a valid command). The entrypoint self-heals the app migration hands-free (see
  memory `deck-fork-submodule`); only reconcile manually if still stale a minute after boot.
- Commit the rebuilt `js/` (the Dockerfile can't rebuild it). After deploy, **purge Cloudflare**
  for the JS bundle.
- Sentinel `AVUZ-BOARD-FOLDERS-V1` in `FolderController.php`; consider adding it to
  `verify_avuz_patches` for parity.
