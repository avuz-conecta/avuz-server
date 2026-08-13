# Deck Board Folders (Espaços) — Implementation Plan (P6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared, recursive folder hierarchy that boards can be organized into, with menu-driven management.

**Architecture:** New `Folder` entity (recursive via `parent_id`) + a `folder_id` column on boards. Mirror the existing Label/Board backend patterns. Frontend renders a collapsible folder tree in the app navigation and adds menu actions (create/rename/delete folder, "move board to folder"). No drag-and-drop or manual reorder in v1.

**Tech Stack:** PHP 8 (Nextcloud AppFramework, QBMapper, `OCP\DB\Types`), Vue 2 + Vuex, `@nextcloud/vue`, `@nextcloud/axios`, phpunit, jest.

**Spec:** `docs/superpowers/specs/2026-08-13-deck-board-folders-design.md` — read it; the Non-goals + permission model bind every task.

**Fork working copy:** `/Users/patrickrezende/work/avuz/deck-fork` (submodule `apps/deck`, branch `avuz`). All paths below are relative to that fork root.

## Global Constraints

- **Version bump:** `appinfo/info.xml` `1.17.2` → **`1.17.3`** (Task 11 only).
- **Migration:** `lib/Migration/Version11703Date20260813120000.php`, class matching filename, extends `SimpleMigrationStep`, `OCP\DB\Types`, guard every `createTable`/`addColumn` with `hasTable`/`hasColumn`. Version integer > 11702.
- **No DB foreign keys** — guards/cascade in app code.
- **Permission model (spec):** move a board in/out of a folder = board `Acl::PERMISSION_MANAGE`; create/rename/nest a folder = any authenticated user; delete a folder = any user but ONLY when empty (no boards, no sub-folders); folder tree is visible to all authenticated users (no per-user pruning).
- **Folders always visible; empty folders always show.** Boards inside respect existing board ACL (the boards list is already ACL-filtered).
- **`lastModified` stamp idiom:** use `array_key_exists('lastModified', $entity->getUpdatedFields())`, NOT the buggy `in_array` (a loose-comparison trap — burned P1).
- **PHP file convention:** every new PHP file = `<?php` + blank line + the SPDX header:
  ```php
  /**
   * SPDX-FileCopyrightText: 2026 Avuz
   * SPDX-License-Identifier: AGPL-3.0-or-later
   */
  ```
- **Sibling folders MAY share a title** (not enforced) — deliberate.
- **Commit discipline:** targeted `git add <paths>` only — NEVER `git add vendor/`, `js/` (except Task 11), `-A`, or `.`; the committed `vendor/` is a production build. Delete `.php-cs-fixer.cache` if it appears. No "Claude Code" trailer.
- **Test commands:** PHP `~/deck-test.sh --filter <Name>` (the harness — bare `vendor/bin/phpunit` fails on missing NC bootstrap; DB tests use a **multi-line** `/** @group DB */` docblock, never inline). JS `npm run test -- <name>`. Full suite baseline: NotifierTest/ActivityManagerTest carry ~6 pre-existing pt_BR locale failures — 0 NEW failures is the bar.

---

### Task 1: Migration + Folder entity + Board.folderId

**Files:**
- Create: `lib/Migration/Version11703Date20260813120000.php`
- Create: `lib/Db/Folder.php`
- Modify: `lib/Db/Board.php` (add `folderId` prop + `addType`)
- Test: `tests/unit/Db/FolderTest.php`

**Interfaces:**
- Produces: `OCA\Deck\Db\Folder` (props `title:string, parentId:?int, owner:string, order:int, lastModified:int`); table `deck_folders`; `deck_boards.folder_id` column; `Board::getFolderId()/setFolderId()`.

- [ ] **Step 1: Write the failing test** — `tests/unit/Db/FolderTest.php`
```php
<?php

/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\Deck\Db;

use Test\TestCase;

class FolderTest extends TestCase {
	public function testTypeCasting(): void {
		$f = new Folder();
		$f->setParentId('5');
		$f->setOrder('2');
		self::assertSame(5, $f->getParentId());
		self::assertSame(2, $f->getOrder());
	}

	public function testNullParentIsTopLevel(): void {
		$f = new Folder();
		self::assertNull($f->getParentId());
	}
}
```

- [ ] **Step 2: Run it, verify it fails**
Run: `~/deck-test.sh --filter FolderTest` → FAIL (class not found).

