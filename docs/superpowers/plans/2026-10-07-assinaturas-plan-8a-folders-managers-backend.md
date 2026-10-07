# Assinaturas Plan 8a: folders and managers (backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Assinaturas app nested, shareable folders and a company-manager role, with one access service that every envelope and folder route goes through.

**Architecture:** Two new tables (`assinaturas_folders`, `assinaturas_folder_acl`) and a nullable `assinaturas_envelopes.folder_id`. `Roles` answers group questions (member, manager, Nextcloud admin). `FolderAccess` works out each user's highest right per folder (owner, own row, group row, inherited from an ancestor; managers and admins manage all). `AccessPolicy::canSee/canAct/canEdit` build on both, and `EnvelopeAccess` applies them to every envelope route. `FolderTree`, `FolderSharing` and `EnvelopeFiling` hold the folder operations behind JSON routes. The Avuz image calls a new `occ assinaturas:groups:ensure` on every boot.

**Tech Stack:** PHP 8.3, Nextcloud 33 OCP (QBMapper, IRepairStep, IEventListener, Symfony Console), PHPUnit 9.6 in the `avuzconecta:latest` test container; bash 3.2 + 5 for the image's boot script.

**Spec:** `docs/superpowers/specs/2026-10-07-assinaturas-folders-and-managers-design.md` (avuz-server repo).
**Companion plan:** `2026-10-07-assinaturas-plan-8b-folders-managers-frontend.md` consumes the JSON API this plan documents in `docs/api.md` (Task 8). Plans 8a and 8b ship together as app `0.6.0`; the version bump is the last task of 8b.

## Global Constraints

- App repo: `/Users/patrickrezende/work/avuz/assinaturas`. Branch off app `main` (after Plan 7 = `0.5.0` is merged): `git switch -c plan-8-folders-managers main`. Plan 8b continues on the same branch.
- App version bump in the last task of Plan 8b: `appinfo/info.xml` → `0.6.0` (runs after Plan 7 = 0.5.0). Migrations named like the existing ones (`VersionXXXXXXDate2026…`). This plan's migration is `Version000600Date20261007000000`. Until the bump, apply it to the local test DB with `tests/env/php.sh occ migrations:execute assinaturas 000600Date20261007000000` (Task 1); `occ upgrade` at the bump then skips it.
- Gates, each run separately, all exit 0: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` (commit built `js/` and `css/`); `composer run lint`; `tests/env/phpunit.sh` (it auto-runs `tests/env/reset.sh` when the local `avuzconecta:latest` image id differs from `~/.assinaturas-test-image-id` — never rebuild that image during the plan, and stop and ask if a reset would happen).
- Before every `tests/env/phpunit.sh` run, check that no reset would happen; if it prints `DIFFERENT`, stop and ask Patrick:
  ```bash
  [ "$(cat ~/.assinaturas-test-image-id)" = "$(docker image inspect avuzconecta:latest --format '{{.Id}}')" ] && echo same || echo DIFFERENT
  ```
- Backend tasks in this plan touch no `src/`, so their gates are `composer run lint` and `tests/env/phpunit.sh` (filtered while iterating, the whole suite at the end of each task). `npm test` must stay green too: `src/l10n.spec.ts` scans `lib/**/*.php` for translated strings, and this plan adds none.
- TypeScript: no `any`, almost no `as`, named exports, no barrel files, async/await, hash maps over switch, named constants, early returns, descriptive names; TanStack Vue Query with query keys from an enum/factory.
- PHP: query builder only (no raw SQL), typed, early returns; every envelope endpoint goes through AccessPolicy (one test per endpoint proving a non-entitled user gets 403/404).
- Tests in 3rd person, never "should"; behaviour not implementation; TDD failing test first.
- WCAG 2.x AA: drag and drop always has a keyboard alternative ("Mover para…"); tree is an accessible tree or list.
- White label: no user-facing string names ZapSign. pt_BR copy natural; l10n via the repo's process.
- Avuz image side (separate repo `/Users/patrickrezende/work/avuz/avuz-server`): if the managers group needs anything at boot beyond the app's repair step, add a task for `docker/lib-assinaturas.sh` with a bash test in `docker/tests` (bash 3.2 + 5); also update `docs/assinaturas-tenant-runbook.md` (managers group, deleted-group caveat). → Task 9: repair steps only run on install and on an app version change, so a deleted group would not come back on the next boot without it.
- Commits: conventional messages, NO AI attribution lines. Branch off app `main`.
- PHP style of the repo: tabs, `declare(strict_types=1);`, `final` classes, constructor promotion, one docblock sentence saying why when the name is not enough. Entities follow `lib/Db/Envelope.php` (a `FIELD_TYPES` map, every field marked updated in the constructor).
- Error bodies are `{"error": "<code>", "message": "<English for developers>"}`; the UI maps codes to pt_BR in Plan 8b.

## Access model (shared by every task)

| Check | Rule |
|---|---|
| `Roles::canUseApp(u)` | Nextcloud admin, or member of `assinaturas`, or member of `assinaturas-admins` |
| `Roles::canSeeAll(u)` | Nextcloud admin, or member of `assinaturas-admins` |
| `FolderAccess::rightOn(f, u)` | `None` when `u` cannot use the app; `Manage` on every folder for `canSeeAll`; else the highest of: `Manage` as owner, every access-list row naming `u` or one of `u`'s groups, on `f` or any ancestor |
| `AccessPolicy::canSee(e, u)` | owner, or `canSeeAll`, or (`e` not a draft and `rightOn(e.folder, u) ≥ View`) |
| `AccessPolicy::canAct(e, u)` | `canEdit`, or `canSeeAll`, or (`e` not a draft and `rightOn(e.folder, u) ≥ Edit`) |
| `AccessPolicy::canEdit(e, u)` | owner who can use the app (drafts in the wizard; unchanged) |
| Admin routes (`/admin/*`) | Nextcloud admins only (`isNextcloudAdmin`) — managers do not get them |

Folder operations: create top-level = can use the app; create subfolder, rename, file envelopes in or out = `Edit`; access list = `Share` (grant at most your own right; touch only entries at or below it); move folder = `Manage` on it and `Edit` on the target; delete = `Manage`; transfer ownership = `canSeeAll`. A folder the user cannot view answers 404 `folder_not_found`; a visible one without the right answers 403 `forbidden`.

## File structure

| File | Responsibility |
|---|---|
| `lib/Migration/Version000600Date20261007000000.php` | folders, access list, `envelopes.folder_id` |
| `lib/Db/EnvelopeFolder.php`, `EnvelopeFolderMapper.php` | folder rows |
| `lib/Db/FolderAcl.php`, `FolderAclMapper.php` | access-list rows (`perm_edit/share/manage`; View = the row exists) |
| `lib/Db/EnvelopeScope.php`, `EnvelopeVisibility.php` | dashboard scopes and the SQL visibility they turn into |
| `lib/Folder/FolderRight.php`, `ParticipantType.php` | enums |
| `lib/Folder/FolderAccess.php` | rights per user and folder; recipients with Edit |
| `lib/Folder/FolderPaths.php` | the folder path a viewer may see |
| `lib/Folder/FolderRejected.php` | folder refusals with our codes |
| `lib/Folder/FolderTree.php` | create / rename / move / delete / transfer |
| `lib/Folder/FolderSharing.php` | access list and the share picker |
| `lib/Folder/EnvelopeFiling.php` | file an envelope in a folder |
| `lib/Folder/FolderJson.php` | folder and access-entry JSON shapes |
| `lib/Access/Roles.php`, `ManagersGroup.php`, `AppGroups.php` | groups and roles |
| `lib/Access/AccessPolicy.php`, `EnvelopeAccess.php` | the one access function per check |
| `lib/Migration/EnsureAppGroups.php` (replaces `EnsureSignersGroup.php`) | repair step |
| `lib/Command/EnsureGroups.php` | `occ assinaturas:groups:ensure` |
| `lib/Controller/FolderController.php`, `FolderSharingController.php`, `UsageController.php` | routes |
| `lib/Listener/ParticipantDeletedListener.php` | drop access rows of deleted users and groups |

---

### Task 1: Schema, entities and mappers

**Files:**
- Create: `lib/Migration/Version000600Date20261007000000.php`
- Create: `lib/Folder/FolderRight.php`, `lib/Folder/ParticipantType.php`
- Create: `lib/Db/EnvelopeFolder.php`, `lib/Db/EnvelopeFolderMapper.php`, `lib/Db/FolderAcl.php`, `lib/Db/FolderAclMapper.php`
- Modify: `lib/Db/Envelope.php` (add `folderId`)
- Modify: `lib/Db/EnvelopeMapper.php` (add `assignFolder`, `refileFolder`)
- Create: `tests/Integration/TestFolders.php`
- Test: `tests/Unit/Folder/FolderRightTest.php`, `tests/Integration/Db/EnvelopeFolderMapperTest.php`, `tests/Integration/Db/FolderAclMapperTest.php`, `tests/Integration/Db/EnvelopeMapperFolderTest.php`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `enum FolderRight: int { None=0; View=1; Edit=2; Share=3; Manage=4 }` with `atLeast(FolderRight $other): bool`, `static highest(FolderRight ...$rights): FolderRight`, `static fromFlags(bool $edit, bool $share, bool $manage): FolderRight`, `flags(): array{edit: bool, share: bool, manage: bool}`, `apiName(): string` (`none|view|edit|share|manage`), `static grantable(string $apiName): ?FolderRight` (view..manage only).
  - `enum ParticipantType: string { User='user'; Group='group' }`.
  - `EnvelopeFolder` getters/setters: `title`, `parentId ?int`, `ownerUid`, `sortOrder`, `createdAt`, `updatedAt`.
  - `EnvelopeFolderMapper`: `TABLE`, `findById(int): EnvelopeFolder` (throws `DoesNotExistException`), `findAllById(): array<int, EnvelopeFolder>` (display order), `nextSortOrder(?int $parentId): int`, `reparentChildren(int $parentId, ?int $newParentId, int $now): void`.
  - `FolderAcl`: `folderId`, `participantType`, `participantId`, `permEdit/permShare/permManage`, `right(): FolderRight`, `grant(FolderRight): void`, `participantTypeValue(): ParticipantType`.
  - `FolderAclMapper`: `TABLE`, `findById(int)`, `findByFolder(int): list<FolderAcl>`, `findByFolders(list<int>): list<FolderAcl>`, `findForParticipant(string $userId, list<string> $groupIds): list<FolderAcl>`, `findOne(int $folderId, ParticipantType, string): ?FolderAcl`, `deleteByFolder(int)`, `deleteByParticipant(ParticipantType, string)`.
  - `Envelope::getFolderId(): ?int`.
  - `EnvelopeMapper::assignFolder(int $envelopeId, ?int $folderId): void`, `EnvelopeMapper::refileFolder(int $folderId, ?int $newFolderId): void`.
  - Test trait `TestFolders`: `folder(string $ownerUid, string $title = 'Contratos', ?EnvelopeFolder $parent = null): EnvelopeFolder`, `grant(EnvelopeFolder, ParticipantType, string $participantId, FolderRight): FolderAcl`, `deleteFoldersOf(list<string> $ownerUids): void`.

- [ ] **Step 1: Write the failing unit test for `FolderRight`**

`tests/Unit/Folder/FolderRightTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\Folder;

use OCA\Assinaturas\Folder\FolderRight;
use PHPUnit\Framework\TestCase;

final class FolderRightTest extends TestCase {
	public function testOrdersTheRightsFromNoneToManage(): void {
		$this->assertTrue(FolderRight::Manage->atLeast(FolderRight::Share));
		$this->assertTrue(FolderRight::Edit->atLeast(FolderRight::Edit));
		$this->assertFalse(FolderRight::View->atLeast(FolderRight::Edit));
		$this->assertFalse(FolderRight::None->atLeast(FolderRight::View));
	}

	/** @return array<string, array{bool, bool, bool, FolderRight}> */
	public static function flagCombinations(): array {
		return [
			'a row without flags' => [false, false, false, FolderRight::View],
			'edit' => [true, false, false, FolderRight::Edit],
			'edit and share' => [true, true, false, FolderRight::Share],
			'every flag' => [true, true, true, FolderRight::Manage],
			'manage alone' => [false, false, true, FolderRight::Manage],
		];
	}

	/** @dataProvider flagCombinations */
	public function testReadsTheRightAnAccessRowGrants(bool $edit, bool $share, bool $manage, FolderRight $expected): void {
		$this->assertSame($expected, FolderRight::fromFlags($edit, $share, $manage));
	}

	public function testStoresEachRightAsTheFlagsItIncludes(): void {
		$this->assertSame(['edit' => false, 'share' => false, 'manage' => false], FolderRight::View->flags());
		$this->assertSame(['edit' => true, 'share' => true, 'manage' => false], FolderRight::Share->flags());
	}

	public function testRoundTripsEveryGrantableRightThroughItsFlags(): void {
		foreach ([FolderRight::View, FolderRight::Edit, FolderRight::Share, FolderRight::Manage] as $right) {
			$flags = $right->flags();
			$this->assertSame($right, FolderRight::fromFlags($flags['edit'], $flags['share'], $flags['manage']));
		}
	}

	public function testPicksTheHighestRight(): void {
		$this->assertSame(FolderRight::Edit, FolderRight::highest(FolderRight::View, FolderRight::Edit, FolderRight::None));
		$this->assertSame(FolderRight::None, FolderRight::highest());
	}

	public function testNamesTheRightsForTheApi(): void {
		$this->assertSame('share', FolderRight::Share->apiName());
		$this->assertSame(FolderRight::Edit, FolderRight::grantable('edit'));
		$this->assertNull(FolderRight::grantable('none'));
		$this->assertNull(FolderRight::grantable('owner'));
	}
}
```

- [ ] **Step 2: Run it and watch it fail**

Run the reset guard from Global Constraints, then: `tests/env/phpunit.sh --filter FolderRightTest`
Expected: FAIL with `Error: Class "OCA\Assinaturas\Folder\FolderRight" not found`.

- [ ] **Step 3: Write the enums**

`lib/Folder/FolderRight.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Folder;

/** What a person may do on a folder and on everything below it. Each right includes the ones before it. */
enum FolderRight: int {
	case None = 0;
	case View = 1;
	case Edit = 2;
	case Share = 3;
	case Manage = 4;

	public function atLeast(self $other): bool {
		return $this->value >= $other->value;
	}

	public static function highest(self ...$rights): self {
		$values = array_map(fn (self $right): int => $right->value, $rights);
		return $values === [] ? self::None : self::from(max($values));
	}

	/** The right an access-list row grants. The row itself grants View. */
	public static function fromFlags(bool $edit, bool $share, bool $manage): self {
		$granted = array_keys(array_filter([self::Manage->value => $manage, self::Share->value => $share, self::Edit->value => $edit]));
		return $granted === [] ? self::View : self::from(max($granted));
	}

	/** @return array{edit: bool, share: bool, manage: bool} the access-list flags that store this right */
	public function flags(): array {
		return ['edit' => $this->atLeast(self::Edit), 'share' => $this->atLeast(self::Share), 'manage' => $this->atLeast(self::Manage)];
	}

	public function apiName(): string {
		return strtolower($this->name);
	}

	/** A right someone can be given (view to manage), from its API name; null for anything else. */
	public static function grantable(string $apiName): ?self {
		foreach (self::cases() as $right) {
			if ($right !== self::None && $right->apiName() === $apiName) {
				return $right;
			}
		}
		return null;
	}
}
```

`lib/Folder/ParticipantType.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Folder;

/** Who an access-list row names. */
enum ParticipantType: string {
	case User = 'user';
	case Group = 'group';
}
```

- [ ] **Step 4: Run the unit test and watch it pass**

Run: `tests/env/phpunit.sh --filter FolderRightTest`
Expected: `OK` (10 tests).

- [ ] **Step 5: Write the test trait and the failing mapper tests**

`tests/Integration/TestFolders.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration;

use OCA\Assinaturas\Db\EnvelopeFolder;
use OCA\Assinaturas\Db\EnvelopeFolderMapper;
use OCA\Assinaturas\Db\FolderAcl;
use OCA\Assinaturas\Db\FolderAclMapper;
use OCA\Assinaturas\Folder\FolderRight;
use OCA\Assinaturas\Folder\ParticipantType;
use OCP\Server;

/** Folders and access rows written straight to the tables, for tests. Call deleteFoldersOf() in tearDown. */
trait TestFolders {
	private function folder(string $ownerUid, string $title = 'Contratos', ?EnvelopeFolder $parent = null): EnvelopeFolder {
		$mapper = Server::get(EnvelopeFolderMapper::class);
		$folder = new EnvelopeFolder();
		$folder->setTitle($title);
		$folder->setOwnerUid($ownerUid);
		$folder->setParentId($parent?->getId());
		$folder->setSortOrder($mapper->nextSortOrder($parent?->getId()));
		$folder->setCreatedAt(1_790_000_000);
		$folder->setUpdatedAt(1_790_000_000);
		return $mapper->insert($folder);
	}

	private function grant(EnvelopeFolder $folder, ParticipantType $type, string $participantId, FolderRight $right): FolderAcl {
		$entry = new FolderAcl();
		$entry->setFolderId($folder->getId());
		$entry->setParticipantType($type->value);
		$entry->setParticipantId($participantId);
		$entry->grant($right);
		return Server::get(FolderAclMapper::class)->insert($entry);
	}

	/** @param list<string> $ownerUids */
	private function deleteFoldersOf(array $ownerUids): void {
		$folderMapper = Server::get(EnvelopeFolderMapper::class);
		$aclMapper = Server::get(FolderAclMapper::class);
		foreach ($folderMapper->findAllById() as $folder) {
			if (!in_array($folder->getOwnerUid(), $ownerUids, true)) {
				continue;
			}
			$aclMapper->deleteByFolder($folder->getId());
			$folderMapper->delete($folder);
		}
	}
}
```

`tests/Integration/Db/EnvelopeFolderMapperTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Db;

