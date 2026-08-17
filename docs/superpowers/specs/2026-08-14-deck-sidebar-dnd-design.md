# Deck Sidebar Drag-and-Drop + Folder Click-Collapse — Design (Phase P6.2)

**Date:** 2026-08-14
**Status:** Approved, ready for implementation plan
**Fork:** `avuz-conecta/deck` (branch `avuz`) at `apps/deck` — target version bump **1.17.5 → 1.17.6**

## Context

Follow-up to P6 (board folders) + P6.1 (folder sharing). P6 shipped folder placement via **menu actions** and explicitly deferred drag-and-drop ("menu actions cover the full functionality in v1; DnD is pure UX sugar, added later") and manual reordering ("v1 sorts by title; an `order` column is added now so reorder is a later frontend-only change"). Two user requests now pull those in:

1. **Clicking a folder row toggles collapse/expand** — today only the caret toggles.
2. **Full drag-and-drop in the sidebar** — drag a board into a folder / out to root, drag folders to re-nest, and **reorder** both boards and folders within a level.

### Decisions locked in brainstorming

- **Scope = Full DnD** (user's explicit pick): board→folder/root, folder re-nest, folder reorder, **and board reorder**.
- **Endpoint reuse, not new reorder endpoints.** Extend the two existing P6 placement endpoints with an `order`:
  - `PUT /boards/{boardId}/folder` body `{ folderId, order }` — one call = move-into-folder **and** position. Same-container drop = same `folderId` + new `order` (pure reorder).
  - `PUT /folders/{folderId}/parent` body `{ parentId, order }` — re-nest **and** position (cycle guard already present).
- **DnD library:** add **`vuedraggable`** (Vue 2 wrapper over SortableJS). One cross-container group handles move + reorder in a single drop. (No sidebar DnD exists today; card/stack DnD inside a board is separate.)
- **Permissions:** board move/reorder → **board MANAGE**; folder move/reorder → **folder MANAGE**. Reorder is org-wide/persisted, so it takes the same gate as move (consistent). Frontend rejects illegal drags; backend re-enforces.
- **Board order** needs a new column: `deck_boards.order` (boards have no order field today). `deck_folders.order` already exists (P6).

## Goals

- Drag boards and folders in the sidebar to place, re-nest, and reorder — persisted, org-wide.
- Clicking a folder row toggles its collapse state (not only the caret).
- Reuse existing endpoints (+ `order`); no new reorder routes.
- End-to-end type safety + tests, mirroring existing Deck reorder patterns (`StackService::reorder`) and P6/P6.1 conventions.

## Non-goals (explicitly out)

- Dragging cards/stacks (already exists, unrelated).
- Cross-instance / multi-select drag.
- Drag to archive/delete via drop zones.
- Touch-specific gesture tuning beyond what SortableJS gives by default.
- A separate "order" per-user view (order is a single shared/global value, like stack/card order).

## Data model

- **New:** `deck_boards.order` — integer, notnull, default 0. Board position **within its container**: the set of boards sharing the same `folder_id` (a folder, or `NULL` = root). Migration `lib/Migration/Version11705Date20260814130000.php`, `hasColumn` guard, `OCP\DB\Types`, version int > 11704.
- `deck_folders.order` — exists (P6); folder position within its `parent_id` group.
- `Board` entity (`lib/Db/Board.php`): add scalar `order` prop + `addType('order','integer')`. Real column → serializes automatically. Update `tests/unit/Db/BoardTest.php` fixtures with `'order' => 0` (learned from P6.1: entity prop adds break the serialization fixtures).

## Backend architecture

### Ordering helpers
- `BoardMapper::maxOrder(?int $folderId): int` — mirror `FolderMapper::maxOrder(?int $parentId)` (returns -1 when the container is empty; `IS NULL` for root). Used to append on plain move.
- `BoardMapper::findInFolder`/root query already exists conceptually; add the ordered read used by the tree.

### Placement + reorder (reuse endpoints)
- `BoardService::setFolder(int $boardId, ?int $folderId, ?int $order = null): Board` — extend P6 signature. Gate on board **MANAGE** (unchanged). Set `folderId`. Position:
  - `order === null` (plain move, e.g. from the menu) → append: `order = maxOrder($folderId) + 1`.
  - `order` given (DnD drop at index) → **insert at that index and resequence** the target container's siblings (shift the rest down). Reuse a single resequencing routine.
  - Same-container reorder = caller passes the current `folderId` + new `order`.
  - Return the **enriched** board (`$this->find($boardId)`) — the P6.1 fix; keep it. The frontend still merges only `folderId`/`order` into the store board (P6.1 `setBoardFolderId` pattern) to preserve enrichment; extend that mutation to also set `order`.
- `FolderService::move(int $id, ?int $parentId, ?int $order = null): Folder` — extend P6 signature. Gate on folder **MANAGE**. Keep the P6 cycle guard (reject into self/descendant). Position within `parentId` siblings using the same append-or-insert-and-resequence logic (`folderMapper->maxOrder($parentId)`).
- **Resequencing routine** (shared shape for boards + folders): given a container (folderId / parentId) and a target index, write contiguous `order` values `0..n-1` to the siblings with the moved item placed at `index`. Keep it deterministic and O(siblings). A plain append is the `index = end` case.

### Controllers + routes (bodies extended, routes unchanged)
- `BoardController::setFolder(int $boardId, ?int $folderId, ?int $order = null)` — add the optional `order` param; pass through.
- `FolderController::move(int $folderId, ?int $parentId, ?int $order = null)` — add the optional `order` param; pass through.
- Routes `PUT /boards/{boardId}/folder` and `PUT /folders/{folderId}/parent` unchanged (bodies gain `order`).

### Tree ordering
- `src/store/folders.js` `buildBoardTree`: replace the `byTitle` comparator (used at every level) with **`byOrderThenTitle`** = compare `order` (numeric, default 0), tie-break by case-insensitive title. Apply to rootFolders, each folder's children, rootBoards, and each folder's boards. (Backend also returns folders ordered by `order`; the getter is the single source for the rendered order.)

## Frontend / UX

### Drag-and-drop (`vuedraggable`)
- Add `vuedraggable` to `package.json`. Each container renders **two separate `<draggable>` lists** — a **folders** list then a **boards** list (matching today's "folders first, then boards" render). This avoids any mixed folder/board index math: order is naturally per-kind.
  - Root level (`AppNavigation.vue`): a folders `<draggable>` (root folders) + a boards `<draggable>` (root boards).
  - Each folder (`AppNavigationFolder.vue`): a folders `<draggable>` (its sub-folders) + a boards `<draggable>` (its boards).
- **Two SortableJS groups, one per kind:**
  - group `"deck-boards"` — shared across every boards-list, so a board drags between root and any folder's boards-list and reorders. Drop index = the board's index in the target boards-list.
  - group `"deck-folders"` — shared across every folders-list, so a folder drags between root and any folder's folders-list (re-nest) and reorders. Drop index = the folder's index in the target folders-list.
  - A board can only land in a boards-list; a folder only in a folders-list. No cross-kind drops.
- **On drop** (`@change` / `@end`), compute `(targetContainer, newIndex, movedItem)`:
  - moved a **board** → `dispatch('setBoardFolder', { boardId, folderId: targetFolderIdOrNull, order: newIndex })`.
  - moved a **folder** → `dispatch('moveFolder', { id, parentId: targetParentIdOrNull, order: newIndex })`.
- **Permission gating** via SortableJS `:move` callback + `filter`:
  - A board is draggable only if `board.permissions.PERMISSION_MANAGE`.
  - A folder is draggable only if `folder.permissions.PERMISSION_MANAGE`.
  - Reject dropping a folder into itself or a descendant (walk the tree client-side; backend also guards).
  - Reject a drop whose target folder the user cannot place into if that matters (placement is gated by the moved item's MANAGE, not the target's — mirror P6 menu rule).
- **Visual:** SortableJS ghost/drop-indicator classes styled to match the sidebar; a subtle drop-target highlight on folders during drag-over.
- Optimistic store update on drop, reconcile with the returned entity; on failure the store action already `showError`s + rejects (P6.1 contract) → revert local order.

### Folder click-collapse (#1)
- `AppNavigationFolder.vue`: bind `NcAppNavigationItem :open.sync="expanded"` (data `expanded`, default matching today's collapsed default) and toggle `expanded` on the item's row click (`@click` on `NcAppNavigationItem`, which fires for the name area, not the action buttons). The caret keeps working via the same synced state. (`:open.sync` is the confirmed NcAppNavigationItem API — see `AppNavigationBoardCategory.vue`/`DeckAppSettings`.) Ensure the click that toggles collapse does not also start a drag (SortableJS delay/threshold distinguishes click from drag) and does not fire when clicking an action button (`@click.stop` on those).

### Store / API
- `src/services/FolderApi.js`: `setBoardFolder(boardId, folderId, order)` and `moveFolder(id, parentId, order)` — add the `order` arg to the existing wrappers.
- `src/store/folders.js`: `setBoardFolder` / `moveFolder` actions pass `order`; the `setBoardFolderId` mutation also sets `order` on the existing board (keep the P6.1 no-clobber merge). `moveFolder` mutation updates `parentId` + `order` on the folder in state.

## Permissions

- Board move/reorder → board **MANAGE** (`BoardService::setFolder` gate, unchanged).
- Folder move/reorder → folder **MANAGE** (`FolderService::move` gate, unchanged) + cycle guard.
- Frontend disables illegal drags; the backend remains the authority.

## Edge cases

- **Per-kind lists (no mixed index).** Folders and boards are separate `<draggable>` lists per container (folders group vs boards group), so a drop index is already the per-kind index — no mixed-list mapping. Folders always render above boards within a container.
- **Plain move (menu "Mover para pasta…")** still works: `order === null` → append to end.
- **Empty folder** is a valid drop target (append at index 0).
- **Folder into its own descendant** — rejected client-side + `BadRequestException` server-side (P6 guard).
- **Board without MANAGE** — not draggable; the menu move is likewise gated.
- **Concurrent reorders** — last write wins (same as stack/card reorder); resequencing is idempotent.
- **Move across containers** resets the item into the target's sequence at the drop index; the source container's remaining siblings are left contiguous (or resequenced lazily — acceptable to leave gaps since sort is by `order` then title).
- **Board clone / new board / new folder** — appended at end (`maxOrder + 1`), consistent with P6 create.

## Testing

- **PHP (`~/deck-test.sh`)**:
  - `Version11705` migration applies (`deck_boards.order` present).
  - `BoardMapper::maxOrder` (root vs folder, empty → -1).
  - `BoardServiceTest::setFolder` — append when `order` null; insert-at-index + resequence when given; MANAGE gate; returns enriched board.
  - `FolderServiceTest::move` — reorder within parent; re-nest + position; cycle guard intact; MANAGE gate.
  - `BoardTest` fixtures updated with `order`.
- **JS (jest)**:
  - `buildBoardTree` sorts by `order` then title at every level.
  - `folders.store` — `setBoardFolder`/`moveFolder` pass `order`; mutations set `order` without clobbering enrichment.
  - `FolderApi.spec` — `order` in the payloads.
  - A DnD component test (mount with a `vuedraggable` stub) asserting a simulated drop dispatches `setBoardFolder`/`moveFolder` with the right container + index, and that a non-MANAGE item is not draggable.
  - `AppNavigationFolder` — row click toggles `expanded`; clicking an action button does not.

## Deployment notes (carried from fork gotchas)

- Bump `appinfo/info.xml` **1.17.5 → 1.17.6**; migration runs on upgrade. **The version bump is mandatory** — it changes NC's global `?v=` asset hash so cached browsers refetch the new JS (memory `deck-js-cachebust-version-bump`); CF purge alone does not refresh browser cache.
- Commit the rebuilt `js/` (Dockerfile can't rebuild it) **and** the new `vuedraggable` dependency in `package.json` + `package-lock.json`. Confirm `npm run build` bundles it (it's a runtime dep, not dev).
- After deploy: WAIT for boot (the web tier can lag the entrypoint config phase and trip a one-off autoheal restart — memory `autoheal-unhealthy-restart`); verify `installed_version == 1.17.6` + `deck_boards.order` exists; then purge Cloudflare.
- **Regression watch** (final review): the boards list + `boardTree` are hot paths; confirm ordering changes don't drop or duplicate boards, plain menu-move still works, and no board/folder becomes undraggable-but-should-be or vice-versa.
