# Deck Folder Sharing & Permission Inheritance — Design (Phase P6.1)

**Date:** 2026-08-14
**Status:** Approved, ready for implementation plan
**Fork:** `avuz-conecta/deck` (branch `avuz`) at `apps/deck` — target version bump **1.17.3 → 1.17.4**

## Context

Follow-up to P6 (board folders, memory `deck-product-evolution`). P6 shipped folders as
**permission-less containers**: the folder tree was shared and visible to every authenticated user,
and folder ops were open to anyone. Live testing surfaced the gap — a user with no access to any
board inside a folder still saw the folder in their sidebar.

The fix is not cosmetic pruning. Folders become **ACL-bearing objects** that can be shared, mirroring
Nextcloud Drive: share a **folder** and the grantee gets access to every board inside it; share a
single **board** and the grantee gets just that board (P6/today's behavior). Both coexist. Board
access becomes the **union** of a board's own ACL and any ancestor folder shared with the user.

Roadmap position: P1 custom fields (done) → P6 folders (done) → **P6.1 folder sharing (this)** →
P9 styling → P4 subtasks → …

### Decisions locked in brainstorming

1. **Folder share carries `{edit, share, manage}`** flags, inherited by all boards inside (and
   sub-folders, recursively).
2. **Union-only** — no per-item override/subtract. A board's effective access is the OR of its own
   ACL and every ancestor-folder ACL granted to the user. You cannot share a folder but exclude one
   board, nor make one board read-only inside an edit-shared folder. (Matches Drive; ClickUp-style
   per-item override is explicitly out of scope.)
3. **Who can share / manage a folder** — mirrors board behavior faithfully (repo convention overrides
   the earlier "gate on SHARE" wording):
   - Adding/editing/removing a **folder ACL** (sharing) → requires folder **MANAGE** (board
     `addAcl` requires `PERMISSION_MANAGE`; we mirror it). The creator/owner has MANAGE implicitly.
   - The per-share **SHARE** flag governs whether that grantee can **re-share** onward (same
     semantics as `deck_board_acl.permission_share`).
   - Folder **management** (rename / delete / create-subfolder / move) → requires folder **MANAGE**.
     This tightens P6's "any authenticated user" rule.
4. **Revoke** — unshare a folder → the grantee loses *inherited* board access, but boards shared to
   them **directly** remain. Falls out of the union model for free.
5. **Sharing UI** — the folder "…" menu gains **Compartilhar**, opening a **modal** that reuses the
   existing board participant-picker + permission toggles (folders have no detail view, so a modal is
   the natural surface).
6. **Inherited display** — a board reachable only via a shared ancestor folder shows a **read-only
   "via `<folder>`" row** in its own sharing tab (Drive-style), alongside its direct shares.
7. **Visibility** (derived, no longer a standalone feature) — `GET /folders` returns only folders the
   caller can see: **creator ∪ shared-to-user ∪ subtree-holds-an-accessible-board**. Enforced
   server-side so other users' folder titles never reach the wire.

## Goals

- A `deck_folder_acl` table + share/unshare API, mirroring `deck_board_acl` and board ACL endpoints.
- Board access resolution that unions a board's own ACL with ancestor-folder ACLs (down-cascading).
- Folder-management ops gated on folder MANAGE.
- Server-side folder visibility filtering.
- A folder sharing modal (reusing the board picker) + inherited "via folder" rows on the board tab.
- End-to-end type safety and tests, mirroring existing Deck ACL patterns.

## Non-goals (explicitly out of this phase)

- **Per-item override / subtractive permissions** (exclude a board from a shared folder; downgrade one
  board). Union-only.
- **Drag-and-drop** sharing, bulk re-share, share links / public folder links.
- **Folder-level activity, comments, or ownership transfer UI** (owner-deletion handling mirrors
  whatever boards already do; no new transfer surface).
- Moving a whole folder *with re-computed shares* as an atomic audited operation beyond the existing
  P6 re-parent (permission recompute is implicit via the resolver).

## Data model

**No DB foreign keys** (Deck convention — cascade/guards in app code).

### `oc_deck_folder_acl` (new) — mirror `oc_deck_board_acl`

| column | type | notes |
|---|---|---|
| `id` | integer | PK autoincrement |
| `folder_id` | integer | notnull; index `deck_folder_acl_folder_idx` |
| `type` | integer | `0`=user, `1`=group, `7`=circle (`Acl::PERMISSION_TYPE_*`) |
| `participant` | string(64) | uid / gid / circleId |
| `permission_edit` | boolean | default false |
| `permission_share` | boolean | default false |
| `permission_manage` | boolean | default false |

**Migration:** `lib/Migration/Version11704Date20260814120000.php`, extends `SimpleMigrationStep`,
`OCP\DB\Types`, guard `createTable` with `hasTable`. Version integer > 11703.

### Entity + mapper
- `lib/Db/FolderAcl.php` — `RelationalEntity` mirroring `Acl.php`: props `participant, type, folderId,
  permissionEdit, permissionShare, permissionManage`; `addType` for `id/folderId/type/integer`,
  `permission*` boolean. Reuse `Acl::PERMISSION_*` and `PERMISSION_TYPE_*` constants (do **not**
  redefine them). Add resolved display fields (`participantDisplayName`, etc.) the same way `Acl` does
  for serialization to the SPA.
- `lib/Db/FolderAclMapper.php` — `extends DeckMapper<FolderAcl>`, mirroring `AclMapper`:
  `findAll(int $folderId): FolderAcl[]`, `find(int $id): FolderAcl`, `delete`, `isOwner`, and
  `findFolderIdsForUser(userId, groups, circles): int[]` (the folders directly shared to the user).

## Backend architecture

### Permission resolution (the core, `PermissionService`)

The heart of the phase. Add a **folder-inheritance resolver** that, for a given user, computes each
folder's accumulated flags in a single root→leaf pass:

```
accumulatedFlags(folder, user) =
    unionFlags( ownFolderAclFlags(folder, user + user's groups/circles),
                accumulatedFlags(parent(folder), user) )   // root's parent = {}
```

`unionFlags` ORs `edit/share/manage`. Compute once per request over all folders the user could match
(topological order by `parent_id`), producing a `Map<folderId, {edit,share,manage}>`.

Then:
- **Board inherited perms** = `accumulatedFlags(board.folderId, user)` (empty if board has no folder
  or user matches no ancestor ACL).
- **Board effective perms** = `unionFlags(ownBoardAclPerms, inheritedPerms)`; board **owner** = full.

**Single injection point — `getPermissions`.** Verified: `PermissionService::checkPermission` (the
gate every service uses — Card, Stack, Attachment, Comment, Label, Assignment, CustomField, BoardTag)
resolves through **`getPermissions(int $boardId, ?string $userId)`** (line ~57), which is
`permissionCache`-backed (`boardId-userId`). Inject the inherited-folder union **into
`getPermissions`** and it propagates to **every enforcement call and the read path at once**, cached
per board per request — no "sees the board but 403s on edit" split. Also union it into
`matchPermissions(Board)` (line ~95), the in-memory variant used when serializing the boards list.

**Reuse, don't re-implement, membership.** `PermissionService::userCan(array $acls, $permission,
$userId)` already resolves user + group (`groupManager->isInGroup`) + circle
(`circlesService->isUserInCircle`) from an ACL array. `FolderAcl` exposes the same
`getType/getParticipant/getPermission` interface, so `userCan` computes folder-grant flags unchanged.

**Cost — memoize the folder→flags map per request.** Build `Map<folderId,{edit,share,manage}>` for the
user once (O(folders), topological over `parent_id`) and memoize it on `PermissionService`; then
`getPermissions`/`matchPermissions` for each board is an O(1) lookup on `board.folderId`. The existing
`permissionCache` still short-circuits repeat board lookups within the request.

### Accessible-boards query (`BoardService` / `BoardMapper`) — highest-risk change

`BoardMapper::findAllForUser` innerJoins `deck_board_acl` (line ~99/220). Rather than rewrite that hot
SQL, resolve inheritance in the **service layer**:

1. `boardsDirect` = existing `findAllForUser` result (owner + `board_acl`, incl. group/circle).
2. `sharedFolderIds` = folders where `folder_acl` matches the user or the user's groups/circles
   (new `FolderAclMapper::findFolderIdsForUser(userId, groups, circles)`).
3. `expandedFolderIds` = `sharedFolderIds` ∪ all descendants (walk `deck_folders.parent_id` down;
   reuse the P6 tree walk).
4. `boardsViaFolder` = `BoardMapper::findInFolders(expandedFolderIds)` (generalize the P6
   `findInFolder` to accept a list).
5. `accessible` = `boardsDirect ∪ boardsViaFolder`, deduped by board id; each board's permissions
   merged via the resolver above.

Group/circle membership resolution reuses `userCan` / the board path's `getUserGroupIds` +
`circlesService->getUserCircles` (do not re-implement). **`since`/`archived`/`before`/deleted filters
must apply identically to the folder-sourced boards** — a board pulled in via a shared folder must
obey the same archived/deleted/pagination rules the SQL applies to direct boards, or the two sources
diverge. Add explicit tests for an archived board reachable only via a shared folder.

### Folder ACL service + gating

- `lib/Service/FolderAclService.php` (mirror `BoardService`'s `addAcl/updateAcl/deleteAcl`):
  - `findAll(int $folderId): FolderAcl[]` — requires folder **READ** (see gate below).
  - `create(folderId, type, participant, edit, share, manage)` — requires folder **MANAGE**;
    validate participant exists (user/group/circle); reject duplicate participant on the same folder.
  - `update(aclId, edit, share, manage)` — requires folder **MANAGE**.
  - `delete(aclId)` — requires folder **MANAGE**.
- Folder permission checks resolve **folder MANAGE/SHARE/EDIT** for a user =
  creator/owner OR a `folder_acl` grant with the flag (direct or inherited from an ancestor — sharing
  manage on a parent cascades down). The planner picks the cleaner integration: either
  `FolderAclMapper implements IPermissionMapper` so the existing
  `PermissionService::checkPermission($mapper, $folderId, Acl::PERMISSION_*)` accepts it, **or** a
  small dedicated `FolderPermissionService::checkPermission(folderId, permission)` mirroring that
  logic — whichever fits `PermissionService` (which is board-centric today) without contortion.
  Reuse the ancestor-walk resolver above; do not duplicate the flag-union logic.
- `FolderService` (P6) — gate `rename/delete/move/create-subfolder` on folder **MANAGE** (currently
  ungated). `delete` also purges the folder's `folder_acl` rows (cascade).
- `FolderService::findAll` — filter to **visible** folders for the caller (creator ∪ has any
  `folder_acl` match ∪ subtree contains a board the user can access). Compute from (2)–(4) above +
  the user's accessible board set; keep ancestors of any visible node (so the path renders).

### Cache invalidation + lifecycle (correctness — easy to miss)

- **Permission cache.** `getPermissions` caches `boardId-userId`. A folder-ACL change (share / update /
  unshare) silently changes the effective perms of **every board in that folder's subtree** for the
  affected participants. On any `FolderAclService` write, **invalidate `permissionCache` for the
  affected boards** (subtree boards) — or flush it — so a just-shared folder takes effect immediately
  and an unshare revokes immediately. Missing this = stale access after (un)share.
- **Participant deletion.** Extend `ParticipantCleanupListener` to also purge `folder_acl` rows whose
  `participant` is the deleted user/group/circle (it already does this for `board_acl`).
- **Folder owner deletion / transfer.** Extend `TransferOwnership` (command) to reassign
  `deck_folders.owner` alongside boards, so a folder isn't orphaned (no owner = no implicit MANAGE)
  when its creator is removed. Mirror the board handling.

### Controller + routes

- `lib/Controller/FolderController.php` — add `#[NoAdminRequired]` ACL actions (sentinel
  `AVUZ-FOLDER-SHARING-V1`): `getAcl(folderId)`, `addAcl(folderId, type, participant, edit, share,
  manage)`, `updateAcl(folderId, aclId, edit, share, manage)`, `deleteAcl(folderId, aclId)`.
