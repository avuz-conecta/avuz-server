# Assinaturas Plan 8b: folders and managers (frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show folders, shared envelopes and the managers' views in the Assinaturas app: sidebar scopes and folder tree (drawer on the phone), folder menu and dialogs, share dialog, drag and drop with a keyboard "Mover para…", the wizard's "Pasta" field, the envelope's folder breadcrumb and actions driven by server permissions, and the owner's name in the cancel confirmation.

**Architecture:** Plan 8a's JSON API (documented in the app's `docs/api.md`) is the only source of truth: every summary and detail carries `ownerDisplayName`, `folderId` and `permissions`; the detail carries `folder`; folders carry the viewer's `right`. One folders query (`QUERY_KEYS.folders()`) feeds the tree, the dashboard, the move dialogs and the wizard. Pure helpers in `src/folders/folder-tree.ts` turn the flat folder list into a tree, menu items and move targets; components stay thin.

**Tech Stack:** Vue 3.5 `<script setup>` + TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), TanStack Vue Query 5, `@nextcloud/l10n`, lucide-vue-next, Vitest 4 + `@vue/test-utils` + happy-dom.

**Depends on:** `2026-10-07-assinaturas-plan-8a-folders-managers-backend.md` (all 9 tasks done on the app branch `plan-8-folders-managers`). Continue on that branch.

## Global Constraints

- App repo: `/Users/patrickrezende/work/avuz/assinaturas`, branch `plan-8-folders-managers` (branched off app `main` after Plan 7 = `0.5.0`).
- App version bump in the last task: `appinfo/info.xml` → `0.6.0` (runs after Plan 7 = 0.5.0). Migrations named like the existing ones (`VersionXXXXXXDate2026…`); this plan adds none.
- Gates, each run separately, all exit 0: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` (commit built `js/` and `css/`); `composer run lint`; `tests/env/phpunit.sh` (it auto-runs `tests/env/reset.sh` when the local `avuzconecta:latest` image id differs from `~/.assinaturas-test-image-id` — never rebuild that image during the plan, and stop and ask if a reset would happen).
- Reset guard before any `tests/env/phpunit.sh` run (stop and ask Patrick on `DIFFERENT`):
  ```bash
  [ "$(cat ~/.assinaturas-test-image-id)" = "$(docker image inspect avuzconecta:latest --format '{{.Id}}')" ] && echo same || echo DIFFERENT
  ```
- Frontend tasks run `npm run typecheck`, `npm run lint`, `npm test` at their end; `npm run build` and the commit of `js/`/`css/` (and `dist/` if the build touches it) happen in Task 10. Task 4 also touches PHP and runs `composer run lint` + `tests/env/phpunit.sh --filter PageControllerTest`.
- TypeScript: no `any`, almost no `as`, named exports, no barrel files, async/await, hash maps over switch, named constants, early returns, descriptive names; TanStack Vue Query with query keys from an enum/factory.
- PHP: query builder only (no raw SQL), typed, early returns; every envelope endpoint goes through AccessPolicy (one test per endpoint proving a non-entitled user gets 403/404).
- Tests in 3rd person, never "should"; behaviour not implementation; TDD failing test first.
- WCAG 2.x AA: drag and drop always has a keyboard alternative ("Mover para…"); tree is an accessible tree or list.
- White label: no user-facing string names ZapSign. pt_BR copy natural; l10n via the repo's process.
- Avuz image side (separate repo `/Users/patrickrezende/work/avuz/avuz-server`): if the managers group needs anything at boot beyond the app's repair step, add a task for `docker/lib-assinaturas.sh` with a bash test in `docker/tests` (bash 3.2 + 5); also update `docs/assinaturas-tenant-runbook.md` (managers group, deleted-group caveat). → Done in Plan 8a Task 9; Task 10 here pins the app submodule.
- Commits: conventional messages, NO AI attribution lines. Branch off app `main`.
- **l10n process:** source strings are English in `t(APP_ID, '…')` / `n(APP_ID, '…', '…', count)`. Every new source string gets its pt_BR text in BOTH `l10n/pt_BR.json` (inside `"translations": { … }`) and `l10n/pt_BR.js` (inside `OC.L10N.register("assinaturas", { … }, …)`), as the last entries before the closing brace, same order, same text in both files. `src/l10n.spec.ts` fails on a missing key or a difference between the two files. Plural keys are `"_singular_::_plural_" : ["…", "…"]`. Error codes use `ERROR_SOURCE_TEXTS` in `src/api/error-messages.ts` and need their pt_BR text too.
- If ESLint reports import order, run `npx eslint --fix <file>`; the repo's order is `import type` lines, a blank line, packages, `.vue` components (`../` before `./`), then `.ts` modules (`../` before `./`).
- Component conventions of the repo: camelCase props and events in templates (`:isPhone`, `@newEnvelope`); pure constants and helpers that do not need the instance go in a plain `<script lang="ts">` block above `<script setup>` (see `src/layout/AppFrame.vue`); dialogs are `AvDialog` with an `error` prop, mutations go through a dialog-mutation composable.

## API contract consumed (from Plan 8a, `docs/api.md`)

- `GET /envelopes?scope=mine|shared|company&folderId=<int>&…` — `folderId` lists that folder's own envelopes; 404 `folder_not_found` when not viewable.
- Summary/detail add `ownerDisplayName: string`, `folderId: number | null`, `permissions: {act, edit, remove}`; detail adds `folder: {id, title, path: [{id, title}]} | null`.
- `POST /envelopes {title, fileIds, folderId?}`; `PUT /envelopes/{uuid}/folder {folderId: number|null}` → detail.
- `GET /folders` → `{folders: [{id, title, parentId, ownerUid, ownerDisplayName, sortOrder, right: view|edit|share|manage}]}`; `POST /folders {title, parentId?}` → 201 folder; `PUT /folders/{id} {title}`; `PUT /folders/{id}/parent {parentId}`; `PUT /folders/{id}/owner {ownerUid}`; `DELETE /folders/{id}`.
- `GET /folders/{id}/access` → `{owner: {uid, displayName}, entries: [{id, type: user|group, participantId, displayName, right}]}`; `POST /folders/{id}/access {type, participantId, right}` → 201 entry; `PUT /folders/{id}/access/{entryId} {right}`; `DELETE …/access/{entryId}`; `GET /sharees?search=` → `{sharees: [{type, id, displayName}]}`.
- `GET /usage` → `{month, sent, completed, credits: number|null}` (managers and admins).
- Page config adds `canSeeAll: boolean`; `isAdmin` = Nextcloud admin only.
- New error codes: `folder_not_found`, `folder_title_invalid`, `folder_cycle`, `owner_invalid`, `participant_not_found`, `participant_duplicate`, `right_invalid`, `access_entry_not_found`.

## File structure

| File | Responsibility |
|---|---|
| `src/api/types.ts`, `envelopes.ts`, `folders.ts`, `usage.ts`, `query-keys.ts`, `error-messages.ts` | API shapes, calls, cache keys, error texts |
| `src/app-config.ts` | `canSeeAll` |
| `src/folders/folder-tree.ts` | tree, rights, move targets, folder menu, folder for a new envelope |
| `src/folders/drag-payload.ts` | what a drag carries |
| `src/folders/envelope-moving.ts` | who may move an envelope |
| `src/folders/use-folders.ts` | the folders query and the cache refresh after moves |
| `src/folders/use-folder-mutation.ts` | dialog mutation for folder dialogs |
| `src/folders/FolderTree.vue`, `FolderTreeItem.vue` | the sidebar tree, its menu and drop targets |
| `src/folders/FolderNameDialog.vue`, `FolderDeleteDialog.vue`, `FolderTransferDialog.vue`, `FolderMoveDialog.vue`, `FolderPickerDialog.vue`, `EnvelopeMoveDialog.vue` | folder and envelope dialogs |
| `src/folders/FolderShareDialog.vue`, `ShareePicker.vue` | access list dialog and its combobox |
| `src/layout/navigation-target.ts`, `cached-envelope-placement.ts`, `AppNavigation.vue` | sidebar scopes and the current entry |
| `src/dashboard/list-query.ts`, `DashboardView.vue`, `SubfolderList.vue`, `EnvelopeTable.vue`, `EnvelopeCards.vue` | scopes, folder view, owner names, row move |
| `src/usage/UsageView.vue` | the managers' usage panel |
| `src/wizard/EnvelopeFolderField.vue` | the wizard's "Pasta" |
| `src/detail/FolderBreadcrumb.vue`, `envelope-actions.ts`, `action-menu.ts`, `DetailView.vue`, `DetailHeader.vue`, `CancelDialog.vue`, `SignersCard.vue`, `envelope-meta.ts` | the envelope page |
| `lib/Controller/PageController.php` | serve `/usage` |

---

### Task 1: API types, calls, keys and config

**Files:**
- Modify: `src/api/types.ts`, `src/api/envelopes.ts`, `src/api/query-keys.ts`, `src/api/error-messages.ts`, `src/app-config.ts`, `src/test-support/envelope-fixtures.ts`, `src/files/FilesSidebarTab.vue`
- Create: `src/api/folders.ts`, `src/api/usage.ts`
- Modify: `l10n/pt_BR.json`, `l10n/pt_BR.js`
- Test: `src/api/folders.spec.ts`, `src/api/usage.spec.ts`, `src/api/envelopes.spec.ts`, `src/app-config.spec.ts`, plus the specs listed in Step 6

**Interfaces:**
- Produces:
  - Types: `EnvelopeScope = 'mine' | 'shared' | 'company'`; `EnvelopeListQuery.folderId: number | null`; `EnvelopePermissions {act, edit, remove}`; `EnvelopeSummary.{ownerDisplayName, folderId, permissions}`; `FolderPathStep {id, title}`; `EnvelopeFolderPlacement {id, title, path}`; `EnvelopeDetail.folder`; `FolderRight = 'view' | 'edit' | 'share' | 'manage'`; `EnvelopeFolder {id, title, parentId, ownerUid, ownerDisplayName, sortOrder, right}`; `ParticipantType = 'user' | 'group'`; `FolderAccessEntry`; `FolderAccessList`; `Sharee`; `ManagerUsage`.
  - `envelopes.ts`: `listEnvelopes` sends `folderId` when set; `createEnvelope(title, fileIds, folderId = null)`; `moveEnvelope(uuid, folderId): Promise<EnvelopeDetail>`.
  - `folders.ts`: `listFolders()`, `createFolder(title, parentId)`, `renameFolder(folderId, title)`, `moveFolder(folderId, parentId)`, `transferFolder(folderId, ownerUid)`, `deleteFolder(folderId)`, `getFolderAccess(folderId)`, `addFolderAccess(folderId, type, participantId, right)`, `changeFolderAccess(folderId, entryId, right)`, `removeFolderAccess(folderId, entryId)`, `searchSharees(search, signal?)`.
  - `usage.ts`: `getUsage(): Promise<ManagerUsage>`.
  - `QUERY_KEYS.folders()`, `.folderAccess(folderId)`, `.sharees(search)`, `.usage()`, `.allEnvelopeDetails()`; `DRAFT_CHANGES` gains `'folder'`.
  - `AppConfig.canSeeAll: boolean`.
  - Fixtures default to an owner's view: `ownerDisplayName: 'Patrick Rezende'`, `folderId: null`, `permissions: {act: true, edit: true, remove: false}`, `folder: null`.

- [ ] **Step 1: Write the failing tests**

`src/api/folders.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	addFolderAccess,
	changeFolderAccess,
	createFolder,
	deleteFolder,
	getFolderAccess,
	listFolders,
	moveFolder,
	removeFolderAccess,
	renameFolder,
	searchSharees,
	transferFolder,
} from './folders.ts'

const { get, post, put, remove } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), remove: vi.fn() }))

vi.mock('@nextcloud/axios', () => ({ default: { get, post, put, delete: remove } }))
vi.mock('@nextcloud/router', () => ({ generateUrl: (path: string) => '/index.php' + path }))

const ROOT = '/index.php/apps/assinaturas/api/v1'
const FOLDER = { id: 3, title: 'Contratos', parentId: null, ownerUid: 'maria', ownerDisplayName: 'Maria Souza', sortOrder: 0, right: 'manage' }
const ENTRY = { id: 9, type: 'user', participantId: 'joao', displayName: 'João Lima', right: 'edit' }

beforeEach(() => {
	vi.resetAllMocks()
	get.mockResolvedValue({ data: { folders: [FOLDER] } })
	post.mockResolvedValue({ data: FOLDER })
	put.mockResolvedValue({ data: FOLDER })
	remove.mockResolvedValue({ data: { deleted: true } })
})

describe('the folder calls', () => {
	it('lists the folders the user can view', async () => {
		expect(await listFolders()).toEqual([FOLDER])
		expect(get).toHaveBeenCalledWith(`${ROOT}/folders`)
	})

	it('creates a folder at the top level or under a parent', async () => {
		await createFolder('Contratos', null)
		await createFolder('Fornecedores', 3)

		expect(post).toHaveBeenNthCalledWith(1, `${ROOT}/folders`, { title: 'Contratos', parentId: null })
		expect(post).toHaveBeenNthCalledWith(2, `${ROOT}/folders`, { title: 'Fornecedores', parentId: 3 })
	})

	it('renames, moves and hands a folder over', async () => {
		await renameFolder(3, 'Novos contratos')
		await moveFolder(3, null)
		await transferFolder(3, 'joao')

		expect(put).toHaveBeenNthCalledWith(1, `${ROOT}/folders/3`, { title: 'Novos contratos' })
		expect(put).toHaveBeenNthCalledWith(2, `${ROOT}/folders/3/parent`, { parentId: null })
		expect(put).toHaveBeenNthCalledWith(3, `${ROOT}/folders/3/owner`, { ownerUid: 'joao' })
	})

	it('deletes a folder', async () => {
		await deleteFolder(3)

		expect(remove).toHaveBeenCalledWith(`${ROOT}/folders/3`)
	})
})

describe('the access-list calls', () => {
	it('reads a folder\'s access list', async () => {
		const list = { owner: { uid: 'maria', displayName: 'Maria Souza' }, entries: [ENTRY] }
		get.mockResolvedValue({ data: list })

		expect(await getFolderAccess(3)).toEqual(list)
		expect(get).toHaveBeenCalledWith(`${ROOT}/folders/3/access`)
	})

	it('adds, changes and removes an entry', async () => {
		post.mockResolvedValue({ data: ENTRY })
		put.mockResolvedValue({ data: ENTRY })

		await addFolderAccess(3, 'group', 'financeiro', 'view')
		await changeFolderAccess(3, 9, 'share')
		await removeFolderAccess(3, 9)

		expect(post).toHaveBeenCalledWith(`${ROOT}/folders/3/access`, { type: 'group', participantId: 'financeiro', right: 'view' })
		expect(put).toHaveBeenCalledWith(`${ROOT}/folders/3/access/9`, { right: 'share' })
		expect(remove).toHaveBeenCalledWith(`${ROOT}/folders/3/access/9`)
	})

	it('searches people and groups to share with, cancellable', async () => {
		const sharees = [{ type: 'user', id: 'joao', displayName: 'João Lima' }]
		get.mockResolvedValue({ data: { sharees } })
		const signal = new AbortController().signal

		expect(await searchSharees('jo', signal)).toEqual(sharees)
		expect(get).toHaveBeenCalledWith(`${ROOT}/sharees`, { params: { search: 'jo' }, signal })
	})
})
```

`src/api/usage.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getUsage } from './usage.ts'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@nextcloud/axios', () => ({ default: { get } }))
vi.mock('@nextcloud/router', () => ({ generateUrl: (path: string) => '/index.php' + path }))

beforeEach(() => vi.resetAllMocks())

describe('getUsage', () => {
	it('reads this month\'s usage for managers', async () => {
		const usage = { month: '2026-10', sent: 12, completed: 9, credits: 140 }
		get.mockResolvedValue({ data: usage })

		expect(await getUsage()).toEqual(usage)
		expect(get).toHaveBeenCalledWith('/index.php/apps/assinaturas/api/v1/usage')
	})
})
```

In `src/api/envelopes.spec.ts`: add `moveEnvelope` to the import list; in the `listEnvelopes` describe change `QUERY` to `{ scope: 'company', folderId: null, filter: 'pending', search: 'contrato', sort: 'deadline', page: 2, perPage: 25, fileId: null }` and the expected params' `scope: 'all'` to `scope: 'company'`; then add:

```ts
	it('asks for the envelopes of a folder', async () => {
		get.mockResolvedValue({ data: LISTING })

		await listEnvelopes({ ...QUERY, folderId: 7 })

		expect(get).toHaveBeenCalledWith(ROOT, expect.objectContaining({ params: expect.objectContaining({ folderId: 7 }) }))
	})
```

and a new describe:

```ts
describe('filing envelopes', () => {
	it('creates a draft without a folder unless one is given', async () => {
		await createEnvelope('Contrato', [1])
		await createEnvelope('Contrato', [1], 7)

		expect(post).toHaveBeenNthCalledWith(1, ROOT, { title: 'Contrato', fileIds: [1] })
		expect(post).toHaveBeenNthCalledWith(2, ROOT, { title: 'Contrato', fileIds: [1], folderId: 7 })
	})

	it('moves an envelope into a folder or out of every folder', async () => {
		await moveEnvelope('u', 7)
		await moveEnvelope('u', null)

		expect(put).toHaveBeenNthCalledWith(1, `${ROOT}/u/folder`, { folderId: 7 }, DRAFT_SAVE)
		expect(put).toHaveBeenNthCalledWith(2, `${ROOT}/u/folder`, { folderId: null }, DRAFT_SAVE)
	})
})
```

In `src/app-config.spec.ts`: add `canSeeAll: false,` after every `isAdmin: false,` in `SERVED_CONFIG` and `mockConfig`, add `expect(config.canSeeAll).toBe(false)` to the locked-down test, and add to the malformed cases: `['a see-everything flag that is not a boolean', { ...SERVED_CONFIG, canSeeAll: 'yes' }],`.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/api src/app-config.spec.ts`
Expected: FAIL — `Failed to resolve import "./folders.ts"`, `"./usage.ts"`, `moveEnvelope is not a function`, the `canSeeAll` assertions.

- [ ] **Step 3: Write the types**

In `src/api/types.ts`:
- replace `export type EnvelopeScope = 'mine' | 'all'` with:
  ```ts
  /** Whose envelopes the dashboard lists (docs/api.md, Listing). `company` needs canSeeAll. */
  export type EnvelopeScope = 'mine' | 'shared' | 'company'
  ```
- in `EnvelopeListQuery`, add `folderId: number | null` after `fileId: number | null`.
- after `EnvelopeSummarySigner`, add:
  ```ts
  /** What the current user may do with an envelope: act on it (and file it), edit the draft, delete it as an admin. */
  export interface EnvelopePermissions {
  	act: boolean
  	edit: boolean
  	remove: boolean
  }
  ```
- in `EnvelopeSummary`, add after `signers: EnvelopeSummarySigner[]`:
  ```ts
  	ownerDisplayName: string
  	/** The folder the envelope is filed in, or null ("Sem pasta"). */
  	folderId: number | null
  	permissions: EnvelopePermissions
  ```
- before `export interface EnvelopeDetail`, add:
  ```ts
  export interface FolderPathStep {
  	id: number
  	title: string
  }

  /** The envelope's folder and the ancestors the viewer can see, top first. */
  export interface EnvelopeFolderPlacement {
  	id: number
  	title: string
  	path: FolderPathStep[]
  }
  ```
- in `EnvelopeDetail`, add after `events: EnvelopeEvent[]`: `folder: EnvelopeFolderPlacement | null`
- at the end of the file, add:
  ```ts
  /** Each right includes the ones before it: Ver, Editar, Compartilhar, Gerenciar. */
  export type FolderRight = 'view' | 'edit' | 'share' | 'manage'

  export interface EnvelopeFolder {
  	id: number
  	title: string
  	/** Null at the top level, and when the viewer cannot see the parent. */
  	parentId: number | null
  	ownerUid: string
  	ownerDisplayName: string
  	sortOrder: number
  	/** The current user's right on the folder. */
  	right: FolderRight
  }

  export type ParticipantType = 'user' | 'group'

  export interface FolderAccessEntry {
  	id: number
  	type: ParticipantType
  	participantId: string
  	displayName: string
  	right: FolderRight
  }

  export interface FolderAccessList {
  	owner: { uid: string, displayName: string }
  	entries: FolderAccessEntry[]
  }

  export interface Sharee {
  	type: ParticipantType
  	id: string
  	displayName: string
  }

  /** The managers' usage panel: this month's envelopes and the plan's remaining credits (null when unknown). */
  export interface ManagerUsage {
  	month: string
  	sent: number
  	completed: number
  	credits: number | null
  }
  ```

- [ ] **Step 4: Write the calls, keys, config and texts**

In `src/api/envelopes.ts`, replace `listEnvelopes` and `createEnvelope` and add `moveEnvelope` after `deleteDraft`:

```ts
/** Lists one page of envelopes, with the count each status filter would show. */
export async function listEnvelopes(query: EnvelopeListQuery): Promise<EnvelopeListing> {
	const { fileId, folderId, ...rest } = query
	const params = { ...rest, ...(fileId === null ? {} : { fileId }), ...(folderId === null ? {} : { folderId }) }
	return calling(async () => (await axios.get<EnvelopeListing>(envelopesUrl(), { params })).data)
}
```

```ts
/** Creates a draft from Drive PDFs; the first file is the main document. With a folder, the draft is filed there. */
export async function createEnvelope(title: string, fileIds: number[], folderId: number | null = null): Promise<EnvelopeDetail> {
	const body = folderId === null ? { title, fileIds } : { title, fileIds, folderId }
	return calling(async () => (await axios.post<EnvelopeDetail>(envelopesUrl(), body)).data)
}
```

```ts
/** Files an envelope in a folder, or in none. The wizard saves a draft's folder through it too. */
export async function moveEnvelope(uuid: string, folderId: number | null): Promise<EnvelopeDetail> {
	return calling(async () => (await axios.put<EnvelopeDetail>(envelopeUrl(uuid, '/folder'), { folderId }, DRAFT_SAVE)).data)
}
```

`src/api/folders.ts`:

```ts
import type { EnvelopeFolder, FolderAccessEntry, FolderAccessList, FolderRight, ParticipantType, Sharee } from './types.ts'

import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'
import { API_ROOT } from '../app-urls.ts'
import { calling } from './api-error.ts'

function foldersUrl(path = ''): string {
	return generateUrl(`${API_ROOT}/folders${path}`)
}

function folderUrl(folderId: number, path = ''): string {
	return foldersUrl(`/${folderId}${path}`)
}

/** Every folder the user can view, in display order, each with the user's right. */
export async function listFolders(): Promise<EnvelopeFolder[]> {
	return calling(async () => (await axios.get<{ folders: EnvelopeFolder[] }>(foldersUrl())).data.folders)
}

/** Creates a folder at the top level (null) or under a parent the user can edit. */
export async function createFolder(title: string, parentId: number | null): Promise<EnvelopeFolder> {
	return calling(async () => (await axios.post<EnvelopeFolder>(foldersUrl(), { title, parentId })).data)
}

export async function renameFolder(folderId: number, title: string): Promise<EnvelopeFolder> {
	return calling(async () => (await axios.put<EnvelopeFolder>(folderUrl(folderId), { title })).data)
}

/** Moves a folder under another one, or to the top level (null). */
export async function moveFolder(folderId: number, parentId: number | null): Promise<EnvelopeFolder> {
	return calling(async () => (await axios.put<EnvelopeFolder>(folderUrl(folderId, '/parent'), { parentId })).data)
}

/** Hands a folder to another member (managers only). */
export async function transferFolder(folderId: number, ownerUid: string): Promise<EnvelopeFolder> {
	return calling(async () => (await axios.put<EnvelopeFolder>(folderUrl(folderId, '/owner'), { ownerUid })).data)
}

/** Deletes a folder; its subfolders and envelopes move to its parent. */
export async function deleteFolder(folderId: number): Promise<void> {
	await calling(() => axios.delete(folderUrl(folderId)))
}

export async function getFolderAccess(folderId: number): Promise<FolderAccessList> {
	return calling(async () => (await axios.get<FolderAccessList>(folderUrl(folderId, '/access'))).data)
}

export async function addFolderAccess(folderId: number, type: ParticipantType, participantId: string, right: FolderRight): Promise<FolderAccessEntry> {
	return calling(async () => (await axios.post<FolderAccessEntry>(folderUrl(folderId, '/access'), { type, participantId, right })).data)
}

export async function changeFolderAccess(folderId: number, entryId: number, right: FolderRight): Promise<FolderAccessEntry> {
	return calling(async () => (await axios.put<FolderAccessEntry>(folderUrl(folderId, `/access/${entryId}`), { right })).data)
}

export async function removeFolderAccess(folderId: number, entryId: number): Promise<void> {
	await calling(() => axios.delete(folderUrl(folderId, `/access/${entryId}`)))
}

/** Members and groups to share with; the signal cancels a search a newer one replaced. */
export async function searchSharees(search: string, signal?: AbortSignal): Promise<Sharee[]> {
	return calling(async () => (await axios.get<{ sharees: Sharee[] }>(generateUrl(`${API_ROOT}/sharees`), { params: { search }, signal })).data.sharees)
}
```

`src/api/usage.ts`:

```ts
import type { ManagerUsage } from './types.ts'

import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'
import { API_ROOT } from '../app-urls.ts'
import { calling } from './api-error.ts'

/** This month's envelopes and the plan's credits, for the managers' usage panel. */
export async function getUsage(): Promise<ManagerUsage> {
	return calling(async () => (await axios.get<ManagerUsage>(generateUrl(`${API_ROOT}/usage`))).data)
}
```

In `src/api/query-keys.ts`:
- replace the `DRAFT_CHANGES` line with `export const DRAFT_CHANGES = ['title', 'documents', 'signers', 'signingOrder', 'fields', 'settings', 'folder'] as const`
- add to `QUERY_KEYS` after `envelope`:
  ```ts
  	/** Every open envelope's detail, e.g. to read their folder paths again after a folder moved. */
  	allEnvelopeDetails: (): readonly ['envelope'] => ['envelope'],
  	folders: (): readonly ['folders'] => ['folders'],
  	folderAccess: (folderId: number): readonly ['folder-access', number] => ['folder-access', folderId],
  	sharees: (search: string): readonly ['sharees', string] => ['sharees', search],
  	usage: (): readonly ['usage'] => ['usage'],
  ```