use OCA\Assinaturas\Db\EnvelopeFolder;
use OCA\Assinaturas\Db\EnvelopeFolderMapper;
use OCA\Assinaturas\Tests\Integration\TestFolders;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class EnvelopeFolderMapperTest extends TestCase {
	use TestUsers;
	use TestFolders;

	private EnvelopeFolderMapper $mapper;
	private string $owner;

	protected function setUp(): void {
		parent::setUp();
		$this->mapper = Server::get(EnvelopeFolderMapper::class);
		$this->owner = $this->createUser();
	}

	protected function tearDown(): void {
		$this->deleteFoldersOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testListsFoldersBySortOrderThenTitle(): void {
		$parent = $this->folder($this->owner, 'Raiz');
		$second = $this->folder($this->owner, 'B', $parent);
		$first = $this->folder($this->owner, 'A', $parent);
		$first->setSortOrder($second->getSortOrder());
		$this->mapper->update($first);

		$titles = array_map(
			fn (EnvelopeFolder $folder): string => $folder->getTitle(),
			array_values(array_filter($this->mapper->findAllById(), fn (EnvelopeFolder $folder): bool => $folder->getParentId() === $parent->getId())),
		);

		$this->assertSame(['A', 'B'], $titles);
	}

	public function testKeysEveryFolderByItsId(): void {
		$folder = $this->folder($this->owner);

		$this->assertSame($folder->getTitle(), $this->mapper->findAllById()[$folder->getId()]->getTitle());
	}

	public function testStartsEachParentsSortOrderAfterItsLastChild(): void {
		$parent = $this->folder($this->owner, 'Raiz');
		$this->folder($this->owner, 'A', $parent);
		$this->folder($this->owner, 'B', $parent);

		$this->assertSame(2, $this->mapper->nextSortOrder($parent->getId()));
		$this->assertSame(0, $this->mapper->nextSortOrder($this->folder($this->owner, 'Vazia')->getId()));
	}

	public function testMovesEveryChildOfAFolderToAnotherParent(): void {
		$grandparent = $this->folder($this->owner, 'Avó');
		$parent = $this->folder($this->owner, 'Mãe', $grandparent);
		$child = $this->folder($this->owner, 'Filha', $parent);

		$this->mapper->reparentChildren($parent->getId(), $grandparent->getId(), 1_790_000_100);
		$this->mapper->reparentChildren($grandparent->getId(), null, 1_790_000_200);

		$this->assertSame($grandparent->getId(), $this->mapper->findById($child->getId())->getParentId());
		$this->assertNull($this->mapper->findById($parent->getId())->getParentId());
		$this->assertSame(1_790_000_200, $this->mapper->findById($parent->getId())->getUpdatedAt());
	}
}
```

`tests/Integration/Db/FolderAclMapperTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Db;

use OCA\Assinaturas\Db\FolderAcl;
use OCA\Assinaturas\Db\FolderAclMapper;
use OCA\Assinaturas\Folder\FolderRight;
use OCA\Assinaturas\Folder\ParticipantType;
use OCA\Assinaturas\Tests\Integration\TestFolders;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class FolderAclMapperTest extends TestCase {
	use TestUsers;
	use TestFolders;

	private FolderAclMapper $mapper;
	private string $owner;

	protected function setUp(): void {
		parent::setUp();
		$this->mapper = Server::get(FolderAclMapper::class);
		$this->owner = $this->createUser();
	}

	protected function tearDown(): void {
		$this->deleteFoldersOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testFindsTheRowsThatNameTheUserOrOneOfTheirGroups(): void {
		$folder = $this->folder($this->owner);
		$own = $this->grant($folder, ParticipantType::User, 'joao', FolderRight::View);
		$group = $this->grant($folder, ParticipantType::Group, 'financeiro', FolderRight::Edit);
		$this->grant($folder, ParticipantType::Group, 'juridico', FolderRight::Edit);
		$this->grant($folder, ParticipantType::User, 'maria', FolderRight::Edit);

		$found = self::ids($this->mapper->findForParticipant('joao', ['financeiro']));

		$this->assertEqualsCanonicalizing([$own->getId(), $group->getId()], $found);
	}

	public function testFindsOnlyTheUsersOwnRowsWithoutGroups(): void {
		$folder = $this->folder($this->owner);
		$own = $this->grant($folder, ParticipantType::User, 'joao', FolderRight::View);
		$this->grant($folder, ParticipantType::Group, 'joao', FolderRight::Edit);

		$this->assertSame([$own->getId()], self::ids($this->mapper->findForParticipant('joao', [])));
	}

	public function testFindsOneRowByFolderAndParticipant(): void {
		$folder = $this->folder($this->owner);
		$entry = $this->grant($folder, ParticipantType::Group, 'financeiro', FolderRight::Share);

		$this->assertSame($entry->getId(), $this->mapper->findOne($folder->getId(), ParticipantType::Group, 'financeiro')?->getId());
		$this->assertNull($this->mapper->findOne($folder->getId(), ParticipantType::User, 'financeiro'));
	}

	public function testReadsTheRightARowStores(): void {
		$folder = $this->folder($this->owner);
		$entry = $this->grant($folder, ParticipantType::User, 'joao', FolderRight::Share);

		$this->assertSame(FolderRight::Share, $this->mapper->findById($entry->getId())->right());
	}

	public function testFindsTheRowsOfSeveralFolders(): void {
		$first = $this->folder($this->owner, 'A');
		$second = $this->folder($this->owner, 'B');
		$third = $this->folder($this->owner, 'C');
		$inFirst = $this->grant($first, ParticipantType::User, 'joao', FolderRight::View);
		$inSecond = $this->grant($second, ParticipantType::User, 'joao', FolderRight::View);
		$this->grant($third, ParticipantType::User, 'joao', FolderRight::View);

		$this->assertEqualsCanonicalizing([$inFirst->getId(), $inSecond->getId()], self::ids($this->mapper->findByFolders([$first->getId(), $second->getId()])));
		$this->assertSame([], $this->mapper->findByFolders([]));
	}

	public function testDeletesEveryRowOfAParticipant(): void {
		$first = $this->folder($this->owner, 'A');
		$second = $this->folder($this->owner, 'B');
		$this->grant($first, ParticipantType::User, 'joao', FolderRight::View);
		$this->grant($second, ParticipantType::User, 'joao', FolderRight::Edit);
		$kept = $this->grant($second, ParticipantType::Group, 'joao', FolderRight::Edit);

		$this->mapper->deleteByParticipant(ParticipantType::User, 'joao');

		$this->assertSame([], $this->mapper->findByFolder($first->getId()));
		$this->assertSame([$kept->getId()], self::ids($this->mapper->findByFolder($second->getId())));
	}

	/**
	 * @param list<FolderAcl> $entries
	 * @return list<int>
	 */
	private static function ids(array $entries): array {
		return array_map(fn (FolderAcl $entry): int => $entry->getId(), $entries);
	}
}
```

`tests/Integration/Db/EnvelopeMapperFolderTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Db;

use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestFolders;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class EnvelopeMapperFolderTest extends TestCase {
	use TestUsers;
	use TestFolders;
	use EnvelopeCleanup;

	private EnvelopeMapper $mapper;
	private string $owner;

	protected function setUp(): void {
		parent::setUp();
		$this->mapper = Server::get(EnvelopeMapper::class);
		$this->owner = $this->createUser();
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteFoldersOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testFilesAnEnvelopeInAFolderWithoutTouchingItsStatus(): void {
		$envelope = $this->draft('Contrato');
		$folder = $this->folder($this->owner);

		$this->mapper->assignFolder($envelope->getId(), $folder->getId());

		$filed = $this->mapper->findById($envelope->getId());
		$this->assertSame($folder->getId(), $filed->getFolderId());
		$this->assertSame(EnvelopeStatus::Draft, $filed->statusValue());
		$this->assertSame($envelope->getUpdatedAt(), $filed->getUpdatedAt());
	}

	public function testTakesAnEnvelopeOutOfEveryFolder(): void {
		$envelope = $this->draft('Contrato');
		$this->mapper->assignFolder($envelope->getId(), $this->folder($this->owner)->getId());

		$this->mapper->assignFolder($envelope->getId(), null);

		$this->assertNull($this->mapper->findById($envelope->getId())->getFolderId());
	}

	public function testHandsEveryEnvelopeOfAFolderToAnotherFolder(): void {
		$from = $this->folder($this->owner, 'Antiga');
		$to = $this->folder($this->owner, 'Nova');
		$first = $this->draft('A');
		$second = $this->draft('B');
		$elsewhere = $this->draft('C');
		$this->mapper->assignFolder($first->getId(), $from->getId());
		$this->mapper->assignFolder($second->getId(), $from->getId());
		$this->mapper->assignFolder($elsewhere->getId(), $to->getId());

		$this->mapper->refileFolder($from->getId(), $to->getId());

		$this->assertSame($to->getId(), $this->mapper->findById($first->getId())->getFolderId());
		$this->assertSame($to->getId(), $this->mapper->findById($second->getId())->getFolderId());
		$this->assertSame($to->getId(), $this->mapper->findById($elsewhere->getId())->getFolderId());
	}

	public function testLeavesTheEnvelopesOfAFolderWithoutFolder(): void {
		$from = $this->folder($this->owner);
		$envelope = $this->draft('A');
		$this->mapper->assignFolder($envelope->getId(), $from->getId());

		$this->mapper->refileFolder($from->getId(), null);

		$this->assertNull($this->mapper->findById($envelope->getId())->getFolderId());
	}

	private function draft(string $title): Envelope {
		$file = $this->writeFile($this->owner, "$title.pdf", self::minimalPdf());
		return Server::get(EnvelopeDrafts::class)->create($this->owner, $title, [$file->getId()]);
	}
}
```

- [ ] **Step 6: Run the mapper tests and watch them fail**

Run: `tests/env/phpunit.sh --filter 'EnvelopeFolderMapperTest|FolderAclMapperTest|EnvelopeMapperFolderTest'`
Expected: FAIL with `Class "OCA\Assinaturas\Db\EnvelopeFolder" not found` (and `Call to undefined method …assignFolder()`).

- [ ] **Step 7: Write the migration**

`lib/Migration/Version000600Date20261007000000.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** Folders of envelopes, their access lists, and the folder each envelope sits in. */
final class Version000600Date20261007000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$this->createFolders($schema);
		$this->createFolderAcl($schema);
		$this->addEnvelopeFolder($schema);
		return $schema;
	}

	private function createFolders(ISchemaWrapper $schema): void {
		if ($schema->hasTable('assinaturas_folders')) {
			return;
		}
		$table = $schema->createTable('assinaturas_folders');
		$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$table->addColumn('title', Types::STRING, ['notnull' => true, 'length' => 255]);
		$table->addColumn('parent_id', Types::BIGINT, ['notnull' => false]);
		$table->addColumn('owner_uid', Types::STRING, ['notnull' => true, 'length' => 64]);
		$table->addColumn('sort_order', Types::INTEGER, ['notnull' => true, 'default' => 0]);
		$table->addColumn('created_at', Types::BIGINT, ['notnull' => true]);
		$table->addColumn('updated_at', Types::BIGINT, ['notnull' => true]);
		$table->setPrimaryKey(['id']);
		$table->addIndex(['parent_id'], 'assin_fold_parent');
		$table->addIndex(['owner_uid'], 'assin_fold_owner');
	}

	private function createFolderAcl(ISchemaWrapper $schema): void {
		if ($schema->hasTable('assinaturas_folder_acl')) {
			return;
		}
		$table = $schema->createTable('assinaturas_folder_acl');
		$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$table->addColumn('folder_id', Types::BIGINT, ['notnull' => true]);
		$table->addColumn('participant_type', Types::STRING, ['notnull' => true, 'length' => 8]);
		$table->addColumn('participant_id', Types::STRING, ['notnull' => true, 'length' => 64]);
		$table->addColumn('perm_edit', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
		$table->addColumn('perm_share', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
		$table->addColumn('perm_manage', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
		$table->setPrimaryKey(['id']);
		$table->addUniqueIndex(['folder_id', 'participant_type', 'participant_id'], 'assin_facl_uniq');
		$table->addIndex(['participant_type', 'participant_id'], 'assin_facl_part');
	}

	private function addEnvelopeFolder(ISchemaWrapper $schema): void {
		$table = $schema->getTable('assinaturas_envelopes');
		if (!$table->hasColumn('folder_id')) {
			$table->addColumn('folder_id', Types::BIGINT, ['notnull' => false]);
		}
		if (!$table->hasIndex('assin_env_folder')) {
			$table->addIndex(['folder_id'], 'assin_env_folder');
		}
	}
}
```

- [ ] **Step 8: Write the entities and mappers**

`lib/Db/EnvelopeFolder.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

use OCP\AppFramework\Db\Entity;
use OCP\DB\Types;

/**
 * A folder of envelopes. Not a Drive folder: it lives in the app's own tables.
 *
 * @method string getTitle()
 * @method void setTitle(string $title)
 * @method int|null getParentId()
 * @method void setParentId(?int $parentId)
 * @method string getOwnerUid()
 * @method void setOwnerUid(string $ownerUid)
 * @method int getSortOrder()
 * @method void setSortOrder(int $sortOrder)
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $createdAt)
 * @method int getUpdatedAt()
 * @method void setUpdatedAt(int $updatedAt)
 */
final class EnvelopeFolder extends Entity {
	private const FIELD_TYPES = [
		'title' => Types::STRING,
		'parentId' => Types::BIGINT,
		'ownerUid' => Types::STRING,
		'sortOrder' => Types::INTEGER,
		'createdAt' => Types::BIGINT,
		'updatedAt' => Types::BIGINT,
	];

	protected $title = '';
	protected $parentId;
	protected $ownerUid = '';
	protected $sortOrder = 0;
	protected $createdAt = 0;
	protected $updatedAt = 0;

	public function __construct() {
		foreach (self::FIELD_TYPES as $field => $type) {
			$this->addType($field, $type);
			$this->markFieldUpdated($field);
		}
	}
}
```

`lib/Db/EnvelopeFolderMapper.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @template-extends QBMapper<EnvelopeFolder>
 */
final class EnvelopeFolderMapper extends QBMapper {
	public const TABLE = 'assinaturas_folders';

	public function __construct(IDBConnection $db) {
		parent::__construct($db, self::TABLE, EnvelopeFolder::class);
	}

	/** @throws DoesNotExistException */
	public function findById(int $folderId): EnvelopeFolder {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->eq('id', $query->createNamedParameter($folderId, IQueryBuilder::PARAM_INT)));
		return $this->findEntity($query);
	}

	/** @return array<int, EnvelopeFolder> every folder by id, in display order: sort order, then title */
	public function findAllById(): array {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->orderBy('sort_order', 'ASC')
			->addOrderBy('title', 'ASC')
			->addOrderBy('id', 'ASC');
		$byId = [];
		foreach ($this->findEntities($query) as $folder) {
			$byId[$folder->getId()] = $folder;
		}
		return $byId;
	}

	/** The sort order that puts a new folder after every folder already under $parentId (null = top level). */
	public function nextSortOrder(?int $parentId): int {
		$query = $this->db->getQueryBuilder();
		$query->selectAlias($query->func()->max('sort_order'), 'highest')
			->from(self::TABLE)
			->where($parentId === null
				? $query->expr()->isNull('parent_id')
				: $query->expr()->eq('parent_id', $query->createNamedParameter($parentId, IQueryBuilder::PARAM_INT)));
		$result = $query->executeQuery();
		$highest = $result->fetchOne();
		$result->closeCursor();
		return $highest === null || $highest === false ? 0 : (int)$highest + 1;
	}

	/** Moves every child of $parentId under $newParentId (null = top level), as a deleted folder hands its subfolders up. */
	public function reparentChildren(int $parentId, ?int $newParentId, int $now): void {
		$query = $this->db->getQueryBuilder();
		$query->update(self::TABLE)
			->set('parent_id', $query->createNamedParameter($newParentId, $newParentId === null ? IQueryBuilder::PARAM_NULL : IQueryBuilder::PARAM_INT))
			->set('updated_at', $query->createNamedParameter($now, IQueryBuilder::PARAM_INT))
			->where($query->expr()->eq('parent_id', $query->createNamedParameter($parentId, IQueryBuilder::PARAM_INT)));
		$query->executeStatement();
	}
}
```

`lib/Db/FolderAcl.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

use OCA\Assinaturas\Folder\FolderRight;
use OCA\Assinaturas\Folder\ParticipantType;
use OCP\AppFramework\Db\Entity;
use OCP\DB\Types;

/**
 * One row of a folder's access list. The row itself grants View; the flags add Edit, Share and Manage.
 *
 * @method int getFolderId()
 * @method void setFolderId(int $folderId)
 * @method string getParticipantType()
 * @method void setParticipantType(string $participantType)
 * @method string getParticipantId()
 * @method void setParticipantId(string $participantId)
 * @method bool getPermEdit()
 * @method void setPermEdit(bool $permEdit)
 * @method bool getPermShare()
 * @method void setPermShare(bool $permShare)
 * @method bool getPermManage()
 * @method void setPermManage(bool $permManage)
 */
final class FolderAcl extends Entity {
	private const FIELD_TYPES = [
		'folderId' => Types::BIGINT,
		'participantType' => Types::STRING,
		'participantId' => Types::STRING,
		'permEdit' => Types::BOOLEAN,
		'permShare' => Types::BOOLEAN,
		'permManage' => Types::BOOLEAN,
	];

	protected $folderId = 0;
	protected $participantType = '';
	protected $participantId = '';
	protected $permEdit = false;
	protected $permShare = false;
	protected $permManage = false;

	public function __construct() {
		foreach (self::FIELD_TYPES as $field => $type) {
			$this->addType($field, $type);
			$this->markFieldUpdated($field);
		}
	}

	public function right(): FolderRight {
		return FolderRight::fromFlags($this->getPermEdit(), $this->getPermShare(), $this->getPermManage());
	}

	public function grant(FolderRight $right): void {
		$flags = $right->flags();
		$this->setPermEdit($flags['edit']);
		$this->setPermShare($flags['share']);
		$this->setPermManage($flags['manage']);
	}

	public function participantTypeValue(): ParticipantType {
		return ParticipantType::from($this->getParticipantType());
	}
}
```

`lib/Db/FolderAclMapper.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

use OCA\Assinaturas\Folder\ParticipantType;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @template-extends QBMapper<FolderAcl>
 */
final class FolderAclMapper extends QBMapper {
	public const TABLE = 'assinaturas_folder_acl';

	public function __construct(IDBConnection $db) {
		parent::__construct($db, self::TABLE, FolderAcl::class);
	}

	/** @throws DoesNotExistException */
	public function findById(int $entryId): FolderAcl {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->eq('id', $query->createNamedParameter($entryId, IQueryBuilder::PARAM_INT)));
		return $this->findEntity($query);
	}

	/** @return list<FolderAcl> in the order they were added */
	public function findByFolder(int $folderId): array {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->eq('folder_id', $query->createNamedParameter($folderId, IQueryBuilder::PARAM_INT)))
			->orderBy('id', 'ASC');
		return $this->findEntities($query);
	}

	/**
	 * @param list<int> $folderIds
	 * @return list<FolderAcl>
	 */
	public function findByFolders(array $folderIds): array {
		if ($folderIds === []) {
			return [];
		}
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->in('folder_id', $query->createNamedParameter($folderIds, IQueryBuilder::PARAM_INT_ARRAY)));
		return $this->findEntities($query);
	}

	/**
	 * @param list<string> $groupIds the user's groups
	 * @return list<FolderAcl> the rows that name the user or one of their groups
	 */
	public function findForParticipant(string $userId, array $groupIds): array {
		$query = $this->db->getQueryBuilder();
		$conditions = [$query->expr()->andX(
			$query->expr()->eq('participant_type', $query->createNamedParameter(ParticipantType::User->value)),
			$query->expr()->eq('participant_id', $query->createNamedParameter($userId)),
		)];
		if ($groupIds !== []) {
			$conditions[] = $query->expr()->andX(
				$query->expr()->eq('participant_type', $query->createNamedParameter(ParticipantType::Group->value)),
				$query->expr()->in('participant_id', $query->createNamedParameter($groupIds, IQueryBuilder::PARAM_STR_ARRAY)),
			);
		}
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->orX(...$conditions));
		return $this->findEntities($query);
	}

	public function findOne(int $folderId, ParticipantType $type, string $participantId): ?FolderAcl {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->eq('folder_id', $query->createNamedParameter($folderId, IQueryBuilder::PARAM_INT)))
			->andWhere($query->expr()->eq('participant_type', $query->createNamedParameter($type->value)))
			->andWhere($query->expr()->eq('participant_id', $query->createNamedParameter($participantId)));
		try {
			return $this->findEntity($query);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	public function deleteByFolder(int $folderId): void {
		$query = $this->db->getQueryBuilder();
		$query->delete(self::TABLE)
			->where($query->expr()->eq('folder_id', $query->createNamedParameter($folderId, IQueryBuilder::PARAM_INT)));
		$query->executeStatement();
	}

	/** Drops every row of a user or group Nextcloud deleted, across all folders. */
	public function deleteByParticipant(ParticipantType $type, string $participantId): void {
		$query = $this->db->getQueryBuilder();
		$query->delete(self::TABLE)
			->where($query->expr()->eq('participant_type', $query->createNamedParameter($type->value)))
			->andWhere($query->expr()->eq('participant_id', $query->createNamedParameter($participantId)));
		$query->executeStatement();
	}
}
```

Modify `lib/Db/Envelope.php`:
- in the class docblock, after `@method void setNextSyncAt(?int $nextSyncAt)`, add:
  ```php
   * @method int|null getFolderId()
   * @method void setFolderId(?int $folderId)
  ```
- in `FIELD_TYPES`, after `'nextSyncAt' => Types::BIGINT,` add `'folderId' => Types::BIGINT,`
- after `protected $nextSyncAt;` add `protected $folderId;`

Modify `lib/Db/EnvelopeMapper.php` — add these two methods after `scheduleSyncNoLaterThan()`:

```php
	/** Files one envelope in a folder, or in none. Writes the folder only, so no concurrent status write is lost. */
	public function assignFolder(int $envelopeId, ?int $folderId): void {
		$query = $this->db->getQueryBuilder();
		$query->update(self::TABLE)
			->set('folder_id', $query->createNamedParameter($folderId, $folderId === null ? IQueryBuilder::PARAM_NULL : IQueryBuilder::PARAM_INT))
			->where($query->expr()->eq('id', $query->createNamedParameter($envelopeId, IQueryBuilder::PARAM_INT)));
		$query->executeStatement();
	}

	/** Hands every envelope of a folder to another folder, or to none, as a deleted folder hands its envelopes to its parent. */
	public function refileFolder(int $folderId, ?int $newFolderId): void {
		$query = $this->db->getQueryBuilder();
		$query->update(self::TABLE)
			->set('folder_id', $query->createNamedParameter($newFolderId, $newFolderId === null ? IQueryBuilder::PARAM_NULL : IQueryBuilder::PARAM_INT))
			->where($query->expr()->eq('folder_id', $query->createNamedParameter($folderId, IQueryBuilder::PARAM_INT)));
		$query->executeStatement();
	}
```

- [ ] **Step 9: Apply the migration to the local test DB**

Run: `tests/env/php.sh occ migrations:execute assinaturas 000600Date20261007000000`
Expected: exit 0.
Then: `tests/env/php.sh occ migrations:status assinaturas`
Expected: the `Last executed migration` line names `000600Date20261007000000`.

- [ ] **Step 10: Run the Task 1 tests and watch them pass**

Run: `tests/env/phpunit.sh --filter 'FolderRightTest|EnvelopeFolderMapperTest|FolderAclMapperTest|EnvelopeMapperFolderTest'`
Expected: `OK`.

- [ ] **Step 11: Run the task gates**

Run each: `composer run lint` (exit 0) and `tests/env/phpunit.sh` (the whole suite, `OK`).

- [ ] **Step 12: Commit**

```bash
git add lib/Migration/Version000600Date20261007000000.php lib/Folder lib/Db tests/Unit/Folder tests/Integration/TestFolders.php tests/Integration/Db
git commit -m "feat(folders): add folder and access-list tables with their mappers"
```

---

### Task 2: Managers group, roles and the manager usage route

**Files:**
- Create: `lib/Access/ManagersGroup.php`, `lib/Access/Roles.php`, `lib/Access/AppGroups.php`
- Create: `lib/Migration/EnsureAppGroups.php`; Delete: `lib/Migration/EnsureSignersGroup.php`
- Create: `lib/Command/EnsureGroups.php`
- Create: `lib/Controller/UsageController.php`
- Modify: `appinfo/info.xml` (repair steps, command)
- Modify: `lib/Access/AccessPolicy.php`, `lib/Access/EnvelopeAccess.php`, `lib/Api/ClientConfig.php`
- Test: `tests/Integration/Access/EnsureAppGroupsTest.php` (replaces `EnsureSignersGroupTest.php`), `tests/Integration/Command/EnsureGroupsTest.php`, `tests/Integration/Access/AccessPolicyTest.php`, `tests/Integration/Access/EnvelopeAccessTest.php`, `tests/Integration/Api/ClientConfigTest.php`, `tests/Integration/AppInfo/NavigationTest.php`, `tests/Integration/Controller/UsageControllerTest.php`, `tests/Integration/Controller/AdminControllerTest.php`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `ManagersGroup::GROUP_ID = 'assinaturas-admins'`, `ManagersGroup::DISPLAY_NAME = 'Avuz Assinaturas Admins'`.
  - `Roles`: `isNextcloudAdmin(string): bool`, `isManager(string): bool`, `isMember(string): bool`, `canUseApp(string): bool`, `canSeeAll(string): bool`.
  - `AppGroups::ensure(): list<string>` (ids it created).
  - `AccessPolicy`: `canUseApp`, `isManager`, `isNextcloudAdmin`, `canSeeAll` (admin or manager), `canEdit` (unchanged); `canRead` stays until Task 4 replaces it.
  - `EnvelopeAccess::mayAdminister()` = Nextcloud admin only; new `EnvelopeAccess::maySeeAll()`.
  - Client config gains `canSeeAll: bool`; `isAdmin` now means Nextcloud admin only.
  - `occ assinaturas:groups:ensure` prints `Groups: unchanged` or `Groups: created <ids>`, exit 0.
  - `GET /api/v1/usage` → `{"month": "YYYY-MM", "sent": int, "completed": int, "credits": int|null}`; 403 `forbidden` unless `canSeeAll`.

- [ ] **Step 1: Write the failing tests**

Move the repair-step test: `git mv tests/Integration/Access/EnsureSignersGroupTest.php tests/Integration/Access/EnsureAppGroupsTest.php`, then replace its contents:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Access;

use OCA\Assinaturas\Access\ManagersGroup;
use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Migration\EnsureAppGroups;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\IGroupManager;
use OCP\Migration\IOutput;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class EnsureAppGroupsTest extends TestCase {
	use TestUsers;

	private IGroupManager $groupManager;

	protected function setUp(): void {
		parent::setUp();
		$this->groupManager = Server::get(IGroupManager::class);
	}

	protected function tearDown(): void {
		$this->deleteCreatedUsers();
		Server::get(EnsureAppGroups::class)->run($this->createMock(IOutput::class));
		parent::tearDown();
	}

	/** @return array<string, array{string, string}> */
	public static function appGroups(): array {
		return [
			'members' => [SignersGroup::GROUP_ID, 'Avuz Assinaturas'],
			'managers' => [ManagersGroup::GROUP_ID, 'Avuz Assinaturas Admins'],
		];
	}

	/** @dataProvider appGroups */
	public function testCreatesEachGroupWithItsDisplayName(string $groupId, string $displayName): void {
		$this->groupManager->get($groupId)?->delete();

		Server::get(EnsureAppGroups::class)->run($this->createMock(IOutput::class));

		$this->assertSame($displayName, $this->groupManager->get($groupId)?->getDisplayName());
	}

	/** @dataProvider appGroups */
	public function testLeavesAnExistingGroupAndItsMembersAlone(string $groupId): void {
		$member = $this->createUser();
		$this->addToGroup($member, $groupId);

		Server::get(EnsureAppGroups::class)->run($this->createMock(IOutput::class));

		$this->assertTrue($this->groupManager->isInGroup($member, $groupId));
	}
}
```

`tests/Integration/Command/EnsureGroupsTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Command;

use OCA\Assinaturas\Access\ManagersGroup;
use OCA\Assinaturas\Command\EnsureGroups;
use OCP\IGroupManager;
use OCP\Server;
use Symfony\Component\Console\Tester\CommandTester;
use Test\TestCase;

/**
 * @group DB
 */
final class EnsureGroupsTest extends TestCase {
	protected function tearDown(): void {
		(new CommandTester(Server::get(EnsureGroups::class)))->execute([]);
		parent::tearDown();
	}

	public function testRecreatesADeletedManagersGroup(): void {
		Server::get(IGroupManager::class)->get(ManagersGroup::GROUP_ID)?->delete();
		$command = new CommandTester(Server::get(EnsureGroups::class));

		$status = $command->execute([]);

		$this->assertSame(0, $status);
		$this->assertStringContainsString('Groups: created assinaturas-admins', $command->getDisplay());
		$this->assertTrue(Server::get(IGroupManager::class)->groupExists(ManagersGroup::GROUP_ID));
	}

	public function testSaysNothingChangedWhenBothGroupsExist(): void {
		(new CommandTester(Server::get(EnsureGroups::class)))->execute([]);
		$command = new CommandTester(Server::get(EnsureGroups::class));

		$command->execute([]);

		$this->assertStringContainsString('Groups: unchanged', $command->getDisplay());
	}
}
```

Append to `tests/Integration/Access/AccessPolicyTest.php` (add `use OCA\Assinaturas\Access\ManagersGroup;`), before `envelopeOwnedBy()`:

```php
	public function testLetsManagersUseTheAppWithoutMembership(): void {
		$manager = $this->createUser();
		$this->addToGroup($manager, ManagersGroup::GROUP_ID);

		$this->assertTrue($this->policy->canUseApp($manager));
	}

	public function testLetsManagersSeeEveryEnvelopeWithoutBeingNextcloudAdmins(): void {
		$manager = $this->createUser();
		$this->addToGroup($manager, ManagersGroup::GROUP_ID);

		$this->assertTrue($this->policy->canSeeAll($manager));
		$this->assertTrue($this->policy->isManager($manager));
		$this->assertFalse($this->policy->isNextcloudAdmin($manager));
	}

	public function testTellsNextcloudAdminsApartFromManagers(): void {
		$this->assertTrue($this->policy->isNextcloudAdmin(self::ADMIN));
		$this->assertFalse($this->policy->isManager(self::ADMIN));
	}
```

In the same file rename `testLetsOnlyAdminsSeeEveryEnvelope` to `testKeepsMembersFromSeeingEveryEnvelope` (body unchanged).

Append to `tests/Integration/Access/EnvelopeAccessTest.php` (add `use OCA\Assinaturas\Access\ManagersGroup;`):

```php
	public function testKeepsAManagerOutOfTheAdministration(): void {
		$this->addToGroup($this->stranger, ManagersGroup::GROUP_ID);
		self::loginAsUser($this->stranger);

		$this->assertTrue($this->access()->maySeeAll());
		$this->assertFalse($this->access()->mayAdminister());
	}
```

Append to `tests/Integration/Api/ClientConfigTest.php` (add `use OCA\Assinaturas\Access\ManagersGroup;`):

```php
	public function testLetsAManagerSeeEverythingWithoutAdminSettings(): void {
		$manager = $this->createUser();
		$this->addToGroup($manager, ManagersGroup::GROUP_ID);

		$config = $this->configFor($manager);

		$this->assertTrue($config['canUseApp']);
		$this->assertTrue($config['canSeeAll']);
		$this->assertFalse($config['isAdmin']);
	}

	public function testLetsAnAdminSeeEverything(): void {
		$this->assertTrue($this->configFor($this->admin)['canSeeAll']);
		$this->assertFalse($this->configFor($this->member)['canSeeAll']);
	}
```

Append to `tests/Integration/AppInfo/NavigationTest.php` (add `use OCA\Assinaturas\Access\ManagersGroup;`):

```php
	public function testShowsTheEntryToAManagerWhoIsNotAMember(): void {
		$manager = $this->createUser();
		$this->addToGroup($manager, ManagersGroup::GROUP_ID);

		$this->assertContains(Application::APP_ID, $this->navigationIdsFor($manager));
	}
```

Append to `tests/Integration/Controller/AdminControllerTest.php` (add `use OCA\Assinaturas\Access\ManagersGroup;`):

```php
	public function testForbidsTheAdministrationToAManager(): void {
		$manager = $this->createUser();
		$this->addToGroup($manager, ManagersGroup::GROUP_ID);
		self::loginAsUser($manager);

		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller()->status()->getStatus());
		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller()->destroy($this->uuid)->getStatus());
		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller()->resetCounters()->getStatus());
	}
```

`tests/Integration/Controller/UsageControllerTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Controller;

use OCA\Assinaturas\Access\ManagersGroup;
use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Controller\UsageController;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\AppFramework\Http;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class UsageControllerTest extends TestCase {
	use TestUsers;

	protected function tearDown(): void {
		self::logout();
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testForbidsTheUsageToAMember(): void {
		$member = $this->createUser();
		$this->addToGroup($member, SignersGroup::GROUP_ID);
		self::loginAsUser($member);

		$response = Server::get(UsageController::class)->show();

		$this->assertSame(Http::STATUS_FORBIDDEN, $response->getStatus());
		$this->assertSame('forbidden', $response->getData()['error']);
	}

	public function testShowsAManagerThisMonthsEnvelopesAndCredits(): void {
		$manager = $this->createUser();
		$this->addToGroup($manager, ManagersGroup::GROUP_ID);
		self::loginAsUser($manager);

		$usage = Server::get(UsageController::class)->show()->getData();

		$this->assertSame(['month', 'sent', 'completed', 'credits'], array_keys($usage));
		$this->assertMatchesRegularExpression('/^\d{4}-\d{2}$/', $usage['month']);
		$this->assertIsInt($usage['sent']);
		$this->assertIsInt($usage['completed']);
		$this->assertTrue($usage['credits'] === null || is_int($usage['credits']));
	}
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `tests/env/phpunit.sh --filter 'EnsureAppGroupsTest|EnsureGroupsTest|AccessPolicyTest|EnvelopeAccessTest|ClientConfigTest|NavigationTest|AdminControllerTest|UsageControllerTest'`
Expected: FAIL — `Class "OCA\Assinaturas\Access\ManagersGroup" not found`, `Class "…\Migration\EnsureAppGroups" not found`, `Class "…\Command\EnsureGroups" not found`, `Class "…\Controller\UsageController" not found`.

- [ ] **Step 3: Write the group and role classes**

`lib/Access/ManagersGroup.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Access;

/** Company managers: see and act on every envelope and folder without being Nextcloud admins. */
final class ManagersGroup {
	public const GROUP_ID = 'assinaturas-admins';
	public const DISPLAY_NAME = 'Avuz Assinaturas Admins';
}
```

`lib/Access/Roles.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Access;

use OCP\IGroupManager;

/** Who someone is to the app, by group: a member, a company manager, or a Nextcloud admin (Avuz maintainers). */
final class Roles {
	public function __construct(
		private IGroupManager $groupManager,
	) {
	}

	public function isNextcloudAdmin(string $userId): bool {
		return $this->groupManager->isAdmin($userId);
	}

	public function isManager(string $userId): bool {
		return $this->groupManager->isInGroup($userId, ManagersGroup::GROUP_ID);
	}

	public function isMember(string $userId): bool {
		return $this->groupManager->isInGroup($userId, SignersGroup::GROUP_ID);
	}

