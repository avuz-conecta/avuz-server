# Deck Custom Fields Engine — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-board custom fields (7 types) with per-card values, managed in board settings and edited in the card sidebar, to the Avuz Deck fork.

**Architecture:** Mirror the existing **Labels** feature end to end — a board-scoped definition entity (`deck_custom_fields`) plus a per-card value join (`deck_card_custom_field_values`), no DB foreign keys (manual cascade in mappers), enrichment of definitions onto the board and values onto the single card, a Vuex store + axios service on the frontend, a board-settings management tab, and a card-sidebar section with a per-type widget map.

**Tech Stack:** PHP 8 (Nextcloud AppFramework, QBMapper, `OCP\DB\Types`), Vue 2 + Vuex, `@nextcloud/vue`, `@nextcloud/axios`, phpunit, jest.

**Spec:** `docs/superpowers/specs/2026-08-11-deck-custom-fields-design.md` (read it — the Non-goals and type table bind every task).

**Fork working copy:** `/Users/patrickrezende/work/avuz/deck-fork` (submodule `apps/deck`, branch `avuz`). All paths below are relative to that fork root unless noted.

## Global Constraints

- **Version bump:** `appinfo/info.xml` `<version>` `1.17.1` → **`1.17.2`** (Task 13 only).
- **Migration name:** `lib/Migration/Version11702Date20260811120000.php`, class `Version11702Date20260811120000`, extends `SimpleMigrationStep`, guard every `createTable` with `if (!$schema->hasTable(...))`, use `OCP\DB\Types`. Version integer must be **> 11701**.
- **No DB foreign keys** — cascade is manual in mappers (Deck convention).
- **No DB-native upsert** (`ON CONFLICT`/`ON DUPLICATE KEY`) — Deck runs MySQL, Postgres, SQLite. Do select→insert/update in app code.
- **The 7 field types** are exactly: `text`, `number`, `money`, `dropdown`, `multi`, `date`, `checkbox`. Enforce this set everywhere (validator, widget map).
- **`type` is immutable after create** — `updateField` never changes it.
- **`required` is soft** — visual badge only, never blocks. Ignored for `checkbox`.
- **`date` is date-only** — ISO `YYYY-MM-DD`, no time.
- **Option ids** for dropdown/multi are **server-generated, stable, never reused**. Removing an option keeps referencing card values (rendered `"(removida)"` in UI) — never silently drop a value.
- **Field title unique per board** (case-insensitive), like labels.
- **Permissions:** field definition CRUD/reorder = board `Acl::PERMISSION_MANAGE`; setting a card value = `Acl::PERMISSION_EDIT`; reads = `Acl::PERMISSION_READ`.
- **P1 does NOT** batch-enrich values on the board view, show values on tiles, hard-enforce required, filter by field, or export — those are later phases.
- **Commit rebuilt `js/`** in Task 13 (the Dockerfile can't rebuild it). Do not commit `node_modules`.
- **Commit style:** no "Claude Code" attribution in commit messages (repo rule).
- **Copyright header** on every new PHP file:
  ```php
  /**
   * SPDX-FileCopyrightText: 2026 Avuz
   * SPDX-License-Identifier: AGPL-3.0-or-later
   */
  ```
- **Test commands:** PHP `composer run test:unit` (from fork root); JS `npm run test`.

---

### Task 1: Migration + entities

**Files:**
- Create: `lib/Migration/Version11702Date20260811120000.php`
- Create: `lib/Db/CustomField.php`
- Create: `lib/Db/CustomFieldValue.php`
- Test: `tests/unit/Db/CustomFieldTest.php`

**Interfaces:**
- Produces: `OCA\Deck\Db\CustomField` (props `boardId:int, title:string, type:string, options:?string, required:bool, order:int, lastModified:int`; `options` stored as JSON text, exposed as array via `getOptionsArray()/setOptionsArray()`), `OCA\Deck\Db\CustomFieldValue` (props `cardId:int, fieldId:int, value:?string`). Tables `deck_custom_fields`, `deck_card_custom_field_values`.

- [ ] **Step 1: Write the failing test** — `tests/unit/Db/CustomFieldTest.php`

```php
<?php
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\Deck\Db;

use Test\TestCase;

class CustomFieldTest extends TestCase {
	public function testTypeCasting(): void {
		$field = new CustomField();
		$field->setBoardId('5');
		$field->setRequired(1);
		$field->setOrder('2');
		self::assertSame(5, $field->getBoardId());
		self::assertSame(true, $field->getRequired());
		self::assertSame(2, $field->getOrder());
	}

	public function testOptionsRoundTrip(): void {
		$field = new CustomField();
		$options = [['id' => 'a1', 'label' => 'Hospitalar', 'color' => '2bb5e3']];
		$field->setOptionsArray($options);
		self::assertSame($options, $field->getOptionsArray());
		self::assertJson($field->getOptions());
	}

	public function testEmptyOptionsArrayIsNull(): void {
		$field = new CustomField();
		self::assertSame([], $field->getOptionsArray());
	}
}
```

- [ ] **Step 2: Run it, verify it fails**
Run: `composer run test:unit -- --filter CustomFieldTest`
Expected: FAIL — `CustomField` class not found.

- [ ] **Step 3: Create the entities**

`lib/Db/CustomField.php`:
```php
<?php
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\Deck\Db;

/**
 * @method int getBoardId()
 * @method void setBoardId(int $boardId)
 * @method string getTitle()
 * @method void setTitle(string $title)
 * @method string getType()
 * @method void setType(string $type)
 * @method string|null getOptions()
 * @method void setOptions(?string $options)
 * @method bool getRequired()
 * @method void setRequired(bool $required)
 * @method int getOrder()
 * @method void setOrder(int $order)
 * @method int getLastModified()
 * @method void setLastModified(int $lastModified)
 */
class CustomField extends RelationalEntity {
	protected $boardId;
	protected $title;
	protected $type;
	protected $options;
	protected $required = false;
	protected $order = 0;
	protected $lastModified;

	public function __construct() {
		$this->addType('id', 'integer');
		$this->addType('boardId', 'integer');
		$this->addType('required', 'boolean');
		$this->addType('order', 'integer');
		$this->addType('lastModified', 'integer');
	}

	/** @return list<array{id:string,label:string,color?:string}> */
	public function getOptionsArray(): array {
		if ($this->options === null || $this->options === '') {
			return [];
		}
		$decoded = json_decode($this->options, true);
		return is_array($decoded) ? $decoded : [];
	}

	/** @param list<array{id:string,label:string,color?:string}> $options */
	public function setOptionsArray(array $options): void {
		$this->setOptions($options === [] ? null : json_encode($options));
	}

	public function getETag(): string {
		return md5((string)$this->getLastModified());
	}
}
```

`lib/Db/CustomFieldValue.php`:
```php
<?php
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\Deck\Db;

/**
 * @method int getCardId()
 * @method void setCardId(int $cardId)
 * @method int getFieldId()
 * @method void setFieldId(int $fieldId)
 * @method string|null getValue()
 * @method void setValue(?string $value)
 */
class CustomFieldValue extends RelationalEntity {
	protected $cardId;
	protected $fieldId;
	protected $value;

	public function __construct() {
		$this->addType('id', 'integer');
		$this->addType('cardId', 'integer');
		$this->addType('fieldId', 'integer');
	}
}
```

- [ ] **Step 4: Create the migration** — `lib/Migration/Version11702Date20260811120000.php`

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

class Version11702Date20260811120000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('deck_custom_fields')) {
			$table = $schema->createTable('deck_custom_fields');
			$table->addColumn('id', Types::INTEGER, ['autoincrement' => true, 'notnull' => true]);
			$table->addColumn('board_id', Types::BIGINT, ['notnull' => true, 'length' => 20]);
			$table->addColumn('title', Types::STRING, ['notnull' => true, 'length' => 255]);
			$table->addColumn('type', Types::STRING, ['notnull' => true, 'length' => 20]);
			$table->addColumn('options', Types::TEXT, ['notnull' => false]);
			$table->addColumn('required', Types::BOOLEAN, ['notnull' => true, 'default' => false]);
			$table->addColumn('order', Types::INTEGER, ['notnull' => true, 'default' => 0]);
			$table->addColumn('last_modified', Types::INTEGER, ['notnull' => false]);
			$table->setPrimaryKey(['id']);
			$table->addIndex(['board_id'], 'deck_cf_board_idx');
		}

		if (!$schema->hasTable('deck_card_custom_field_values')) {
			$table = $schema->createTable('deck_card_custom_field_values');
			$table->addColumn('id', Types::INTEGER, ['autoincrement' => true, 'notnull' => true]);
			$table->addColumn('card_id', Types::INTEGER, ['notnull' => true]);
			$table->addColumn('field_id', Types::INTEGER, ['notnull' => true]);
			$table->addColumn('value', Types::TEXT, ['notnull' => false]);
			$table->setPrimaryKey(['id']);
			$table->addUniqueIndex(['card_id', 'field_id'], 'deck_cfv_card_field_uidx');
			$table->addIndex(['field_id'], 'deck_cfv_field_idx');
		}

		return $schema;
	}
}
```

- [ ] **Step 5: Run the test, verify it passes**
Run: `composer run test:unit -- --filter CustomFieldTest`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**
```bash
git add lib/Db/CustomField.php lib/Db/CustomFieldValue.php lib/Migration/Version11702Date20260811120000.php tests/unit/Db/CustomFieldTest.php
git commit -m "feat(deck): custom-field entities + migration"
```

---

### Task 2: CustomFieldMapper

**Files:**
- Create: `lib/Db/CustomFieldMapper.php`
- Test: `tests/unit/Db/CustomFieldMapperTest.php`

**Interfaces:**
- Consumes: `CustomField` (Task 1), `DeckMapper<CustomField>`, `IPermissionMapper`.
- Produces: `CustomFieldMapper` with `findAll(int $boardId): CustomField[]` (ordered by `order`,`id`), `find(int $id): CustomField` (from `DeckMapper`), `insert`/`update` (stamp `lastModified`), `delete(Entity)`, `isOwner(string,int):bool`, `findBoardId(int):?int`.

- [ ] **Step 1: Write the failing test** — `tests/unit/Db/CustomFieldMapperTest.php`

Model it on `tests/unit/Db/LabelMapperTest.php` (a DB-backed mapper test). Assert:
- `findAll($boardId)` returns only that board's fields, ordered by `order`.
- `insert` stamps `lastModified`.
- `delete` removes the row.
- `findBoardId($id)` returns the board id; returns `null` for a missing id.

```php
<?php
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\Deck\Db;