In `src/app-config.ts`:
- add `canSeeAll: boolean` after `isAdmin: boolean` in `AppConfig`, with the doc comment `/** Managers and Nextcloud admins: "Toda a empresa", the usage panel, every folder. */`;
- add `canSeeAll: false,` after `isAdmin: false,` in `LOCKED_DOWN`;
- add `&& typeof value.canSeeAll === 'boolean'` after the `isAdmin` check in `isAppConfig`.

In `src/api/error-messages.ts`, add to `ERROR_SOURCE_TEXTS` before `} as const`:

```ts
	folder_not_found: 'This folder does not exist or you cannot see it.',
	folder_title_invalid: 'Enter a folder name of up to 255 characters.',
	folder_cycle: 'A folder cannot move into itself or one of its subfolders.',
	owner_invalid: 'The new owner cannot use Signatures.',
	participant_not_found: 'This person or group no longer exists.',
	participant_duplicate: 'The folder is already shared with this person or group.',
	right_invalid: 'This permission is not valid.',
	access_entry_not_found: 'This access was already removed.',
```

In `src/test-support/envelope-fixtures.ts`, add to the defaults of `envelopeSummary` and of `envelopeDetail`, after `signers: [],`:

```ts
		ownerDisplayName: 'Patrick Rezende',
		folderId: null,
		permissions: { act: true, edit: true, remove: false },
```

and in `envelopeDetail` also `folder: null,` after `events: [],`.

In `src/files/FilesSidebarTab.vue`, add `folderId: null,` after `fileId: props.node.fileid ?? null,` in `listQuery`.

Add to both l10n files:

```json
    "This folder does not exist or you cannot see it." : "Esta pasta não existe ou você não tem acesso a ela.",
    "Enter a folder name of up to 255 characters." : "Informe um nome de pasta com até 255 caracteres.",
    "A folder cannot move into itself or one of its subfolders." : "Uma pasta não pode ser movida para dentro dela mesma ou de uma subpasta.",
    "The new owner cannot use Signatures." : "O novo dono não tem acesso ao Assinaturas.",
    "This person or group no longer exists." : "Esta pessoa ou grupo não existe mais.",
    "The folder is already shared with this person or group." : "A pasta já está compartilhada com esta pessoa ou grupo.",
    "This permission is not valid." : "Esta permissão não é válida.",
    "This access was already removed." : "Este acesso já foi removido."
```

(Mind the comma on the line before the first new entry, and none after the last.)

- [ ] **Step 5: Run the API tests and watch them pass**

Run: `npx vitest run src/api src/app-config.spec.ts`
Expected: PASS.

- [ ] **Step 6: Bring the other specs to the new shapes**

Run `npm run typecheck`. Every error it reports is one of these, fix each as stated:
- an `EnvelopeListQuery` literal without `folderId` (in `src/api/query-keys.spec.ts`, `src/layout/AppFrame.spec.ts` `MY_DASHBOARD_QUERY`, `src/files/FilesSidebarTab.spec.ts`, `src/dashboard/list-query.spec.ts`, `src/dashboard/DashboardView.spec.ts`): add `folderId: null` after `fileId`.
- a `scope: 'all'` literal: change it to `scope: 'company'` (the routes change in Task 3).
- a hand-built `EnvelopeDetail`/`EnvelopeSummary` literal (for example `createdEnvelope()` in `src/new-envelope.spec.ts`): add `ownerDisplayName: 'Alice', folderId: null, permissions: { act: true, edit: true, remove: false },` and, for a detail, `folder: null,`.
- an `AppConfig` literal (for example `configWith()` in `src/layout/AppFrame.spec.ts`): add `canSeeAll: false,`.

- [ ] **Step 7: Run the frontend gates and commit**

Run each: `npm run typecheck`, `npm run lint`, `npm test`. All exit 0. (`src/l10n.spec.ts` checks the eight new error texts.)

```bash
git add src l10n
git commit -m "feat(api): add folder, sharing and usage calls and the viewer's permissions"
```

---

### Task 2: Folder model helpers

**Files:**
- Create: `src/folders/folder-tree.ts`, `src/folders/drag-payload.ts`, `src/folders/envelope-moving.ts`, `src/folders/use-folders.ts`
- Modify: `l10n/pt_BR.json`, `l10n/pt_BR.js`
- Test: `src/folders/folder-tree.spec.ts`, `src/folders/drag-payload.spec.ts`, `src/folders/envelope-moving.spec.ts`

**Interfaces:**
- Consumes: Task 1 types and `listFolders`, `QUERY_KEYS`.
- Produces:
  - `folder-tree.ts`: `FOLDER_RIGHTS`, `FOLDER_TITLE_MAX_LENGTH = 255`, `NO_FOLDER_VALUE = ''`, `interface FolderNode {folder, children}`, `interface FolderOption {value, label}`, `type FolderAction = 'new-subfolder' | 'rename' | 'share' | 'move' | 'transfer' | 'delete'`, `rightAtLeast(right, needed)`, `isFolderRight(value): value is FolderRight`, `canEditFolder(folder)`, `folderById(folders, id | null)`, `buildFolderTree(folders)`, `ancestorIds(folders, id)`, `subtreeIds(folders, id)`, `moveTargetOptions(folders, excluded, noFolderLabel)`, `optionValueOf(folderId | null)`, `folderIdFromOption(value)`, `folderActions(folder, canSeeAll)`, `folderMenuItems(folder, canSeeAll)`, `isFolderAction(id)`, `folderForNewEnvelope(folders, viewedFolderId)`, `participantKey(type, id)`.
  - `drag-payload.ts`: `type DragPayload = {kind: 'envelope', uuid} | {kind: 'folder', folderId}`, `writeDragPayload(transfer, payload)`, `carriesDragPayload(transfer)`, `readDragPayload(transfer)`.
  - `envelope-moving.ts`: `canMoveEnvelope(envelope)`.
  - `use-folders.ts`: `foldersQueryOptions()`, `useFolders(): ComputedRef<EnvelopeFolder[]>`, `refreshFolderViews(queryClient)`.

- [ ] **Step 1: Write the failing tests**

`src/folders/folder-tree.spec.ts`:

```ts
import type { EnvelopeFolder, FolderRight } from '../api/types.ts'

import { describe, expect, it } from 'vitest'
import {
	ancestorIds,
	buildFolderTree,
	folderActions,
	folderForNewEnvelope,
	folderIdFromOption,
	folderMenuItems,
	moveTargetOptions,
	optionValueOf,
	rightAtLeast,
	subtreeIds,
} from './folder-tree.ts'
import { usePortugueseEnvironment } from '../test-support/pt-br-environment.ts'

usePortugueseEnvironment()

function folder(id: number, title: string, parentId: number | null, right: FolderRight = 'manage'): EnvelopeFolder {
	return { id, title, parentId, ownerUid: 'maria', ownerDisplayName: 'Maria Souza', sortOrder: 0, right }
}

const CONTRATOS = folder(1, 'Contratos', null)
const FORNECEDORES = folder(2, 'Fornecedores', 1)
const LIMPEZA = folder(3, 'Limpeza', 2)
const RH = folder(4, 'RH', null, 'view')
const FOLDERS = [CONTRATOS, FORNECEDORES, LIMPEZA, RH]
const NBSP = ' '

describe('rightAtLeast', () => {
	it('orders the rights from view to manage', () => {
		expect(rightAtLeast('manage', 'share')).toBe(true)
		expect(rightAtLeast('edit', 'edit')).toBe(true)
		expect(rightAtLeast('view', 'edit')).toBe(false)
	})
})

describe('buildFolderTree', () => {
	it('nests each folder under its parent, keeping the order it came in', () => {
		const tree = buildFolderTree(FOLDERS)

		expect(tree.map((node) => node.folder.title)).toEqual(['Contratos', 'RH'])
		expect(tree[0]?.children.map((node) => node.folder.title)).toEqual(['Fornecedores'])
		expect(tree[0]?.children[0]?.children.map((node) => node.folder.title)).toEqual(['Limpeza'])
	})

	it('starts a folder whose parent the user cannot see at the top', () => {
		const tree = buildFolderTree([folder(9, 'Compartilhada', 77)])

		expect(tree.map((node) => node.folder.id)).toEqual([9])
	})
})

describe('ancestorIds and subtreeIds', () => {
	it('lists the ancestors from the top down', () => {
		expect(ancestorIds(FOLDERS, LIMPEZA.id)).toEqual([1, 2])
		expect(ancestorIds(FOLDERS, CONTRATOS.id)).toEqual([])
	})

	it('lists a folder and everything below it', () => {
		expect([...subtreeIds(FOLDERS, CONTRATOS.id)].sort()).toEqual([1, 2, 3])
	})
})

describe('moveTargetOptions', () => {
	it('offers "Sem pasta", then every folder the user can edit, indented by depth', () => {
		const options = moveTargetOptions(FOLDERS, new Set(), 'Sem pasta')

		expect(options).toEqual([
			{ value: '', label: 'Sem pasta' },
			{ value: '1', label: 'Contratos' },
			{ value: '2', label: `${NBSP.repeat(3)}Fornecedores` },
			{ value: '3', label: `${NBSP.repeat(6)}Limpeza` },
		])
	})

	it('leaves out a moving folder and everything below it', () => {
		const options = moveTargetOptions(FOLDERS, subtreeIds(FOLDERS, FORNECEDORES.id), 'Sem pasta')

		expect(options.map((option) => option.value)).toEqual(['', '1'])
	})

	it('converts between option values and folder ids', () => {
		expect(optionValueOf(null)).toBe('')
		expect(optionValueOf(3)).toBe('3')
		expect(folderIdFromOption('')).toBeNull()
		expect(folderIdFromOption('3')).toBe(3)
	})
})

describe('the folder menu', () => {
	it.each<[FolderRight, boolean, string[]]>([
		['view', false, []],
		['edit', false, ['new-subfolder', 'rename']],
		['share', false, ['new-subfolder', 'rename', 'share']],
		['manage', false, ['new-subfolder', 'rename', 'share', 'move', 'delete']],
		['manage', true, ['new-subfolder', 'rename', 'share', 'move', 'transfer', 'delete']],
	])('offers a %s holder (manager: %s) only what that right allows', (right, canSeeAll, expected) => {
		expect(folderActions(folder(1, 'Contratos', null, right), canSeeAll)).toEqual(expected)
	})

	it('names each action in pt_BR and marks the deletion as dangerous', () => {
		expect(folderMenuItems(CONTRATOS, true)).toEqual([
			{ id: 'new-subfolder', label: 'Nova subpasta' },
			{ id: 'rename', label: 'Renomear' },
			{ id: 'share', label: 'Compartilhar' },
			{ id: 'move', label: 'Mover para…' },
			{ id: 'transfer', label: 'Transferir' },
			{ id: 'delete', label: 'Excluir', tone: 'danger' },
		])
	})
})

describe('folderForNewEnvelope', () => {
	it('starts a new envelope in the viewed folder when the user can file envelopes there', () => {
		expect(folderForNewEnvelope(FOLDERS, CONTRATOS.id)).toBe(1)
	})

	it('starts it without a folder from a view-only folder or outside folders', () => {
		expect(folderForNewEnvelope(FOLDERS, RH.id)).toBeNull()
		expect(folderForNewEnvelope(FOLDERS, null)).toBeNull()
		expect(folderForNewEnvelope(FOLDERS, 99)).toBeNull()
	})
})
```

`src/folders/drag-payload.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { carriesDragPayload, readDragPayload, writeDragPayload } from './drag-payload.ts'

describe('the drag payload', () => {
	it('carries an envelope from the dashboard to a folder', () => {
		const transfer = new DataTransfer()

		writeDragPayload(transfer, { kind: 'envelope', uuid: 'abc' })

		expect(carriesDragPayload(transfer)).toBe(true)
		expect(readDragPayload(transfer)).toEqual({ kind: 'envelope', uuid: 'abc' })
	})

	it('carries a folder to another folder', () => {
		const transfer = new DataTransfer()

		writeDragPayload(transfer, { kind: 'folder', folderId: 7 })

		expect(readDragPayload(transfer)).toEqual({ kind: 'folder', folderId: 7 })
	})

	it('ignores anything else dragged over a folder', () => {
		const transfer = new DataTransfer()
		transfer.setData('text/plain', 'Contrato.pdf')

		expect(carriesDragPayload(transfer)).toBe(false)
		expect(readDragPayload(transfer)).toBeNull()
		expect(readDragPayload(null)).toBeNull()
	})
})
```

`src/folders/envelope-moving.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { canMoveEnvelope } from './envelope-moving.ts'

describe('canMoveEnvelope', () => {
	it('leaves a draft to its owner', () => {
		expect(canMoveEnvelope({ status: 'draft', permissions: { act: true, edit: true, remove: false } })).toBe(true)
		expect(canMoveEnvelope({ status: 'draft', permissions: { act: true, edit: false, remove: true } })).toBe(false)
	})

	it('lets whoever may act move a sent envelope', () => {
		expect(canMoveEnvelope({ status: 'pending', permissions: { act: true, edit: false, remove: false } })).toBe(true)
		expect(canMoveEnvelope({ status: 'completed', permissions: { act: false, edit: false, remove: false } })).toBe(false)
	})
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/folders`
Expected: FAIL with `Failed to resolve import "./folder-tree.ts"` (and the other two modules).

- [ ] **Step 3: Write the helpers**

`src/folders/folder-tree.ts`:

```ts
import type { EnvelopeFolder, FolderRight, ParticipantType } from '../api/types.ts'
import type { MenuItem } from '../ui/menu.ts'

import { t } from '@nextcloud/l10n'
import { APP_ID } from '../app-config.ts'

/** Each right includes the ones before it (docs/api.md, Access). */
const RIGHT_RANKS: Readonly<Record<FolderRight, number>> = { view: 1, edit: 2, share: 3, manage: 4 }

export const FOLDER_RIGHTS: readonly FolderRight[] = ['view', 'edit', 'share', 'manage']

/** The longest folder title `POST /folders` accepts (docs/api.md, `folder_title_invalid`). */
export const FOLDER_TITLE_MAX_LENGTH = 255

/** The `<select>` value of "Sem pasta". */
export const NO_FOLDER_VALUE = ''

/** Non-breaking spaces per level: a native select cannot style its options, and screen readers skip them. */
const DEPTH_INDENT = '   '

export interface FolderNode {
	folder: EnvelopeFolder
	children: FolderNode[]
}

export interface FolderOption {
	value: string
	label: string
}

export type FolderAction = 'new-subfolder' | 'rename' | 'share' | 'move' | 'transfer' | 'delete'

interface FolderActionRule {
	action: FolderAction
	/** The right it needs, or `manager` for managers and Nextcloud admins only. */
	needs: FolderRight | 'manager'
	label: () => string
	isDangerous: boolean
}

const FOLDER_ACTION_RULES: readonly FolderActionRule[] = [
	{ action: 'new-subfolder', needs: 'edit', label: () => t(APP_ID, 'New subfolder'), isDangerous: false },
	{ action: 'rename', needs: 'edit', label: () => t(APP_ID, 'Rename'), isDangerous: false },
	{ action: 'share', needs: 'share', label: () => t(APP_ID, 'Share'), isDangerous: false },
	{ action: 'move', needs: 'manage', label: () => t(APP_ID, 'Move to…'), isDangerous: false },
	{ action: 'transfer', needs: 'manager', label: () => t(APP_ID, 'Transfer'), isDangerous: false },
	{ action: 'delete', needs: 'manage', label: () => t(APP_ID, 'Delete'), isDangerous: true },
]

export function rightAtLeast(right: FolderRight, needed: FolderRight): boolean {
	return RIGHT_RANKS[right] >= RIGHT_RANKS[needed]
}

export function isFolderRight(value: string): value is FolderRight {
	return FOLDER_RIGHTS.some((right) => right === value)
}

/** Editar: file envelopes, rename, create subfolders. */
export function canEditFolder(folder: EnvelopeFolder): boolean {
	return rightAtLeast(folder.right, 'edit')
}

export function folderById(folders: readonly EnvelopeFolder[], folderId: number | null): EnvelopeFolder | undefined {
	return folderId === null ? undefined : folders.find((folder) => folder.id === folderId)
}

/** The folders as a tree, in the server's order. A folder whose parent the user cannot see starts at the top. */
export function buildFolderTree(folders: readonly EnvelopeFolder[]): FolderNode[] {
	const visibleIds = new Set(folders.map((folder) => folder.id))
	const childrenByParent = new Map<number | null, EnvelopeFolder[]>()
	for (const folder of folders) {
		const parentId = folder.parentId !== null && visibleIds.has(folder.parentId) ? folder.parentId : null
		childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), folder])
	}
	const placed = new Set<number>()
	function nodesUnder(parentId: number | null): FolderNode[] {
		return (childrenByParent.get(parentId) ?? [])
			.filter((folder) => !placed.has(folder.id))
			.map((folder) => {
				placed.add(folder.id)
				return { folder, children: nodesUnder(folder.id) }
			})
	}
	return nodesUnder(null)
}

/** The ids from the top of the user's tree down to the folder's parent. */
export function ancestorIds(folders: readonly EnvelopeFolder[], folderId: number): number[] {
	const ancestors: number[] = []
	let parent = folderById(folders, folderById(folders, folderId)?.parentId ?? null)
	while (parent !== undefined && !ancestors.includes(parent.id)) {
		ancestors.unshift(parent.id)
		parent = folderById(folders, parent.parentId)
	}
	return ancestors
}

/** The folder and every folder below it. */
export function subtreeIds(folders: readonly EnvelopeFolder[], folderId: number): Set<number> {
	const ids = new Set([folderId])
	let isGrowing = true
	while (isGrowing) {
		isGrowing = false
		for (const folder of folders) {
			if (folder.parentId === null || !ids.has(folder.parentId) || ids.has(folder.id)) {
				continue
			}
			ids.add(folder.id)
			isGrowing = true
		}
	}
	return ids
}

/**
 * Where something can move: "Sem pasta" first, then every folder the user can edit, indented by depth.
 * The folders in `excluded` (a moving folder and everything below it) are left out with their subtrees.
 */
export function moveTargetOptions(folders: readonly EnvelopeFolder[], excluded: ReadonlySet<number>, noFolderLabel: string): FolderOption[] {
	const options: FolderOption[] = [{ value: NO_FOLDER_VALUE, label: noFolderLabel }]
	function visit(nodes: readonly FolderNode[], depth: number) {
		for (const { folder, children } of nodes) {
			if (excluded.has(folder.id)) {
				continue
			}
			if (canEditFolder(folder)) {
				options.push({ value: String(folder.id), label: `${DEPTH_INDENT.repeat(depth)}${folder.title}` })
			}
			visit(children, depth + 1)
		}
	}
	visit(buildFolderTree(folders), 0)
	return options
}

export function optionValueOf(folderId: number | null): string {
	return folderId === null ? NO_FOLDER_VALUE : String(folderId)
}

export function folderIdFromOption(value: string): number | null {
	return value === NO_FOLDER_VALUE ? null : Number(value)
}

export function folderActions(folder: EnvelopeFolder, canSeeAll: boolean): FolderAction[] {
	return FOLDER_ACTION_RULES
		.filter(({ needs }) => (needs === 'manager' ? canSeeAll : rightAtLeast(folder.right, needs)))
		.map(({ action }) => action)
}

/** The folder's ⋮ menu: only what the user's right allows; Transferir for managers. */
export function folderMenuItems(folder: EnvelopeFolder, canSeeAll: boolean): MenuItem[] {
	const allowed = folderActions(folder, canSeeAll)
	return FOLDER_ACTION_RULES
		.filter(({ action }) => allowed.includes(action))
		.map(({ action, label, isDangerous }): MenuItem => (isDangerous ? { id: action, label: label(), tone: 'danger' } : { id: action, label: label() }))
}

export function isFolderAction(id: string): id is FolderAction {
	return FOLDER_ACTION_RULES.some(({ action }) => action === id)
}

/** The folder a new envelope starts in: the viewed folder when the user can file envelopes there, else none. */
export function folderForNewEnvelope(folders: readonly EnvelopeFolder[], viewedFolderId: number | null): number | null {
	const viewed = folderById(folders, viewedFolderId)
	return viewed !== undefined && canEditFolder(viewed) ? viewed.id : null
}

/** One key per user or group, as the access list and the share picker compare them. */
export function participantKey(type: ParticipantType, participantId: string): string {
	return `${type}:${participantId}`
}
```

`src/folders/drag-payload.ts`:

```ts
/** What a drag onto a folder carries: an envelope from the dashboard, or a folder from the tree. */
export type DragPayload = { kind: 'envelope', uuid: string } | { kind: 'folder', folderId: number }

const ENVELOPE_TYPE = 'application/x-assinaturas-envelope'
const FOLDER_TYPE = 'application/x-assinaturas-folder'
const DRAG_EFFECT = 'move'

export function writeDragPayload(transfer: DataTransfer, payload: DragPayload): void {
	transfer.effectAllowed = DRAG_EFFECT
	if (payload.kind === 'envelope') {
		transfer.setData(ENVELOPE_TYPE, payload.uuid)
		return
	}
	transfer.setData(FOLDER_TYPE, String(payload.folderId))
}

/** Whether a drag carries something a folder accepts. During dragover only the types are readable, not the data. */
export function carriesDragPayload(transfer: DataTransfer | null): boolean {
	const types = Array.from(transfer?.types ?? [])
	return types.includes(ENVELOPE_TYPE) || types.includes(FOLDER_TYPE)
}

export function readDragPayload(transfer: DataTransfer | null): DragPayload | null {
	if (transfer === null) {
		return null
	}
	const uuid = transfer.getData(ENVELOPE_TYPE)
	if (uuid !== '') {
		return { kind: 'envelope', uuid }
	}
	const folderId = Number(transfer.getData(FOLDER_TYPE))
	return Number.isSafeInteger(folderId) && folderId > 0 ? { kind: 'folder', folderId } : null
}
```

`src/folders/envelope-moving.ts`:

```ts
import type { EnvelopeSummary } from '../api/types.ts'

/** A draft moves with its owner (it is wizard work); a sent envelope with whoever may act on it. */
export function canMoveEnvelope(envelope: Pick<EnvelopeSummary, 'status' | 'permissions'>): boolean {
	return envelope.status === 'draft' ? envelope.permissions.edit : envelope.permissions.act
}
```

`src/folders/use-folders.ts`:

```ts
import type { QueryClient } from '@tanstack/vue-query'
import type { ComputedRef } from 'vue'
import type { EnvelopeFolder } from '../api/types.ts'

import { queryOptions, useQuery } from '@tanstack/vue-query'
import { computed } from 'vue'
import { listFolders } from '../api/folders.ts'
import { QUERY_KEYS } from '../api/query-keys.ts'

export function foldersQueryOptions() {
	return queryOptions({ queryKey: QUERY_KEYS.folders(), queryFn: listFolders })
}

/** Call in setup: every folder the user can view, [] until the first answer. The tree, dashboard and dialogs share one request. */
export function useFolders(): ComputedRef<EnvelopeFolder[]> {
	const query = useQuery(foldersQueryOptions())
	return computed(() => query.data.value ?? [])
}

/** After a folder or an envelope moved: the tree, every listing and every open envelope read again. */
export async function refreshFolderViews(queryClient: QueryClient): Promise<void> {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: QUERY_KEYS.folders() }),
		queryClient.invalidateQueries({ queryKey: QUERY_KEYS.allEnvelopes() }),
		queryClient.invalidateQueries({ queryKey: QUERY_KEYS.allEnvelopeDetails() }),
	])
}
```

Add to both l10n files:

```json
    "New subfolder" : "Nova subpasta",
    "Rename" : "Renomear",
    "Share" : "Compartilhar",
    "Move to…" : "Mover para…",
    "Transfer" : "Transferir"
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/folders`
Expected: PASS.

- [ ] **Step 5: Run the gates and commit**

Run each: `npm run typecheck`, `npm run lint`, `npm test`.

```bash
git add src/folders l10n
git commit -m "feat(folders): add the folder tree, move targets, menu rules and drag payloads"
```

---

### Task 3: Dashboard scopes and the folder view

**Files:**
- Modify: `src/router.ts`, `src/dashboard/list-query.ts`, `src/dashboard/DashboardView.vue`, `src/dashboard/EnvelopeTable.vue`, `src/dashboard/EnvelopeCards.vue`, `src/layout/my-envelope-count.ts`, `src/new-envelope.ts`
- Create: `src/dashboard/SubfolderList.vue`
- Modify: `l10n/pt_BR.json`, `l10n/pt_BR.js`
- Test: `src/dashboard/list-query.spec.ts`, `src/dashboard/DashboardView.spec.ts`, `src/new-envelope.spec.ts`