	public function canUseApp(string $userId): bool {
		return $this->isNextcloudAdmin($userId) || $this->isManager($userId) || $this->isMember($userId);
	}

	public function canSeeAll(string $userId): bool {
		return $this->isNextcloudAdmin($userId) || $this->isManager($userId);
	}
}
```

`lib/Access/AppGroups.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Access;

use OCP\IGroupManager;

/** Creates the app's two groups when they are missing. Only Nextcloud admins manage who is in them. */
final class AppGroups {
	private const GROUPS = [
		SignersGroup::GROUP_ID => SignersGroup::DISPLAY_NAME,
		ManagersGroup::GROUP_ID => ManagersGroup::DISPLAY_NAME,
	];

	public function __construct(
		private IGroupManager $groupManager,
	) {
	}

	/** @return list<string> the ids of the groups it had to create */
	public function ensure(): array {
		$created = [];
		foreach (self::GROUPS as $groupId => $displayName) {
			if ($this->groupManager->groupExists($groupId)) {
				continue;
			}
			$this->groupManager->createGroup($groupId)?->setDisplayName($displayName);
			$created[] = $groupId;
		}
		return $created;
	}
}
```

`git rm lib/Migration/EnsureSignersGroup.php`, then `lib/Migration/EnsureAppGroups.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Migration;

use OCA\Assinaturas\Access\AppGroups;
use OCP\Migration\IOutput;
use OCP\Migration\IRepairStep;

final class EnsureAppGroups implements IRepairStep {
	public function __construct(
		private AppGroups $appGroups,
	) {
	}

	public function getName(): string {
		return 'Create the Avuz Assinaturas groups';
	}

	public function run(IOutput $output): void {
		foreach ($this->appGroups->ensure() as $groupId) {
			$output->info('Created group ' . $groupId);
		}
	}
}
```

`lib/Command/EnsureGroups.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Command;

use OCA\Assinaturas\Access\AppGroups;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

/** Run by the Avuz image on every boot: repair steps only run on install and upgrade, so a deleted group would stay gone. */
final class EnsureGroups extends Command {
	public function __construct(
		private AppGroups $appGroups,
	) {
		parent::__construct();
	}

	protected function configure(): void {
		$this->setName('assinaturas:groups:ensure')
			->setDescription('Creates the Avuz Assinaturas member and manager groups when they are missing');
	}

	protected function execute(InputInterface $input, OutputInterface $output): int {
		$created = $this->appGroups->ensure();
		$output->writeln($created === [] ? 'Groups: unchanged' : 'Groups: created ' . implode(', ', $created));
		return self::SUCCESS;
	}
}
```

In `appinfo/info.xml`, replace both `<step>OCA\Assinaturas\Migration\EnsureSignersGroup</step>` with `<step>OCA\Assinaturas\Migration\EnsureAppGroups</step>`, and add after the `EnsureWebhooks` command:

```xml
        <command>OCA\Assinaturas\Command\EnsureGroups</command>
```

- [ ] **Step 4: Rewire the access classes and the client config**

Replace `lib/Access/AccessPolicy.php` with:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Access;

use OCA\Assinaturas\Db\Envelope;

/**
 * Enforced in the app, not through Nextcloud's "limit to groups": core treats group-limited
 * apps as disabled for anonymous requests, which would 404 the ZapSign webhook.
 */
final class AccessPolicy {
	public function __construct(
		private Roles $roles,
	) {
	}

	public function canUseApp(string $userId): bool {
		return $this->roles->canUseApp($userId);
	}

	public function isManager(string $userId): bool {
		return $this->roles->isManager($userId);
	}

	public function isNextcloudAdmin(string $userId): bool {
		return $this->roles->isNextcloudAdmin($userId);
	}

	/** Nextcloud admins and company managers see and act on every envelope and folder. */
	public function canSeeAll(string $userId): bool {
		return $this->roles->canSeeAll($userId);
	}

	public function canRead(Envelope $envelope, string $userId): bool {
		return $envelope->getOwnerUid() === $userId || $this->canSeeAll($userId);
	}

	/** Draft editing (the wizard) stays with the owner. */
	public function canEdit(Envelope $envelope, string $userId): bool {
		return $envelope->getOwnerUid() === $userId && $this->canUseApp($userId);
	}
}
```

In `lib/Access/EnvelopeAccess.php`, replace `mayAdminister()` with:

```php
	/** The admin routes (connection status, counters, deleting any envelope) stay with Nextcloud admins. */
	public function mayAdminister(): bool {
		return $this->accessPolicy->isNextcloudAdmin($this->currentUserId());
	}

	public function maySeeAll(): bool {
		return $this->accessPolicy->canSeeAll($this->currentUserId());
	}
```

In `lib/Api/ClientConfig.php`, change the docblock return type to `array{environment: string, canUseApp: bool, isAdmin: bool, canSeeAll: bool, limits: array<string, int>}` and replace the `'isAdmin'` line with:

```php
			'isAdmin' => $this->accessPolicy->isNextcloudAdmin($userId),
			'canSeeAll' => $this->accessPolicy->canSeeAll($userId),
```

`lib/Controller/UsageController.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Controller;

use OCA\Assinaturas\Access\EnvelopeAccess;
use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\Ops\ProviderHealth;
use OCA\Assinaturas\Ops\UsageReport;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\FrontpageRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

/** The read-only usage panel for company managers: this month's envelopes and the plan's credits. */
final class UsageController extends Controller {
	public function __construct(
		IRequest $request,
		private EnvelopeAccess $access,
		private UsageReport $usage,
		private ProviderHealth $health,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'GET', url: '/api/v1/usage')]
	public function show(): JSONResponse {
		if (!$this->access->maySeeAll()) {
			return new JSONResponse(['error' => 'forbidden', 'message' => 'You are not allowed to do this'], Http::STATUS_FORBIDDEN);
		}
		$thisMonth = $this->usage->thisMonth();
		$plan = $this->health->current()['plan'];
		return new JSONResponse([
			'month' => $thisMonth['month'],
			'sent' => $thisMonth['sent'],
			'completed' => $thisMonth['completed'],
			'credits' => $plan === null ? null : $plan['credits'],
		]);
	}
}
```

- [ ] **Step 5: Run the Task 2 tests and watch them pass**

Run: `tests/env/phpunit.sh --filter 'EnsureAppGroupsTest|EnsureGroupsTest|AccessPolicyTest|EnvelopeAccessTest|ClientConfigTest|NavigationTest|AdminControllerTest|UsageControllerTest'`
Expected: `OK`.

- [ ] **Step 6: Check the command from the CLI**

Run: `tests/env/php.sh occ assinaturas:groups:ensure`
Expected: `Groups: created assinaturas-admins` the first time, `Groups: unchanged` the second.

- [ ] **Step 7: Run the task gates and commit**

Run each: `composer run lint`, `tests/env/phpunit.sh`. Both exit 0.

```bash
git add -A lib/Access lib/Migration lib/Command lib/Controller/UsageController.php lib/Api/ClientConfig.php appinfo/info.xml tests/Integration
git commit -m "feat(access): add the company managers group and their usage route"
```

---

### Task 3: Folder rights (`FolderAccess`)

**Files:**
- Create: `lib/Folder/FolderAccess.php`
- Create: `tests/Integration/TestGroups.php`
- Modify: `tests/Integration/TestFolders.php` (forget cached rights after each write)
- Test: `tests/Integration/Folder/FolderAccessTest.php`

**Interfaces:**
- Consumes: Task 1 mappers and `FolderRight`, Task 2 `Roles`.
- Produces (fixed contract for Plan 9, contracts):
  - `FolderAccess::rightOn(int $folderId, string $userId): FolderRight`
  - `FolderAccess::rightsFor(string $userId): array<int, FolderRight>` (only folders ≥ View)
  - `FolderAccess::visibleFolderIds(string $userId): list<int>`
  - `FolderAccess::userIdsWithEditOn(int $folderId): list<string>` (sorted; owner and ACL holders with ≥ Edit on the folder or an ancestor, groups expanded, filtered to users who can use the app; managers are not added for their role)
  - `FolderAccess::forget(): void`
  - Test trait `TestGroups`: `newGroup(): string`, `deleteCreatedGroups(): void`.

- [ ] **Step 1: Write the test helpers and the failing matrix test**

`tests/Integration/TestGroups.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration;

use OCP\IGroupManager;
use OCP\Server;

/** Throwaway Nextcloud groups for tests. Call deleteCreatedGroups() in tearDown. */
trait TestGroups {
	/** @var list<string> */
	private array $createdGroupIds = [];

	private function newGroup(): string {
		$groupId = 'assinaturas-test-' . bin2hex(random_bytes(4));
		Server::get(IGroupManager::class)->createGroup($groupId);
		$this->createdGroupIds[] = $groupId;
		return $groupId;
	}

	private function deleteCreatedGroups(): void {
		foreach ($this->createdGroupIds as $groupId) {
			Server::get(IGroupManager::class)->get($groupId)?->delete();
		}
		$this->createdGroupIds = [];
	}
}
```

In `tests/Integration/TestFolders.php`, add `use OCA\Assinaturas\Folder\FolderAccess;` and make both writers forget the cached rights. Replace the last line of `folder()` (`return $mapper->insert($folder);`) with:

```php
		$created = $mapper->insert($folder);
		Server::get(FolderAccess::class)->forget();
		return $created;
```

and the last line of `grant()` with:

```php
		$granted = Server::get(FolderAclMapper::class)->insert($entry);
		Server::get(FolderAccess::class)->forget();
		return $granted;
```

`tests/Integration/Folder/FolderAccessTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Folder;

use OCA\Assinaturas\Access\ManagersGroup;
use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Db\EnvelopeFolderMapper;
use OCA\Assinaturas\Folder\FolderAccess;
use OCA\Assinaturas\Folder\FolderRight;
use OCA\Assinaturas\Folder\ParticipantType;
use OCA\Assinaturas\Tests\Integration\TestFolders;
use OCA\Assinaturas\Tests\Integration\TestGroups;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class FolderAccessTest extends TestCase {
	use TestUsers;
	use TestGroups;
	use TestFolders;

	private const ADMIN_GROUP = 'admin';

	private string $owner;
	private string $member;

	protected function setUp(): void {
		parent::setUp();
		$this->owner = $this->memberUser();
		$this->member = $this->memberUser();
	}

	protected function tearDown(): void {
		$this->deleteFoldersOf($this->createdUserIds);
		$this->deleteCreatedGroups();
		$this->deleteCreatedUsers();
		Server::get(FolderAccess::class)->forget();
		parent::tearDown();
	}

	public function testGivesTheOwnerManageOnTheFolderAndBelow(): void {
		$parent = $this->folder($this->owner, 'Contratos');
		$child = $this->folder($this->member, 'Fornecedores', $parent);

		$this->assertSame(FolderRight::Manage, $this->access()->rightOn($parent->getId(), $this->owner));
		$this->assertSame(FolderRight::Manage, $this->access()->rightOn($child->getId(), $this->owner));
	}

	/** @return array<string, array{FolderRight}> */
	public static function grantableRights(): array {
		return ['view' => [FolderRight::View], 'edit' => [FolderRight::Edit], 'share' => [FolderRight::Share], 'manage' => [FolderRight::Manage]];
	}

	/** @dataProvider grantableRights */
	public function testGrantsEachRightThroughTheUsersOwnRow(FolderRight $right): void {
		$folder = $this->folder($this->owner);
		$this->grant($folder, ParticipantType::User, $this->member, $right);

		$this->assertSame($right, $this->access()->rightOn($folder->getId(), $this->member));
	}

	public function testGrantsARightThroughAGroup(): void {
		$groupId = $this->newGroup();
		$this->addToGroup($this->member, $groupId);
		$folder = $this->folder($this->owner);
		$this->grant($folder, ParticipantType::Group, $groupId, FolderRight::Edit);

		$this->assertSame(FolderRight::Edit, $this->access()->rightOn($folder->getId(), $this->member));
	}

	public function testInheritsARightFromAnAncestor(): void {
		$parent = $this->folder($this->owner, 'Contratos');
		$child = $this->folder($this->owner, '2026', $parent);
		$grandchild = $this->folder($this->owner, 'Outubro', $child);
		$this->grant($parent, ParticipantType::User, $this->member, FolderRight::Share);

		$this->assertSame(FolderRight::Share, $this->access()->rightOn($grandchild->getId(), $this->member));
	}

	public function testKeepsTheHighestRightAcrossEveryPath(): void {
		$groupId = $this->newGroup();
		$this->addToGroup($this->member, $groupId);
		$parent = $this->folder($this->owner, 'Contratos');
		$child = $this->folder($this->owner, '2026', $parent);
		$this->grant($child, ParticipantType::User, $this->member, FolderRight::View);
		$this->grant($parent, ParticipantType::Group, $groupId, FolderRight::Edit);
		$this->grant($child, ParticipantType::Group, $groupId, FolderRight::View);

		$this->assertSame(FolderRight::Edit, $this->access()->rightOn($child->getId(), $this->member));
		$this->assertSame(FolderRight::Edit, $this->access()->rightOn($parent->getId(), $this->member));
	}

	public function testGivesNoRightToSomeoneWhoCannotUseTheApp(): void {
		$outsider = $this->createUser();
		$folder = $this->folder($this->owner);
		$this->grant($folder, ParticipantType::User, $outsider, FolderRight::Manage);

		$this->assertSame(FolderRight::None, $this->access()->rightOn($folder->getId(), $outsider));
		$this->assertSame([], $this->access()->visibleFolderIds($outsider));
	}

	public function testGivesNoRightOnAFolderNobodySharedWithTheUser(): void {
		$folder = $this->folder($this->owner);

		$this->assertSame(FolderRight::None, $this->access()->rightOn($folder->getId(), $this->member));
	}

	public function testGivesManagersManageOnEveryFolder(): void {
		$manager = $this->createUser();
		$this->addToGroup($manager, ManagersGroup::GROUP_ID);
		$folder = $this->folder($this->owner);

		$this->assertSame(FolderRight::Manage, $this->access()->rightOn($folder->getId(), $manager));
	}

	public function testGivesNextcloudAdminsManageOnEveryFolder(): void {
		$admin = $this->createUser();
		$this->addToGroup($admin, self::ADMIN_GROUP);
		$folder = $this->folder($this->owner);

		$this->assertSame(FolderRight::Manage, $this->access()->rightOn($folder->getId(), $admin));
	}

	public function testListsTheFoldersAUserCanViewAndNoOthers(): void {
		$shared = $this->folder($this->owner, 'Compartilhada');
		$below = $this->folder($this->owner, 'Abaixo', $shared);
		$unrelated = $this->folder($this->owner, 'Privada');
		$this->grant($shared, ParticipantType::User, $this->member, FolderRight::View);

		$visible = $this->access()->visibleFolderIds($this->member);

		$this->assertEqualsCanonicalizing([$shared->getId(), $below->getId()], $visible);
		$this->assertNotContains($unrelated->getId(), $visible);
	}

	public function testSeesANewGrantOnceTheCachedRightsAreForgotten(): void {
		$folder = $this->folder($this->owner);
		$this->assertSame(FolderRight::None, $this->access()->rightOn($folder->getId(), $this->member));

		$this->grant($folder, ParticipantType::User, $this->member, FolderRight::Edit);

		$this->assertSame(FolderRight::Edit, $this->access()->rightOn($folder->getId(), $this->member));
	}

	public function testStopsAtALoopInTheParentLinks(): void {
		$first = $this->folder($this->owner, 'A');
		$second = $this->folder($this->owner, 'B', $first);
		$first->setParentId($second->getId());
		Server::get(EnvelopeFolderMapper::class)->update($first);
		$this->access()->forget();

		$this->assertSame(FolderRight::Manage, $this->access()->rightOn($second->getId(), $this->owner));
		$this->assertSame(FolderRight::None, $this->access()->rightOn($second->getId(), $this->member));
	}

	public function testListsEveryoneWhoCanEditAFolderForItsAlerts(): void {
		$groupId = $this->newGroup();
		$groupEditor = $this->memberUser();
		$this->addToGroup($groupEditor, $groupId);
		$viewer = $this->memberUser();
		$outsider = $this->createUser();
		$parent = $this->folder($this->owner, 'Contratos');
		$child = $this->folder($this->owner, 'Fornecedores', $parent);
		$this->grant($parent, ParticipantType::User, $this->member, FolderRight::Edit);
		$this->grant($child, ParticipantType::Group, $groupId, FolderRight::Share);
		$this->grant($child, ParticipantType::User, $viewer, FolderRight::View);
		$this->grant($child, ParticipantType::User, $outsider, FolderRight::Manage);

		$recipients = $this->access()->userIdsWithEditOn($child->getId());

		$expected = [$this->owner, $this->member, $groupEditor];
		sort($expected);
		$this->assertSame($expected, $recipients);
	}

	private function memberUser(): string {
		$userId = $this->createUser();
		$this->addToGroup($userId, SignersGroup::GROUP_ID);
		return $userId;
	}

	private function access(): FolderAccess {
		return Server::get(FolderAccess::class);
	}
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `tests/env/phpunit.sh --filter FolderAccessTest`
Expected: FAIL with `Class "OCA\Assinaturas\Folder\FolderAccess" not found`.

- [ ] **Step 3: Write `FolderAccess`**

`lib/Folder/FolderAccess.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Folder;

use OCA\Assinaturas\Access\Roles;
use OCA\Assinaturas\Db\EnvelopeFolder;
use OCA\Assinaturas\Db\EnvelopeFolderMapper;
use OCA\Assinaturas\Db\FolderAcl;
use OCA\Assinaturas\Db\FolderAclMapper;
use OCP\IGroupManager;
use OCP\IUser;
use OCP\IUserManager;

/**
 * Who may do what on each folder. A right on a folder holds for everything below it; with several paths
 * (ownership, an own row, a group row, an ancestor) the highest wins. Managers and Nextcloud admins manage
 * every folder; someone who cannot use the app holds nothing. Rights are worked out once per user and
 * request, so every writer of folders or access lists calls forget().
 */
final class FolderAccess {
	/** @var array<string, array<int, FolderRight>> */
	private array $rightsByUser = [];

	public function __construct(
		private EnvelopeFolderMapper $folderMapper,
		private FolderAclMapper $aclMapper,
		private Roles $roles,
		private IGroupManager $groupManager,
		private IUserManager $userManager,
	) {
	}

	public function rightOn(int $folderId, string $userId): FolderRight {
		return $this->rightsFor($userId)[$folderId] ?? FolderRight::None;
	}

	/** @return array<int, FolderRight> folder id => the user's right, for every folder the user can at least view */
	public function rightsFor(string $userId): array {
		$this->rightsByUser[$userId] ??= $this->computeRights($userId);
		return $this->rightsByUser[$userId];
	}

	/** @return list<int> */
	public function visibleFolderIds(string $userId): array {
		return array_keys($this->rightsFor($userId));
	}

	/**
	 * Everyone who can use the app and holds at least Edit on the folder through ownership or an access list,
	 * on the folder or one of its ancestors, directly or through a group. Managers and admins are not added for
	 * their role alone.
	 *
	 * @return list<string> user ids, sorted
	 */
	public function userIdsWithEditOn(int $folderId): array {
		$folders = $this->folderMapper->findAllById();
		$lineage = self::lineage($folderId, $folders);
		$userIds = array_map(fn (int $id): string => $folders[$id]->getOwnerUid(), $lineage);
		foreach ($this->aclMapper->findByFolders($lineage) as $entry) {
			if ($entry->right()->atLeast(FolderRight::Edit)) {
				$userIds = [...$userIds, ...$this->membersOf($entry)];
			}
		}
		$entitled = array_values(array_unique(array_filter($userIds, fn (string $userId): bool => $this->roles->canUseApp($userId))));
		sort($entitled);
		return $entitled;
	}

	public function forget(): void {
		$this->rightsByUser = [];
	}

	/** @return array<int, FolderRight> */
	private function computeRights(string $userId): array {
		if (!$this->roles->canUseApp($userId)) {
			return [];
		}
		$folders = $this->folderMapper->findAllById();
		if ($this->roles->canSeeAll($userId)) {
			return array_fill_keys(array_keys($folders), FolderRight::Manage);
		}
		$direct = $this->directRights($userId, $folders);
		$effective = [];
		foreach (array_keys($folders) as $folderId) {
			$inherited = array_map(fn (int $ancestorId): FolderRight => $direct[$ancestorId] ?? FolderRight::None, self::lineage($folderId, $folders));
			$right = FolderRight::highest(...$inherited);
			if ($right->atLeast(FolderRight::View)) {
				$effective[$folderId] = $right;
			}
		}
		return $effective;
	}

	/**
	 * @param array<int, EnvelopeFolder> $folders
	 * @return array<int, FolderRight> what the user holds on each folder itself, before inheritance
	 */
	private function directRights(string $userId, array $folders): array {
		$direct = [];
		foreach ($folders as $folderId => $folder) {
			if ($folder->getOwnerUid() === $userId) {
				$direct[$folderId] = FolderRight::Manage;
			}
		}
		foreach ($this->aclMapper->findForParticipant($userId, $this->groupIdsOf($userId)) as $entry) {
			$folderId = $entry->getFolderId();
			$direct[$folderId] = FolderRight::highest($direct[$folderId] ?? FolderRight::None, $entry->right());
		}
		return $direct;
	}

	/** @return list<string> */
	private function groupIdsOf(string $userId): array {
		$user = $this->userManager->get($userId);
		return $user === null ? [] : array_values($this->groupManager->getUserGroupIds($user));
	}

	/** @return list<string> */
	private function membersOf(FolderAcl $entry): array {
		if ($entry->participantTypeValue() === ParticipantType::User) {
			return [$entry->getParticipantId()];
		}
		$group = $this->groupManager->get($entry->getParticipantId());
		return $group === null ? [] : array_values(array_map(fn (IUser $user): string => $user->getUID(), $group->getUsers()));
	}

	/**
	 * The folder and its ancestors, nearest first. A missing parent or a loop in the parent links ends the walk.
	 *
	 * @param array<int, EnvelopeFolder> $folders
	 * @return list<int>
	 */
	private static function lineage(int $folderId, array $folders): array {
		$lineage = [];
		$current = $folderId;
		while ($current !== null && isset($folders[$current]) && !in_array($current, $lineage, true)) {
			$lineage[] = $current;
			$current = $folders[$current]->getParentId();
		}
		return $lineage;
	}
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `tests/env/phpunit.sh --filter FolderAccessTest`
Expected: `OK` (16 tests).

- [ ] **Step 5: Run the task gates and commit**

Run each: `composer run lint`, `tests/env/phpunit.sh`.

```bash
git add lib/Folder/FolderAccess.php tests/Integration/TestGroups.php tests/Integration/TestFolders.php tests/Integration/Folder
git commit -m "feat(folders): work out each user's right on every folder"
```

---

### Task 4: `canSee` / `canAct` and every envelope route

**Files:**
- Modify: `lib/Access/AccessPolicy.php` (final shape: `canSee`, `canAct`; drop `canRead`)
- Modify: `lib/Access/EnvelopeAccess.php` (`readable` → `visible`, add `mayAct`)
- Modify: `lib/Controller/EnvelopeController.php`, `lib/Controller/EnvelopeActionController.php`, `lib/Controller/AdminController.php`
- Test: `tests/Integration/Access/AccessPolicyTest.php` (rewrite), `tests/Integration/Access/EnvelopeAccessTest.php`, `tests/Integration/Controller/EnvelopeActionControllerTest.php`, new `tests/Integration/Controller/EnvelopeEndpointAccessTest.php`

**Interfaces:**
- Consumes: `Roles` (Task 2), `FolderAccess` (Task 3), `EnvelopeMapper::assignFolder` (Task 1).
- Produces (fixed contract):
  - `AccessPolicy::canUseApp(string): bool`, `canSee(Envelope, string): bool`, `canAct(Envelope, string): bool`, `canEdit(Envelope, string): bool`, `isManager(string): bool`, `isNextcloudAdmin(string): bool`, `canSeeAll(string): bool`. `canRead` no longer exists.
  - `EnvelopeAccess::visible(string $uuid): ?Envelope`, `mayAct(Envelope): bool`, `mayEdit(Envelope): bool`, `mayAdminister(): bool`, `maySeeAll(): bool`, `currentUserId(): string`.
  - Every `EnvelopeActionController` route except the three downloads requires `mayAct` (403 otherwise); downloads require `visible` only.

- [ ] **Step 1: Write the failing tests**

Replace `tests/Integration/Access/AccessPolicyTest.php` with:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Access;

use OCA\Assinaturas\Access\AccessPolicy;
use OCA\Assinaturas\Access\ManagersGroup;
use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeFolder;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Folder\FolderAccess;
use OCA\Assinaturas\Folder\FolderRight;
use OCA\Assinaturas\Folder\ParticipantType;
use OCA\Assinaturas\Tests\Integration\TestFolders;
use OCA\Assinaturas\Tests\Integration\TestGroups;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\Server;
use Test\TestCase;

/**
 * The access matrix: who sees and who acts on an envelope, drafts and sent ones, with and without folders.
 *
 * @group DB
 */
final class AccessPolicyTest extends TestCase {
	use TestUsers;
	use TestGroups;
	use TestFolders;

	private const ADMIN = 'admin';

	private AccessPolicy $policy;
	private string $owner;
	private string $member;
	private EnvelopeFolder $folder;

	protected function setUp(): void {
		parent::setUp();
		$this->policy = Server::get(AccessPolicy::class);
		$this->owner = $this->memberUser();
		$this->member = $this->memberUser();
		$this->folder = $this->folder($this->owner);
	}

	protected function tearDown(): void {
		$this->deleteFoldersOf($this->createdUserIds);
		$this->deleteCreatedGroups();
		$this->deleteCreatedUsers();
		Server::get(FolderAccess::class)->forget();
		parent::tearDown();
	}

	public function testLetsGroupMembersUseTheApp(): void {
		$this->assertTrue($this->policy->canUseApp($this->member));
	}

	public function testKeepsNonMembersOut(): void {
		$this->assertFalse($this->policy->canUseApp($this->createUser()));
	}

	public function testLetsAdminsUseTheAppWithoutMembership(): void {
		$this->assertTrue($this->policy->canUseApp(self::ADMIN));
	}

	public function testLetsManagersUseTheAppWithoutMembership(): void {
		$this->assertTrue($this->policy->canUseApp($this->manager()));
	}

	public function testLetsManagersSeeEveryEnvelopeWithoutBeingNextcloudAdmins(): void {
		$manager = $this->manager();

		$this->assertTrue($this->policy->canSeeAll($manager));
		$this->assertTrue($this->policy->isManager($manager));
		$this->assertFalse($this->policy->isNextcloudAdmin($manager));
	}

	public function testTellsNextcloudAdminsApartFromManagers(): void {
		$this->assertTrue($this->policy->isNextcloudAdmin(self::ADMIN));
		$this->assertFalse($this->policy->isManager(self::ADMIN));
	}