use OCP\IDBConnection;
use Test\TestCase;

/** @group DB */
class CustomFieldMapperTest extends TestCase {
	private IDBConnection $db;
	private CustomFieldMapper $mapper;

	public function setUp(): void {
		parent::setUp();
		$this->db = \OC::$server->get(IDBConnection::class);
		$this->mapper = new CustomFieldMapper($this->db);
	}

	private function makeField(int $boardId, string $title, int $order): CustomField {
		$f = new CustomField();
		$f->setBoardId($boardId);
		$f->setTitle($title);
		$f->setType('text');
		$f->setOrder($order);
		return $this->mapper->insert($f);
	}

	public function testFindAllOrderedByOrder(): void {
		$boardId = 900001;
		$b = $this->makeField($boardId, 'B', 2);
		$a = $this->makeField($boardId, 'A', 1);
		$other = $this->makeField(900002, 'X', 1);

		$all = $this->mapper->findAll($boardId);
		self::assertSame(['A', 'B'], array_map(fn ($f) => $f->getTitle(), $all));

		$this->mapper->delete($a);
		$this->mapper->delete($b);
		$this->mapper->delete($other);
	}

	public function testInsertStampsLastModified(): void {
		$f = $this->makeField(900003, 'T', 0);
		self::assertGreaterThan(0, $f->getLastModified());
		$this->mapper->delete($f);
	}