**Interfaces:**
- Consumes: `useFolders`, `folderById`, `folderForNewEnvelope` (Task 2).
- Produces:
  - `router.ts`: `COMPANY_SCOPE_QUERY = { scope: 'company' }`, `SHARED_SCOPE_QUERY = { scope: 'shared' }`, `folderQuery(folderId): { folderId: string }`.
  - `listQueryFromRoute()` reads `scope` (`shared` for everyone, `company` with `canSeeAll`) and `folderId`; `routeQueryFromList()` writes them.
  - `startNewEnvelope(router, folderId: number | null = null)`.
  - `EnvelopeTable` and `EnvelopeCards` take `showOwners: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `src/dashboard/list-query.spec.ts` (its `app-config` mock reads `admin.value`; change the mock to `appConfig: () => ({ isAdmin: admin.value, canSeeAll: admin.value })`, and replace every `'all'` scope in its existing cases with `'company'`):

```ts
describe('scopes and folders', () => {
	it('lets every member read the shared scope', () => {
		admin.value = false

		expect(listQueryFromRoute({ scope: 'shared' }).scope).toBe('shared')
	})

	it('keeps the company scope for managers and admins', () => {
		admin.value = false
		expect(listQueryFromRoute({ scope: 'company' }).scope).toBe('mine')

		admin.value = true
		expect(listQueryFromRoute({ scope: 'company' }).scope).toBe('company')
	})

	it('reads a folder view and writes it back', () => {
		const query = listQueryFromRoute({ folderId: '7' })

		expect(query.folderId).toBe(7)
		expect(routeQueryFromList(query)).toEqual({ folderId: '7' })
		expect(listQueryFromRoute({ folderId: 'x' }).folderId).toBeNull()
	})
})
```

In `src/dashboard/DashboardView.spec.ts`:
- change the `app-config` mock to `appConfig: () => ({ isAdmin: admin.value, canSeeAll: admin.value })`;
- add `vi.mock('../api/folders.ts', () => ({ listFolders: vi.fn() }))`, import `listFolders` from `'../api/folders.ts'` and `type { EnvelopeFolder }` from `'../api/types.ts'`, and in the top-level `beforeEach` add `vi.mocked(listFolders).mockResolvedValue([])`;
- replace `?scope=all` with `?scope=company` and `scope: 'all'` with `scope: 'company'` everywhere in the file;
- append:

```ts
describe('scopes and folders', () => {
	const CONTRATOS: EnvelopeFolder = { id: 7, title: 'Contratos', parentId: null, ownerUid: 'maria', ownerDisplayName: 'Maria Souza', sortOrder: 0, right: 'edit' }
	const FORNECEDORES: EnvelopeFolder = { ...CONTRATOS, id: 8, title: 'Fornecedores', parentId: 7 }

	it('heads the shared scope "Compartilhados comigo" and asks for it', async () => {
		vi.mocked(listEnvelopes).mockResolvedValue(listing())

		const { wrapper } = await mountDashboard({ path: '/?scope=shared' })

		expect(wrapper.find('h1').text()).toBe('Compartilhados comigo')
		expect(lastListQuery()?.scope).toBe('shared')
	})

	it('heads a folder with its title, lists its subfolders first and asks for its envelopes', async () => {
		vi.mocked(listFolders).mockResolvedValue([CONTRATOS, FORNECEDORES])
		vi.mocked(listEnvelopes).mockResolvedValue(listing())

		const { wrapper } = await mountDashboard({ path: '/?folderId=7' })

		expect(wrapper.find('h1').text()).toBe('Contratos')
		expect(wrapper.find('.subfolders').text()).toContain('Fornecedores')
		expect(wrapper.find('.subfolders a').attributes('href')).toBe('/?folderId=8')
		expect(lastListQuery()?.folderId).toBe(7)
	})

	it('names the owner of each envelope outside "Meus envelopes"', async () => {
		vi.mocked(listEnvelopes).mockResolvedValue(listing({ envelopes: [envelopeSummary({ uuid: 'x', title: 'Locação', ownerDisplayName: 'Maria Souza' })] }))

		const { wrapper } = await mountDashboard({ path: '/?scope=shared' })

		expect(rowOf(wrapper, 'Locação')?.text()).toContain('Maria Souza')
	})

	it('leaves the owner out of "Meus envelopes"', async () => {
		vi.mocked(listEnvelopes).mockResolvedValue(listing({ envelopes: [envelopeSummary({ uuid: 'x', title: 'Locação', ownerDisplayName: 'Patrick Rezende' })] }))

		const { wrapper } = await mountDashboard()

		expect(rowOf(wrapper, 'Locação')?.text()).not.toContain('Patrick Rezende')
	})

	it('starts a new envelope in the viewed folder the user can edit', async () => {
		vi.mocked(listFolders).mockResolvedValue([CONTRATOS])
		vi.mocked(listEnvelopes).mockResolvedValue(EMPTY_LISTING)
		const { wrapper, router } = await mountDashboard({ path: '/?folderId=7' })

		await buttonNamed(wrapper, 'Novo envelope')?.trigger('click')
		await settle()

		expect(startNewEnvelope).toHaveBeenCalledWith(router, 7)
	})

	it('starts it without a folder from a folder the user only views', async () => {
		vi.mocked(listFolders).mockResolvedValue([{ ...CONTRATOS, right: 'view' }])
		vi.mocked(listEnvelopes).mockResolvedValue(EMPTY_LISTING)
		const { wrapper, router } = await mountDashboard({ path: '/?folderId=7' })

		await buttonNamed(wrapper, 'Novo envelope')?.trigger('click')
		await settle()

		expect(startNewEnvelope).toHaveBeenCalledWith(router, null)
	})
})
```

In `src/new-envelope.spec.ts`, append a case (`preparePicker`, `pickNodes`, `pickedNode` and `createdEnvelope` are the spec's existing helpers and hoisted mocks):

```ts
describe('starting from a folder', () => {
	it('files the new draft in the folder it was started from', async () => {
		preparePicker()
		pickNodes.mockResolvedValue([pickedNode(5, 'Contrato.pdf')])
		vi.mocked(createEnvelope).mockResolvedValue(createdEnvelope('novo'))

		await startNewEnvelope(router, 7)

		expect(createEnvelope).toHaveBeenCalledWith('Contrato', [5], 7)
	})

	it('creates the draft without a folder by default', async () => {
		preparePicker()
		pickNodes.mockResolvedValue([pickedNode(5, 'Contrato.pdf')])
		vi.mocked(createEnvelope).mockResolvedValue(createdEnvelope('novo'))

		await startNewEnvelope(router)

		expect(createEnvelope).toHaveBeenCalledWith('Contrato', [5], null)
	})
})
```

The spec's existing cases that assert `createEnvelope` was called with `(title, fileIds)` now see a third argument `null`: add it to those expectations.

In `src/layout/AppFrame.spec.ts`, replace `/?scope=all` with `/?scope=company` and `{ scope: 'all' }` with `{ scope: 'company' }` (the old navigation still shows "Toda a empresa" to `isAdmin` until Task 4).

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/dashboard src/new-envelope.spec.ts`
Expected: FAIL — shared scope reads as `mine`, `folderId` undefined, no `.subfolders`, `startNewEnvelope` called with one argument.

- [ ] **Step 3: Write the routing and list query**

In `src/router.ts`, replace `COMPANY_SCOPE_QUERY` with:

```ts
/** The dashboard query that lists every envelope of the company (managers and admins only). */
export const COMPANY_SCOPE_QUERY = { scope: 'company' } as const satisfies { scope: EnvelopeScope }

/** The dashboard query that lists the envelopes colleagues filed in folders shared with the user. */
export const SHARED_SCOPE_QUERY = { scope: 'shared' } as const satisfies { scope: EnvelopeScope }

/** The dashboard query of one folder's view. */
export function folderQuery(folderId: number): { folderId: string } {
	return { folderId: String(folderId) }
}
```

In `src/dashboard/list-query.ts`:
- add `folderId: null,` after `fileId: null,` in `DEFAULT_LIST_QUERY`;
- replace `scopeFrom()` with:

```ts
/** Who may read each scope: the company's needs managers or admins. */
const SCOPE_ALLOWED: Readonly<Record<EnvelopeScope, () => boolean>> = {
	mine: () => true,
	shared: () => true,
	company: () => appConfig().canSeeAll,
}

function isScope(text: string | null): text is EnvelopeScope {
	return text !== null && Object.hasOwn(SCOPE_ALLOWED, text)
}

function scopeFrom(text: string | null): EnvelopeScope {
	return isScope(text) && SCOPE_ALLOWED[text]() ? text : DEFAULT_LIST_QUERY.scope
}
```

- in `listQueryFromRoute()`, add `folderId: positiveInteger(firstValue(query.folderId)),` after the `fileId` line;
- in `routeQueryFromList()`, add `['folderId', query.folderId],` after `['fileId', query.fileId],`.

In `src/layout/my-envelope-count.ts`, add `&& 'folderId' in listQuery && listQuery.folderId === null` to `isMyUnfilteredListingKey`.

In `src/new-envelope.ts`, replace the last two functions with:

```ts
async function createDraftFromPickedPdfs(router: Router, folderId: number | null): Promise<void> {
	const { limits } = appConfig()
	const nodes = await pickPdfNodes(t(APP_ID, 'Choose the PDFs to send for signature'), limits.maxFiles)
	const draft = draftFromFiles(nodes, limits.maxTitleLength)
	if (draft === null) {
		return
	}
	const { uuid } = await createEnvelope(draft.title, draft.fileIds, folderId)
	await router.push({ name: ROUTE_NAMES.envelope, params: { uuid } })
}

/** Picks PDFs from Drive, creates a draft envelope from them (filed in `folderId` when given) and opens it. */
export async function startNewEnvelope(router: Router, folderId: number | null = null): Promise<void> {
	try {
		await createDraftFromPickedPdfs(router, folderId)
	} catch (error) {
		logger.error('Could not create the envelope', { error })
		showApiError(error)
	}
}
```

- [ ] **Step 4: Write the folder view**

`src/dashboard/SubfolderList.vue`:

```vue
<script setup lang="ts">
import type { EnvelopeFolder } from '../api/types.ts'

import { t } from '@nextcloud/l10n'
import { Folder } from 'lucide-vue-next'
import { useId } from 'vue'
import { RouterLink } from 'vue-router'
import { APP_ID } from '../app-config.ts'
import { ICON_SIZE_INLINE, ICON_STROKE_INLINE } from '../icon-sizes.ts'
import { folderQuery, ROUTE_NAMES } from '../router.ts'

defineProps<{
	folders: EnvelopeFolder[]
}>()

const headingId = useId()
</script>

<template>
	<section class="subfolders" :aria-labelledby="headingId">
		<h2 :id="headingId" class="av-visually-hidden">
			{{ t(APP_ID, 'Subfolders') }}
		</h2>
		<ul class="subfolders__list">
			<li v-for="folder in folders" :key="folder.id">
				<RouterLink class="subfolders__link" :to="{ name: ROUTE_NAMES.dashboard, query: folderQuery(folder.id) }">
					<Folder :size="ICON_SIZE_INLINE" :stroke-width="ICON_STROKE_INLINE" aria-hidden="true" />
					<span>{{ folder.title }}</span>
				</RouterLink>
			</li>
		</ul>
	</section>
</template>

<style scoped>
.subfolders__list {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	margin: 0;
	padding: 0;
	list-style: none;
}

/* 44px tall: the WCAG 2.5.5 touch target on the phone too. */
.subfolders__link {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	min-height: 44px;
	padding: 0 16px;
	border: 1px solid var(--av-hairline);
	border-radius: var(--av-radius-pill);
	color: var(--av-ink);
	font-size: var(--av-text-body);
	text-decoration: none;
}

.subfolders__link:hover {
	background: var(--av-subtle-fill);
}
</style>
```

In `src/dashboard/DashboardView.vue`:
- imports: add `EnvelopeScope` to the `import type { … } from '../api/types.ts'` line; add `import SubfolderList from './SubfolderList.vue'`, `import { folderById, folderForNewEnvelope } from '../folders/folder-tree.ts'`, `import { useFolders } from '../folders/use-folders.ts'`;
- add above `const route = useRoute()` (module-level texts):

```ts
const SCOPE_TEXTS: Readonly<Record<EnvelopeScope, { heading: () => string, description: () => string }>> = {
	mine: { heading: () => t(APP_ID, 'My envelopes'), description: () => t(APP_ID, 'Documents you sent for signature.') },
	shared: { heading: () => t(APP_ID, 'Shared with me'), description: () => t(APP_ID, 'Envelopes your colleagues filed in folders shared with you.') },
	company: { heading: () => t(APP_ID, 'Whole company'), description: () => t(APP_ID, 'Documents the company sent for signature.') },
}
```

- after `const listQuery = …` add `const folders = useFolders()`;
- replace `isCompanyScope`, `heading` and `description` with:

```ts
const viewedFolder = computed(() => folderById(folders.value, listQuery.value.folderId))
const subfolders = computed(() => (listQuery.value.folderId === null ? [] : folders.value.filter((folder) => folder.parentId === listQuery.value.folderId)))
const heading = computed(() => (listQuery.value.folderId === null ? SCOPE_TEXTS[listQuery.value.scope].heading() : viewedFolder.value?.title ?? t(APP_ID, 'Folder')))
const description = computed(() => (listQuery.value.folderId === null ? SCOPE_TEXTS[listQuery.value.scope].description() : t(APP_ID, 'Envelopes filed in this folder.')))
/** Outside "Meus envelopes" envelopes belong to others too, so each names its owner. */
const showsOwners = computed(() => listQuery.value.folderId !== null || listQuery.value.scope !== 'mine')
```

- in `onNewEnvelope()`, replace `await startNewEnvelope(router)` with `await startNewEnvelope(router, folderForNewEnvelope(folders.value, listQuery.value.folderId))`;
- in the template, insert before `<FilterChips`:

```vue
		<SubfolderList v-if="subfolders.length > 0" class="dashboard__subfolders" :folders="subfolders" />
```

- pass `:showOwners="showsOwners"` to `<EnvelopeCards …>` and `<EnvelopeTable …>`;
- in the styles, add `.dashboard--phone .dashboard__subfolders` to the selector list that sets `padding: 0 var(--av-phone-inset);`.

In `src/dashboard/EnvelopeTable.vue`, add `showOwners: boolean` to the props, and replace `<span class="envelope-table__meta">{{ documentsLabel(envelope) }}</span>` with:

```vue
<span class="envelope-table__meta">{{ documentsLabel(envelope) }}<template v-if="showOwners"> · {{ envelope.ownerDisplayName }}</template></span>
```

In `src/dashboard/EnvelopeCards.vue`, add `showOwners: boolean` to the props, and replace `<span class="envelope-card__documents">{{ documentsLabel(envelope) }}</span>` with:

```vue
<span class="envelope-card__documents">{{ documentsLabel(envelope) }}<template v-if="showOwners"> · {{ envelope.ownerDisplayName }}</template></span>
```

Any other component rendering `EnvelopeTable`/`EnvelopeCards` (check with `grep -rn "<EnvelopeTable\|<EnvelopeCards" src`) passes `:showOwners="false"`.

Add to both l10n files:

```json
    "Shared with me" : "Compartilhados comigo",
    "Envelopes your colleagues filed in folders shared with you." : "Envelopes de colegas guardados em pastas compartilhadas com você.",
    "Folder" : "Pasta",
    "Envelopes filed in this folder." : "Envelopes guardados nesta pasta.",
    "Subfolders" : "Subpastas"
```

- [ ] **Step 5: Run them and watch them pass**

Run: `npx vitest run src/dashboard src/new-envelope.spec.ts src/layout`
Expected: PASS.

- [ ] **Step 6: Run the gates and commit**

Run each: `npm run typecheck`, `npm run lint`, `npm test`.

```bash
git add src l10n
git commit -m "feat(dashboard): list shared, company and folder views with their owners"
```

---

### Task 4: Sidebar scopes, current entry and the usage panel

**Files:**
- Create: `src/layout/navigation-target.ts`, `src/layout/cached-envelope-placement.ts`, `src/usage/UsageView.vue`
- Delete: `src/layout/cached-envelope-owner.ts`
- Modify: `src/layout/AppNavigation.vue`, `src/router.ts`, `lib/Controller/PageController.php`
- Modify: `l10n/pt_BR.json`, `l10n/pt_BR.js`
- Test: `src/layout/navigation-target.spec.ts`, `src/usage/UsageView.spec.ts`, `src/layout/AppFrame.spec.ts`, `tests/Integration/Controller/PageControllerTest.php`

**Interfaces:**
- Consumes: `useFolders`, `folderForNewEnvelope`, `listQueryFromRoute`, `SHARED_SCOPE_QUERY`, `COMPANY_SCOPE_QUERY`, `getUsage`.
- Produces:
  - `ROUTE_NAMES.usage = 'usage'`, route `/usage`; server serves `/apps/assinaturas/usage`.
  - `navigation-target.ts`: `type NavigationTarget`, `interface EnvelopePlacement {ownerUid, folderId}`, `interface NavigationState`, `NAVIGATION_TARGETS {mine, shared, company, usage}`, `navigationTarget(state)`, `isSameTarget(a, b)`.
  - `useCachedEnvelopePlacement(uuid getter): ComputedRef<EnvelopePlacement | null>`.
  - `AppNavigation` exposes nothing new; it computes `currentFolderId` for the tree (Task 6 renders the tree).

- [ ] **Step 1: Write the failing tests**

`src/layout/navigation-target.spec.ts`:

```ts
import type { NavigationState } from './navigation-target.ts'

import { describe, expect, it } from 'vitest'
import { ROUTE_NAMES } from '../router.ts'
import { isSameTarget, NAVIGATION_TARGETS, navigationTarget } from './navigation-target.ts'

function state(overrides: Partial<NavigationState>): NavigationState {
	return {
		routeName: ROUTE_NAMES.dashboard,
		listScope: 'mine',
		listFolderId: null,
		envelope: null,
		viewerUid: 'patrick',
		canSeeAll: false,
		visibleFolderIds: new Set([7]),
		...overrides,
	}
}

describe('navigationTarget', () => {
	it('marks the dashboard scope', () => {
		expect(navigationTarget(state({ listScope: 'shared' }))).toEqual(NAVIGATION_TARGETS.shared)
	})

	it('marks the folder of a folder view', () => {
		expect(navigationTarget(state({ listFolderId: 7 }))).toEqual({ kind: 'folder', folderId: 7 })
	})

	it('marks the usage panel', () => {
		expect(navigationTarget(state({ routeName: ROUTE_NAMES.usage }))).toEqual(NAVIGATION_TARGETS.usage)
	})

	describe('on an envelope', () => {
		const ENVELOPE = ROUTE_NAMES.envelope

		it('keeps "Meus envelopes" until the envelope is read', () => {
			expect(navigationTarget(state({ routeName: ENVELOPE }))).toEqual(NAVIGATION_TARGETS.mine)
		})

		it('marks the folder the envelope is filed in when the user sees that folder', () => {
			expect(navigationTarget(state({ routeName: ENVELOPE, envelope: { ownerUid: 'maria', folderId: 7 } }))).toEqual({ kind: 'folder', folderId: 7 })
		})

		it('marks "Meus envelopes" for an own envelope outside the tree', () => {
			expect(navigationTarget(state({ routeName: ENVELOPE, envelope: { ownerUid: 'patrick', folderId: null } }))).toEqual(NAVIGATION_TARGETS.mine)
		})

		it('marks "Toda a empresa" for a manager on a colleague\'s envelope and "Compartilhados comigo" for a member', () => {
			const colleagues = { ownerUid: 'maria', folderId: 99 }

			expect(navigationTarget(state({ routeName: ENVELOPE, envelope: colleagues, canSeeAll: true }))).toEqual(NAVIGATION_TARGETS.company)
			expect(navigationTarget(state({ routeName: ENVELOPE, envelope: colleagues }))).toEqual(NAVIGATION_TARGETS.shared)
		})
	})

	it('marks nothing on another page', () => {
		expect(navigationTarget(state({ routeName: null }))).toEqual({ kind: 'none' })
	})
})

describe('isSameTarget', () => {
	it('compares scopes and folders by value', () => {
		expect(isSameTarget({ kind: 'folder', folderId: 7 }, { kind: 'folder', folderId: 7 })).toBe(true)
		expect(isSameTarget({ kind: 'folder', folderId: 7 }, { kind: 'folder', folderId: 8 })).toBe(false)
		expect(isSameTarget(NAVIGATION_TARGETS.mine, NAVIGATION_TARGETS.shared)).toBe(false)
	})
})
```

`src/usage/UsageView.spec.ts`:

```ts
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, Suspense } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import UsageView from './UsageView.vue'
import { getUsage } from '../api/usage.ts'
import { usePortugueseEnvironment } from '../test-support/pt-br-environment.ts'

const { manager } = vi.hoisted(() => ({ manager: { value: true } }))

vi.mock('../app-config.ts', () => ({ APP_ID: 'assinaturas', appConfig: () => ({ canSeeAll: manager.value }) }))
vi.mock('../api/usage.ts', () => ({ getUsage: vi.fn() }))

usePortugueseEnvironment()

async function mountUsage() {
	const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', name: 'dashboard', component: defineComponent({ render: () => h('p') }) }] })
	const wrapper = mount(defineComponent({ render: () => h(Suspense, null, { default: () => h(UsageView) }) }), {
		global: { plugins: [router, [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]] },
	})
	await flushPromises()
	return wrapper
}

beforeEach(() => {
	manager.value = true
	vi.mocked(getUsage).mockResolvedValue({ month: '2026-10', sent: 12, completed: 9, credits: 140 })
})

describe('the usage panel', () => {
	it('shows a manager this month\'s envelopes and the plan\'s credits', async () => {
		const wrapper = await mountUsage()

		expect(wrapper.find('h1').text()).toContain('outubro de 2026')
		expect(wrapper.text()).toContain('Enviados')
		expect(wrapper.text()).toContain('12')
		expect(wrapper.text()).toContain('Concluídos')
		expect(wrapper.text()).toContain('9')
		expect(wrapper.text()).toContain('Créditos')
		expect(wrapper.text()).toContain('140')
	})

	it('shows a dash for credits the connection check does not know', async () => {
		vi.mocked(getUsage).mockResolvedValue({ month: '2026-10', sent: 0, completed: 0, credits: null })

		const wrapper = await mountUsage()

		expect(wrapper.find('dd:last-of-type').text()).toBe('—')
	})

	it('shows a member the page-not-found state without asking the server', async () => {
		manager.value = false

		const wrapper = await mountUsage()

		expect(wrapper.text()).toContain('Página não encontrada')
		expect(getUsage).not.toHaveBeenCalled()
	})
})
```

(`'Página não encontrada'` is the existing pt_BR of `'Page not found'`; the heading uses the existing `'Usage in {month}'` ("Uso em {month}") with `formatYearMonth`, which writes `outubro de 2026` in pt-BR.)

In `src/layout/AppFrame.spec.ts`:
- add `vi.mock('../api/folders.ts', () => ({ listFolders: vi.fn(async () => []) }))`;
- add `[ROUTE_NAMES.usage]: defineComponent({ render: () => h('p', 'Uso') }),` to `STAND_INS`;
- add `canSeeAll: false,` to `configWith()` (if Task 1 did not already);
- replace the whole `describe('for a user who is not an admin', …)` and `describe('for an admin', …)` blocks with:

```ts
			describe('for a member', () => {
				it('offers "Compartilhados comigo" but neither "Toda a empresa", "Uso" nor "Configurações"', async () => {
					const { wrapper } = await mountFrame()

					expect(navigationLink(wrapper, 'Compartilhados comigo')).toBeDefined()
					expect(navigationLink(wrapper, 'Toda a empresa')).toBeUndefined()
					expect(navigationLink(wrapper, 'Uso')).toBeUndefined()
					expect(navigationLink(wrapper, 'Configurações')).toBeUndefined()
				})

				it('goes to the shared scope from "Compartilhados comigo" and marks it current', async () => {
					const { wrapper, router } = await mountFrame()

					await navigationLink(wrapper, 'Compartilhados comigo')?.trigger('click')
					await flushPromises()

					expect(router.currentRoute.value.query).toEqual({ scope: 'shared' })
					expect(navigationLink(wrapper, 'Compartilhados comigo')?.attributes('aria-current')).toBe('page')
					expect(navigationLink(wrapper, 'Meus envelopes')?.attributes('aria-current')).toBeUndefined()
				})

				it('marks "Compartilhados comigo" current on a colleague\'s envelope', async () => {
					const queryClient = new QueryClient()
					queryClient.setQueryData(QUERY_KEYS.envelope('abc'), envelopeDetail({ uuid: 'abc', ownerUid: 'maria' }))

					const { wrapper } = await mountFrame({ path: '/envelopes/abc', queryClient })

					expect(navigationLink(wrapper, 'Compartilhados comigo')?.attributes('aria-current')).toBe('page')
				})
			})

			describe('for a manager', () => {
				const MANAGER: Partial<AppConfig> = { canSeeAll: true }

				it('offers "Toda a empresa" and "Uso" but not "Configurações"', async () => {
					const { wrapper } = await mountFrame({ config: MANAGER })

					expect(navigationLink(wrapper, 'Toda a empresa')).toBeDefined()
					expect(navigationLink(wrapper, 'Uso')).toBeDefined()
					expect(navigationLink(wrapper, 'Configurações')).toBeUndefined()
				})

				it('marks "Toda a empresa", not "Meus envelopes", as current on the company scope', async () => {
					const { wrapper } = await mountFrame({ config: MANAGER, path: '/?scope=company' })

					expect(navigationLink(wrapper, 'Toda a empresa')?.attributes('aria-current')).toBe('page')
					expect(navigationLink(wrapper, 'Meus envelopes')?.attributes('aria-current')).toBeUndefined()
				})

				it('marks "Toda a empresa" current on a colleague\'s envelope', async () => {
					const queryClient = new QueryClient()
					queryClient.setQueryData(QUERY_KEYS.envelope('abc'), envelopeDetail({ uuid: 'abc', ownerUid: 'maria' }))

					const { wrapper } = await mountFrame({ config: MANAGER, path: '/envelopes/abc', queryClient })

					expect(navigationLink(wrapper, 'Toda a empresa')?.attributes('aria-current')).toBe('page')
					expect(navigationLink(wrapper, 'Meus envelopes')?.attributes('aria-current')).toBeUndefined()
				})

				it('moves the current page to "Toda a empresa" once the colleague\'s envelope is read', async () => {
					const queryClient = new QueryClient()
					const { wrapper } = await mountFrame({ config: MANAGER, path: '/envelopes/abc', queryClient })

					queryClient.setQueryData(QUERY_KEYS.envelope('abc'), envelopeDetail({ uuid: 'abc', ownerUid: 'maria' }))
					await flushPromises()

					expect(navigationLink(wrapper, 'Toda a empresa')?.attributes('aria-current')).toBe('page')
				})

				it('keeps "Meus envelopes" current on an envelope of their own', async () => {
					const queryClient = new QueryClient()
					queryClient.setQueryData(QUERY_KEYS.envelope('abc'), envelopeDetail({ uuid: 'abc', ownerUid: 'patrick' }))

					const { wrapper } = await mountFrame({ config: MANAGER, path: '/envelopes/abc', queryClient })

					expect(navigationLink(wrapper, 'Meus envelopes')?.attributes('aria-current')).toBe('page')
					expect(navigationLink(wrapper, 'Toda a empresa')?.attributes('aria-current')).toBeUndefined()
				})

				it('goes to the company scope from "Toda a empresa"', async () => {
					const { wrapper, router } = await mountFrame({ config: MANAGER })

					await navigationLink(wrapper, 'Toda a empresa')?.trigger('click')
					await flushPromises()

					expect(router.currentRoute.value.query).toEqual({ scope: 'company' })
				})

				it('opens the usage panel from "Uso" and marks it current', async () => {
					const { wrapper, router } = await mountFrame({ config: MANAGER })

					await navigationLink(wrapper, 'Uso')?.trigger('click')
					await flushPromises()

					expect(router.currentRoute.value.name).toBe(ROUTE_NAMES.usage)
					expect(navigationLink(wrapper, 'Uso')?.attributes('aria-current')).toBe('page')
				})
			})

			describe('for a Nextcloud admin', () => {
				it('links "Configurações" to the admin settings', async () => {
					const { wrapper } = await mountFrame({ config: { isAdmin: true, canSeeAll: true } })

					expect(navigationLink(wrapper, 'Configurações')?.attributes('href')).toBe('/index.php/settings/admin/assinaturas')
				})
			})
```

