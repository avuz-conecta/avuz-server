# Deck Sidebar Drag-and-Drop + Folder Click-Collapse — Implementation Plan (P6.2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag boards and folders in the Deck sidebar to place, re-nest, and reorder (persisted, org-wide), and make a folder row click toggle its collapse.

**Architecture:** Add a `deck_boards.order` column. Extend the two existing P6 placement endpoints (`PUT /boards/{id}/folder`, `PUT /folders/{id}/parent`) with an optional `order` so one call does move **and** position (same-container = pure reorder). Frontend adds `vuedraggable@^2.24` with two per-kind SortableJS groups (boards, folders) over the folder-tree lists only; `buildBoardTree` sorts by `order` then title.

**Tech Stack:** PHP 8 / NC AppFramework (QBMapper, SimpleMigrationStep, IPermissionMapper), Vue 2.7 / Vuex, `@nextcloud/vue`, `vuedraggable@^2.24` (SortableJS 1.x), jest, phpunit via `~/deck-test.sh`.

## Global Constraints

- Fork `avuz-conecta/deck`, branch `avuz`, at `apps/deck`. Version bump **1.17.5 → 1.17.6** (mandatory — busts NC's global `?v=` asset hash so cached browsers refetch; CF purge alone does not — memory `deck-js-cachebust-version-bump`).
- **`vuedraggable@^2.24` only** (Vue 2 / SortableJS 1.x). `vuedraggable@4` is Vue 3 — do NOT use.
- **Endpoint reuse, no new reorder routes.** Extend `setFolder`/`move` with an optional `order`.
- **Reorder is order-only**: no per-board activity, notifications, or ETag storm. Use an order-only mapper write; do NOT fan out `changeHelper->boardChanged()` per sibling.
- **Resequence the FULL container** (all rows by `folder_id`/`parent_id`), not the actor's ACL-filtered subset.
- Permissions: board move/reorder → board **MANAGE**; folder move/reorder → folder **MANAGE** (+ cycle guard). Frontend rejects illegal drags; backend re-enforces.
- Draggable wraps **only** the folder-tree lists (root + folder children), never the shared/archived `AppNavigationBoardCategory` lists.
- Commit rebuilt `js/` + `package.json`/`package-lock.json`. No "Claude Code" in commit messages. PT for any new user-facing string. Tests assert behavior.
- Run PHP via `~/deck-test.sh --filter <Test>`; JS via `npm run test -- <file>`. `@group DB` tests need the multiline docblock. If `~/deck-test.sh` hits `No space left on device`/`FileSequence`, run `docker builder prune -f` and retry.

---

### Task 1: Migration + Board.order + BoardMapper::maxOrder + BoardTest fixtures + version bump

**Files:**
- Create: `lib/Migration/Version11705Date20260814130000.php`
- Modify: `lib/Db/Board.php`, `lib/Db/BoardMapper.php`, `appinfo/info.xml`, `tests/unit/Db/BoardTest.php`
- Test: `tests/unit/Db/BoardMapperTest.php`

**Interfaces (Produces):** `deck_boards.order` column; `Board::getOrder()/setOrder()` (int, default 0); `BoardMapper::maxOrder(?int $folderId): int` (-1 when empty; `IS NULL` for root).

- [ ] **Step 1: Migration.** Create `Version11705Date20260814130000` extends `SimpleMigrationStep`; in `changeSchema` guard `$table->hasColumn('order')` on `deck_boards`; add column `order` (Type INTEGER, notnull true, default 0). Use `OCP\DB\Types`. Mirror the column-add style of `Version11703` (which added `folder_id`).
- [ ] **Step 2: Version bump.** `appinfo/info.xml` `<version>1.17.5</version>` → `<version>1.17.6</version>`.
- [ ] **Step 3: Board entity.** In `lib/Db/Board.php` add `protected $order = 0;` + `$this->addType('order', 'integer');` (mirror the P6 `folderId` add) + `@method` docblocks for `getOrder`/`setOrder`.
- [ ] **Step 4: `maxOrder`.** In `BoardMapper` add `maxOrder(?int $folderId): int` mirroring `FolderMapper::maxOrder(?int $parentId)` verbatim, using column `folder_id` (root = `IS NULL`).
- [ ] **Step 5: Fix BoardTest fixtures.** In `tests/unit/Db/BoardTest.php`, add `'order' => 0` to every expected `jsonSerialize` array (same spot as the existing `folderId`/`acl` keys) — adding an entity prop breaks these (learned in P6.1). Find all failing arrays (`testJsonSerialize`, `testUnfetchedValues`, `testSetLabels`, `testSetShared`, plus any others).
- [ ] **Step 6: Failing mapper test.** In `BoardMapperTest` add `testMaxOrder`: insert boards with folder_id null + a folder id, assert `maxOrder(null)` and `maxOrder(<folderId>)` return the max, and `-1` for an empty container.
- Run: `~/deck-test.sh --filter BoardMapperTest` and `~/deck-test.sh --filter BoardTest`
- Expected: FAIL first, PASS after the migration is applied to the harness DB (the harness runs `occ upgrade`; if not, run `~/deck-occ.sh upgrade`).
- [ ] **Step 7: Commit.**
```bash
git add lib/Migration/Version11705Date20260814130000.php lib/Db/Board.php lib/Db/BoardMapper.php appinfo/info.xml tests/unit/Db/BoardTest.php tests/unit/Db/BoardMapperTest.php
git commit -m "feat(deck): deck_boards.order column + Board.order + maxOrder (P6.2)"
```

---

### Task 2: BoardService::setFolder(+order) — move/reorder, full-container resequence, order-only

**Files:** Modify `lib/Service/BoardService.php`, `lib/Db/BoardMapper.php`; Test `tests/unit/Service/BoardServiceTest.php`

**Interfaces:**
- Consumes: `BoardMapper::maxOrder` (Task 1), `PermissionService::checkPermission`.
- Produces: `BoardService::setFolder(int $boardId, ?int $folderId, ?int $order = null): Board`; `BoardMapper::updateOrder(int $boardId, int $order): void` (order-only write, no lastModified bump); `BoardMapper::findInFolderOrdered(?int $folderId): Board[]` (all boards in a container, by order then title).

- [ ] **Step 1: Failing tests.** In `BoardServiceTest`:
  - `testSetFolderAppendsWhenNoOrder`: move board to folder F (order null) → its order = `maxOrder(F)+1`; MANAGE checked.
  - `testSetFolderInsertsAtIndexAndResequences`: container has boards ordered [A0,B1,C2]; `setFolder(C, F, 0)` → orders become C0,A1,B2 (full-container resequence, contiguous).
  - `testSetFolderReorderSameFolder`: same folderId + new order reorders without changing folderId.
  - `testSetFolderRequiresManage`: non-manager → `NoPermissionException`.
  - `testSetFolderReorderDoesNotFanOutBoardChanged`: reorder touches N siblings but `changeHelper->boardChanged` is NOT called per sibling (assert call count — at most once, for the moved board's folder change; zero for a pure same-folder reorder).
- [ ] **Step 2: Mapper helpers.** Add `BoardMapper::updateOrder(int $boardId, int $order)` — a direct `UPDATE deck_boards SET \`order\` = :order WHERE id = :id` via the query builder (NO `lastModified`/change side effects). Add `findInFolderOrdered(?int $folderId): Board[]` — select all boards where `folder_id` matches (`IS NULL` for root), order by `order`, `title`.
- [ ] **Step 3: Extend `setFolder`.**
```php
public function setFolder(int $boardId, ?int $folderId, ?int $order = null): Board {
    $this->permissionService->checkPermission($this->boardMapper, $boardId, Acl::PERMISSION_MANAGE);
    if ($folderId !== null) {
        $this->folderMapper->find($folderId); // throws if missing
    }
    $board = $this->boardMapper->find($boardId);
    $folderChanged = $board->getFolderId() !== $folderId;
    $board->setFolderId($folderId);
    if ($order === null) {
        $board->setOrder($this->boardMapper->maxOrder($folderId) + 1);
        $this->boardMapper->update($board);
    } else {
        $this->boardMapper->update($board); // persist folderId first
        $this->resequence($folderId, $boardId, $order); // full-container, order-only
    }
    if ($folderChanged) {
        $this->changeHelper->boardChanged($boardId); // once, only on a real move
    }
    return $board;
}

/** Write contiguous order 0..n-1 over the full container, placing $movedId at $index. Order-only. */
private function resequence(?int $folderId, int $movedId, int $index): void {
    $siblings = $this->boardMapper->findInFolderOrdered($folderId);
    $ids = array_values(array_filter(array_map(fn ($b) => $b->getId(), $siblings), fn ($id) => $id !== $movedId));
    $index = max(0, min($index, count($ids)));
    array_splice($ids, $index, 0, [$movedId]);
    foreach ($ids as $pos => $id) {
        $this->boardMapper->updateOrder($id, $pos);
    }
}
```
- [ ] **Step 4: Run tests.** `~/deck-test.sh --filter BoardServiceTest` → PASS.
- [ ] **Step 5: Commit.**
```bash
git add lib/Service/BoardService.php lib/Db/BoardMapper.php tests/unit/Service/BoardServiceTest.php
git commit -m "feat(deck): setFolder accepts order — move+reorder, full-container resequence, order-only (P6.2)"
```

---

### Task 3: FolderService::move(+order) — re-nest/reorder, resequence, cycle guard

**Files:** Modify `lib/Service/FolderService.php`, `lib/Db/FolderMapper.php`; Test `tests/unit/Service/FolderServiceTest.php`

**Interfaces:** `FolderService::move(int $id, ?int $parentId, ?int $order = null): Folder`; `FolderMapper::updateOrder(int $id, int $order): void`; `FolderMapper::findChildrenOrdered(?int $parentId): Folder[]`.

- [ ] **Step 1: Failing tests.** In `FolderServiceTest`:
  - `testMoveAppendsWhenNoOrder`: order null → `maxOrder(parent)+1`.
  - `testMoveInsertsAtIndexAndResequences`: reorder within parent to a given index → contiguous orders.
  - `testMoveReparentAndPosition`: change parentId + order together.
  - `testMoveRejectsIntoDescendant`: existing cycle guard still throws.
  - `testMoveRequiresManage`: non-manager → `NoPermissionException`.
- [ ] **Step 2: Mapper helpers.** `FolderMapper::updateOrder(int $id, int $order)` (order-only UPDATE) + `findChildrenOrdered(?int $parentId): Folder[]` (order by `order`,`title`; `IS NULL` for root).
- [ ] **Step 3: Extend `move`.** Add `?int $order = null`. Keep the MANAGE gate + cycle guard. Set `parentId`; if `order === null` append via `folderMapper->maxOrder($parentId)+1`; else persist parent then `resequence`-analog over `findChildrenOrdered($parentId)` using `updateOrder` (mirror Task 2's `resequence`, folders variant). No activity fan-out.
- [ ] **Step 4: Run tests.** `~/deck-test.sh --filter FolderServiceTest` → PASS.
- [ ] **Step 5: Commit.**
```bash
git add lib/Service/FolderService.php lib/Db/FolderMapper.php tests/unit/Service/FolderServiceTest.php
git commit -m "feat(deck): folder move accepts order — re-nest+reorder, resequence, cycle guard (P6.2)"
```

---

### Task 4: Controllers accept `order`

**Files:** Modify `lib/Controller/BoardController.php`, `lib/Controller/FolderController.php`; Test `tests/unit/Controller/BoardControllerTest.php`, `tests/unit/Controller/FolderControllerTest.php`

**Interfaces:** `BoardController::setFolder(int $boardId, ?int $folderId = null, ?int $order = null)`; `FolderController::move(int $folderId, ?int $parentId = null, ?int $order = null)`. Routes unchanged.

- [ ] **Step 1: Failing tests.** Assert each controller passes `order` through to its service (thin passthrough), mirroring the existing setFolder/move controller tests.
- [ ] **Step 2: Add the param.** Add `?int $order = null` to both actions and forward it (`setFolder($boardId, $folderId, $order)` / `move($folderId, $parentId, $order)`). Keep `#[NoAdminRequired]`.
- [ ] **Step 3: Run tests.** `~/deck-test.sh --filter BoardControllerTest` and `~/deck-test.sh --filter FolderControllerTest` → PASS.
- [ ] **Step 4: Commit.**
```bash
git add lib/Controller/BoardController.php lib/Controller/FolderController.php tests/unit/Controller/BoardControllerTest.php tests/unit/Controller/FolderControllerTest.php
git commit -m "feat(deck): controllers accept order for board/folder placement (P6.2)"
```

---

### Task 5: Frontend data layer — sort by order, API + store carry order

**Files:** Modify `src/store/folders.js`, `src/services/FolderApi.js`; Test `src/store/folders.store.spec.js`, `src/services/FolderApi.spec.js`

**Interfaces:** `buildBoardTree` sorts by order then title; `FolderApi.setBoardFolder(boardId, folderId, order)` / `moveFolder(id, parentId, order)`; store actions pass `order`; `setBoardFolderId` mutation also sets `order`.

- [ ] **Step 1: Failing tests.**
  - `folders.store.spec`: `buildBoardTree` orders folders + boards by `order` then title at every level (e.g. boards [{order:2,title:'A'},{order:1,title:'B'}] → B before A); `setBoardFolder` action calls API with `order` and commits `setBoardFolderId` with `{boardId, folderId, order}`; the mutation sets `order` on the existing board without clobbering enrichment; `moveFolder` passes `order`.
  - `FolderApi.spec`: `setBoardFolder`/`moveFolder` PUT bodies include `order`.
- [ ] **Step 2: Comparator.** In `src/store/folders.js` add `const byOrderThenTitle = (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })` and replace every `.sort(byTitle)` in `buildBoardTree` (rootFolders, children, rootBoards, folder boards) with `.sort(byOrderThenTitle)`. Keep `byTitle` only if still used elsewhere.
- [ ] **Step 3: API + store.** `FolderApi.setBoardFolder(boardId, folderId = null, order = null)` → PUT body `{ folderId, order }`; `moveFolder(id, parentId = null, order = null)` → PUT body `{ parentId, order }`. In `folders.js`: `setBoardFolder` action passes `order` to the API + commits `setBoardFolderId({ boardId, folderId, order })`; extend the `setBoardFolderId` mutation to `Vue.set(board,'folderId',folderId)` **and** `Vue.set(board,'order',order)` when `order != null`; `moveFolder` action passes `order` + its mutation sets `parentId`+`order` on the folder.
- [ ] **Step 4: Run tests.** `npm run test -- folders.store` and `npm run test -- FolderApi` → PASS.
- [ ] **Step 5: Commit.**
```bash
git add src/store/folders.js src/services/FolderApi.js src/store/folders.store.spec.js src/services/FolderApi.spec.js
git commit -m "feat(deck): sidebar tree sorts by order; api+store carry order (P6.2)"
```

---

### Task 6: vuedraggable wiring — draggable lists + drop→dispatch (move + reorder)

**Files:** Modify `package.json`, `package-lock.json`, `src/components/navigation/AppNavigation.vue`, `src/components/navigation/AppNavigationFolder.vue`; Test `src/components/navigation/AppNavigationFolder.spec.js`

**Interfaces:** Boards drag within group `deck-boards`; folders within `deck-folders`; a drop dispatches `setBoardFolder`/`moveFolder` with `(targetContainerId|null, dropIndex)`.

- [ ] **Step 1: Add dep.** `npm install --save vuedraggable@^2.24` (installs SortableJS 1.x). Confirm `package.json` shows `vuedraggable` in `dependencies` (not dev) and `package-lock.json` updated.
- [ ] **Step 2: Failing component test.** In `AppNavigationFolder.spec.js` (stub `vuedraggable` as a component that emits a synthetic `change`/`end` with a known `{item, newIndex}`): simulate dropping a board into this folder → asserts `setBoardFolder` dispatched with `{ boardId, folderId: <thisFolderId>, order: <index> }`; dropping a sub-folder → `moveFolder` with `{ id, parentId: <thisFolderId>, order: <index> }`.
- [ ] **Step 3: Wire the lists.** Replace the raw `v-for`s with two `<draggable>` lists per container:
  - `AppNavigationFolder.vue` (inside `NcAppNavigationItem`): a `<draggable group="deck-folders" tag="ul" v-model="foldersModel" @change="onFolderDrop">` over `folder.children`, then a `<draggable group="deck-boards" tag="ul" v-model="boardsModel" @change="onBoardDrop">` over `folder.boards`. Use a `tag`/`:component` (`ul`) so the nav markup (`li` items) is preserved — verify the rendered DOM matches pre-DnD.
  - `AppNavigation.vue`: same two draggables over `boardTree.rootFolders` and `boardTree.rootBoards`. Do NOT wrap the shared/archived `AppNavigationBoardCategory` lists.
  - `@change`/`@end` handlers read the moved item + `newIndex` and dispatch `setBoardFolder`/`moveFolder` with this container's id (`folder.id`, or `null` at root) and the index. Bind the draggable `v-model` to computed proxies backed by the tree (or local copies) so vuedraggable can move items.
- [ ] **Step 4: Run test + lint.** `npm run test -- AppNavigationFolder` → PASS; `npx eslint <changed .vue>` → 0 new errors.
- [ ] **Step 5: Commit.**
```bash
git add package.json package-lock.json src/components/navigation/AppNavigation.vue src/components/navigation/AppNavigationFolder.vue src/components/navigation/AppNavigationFolder.spec.js
git commit -m "feat(deck): vuedraggable board/folder drag+reorder in sidebar tree (P6.2)"
```

---

### Task 7: DnD safety — permission gate, cycle guard, revert-on-reject, click-vs-drag

**Files:** Modify `src/components/navigation/AppNavigation.vue`, `src/components/navigation/AppNavigationFolder.vue`; Test `src/components/navigation/AppNavigationFolder.spec.js`

**Interfaces:** Only MANAGE items draggable; folder can't drop into its own descendant; failed drop reverts; click ≠ drag.

- [ ] **Step 1: Failing tests.** Extend the spec: a board/folder without `permissions.PERMISSION_MANAGE` is not draggable (e.g. `:move`/`filter` rejects, or the draggable receives a disabled flag); a drop whose dispatched action **rejects** restores the pre-drop order (mock the store action to reject, assert the model returns to its snapshot).
- [ ] **Step 2: Permission + cycle gate.** Add a SortableJS `:move="onMove"` (and/or `filter`) that returns false when: the dragged item lacks `PERMISSION_MANAGE`; or a dragged folder's target container is itself or a descendant (walk `boardTree`/parent chain client-side). Reuse a `PERMISSION_MANAGE` constant (no magic).
- [ ] **Step 3: Revert-on-reject.** In `onBoardDrop`/`onFolderDrop`, snapshot the affected list order before dispatch; `await` the action; on catch, restore the snapshot (reassign the model) — the store action already `showError`s (P6.1 contract), so do NOT show a second toast.
- [ ] **Step 4: Click-vs-drag.** Configure the draggables with a small `:delay`/`touchStartThreshold` (SortableJS options via `:options`/props) so a click isn't read as a drag; confirm the folder-row collapse click (Task 8) and board-open click still fire, and a drag suppresses the trailing click. (If unreliable, add a drag handle — note the change.)
- [ ] **Step 5: Run test + lint.** `npm run test -- AppNavigationFolder` → PASS; eslint clean.
- [ ] **Step 6: Commit.**
```bash
git add src/components/navigation/AppNavigation.vue src/components/navigation/AppNavigationFolder.vue src/components/navigation/AppNavigationFolder.spec.js
git commit -m "feat(deck): DnD permission gate, cycle guard, revert-on-reject, click-vs-drag (P6.2)"
```

---

### Task 8: Folder row click toggles collapse (#1)

**Files:** Modify `src/components/navigation/AppNavigationFolder.vue`; Test `src/components/navigation/AppNavigationFolder.spec.js`

**Interfaces:** Clicking the folder row toggles expand/collapse; clicking an action button does not.

- [ ] **Step 1: Failing test.** In the spec: clicking the `NcAppNavigationItem` row toggles a local `expanded` data (default = today's collapsed default); clicking an action `NcActionButton` does not toggle it.
- [ ] **Step 2: Implement.** Bind `<NcAppNavigationItem :open.sync="expanded" @click="toggleExpanded" ...>` (data `expanded`, initial value matching the current default), `toggleExpanded(){ this.expanded = !this.expanded }`. Ensure the action buttons carry `@click.stop` so their clicks don't bubble to the row toggle. (`:open.sync` is the confirmed NcAppNavigationItem collapse API — see `AppNavigationBoardCategory.vue`/`DeckAppSettings`.) Do not break the caret (it drives the same synced state).
- [ ] **Step 3: Run test + lint.** `npm run test -- AppNavigationFolder` → PASS; eslint clean.
- [ ] **Step 4: Commit.**
```bash
git add src/components/navigation/AppNavigationFolder.vue src/components/navigation/AppNavigationFolder.spec.js
git commit -m "feat(deck): folder row click toggles collapse (P6.2)"
```

---

### Task 9: Full-suite verify + build bundle

**Files:** Build `js/`; final verification.

- [ ] **Step 1: Full JS suite.** `npm run test` → all green (no new failures vs baseline).
- [ ] **Step 2: Full PHP suite.** `~/deck-test.sh` → only the known ~6 pre-existing `NotifierTest` pt_BR-locale failures may fail; ZERO others (Board/Folder/Controller tests green, BoardTest fixtures fixed). If any other test fails, STOP and report.
- [ ] **Step 3: Lint.** `npx eslint src` → 0 new errors.
- [ ] **Step 4: Build.** `npm run build` → compiles clean (only pre-existing asset-size warnings); confirm `vuedraggable` bundled.
- [ ] **Step 5: Commit source + bundle.**
```bash
git add js/
git status   # confirm no vendor/ or node_modules staged; delete .php-cs-fixer.cache if present
git commit -m "chore(deck): build bundle v1.17.6 — sidebar DnD + folder click-collapse (P6.2)"
```

---

## Self-Review notes (author)

- **Spec coverage:** migration+order (T1), setFolder+order (T2), move+order (T3), controllers (T4), tree sort+api+store (T5), draggable wiring (T6), DnD safety incl click-vs-drag (T7), folder click-collapse (T8), build (T9). All spec sections mapped.
- **Type/signature consistency:** `setFolder(boardId, folderId, order=null)`, `move(id, parentId, order=null)`, `maxOrder`, `updateOrder`, `findInFolderOrdered`/`findChildrenOrdered`, `byOrderThenTitle`, `setBoardFolderId({boardId,folderId,order})` used consistently across tasks.
- **Risk for the final review:** boards list + `boardTree` are hot paths — confirm ordering never drops/duplicates a board, plain menu-move still appends, reorder writes no activity, and the draggable wrapper didn't alter the shared/archived categories or break nav markup. Verify the `?v` bump changed on deploy (memory `deck-js-cachebust-version-bump`).