- [ ] **Step 3: Create the entity** — `lib/Db/Folder.php`
```php
<?php

/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\Deck\Db;

/**
 * @method string getTitle()
 * @method void setTitle(string $title)
 * @method int|null getParentId()
 * @method void setParentId(?int $parentId)
 * @method string getOwner()
 * @method void setOwner(string $owner)
 * @method int getOrder()
 * @method void setOrder(int $order)
 * @method int getLastModified()
 * @method void setLastModified(int $lastModified)
 */
class Folder extends RelationalEntity {
	protected $title;
	protected $parentId;
	protected $owner;
	protected $order = 0;
	protected $lastModified;

	public function __construct() {
		$this->addType('id', 'integer');
		$this->addType('parentId', 'integer');
		$this->addType('order', 'integer');
		$this->addType('lastModified', 'integer');
	}

	public function getETag(): string {
		return md5((string)$this->getLastModified());
	}
}
```

- [ ] **Step 4: Create the migration** — `lib/Migration/Version11703Date20260813120000.php`
```php
<?php

/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
declare(strict_types=1);

namespace OCA\Deck\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

class Version11703Date20260813120000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('deck_folders')) {
			$table = $schema->createTable('deck_folders');
			$table->addColumn('id', Types::INTEGER, ['autoincrement' => true, 'notnull' => true]);
			$table->addColumn('title', Types::STRING, ['notnull' => true, 'length' => 255]);
			$table->addColumn('parent_id', Types::INTEGER, ['notnull' => false]);
			$table->addColumn('owner', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('order', Types::INTEGER, ['notnull' => true, 'default' => 0]);
			$table->addColumn('last_modified', Types::INTEGER, ['notnull' => false]);
			$table->setPrimaryKey(['id']);
			$table->addIndex(['parent_id'], 'deck_folders_parent_idx');
		}

		if ($schema->hasTable('deck_boards')) {
			$boards = $schema->getTable('deck_boards');
			if (!$boards->hasColumn('folder_id')) {
				$boards->addColumn('folder_id', Types::INTEGER, ['notnull' => false]);
				$boards->addIndex(['folder_id'], 'deck_boards_folder_idx');
			}
		}

		return $schema;
	}
}
```

- [ ] **Step 5: Wire Board.folderId** — in `lib/Db/Board.php`: add `protected $folderId;` with the other props, add `$this->addType('folderId', 'integer');` next to the other `addType` calls (constructor ~line 52-56), and add the docblock `@method int|null getFolderId()` / `@method void setFolderId(?int $folderId)`. (It is a scalar column → serializes automatically, no `addRelation`.)

- [ ] **Step 6: Run the test, verify it passes**
Run: `~/deck-test.sh --filter FolderTest` → PASS (2 tests).

- [ ] **Step 7: Commit**
```bash
git add lib/Db/Folder.php lib/Db/Board.php lib/Migration/Version11703Date20260813120000.php tests/unit/Db/FolderTest.php
git commit -m "feat(deck): folder entity + migration + board.folder_id"
```

---

### Task 2: FolderMapper + BoardMapper::findInFolder

**Files:**
- Create: `lib/Db/FolderMapper.php`
- Modify: `lib/Db/CardMapper.php`? NO — `lib/Db/BoardMapper.php` (add `findInFolder`)
- Test: `tests/unit/Db/FolderMapperTest.php`; extend `tests/unit/Db/BoardMapperTest.php`

**Interfaces:**
- Produces: `FolderMapper` with `findAll(): Folder[]` (order by `parent_id`, `order`, `title`), `findChildren(int $parentId): Folder[]`, `hasChildren(int $id): bool`, `find(int $id): Folder`, `maxOrder(?int $parentId): int`, `insert`/`update` (stamp lastModified); `BoardMapper::findInFolder(int $folderId): Board[]`.

- [ ] **Step 1: Write the failing test** — `tests/unit/Db/FolderMapperTest.php` (`@group DB`, multi-line docblock). Assert: `findAll` returns inserted folders; `findChildren(parent)` filters; `hasChildren` true/false; `insert` stamps `lastModified`; `maxOrder` returns the highest sibling order (or -1/0 when none). Model the DB-test shape on `CustomFieldMapperTest`.

```php
<?php

/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\Deck\Db;

use OCP\IDBConnection;
use Test\TestCase;

/**
 * @group DB
 */
class FolderMapperTest extends TestCase {
	private FolderMapper $mapper;

	public function setUp(): void {
		parent::setUp();
		$this->mapper = new FolderMapper(\OC::$server->get(IDBConnection::class));
	}

	private function make(?int $parent, string $title, int $order): Folder {
		$f = new Folder();
		$f->setTitle($title);
		$f->setOwner('admin');
		$f->setParentId($parent);
		$f->setOrder($order);
		return $this->mapper->insert($f);
	}

	public function testChildrenAndHasChildren(): void {
		$root = $this->make(null, 'Root', 0);
		$child = $this->make($root->getId(), 'Child', 0);
		self::assertSame(['Child'], array_map(fn ($f) => $f->getTitle(), $this->mapper->findChildren($root->getId())));
		self::assertTrue($this->mapper->hasChildren($root->getId()));
		self::assertFalse($this->mapper->hasChildren($child->getId()));
		self::assertGreaterThan(0, $child->getLastModified());
		$this->mapper->delete($child);
		$this->mapper->delete($root);
	}

	public function testMaxOrder(): void {
		$a = $this->make(null, 'A', 3);
		$b = $this->make(null, 'B', 7);
		self::assertGreaterThanOrEqual(7, $this->mapper->maxOrder(null));
		$this->mapper->delete($a);
		$this->mapper->delete($b);
	}
}
```