- in the phone test `closes the drawer after following one of its links`, change `config: { isAdmin: true }` to `config: { canSeeAll: true }` and the expected query to `{ scope: 'company' }`; in any other test that passes `config: { isAdmin: true }` only to see "Toda a empresa", pass `{ canSeeAll: true }` instead.

In `tests/Integration/Controller/PageControllerTest.php`, add to `pages()`:

```php
			'usage' => [static fn (PageController $controller): TemplateResponse => $controller->usage()],
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/layout src/usage` and, after the reset guard, `tests/env/phpunit.sh --filter PageControllerTest`
Expected: FAIL — missing `navigation-target.ts`, `UsageView.vue`, `ROUTE_NAMES.usage`, `PageController::usage()`.

- [ ] **Step 3: Write the navigation model**

`src/layout/navigation-target.ts`:

```ts
import type { EnvelopeScope } from '../api/types.ts'

import { ROUTE_NAMES } from '../router.ts'

/** The sidebar entry that stands for the open page. */
export type NavigationTarget
	= | { kind: 'scope', scope: EnvelopeScope }
		| { kind: 'folder', folderId: number }
		| { kind: 'usage' }
		| { kind: 'none' }

/** Where the open envelope belongs, from its cached detail. */
export interface EnvelopePlacement {
	ownerUid: string
	folderId: number | null
}

export interface NavigationState {
	routeName: string | null
	listScope: EnvelopeScope
	listFolderId: number | null
	envelope: EnvelopePlacement | null
	viewerUid: string | null
	canSeeAll: boolean
	visibleFolderIds: ReadonlySet<number>
}

export const NAVIGATION_TARGETS = {
	mine: { kind: 'scope', scope: 'mine' },
	shared: { kind: 'scope', scope: 'shared' },
	company: { kind: 'scope', scope: 'company' },
	usage: { kind: 'usage' },
} as const satisfies Record<string, NavigationTarget>

/**
 * An envelope counts as the user's own until it is read, so the user's own envelopes never flicker. A filed envelope
 * lights its folder when the user sees that folder; a colleague's other envelope lights the scope that lists it.
 */
function envelopeTarget(state: NavigationState): NavigationTarget {
	const { envelope } = state
	if (envelope === null) {
		return NAVIGATION_TARGETS.mine
	}
	if (envelope.folderId !== null && state.visibleFolderIds.has(envelope.folderId)) {
		return { kind: 'folder', folderId: envelope.folderId }
	}
	if (envelope.ownerUid === state.viewerUid) {
		return NAVIGATION_TARGETS.mine
	}
	return state.canSeeAll ? NAVIGATION_TARGETS.company : NAVIGATION_TARGETS.shared
}

function dashboardTarget(state: NavigationState): NavigationTarget {
	return state.listFolderId === null ? { kind: 'scope', scope: state.listScope } : { kind: 'folder', folderId: state.listFolderId }
}

const TARGETS_BY_ROUTE: Readonly<Record<string, (state: NavigationState) => NavigationTarget>> = {
	[ROUTE_NAMES.dashboard]: dashboardTarget,
	[ROUTE_NAMES.envelope]: envelopeTarget,
	[ROUTE_NAMES.usage]: () => NAVIGATION_TARGETS.usage,
}

export function navigationTarget(state: NavigationState): NavigationTarget {
	const resolve = state.routeName === null ? undefined : TARGETS_BY_ROUTE[state.routeName]
	return resolve === undefined ? { kind: 'none' } : resolve(state)
}

export function isSameTarget(first: NavigationTarget, second: NavigationTarget): boolean {
	return JSON.stringify(first) === JSON.stringify(second)
}
```

`src/layout/cached-envelope-placement.ts` (then `git rm src/layout/cached-envelope-owner.ts`):

```ts
import type { ComputedRef } from 'vue'
import type { EnvelopePlacement } from './navigation-target.ts'

import { useQueryClient } from '@tanstack/vue-query'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { envelopeQueryOptions } from '../api/envelope-query.ts'

/**
 * Who owns the open envelope and where it is filed, from the envelope screen's cached query; null while no envelope
 * is open or read yet. Reads the cache only: the navigation never fetches.
 */
export function useCachedEnvelopePlacement(envelopeUuid: () => string | null): ComputedRef<EnvelopePlacement | null> {
	const queryClient = useQueryClient()
	const placement = shallowRef<EnvelopePlacement | null>(null)
	function readPlacement() {
		const uuid = envelopeUuid()
		const envelope = uuid === null ? undefined : queryClient.getQueryData(envelopeQueryOptions(uuid).queryKey)
		placement.value = envelope === undefined ? null : { ownerUid: envelope.ownerUid, folderId: envelope.folderId }
	}
	readPlacement()
	watch(envelopeUuid, readPlacement)
	onScopeDispose(queryClient.getQueryCache().subscribe(readPlacement))
	return computed(() => placement.value)
}
```

In `src/router.ts`, set `ROUTE_NAMES` to `{ dashboard: 'dashboard', envelope: 'envelope', usage: 'usage' }` and add before the catch-all route:

```ts
	{ path: '/usage', name: ROUTE_NAMES.usage, component: () => import('./usage/UsageView.vue') },
```

- [ ] **Step 4: Write the sidebar and the usage panel**

Replace `src/layout/AppNavigation.vue` with:

```vue
<script setup lang="ts">
import type { NavigationTarget } from './navigation-target.ts'

import { n, t } from '@nextcloud/l10n'
import { Building2, ChartColumn, Inbox, Plus, Settings, Users } from 'lucide-vue-next'
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AvButton from '../ui/AvButton.vue'
import NavigationLink from './NavigationLink.vue'
import { APP_ID, appConfig } from '../app-config.ts'
import { adminSettingsUrl } from '../app-urls.ts'
import { currentUid } from '../current-user.ts'
import { listQueryFromRoute } from '../dashboard/list-query.ts'
import { folderForNewEnvelope } from '../folders/folder-tree.ts'
import { useFolders } from '../folders/use-folders.ts'
import { ICON_SIZE_INLINE, ICON_STROKE_EMPHASIS, ICON_STROKE_INLINE } from '../icon-sizes.ts'
import { startNewEnvelope } from '../new-envelope.ts'
import { COMPANY_SCOPE_QUERY, ROUTE_NAMES, SHARED_SCOPE_QUERY } from '../router.ts'
import { useCachedEnvelopePlacement } from './cached-envelope-placement.ts'
import { useMyEnvelopeCount } from './my-envelope-count.ts'
import { isSameTarget, NAVIGATION_TARGETS, navigationTarget } from './navigation-target.ts'

const emit = defineEmits<{ navigate: [] }>()

const { isAdmin, canSeeAll } = appConfig()
const router = useRouter()
const route = useRoute()
const folders = useFolders()
const myEnvelopeCount = useMyEnvelopeCount()
const myEnvelopeCountLabel = computed(() => (myEnvelopeCount.value === null ? null : n(APP_ID, '%n envelope', '%n envelopes', myEnvelopeCount.value)))
const isStartingEnvelope = ref(false)
const newEnvelopeButton = useTemplateRef<InstanceType<typeof AvButton>>('newEnvelopeButton')
const settingsUrl = adminSettingsUrl()

function openEnvelopeUuid(): string | null {
	return route.name === ROUTE_NAMES.envelope && typeof route.params.uuid === 'string' ? route.params.uuid : null
}

const envelopePlacement = useCachedEnvelopePlacement(openEnvelopeUuid)
const listQuery = computed(() => listQueryFromRoute(route.query))
const currentTarget = computed(() => navigationTarget({
	routeName: typeof route.name === 'string' ? route.name : null,
	listScope: listQuery.value.scope,
	listFolderId: listQuery.value.folderId,
	envelope: envelopePlacement.value,
	viewerUid: currentUid(),
	canSeeAll,
	visibleFolderIds: new Set(folders.value.map((folder) => folder.id)),
}))
/** The folder the tree marks as current, if the open page belongs to one. */
const currentFolderId = computed(() => (currentTarget.value.kind === 'folder' ? currentTarget.value.folderId : null))
/** A new envelope starts in the folder being viewed on the dashboard. */
const viewedFolderId = computed(() => (route.name === ROUTE_NAMES.dashboard ? listQuery.value.folderId : null))

function isCurrent(target: NavigationTarget): boolean {
	return isSameTarget(currentTarget.value, target)
}

defineExpose({
	focusNewEnvelope: () => {
		const element: unknown = newEnvelopeButton.value?.$el
		if (element instanceof HTMLElement) {
			element.focus()
		}
	},
})

async function onNewEnvelope() {
	emit('navigate')
	await nextTick()
	isStartingEnvelope.value = true
	try {
		await startNewEnvelope(router, folderForNewEnvelope(folders.value, viewedFolderId.value))
	} finally {
		isStartingEnvelope.value = false
	}
}
</script>

<template>
	<nav class="app-navigation" tabindex="-1" :aria-label="t(APP_ID, 'Signatures')">
		<AvButton
			ref="newEnvelopeButton"
			class="app-navigation__new"
			size="large"
			:disabled="isStartingEnvelope"
			@click="onNewEnvelope">
			<template #icon>
				<Plus :size="ICON_SIZE_INLINE" :stroke-width="ICON_STROKE_EMPHASIS" />
			</template>
			{{ t(APP_ID, 'New envelope') }}
		</AvButton>
		<NavigationLink
			:label="t(APP_ID, 'My envelopes')"
			:to="{ name: ROUTE_NAMES.dashboard }"
			:current="isCurrent(NAVIGATION_TARGETS.mine)"
			:badge="myEnvelopeCount"
			:badgeLabel="myEnvelopeCountLabel"
			@navigate="emit('navigate')">
			<template #icon>
				<Inbox :size="ICON_SIZE_INLINE" :stroke-width="ICON_STROKE_INLINE" aria-hidden="true" />
			</template>
		</NavigationLink>
		<NavigationLink
			:label="t(APP_ID, 'Shared with me')"
			:to="{ name: ROUTE_NAMES.dashboard, query: SHARED_SCOPE_QUERY }"
			:current="isCurrent(NAVIGATION_TARGETS.shared)"
			@navigate="emit('navigate')">
			<template #icon>
				<Users :size="ICON_SIZE_INLINE" :stroke-width="ICON_STROKE_INLINE" aria-hidden="true" />
			</template>
		</NavigationLink>
		<template v-if="canSeeAll">
			<NavigationLink
				:label="t(APP_ID, 'Whole company')"
				:to="{ name: ROUTE_NAMES.dashboard, query: COMPANY_SCOPE_QUERY }"
				:current="isCurrent(NAVIGATION_TARGETS.company)"
				@navigate="emit('navigate')">
				<template #icon>
					<Building2 :size="ICON_SIZE_INLINE" :stroke-width="ICON_STROKE_INLINE" aria-hidden="true" />
				</template>
			</NavigationLink>
			<NavigationLink
				:label="t(APP_ID, 'Usage')"
				:to="{ name: ROUTE_NAMES.usage }"
				:current="isCurrent(NAVIGATION_TARGETS.usage)"
				@navigate="emit('navigate')">
				<template #icon>
					<ChartColumn :size="ICON_SIZE_INLINE" :stroke-width="ICON_STROKE_INLINE" aria-hidden="true" />
				</template>
			</NavigationLink>
		</template>
		<div class="app-navigation__spacer" :data-current-folder="currentFolderId ?? undefined" />
		<NavigationLink v-if="isAdmin" :label="t(APP_ID, 'Settings')" :href="settingsUrl" @navigate="emit('navigate')">
			<template #icon>
				<Settings :size="ICON_SIZE_INLINE" :stroke-width="ICON_STROKE_INLINE" aria-hidden="true" />
			</template>
		</NavigationLink>
	</nav>
</template>

<style scoped>
.app-navigation {
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	flex-shrink: 0;
	gap: 4px;
	width: 280px;
	padding: 24px 16px;
	overflow-y: auto;
	border-radius: var(--av-radius-panel);
	background: var(--av-panel);
}

.app-navigation .app-navigation__new {
	--av-control-height-large: 48px;
	--av-control-margin: 0 0 20px;
	flex-shrink: 0;
	gap: 10px;
}

.app-navigation__spacer {
	flex-grow: 1;
}
</style>
```