	public function testKeepsMembersFromSeeingEveryEnvelope(): void {
		$this->assertTrue($this->policy->canSeeAll(self::ADMIN));
		$this->assertFalse($this->policy->canSeeAll($this->member));
	}

	/** @return array<string, array{EnvelopeStatus}> */
	public static function bothKinds(): array {
		return ['a draft' => [EnvelopeStatus::Draft], 'a sent envelope' => [EnvelopeStatus::Pending]];
	}

	/** @dataProvider bothKinds */
	public function testLetsTheOwnerSeeActAndEdit(EnvelopeStatus $status): void {
		$envelope = $this->envelope($status, $this->folder);

		$this->assertTrue($this->policy->canSee($envelope, $this->owner));
		$this->assertTrue($this->policy->canAct($envelope, $this->owner));
		$this->assertTrue($this->policy->canEdit($envelope, $this->owner));
	}

	public function testLetsAFormerMemberSeeButNotActOnTheirEnvelope(): void {
		$formerMember = $this->createUser();
		$envelope = $this->envelope(EnvelopeStatus::Pending, null, $formerMember);

		$this->assertTrue($this->policy->canSee($envelope, $formerMember));
		$this->assertFalse($this->policy->canAct($envelope, $formerMember));
		$this->assertFalse($this->policy->canEdit($envelope, $formerMember));
	}

	public function testKeepsAnotherMemberOutOfAnEnvelopeOutsideFolders(): void {
		$envelope = $this->envelope(EnvelopeStatus::Pending, null);

		$this->assertFalse($this->policy->canSee($envelope, $this->member));
		$this->assertFalse($this->policy->canAct($envelope, $this->member));
	}

	public function testLetsAFolderViewerSeeButNotActOnASentEnvelope(): void {
		$this->grant($this->folder, ParticipantType::User, $this->member, FolderRight::View);
		$envelope = $this->envelope(EnvelopeStatus::Pending, $this->folder);

		$this->assertTrue($this->policy->canSee($envelope, $this->member));
		$this->assertFalse($this->policy->canAct($envelope, $this->member));
		$this->assertFalse($this->policy->canEdit($envelope, $this->member));
	}

	/** @return array<string, array{FolderRight}> */
	public static function actingRights(): array {
		return ['edit' => [FolderRight::Edit], 'share' => [FolderRight::Share], 'manage' => [FolderRight::Manage]];
	}

	/** @dataProvider actingRights */
	public function testLetsAFolderEditorActOnASentEnvelope(FolderRight $right): void {
		$this->grant($this->folder, ParticipantType::User, $this->member, $right);
		$envelope = $this->envelope(EnvelopeStatus::Pending, $this->folder);

		$this->assertTrue($this->policy->canSee($envelope, $this->member));
		$this->assertTrue($this->policy->canAct($envelope, $this->member));
		$this->assertFalse($this->policy->canEdit($envelope, $this->member));
	}

	public function testLetsAGroupEditorActOnASentEnvelope(): void {
		$groupId = $this->newGroup();
		$this->addToGroup($this->member, $groupId);
		$this->grant($this->folder, ParticipantType::Group, $groupId, FolderRight::Edit);

		$this->assertTrue($this->policy->canAct($this->envelope(EnvelopeStatus::Pending, $this->folder), $this->member));
	}

	public function testLetsAnEditorOfAnAncestorActBelowIt(): void {
		$child = $this->folder($this->owner, 'Fornecedores', $this->folder);
		$this->grant($this->folder, ParticipantType::User, $this->member, FolderRight::Edit);

		$this->assertTrue($this->policy->canAct($this->envelope(EnvelopeStatus::Pending, $child), $this->member));
	}

	public function testKeepsDraftsPrivateInsideASharedFolder(): void {
		$this->grant($this->folder, ParticipantType::User, $this->member, FolderRight::Manage);
		$draft = $this->envelope(EnvelopeStatus::Draft, $this->folder);

		$this->assertFalse($this->policy->canSee($draft, $this->member));
		$this->assertFalse($this->policy->canAct($draft, $this->member));
	}

	public function testKeepsSomeoneWhoCannotUseTheAppOutDespiteAFolderRight(): void {
		$outsider = $this->createUser();
		$this->grant($this->folder, ParticipantType::User, $outsider, FolderRight::Manage);
		$envelope = $this->envelope(EnvelopeStatus::Pending, $this->folder);

		$this->assertFalse($this->policy->canSee($envelope, $outsider));
		$this->assertFalse($this->policy->canAct($envelope, $outsider));
	}

	/** @dataProvider bothKinds */
	public function testLetsAManagerSeeAndActButNotEdit(EnvelopeStatus $status): void {
		$manager = $this->manager();
		$envelope = $this->envelope($status, null);

		$this->assertTrue($this->policy->canSee($envelope, $manager));
		$this->assertTrue($this->policy->canAct($envelope, $manager));
		$this->assertFalse($this->policy->canEdit($envelope, $manager));
	}

	/** @dataProvider bothKinds */
	public function testLetsANextcloudAdminSeeAndActButNotEdit(EnvelopeStatus $status): void {
		$envelope = $this->envelope($status, null);

		$this->assertTrue($this->policy->canSee($envelope, self::ADMIN));
		$this->assertTrue($this->policy->canAct($envelope, self::ADMIN));
		$this->assertFalse($this->policy->canEdit($envelope, self::ADMIN));
	}

	private function envelope(EnvelopeStatus $status, ?EnvelopeFolder $folder, ?string $ownerUid = null): Envelope {
		$envelope = new Envelope();
		$envelope->setOwnerUid($ownerUid ?? $this->owner);
		$envelope->setStatus($status->value);
		$envelope->setFolderId($folder?->getId());
		return $envelope;
	}

	private function memberUser(): string {
		$userId = $this->createUser();
		$this->addToGroup($userId, SignersGroup::GROUP_ID);
		return $userId;
	}

	private function manager(): string {
		$userId = $this->createUser();
		$this->addToGroup($userId, ManagersGroup::GROUP_ID);
		return $userId;
	}
}
```

In `tests/Integration/Access/EnvelopeAccessTest.php`, replace every `->readable(` with `->visible(`, and append:

```php
	public function testLetsAManagerSeeAndActOnAnyEnvelope(): void {
		$this->addToGroup($this->stranger, ManagersGroup::GROUP_ID);
		self::loginAsUser($this->stranger);

		$envelope = $this->access()->visible($this->uuid);

		$this->assertNotNull($envelope);
		$this->assertTrue($this->access()->mayAct($envelope));
		$this->assertFalse($this->access()->mayEdit($envelope));
	}
```

Rename `testLetsAnAdminReadAndAdministerButNotEdit` to `testLetsAnAdminSeeActAndAdministerButNotEdit` and add `$this->assertTrue($this->access()->mayAct($envelope));` after its `assertNotNull`.

In `tests/Integration/Controller/EnvelopeActionControllerTest.php`, replace the two admin tests (managers and admins now act on every envelope):

```php
	public function testLetsAnAdminActOnSomeoneElsesEnvelope(): void {
		$admin = $this->createUser();
		Server::get(IGroupManager::class)->get('admin')->addUser(Server::get(IUserManager::class)->get($admin));
		self::loginAsUser($admin);

		$response = $this->controller()->cancel($this->uuid, 'Valores errados');

		$this->assertSame(Http::STATUS_CONFLICT, $response->getStatus());
		$this->assertSame('not_cancellable', $response->getData()['error']);
	}

	public function testLetsAnAdminAskForSomeoneElsesLink(): void {
		$admin = $this->createUser();
		Server::get(IGroupManager::class)->get('admin')->addUser(Server::get(IUserManager::class)->get($admin));
		self::loginAsUser($admin);

		$response = $this->controller()->signLink($this->uuid, 999999999);

		$this->assertNotContains($response->getData()['error'] ?? null, ['forbidden', 'not_found']);
	}
```

`tests/Integration/Controller/EnvelopeEndpointAccessTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Controller;

use Closure;
use OCA\Assinaturas\Access\ManagersGroup;
use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Controller\AdminController;
use OCA\Assinaturas\Controller\EnvelopeActionController;
use OCA\Assinaturas\Controller\EnvelopeController;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Folder\FolderAccess;
use OCA\Assinaturas\Folder\FolderRight;
use OCA\Assinaturas\Folder\ParticipantType;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\SentEnvelopes;
use OCA\Assinaturas\Tests\Integration\TestFolders;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\Response;
use OCP\Server;
use Test\TestCase;

/**
 * Every envelope route goes through AccessPolicy: someone who may not see the envelope gets 404, someone who sees
 * it without the route's right gets 403, and a right holder reaches the route's own checks (its own error code).
 *
 * @group DB
 */
final class EnvelopeEndpointAccessTest extends TestCase {
	use TestUsers;
	use TestFolders;
	use EnvelopeCleanup;
	use ZapSignDoubles;
	use SentEnvelopes;

	private const UNKNOWN_ID = 999999999;

	private string $owner;
	private string $viewer;
	private string $editor;
	private string $stranger;
	private Envelope $sent;
	private Envelope $draft;

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->owner = $this->memberUser();
		$this->viewer = $this->memberUser();
		$this->editor = $this->memberUser();
		$this->stranger = $this->memberUser();
		$folder = $this->folder($this->owner);
		$this->grant($folder, ParticipantType::User, $this->viewer, FolderRight::View);
		$this->grant($folder, ParticipantType::User, $this->editor, FolderRight::Edit);
		$this->sent = $this->sentEnvelope($this->owner);
		$file = $this->writeFile($this->owner, 'Rascunho.pdf', self::minimalPdf());
		$this->draft = Server::get(EnvelopeDrafts::class)->create($this->owner, 'Rascunho', [$file->getId()]);
		Server::get(EnvelopeMapper::class)->assignFolder($this->sent->getId(), $folder->getId());
		Server::get(EnvelopeMapper::class)->assignFolder($this->draft->getId(), $folder->getId());
	}

	protected function tearDown(): void {
		self::logout();
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteFoldersOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		Server::get(FolderAccess::class)->forget();
		parent::tearDown();
	}

	/** @return array<string, array{class-string, Closure}> routes that change a draft: the owner's alone */
	public static function editRoutes(): array {
		return [
			'update' => [EnvelopeController::class, static fn (EnvelopeController $controller, string $uuid): Response => $controller->update($uuid, 'Novo título')],
			'replace signers' => [EnvelopeController::class, static fn (EnvelopeController $controller, string $uuid): Response => $controller->replaceSigners($uuid, [])],
			'replace documents' => [EnvelopeController::class, static fn (EnvelopeController $controller, string $uuid): Response => $controller->replaceDocuments($uuid, [])],
			'source' => [EnvelopeController::class, static fn (EnvelopeController $controller, string $uuid): Response => $controller->source($uuid, self::UNKNOWN_ID)],
			'replace fields' => [EnvelopeController::class, static fn (EnvelopeController $controller, string $uuid): Response => $controller->replaceFields($uuid, self::UNKNOWN_ID, [], [])],
			'delete' => [EnvelopeController::class, static fn (EnvelopeController $controller, string $uuid): Response => $controller->destroy($uuid)],
			'send' => [EnvelopeController::class, static fn (EnvelopeController $controller, string $uuid): Response => $controller->send($uuid)],
		];
	}

	/** @return array<string, array{class-string, Closure, string}> routes that act on a sent envelope, each with the code its own checks answer */
	public static function actionRoutes(): array {
		return [
			'cancel' => [EnvelopeActionController::class, static fn (EnvelopeActionController $controller, string $uuid): Response => $controller->cancel($uuid, ''), 'cancel_reason_invalid'],
			'discard' => [EnvelopeActionController::class, static fn (EnvelopeActionController $controller, string $uuid): Response => $controller->discard($uuid), 'not_discardable'],
			'reopen' => [EnvelopeActionController::class, static fn (EnvelopeActionController $controller, string $uuid): Response => $controller->reopen($uuid), 'not_reopenable'],
			'deadline' => [EnvelopeActionController::class, static fn (EnvelopeActionController $controller, string $uuid): Response => $controller->extendDeadline($uuid, '2020-01-01'), 'deadline_invalid'],
			'remind' => [EnvelopeActionController::class, static fn (EnvelopeActionController $controller, string $uuid): Response => $controller->remind($uuid, self::UNKNOWN_ID), 'signer_not_found'],
			'correct email' => [EnvelopeActionController::class, static fn (EnvelopeActionController $controller, string $uuid): Response => $controller->correctEmail($uuid, self::UNKNOWN_ID, 'not-an-email'), 'signer_email_invalid'],
			'sign link' => [EnvelopeActionController::class, static fn (EnvelopeActionController $controller, string $uuid): Response => $controller->signLink($uuid, self::UNKNOWN_ID), 'signer_not_found'],
		];
	}

	/** @return array<string, array{class-string, Closure, string}> downloads: whoever sees the envelope */
	public static function downloadRoutes(): array {
		return [
			'signed copy' => [EnvelopeActionController::class, static fn (EnvelopeActionController $controller, string $uuid): Response => $controller->downloadSigned($uuid, self::UNKNOWN_ID), 'document_not_found'],
			'original' => [EnvelopeActionController::class, static fn (EnvelopeActionController $controller, string $uuid): Response => $controller->downloadOriginal($uuid, self::UNKNOWN_ID), 'document_not_found'],
		];
	}

	/** @return array<string, array{class-string, Closure}> every route that names an envelope */
	public static function everyRoute(): array {
		$routes = [
			'show' => [EnvelopeController::class, static fn (EnvelopeController $controller, string $uuid): Response => $controller->show($uuid)],
			'activity report' => [EnvelopeActionController::class, static fn (EnvelopeActionController $controller, string $uuid): Response => $controller->downloadActivityReport($uuid)],
			...self::editRoutes(),
		];
		foreach ([...self::actionRoutes(), ...self::downloadRoutes()] as $name => [$controller, $call]) {
			$routes[$name] = [$controller, $call];
		}
		return $routes;
	}

	/**
	 * @dataProvider everyRoute
	 * @param class-string $controller
	 */
	public function testHidesEveryRouteFromAMemberWithoutAccess(string $controller, Closure $call): void {
		self::loginAsUser($this->stranger);

		$response = $call(Server::get($controller), $this->sent->getUuid());

		$this->assertSame(Http::STATUS_NOT_FOUND, $response->getStatus());
		$this->assertSame('not_found', self::errorOf($response));
	}

	/**
	 * @dataProvider everyRoute
	 * @param class-string $controller
	 */
	public function testHidesADraftFiledInASharedFolder(string $controller, Closure $call): void {
		self::loginAsUser($this->editor);

		$response = $call(Server::get($controller), $this->draft->getUuid());

		$this->assertSame(Http::STATUS_NOT_FOUND, $response->getStatus());
	}

	/**
	 * @dataProvider editRoutes
	 * @param class-string $controller
	 */
	public function testForbidsDraftEditingToAFolderEditor(string $controller, Closure $call): void {
		self::loginAsUser($this->editor);

		$response = $call(Server::get($controller), $this->sent->getUuid());

		$this->assertSame(Http::STATUS_FORBIDDEN, $response->getStatus());
	}

	/**
	 * @dataProvider actionRoutes
	 * @param class-string $controller
	 */
	public function testForbidsEveryActionToAFolderViewer(string $controller, Closure $call): void {
		self::loginAsUser($this->viewer);

		$response = $call(Server::get($controller), $this->sent->getUuid());

		$this->assertSame(Http::STATUS_FORBIDDEN, $response->getStatus());
		$this->assertSame('forbidden', self::errorOf($response));
	}

	/**
	 * @dataProvider actionRoutes
	 * @param class-string $controller
	 */
	public function testLetsAFolderEditorReachEachAction(string $controller, Closure $call, string $ownCode): void {
		self::loginAsUser($this->editor);

		$response = $call(Server::get($controller), $this->sent->getUuid());

		$this->assertSame($ownCode, self::errorOf($response));
	}

	/**
	 * @dataProvider downloadRoutes
	 * @param class-string $controller
	 */
	public function testLetsAFolderViewerReachEachDownload(string $controller, Closure $call, string $ownCode): void {
		self::loginAsUser($this->viewer);

		$response = $call(Server::get($controller), $this->sent->getUuid());

		$this->assertSame($ownCode, self::errorOf($response));
	}

	public function testLetsAFolderViewerReadTheEnvelope(): void {
		self::loginAsUser($this->viewer);

		$this->assertSame(Http::STATUS_OK, Server::get(EnvelopeController::class)->show($this->sent->getUuid())->getStatus());
	}

	public function testKeepsAManagerOutOfTheAdminDeletion(): void {
		$manager = $this->createUser();
		$this->addToGroup($manager, ManagersGroup::GROUP_ID);
		self::loginAsUser($manager);

		$this->assertSame(Http::STATUS_FORBIDDEN, Server::get(AdminController::class)->destroy($this->sent->getUuid())->getStatus());
	}

	private static function errorOf(Response $response): ?string {
		return $response instanceof JSONResponse ? ($response->getData()['error'] ?? null) : null;
	}

	private function memberUser(): string {
		$userId = $this->createUser();
		$this->addToGroup($userId, SignersGroup::GROUP_ID);
		return $userId;
	}
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `tests/env/phpunit.sh --filter 'AccessPolicyTest|EnvelopeAccessTest|EnvelopeActionControllerTest|EnvelopeEndpointAccessTest'`
Expected: FAIL — `Call to undefined method …AccessPolicy::canSee()`, `…EnvelopeAccess::visible()`, folder viewers getting 404 instead of 200, admins getting 403.

- [ ] **Step 3: Write the final access classes**

Replace `lib/Access/AccessPolicy.php` with:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Access;

use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Folder\FolderAccess;
use OCA\Assinaturas\Folder\FolderRight;

/**
 * The one place that decides who sees and who acts on an envelope. Every envelope route goes through it.
 *
 * Enforced in the app, not through Nextcloud's "limit to groups": core treats group-limited
 * apps as disabled for anonymous requests, which would 404 the ZapSign webhook.
 */
final class AccessPolicy {
	public function __construct(
		private Roles $roles,
		private FolderAccess $folderAccess,
	) {
	}

	public function canUseApp(string $userId): bool {
		return $this->roles->canUseApp($userId);
	}

	public function isManager(string $userId): bool {
		return $this->roles->isManager($userId);
	}

	public function isNextcloudAdmin(string $userId): bool {
		return $this->roles->isNextcloudAdmin($userId);
	}

	/** Nextcloud admins and company managers see and act on every envelope and folder. */
	public function canSeeAll(string $userId): bool {
		return $this->roles->canSeeAll($userId);
	}

	/** The owner, admins, managers, and anyone with Ver on the folder of an envelope that was sent. */
	public function canSee(Envelope $envelope, string $userId): bool {
		if ($envelope->getOwnerUid() === $userId || $this->canSeeAll($userId)) {
			return true;
		}
		return $this->sharedRight($envelope, $userId)->atLeast(FolderRight::View);
	}

	/** The owner who can use the app, admins, managers, and anyone with Editar on the folder of an envelope that was sent. */
	public function canAct(Envelope $envelope, string $userId): bool {
		if ($this->canEdit($envelope, $userId) || $this->canSeeAll($userId)) {
			return true;
		}
		return $this->sharedRight($envelope, $userId)->atLeast(FolderRight::Edit);
	}

	/** Draft editing (the wizard) stays with the owner. */
	public function canEdit(Envelope $envelope, string $userId): bool {
		return $envelope->getOwnerUid() === $userId && $this->canUseApp($userId);
	}

	/** What a folder grants on the envelope: nothing for a draft, which stays private to its owner until it is sent. */
	private function sharedRight(Envelope $envelope, string $userId): FolderRight {
		$folderId = $envelope->getFolderId();
		if ($folderId === null || $envelope->statusValue() === EnvelopeStatus::Draft) {
			return FolderRight::None;
		}
		return $this->folderAccess->rightOn($folderId, $userId);
	}
}
```

Replace `lib/Access/EnvelopeAccess.php` with:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Access;

use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\IUserSession;

/** Loads envelopes for the signed-in user. Hidden and unknown envelopes look the same (null), so existence never leaks. */
final class EnvelopeAccess {
	public function __construct(
		private IUserSession $userSession,
		private AccessPolicy $accessPolicy,
		private EnvelopeMapper $envelopeMapper,
	) {
	}

	public function currentUserId(): string {
		return $this->userSession->getUser()?->getUID() ?? '';
	}

	public function visible(string $uuid): ?Envelope {
		try {
			$envelope = $this->envelopeMapper->findByUuid($uuid);
		} catch (DoesNotExistException) {
			return null;
		}
		return $this->accessPolicy->canSee($envelope, $this->currentUserId()) ? $envelope : null;
	}

	public function mayAct(Envelope $envelope): bool {
		return $this->accessPolicy->canAct($envelope, $this->currentUserId());
	}

	public function mayEdit(Envelope $envelope): bool {
		return $this->accessPolicy->canEdit($envelope, $this->currentUserId());
	}

	/** The admin routes (connection status, counters, deleting any envelope) stay with Nextcloud admins. */
	public function mayAdminister(): bool {
		return $this->accessPolicy->isNextcloudAdmin($this->currentUserId());
	}

	public function maySeeAll(): bool {
		return $this->accessPolicy->canSeeAll($this->currentUserId());
	}
}
```

In `lib/Controller/EnvelopeController.php` and `lib/Controller/AdminController.php`, replace every `$this->access->readable(` with `$this->access->visible(`.

In `lib/Controller/EnvelopeActionController.php`:
- replace every `$this->access->readable(` with `$this->access->visible(`;
- in `acting()`, replace `if (!$this->access->mayEdit($envelope)) {` with `if (!$this->access->mayAct($envelope)) {`;
- replace the class docblock with `/** Actions on sent envelopes and their downloads. Whoever may act (owner, managers, admins, folder editors) acts; whoever sees the envelope downloads. Every rejection carries our own code. */`;
- replace the `acting()` docblock first line with `Higher-order guard: the envelope must be visible (else 404) and the current user must be allowed to act on it (else 403); rejections become their own status with our code.`

- [ ] **Step 4: Run them and watch them pass**

Run: `tests/env/phpunit.sh --filter 'AccessPolicyTest|EnvelopeAccessTest|EnvelopeActionControllerTest|EnvelopeEndpointAccessTest|EnvelopeControllerTest|AdminControllerTest'`
Expected: `OK`.

- [ ] **Step 5: Run the task gates and commit**

Run each: `composer run lint`, `tests/env/phpunit.sh`. Then `grep -rn "canRead\|readable(" lib tests` prints nothing.

```bash
git add lib/Access lib/Controller tests/Integration
git commit -m "feat(access): decide seeing and acting on envelopes through folders and roles"
```

---

### Task 5: Dashboard scopes, folder listing and the viewer's context

**Files:**
- Create: `lib/Db/EnvelopeScope.php`, `lib/Db/EnvelopeVisibility.php`, `lib/Folder/FolderPaths.php`
- Modify: `lib/Db/EnvelopeSearch.php`, `lib/Db/EnvelopeMapper.php` (`applyConditions`), `lib/Controller/EnvelopeController.php` (`index`), `lib/Api/EnvelopeDetails.php`
- Modify tests: `tests/Integration/Db/EnvelopeMapperSearchTest.php`, `tests/Integration/Draft/EnvelopeDraftsCreationTest.php`, `tests/Integration/Controller/EnvelopeControllerTest.php`
- Test: `tests/Integration/Controller/EnvelopeListingScopesTest.php`

**Interfaces:**
- Consumes: `FolderAccess` (Task 3), `AccessPolicy` (Task 4).
- Produces:
  - `enum EnvelopeScope: string { Mine='mine'; Shared='shared'; Company='company' }` (`OCA\Assinaturas\Db`).
  - `EnvelopeVisibility::everyone()`, `::ownedBy(string)`, `::sharedWith(string $userId, list<int> $folderIds)`, `::inFolder(int $folderId, string $viewerUid, bool $seesDrafts)`.
  - `new EnvelopeSearch(EnvelopeVisibility $visibility, EnvelopeFilter, ?string $text, ?int $fileId, EnvelopeSort, int $offset, int $limit)`.
  - `FolderPaths::placement(int $folderId, string $viewerUid): ?array{id: int, title: string, path: list<array{id: int, title: string}>}`; `FolderPaths::visibleParentId(EnvelopeFolder, array<int, FolderRight>): ?int` (static).
  - `GET /api/v1/envelopes?scope=mine|shared|company&folderId=<int>`: unknown scope → 422 `list_query_invalid`; a folder the user cannot view → 404 `folder_not_found`; `folderId` lists that folder's own envelopes (not subfolders'), others' drafts hidden unless `canSeeAll`; `scope=company` without `canSeeAll` lists the user's own.
  - Every summary and detail gains `ownerDisplayName: string`, `folderId: int|null`, `permissions: {act: bool, edit: bool, remove: bool}` (`remove` = Nextcloud admin deletion); the detail also gains `folder: {id, title, path: [{id, title}]} | null`.

- [ ] **Step 1: Write the failing tests**

`tests/Integration/Controller/EnvelopeListingScopesTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Controller;

use OCA\Assinaturas\Access\ManagersGroup;
use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Controller\EnvelopeController;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeFolder;
use OCA\Assinaturas\Db\EnvelopeFolderMapper;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Folder\FolderAccess;
use OCA\Assinaturas\Folder\FolderRight;
use OCA\Assinaturas\Folder\ParticipantType;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\SentEnvelopes;
use OCA\Assinaturas\Tests\Integration\TestFolders;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\AppFramework\Http;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class EnvelopeListingScopesTest extends TestCase {
	use TestUsers;
	use TestFolders;
	use EnvelopeCleanup;
	use ZapSignDoubles;
	use SentEnvelopes;

	private const EVERYTHING = 100;

	private string $owner;
	private string $colleague;
	private EnvelopeFolder $shared;

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->owner = $this->memberUser('Maria Souza');
		$this->colleague = $this->memberUser('João Lima');
		$this->shared = $this->folder($this->owner, 'Contratos');
		$this->grant($this->shared, ParticipantType::User, $this->colleague, FolderRight::View);
	}

	protected function tearDown(): void {
		self::logout();
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteFoldersOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		Server::get(FolderAccess::class)->forget();
		parent::tearDown();
	}

	public function testListsOnlyTheEnvelopesSharedThroughFolders(): void {
		$sentInFolder = $this->filed($this->sentEnvelope($this->owner), $this->shared);
		$draftInFolder = $this->filed($this->draft($this->owner), $this->shared);
		$sentOutside = $this->sentEnvelope($this->owner);
		$colleaguesOwn = $this->filed($this->sentEnvelope($this->colleague), $this->shared);
		self::loginAsUser($this->colleague);

		$listing = $this->controller()->index(scope: 'shared', perPage: self::EVERYTHING)->getData();

		$this->assertSame([$sentInFolder->getUuid()], self::uuids($listing));
		$this->assertNotContains($draftInFolder->getUuid(), self::uuids($listing));
		$this->assertNotContains($sentOutside->getUuid(), self::uuids($listing));
		$this->assertNotContains($colleaguesOwn->getUuid(), self::uuids($listing));
		$this->assertSame(1, $listing['counts']['all']);
	}

	public function testListsTheOwnEnvelopesOfAFolderButNotThoseOfItsSubfolders(): void {
		$child = $this->folder($this->owner, 'Fornecedores', $this->shared);
		$direct = $this->filed($this->sentEnvelope($this->owner), $this->shared);
		$below = $this->filed($this->sentEnvelope($this->owner), $child);
		self::loginAsUser($this->colleague);

		$uuids = self::uuids($this->controller()->index(perPage: self::EVERYTHING, folderId: $this->shared->getId())->getData());

		$this->assertSame([$direct->getUuid()], $uuids);
		$this->assertNotContains($below->getUuid(), $uuids);
	}

	public function testHidesTheDraftsOfOthersInAFolderButShowsTheViewersOwn(): void {
		$othersDraft = $this->filed($this->draft($this->owner), $this->shared);
		$this->grant($this->shared, ParticipantType::User, $this->colleague, FolderRight::Edit);
		$ownDraft = $this->filed($this->draft($this->colleague), $this->shared);
		self::loginAsUser($this->colleague);

		$uuids = self::uuids($this->controller()->index(perPage: self::EVERYTHING, folderId: $this->shared->getId())->getData());

		$this->assertContains($ownDraft->getUuid(), $uuids);
		$this->assertNotContains($othersDraft->getUuid(), $uuids);
	}

	public function testShowsAManagerEveryDraftOfAFolder(): void {
		$draft = $this->filed($this->draft($this->owner), $this->shared);
		self::loginAsUser($this->manager());

		$uuids = self::uuids($this->controller()->index(perPage: self::EVERYTHING, folderId: $this->shared->getId())->getData());

		$this->assertContains($draft->getUuid(), $uuids);
	}

	public function testAnswersNotFoundForAFolderTheUserCannotView(): void {
		$private = $this->folder($this->owner, 'Privada');
		self::loginAsUser($this->colleague);

		$response = $this->controller()->index(folderId: $private->getId());

		$this->assertSame(Http::STATUS_NOT_FOUND, $response->getStatus());
		$this->assertSame('folder_not_found', $response->getData()['error']);
	}

	public function testListsEveryEnvelopeOnTheCompanyScopeForAManager(): void {
		$first = $this->sentEnvelope($this->owner);
		$second = $this->draft($this->colleague);
		self::loginAsUser($this->manager());

		$uuids = self::uuids($this->controller()->index(scope: 'company', perPage: self::EVERYTHING)->getData());

		$this->assertContains($first->getUuid(), $uuids);
		$this->assertContains($second->getUuid(), $uuids);
	}

	public function testListsOnlyTheirOwnForAMemberAskingForTheCompany(): void {
		$theirs = $this->sentEnvelope($this->owner);
		$own = $this->draft($this->colleague);
		self::loginAsUser($this->colleague);

		$uuids = self::uuids($this->controller()->index(scope: 'company', perPage: self::EVERYTHING)->getData());

		$this->assertSame([$own->getUuid()], $uuids);
		$this->assertNotContains($theirs->getUuid(), $uuids);
	}

	public function testRejectsAnUnknownScope(): void {
		self::loginAsUser($this->colleague);

		$response = $this->controller()->index(scope: 'all');

		$this->assertSame(Http::STATUS_UNPROCESSABLE_ENTITY, $response->getStatus());
		$this->assertSame('list_query_invalid', $response->getData()['error']);
	}

	public function testNamesTheOwnerFolderAndPermissionsOfEachListedEnvelope(): void {
		$filed = $this->filed($this->sentEnvelope($this->owner), $this->shared);
		self::loginAsUser($this->colleague);

		$summary = $this->controller()->index(scope: 'shared')->getData()['envelopes'][0];

		$this->assertSame($filed->getUuid(), $summary['uuid']);
		$this->assertSame('Maria Souza', $summary['ownerDisplayName']);
		$this->assertSame($this->shared->getId(), $summary['folderId']);
		$this->assertSame(['act' => false, 'edit' => false, 'remove' => false], $summary['permissions']);
	}

	public function testShowsTheFolderPathTheViewerMaySee(): void {
		$child = $this->folder($this->owner, 'Fornecedores', $this->shared);
		$grandchild = $this->folder($this->owner, 'Limpeza', $child);
		$hiddenParent = $this->folder($this->owner, 'Diretoria');
		$this->shared->setParentId($hiddenParent->getId());
		Server::get(EnvelopeFolderMapper::class)->update($this->shared);
		Server::get(FolderAccess::class)->forget();
		$filed = $this->filed($this->sentEnvelope($this->owner), $grandchild);
		self::loginAsUser($this->colleague);

		$detail = $this->controller()->show($filed->getUuid())->getData();

		$this->assertSame([
			'id' => $grandchild->getId(),
			'title' => 'Limpeza',
			'path' => [['id' => $this->shared->getId(), 'title' => 'Contratos'], ['id' => $child->getId(), 'title' => 'Fornecedores']],
		], $detail['folder']);
		$this->assertSame(['act' => false, 'edit' => false, 'remove' => false], $detail['permissions']);
	}

	public function testShowsNoFolderForAnEnvelopeOutsideFolders(): void {
		$own = $this->draft($this->colleague);
		self::loginAsUser($this->colleague);

		$detail = $this->controller()->show($own->getUuid())->getData();

		$this->assertNull($detail['folder']);
		$this->assertNull($detail['folderId']);
		$this->assertSame(['act' => true, 'edit' => true, 'remove' => false], $detail['permissions']);
	}

	private function filed(Envelope $envelope, EnvelopeFolder $folder): Envelope {
		Server::get(EnvelopeMapper::class)->assignFolder($envelope->getId(), $folder->getId());
		return $envelope;
	}

	private function draft(string $ownerUid): Envelope {
		$file = $this->writeFile($ownerUid, 'Rascunho ' . bin2hex(random_bytes(3)) . '.pdf', self::minimalPdf());
		return Server::get(EnvelopeDrafts::class)->create($ownerUid, 'Rascunho', [$file->getId()]);
	}

	private function memberUser(string $displayName): string {
		$userId = $this->createUser($displayName);
		$this->addToGroup($userId, SignersGroup::GROUP_ID);
		return $userId;
	}

	private function manager(): string {
		$userId = $this->createUser('Gestora');
		$this->addToGroup($userId, ManagersGroup::GROUP_ID);
		return $userId;
	}

	private function controller(): EnvelopeController {
		return Server::get(EnvelopeController::class);
	}

	/**
	 * @param array{envelopes: list<array{uuid: string}>} $listing
	 * @return list<string>
	 */
	private static function uuids(array $listing): array {
		return array_map(fn (array $envelope): string => $envelope['uuid'], $listing['envelopes']);
	}
}
```

Adjust the existing tests to the new search shape and scope names:
- `tests/Integration/Db/EnvelopeMapperSearchTest.php`: add `use OCA\Assinaturas\Db\EnvelopeVisibility;` and in `searchFor()` replace `new EnvelopeSearch($ownerUid, …` with `new EnvelopeSearch($ownerUid === null ? EnvelopeVisibility::everyone() : EnvelopeVisibility::ownedBy($ownerUid), $filter, $text, $fileId, $sort, $offset, $limit)`.
- `tests/Integration/Draft/EnvelopeDraftsCreationTest.php`: add the same `use`, and in `everything()` replace `new EnvelopeSearch($ownerUid, …` with `new EnvelopeSearch($ownerUid === null ? EnvelopeVisibility::everyone() : EnvelopeVisibility::ownedBy($ownerUid), EnvelopeFilter::All, null, null, EnvelopeSort::Recent, 0, self::EVERYTHING_LIMIT)`.
- `tests/Integration/Controller/EnvelopeControllerTest.php`: in `testListsMineUnlessAnAdminAsksForEveryone` replace the three `index('all')`/`index('mine')` calls' `'all'` with `'company'`; rename `testListForNonAdminIgnoresScopeAll` to `testListForAMemberIgnoresTheCompanyScope` and replace `scope: 'all'` with `scope: 'company'` in it.

- [ ] **Step 2: Run them and watch them fail**

Run: `tests/env/phpunit.sh --filter 'EnvelopeListingScopesTest|EnvelopeMapperSearchTest|EnvelopeDraftsCreationTest|EnvelopeControllerTest'`
Expected: FAIL — `Class "OCA\Assinaturas\Db\EnvelopeVisibility" not found` and `Unknown named parameter $folderId`.

- [ ] **Step 3: Write the scope and visibility types**

`lib/Db/EnvelopeScope.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

/** Whose envelopes the dashboard lists: the user's own, those shared with them through folders, or the whole company's. */
enum EnvelopeScope: string {
	case Mine = 'mine';
	case Shared = 'shared';
	case Company = 'company';
}
```

`lib/Db/EnvelopeVisibility.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

/** Which envelopes a search may return, already decided by the access rules. Each null condition is not applied. */
final class EnvelopeVisibility {
	/**
	 * @param list<int>|null $folderIds null = in any folder or none; [] = no envelope at all
	 * @param string|null $draftsOnlyOf drafts are kept only when this user owns them
	 */
	private function __construct(
		public readonly ?string $ownerUid,
		public readonly ?string $excludedOwnerUid,
		public readonly ?array $folderIds,
		public readonly ?string $draftsOnlyOf,
	) {
	}

	public static function everyone(): self {
		return new self(null, null, null, null);
	}

	public static function ownedBy(string $userId): self {
		return new self($userId, null, null, null);
	}

	/** @param list<int> $folderIds the folders the user can view */
	public static function sharedWith(string $userId, array $folderIds): self {
		return new self(null, $userId, $folderIds, $userId);
	}

	public static function inFolder(int $folderId, string $viewerUid, bool $seesDrafts): self {
		return new self(null, null, [$folderId], $seesDrafts ? null : $viewerUid);
	}
}
```

Replace `lib/Db/EnvelopeSearch.php` with:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

/** One dashboard list request, already validated. */
final class EnvelopeSearch {
	public function __construct(
		public readonly EnvelopeVisibility $visibility,
		public readonly EnvelopeFilter $filter,
		public readonly ?string $text,
		public readonly ?int $fileId,
		public readonly EnvelopeSort $sort,
		public readonly int $offset,
		public readonly int $limit,
	) {
	}
}
```

In `lib/Db/EnvelopeMapper.php`, in `applyConditions()`, replace

```php
		if ($search->ownerUid !== null) {
			$query->andWhere($query->expr()->eq(self::ALIAS . '.owner_uid', $query->createNamedParameter($search->ownerUid)));
		}
```

with `$this->applyVisibility($query, $search->visibility);`, and add after `applyConditions()`:

```php
	private function applyVisibility(IQueryBuilder $query, EnvelopeVisibility $visibility): void {
		if ($visibility->ownerUid !== null) {
			$query->andWhere($query->expr()->eq(self::ALIAS . '.owner_uid', $query->createNamedParameter($visibility->ownerUid)));
		}
		if ($visibility->excludedOwnerUid !== null) {
			$query->andWhere($query->expr()->neq(self::ALIAS . '.owner_uid', $query->createNamedParameter($visibility->excludedOwnerUid)));
		}
		if ($visibility->folderIds !== null) {
			$noEnvelope = $query->expr()->isNull(self::ALIAS . '.id');
			$query->andWhere($visibility->folderIds === []
				? $noEnvelope
				: $query->expr()->in(self::ALIAS . '.folder_id', $query->createNamedParameter($visibility->folderIds, IQueryBuilder::PARAM_INT_ARRAY)));
		}
		if ($visibility->draftsOnlyOf !== null) {
			$query->andWhere($query->expr()->orX(
				$query->expr()->neq(self::ALIAS . '.status', $query->createNamedParameter(EnvelopeStatus::Draft->value)),
				$query->expr()->eq(self::ALIAS . '.owner_uid', $query->createNamedParameter($visibility->draftsOnlyOf)),
			));
		}
	}
```

- [ ] **Step 4: Write `FolderPaths`**

`lib/Folder/FolderPaths.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Folder;

use OCA\Assinaturas\Db\EnvelopeFolder;
use OCA\Assinaturas\Db\EnvelopeFolderMapper;

/** Where a folder sits, as far as the viewer may see: hidden ancestors are left out, never named. */
final class FolderPaths {
	public function __construct(
		private EnvelopeFolderMapper $folderMapper,
		private FolderAccess $folderAccess,
	) {
	}

	/**
	 * @return array{id: int, title: string, path: list<array{id: int, title: string}>}|null the folder and its
	 *     visible ancestors, top first; null when the folder is gone
	 */
	public function placement(int $folderId, string $viewerUid): ?array {
		$folders = $this->folderMapper->findAllById();
		$folder = $folders[$folderId] ?? null;
		if ($folder === null) {
			return null;
		}
		$rights = $this->folderAccess->rightsFor($viewerUid);
		$path = [];
		$visited = [$folderId];
		$ancestorId = self::visibleParentId($folder, $rights);
		while ($ancestorId !== null && isset($folders[$ancestorId]) && !in_array($ancestorId, $visited, true)) {
			$visited[] = $ancestorId;
			array_unshift($path, ['id' => $ancestorId, 'title' => $folders[$ancestorId]->getTitle()]);
			$ancestorId = self::visibleParentId($folders[$ancestorId], $rights);
		}
		return ['id' => $folderId, 'title' => $folder->getTitle(), 'path' => $path];
	}

	/**
	 * @param array<int, FolderRight> $rights the viewer's rights, from FolderAccess::rightsFor()
	 * @return int|null the parent, or null at the top or when the viewer cannot see the parent
	 */
	public static function visibleParentId(EnvelopeFolder $folder, array $rights): ?int {
		$parentId = $folder->getParentId();
		return $parentId !== null && isset($rights[$parentId]) ? $parentId : null;
	}
}
```

- [ ] **Step 5: Wire the listing route and the viewer's context**

In `lib/Controller/EnvelopeController.php`:
- add imports `OCA\Assinaturas\Db\EnvelopeScope`, `OCA\Assinaturas\Db\EnvelopeVisibility`, `OCA\Assinaturas\Folder\FolderAccess`, `OCA\Assinaturas\Folder\FolderRight`;
- delete `private const SCOPE_EVERYONE = 'all';`;
- add `private FolderAccess $folderAccess,` to the constructor after `private AccessPolicy $accessPolicy,`;
- replace `index()` with:

```php
	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'GET', url: '/api/v1/envelopes')]
	public function index(string $scope = 'mine', string $filter = 'all', string $search = '', string $sort = 'recent', int $page = 1, int $perPage = self::DEFAULT_PER_PAGE, ?int $fileId = null, ?int $folderId = null): JSONResponse {
		$userId = $this->access->currentUserId();
		$parsedScope = EnvelopeScope::tryFrom($scope);
		$parsedFilter = EnvelopeFilter::tryFrom($filter);
		$parsedSort = EnvelopeSort::tryFrom($sort);
		$text = trim($search);
		$isValid = $parsedScope !== null && $parsedFilter !== null && $parsedSort !== null
			&& $page >= 1 && $page <= intdiv(PHP_INT_MAX, EnvelopeLimits::PER_PAGE_MAX)
			&& $perPage >= 1 && $perPage <= EnvelopeLimits::PER_PAGE_MAX
			&& mb_strlen($text) <= EnvelopeLimits::SEARCH_MAX_LENGTH;
		if (!$isValid) {
			return new JSONResponse(['error' => 'list_query_invalid', 'message' => 'Unknown scope, filter or sort, or page, perPage or search out of range'], Http::STATUS_UNPROCESSABLE_ENTITY);
		}
		if ($folderId !== null && !$this->folderAccess->rightOn($folderId, $userId)->atLeast(FolderRight::View)) {
			return new JSONResponse(['error' => 'folder_not_found', 'message' => 'Folder not found'], Http::STATUS_NOT_FOUND);
		}
		$found = $this->drafts->search(new EnvelopeSearch(
			$this->visibility($parsedScope, $folderId, $userId),
			$parsedFilter,
			$text === '' ? null : $text,
			$fileId,
			$parsedSort,
			($page - 1) * $perPage,
			$perPage,
		));
		return new JSONResponse($this->details->listing($found, $page, $perPage));
	}

	/** A folder view lists that folder (others' drafts hidden); otherwise the scope decides. The company scope needs canSeeAll. */
	private function visibility(EnvelopeScope $scope, ?int $folderId, string $userId): EnvelopeVisibility {
		$seesAll = $this->accessPolicy->canSeeAll($userId);
		if ($folderId !== null) {
			return EnvelopeVisibility::inFolder($folderId, $userId, $seesAll);
		}
		return match ($scope) {
			EnvelopeScope::Mine => EnvelopeVisibility::ownedBy($userId),
			EnvelopeScope::Shared => EnvelopeVisibility::sharedWith($userId, $this->folderAccess->visibleFolderIds($userId)),
			EnvelopeScope::Company => $seesAll ? EnvelopeVisibility::everyone() : EnvelopeVisibility::ownedBy($userId),
		};
	}