- [ ] **Step 2: Run it, verify it fails**
Run: `~/deck-test.sh --filter FolderMapperTest` → FAIL (class not found).

- [ ] **Step 3: Create the mapper** — `lib/Db/FolderMapper.php`
```php
<?php

/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\Deck\Db;

use OCP\AppFramework\Db\Entity;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends DeckMapper<Folder> */
class FolderMapper extends DeckMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deck_folders', Folder::class);
	}

	/** @return Folder[] */
	public function findAll(): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->orderBy('parent_id', 'ASC')->addOrderBy('order', 'ASC')->addOrderBy('title', 'ASC');
		return $this->findEntities($qb);
	}

	/** @return Folder[] */
	public function findChildren(int $parentId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('parent_id', $qb->createNamedParameter($parentId, IQueryBuilder::PARAM_INT)))
			->orderBy('order', 'ASC')->addOrderBy('title', 'ASC');
		return $this->findEntities($qb);
	}

	public function hasChildren(int $id): bool {
		$qb = $this->db->getQueryBuilder();
		$qb->select('id')->from($this->getTableName())
			->where($qb->expr()->eq('parent_id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)))
			->setMaxResults(1);
		return $qb->executeQuery()->fetch() !== false;
	}

	public function maxOrder(?int $parentId): int {
		$qb = $this->db->getQueryBuilder();
		$qb->selectAlias($qb->func()->max('order'), 'maxorder')->from($this->getTableName());
		if ($parentId === null) {
			$qb->where($qb->expr()->isNull('parent_id'));
		} else {
			$qb->where($qb->expr()->eq('parent_id', $qb->createNamedParameter($parentId, IQueryBuilder::PARAM_INT)));
		}
		$row = $qb->executeQuery()->fetch();
		return $row && $row['maxorder'] !== null ? (int)$row['maxorder'] : -1;
	}

	public function insert(Entity $entity): Entity {
		if (!array_key_exists('lastModified', $entity->getUpdatedFields())) {
			$entity->setLastModified(time());
		}
		return parent::insert($entity);
	}

	public function update(Entity $entity, bool $updateModified = true): Entity {
		if ($updateModified) {
			$entity->setLastModified(time());
		}
		return parent::update($entity);
	}
}
```
> `order` and `parent_id` are quoted by the QueryBuilder — safe to use as identifiers.

- [ ] **Step 4: Add `BoardMapper::findInFolder`** — in `lib/Db/BoardMapper.php`:
```php
	/** @return Board[] */
	public function findInFolder(int $folderId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from('deck_boards')
			->where($qb->expr()->eq('folder_id', $qb->createNamedParameter($folderId, IQueryBuilder::PARAM_INT)));
		return $this->findEntities($qb);
	}
```
Add a `BoardMapperTest` case: insert a board, `setFolderId`, update, assert `findInFolder(id)` returns it. (Board insert in that test already exists — reuse `getBoard`.)

- [ ] **Step 5: Run the tests, verify they pass**
Run: `~/deck-test.sh --filter "FolderMapperTest|BoardMapperTest"` → PASS.

- [ ] **Step 6: Commit**
```bash
git add lib/Db/FolderMapper.php lib/Db/BoardMapper.php tests/unit/Db/FolderMapperTest.php tests/unit/Db/BoardMapperTest.php
git commit -m "feat(deck): FolderMapper + BoardMapper::findInFolder"
```

---

### Task 3: FolderServiceValidator

**Files:** Create `lib/Validators/FolderServiceValidator.php`; Test `tests/unit/Validators/FolderServiceValidatorTest.php`

**Interfaces:** Produces `FolderServiceValidator` — `rules()`: `id`→numeric; `title`→not_empty/not_null/not_false/max:255.