(The spacer's `data-current-folder` keeps `currentFolderId` in use until Task 6 hands it to the tree; Task 6 removes that attribute.)

`src/usage/UsageView.vue`:

```vue
<script lang="ts">
/** Credits the connection check does not know (not configured, refused, unreachable). */
const UNKNOWN_CREDITS = '—'
</script>

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import { useQuery } from '@tanstack/vue-query'
import { computed, useId } from 'vue'
import NotFoundView from '../views/NotFoundView.vue'
import { QUERY_KEYS } from '../api/query-keys.ts'
import { getUsage } from '../api/usage.ts'
import { APP_ID, appConfig } from '../app-config.ts'
import { awaitFirstLoad } from '../first-load.ts'
import { formatYearMonth } from '../presentation/dates.ts'
import { PLAIN_TEXT } from '../presentation/plain-text.ts'

const { canSeeAll } = appConfig()
const headingId = useId()

const usageQuery = useQuery({
	queryKey: QUERY_KEYS.usage(),
	queryFn: getUsage,
	enabled: canSeeAll,
	throwOnError: true,
})

const usage = computed(() => usageQuery.data.value)
const credits = computed(() => (usage.value?.credits === null || usage.value === undefined ? UNKNOWN_CREDITS : String(usage.value.credits)))

if (canSeeAll) {
	await awaitFirstLoad(usageQuery)
}
</script>

<template>
	<NotFoundView v-if="!canSeeAll" />
	<section v-else-if="usage !== undefined" class="usage" :aria-labelledby="headingId">
		<h1 :id="headingId" class="usage__title" tabindex="-1">
			{{ t(APP_ID, 'Usage in {month}', { month: formatYearMonth(usage.month) }, undefined, PLAIN_TEXT) }}
		</h1>
		<p class="usage__description">
			{{ t(APP_ID, 'Each send uses 1 envelope of the plan.') }}
		</p>
		<dl class="usage__facts">
			<div class="usage__fact">
				<dt>{{ t(APP_ID, 'Sent') }}</dt>
				<dd>{{ usage.sent }}</dd>
			</div>
			<div class="usage__fact">
				<dt>{{ t(APP_ID, 'Completed') }}</dt>
				<dd>{{ usage.completed }}</dd>
			</div>
			<div class="usage__fact">
				<dt>{{ t(APP_ID, 'Credits') }}</dt>
				<dd>{{ credits }}</dd>
			</div>
		</dl>
	</section>
</template>

<style scoped>
.usage {
	display: flex;
	flex-direction: column;
	gap: 20px;
}

.usage__title {
	font-size: var(--av-text-h1);
	font-weight: 400;
}

.usage__description {
	margin: 0;
	color: var(--av-muted);
}

.usage__facts {
	display: flex;
	flex-wrap: wrap;
	gap: 16px;
	margin: 0;
}

.usage__fact {
	min-width: 160px;
	padding: 20px 24px;
	border: 1px solid var(--av-hairline);
	border-radius: var(--av-radius-card);
}

.usage__fact dt {
	color: var(--av-muted);
	font-size: var(--av-text-meta);
}

.usage__fact dd {
	margin: 6px 0 0;
	font-size: var(--av-text-h1);
}
</style>
```

In `lib/Controller/PageController.php`, add after `envelope()`:

```php
	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[FrontpageRoute(verb: 'GET', url: '/usage')]
	public function usage(): TemplateResponse {
		return $this->page();
	}
```

Add to both l10n files:

```json
    "Usage" : "Uso"
```

- [ ] **Step 5: Run them and watch them pass**

Run: `npx vitest run src/layout src/usage` — PASS.
Run: `composer run lint` and, after the reset guard, `tests/env/phpunit.sh --filter PageControllerTest` — `OK`.

- [ ] **Step 6: Run the gates and commit**

Run each: `npm run typecheck`, `npm run lint`, `npm test`.

```bash
git add -A src l10n lib/Controller/PageController.php tests/Integration/Controller/PageControllerTest.php
git commit -m "feat(navigation): add shared, company and usage entries for managers"
```

---

### Task 5: Share dialog

**Files:**
- Create: `src/folders/ShareePicker.vue`, `src/folders/FolderShareDialog.vue`
- Modify: `l10n/pt_BR.json`, `l10n/pt_BR.js`
- Test: `src/folders/FolderShareDialog.spec.ts`

**Interfaces:**
- Consumes: `getFolderAccess`, `addFolderAccess`, `changeFolderAccess`, `removeFolderAccess`, `searchSharees` (Task 1); `FOLDER_RIGHTS`, `rightAtLeast`, `isFolderRight`, `participantKey` (Task 2); `refreshFolderViews` (Task 2).
- Produces:
  - `<ShareePicker :excluded="ReadonlySet<string>" :disabled @pick="(sharee: Sharee) => …" />` — an ARIA combobox (listbox popup, arrows move, Enter picks, Esc closes, `aria-activedescendant`, polite live count).
  - `<FolderShareDialog :open :folder="EnvelopeFolder" @close />` — render it only with a folder (`v-if`). Lists the owner and every entry; offers only rights up to the user's own; an entry above the user's right is read-only.

- [ ] **Step 1: Write the failing test**

`src/folders/FolderShareDialog.spec.ts`:

```ts
import type { VueWrapper } from '@vue/test-utils'
import type { EnvelopeFolder, FolderAccessEntry, FolderAccessList, FolderRight } from '../api/types.ts'

import { showSuccess } from '@nextcloud/dialogs'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FolderShareDialog from './FolderShareDialog.vue'
import { addFolderAccess, changeFolderAccess, getFolderAccess, removeFolderAccess, searchSharees } from '../api/folders.ts'
import { usePortugueseEnvironment } from '../test-support/pt-br-environment.ts'

vi.mock('../api/folders.ts', () => ({
	getFolderAccess: vi.fn(),
	addFolderAccess: vi.fn(),
	changeFolderAccess: vi.fn(),
	removeFolderAccess: vi.fn(),
	searchSharees: vi.fn(),
	listFolders: vi.fn(async () => []),
}))
vi.mock('@nextcloud/dialogs', () => ({ showSuccess: vi.fn(), showError: vi.fn() }))

usePortugueseEnvironment()

const SEARCH_DEBOUNCE_MILLISECONDS = 250

function folderWith(right: FolderRight): EnvelopeFolder {
	return { id: 3, title: 'Contratos', parentId: null, ownerUid: 'maria', ownerDisplayName: 'Maria Souza', sortOrder: 0, right }
}

const JOAO: FolderAccessEntry = { id: 9, type: 'user', participantId: 'joao', displayName: 'João Lima', right: 'view' }
const FINANCEIRO: FolderAccessEntry = { id: 10, type: 'group', participantId: 'financeiro', displayName: 'Financeiro', right: 'manage' }

const ACCESS: FolderAccessList = {
	owner: { uid: 'maria', displayName: 'Maria Souza' },
	entries: [JOAO, FINANCEIRO],
}

const mounted: VueWrapper[] = []

async function mountDialog(right: FolderRight = 'manage') {
	const wrapper = mount(FolderShareDialog, {
		attachTo: document.body,
		props: { open: true, folder: folderWith(right) },
		global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]] },
	})
	mounted.push(wrapper)
	await flushPromises()
	return wrapper
}

/** AvSelect names its select through a `<label for>`, hidden for the row selects. */
function selectLabelled(wrapper: VueWrapper, label: string) {
	const id = wrapper.findAll('label').find((candidate) => candidate.text() === label)?.attributes('for')
	return id === undefined ? undefined : wrapper.find(`select[id="${id}"]`)
}

async function search(wrapper: VueWrapper, text: string) {
	await wrapper.find('input[role="combobox"]').setValue(text)
	await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MILLISECONDS)
	await flushPromises()
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
	vi.mocked(getFolderAccess).mockResolvedValue(ACCESS)
	vi.mocked(searchSharees).mockResolvedValue([
		{ type: 'user', id: 'ana', displayName: 'Ana Lima' },
		{ type: 'user', id: 'joao', displayName: 'João Lima' },
	])
})

afterEach(() => {
	mounted.splice(0).forEach((wrapper) => wrapper.unmount())
	vi.useRealTimers()
	vi.clearAllMocks()
	document.body.innerHTML = ''
})

describe('the share dialog', () => {
	it('lists the owner and everyone with access', async () => {
		const wrapper = await mountDialog()

		expect(wrapper.text()).toContain('Compartilhar "Contratos"')
		expect(wrapper.text()).toContain('Maria Souza')
		expect(wrapper.text()).toContain('Dono')
		expect(wrapper.text()).toContain('João Lima')
		expect(wrapper.text()).toContain('Financeiro')
	})

	it('offers a sharer only the rights up to their own and locks entries above it', async () => {
		const wrapper = await mountDialog('share')

		const select = selectLabelled(wrapper, 'Acesso de João Lima')
		expect(select?.findAll('option').map((option) => option.text())).toEqual(['Pode ver', 'Pode editar', 'Pode compartilhar'])
		expect(selectLabelled(wrapper, 'Acesso de Financeiro')).toBeUndefined()
		expect(wrapper.find('button[aria-label="Remover Financeiro"]').exists()).toBe(false)
	})

	it('suggests people not on the list, announces the count and adds the picked one with Ver', async () => {
		vi.mocked(addFolderAccess).mockResolvedValue({ id: 11, type: 'user', participantId: 'ana', displayName: 'Ana Lima', right: 'view' })
		const wrapper = await mountDialog()

		await search(wrapper, 'Lima')
		const options = wrapper.findAll('[role="option"]')
		expect(options.map((option) => option.text())).toEqual(['Ana Lima'])
		expect(wrapper.find('[role="status"]').text()).toBe('1 resultado')
		const input = wrapper.find('input[role="combobox"]')
		expect(input.attributes('aria-activedescendant')).toBe(options[0]?.attributes('id'))

		await input.trigger('keydown', { key: 'Enter' })
		await flushPromises()

		expect(addFolderAccess).toHaveBeenCalledWith(3, 'user', 'ana', 'view')
		expect(showSuccess).toHaveBeenCalledWith('Acesso adicionado')
	})

	it('closes the suggestions on Escape without closing the dialog', async () => {
		const wrapper = await mountDialog()
		await search(wrapper, 'Lima')

		await wrapper.find('input[role="combobox"]').trigger('keydown', { key: 'Escape' })

		expect(wrapper.find('input[role="combobox"]').attributes('aria-expanded')).toBe('false')
		expect(wrapper.find('dialog').element.open).toBe(true)
	})

	it('changes and removes an entry', async () => {
		vi.mocked(changeFolderAccess).mockResolvedValue({ ...JOAO, right: 'edit' })
		vi.mocked(removeFolderAccess).mockResolvedValue(undefined)
		const wrapper = await mountDialog()

		await selectLabelled(wrapper, 'Acesso de João Lima')?.setValue('edit')
		await flushPromises()
		await wrapper.find('button[aria-label="Remover João Lima"]').trigger('click')
		await flushPromises()

		expect(changeFolderAccess).toHaveBeenCalledWith(3, 9, 'edit')
		expect(removeFolderAccess).toHaveBeenCalledWith(3, 9)
	})
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/folders/FolderShareDialog.spec.ts`
Expected: FAIL with `Failed to resolve import "./FolderShareDialog.vue"`.

- [ ] **Step 3: Write the combobox**

`src/folders/ShareePicker.vue`:

```vue
<script lang="ts">
import type { Sharee } from '../api/types.ts'

/** The keys that move the highlighted suggestion, wrapping around the list. */
const OPTION_MOVES: Readonly<Record<string, (current: number, count: number) => number>> = {
	ArrowDown: (current, count) => (current + 1) % count,
	ArrowUp: (current, count) => (current - 1 + count) % count,
}

const SEARCH_DEBOUNCE_MILLISECONDS = 250
const NO_OPTION = -1
const OPTION_AVATAR_SIZE = 28
</script>

<script setup lang="ts">
import { n, t } from '@nextcloud/l10n'
import { useQuery } from '@tanstack/vue-query'
import { Users } from 'lucide-vue-next'
import { computed, ref, useId, watch } from 'vue'
import AvAvatar from '../ui/AvAvatar.vue'
import { searchSharees } from '../api/folders.ts'
import { QUERY_KEYS } from '../api/query-keys.ts'
import { APP_ID } from '../app-config.ts'
import { ICON_SIZE_FIELD, ICON_STROKE_INLINE } from '../icon-sizes.ts'
import { useDebounced } from '../presentation/use-debounced.ts'
import { participantKey } from './folder-tree.ts'

const props = defineProps<{
	/** Already on the access list (and the owner): never suggested again. */
	excluded: ReadonlySet<string>
	disabled: boolean
}>()

const emit = defineEmits<{ pick: [sharee: Sharee] }>()

const inputId = useId()
const listboxId = `${inputId}-listbox`
const search = ref('')
const debouncedSearch = useDebounced(search, SEARCH_DEBOUNCE_MILLISECONDS)
const searchedText = computed(() => debouncedSearch.value.trim())
const isOpen = ref(false)
const activeIndex = ref(NO_OPTION)

const shareesQuery = useQuery({
	queryKey: computed(() => QUERY_KEYS.sharees(searchedText.value)),
	queryFn: ({ queryKey: [, text], signal }) => searchSharees(text, signal),
	enabled: computed(() => searchedText.value !== ''),
})

const options = computed(() => (shareesQuery.data.value ?? []).filter((sharee) => !props.excluded.has(participantKey(sharee.type, sharee.id))))
const isExpanded = computed(() => isOpen.value && options.value.length > 0)
const activeOptionId = computed(() => (isExpanded.value && activeIndex.value !== NO_OPTION ? optionId(activeIndex.value) : undefined))
const announcement = computed(() => {
	if (!isOpen.value || searchedText.value === '' || shareesQuery.isFetching.value) {
		return ''
	}
	return options.value.length === 0 ? t(APP_ID, 'No one found') : n(APP_ID, '%n result', '%n results', options.value.length)
})

function optionId(index: number): string {
	return `${listboxId}-${index}`
}

watch(options, (current) => {
	activeIndex.value = current.length === 0 ? NO_OPTION : 0
})

watch(search, (text) => {
	isOpen.value = text.trim() !== ''
})

function pick(sharee: Sharee) {
	emit('pick', sharee)
	search.value = ''
	isOpen.value = false
}

/** Enter picks, Esc closes the suggestions (and only them, not the dialog), the arrows move. */
function onKeydown(event: KeyboardEvent) {
	if (event.key === 'Escape' && isExpanded.value) {
		event.preventDefault()
		event.stopPropagation()
		isOpen.value = false
		return
	}
	if (event.key === 'Enter') {
		const chosen = isExpanded.value ? options.value[activeIndex.value] : undefined
		if (chosen === undefined) {
			return
		}
		event.preventDefault()
		pick(chosen)
		return
	}
	const move = OPTION_MOVES[event.key]
	if (move === undefined || options.value.length === 0) {
		return
	}
	event.preventDefault()
	isOpen.value = true
	activeIndex.value = move(activeIndex.value, options.value.length)
}
</script>

<template>
	<div class="sharee-picker">
		<label :for="inputId" class="sharee-picker__label">{{ t(APP_ID, 'Add people or groups') }}</label>
		<input
			:id="inputId"
			v-model="search"
			class="av-input sharee-picker__input"
			type="text"
			role="combobox"
			autocomplete="off"
			aria-autocomplete="list"
			:aria-expanded="isExpanded ? 'true' : 'false'"
			:aria-controls="listboxId"
			:aria-activedescendant="activeOptionId"
			:disabled="disabled"
			@keydown="onKeydown"
			@blur="isOpen = false">
		<ul
			v-show="isExpanded"
			:id="listboxId"
			class="sharee-picker__options"
			role="listbox"
			:aria-label="t(APP_ID, 'Add people or groups')">
			<li
				v-for="(sharee, index) in options"
				:id="optionId(index)"
				:key="participantKey(sharee.type, sharee.id)"
				role="option"
				class="sharee-picker__option"
				:class="{ 'sharee-picker__option--active': index === activeIndex }"
				:aria-selected="index === activeIndex ? 'true' : 'false'"
				@mousedown.prevent="pick(sharee)">
				<AvAvatar v-if="sharee.type === 'user'" :name="sharee.displayName" :size="OPTION_AVATAR_SIZE" decorative />
				<span v-else class="sharee-picker__group" aria-hidden="true">
					<Users :size="ICON_SIZE_FIELD" :stroke-width="ICON_STROKE_INLINE" />
				</span>
				<span class="sharee-picker__name">{{ sharee.displayName }}</span>
				<span v-if="sharee.type === 'group'" class="sharee-picker__kind">{{ t(APP_ID, 'Group') }}</span>
			</li>
		</ul>
		<p class="av-visually-hidden" role="status" aria-live="polite">
			{{ announcement }}
		</p>
	</div>
</template>

<style scoped>
.sharee-picker {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.sharee-picker__label {
	font-size: var(--av-text-meta);
	color: var(--av-muted);
}

.sharee-picker__options {
	position: absolute;
	top: 100%;
	right: 0;
	left: 0;
	z-index: var(--av-layer-popover);
	max-height: 240px;
	margin: 4px 0 0;
	padding: 4px;
	overflow-y: auto;
	list-style: none;
	border: 1px solid var(--av-hairline);
	border-radius: var(--av-radius-card);
	background: var(--av-panel);
	box-shadow: var(--av-shadow-float);
}

.sharee-picker__option {
	display: flex;
	align-items: center;
	gap: 10px;
	min-height: 44px;
	padding: 0 10px;
	border-radius: var(--av-radius-pill);
	cursor: pointer;
}

.sharee-picker__option--active {
	background: var(--av-tint);
	color: var(--av-tint-text);
}

.sharee-picker__group {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	border-radius: 50%;
	background: var(--av-subtle-fill);
}

.sharee-picker__name {
	flex-grow: 1;
}

.sharee-picker__kind {
	font-size: var(--av-text-meta);
	color: var(--av-muted);
}
</style>
```

- [ ] **Step 4: Write the dialog**

`src/folders/FolderShareDialog.vue`:

```vue
<script lang="ts">
import type { FolderRight } from '../api/types.ts'

import { t } from '@nextcloud/l10n'
import { APP_ID } from '../app-config.ts'

const RIGHT_LABELS: Readonly<Record<FolderRight, () => string>> = {
	view: () => t(APP_ID, 'Can view'),
	edit: () => t(APP_ID, 'Can edit'),
	share: () => t(APP_ID, 'Can share'),
	manage: () => t(APP_ID, 'Can manage'),
}

/** New people start with Ver; the row's select raises it. */
const FIRST_RIGHT: FolderRight = 'view'
</script>

<script setup lang="ts">
import type { EnvelopeFolder, FolderAccessEntry, Sharee } from '../api/types.ts'

import { showSuccess } from '@nextcloud/dialogs'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { Users, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import AvAvatar from '../ui/AvAvatar.vue'
import AvButton from '../ui/AvButton.vue'
import AvDialog from '../ui/AvDialog.vue'
import AvIconButton from '../ui/AvIconButton.vue'
import AvSelect from '../ui/AvSelect.vue'
import ShareePicker from './ShareePicker.vue'
import { isCancelled } from '../api/api-error.ts'
import { errorMessage } from '../api/error-messages.ts'
import { addFolderAccess, changeFolderAccess, getFolderAccess, removeFolderAccess } from '../api/folders.ts'
import { QUERY_KEYS } from '../api/query-keys.ts'
import { ICON_SIZE_FIELD, ICON_STROKE_EMPHASIS, ICON_STROKE_INLINE } from '../icon-sizes.ts'
import { logger } from '../logger.ts'
import { PLAIN_TEXT } from '../presentation/plain-text.ts'
import { FOLDER_RIGHTS, isFolderRight, participantKey, rightAtLeast } from './folder-tree.ts'
import { refreshFolderViews } from './use-folders.ts'

const props = defineProps<{
	open: boolean
	folder: EnvelopeFolder
}>()

const emit = defineEmits<{ close: [] }>()

const queryClient = useQueryClient()
const error = ref<string | null>(null)

const accessQuery = useQuery({
	queryKey: computed(() => QUERY_KEYS.folderAccess(props.folder.id)),
	queryFn: ({ queryKey: [, folderId] }) => getFolderAccess(folderId),
	enabled: computed(() => props.open),
})

const access = computed(() => accessQuery.data.value)
const entries = computed(() => access.value?.entries ?? [])
const dialogTitle = computed(() => t(APP_ID, 'Share "{title}"', { title: props.folder.title }, undefined, PLAIN_TEXT))
const rightOptions = computed(() => FOLDER_RIGHTS
	.filter((right) => rightAtLeast(props.folder.right, right))
	.map((right) => ({ value: right, label: RIGHT_LABELS[right]() })))
const excluded = computed(() => new Set([
	...(access.value === undefined ? [] : [participantKey('user', access.value.owner.uid)]),
	...entries.value.map((entry) => participantKey(entry.type, entry.participantId)),
]))

/** Nobody touches an entry above their own right (docs/api.md, access list). */
function canChange(entry: FolderAccessEntry): boolean {
	return rightAtLeast(props.folder.right, entry.right)
}

async function afterChange(message: string) {
	showSuccess(message)
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: QUERY_KEYS.folderAccess(props.folder.id) }),
		refreshFolderViews(queryClient),
	])
}

function onFailure(failure: Error) {
	if (isCancelled(failure)) {
		return
	}
	logger.error('Could not change the folder access', { error: failure })
	error.value = errorMessage(failure)
}

const addAccess = useMutation({
	mutationFn: (sharee: Sharee) => addFolderAccess(props.folder.id, sharee.type, sharee.id, FIRST_RIGHT),
	onSuccess: () => afterChange(t(APP_ID, 'Access added')),
	onError: onFailure,
})

const changeAccess = useMutation({
	mutationFn: ({ entry, right }: { entry: FolderAccessEntry, right: FolderRight }) => changeFolderAccess(props.folder.id, entry.id, right),
	onSuccess: () => afterChange(t(APP_ID, 'Access updated')),
	onError: onFailure,
})

const removeAccess = useMutation({
	mutationFn: (entry: FolderAccessEntry) => removeFolderAccess(props.folder.id, entry.id),
	onSuccess: () => afterChange(t(APP_ID, 'Access removed')),
	onError: onFailure,
})

function onPick(sharee: Sharee) {
	error.value = null
	addAccess.mutate(sharee)
}

function onChangeRight(entry: FolderAccessEntry, value: string) {
	if (!isFolderRight(value) || value === entry.right) {
		return
	}
	error.value = null
	changeAccess.mutate({ entry, right: value })
}

function onRemove(entry: FolderAccessEntry) {
	error.value = null
	removeAccess.mutate(entry)
}
</script>

<template>
	<AvDialog :open="open" :title="dialogTitle" :error="error" @close="emit('close')">
		<ShareePicker :excluded="excluded" :disabled="addAccess.isPending.value" @pick="onPick" />
		<p class="share-dialog__hint">
			{{ t(APP_ID, 'People only get access if they can use Signatures.') }}
		</p>
		<ul v-if="access !== undefined" class="share-dialog__list" :aria-label="t(APP_ID, 'People with access')">
			<li class="share-dialog__row">
				<AvAvatar :name="access.owner.displayName" decorative />
				<span class="share-dialog__name">{{ access.owner.displayName }}</span>
				<span class="share-dialog__right">{{ t(APP_ID, 'Owner') }}</span>
			</li>
			<li v-for="entry in entries" :key="entry.id" class="share-dialog__row">
				<AvAvatar v-if="entry.type === 'user'" :name="entry.displayName" decorative />
				<span v-else class="share-dialog__group" aria-hidden="true">
					<Users :size="ICON_SIZE_FIELD" :stroke-width="ICON_STROKE_INLINE" />
				</span>
				<span class="share-dialog__name">
					{{ entry.displayName }}<span v-if="entry.type === 'group'" class="share-dialog__kind"> · {{ t(APP_ID, 'Group') }}</span>
				</span>
				<template v-if="canChange(entry)">
					<AvSelect
						:modelValue="entry.right"
						class="share-dialog__select"
						size="compact"
						labelHidden
						:label="t(APP_ID, 'Access of {name}', { name: entry.displayName }, undefined, PLAIN_TEXT)"
						:options="rightOptions"
						@update:modelValue="onChangeRight(entry, $event)" />
					<AvIconButton :label="t(APP_ID, 'Remove {name}', { name: entry.displayName }, undefined, PLAIN_TEXT)" @click="onRemove(entry)">
						<X :size="ICON_SIZE_FIELD" :stroke-width="ICON_STROKE_EMPHASIS" aria-hidden="true" />
					</AvIconButton>
				</template>
				<span v-else class="share-dialog__right">{{ RIGHT_LABELS[entry.right]() }}</span>
			</li>
		</ul>
		<p v-if="access !== undefined && entries.length === 0" class="share-dialog__empty">
			{{ t(APP_ID, 'Not shared with anyone yet') }}
		</p>
		<template #actions>
			<AvButton variant="secondary" @click="emit('close')">
				{{ t(APP_ID, 'Close') }}
			</AvButton>
		</template>
	</AvDialog>
</template>

<style scoped>
.share-dialog__hint,
.share-dialog__empty {
	margin: 0;
	color: var(--av-muted);
	font-size: var(--av-text-meta);
}

.share-dialog__list {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.share-dialog__row {
	display: flex;
	align-items: center;
	gap: 10px;
	min-height: 48px;
}

.share-dialog__group {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 32px;
	border-radius: 50%;
	background: var(--av-subtle-fill);
}

.share-dialog__name {
	flex-grow: 1;
	min-width: 0;
}

.share-dialog__kind,
.share-dialog__right {
	color: var(--av-muted);
	font-size: var(--av-text-meta);
}

.share-dialog__select {
	width: 180px;
}
</style>
```

Add to both l10n files:

```json
    "Share \"{title}\"" : "Compartilhar \"{title}\"",
    "Can view" : "Pode ver",
    "Can edit" : "Pode editar",
    "Can share" : "Pode compartilhar",
    "Can manage" : "Pode gerenciar",
    "Owner" : "Dono",
    "Remove {name}" : "Remover {name}",
    "Access of {name}" : "Acesso de {name}",
    "Not shared with anyone yet" : "Ainda não compartilhada com ninguém",
    "People with access" : "Pessoas com acesso",
    "People only get access if they can use Signatures." : "As pessoas só têm acesso se puderem usar o Assinaturas.",
    "Access added" : "Acesso adicionado",
    "Access updated" : "Acesso atualizado",
    "Access removed" : "Acesso removido",
    "Close" : "Fechar",
    "Add people or groups" : "Adicionar pessoas ou grupos",
    "No one found" : "Ninguém encontrado",
    "_%n result_::_%n results_" : ["%n resultado","%n resultados"]
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run src/folders/FolderShareDialog.spec.ts`
Expected: PASS.

- [ ] **Step 6: Run the gates and commit**

Run each: `npm run typecheck`, `npm run lint`, `npm test`.

```bash
git add src/folders l10n
git commit -m "feat(folders): share a folder with people and groups"
```

---

### Task 6: Folder tree in the sidebar, its menu and dialogs (drawer on the phone)

**Files:**
- Create: `src/folders/use-folder-mutation.ts`, `src/folders/FolderTree.vue`, `src/folders/FolderTreeItem.vue`, `src/folders/FolderNameDialog.vue`, `src/folders/FolderDeleteDialog.vue`, `src/folders/FolderTransferDialog.vue`, `src/folders/FolderPickerDialog.vue`, `src/folders/FolderMoveDialog.vue`
- Modify: `src/layout/AppNavigation.vue`
- Modify: `l10n/pt_BR.json`, `l10n/pt_BR.js`
- Test: `src/folders/FolderTree.spec.ts`, `src/layout/AppFrame.spec.ts`

**Interfaces:**
- Consumes: Task 2 helpers, Task 5 `FolderShareDialog`, Task 1 folder calls.
- Produces:
  - `useFolderDialogMutation<Variables, Result>({ isOpen, close, mutationFn, failureLog, successMessage, beforeClose?, afterSuccess? })` → `{ error, isPending, mutate, requestClose }`; on success it closes, toasts, refreshes the tree, listings and details.
  - `<FolderTree :currentFolderId @navigate />` — heading "Pastas", "Nova pasta" button, nested `<ul>` list of `<FolderTreeItem>` with disclosure buttons (`aria-expanded`, `aria-controls`), links with `aria-current`, a ⋮ menu per folder (only allowed actions), and the dialogs.
  - `<FolderTreeItem :node :depth :currentFolderId :expandedIds :canSeeAll @toggle @action @navigate />` (Task 7 adds `@drop`).
  - `<FolderPickerDialog :open :title :options :current :error :isPending @close @pick />` — presentational; Task 7 reuses it for envelopes.

- [ ] **Step 1: Write the failing tests**

`src/folders/FolderTree.spec.ts`:

```ts
import type { VueWrapper } from '@vue/test-utils'
import type { EnvelopeFolder, FolderRight } from '../api/types.ts'

import { showSuccess } from '@nextcloud/dialogs'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import FolderTree from './FolderTree.vue'
import { createFolder, deleteFolder, listFolders, moveFolder, renameFolder, searchSharees, transferFolder } from '../api/folders.ts'
import { ROUTE_NAMES } from '../router.ts'
import { usePortugueseEnvironment } from '../test-support/pt-br-environment.ts'

const { manager } = vi.hoisted(() => ({ manager: { value: false } }))

vi.mock('../app-config.ts', () => ({ APP_ID: 'assinaturas', appConfig: () => ({ canSeeAll: manager.value }) }))
vi.mock('../api/folders.ts', () => ({
	listFolders: vi.fn(),
	createFolder: vi.fn(),
	renameFolder: vi.fn(),
	moveFolder: vi.fn(),
	transferFolder: vi.fn(),
	deleteFolder: vi.fn(),
	getFolderAccess: vi.fn(async () => ({ owner: { uid: 'maria', displayName: 'Maria Souza' }, entries: [] })),
	searchSharees: vi.fn(),
	addFolderAccess: vi.fn(),
	changeFolderAccess: vi.fn(),
	removeFolderAccess: vi.fn(),
}))
vi.mock('@nextcloud/dialogs', () => ({ showSuccess: vi.fn(), showError: vi.fn() }))

usePortugueseEnvironment()

function folder(id: number, title: string, parentId: number | null, right: FolderRight = 'manage'): EnvelopeFolder {
	return { id, title, parentId, ownerUid: 'maria', ownerDisplayName: 'Maria Souza', sortOrder: 0, right }
}

const CONTRATOS = folder(1, 'Contratos', null)
const FORNECEDORES = folder(2, 'Fornecedores', 1)
const RH = folder(3, 'RH', null, 'view')

const mounted: VueWrapper[] = []

async function mountTree(currentFolderId: number | null = null) {
	const router = createRouter({
		history: createMemoryHistory(),
		routes: [{ path: '/', name: ROUTE_NAMES.dashboard, component: defineComponent({ render: () => h('p') }) }],
	})
	router.push(currentFolderId === null ? '/' : `/?folderId=${currentFolderId}`)
	await router.isReady()
	const wrapper = mount(FolderTree, {
		attachTo: document.body,
		props: { currentFolderId },
		global: { plugins: [router, [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]] },
	})
	mounted.push(wrapper)
	await flushPromises()
	return { wrapper, router }
}

function linkNamed(wrapper: VueWrapper, name: string) {
	return wrapper.findAll('a').find((link) => link.text() === name)
}

async function chooseMenuItem(wrapper: VueWrapper, folderTitle: string, item: string) {
	await wrapper.find(`button[aria-label="Ações de ${folderTitle}"]`).trigger('click')
	await flushPromises()
	await wrapper.findAll('[role="menuitem"]').find((menuItem) => menuItem.text() === item)?.trigger('click')
	await flushPromises()
}

function openDialog(wrapper: VueWrapper) {
	return wrapper.findAll('dialog').find((dialog) => dialog.element.open)
}

beforeEach(() => {
	manager.value = false
	vi.mocked(listFolders).mockResolvedValue([CONTRATOS, FORNECEDORES, RH])
})

afterEach(() => {
	mounted.splice(0).forEach((wrapper) => wrapper.unmount())
	vi.clearAllMocks()
	document.body.innerHTML = ''
})

describe('the folder tree', () => {
	it('lists the top folders and keeps subfolders behind a disclosure button', async () => {
		const { wrapper } = await mountTree()

		expect(wrapper.find('h2').text()).toBe('Pastas')
		expect(linkNamed(wrapper, 'Contratos')?.attributes('href')).toBe('/?folderId=1')
		const toggle = wrapper.find('button[aria-label="Expandir Contratos"]')
		expect(toggle.attributes('aria-expanded')).toBe('false')
		expect(linkNamed(wrapper, 'Fornecedores')?.isVisible()).toBe(false)

		await toggle.trigger('click')

		expect(wrapper.find('button[aria-label="Recolher Contratos"]').attributes('aria-expanded')).toBe('true')
		expect(linkNamed(wrapper, 'Fornecedores')?.isVisible()).toBe(true)
	})

	it('opens the ancestors of the current folder and marks it current', async () => {
		const { wrapper } = await mountTree(FORNECEDORES.id)

		expect(linkNamed(wrapper, 'Fornecedores')?.isVisible()).toBe(true)
		expect(linkNamed(wrapper, 'Fornecedores')?.attributes('aria-current')).toBe('page')
	})

	it('shows no menu on a folder the user only views', async () => {
		const { wrapper } = await mountTree()

		expect(wrapper.find('button[aria-label="Ações de RH"]').exists()).toBe(false)
	})

	it('offers "Transferir" to managers only', async () => {
		const { wrapper } = await mountTree()
		await wrapper.find('button[aria-label="Ações de Contratos"]').trigger('click')
		expect(wrapper.findAll('[role="menuitem"]').map((item) => item.text())).not.toContain('Transferir')
		mounted.splice(0).forEach((mountedWrapper) => mountedWrapper.unmount())

		manager.value = true
		const { wrapper: managerTree } = await mountTree()
		await managerTree.find('button[aria-label="Ações de Contratos"]').trigger('click')

		expect(managerTree.findAll('[role="menuitem"]').map((item) => item.text())).toContain('Transferir')
	})

	it('creates a top-level folder from "Nova pasta"', async () => {
		vi.mocked(createFolder).mockResolvedValue(folder(9, 'Jurídico', null))
		const { wrapper } = await mountTree()

		await wrapper.find('button[aria-label="Nova pasta"]').trigger('click')
		await flushPromises()
		await openDialog(wrapper)?.find('input').setValue('Jurídico')
		await openDialog(wrapper)?.findAll('button').find((button) => button.text() === 'Criar pasta')?.trigger('click')
		await flushPromises()

		expect(createFolder).toHaveBeenCalledWith('Jurídico', null)
		expect(showSuccess).toHaveBeenCalledWith('Pasta criada')
	})

	it('creates a subfolder and renames a folder from its menu', async () => {
		vi.mocked(createFolder).mockResolvedValue(folder(9, 'Limpeza', 1))
		vi.mocked(renameFolder).mockResolvedValue(folder(1, 'Contratos 2026', null))
		const { wrapper } = await mountTree()

		await chooseMenuItem(wrapper, 'Contratos', 'Nova subpasta')
		await openDialog(wrapper)?.find('input').setValue('Limpeza')
		await openDialog(wrapper)?.findAll('button').find((button) => button.text() === 'Criar pasta')?.trigger('click')
		await flushPromises()
		await chooseMenuItem(wrapper, 'Contratos', 'Renomear')
		await openDialog(wrapper)?.find('input').setValue('Contratos 2026')
		await openDialog(wrapper)?.findAll('button').find((button) => button.text() === 'Salvar')?.trigger('click')
		await flushPromises()

		expect(createFolder).toHaveBeenCalledWith('Limpeza', 1)
		expect(renameFolder).toHaveBeenCalledWith(1, 'Contratos 2026')
		expect(showSuccess).toHaveBeenCalledWith('Pasta renomeada')
	})

	it('moves a folder with "Mover para…", never into itself or below', async () => {
		vi.mocked(moveFolder).mockResolvedValue(folder(1, 'Contratos', null))
		const { wrapper } = await mountTree()

		await chooseMenuItem(wrapper, 'Contratos', 'Mover para…')
		const select = openDialog(wrapper)?.find('select')
		expect(select?.findAll('option').map((option) => option.text().trim())).toEqual(['Sem pasta'])

		mounted.splice(0).forEach((mountedWrapper) => mountedWrapper.unmount())
		const { wrapper: tree } = await mountTree()
		await tree.find('button[aria-label="Expandir Contratos"]').trigger('click')
		await chooseMenuItem(tree, 'Fornecedores', 'Mover para…')
		await openDialog(tree)?.find('select').setValue('')
		await openDialog(tree)?.findAll('button').find((button) => button.text() === 'Mover')?.trigger('click')
		await flushPromises()

		expect(moveFolder).toHaveBeenCalledWith(2, null)
		expect(showSuccess).toHaveBeenCalledWith('Pasta movida')
	})

	it('deletes a folder, says where its contents go and leaves its view', async () => {
		vi.mocked(deleteFolder).mockResolvedValue(undefined)
		const { wrapper, router } = await mountTree(FORNECEDORES.id)

		await chooseMenuItem(wrapper, 'Fornecedores', 'Excluir')
		expect(openDialog(wrapper)?.text()).toContain('As subpastas e os envelopes dela vão para Contratos. Nenhum envelope é excluído.')
		await openDialog(wrapper)?.findAll('button').find((button) => button.text() === 'Excluir pasta')?.trigger('click')
		await flushPromises()

		expect(deleteFolder).toHaveBeenCalledWith(2)
		expect(router.currentRoute.value.query).toEqual({ folderId: '1' })
	})

	it('lets a manager hand a folder to another member', async () => {
		manager.value = true
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
		vi.mocked(searchSharees).mockResolvedValue([{ type: 'user', id: 'joao', displayName: 'João Lima' }, { type: 'group', id: 'rh', displayName: 'RH' }])
		vi.mocked(transferFolder).mockResolvedValue({ ...CONTRATOS, ownerUid: 'joao' })
		const { wrapper } = await mountTree()

		await chooseMenuItem(wrapper, 'Contratos', 'Transferir')
		await openDialog(wrapper)?.find('input').setValue('João')
		await vi.advanceTimersByTimeAsync(250)
		await flushPromises()
		const select = openDialog(wrapper)?.find('select')
		expect(select?.findAll('option').map((option) => option.text())).toEqual(['Escolha uma pessoa', 'João Lima'])
		await select?.setValue('joao')
		await openDialog(wrapper)?.findAll('button').find((button) => button.text() === 'Transferir')?.trigger('click')
		await flushPromises()
		vi.useRealTimers()

		expect(transferFolder).toHaveBeenCalledWith(1, 'joao')
	})

	it('opens the share dialog from "Compartilhar"', async () => {
		const { wrapper } = await mountTree()

		await chooseMenuItem(wrapper, 'Contratos', 'Compartilhar')

		expect(openDialog(wrapper)?.text()).toContain('Compartilhar "Contratos"')
	})
})
```

In `src/layout/AppFrame.spec.ts`, inside the phone `describe`, add:

```ts
		it('shows the folder tree in the drawer', async () => {
			vi.mocked(listFolders).mockResolvedValue([{ id: 1, title: 'Contratos', parentId: null, ownerUid: 'patrick', ownerDisplayName: 'Patrick Rezende', sortOrder: 0, right: 'manage' }])
			const { wrapper } = await mountFrame()

			await wrapper.find('button[aria-label="Abrir menu"]').trigger('click')
			await flushPromises()

			const drawer = wrapper.find('dialog')
			expect(drawer.text()).toContain('Pastas')
			expect(drawer.findAll('a').map((link) => link.text())).toContain('Contratos')
		})
```

(import `listFolders` from `'../api/folders.ts'`; the module is already mocked since Task 4.)

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/folders/FolderTree.spec.ts src/layout/AppFrame.spec.ts`
Expected: FAIL with `Failed to resolve import "./FolderTree.vue"` and no "Pastas" in the drawer.

- [ ] **Step 3: Write the folder dialog mutation**

`src/folders/use-folder-mutation.ts`:

```ts
import { showSuccess } from '@nextcloud/dialogs'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { nextTick, ref, watch } from 'vue'
import { isCancelled } from '../api/api-error.ts'
import { errorMessage } from '../api/error-messages.ts'
import { logger } from '../logger.ts'
import { refreshFolderViews } from './use-folders.ts'

interface FolderDialogMutation<Variables, Result> {
	isOpen: () => boolean
	close: () => void
	mutationFn: (variables: Variables) => Promise<Result>
	/** Logged when the mutation fails, e.g. "Could not delete the folder". */
	failureLog: string
	successMessage: (result: Result, variables: Variables) => string
	/** Runs before the dialog closes, while it can still emit (an unmounted component's events are dropped). */
	beforeClose?: (result: Result, variables: Variables) => void
	/** Runs after the toast and the refresh: may seed a cache (never emit: the dialog may be gone). */
	afterSuccess?: (result: Result, variables: Variables) => Promise<void> | void
}

/**
 * The mutation of a dialog that changes folders or files an envelope. Call in setup. A failure stays inside the
 * dialog (a toast would land in the inert page behind the modal); a success closes it, toasts, and reads the tree,
 * the listings and the open envelopes again.
 */
export function useFolderDialogMutation<Variables, Result>(options: FolderDialogMutation<Variables, Result>) {
	const queryClient = useQueryClient()
	const error = ref<string | null>(null)

	const mutation = useMutation({
		mutationFn: options.mutationFn,
		onSuccess: async (result, variables) => {
			options.beforeClose?.(result, variables)
			options.close()
			await nextTick()
			showSuccess(options.successMessage(result, variables))
			await refreshFolderViews(queryClient)
			await options.afterSuccess?.(result, variables)
		},
		onError: (failure) => {
			if (isCancelled(failure)) {
				return
			}
			logger.error(options.failureLog, { error: failure })
			error.value = errorMessage(failure)
		},
	})

	watch(options.isOpen, (isOpen) => {
		if (!isOpen) {
			return
		}
		error.value = null
	})

	function mutate(variables: Variables) {
		error.value = null
		mutation.mutate(variables)
	}

	function requestClose() {
		if (mutation.isPending.value) {
			return
		}
		options.close()
	}

	return { error, isPending: mutation.isPending, mutate, requestClose }
}
```

- [ ] **Step 4: Write the dialogs**

`src/folders/FolderPickerDialog.vue`:

```vue
<script setup lang="ts">
import type { FolderOption } from './folder-tree.ts'

import { t } from '@nextcloud/l10n'
import { ref, watch } from 'vue'
import AvButton from '../ui/AvButton.vue'
import AvDialog from '../ui/AvDialog.vue'
import AvSelect from '../ui/AvSelect.vue'
import { APP_ID } from '../app-config.ts'

const props = defineProps<{
	open: boolean
	title: string
	options: FolderOption[]
	/** The option value of where the moving thing is now. */
	current: string
	error: string | null
	isPending: boolean
}>()

const emit = defineEmits<{ close: [], pick: [value: string] }>()

const selected = ref(props.current)

watch(() => props.open, (isOpen) => {
	if (!isOpen) {
		return
	}
	selected.value = props.current
})
</script>

<template>
	<AvDialog :open="open" :title="title" :error="error" @close="emit('close')">
		<AvSelect v-model="selected" :label="t(APP_ID, 'Destination')" :options="options" />
		<template #actions>
			<AvButton variant="secondary" :disabled="isPending" @click="emit('close')">
				{{ t(APP_ID, 'Cancel') }}
			</AvButton>
			<AvButton :disabled="isPending || selected === current" @click="emit('pick', selected)">
				{{ t(APP_ID, 'Move') }}
			</AvButton>
		</template>
	</AvDialog>
</template>
```

`src/folders/FolderMoveDialog.vue`:

```vue
<script setup lang="ts">
import type { EnvelopeFolder } from '../api/types.ts'

import { t } from '@nextcloud/l10n'
import { computed } from 'vue'
import FolderPickerDialog from './FolderPickerDialog.vue'
import { moveFolder } from '../api/folders.ts'
import { APP_ID } from '../app-config.ts'
import { PLAIN_TEXT } from '../presentation/plain-text.ts'
import { folderIdFromOption, moveTargetOptions, optionValueOf, subtreeIds } from './folder-tree.ts'
import { useFolderDialogMutation } from './use-folder-mutation.ts'
import { useFolders } from './use-folders.ts'

const props = defineProps<{
	open: boolean
	folder: EnvelopeFolder
}>()

const emit = defineEmits<{ close: [] }>()

const folders = useFolders()
const options = computed(() => moveTargetOptions(folders.value, subtreeIds(folders.value, props.folder.id), t(APP_ID, 'No folder')))
const title = computed(() => t(APP_ID, 'Move "{title}"', { title: props.folder.title }, undefined, PLAIN_TEXT))

const { error, isPending, mutate, requestClose } = useFolderDialogMutation({
	isOpen: () => props.open,
	close: () => emit('close'),
	mutationFn: ({ folderId, parentId }: { folderId: number, parentId: number | null }) => moveFolder(folderId, parentId),
	failureLog: 'Could not move the folder',
	successMessage: () => t(APP_ID, 'Folder moved'),
})

function onPick(value: string) {
	mutate({ folderId: props.folder.id, parentId: folderIdFromOption(value) })
}
</script>

<template>
	<FolderPickerDialog
		:open="open"
		:title="title"
		:options="options"
		:current="optionValueOf(folder.parentId)"
		:error="error"
		:isPending="isPending"
		@close="requestClose"
		@pick="onPick" />
</template>
```

`src/folders/FolderNameDialog.vue`:

```vue
<script lang="ts">
interface FolderNameSave {
	title: string
	/** The folder renamed, or null to create one. */
	renamedFolderId: number | null
	parentId: number | null
}
</script>

<script setup lang="ts">
import type { EnvelopeFolder } from '../api/types.ts'

import { t } from '@nextcloud/l10n'
import { computed, ref, watch } from 'vue'
import AvButton from '../ui/AvButton.vue'
import AvDialog from '../ui/AvDialog.vue'
import AvTextField from '../ui/AvTextField.vue'
import { createFolder, renameFolder } from '../api/folders.ts'
import { APP_ID } from '../app-config.ts'
import { PLAIN_TEXT } from '../presentation/plain-text.ts'
import { FOLDER_TITLE_MAX_LENGTH } from './folder-tree.ts'
import { useFolderDialogMutation } from './use-folder-mutation.ts'

const props = defineProps<{
	open: boolean
	/** The folder to rename; null creates one. */
	folder: EnvelopeFolder | null
	/** Where a new folder goes; null is the top level. */
	parent: EnvelopeFolder | null
}>()

const emit = defineEmits<{ close: [] }>()

const title = ref('')
const trimmedTitle = computed(() => title.value.trim())
const dialogTitle = computed(() => {
	if (props.folder !== null) {
		return t(APP_ID, 'Rename folder')
	}
	return props.parent === null ? t(APP_ID, 'New folder') : t(APP_ID, 'New subfolder in {folder}', { folder: props.parent.title }, undefined, PLAIN_TEXT)
})
const confirmLabel = computed(() => (props.folder === null ? t(APP_ID, 'Create folder') : t(APP_ID, 'Save')))

const { error, isPending, mutate, requestClose } = useFolderDialogMutation({
	isOpen: () => props.open,
	close: () => emit('close'),
	mutationFn: ({ title: name, renamedFolderId, parentId }: FolderNameSave) => (renamedFolderId === null ? createFolder(name, parentId) : renameFolder(renamedFolderId, name)),
	failureLog: 'Could not save the folder',
	successMessage: (_folder, { renamedFolderId }) => (renamedFolderId === null ? t(APP_ID, 'Folder created') : t(APP_ID, 'Folder renamed')),
})

watch(() => props.open, (isOpen) => {
	if (!isOpen) {
		return
	}
	title.value = props.folder?.title ?? ''
})

function onSave() {
	if (trimmedTitle.value === '') {
		return
	}
	mutate({ title: trimmedTitle.value, renamedFolderId: props.folder?.id ?? null, parentId: props.parent?.id ?? null })
}
</script>

<template>
	<AvDialog :open="open" :title="dialogTitle" @close="requestClose">
		<form class="folder-name-dialog" @submit.prevent="onSave">
			<AvTextField
				v-model="title"
				:label="t(APP_ID, 'Folder name')"
				:maxlength="FOLDER_TITLE_MAX_LENGTH"
				required
				:error="error" />
		</form>
		<template #actions>
			<AvButton variant="secondary" :disabled="isPending" @click="requestClose">
				{{ t(APP_ID, 'Cancel') }}
			</AvButton>
			<AvButton :disabled="isPending || trimmedTitle === ''" @click="onSave">
				{{ confirmLabel }}
			</AvButton>
		</template>
	</AvDialog>
</template>
```

`src/folders/FolderDeleteDialog.vue`:

```vue
<script setup lang="ts">
import type { EnvelopeFolder } from '../api/types.ts'

import { t } from '@nextcloud/l10n'
import { computed } from 'vue'
import AvButton from '../ui/AvButton.vue'
import AvDialog from '../ui/AvDialog.vue'
import { deleteFolder } from '../api/folders.ts'
import { APP_ID } from '../app-config.ts'
import { PLAIN_TEXT } from '../presentation/plain-text.ts'
import { folderById } from './folder-tree.ts'
import { useFolderDialogMutation } from './use-folder-mutation.ts'
import { useFolders } from './use-folders.ts'

const props = defineProps<{
	open: boolean
	folder: EnvelopeFolder
}>()

const emit = defineEmits<{ close: [], deleted: [folder: EnvelopeFolder] }>()

const folders = useFolders()
const destination = computed(() => folderById(folders.value, props.folder.parentId)?.title ?? t(APP_ID, 'No folder'))

const { error, isPending, mutate, requestClose } = useFolderDialogMutation({
	isOpen: () => props.open,
	close: () => emit('close'),
	mutationFn: async (folder: EnvelopeFolder) => {
		await deleteFolder(folder.id)
		return folder
	},
	failureLog: 'Could not delete the folder',
	successMessage: () => t(APP_ID, 'Folder deleted'),
	beforeClose: (folder) => emit('deleted', folder),
})
</script>

<template>
	<AvDialog :open="open" :title="t(APP_ID, 'Delete folder?')" :error="error" @close="requestClose">
		<p class="folder-delete-dialog__text">
			{{ t(APP_ID, 'Its subfolders and envelopes move to {destination}. No envelope is deleted.', { destination }, undefined, PLAIN_TEXT) }}
		</p>
		<template #actions>
			<AvButton variant="secondary" :disabled="isPending" @click="requestClose">
				{{ t(APP_ID, 'Cancel') }}
			</AvButton>
			<AvButton variant="danger" :disabled="isPending" @click="mutate(folder)">
				{{ t(APP_ID, 'Delete folder') }}
			</AvButton>
		</template>
	</AvDialog>
</template>

<style scoped>
.folder-delete-dialog__text {
	margin: 0;
	color: var(--av-muted);
}
</style>
```

`src/folders/FolderTransferDialog.vue`:

```vue
<script lang="ts">
const SEARCH_DEBOUNCE_MILLISECONDS = 250
/** The select's value before anyone is chosen. */
const NOBODY = ''
</script>

<script setup lang="ts">
import type { EnvelopeFolder } from '../api/types.ts'

import { t } from '@nextcloud/l10n'
import { useQuery } from '@tanstack/vue-query'
import { computed, ref, watch } from 'vue'
import AvButton from '../ui/AvButton.vue'
import AvDialog from '../ui/AvDialog.vue'
import AvSelect from '../ui/AvSelect.vue'
import AvTextField from '../ui/AvTextField.vue'
import { searchSharees, transferFolder } from '../api/folders.ts'
import { QUERY_KEYS } from '../api/query-keys.ts'
import { APP_ID } from '../app-config.ts'
import { PLAIN_TEXT } from '../presentation/plain-text.ts'
import { useDebounced } from '../presentation/use-debounced.ts'
import { useFolderDialogMutation } from './use-folder-mutation.ts'

const props = defineProps<{
	open: boolean
	folder: EnvelopeFolder
}>()

const emit = defineEmits<{ close: [] }>()

const search = ref('')
const debouncedSearch = useDebounced(search, SEARCH_DEBOUNCE_MILLISECONDS)
const searchedText = computed(() => debouncedSearch.value.trim())
const newOwnerUid = ref(NOBODY)

const shareesQuery = useQuery({
	queryKey: computed(() => QUERY_KEYS.sharees(searchedText.value)),
	queryFn: ({ queryKey: [, text], signal }) => searchSharees(text, signal),
	enabled: computed(() => props.open && searchedText.value !== ''),
})

/** People only: a folder belongs to one member, never to a group. */
const ownerOptions = computed(() => [
	{ value: NOBODY, label: t(APP_ID, 'Choose a person') },
	...(shareesQuery.data.value ?? [])
		.filter((sharee) => sharee.type === 'user' && sharee.id !== props.folder.ownerUid)
		.map((sharee) => ({ value: sharee.id, label: sharee.displayName })),
])

const { error, isPending, mutate, requestClose } = useFolderDialogMutation({
	isOpen: () => props.open,
	close: () => emit('close'),
	mutationFn: ({ folderId, ownerUid }: { folderId: number, ownerUid: string }) => transferFolder(folderId, ownerUid),
	failureLog: 'Could not transfer the folder',
	successMessage: () => t(APP_ID, 'Folder transferred'),
})

watch(() => props.open, (isOpen) => {
	if (!isOpen) {
		return
	}
	search.value = ''
	newOwnerUid.value = NOBODY
})
</script>

<template>
	<AvDialog :open="open" :title="t(APP_ID, 'Transfer folder')" :error="error" @close="requestClose">
		<p class="folder-transfer-dialog__owner">
			{{ t(APP_ID, 'Current owner: {owner}', { owner: folder.ownerDisplayName }, undefined, PLAIN_TEXT) }}
		</p>
		<AvTextField v-model="search" type="search" :label="t(APP_ID, 'Search people')" />
		<AvSelect v-model="newOwnerUid" :label="t(APP_ID, 'New owner')" :options="ownerOptions" />
		<template #actions>
			<AvButton variant="secondary" :disabled="isPending" @click="requestClose">
				{{ t(APP_ID, 'Cancel') }}
			</AvButton>
			<AvButton :disabled="isPending || newOwnerUid === NOBODY" @click="mutate({ folderId: folder.id, ownerUid: newOwnerUid })">
				{{ t(APP_ID, 'Transfer') }}
			</AvButton>
		</template>
	</AvDialog>
</template>

<style scoped>
.folder-transfer-dialog__owner {
	margin: 0;
	color: var(--av-muted);
}
</style>
```

- [ ] **Step 5: Write the tree**

`src/folders/FolderTreeItem.vue`:

```vue
<script setup lang="ts">
import type { EnvelopeFolder } from '../api/types.ts'
import type { FolderAction, FolderNode } from './folder-tree.ts'

import { t } from '@nextcloud/l10n'
import { ChevronDown, ChevronRight, EllipsisVertical, Folder } from 'lucide-vue-next'
import { computed, useId } from 'vue'
import NavigationLink from '../layout/NavigationLink.vue'
import AvIconButton from '../ui/AvIconButton.vue'
import AvMenu from '../ui/AvMenu.vue'
import { APP_ID } from '../app-config.ts'
import { ICON_SIZE_INLINE, ICON_STROKE_INLINE, ICON_STROKE_MENU } from '../icon-sizes.ts'
import { PLAIN_TEXT } from '../presentation/plain-text.ts'
import { folderQuery, ROUTE_NAMES } from '../router.ts'
import { folderMenuItems, isFolderAction } from './folder-tree.ts'

const props = defineProps<{
	node: FolderNode
	depth: number
	currentFolderId: number | null
	expandedIds: ReadonlySet<number>
	canSeeAll: boolean
}>()

const emit = defineEmits<{
	toggle: [folderId: number]
	action: [action: FolderAction, folder: EnvelopeFolder]
	navigate: []
}>()

const childListId = useId()
const folder = computed(() => props.node.folder)
const hasChildren = computed(() => props.node.children.length > 0)
const isExpanded = computed(() => props.expandedIds.has(folder.value.id))
const menuItems = computed(() => folderMenuItems(folder.value, props.canSeeAll))
const toggleLabel = computed(() => (isExpanded.value
	? t(APP_ID, 'Collapse {folder}', { folder: folder.value.title }, undefined, PLAIN_TEXT)
	: t(APP_ID, 'Expand {folder}', { folder: folder.value.title }, undefined, PLAIN_TEXT)))

function onMenuSelect(id: string) {
	if (!isFolderAction(id)) {
		return
	}
	emit('action', id, folder.value)
}
</script>

<template>
	<li class="folder-tree-item">
		<div class="folder-tree-item__row" :style="{ '--folder-depth': depth }">
			<AvIconButton
				v-if="hasChildren"
				class="folder-tree-item__toggle"
				:label="toggleLabel"
				:aria-expanded="isExpanded ? 'true' : 'false'"
				:aria-controls="childListId"
				@click="emit('toggle', folder.id)">
				<ChevronDown v-if="isExpanded" :size="ICON_SIZE_INLINE" :stroke-width="ICON_STROKE_INLINE" aria-hidden="true" />
				<ChevronRight v-else :size="ICON_SIZE_INLINE" :stroke-width="ICON_STROKE_INLINE" aria-hidden="true" />
			</AvIconButton>
			<span v-else class="folder-tree-item__toggle-space" aria-hidden="true" />
			<div class="folder-tree-item__link">
				<NavigationLink
					:label="folder.title"
					:to="{ name: ROUTE_NAMES.dashboard, query: folderQuery(folder.id) }"
					:current="currentFolderId === folder.id"
					@navigate="emit('navigate')">
					<template #icon>
						<Folder :size="ICON_SIZE_INLINE" :stroke-width="ICON_STROKE_INLINE" aria-hidden="true" />
					</template>
				</NavigationLink>
			</div>
			<AvMenu
				v-if="menuItems.length > 0"
				class="folder-tree-item__menu"
				:label="t(APP_ID, 'Actions for {title}', { title: folder.title }, undefined, PLAIN_TEXT)"
				:items="menuItems"
				@select="onMenuSelect">
				<template #triggerIcon>
					<EllipsisVertical :size="ICON_SIZE_INLINE" :stroke-width="ICON_STROKE_MENU" />
				</template>
			</AvMenu>
		</div>
		<ul v-if="hasChildren" v-show="isExpanded" :id="childListId" class="folder-tree-item__children">
			<FolderTreeItem
				v-for="child in node.children"
				:key="child.folder.id"
				:node="child"
				:depth="depth + 1"
				:currentFolderId="currentFolderId"
				:expandedIds="expandedIds"
				:canSeeAll="canSeeAll"
				@toggle="emit('toggle', $event)"
				@action="(action: FolderAction, target: EnvelopeFolder) => emit('action', action, target)"
				@navigate="emit('navigate')" />
		</ul>
	</li>
</template>

<style scoped>
.folder-tree-item {
	list-style: none;
}

/* Each level indents by 16px; the toggle keeps the 44px target. */
.folder-tree-item__row {
	display: flex;
	align-items: center;
	gap: 2px;
	padding-inline-start: calc(var(--folder-depth) * 16px);
	border-radius: var(--av-radius-pill);
}

.folder-tree-item__toggle-space {
	flex-shrink: 0;
	width: var(--av-control-height);
}

.folder-tree-item__link {
	flex-grow: 1;
	min-width: 0;
}

.folder-tree-item__link :deep(.navigation-link) {
	padding: 0 10px;
}

.folder-tree-item__link :deep(.navigation-link__label) {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.folder-tree-item__children {
	margin: 0;
	padding: 0;
}
</style>
```

`src/folders/FolderTree.vue`:

```vue
<script lang="ts">
import type { EnvelopeFolder } from '../api/types.ts'
import type { FolderAction } from './folder-tree.ts'

/** The one dialog the tree has open, and the folder it is about (a new top-level folder has none). */
type OpenDialog
	= | { action: 'create', parent: EnvelopeFolder | null }
		| { action: Exclude<FolderAction, 'new-subfolder'>, folder: EnvelopeFolder }

const DIALOG_OPENERS: Readonly<Record<FolderAction, (folder: EnvelopeFolder) => OpenDialog>> = {
	'new-subfolder': (folder) => ({ action: 'create', parent: folder }),
	rename: (folder) => ({ action: 'rename', folder }),
	share: (folder) => ({ action: 'share', folder }),
	move: (folder) => ({ action: 'move', folder }),
	transfer: (folder) => ({ action: 'transfer', folder }),
	delete: (folder) => ({ action: 'delete', folder }),
}
</script>

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import { FolderPlus } from 'lucide-vue-next'
import { computed, ref, useId, watch } from 'vue'
import { useRouter } from 'vue-router'
import AvIconButton from '../ui/AvIconButton.vue'
import FolderDeleteDialog from './FolderDeleteDialog.vue'
import FolderMoveDialog from './FolderMoveDialog.vue'
import FolderNameDialog from './FolderNameDialog.vue'
import FolderShareDialog from './FolderShareDialog.vue'
import FolderTransferDialog from './FolderTransferDialog.vue'
import FolderTreeItem from './FolderTreeItem.vue'
import { APP_ID, appConfig } from '../app-config.ts'
import { ICON_SIZE_INLINE, ICON_STROKE_INLINE } from '../icon-sizes.ts'
import { folderQuery, ROUTE_NAMES } from '../router.ts'
import { ancestorIds, buildFolderTree } from './folder-tree.ts'
import { useFolders } from './use-folders.ts'

const props = defineProps<{
	currentFolderId: number | null
}>()

const emit = defineEmits<{ navigate: [] }>()

const { canSeeAll } = appConfig()
const router = useRouter()
const headingId = useId()
const folders = useFolders()
const tree = computed(() => buildFolderTree(folders.value))
const expandedIds = ref<ReadonlySet<number>>(new Set())
const openDialog = ref<OpenDialog | null>(null)

const nameDialog = computed(() => {
	const dialog = openDialog.value
	if (dialog?.action === 'create') {
		return { folder: null, parent: dialog.parent }
	}
	return dialog?.action === 'rename' ? { folder: dialog.folder, parent: null } : null
})

function folderOf(action: Exclude<FolderAction, 'new-subfolder' | 'rename'>): EnvelopeFolder | null {
	const dialog = openDialog.value
	return dialog !== null && dialog.action === action && 'folder' in dialog ? dialog.folder : null
}

const shareFolder = computed(() => folderOf('share'))
const moveFolderTarget = computed(() => folderOf('move'))
const transferFolderTarget = computed(() => folderOf('transfer'))
const deleteFolderTarget = computed(() => folderOf('delete'))

/** The current folder's ancestors open, so the user sees where they are. */
watch([() => props.currentFolderId, folders], ([folderId]) => {
	if (folderId === null) {
		return
	}
	expandedIds.value = new Set([...expandedIds.value, ...ancestorIds(folders.value, folderId)])
}, { immediate: true })

function onToggle(folderId: number) {
	const next = new Set(expandedIds.value)
	const wasExpanded = next.delete(folderId)
	if (!wasExpanded) {
		next.add(folderId)
	}
	expandedIds.value = next
}

function onAction(action: FolderAction, folder: EnvelopeFolder) {
	openDialog.value = DIALOG_OPENERS[action](folder)
}

function onNewFolder() {
	openDialog.value = { action: 'create', parent: null }
}

function onCloseDialog() {
	openDialog.value = null
}

/** A deleted folder on screen hands the view to its parent, where its envelopes went. */
async function onDeleted(folder: EnvelopeFolder) {
	if (props.currentFolderId !== folder.id) {
		return
	}
	await router.replace({ name: ROUTE_NAMES.dashboard, query: folder.parentId === null ? {} : folderQuery(folder.parentId) })
}
</script>

<template>
	<section class="folder-tree" :aria-labelledby="headingId">
		<div class="folder-tree__header">
			<h2 :id="headingId" class="folder-tree__heading">
				{{ t(APP_ID, 'Folders') }}
			</h2>
			<AvIconButton :label="t(APP_ID, 'New folder')" @click="onNewFolder">
				<FolderPlus :size="ICON_SIZE_INLINE" :stroke-width="ICON_STROKE_INLINE" aria-hidden="true" />
			</AvIconButton>
		</div>
		<ul v-if="tree.length > 0" class="folder-tree__list">
			<FolderTreeItem
				v-for="node in tree"
				:key="node.folder.id"
				:node="node"
				:depth="0"
				:currentFolderId="currentFolderId"
				:expandedIds="expandedIds"
				:canSeeAll="canSeeAll"
				@toggle="onToggle"
				@action="onAction"
				@navigate="emit('navigate')" />
		</ul>
		<p v-else class="folder-tree__empty">
			{{ t(APP_ID, 'No folders yet') }}
		</p>
		<FolderNameDialog
			:open="nameDialog !== null"
			:folder="nameDialog?.folder ?? null"
			:parent="nameDialog?.parent ?? null"
			@close="onCloseDialog" />
		<FolderShareDialog v-if="shareFolder !== null" :open="true" :folder="shareFolder" @close="onCloseDialog" />
		<FolderMoveDialog v-if="moveFolderTarget !== null" :open="true" :folder="moveFolderTarget" @close="onCloseDialog" />
		<FolderTransferDialog v-if="transferFolderTarget !== null" :open="true" :folder="transferFolderTarget" @close="onCloseDialog" />
		<FolderDeleteDialog
			v-if="deleteFolderTarget !== null"
			:open="true"
			:folder="deleteFolderTarget"
			@close="onCloseDialog"
			@deleted="onDeleted" />
	</section>
</template>

<style scoped>
.folder-tree {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin-top: 16px;
}

.folder-tree__header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding-inline-start: 16px;
}

.folder-tree__heading {
	margin: 0;
	color: var(--av-muted);
	font-size: var(--av-text-meta);
	font-weight: 400;
	letter-spacing: 0.4px;
	text-transform: uppercase;
}

.folder-tree__list {
	margin: 0;
	padding: 0;
}

.folder-tree__empty {
	margin: 0;
	padding: 0 16px;
	color: var(--av-muted);
	font-size: var(--av-text-meta);
}
</style>
```

Wire it into `src/layout/AppNavigation.vue`: add `import FolderTree from '../folders/FolderTree.vue'` with the component imports, replace the spacer line with:

```vue
		<FolderTree :currentFolderId="currentFolderId" @navigate="emit('navigate')" />
		<div class="app-navigation__spacer" />
```

The phone drawer already renders `AppNavigation`, so the tree opens in the drawer there.

Add to both l10n files:

```json
    "Folders" : "Pastas",
    "New folder" : "Nova pasta",
    "No folders yet" : "Nenhuma pasta ainda",
    "Expand {folder}" : "Expandir {folder}",
    "Collapse {folder}" : "Recolher {folder}",
    "Rename folder" : "Renomear pasta",
    "New subfolder in {folder}" : "Nova subpasta em {folder}",
    "Folder name" : "Nome da pasta",
    "Create folder" : "Criar pasta",
    "Save" : "Salvar",
    "Folder created" : "Pasta criada",
    "Folder renamed" : "Pasta renomeada",
    "Delete folder?" : "Excluir pasta?",
    "Its subfolders and envelopes move to {destination}. No envelope is deleted." : "As subpastas e os envelopes dela vão para {destination}. Nenhum envelope é excluído.",
    "No folder" : "Sem pasta",
    "Delete folder" : "Excluir pasta",
    "Folder deleted" : "Pasta excluída",
    "Transfer folder" : "Transferir pasta",
    "Current owner: {owner}" : "Dono atual: {owner}",
    "Search people" : "Buscar pessoas",
    "New owner" : "Novo dono",
    "Choose a person" : "Escolha uma pessoa",
    "Folder transferred" : "Pasta transferida",
    "Move \"{title}\"" : "Mover \"{title}\"",
    "Destination" : "Destino",
    "Move" : "Mover",
    "Folder moved" : "Pasta movida"
```

- [ ] **Step 6: Run them and watch them pass**

Run: `npx vitest run src/folders src/layout`
Expected: PASS.

- [ ] **Step 7: Run the gates and commit**

Run each: `npm run typecheck`, `npm run lint`, `npm test`.

```bash
git add src l10n
git commit -m "feat(folders): show the folder tree with its menu and dialogs"
```

---

### Task 7: Drag and drop, and "Mover para…" for envelopes

**Files:**
- Create: `src/folders/EnvelopeMoveDialog.vue`
- Modify: `src/folders/FolderTreeItem.vue`, `src/folders/FolderTree.vue`, `src/dashboard/EnvelopeTable.vue`, `src/dashboard/DashboardView.vue`
- Modify: `l10n/pt_BR.json`, `l10n/pt_BR.js`
- Test: `src/folders/FolderTree.spec.ts`, `src/dashboard/DashboardView.spec.ts`

**Interfaces:**
- Consumes: `writeDragPayload`, `carriesDragPayload`, `readDragPayload`, `canMoveEnvelope`, `moveTargetOptions`, `FolderPickerDialog`, `useFolderDialogMutation`, `moveEnvelope`.
- Produces:
  - `<EnvelopeMoveDialog :open :envelope="{ uuid, title, folderId }" @close />` — the keyboard alternative ("Mover para…"); the detail page reuses it in Task 9.
  - Envelope rows the user may move are `draggable`; their ⋮ menu has "Mover para…". Folder rows the user manages are draggable; folders the user can edit accept drops.

- [ ] **Step 1: Write the failing tests**

Append to `src/folders/FolderTree.spec.ts` (add `moveEnvelope` to the imports from a new mock `vi.mock('../api/envelopes.ts', () => ({ moveEnvelope: vi.fn() }))` and `import { moveEnvelope } from '../api/envelopes.ts'`):

```ts
describe('dropping onto a folder', () => {
	function rowOf(wrapper: VueWrapper, title: string) {
		return wrapper.findAll('.folder-tree-item__row').find((row) => row.text().includes(title))
	}

	it('files a dragged envelope in the folder', async () => {
		vi.mocked(moveEnvelope).mockResolvedValue(envelopeDetail({ uuid: 'abc', folderId: 1 }))
		const { wrapper } = await mountTree()
		const transfer = new DataTransfer()
		transfer.setData('application/x-assinaturas-envelope', 'abc')

		await rowOf(wrapper, 'Contratos')?.trigger('dragover', { dataTransfer: transfer })
		expect(rowOf(wrapper, 'Contratos')?.classes()).toContain('folder-tree-item__row--drop-target')
		await rowOf(wrapper, 'Contratos')?.trigger('drop', { dataTransfer: transfer })
		await flushPromises()

		expect(moveEnvelope).toHaveBeenCalledWith('abc', 1)
		expect(showSuccess).toHaveBeenCalledWith('Envelope movido')
	})

	it('moves a dragged folder into another one, but never into itself', async () => {
		vi.mocked(moveFolder).mockResolvedValue(folder(3, 'RH', 1))
		vi.mocked(listFolders).mockResolvedValue([CONTRATOS, FORNECEDORES, folder(4, 'Jurídico', null)])
		const { wrapper } = await mountTree()
		const transfer = new DataTransfer()

		await rowOf(wrapper, 'Jurídico')?.trigger('dragstart', { dataTransfer: transfer })
		await rowOf(wrapper, 'Contratos')?.trigger('drop', { dataTransfer: transfer })
		await flushPromises()
		const ownTransfer = new DataTransfer()
		await rowOf(wrapper, 'Contratos')?.trigger('dragstart', { dataTransfer: ownTransfer })
		await rowOf(wrapper, 'Contratos')?.trigger('drop', { dataTransfer: ownTransfer })
		await flushPromises()

		expect(moveFolder).toHaveBeenCalledOnce()
		expect(moveFolder).toHaveBeenCalledWith(4, 1)
	})

	it('ignores drops on a folder the user only views', async () => {
		const { wrapper } = await mountTree()
		const transfer = new DataTransfer()
		transfer.setData('application/x-assinaturas-envelope', 'abc')

		await rowOf(wrapper, 'RH')?.trigger('drop', { dataTransfer: transfer })
		await flushPromises()

		expect(moveEnvelope).not.toHaveBeenCalled()
	})

	it('lets only folders the user manages be dragged', async () => {
		const { wrapper } = await mountTree()

		expect(rowOf(wrapper, 'Contratos')?.attributes('draggable')).toBe('true')
		expect(rowOf(wrapper, 'RH')?.attributes('draggable')).toBe('false')
	})
})
```

(import `envelopeDetail` from `'../test-support/envelope-fixtures.ts'`.)

Append to `src/dashboard/DashboardView.spec.ts` (mock `moveEnvelope` by adding it to the existing `'../api/envelopes.ts'` mock: `({ listEnvelopes: vi.fn(), deleteDraft: vi.fn(), moveEnvelope: vi.fn() })`, and import it):

```ts
describe('moving envelopes', () => {
	const CONTRATOS: EnvelopeFolder = { id: 7, title: 'Contratos', parentId: null, ownerUid: 'patrick', ownerDisplayName: 'Patrick Rezende', sortOrder: 0, right: 'manage' }

	it('moves an envelope with "Mover para…" from its row menu, the keyboard alternative to dragging', async () => {
		vi.mocked(listFolders).mockResolvedValue([CONTRATOS])
		vi.mocked(listEnvelopes).mockResolvedValue(listing())
		vi.mocked(moveEnvelope).mockResolvedValue(envelopeDetail({ uuid: 'contrato', folderId: 7 }))
		const { wrapper } = await mountDashboard()

		await rowOf(wrapper, 'Contrato de prestação de serviços')?.find('button[aria-haspopup]').trigger('click')
		await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Mover para…')?.trigger('click')
		await settle()
		const dialog = wrapper.findAll('dialog').find((candidate) => candidate.element.open)
		await dialog?.find('select').setValue('7')
		await dialog?.findAll('button').find((button) => button.text() === 'Mover')?.trigger('click')
		await settle()

		expect(moveEnvelope).toHaveBeenCalledWith('contrato', 7)
		expect(showSuccess).toHaveBeenCalledWith('Envelope movido')
	})

	it('makes the rows the user may move draggable, and only those', async () => {
		vi.mocked(listEnvelopes).mockResolvedValue(listing({ envelopes: [
			envelopeSummary({ uuid: 'a', title: 'Movível' }),
			envelopeSummary({ uuid: 'b', title: 'Só leitura', permissions: { act: false, edit: false, remove: false } }),
		] }))
		const { wrapper } = await mountDashboard({ path: '/?scope=shared' })

		expect(rowOf(wrapper, 'Movível')?.attributes('draggable')).toBe('true')
		expect(rowOf(wrapper, 'Só leitura')?.attributes('draggable')).toBe('false')
	})

	it('puts the envelope on the drag', async () => {
		vi.mocked(listEnvelopes).mockResolvedValue(listing())
		const { wrapper } = await mountDashboard()
		const transfer = new DataTransfer()

		await rowOf(wrapper, 'Contrato de prestação de serviços')?.trigger('dragstart', { dataTransfer: transfer })

		expect(transfer.getData('application/x-assinaturas-envelope')).toBe('contrato')
	})
})
```

(import `envelopeDetail` from the fixtures; the row menu's trigger is `AvMenu`'s button with `aria-haspopup="menu"`.)

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/folders/FolderTree.spec.ts src/dashboard/DashboardView.spec.ts`
Expected: FAIL — no drop handling, no "Mover para…" row item, rows not draggable.

- [ ] **Step 3: Write the envelope move dialog**

`src/folders/EnvelopeMoveDialog.vue`:

```vue
<script setup lang="ts">
import type { EnvelopeSummary } from '../api/types.ts'

import { t } from '@nextcloud/l10n'
import { useQueryClient } from '@tanstack/vue-query'
import { computed } from 'vue'
import FolderPickerDialog from './FolderPickerDialog.vue'
import { moveEnvelope } from '../api/envelopes.ts'
import { QUERY_KEYS } from '../api/query-keys.ts'
import { APP_ID } from '../app-config.ts'
import { PLAIN_TEXT } from '../presentation/plain-text.ts'
import { folderIdFromOption, moveTargetOptions, optionValueOf } from './folder-tree.ts'
import { useFolderDialogMutation } from './use-folder-mutation.ts'
import { useFolders } from './use-folders.ts'

const props = defineProps<{
	open: boolean
	envelope: Pick<EnvelopeSummary, 'uuid' | 'title' | 'folderId'>
}>()

const emit = defineEmits<{ close: [] }>()

const NO_EXCLUDED_FOLDERS: ReadonlySet<number> = new Set()

const queryClient = useQueryClient()
const folders = useFolders()
const options = computed(() => moveTargetOptions(folders.value, NO_EXCLUDED_FOLDERS, t(APP_ID, 'No folder')))
const title = computed(() => t(APP_ID, 'Move "{title}"', { title: props.envelope.title }, undefined, PLAIN_TEXT))

const { error, isPending, mutate, requestClose } = useFolderDialogMutation({
	isOpen: () => props.open,
	close: () => emit('close'),
	mutationFn: ({ uuid, folderId }: { uuid: string, folderId: number | null }) => moveEnvelope(uuid, folderId),
	failureLog: 'Could not move the envelope',
	successMessage: () => t(APP_ID, 'Envelope moved'),
	afterSuccess: (detail) => {
		queryClient.setQueryData(QUERY_KEYS.envelope(detail.uuid), detail)
	},
})

function onPick(value: string) {
	mutate({ uuid: props.envelope.uuid, folderId: folderIdFromOption(value) })
}
</script>

<template>
	<FolderPickerDialog
		:open="open"
		:title="title"
		:options="options"
		:current="optionValueOf(envelope.folderId)"
		:error="error"
		:isPending="isPending"
		@close="requestClose"
		@pick="onPick" />
</template>
```

- [ ] **Step 4: Make rows and folders draggable, folders droppable**

In `src/folders/FolderTreeItem.vue`:
- add imports: `import type { DragPayload } from './drag-payload.ts'`, `ref` from `vue`, `rightAtLeast` from `./folder-tree.ts`, and `import { carriesDragPayload, readDragPayload, writeDragPayload } from './drag-payload.ts'`;
- add `drop: [payload: DragPayload, target: EnvelopeFolder]` to the emits;
- add after `toggleLabel`:

```ts
const isDropTarget = ref(false)
/** Moving a folder needs Gerenciar on it; filing into a folder needs Editar there. */
const canDrag = computed(() => rightAtLeast(folder.value.right, 'manage'))
const acceptsDrops = computed(() => rightAtLeast(folder.value.right, 'edit'))

function onDragStart(event: DragEvent) {
	if (!canDrag.value || event.dataTransfer === null) {
		return
	}
	event.stopPropagation()
	writeDragPayload(event.dataTransfer, { kind: 'folder', folderId: folder.value.id })
}

function onDragOver(event: DragEvent) {
	if (!acceptsDrops.value || !carriesDragPayload(event.dataTransfer)) {
		return
	}
	event.preventDefault()
	isDropTarget.value = true
}

function onDragLeave() {
	isDropTarget.value = false
}

function onDrop(event: DragEvent) {
	isDropTarget.value = false
	const payload = readDragPayload(event.dataTransfer)
	if (!acceptsDrops.value || payload === null) {
		return
	}
	event.preventDefault()
	event.stopPropagation()
	emit('drop', payload, folder.value)
}
```

- replace the row's opening tag with:

```vue
		<div
			class="folder-tree-item__row"
			:class="{ 'folder-tree-item__row--drop-target': isDropTarget }"
			:style="{ '--folder-depth': depth }"
			:draggable="canDrag ? 'true' : 'false'"
			@dragstart="onDragStart"
			@dragover="onDragOver"
			@dragleave="onDragLeave"
			@drop="onDrop">
```

- forward drops from children: add `@drop="(payload: DragPayload, target: EnvelopeFolder) => emit('drop', payload, target)"` to the nested `<FolderTreeItem>`;
- add the style:

```css
.folder-tree-item__row--drop-target {
	outline: 2px solid var(--av-action);
	outline-offset: -2px;
	background: var(--av-tint);
}
```

In `src/folders/FolderTree.vue`:
- add imports: `import type { DragPayload } from './drag-payload.ts'`, `showSuccess` from `@nextcloud/dialogs`, `useMutation, useQueryClient` from `@tanstack/vue-query`, `moveEnvelope` from `../api/envelopes.ts`, `moveFolder` from `../api/folders.ts`, `showApiError` from `../api/show-api-error.ts`, `logger` from `../logger.ts`, `subtreeIds` from `./folder-tree.ts`, `refreshFolderViews` from `./use-folders.ts`;
- add to the plain `<script lang="ts">` block:

```ts
async function moveDropped(payload: DragPayload, targetFolderId: number): Promise<void> {
	if (payload.kind === 'envelope') {
		await moveEnvelope(payload.uuid, targetFolderId)
		return
	}
	await moveFolder(payload.folderId, targetFolderId)
}
```

  (move the `import { moveEnvelope } …` and `import { moveFolder } …` lines into that block, since it uses them);
- add in `<script setup>`:

```ts
const queryClient = useQueryClient()

const dropMove = useMutation({
	mutationFn: ({ payload, target }: { payload: DragPayload, target: EnvelopeFolder }) => moveDropped(payload, target.id),
	onSuccess: async (_result, { payload }) => {
		showSuccess(payload.kind === 'envelope' ? t(APP_ID, 'Envelope moved') : t(APP_ID, 'Folder moved'))
		await refreshFolderViews(queryClient)
	},
	onError: (failure) => {
		logger.error('Could not move what was dropped on a folder', { error: failure })
		showApiError(failure)
	},
})

/** A folder dropped on itself or below itself stays where it is. */
function onDrop(payload: DragPayload, target: EnvelopeFolder) {
	if (payload.kind === 'folder' && subtreeIds(folders.value, payload.folderId).has(target.id)) {
		return
	}
	dropMove.mutate({ payload, target })
}
```

- add `@drop="onDrop"` to the top-level `<FolderTreeItem>`.

In `src/dashboard/EnvelopeTable.vue`:
- imports: `writeDragPayload` from `'../folders/drag-payload.ts'` and `canMoveEnvelope` from `'../folders/envelope-moving.ts'`;
- emits: `const emit = defineEmits<{ deleteDraft: [envelope: EnvelopeSummary], moveEnvelope: [envelope: EnvelopeSummary] }>()`;
- `type RowAction = 'open' | 'continue' | 'delete' | 'move'`;
- replace `rowActions()` with:

```ts
const MOVE_ITEM: () => MenuItem = () => ({ id: 'move', label: t(APP_ID, 'Move to…') })

function rowActions(envelope: EnvelopeSummary): MenuItem[] {
	const moving = canMoveEnvelope(envelope) ? [MOVE_ITEM()] : []
	if (envelope.status === 'draft') {
		return [
			{ id: 'continue', label: t(APP_ID, 'Continue editing') },
			...moving,
			{ id: 'delete', label: t(APP_ID, 'Delete draft'), tone: 'danger' },
		]
	}
	return [{ id: 'open', label: t(APP_ID, 'Open') }, ...moving]
}
```

- add `move: (envelope) => emit('moveEnvelope', envelope),` to `ROW_ACTIONS`;
- add:

```ts
/** Dragging a row onto a folder of the sidebar files it there; "Mover para…" in the row menu does the same by keyboard. */
function onDragStart(event: DragEvent, envelope: EnvelopeSummary) {
	if (event.dataTransfer === null || !canMoveEnvelope(envelope)) {
		return
	}
	writeDragPayload(event.dataTransfer, { kind: 'envelope', uuid: envelope.uuid })
}
```

- replace `<tr v-for="envelope in envelopes" :key="envelope.uuid">` with:

```vue
			<tr
				v-for="envelope in envelopes"
				:key="envelope.uuid"
				:draggable="canMoveEnvelope(envelope) ? 'true' : 'false'"
				@dragstart="onDragStart($event, envelope)">
```

In `src/dashboard/DashboardView.vue`:
- import `EnvelopeMoveDialog from '../folders/EnvelopeMoveDialog.vue'`;
- add `const envelopeToMove = ref<EnvelopeSummary | null>(null)`;
- on `<EnvelopeTable …>` add `@moveEnvelope="envelopeToMove = $event"`;
- before the closing `</div>` of `.dashboard`, add:

```vue
		<EnvelopeMoveDialog
			v-if="envelopeToMove !== null"
			:open="true"
			:envelope="envelopeToMove"
			@close="envelopeToMove = null" />
```

Add to both l10n files:

```json
    "Envelope moved" : "Envelope movido"
```

- [ ] **Step 5: Run them and watch them pass**

Run: `npx vitest run src/folders src/dashboard`
Expected: PASS.

- [ ] **Step 6: Run the gates and commit**

Run each: `npm run typecheck`, `npm run lint`, `npm test`.

```bash
git add src l10n
git commit -m "feat(folders): drag envelopes and folders onto folders, with a keyboard Mover para"
```

---

### Task 8: The wizard's "Pasta" field

**Files:**
- Create: `src/wizard/EnvelopeFolderField.vue`
- Modify: `src/wizard/DocumentsStep.vue`
- Modify: `l10n/pt_BR.json`, `l10n/pt_BR.js`
- Test: `src/wizard/EnvelopeFolderField.spec.ts`; add the folders mock to `src/wizard/DocumentsStep.spec.ts` and `src/wizard/WizardView.spec.ts`

**Interfaces:**
- Consumes: `moveEnvelope` (Task 1), `DRAFT_CHANGES` `'folder'` (Task 1), `draftChangeOptions`, `forgetSettledSaves` (existing `src/wizard/draft-save-state.ts`), `moveTargetOptions`, `optionValueOf`, `folderIdFromOption`, `useFolders` (Task 2).
- Produces: `<EnvelopeFolderField :envelope="EnvelopeDetail" />` — optional; saves as the draft change `folder`, so the wizard's save line and retry cover it. A new draft starts in the folder being viewed (Task 3/4 pass it to `createEnvelope`).

- [ ] **Step 1: Write the failing test**

`src/wizard/EnvelopeFolderField.spec.ts`:

```ts
import type { VueWrapper } from '@vue/test-utils'
import type { EnvelopeFolder } from '../api/types.ts'

import { showError } from '@nextcloud/dialogs'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EnvelopeFolderField from './EnvelopeFolderField.vue'
import { ApiError } from '../api/api-error.ts'
import { moveEnvelope } from '../api/envelopes.ts'
import { listFolders } from '../api/folders.ts'
import { QUERY_KEYS } from '../api/query-keys.ts'
import { envelopeDetail } from '../test-support/envelope-fixtures.ts'
import { usePortugueseEnvironment } from '../test-support/pt-br-environment.ts'

vi.mock('../api/envelopes.ts', () => ({ moveEnvelope: vi.fn() }))
vi.mock('../api/folders.ts', () => ({ listFolders: vi.fn() }))
vi.mock('@nextcloud/dialogs', () => ({ showError: vi.fn(), showSuccess: vi.fn() }))

usePortugueseEnvironment()

const NBSP = ' '

function folder(id: number, title: string, parentId: number | null, right: EnvelopeFolder['right']): EnvelopeFolder {
	return { id, title, parentId, ownerUid: 'maria', ownerDisplayName: 'Maria Souza', sortOrder: 0, right }
}

const mounted: VueWrapper[] = []

async function mountField(folderId: number | null = null) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	const envelope = envelopeDetail({ uuid: 'rascunho', status: 'draft', folderId })
	queryClient.setQueryData(QUERY_KEYS.envelope('rascunho'), envelope)
	const wrapper = mount(EnvelopeFolderField, {
		props: { envelope },
		global: { plugins: [[VueQueryPlugin, { queryClient }]] },
	})
	mounted.push(wrapper)
	await flushPromises()
	return { wrapper, queryClient }
}

beforeEach(() => {
	vi.mocked(listFolders).mockResolvedValue([
		folder(1, 'Contratos', null, 'manage'),
		folder(2, 'Fornecedores', 1, 'edit'),
		folder(3, 'RH', null, 'view'),
	])
})

afterEach(() => {
	mounted.splice(0).forEach((wrapper) => wrapper.unmount())
	vi.clearAllMocks()
})

describe('the "Pasta" field', () => {
	it('offers "Sem pasta" and every folder the user can file envelopes in', async () => {
		const { wrapper } = await mountField()

		expect(wrapper.find('label').text()).toBe('Pasta')
		expect(wrapper.findAll('option').map((option) => option.text())).toEqual(['Sem pasta', 'Contratos', `${NBSP.repeat(3)}Fornecedores`])
		expect(wrapper.find('select').element.value).toBe('')
	})

	it('starts on the folder the draft was created in', async () => {
		const { wrapper } = await mountField(2)

		expect(wrapper.find('select').element.value).toBe('2')
	})

	it('saves the chosen folder as a draft change and shows the saved draft', async () => {
		const saved = envelopeDetail({ uuid: 'rascunho', status: 'draft', folderId: 1 })
		vi.mocked(moveEnvelope).mockResolvedValue(saved)
		const { wrapper, queryClient } = await mountField()

		await wrapper.find('select').setValue('1')
		await flushPromises()

		expect(moveEnvelope).toHaveBeenCalledWith('rascunho', 1)
		expect(queryClient.getQueryData(QUERY_KEYS.envelope('rascunho'))).toEqual(saved)
		expect(queryClient.getMutationCache().findAll({ mutationKey: QUERY_KEYS.draftChange('rascunho', 'folder') })).toHaveLength(1)
	})

	it('says why a refused folder was not saved and shows the saved one again', async () => {
		vi.mocked(moveEnvelope).mockRejectedValue(new ApiError('forbidden', 403, null, 'x'))
		const { wrapper } = await mountField()

		await wrapper.find('select').setValue('1')
		await flushPromises()

		expect(showError).toHaveBeenCalledWith('Você não pode fazer isso.')
		expect(wrapper.find('select').element.value).toBe('')
	})
})
```

(`'Você não pode fazer isso.'` is the existing pt_BR of the `forbidden` text.)

In `src/wizard/DocumentsStep.spec.ts` and `src/wizard/WizardView.spec.ts`, add `vi.mock('../api/folders.ts', () => ({ listFolders: vi.fn(async () => []) }))`, and if they mock `'../api/envelopes.ts'` with a factory listing functions, add `moveEnvelope: vi.fn()` to it.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/wizard/EnvelopeFolderField.spec.ts`
Expected: FAIL with `Failed to resolve import "./EnvelopeFolderField.vue"`.

- [ ] **Step 3: Write the field and place it in step 1**

`src/wizard/EnvelopeFolderField.vue`:

```vue
<script lang="ts">
/** Nothing chosen on screen beyond the saved folder. */
const NO_PENDING_CHOICE = null
</script>

<script setup lang="ts">
import type { EnvelopeDetail } from '../api/types.ts'

import { t } from '@nextcloud/l10n'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { computed, shallowRef } from 'vue'
import AvSelect from '../ui/AvSelect.vue'
import { moveEnvelope } from '../api/envelopes.ts'
import { QUERY_KEYS } from '../api/query-keys.ts'
import { showApiError } from '../api/show-api-error.ts'
import { APP_ID } from '../app-config.ts'
import { folderIdFromOption, moveTargetOptions, optionValueOf } from '../folders/folder-tree.ts'
import { useFolders } from '../folders/use-folders.ts'
import { logger } from '../logger.ts'
import { draftChangeOptions, forgetSettledSaves } from './draft-save-state.ts'

const props = defineProps<{
	envelope: EnvelopeDetail
}>()

const NO_EXCLUDED_FOLDERS: ReadonlySet<number> = new Set()

const uuid = props.envelope.uuid
const queryClient = useQueryClient()
const folders = useFolders()
/** The folder a save on its way is sending, shown at once; null shows the saved one. */
const pendingChoice = shallowRef<string | null>(NO_PENDING_CHOICE)

const folderSave = useMutation({
	...draftChangeOptions(uuid, 'folder'),
	mutationFn: (folderId: number | null) => moveEnvelope(uuid, folderId),
	onSuccess: async (detail) => {
		queryClient.setQueryData(QUERY_KEYS.envelope(uuid), detail)
		forgetSettledSaves(queryClient, uuid, 'folder')
		await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.allEnvelopes() })
	},
	onError: (error) => {
		logger.error('Could not file the draft in a folder', { error })
		showApiError(error)
	},
	onSettled: () => {
		pendingChoice.value = NO_PENDING_CHOICE
	},
})