- `appinfo/routes.php` (mirror board ACL routes):
  - `GET    /folders/{folderId}/acl`             → `folder#getAcl`
  - `POST   /folders/{folderId}/acl`             → `folder#addAcl`
  - `PUT    /folders/{folderId}/acl/{aclId}`     → `folder#updateAcl`
  - `DELETE /folders/{folderId}/acl/{aclId}`     → `folder#deleteAcl`
- **Board payload** gains `inheritedAcl[]` — the ancestor-folder ACL entries that grant the current
  user access, each tagged with the source folder (`folderId`, `folderTitle`) and its flags. Computed
  by the resolver; read-only. Used only for display.

## Frontend / UX

### Folder sharing modal
- Folder "…" menu (P6 `AppNavigationFolder.vue`) gains **Compartilhar** → opens a modal
  (`FolderSharingModal.vue`).
- The modal reuses the participant-picker + permission-toggle rows from `SharingTabSidebar.vue`
  (extract the reusable inner list/picker if needed; do not fork-copy the logic). Search
  users/groups/circles, add with `edit/share/manage`, list current shares, edit flags, remove.
- Dispatches to a `folderAcl` store module via a new `FolderSharingApi.js` (mirror `SharingApi.js`):
  `getFolderAcl`, `addFolderAcl`, `updateFolderAcl`, `deleteFolderAcl`.

