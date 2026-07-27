# Deck Board Tags and Overview Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user tag Deck boards and filter the boards list by tag and by due date.

**Architecture:** Fork Deck v1.17.0 as `avuz-conecta/deck` branch `avuz`, shipped as a git submodule at `apps/deck` with its built `js/` committed. A board carries a tag when a label of that title is attached to the board directly (new table) or assigned to a live card on it. One new endpoint returns per-board tags and due-date counts; the boards list filters client-side.

**Tech Stack:** PHP 8 / Nextcloud 33 app framework (`SimpleMigrationStep`, `QBMapper`, `IQueryBuilder`), Vue 2.7 + Vuex + `@nextcloud/vue`, webpack, PHPUnit 9, Jest 29.

## Global Constraints

- Target Deck version: fork of upstream tag `v1.17.0`. `appinfo/info.xml` declares `<nextcloud min-version="33" max-version="33"/>` — do not change.
- App version becomes **`1.17.1`**. `resources/app-info.xsd` restricts `<version>` to strict three-part semver (`(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)`), so `1.17.0.1` is invalid. If upstream later ships a real 1.17.1, the rebase moves us to the next free patch number.
- Migration class name: `Version11701Date20260727120000`. `MigrationService::sortMigrations` orders on `/(\d+)Date(\d+)/`, so the `11701` prefix sorts after every upstream Deck migration (highest today is `Version11000Date20240222115515`).
- Due-date vocabulary reuses Deck's existing card-filter strings verbatim: `overdue`, `dueToday`, `dueWeek`, `dueMonth`, `noDue` (see `src/components/Controls.vue`). No second vocabulary.
- Tag identity is the label **title**, compared after `trim()` and case-folded.
- A **live card** is: `deleted_at = 0`, `archived = false`, `done IS NULL`, on a stack with `deleted_at = 0`.
- Follow Deck's existing conventions, not the house style guide, where they conflict: Vue SFCs use `export default`, PHP uses tabs, `t('deck', '...')` for strings.
- Every PHP file starts with the SPDX header used by the file it sits beside.
- Table name: `deck_board_assigned_labels`. Sentinel string: `AVUZ-BOARD-TAGS-V1`.
- **The database is PostgreSQL** (`portainer-stack.yml:18`, `portainer-stack-s3.yml:51`).
  All SQL must be valid Postgres: `archived` is a real boolean, not tinyint, and
  `SUM(...)` returns bigint — which arrives in PHP as a string, so every count is
  cast with `(int)`. `@group DB` suites run against Postgres, never sqlite; sqlite
  would pass SQL that Postgres rejects.

---

## File Structure

**Fork repo (`avuz-conecta/deck`, branch `avuz`):**

| Path | Responsibility |
| --- | --- |
| `appinfo/info.xml` | version bump to 1.17.1 |
| `appinfo/routes.php` | three new routes |
| `lib/Migration/Version11701Date20260727120000.php` | creates `deck_board_assigned_labels` |
| `lib/Db/BoardLabelMapper.php` | direct board↔label attachments, CRUD only |
| `lib/Db/BoardSummaryMapper.php` | the two aggregate reads: derived tags, due counts |
| `lib/Service/BoardTagService.php` | title↔label resolution, permission checks |
| `lib/Service/BoardSummaryService.php` | joins mappers with the user's visible boards |
| `lib/Controller/BoardTagController.php` | HTTP surface for both |
| `lib/Service/BoardService.php` | carries the ported board-copy fix |
| `src/helpers/boardFilters.js` | pure filter predicate — the only unit-tested JS |
| `src/services/BoardTagApi.js` | axios client |
| `src/store/main.js` | summary state, filter state, getters |
| `src/components/boards/BoardFilterBar.vue` | the filter UI |
| `src/components/boards/Boards.vue` | renders the bar, uses the filtered getter |
| `src/components/boards/BoardItem.vue` | direct-tag chips |
| `src/components/board/TagsTabSidebar.vue` | board-tag picker |
| `l10n/pt_BR.js` + `l10n/pt_BR.json` | translations |

**Server repo (this worktree):**

| Path | Change |
| --- | --- |
| `.gitmodules`, `apps/deck` | Deck becomes a submodule |
| `Dockerfile:41` | overlay copy line deleted |
| `docker/overlays/deck/` | directory deleted |
| `docker/entrypoint.sh:121-137` | sentinel entry updated |
| `CLAUDE.md` | Deck moves from the rsync list to the submodule line |

---

### Task 1: Fork bootstrap and reproducible build

Creates the fork and proves it builds byte-for-byte usable output before any feature code exists.

**Files:**
- Create: new GitHub repo `avuz-conecta/deck`
- Create: local clone at `~/work/avuz/deck-fork`

**Interfaces:**
- Produces: a `avuz` branch at upstream `v1.17.0` with `js/` committed, which every later task commits onto.

- [ ] **Step 1: Get explicit approval to create the repo**

Creating a GitHub repository is outward-facing. Ask the user to confirm the name
`avuz-conecta/deck` and whether it should be private, then wait for a clear yes.
Do not run the next step before that.

- [ ] **Step 2: Create the repo and the branch**

```bash
gh repo create avuz-conecta/deck --private --description "Avuz fork of nextcloud/deck"
```

```bash
git clone https://github.com/nextcloud/deck.git ~/work/avuz/deck-fork && cd ~/work/avuz/deck-fork && git checkout -b avuz v1.17.0
```

```bash
git remote add avuz https://github.com/avuz-conecta/deck.git && git remote set-url origin https://github.com/nextcloud/deck.git
```

`origin` stays upstream so `git fetch origin --tags` keeps working for rebases;
`avuz` is our push target.

- [ ] **Step 3: Install dependencies**

```bash
cd ~/work/avuz/deck-fork && npm ci
```

Expected: completes without `ERESOLVE`. If Node is too new, install the version
in `package.json` `engines` via nvm and retry — do not pass `--force`.

```bash
cd ~/work/avuz/deck-fork && composer install --no-dev
```

- [ ] **Step 4: Build the frontend and confirm output**

```bash
cd ~/work/avuz/deck-fork && npm run build
```

```bash
ls -la ~/work/avuz/deck-fork/js/ | head -20
```

Expected: `deck-main.js` and siblings present with a current timestamp.

- [ ] **Step 5: Un-ignore the build output**

`js/` is gitignored upstream because the App Store builds it. We ship it.

Edit `.gitignore` and remove the line ignoring `/js/` (grep for it first —
`grep -n "^/\?js" .gitignore`). Then:

```bash
cd ~/work/avuz/deck-fork && git add -f js/ .gitignore && git status --short | head
```

- [ ] **Step 6: Stand up a Postgres-backed Nextcloud dev instance**

Tasks 4 and 5 carry `@group DB` mapper suites — the tests covering the aggregate
SQL. They need a real Nextcloud with a real Postgres behind it. Production runs
Postgres, so the harness does too; sqlite would accept SQL that Postgres rejects
and defeat the purpose of the tests.

```bash
docker run -d --name deck-test-db -e POSTGRES_PASSWORD=deck -e POSTGRES_USER=deck -e POSTGRES_DB=deck -p 55432:5432 postgres:16
```

```bash
docker run -d --name deck-test-nc --link deck-test-db:db -p 8099:80 -v ~/work/avuz/deck-fork:/var/www/html/custom_apps/deck nextcloud:33
```

Complete the install through `occ`, pointing at the linked Postgres:

```bash
docker exec -u www-data deck-test-nc php occ maintenance:install --database pgsql --database-host db --database-name deck --database-user deck --database-pass deck --admin-user admin --admin-pass admin
```

```bash
docker exec -u www-data deck-test-nc php occ app:enable deck && docker exec -u www-data deck-test-nc php occ status
```

Expected: `installed: true`, deck enabled. If the `nextcloud:33` image is not
published yet, use the newest 33.x tag available; the app only needs the schema
and `Test\TestCase` bootstrap, not our production image.

- [ ] **Step 7: Run both suites to establish a green baseline**

Run PHPUnit **inside** the container, where `tests/bootstrap.php` can find the
server:

```bash
docker exec -u www-data -w /var/www/html/custom_apps/deck deck-test-nc php vendor/bin/phpunit -c tests/phpunit.xml 2>&1 | tail -20
```

Expected: the suite runs and reports its own baseline — some upstream failures are
acceptable, a fatal bootstrap error is not. Record the exact pass/fail counts in
the task report: every later task compares against this number, and without it
"tests pass" is unverifiable.

```bash
cd ~/work/avuz/deck-fork && npx jest --passWithNoTests 2>&1 | tail -5
```

Expected: no tests found (Task 9 adds the first one).

- [ ] **Step 8: Commit the baseline**

```bash
cd ~/work/avuz/deck-fork && git commit -m "build: ship compiled js/ in the avuz fork" && git push -u avuz avuz
```

---

### Task 2: Port the board-copy fix out of the overlay

The overlay this fork replaces contains one real fix. It moves in first, with the
regression test it never had.

**Files:**
- Modify: `lib/Service/BoardService.php` (fork, ~line 541)
- Test: `tests/unit/Service/BoardServiceTest.php`
- Reference: `docker/overlays/deck/lib/Service/BoardService.php` in the server repo