const savedChoice = computed(() => optionValueOf(props.envelope.folderId))

/** The saved folder stays listed even when the user can no longer file envelopes there. */
const options = computed(() => {
	const targets = moveTargetOptions(folders.value, NO_EXCLUDED_FOLDERS, t(APP_ID, 'No folder'))
	const placement = props.envelope.folder
	const isListed = targets.some((option) => option.value === savedChoice.value)
	return isListed || placement === null ? targets : [...targets, { value: savedChoice.value, label: placement.title }]
})

const selected = computed({
	get: () => pendingChoice.value ?? savedChoice.value,
	set: (choice: string) => {
		if (choice === selected.value) {
			return
		}
		pendingChoice.value = choice
		folderSave.mutate(folderIdFromOption(choice))
	},
})
</script>

<template>
	<AvSelect
		v-model="selected"
		:label="t(APP_ID, 'Folder')"
		:hint="t(APP_ID, 'Optional. Whoever can see the folder sees the envelope once it is sent.')"
		:options="options" />
</template>
```

In `src/wizard/DocumentsStep.vue`, add `import EnvelopeFolderField from './EnvelopeFolderField.vue'` with the component imports, and right after the title `<AvTextField … :error="titleError" />` add:

```vue
			<EnvelopeFolderField :envelope="envelope" />