```

Replace `lib/Api/EnvelopeDetails.php` with:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Api;

use OCA\Assinaturas\Access\AccessPolicy;
use OCA\Assinaturas\Db\Document;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EventMapper;
use OCA\Assinaturas\Db\FieldMapper;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Folder\FolderPaths;
use OCP\Files\File;
use OCP\Files\IRootFolder;
use OCP\Files\NotPermittedException;
use OCP\IUserManager;
use OCP\IUserSession;

/** Loads what an envelope's JSON shapes need, so every route answers with the same data, and adds what the viewer may do. */
final class EnvelopeDetails {
	public function __construct(
		private EnvelopeMapper $envelopeMapper,
		private DocumentMapper $documentMapper,
		private SignerMapper $signerMapper,
		private FieldMapper $fieldMapper,
		private EventMapper $eventMapper,
		private EnvelopeView $view,
		private IRootFolder $rootFolder,
		private IUserManager $userManager,
		private IUserSession $userSession,
		private AccessPolicy $accessPolicy,
		private FolderPaths $folderPaths,
	) {
	}

	/**
	 * Counts the documents and loads the signers for the whole page in two queries, not per envelope.
	 *
	 * @param array{envelopes: list<Envelope>, total: int, counts: array<string, int>} $found
	 * @return array<string, mixed>
	 */
	public function listing(array $found, int $page, int $perPage): array {
		$ids = array_map(fn (Envelope $envelope): int => $envelope->getId(), $found['envelopes']);
		$documents = $this->documentMapper->countByEnvelopes($ids);
		$signers = $this->signerMapper->findByEnvelopes($ids);
		$viewerUid = $this->viewerUid();
		return [
			'envelopes' => array_map(fn (Envelope $envelope): array => $this->view->summary(
				$envelope,
				$documents[$envelope->getId()] ?? 0,
				$signers[$envelope->getId()] ?? [],
			) + $this->viewerContext($envelope, $viewerUid), $found['envelopes']),
			'total' => $found['total'],
			'page' => $page,
			'perPage' => $perPage,
			'counts' => $found['counts'],
		];
	}

	/** @return array<string, mixed> */
	public function detail(Envelope $envelope): array {
		$current = $this->envelopeMapper->findById($envelope->getId());
		$documents = $this->documentMapper->findByEnvelope($current->getId());
		$fieldsByDocument = [];
		foreach ($documents as $document) {
			$fieldsByDocument[$document->getId()] = $this->fieldMapper->findByDocument($document->getId());
		}
		$viewerUid = $this->viewerUid();
		$folderId = $current->getFolderId();
		return $this->view->detail(
			$current,
			$documents,
			$this->signerMapper->findByEnvelope($current->getId()),
			$fieldsByDocument,
			$this->eventMapper->findByEnvelope($current->getId()),
			$this->driveSizes($current, $documents),
		) + $this->viewerContext($current, $viewerUid) + [
			'folder' => $folderId === null ? null : $this->folderPaths->placement($folderId, $viewerUid),
		];
	}

	/** @return array{ownerDisplayName: string, folderId: int|null, permissions: array{act: bool, edit: bool, remove: bool}} */
	private function viewerContext(Envelope $envelope, string $viewerUid): array {
		$ownerUid = $envelope->getOwnerUid();
		return [
			'ownerDisplayName' => $this->userManager->getDisplayName($ownerUid) ?? $ownerUid,
			'folderId' => $envelope->getFolderId(),
			'permissions' => [
				'act' => $this->accessPolicy->canAct($envelope, $viewerUid),
				'edit' => $this->accessPolicy->canEdit($envelope, $viewerUid),
				'remove' => $this->accessPolicy->isNextcloudAdmin($viewerUid),
			],
		];
	}

	private function viewerUid(): string {
		return $this->userSession->getUser()?->getUID() ?? '';
	}

	/**
	 * @param list<Document> $documents
	 * @return array<int, int|null> the current Drive size per document id; null when the file is gone
	 */
	private function driveSizes(Envelope $envelope, array $documents): array {
		$unknownSizes = array_fill_keys(array_map(fn (Document $document): int => $document->getId(), $documents), null);
		if (!$this->userManager->userExists($envelope->getOwnerUid())) {
			return $unknownSizes;
		}
		try {
			$userFolder = $this->rootFolder->getUserFolder($envelope->getOwnerUid());
		} catch (NotPermittedException) {
			return $unknownSizes;
		}
		$sizes = [];
		foreach ($documents as $document) {
			$file = $userFolder->getFirstNodeById($document->getSourceFileId());
			$sizes[$document->getId()] = $file instanceof File ? $file->getSize() : null;
		}
		return $sizes;
	}
}
```