**Interfaces:**
- Consumes: Task 1's `avuz` branch.
- Produces: sentinel `AVUZ-DECK-CLONE-ORDER-V1` present in `lib/Service/BoardService.php`, which `docker/entrypoint.sh` already checks for.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/Service/BoardServiceTest.php`:

```php
public function testCloneKeepsLeftmostStackOrder(): void {
	$stack = new Stack();
	$stack->setId(1);
	$stack->setTitle('A Fazer');
	$stack->setOrder(0);

	$this->stackMapper->expects($this->once())
		->method('findAll')
		->willReturn([$stack]);

	$inserted = [];
	$this->stackMapper->expects($this->once())
		->method('insert')
		->willReturnCallback(function (Stack $newStack) use (&$inserted) {
			$inserted[] = $newStack->getOrder();
			$newStack->setId(99);
			return $newStack;
		});

	$this->service->clone(1, 'admin');

	$this->assertSame([0], $inserted, 'stack with order 0 must clone as order 0, not 999');
}
```

The exact mock wiring for `$this->service` and `$this->stackMapper` already exists
in that file's `setUp()`. Read it and match the established style — if `clone()`
needs more collaborators mocked than the existing tests set up, add only what the
method actually calls.

- [ ] **Step 2: Run it and watch it fail**

```bash
docker exec -u www-data -w /var/www/html/custom_apps/deck deck-test-nc php vendor/bin/phpunit -c tests/phpunit.xml --filter testCloneKeepsLeftmostStackOrder 2>&1 | tail -20
```

Expected: FAIL — asserts `[999]` where `[0]` was expected.

- [ ] **Step 3: Apply the fix**

In `lib/Service/BoardService.php`, inside the stack loop of `clone()`, replace:

```php
			if ($stack->getOrder() == null) {
```

with:

```php
			// AVUZ-DECK-CLONE-ORDER-V1: strict null check. Order is an int and the
			// leftmost stack is 0; loose `== null` treated 0 as null and bumped the
			// first column to order 999, so on copy it jumped to the end and every
			// card slid one column right (cloneCards maps by sorted index).
			if ($stack->getOrder() === null) {
```

- [ ] **Step 4: Run it and watch it pass**

```bash
docker exec -u www-data -w /var/www/html/custom_apps/deck deck-test-nc php vendor/bin/phpunit -c tests/phpunit.xml --filter testCloneKeepsLeftmostStackOrder 2>&1 | tail -20
```

Expected: OK (1 test).

- [ ] **Step 5: Commit**

```bash
cd ~/work/avuz/deck-fork && git add lib/Service/BoardService.php tests/unit/Service/BoardServiceTest.php && git commit -m "fix(board): keep stack order 0 when cloning a board"
```

---

### Task 3: Migration and version bump

**Files:**
- Create: `lib/Migration/Version11701Date20260727120000.php`
- Modify: `appinfo/info.xml` (line 23)

**Interfaces:**
- Produces: table `deck_board_assigned_labels(board_id int, label_id int)` with unique index `deck_board_labels_uq` on `(board_id, label_id)` and index `deck_board_labels_idx_b` on `(board_id)`. Task 4's mapper depends on exactly these names.

- [ ] **Step 1: Write the migration**

Create `lib/Migration/Version11701Date20260727120000.php`:

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

class Version11701Date20260727120000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('deck_board_assigned_labels')) {
			return null;
		}

		$table = $schema->createTable('deck_board_assigned_labels');
		$table->addColumn('board_id', Types::BIGINT, [
			'notnull' => true,
			'length' => 20,
		]);
		$table->addColumn('label_id', Types::BIGINT, [
			'notnull' => true,
			'length' => 20,
		]);
		$table->addUniqueIndex(['board_id', 'label_id'], 'deck_board_labels_uq');
		$table->addIndex(['board_id'], 'deck_board_labels_idx_b');

		return $schema;
	}
}
```

The table has no primary key column on purpose — the unique pair is the identity,
matching how `deck_assigned_labels` is shaped.

- [ ] **Step 2: Bump the app version**

In `appinfo/info.xml` line 23, replace `<version>1.17.0</version>` with:

```xml
    <version>1.17.1</version>
```

- [ ] **Step 3: Verify the version still validates**

```bash
cd ~/work/avuz/deck-fork && php -r '$x=new DOMDocument();$x->load("appinfo/info.xml");var_dump($x->schemaValidate("/Users/patrickrezende/work/avuz/avuz-server/resources/app-info.xsd"));' 2>&1 | tail -5
```

Expected: `bool(true)`. A `false` here means the version string broke the semver
pattern — fix it before continuing, since NC would reject the app at install time.

- [ ] **Step 4: Commit**

```bash
cd ~/work/avuz/deck-fork && git add lib/Migration/Version11701Date20260727120000.php appinfo/info.xml && git commit -m "feat(tags): add deck_board_assigned_labels table"
```

---

### Task 4: BoardLabelMapper — direct attachments

**Files:**
- Create: `lib/Db/BoardLabelMapper.php`
- Test: `tests/unit/Db/BoardLabelMapperTest.php`

**Interfaces:**
- Consumes: the table from Task 3.
- Produces:
  - `findLabelIdsForBoard(int $boardId): int[]`
  - `setForBoard(int $boardId, int[] $labelIds): void` — replaces the whole set
  - `deleteByBoard(int $boardId): void`
  - `deleteByLabel(int $labelId): void`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/Db/BoardLabelMapperTest.php`:

```php
<?php

/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Deck\Db;

use OCP\IDBConnection;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
class BoardLabelMapperTest extends TestCase {
	private IDBConnection $connection;
	private BoardLabelMapper $mapper;

	public function setUp(): void {
		parent::setUp();
		$this->connection = Server::get(IDBConnection::class);
		$this->mapper = new BoardLabelMapper($this->connection);
		$this->mapper->deleteByBoard(9001);
	}

	public function tearDown(): void {
		$this->mapper->deleteByBoard(9001);
		parent::tearDown();
	}

	public function testSetForBoardReplacesTheWholeSet(): void {
		$this->mapper->setForBoard(9001, [11, 12]);
		$this->assertEqualsCanonicalizing([11, 12], $this->mapper->findLabelIdsForBoard(9001));

		$this->mapper->setForBoard(9001, [12, 13]);
		$this->assertEqualsCanonicalizing([12, 13], $this->mapper->findLabelIdsForBoard(9001));
	}

	public function testSetForBoardWithEmptyListClearsTheBoard(): void {
		$this->mapper->setForBoard(9001, [11]);
		$this->mapper->setForBoard(9001, []);
		$this->assertSame([], $this->mapper->findLabelIdsForBoard(9001));
	}

	public function testDeleteByLabelRemovesThatLabelEverywhere(): void {
		$this->mapper->setForBoard(9001, [11, 12]);
		$this->mapper->deleteByLabel(11);
		$this->assertSame([12], $this->mapper->findLabelIdsForBoard(9001));
	}

	public function testFindLabelIdsForUnknownBoardReturnsEmpty(): void {
		$this->assertSame([], $this->mapper->findLabelIdsForBoard(9999));
	}
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
docker exec -u www-data -w /var/www/html/custom_apps/deck deck-test-nc php vendor/bin/phpunit -c tests/phpunit.xml tests/unit/Db/BoardLabelMapperTest.php 2>&1 | tail -20
```

Expected: FAIL — `Class "OCA\Deck\Db\BoardLabelMapper" not found`.

This suite is `@group DB` and needs a Nextcloud dev instance with the migration
applied. If no instance is reachable, stop and set one up — do not skip to the
implementation, because an untested mapper is where the SQL bugs hide.

- [ ] **Step 3: Write the mapper**

Create `lib/Db/BoardLabelMapper.php`:

```php
<?php

/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

declare(strict_types=1);

namespace OCA\Deck\Db;

use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

class BoardLabelMapper {
	public function __construct(
		private IDBConnection $db,
	) {
	}

	/**
	 * @return int[]
	 */
	public function findLabelIdsForBoard(int $boardId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('label_id')
			->from('deck_board_assigned_labels')
			->where($qb->expr()->eq('board_id', $qb->createNamedParameter($boardId, IQueryBuilder::PARAM_INT)));

		$result = $qb->executeQuery();
		$labelIds = array_map(static fn (array $row): int => (int)$row['label_id'], $result->fetchAll());
		$result->closeCursor();

		return $labelIds;
	}

	/**
	 * @param int[] $labelIds
	 */
	public function setForBoard(int $boardId, array $labelIds): void {
		$this->deleteByBoard($boardId);

		foreach (array_unique($labelIds) as $labelId) {
			$qb = $this->db->getQueryBuilder();
			$qb->insert('deck_board_assigned_labels')
				->values([
					'board_id' => $qb->createNamedParameter($boardId, IQueryBuilder::PARAM_INT),
					'label_id' => $qb->createNamedParameter($labelId, IQueryBuilder::PARAM_INT),
				])
				->executeStatement();
		}
	}

	public function deleteByBoard(int $boardId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete('deck_board_assigned_labels')
			->where($qb->expr()->eq('board_id', $qb->createNamedParameter($boardId, IQueryBuilder::PARAM_INT)))
			->executeStatement();
	}

	public function deleteByLabel(int $labelId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete('deck_board_assigned_labels')
			->where($qb->expr()->eq('label_id', $qb->createNamedParameter($labelId, IQueryBuilder::PARAM_INT)))
			->executeStatement();
	}
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
docker exec -u www-data -w /var/www/html/custom_apps/deck deck-test-nc php vendor/bin/phpunit -c tests/phpunit.xml tests/unit/Db/BoardLabelMapperTest.php 2>&1 | tail -20
```

Expected: OK (4 tests).

- [ ] **Step 5: Write the failing cascade test**

A deleted label must not leave a dangling board attachment. `LabelMapper::delete()`
(`lib/Db/LabelMapper.php:36`) is already the single choke point for this — it
overrides the parent to call `deleteLabelAssignments()` first, so every delete path
(label deleted, board deleted, import rollback) passes through it. The board
attachment cleanup belongs there, not in `LabelService`.

Add to `tests/unit/Db/BoardLabelMapperTest.php`:

```php
	public function testDeletingALabelDetachesItFromBoards(): void {
		$labelMapper = Server::get(LabelMapper::class);

		$label = new Label();
		$label->setTitle('Efêmera');
		$label->setColor('31CC7C');
		$label->setBoardId(9001);
		$label = $labelMapper->insert($label);

		$this->mapper->setForBoard(9001, [$label->getId()]);
		$labelMapper->delete($label);

		$this->assertSame([], $this->mapper->findLabelIdsForBoard(9001));
	}
```

Add `use OCP\Server;` and the `Label` class is already in this namespace.

- [ ] **Step 6: Run it and watch it fail**

```bash
docker exec -u www-data -w /var/www/html/custom_apps/deck deck-test-nc php vendor/bin/phpunit -c tests/phpunit.xml --filter testDeletingALabelDetachesItFromBoards 2>&1 | tail -20
```

Expected: FAIL — the attachment survives, so the array is not empty.

- [ ] **Step 7: Add the cascade**

In `lib/Db/LabelMapper.php`, inject the new mapper and extend `delete()`:

```php
	public function __construct(
		IDBConnection $db,
		private BoardLabelMapper $boardLabelMapper,
	) {
		parent::__construct($db, 'deck_labels', Label::class);
	}
```

Keep the existing `parent::__construct` arguments exactly as they are in the file —
copy them, do not retype from memory. Then:

```php
	public function delete(Entity $entity): Entity {
		// delete assigned labels
		$this->deleteLabelAssignments($entity->getId());
		// AVUZ: drop board-level attachments too, or the boards overview keeps
		// filtering on a tag whose label no longer exists.
		$this->boardLabelMapper->deleteByLabel($entity->getId());
		// delete label
		return parent::delete($entity);
	}
```

- [ ] **Step 8: Run the whole mapper suite**

```bash
docker exec -u www-data -w /var/www/html/custom_apps/deck deck-test-nc php vendor/bin/phpunit -c tests/phpunit.xml tests/unit/Db/BoardLabelMapperTest.php 2>&1 | tail -20
```

Expected: OK (5 tests).

- [ ] **Step 9: Commit**

```bash
cd ~/work/avuz/deck-fork && git add lib/Db/BoardLabelMapper.php lib/Db/LabelMapper.php tests/unit/Db/BoardLabelMapperTest.php && git commit -m "feat(tags): attach labels directly to boards"
```

---

### Task 5: BoardSummaryMapper — derived tags and due counts

The two aggregate reads. Both take board ids the caller has already
permission-checked, so neither touches ACL.

**Files:**
- Create: `lib/Db/BoardSummaryMapper.php`
- Test: `tests/unit/Db/BoardSummaryMapperTest.php`

**Interfaces:**
- Consumes: `BoardLabelMapper` from Task 4 (only in the test, for fixtures).
- Produces:
  - `findDerivedTags(int[] $boardIds): array` → `[boardId => string[]]`
  - `findDirectTags(int[] $boardIds): array` → `[boardId => string[]]`
  - `findDueCounts(int[] $boardIds, \DateTimeImmutable $now): array` → `[boardId => ['overdue' => int, 'dueToday' => int, 'dueWeek' => int, 'dueMonth' => int, 'noDue' => int]]`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/Db/BoardSummaryMapperTest.php`. It builds a real board with a
stack, four cards, and two labels, then asserts what each read returns.

```php
<?php

/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Deck\Db;

use OCP\IDBConnection;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
class BoardSummaryMapperTest extends TestCase {
	private BoardSummaryMapper $mapper;
	private BoardMapper $boardMapper;
	private StackMapper $stackMapper;
	private CardMapper $cardMapper;
	private LabelMapper $labelMapper;
	private Board $board;
	private Stack $stack;

	public function setUp(): void {
		parent::setUp();
		$db = Server::get(IDBConnection::class);
		$this->mapper = new BoardSummaryMapper($db);
		$this->boardMapper = Server::get(BoardMapper::class);
		$this->stackMapper = Server::get(StackMapper::class);
		$this->cardMapper = Server::get(CardMapper::class);
		$this->labelMapper = Server::get(LabelMapper::class);

		$board = new Board();
		$board->setTitle('Summary Fixture');
		$board->setOwner('admin');
		$board->setColor('ff0000');
		$this->board = $this->boardMapper->insert($board);

		$stack = new Stack();
		$stack->setTitle('A Fazer');
		$stack->setBoardId($this->board->getId());
		$stack->setOrder(0);
		$this->stack = $this->stackMapper->insert($stack);
	}

	public function tearDown(): void {
		$this->boardMapper->delete($this->board);
		parent::tearDown();
	}

	private function makeCard(string $title, ?string $duedate, bool $archived = false, ?string $done = null): Card {
		$card = new Card();
		$card->setTitle($title);
		$card->setStackId($this->stack->getId());
		$card->setOwner('admin');
		$card->setOrder(0);
		$card->setArchived($archived);
		$card->setDuedate($duedate === null ? null : new \DateTime($duedate));
		$card->setDone($done === null ? null : new \DateTime($done));
		return $this->cardMapper->insert($card);
	}

	private function makeLabel(string $title): Label {
		$label = new Label();
		$label->setTitle($title);
		$label->setColor('31CC7C');
		$label->setBoardId($this->board->getId());
		return $this->labelMapper->insert($label);
	}

	public function testDerivedTagsListLabelsOfLiveCards(): void {
		$live = $this->makeCard('Live', '2030-01-01 10:00:00');
		$label = $this->makeLabel('Cliente X');
		$this->cardMapper->assignLabel($live->getId(), $label->getId());

		$tags = $this->mapper->findDerivedTags([$this->board->getId()]);

		$this->assertSame(['Cliente X'], $tags[$this->board->getId()]);
	}

	public function testDerivedTagsIgnoreDoneAndArchivedCards(): void {
		$done = $this->makeCard('Done', '2030-01-01 10:00:00', false, '2026-01-01 10:00:00');
		$archived = $this->makeCard('Archived', '2030-01-01 10:00:00', true);
		$label = $this->makeLabel('Invisivel');
		$this->cardMapper->assignLabel($done->getId(), $label->getId());
		$this->cardMapper->assignLabel($archived->getId(), $label->getId());

		$tags = $this->mapper->findDerivedTags([$this->board->getId()]);

		$this->assertArrayNotHasKey($this->board->getId(), $tags);
	}

	public function testDueCountsBucketLiveCards(): void {
		$now = new \DateTimeImmutable('2026-07-27 12:00:00');
		$this->makeCard('Late', '2026-07-01 10:00:00');
		$this->makeCard('Soon', '2026-07-27 20:00:00');
		$this->makeCard('NextWeek', '2026-08-01 10:00:00');
		$this->makeCard('NoDate', null);

		$counts = $this->mapper->findDueCounts([$this->board->getId()], $now);

		$this->assertSame(1, $counts[$this->board->getId()]['overdue']);
		$this->assertSame(1, $counts[$this->board->getId()]['dueToday']);
		$this->assertSame(2, $counts[$this->board->getId()]['dueWeek']);
		$this->assertSame(3, $counts[$this->board->getId()]['dueMonth']);
		$this->assertSame(1, $counts[$this->board->getId()]['noDue']);
	}

	public function testEmptyBoardListReturnsEmptyArray(): void {
		$this->assertSame([], $this->mapper->findDueCounts([], new \DateTimeImmutable()));
		$this->assertSame([], $this->mapper->findDerivedTags([]));
	}
}
```

Note the bucket expectations: `dueWeek` counts the card due today *and* the one
due in five days, because the windows nest. `dueMonth` counts all three dated
future cards. Overdue is never counted in a forward window.

`CardMapper::assignLabel(int $card, int $label): void` is the assignment helper —
note the argument order is card first, label second.

- [ ] **Step 2: Run it and watch it fail**

```bash
docker exec -u www-data -w /var/www/html/custom_apps/deck deck-test-nc php vendor/bin/phpunit -c tests/phpunit.xml tests/unit/Db/BoardSummaryMapperTest.php 2>&1 | tail -20
```

Expected: FAIL — `Class "OCA\Deck\Db\BoardSummaryMapper" not found`.

- [ ] **Step 3: Write the mapper**

Create `lib/Db/BoardSummaryMapper.php`:

```php
<?php

/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

declare(strict_types=1);

namespace OCA\Deck\Db;

use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

class BoardSummaryMapper {
	public function __construct(
		private IDBConnection $db,
	) {
	}

	/**
	 * @param int[] $boardIds
	 * @return array<int, string[]>
	 */
	public function findDerivedTags(array $boardIds): array {
		if ($boardIds === []) {
			return [];
		}

		$qb = $this->db->getQueryBuilder();
		$qb->selectDistinct(['s.board_id', 'l.title'])
			->from('deck_labels', 'l')
			->innerJoin('l', 'deck_assigned_labels', 'al', $qb->expr()->eq('al.label_id', 'l.id'))
			->innerJoin('al', 'deck_cards', 'c', $qb->expr()->eq('c.id', 'al.card_id'))
			->innerJoin('c', 'deck_stacks', 's', $qb->expr()->eq('s.id', 'c.stack_id'))
			->where($qb->expr()->in('s.board_id', $qb->createNamedParameter($boardIds, IQueryBuilder::PARAM_INT_ARRAY)))
			->andWhere($qb->expr()->eq('c.archived', $qb->createNamedParameter(false, IQueryBuilder::PARAM_BOOL)))
			->andWhere($qb->expr()->eq('c.deleted_at', $qb->createNamedParameter(0, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->isNull('c.done'))
			->andWhere($qb->expr()->eq('s.deleted_at', $qb->createNamedParameter(0, IQueryBuilder::PARAM_INT)));

		return $this->groupTitlesByBoard($qb);
	}

	/**
	 * @param int[] $boardIds
	 * @return array<int, string[]>
	 */
	public function findDirectTags(array $boardIds): array {
		if ($boardIds === []) {
			return [];
		}

		$qb = $this->db->getQueryBuilder();
		$qb->selectDistinct(['bal.board_id', 'l.title'])
			->from('deck_board_assigned_labels', 'bal')
			->innerJoin('bal', 'deck_labels', 'l', $qb->expr()->eq('l.id', 'bal.label_id'))
			->where($qb->expr()->in('bal.board_id', $qb->createNamedParameter($boardIds, IQueryBuilder::PARAM_INT_ARRAY)));

		return $this->groupTitlesByBoard($qb);
	}

	/**
	 * @param int[] $boardIds
	 * @return array<int, array{overdue: int, dueToday: int, dueWeek: int, dueMonth: int, noDue: int}>
	 */
	public function findDueCounts(array $boardIds, \DateTimeImmutable $now): array {
		if ($boardIds === []) {
			return [];
		}

		$qb = $this->db->getQueryBuilder();
		$nowParam = $qb->createNamedParameter($now, IQueryBuilder::PARAM_DATETIME_IMMUTABLE);
		$in24h = $qb->createNamedParameter($now->modify('+1 day'), IQueryBuilder::PARAM_DATETIME_IMMUTABLE);
		$in7d = $qb->createNamedParameter($now->modify('+7 days'), IQueryBuilder::PARAM_DATETIME_IMMUTABLE);
		$in30d = $qb->createNamedParameter($now->modify('+30 days'), IQueryBuilder::PARAM_DATETIME_IMMUTABLE);

		$bucket = static fn (string $condition): string => "SUM(CASE WHEN $condition THEN 1 ELSE 0 END)";

		$qb->select('s.board_id')
			->selectAlias($qb->createFunction($bucket("c.duedate IS NOT NULL AND c.duedate < $nowParam")), 'overdue')
			->selectAlias($qb->createFunction($bucket("c.duedate >= $nowParam AND c.duedate <= $in24h")), 'due_today')
			->selectAlias($qb->createFunction($bucket("c.duedate >= $nowParam AND c.duedate <= $in7d")), 'due_week')
			->selectAlias($qb->createFunction($bucket("c.duedate >= $nowParam AND c.duedate <= $in30d")), 'due_month')
			->selectAlias($qb->createFunction($bucket('c.duedate IS NULL')), 'no_due')
			->from('deck_cards', 'c')
			->innerJoin('c', 'deck_stacks', 's', $qb->expr()->eq('s.id', 'c.stack_id'))
			->where($qb->expr()->in('s.board_id', $qb->createNamedParameter($boardIds, IQueryBuilder::PARAM_INT_ARRAY)))
			->andWhere($qb->expr()->eq('c.archived', $qb->createNamedParameter(false, IQueryBuilder::PARAM_BOOL)))
			->andWhere($qb->expr()->eq('c.deleted_at', $qb->createNamedParameter(0, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->isNull('c.done'))
			->andWhere($qb->expr()->eq('s.deleted_at', $qb->createNamedParameter(0, IQueryBuilder::PARAM_INT)))
			->groupBy('s.board_id');

		$result = $qb->executeQuery();
		$counts = [];
		foreach ($result->fetchAll() as $row) {
			$counts[(int)$row['board_id']] = [
				'overdue' => (int)$row['overdue'],
				'dueToday' => (int)$row['due_today'],
				'dueWeek' => (int)$row['due_week'],
				'dueMonth' => (int)$row['due_month'],
				'noDue' => (int)$row['no_due'],
			];
		}
		$result->closeCursor();

		return $counts;
	}

	/**
	 * @return array<int, string[]>
	 */
	private function groupTitlesByBoard(IQueryBuilder $qb): array {
		$result = $qb->executeQuery();
		$tags = [];
		foreach ($result->fetchAll() as $row) {
			$tags[(int)$row['board_id']][] = (string)$row['title'];
		}
		$result->closeCursor();

		return $tags;
	}
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
docker exec -u www-data -w /var/www/html/custom_apps/deck deck-test-nc php vendor/bin/phpunit -c tests/phpunit.xml tests/unit/Db/BoardSummaryMapperTest.php 2>&1 | tail -20
```

Expected: OK (4 tests).

Postgres returns `SUM(...)` as bigint, which PDO hands back as a string — the
`(int)` casts already cover that. If Postgres rejects
`selectAlias(createFunction(...))`, fall back to five separate `COUNT(*)` queries
with the same conditions rather than hand-writing SQL strings. Do not "fix" a
Postgres type error by loosening the cast; find the real column type first.

- [ ] **Step 5: Commit**

```bash
cd ~/work/avuz/deck-fork && git add lib/Db/BoardSummaryMapper.php tests/unit/Db/BoardSummaryMapperTest.php && git commit -m "feat(tags): read derived tags and due counts per board"
```

---

### Task 6: BoardTagService — title resolution

Turns a list of free-text titles into label rows on a board, creating what's
missing. This is where the case-folding and duplicate-title rules live.

**Files:**
- Create: `lib/Service/BoardTagService.php`
- Test: `tests/unit/Service/BoardTagServiceTest.php`

**Interfaces:**
- Consumes: `BoardLabelMapper` (Task 4), `LabelMapper`, `LabelService::create(string $title, string $color, int $boardId): Label`, `PermissionService::checkPermission(?IPermissionMapper $mapper, $id, int $permission)`.
- Produces:
  - `getTags(int $boardId): string[]`
  - `setTags(int $boardId, string[] $titles): string[]`
  - `const FALLBACK_COLOR = '31CC7C'`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/Service/BoardTagServiceTest.php`:

```php
<?php

/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Deck\Service;

use OCA\Deck\Db\Acl;
use OCA\Deck\Db\BoardLabelMapper;
use OCA\Deck\Db\BoardMapper;
use OCA\Deck\Db\Label;
use OCA\Deck\Db\LabelMapper;
use OCA\Deck\NoPermissionException;
use PHPUnit\Framework\MockObject\MockObject;
use Test\TestCase;

class BoardTagServiceTest extends TestCase {
	private BoardLabelMapper&MockObject $boardLabelMapper;
	private LabelMapper&MockObject $labelMapper;
	private LabelService&MockObject $labelService;
	private PermissionService&MockObject $permissionService;
	private BoardMapper&MockObject $boardMapper;
	private BoardTagService $service;

	public function setUp(): void {
		parent::setUp();
		$this->boardLabelMapper = $this->createMock(BoardLabelMapper::class);
		$this->labelMapper = $this->createMock(LabelMapper::class);
		$this->labelService = $this->createMock(LabelService::class);
		$this->permissionService = $this->createMock(PermissionService::class);
		$this->boardMapper = $this->createMock(BoardMapper::class);
		$this->service = new BoardTagService(
			$this->boardLabelMapper,
			$this->labelMapper,
			$this->labelService,
			$this->permissionService,
			$this->boardMapper,
		);
	}

	private function label(int $id, string $title): Label {
		$label = new Label();
		$label->setId($id);
		$label->setTitle($title);
		$label->setColor('31CC7C');
		$label->setBoardId(1);
		return $label;
	}

	public function testSetTagsReusesAnExistingLabelIgnoringCaseAndWhitespace(): void {
		$this->labelMapper->method('findAll')->willReturn([$this->label(7, 'Cliente X')]);
		$this->labelService->expects($this->never())->method('create');
		$this->boardLabelMapper->expects($this->once())->method('setForBoard')->with(1, [7]);

		$this->service->setTags(1, ['  cliente x  ']);
	}

	public function testSetTagsCreatesAMissingLabel(): void {
		$this->labelMapper->method('findAll')->willReturn([]);
		$this->labelService->expects($this->once())
			->method('create')
			->with('Novo', BoardTagService::FALLBACK_COLOR, 1)
			->willReturn($this->label(9, 'Novo'));
		$this->boardLabelMapper->expects($this->once())->method('setForBoard')->with(1, [9]);

		$this->service->setTags(1, ['Novo']);
	}

	public function testSetTagsPicksTheLowestIdWhenTitlesCollide(): void {
		$this->labelMapper->method('findAll')->willReturn([
			$this->label(12, 'Urgente'),
			$this->label(4, 'Urgente'),
		]);
		$this->boardLabelMapper->expects($this->once())->method('setForBoard')->with(1, [4]);

		$this->service->setTags(1, ['Urgente']);
	}

	public function testSetTagsRejectsAUserWithoutManagePermission(): void {
		$this->permissionService->method('checkPermission')
			->willThrowException(new NoPermissionException('nope'));

		$this->expectException(NoPermissionException::class);

		$this->service->setTags(1, ['Cliente X']);
	}

	public function testSetTagsWithAnEmptyListClearsTheBoard(): void {
		$this->labelMapper->method('findAll')->willReturn([$this->label(7, 'Cliente X')]);
		$this->boardLabelMapper->expects($this->once())->method('setForBoard')->with(1, []);

		$this->service->setTags(1, []);
	}
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
docker exec -u www-data -w /var/www/html/custom_apps/deck deck-test-nc php vendor/bin/phpunit -c tests/phpunit.xml tests/unit/Service/BoardTagServiceTest.php 2>&1 | tail -20
```

Expected: FAIL — `Class "OCA\Deck\Service\BoardTagService" not found`.

- [ ] **Step 3: Write the service**

Create `lib/Service/BoardTagService.php`:

```php
<?php

/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

declare(strict_types=1);

namespace OCA\Deck\Service;

use OCA\Deck\Db\Acl;
use OCA\Deck\Db\BoardLabelMapper;
use OCA\Deck\Db\BoardMapper;
use OCA\Deck\Db\Label;
use OCA\Deck\Db\LabelMapper;

class BoardTagService {
	public const FALLBACK_COLOR = '31CC7C';

	public function __construct(
		private BoardLabelMapper $boardLabelMapper,
		private LabelMapper $labelMapper,
		private LabelService $labelService,
		private PermissionService $permissionService,
		private BoardMapper $boardMapper,
	) {
	}

	/**
	 * @return string[]
	 */
	public function getTags(int $boardId): array {
		$this->permissionService->checkPermission($this->boardMapper, $boardId, Acl::PERMISSION_READ);

		$attached = $this->boardLabelMapper->findLabelIdsForBoard($boardId);
		$titles = [];
		foreach ($this->labelMapper->findAll($boardId) as $label) {
			if (in_array($label->getId(), $attached, true)) {
				$titles[] = $label->getTitle();
			}
		}

		return $titles;
	}

	/**
	 * @param string[] $titles
	 * @return string[] the titles actually stored
	 */
	public function setTags(int $boardId, array $titles): array {
		$this->permissionService->checkPermission($this->boardMapper, $boardId, Acl::PERMISSION_MANAGE);

		$existing = $this->indexLowestIdByTitle($this->labelMapper->findAll($boardId));

		$labelIds = [];
		$stored = [];
		foreach ($this->normalize($titles) as $key => $title) {
			$label = $existing[$key] ?? $this->labelService->create($title, self::FALLBACK_COLOR, $boardId);
			$labelIds[] = $label->getId();
			$stored[] = $label->getTitle();
		}

		$this->boardLabelMapper->setForBoard($boardId, $labelIds);

		return $stored;
	}

	/**
	 * @param Label[] $labels
	 * @return array<string, Label>
	 */
	private function indexLowestIdByTitle(array $labels): array {
		$byTitle = [];
		foreach ($labels as $label) {
			$key = $this->key($label->getTitle());
			if (!isset($byTitle[$key]) || $label->getId() < $byTitle[$key]->getId()) {
				$byTitle[$key] = $label;
			}
		}

		return $byTitle;
	}

	/**
	 * @param string[] $titles
	 * @return array<string, string> comparison key => display title
	 */
	private function normalize(array $titles): array {
		$normalized = [];
		foreach ($titles as $title) {
			$trimmed = trim($title);
			if ($trimmed === '') {
				continue;
			}
			$normalized[$this->key($trimmed)] = $trimmed;
		}

		return $normalized;
	}

	private function key(string $title): string {
		return mb_strtolower(trim($title));
	}
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
docker exec -u www-data -w /var/www/html/custom_apps/deck deck-test-nc php vendor/bin/phpunit -c tests/phpunit.xml tests/unit/Service/BoardTagServiceTest.php 2>&1 | tail -20
```

Expected: OK (5 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/work/avuz/deck-fork && git add lib/Service/BoardTagService.php tests/unit/Service/BoardTagServiceTest.php && git commit -m "feat(tags): resolve board tag titles to labels"
```

---

### Task 7: BoardSummaryService — merge the reads against visible boards

**Files:**
- Create: `lib/Service/BoardSummaryService.php`
- Test: `tests/unit/Service/BoardSummaryServiceTest.php`

**Interfaces:**
- Consumes: `BoardSummaryMapper` (Task 5), `BoardService::findAll(int $since = -1, bool $fullDetails = false, bool $includeArchived = true): Board[]`.
- Produces: `findForCurrentUser(): array` → list of `['boardId' => int, 'tags' => string[], 'directTags' => string[], 'due' => array{overdue:int,dueToday:int,dueWeek:int,dueMonth:int,noDue:int}]`

`tags` drives filtering (direct ∪ derived). `directTags` is what Task 12 renders as
chips on the tile — the tile must not display derived tags.

Permission comes free: `BoardService::findAll()` already returns only boards the
user may see, so the summary never queries a board id the caller can't read.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/Service/BoardSummaryServiceTest.php`:

```php
<?php

/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Deck\Service;

use OCA\Deck\Db\Board;
use OCA\Deck\Db\BoardSummaryMapper;
use OCP\AppFramework\Utility\ITimeFactory;
use PHPUnit\Framework\MockObject\MockObject;
use Test\TestCase;

class BoardSummaryServiceTest extends TestCase {
	private BoardSummaryMapper&MockObject $summaryMapper;
	private BoardService&MockObject $boardService;
	private ITimeFactory&MockObject $timeFactory;
	private BoardSummaryService $service;

	public function setUp(): void {
		parent::setUp();
		$this->summaryMapper = $this->createMock(BoardSummaryMapper::class);
		$this->boardService = $this->createMock(BoardService::class);
		$this->timeFactory = $this->createMock(ITimeFactory::class);
		$this->timeFactory->method('getDateTime')->willReturn(new \DateTime('2026-07-27 12:00:00'));
		$this->service = new BoardSummaryService(
			$this->summaryMapper,
			$this->boardService,
			$this->timeFactory,
		);
	}

	private function board(int $id): Board {
		$board = new Board();
		$board->setId($id);
		$board->setTitle("Board $id");
		return $board;
	}

	public function testMergesDirectAndDerivedTagsWithoutDuplicates(): void {
		$this->boardService->method('findAll')->willReturn([$this->board(1)]);
		$this->summaryMapper->method('findDirectTags')->willReturn([1 => ['Cliente X']]);
		$this->summaryMapper->method('findDerivedTags')->willReturn([1 => ['cliente x', 'Urgente']]);
		$this->summaryMapper->method('findDueCounts')->willReturn([]);

		$summaries = $this->service->findForCurrentUser();

		$this->assertEqualsCanonicalizing(['Cliente X', 'Urgente'], $summaries[0]['tags']);
		$this->assertSame(['Cliente X'], $summaries[0]['directTags']);
	}

	public function testDirectTagsExcludeDerivedOnes(): void {
		$this->boardService->method('findAll')->willReturn([$this->board(1)]);
		$this->summaryMapper->method('findDirectTags')->willReturn([]);
		$this->summaryMapper->method('findDerivedTags')->willReturn([1 => ['Urgente']]);
		$this->summaryMapper->method('findDueCounts')->willReturn([]);

		$summaries = $this->service->findForCurrentUser();

		$this->assertSame(['Urgente'], $summaries[0]['tags']);
		$this->assertSame([], $summaries[0]['directTags']);
	}

	public function testBoardWithNoCardsReportsZeroCounts(): void {
		$this->boardService->method('findAll')->willReturn([$this->board(1)]);
		$this->summaryMapper->method('findDirectTags')->willReturn([]);
		$this->summaryMapper->method('findDerivedTags')->willReturn([]);
		$this->summaryMapper->method('findDueCounts')->willReturn([]);

		$summaries = $this->service->findForCurrentUser();

		$this->assertSame([
			'overdue' => 0,
			'dueToday' => 0,
			'dueWeek' => 0,
			'dueMonth' => 0,
			'noDue' => 0,
		], $summaries[0]['due']);
	}

	public function testNoVisibleBoardsReturnsEmptyList(): void {
		$this->boardService->method('findAll')->willReturn([]);

		$this->assertSame([], $this->service->findForCurrentUser());
	}
}
```

Delete the `ITimeFactoryStub` property declaration and type the field as
`\OCP\AppFramework\Utility\ITimeFactory&MockObject` — the stub name above is a
leftover placeholder, and PHPUnit needs the real interface.

- [ ] **Step 2: Run it and watch it fail**

```bash
docker exec -u www-data -w /var/www/html/custom_apps/deck deck-test-nc php vendor/bin/phpunit -c tests/phpunit.xml tests/unit/Service/BoardSummaryServiceTest.php 2>&1 | tail -20
```

Expected: FAIL — `Class "OCA\Deck\Service\BoardSummaryService" not found`.

- [ ] **Step 3: Write the service**

Create `lib/Service/BoardSummaryService.php`:

```php
<?php

/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

declare(strict_types=1);

namespace OCA\Deck\Service;

use OCA\Deck\Db\BoardSummaryMapper;
use OCP\AppFramework\Utility\ITimeFactory;

class BoardSummaryService {
	private const EMPTY_COUNTS = [
		'overdue' => 0,
		'dueToday' => 0,
		'dueWeek' => 0,
		'dueMonth' => 0,
		'noDue' => 0,
	];

	public function __construct(
		private BoardSummaryMapper $summaryMapper,
		private BoardService $boardService,
		private ITimeFactory $timeFactory,
	) {
	}

	/**
	 * @return list<array{boardId: int, tags: string[], due: array<string, int>}>
	 */
	public function findForCurrentUser(): array {
		$boardIds = array_map(
			static fn ($board): int => (int)$board->getId(),
			$this->boardService->findAll(),
		);

		if ($boardIds === []) {
			return [];
		}

		$direct = $this->summaryMapper->findDirectTags($boardIds);
		$derived = $this->summaryMapper->findDerivedTags($boardIds);
		$now = \DateTimeImmutable::createFromMutable($this->timeFactory->getDateTime());
		$counts = $this->summaryMapper->findDueCounts($boardIds, $now);

		$summaries = [];
		foreach ($boardIds as $boardId) {
			$summaries[] = [
				'boardId' => $boardId,
				'tags' => $this->mergeTitles($direct[$boardId] ?? [], $derived[$boardId] ?? []),
				'directTags' => $direct[$boardId] ?? [],
				'due' => $counts[$boardId] ?? self::EMPTY_COUNTS,
			];
		}

		return $summaries;
	}

	/**
	 * @param string[] $direct
	 * @param string[] $derived
	 * @return string[]
	 */
	private function mergeTitles(array $direct, array $derived): array {
		$byKey = [];
		foreach ([...$direct, ...$derived] as $title) {
			$byKey[mb_strtolower(trim($title))] ??= $title;
		}

		return array_values($byKey);
	}
}
```

Direct titles are merged first, so when the same tag exists in both spellings the
board's own attachment wins the display casing.

- [ ] **Step 4: Run it and watch it pass**

```bash
docker exec -u www-data -w /var/www/html/custom_apps/deck deck-test-nc php vendor/bin/phpunit -c tests/phpunit.xml tests/unit/Service/BoardSummaryServiceTest.php 2>&1 | tail -20
```

Expected: OK (3 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/work/avuz/deck-fork && git add lib/Service/BoardSummaryService.php tests/unit/Service/BoardSummaryServiceTest.php && git commit -m "feat(tags): assemble per-board tag and due summaries"
```

---

### Task 8: Controller and routes

**Files:**
- Create: `lib/Controller/BoardTagController.php`
- Modify: `appinfo/routes.php` (after the `// labels` block, around line 75)
- Test: `tests/unit/Controller/BoardTagControllerTest.php`

**Interfaces:**
- Consumes: `BoardTagService` (Task 6), `BoardSummaryService` (Task 7).
- Produces HTTP:
  - `GET  /apps/deck/avuz/board-summary` → `[{boardId, tags, due}]`
  - `GET  /apps/deck/boards/{boardId}/tags` → `string[]`
  - `PUT  /apps/deck/boards/{boardId}/tags` body `{"tags": ["Cliente X"]}` → `string[]`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/Controller/BoardTagControllerTest.php`:

```php
<?php

/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Deck\Controller;

use OCA\Deck\Service\BoardSummaryService;
use OCA\Deck\Service\BoardTagService;
use OCP\IRequest;
use PHPUnit\Framework\MockObject\MockObject;
use Test\TestCase;

class BoardTagControllerTest extends TestCase {
	private BoardTagController $controller;
	private BoardTagService&MockObject $tagService;
	private BoardSummaryService&MockObject $summaryService;

	public function setUp(): void {
		parent::setUp();
		$this->tagService = $this->createMock(BoardTagService::class);
		$this->summaryService = $this->createMock(BoardSummaryService::class);
		$this->controller = new BoardTagController(
			'deck',
			$this->createMock(IRequest::class),
			$this->tagService,
			$this->summaryService,
		);
	}

	public function testSummaryReturnsWhatTheServiceProduced(): void {
		$expected = [['boardId' => 1, 'tags' => ['Cliente X'], 'due' => ['overdue' => 2]]];
		$this->summaryService->method('findForCurrentUser')->willReturn($expected);

		$this->assertSame($expected, $this->controller->summary());
	}

	public function testUpdatePassesTitlesThrough(): void {
		$this->tagService->expects($this->once())
			->method('setTags')
			->with(5, ['Cliente X', 'Urgente'])
			->willReturn(['Cliente X', 'Urgente']);

		$this->assertSame(['Cliente X', 'Urgente'], $this->controller->update(5, ['Cliente X', 'Urgente']));
	}

	public function testReadReturnsBoardTags(): void {
		$this->tagService->method('getTags')->with(5)->willReturn(['Cliente X']);

		$this->assertSame(['Cliente X'], $this->controller->read(5));
	}
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
docker exec -u www-data -w /var/www/html/custom_apps/deck deck-test-nc php vendor/bin/phpunit -c tests/phpunit.xml tests/unit/Controller/BoardTagControllerTest.php 2>&1 | tail -20
```

Expected: FAIL — `Class "OCA\Deck\Controller\BoardTagController" not found`.

- [ ] **Step 3: Write the controller**

Create `lib/Controller/BoardTagController.php`:

```php
<?php

/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

declare(strict_types=1);

namespace OCA\Deck\Controller;

use OCA\Deck\Service\BoardSummaryService;
use OCA\Deck\Service\BoardTagService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\IRequest;

class BoardTagController extends Controller {
	public function __construct(
		string $appName,
		IRequest $request,
		private BoardTagService $boardTagService,
		private BoardSummaryService $boardSummaryService,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	public function summary(): array {
		return $this->boardSummaryService->findForCurrentUser();
	}

	#[NoAdminRequired]
	public function read(int $boardId): array {
		return $this->boardTagService->getTags($boardId);
	}

	/**
	 * @param string[] $tags
	 */
	#[NoAdminRequired]
	public function update(int $boardId, array $tags): array {
		return $this->boardTagService->setTags($boardId, $tags);
	}
}
```

- [ ] **Step 4: Register the routes**

In `appinfo/routes.php`, immediately after the `// labels` block (the three
`label#...` entries around line 73-75), add:

```php
		// avuz board tags
		['name' => 'board_tag#summary', 'url' => '/avuz/board-summary', 'verb' => 'GET'],
		['name' => 'board_tag#read', 'url' => '/boards/{boardId}/tags', 'verb' => 'GET'],
		['name' => 'board_tag#update', 'url' => '/boards/{boardId}/tags', 'verb' => 'PUT'],
```

- [ ] **Step 5: Run it and watch it pass**

```bash
docker exec -u www-data -w /var/www/html/custom_apps/deck deck-test-nc php vendor/bin/phpunit -c tests/phpunit.xml tests/unit/Controller/BoardTagControllerTest.php 2>&1 | tail -20
```

Expected: OK (3 tests).

- [ ] **Step 6: Commit**

```bash
cd ~/work/avuz/deck-fork && git add lib/Controller/BoardTagController.php appinfo/routes.php tests/unit/Controller/BoardTagControllerTest.php && git commit -m "feat(tags): expose board tag and summary endpoints"
```

---

### Task 9: The filter predicate

The only piece of frontend logic worth unit testing, extracted so it can be. This
will be the repo's **first** Jest test — `npm run test` currently finds none.

**Files:**
- Create: `src/helpers/boardFilters.js`
- Test: `src/helpers/boardFilters.spec.js`

**Interfaces:**
- Produces:
  - `export const DUE_FILTERS = { OVERDUE: 'overdue', TODAY: 'dueToday', WEEK: 'dueWeek', MONTH: 'dueMonth', NONE: 'noDue' }`
  - `export function boardMatchesFilters(summary, { tags, due })` → boolean
  - `export function tagOptions(summaries)` → `[{ title, count }]` sorted by count desc, then title

- [ ] **Step 1: Write the failing test**

Create `src/helpers/boardFilters.spec.js`:

```js
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { boardMatchesFilters, tagOptions, DUE_FILTERS } from './boardFilters.js'

const summary = (tags = [], due = {}) => ({
	boardId: 1,
	tags,
	due: { overdue: 0, dueToday: 0, dueWeek: 0, dueMonth: 0, noDue: 0, ...due },
})

describe('boardMatchesFilters', () => {
	it('matches everything when no filter is set', () => {
		expect(boardMatchesFilters(summary(), { tags: [], due: '' })).toBe(true)
	})

	it('matches a board carrying any of the selected tags', () => {
		const board = summary(['Cliente X'])
		expect(boardMatchesFilters(board, { tags: ['Cliente X', 'Urgente'], due: '' })).toBe(true)
	})

	it('rejects a board carrying none of the selected tags', () => {
		const board = summary(['Interno'])
		expect(boardMatchesFilters(board, { tags: ['Cliente X'], due: '' })).toBe(false)
	})

	it('ignores case and surrounding whitespace when matching tags', () => {
		const board = summary(['Cliente X'])
		expect(boardMatchesFilters(board, { tags: ['  cliente x '], due: '' })).toBe(true)
	})

	it('matches a due filter when that bucket has cards', () => {
		const board = summary([], { overdue: 3 })
		expect(boardMatchesFilters(board, { tags: [], due: DUE_FILTERS.OVERDUE })).toBe(true)
	})

	it('rejects a due filter when that bucket is empty', () => {
		const board = summary([], { overdue: 0 })
		expect(boardMatchesFilters(board, { tags: [], due: DUE_FILTERS.OVERDUE })).toBe(false)
	})

	it('requires both the tag set and the due filter to match', () => {
		const board = summary(['Cliente X'], { overdue: 0, dueWeek: 2 })
		expect(boardMatchesFilters(board, { tags: ['Cliente X'], due: DUE_FILTERS.OVERDUE })).toBe(false)
		expect(boardMatchesFilters(board, { tags: ['Cliente X'], due: DUE_FILTERS.WEEK })).toBe(true)
	})

	it('rejects a board with no summary loaded yet when a filter is active', () => {
		expect(boardMatchesFilters(undefined, { tags: ['Cliente X'], due: '' })).toBe(false)
		expect(boardMatchesFilters(undefined, { tags: [], due: '' })).toBe(true)
	})
})

describe('tagOptions', () => {
	it('counts each tag across boards and sorts by count then title', () => {
		const summaries = [
			summary(['Cliente X', 'Urgente']),
			summary(['Cliente X']),
			summary(['Adiada']),
		]

		expect(tagOptions(summaries)).toEqual([
			{ title: 'Cliente X', count: 2 },
			{ title: 'Adiada', count: 1 },
			{ title: 'Urgente', count: 1 },
		])
	})

	it('folds spellings that differ only by case into one option', () => {
		const summaries = [summary(['Cliente X']), summary(['cliente x'])]

		expect(tagOptions(summaries)).toEqual([{ title: 'Cliente X', count: 2 }])
	})
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/work/avuz/deck-fork && npx jest src/helpers/boardFilters.spec.js 2>&1 | tail -20
```

Expected: FAIL — cannot resolve `./boardFilters.js`.

- [ ] **Step 3: Write the helper**

Create `src/helpers/boardFilters.js`:

```js
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export const DUE_FILTERS = {
	OVERDUE: 'overdue',
	TODAY: 'dueToday',
	WEEK: 'dueWeek',
	MONTH: 'dueMonth',
	NONE: 'noDue',
}

const key = (title) => title.trim().toLowerCase()

export function boardMatchesFilters(summary, { tags, due }) {
	if (tags.length === 0 && due === '') {
		return true
	}

	if (!summary) {
		return false
	}

	if (tags.length > 0) {
		const wanted = tags.map(key)
		const carried = summary.tags.map(key)
		if (!carried.some((tag) => wanted.includes(tag))) {
			return false
		}
	}

	if (due !== '' && !(summary.due?.[due] > 0)) {
		return false
	}

	return true
}

export function tagOptions(summaries) {
	const counts = new Map()

	for (const summary of summaries) {
		for (const title of summary.tags) {
			const existing = counts.get(key(title))
			if (existing) {
				existing.count += 1
				continue
			}
			counts.set(key(title), { title, count: 1 })
		}
	}

	return [...counts.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd ~/work/avuz/deck-fork && npx jest src/helpers/boardFilters.spec.js 2>&1 | tail -20
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Lint**

```bash
cd ~/work/avuz/deck-fork && npm run lint 2>&1 | tail -20
```

Expected: no errors for the new files. Fix what it reports rather than adding
eslint-disable comments.

- [ ] **Step 6: Commit**

```bash
cd ~/work/avuz/deck-fork && git add src/helpers/boardFilters.js src/helpers/boardFilters.spec.js && git commit -m "feat(tags): add board filter predicate"
```

---

### Task 10: API client and store wiring

**Files:**
- Create: `src/services/BoardTagApi.js`
- Modify: `src/store/main.js` (state ~line 58, mutations ~line 234, getters ~line 110, actions ~line 428)

**Interfaces:**
- Consumes: routes from Task 8, helpers from Task 9.
- Produces:
  - store state `boardSummaries: {}` keyed by board id, `boardTagFilter: []`, `boardDueFilter: ''`
  - getter `boardsFilteredByTags` — `filteredBoards` narrowed by the predicate
  - getter `boardTagOptions`
  - actions `loadBoardSummaries`, `setBoardTagFilter`, `setBoardDueFilter`, `setBoardTags({ boardId, tags })`

- [ ] **Step 1: Write the API client**

Create `src/services/BoardTagApi.js`, mirroring `BoardApi.js`'s shape:

```js
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'

export class BoardTagApi {

	url(url) {
		return generateUrl(`/apps/deck${url}`)
	}

	async loadSummaries() {
		const response = await axios.get(this.url('/avuz/board-summary'))
		return response.data
	}

	async setBoardTags(boardId, tags) {
		const response = await axios.put(this.url(`/boards/${boardId}/tags`), { tags })
		return response.data
	}

}
```

- [ ] **Step 2: Add store state**

In `src/store/main.js`, the root `state` object (around line 58, next to
`boardFilter` and `searchQuery`) gains:

```js
			boardSummaries: {},
			boardTagFilter: [],
			boardDueFilter: '',
```

- [ ] **Step 3: Add mutations**

Next to `setBoards` (around line 234):

```js
			setBoardSummaries(state, summaries) {
				state.boardSummaries = summaries.reduce((byId, summary) => {
					byId[summary.boardId] = summary
					return byId
				}, {})
			},
			setBoardTagFilter(state, tags) {
				state.boardTagFilter = tags
			},
			setBoardDueFilter(state, due) {
				state.boardDueFilter = due
			},
```

- [ ] **Step 4: Add getters**

Next to `filteredBoards` (around line 110). `filteredBoards` itself is left
alone — the navigation counts and other views still use it.

```js
			boardsFilteredByTags: (state, getters) => {
				return getters.filteredBoards.filter((board) => boardMatchesFilters(
					state.boardSummaries[board.id],
					{ tags: state.boardTagFilter, due: state.boardDueFilter },
				))
			},
			boardTagOptions: (state, getters) => {
				const visible = getters.filteredBoards
					.map((board) => state.boardSummaries[board.id])
					.filter(Boolean)
				return tagOptions(visible)
			},
```

Add the import at the top of the file, beside the existing imports:

```js
import { boardMatchesFilters, tagOptions } from '../helpers/boardFilters.js'
```

- [ ] **Step 5: Add actions**

Next to `loadBoards` (around line 428):

```js
			async loadBoardSummaries({ commit }) {
				const summaries = await boardTagApi.loadSummaries()
				commit('setBoardSummaries', summaries)
			},
			async setBoardTags({ dispatch }, { boardId, tags }) {
				await boardTagApi.setBoardTags(boardId, tags)
				await dispatch('loadBoardSummaries')
			},
```

Instantiate the client beside the existing `apiClient` near the top of the file:

```js
const boardTagApi = new BoardTagApi()
```

with `import { BoardTagApi } from '../services/BoardTagApi.js'` alongside the
other service imports.

- [ ] **Step 6: Verify the bundle still builds**

```bash
cd ~/work/avuz/deck-fork && npm run build 2>&1 | tail -15
```

Expected: build completes with no errors. A missing import surfaces here.

- [ ] **Step 7: Run the full JS suite and lint**

```bash
cd ~/work/avuz/deck-fork && npx jest 2>&1 | tail -10 && npm run lint 2>&1 | tail -10
```

Expected: 10 tests pass, lint clean.

- [ ] **Step 8: Commit**

```bash
cd ~/work/avuz/deck-fork && git add src/services/BoardTagApi.js src/store/main.js && git commit -m "feat(tags): load board summaries into the store"
```

---

### Task 11: The filter bar

**Files:**
- Create: `src/components/boards/BoardFilterBar.vue`
- Modify: `src/components/boards/Boards.vue`

**Interfaces:**
- Consumes: store getters and actions from Task 10.
- Produces: a filter bar reading and writing `?tag=...&due=...` on the current route.

- [ ] **Step 1: Write the component**

Create `src/components/boards/BoardFilterBar.vue`:

```vue
<!--
  - SPDX-FileCopyrightText: 2026 Avuz
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<div class="board-filter-bar" role="group" :aria-label="t('deck', 'Filtrar quadros')">
		<NcSelect v-model="selectedTags"
			class="board-filter-bar__tags"
			:options="tagOptionTitles"
			:multiple="true"
			:close-on-select="false"
			:placeholder="t('deck', 'Filtrar por tag')"
			:aria-label="t('deck', 'Filtrar por tag')"
			@input="applyFilters" />

		<div class="board-filter-bar__due">
			<NcButton v-for="option in dueOptions"
				:key="option.value"
				:type="selectedDue === option.value ? 'primary' : 'tertiary'"
				:aria-pressed="selectedDue === option.value"
				@click="toggleDue(option.value)">
				{{ option.label }}
			</NcButton>
		</div>

		<NcButton v-if="hasActiveFilter"
			type="tertiary"
			@click="clearFilters">
			{{ t('deck', 'Limpar filtros') }}
		</NcButton>

		<p class="board-filter-bar__count" aria-live="polite">
			{{ n('deck', '%n quadro', '%n quadros', visibleCount) }}
		</p>
	</div>
</template>

<script>
import { NcButton, NcSelect } from '@nextcloud/vue'
import { DUE_FILTERS } from '../../helpers/boardFilters.js'

export default {
	name: 'BoardFilterBar',
	components: {
		NcButton,
		NcSelect,
	},
	data() {
		return {
			selectedTags: [],
			selectedDue: '',
		}
	},
	computed: {
		dueOptions() {
			// `t` and `n` are Vue prototype methods here (src/main.js:25-26), not
			// globals — inside <script> they must be called as this.t / this.n.
			return [
				{ value: DUE_FILTERS.OVERDUE, label: this.t('deck', 'Vencidas') },
				{ value: DUE_FILTERS.TODAY, label: this.t('deck', 'Próximas 24 horas') },
				{ value: DUE_FILTERS.WEEK, label: this.t('deck', 'Próximos 7 dias') },
				{ value: DUE_FILTERS.MONTH, label: this.t('deck', 'Próximos 30 dias') },
				{ value: DUE_FILTERS.NONE, label: this.t('deck', 'Sem prazo') },
			]
		},
		tagOptionTitles() {
			return this.$store.getters.boardTagOptions.map((option) => option.title)
		},
		visibleCount() {
			return this.$store.getters.boardsFilteredByTags.length
		},
		hasActiveFilter() {
			return this.selectedTags.length > 0 || this.selectedDue !== ''
		},
	},
	created() {
		this.readFiltersFromRoute()
	},
	methods: {
		readFiltersFromRoute() {
			const query = this.$route.query
			const tags = query.tag ?? []
			this.selectedTags = Array.isArray(tags) ? tags : [tags]
			this.selectedDue = query.due ?? ''
			this.commitFilters()
		},
		toggleDue(value) {
			this.selectedDue = this.selectedDue === value ? '' : value
			this.applyFilters()
		},
		clearFilters() {
			this.selectedTags = []
			this.selectedDue = ''
			this.applyFilters()
		},
		applyFilters() {
			this.commitFilters()
			this.writeFiltersToRoute()
		},
		commitFilters() {
			this.$store.commit('setBoardTagFilter', this.selectedTags)
			this.$store.commit('setBoardDueFilter', this.selectedDue)
		},
		writeFiltersToRoute() {
			const query = {}
			if (this.selectedTags.length > 0) {
				query.tag = this.selectedTags
			}
			if (this.selectedDue !== '') {
				query.due = this.selectedDue
			}
			this.$router.replace({ query }).catch(() => {})
		},
	},
}
</script>

<style lang="scss" scoped>
	.board-filter-bar {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 8px 15px;

		&__tags {
			min-width: 260px;
		}

		&__due {
			display: flex;
			flex-wrap: wrap;
			gap: 4px;
		}

		&__count {
			color: var(--color-text-maxcontrast);
			margin-inline-start: auto;
		}
	}
</style>
```

`vue-router` serialises a `tag` array as repeated `?tag=a&tag=b` params and
URL-encodes each value, which is exactly the format the spec calls for — a title
containing a comma survives intact.

The `.catch(() => {})` on `$router.replace` swallows vue-router's
`NavigationDuplicated` rejection, which fires when the query is already identical.

- [ ] **Step 2: Wire it into the boards list**

In `src/components/boards/Boards.vue`, add the bar above `.board-list` and switch
the loop to the filtered getter:

```vue
	<div>
		<Controls />
		<BoardFilterBar />
		<div class="board-list">
```

Change the `v-for` source from `boardsSorted` to the new getter by editing the
`boardsSorted` computed to read from it:

```js
		boardsSorted() {
			return [...this.$store.getters.boardsFilteredByTags]
				.filter((board) => board.deletedAt <= 0 && board.title.toLowerCase().includes(this.$store.getters.getSearchQuery.toLowerCase()))
				.sort((a, b) => (a.title < b.title) ? -1 : 1)
		},
```

and delete the now-unused `filteredBoards` computed from this component (the store
getter of the same name stays). Register the import and component:

```js
import BoardFilterBar from './BoardFilterBar.vue'
```

- [ ] **Step 3: Load summaries when the list mounts**

Add to `Boards.vue`:

```js
	async mounted() {
		await this.$store.dispatch('loadBoardSummaries')
	},
```

- [ ] **Step 4: Add the empty state**

Below the `BoardItem` loop in `Boards.vue`:

```vue
			<NcEmptyContent v-if="boardsSorted.length === 0"
				:name="t('deck', 'Nenhum quadro com esses filtros')">
				<template #action>
					<NcButton @click="$store.commit('setBoardTagFilter', []); $store.commit('setBoardDueFilter', '')">
						{{ t('deck', 'Limpar filtros') }}
					</NcButton>
				</template>
			</NcEmptyContent>
```

with `import { NcButton, NcEmptyContent } from '@nextcloud/vue'` added to the
component's imports.

- [ ] **Step 5: Build and lint**

```bash
cd ~/work/avuz/deck-fork && npm run build 2>&1 | tail -15 && npm run lint 2>&1 | tail -10 && npm run stylelint 2>&1 | tail -10
```

Expected: all three clean.

- [ ] **Step 6: Verify in a browser**

Open the Deck boards list on your dev instance. Confirm, by clicking:
the tag select lists tags with no duplicates; selecting two tags widens the list;
a due chip narrows it; the URL shows `?tag=...&due=...`; reloading the page keeps
the same boards visible; clearing filters restores the full list.

Record what you saw. If any of those six is not true, fix it before committing —
a passing build is not evidence the filter works.

- [ ] **Step 7: Commit**

```bash
cd ~/work/avuz/deck-fork && git add src/components/boards/ && git commit -m "feat(tags): filter the boards list by tag and due date"
```

---

### Task 12: Board tile chips and the tagging UI

**Files:**
- Modify: `src/components/boards/BoardItem.vue`
- Modify: `src/components/board/TagsTabSidebar.vue`

**Interfaces:**
- Consumes: `setBoardTags` action (Task 10), `boardSummaries` state.

- [ ] **Step 1: Show direct tags on the tile**

`BoardItem.vue` renders a row of cells. Add a cell after the title cell:

```vue
		<div class="board-list-tags-cell">
			<span v-for="tag in visibleTags" :key="tag" class="board-tag-chip">{{ tag }}</span>
			<span v-if="hiddenTagCount > 0"
				class="board-tag-chip board-tag-chip--overflow"
				tabindex="0"
				:title="hiddenTags.join(', ')"
				:aria-label="hiddenTags.join(', ')">
				+{{ hiddenTagCount }}
			</span>
		</div>
```

with these computed properties, reading the `directTags` field Task 7 already
returns:

```js
		directTags() {
			return this.$store.state.boardSummaries[this.board.id]?.directTags ?? []
		},
		visibleTags() {
			return this.directTags.slice(0, 3)
		},
		hiddenTags() {
			return this.directTags.slice(3)
		},
		hiddenTagCount() {
			return this.hiddenTags.length
		},
```

Derived tags are deliberately absent here: they drive filtering, but rendering them
would put Deck's four default labels on every row.

- [ ] **Step 2: Style the chips**

In `BoardItem.vue`'s style block:

```scss
	.board-list-tags-cell {
		display: flex;
		flex: 0 1 auto;
		gap: 4px;
		padding: 6px 15px;
	}

	.board-tag-chip {
		background-color: var(--color-background-dark);
		border-radius: var(--border-radius-pill);
		color: var(--color-main-text);
		font-size: 90%;
		padding: 2px 10px;
		white-space: nowrap;
	}
```

Chips carry no per-tag colour: the tile row is dense, and the tag name in text is
what identifies it. Colour would add a second encoding without adding meaning.

- [ ] **Step 3: Add the tagging section to the board sidebar**

`TagsTabSidebar.vue` already manages that board's labels. Add a section above the
existing label editor:

```vue
		<div v-if="canManage" class="board-tags">
			<h3>{{ t('deck', 'Tags do quadro') }}</h3>
			<p class="board-tags__hint">
				{{ t('deck', 'Tags marcam o quadro na visão geral e podem ser filtradas lá.') }}
			</p>
			<NcSelect v-model="boardTags"
				:options="allKnownTags"
				:multiple="true"
				:taggable="true"
				:close-on-select="false"
				:placeholder="t('deck', 'Adicionar tag ao quadro')"
				:aria-label="t('deck', 'Tags do quadro')"
				@input="saveBoardTags" />
		</div>
```

```js
		canManage() {
			return this.$store.getters.canManage
		},
		allKnownTags() {
			return this.$store.getters.boardTagOptions.map((option) => option.title)
		},
```

```js
	methods: {
		async saveBoardTags() {
			await this.$store.dispatch('setBoardTags', {
				boardId: this.board.id,
				tags: this.boardTags,
			})
		},
	},
```

Initialise `boardTags` in `created()` from
`this.$store.state.boardSummaries[this.board.id]?.directTags ?? []`, dispatching
`loadBoardSummaries` first if the map is empty — the sidebar can be opened without
ever visiting the boards list.

`canManage` is a real getter at `src/store/main.js:122`, reading
`state.currentBoard.permissions.PERMISSION_MANAGE` — the same permission
`BoardTagService::setTags()` enforces server-side, so the hidden UI and the
rejected request agree.

- [ ] **Step 4: Build, lint, verify by hand**

```bash
cd ~/work/avuz/deck-fork && npm run build 2>&1 | tail -10 && npm run lint 2>&1 | tail -10
```

Then in the browser: open a board's Tags sidebar, add a tag that exists on another
board, confirm it appears as a chip on the boards list, and confirm filtering by it
returns that board. Then open the sidebar as a user with read-only access and
confirm the section is not rendered.

- [ ] **Step 5: Commit**

```bash
cd ~/work/avuz/deck-fork && git add src/components/ && git commit -m "feat(tags): show and edit board tags"
```

---

### Task 13: Portuguese strings

**Files:**
- Modify: `l10n/pt_BR.js`, `l10n/pt_BR.json`

Deck's l10n files are generated from Transifex, but ours are additive: our strings
never exist upstream, so a rebase keeps them as long as we append rather than
reformat.

- [ ] **Step 1: Add the strings**

Every string introduced in Tasks 11 and 12 was already written in Portuguese, so
`pt_BR` needs entries only where the English source differs. Collect them:

```bash
cd ~/work/avuz/deck-fork && grep -rhoE "t\('deck', '[^']+'\)" src/components/boards/BoardFilterBar.vue src/components/boards/Boards.vue src/components/board/TagsTabSidebar.vue | sort -u
```

For each string that is still English (`Filter boards`, if any survived), add a
`pt_BR` entry to both files following their existing shape.

- [ ] **Step 2: Confirm nothing regressed**

```bash
cd ~/work/avuz/deck-fork && php -r 'json_decode(file_get_contents("l10n/pt_BR.json"), true); echo json_last_error_msg(), PHP_EOL;'
```

Expected: `No error`.

- [ ] **Step 3: Commit**

```bash
cd ~/work/avuz/deck-fork && git add l10n/ && git commit -m "i18n(tags): pt_BR strings for board tags"
```

---

### Task 14: Ship the fork — submodule, overlay removal, sentinel

Back in the server repo. This is the task that changes what the image contains.

**Files:**
- Modify: `.gitmodules`, `apps/deck`
- Modify: `Dockerfile:41`
- Delete: `docker/overlays/deck/`
- Modify: `docker/entrypoint.sh:121-137`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Build and commit the final bundle in the fork**

```bash
cd ~/work/avuz/deck-fork && npm run build && git add js/ && git commit -m "build: rebuild bundle with board tags" && git push avuz avuz
```

- [ ] **Step 2: Add the sentinel**

The entrypoint's check table (`docker/entrypoint.sh:132`) already resolves app
paths via `occ app:getpath`, so a shadowing copy in `custom_apps` is caught. Add a
second Deck entry for the new feature. In the fork, put the sentinel in a file the
feature cannot work without — `lib/Controller/BoardTagController.php`:

```php
// AVUZ-BOARD-TAGS-V1: board-level tags and boards-overview filters.
```

directly above the class declaration, then rebuild, commit, and push.

- [ ] **Step 3: Replace the overlay with the submodule**

```bash
cd /Users/patrickrezende/work/avuz/avuz-server/.claude/worktrees/deck-app-improvements-786dd1 && git rm -r --cached apps/deck && rm -rf apps/deck && git submodule add -f -b avuz https://github.com/avuz-conecta/deck.git apps/deck
```

`-f` is required, not optional: `.gitignore:22` (`/apps*/*`) ignores `apps/deck`,
and `git submodule add` refuses an ignored path without it. Confirm with
`git check-ignore -v apps/deck` if the command errors.

```bash
git rm -r docker/overlays/deck
```

In `Dockerfile`, delete line 41:

```dockerfile
RUN cp -R /var/www/html/docker/overlays/deck/. /var/www/html/apps/deck/
```

- [ ] **Step 4: Update the sentinel table**

In `docker/entrypoint.sh`, the `checks` array already carries the
`AVUZ-DECK-CLONE-ORDER-V1` entry — keep it (the fix moved into the fork, the
sentinel comment moved with it). Add below it:

```bash
        "AVUZ-BOARD-TAGS-V1|deck|lib/Controller/BoardTagController.php|deck fork missing — board tags and overview filters lost; check the apps/deck submodule shipped and no store copy in custom_apps outranks 1.17.1"
```

- [ ] **Step 5: Update CLAUDE.md**

In the "Fresh Checkout Setup" section, remove `deck` from the rsync `for app in`
list and add it to the submodule line, which becomes:

```bash
git submodule update --init --recursive 3rdparty apps/integration_openai apps/deck
```

Then extend the `integration_openai` paragraph with a sentence naming Deck as the
second version-pinned fork, with the same rule: not rsync'd, not App Store-installed.

- [ ] **Step 6: Verify the tree is consistent**

```bash
cd /Users/patrickrezende/work/avuz/avuz-server/.claude/worktrees/deck-app-improvements-786dd1 && git status --short && grep -n "overlays/deck" Dockerfile docker/*.sh || echo "no overlay references left"
```

Expected: no remaining `overlays/deck` references, `apps/deck` staged as a
submodule.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(deck): ship the avuz fork as a submodule"
```

---

### Task 15: Build, deploy to staging, verify

- [ ] **Step 1: Build the staging image**

```bash
./scripts/build-push.sh latest staging
```

Expected: build completes and pushes. A failure in the Deck submodule step means
the submodule was not initialised — run `git submodule update --init apps/deck`.

- [ ] **Step 2: Deploy and watch the migration run**

Redeploy the staging stack, then confirm the reconcile fired:

```bash
./scripts/portainer-exec.sh "grep -i 'Reconciling deck' /var/www/html/data/avuz-health.log | tail -5"
```

Expected: a line reporting Deck code `1.17.1` ahead of installed `1.17.0`.

```bash
./scripts/portainer-exec.sh -u www-data "php occ config:app:get deck installed_version"
```

Expected: `1.17.1`.

- [ ] **Step 3: Confirm the table exists**

```bash
./scripts/portainer-exec.sh -u www-data "php occ migrations:status deck | tail -10"
```

Expected: `Version11701Date20260727120000` listed among the executed migrations.

Then confirm the table itself, not just the migration record:

```bash
./scripts/portainer-exec.sh -u www-data "php occ db:show-tables 2>/dev/null | grep board_assigned || echo 'TABLE MISSING'"
```

If `db:show-tables` is unavailable on this NC build, query
`information_schema.tables` from the database container instead. Record the actual
output — a migration marked executed is not proof the table landed.

- [ ] **Step 4: Measure the summary endpoint**

With a user who has real boards, time the call:

```bash
./scripts/portainer-exec.sh "curl -s -o /dev/null -w '%{time_total}\n' -u USER:PASS 'http://localhost/index.php/apps/deck/avuz/board-summary'"
```

Run it three times and record the numbers in the deploy notes. This is the one
performance unknown in the design — a real number retires it. If it exceeds
roughly 500ms, add the per-board cache keyed on `last_modified` described in the
spec before prod.

- [ ] **Step 5: Verify the feature end to end in the browser**

On staging: tag two different boards with the same tag title, confirm both appear
when filtering by it; confirm a due chip narrows the list; confirm the URL is
shareable; confirm a read-only member sees no tagging UI.

- [ ] **Step 6: Write the deploy note**

Add the rollback procedure to the staging deploy notes: redeploying an older image
requires `occ config:app:set deck installed_version --value 1.17.0`, and the
`deck_board_assigned_labels` table is left in place deliberately.

- [ ] **Step 7: Stop before production**

Production build and deploy require the user's explicit approval, per action. Do
not run `build-push.sh latest prod`. Report the staging results and ask.

---

## Rebase Runbook

When upstream ships the next Deck release:

```bash
cd ~/work/avuz/deck-fork && git fetch origin --tags && git rebase v1.18.0 avuz
```

Conflicts can only land in the eight upstream files we touch — `appinfo/routes.php`,
`appinfo/info.xml`, `src/store/main.js`, `src/components/boards/Boards.vue`,
`src/components/boards/BoardItem.vue`, `src/components/board/TagsTabSidebar.vue`,
`lib/Service/BoardService.php`, `lib/Service/LabelService.php`. Everything else is
new files that rebase cleanly. Afterwards: bump the version to the new tag plus a
patch, rename the migration class only if its prefix now sorts wrong, `npm ci &&
npm run build`, run both suites, commit the bundle, and bump the submodule pointer
in the server repo.