### Inherited rows on the board sharing tab
- `SharingTabSidebar.vue` renders the board's `inheritedAcl[]` as **read-only rows** labeled
  "via `<folder title>`" with the inherited flags shown but not editable/removable, above or below the
  direct-share list. Direct shares stay fully editable.

### Sidebar tree
- No change to rendering; the tree simply reflects the now-filtered `GET /folders`. Folders the user
  can't see are absent. Nesting still driven by the P6 `buildBoardTree` getter over (visible folders +
  accessible boards).

## Edge cases

- **Board owner** always has full perms regardless of folder shares (unaffected).
- **Union revoke** — removing a folder ACL recomputes access; directly-shared boards persist.
- **Deeper grant wins additively** — folder A (edit) → sub-folder A1 (manage) → board B inherits
  edit+manage. Multiple ancestor grants OR together.
- **Folder delete** — still only when empty (P6 rule) AND requires MANAGE; cascades `folder_acl` rows.
- **Move folder** — P6 cycle guard stays; after a move, inherited access recomputes implicitly (no
  stored denormalized perms to migrate).
- **Group/circle share** — resolved through the same membership helper as board shares; a board is
  accessible if a folder is shared to any of the user's groups/circles.
- **Empty shared folder** — visible to creator + grantees (expected; Drive shows empty shared
  folders), even with no boards yet.