	public function testFindBoardId(): void {
		$f = $this->makeField(900004, 'T', 0);
		self::assertSame(900004, $this->mapper->findBoardId($f->getId()));
		self::assertNull($this->mapper->findBoardId(99999999));
		$this->mapper->delete($f);
	}
}
```

- [ ] **Step 2: Run it, verify it fails**
Run: `composer run test:unit -- --filter CustomFieldMapperTest`
Expected: FAIL — `CustomFieldMapper` not found.

- [ ] **Step 3: Create the mapper** — `lib/Db/CustomFieldMapper.php`

```php
<?php
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\Deck\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\Entity;
use OCP\AppFramework\Db\MultipleObjectsReturnedException;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends DeckMapper<CustomField> */
class CustomFieldMapper extends DeckMapper implements IPermissionMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deck_custom_fields', CustomField::class);
	}

	/** @return CustomField[] */
	public function findAll(int $boardId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('board_id', $qb->createNamedParameter($boardId, IQueryBuilder::PARAM_INT)))
			->orderBy('order', 'ASC')
			->addOrderBy('id', 'ASC');
		return $this->findEntities($qb);
	}

	public function insert(Entity $entity): Entity {
		if (!in_array('lastModified', $entity->getUpdatedFields())) {
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

	public function isOwner(string $userId, int $id): bool {
		$qb = $this->db->getQueryBuilder();
		$qb->select('f.id')
			->from($this->getTableName(), 'f')
			->innerJoin('f', 'deck_boards', 'b', 'f.board_id = b.id')
			->where($qb->expr()->eq('f.id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('b.owner', $qb->createNamedParameter($userId, IQueryBuilder::PARAM_STR)));
		return count($qb->executeQuery()->fetchAll()) > 0;
	}

	public function findBoardId(int $id): ?int {
		try {
			return $this->find($id)->getBoardId();
		} catch (DoesNotExistException|MultipleObjectsReturnedException) {
			return null;
		}
	}
}
```

> Note: `order` is a SQL reserved word — the QueryBuilder quotes identifiers, so `orderBy('order', ...)` is safe. Keep the column name `order` (matches the spec); do not rename.

- [ ] **Step 4: Run the test, verify it passes**
Run: `composer run test:unit -- --filter CustomFieldMapperTest`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add lib/Db/CustomFieldMapper.php tests/unit/Db/CustomFieldMapperTest.php
git commit -m "feat(deck): CustomFieldMapper (board-scoped defs)"
```

---

### Task 3: CustomFieldValueMapper (portable insert/update)

**Files:**
- Create: `lib/Db/CustomFieldValueMapper.php`
- Test: `tests/unit/Db/CustomFieldValueMapperTest.php`

**Interfaces:**
- Consumes: `CustomFieldValue` (Task 1).
- Produces: `CustomFieldValueMapper` with `findForCard(int $cardId): CustomFieldValue[]`, `findForCards(int[] $cardIds): CustomFieldValue[]` (batch, **P5-only, not wired in P1**), `setValue(int $cardId, int $fieldId, ?string $value): void` (app-level insert/update; null/empty deletes), `deleteForField(int $fieldId): void`, `deleteForCard(int $cardId): void`, `deleteForFieldValueOption` not needed.

- [ ] **Step 1: Write the failing test** — assert the round-trip and that `setValue` on the same `(card,field)` twice **updates** (one row, second value wins), and that a null value deletes the row.

```php
<?php
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\Deck\Db;

use OCP\IDBConnection;
use Test\TestCase;

/** @group DB */
class CustomFieldValueMapperTest extends TestCase {
	private CustomFieldValueMapper $mapper;

	public function setUp(): void {
		parent::setUp();
		$this->mapper = new CustomFieldValueMapper(\OC::$server->get(IDBConnection::class));
	}

	public function testSetValueInsertsThenUpdatesSameRow(): void {
		$this->mapper->setValue(910001, 920001, 'first');
		$this->mapper->setValue(910001, 920001, 'second');
		$rows = $this->mapper->findForCard(910001);
		self::assertCount(1, $rows);
		self::assertSame('second', $rows[0]->getValue());
		$this->mapper->deleteForCard(910001);
	}

	public function testNullValueDeletesRow(): void {
		$this->mapper->setValue(910002, 920002, 'x');
		$this->mapper->setValue(910002, 920002, null);
		self::assertCount(0, $this->mapper->findForCard(910002));
	}

	public function testDeleteForField(): void {
		$this->mapper->setValue(910003, 920003, 'a');
		$this->mapper->setValue(910004, 920003, 'b');
		$this->mapper->deleteForField(920003);
		self::assertCount(0, $this->mapper->findForCard(910003));
		self::assertCount(0, $this->mapper->findForCard(910004));
	}
}
```

- [ ] **Step 2: Run it, verify it fails**
Run: `composer run test:unit -- --filter CustomFieldValueMapperTest`
Expected: FAIL — class not found.

- [ ] **Step 3: Create the mapper** — `lib/Db/CustomFieldValueMapper.php`

```php
<?php
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\Deck\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends DeckMapper<CustomFieldValue> */
class CustomFieldValueMapper extends DeckMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deck_card_custom_field_values', CustomFieldValue::class);
	}

	/** @return CustomFieldValue[] */
	public function findForCard(int $cardId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('card_id', $qb->createNamedParameter($cardId, IQueryBuilder::PARAM_INT)));
		return $this->findEntities($qb);
	}

	/**
	 * Batch fetch for many cards. NOT used in P1 (values are not shown on the
	 * board view yet) — added for P5 tile display.
	 * @param int[] $cardIds
	 * @return CustomFieldValue[]
	 */
	public function findForCards(array $cardIds): array {
		if ($cardIds === []) {
			return [];
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->in('card_id', $qb->createNamedParameter($cardIds, IQueryBuilder::PARAM_INT_ARRAY)));
		return $this->findEntities($qb);
	}

	/**
	 * Portable insert-or-update on the unique (card_id, field_id) pair.
	 * No DB-native upsert — Deck runs MySQL, Postgres and SQLite.
	 * A null/empty value deletes the row.
	 */
	public function setValue(int $cardId, int $fieldId, ?string $value): void {
		$existing = $this->findRow($cardId, $fieldId);
		if ($value === null || $value === '') {
			if ($existing !== null) {
				$this->delete($existing);
			}
			return;
		}
		if ($existing === null) {
			$row = new CustomFieldValue();
			$row->setCardId($cardId);
			$row->setFieldId($fieldId);
			$row->setValue($value);
			$this->insert($row);
			return;
		}
		$existing->setValue($value);
		$this->update($existing);
	}

	private function findRow(int $cardId, int $fieldId): ?CustomFieldValue {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from($this->getTableName())
			->where($qb->expr()->eq('card_id', $qb->createNamedParameter($cardId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('field_id', $qb->createNamedParameter($fieldId, IQueryBuilder::PARAM_INT)));
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	public function deleteForField(int $fieldId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('field_id', $qb->createNamedParameter($fieldId, IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
	}

	public function deleteForCard(int $cardId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('card_id', $qb->createNamedParameter($cardId, IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
	}
}
```

- [ ] **Step 4: Run the test, verify it passes**
Run: `composer run test:unit -- --filter CustomFieldValueMapperTest`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add lib/Db/CustomFieldValueMapper.php tests/unit/Db/CustomFieldValueMapperTest.php
git commit -m "feat(deck): CustomFieldValueMapper (portable insert/update)"
```

---

### Task 4: FieldType helper + validator

**Files:**
- Create: `lib/Service/CustomFieldType.php`
- Create: `lib/Validators/CustomFieldServiceValidator.php`
- Test: `tests/unit/Service/CustomFieldTypeTest.php`
- Test: `tests/unit/Validators/CustomFieldServiceValidatorTest.php`

**Interfaces:**
- Produces:
  - `CustomFieldType::TYPES` = `['text','number','money','dropdown','multi','date','checkbox']`.
  - `CustomFieldType::isValid(string $type): bool`.
  - `CustomFieldType::validateValue(string $type, ?string $value, array $options): bool` — null always valid; `number`/`money` numeric; `date` matches `YYYY-MM-DD`; `checkbox` in `['0','1']`; `dropdown` value ∈ option ids; `multi` JSON array ⊆ option ids.
  - `CustomFieldServiceValidator` with `rules()` for `title`/`type`/`boardId`/`id`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/Service/CustomFieldTypeTest.php`:
```php
<?php
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\Deck\Service;

use Test\TestCase;

class CustomFieldTypeTest extends TestCase {
	public function testIsValid(): void {
		self::assertTrue(CustomFieldType::isValid('money'));
		self::assertFalse(CustomFieldType::isValid('rating'));
	}

	public function testNumber(): void {
		self::assertTrue(CustomFieldType::validateValue('number', '12.5', []));
		self::assertFalse(CustomFieldType::validateValue('number', 'abc', []));
	}

	public function testDate(): void {
		self::assertTrue(CustomFieldType::validateValue('date', '2027-05-03', []));
		self::assertFalse(CustomFieldType::validateValue('date', '2027-05-03 02:00', []));
	}

	public function testCheckbox(): void {
		self::assertTrue(CustomFieldType::validateValue('checkbox', '1', []));
		self::assertFalse(CustomFieldType::validateValue('checkbox', '2', []));
	}

	public function testDropdownMustBeKnownOption(): void {
		$options = [['id' => 'o1', 'label' => 'A']];
		self::assertTrue(CustomFieldType::validateValue('dropdown', 'o1', $options));
		self::assertFalse(CustomFieldType::validateValue('dropdown', 'o2', $options));
	}

	public function testMultiSubsetOfOptions(): void {
		$options = [['id' => 'o1', 'label' => 'A'], ['id' => 'o2', 'label' => 'B']];
		self::assertTrue(CustomFieldType::validateValue('multi', json_encode(['o1', 'o2']), $options));
		self::assertFalse(CustomFieldType::validateValue('multi', json_encode(['o3']), $options));
	}

	public function testNullAlwaysValid(): void {
		self::assertTrue(CustomFieldType::validateValue('number', null, []));
	}
}
```

`tests/unit/Validators/CustomFieldServiceValidatorTest.php`:
```php
<?php
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\Deck\Validators;

use OCA\Deck\BadRequestException;
use Test\TestCase;

class CustomFieldServiceValidatorTest extends TestCase {
	private CustomFieldServiceValidator $validator;

	public function setUp(): void {
		parent::setUp();
		$this->validator = new CustomFieldServiceValidator();
	}

	public function testAcceptsValid(): void {
		$this->validator->check(['title' => 'Cidade', 'type' => 'text', 'boardId' => 1]);
		self::assertTrue(true);
	}

	public function testRejectsEmptyTitle(): void {
		$this->expectException(BadRequestException::class);
		$this->validator->check(['title' => '', 'type' => 'text', 'boardId' => 1]);
	}

	public function testRejectsBadType(): void {
		$this->expectException(BadRequestException::class);
		$this->validator->check(['title' => 'X', 'type' => 'rating', 'boardId' => 1]);
	}
}
```

- [ ] **Step 2: Run them, verify they fail**
Run: `composer run test:unit -- --filter "CustomFieldTypeTest|CustomFieldServiceValidatorTest"`
Expected: FAIL — classes not found.

- [ ] **Step 3: Create the type helper** — `lib/Service/CustomFieldType.php`

```php
<?php
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\Deck\Service;

class CustomFieldType {
	public const TYPES = ['text', 'number', 'money', 'dropdown', 'multi', 'date', 'checkbox'];

	public static function isValid(string $type): bool {
		return in_array($type, self::TYPES, true);
	}

	public static function optionIds(array $options): array {
		return array_map(static fn ($o) => (string)($o['id'] ?? ''), $options);
	}

	/** @param list<array{id:string,label:string,color?:string}> $options */
	public static function validateValue(string $type, ?string $value, array $options): bool {
		if ($value === null || $value === '') {
			return true;
		}
		$validators = [
			'text' => static fn () => true,
			'number' => static fn () => is_numeric($value),
			'money' => static fn () => is_numeric($value),
			'date' => static fn () => preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1,
			'checkbox' => static fn () => in_array($value, ['0', '1'], true),
			'dropdown' => static fn () => in_array($value, self::optionIds($options), true),
			'multi' => static function () use ($value, $options): bool {
				$decoded = json_decode($value, true);
				if (!is_array($decoded)) {
					return false;
				}
				return array_diff($decoded, self::optionIds($options)) === [];
			},
		];
		return isset($validators[$type]) ? $validators[$type]() : false;
	}
}
```

- [ ] **Step 4: Create the validator** — `lib/Validators/CustomFieldServiceValidator.php`

```php
<?php
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
declare(strict_types=1);

namespace OCA\Deck\Validators;

use OCA\Deck\Service\CustomFieldType;

class CustomFieldServiceValidator extends BaseValidator {
	protected function field_type(string $value): bool {
		return CustomFieldType::isValid($value);
	}

	public function rules() {
		return [
			'id' => ['numeric'],
			'title' => ['not_empty', 'not_null', 'not_false', 'max:255'],
			'type' => ['not_empty', 'not_null', 'field_type'],
			'boardId' => ['numeric', 'not_null'],
		];
	}
}
```

> Check `lib/Validators/BaseValidator.php` for how custom rule methods are dispatched (the `hex_color` method in `LabelServiceValidator` is the pattern — a `protected function <rule_name>($value): bool`). Name the method to match the rule string `field_type`.

- [ ] **Step 5: Run the tests, verify they pass**
Run: `composer run test:unit -- --filter "CustomFieldTypeTest|CustomFieldServiceValidatorTest"`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add lib/Service/CustomFieldType.php lib/Validators/CustomFieldServiceValidator.php tests/unit/Service/CustomFieldTypeTest.php tests/unit/Validators/CustomFieldServiceValidatorTest.php
git commit -m "feat(deck): custom-field type helper + validator"
```

---

### Task 5: CustomFieldService

**Files:**
- Create: `lib/Service/CustomFieldService.php`
- Test: `tests/unit/Service/CustomFieldServiceTest.php`

**Interfaces:**
- Consumes: `CustomFieldMapper`, `CustomFieldValueMapper`, `CardMapper`, `PermissionService`, `BoardService`, `ChangeHelper`, `CustomFieldServiceValidator`, `CustomFieldType`.
- Produces:
  - `create(int $boardId, string $title, string $type, ?array $options, bool $required): CustomField` — MANAGE; validate; unique title; archived guard; mints stable option ids; insert.
  - `update(int $id, string $title, ?array $options, bool $required): CustomField` — MANAGE; unique title (excluding self); **type unchanged**; preserves existing option ids, mints ids for new options; **removed options are NOT purged from values**.
  - `delete(int $id): CustomField` — MANAGE; cascade `valueMapper->deleteForField`.
  - `reorder(int $boardId, int[] $orderedIds): CustomField[]` — MANAGE; sets `order` to array index for ids that belong to the board.
  - `setValue(int $cardId, int $fieldId, ?string $value): void` — resolve board via card, EDIT; validate value against field type/options; `valueMapper->setValue`.
  - `getValues(int $cardId): CustomFieldValue[]` — READ (via card's board); `valueMapper->findForCard`.
  - `findAll(int $boardId): CustomField[]` — READ; passthrough (used by enrichment in Task 7).

- [ ] **Step 1: Write the failing test** — assert the permission gate and option-id behavior. Mock `PermissionService::checkPermission` to throw `NoPermissionException` and assert it propagates; mock mappers for the option-id logic. Follow `tests/unit/Service/LabelServiceTest.php` for the mocking style (all collaborators mocked).

```php
<?php
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\Deck\Service;

use OCA\Deck\Db\CardMapper;
use OCA\Deck\Db\ChangeHelper;
use OCA\Deck\Db\CustomField;
use OCA\Deck\Db\CustomFieldMapper;
use OCA\Deck\Db\CustomFieldValueMapper;
use OCA\Deck\NoPermissionException;
use OCA\Deck\Validators\CustomFieldServiceValidator;
use PHPUnit\Framework\MockObject\MockObject;
use Test\TestCase;

class CustomFieldServiceTest extends TestCase {
	private CustomFieldMapper&MockObject $fieldMapper;
	private CustomFieldValueMapper&MockObject $valueMapper;
	private CardMapper&MockObject $cardMapper;
	private PermissionService&MockObject $permissionService;
	private BoardService&MockObject $boardService;
	private ChangeHelper&MockObject $changeHelper;
	private CustomFieldService $service;

	public function setUp(): void {
		parent::setUp();
		$this->fieldMapper = $this->createMock(CustomFieldMapper::class);
		$this->valueMapper = $this->createMock(CustomFieldValueMapper::class);
		$this->cardMapper = $this->createMock(CardMapper::class);
		$this->permissionService = $this->createMock(PermissionService::class);
		$this->boardService = $this->createMock(BoardService::class);
		$this->changeHelper = $this->createMock(ChangeHelper::class);
		$this->service = new CustomFieldService(
			$this->fieldMapper, $this->valueMapper, $this->cardMapper,
			$this->permissionService, $this->boardService, $this->changeHelper,
			new CustomFieldServiceValidator(),
		);
	}

	public function testCreateRequiresManage(): void {
		$this->permissionService->method('checkPermission')
			->willThrowException(new NoPermissionException('no'));
		$this->expectException(NoPermissionException::class);
		$this->service->create(1, 'Cidade', 'text', null, false);
	}

	public function testCreateMintsOptionIds(): void {
		$this->fieldMapper->method('findAll')->willReturn([]);
		$this->boardService->method('isArchived')->willReturn(false);
		$this->fieldMapper->method('insert')->willReturnArgument(0);
		$field = $this->service->create(1, 'Tipo', 'dropdown', [['label' => 'Hospitalar']], false);
		$options = $field->getOptionsArray();
		self::assertNotEmpty($options[0]['id']);
		self::assertSame('Hospitalar', $options[0]['label']);
	}

	public function testUpdateKeepsRemovedOptionValues(): void {
		// Removing an option from the definition must NOT purge card values.
		$existing = new CustomField();
		$existing->setBoardId(1);
		$existing->setType('dropdown');
		$existing->setOptionsArray([['id' => 'o1', 'label' => 'A'], ['id' => 'o2', 'label' => 'B']]);
		$this->fieldMapper->method('find')->willReturn($existing);
		$this->fieldMapper->method('findAll')->willReturn([]);
		$this->boardService->method('isArchived')->willReturn(false);
		$this->fieldMapper->method('update')->willReturnArgument(0);
		$this->valueMapper->expects(self::never())->method('deleteForField');
		$this->service->update(10, 'Tipo', [['id' => 'o1', 'label' => 'A']], false);
	}
}
```

- [ ] **Step 2: Run it, verify it fails**
Run: `composer run test:unit -- --filter CustomFieldServiceTest`
Expected: FAIL — `CustomFieldService` not found.

- [ ] **Step 3: Create the service** — `lib/Service/CustomFieldService.php`

```php
<?php
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\Deck\Service;

use OCA\Deck\BadRequestException;
use OCA\Deck\Db\Acl;
use OCA\Deck\Db\CardMapper;
use OCA\Deck\Db\ChangeHelper;
use OCA\Deck\Db\CustomField;
use OCA\Deck\Db\CustomFieldMapper;
use OCA\Deck\Db\CustomFieldValue;
use OCA\Deck\Db\CustomFieldValueMapper;
use OCA\Deck\StatusException;
use OCA\Deck\Validators\CustomFieldServiceValidator;

class CustomFieldService {
	public function __construct(
		private CustomFieldMapper $fieldMapper,
		private CustomFieldValueMapper $valueMapper,
		private CardMapper $cardMapper,
		private PermissionService $permissionService,
		private BoardService $boardService,
		private ChangeHelper $changeHelper,
		private CustomFieldServiceValidator $validator,
	) {
	}

	/** @return CustomField[] */
	public function findAll(int $boardId): array {
		$this->permissionService->checkPermission(null, $boardId, Acl::PERMISSION_READ);
		return $this->fieldMapper->findAll($boardId);
	}

	public function create(int $boardId, string $title, string $type, ?array $options, bool $required): CustomField {
		$this->validator->check(compact('title', 'type', 'boardId'));
		$this->permissionService->checkPermission(null, $boardId, Acl::PERMISSION_MANAGE);
		$this->assertTitleUnique($boardId, $title, null);
		if ($this->boardService->isArchived(null, $boardId)) {
			throw new StatusException('Operation not allowed. This board is archived.');
		}
		$field = new CustomField();
		$field->setBoardId($boardId);
		$field->setTitle($title);
		$field->setType($type);
		$field->setRequired($required);
		$field->setOptionsArray($this->mintOptionIds($options ?? [], []));
		$this->changeHelper->boardChanged($boardId);
		return $this->fieldMapper->insert($field);
	}

	public function update(int $id, string $title, ?array $options, bool $required): CustomField {
		$this->validator->check(compact('title', 'id'));
		$this->permissionService->checkPermission($this->fieldMapper, $id, Acl::PERMISSION_MANAGE);
		$field = $this->fieldMapper->find($id);
		$this->assertTitleUnique($field->getBoardId(), $title, $id);
		if ($this->boardService->isArchived($this->fieldMapper, $id)) {
			throw new StatusException('Operation not allowed. This board is archived.');
		}
		$field->setTitle($title);
		$field->setRequired($required);
		// type is immutable; keep existing option ids, mint ids only for new options.
		$field->setOptionsArray($this->mintOptionIds($options ?? [], $field->getOptionsArray()));
		$this->changeHelper->boardChanged($field->getBoardId());
		return $this->fieldMapper->update($field);
	}

	public function delete(int $id): CustomField {
		$this->permissionService->checkPermission($this->fieldMapper, $id, Acl::PERMISSION_MANAGE);
		$field = $this->fieldMapper->find($id);
		$this->valueMapper->deleteForField($id);
		$this->changeHelper->boardChanged($field->getBoardId());
		return $this->fieldMapper->delete($field);
	}

	/**
	 * @param int[] $orderedIds
	 * @return CustomField[]
	 */
	public function reorder(int $boardId, array $orderedIds): array {
		$this->permissionService->checkPermission(null, $boardId, Acl::PERMISSION_MANAGE);
		$fields = $this->fieldMapper->findAll($boardId);
		$byId = [];
		foreach ($fields as $field) {
			$byId[$field->getId()] = $field;
		}
		$position = 0;
		foreach ($orderedIds as $fieldId) {
			if (!isset($byId[$fieldId])) {
				continue;
			}
			$byId[$fieldId]->setOrder($position++);
			$this->fieldMapper->update($byId[$fieldId]);
		}
		$this->changeHelper->boardChanged($boardId);
		return $this->fieldMapper->findAll($boardId);
	}

	public function setValue(int $cardId, int $fieldId, ?string $value): void {
		$boardId = $this->cardMapper->findBoardId($cardId);
		$this->permissionService->checkPermission($this->cardMapper, $cardId, Acl::PERMISSION_EDIT);
		$field = $this->fieldMapper->find($fieldId);
		if ($field->getBoardId() !== $boardId) {
			throw new BadRequestException('field does not belong to this card');
		}
		if (!CustomFieldType::validateValue($field->getType(), $value, $field->getOptionsArray())) {
			throw new BadRequestException('invalid value for field type');
		}
		$this->valueMapper->setValue($cardId, $fieldId, $value);
		$this->changeHelper->cardChanged($cardId);
	}

	/** @return CustomFieldValue[] */
	public function getValues(int $cardId): array {
		$this->permissionService->checkPermission($this->cardMapper, $cardId, Acl::PERMISSION_READ);
		return $this->valueMapper->findForCard($cardId);
	}

	private function assertTitleUnique(int $boardId, string $title, ?int $exceptId): void {
		foreach ($this->fieldMapper->findAll($boardId) as $field) {
			if ($exceptId !== null && $field->getId() === $exceptId) {
				continue;
			}
			if (mb_strtolower($field->getTitle()) === mb_strtolower($title)) {
				throw new BadRequestException('title must be unique');
			}
		}
	}

	/**
	 * Give every option a stable id: reuse the id when present, otherwise mint a
	 * fresh unique one. Never reuse an id that already existed on the field.
	 * @param list<array{id?:string,label:string,color?:string}> $options
	 * @param list<array{id:string,label:string,color?:string}> $existing
	 * @return list<array{id:string,label:string,color?:string}>
	 */
	private function mintOptionIds(array $options, array $existing): array {
		$used = array_map(static fn ($o) => (string)($o['id'] ?? ''), $existing);
		$result = [];
		foreach ($options as $option) {
			$id = (string)($option['id'] ?? '');
			if ($id === '') {
				do {
					$id = 'opt-' . bin2hex(random_bytes(4));
				} while (in_array($id, $used, true));
			}
			$used[] = $id;
			$entry = ['id' => $id, 'label' => (string)($option['label'] ?? '')];
			if (isset($option['color'])) {
				$entry['color'] = (string)$option['color'];
			}
			$result[] = $entry;
		}
		return $result;
	}
}
```

> Confirm `ChangeHelper` exposes `cardChanged(int)` (it is used across CardService) and `CardMapper::findBoardId(int)` exists — both are used elsewhere in the fork. If `cardChanged` differs, use whatever `CardService` calls after a card mutation.

- [ ] **Step 4: Run the test, verify it passes**
Run: `composer run test:unit -- --filter CustomFieldServiceTest`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/Service/CustomFieldService.php tests/unit/Service/CustomFieldServiceTest.php
git commit -m "feat(deck): CustomFieldService (CRUD, reorder, values, option-id safety)"
```

---

### Task 6: Controller + routes

**Files:**
- Create: `lib/Controller/CustomFieldController.php`
- Modify: `appinfo/routes.php` (add to the `'routes'` array, after the `// labels` block)
- Test: `tests/unit/controller/CustomFieldControllerTest.php`

**Interfaces:**
- Consumes: `CustomFieldService`.
- Produces: web routes named `custom_field#createField|updateField|deleteField|reorderFields|getCardValues|setCardValue`.

- [ ] **Step 1: Write the failing test** — controller methods pass through to the service. Follow `tests/unit/controller/LabelControllerTest.php`.

```php
<?php
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\Deck\Controller;

use OCA\Deck\Db\CustomField;
use OCA\Deck\Service\CustomFieldService;
use OCP\IRequest;
use Test\TestCase;

class CustomFieldControllerTest extends TestCase {
	public function testCreateFieldDelegates(): void {
		$service = $this->createMock(CustomFieldService::class);
		$request = $this->createMock(IRequest::class);
		$controller = new CustomFieldController('deck', $request, $service);
		$field = new CustomField();
		$service->expects(self::once())->method('create')
			->with(7, 'Cidade', 'text', null, false)->willReturn($field);
		self::assertSame($field, $controller->createField(7, 'Cidade', 'text', null, false));
	}
}
```

- [ ] **Step 2: Run it, verify it fails**
Run: `composer run test:unit -- --filter CustomFieldControllerTest`
Expected: FAIL — controller not found.

- [ ] **Step 3: Create the controller** — `lib/Controller/CustomFieldController.php`

```php
<?php
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * AVUZ-CUSTOM-FIELDS-V1 — per-board custom fields (Phase 1). Sentinel for
 * verify_avuz_patches; do not remove.
 */
namespace OCA\Deck\Controller;

use OCA\Deck\Db\CustomField;
use OCA\Deck\Service\CustomFieldService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\IRequest;

class CustomFieldController extends Controller {
	public function __construct(
		$appName,
		IRequest $request,
		private CustomFieldService $service,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	public function createField(int $boardId, string $title, string $type, ?array $options, bool $required): CustomField {
		return $this->service->create($boardId, $title, $type, $options, $required);
	}

	#[NoAdminRequired]
	public function updateField(int $fieldId, string $title, ?array $options, bool $required): CustomField {
		return $this->service->update($fieldId, $title, $options, $required);
	}

	#[NoAdminRequired]
	public function deleteField(int $fieldId): CustomField {
		return $this->service->delete($fieldId);
	}

	#[NoAdminRequired]
	public function reorderFields(int $boardId, array $fieldIds): array {
		return $this->service->reorder($boardId, $fieldIds);
	}

	#[NoAdminRequired]
	public function getCardValues(int $cardId): array {
		return $this->service->getValues($cardId);
	}

	#[NoAdminRequired]
	public function setCardValue(int $cardId, int $fieldId, ?string $value): array {
		$this->service->setValue($cardId, $fieldId, $value);
		return $this->service->getValues($cardId);
	}
}
```

- [ ] **Step 4: Add the routes** — in `appinfo/routes.php`, inside the `'routes' => [ ... ]` array, right after the `// labels` entries (around line 75):

```php
		// custom fields (AVUZ-CUSTOM-FIELDS-V1)
		['name' => 'custom_field#createField', 'url' => '/boards/{boardId}/custom-fields', 'verb' => 'POST'],
		['name' => 'custom_field#reorderFields', 'url' => '/boards/{boardId}/custom-fields/reorder', 'verb' => 'PUT'],
		['name' => 'custom_field#updateField', 'url' => '/custom-fields/{fieldId}', 'verb' => 'PUT'],
		['name' => 'custom_field#deleteField', 'url' => '/custom-fields/{fieldId}', 'verb' => 'DELETE'],
		['name' => 'custom_field#getCardValues', 'url' => '/cards/{cardId}/custom-fields', 'verb' => 'GET'],
		['name' => 'custom_field#setCardValue', 'url' => '/cards/{cardId}/custom-fields/{fieldId}', 'verb' => 'PUT'],
```

> Order matters: the literal `/custom-fields/reorder` under `/boards/{boardId}/...` is distinct from `/custom-fields/{fieldId}`, so there is no collision. Keep `reorder` before the `{fieldId}` routes anyway.

- [ ] **Step 5: Run the test, verify it passes**
Run: `composer run test:unit -- --filter CustomFieldControllerTest`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add lib/Controller/CustomFieldController.php appinfo/routes.php tests/unit/controller/CustomFieldControllerTest.php
git commit -m "feat(deck): custom-field controller + routes (AVUZ-CUSTOM-FIELDS-V1)"
```

---

### Task 7: Board + card enrichment

**Files:**
- Modify: `lib/Db/Board.php` (add `addRelation('customFields')` + `@method` docblock)
- Modify: `lib/Db/Card.php` (add `addRelation('customFieldValues')` at ~line 116 + `@method` docblock)
- Modify: `lib/Service/BoardService.php` (constructor DI `CustomFieldMapper`; in the board-`find` enrichment near line 748, `$board->setCustomFields($this->customFieldMapper->findAll($board->getId()))`)
- Test: `tests/unit/Service/BoardServiceTest.php` (extend existing) — a board returned by `find()` carries `customFields`.

**Interfaces:**
- Consumes: `CustomFieldMapper::findAll` (Task 2).
- Produces: `board.customFields` reaches the SPA; card carries `customFieldValues` for the round-trip in Task 12. **No batch value enrichment** — values load via the Task 6 `getCardValues` endpoint only.

- [ ] **Step 1: Write/extend the failing test** — in the existing `BoardServiceTest`, add a case asserting that `find()` calls `customFieldMapper->findAll` and sets `customFields` on the returned board. Match the mocking already used for `labelMapper` in that test file.

```php
	public function testFindEnrichesCustomFields(): void {
		// Arrange the existing find() mock chain (copy the labels arrangement in
		// this file), then add:
		$field = new \OCA\Deck\Db\CustomField();
		$this->customFieldMapper->method('findAll')->willReturn([$field]);
		$board = $this->service->find($this->boardId);
		self::assertSame([$field], $board->getCustomFields());
	}
```

- [ ] **Step 2: Run it, verify it fails**
Run: `composer run test:unit -- --filter "BoardServiceTest::testFindEnrichesCustomFields"`
Expected: FAIL — `customFieldMapper` property / `getCustomFields` missing.

- [ ] **Step 3: Wire the entities**

`lib/Db/Board.php` — in the constructor where other relations are registered, add:
```php
		$this->addRelation('customFields');
```
and add the docblock `@method` pair:
```php
 * @method CustomField[] getCustomFields()
 * @method void setCustomFields(array $customFields)
```

`lib/Db/Card.php` — after line 116 (with the other `addRelation` calls), add:
```php
		$this->addRelation('customFieldValues');
```
and the docblock:
```php
 * @method CustomFieldValue[] getCustomFieldValues()
 * @method void setCustomFieldValues(array $customFieldValues)
```

- [ ] **Step 4: Wire BoardService**
- Add `CustomFieldMapper $customFieldMapper` to the constructor (store as `private`), mirroring how `LabelMapper` is injected (line ~62).
- In the `find()` enrichment block near line 748 (where it does `$labels = $this->labelMapper->findAll($board->getId()); ...; $board->setLabels($labels);`), add:
```php
		$board->setCustomFields($this->customFieldMapper->findAll($board->getId()));
```

- [ ] **Step 5: Run the test, verify it passes**
Run: `composer run test:unit -- --filter "BoardServiceTest::testFindEnrichesCustomFields"`
Expected: PASS. Then run the whole `BoardServiceTest` to confirm no regression:
Run: `composer run test:unit -- --filter BoardServiceTest`

- [ ] **Step 6: Commit**
```bash
git add lib/Db/Board.php lib/Db/Card.php lib/Service/BoardService.php tests/unit/Service/BoardServiceTest.php
git commit -m "feat(deck): enrich board with customFields; card carries customFieldValues"
```

---

### Task 8: Clone carries fields + values

**Files:**
- Modify: `lib/Service/BoardService.php` (board clone path, ~line 531 — where labels are copied to the new board)
- Modify: `lib/Service/CardService.php` (card clone path — where a card's labels/assignments are copied)
- Test: `tests/unit/Service/BoardServiceTest.php` (clone reproduces field defs), `tests/unit/Service/CardServiceTest.php` (card clone remaps value field ids)

**Interfaces:**
- Consumes: `CustomFieldMapper`, `CustomFieldValueMapper`.
- Produces: cloning a board reproduces its field definitions with **new ids** and builds an `oldFieldId → newFieldId` map; cloning a card copies each value row through that map (same-board clone keeps field ids unchanged).

- [ ] **Step 1: Write the failing tests**
- `BoardServiceTest::testCloneCopiesCustomFields` — the clone inserts a new `CustomField` per source field on the target board.
- `CardServiceTest::testCloneCopiesCustomFieldValues` — cloning a card copies its value rows (remapping `field_id` when a map is provided).

Use the mock arrangements already present in those clone tests for labels as the template.

- [ ] **Step 2: Run them, verify they fail**
Run: `composer run test:unit -- --filter "testCloneCopiesCustomFields|testCloneCopiesCustomFieldValues"`
Expected: FAIL.

- [ ] **Step 3: Implement board-clone field copy**
In `BoardService`'s clone method (the `deepClone`/`clone` path around line 531 that does `$labels = $this->labelMapper->findAll($id); foreach (...) { ...; $this->labelMapper->insert($newLabel); }`), add after the label copy:
```php
		// AVUZ-CUSTOM-FIELDS-V1: carry custom-field definitions to the clone.
		$fieldIdMap = [];
		foreach ($this->customFieldMapper->findAll($id) as $sourceField) {
			$newField = new CustomField();
			$newField->setBoardId($newBoard->getId());
			$newField->setTitle($sourceField->getTitle());
			$newField->setType($sourceField->getType());
			$newField->setOptions($sourceField->getOptions());
			$newField->setRequired($sourceField->getRequired());
			$newField->setOrder($sourceField->getOrder());
			$inserted = $this->customFieldMapper->insert($newField);
			$fieldIdMap[$sourceField->getId()] = $inserted->getId();
		}
```
Make `$fieldIdMap` available to the per-card clone calls in that same method (the loop that clones cards — pass it into `cardService->cloneCard(...)` or store on a property the card-clone reads). Follow how the label remap at line ~700 threads board context.

- [ ] **Step 4: Implement card-clone value copy**
In `CardService`'s clone path (where it copies labels/assignments to `$newCard`), add:
```php
		// AVUZ-CUSTOM-FIELDS-V1: copy custom-field values, remapping field ids.
		foreach ($this->customFieldValueMapper->findForCard($card->getId()) as $value) {
			$targetFieldId = $fieldIdMap[$value->getFieldId()] ?? $value->getFieldId();
			$this->customFieldValueMapper->setValue($newCard->getId(), $targetFieldId, $value->getValue());
		}
```
Inject `CustomFieldValueMapper` into `CardService` and accept the `$fieldIdMap` (default `[]` for same-board clones where ids are unchanged).

- [ ] **Step 5: Run the tests, verify they pass**
Run: `composer run test:unit -- --filter "testCloneCopiesCustomFields|testCloneCopiesCustomFieldValues"`
Expected: PASS. Then run `BoardServiceTest` + `CardServiceTest` fully to check no clone regression (this is the `AVUZ-DECK-CLONE-ORDER-V1` area — keep it green).

- [ ] **Step 6: Commit**
```bash
git add lib/Service/BoardService.php lib/Service/CardService.php tests/unit/Service/BoardServiceTest.php tests/unit/Service/CardServiceTest.php
git commit -m "feat(deck): clone carries custom-field defs + values"
```

---

### Task 9: Frontend API service

**Files:**
- Create: `src/services/CustomFieldApi.js`
- Test: `src/services/CustomFieldApi.spec.js`

**Interfaces:**
- Produces: `CustomFieldApi` with `createCustomField(boardId, data)`, `updateCustomField(field)`, `deleteCustomField(id)`, `reorderCustomFields(boardId, fieldIds)`, `getCardValues(cardId)`, `setCardCustomFieldValue(cardId, fieldId, value)` — all returning `axios` promises resolving to `response.data`.

- [ ] **Step 1: Write the failing test** — `src/services/CustomFieldApi.spec.js` (model on `src/services/BoardTagApi.spec.js`).

```js
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import axios from '@nextcloud/axios'
import { CustomFieldApi } from './CustomFieldApi.js'

jest.mock('@nextcloud/axios', () => ({
	post: jest.fn(() => Promise.resolve({ data: {} })),
	put: jest.fn(() => Promise.resolve({ data: {} })),
	get: jest.fn(() => Promise.resolve({ data: [] })),
	delete: jest.fn(() => Promise.resolve({ data: {} })),
}))
jest.mock('@nextcloud/router', () => ({ generateUrl: (u) => u }))

describe('CustomFieldApi', () => {
	beforeEach(() => jest.clearAllMocks())

	it('creates a field under the board', async () => {
		await new CustomFieldApi().createCustomField(7, { title: 'Cidade', type: 'text' })
		expect(axios.post).toHaveBeenCalledWith('/apps/deck/boards/7/custom-fields', { title: 'Cidade', type: 'text' })
	})

	it('sets a card value via PUT', async () => {
		await new CustomFieldApi().setCardCustomFieldValue(3, 9, 'x')
		expect(axios.put).toHaveBeenCalledWith('/apps/deck/cards/3/custom-fields/9', { value: 'x' })
	})

	it('reads card values via GET', async () => {
		await new CustomFieldApi().getCardValues(3)
		expect(axios.get).toHaveBeenCalledWith('/apps/deck/cards/3/custom-fields')
	})
})
```

- [ ] **Step 2: Run it, verify it fails**
Run: `npm run test -- CustomFieldApi`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the service** — `src/services/CustomFieldApi.js`

```js
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'

export class CustomFieldApi {

	url(url) {
		return generateUrl(`/apps/deck${url}`)
	}

	async createCustomField(boardId, data) {
		const response = await axios.post(this.url(`/boards/${boardId}/custom-fields`), data)
		return response.data
	}

	async updateCustomField(field) {
		const response = await axios.put(this.url(`/custom-fields/${field.id}`), field)
		return response.data
	}

	async deleteCustomField(id) {
		const response = await axios.delete(this.url(`/custom-fields/${id}`))
		return response.data
	}

	async reorderCustomFields(boardId, fieldIds) {
		const response = await axios.put(this.url(`/boards/${boardId}/custom-fields/reorder`), { fieldIds })
		return response.data
	}

	async getCardValues(cardId) {
		const response = await axios.get(this.url(`/cards/${cardId}/custom-fields`))
		return response.data
	}

	async setCardCustomFieldValue(cardId, fieldId, value) {
		const response = await axios.put(this.url(`/cards/${cardId}/custom-fields/${fieldId}`), { value })
		return response.data
	}

}
```

- [ ] **Step 4: Run the test, verify it passes**
Run: `npm run test -- CustomFieldApi`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/services/CustomFieldApi.js src/services/CustomFieldApi.spec.js
git commit -m "feat(deck): CustomFieldApi frontend service"
```

---

### Task 10: Vuex store wiring

**Files:**
- Modify: `src/store/main.js` (board `customFields` state + mutations + actions, near the label mutations ~line 295 and actions ~line 520)
- Modify: `src/store/card.js` (`loadCustomFieldValues` + `setCustomFieldValue` actions, near the label actions ~line 351)
- Test: `src/store/customFields.store.spec.js`

**Interfaces:**
- Consumes: `CustomFieldApi` (Task 9), the `updateCardProperty` mutation (existing in `card.js`).
- Produces: getter `currentBoardCustomFields`; actions `createCustomField`, `updateCustomField`, `removeCustomField`, `reorderCustomFields` (board), `loadCustomFieldValues`, `setCustomFieldValue` (card).

- [ ] **Step 1: Write the failing test** — a store test that dispatches `setCustomFieldValue` and asserts it calls the api then commits `updateCardProperty` with `property: 'customFieldValues'`. Follow how existing store specs mock `apiClient`.

- [ ] **Step 2: Run it, verify it fails**
Run: `npm run test -- customFields.store`
Expected: FAIL.

- [ ] **Step 3: Wire `main.js`**
- Import and instantiate: `import { CustomFieldApi } from '../services/CustomFieldApi.js'` and `const customFieldApi = new CustomFieldApi()` (mirror the `apiClient` instantiation).
- State: `currentBoard.customFields` is populated from the board payload (Task 7 sets it server-side); add a getter:
```js
	currentBoardCustomFields: state => state.currentBoard ? (state.currentBoard.customFields || []) : [],
```
- Mutations (near the label mutations):
```js
	addCustomFieldToCurrentBoard(state, field) {
		state.currentBoard.customFields = [...(state.currentBoard.customFields || []), field]
	},
	updateCustomFieldInCurrentBoard(state, field) {
		state.currentBoard.customFields = (state.currentBoard.customFields || [])
			.map(f => f.id === field.id ? field : f)
	},
	removeCustomFieldFromCurrentBoard(state, id) {
		state.currentBoard.customFields = (state.currentBoard.customFields || []).filter(f => f.id !== id)
	},
	setCurrentBoardCustomFields(state, fields) {
		state.currentBoard.customFields = fields
	},
```
- Actions (near the label actions):
```js
	async createCustomField({ commit, state }, data) {
		const field = await customFieldApi.createCustomField(state.currentBoard.id, data)
		commit('addCustomFieldToCurrentBoard', field)
		return field
	},
	async updateCustomField({ commit }, field) {
		const updated = await customFieldApi.updateCustomField(field)
		commit('updateCustomFieldInCurrentBoard', updated)
	},
	async removeCustomField({ commit }, id) {
		await customFieldApi.deleteCustomField(id)
		commit('removeCustomFieldFromCurrentBoard', id)
	},
	async reorderCustomFields({ commit, state }, fieldIds) {
		const fields = await customFieldApi.reorderCustomFields(state.currentBoard.id, fieldIds)
		commit('setCurrentBoardCustomFields', fields)
	},
```

- [ ] **Step 4: Wire `card.js`**
```js
	async loadCustomFieldValues({ commit }, card) {
		const customFieldValues = await customFieldApi.getCardValues(card.id)
		commit('updateCardProperty', { property: 'customFieldValues', card: { ...card, customFieldValues } })
	},
	async setCustomFieldValue({ commit }, { card, fieldId, value }) {
		const customFieldValues = await customFieldApi.setCardCustomFieldValue(card.id, fieldId, value)
		commit('updateCardProperty', { property: 'customFieldValues', card: { ...card, customFieldValues } })
	},
```
(Import/instantiate `CustomFieldApi` in `card.js` the same way, or reuse the shared `apiClient` if the store centralizes it — match the file's existing pattern.)

- [ ] **Step 5: Run the test, verify it passes**
Run: `npm run test -- customFields.store`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add src/store/main.js src/store/card.js src/store/customFields.store.spec.js
git commit -m "feat(deck): store wiring for custom fields + values"
```

---

### Task 11: Board-settings management UI

**Files:**
- Create: `src/components/board/CustomFieldsTabSidebar.vue`
- Modify: `src/components/board/BoardSidebar.vue` (add a new `NcAppSidebarTab` for "Campos", rendering `CustomFieldsTabSidebar`, beside the Tags tab)
- Test: `src/components/board/CustomFieldsTabSidebar.spec.js`

**Interfaces:**
- Consumes: store getter `currentBoardCustomFields`, actions `createCustomField`/`updateCustomField`/`removeCustomField`/`reorderCustomFields`; the 7 types from a local `FIELD_TYPES` constant.
- Produces: a board-settings pane to add/edit/delete/reorder fields, with an option editor shown only for `dropdown`/`multi` and a `required` toggle.

- [ ] **Step 1: Write the failing test** — mount the component with a mocked store; assert the type `<select>`/`NcSelect` offers all 7 types, and that submitting the add-form dispatches `createCustomField` with `{title, type, options, required}`. Follow the jest+`@vue/test-utils` setup used by other component specs in the fork.

- [ ] **Step 2: Run it, verify it fails**
Run: `npm run test -- CustomFieldsTabSidebar`
Expected: FAIL — component not found.

- [ ] **Step 3: Build the component** — `src/components/board/CustomFieldsTabSidebar.vue`

Structure (real code for the non-obvious parts; keep styling minimal and consistent with `TagsTabSidebar.vue`):
```vue
<template>
	<div class="custom-fields">
		<h3>{{ t('deck', 'Campos') }}</h3>
		<ul class="custom-fields__list">
			<li v-for="field in fields" :key="field.id" class="custom-fields__item">
				<span class="custom-fields__title">{{ field.title }}</span>
				<span class="custom-fields__type">{{ typeLabel(field.type) }}</span>
				<span v-if="field.required" class="custom-fields__required">{{ t('deck', 'obrigatório') }}</span>
				<NcActions>
					<NcActionButton icon="icon-rename" @click="startEdit(field)">{{ t('deck', 'Edit') }}</NcActionButton>
					<NcActionButton icon="icon-delete" @click="remove(field.id)">{{ t('deck', 'Delete') }}</NcActionButton>
				</NcActions>
			</li>
		</ul>

		<form class="custom-fields__form" @submit.prevent="submit">
			<input v-model="draft.title" type="text" :placeholder="t('deck', 'Nome do campo')">
			<NcSelect v-model="draft.type"
				:options="typeOptions"
				:reduce="option => option.id"
				label="label"
				:disabled="isEditing"
				:placeholder="t('deck', 'Tipo')" />
			<div v-if="hasOptions" class="custom-fields__options">
				<div v-for="(option, index) in draft.options" :key="index" class="custom-fields__option">
					<input v-model="option.label" type="text" :placeholder="t('deck', 'Opção')">
					<NcButton type="tertiary" @click="removeOption(index)">
						<template #icon><CloseIcon :size="16" /></template>
					</NcButton>
				</div>
				<NcButton type="tertiary" @click="addOption">{{ t('deck', 'Adicionar opção') }}</NcButton>
			</div>
			<NcCheckboxRadioSwitch :checked.sync="draft.required">{{ t('deck', 'Obrigatório') }}</NcCheckboxRadioSwitch>
			<NcButton type="primary" native-type="submit" :disabled="!canSubmit">
				{{ isEditing ? t('deck', 'Salvar') : t('deck', 'Adicionar campo') }}
			</NcButton>
		</form>
	</div>
</template>

<script>
import { mapGetters } from 'vuex'
import { NcSelect, NcButton, NcActions, NcActionButton, NcCheckboxRadioSwitch } from '@nextcloud/vue'
import CloseIcon from 'vue-material-design-icons/Close.vue'
import { FIELD_TYPES } from './fieldTypes.js'

export default {
	name: 'CustomFieldsTabSidebar',
	components: { NcSelect, NcButton, NcActions, NcActionButton, NcCheckboxRadioSwitch, CloseIcon },
	props: {
		board: { type: Object, default: () => ({}) },
	},
	data() {
		return {
			editingId: null,
			draft: { title: '', type: 'text', options: [], required: false },
		}
	},
	computed: {
		...mapGetters({ fields: 'currentBoardCustomFields' }),
		typeOptions() { return FIELD_TYPES },
		isEditing() { return this.editingId !== null },
		hasOptions() { return this.draft.type === 'dropdown' || this.draft.type === 'multi' },
		canSubmit() {
			if (this.draft.title.trim() === '') return false
			if (this.hasOptions && this.draft.options.filter(o => o.label.trim() !== '').length === 0) return false
			return true
		},
	},
	methods: {
		typeLabel(type) { return (FIELD_TYPES.find(t => t.id === type) || {}).label || type },
		addOption() { this.draft.options.push({ label: '' }) },
		removeOption(index) { this.draft.options.splice(index, 1) },
		startEdit(field) {
			this.editingId = field.id
			this.draft = {
				title: field.title,
				type: field.type,
				options: (field.options || []).map(o => ({ ...o })),
				required: !!field.required,
			}
		},
		reset() {
			this.editingId = null
			this.draft = { title: '', type: 'text', options: [], required: false }
		},
		async submit() {
			const payload = {
				title: this.draft.title.trim(),
				type: this.draft.type,
				options: this.hasOptions ? this.draft.options.filter(o => o.label.trim() !== '') : null,
				required: this.draft.required,
			}
			if (this.isEditing) {
				await this.$store.dispatch('updateCustomField', { id: this.editingId, ...payload })
			} else {
				await this.$store.dispatch('createCustomField', payload)
			}
			this.reset()
		},
		async remove(id) {
			await this.$store.dispatch('removeCustomField', id)
		},
	},
}
</script>
```

Also create `src/components/board/fieldTypes.js`:
```js
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
export const FIELD_TYPES = [
	{ id: 'text', label: t('deck', 'Texto') },
	{ id: 'number', label: t('deck', 'Número') },
	{ id: 'money', label: t('deck', 'Moeda (R$)') },
	{ id: 'dropdown', label: t('deck', 'Lista suspensa') },
	{ id: 'multi', label: t('deck', 'Múltipla escolha') },
	{ id: 'date', label: t('deck', 'Data') },
	{ id: 'checkbox', label: t('deck', 'Caixa de seleção') },
]
```

- [ ] **Step 4: Register the tab** in `src/components/board/BoardSidebar.vue` — add an `NcAppSidebarTab` (id `custom-fields`, name "Campos", an icon such as `FormatListBulletedIcon`) rendering `<CustomFieldsTabSidebar :board="board" />`, beside the Tags/labels tab. Import and register the component.

- [ ] **Step 5: Run the test, verify it passes**
Run: `npm run test -- CustomFieldsTabSidebar`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add src/components/board/CustomFieldsTabSidebar.vue src/components/board/fieldTypes.js src/components/board/BoardSidebar.vue src/components/board/CustomFieldsTabSidebar.spec.js
git commit -m "feat(deck): board-settings custom-fields management tab"
```

---

### Task 12: Card-sidebar section + per-type widgets

**Files:**
- Create: `src/components/card/CustomFieldsSection.vue`
- Create: `src/components/card/CustomFieldInput.vue` (the per-type widget map)
- Modify: `src/components/card/CardSidebarTabDetails.vue` (render `<CustomFieldsSection :card="card" />` after `DueDateSelector`, before `NcCollectionList`/`Description`)
- Test: `src/components/card/CustomFieldInput.spec.js`

**Interfaces:**
- Consumes: store getter `currentBoardCustomFields`, actions `loadCustomFieldValues` + `setCustomFieldValue`; the card's `customFieldValues`.
- Produces: the "Campos" section in the card details, one widget per field keyed by `field.type`, soft-required badge when `required && empty` (except checkbox).

- [ ] **Step 1: Write the failing test** — `src/components/card/CustomFieldInput.spec.js`: for each type, mounting `CustomFieldInput` renders the right control (text→`input`, checkbox→`NcCheckboxRadioSwitch`, dropdown→`NcSelect`, etc.), and changing it emits `input` with the correctly-encoded value (e.g. `multi` emits a JSON array string; `checkbox` emits `'0'`/`'1'`).

- [ ] **Step 2: Run it, verify it fails**
Run: `npm run test -- CustomFieldInput`
Expected: FAIL — component not found.

- [ ] **Step 3: Build `CustomFieldInput.vue`** — one component, `field.type` selects the control. Encapsulate encode/decode so the value crossing `v-model` is always the stored-string form.

```vue
<template>
	<div class="custom-field-input">
		<input v-if="field.type === 'text'" :value="value" type="text" @change="emit($event.target.value)">
		<input v-else-if="field.type === 'number'" :value="value" type="number" step="any" @change="emit($event.target.value)">
		<div v-else-if="field.type === 'money'" class="custom-field-input__money">
			<span>R$</span>
			<input :value="value" type="number" step="0.01" @change="emit($event.target.value)">
		</div>
		<input v-else-if="field.type === 'date'" :value="value" type="date" @change="emit($event.target.value)">
		<NcCheckboxRadioSwitch v-else-if="field.type === 'checkbox'"
			:checked="value === '1'"
			@update:checked="emit($event ? '1' : '0')" />
		<NcSelect v-else-if="field.type === 'dropdown'"
			:value="selectedOption"
			:options="field.options || []"
			label="label"
			@input="emit($event ? $event.id : null)" />
		<NcSelect v-else-if="field.type === 'multi'"
			:value="selectedOptions"
			:options="field.options || []"
			:multiple="true"
			label="label"
			@input="emitMulti" />
	</div>
</template>

<script>
import { NcSelect, NcCheckboxRadioSwitch } from '@nextcloud/vue'

export default {
	name: 'CustomFieldInput',
	components: { NcSelect, NcCheckboxRadioSwitch },
	props: {
		field: { type: Object, required: true },
		value: { type: String, default: null },
	},
	computed: {
		selectedOption() {
			return (this.field.options || []).find(o => o.id === this.value) || null
		},
		selectedOptions() {
			const ids = this.decodeMulti(this.value)
			return (this.field.options || []).filter(o => ids.includes(o.id))
		},
	},
	methods: {
		emit(value) { this.$emit('input', value === '' ? null : value) },
		emitMulti(options) {
			this.$emit('input', options.length ? JSON.stringify(options.map(o => o.id)) : null)
		},
		decodeMulti(raw) {
			if (!raw) return []
			try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : [] } catch (e) { return [] }
		},
	},
}
</script>
```

- [ ] **Step 4: Build `CustomFieldsSection.vue`** — lists the board's fields, binds each to the card's value, shows the soft-required badge, fetches values on open, dispatches on change.

```vue
<template>
	<div v-if="fields.length" class="custom-fields-section">
		<h5 class="custom-fields-section__header">{{ t('deck', 'Campos') }}</h5>
		<div v-for="field in fields" :key="field.id" class="custom-fields-section__field">
			<label>
				{{ field.title }}
				<span v-if="isMissing(field)" class="custom-fields-section__required">{{ t('deck', 'obrigatório') }}</span>
			</label>
			<CustomFieldInput :field="field" :value="valueFor(field.id)" @input="save(field.id, $event)" />
		</div>
	</div>
</template>

<script>
import { mapGetters } from 'vuex'
import CustomFieldInput from './CustomFieldInput.vue'

export default {
	name: 'CustomFieldsSection',
	components: { CustomFieldInput },
	props: {
		card: { type: Object, required: true },
	},
	computed: {
		...mapGetters({ fields: 'currentBoardCustomFields' }),
		valuesByField() {
			const map = {}
			for (const v of (this.card.customFieldValues || [])) { map[v.fieldId] = v.value }
			return map
		},
	},
	watch: {
		'card.id': { immediate: true, handler() { this.$store.dispatch('loadCustomFieldValues', this.card) } },
	},
	methods: {
		valueFor(fieldId) { return this.valuesByField[fieldId] ?? null },
		isMissing(field) {
			if (!field.required || field.type === 'checkbox') return false
			const v = this.valueFor(field.id)
			return v === null || v === '' || v === undefined
		},
		save(fieldId, value) {
			this.$store.dispatch('setCustomFieldValue', { card: this.card, fieldId, value })
		},
	},
}
</script>
```

- [ ] **Step 5: Slot into `CardSidebarTabDetails.vue`**
- Import + register `CustomFieldsSection`.
- Render it right after `<DueDateSelector .../>` (line ~21) and before the `NcCollectionList`/`Description` block:
```vue
		<CustomFieldsSection :card="card" />
```

- [ ] **Step 6: Run the test, verify it passes**
Run: `npm run test -- CustomFieldInput`
Expected: PASS.

- [ ] **Step 7: Commit**
```bash
git add src/components/card/CustomFieldsSection.vue src/components/card/CustomFieldInput.vue src/components/card/CardSidebarTabDetails.vue src/components/card/CustomFieldInput.spec.js
git commit -m "feat(deck): card-sidebar custom-fields section + per-type widgets"
```

---

### Task 13: Version bump, i18n, build

**Files:**
- Modify: `appinfo/info.xml` (`<version>1.17.2</version>`)
- Modify: `l10n/pt_BR.js` + `l10n/pt_BR.json` (translations for the new strings) — **and** the Avuz theme override `themes/avuz/apps/deck/l10n/pt_BR.json` in the avuz-server repo if the strings must render pt_BR there
- Build: regenerate `js/` (committed artifact)

**Interfaces:** none (release task).

- [ ] **Step 1: Bump the version** — `appinfo/info.xml`: `<version>1.17.1</version>` → `<version>1.17.2</version>`.

- [ ] **Step 2: Add translations** — add the new UI strings (`Campos`, `obrigatório`, `Obrigatório`, `Nome do campo`, `Tipo`, `Opção`, `Adicionar opção`, `Adicionar campo`, `Salvar`, `Texto`, `Número`, `Moeda (R$)`, `Lista suspensa`, `Múltipla escolha`, `Data`, `Caixa de seleção`, `(removida)`) to `l10n/pt_BR.js` and `l10n/pt_BR.json` following the existing entry format.

- [ ] **Step 3: Build the bundle**
Run: `npm ci && npm run build`
Expected: builds `js/` with no errors.

- [ ] **Step 4: Run the full suites**
Run: `composer run test:unit && npm run test`
Expected: all green.

- [ ] **Step 5: Commit** (include the rebuilt `js/`)
```bash
git add appinfo/info.xml l10n/pt_BR.js l10n/pt_BR.json js/
git commit -m "chore(deck): v1.17.2 — custom fields; build + pt_BR strings"
```

---

## Post-implementation (outside this plan, handled by the deploy flow)

- Update the submodule pointer in avuz-server; rebuild the image; deploy.
- **Verify on deploy:** `occ config:app:get deck installed_version` == `1.17.2` and both tables exist; if the app was stale-but-disabled, `occ app:disable deck && occ app:enable --force deck`.
- **Purge Cloudflare** for each tenant domain (JS-only-visible changes serve stale via the `?v=` global-core-hash cache).
- Consider adding `AVUZ-CUSTOM-FIELDS-V1` to `verify_avuz_patches` in the avuz-server entrypoint for parity with the other sentinels.

## Self-Review notes

- **Spec coverage:** all 7 types (Task 4 helper + Task 12 widgets); per-board defs (Tasks 2,5,7); per-card values (Tasks 3,5,12); soft-required (Task 12, ignored for checkbox); type immutability (Task 5 update + Task 11 disabled type on edit); option-id stability + no-purge on removal (Task 5 `mintOptionIds`, test in Task 5); unique title (Task 5 `assertTitleUnique`); portable insert/update (Task 3); clone carries fields+values (Task 8); permissions MANAGE/EDIT/READ (Task 5); no batch enrichment in P1 (Task 7 note); sentinel (Task 6); version + i18n + build (Task 13).
- **Type consistency:** `customFields` / `customFieldValues` relation names, `CustomFieldApi` method names, and route names are used identically across backend and frontend tasks.
- **Deferred (not in any task, by design):** filter/group by field, values on tiles, hard-required, Excel export, auto-fill — later phases.