If Plan 7 changed `detail()` or `listing()` in this file (for example to pass the signers' `saveToContacts`), keep its change and add only the `$viewerUid`, `+ $this->viewerContext(…)` and `'folder'` parts shown above.

- [ ] **Step 6: Run them and watch them pass**

Run: `tests/env/phpunit.sh --filter 'EnvelopeListingScopesTest|EnvelopeMapperSearchTest|EnvelopeDraftsCreationTest|EnvelopeControllerTest|EnvelopeActionControllerTest'`
Expected: `OK`.

- [ ] **Step 7: Run the task gates and commit**

Run each: `composer run lint`, `tests/env/phpunit.sh`.

```bash
git add lib/Db lib/Folder/FolderPaths.php lib/Controller/EnvelopeController.php lib/Api/EnvelopeDetails.php tests/Integration
git commit -m "feat(dashboard): list shared, company and folder scopes with each viewer's permissions"
```

---

### Task 6: Folder tree API

**Files:**
- Create: `lib/Folder/FolderRejected.php`, `lib/Folder/FolderTree.php`, `lib/Folder/FolderJson.php`, `lib/Controller/FolderController.php`
- Test: `tests/Integration/Folder/FolderTreeTest.php`, `tests/Integration/Controller/FolderControllerTest.php`

**Interfaces:**
- Consumes: `FolderAccess`, `FolderPaths`, `Roles`, mappers.
- Produces:
  - `FolderRejected` (`errorCode`, `httpStatus`, `toResponse(): JSONResponse`) with named constructors `notFound()` (404 `folder_not_found`), `forbidden()` (403 `forbidden`), `titleInvalid()` (422 `folder_title_invalid`), `cycle()` (422 `folder_cycle`), `ownerInvalid()` (422 `owner_invalid`), `participantNotFound()` (422 `participant_not_found`), `participantDuplicate()` (409 `participant_duplicate`), `rightInvalid()` (422 `right_invalid`), `entryNotFound()` (404 `access_entry_not_found`).
  - `FolderTree::MAX_TITLE_LENGTH = 255`; `visible(string $userId): list<EnvelopeFolder>`, `create(string $userId, string $title, ?int $parentId): EnvelopeFolder`, `rename(int, string $userId, string $title)`, `move(int, string $userId, ?int $parentId)`, `delete(int, string $userId): void`, `transfer(int, string $actorUid, string $newOwnerUid)`, `requireRight(int $folderId, string $userId, FolderRight $needed): EnvelopeFolder`. All throw `FolderRejected`.
  - `FolderJson::folder(EnvelopeFolder, string $viewerUid): array{id, title, parentId, ownerUid, ownerDisplayName, sortOrder, right}`.
  - Routes: `GET /api/v1/folders` → `{"folders": [folder…]}`; `POST /api/v1/folders` `{title, parentId?}` → 201 folder; `PUT /api/v1/folders/{folderId}` `{title}` → folder; `PUT /api/v1/folders/{folderId}/parent` `{parentId: int|null}` → folder; `PUT /api/v1/folders/{folderId}/owner` `{ownerUid}` → folder; `DELETE /api/v1/folders/{folderId}` → `{"deleted": true}`.

- [ ] **Step 1: Write the failing tests**

`tests/Integration/Folder/FolderTreeTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Folder;

use OCA\Assinaturas\Access\ManagersGroup;
use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Db\EnvelopeFolderMapper;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\FolderAclMapper;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Folder\FolderAccess;
use OCA\Assinaturas\Folder\FolderRejected;
use OCA\Assinaturas\Folder\FolderRight;
use OCA\Assinaturas\Folder\FolderTree;
use OCA\Assinaturas\Folder\ParticipantType;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestFolders;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class FolderTreeTest extends TestCase {
	use TestUsers;
	use TestFolders;
	use EnvelopeCleanup;

	private string $owner;
	private string $member;

	protected function setUp(): void {
		parent::setUp();
		$this->owner = $this->memberUser();
		$this->member = $this->memberUser();
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteFoldersOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		Server::get(FolderAccess::class)->forget();
		parent::tearDown();
	}

	public function testCreatesATopLevelFolderOwnedByItsCreator(): void {
		$folder = $this->tree()->create($this->member, '  Contratos  ', null);

		$this->assertSame('Contratos', $folder->getTitle());
		$this->assertSame($this->member, $folder->getOwnerUid());
		$this->assertNull($folder->getParentId());
		$this->assertSame(FolderRight::Manage, Server::get(FolderAccess::class)->rightOn($folder->getId(), $this->member));
	}

	/** @return array<string, array{string}> */
	public static function invalidTitles(): array {
		return ['empty' => [''], 'blank' => ['   '], 'too long' => [str_repeat('a', 256)]];
	}

	/** @dataProvider invalidTitles */
	public function testRefusesAnInvalidTitle(string $title): void {
		$this->assertRejected('folder_title_invalid', fn () => $this->tree()->create($this->member, $title, null));
	}

	public function testRefusesFoldersToSomeoneWhoCannotUseTheApp(): void {
		$this->assertRejected('forbidden', fn () => $this->tree()->create($this->createUser(), 'Contratos', null));
	}

	public function testCreatesASubfolderWithEditOnTheParent(): void {
		$parent = $this->folder($this->owner);
		$this->grant($parent, ParticipantType::User, $this->member, FolderRight::Edit);

		$child = $this->tree()->create($this->member, 'Fornecedores', $parent->getId());

		$this->assertSame($parent->getId(), $child->getParentId());
	}

	public function testRefusesASubfolderToAViewer(): void {
		$parent = $this->folder($this->owner);
		$this->grant($parent, ParticipantType::User, $this->member, FolderRight::View);

		$this->assertRejected('forbidden', fn () => $this->tree()->create($this->member, 'Fornecedores', $parent->getId()));
	}

	public function testHidesAParentTheUserCannotSee(): void {
		$parent = $this->folder($this->owner);

		$this->assertRejected('folder_not_found', fn () => $this->tree()->create($this->member, 'Fornecedores', $parent->getId()));
	}

	public function testRenamesWithEditAndRefusesAViewer(): void {
		$folder = $this->folder($this->owner);
		$this->grant($folder, ParticipantType::User, $this->member, FolderRight::Edit);

		$this->assertSame('Novos contratos', $this->tree()->rename($folder->getId(), $this->member, 'Novos contratos')->getTitle());

		$viewer = $this->memberUser();
		$this->grant($folder, ParticipantType::User, $viewer, FolderRight::View);
		$this->assertRejected('forbidden', fn () => $this->tree()->rename($folder->getId(), $viewer, 'Outro'));
	}

	public function testMovesAFolderItManagesIntoAFolderItEdits(): void {
		$moving = $this->folder($this->member, 'Fornecedores');
		$target = $this->folder($this->owner, 'Contratos');
		$this->grant($target, ParticipantType::User, $this->member, FolderRight::Edit);

		$moved = $this->tree()->move($moving->getId(), $this->member, $target->getId());

		$this->assertSame($target->getId(), $moved->getParentId());
	}

	public function testMovesAFolderToTheTopLevel(): void {
		$parent = $this->folder($this->owner, 'Contratos');
		$child = $this->folder($this->owner, 'Fornecedores', $parent);

		$this->assertNull($this->tree()->move($child->getId(), $this->owner, null)->getParentId());
	}

	public function testRefusesMovingAFolderIntoItselfOrBelowItself(): void {
		$parent = $this->folder($this->owner, 'Contratos');
		$child = $this->folder($this->owner, 'Fornecedores', $parent);
		$grandchild = $this->folder($this->owner, 'Limpeza', $child);

		$this->assertRejected('folder_cycle', fn () => $this->tree()->move($parent->getId(), $this->owner, $parent->getId()));
		$this->assertRejected('folder_cycle', fn () => $this->tree()->move($parent->getId(), $this->owner, $grandchild->getId()));
	}

	public function testRefusesMovingWithoutManage(): void {
		$folder = $this->folder($this->owner);
		$this->grant($folder, ParticipantType::User, $this->member, FolderRight::Share);

		$this->assertRejected('forbidden', fn () => $this->tree()->move($folder->getId(), $this->member, null));
	}

	public function testDeletingHandsSubfoldersAndEnvelopesToTheParent(): void {
		$parent = $this->folder($this->owner, 'Contratos');
		$deleted = $this->folder($this->owner, 'Fornecedores', $parent);
		$grandchild = $this->folder($this->owner, 'Limpeza', $deleted);
		$this->grant($deleted, ParticipantType::User, $this->member, FolderRight::Edit);
		$envelope = $this->draftIn($deleted->getId());

		$this->tree()->delete($deleted->getId(), $this->owner);

		$folders = Server::get(EnvelopeFolderMapper::class)->findAllById();
		$this->assertArrayNotHasKey($deleted->getId(), $folders);
		$this->assertSame($parent->getId(), $folders[$grandchild->getId()]->getParentId());
		$this->assertSame($parent->getId(), Server::get(EnvelopeMapper::class)->findById($envelope)->getFolderId());
		$this->assertSame([], Server::get(FolderAclMapper::class)->findByFolder($deleted->getId()));
	}

	public function testDeletingATopLevelFolderLeavesItsEnvelopesWithoutFolder(): void {
		$folder = $this->folder($this->owner);
		$envelope = $this->draftIn($folder->getId());

		$this->tree()->delete($folder->getId(), $this->owner);

		$this->assertNull(Server::get(EnvelopeMapper::class)->findById($envelope)->getFolderId());
	}

	public function testRefusesDeletingWithoutManage(): void {
		$folder = $this->folder($this->owner);
		$this->grant($folder, ParticipantType::User, $this->member, FolderRight::Share);

		$this->assertRejected('forbidden', fn () => $this->tree()->delete($folder->getId(), $this->member));
	}

	public function testLetsAManagerHandAFolderToAnotherMember(): void {
		$folder = $this->folder($this->owner);
		$manager = $this->createUser();
		$this->addToGroup($manager, ManagersGroup::GROUP_ID);

		$this->assertSame($this->member, $this->tree()->transfer($folder->getId(), $manager, $this->member)->getOwnerUid());
	}

	public function testRefusesAHandOverByTheOwnerWhoIsNotAManager(): void {
		$folder = $this->folder($this->owner);

		$this->assertRejected('forbidden', fn () => $this->tree()->transfer($folder->getId(), $this->owner, $this->member));
	}

	public function testRefusesAHandOverToSomeoneWhoCannotUseTheApp(): void {
		$folder = $this->folder($this->owner);
		$manager = $this->createUser();
		$this->addToGroup($manager, ManagersGroup::GROUP_ID);

		$this->assertRejected('owner_invalid', fn () => $this->tree()->transfer($folder->getId(), $manager, $this->createUser()));
	}

	public function testListsTheFoldersTheUserCanSee(): void {
		$shared = $this->folder($this->owner, 'Compartilhada');
		$hidden = $this->folder($this->owner, 'Privada');
		$own = $this->folder($this->member, 'Minha');
		$this->grant($shared, ParticipantType::User, $this->member, FolderRight::View);

		$ids = array_map(fn ($folder): int => $folder->getId(), $this->tree()->visible($this->member));

		$this->assertContains($shared->getId(), $ids);
		$this->assertContains($own->getId(), $ids);
		$this->assertNotContains($hidden->getId(), $ids);
	}

	private function draftIn(int $folderId): int {
		$file = $this->writeFile($this->owner, 'Contrato ' . bin2hex(random_bytes(3)) . '.pdf', self::minimalPdf());
		$envelope = Server::get(EnvelopeDrafts::class)->create($this->owner, 'Contrato', [$file->getId()]);
		Server::get(EnvelopeMapper::class)->assignFolder($envelope->getId(), $folderId);
		return $envelope->getId();
	}

	private function assertRejected(string $expectedCode, callable $action): void {
		try {
			$action();
			$this->fail('Expected the folder request to be refused with ' . $expectedCode);
		} catch (FolderRejected $rejection) {
			$this->assertSame($expectedCode, $rejection->errorCode);
		}
	}

	private function memberUser(): string {
		$userId = $this->createUser();
		$this->addToGroup($userId, SignersGroup::GROUP_ID);
		return $userId;
	}

	private function tree(): FolderTree {
		return Server::get(FolderTree::class);
	}
}
```

`tests/Integration/Controller/FolderControllerTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Controller;

use Closure;
use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Controller\FolderController;
use OCA\Assinaturas\Db\EnvelopeFolder;
use OCA\Assinaturas\Folder\FolderAccess;
use OCA\Assinaturas\Folder\FolderRight;
use OCA\Assinaturas\Folder\ParticipantType;
use OCA\Assinaturas\Tests\Integration\TestFolders;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class FolderControllerTest extends TestCase {
	use TestUsers;
	use TestFolders;

	private string $owner;
	private string $member;
	private EnvelopeFolder $folder;

	protected function setUp(): void {
		parent::setUp();
		$this->owner = $this->memberUser('Maria Souza');
		$this->member = $this->memberUser('João Lima');
		$this->folder = $this->folder($this->owner, 'Contratos');
	}

	protected function tearDown(): void {
		self::logout();
		$this->deleteFoldersOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		Server::get(FolderAccess::class)->forget();
		parent::tearDown();
	}

	public function testListsTheFoldersWithTheViewersRightAndOnlyVisibleParents(): void {
		$child = $this->folder($this->owner, 'Fornecedores', $this->folder);
		$this->grant($child, ParticipantType::User, $this->member, FolderRight::Edit);
		self::loginAsUser($this->member);

		$folders = $this->controller()->index()->getData()['folders'];

		$this->assertSame([[
			'id' => $child->getId(),
			'title' => 'Fornecedores',
			'parentId' => null,
			'ownerUid' => $this->owner,
			'ownerDisplayName' => 'Maria Souza',
			'sortOrder' => $child->getSortOrder(),
			'right' => 'edit',
		]], $folders);
	}

	public function testCreatesAFolderAndAnswersCreated(): void {
		self::loginAsUser($this->member);

		$response = $this->controller()->create('Minha pasta');

		$this->assertSame(Http::STATUS_CREATED, $response->getStatus());
		$this->assertSame('Minha pasta', $response->getData()['title']);
		$this->assertSame('manage', $response->getData()['right']);
	}

	public function testAnswersForbiddenToANonMember(): void {
		self::loginAsUser($this->createUser());

		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller()->index()->getStatus());
		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller()->create('Contratos')->getStatus());
	}

	public function testAnswersUnprocessableForACycle(): void {
		$child = $this->folder($this->owner, 'Fornecedores', $this->folder);
		self::loginAsUser($this->owner);

		$response = $this->controller()->move($this->folder->getId(), $child->getId());

		$this->assertSame(Http::STATUS_UNPROCESSABLE_ENTITY, $response->getStatus());
		$this->assertSame('folder_cycle', $response->getData()['error']);
	}

	public function testDeletesAFolder(): void {
		self::loginAsUser($this->owner);

		$this->assertSame(['deleted' => true], $this->controller()->destroy($this->folder->getId())->getData());
	}

	/** @return array<string, array{Closure}> every route that names a folder */
	public static function folderRoutes(): array {
		return [
			'rename' => [static fn (FolderController $controller, int $folderId): JSONResponse => $controller->rename($folderId, 'Outro')],
			'move' => [static fn (FolderController $controller, int $folderId): JSONResponse => $controller->move($folderId, null)],
			'transfer' => [static fn (FolderController $controller, int $folderId): JSONResponse => $controller->transfer($folderId, 'ninguem')],
			'delete' => [static fn (FolderController $controller, int $folderId): JSONResponse => $controller->destroy($folderId)],
			'subfolder' => [static fn (FolderController $controller, int $folderId): JSONResponse => $controller->create('Sub', $folderId)],
		];
	}

	/** @dataProvider folderRoutes */
	public function testHidesEveryFolderRouteFromAMemberWithoutAccess(Closure $call): void {
		self::loginAsUser($this->member);

		$response = $call($this->controller(), $this->folder->getId());

		$this->assertSame(Http::STATUS_NOT_FOUND, $response->getStatus());
		$this->assertSame('folder_not_found', $response->getData()['error']);
	}

	/** @dataProvider folderRoutes */
	public function testForbidsEveryFolderRouteToAViewer(Closure $call): void {
		$this->grant($this->folder, ParticipantType::User, $this->member, FolderRight::View);
		self::loginAsUser($this->member);

		$response = $call($this->controller(), $this->folder->getId());

		$this->assertSame(Http::STATUS_FORBIDDEN, $response->getStatus());
		$this->assertSame('forbidden', $response->getData()['error']);
	}

	private function memberUser(string $displayName): string {
		$userId = $this->createUser($displayName);
		$this->addToGroup($userId, SignersGroup::GROUP_ID);
		return $userId;
	}

	private function controller(): FolderController {
		return Server::get(FolderController::class);
	}
}
```

Note: the transfer route answers 403 for anyone who is not a manager, so for the member without access it must still answer 404 first. `FolderTree::transfer()` therefore checks `requireRight(…, Manage)` before the manager check (Step 3 does that).

- [ ] **Step 2: Run them and watch them fail**

Run: `tests/env/phpunit.sh --filter 'FolderTreeTest|FolderControllerTest'`
Expected: FAIL with `Class "OCA\Assinaturas\Folder\FolderTree" not found`.

- [ ] **Step 3: Write `FolderRejected`, `FolderTree`, `FolderJson`**

`lib/Folder/FolderRejected.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Folder;

use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;

/** A folder request the access rules or the input refused. The code is stable for the UI; the message is for developers. */
final class FolderRejected extends \RuntimeException {
	public function __construct(
		public readonly string $errorCode,
		string $message,
		public readonly int $httpStatus,
	) {
		parent::__construct($message);
	}

	public static function notFound(): self {
		return new self('folder_not_found', 'Folder not found', Http::STATUS_NOT_FOUND);
	}

	public static function forbidden(): self {
		return new self('forbidden', 'You are not allowed to do this', Http::STATUS_FORBIDDEN);
	}

	public static function titleInvalid(): self {
		return new self('folder_title_invalid', 'The folder title is empty or longer than 255 characters', Http::STATUS_UNPROCESSABLE_ENTITY);
	}

	public static function cycle(): self {
		return new self('folder_cycle', 'A folder cannot move into itself or one of its subfolders', Http::STATUS_UNPROCESSABLE_ENTITY);
	}

	public static function ownerInvalid(): self {
		return new self('owner_invalid', 'The new owner cannot use the app', Http::STATUS_UNPROCESSABLE_ENTITY);
	}

	public static function participantNotFound(): self {
		return new self('participant_not_found', 'No such user or group', Http::STATUS_UNPROCESSABLE_ENTITY);
	}

	public static function participantDuplicate(): self {
		return new self('participant_duplicate', 'The folder is already shared with this user or group', Http::STATUS_CONFLICT);
	}

	public static function rightInvalid(): self {
		return new self('right_invalid', 'Unknown right', Http::STATUS_UNPROCESSABLE_ENTITY);
	}

	public static function entryNotFound(): self {
		return new self('access_entry_not_found', 'Access entry not found', Http::STATUS_NOT_FOUND);
	}

	public function toResponse(): JSONResponse {
		return new JSONResponse(['error' => $this->errorCode, 'message' => $this->getMessage()], $this->httpStatus);
	}
}
```

`lib/Folder/FolderTree.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Folder;

use OCA\Assinaturas\Access\Roles;
use OCA\Assinaturas\Db\EnvelopeFolder;
use OCA\Assinaturas\Db\EnvelopeFolderMapper;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\FolderAclMapper;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IDBConnection;

/** Creates, renames, moves, deletes and hands over folders, each behind the right it needs. */
final class FolderTree {
	public const MAX_TITLE_LENGTH = 255;

	public function __construct(
		private EnvelopeFolderMapper $folderMapper,
		private FolderAclMapper $aclMapper,
		private EnvelopeMapper $envelopeMapper,
		private FolderAccess $folderAccess,
		private Roles $roles,
		private ITimeFactory $timeFactory,
		private IDBConnection $connection,
	) {
	}

	/**
	 * @return list<EnvelopeFolder> every folder the user can view, in display order
	 * @throws FolderRejected
	 */
	public function visible(string $userId): array {
		$this->requireApp($userId);
		$rights = $this->folderAccess->rightsFor($userId);
		return array_values(array_filter($this->folderMapper->findAllById(), fn (EnvelopeFolder $folder): bool => isset($rights[$folder->getId()])));
	}

	/** @throws FolderRejected */
	public function create(string $userId, string $title, ?int $parentId): EnvelopeFolder {
		$this->requireApp($userId);
		if ($parentId !== null) {
			$this->requireRight($parentId, $userId, FolderRight::Edit);
		}
		$now = $this->timeFactory->getTime();
		$folder = new EnvelopeFolder();
		$folder->setTitle(self::validTitle($title));
		$folder->setParentId($parentId);
		$folder->setOwnerUid($userId);
		$folder->setSortOrder($this->folderMapper->nextSortOrder($parentId));
		$folder->setCreatedAt($now);
		$folder->setUpdatedAt($now);
		$created = $this->folderMapper->insert($folder);
		$this->folderAccess->forget();
		return $created;
	}

	/** @throws FolderRejected */
	public function rename(int $folderId, string $userId, string $title): EnvelopeFolder {
		$folder = $this->requireRight($folderId, $userId, FolderRight::Edit);
		$folder->setTitle(self::validTitle($title));
		$folder->setUpdatedAt($this->timeFactory->getTime());
		return $this->folderMapper->update($folder);
	}

	/**
	 * Moves a folder under another one (or to the top level, null). Needs Manage on the folder and Edit on the target.
	 *
	 * @throws FolderRejected
	 */
	public function move(int $folderId, string $userId, ?int $parentId): EnvelopeFolder {
		$folder = $this->requireRight($folderId, $userId, FolderRight::Manage);
		if ($parentId !== null) {
			$this->requireRight($parentId, $userId, FolderRight::Edit);
			if ($this->isWithin($parentId, $folderId)) {
				throw FolderRejected::cycle();
			}
		}
		$folder->setParentId($parentId);
		$folder->setSortOrder($this->folderMapper->nextSortOrder($parentId));
		$folder->setUpdatedAt($this->timeFactory->getTime());
		$moved = $this->folderMapper->update($folder);
		$this->folderAccess->forget();
		return $moved;
	}

	/**
	 * Deletes a folder. Its subfolders and envelopes move to its parent (or to "Sem pasta" at the top); envelopes are
	 * never deleted with a folder.
	 *
	 * @throws FolderRejected
	 */
	public function delete(int $folderId, string $userId): void {
		$folder = $this->requireRight($folderId, $userId, FolderRight::Manage);
		$parentId = $folder->getParentId();
		$this->inTransaction(function () use ($folder, $parentId): void {
			$this->folderMapper->reparentChildren($folder->getId(), $parentId, $this->timeFactory->getTime());
			$this->envelopeMapper->refileFolder($folder->getId(), $parentId);
			$this->aclMapper->deleteByFolder($folder->getId());
			$this->folderMapper->delete($folder);
		});
		$this->folderAccess->forget();
	}

	/**
	 * Hands a folder to another member, e.g. when its owner leaves. Managers and Nextcloud admins only.
	 *
	 * @throws FolderRejected
	 */
	public function transfer(int $folderId, string $actorUid, string $newOwnerUid): EnvelopeFolder {
		$folder = $this->requireRight($folderId, $actorUid, FolderRight::Manage);
		if (!$this->roles->canSeeAll($actorUid)) {
			throw FolderRejected::forbidden();
		}
		if (!$this->roles->canUseApp($newOwnerUid)) {
			throw FolderRejected::ownerInvalid();
		}
		$folder->setOwnerUid($newOwnerUid);
		$folder->setUpdatedAt($this->timeFactory->getTime());
		$transferred = $this->folderMapper->update($folder);
		$this->folderAccess->forget();
		return $transferred;
	}

	/**
	 * The folder, when the user holds at least $needed on it. Below View it answers not found, so existence never
	 * leaks; below $needed, forbidden.
	 *
	 * @throws FolderRejected
	 */
	public function requireRight(int $folderId, string $userId, FolderRight $needed): EnvelopeFolder {
		$right = $this->folderAccess->rightOn($folderId, $userId);
		if (!$right->atLeast(FolderRight::View)) {
			throw FolderRejected::notFound();
		}
		if (!$right->atLeast($needed)) {
			throw FolderRejected::forbidden();
		}
		try {
			return $this->folderMapper->findById($folderId);
		} catch (DoesNotExistException) {
			throw FolderRejected::notFound();
		}
	}

	/** @throws FolderRejected */
	private function requireApp(string $userId): void {
		if (!$this->roles->canUseApp($userId)) {
			throw FolderRejected::forbidden();
		}
	}

	/** Whether $candidateId is $ancestorId itself or somewhere below it. */
	private function isWithin(int $candidateId, int $ancestorId): bool {
		$folders = $this->folderMapper->findAllById();
		$visited = [];
		$current = $candidateId;
		while ($current !== null && isset($folders[$current]) && !in_array($current, $visited, true)) {
			if ($current === $ancestorId) {
				return true;
			}
			$visited[] = $current;
			$current = $folders[$current]->getParentId();
		}
		return false;
	}

	/** @throws FolderRejected */
	private static function validTitle(string $title): string {
		$trimmed = trim($title);
		if ($trimmed === '' || mb_strlen($trimmed) > self::MAX_TITLE_LENGTH) {
			throw FolderRejected::titleInvalid();
		}
		return $trimmed;
	}

	/**
	 * @param callable(): void $work
	 */
	private function inTransaction(callable $work): void {
		$this->connection->beginTransaction();
		try {
			$work();
			$this->connection->commit();
		} catch (\Throwable $failure) {
			$this->connection->rollBack();
			throw $failure;
		}
	}
}
```

`lib/Folder/FolderJson.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Folder;

use OCA\Assinaturas\Db\EnvelopeFolder;
use OCP\IUserManager;

/** The API's folder shapes, as one viewer sees them: their right, and the parent only when they can see it. */
final class FolderJson {
	public function __construct(
		private FolderAccess $folderAccess,
		private IUserManager $userManager,
	) {
	}

	/** @return array{id: int, title: string, parentId: int|null, ownerUid: string, ownerDisplayName: string, sortOrder: int, right: string} */
	public function folder(EnvelopeFolder $folder, string $viewerUid): array {
		$rights = $this->folderAccess->rightsFor($viewerUid);
		return [
			'id' => $folder->getId(),
			'title' => $folder->getTitle(),
			'parentId' => FolderPaths::visibleParentId($folder, $rights),
			'ownerUid' => $folder->getOwnerUid(),
			'ownerDisplayName' => $this->displayName($folder->getOwnerUid()),
			'sortOrder' => $folder->getSortOrder(),
			'right' => ($rights[$folder->getId()] ?? FolderRight::None)->apiName(),
		];
	}

	public function displayName(string $userId): string {
		return $this->userManager->getDisplayName($userId) ?? $userId;
	}
}
```

- [ ] **Step 4: Write `FolderController`**

`lib/Controller/FolderController.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Controller;

use OCA\Assinaturas\Access\EnvelopeAccess;
use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\Db\EnvelopeFolder;
use OCA\Assinaturas\Folder\FolderJson;
use OCA\Assinaturas\Folder\FolderRejected;
use OCA\Assinaturas\Folder\FolderTree;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\FrontpageRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

/** Folder routes. FolderTree checks every right; each refusal carries our JSON error shape. */
final class FolderController extends Controller {
	public function __construct(
		IRequest $request,
		private EnvelopeAccess $access,
		private FolderTree $tree,
		private FolderJson $json,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'GET', url: '/api/v1/folders')]
	public function index(): JSONResponse {
		return $this->handling(fn (string $userId): JSONResponse => new JSONResponse([
			'folders' => array_map(fn (EnvelopeFolder $folder): array => $this->json->folder($folder, $userId), $this->tree->visible($userId)),
		]));
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'POST', url: '/api/v1/folders')]
	public function create(string $title, ?int $parentId = null): JSONResponse {
		return $this->handling(fn (string $userId): JSONResponse => new JSONResponse(
			$this->json->folder($this->tree->create($userId, $title, $parentId), $userId),
			Http::STATUS_CREATED,
		));
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'PUT', url: '/api/v1/folders/{folderId}')]
	public function rename(int $folderId, string $title): JSONResponse {
		return $this->handling(fn (string $userId): JSONResponse => new JSONResponse(
			$this->json->folder($this->tree->rename($folderId, $userId, $title), $userId),
		));
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'PUT', url: '/api/v1/folders/{folderId}/parent')]
	public function move(int $folderId, ?int $parentId = null): JSONResponse {
		return $this->handling(fn (string $userId): JSONResponse => new JSONResponse(
			$this->json->folder($this->tree->move($folderId, $userId, $parentId), $userId),
		));
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'PUT', url: '/api/v1/folders/{folderId}/owner')]
	public function transfer(int $folderId, string $ownerUid): JSONResponse {
		return $this->handling(fn (string $userId): JSONResponse => new JSONResponse(
			$this->json->folder($this->tree->transfer($folderId, $userId, $ownerUid), $userId),
		));
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'DELETE', url: '/api/v1/folders/{folderId}')]
	public function destroy(int $folderId): JSONResponse {
		return $this->handling(function (string $userId) use ($folderId): JSONResponse {
			$this->tree->delete($folderId, $userId);
			return new JSONResponse(['deleted' => true]);
		});
	}

	/**
	 * Higher-order guard: runs the request as the current user and turns folder refusals into error responses.
	 *
	 * @param callable(string): JSONResponse $request
	 */
	private function handling(callable $request): JSONResponse {
		try {
			return $request($this->access->currentUserId());
		} catch (FolderRejected $rejection) {
			return $rejection->toResponse();
		}
	}
}
```

- [ ] **Step 5: Run them and watch them pass**

Run: `tests/env/phpunit.sh --filter 'FolderTreeTest|FolderControllerTest'`
Expected: `OK`.

- [ ] **Step 6: Run the task gates and commit**

Run each: `composer run lint`, `tests/env/phpunit.sh`.

```bash
git add lib/Folder lib/Controller/FolderController.php tests/Integration
git commit -m "feat(folders): create, rename, move, delete and hand over folders"
```

---

### Task 7: Sharing API and access cleanup on deleted users and groups

**Files:**
- Create: `lib/Folder/FolderSharing.php`, `lib/Controller/FolderSharingController.php`, `lib/Listener/ParticipantDeletedListener.php`
- Modify: `lib/Folder/FolderJson.php` (access entries), `lib/AppInfo/Application.php` (listeners)
- Test: `tests/Integration/Folder/FolderSharingTest.php`, `tests/Integration/Controller/FolderSharingControllerTest.php`, `tests/Integration/Listener/ParticipantDeletedListenerTest.php`

**Interfaces:**
- Consumes: `FolderTree::requireRight`, `FolderAccess`, `Roles`, `SignersGroup`.
- Produces:
  - `FolderSharing::accessList(int $folderId, string $userId): array{owner: string, entries: list<FolderAcl>}`, `add(int $folderId, string $userId, string $type, string $participantId, string $right): FolderAcl`, `change(int $folderId, int $entryId, string $userId, string $right): FolderAcl`, `remove(int $folderId, int $entryId, string $userId): void`, `sharees(string $userId, string $search): list<array{type: string, id: string, displayName: string}>`.
  - `FolderJson::accessEntry(FolderAcl): array{id: int, type: string, participantId: string, displayName: string, right: string}`.
  - Routes: `GET /api/v1/folders/{folderId}/access` → `{"owner": {"uid", "displayName"}, "entries": [entry…]}`; `POST /api/v1/folders/{folderId}/access` `{type: "user"|"group", participantId, right: "view"|"edit"|"share"|"manage"}` → 201 entry; `PUT /api/v1/folders/{folderId}/access/{entryId}` `{right}` → entry; `DELETE /api/v1/folders/{folderId}/access/{entryId}` → `{"deleted": true}`; `GET /api/v1/sharees?search=<text>` → `{"sharees": [{type, id, displayName}…]}` (members of `assinaturas` except the searcher, then groups; at most 20 of each).

- [ ] **Step 1: Write the failing tests**

`tests/Integration/Folder/FolderSharingTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Folder;

use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Db\EnvelopeFolder;
use OCA\Assinaturas\Folder\FolderAccess;
use OCA\Assinaturas\Folder\FolderRejected;
use OCA\Assinaturas\Folder\FolderRight;
use OCA\Assinaturas\Folder\FolderSharing;
use OCA\Assinaturas\Folder\ParticipantType;
use OCA\Assinaturas\Tests\Integration\TestFolders;
use OCA\Assinaturas\Tests\Integration\TestGroups;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class FolderSharingTest extends TestCase {
	use TestUsers;
	use TestGroups;
	use TestFolders;

	private string $owner;
	private string $member;
	private EnvelopeFolder $folder;

	protected function setUp(): void {
		parent::setUp();
		$this->owner = $this->memberUser('Maria Souza');
		$this->member = $this->memberUser('João Lima');
		$this->folder = $this->folder($this->owner);
	}

	protected function tearDown(): void {
		$this->deleteFoldersOf($this->createdUserIds);
		$this->deleteCreatedGroups();
		$this->deleteCreatedUsers();
		Server::get(FolderAccess::class)->forget();
		parent::tearDown();
	}

	public function testSharesAFolderWithAMemberAtTheChosenRight(): void {
		$entry = $this->sharing()->add($this->folder->getId(), $this->owner, 'user', $this->member, 'edit');

		$this->assertSame(FolderRight::Edit, $entry->right());
		$this->assertSame(FolderRight::Edit, Server::get(FolderAccess::class)->rightOn($this->folder->getId(), $this->member));
	}

	public function testSharesAFolderWithAGroup(): void {
		$groupId = $this->newGroup();
		$this->addToGroup($this->member, $groupId);

		$this->sharing()->add($this->folder->getId(), $this->owner, 'group', $groupId, 'view');

		$this->assertSame(FolderRight::View, Server::get(FolderAccess::class)->rightOn($this->folder->getId(), $this->member));
	}

	public function testRefusesSharingWithoutTheShareRight(): void {
		$this->grant($this->folder, ParticipantType::User, $this->member, FolderRight::Edit);
		$colleague = $this->memberUser('Ana Lima');

		$this->assertRejected('forbidden', fn () => $this->sharing()->add($this->folder->getId(), $this->member, 'user', $colleague, 'view'));
	}

	public function testRefusesGrantingMoreThanTheSharerHolds(): void {
		$this->grant($this->folder, ParticipantType::User, $this->member, FolderRight::Share);
		$colleague = $this->memberUser('Ana Lima');

		$this->assertRejected('forbidden', fn () => $this->sharing()->add($this->folder->getId(), $this->member, 'user', $colleague, 'manage'));
		$this->assertSame(FolderRight::Share, $this->sharing()->add($this->folder->getId(), $this->member, 'user', $colleague, 'share')->right());
	}

	public function testLetsASharerChangeAndRemoveEntriesUpToTheirRight(): void {
		$this->grant($this->folder, ParticipantType::User, $this->member, FolderRight::Share);
		$colleague = $this->grant($this->folder, ParticipantType::User, $this->memberUser('Ana Lima'), FolderRight::View);

		$this->assertSame(FolderRight::Edit, $this->sharing()->change($this->folder->getId(), $colleague->getId(), $this->member, 'edit')->right());
		$this->sharing()->remove($this->folder->getId(), $colleague->getId(), $this->member);

		$this->assertCount(1, $this->sharing()->accessList($this->folder->getId(), $this->owner)['entries']);
	}

	public function testRefusesTouchingAnEntryAboveTheSharersRight(): void {
		$this->grant($this->folder, ParticipantType::User, $this->member, FolderRight::Share);
		$manager = $this->grant($this->folder, ParticipantType::User, $this->memberUser('Ana Lima'), FolderRight::Manage);

		$this->assertRejected('forbidden', fn () => $this->sharing()->change($this->folder->getId(), $manager->getId(), $this->member, 'view'));
		$this->assertRejected('forbidden', fn () => $this->sharing()->remove($this->folder->getId(), $manager->getId(), $this->member));
	}

	/** @return array<string, array{string, string, string, string}> */
	public static function invalidShares(): array {
		return [
			'an unknown user' => ['user', 'ninguem-inexistente', 'view', 'participant_not_found'],
			'an unknown group' => ['group', 'grupo-inexistente', 'view', 'participant_not_found'],
			'an unknown participant type' => ['circle', 'x', 'view', 'participant_not_found'],
			'an unknown right' => ['user', 'admin', 'owner', 'right_invalid'],
		];
	}

	/** @dataProvider invalidShares */
	public function testRefusesAnInvalidShare(string $type, string $participantId, string $right, string $expectedCode): void {
		$this->assertRejected($expectedCode, fn () => $this->sharing()->add($this->folder->getId(), $this->owner, $type, $participantId, $right));
	}

	public function testRefusesSharingTwiceWithTheSameParticipant(): void {
		$this->sharing()->add($this->folder->getId(), $this->owner, 'user', $this->member, 'view');

		$this->assertRejected('participant_duplicate', fn () => $this->sharing()->add($this->folder->getId(), $this->owner, 'user', $this->member, 'edit'));
	}

	public function testAnswersNotFoundForAnEntryOfAnotherFolder(): void {
		$other = $this->folder($this->owner, 'Outra');
		$entry = $this->grant($other, ParticipantType::User, $this->member, FolderRight::View);

		$this->assertRejected('access_entry_not_found', fn () => $this->sharing()->remove($this->folder->getId(), $entry->getId(), $this->owner));
	}

	public function testListsTheOwnerAndTheEntries(): void {
		$entry = $this->grant($this->folder, ParticipantType::User, $this->member, FolderRight::View);

		$list = $this->sharing()->accessList($this->folder->getId(), $this->owner);

		$this->assertSame($this->owner, $list['owner']);
		$this->assertSame([$entry->getId()], array_map(fn ($row): int => $row->getId(), $list['entries']));
	}

	public function testSuggestsMembersButNeitherTheSearcherNorNonMembers(): void {
		$nonMember = $this->createUser('Ana Lima Externa');
		$searcher = $this->memberUser('Bruna Lima');

		$ids = self::shareeIds($this->sharing()->sharees($searcher, 'Lima'));

		$this->assertContains('user:' . $this->member, $ids);
		$this->assertNotContains('user:' . $searcher, $ids);
		$this->assertNotContains('user:' . $nonMember, $ids);
	}

	public function testSuggestsGroups(): void {
		$groupId = $this->newGroup();

		$this->assertContains('group:' . $groupId, self::shareeIds($this->sharing()->sharees($this->owner, $groupId)));
	}

	/**
	 * @param list<array{type: string, id: string, displayName: string}> $sharees
	 * @return list<string>
	 */
	private static function shareeIds(array $sharees): array {
		return array_map(fn (array $sharee): string => $sharee['type'] . ':' . $sharee['id'], $sharees);
	}

	public function testRefusesTheShareePickerToANonMember(): void {
		$this->assertRejected('forbidden', fn () => $this->sharing()->sharees($this->createUser(), ''));
	}

	private function assertRejected(string $expectedCode, callable $action): void {
		try {
			$action();
			$this->fail('Expected the sharing request to be refused with ' . $expectedCode);
		} catch (FolderRejected $rejection) {
			$this->assertSame($expectedCode, $rejection->errorCode);
		}
	}

	private function memberUser(string $displayName): string {
		$userId = $this->createUser($displayName);
		$this->addToGroup($userId, SignersGroup::GROUP_ID);
		return $userId;
	}

	private function sharing(): FolderSharing {
		return Server::get(FolderSharing::class);
	}
}
```

`tests/Integration/Controller/FolderSharingControllerTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Controller;

use Closure;
use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Controller\FolderSharingController;
use OCA\Assinaturas\Db\EnvelopeFolder;
use OCA\Assinaturas\Db\FolderAcl;
use OCA\Assinaturas\Folder\FolderAccess;
use OCA\Assinaturas\Folder\FolderRight;
use OCA\Assinaturas\Folder\ParticipantType;
use OCA\Assinaturas\Tests\Integration\TestFolders;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class FolderSharingControllerTest extends TestCase {
	use TestUsers;
	use TestFolders;

	private string $owner;
	private string $member;
	private EnvelopeFolder $folder;
	private FolderAcl $entry;

	protected function setUp(): void {
		parent::setUp();
		$this->owner = $this->memberUser('Maria Souza');
		$this->member = $this->memberUser('João Lima');
		$this->folder = $this->folder($this->owner);
		$this->entry = $this->grant($this->folder, ParticipantType::User, $this->memberUser('Ana Lima'), FolderRight::View);
	}

	protected function tearDown(): void {
		self::logout();
		$this->deleteFoldersOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		Server::get(FolderAccess::class)->forget();
		parent::tearDown();
	}

	public function testListsTheOwnerAndEveryEntry(): void {
		self::loginAsUser($this->owner);

		$list = $this->controller()->index($this->folder->getId())->getData();

		$this->assertSame(['uid' => $this->owner, 'displayName' => 'Maria Souza'], $list['owner']);
		$this->assertSame('Ana Lima', $list['entries'][0]['displayName']);
		$this->assertSame('view', $list['entries'][0]['right']);
	}

	public function testAddsAnEntryAndAnswersCreated(): void {
		self::loginAsUser($this->owner);

		$response = $this->controller()->create($this->folder->getId(), 'user', $this->member, 'edit');

		$this->assertSame(Http::STATUS_CREATED, $response->getStatus());
		$this->assertSame(['type' => 'user', 'participantId' => $this->member, 'displayName' => 'João Lima', 'right' => 'edit'], array_diff_key($response->getData(), ['id' => true]));
	}

	/** @return array<string, array{Closure}> every access-list route */
	public static function accessRoutes(): array {
		return [
			'list' => [static fn (FolderSharingController $controller, int $folderId, int $entryId): JSONResponse => $controller->index($folderId)],
			'add' => [static fn (FolderSharingController $controller, int $folderId, int $entryId): JSONResponse => $controller->create($folderId, 'user', 'admin', 'view')],
			'change' => [static fn (FolderSharingController $controller, int $folderId, int $entryId): JSONResponse => $controller->update($folderId, $entryId, 'edit')],
			'remove' => [static fn (FolderSharingController $controller, int $folderId, int $entryId): JSONResponse => $controller->destroy($folderId, $entryId)],
		];
	}

	/** @dataProvider accessRoutes */
	public function testHidesEveryAccessRouteFromAMemberWithoutAccess(Closure $call): void {
		self::loginAsUser($this->member);

		$response = $call($this->controller(), $this->folder->getId(), $this->entry->getId());

		$this->assertSame(Http::STATUS_NOT_FOUND, $response->getStatus());
	}

	/** @dataProvider accessRoutes */
	public function testForbidsEveryAccessRouteToAnEditor(Closure $call): void {
		$this->grant($this->folder, ParticipantType::User, $this->member, FolderRight::Edit);
		self::loginAsUser($this->member);

		$response = $call($this->controller(), $this->folder->getId(), $this->entry->getId());

		$this->assertSame(Http::STATUS_FORBIDDEN, $response->getStatus());
	}

	public function testForbidsTheShareePickerToANonMember(): void {
		self::loginAsUser($this->createUser());

		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller()->sharees('a')->getStatus());
	}

	public function testSuggestsMembersByName(): void {
		self::loginAsUser($this->owner);

		$sharees = $this->controller()->sharees('João')->getData()['sharees'];

		$this->assertContains(['type' => 'user', 'id' => $this->member, 'displayName' => 'João Lima'], $sharees);
	}

	private function memberUser(string $displayName): string {
		$userId = $this->createUser($displayName);
		$this->addToGroup($userId, SignersGroup::GROUP_ID);
		return $userId;
	}

	private function controller(): FolderSharingController {
		return Server::get(FolderSharingController::class);
	}
}
```

`tests/Integration/Listener/ParticipantDeletedListenerTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Listener;

use OCA\Assinaturas\Db\FolderAcl;
use OCA\Assinaturas\Db\FolderAclMapper;
use OCA\Assinaturas\Folder\FolderRight;
use OCA\Assinaturas\Folder\ParticipantType;
use OCA\Assinaturas\Tests\Integration\TestFolders;
use OCA\Assinaturas\Tests\Integration\TestGroups;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\IGroupManager;
use OCP\IUserManager;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class ParticipantDeletedListenerTest extends TestCase {
	use TestUsers;
	use TestGroups;
	use TestFolders;

	private string $owner;

	protected function setUp(): void {
		parent::setUp();
		$this->owner = $this->createUser();
	}

	protected function tearDown(): void {
		$this->deleteFoldersOf($this->createdUserIds);
		$this->deleteCreatedGroups();
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testDropsTheAccessRowsOfADeletedUser(): void {
		$folder = $this->folder($this->owner);
		$leaving = $this->createUser();
		$this->grant($folder, ParticipantType::User, $leaving, FolderRight::Edit);
		$staying = $this->grant($folder, ParticipantType::User, $this->createUser(), FolderRight::View);

		Server::get(IUserManager::class)->get($leaving)?->delete();

		$this->assertSame([$staying->getId()], self::ids($folder->getId()));
	}

	public function testDropsTheAccessRowsOfADeletedGroup(): void {
		$folder = $this->folder($this->owner);
		$groupId = $this->newGroup();
		$this->grant($folder, ParticipantType::Group, $groupId, FolderRight::Edit);

		Server::get(IGroupManager::class)->get($groupId)?->delete();

		$this->assertSame([], self::ids($folder->getId()));
	}

	/** @return list<int> */
	private static function ids(int $folderId): array {
		return array_map(fn (FolderAcl $entry): int => $entry->getId(), Server::get(FolderAclMapper::class)->findByFolder($folderId));
	}
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `tests/env/phpunit.sh --filter 'FolderSharingTest|FolderSharingControllerTest|ParticipantDeletedListenerTest'`
Expected: FAIL — `Class "OCA\Assinaturas\Folder\FolderSharing" not found`; the listener test fails with rows still present.

- [ ] **Step 3: Write `FolderSharing`, the access-entry JSON and the listener**

`lib/Folder/FolderSharing.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Folder;

use OCA\Assinaturas\Access\Roles;
use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Db\FolderAcl;
use OCA\Assinaturas\Db\FolderAclMapper;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\IGroup;
use OCP\IGroupManager;
use OCP\IUserManager;

/**
 * A folder's access list. It needs Compartilhar; nobody grants more than they hold, or touches an entry above their own
 * right. A recipient gains access only once they can use the app, so the picker suggests members and groups.
 */
final class FolderSharing {
	private const SHAREE_LIMIT = 20;

	public function __construct(
		private FolderTree $tree,
		private FolderAclMapper $aclMapper,
		private FolderAccess $folderAccess,
		private Roles $roles,
		private IUserManager $userManager,
		private IGroupManager $groupManager,
	) {
	}

	/**
	 * @return array{owner: string, entries: list<FolderAcl>}
	 * @throws FolderRejected
	 */
	public function accessList(int $folderId, string $userId): array {
		$folder = $this->tree->requireRight($folderId, $userId, FolderRight::Share);
		return ['owner' => $folder->getOwnerUid(), 'entries' => $this->aclMapper->findByFolder($folderId)];
	}

	/** @throws FolderRejected */
	public function add(int $folderId, string $userId, string $type, string $participantId, string $right): FolderAcl {
		$this->tree->requireRight($folderId, $userId, FolderRight::Share);
		$participantType = ParticipantType::tryFrom($type) ?? throw FolderRejected::participantNotFound();
		$granted = $this->grantableBy($folderId, $userId, $right);
		if (!$this->participantExists($participantType, $participantId)) {
			throw FolderRejected::participantNotFound();
		}
		if ($this->aclMapper->findOne($folderId, $participantType, $participantId) !== null) {
			throw FolderRejected::participantDuplicate();
		}
		$entry = new FolderAcl();
		$entry->setFolderId($folderId);
		$entry->setParticipantType($participantType->value);
		$entry->setParticipantId($participantId);
		$entry->grant($granted);
		$added = $this->aclMapper->insert($entry);
		$this->folderAccess->forget();
		return $added;
	}

	/** @throws FolderRejected */
	public function change(int $folderId, int $entryId, string $userId, string $right): FolderAcl {
		$this->tree->requireRight($folderId, $userId, FolderRight::Share);
		$entry = $this->entryOf($folderId, $entryId);
		$this->assertMayTouch($folderId, $userId, $entry);
		$entry->grant($this->grantableBy($folderId, $userId, $right));
		$changed = $this->aclMapper->update($entry);
		$this->folderAccess->forget();
		return $changed;
	}

	/** @throws FolderRejected */
	public function remove(int $folderId, int $entryId, string $userId): void {
		$this->tree->requireRight($folderId, $userId, FolderRight::Share);
		$entry = $this->entryOf($folderId, $entryId);
		$this->assertMayTouch($folderId, $userId, $entry);
		$this->aclMapper->delete($entry);
		$this->folderAccess->forget();
	}

	/**
	 * @return list<array{type: string, id: string, displayName: string}> members of the app (not the searcher), then groups
	 * @throws FolderRejected
	 */
	public function sharees(string $userId, string $search): array {
		if (!$this->roles->canUseApp($userId)) {
			throw FolderRejected::forbidden();
		}
		$text = trim($search);
		$users = [];
		foreach ($this->groupManager->displayNamesInGroup(SignersGroup::GROUP_ID, $text, self::SHAREE_LIMIT) as $memberUid => $displayName) {
			if ((string)$memberUid === $userId) {
				continue;
			}
			$users[] = ['type' => ParticipantType::User->value, 'id' => (string)$memberUid, 'displayName' => (string)$displayName];
		}
		$groups = array_map(
			fn (IGroup $group): array => ['type' => ParticipantType::Group->value, 'id' => $group->getGID(), 'displayName' => $group->getDisplayName()],
			array_values($this->groupManager->search($text, self::SHAREE_LIMIT)),
		);
		return [...$users, ...$groups];
	}

	/** @throws FolderRejected */
	private function grantableBy(int $folderId, string $userId, string $right): FolderRight {
		$granted = FolderRight::grantable($right) ?? throw FolderRejected::rightInvalid();
		if (!$this->folderAccess->rightOn($folderId, $userId)->atLeast($granted)) {
			throw FolderRejected::forbidden();
		}
		return $granted;
	}

	/** @throws FolderRejected */
	private function assertMayTouch(int $folderId, string $userId, FolderAcl $entry): void {
		if (!$this->folderAccess->rightOn($folderId, $userId)->atLeast($entry->right())) {
			throw FolderRejected::forbidden();
		}
	}

	/** @throws FolderRejected */
	private function entryOf(int $folderId, int $entryId): FolderAcl {
		try {
			$entry = $this->aclMapper->findById($entryId);
		} catch (DoesNotExistException) {
			throw FolderRejected::entryNotFound();
		}
		if ($entry->getFolderId() !== $folderId) {
			throw FolderRejected::entryNotFound();
		}
		return $entry;
	}

	private function participantExists(ParticipantType $type, string $participantId): bool {
		return $type === ParticipantType::User
			? $this->userManager->userExists($participantId)
			: $this->groupManager->groupExists($participantId);
	}
}
```

Replace `lib/Folder/FolderJson.php` with:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Folder;

use OCA\Assinaturas\Db\EnvelopeFolder;
use OCA\Assinaturas\Db\FolderAcl;
use OCP\IGroupManager;
use OCP\IUserManager;

/** The API's folder shapes, as one viewer sees them: their right, and the parent only when they can see it. */
final class FolderJson {
	public function __construct(
		private FolderAccess $folderAccess,
		private IUserManager $userManager,
		private IGroupManager $groupManager,
	) {
	}

	/** @return array{id: int, title: string, parentId: int|null, ownerUid: string, ownerDisplayName: string, sortOrder: int, right: string} */
	public function folder(EnvelopeFolder $folder, string $viewerUid): array {
		$rights = $this->folderAccess->rightsFor($viewerUid);
		return [
			'id' => $folder->getId(),
			'title' => $folder->getTitle(),
			'parentId' => FolderPaths::visibleParentId($folder, $rights),
			'ownerUid' => $folder->getOwnerUid(),
			'ownerDisplayName' => $this->displayName($folder->getOwnerUid()),
			'sortOrder' => $folder->getSortOrder(),
			'right' => ($rights[$folder->getId()] ?? FolderRight::None)->apiName(),
		];
	}

	/** @return array{id: int, type: string, participantId: string, displayName: string, right: string} */
	public function accessEntry(FolderAcl $entry): array {
		return [
			'id' => $entry->getId(),
			'type' => $entry->getParticipantType(),
			'participantId' => $entry->getParticipantId(),
			'displayName' => $this->participantName($entry),
			'right' => $entry->right()->apiName(),
		];
	}

	public function displayName(string $userId): string {
		return $this->userManager->getDisplayName($userId) ?? $userId;
	}

	private function participantName(FolderAcl $entry): string {
		$participantId = $entry->getParticipantId();
		if ($entry->participantTypeValue() === ParticipantType::User) {
			return $this->displayName($participantId);
		}
		return $this->groupManager->get($participantId)?->getDisplayName() ?? $participantId;
	}
}
```

`lib/Controller/FolderSharingController.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Controller;

use OCA\Assinaturas\Access\EnvelopeAccess;
use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\Db\FolderAcl;
use OCA\Assinaturas\Folder\FolderJson;
use OCA\Assinaturas\Folder\FolderRejected;
use OCA\Assinaturas\Folder\FolderSharing;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\FrontpageRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

/** A folder's access list and the share picker. FolderSharing checks every right. */
final class FolderSharingController extends Controller {
	public function __construct(
		IRequest $request,
		private EnvelopeAccess $access,
		private FolderSharing $sharing,
		private FolderJson $json,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'GET', url: '/api/v1/folders/{folderId}/access')]
	public function index(int $folderId): JSONResponse {
		return $this->handling(function (string $userId) use ($folderId): JSONResponse {
			$list = $this->sharing->accessList($folderId, $userId);
			return new JSONResponse([
				'owner' => ['uid' => $list['owner'], 'displayName' => $this->json->displayName($list['owner'])],
				'entries' => array_map(fn (FolderAcl $entry): array => $this->json->accessEntry($entry), $list['entries']),
			]);
		});
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'POST', url: '/api/v1/folders/{folderId}/access')]
	public function create(int $folderId, string $type, string $participantId, string $right): JSONResponse {
		return $this->handling(fn (string $userId): JSONResponse => new JSONResponse(
			$this->json->accessEntry($this->sharing->add($folderId, $userId, $type, $participantId, $right)),
			Http::STATUS_CREATED,
		));
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'PUT', url: '/api/v1/folders/{folderId}/access/{entryId}')]
	public function update(int $folderId, int $entryId, string $right): JSONResponse {
		return $this->handling(fn (string $userId): JSONResponse => new JSONResponse(
			$this->json->accessEntry($this->sharing->change($folderId, $entryId, $userId, $right)),
		));
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'DELETE', url: '/api/v1/folders/{folderId}/access/{entryId}')]
	public function destroy(int $folderId, int $entryId): JSONResponse {
		return $this->handling(function (string $userId) use ($folderId, $entryId): JSONResponse {
			$this->sharing->remove($folderId, $entryId, $userId);
			return new JSONResponse(['deleted' => true]);
		});
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'GET', url: '/api/v1/sharees')]
	public function sharees(string $search = ''): JSONResponse {
		return $this->handling(fn (string $userId): JSONResponse => new JSONResponse(['sharees' => $this->sharing->sharees($userId, $search)]));
	}

	/**
	 * Higher-order guard: runs the request as the current user and turns folder refusals into error responses.
	 *
	 * @param callable(string): JSONResponse $request
	 */
	private function handling(callable $request): JSONResponse {
		try {
			return $request($this->access->currentUserId());
		} catch (FolderRejected $rejection) {
			return $rejection->toResponse();
		}
	}
}
```

`lib/Listener/ParticipantDeletedListener.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Listener;

use OCA\Assinaturas\Db\FolderAclMapper;
use OCA\Assinaturas\Folder\ParticipantType;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Group\Events\GroupDeletedEvent;
use OCP\User\Events\UserDeletedEvent;

/**
 * Drops the folder access rows of users and groups Nextcloud deleted, so a new account with the same id gets nothing.
 *
 * @template-implements IEventListener<UserDeletedEvent|GroupDeletedEvent>
 */
final class ParticipantDeletedListener implements IEventListener {
	public function __construct(
		private FolderAclMapper $aclMapper,
	) {
	}

	public function handle(Event $event): void {
		if ($event instanceof UserDeletedEvent) {
			$this->aclMapper->deleteByParticipant(ParticipantType::User, $event->getUser()->getUID());
			return;
		}
		if ($event instanceof GroupDeletedEvent) {
			$this->aclMapper->deleteByParticipant(ParticipantType::Group, $event->getGroup()->getGID());
		}
	}
}
```

In `lib/AppInfo/Application.php` add the imports `OCA\Assinaturas\Listener\ParticipantDeletedListener`, `OCP\Group\Events\GroupDeletedEvent`, `OCP\User\Events\UserDeletedEvent`, and at the end of `register()`:

```php
		$context->registerEventListener(UserDeletedEvent::class, ParticipantDeletedListener::class);
		$context->registerEventListener(GroupDeletedEvent::class, ParticipantDeletedListener::class);
```

- [ ] **Step 4: Run them and watch them pass**

Run: `tests/env/phpunit.sh --filter 'FolderSharingTest|FolderSharingControllerTest|ParticipantDeletedListenerTest|FolderControllerTest'`
Expected: `OK`.

- [ ] **Step 5: Run the task gates and commit**

Run each: `composer run lint`, `tests/env/phpunit.sh`.

```bash
git add lib/Folder lib/Controller/FolderSharingController.php lib/Listener/ParticipantDeletedListener.php lib/AppInfo/Application.php tests/Integration
git commit -m "feat(folders): share folders with users and groups, cleaning up deleted ones"
```

---

### Task 8: Filing envelopes and the API reference

**Files:**
- Create: `lib/Folder/EnvelopeFiling.php`
- Modify: `lib/Controller/EnvelopeController.php` (`create` takes `folderId`), `lib/Controller/EnvelopeActionController.php` (`PUT …/folder`, catch `FolderRejected`)
- Modify: `docs/api.md`
- Test: `tests/Integration/Folder/EnvelopeFilingTest.php`, `tests/Integration/Controller/EnvelopeEndpointAccessTest.php` (add the folder route)

**Interfaces:**
- Consumes: `FolderTree::requireRight`, `AccessPolicy::canEdit/canAct`, `EnvelopeMapper::assignFolder`.
- Produces:
  - `EnvelopeFiling::assertCanFileInto(?int $folderId, string $userId): void`, `placeNew(Envelope, ?int $folderId): void`, `file(Envelope, ?int $folderId, string $userId): void` (drafts need `canEdit`, others `canAct`; the target needs Edit). All throw `FolderRejected`.
  - `POST /api/v1/envelopes` accepts optional `folderId`; the target is checked before the draft is created.
  - `PUT /api/v1/envelopes/{uuid}/folder` `{folderId: int|null}` → 200 detail.
  - `docs/api.md`: the full Plan 8 contract that Plan 8b builds on.

- [ ] **Step 1: Write the failing tests**

`tests/Integration/Folder/EnvelopeFilingTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Folder;

use OCA\Assinaturas\Access\ManagersGroup;
use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Controller\EnvelopeActionController;
use OCA\Assinaturas\Controller\EnvelopeController;
use OCA\Assinaturas\Db\EnvelopeFolder;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Folder\FolderAccess;
use OCA\Assinaturas\Folder\FolderRight;
use OCA\Assinaturas\Folder\ParticipantType;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\OwnedEnvelopes;
use OCA\Assinaturas\Tests\Integration\SentEnvelopes;
use OCA\Assinaturas\Tests\Integration\TestFolders;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\AppFramework\Http;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class EnvelopeFilingTest extends TestCase {
	use TestUsers;
	use TestFolders;
	use EnvelopeCleanup;
	use ZapSignDoubles;
	use SentEnvelopes;

	private string $owner;
	private string $editor;
	private EnvelopeFolder $folder;

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->owner = $this->memberUser();
		$this->editor = $this->memberUser();
		$this->folder = $this->folder($this->owner, 'Contratos');
		$this->grant($this->folder, ParticipantType::User, $this->editor, FolderRight::Edit);
	}

	protected function tearDown(): void {
		self::logout();
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteFoldersOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		Server::get(FolderAccess::class)->forget();
		parent::tearDown();
	}

	public function testCreatesADraftInsideAFolderTheCreatorEdits(): void {
		self::loginAsUser($this->editor);
		$file = $this->writeFile($this->editor, 'Contrato.pdf', self::minimalPdf());

		$response = Server::get(EnvelopeController::class)->create('Contrato', [$file->getId()], $this->folder->getId());

		$this->assertSame(Http::STATUS_CREATED, $response->getStatus());
		$this->assertSame($this->folder->getId(), $response->getData()['folderId']);
		$this->assertSame('Contratos', $response->getData()['folder']['title']);
	}

	public function testCreatesNoDraftWhenTheFolderIsOnlyViewable(): void {
		$viewer = $this->memberUser();
		$this->grant($this->folder, ParticipantType::User, $viewer, FolderRight::View);
		self::loginAsUser($viewer);
		$file = $this->writeFile($viewer, 'Contrato.pdf', self::minimalPdf());

		$response = Server::get(EnvelopeController::class)->create('Contrato', [$file->getId()], $this->folder->getId());

		$this->assertSame(Http::STATUS_FORBIDDEN, $response->getStatus());
		$this->assertSame([], OwnedEnvelopes::of($viewer));
	}

	public function testFilesADraftForItsOwner(): void {
		$draft = $this->draft();
		self::loginAsUser($this->owner);

		$response = $this->actions()->file($draft, $this->folder->getId());

		$this->assertSame(Http::STATUS_OK, $response->getStatus());
		$this->assertSame($this->folder->getId(), $response->getData()['folderId']);
	}

	public function testLetsAFolderEditorTakeASentEnvelopeOutOfTheFolder(): void {
		$sent = $this->sentEnvelope($this->owner);
		Server::get(EnvelopeMapper::class)->assignFolder($sent->getId(), $this->folder->getId());
		self::loginAsUser($this->editor);

		$response = $this->actions()->file($sent->getUuid(), null);

		$this->assertSame(Http::STATUS_OK, $response->getStatus());
		$this->assertNull(Server::get(EnvelopeMapper::class)->findById($sent->getId())->getFolderId());
	}

	public function testRefusesFilingIntoAFolderTheUserOnlyViews(): void {
		$readOnly = $this->folder($this->owner, 'Leitura');
		$this->grant($readOnly, ParticipantType::User, $this->editor, FolderRight::View);
		$own = $this->sentEnvelope($this->editor);
		self::loginAsUser($this->editor);

		$response = $this->actions()->file($own->getUuid(), $readOnly->getId());

		$this->assertSame(Http::STATUS_FORBIDDEN, $response->getStatus());
		$this->assertSame('forbidden', $response->getData()['error']);
	}

	public function testHidesATargetFolderTheUserCannotSee(): void {
		$hidden = $this->folder($this->owner, 'Privada');
		$own = $this->sentEnvelope($this->editor);
		self::loginAsUser($this->editor);

		$this->assertSame('folder_not_found', $this->actions()->file($own->getUuid(), $hidden->getId())->getData()['error']);
	}

	public function testRefusesAManagerMovingSomeoneElsesDraft(): void {
		$draft = $this->draft();
		$manager = $this->createUser();
		$this->addToGroup($manager, ManagersGroup::GROUP_ID);
		self::loginAsUser($manager);

		$this->assertSame(Http::STATUS_FORBIDDEN, $this->actions()->file($draft, $this->folder->getId())->getStatus());
	}

	public function testLetsAManagerFileAnySentEnvelope(): void {
		$sent = $this->sentEnvelope($this->owner);
		$manager = $this->createUser();
		$this->addToGroup($manager, ManagersGroup::GROUP_ID);
		self::loginAsUser($manager);

		$this->assertSame(Http::STATUS_OK, $this->actions()->file($sent->getUuid(), $this->folder->getId())->getStatus());
	}

	private function draft(): string {
		self::loginAsUser($this->owner);
		$file = $this->writeFile($this->owner, 'Rascunho ' . bin2hex(random_bytes(3)) . '.pdf', self::minimalPdf());
		$uuid = Server::get(EnvelopeController::class)->create('Rascunho', [$file->getId()])->getData()['uuid'];
		self::logout();
		return $uuid;
	}

	private function memberUser(): string {
		$userId = $this->createUser();
		$this->addToGroup($userId, SignersGroup::GROUP_ID);
		return $userId;
	}

	private function actions(): EnvelopeActionController {
		return Server::get(EnvelopeActionController::class);
	}
}
```

In `tests/Integration/Controller/EnvelopeEndpointAccessTest.php`, add to `actionRoutes()`:

```php
			'file in a folder' => [EnvelopeActionController::class, static fn (EnvelopeActionController $controller, string $uuid): Response => $controller->file($uuid, self::UNKNOWN_ID), 'folder_not_found'],
```

- [ ] **Step 2: Run them and watch them fail**

Run: `tests/env/phpunit.sh --filter 'EnvelopeFilingTest|EnvelopeEndpointAccessTest'`
Expected: FAIL — `Call to undefined method …EnvelopeActionController::file()` and `Unknown named parameter` / extra argument on `create`.

- [ ] **Step 3: Write `EnvelopeFiling` and wire the routes**

`lib/Folder/EnvelopeFiling.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Folder;

use OCA\Assinaturas\Access\AccessPolicy;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;

/** Files envelopes in folders. Moving needs the envelope's own right (a draft is its owner's) and Editar on the target. */
final class EnvelopeFiling {
	public function __construct(
		private FolderTree $tree,
		private AccessPolicy $accessPolicy,
		private EnvelopeMapper $envelopeMapper,
	) {
	}

	/** @throws FolderRejected */
	public function assertCanFileInto(?int $folderId, string $userId): void {
		if ($folderId === null) {
			return;
		}
		$this->tree->requireRight($folderId, $userId, FolderRight::Edit);
	}

	/** Puts a draft just created into the folder its creator was viewing; the caller checked the folder first. */
	public function placeNew(Envelope $envelope, ?int $folderId): void {
		if ($folderId === null) {
			return;
		}
		$this->envelopeMapper->assignFolder($envelope->getId(), $folderId);
	}

	/** @throws FolderRejected */
	public function file(Envelope $envelope, ?int $folderId, string $userId): void {
		$mayMove = $envelope->statusValue() === EnvelopeStatus::Draft
			? $this->accessPolicy->canEdit($envelope, $userId)
			: $this->accessPolicy->canAct($envelope, $userId);
		if (!$mayMove) {
			throw FolderRejected::forbidden();
		}
		$this->assertCanFileInto($folderId, $userId);
		$this->envelopeMapper->assignFolder($envelope->getId(), $folderId);
	}
}
```

In `lib/Controller/EnvelopeController.php`:
- add imports `OCA\Assinaturas\Folder\EnvelopeFiling` and `OCA\Assinaturas\Folder\FolderRejected`;
- add `private EnvelopeFiling $filing,` to the constructor after `private EnvelopeSender $sender,`;
- replace `create()` with:

```php
	/** @param list<int> $fileIds */
	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'POST', url: '/api/v1/envelopes')]
	public function create(string $title, array $fileIds, ?int $folderId = null): JSONResponse {
		$userId = $this->access->currentUserId();
		if (!$this->accessPolicy->canUseApp($userId)) {
			return self::forbidden();
		}
		try {
			$this->filing->assertCanFileInto($folderId, $userId);
		} catch (FolderRejected $rejection) {
			return $rejection->toResponse();
		}
		return self::handlingRejections(function () use ($userId, $title, $fileIds, $folderId): JSONResponse {
			$envelope = $this->drafts->create($userId, $title, $fileIds);
			$this->filing->placeNew($envelope, $folderId);
			return new JSONResponse($this->details->detail($envelope), Http::STATUS_CREATED);
		});
	}
```

In `lib/Controller/EnvelopeActionController.php`:
- add imports `OCA\Assinaturas\Folder\EnvelopeFiling` and `OCA\Assinaturas\Folder\FolderRejected`;
- add `private EnvelopeFiling $filing,` to the constructor after `private EnvelopeDownloads $downloads,`;
- add this route after `signLink()`:

```php
	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'PUT', url: '/api/v1/envelopes/{uuid}/folder')]
	public function file(string $uuid, ?int $folderId = null): JSONResponse {
		return $this->acting($uuid, function (Envelope $envelope) use ($folderId): JSONResponse {
			$this->filing->file($envelope, $folderId, $this->access->currentUserId());
			return new JSONResponse($this->details->detail($envelope));
		});
	}
```

- in `acting()`, add a third catch after the `DraftRejected` one:

```php
		} catch (FolderRejected $rejection) {
			return $rejection->toResponse();
		}
```

In `tests/Integration/Controller/EnvelopeActionControllerTest.php`, `fakeZapSignController()` builds the controller by hand: add `Server::get(EnvelopeFiling::class),` as the last constructor argument and `use OCA\Assinaturas\Folder\EnvelopeFiling;`.

- [ ] **Step 4: Run them and watch them pass**

Run: `tests/env/phpunit.sh --filter 'EnvelopeFilingTest|EnvelopeEndpointAccessTest|EnvelopeActionControllerTest|EnvelopeControllerTest'`
Expected: `OK`.

- [ ] **Step 5: Document the API (the contract Plan 8b consumes)**

Edit `docs/api.md`:

1. In the Errors table, replace the 403 and 404 rows with:

```markdown
| 403 `forbidden` | The user can't use the app (not in "Avuz Assinaturas", not in "Avuz Assinaturas Admins", not an admin), or sees the envelope or folder but lacks the right the route needs |
| 404 `not_found` | Unknown envelope, or one the user may not see |
| 404 `folder_not_found` | Unknown folder, or one the user cannot view (folder routes, `folderId` on the list, create and file) |
```

and add after the `list_query_invalid` row:

```markdown
| 422 `list_query_invalid` (scope) | `scope` is not `mine`, `shared` or `company` |
```

2. Add a section before `## Limits`:

````markdown
## Access

| Who | Sees | Acts (remind, correct email, deadline, cancel, discard, reopen, copy link, file in folders) | Edits drafts |
|---|---|---|---|
| Owner (can use the app) | own envelopes | yes | yes |
| Owner who left the groups | own envelopes | no | no |
| Folder **Ver** (view) | sent envelopes in the folder and below | no | no |
| Folder **Editar** (edit), **Compartilhar** (share), **Gerenciar** (manage) | same | yes | no |
| Manager (`assinaturas-admins`) | every envelope, drafts included | yes | no |
| Nextcloud admin | every envelope | yes | no; plus the `/admin` routes |

- A right on a folder holds for every subfolder. With several paths (own entry, a group, an ancestor, ownership) the highest wins. The folder owner has every right; managers and admins manage every folder.
- Drafts stay private to their owner inside shared folders (managers and admins excepted): others see an envelope once it was sent.
- Someone who cannot use the app gets nothing from a folder entry.
````

3. In `## Listing`, add these bullets:

```markdown
- `scope`: `mine` (default) lists the user's own envelopes; `shared` lists the sent envelopes of others that sit in a folder the user can view; `company` lists every envelope for managers and admins and the user's own for anyone else.
- `folderId` lists the envelopes filed directly in that folder (not in its subfolders), whatever `scope` says. Others' drafts are left out unless the user is a manager or admin. A folder the user cannot view answers 404 `folder_not_found`.
- `counts` follow the same `scope`/`folderId`.
```

4. In `## Envelope summary`, add to the JSON example `"ownerDisplayName": "Maria Souza", "folderId": 3, "permissions": {"act": true, "edit": true, "remove": false}` and this paragraph:

```markdown
`ownerDisplayName` is the owner's Nextcloud display name (the uid when the account is gone). `folderId` is the folder the envelope is filed in, or `null` ("Sem pasta"). `permissions` say what the current user may do: `act` (the actions on sent envelopes and filing it), `edit` (the draft routes; the owner only), `remove` (the admin deletion; Nextcloud admins only).
```

5. In `## Envelope detail`, add `"folder": {"id": 3, "title": "Fornecedores", "path": [{"id": 1, "title": "Contratos"}]}` to the example and: `` `folder` is `null` without a folder. `path` lists the ancestors the viewer can see, top first; a hidden ancestor and everything above it are left out. ``

6. In the Routes table: change the list row's path to `/envelopes?scope=mine\|shared\|company&folderId=<int>&filter=…` and its last sentence to `See *Listing* below.`; change the POST row body to `` `{"title", "fileIds": [int…], "folderId": int?}` (the first file is the main document; with `folderId` the draft is filed there, which needs Editar on it — checked before the draft is created) ``; change the three download rows' "the owner and admins" to "whoever sees the envelope"; and add after the `link` row:

```markdown
| PUT | `/envelopes/{uuid}/folder` | `{"folderId": int\|null}` — files the envelope in a folder, or in none. A draft needs its owner; any other status needs `permissions.act`. The target needs Editar | 200 detail; 403 `forbidden`; 404 `folder_not_found` |
```

7. Replace "Only the owner can cancel, discard, reopen, extend the deadline, remind, correct an email or copy a link (404 for an envelope the user can't read, 403 for one they can't edit, admins included)." with "Whoever may act (see *Access*) can cancel, discard, reopen, extend the deadline, remind, correct an email, copy a link and file the envelope (404 for an envelope the user can't see, 403 for one they see without that right)." In **Signing links**, replace "It works for the owner only" with "It works for whoever may act", and "with the owner's `actorUid`" with "with the caller's `actorUid`". In **Downloads**, replace "Only the owner and admins can read them" with "Whoever sees the envelope can read them".

8. Under `## Admin`, change "Admins only." to "Nextcloud admins only (managers get 403)." and add a new section after it:

````markdown
## Usage (managers)

`GET /usage` — managers and Nextcloud admins; others get 403 `forbidden`.

```json
{"month": "2026-10", "sent": 12, "completed": 9, "credits": 140}
```

`month`, `sent` and `completed` mean what they mean in the admin status `usage`. `credits` is the plan's remaining credits, or `null` when the connection check has no plan (not configured, refused, unreachable).

## Folders

Folders are the app's own (not Drive folders). Every route answers 403 `forbidden` to someone who cannot use the app.

**Folder:**

```json
{"id": 3, "title": "Fornecedores", "parentId": 1, "ownerUid": "maria", "ownerDisplayName": "Maria Souza", "sortOrder": 0, "right": "edit"}
```

`right` is the current user's right: `view`, `edit`, `share` or `manage`. `parentId` is `null` at the top level and also when the user cannot see the parent (the folder then shows at the top of their tree). Folders come in display order (`sortOrder`, then title).

| Method | Path | Body | Needs | Returns |
|---|---|---|---|---|
| GET | `/folders` | — | — | `{"folders": [folder…]}`: every folder the user can view (managers and admins: all) |
| POST | `/folders` | `{"title", "parentId": int?}` | Editar on the parent (none at the top level) | 201 folder, owned by the creator |
| PUT | `/folders/{folderId}` | `{"title"}` | Editar | folder |
| PUT | `/folders/{folderId}/parent` | `{"parentId": int\|null}` | Gerenciar on the folder, Editar on the target | folder; 422 `folder_cycle` when the target is the folder or below it |
| PUT | `/folders/{folderId}/owner` | `{"ownerUid"}` | manager or admin | folder; 422 `owner_invalid` when the new owner cannot use the app |
| DELETE | `/folders/{folderId}` | — | Gerenciar | `{"deleted": true}`. Subfolders and envelopes move to the parent (or to "Sem pasta" at the top); envelopes are never deleted |

Codes: 404 `folder_not_found` (unknown, or not viewable), 403 `forbidden` (viewable without the right), 422 `folder_title_invalid` (empty, blank, or over 255 characters after trimming).

**Access list** (`Compartilhar` needed on every route; nobody grants more than they hold, or changes or removes an entry above their own right):

```json
{"owner": {"uid": "maria", "displayName": "Maria Souza"},
 "entries": [{"id": 9, "type": "user", "participantId": "joao", "displayName": "João Lima", "right": "edit"}]}
```

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/folders/{folderId}/access` | — | the list above |
| POST | `/folders/{folderId}/access` | `{"type": "user"\|"group", "participantId", "right": "view"\|"edit"\|"share"\|"manage"}` | 201 entry |
| PUT | `/folders/{folderId}/access/{entryId}` | `{"right"}` | entry |
| DELETE | `/folders/{folderId}/access/{entryId}` | — | `{"deleted": true}` |
| GET | `/sharees?search=<text>` | — (needs only to use the app) | `{"sharees": [{"type": "user"\|"group", "id", "displayName"}…]}`: members of "Avuz Assinaturas" (not the searcher), then groups, at most 20 of each |

Codes: 422 `participant_not_found` (unknown user, group or `type`), 409 `participant_duplicate`, 422 `right_invalid`, 404 `access_entry_not_found` (unknown entry or one of another folder). When Nextcloud deletes a user or a group, their entries are removed.
````

- [ ] **Step 6: Run the task gates and commit**

Run each: `composer run lint`, `tests/env/phpunit.sh`, `npm test` (the l10n spec reads `lib/`; it must stay green).

```bash
git add lib/Folder/EnvelopeFiling.php lib/Controller docs/api.md tests/Integration
git commit -m "feat(folders): file envelopes in folders and document the folder API"
```

---

### Task 9: Avuz image — recreate the groups on every boot, runbook

Work in the avuz-server worktree `/Users/patrickrezende/work/avuz/avuz-server/.claude/worktrees/avuzconecta-signature-feasibility-59ecdd`, branch `claude/avuzconecta-signature-feasibility-59ecdd`. First bring it level with `avuz-customization` (Plan 4 rule): `git merge-base --is-ancestor HEAD avuz-customization && git merge --ff-only avuz-customization`; if HEAD is not an ancestor, `git merge --no-ff avuz-customization` and resolve. Never sync with `master`.

**Files:**
- Modify: `docker/lib-assinaturas.sh`
- Test: `docker/tests/assinaturas.test.sh`
- Modify: `docs/assinaturas-tenant-runbook.md`, `CLAUDE.md` (Assinaturas section)

**Interfaces:**
- Consumes: `occ assinaturas:groups:ensure` (Task 2): exit 0, prints `Groups: unchanged` or `Groups: created <ids>`.
- Produces: every boot with the app enabled runs `assinaturas:groups:ensure` after the enable/reconcile and before the config writes; a failure logs `✗ Assinaturas: groups:ensure failed — the app groups may be missing until the next boot` and the boot goes on.

- [ ] **Step 1: Write the failing bash tests**

In `docker/tests/assinaturas.test.sh`:
- in the `_avuz_occ` fake's `case`, add before `esac`:
  ```bash
          "assinaturas:groups:ensure") [ "$FAKE_GROUPS_FAILS" = "yes" ] && return 1 ;;
  ```
- in `reset_fakes()`, add `FAKE_GROUPS_FAILS="no"` to the line that sets `FAKE_ENABLE_FAILS="no"; …`;
- in the "enables, configures and registers webhooks in order" assertion, insert the line `assinaturas:groups:ensure` right after `app:enable --force assinaturas`;
- add before the `# ── failures ──` section:

```bash
# ── app groups (members + managers) come back on every boot ──
reset_fakes; configure_env; FAKE_ENABLED="yes"; FAKE_INSTALLED="0.4.0"
sync_now
assert_has "recreates the app groups on a steady boot" "assinaturas:groups:ensure" "$(writes)"
assert_eq "keeps a steady boot unchanged after ensuring the groups" "0" "$AVUZ_ASSINATURAS_CHANGED"

reset_fakes
sync_now
assert_lacks "leaves the groups alone while the app is off" "assinaturas:groups:ensure" "$(writes)"

reset_fakes; configure_env; FAKE_ENABLED="yes"; FAKE_INSTALLED="0.4.0"; FAKE_GROUPS_FAILS="yes"
if sync_now; then rc=0; else rc=1; fi
assert_eq "never fails the boot when the groups cannot be ensured" "0" "$rc"
assert_has "reports the failed group ensure" \
    "✗ Assinaturas: groups:ensure failed — the app groups may be missing until the next boot" "$(synced)"
assert_has "still registers the webhooks after a failed group ensure" "assinaturas:webhook:ensure" "$(writes)"
```

- [ ] **Step 2: Run them and watch them fail**

Run: `bash docker/tests/assinaturas.test.sh`
Expected: exit 1 with `NOT OK - enables, configures and registers webhooks in order` and `NOT OK - recreates the app groups on a steady boot`.