- **Participant no longer exists** (deleted user/group) — mirror board ACL behavior; see cleanup
  listener above.

### Access-semantics implications (settled by the locked decisions — flagged for a veto)

Two consequences fall out of **union-only** + **MANAGE-gated folder ops**. Both match Nextcloud Drive.
Neither is a new question — but they define how powerful folder sharing is, so they're called out:

1. **Folder MANAGE = full control of the boards inside**, including **deleting a board** and
   **re-sharing it**. Union-only (decision 2) forbids capping inherited perms, so `manage` on a folder
   grants `manage` on every board in it. Sharing a folder with `manage` is therefore a heavy grant —
   the UI copy on the share modal should make the level's effect legible (e.g. what "Gerenciar" does).
2. **Moving a folder into a shared folder propagates access.** Moving folder X (which you MANAGE) under
   a folder Y shared with others makes X's boards accessible to Y's grantees — exactly Drive's
   behavior. The move is gated only on **your** MANAGE of X (not on Y), so the exposure is your
   deliberate action, not a third-party leak. No destination-permission gate is added.

## Testing

- **PHP (`~/deck-test.sh`)**:
  - `FolderAclMapperTest` — findAll, find, delete, `findFolderIdsForUser` (user + group + circle).
  - `FolderAclServiceTest` — create/update/delete **gated on folder MANAGE** (non-manager rejected);
    duplicate-participant rejected; delete cascade on folder delete.
  - `PermissionServiceTest` (folder inheritance) — `getPermissions` unions inherited folder perms;
    ancestor-walk accumulates (edit at A + manage at A1 → edit+manage on B); owner = full; no folder =
    board-only; **inherited perm is enforced at `checkPermission`** (a folder-edit grantee passes an
    EDIT check on a card in that board — not just the read path); **cache invalidated on folder-ACL
    change** (share then immediately-effective; unshare then immediately-revoked).
  - `BoardServiceTest` / `BoardMapperTest` — accessible boards include boards under a folder shared to
    the user (direct + descendant folders); group/circle path; dedupe with a direct board share;
    `since`/archived filters still honored (incl. **an archived board reachable only via a shared
    folder**).
  - `ParticipantCleanupListenerTest` / `TransferOwnershipTest` — deleting a participant purges their
    `folder_acl` rows; transferring ownership reassigns `deck_folders.owner`.
  - `FolderServiceTest` — `findAll` returns only visible folders (creator ∪ shared ∪
    subtree-has-accessible-board), ancestors of a visible node kept; rename/delete/move now require
    MANAGE.
  - `FolderControllerTest` — thin passthrough for the four ACL routes.
- **JS (jest)**:
  - `FolderSharingApi.spec.js` — URL/verb/payload per method.
  - Folder-acl store module — add/update/remove reflected in state.
  - `SharingTabSidebar` — renders inherited "via folder" rows read-only; direct rows still editable.

Behavior tests, not implementation.

## Deployment notes (carried from fork gotchas)

- Bump `appinfo/info.xml` to **1.17.4**; `Version11704` runs on upgrade. After deploy, wait for boot
  (~40–60s), verify `installed_version == 1.17.4` AND `deck_folder_acl` exists (via
  `createSchema()->getTables()`, not `occ db:show-tables`). Entrypoint self-heals migrations.
- Commit rebuilt `js/` (Dockerfile can't rebuild it). After deploy, **purge Cloudflare** for the JS
  bundle.
- **Staging host disk** ran to 100% during the P6 deploy (`Fail to create file sequence directory` =
  ENOSPC, self-healed after image prune). Check free space before deploying (memory
  `disk-full-filesequence-crashloop`).
- Sentinel `AVUZ-FOLDER-SHARING-V1` in `FolderController.php`; consider adding to
  `verify_avuz_patches`.
- **Regression watch**: `findAllForUser` is Deck's hottest path — the whole boards list and every
  board-open funnels through access resolution. The final review must confirm no board that was
  visible before P6.1 becomes invisible, and no user gains access they shouldn't.