- [ ] **Step 1: Failing test** — accepts a valid title; rejects empty title (expects `BadRequestException`). Model on `CustomFieldServiceValidatorTest`.
- [ ] **Step 2: Run** `~/deck-test.sh --filter FolderServiceValidatorTest` → FAIL.
- [ ] **Step 3: Implement**
```php
<?php

/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
declare(strict_types=1);

namespace OCA\Deck\Validators;

class FolderServiceValidator extends BaseValidator {
	public function rules() {
		return [
			'id' => ['numeric'],
			'title' => ['not_empty', 'not_null', 'not_false', 'max:255'],
		];
	}
}
```
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add lib/Validators/FolderServiceValidator.php tests/unit/Validators/FolderServiceValidatorTest.php && git commit -m "feat(deck): folder validator"`

---

### Task 4: FolderService

**Files:** Create `lib/Service/FolderService.php`; Test `tests/unit/Service/FolderServiceTest.php`

**Interfaces:**
- Consumes: `FolderMapper`, `BoardMapper`, `FolderServiceValidator`, `IUserSession` (for `owner`/current uid).
- Produces:
  - `findAll(): Folder[]`
  - `create(string $title, ?int $parentId): Folder` — validate; parent must exist if set; `owner`=uid; `order`=`maxOrder(parentId)+1`; insert.
  - `rename(int $id, string $title): Folder` — validate; update title.
  - `move(int $id, ?int $parentId): Folder` — **cycle prevention** (reject if `parentId === id` or `parentId` is a descendant of `id`); parent must exist if set.
  - `delete(int $id): void` — reject with `BadRequestException` if `boardMapper->findInFolder(id)` non-empty OR `folderMapper->hasChildren(id)`; else delete.

- [ ] **Step 1: Failing test** — mock all collaborators. Assert:
  - `testMoveRejectsCycle`: moving folder A under its own descendant throws `BadRequestException` (arrange `find` to return a chain where walking up from the target parent reaches A).
  - `testDeleteRejectsWhenBoardsPresent`: `boardMapper->findInFolder` returns `[a board]` → `delete` throws; `folderMapper->delete` never called.
  - `testDeleteRejectsWhenSubfolders`: `hasChildren` true → throws.
  - `testDeleteOkWhenEmpty`: both empty → `folderMapper->delete` called.
  - `testCreateSeedsOrder`: `maxOrder` returns 4 → created folder has `order` 5.

```php
<?php

/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\Deck\Service;

use OCA\Deck\BadRequestException;
use OCA\Deck\Db\BoardMapper;
use OCA\Deck\Db\Folder;
use OCA\Deck\Db\FolderMapper;
use OCA\Deck\Validators\FolderServiceValidator;
use OCP\IUser;
use OCP\IUserSession;
use PHPUnit\Framework\MockObject\MockObject;
use Test\TestCase;

class FolderServiceTest extends TestCase {
	private FolderMapper&MockObject $folderMapper;
	private BoardMapper&MockObject $boardMapper;
	private IUserSession&MockObject $userSession;
	private FolderService $service;

	public function setUp(): void {
		parent::setUp();
		$this->folderMapper = $this->createMock(FolderMapper::class);
		$this->boardMapper = $this->createMock(BoardMapper::class);
		$this->userSession = $this->createMock(IUserSession::class);
		$user = $this->createMock(IUser::class);
		$user->method('getUID')->willReturn('admin');
		$this->userSession->method('getUser')->willReturn($user);
		$this->service = new FolderService(
			$this->folderMapper, $this->boardMapper, $this->userSession, new FolderServiceValidator(),
		);
	}

	public function testCreateSeedsOrder(): void {
		$this->folderMapper->method('maxOrder')->willReturn(4);
		$this->folderMapper->method('insert')->willReturnArgument(0);
		$f = $this->service->create('Espaço', null);
		self::assertSame(5, $f->getOrder());
		self::assertSame('admin', $f->getOwner());
	}

	public function testDeleteRejectsWhenBoardsPresent(): void {
		$this->folderMapper->method('find')->willReturn(new Folder());
		$this->boardMapper->method('findInFolder')->willReturn([new \OCA\Deck\Db\Board()]);
		$this->folderMapper->expects(self::never())->method('delete');
		$this->expectException(BadRequestException::class);
		$this->service->delete(10);
	}

	public function testDeleteOkWhenEmpty(): void {
		$folder = new Folder();
		$this->folderMapper->method('find')->willReturn($folder);
		$this->boardMapper->method('findInFolder')->willReturn([]);
		$this->folderMapper->method('hasChildren')->willReturn(false);
		$this->folderMapper->expects(self::once())->method('delete')->with($folder);
		$this->service->delete(10);
	}

