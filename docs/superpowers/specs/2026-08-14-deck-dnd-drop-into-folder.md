# Deck DnD — Drop a Board Into a Folder (fix) — Design (Phase P6.2.1)

**Date:** 2026-08-14
**Status:** Approved, ready to implement
**Fork:** `avuz-conecta/deck` (branch `avuz`) — version bump **1.17.6 → 1.17.7** (mandatory `?v` bust; memory `deck-js-cachebust-version-bump`)

## Context

P6.2 shipped sidebar drag-and-drop. Live smoke found: **dragging a board *into* a folder doesn't work.** Root cause diagnosed live: the drop target for "board → folder" is the folder's **nested boards-sublist** (`<draggable group="deck-boards">`). When a folder is **collapsed, that sublist is `0×0`** — you can't drop onto a zero-size element — and the **folder row itself is not a drop target**. So dragging a board onto a collapsed folder does nothing. The move only works if you first expand the folder and drop precisely into its (possibly tiny) boards area.

The P6.2 backend/store/logic is correct (verified live: invoking `onBoardDrop` dispatches `setBoardFolder` and the board moves). This is purely a **drop-target / interaction** gap. Reorder-within and folder re-nest gestures work (SortableJS attached, correct groups). Folder-row click-collapse works. Caret works (no double-toggle).

Frontend-only, no backend/migration change.

## Decisions

- **Native drag confirmed:** the `<draggable>`s use SortableJS's default **native HTML5 drag** (no `forceFallback`), so native `dragenter`/`dragover`/`drop` events fire on DOM elements during a drag. This is the hook for row-level behavior.
- **Two fixes, layered:**
  1. **Auto-expand a folder when a board is dragged over its row** (the guaranteed fix — standard tree-DnD pattern). A collapsed folder opens on hover so its boards-sublist becomes a live, sized drop target.
  2. **Empty/expanded folder has a real drop zone** — an empty boards-sublist gets a `min-height` + padding so it's actually hittable after expand (a `0-height` `<ul>` still can't receive a drop).
- Keep everything P6.2 already got right (permission gate, cycle guard, revert-on-reject, order-only, click-collapse).

## Goals

- Dragging a board onto a folder in the sidebar reliably moves it into that folder — whether the folder was collapsed or expanded, without the user having to pre-expand it.
- No regression to reorder-within, folder re-nest, or click-collapse.

## Non-goals

- Backend/order-model changes (P6.2 backend is correct).
- Drag-and-drop for the shared/archived categories (still out).
- A bespoke drag-ghost/animation overhaul.

## Design

### 1. Track "a board is being dragged" (global-ish flag)
SortableJS fires `@start`/`@end` on each `<draggable>`. On a **boards** draggable `@start`, set a shared flag `isDraggingBoard = true`; clear on `@end`. Simplest reliable home: a tiny Vuex flag in the `folders` store (`draggingBoard` state + `setDraggingBoard` mutation) so every recursive `AppNavigationFolder` instance can read it (they can't share local data). Set it from the boards-draggable `@start`/`@end` in both `AppNavigationFolder.vue` and `AppNavigation.vue`. (Alternatively `Sortable.active`/`Sortable.dragged` global — but the store flag is explicit and testable.)

### 2. Auto-expand a collapsed folder on board drag-over
On the folder's `NcAppNavigationItem` **row element**, add a native `@dragenter`/`@dragover` handler `onRowDragOver`:
- If `store.draggingBoard` (a board drag is in progress) AND this folder is collapsed (`!this.expanded`), set `this.expanded = true` (optionally after a small hover delay to avoid opening every folder skimmed over — a `~250ms` timer cleared on `dragleave` is enough; a plain immediate expand is acceptable for v1).
- Do NOT collapse on dragleave (leave it expanded; the user can collapse later). Do NOT auto-expand on a *folder* drag (only board drags, so re-nesting isn't disrupted) — gate on `draggingBoard`.
- Scope: the handler must be on the folder's own row, not bubble from its children (use the row element, and guard so a dragenter into a child folder expands the child, not the parent — natural with per-instance handlers).

### 3. Empty boards-sublist is a real drop zone
Give `.app-navigation-entry__folder-boards` (the boards `<draggable>`) a **`min-height`** (e.g. `~28px`) and small padding when it would otherwise be empty, so an expanded empty folder presents a hittable drop area directly under its row. Keep it visually subtle (no border unless dragging). Optional nicety: a drop-target highlight on the sublist during a board drag (`.sortable-ghost`/a drag-over class) so the user sees where it will land.

### 4. (Stretch, only if clean) Folder row as a direct append-drop
If it can be done without fighting SortableJS: a native `@drop` on the folder row that, when `draggingBoard`, dispatches `setBoardFolder({ boardId, folderId: thisFolder.id, order: null })` (append) and `preventDefault`s. This lets a user drop a board *anywhere on the row* to move it in, no expand needed. **Only include if it doesn't double-fire with the sublist's own SortableJS drop** (guard against both firing for one drop). If there's any conflict, ship 1–3 alone (auto-expand + droppable sublist already fixes the reported bug) and leave row-drop for later.

## Edge cases
- Dragging a **folder** (not a board) must NOT auto-expand targets (gate on `draggingBoard`), so re-nesting still works.
- Auto-expanding a folder mid-drag must not break the in-flight SortableJS drag (expanding adds DOM; SortableJS tolerates this, but verify the drop still lands).
- A folder with no manage permission: the board can still be dropped *into* it only if the board is manageable (existing `:move` gate on the board) — auto-expand is harmless (view-only).
- `draggingBoard` must reliably clear on `@end` even if the drop is cancelled/reverted (P6.2 revert path), so folders don't keep auto-expanding after a drag.

## Testing
- **jest (`AppNavigationFolder.spec.js`):** `onRowDragOver` expands a collapsed folder when `draggingBoard` is true, and does NOT when it's false (folder drag) or the folder is already expanded; the boards-draggable `@start`/`@end` toggle the store `draggingBoard` flag; (if row-drop is included) a row `@drop` with `draggingBoard` dispatches `setBoardFolder(append)` exactly once and `preventDefault`s.
- **Store test:** `setDraggingBoard` mutation flips the flag.
- Regression: existing DnD/permission/cycle/revert/click-collapse tests stay green.

## Deployment
- Version bump **1.17.7** (mandatory — busts the global `?v` so cached browsers get the fix; CF purge alone won't). Rebuild `js/`, commit bundle. Deploy staging, purge Cloudflare, re-smoke the drag-into-folder gesture (collapsed + expanded folders).