```

Add to both l10n files:

```json
    "Optional. Whoever can see the folder sees the envelope once it is sent." : "Opcional. Quem tem acesso à pasta vê o envelope depois do envio."
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/wizard`
Expected: PASS.

- [ ] **Step 5: Run the gates and commit**

Run each: `npm run typecheck`, `npm run lint`, `npm test`.

```bash
git add src l10n
git commit -m "feat(wizard): choose the envelope's folder in the documents step"
```

---

### Task 9: The envelope page — permissions, folder breadcrumb, "Mover para…", owner in the cancel confirmation

**Files:**
- Create: `src/detail/FolderBreadcrumb.vue`
- Modify: `src/detail/envelope-actions.ts`, `src/detail/action-menu.ts`, `src/detail/DetailView.vue`, `src/detail/DetailHeader.vue`, `src/detail/CancelDialog.vue`, `src/detail/SignersCard.vue`, `src/detail/envelope-meta.ts`, `src/envelope/EnvelopeView.vue`
- Modify: `l10n/pt_BR.json`, `l10n/pt_BR.js`
- Test: `src/detail/envelope-actions.spec.ts` (rewrite), `src/detail/DetailView.spec.ts`, `src/detail/SignersCard.spec.ts`

**Interfaces:**
- Consumes: `EnvelopeDetail.permissions`, `.folder`, `.ownerDisplayName` (Task 1), `canMoveEnvelope` (Task 2), `EnvelopeMoveDialog` (Task 7), `useFolders`.
- Produces:
  - `envelopeActions(envelope: EnvelopeDetail): EnvelopeAction[]` (no more `isOwner`/`isAdmin` arguments); new action `'move'`; `DialogAction` gains `'move'`.
  - `SignersCard` prop `canAct: boolean` (replaces `isOwner`).
  - `sentLabel()` names `envelope.ownerDisplayName`.

- [ ] **Step 1: Write the failing tests**

Replace `src/detail/envelope-actions.spec.ts` with:

```ts
import type { EnvelopePermissions, EnvelopeStatus } from '../api/types.ts'
import type { EnvelopeAction } from './envelope-actions.ts'