- [ ] **Step 3: Call the command from the boot sync**

In `docker/lib-assinaturas.sh`, in `avuz_assinaturas_sync()`, insert between the reconcile block (ending `fi` after `AVUZ_ASSINATURAS_CHANGED=1`) and `if ! avuz_assinaturas_write_config; then`:

```bash
    # Repair steps only run on install and upgrade: this brings back a deleted
    # "Avuz Assinaturas" or "Avuz Assinaturas Admins" group (empty) on every boot.
    if ! _avuz_occ assinaturas:groups:ensure >/dev/null; then
        echo "✗ Assinaturas: groups:ensure failed — the app groups may be missing until the next boot"
    fi
```

- [ ] **Step 4: Run the tests with both bash versions**

Run: `bash docker/tests/assinaturas.test.sh` (macOS `/bin/bash` 3.2)
Expected: every line `ok - …`, exit 0.
Run: `docker run --rm --entrypoint bash -v "$PWD/docker:/docker:ro" avuzconecta:latest /docker/tests/assinaturas.test.sh` (bash 5; read-only, does not rebuild the image)
Expected: every line `ok - …`, exit 0.

- [ ] **Step 5: Update the runbook and CLAUDE.md**

In `docs/assinaturas-tenant-runbook.md`, replace the bullet `- Add the tenant's users to the `assinaturas` group. Admins always pass.` with:

```markdown
- Add the tenant's users to the `assinaturas` group ("Avuz Assinaturas").
- Add the client's company managers to `assinaturas-admins` ("Avuz Assinaturas Admins"). Managers see "Toda a empresa", act on every envelope, manage every folder, hand folders over ("Transferir pasta") and read the usage panel. They can use the app without being in `assinaturas`. Client users are never Nextcloud admins; Nextcloud admins (Avuz) always pass and also get the connection settings.
- Only Nextcloud admins manage who is in either group.
- Deleting either group in the Users screen does not stick: every boot runs `occ assinaturas:groups:ensure`, which recreates it **empty**. The memberships are lost; add the people again. A deleted group also loses its folder access entries.
```

In `CLAUDE.md` (this repo), in the "Assinaturas (ZapSign e-signature)" section, replace the line `- Access is limited to the Nextcloud group `assinaturas`; admins always pass.` with:

```markdown
- Access: members of `assinaturas`, company managers in `assinaturas-admins` (see/act on every envelope and folder, no Nextcloud admin), and Nextcloud admins. Envelopes nest in shareable app folders (Ver/Editar/Compartilhar/Gerenciar, inherited). The boot runs `occ assinaturas:groups:ensure` every time, so a deleted group comes back empty.
```

- [ ] **Step 6: Commit (avuz-server)**

```bash
git add docker/lib-assinaturas.sh docker/tests/assinaturas.test.sh docs/assinaturas-tenant-runbook.md CLAUDE.md
git commit -m "feat(assinaturas): recreate the app groups on every boot"
```

The image only gets this behaviour together with the app `0.6.0` submodule pin (Plan 8b, last task). Until then `assinaturas:groups:ensure` is unknown to the pinned app; the failure line is logged and the boot continues, which the test above covers.

---

## Self-review notes

- Spec coverage (backend half): roles table (Tasks 2, 4), managers without `assinaturas` (Task 2), groups by repair step + every boot (Tasks 2, 9), runbook caveat (Task 9); folders with title/parent/owner/sort order, nesting, `folder_cycle` (Tasks 1, 6); one folder per envelope (Tasks 1, 8); users/groups ACL with Ver/Editar/Compartilhar/Gerenciar (Tasks 1, 3, 7); owner all rights, inheritance, highest path (Task 3); recipients must use the app, picker lists members and groups (Tasks 3, 7); delete moves children up (Task 6); transfer by managers (Task 6); drafts private (Tasks 4, 5); one access service, every endpoint (Task 4 matrix + per-endpoint test, Task 8 folder route); `folderRight` = `FolderAccess::rightOn` (Task 3); data model and ACL cleanup on deletion (Tasks 1, 7); usage panel data (Task 2); dashboard scopes and folder listing (Task 5); cancel-confirmation owner name data (`ownerDisplayName`, Task 5). Screens are Plan 8b.
- Contract names used by other plans: `AccessPolicy::{canUseApp, canSee, canAct, canEdit, isManager, canSeeAll}`, `ManagersGroup::{GROUP_ID, DISPLAY_NAME}`, `FolderAccess::{rightOn, userIdsWithEditOn}`, `FolderRight` (+ `atLeast`), tables `assinaturas_folders` / `assinaturas_folder_acl`, column `assinaturas_envelopes.folder_id`, scopes `mine|shared|company` + `folderId`.
