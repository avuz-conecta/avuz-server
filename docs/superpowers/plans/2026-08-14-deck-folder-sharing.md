# Deck Folder Sharing & Permission Inheritance — Implementation Plan (P6.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Deck folders shareable ACL objects whose grants inherit down to every board inside (union with each board's own ACL), mirroring Nextcloud Drive.

**Architecture:** New `deck_folder_acl` table + `FolderAcl` entity/mapper mirroring `deck_board_acl`/`Acl`. A memoized ancestor-walk resolver in `PermissionService` unions inherited folder flags into `getPermissions` (the single enforcement choke point) and `matchPermissions`. `BoardService` merges folder-reachable boards into the accessible list. Folder management + sharing gate on folder MANAGE. `GET /folders` returns only visible folders. Frontend adds a share modal (reusing the board participant-picker) + inherited "via folder" rows.

**Tech Stack:** PHP 8 / NC AppFramework (QBMapper, RelationalEntity, SimpleMigrationStep, IPermissionMapper), Vue 2 / Vuex, @nextcloud/vue, jest, phpunit via `~/deck-test.sh`.

## Global Constraints

- Fork `avuz-conecta/deck`, branch `avuz`, at `apps/deck`. Version bump **1.17.3 → 1.17.4**.
- **Union-only**: effective board perms = OR of own board ACL + all ancestor-folder ACLs. **No per-item override/subtract.** Never cap inherited perms.
- **Mirror existing patterns, do not invent**: `lib/Db/Acl.php`, `lib/Db/AclMapper.php`, board `addAcl/updateAcl/deleteAcl` in `BoardService`, board ACL routes, `src/components/board/SharingTabSidebar.vue`, `src/services/SharingApi.js`. Reuse `PermissionService::userCan` for user/group/circle resolution — never re-implement membership.
- **No DB foreign keys** (Deck convention; cascade/guards in app code).
- **Single injection point**: inherited union goes into `PermissionService::getPermissions` (+ `matchPermissions`), never scattered across services.
- Sharing/folder-management ops gate on folder **MANAGE**; the per-share **SHARE** flag = onward re-share (board parity).
- **Cache**: invalidate `permissionCache` for a folder's subtree boards on any folder-ACL write.
- **Portuguese UI**: user-facing strings are `t('deck', '<PT text>')` — the Portuguese msgid IS the displayed text for pt_BR (do not leave English msgids).
- Commit rebuilt `js/` (Dockerfile can't rebuild). Sentinel `AVUZ-FOLDER-SHARING-V1` in `FolderController.php`. No "Claude Code" in commit messages.
- Tests assert **behavior**, not implementation. PHP `@group DB` tests need the multiline docblock. Run PHP via `~/deck-test.sh --filter <Test>`, JS via `npm run test -- <file>`.

---

### Task 1: Migration + FolderAcl entity + FolderAclMapper + version bump

**Files:**
- Create: `lib/Db/FolderAcl.php`
- Create: `lib/Db/FolderAclMapper.php`
- Create: `lib/Migration/Version11704Date20260814120000.php`
- Modify: `appinfo/info.xml` (version `1.17.3` → `1.17.4`)
- Test: `tests/unit/Db/FolderAclMapperTest.php`

**Interfaces (Produces):**
- `FolderAcl` — props `participant:string, type:int, folderId:int, permissionEdit:bool, permissionShare:bool, permissionManage:bool`; reuses `Acl::PERMISSION_*` + `Acl::PERMISSION_TYPE_*` constants; `getPermission(int $permission): bool` (same switch as `Acl::getPermission`); resolved display fields `participantDisplayName` etc. (mirror `Acl`).
- `FolderAclMapper extends DeckMapper<FolderAcl>`:
  - `findAll(int $folderId): FolderAcl[]`
  - `find(int $id): FolderAcl`
  - `delete(FolderAcl $acl): FolderAcl`
  - `findFolderIdsForUser(string $userId, string[] $groups, string[] $circleIds): int[]` — distinct `folder_id` where (`type`=user ∧ `participant`=userId) ∨ (`type`=group ∧ `participant` IN groups) ∨ (`type`=circle ∧ `participant` IN circleIds).

- [ ] **Step 1: Write the migration.** Create `lib/Migration/Version11704Date20260814120000.php`, class `Version11704Date20260814120000 extends SimpleMigrationStep`. In `changeSchema`, guard with `$schema->hasTable('deck_folder_acl')`; create table columns: `id` (bigint, autoincrement, notnull, primary), `folder_id` (bigint, notnull), `type` (integer, notnull, default 0), `participant` (string, length 64, notnull), `permission_edit`/`permission_share`/`permission_manage` (boolean, notnull, default false). Add index `deck_folder_acl_folder_idx` on `['folder_id']`. Use `OCP\DB\Types`. Mirror the table-creation style of `Version11703Date20260813120000.php`.

- [ ] **Step 2: Bump version.** In `appinfo/info.xml` change `<version>1.17.3</version>` to `<version>1.17.4</version>`.

- [ ] **Step 3: Write the entity.** Create `lib/Db/FolderAcl.php` mirroring `lib/Db/Acl.php` exactly, with `folderId` replacing `boardId` (`protected $folderId;`, `$this->addType('folderId','integer');`). Keep `type`, `participant`, `permissionEdit/Share/Manage`, `owner`, the `addType` calls, `getPermission(int $permission)`, and the JSON/resolved-field handling identical to `Acl`. Do NOT redefine the `PERMISSION_*` constants — reference `Acl::PERMISSION_*`.

- [ ] **Step 4: Write the mapper.** Create `lib/Db/FolderAclMapper.php` mirroring `lib/Db/AclMapper.php`, table `deck_folder_acl`, entity `FolderAcl`. Implement `findAll(int $folderId)`, `find(int $id)`, `delete()`. Add `findFolderIdsForUser(string $userId, array $groups, array $circleIds): int[]` returning distinct `folder_id`s per the Produces contract (build the OR with `$qb->expr()->orX(...)`, guard empty group/circle arrays so `IN ()` is never emitted).

- [ ] **Step 5: Write the failing mapper test.** Create `tests/unit/Db/FolderAclMapperTest.php` (`@group DB` multiline docblock). Insert a folder row + folder-ACL rows (user, group, circle); assert `findAll` returns them, `findFolderIdsForUser('user1', ['grp1'], ['circle1'])` returns the expected folder ids (matching user OR group OR circle), and `delete` removes a row. Mirror `AclMapperTest` setup.

Run: `~/deck-test.sh --filter FolderAclMapperTest`
Expected: FAIL (classes/table not yet wired) → after Steps 1–4 applied to the harness DB, PASS.

- [ ] **Step 6: Apply the migration to the harness DB + run test to pass.** Run `~/deck-test.sh --filter FolderAclMapperTest` (the harness runs `occ upgrade` so `Version11704` creates the table). Expected: PASS.

- [ ] **Step 7: Commit.**
```bash
git add lib/Db/FolderAcl.php lib/Db/FolderAclMapper.php lib/Migration/Version11704Date20260814120000.php appinfo/info.xml tests/unit/Db/FolderAclMapperTest.php
git commit -m "feat(deck): deck_folder_acl table + FolderAcl entity/mapper (P6.1)"
```

---

### Task 2: Folder permission resolver — inject inherited union into getPermissions/matchPermissions

**Files:**
- Modify: `lib/Service/PermissionService.php`
- Test: `tests/unit/Service/PermissionServiceTest.php`

**Interfaces:**
- Consumes: `FolderAclMapper::findFolderIdsForUser` (Task 1), `FolderMapper` (P6), `PermissionService::userCan` (existing), `IGroupManager`, `CirclesService` (both already injected).
- Produces:
  - `PermissionService::folderPermissionsForUser(string $userId): array<int, array<Acl::PERMISSION_*,bool>>` — memoized per request; maps every folder id → accumulated `{READ,EDIT,MANAGE,SHARE}` flags for the user (ancestor-walk union). READ is true whenever any of EDIT/MANAGE/SHARE is (folder access implies read).
  - `PermissionService::inheritedBoardPermissions(int $boardId, string $userId): array` — the accumulated flags of the board's `folderId` (empty map if no folder / no match).
  - `getPermissions` / `matchPermissions` now OR these into their result.

- [ ] **Step 1: Write the failing test.** In `tests/unit/Service/PermissionServiceTest.php` add cases:
  - `testGetPermissionsUnionsInheritedFolderEdit`: board B in folder F; F has folder-ACL `edit` for user U (no board ACL for U); assert `getPermissions(B, U)[PERMISSION_EDIT] === true` and `[PERMISSION_MANAGE] === false`.
  - `testInheritedAccumulatesUpAncestors`: folders A → A1 (A1.parent=A); A shares `edit`, A1 shares `manage` to U; board B.folderId=A1; assert `getPermissions(B,U)` has EDIT and MANAGE true.
  - `testCheckPermissionEnforcesInherited`: same edit-only folder share; assert `checkPermission($cardMapper, $cardId, PERMISSION_EDIT, U)` returns true (card in B) — proves the enforcement path, not just read.
  - `testInheritedCacheInvalidated` can live in Task 4 (needs FolderAclService); keep here only the read-path cases.
  Mock `FolderAclMapper::findFolderIdsForUser` + `FolderMapper::findAll` to build the tree.

Run: `~/deck-test.sh --filter PermissionServiceTest`
Expected: FAIL (`folderPermissionsForUser` undefined / no union).

- [ ] **Step 2: Inject the mappers.** Add `FolderMapper` and `FolderAclMapper` to the `PermissionService` constructor (mirror the existing promoted-property constructor params). Add a private `?array $folderPermsCache = null` memo field.

- [ ] **Step 3: Implement the resolver.** `FolderMapper::findAll()` returns a **flat list** (ordered by parent_id/order/title) — build an id-index locally; do not index the raw result. Seed a folder's own flags from **both** the folder's creator-ownership (implicit full flags) **and** any `folder_acl` grant the user matches.
```php
public function folderPermissionsForUser(string $userId): array {
    if ($this->folderPermsCache !== null) {
        return $this->folderPermsCache;
    }
    $folders = $this->folderMapper->findAll();        // flat Folder[]
    $byId = [];
    foreach ($folders as $f) { $byId[$f->getId()] = $f; }   // id-index (findAll is NOT id-keyed)

    $groups = $this->groupManager->getUserGroupIds($this->userManager->get($userId));
    $circleIds = $this->circlesService->getUserCircles($userId); // already returns string[] of circle ids — do NOT map getSingleId()
    $sharedFolderIds = $this->folderAclMapper->findFolderIdsForUser($userId, $groups, $circleIds);

    $ownFlags = []; // folderId => [EDIT,SHARE,MANAGE]
    foreach ($folders as $f) {                         // creator/owner => implicit full control
        if ($f->getOwner() === $userId) {
            $ownFlags[$f->getId()] = [Acl::PERMISSION_EDIT => true, Acl::PERMISSION_SHARE => true, Acl::PERMISSION_MANAGE => true];
        }
    }
    foreach ($sharedFolderIds as $fid) {               // folder_acl grants, unioned with any owner flags
        $acls = $this->folderAclMapper->findAll($fid);
        $ownFlags[$fid] = $this->unionFlags($ownFlags[$fid] ?? [], [
            Acl::PERMISSION_EDIT => $this->userCan($acls, Acl::PERMISSION_EDIT, $userId),
            Acl::PERMISSION_SHARE => $this->userCan($acls, Acl::PERMISSION_SHARE, $userId),
            Acl::PERMISSION_MANAGE => $this->userCan($acls, Acl::PERMISSION_MANAGE, $userId),
        ]);
    }

    $acc = [];
    $resolve = function (int $fid, callable $self) use (&$acc, $ownFlags, $byId) {
        if (isset($acc[$fid])) { return $acc[$fid]; }
        $acc[$fid] = ['_wip' => true];                 // guard against a malformed cycle (P6 prevents real ones)
        $folder = $byId[$fid] ?? null;
        $parentFlags = ($folder && $folder->getParentId() !== null && !isset($acc[$folder->getParentId()]['_wip']))
            ? $self($folder->getParentId(), $self) : [];
        $acc[$fid] = $this->unionFlags($parentFlags, $ownFlags[$fid] ?? []);
        return $acc[$fid];
    };
    foreach ($byId as $fid => $_f) { $resolve($fid, $resolve); }
    foreach ($acc as $fid => $flags) {
        $acc[$fid][Acl::PERMISSION_READ] = !empty($flags[Acl::PERMISSION_EDIT])
            || !empty($flags[Acl::PERMISSION_SHARE]) || !empty($flags[Acl::PERMISSION_MANAGE]);
    }
    return $this->folderPermsCache = $acc;
}
```
Add private `unionFlags(array $a, array $b): array` (OR of `EDIT/SHARE/MANAGE`). Add `inheritedBoardPermissions(int $boardId, string $userId)`: look up the board's `folderId` (via `boardMapper->find`) and return `folderPermissionsForUser($userId)[$folderId] ?? []`. **Owner-seed test:** add `testFolderOwnerInheritsManageOnContainedBoard` — a folder creator gets MANAGE on a board another user placed inside their folder (consistent with the approved "move propagates access" semantic, in reverse).

- [ ] **Step 4: Union into getPermissions.** In `getPermissions`, after computing the board-ACL `$permissions`, fetch `$inherited = $this->inheritedBoardPermissions($boardId, $userId);` and set each of READ/EDIT/MANAGE/SHARE to `$permissions[X] || ($inherited[X] ?? false)` (keep the existing `sharingDisabledForUser` guard on SHARE). Cache as before.

- [ ] **Step 5: Union into matchPermissions.** Same OR against `inheritedBoardPermissions($board->getId(), $this->userId)`.

- [ ] **Step 6: Run test to pass.** Run: `~/deck-test.sh --filter PermissionServiceTest`. Expected: PASS. Also run `~/deck-test.sh --filter BoardServiceTest` to confirm no regression in existing permission expectations.

- [ ] **Step 7: Commit.**
```bash
git add lib/Service/PermissionService.php tests/unit/Service/PermissionServiceTest.php
git commit -m "feat(deck): inherit folder ACL into board permissions via getPermissions (P6.1)"
```

---

### Task 3: Accessible-boards merge — folder-shared boards in the boards list

**Files:**
- Modify: `lib/Db/BoardMapper.php` (add `findInFolders`)
- Modify: `lib/Service/BoardService.php` (merge into `findAll`)
- Test: `tests/unit/Service/BoardServiceTest.php`, `tests/unit/Db/BoardMapperTest.php`

**Interfaces:**
- Consumes: `FolderAclMapper::findFolderIdsForUser`, `FolderMapper` (already injected in `BoardService`), `PermissionService::folderPermissionsForUser`.
- Produces: `BoardMapper::findInFolders(int[] $folderIds, ...filters): Board[]`; `FolderMapper::expandWithDescendants(int[] $ids): int[]`; `BoardService::findAll` returns direct ∪ folder-reachable boards, deduped, each with merged permissions.
- **DI note (avoid a cycle):** `BoardService` already injects `FolderMapper` (not `FolderService`); put the descendant-expansion (`expandWithDescendants`) on **`FolderMapper`** so both `BoardService` and `FolderService` reuse it without a service cycle. Do **not** inject `FolderService` into `BoardService`.

- [ ] **Step 1: Write failing mapper test.** In `BoardMapperTest`, insert two boards, put board X in folder 900; assert `findInFolders([900, 901])` returns X once and excludes the other. Empty-array input returns `[]`.

- [ ] **Step 2: Implement `findInFolders`.** In `BoardMapper`, add `findInFolders(array $folderIds, bool $includeArchived = true, ?int $since = null, ?int $before = null): array` — `WHERE folder_id IN (:ids)` **plus the same archived/deleted/since/before WHERE clauses `findAllForUser` applies** (push filters into SQL — do NOT post-filter in PHP, which would diverge from the direct-board semantics). Return `[]` immediately if `$folderIds` is empty (never emit `IN ()`). Model it on `findInFolder(int $folderId)` + the filter clauses of `findAllForUser`.

- [ ] **Step 3: Run mapper test to pass.** `~/deck-test.sh --filter BoardMapperTest` → PASS.

- [ ] **Step 4: Write failing service test.** In `BoardServiceTest`:
  - `testFindAllIncludesBoardsInSharedFolder`: user U has no board ACL on board X; X is in folder F shared to U (`edit`); assert `findAll()` for U includes X with `PERMISSION_EDIT` true.
  - `testFindAllSharedFolderCascadesToSubfolder`: F shared to U; board Y in sub-folder F1 (parent F); assert Y included.
  - `testFindAllDedupesDirectAndFolderShare`: X shared to U directly (manage) AND via folder (edit); appears once with manage (union).
  - `testArchivedBoardViaFolderRespectsFilter`: archived board reachable only via shared folder is excluded when `includeArchived=false`.

- [ ] **Step 5: Implement the merge in `BoardService::findAll`.** After the existing `boardMapper->findAllForUser(...)` call:
```php
$groups = $this->groupManager->getUserGroupIds($this->userManager->get($userId));
$circleIds = $this->circlesService->getUserCircles($userId); // already returns string[] of circle ids — do NOT map getSingleId()
$sharedFolderIds = $this->folderAclMapper->findFolderIdsForUser($userId, $groups, $circleIds);
$expanded = $this->folderMapper->expandWithDescendants($sharedFolderIds); // FolderMapper helper (no service cycle)
$folderBoards = $this->boardMapper->findInFolders($expanded, $includeArchived, $since, $before);
```
Merge `$folderBoards` into the existing result **deduped by board id** (a board reachable both directly and via folder appears once). Filtering already happened in SQL (Step 2). Run each merged board through the existing enrichment/permission path so `matchPermissions` unions inherited flags (Task 2). Add `FolderMapper::expandWithDescendants(int[] $ids): int[]` (BFS over `findChildren` / a `parent_id` children-index; dedup; guard empty input).

- [ ] **Step 6: Run service test to pass.** `~/deck-test.sh --filter BoardServiceTest` → PASS.

- [ ] **Step 7: Commit.**
```bash
git add lib/Db/BoardMapper.php lib/Db/FolderMapper.php lib/Service/BoardService.php tests/unit/Service/BoardServiceTest.php tests/unit/Db/BoardMapperTest.php
git commit -m "feat(deck): include folder-shared boards in accessible boards list (P6.1)"
```

---

### Task 4: FolderAclService — CRUD, MANAGE gate, validation, cache invalidation

**Files:**
- Create: `lib/Service/FolderAclService.php`
- Create: `lib/Validators/FolderAclServiceValidator.php` (mirror `BoardServiceValidator`)
- Modify: `lib/Service/PermissionService.php` (add `checkFolderPermission` + subtree cache flush helper)
- Test: `tests/unit/Service/FolderAclServiceTest.php`

**Interfaces:**
- Produces: `FolderAclService::findAll(int $folderId): FolderAcl[]`, `create(int $folderId, int $type, string $participant, bool $edit, bool $share, bool $manage): FolderAcl`, `update(int $aclId, bool $edit, bool $share, bool $manage): FolderAcl`, `delete(int $aclId): FolderAcl`.
- `PermissionService::checkFolderPermission(int $folderId, int $permission, ?string $userId = null): bool` — throws `NoPermissionException` if the user lacks the folder flag (owner OR `folderPermissionsForUser`); `invalidateFolderSubtreeCache(int $folderId): void`.

- [ ] **Step 1: Write failing test.** In `FolderAclServiceTest`:
  - `testCreateRequiresFolderManage`: user without manage on folder → `create` throws `NoPermissionException`.
  - `testCreateAsOwnerSucceeds`: folder owner adds a user ACL → persisted, returned with resolved display name.
  - `testCreateRejectsDuplicateParticipant`: same participant twice → exception.
  - `testDeleteRequiresManage` / `testUpdateRequiresManage`.
  - `testCreateInvalidatesSubtreePermissionCache`: pre-warm `getPermissions` for a board in the folder for user U (no access → false), then `create` an edit ACL for U, then `getPermissions` again returns edit=true (proves the cache was invalidated).

- [ ] **Step 2: Implement `checkFolderPermission` + `invalidateFolderSubtreeCache`.** In `PermissionService`: `checkFolderPermission` = folder owner (`folderMapper->find($folderId)->getOwner() === $userId`) OR `folderPermissionsForUser($userId)[$folderId][$permission] ?? false`, else throw. `invalidateFolderSubtreeCache` = expand folder → descendants (reuse `FolderService::expandWithDescendants` or a mapper walk), collect boards via `boardMapper->findInFolders`, and `permissionCache->remove("$boardId-$userId")` for affected users — simplest correct version: `permissionCache->clear()` (whole-cache flush per request) and null out `$this->folderPermsCache`. Prefer the flush for correctness; note the targeted version as a later optimization.

- [ ] **Step 3: Implement `FolderAclService`.** Mirror `BoardService::addAcl/updateAcl/deleteAcl`:
  - `create`: `$this->permissionService->checkFolderPermission($folderId, Acl::PERMISSION_MANAGE)`; validate the payload via a `FolderAclServiceValidator` mirroring `BoardServiceValidator` (type/participant/flags), and confirm the participant exists (user via `userManager->userExists`, group via `groupManager->groupExists`, circle via `circlesService`), same as board `addAcl`; reject duplicate (`findAll` already contains participant+type); insert; `invalidateFolderSubtreeCache`; return with resolved display fields.
  - `update`: load ACL → `checkFolderPermission(acl->getFolderId(), MANAGE)`; set flags; update; invalidate.
  - `delete`: load ACL → `checkFolderPermission(..., MANAGE)`; delete; invalidate.
  - `findAll`: `checkFolderPermission($folderId, Acl::PERMISSION_READ)`; return `folderAclMapper->findAll` with resolved display names.

- [ ] **Step 4: Run test to pass.** `~/deck-test.sh --filter FolderAclServiceTest` → PASS. Re-run `~/deck-test.sh --filter PermissionServiceTest` (no regression).

- [ ] **Step 5: Commit.**
```bash
git add lib/Service/FolderAclService.php lib/Validators/FolderAclServiceValidator.php lib/Service/PermissionService.php tests/unit/Service/FolderAclServiceTest.php
git commit -m "feat(deck): FolderAclService with MANAGE gate + permission-cache invalidation (P6.1)"
```

---

### Task 5: FolderService — gate management ops on MANAGE + visibility filter + delete cascade

**Files:**
- Modify: `lib/Service/FolderService.php`
- Test: `tests/unit/Service/FolderServiceTest.php`

**Interfaces:**
- Consumes: `PermissionService::checkFolderPermission` + `folderPermissionsForUser`, `FolderAclMapper` (cascade), `BoardMapper` (accessible-board set for visibility — inject `BoardMapper`, NOT `BoardService`, to avoid a cycle).
- Produces: `FolderService::findAll()` returns only visible folders, **each carrying the caller's `permissions` `{PERMISSION_EDIT,SHARE,MANAGE}`** (so the frontend can gate actions); `rename/delete/move/create`(subfolder) gate on folder MANAGE; `delete` purges `folder_acl`.

- [ ] **Step 1: Write failing test.** In `FolderServiceTest`:
  - `testRenameRequiresManage`, `testDeleteRequiresManage`, `testMoveRequiresManage`, `testCreateSubfolderRequiresManageOnParent` — non-manager → `NoPermissionException`.
  - `testCreateRootFolderAllowedForAnyUser` — root folder (no parent) still creatable by any authenticated user (owner becomes creator, gets MANAGE). (Root creation stays open; only ops on existing folders gate.)
  - `testFindAllReturnsOnlyVisibleFolders` — user sees: a folder they created (empty), a folder shared to them, a folder containing a board they can access (+ its ancestors); does NOT see an unrelated folder with only inaccessible boards.
  - `testDeletePurgesFolderAcl` — deleting an (empty) folder removes its `folder_acl` rows.

- [ ] **Step 2: Gate the management ops.** In `FolderService::rename/delete/move`, add `$this->permissionService->checkFolderPermission($id, Acl::PERMISSION_MANAGE)` at the top. In `create`, if `$parentId !== null`, `checkFolderPermission($parentId, Acl::PERMISSION_MANAGE)` (creating a subfolder needs manage on the parent); root creation (`$parentId === null`) stays open. Keep the P6 empty-check + cycle guard.

- [ ] **Step 3: Cascade on delete.** In `delete`, after the empty-check passes, delete all `folderAclMapper->findAll($id)` rows before removing the folder row.

- [ ] **Step 4: Visibility filter + per-folder permissions in `findAll`.** Compute the caller's visible folder set: `visible = creatorFolders ∪ sharedFolderIds ∪ foldersContainingAccessibleBoard`, then add all ancestors of any visible folder (walk `parentId` up) so paths render. Return only those. Reuse `folderPermissionsForUser` (shared/creator) + the accessible-board set (`boardMapper` folderIds + folder-reachable). **On each returned folder, attach the caller's `permissions` = `folderPermissionsForUser($userId)[$folderId]`** (owner ⇒ full) so the SPA can gate the share/rename/delete/subfolder actions. Add a `testFindAllAttachesCallerPermissions` case (owner ⇒ manage true; read-only sharee ⇒ manage false). Keep the existing ordering.

- [ ] **Step 5: Run test to pass.** `~/deck-test.sh --filter FolderServiceTest` → PASS.

- [ ] **Step 6: Commit.**
```bash
git add lib/Service/FolderService.php tests/unit/Service/FolderServiceTest.php
git commit -m "feat(deck): gate folder ops on MANAGE + visibility filter + ACL cascade (P6.1)"
```

---

### Task 6: FolderController ACL endpoints + routes

**Files:**
- Modify: `lib/Controller/FolderController.php`
- Modify: `appinfo/routes.php`
- Test: `tests/unit/Controller/FolderControllerTest.php`

**Interfaces:** Consumes `FolderAclService`. Produces routes `GET/POST /folders/{folderId}/acl`, `PUT/DELETE /folders/{folderId}/acl/{aclId}`.

- [ ] **Step 1: Write failing test.** In `FolderControllerTest`, assert each new action calls the matching `FolderAclService` method with the passed args and returns its result (thin passthrough), mirroring how board ACL controller tests assert.

- [ ] **Step 2: Add controller actions.** In `FolderController` (keep sentinel comment `AVUZ-FOLDER-SHARING-V1`), add `#[NoAdminRequired]` methods `getAcl(int $folderId)`, `addAcl(int $folderId, int $type, string $participant, bool $edit, bool $share, bool $manage)`, `updateAcl(int $folderId, int $aclId, bool $edit, bool $share, bool $manage)`, `deleteAcl(int $folderId, int $aclId)` — each delegating to `FolderAclService` and returning a `DataResponse`. Mirror the board ACL controller actions.

- [ ] **Step 3: Register routes.** In `appinfo/routes.php` add:
```php
['name' => 'folder#getAcl',    'url' => '/folders/{folderId}/acl',         'verb' => 'GET'],
['name' => 'folder#addAcl',    'url' => '/folders/{folderId}/acl',         'verb' => 'POST'],
['name' => 'folder#updateAcl', 'url' => '/folders/{folderId}/acl/{aclId}', 'verb' => 'PUT'],
['name' => 'folder#deleteAcl', 'url' => '/folders/{folderId}/acl/{aclId}', 'verb' => 'DELETE'],
```

- [ ] **Step 4: Run test to pass.** `~/deck-test.sh --filter FolderControllerTest` → PASS.

- [ ] **Step 5: Commit.**
```bash
git add lib/Controller/FolderController.php appinfo/routes.php tests/unit/Controller/FolderControllerTest.php
git commit -m "feat(deck): folder ACL controller endpoints + routes (P6.1)"
```

---

### Task 7: Expose inheritedAcl[] on the board payload

**Files:**
- Modify: `lib/Service/BoardService.php` (enrichment) and/or `lib/Db/Board.php`
- Test: `tests/unit/Service/BoardServiceTest.php`

**Interfaces:** Produces `board.inheritedAcl[]` — for the current user, the ancestor-folder ACL grants that give access, each `{ folderId, folderTitle, permissionEdit, permissionShare, permissionManage }`. Read-only; display only.

- [ ] **Step 1: Write failing test.** In `BoardServiceTest`: board B in folder F shared to U with `edit`; assert the enriched board for U exposes `inheritedAcl` containing one entry with `folderId=F`, `folderTitle`, `permissionEdit=true`. A board with no folder / no inherited grant → empty `inheritedAcl`.

- [ ] **Step 2: Compute + attach.** In the board enrichment path (where `matchPermissions`/labels are attached), for the current user walk the board's folder ancestry; for each ancestor with a `folder_acl` grant the user matches (reuse `folderPermissionsForUser` + `folderAclMapper->findAll` per ancestor), add an entry tagged with the folder's id+title. Attach as `inheritedAcl` on the serialized board (add the property to `Board` with `addType`/relation the same way `acl` is exposed, or attach in enrichment like other computed fields).

- [ ] **Step 3: Run test to pass.** `~/deck-test.sh --filter BoardServiceTest` → PASS.

- [ ] **Step 4: Commit.**
```bash
git add lib/Service/BoardService.php lib/Db/Board.php tests/unit/Service/BoardServiceTest.php
git commit -m "feat(deck): expose inheritedAcl on board payload for via-folder display (P6.1)"
```

---

### Task 8: Lifecycle — participant cleanup + ownership transfer for folders

**Files:**
- Modify: `lib/Listeners/ParticipantCleanupListener.php`
- Modify: `lib/Command/TransferOwnership.php`
- Test: `tests/unit/Listeners/ParticipantCleanupListenerTest.php`, `tests/unit/Command/TransferOwnershipTest.php` (create if absent, else extend)

**Interfaces:** Consumes `FolderAclMapper`, `FolderMapper`. Produces: deleted participant's `folder_acl` rows purged; `TransferOwnership` reassigns `deck_folders.owner`.

- [ ] **Step 1: Write failing tests.** Participant cleanup: after a user is deleted, their `folder_acl` rows are gone (mirror the board-ACL cleanup assertion). Transfer: after transfer from A→B, folders owned by A now have `owner=B`.

- [ ] **Step 2: Extend the listener.** In `ParticipantCleanupListener`, alongside the board-ACL purge, delete `folder_acl` rows whose `participant` matches the removed user/group/circle (add a `FolderAclMapper` deletion query, e.g. `deleteByParticipant(type, participant)`).

- [ ] **Step 3: Extend the command.** In `TransferOwnership`, alongside board ownership, update `deck_folders.owner` from the source to the target uid (add `FolderMapper::transferOwnership(oldUid, newUid)` or reuse an update loop).

- [ ] **Step 4: Run tests to pass.** `~/deck-test.sh --filter ParticipantCleanupListenerTest` and `~/deck-test.sh --filter TransferOwnershipTest` → PASS.

- [ ] **Step 5: Commit.**
```bash
git add lib/Listeners/ParticipantCleanupListener.php lib/Command/TransferOwnership.php lib/Db/FolderAclMapper.php lib/Db/FolderMapper.php tests/unit/Listeners/ParticipantCleanupListenerTest.php tests/unit/Command/TransferOwnershipTest.php
git commit -m "feat(deck): folder ACL cleanup + ownership transfer on user deletion (P6.1)"
```

---

### Task 9: Frontend API + store for folder ACL

**Files:**
- Create: `src/services/FolderSharingApi.js`
- Modify: `src/store/folders.js` (add ACL state + actions)
- Test: `src/services/FolderSharingApi.spec.js`, `src/store/folders.store.spec.js`

**Interfaces:** Produces `getFolderAcl(folderId)`, `addFolderAcl(folderId, payload)`, `updateFolderAcl(folderId, aclId, payload)`, `deleteFolderAcl(folderId, aclId)` (axios wrappers mirroring `SharingApi.js`); store actions `loadFolderAcl/addFolderAcl/updateFolderAcl/removeFolderAcl` + `folderAcls` state keyed by folderId.

- [ ] **Step 1: Write failing API test.** `FolderSharingApi.spec.js`: assert each method hits the right URL (`/folders/{id}/acl` [+ `/{aclId}`]) with the right verb + payload. Mirror `SharingApi.spec` if present, else axios-mock.

- [ ] **Step 2: Implement `FolderSharingApi.js`.** Mirror `src/services/SharingApi.js` (`generateUrl('/apps/deck/folders/{folderId}/acl' ...)`), named exports, `await`/async.

- [ ] **Step 3: Write failing store test.** In `folders.store.spec.js`: dispatching `addFolderAcl` calls the API and commits the returned ACL into `state.folderAcls[folderId]`; `removeFolderAcl` drops it.

- [ ] **Step 4: Implement store.** Add `folderAcls` state + mutations (`setFolderAcls`, `addFolderAcl`, `updateFolderAcl`, `removeFolderAcl` using `Vue.set`/reactive updates) + actions wrapping `FolderSharingApi`, each with `try/catch` + `showError` (PT copy, e.g. `'Não foi possível atualizar o compartilhamento da pasta'`). No magic strings (reuse the existing cache-key/enum pattern if the store has one).

- [ ] **Step 5: Run tests to pass.** `npm run test -- FolderSharingApi` and `npm run test -- folders.store` → PASS.

- [ ] **Step 6: Commit.**
```bash
git add src/services/FolderSharingApi.js src/store/folders.js src/services/FolderSharingApi.spec.js src/store/folders.store.spec.js
git commit -m "feat(deck): folder-ACL api service + store module (P6.1)"
```

---

### Task 10: Folder sharing modal + "Compartilhar" menu item

**Files:**
- Create: `src/components/navigation/FolderSharingModal.vue`
- Modify: `src/components/navigation/AppNavigationFolder.vue`
- (Reuse) `src/components/board/SharingTabSidebar.vue` participant-picker

**Interfaces:** Consumes the folder-ACL store (Task 9). A `Compartilhar` action opens `FolderSharingModal` for that folder.

- [ ] **Step 1: Add the menu item + gate existing actions.** In `AppNavigationFolder.vue`, add an `NcActionButton` (mirroring `Nova subpasta`/`Renomear`/`Excluir` at lines 15–32) labeled `t('deck', 'Compartilhar')` with a share icon, `@click="startShare"`. Add `canManage` computed = `!!this.folder.permissions?.[PERMISSION_MANAGE]` (folder payload now carries `permissions`, Task 5). **Gate all four management actions** (`Compartilhar`, `Nova subpasta`, `Renomear`, `Excluir`) behind `v-if="canManage"` — P6 left them ungated, so a non-manager currently sees actions that now 403. `startShare` opens the modal. Use the app's permission-constant enum (no magic ints).

- [ ] **Step 2: Build the modal.** Create `FolderSharingModal.vue` using `NcModal` (or `NcDialog`) containing the reusable participant-picker + permission-row list. Extract the reusable inner list/picker from `SharingTabSidebar.vue` into a shared child component if it isn't already reusable (do NOT copy-paste its logic); feed it the folder's ACLs + folder-ACL store actions. Search users/groups/circles, add with `edit/share/manage`, edit flags, remove. On open, dispatch `loadFolderAcl(folderId)`.

- [ ] **Step 3: Manual/behavioral check.** Add a jest mount test for `FolderSharingModal` asserting it lists loaded ACLs and calls `addFolderAcl`/`removeFolderAcl` on interaction (behavioral, not pixel).
Run: `npm run test -- FolderSharingModal`
Expected: PASS.

- [ ] **Step 4: Commit.**
```bash
git add src/components/navigation/FolderSharingModal.vue src/components/navigation/AppNavigationFolder.vue src/components/board/SharingTabSidebar.vue
git commit -m "feat(deck): folder sharing modal + Compartilhar menu action (P6.1)"
```

---

### Task 11: Inherited "via folder" rows on the board sharing tab + build bundle

**Files:**
- Modify: `src/components/board/SharingTabSidebar.vue`
- Test: `src/components/board/SharingTabSidebar.spec.js` (create/extend)
- Build: `js/` bundle

**Interfaces:** Consumes `board.inheritedAcl[]` (Task 7).

- [ ] **Step 1: Write failing component test.** `SharingTabSidebar.spec.js`: given a board with `inheritedAcl` = one entry (`folderTitle: 'Orçamentos'`, edit=true), the component renders a read-only row labeled `via Orçamentos` with no remove control; direct-share rows stay editable.

- [ ] **Step 2: Render inherited rows.** In `SharingTabSidebar.vue`, iterate `board.inheritedAcl` and render each as a disabled/read-only row (reuse the participant row markup) labeled `t('deck', 'via {folder}', { folder: entry.folderTitle })`, showing the inherited flags, with edit/remove controls hidden. Place them visually grouped (e.g. under the direct shares) so it's clear they're inherited.

- [ ] **Step 3: Run test to pass.** `npm run test -- SharingTabSidebar` → PASS. Then run the full suites: `npm run test` and `~/deck-test.sh` (no new failures).

- [ ] **Step 4: Lint + build.** `npm run lint` (0 new errors) then `npm run build` (regenerates `js/`).

- [ ] **Step 5: Commit (source + bundle).**
```bash
git add src/components/board/SharingTabSidebar.vue src/components/board/SharingTabSidebar.spec.js js/
git commit -m "feat(deck): inherited via-folder rows on board sharing tab; build bundle v1.17.4 (P6.1)"
```

---

## Self-Review notes (author)

- **Spec coverage:** data model (T1), resolver/enforcement (T2), accessible-boards (T3), share CRUD + gate + cache (T4), folder-mgmt gate + visibility + cascade (T5), endpoints (T6), inheritedAcl payload (T7), lifecycle (T8), frontend api/store (T9), share modal (T10), inherited rows + build (T11). All spec sections mapped.
- **Type consistency:** `folderPermissionsForUser` / `inheritedBoardPermissions` / `checkFolderPermission` / `invalidateFolderSubtreeCache` / `findFolderIdsForUser` / `findInFolders` / `expandWithDescendants` used with the same signatures across tasks.
- **Risk (restated for the final review):** `getPermissions` + `findAllForUser` are Deck's hottest paths. The final whole-branch review must confirm (a) no board visible pre-P6.1 becomes invisible, (b) no user gains unintended access, (c) the per-request memoization actually fires (no N-queries on the board list).