import { describe, expect, it } from 'vitest'
import { envelopeDetail, epochAt } from '../test-support/envelope-fixtures.ts'
import { envelopeActions, isLiveEnvelope } from './envelope-actions.ts'

const OWNER: EnvelopePermissions = { act: true, edit: true, remove: false }
const FOLDER_VIEWER: EnvelopePermissions = { act: false, edit: false, remove: false }
const NEXTCLOUD_ADMIN: EnvelopePermissions = { act: true, edit: false, remove: true }

interface ActionRow {
	status: EnvelopeStatus
	owner: EnvelopeAction[]
	viewer: EnvelopeAction[]
}

const ROWS: ActionRow[] = [
	{ status: 'draft', owner: [], viewer: [] },
	{ status: 'sending', owner: ['move'], viewer: [] },
	{ status: 'finalizing', owner: ['move'], viewer: [] },
	{ status: 'failed', owner: ['retry-send', 'reopen', 'discard', 'move'], viewer: [] },
	{ status: 'pending', owner: ['download-originals', 'activity-report', 'cancel', 'extend-deadline', 'move'], viewer: ['download-originals', 'activity-report'] },
	{ status: 'expired', owner: ['download-originals', 'activity-report', 'cancel', 'extend-deadline', 'move'], viewer: ['download-originals', 'activity-report'] },
	{ status: 'completed', owner: ['download-signed', 'download-originals', 'activity-report', 'move'], viewer: ['download-signed', 'download-originals', 'activity-report'] },
	{ status: 'refused', owner: ['download-originals', 'activity-report', 'move'], viewer: ['download-originals', 'activity-report'] },
	{ status: 'cancelled', owner: ['download-originals', 'activity-report', 'move'], viewer: ['download-originals', 'activity-report'] },
	{ status: 'archived_sandbox', owner: ['move'], viewer: [] },
]

const DELETABLE: EnvelopeStatus[] = ['failed', 'pending', 'expired', 'completed', 'refused', 'cancelled', 'archived_sandbox']

describe('envelopeActions', () => {
	describe.each(ROWS)('for a $status envelope', ({ status, owner, viewer }) => {
		it('gives the owner the status actions and the move', () => {
			expect(envelopeActions(envelopeDetail({ status, permissions: OWNER }))).toEqual(owner)
		})

		it('gives someone who only sees it the downloads', () => {
			expect(envelopeActions(envelopeDetail({ status, permissions: FOLDER_VIEWER }))).toEqual(viewer)
		})

		it('adds the delete for a Nextcloud admin when the status allows it', () => {
			const acting = owner.filter((action) => action !== 'retry-send')
			const expected: EnvelopeAction[] = DELETABLE.includes(status) ? [...acting, 'delete'] : acting

			expect(envelopeActions(envelopeDetail({ status, permissions: NEXTCLOUD_ADMIN }))).toEqual(status === 'draft' ? [] : expected)
		})
	})

	it('leaves sending again to the owner: it is a draft route', () => {
		const manager: EnvelopePermissions = { act: true, edit: false, remove: false }

		expect(envelopeActions(envelopeDetail({ status: 'failed', permissions: manager }))).toEqual(['reopen', 'discard', 'move'])
	})

	describe('while a cancellation is requested', () => {
		it.each<EnvelopeStatus>(['pending', 'expired'])('hides the cancel of a %s envelope', (status) => {
			const envelope = envelopeDetail({ status, cancelRequestedAt: epochAt('2026-10-01 17:00') })

			expect(envelopeActions(envelope)).toEqual(['download-originals', 'activity-report', 'extend-deadline', 'move'])
		})
	})

	describe('for an envelope that never reached ZapSign', () => {
		it('offers no original or activity report of a discarded envelope', () => {
			const envelope = envelopeDetail({ status: 'cancelled', sentAt: null, permissions: NEXTCLOUD_ADMIN })

			expect(envelopeActions(envelope)).toEqual(['move', 'delete'])
		})
	})
})

describe('isLiveEnvelope', () => {
	it.each<[EnvelopeStatus, boolean]>([
		['pending', true],
		['expired', true],
		['failed', false],
		['completed', false],
		['refused', false],
		['cancelled', false],
		['archived_sandbox', false],
	])('says whether signers of a %s envelope still get notified (%s)', (status, live) => {
		expect(isLiveEnvelope(status)).toBe(live)
	})
})
```

In `src/detail/DetailView.spec.ts`:
- add `vi.mock('../api/folders.ts', () => ({ listFolders: vi.fn(async () => []) }))`, and add `moveEnvelope: vi.fn()` to the `'../api/envelopes.ts'` mock if it is a factory listing functions;
- replace the test `names another owner by their user id` with:

```ts
		it('names another owner by their display name', async () => {
			vi.mocked(getEnvelope).mockResolvedValue(seedDetail({ ownerUid: 'maria', ownerDisplayName: 'Maria Souza', permissions: { act: false, edit: false, remove: false } }))

			const { wrapper } = await mountEnvelope()

			expect(metaLines(wrapper)).toContain('Enviado em 01/10/2026 por Maria Souza · Prazo 15/10/2026')
		})
```

- in `heads another owner's draft "Rascunho" for an administrator`, pass `ownerDisplayName: 'maria', permissions: { act: true, edit: false, remove: true }` in the `seedDetail({...})` call;
- in `describe('deleting as an administrator')`'s `beforeEach`, add `vi.mocked(getEnvelope).mockResolvedValue(seedDetail({ permissions: { act: true, edit: false, remove: true } }))`;
- where a test lists the overflow menu's items of a sent envelope, add `'Mover para…'` to the expected items in its place (after the status actions, before `Excluir`);
- append:

```ts
	describe('folders', () => {
		it('shows the folder path as links to each folder', async () => {
			vi.mocked(listFolders).mockResolvedValue([
				{ id: 1, title: 'Contratos', parentId: null, ownerUid: 'patrick', ownerDisplayName: 'Patrick Rezende', sortOrder: 0, right: 'manage' },
				{ id: 2, title: 'Fornecedores', parentId: 1, ownerUid: 'patrick', ownerDisplayName: 'Patrick Rezende', sortOrder: 0, right: 'manage' },
			])
			vi.mocked(getEnvelope).mockResolvedValue(seedDetail({ folderId: 2, folder: { id: 2, title: 'Fornecedores', path: [{ id: 1, title: 'Contratos' }] } }))

			const { wrapper } = await mountEnvelope()

			const breadcrumb = wrapper.find('nav[aria-label="Pasta"]')
			expect(breadcrumb.findAll('a').map((link) => [link.text(), link.attributes('href')])).toEqual([
				['Contratos', '/?folderId=1'],
				['Fornecedores', '/?folderId=2'],
			])
		})

		it('moves the envelope with "Mover para…"', async () => {
			const { wrapper } = await mountEnvelope()

			await click(wrapper, 'Mais ações')
			await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Mover para…')?.trigger('click')
			await settle()

			expect(openDialog(wrapper)?.text()).toContain('Mover "Contrato de prestação de serviços"')
		})
	})

	describe('cancelling someone else\'s envelope', () => {
		it('names the owner in the confirmation', async () => {
			vi.mocked(getEnvelope).mockResolvedValue(seedDetail({ ownerUid: 'maria', ownerDisplayName: 'Maria Souza' }))
			const { wrapper } = await mountEnvelope()

			await click(wrapper, 'Cancelar envelope')
			await settle()

			expect(openDialog(wrapper)?.text()).toContain('Este envelope é de Maria Souza.')
		})

		it('says nothing about the owner on the user\'s own envelope', async () => {
			const { wrapper } = await mountEnvelope()

			await click(wrapper, 'Cancelar envelope')
			await settle()

			expect(openDialog(wrapper)?.text()).not.toContain('Este envelope é de')
		})
	})
```

(import `listFolders` from `'../api/folders.ts'`. `click`, `settle`, `openDialog`, `metaLines`, `seedDetail` and `mountEnvelope` are the spec's existing helpers.)

In `src/detail/SignersCard.spec.ts`, rename the `mountCard` option and prop `isOwner` to `canAct` (`{ canAct = true, isPhone = false }`, `props: { envelope, canAct, isPhone }`, and `{ canAct: false }` at the call site).

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/detail src/envelope`
Expected: FAIL — `envelopeActions` still wants three arguments, no breadcrumb, no "Mover para…", no owner sentence.

- [ ] **Step 3: Write the actions and the breadcrumb**

In `src/detail/envelope-actions.ts`:
- add `| 'move'` to `EnvelopeAction` (before `| 'delete'`);
- add `import { canMoveEnvelope } from '../folders/envelope-moving.ts'`;
- replace the two doc comments and `envelopeActions()`:

```ts
/** Nextcloud admins delete any envelope that is not being sent or finalized (EnvelopeRemoval::BUSY_STATUSES); drafts are their owner's. */
const DELETABLE_STATUSES: readonly EnvelopeStatus[] = ['failed', 'pending', 'expired', 'completed', 'refused', 'cancelled', 'archived_sandbox']

/** Whoever sees the envelope downloads; everything else needs `permissions.act`. */
const DOWNLOAD_ACTIONS: readonly EnvelopeAction[] = ['download-signed', 'download-originals', 'activity-report']

/** Sending again is a draft route (`POST …/send`): the owner's alone. */
const OWNER_ACTIONS: readonly EnvelopeAction[] = ['retry-send']
```

```ts
function isAllowed(action: EnvelopeAction, envelope: EnvelopeDetail): boolean {
	if (isDownload(action)) {
		return true
	}
	return OWNER_ACTIONS.includes(action) ? envelope.permissions.edit : envelope.permissions.act
}

/** What the current user can do with the envelope, in display order, from the permissions the server sent. */
export function envelopeActions(envelope: EnvelopeDetail): EnvelopeAction[] {
	const allowed = STATUS_ACTIONS[envelope.status].filter((action) => isAvailableNow(action, envelope) && isAllowed(action, envelope))
	const moving: EnvelopeAction[] = envelope.status !== 'draft' && canMoveEnvelope(envelope) ? ['move'] : []
	const removing: EnvelopeAction[] = envelope.permissions.remove && DELETABLE_STATUSES.includes(envelope.status) ? ['delete'] : []
	return [...allowed, ...moving, ...removing]
}
```

In `src/detail/action-menu.ts`:
- `export type DialogAction = 'cancel' | 'extend-deadline' | 'move' | 'delete'`;
- `const DIALOG_ACTIONS: readonly string[] = ['cancel', 'extend-deadline', 'move', 'delete'] satisfies DialogAction[]`;
- add to `MENU_ITEMS` before `delete`: `move: () => [{ id: 'move', label: t(APP_ID, 'Move to…') }],`

`src/detail/FolderBreadcrumb.vue`:

```vue
<script setup lang="ts">
import type { EnvelopeFolderPlacement } from '../api/types.ts'

import { t } from '@nextcloud/l10n'
import { Folder } from 'lucide-vue-next'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { APP_ID } from '../app-config.ts'
import { useFolders } from '../folders/use-folders.ts'
import { ICON_SIZE_LINK, ICON_STROKE_INLINE } from '../icon-sizes.ts'
import { folderQuery, ROUTE_NAMES } from '../router.ts'

const props = defineProps<{
	placement: EnvelopeFolderPlacement
}>()

const folders = useFolders()
const visibleIds = computed(() => new Set(folders.value.map((folder) => folder.id)))
/** The path, then the folder itself; a folder the user cannot open is named without a link. */
const steps = computed(() => [...props.placement.path, { id: props.placement.id, title: props.placement.title }]
	.map((step) => ({ ...step, isLinked: visibleIds.value.has(step.id) })))
</script>

<template>
	<nav class="folder-breadcrumb" :aria-label="t(APP_ID, 'Folder')">
		<Folder :size="ICON_SIZE_LINK" :stroke-width="ICON_STROKE_INLINE" aria-hidden="true" />
		<ol class="folder-breadcrumb__steps">
			<li v-for="step in steps" :key="step.id" class="folder-breadcrumb__step">
				<RouterLink v-if="step.isLinked" class="folder-breadcrumb__link" :to="{ name: ROUTE_NAMES.dashboard, query: folderQuery(step.id) }">
					{{ step.title }}
				</RouterLink>
				<span v-else>{{ step.title }}</span>
			</li>
		</ol>
	</nav>
</template>

<style scoped>
.folder-breadcrumb {
	display: flex;
	align-items: center;
	gap: 6px;
	color: var(--av-muted);
	font-size: var(--av-text-meta);
}

.folder-breadcrumb__steps {
	display: flex;
	flex-wrap: wrap;
	margin: 0;
	padding: 0;
	list-style: none;
}

/* The separator is decoration: the list already tells the steps apart. */
.folder-breadcrumb__step + .folder-breadcrumb__step::before {
	content: "/" / "";
	margin: 0 6px;
}

.folder-breadcrumb__link {
	color: inherit;
}
</style>
```

- [ ] **Step 4: Wire the page**

In `src/detail/DetailView.vue`:
- remove `appConfig` from the `../app-config.ts` import (keep `APP_ID`) and delete `const { isAdmin } = appConfig()`;
- replace the `actions` computed with `const actions = computed(() => (envelope.value === undefined ? [] : envelopeActions(envelope.value)))`;
- keep `isOwner` (DocumentsCard opens the signed copy in the owner's Drive only);
- replace both `<SignersCard … :isOwner="isOwner" …/>` with `:canAct="envelope.permissions.act"`;
- add `import EnvelopeMoveDialog from '../folders/EnvelopeMoveDialog.vue'` and, after `<DeleteDialog …/>`:

```vue
		<EnvelopeMoveDialog
			v-if="actions.includes('move') || openDialog === 'move'"
			:open="openDialog === 'move'"
			:envelope="envelope"
			@close="onCloseDialog" />
```

In `src/detail/DetailHeader.vue`:
- add `import FolderBreadcrumb from './FolderBreadcrumb.vue'`;
- in the phone header, insert `<FolderBreadcrumb v-if="envelope.folder !== null" :placement="envelope.folder" />` before the `<h1>`;
- in the desktop header, insert the same line inside `.detail-header__heading` before `.detail-header__title-row`.

In `src/detail/SignersCard.vue`: rename the prop `isOwner: boolean` to `canAct: boolean`, and replace every `props.isOwner` with `props.canAct` and the template's `:canCorrectEmail="isOwner"` with `:canCorrectEmail="canAct"`.

In `src/detail/envelope-meta.ts`: delete `ownerName()` and the `getCurrentUser` import, and in `sentLabel()` replace `const owner = ownerName(envelope.ownerUid)` with `const owner = envelope.ownerDisplayName`.

In `src/detail/CancelDialog.vue`:
- add `import { currentUid } from '../current-user.ts'` and `import { PLAIN_TEXT } from '../presentation/plain-text.ts'`;
- add `const ownerNote = computed(() => (props.envelope.ownerUid === currentUid() ? null : t(APP_ID, 'This envelope belongs to {owner}.', { owner: props.envelope.ownerDisplayName }, undefined, PLAIN_TEXT)))`;
- insert before the warning paragraph: `<p v-if="ownerNote !== null" class="cancel-dialog__owner">{{ ownerNote }}</p>` and the style `.cancel-dialog__owner { margin: 0; font-weight: bold; }`.

In `src/envelope/EnvelopeView.vue`: replace the `isEditableDraft` body with `return envelope?.status === 'draft' && envelope.permissions.edit` (update its comment to "Whoever may edit the draft (its owner) gets the wizard; anyone else sees its detail.") and remove the now unused `currentUid` import.

Add to both l10n files:

```json
    "This envelope belongs to {owner}." : "Este envelope é de {owner}."
```

- [ ] **Step 5: Run them and watch them pass**

Run: `npx vitest run src/detail src/envelope src/wizard`
Expected: PASS.

- [ ] **Step 6: Run the gates and commit**

Run each: `npm run typecheck`, `npm run lint`, `npm test`.

```bash
git add src l10n
git commit -m "feat(detail): act from server permissions, show the folder path, name the owner on cancel"
```

---

### Task 10: Release 0.6.0 and pin it in the Avuz image

**Files:**
- Modify: `appinfo/info.xml` (version), built `js/`, `css/` (and `dist/` when the build changes it)
- avuz-server: the `apps/assinaturas` submodule pointer

**Interfaces:**
- Consumes: everything above and Plan 8a.
- Produces: app `0.6.0` on the app's `main`; avuz-server pinned to it.

- [ ] **Step 1: White-label and copy check**

Run: `grep -rni "zapsign" src --include=*.vue --include=*.ts | grep -v "spec.ts" | grep -i "t(APP_ID\|n(APP_ID"`
Expected: no output. `npm test` also runs the white-label guard in `src/l10n.spec.ts`.

- [ ] **Step 2: Bump the version**

In `appinfo/info.xml`, set `<version>0.6.0</version>`.

Run the reset guard, then: `tests/env/php.sh occ upgrade`
Expected: it ends with `Update successful` (the migration was executed in Plan 8a and is skipped; the repair step `EnsureAppGroups` runs).

- [ ] **Step 3: Run every gate, each on its own**

Run, one at a time, each must exit 0:
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `composer run lint`
- `tests/env/phpunit.sh` (after the reset guard)

- [ ] **Step 4: Browser check (local preview)**

With the local preview (`tests/env/serve.sh`, see the app README), log in as a member, a second member, a manager (`assinaturas-admins`) and `admin`, and check, at 1280 px and at 375 px:
- the sidebar shows Meus envelopes, Compartilhados comigo, (Toda a empresa, Uso for the manager and admin), Pastas; on the phone the tree is in the drawer;
- create a folder and a subfolder, share the parent with the second member as Ver, send an envelope into the subfolder: the second member sees it under Compartilhados comigo and in the subfolder, cannot cancel it, can download; change the share to Editar: the second member can remind and cancel, and the cancel dialog says "Este envelope é de …";
- drag an envelope row onto a folder, and do the same with "Mover para…" using the keyboard only (Tab to the row menu, Enter, arrows, Enter);
- the manager transfers a folder; the admin deletes it: its envelopes appear in the parent;
- the wizard's "Pasta" starts on the folder the draft was started from.

Report anything that differs; fix it in this task with a test first.

- [ ] **Step 5: Commit the release**

```bash
git add appinfo/info.xml js css
git status --short dist | grep -q . && git add dist
git commit -m "chore: release 0.6.0 (folders and managers)"
```

- [ ] **Step 6: Merge and pin**

Finish the branch with superpowers:finishing-a-development-branch (merge `plan-8-folders-managers` into the app's `main` and push, with Patrick's OK).

Then in the avuz-server worktree `/Users/patrickrezende/work/avuz/avuz-server/.claude/worktrees/avuzconecta-signature-feasibility-59ecdd`:

```bash
git -C apps/assinaturas fetch origin main
git -C apps/assinaturas checkout origin/main
grep -o '<version>[^<]*' apps/assinaturas/appinfo/info.xml
```

Expected: `<version>0.6.0`.

```bash
git add apps/assinaturas
git commit -m "chore: pin Assinaturas 0.6.0 (folders and managers)"
```

Building and deploying the image (staging or production) is not part of this plan: staging runs on Patrick's go, production is gated per action.

---

## Self-review notes

- Spec coverage (screens half): sidebar "Meus envelopes", "Compartilhados comigo", "Toda a empresa" (managers/admins), folder tree with folders the user sees (Tasks 4, 6); folder view with subfolders first, then envelopes with filters and search (Task 3); folder ⋮ menu Nova subpasta / Renomear / Compartilhar / Mover / Transferir (managers) / Excluir, each only with its right (Tasks 2, 6); share dialog like Deck's (Task 5); drag and drop of envelopes and folders with the keyboard "Mover para…" (Tasks 6, 7); wizard "Pasta" defaulting to the viewed folder (Tasks 3, 4, 8); envelope breadcrumb and "Mover para…" (Task 9); phone drawer (Task 6 test; the drawer already hosts the navigation); cancel confirmation names the owner (Task 9); managers' read-only usage panel (Task 4); white label and pt_BR (every task, Task 10 check). Access rules, data and the image side are Plan 8a.
- Vitest coverage asked by the spec: sidebar scopes (AppFrame.spec, navigation-target.spec), tree drag and drop with keyboard alternative (FolderTree.spec, DashboardView.spec), share dialog (FolderShareDialog.spec), "Pasta" field (EnvelopeFolderField.spec), cancel confirmation naming the owner (DetailView.spec).
- Names used across tasks: `EnvelopeFolder`, `FolderRight`, `useFolders`, `refreshFolderViews`, `useFolderDialogMutation`, `FolderPickerDialog`, `EnvelopeMoveDialog`, `canMoveEnvelope`, `folderQuery`, `SHARED_SCOPE_QUERY`, `COMPANY_SCOPE_QUERY`, `ROUTE_NAMES.usage`, `QUERY_KEYS.{folders, folderAccess, sharees, usage, allEnvelopeDetails}`, `DRAFT_CHANGES 'folder'`, `AppConfig.canSeeAll`.