	public function testMoveRejectsCycle(): void {
		// folder 1's target parent is 2, whose parent is 1 → cycle.
		$one = new Folder(); $one->setParentId(null);
		$two = new Folder(); $two->setParentId(1);
		$this->folderMapper->method('find')->willReturnMap([[1, $one], [2, $two]]);
		$this->expectException(BadRequestException::class);
		$this->service->move(1, 2);
	}
}
```
> Note the test uses `find` id→entity mapping; make `Folder::getId()` deterministic in the test by setting ids, or adapt the cycle-walk to accept the mocked chain. Implementer: ensure the cycle walk calls `folderMapper->find($parentId)` and follows `getParentId()` up to root, comparing each id to `$id`.

- [ ] **Step 2: Run** `~/deck-test.sh --filter FolderServiceTest` → FAIL.
- [ ] **Step 3: Implement** — `lib/Service/FolderService.php`
```php
<?php

/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\Deck\Service;

use OCA\Deck\BadRequestException;
use OCA\Deck\Db\BoardMapper;
use OCA\Deck\Db\Folder;
use OCA\Deck\Db\FolderMapper;
use OCA\Deck\Validators\FolderServiceValidator;
use OCP\IUserSession;

class FolderService {
	public function __construct(
		private FolderMapper $folderMapper,
		private BoardMapper $boardMapper,
		private IUserSession $userSession,
		private FolderServiceValidator $validator,
	) {
	}

	/** @return Folder[] */
	public function findAll(): array {
		return $this->folderMapper->findAll();
	}

	public function create(string $title, ?int $parentId): Folder {
		$this->validator->check(compact('title'));
		if ($parentId !== null) {
			$this->folderMapper->find($parentId); // throws if missing
		}
		$folder = new Folder();
		$folder->setTitle($title);
		$folder->setParentId($parentId);
		$folder->setOwner($this->userSession->getUser()->getUID());
		$folder->setOrder($this->folderMapper->maxOrder($parentId) + 1);
		return $this->folderMapper->insert($folder);
	}

	public function rename(int $id, string $title): Folder {
		$this->validator->check(compact('id', 'title'));
		$folder = $this->folderMapper->find($id);
		$folder->setTitle($title);
		return $this->folderMapper->update($folder);
	}

	public function move(int $id, ?int $parentId): Folder {
		$folder = $this->folderMapper->find($id);
		if ($parentId !== null) {
			if ($parentId === $id || $this->isDescendant($parentId, $id)) {
				throw new BadRequestException('cannot move a folder into itself or a descendant');
			}
			$this->folderMapper->find($parentId); // throws if missing
		}
		$folder->setParentId($parentId);
		return $this->folderMapper->update($folder);
	}

	public function delete(int $id): void {
		$folder = $this->folderMapper->find($id);
		if (count($this->boardMapper->findInFolder($id)) > 0 || $this->folderMapper->hasChildren($id)) {
			throw new BadRequestException('folder is not empty');
		}
		$this->folderMapper->delete($folder);
	}

	/** true if $folderId is $ancestorId itself or somewhere below it. */
	private function isDescendant(int $folderId, int $ancestorId): bool {
		$current = $folderId;
		while ($current !== null) {
			if ($current === $ancestorId) {
				return true;
			}
			$parent = $this->folderMapper->find($current)->getParentId();
			$current = $parent;
		}
		return false;
	}
}
```
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add lib/Service/FolderService.php tests/unit/Service/FolderServiceTest.php && git commit -m "feat(deck): FolderService (cycle guard + delete-when-empty)"`

---

### Task 5: BoardService::setFolder

**Files:** Modify `lib/Service/BoardService.php` (constructor + method); Test extend `tests/unit/Service/BoardServiceTest.php`

**Interfaces:**
- Consumes: `FolderMapper` (verify folder exists), `PermissionService`, `BoardMapper`.
- Produces: `setFolder(int $boardId, ?int $folderId): Board` — `checkPermission($boardMapper, $boardId, Acl::PERMISSION_MANAGE)`; if `$folderId` set, `folderMapper->find($folderId)`; `board->setFolderId($folderId)`; `boardMapper->update`; `changeHelper->boardChanged`.

**Ripple:** `BoardService` gets a new constructor param `FolderMapper` → update the ONE `new BoardService(...)` test call site in `tests/unit/Service/BoardServiceTest.php` (add a `FolderMapper` mock in the matching position). Read the constructor to place it correctly.

- [ ] **Step 1: Failing test** — `testSetFolderRequiresManage` (checkPermission throws → propagates) + `testSetFolderSetsFolderId` (permission passes, folder found, board.folderId set, update called). Mock collaborators.
- [ ] **Step 2: Run** `~/deck-test.sh --filter BoardServiceTest` → FAIL.
- [ ] **Step 3: Implement** — add param + method:
```php
	public function setFolder(int $boardId, ?int $folderId): Board {
		$this->permissionService->checkPermission($this->boardMapper, $boardId, Acl::PERMISSION_MANAGE);
		if ($folderId !== null) {
			$this->folderMapper->find($folderId); // throws if missing
		}
		$board = $this->boardMapper->find($boardId);
		$board->setFolderId($folderId);
		$this->boardMapper->update($board);
		$this->changeHelper->boardChanged($boardId);
		return $board;
	}
```
Add `private FolderMapper $folderMapper` to the constructor (import `use OCA\Deck\Db\FolderMapper;` if BoardService isn't already in `OCA\Deck\Service` importing Db classes — it imports many Db classes, follow the existing `use` style).
- [ ] **Step 4: Run** the full `BoardServiceTest` → PASS, no regressions.
- [ ] **Step 5: Commit** `git add lib/Service/BoardService.php tests/unit/Service/BoardServiceTest.php && git commit -m "feat(deck): BoardService::setFolder (board MANAGE gate)"`

---

### Task 6: FolderController + BoardController.setFolder + routes

**Files:** Create `lib/Controller/FolderController.php`; Modify `lib/Controller/BoardController.php`, `appinfo/routes.php`; Test `tests/unit/controller/FolderControllerTest.php`

**Interfaces:** routes `folder#index|create|rename|move|delete`, `board#setFolder`.

- [ ] **Step 1: Failing test** — thin passthrough (mock `FolderService`): `create` delegates. Model on `CustomFieldControllerTest`.
- [ ] **Step 2: Run** `~/deck-test.sh --filter FolderControllerTest` → FAIL.
- [ ] **Step 3: Implement** — `lib/Controller/FolderController.php`
```php
<?php

/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * AVUZ-BOARD-FOLDERS-V1 — board folders/Espaços (P6). Sentinel for
 * verify_avuz_patches; do not remove.
 */
namespace OCA\Deck\Controller;

use OCA\Deck\Db\Folder;
use OCA\Deck\Service\FolderService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\IRequest;

class FolderController extends Controller {
	public function __construct($appName, IRequest $request, private FolderService $service) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	public function index(): array {
		return $this->service->findAll();
	}

	#[NoAdminRequired]
	public function create(string $title, ?int $parentId = null): Folder {
		return $this->service->create($title, $parentId);
	}

	#[NoAdminRequired]
	public function rename(int $folderId, string $title): Folder {
		return $this->service->rename($folderId, $title);
	}

	#[NoAdminRequired]
	public function move(int $folderId, ?int $parentId = null): Folder {
		return $this->service->move($folderId, $parentId);
	}

	#[NoAdminRequired]
	public function delete(int $folderId): void {
		$this->service->delete($folderId);
	}
}
```
- [ ] **Step 4: BoardController::setFolder** — add:
```php
	#[NoAdminRequired]
	public function setFolder(int $boardId, ?int $folderId = null): Board {
		return $this->boardService->setFolder($boardId, $folderId);
	}
```
(follow the controller's existing `use`/constructor for `boardService`; add `use OCA\Deck\Db\Board;` if needed.)
- [ ] **Step 5: Routes** — in `appinfo/routes.php` `'routes'` array (after the `// custom fields` block):
```php
		// board folders (AVUZ-BOARD-FOLDERS-V1)
		['name' => 'folder#index', 'url' => '/folders', 'verb' => 'GET'],
		['name' => 'folder#create', 'url' => '/folders', 'verb' => 'POST'],
		['name' => 'folder#rename', 'url' => '/folders/{folderId}', 'verb' => 'PUT'],
		['name' => 'folder#move', 'url' => '/folders/{folderId}/parent', 'verb' => 'PUT'],
		['name' => 'folder#delete', 'url' => '/folders/{folderId}', 'verb' => 'DELETE'],
		['name' => 'board#setFolder', 'url' => '/boards/{boardId}/folder', 'verb' => 'PUT'],
```
> `/folders/{folderId}/parent` (move) is distinct from `/folders/{folderId}` (rename) — no collision.
- [ ] **Step 6: Run** `~/deck-test.sh --filter FolderControllerTest` → PASS.
- [ ] **Step 7: Commit** `git add lib/Controller/FolderController.php lib/Controller/BoardController.php appinfo/routes.php tests/unit/controller/FolderControllerTest.php && git commit -m "feat(deck): folder controller + routes + board#setFolder (AVUZ-BOARD-FOLDERS-V1)"`

---

### Task 7: FolderApi frontend service

**Files:** Create `src/services/FolderApi.js`, `src/services/FolderApi.spec.js`

**Interfaces:** `getFolders()`, `createFolder(title, parentId)`, `renameFolder(id, title)`, `moveFolder(id, parentId)`, `deleteFolder(id)`, `setBoardFolder(boardId, folderId)` — axios promises resolving to `response.data`.

- [ ] **Step 1: Failing jest spec** — model on `CustomFieldApi.spec.js`. Assert `createFolder(0, ...)`? No — `createFolder('Espaço', null)` → `POST /apps/deck/folders {title, parentId}`; `setBoardFolder(3, 9)` → `PUT /apps/deck/boards/3/folder {folderId: 9}`; `moveFolder(2, 1)` → `PUT /apps/deck/folders/2/parent {parentId: 1}`; `getFolders()` → `GET /apps/deck/folders`.
- [ ] **Step 2: Run** `npm run test -- FolderApi` → FAIL.
- [ ] **Step 3: Implement** — `src/services/FolderApi.js`
```js
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'

export class FolderApi {

	url(url) {
		return generateUrl(`/apps/deck${url}`)
	}

	async getFolders() {
		return (await axios.get(this.url('/folders'))).data
	}

	async createFolder(title, parentId = null) {
		return (await axios.post(this.url('/folders'), { title, parentId })).data
	}

	async renameFolder(id, title) {
		return (await axios.put(this.url(`/folders/${id}`), { title })).data
	}

	async moveFolder(id, parentId = null) {
		return (await axios.put(this.url(`/folders/${id}/parent`), { parentId })).data
	}

	async deleteFolder(id) {
		return (await axios.delete(this.url(`/folders/${id}`))).data
	}

	async setBoardFolder(boardId, folderId = null) {
		return (await axios.put(this.url(`/boards/${boardId}/folder`), { folderId })).data
	}

}
```
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add src/services/FolderApi.js src/services/FolderApi.spec.js && git commit -m "feat(deck): FolderApi frontend service"`

---

### Task 8: Vuex store — folders module + tree getter

**Files:** Create `src/store/folders.js` (or add to an existing store module per the repo's pattern — check `src/store/`); Modify `src/store/main.js` (register); Test `src/store/folders.store.spec.js`

**Interfaces:**
- State: `folders` (flat list from `getFolders`).
- Actions: `loadFolders`, `createFolder`, `renameFolder`, `moveFolder`, `deleteFolder`, `setBoardFolder` (calls `FolderApi`, commits, and on `setBoardFolder` updates the board's `folderId` in board state).
- Getter: `boardTree` — builds the nested tree from `state.folders` + the boards getter (`noneArchivedBoards`): each folder gets `{ ...folder, children: subfolders, boards: boards with folderId === folder.id }`; returns `{ rootFolders, rootBoards }` (boards with `folderId == null`). No pruning (folders always included).

- [ ] **Step 1: Failing jest store test** — dispatch nothing; test the `boardTree` getter directly: given folders `[{id:1,parentId:null},{id:2,parentId:1}]` and boards `[{id:10,folderId:1},{id:11,folderId:null}]`, assert `rootFolders[0].id===1`, its `children[0].id===2`, its `boards[0].id===10`, and `rootBoards[0].id===11`. Mock the boards getter. Follow `customFields.store.spec.js` for mocking style (mock `FolderApi`/`BoardApi`).
- [ ] **Step 2: Run** `npm run test -- folders.store` → FAIL.
- [ ] **Step 3: Implement** the module + getter + register in `main.js` (mirror how `customFields` state/actions were added to `main.js`, or a dedicated module if the repo uses them). Instantiate `const folderApi = new FolderApi()`. The `boardTree` getter is pure (folders + boards → tree).
- [ ] **Step 4: Run** → PASS; then `npm run test` full → no regressions.
- [ ] **Step 5: Commit** `git add src/store/folders.js src/store/main.js src/store/folders.store.spec.js && git commit -m "feat(deck): folders store + tree getter"`

---

### Task 9: Sidebar folder tree (render)

**Files:** Create `src/components/navigation/AppNavigationFolder.vue`; Modify `src/components/navigation/AppNavigation.vue`

**Interfaces:** Consumes `boardTree` getter + `loadFolders` action.

- [ ] **Step 1** (Vue — verify by build+lint, not jest): create `AppNavigationFolder.vue` — a **recursive** `NcAppNavigationItem` (a folder) with:
  - `:name="folder.title"`, an `allowCollapse` folder icon, expandable.
  - children: `<AppNavigationFolder v-for="child in folder.children" :folder="child" />` (recursion) then `<AppNavigationBoard v-for="board in folder.boards" :board="board" />`.
  - Register itself for recursion (`name: 'AppNavigationFolder'`, use `components: { AppNavigationBoard }` and reference itself by name).
- [ ] **Step 2** Modify `AppNavigation.vue`: on mount dispatch `loadFolders`; in the "All boards" area, render the tree from `boardTree` — `<AppNavigationFolder v-for="f in boardTree.rootFolders" :folder="f" />` then the existing board list for `boardTree.rootBoards` (un-foldered). Keep archived/shared categories unchanged. (Model the board item usage on the existing `AppNavigationBoardCategory`.)
- [ ] **Step 3: Verify** — `npm run build` compiles clean; `npm run lint` no new errors; `npm run stylelint` clean. (No jest for Vue components here.) Do NOT commit `js/`.
- [ ] **Step 4: Commit** `git add src/components/navigation/AppNavigationFolder.vue src/components/navigation/AppNavigation.vue && git commit -m "feat(deck): render folder tree in navigation"`

---

### Task 10: Folder + board menu actions

**Files:** Modify `src/components/navigation/AppNavigationFolder.vue` (folder actions), `src/components/navigation/AppNavigation.vue` ("Nova pasta" at root), `src/components/navigation/AppNavigationBoard.vue` ("Mover para pasta…")

- [ ] **Step 1** In `AppNavigationFolder.vue`, add `NcActionButton`s to the folder item: **Nova subpasta** (create with `parentId=folder.id`), **Renomear** (inline edit or prompt → `renameFolder`), **Excluir** (→ `deleteFolder`; on the `BadRequestException`/"folder is not empty" rejection, `showError(t('deck','A pasta não está vazia'))`). Import `showError` from `@nextcloud/dialogs`.
- [ ] **Step 2** In `AppNavigation.vue`, add a **Nova pasta** control at root (`createFolder(title, null)`).
- [ ] **Step 3** In `AppNavigationBoard.vue`, add a **"Mover para pasta…"** `NcActionButton` (shown only when the user can manage the board — reuse the same guard the existing manage-only actions use, e.g. `canManage`/the board's permissions). It opens a small folder picker (list from `boardTree` flattened, + a "Raiz" option) → `setBoardFolder(board.id, folderId)`.
- [ ] **Step 4: Verify** — `npm run build` + `npm run lint` + `npm run stylelint` clean. No `js/` commit.
- [ ] **Step 5: Commit** `git add src/components/navigation/AppNavigationFolder.vue src/components/navigation/AppNavigation.vue src/components/navigation/AppNavigationBoard.vue && git commit -m "feat(deck): folder + board menu actions (create/rename/delete/move)"`

---

### Task 11: Version bump + authoritative build

**Files:** Modify `appinfo/info.xml` (`<version>1.17.3</version>`); Build `js/`

- [ ] **Step 1** `appinfo/info.xml`: `1.17.2` → `1.17.3`.
- [ ] **Step 2** i18n: do NOT hand-edit `l10n/` (Transifex-generated; msgid-fallback — same decision as P1). Verify the new UI strings are Portuguese (grep the new components for `t('deck',` / `this.t('deck',`); report any English msgid.
- [ ] **Step 3** `npm ci && npm run build` — compiles clean; grep `js/` for a marker (e.g. `AppNavigationFolder` / `boardTree`) to confirm the feature is in the bundle.
- [ ] **Step 4** Full sweep: `~/deck-test.sh` (no NEW failures vs the ~6 pre-existing) + `npm run test` (green).
- [ ] **Step 5: Commit** (includes `js/`)
```bash
git add appinfo/info.xml js/
git commit -m "chore(deck): v1.17.3 — board folders; build bundle"
```

---

## Post-implementation (deploy flow, outside this plan)

- Update the avuz-server submodule pointer; rebuild image; deploy staging.
- **Verify on deploy:** wait ~40–60s for boot, then confirm `installed_version == 1.17.3` AND `deck_folders` table + `deck_boards.folder_id` column exist (via `createSchema()->getTables()`, not `occ db:show-tables`). Entrypoint self-heals the migration hands-free; only reconcile manually if still stale a minute after boot.
- **Purge Cloudflare** for the JS bundle.
- Consider adding `AVUZ-BOARD-FOLDERS-V1` to `verify_avuz_patches`.

## Self-Review notes

- **Spec coverage:** recursive folders (Tasks 1,2), shared visible tree/no prune (Task 8 getter), board placement via MANAGE (Task 5), create/rename/nest any-user (Tasks 4,6), delete-when-empty (Task 4 `findInFolder`+`hasChildren`), cycle prevention (Task 4), menu actions/no-DnD (Tasks 9,10), order seeding (Task 4), sentinel (Task 6), version+build (Task 11).
- **Type consistency:** `folderId` (board), `parentId` (folder), route names, and `FolderApi` method names are used identically across back/front tasks.
- **Deferred (not in any task):** drag-and-drop, manual folder reorder UI, per-folder ACL — all fast-follow by design.
