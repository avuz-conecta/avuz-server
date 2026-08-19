# All-Boards User Filter + Card Start Date — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an assigned-user filter to the All-Boards overview (group/team assignments resolve to members) and an optional card `startdate` field (datetime, picker + badge, start ≤ due).

**Architecture:** Two independent features in the `avuz-conecta/deck` fork. Feature 2 (start date) mirrors the existing `duedate` field across entity/migration/service/controller/activity/Vue. Feature 1 (user filter) extends the fork-custom All-Boards machinery (`BoardSummaryService` + `BoardSummaryMapper` + `MatchingCardMapper` + `BoardTagService`/`Controller` + `BoardFilterBar` + `boardFilters.js`) with a user dimension; group/team assignments expand to member UIDs server-side.

**Tech Stack:** PHP 8 Nextcloud AppFramework (QBMapper, SimpleMigrationStep, ActivityManager), Vue 2.7 / Vuex, `@nextcloud/vue`, jest, phpunit.

## Global Constraints

- Fork branch `avuz`; **must commit built `js/` and `vendor/`** — see memory `deck-fork-submodule`. Canonical clone: `/Users/patrickrezende/work/avuz/deck-fork`.
- **Version bump 1.17.15 → 1.18.0** in `appinfo/info.xml` (mandatory `?v` cache-bust — memory `deck-js-cachebust-version-bump`). Done once at the end (Task DEPLOY), not per task.
- `startdate` is a full `datetime` mirroring `duedate`; the ≤ check is a **strict timestamp compare** (same-day-later-start is rejected).
- User filter: group (`type=1`) and circle/team (`type=7`) assignments resolve to member UIDs (mirror `PermissionService::findUsers()`); small-teams assumption → client-side filtering.
- `@group DB` phpunit tests run via the patched `avuzconecta:latest` image (`~/deck-test.sh`) — memory notes the Log.php normalizer patch.
- Assignment types: `Assignment::TYPE_USER=0`, `TYPE_GROUP=1`, `TYPE_CIRCLE=7`. Table `deck_assigned_users(participant string, card_id int, type int)`.
- Datetime entity properties auto-serialize to ISO-8601 (`format('c')`) via `RelationalEntity::jsonSerialize` and auto-bind from request params by name — no serializer/param glue needed.

---

# FEATURE 2 — Card Start Date

## Task F2.1: `startdate` column + entity

**Files:**
- Create: `lib/Migration/Version11800Date20260818120000.php`
- Modify: `lib/Db/Card.php` (constructor ~`:103-126`, `@method` block ~`:16-66`, property near `:85`)
- Test: `tests/unit/Db/CardTest.php` (create if absent) — entity serialization

**Interfaces:**
- Produces: `Card::getStartdate(): ?\DateTime` / `setStartdate(?\DateTime)`; `deck_cards.startdate` nullable datetime column; `startdate` key in card JSON (ISO-8601 or null).

- [ ] **Step 1: Write the failing entity test**

`tests/unit/Db/CardTest.php`:
```php
<?php
/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\Deck\Db;

use Test\TestCase;

class CardTest extends TestCase {
	public function testSerializesStartdateAsIsoOrNull(): void {
		$card = new Card();
		self::assertArrayHasKey('startdate', $card->jsonSerialize());
		self::assertNull($card->jsonSerialize()['startdate']);

		$card->setStartdate(new \DateTime('2026-08-18T09:00:00+00:00'));
		self::assertSame('2026-08-18T09:00:00+00:00', $card->jsonSerialize()['startdate']);
	}
}
```

- [ ] **Step 2: Run it, expect failure**

Run: `~/deck-test.sh --filter testSerializesStartdateAsIsoOrNull`
Expected: FAIL (no `startdate` key / setter).

- [ ] **Step 3: Add the property + type + annotations to `Card.php`**

Add property beside `duedate` (`:85`):
```php
	protected $startdate;
```
In `__construct()`, beside `$this->addType('duedate', 'datetime');`:
```php
		$this->addType('startdate', 'datetime');
```
Add to the `@method` phpdoc block near the top:
```php
 * @method ?\DateTime getStartdate()
 * @method void setStartdate(?\DateTime $startdate)
```

- [ ] **Step 4: Run it, expect pass**

Run: `~/deck-test.sh --filter testSerializesStartdateAsIsoOrNull`
Expected: PASS.

- [ ] **Step 5: Write the migration** (mirror of `Version1011Date20230901010840.php`)

`lib/Migration/Version11800Date20260818120000.php`:
```php
<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Avuz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Deck\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

class Version11800Date20260818120000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$table = $schema->getTable('deck_cards');
		if (!$table->hasColumn('startdate')) {
			$table->addColumn('startdate', Types::DATETIME, [
				'default' => null,
				'notnull' => false,
			]);
			return $schema;
		}
		return null;
	}
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/Migration/Version11800Date20260818120000.php lib/Db/Card.php tests/unit/Db/CardTest.php
git commit -m "feat(deck): add optional startdate column + entity field on cards"
```

---

## Task F2.2: Persist `startdate` + validate start ≤ due

**Files:**
- Modify: `lib/Service/CardService.php` (`update()` `:238-350`, `create()` `:181`)
- Modify: `lib/Controller/CardController.php` (`update()` `:63-72`, `create()` `:49`)
- Test: `tests/unit/Service/CardServiceTest.php`

**Interfaces:**
- Consumes: `Card::setStartdate` (F2.1).
- Produces: `CardService::update(..., ?string $startdate = null)` — persists startdate; throws `BadRequestException` when both set and `startdate > duedate`. `CardController::update` forwards `$startdate`.

- [ ] **Step 1: Write the failing service tests**

Add to `tests/unit/Service/CardServiceTest.php` (follow the file's existing `update` test setup for mocks — find an existing `testUpdate*` for the mock scaffolding and mirror it; the assertions unique to this task):
```php
	public function testUpdateRejectsStartAfterDue(): void {
		// start 2026-08-20 > due 2026-08-18 → BadRequestException, no persist
		$this->expectException(\OCA\Deck\BadRequestException::class);
		$this->service->update(1, 'title', 1, 'plain', 'admin', '', 0,
			'2026-08-18T09:00:00+00:00', null, null, null, '2026-08-20T09:00:00+00:00');
	}

	public function testUpdateRejectsDueBeforeExistingStart(): void {
		// symmetric direction: setting a due earlier than the start being set
		$this->expectException(\OCA\Deck\BadRequestException::class);
		$this->service->update(1, 'title', 1, 'plain', 'admin', '', 0,
			'2026-08-10T09:00:00+00:00', null, null, null, '2026-08-15T09:00:00+00:00');
	}

	public function testUpdateAcceptsEqualStartAndDue(): void {
		$card = $this->service->update(1, 'title', 1, 'plain', 'admin', '', 0,
			'2026-08-18T09:00:00+00:00', null, null, null, '2026-08-18T09:00:00+00:00');
		self::assertEquals(new \DateTime('2026-08-18T09:00:00+00:00'), $card->getStartdate());
	}

	public function testUpdateAcceptsStartWithNoDue(): void {
		$card = $this->service->update(1, 'title', 1, 'plain', 'admin', '', 0,
			null, null, null, null, '2026-08-18T09:00:00+00:00');
		self::assertEquals(new \DateTime('2026-08-18T09:00:00+00:00'), $card->getStartdate());
	}
```
> NOTE for the implementer: the `update` signature after this task is `update(int $id, string $title, int $stackId, string $type, string $owner, string $description='', int $order=0, ?string $duedate=null, ?int $deletedAt=null, ?bool $archived=null, ?OptionalNullableValue $done=null, ?string $startdate=null)`. Adjust the positional args in these tests to that order (startdate is the LAST param). Reuse the existing `testUpdate` mock setup (cardMapper->find/update, permissionService, etc.).

- [ ] **Step 2: Run them, expect failure** — `~/deck-test.sh --filter "testUpdateRejectsStartAfterDue|testUpdateRejectsDueBeforeExistingStart|testUpdateAcceptsEqualStartAndDue|testUpdateAcceptsStartWithNoDue"` → FAIL (unknown param / no validation).

- [ ] **Step 3: Add `$startdate` to `CardService::update` + `create` with validation**

In `update()` add the trailing param: `..., ?OptionalNullableValue $done = null, ?string $startdate = null): Card`.
Near the duedate assignment (`:280` `$card->setDuedate(...)`):
```php
		$card->setDuedate($duedate ? new \DateTime($duedate) : null);
		$card->setStartdate($startdate ? new \DateTime($startdate) : null);
		if ($card->getStartdate() !== null && $card->getDuedate() !== null
			&& $card->getStartdate() > $card->getDuedate()) {
			throw new BadRequestException($this->l10n->t('A data de início não pode ser posterior à data de conclusão'));
		}
```
(Confirm `BadRequestException` is imported and an `IL10N $l10n` is available in the service; if the translation service differs, use the same message helper the class already uses.) In `create()`, mirror by adding `?string $startdate = null` and `setStartdate` before persist (no validation needed on create unless both provided — include the same guard for safety).

- [ ] **Step 4: Add `$startdate` to `CardController::update` + `create`**

`update()` signature → add `$startdate = null` and forward:
```php
	public function update(int $id, string $title, int $stackId, string $type, int $order, string $description, $duedate, $deletedAt, $archived = null, $startdate = null): Card {
		$done = array_key_exists('done', $this->request->getParams())
			? new OptionalNullableValue($this->request->getParam('done', null))
			: null;
		return $this->cardService->update($id, $title, $stackId, $type, $this->userId, $description, $order, $duedate, $deletedAt, $archived, $done, $startdate);
	}
```
Mirror in `create()` if it forwards duedate.

- [ ] **Step 5: Run tests, expect pass** — same filter → PASS. Then run the whole `CardServiceTest` to confirm no regression: `~/deck-test.sh --filter CardServiceTest`.

- [ ] **Step 6: Commit**

```bash
git add lib/Service/CardService.php lib/Controller/CardController.php tests/unit/Service/CardServiceTest.php
git commit -m "feat(deck): persist card startdate and enforce start <= due"
```

---

## Task F2.3: Start-date activity event

**Files:**
- Modify: `lib/Activity/ActivityManager.php` (constants `:68-81`, subject-message switch, `createEvent` switch `:347-370`)
- Test: `tests/unit/Activity/ActivityManagerTest.php` (extend if present)

**Interfaces:**
- Produces: `ActivityManager::SUBJECT_CARD_UPDATE_STARTDATE = 'card_update_startdate'`; a changed `startdate` field produces a valid activity event (not swallowed, not mislabeled as duedate).

- [ ] **Step 1: Write the failing test** — assert `createEvent(DECK_OBJECT_CARD, $card, ActivityManager::SUBJECT_CARD_UPDATE_STARTDATE, ['before'=>null,'after'=>new \DateTime()])` returns an event (does not throw "Unknown subject"). Mirror an existing `createEvent`/duedate test in the file for scaffolding; if no such test file exists, create `ActivityManagerTest.php` with a minimal DI setup mirroring another service test.

- [ ] **Step 2: Run it, expect failure** (throws "Unknown subject for activity.").

- [ ] **Step 3: Add the constant** beside `SUBJECT_CARD_UPDATE_DUEDATE`:
```php
	public const SUBJECT_CARD_UPDATE_STARTDATE = 'card_update_startdate';
```

- [ ] **Step 4: Handle it in `createEvent`** — in the switch that formats datetime before/after (where `SUBJECT_CARD_UPDATE_DUEDATE` is handled, ~`:355`), add `self::SUBJECT_CARD_UPDATE_STARTDATE` to the same `case` group so its `\DateTimeInterface` before/after are `->format('c')`'d and it's a known subject.

- [ ] **Step 5: Add the human message** — in the subject-string switch (where `case self::SUBJECT_CARD_UPDATE_DUEDATE:` builds "changed the due date…"), add a parallel `case self::SUBJECT_CARD_UPDATE_STARTDATE:` with set/removed/changed messages, e.g.:
```php
			case self::SUBJECT_CARD_UPDATE_STARTDATE:
				if (!isset($subjectParams['after'])) {
					$subject = $ownActivity ? $l->t('You have removed the start date of card {card}') : $l->t('{user} has removed the start date of card {card}');
				} else {
					$subject = $ownActivity ? $l->t('You have set the start date of card {card} to {after}') : $l->t('{user} has set the start date of card {card} to {after}');
				}
				break;
```
(Match the exact structure of the duedate case in this file, including any `findDetailsForCard` fallthrough list it belongs to.)

- [ ] **Step 6: Run test, expect pass; commit**
```bash
git add lib/Activity/ActivityManager.php tests/unit/Activity/ActivityManagerTest.php
git commit -m "feat(deck): own activity event for card start date changes"
```

---

## Task F2.4: Start-date picker in the card sidebar

**Files:**
- Create: `src/components/card/StartDateSelector.vue` (clone of `DueDateSelector.vue`)
- Modify: `src/components/card/CardSidebarTabDetails.vue` (mount `:21-24`, handlers `:147-156`, imports `:56`)
- Modify: `src/store/card.js` (add `updateCardStart` action beside `updateCardDue` `:365-368`)
- Test: `src/components/card/StartDateSelector.spec.js`

**Interfaces:**
- Consumes: card object with `startdate`/`duedate` ISO strings.
- Produces: `updateCardStart` Vuex action → PUTs card with `startdate` → commits `updateCardProperty('startdate')`.

- [ ] **Step 1: Write the failing spec** — mount `StartDateSelector` with `card: { startdate: null, duedate: '2026-08-20T09:00:00+00:00' }`; assert (a) the `startdate` computed getter is null; (b) setting it emits `input`; (c) the date picker's `:max` prop equals the card's duedate (so start can't exceed due). Mock `@nextcloud/vue` components as the existing card specs do.

- [ ] **Step 2: Run it, expect failure** (component absent).

- [ ] **Step 3: Create `StartDateSelector.vue`** — copy `src/components/card/DueDateSelector.vue`, then:
  - Rename component to `StartDateSelector`; `data-test="start-date-selector"`; label text → "Assign a start date to this card…".
  - Replace the `duedate` computed with `startdate` (get: `this.card?.startdate ? new Date(this.card.startdate) : null`; set: `this.$emit('input', val ? new Date(val) : null)`).
  - Picker `id="card-startdate-picker"`, `v-model="startdate"`, add `:max="maxStartDate"` where:
    ```js
    computed: {
      maxStartDate() { return this.card?.duedate ? new Date(this.card.duedate) : null },
    }
    ```
  - **Remove** the "Mark as done"/archive branch and the reminder shortcuts (`reminderOptions`, `selectShortcut`, `changeCardDoneStatus`, `archiveUnarchiveCard`) — start date has no done/reminder semantics. Keep `initDate` (seed) and `removeStart` (clear → `$emit('change', null)`).
  - Keep the `input` (debounced) + `change` (immediate) emits.

- [ ] **Step 4: Add `updateCardStart` to `src/store/card.js`** (beside `updateCardDue`):
```js
	async updateCardStart({ commit }, card) {
		const updatedCard = await apiClient.updateCard(card)
		commit('updateCardProperty', { property: 'startdate', card: updatedCard })
	},
```

- [ ] **Step 5: Mount it in `CardSidebarTabDetails.vue`** — import + register `StartDateSelector`; render it directly above the `DueDateSelector` block:
```html
		<StartDateSelector :card="card"
			:can-edit="canEdit"
			@change="updateCardStart"
			@input="debouncedUpdateCardStart" />
```
Add handlers mirroring `updateCardDue`:
```js
		updateCardStart(val) {
			this.$store.dispatch('updateCardStart', {
				...this.copiedCard,
				startdate: val ? (new Date(val)).toISOString() : null,
			})
		},
		debouncedUpdateCardStart: debounce(function(val) {
			this.updateCardStart(val)
		}, 500),
```

- [ ] **Step 6: Run spec + eslint, expect pass; commit**
```bash
npx jest src/components/card/StartDateSelector.spec.js
npx eslint src/components/card/StartDateSelector.vue src/store/card.js src/components/card/CardSidebarTabDetails.vue
git add src/components/card/StartDateSelector.vue src/components/card/CardSidebarTabDetails.vue src/store/card.js src/components/card/StartDateSelector.spec.js
git commit -m "feat(deck): start-date picker in card sidebar (capped at due date)"
```

---

## Task F2.5: Start-date badge on the card face

**Files:**
- Create: `src/components/cards/badges/StartDate.vue` (clone of `badges/DueDate.vue`, simplified)
- Modify: `src/components/cards/CardBadges.vue` (import `:54`, register `:59`, render `:9`)
- Test: `src/components/cards/badges/StartDate.spec.js`

**Interfaces:**
- Consumes: card object with `startdate`.
- Produces: a badge rendered when `card.startdate` is set.

- [ ] **Step 1: Write the failing spec** — mount `StartDate` with `card: { startdate: '2026-08-18T09:00:00+00:00' }`; assert the badge renders and shows a relative date; mount with `startdate: null` → renders nothing. Mirror `DueDate.spec.js` if present.

- [ ] **Step 2: Run it, expect failure.**

- [ ] **Step 3: Create `StartDate.vue`** — copy `badges/DueDate.vue`, then strip the due-state logic (`DueState` enum, `dueState`, `overdue`, `[data-due-state=...]` color rules, `card.done` branch). Bind to `card.startdate`; show `v-if="card.startdate"`; use a distinct neutral icon (e.g. `CalendarStart`/`Calendar` from `vue-material-design-icons`); label = `moment(card.startdate).fromNow()` with `absoluteDate` title. Neutral styling only.

- [ ] **Step 4: Render it in `CardBadges.vue`** — import + register `StartDate`; in `.badge-left`, beside the `DueDate` render:
```html
		<StartDate v-if="card.startdate" :card="card" />
```

- [ ] **Step 5: Run spec + eslint, expect pass; commit**
```bash
npx jest src/components/cards/badges/StartDate.spec.js
git add src/components/cards/badges/StartDate.vue src/components/cards/CardBadges.vue src/components/cards/badges/StartDate.spec.js
git commit -m "feat(deck): start-date badge on the card face"
```

---

# FEATURE 1 — All-Boards User Filter

## Task F1.1: Board summaries carry expanded assigned users

**Files:**
- Modify: `lib/Db/BoardSummaryMapper.php` (add `findAssignedParticipants(array $boardIds): array`)
- Modify: `lib/Service/BoardSummaryService.php` (constructor deps, `findForCurrentUser()`, return shape) — inject `IGroupManager`, `CirclesService`, `IUserManager`
- Test: `tests/unit/Service/BoardSummaryServiceTest.php`, `tests/unit/Db/BoardSummaryMapperTest.php` (`@group DB`)

**Interfaces:**
- Produces: each summary gains `users: array{uid: string, displayName: string}[]` — direct user assignees plus every member of groups/teams assigned to a live card in that board, deduped by uid.

- [ ] **Step 1: Write the failing mapper test** (`@group DB`) — insert a board/stack/card, assign `deck_assigned_users` rows of type USER (`participant='alice'`), GROUP (`participant='team1'`), CIRCLE (`participant='circle1'`) to the card; assert `findAssignedParticipants([boardId])` returns `[boardId => [['participant'=>'alice','type'=>0], ['participant'=>'team1','type'=>1], ['participant'=>'circle1','type'=>7]]]` (raw participants+types, archived/deleted/done cards excluded). Follow `BoardSummaryMapperTest` fixtures for the tag/due tests already in the repo.

- [ ] **Step 2: Run it, expect failure.**

- [ ] **Step 3: Add `findAssignedParticipants` to `BoardSummaryMapper`** — mirror `findDerivedTags`'s joins (`deck_cards c` ⋈ `deck_stacks s` on board, same `c.archived=false`, `c.deleted_at=0`, `c.done IS NULL`, `s.deleted_at=0` filters) but join `deck_assigned_users au ON au.card_id = c.id`, selecting distinct `s.board_id, au.participant, au.type`. Group results by board id into `array<int, array{participant:string, type:int}[]>`.

- [ ] **Step 4: Run mapper test, expect pass.**

- [ ] **Step 5: Write the failing service test** — mock `BoardSummaryMapper::findAssignedParticipants` to return a USER + a GROUP + a CIRCLE for a board; mock `IGroupManager::get('team1')->getUsers()` → `[bob]`, `CirclesService::getCircle('circle1')->getInheritedMembers()` → `[carol]`; mock `IUserManager::get(uid)->getDisplayName()`. Assert the summary's `users` = `[{uid:'alice',...},{uid:'bob',...},{uid:'carol',...}]` deduped, and that a uid appearing via two paths is single. Mirror the existing `BoardSummaryServiceTest` scaffolding.

- [ ] **Step 6: Run it, expect failure.**

- [ ] **Step 7: Extend `BoardSummaryService`** — add `IGroupManager $groupManager, CirclesService $circlesService, IUserManager $userManager` to the constructor. Add a private `expandParticipants(array $participants): array` that mirrors `PermissionService::findUsers()` (`:300-334`): TYPE_USER → the uid; TYPE_GROUP → `$this->groupManager->get($p)?->getUsers()` UIDs; TYPE_CIRCLE → `$this->circlesService->getCircle($p)?->getInheritedMembers()` filtered to real users. Resolve each distinct group/circle once (cache in a local map across boards). Attach `'users' => array_map(fn($uid) => ['uid'=>$uid,'displayName'=>$this->displayName($uid)], $expandedUidsForBoard)` to each summary; update the `@return` docblock. Guard circles with `CirclesService::isCirclesEnabled()`.

- [ ] **Step 8: Run service test + full `BoardSummaryServiceTest`, expect pass; commit**
```bash
git add lib/Db/BoardSummaryMapper.php lib/Service/BoardSummaryService.php tests/unit/Db/BoardSummaryMapperTest.php tests/unit/Service/BoardSummaryServiceTest.php
git commit -m "feat(deck): board summaries carry expanded assigned users (groups/teams -> members)"
```

---

## Task F1.2: Matching-cards query filters by assigned user

**Files:**
- Modify: `lib/Db/MatchingCardMapper.php` (`findMatchingCards` `:25-57`)
- Modify: `lib/Service/BoardTagService.php` (`matchingCards` `:77-81` — resolve picked users' memberships, pass to mapper)
- Modify: `lib/Controller/BoardTagController.php` (`matchingCards` `:50-53` — accept `users`)
- Modify: `appinfo/routes.php` (route unchanged; param is query-bound)
- Test: `tests/unit/Db/MatchingCardMapperTest.php` (`@group DB`), `tests/unit/Service/BoardTagServiceTest.php`

**Interfaces:**
- Consumes: `Assignment` types; group/circle resolution (mirror F1.1's expansion, or extract a shared helper).
- Produces: `MatchingCardMapper::findMatchingCards(int $boardId, array $tagTitles, string $due, \DateTimeImmutable $now, array $assignedParticipants = [])` — when non-empty, `INNER JOIN deck_assigned_users` on `(participant,type)` IN the set, `DISTINCT`.

- [ ] **Step 1: Write the failing mapper test** (`@group DB`) — board with two cards: card A assigned to user `alice` (type 0), card B assigned to group `team1` (type 1). `findMatchingCards(board, [], '', now, [['participant'=>'alice','type'=>0]])` → only A; `findMatchingCards(board, [], '', now, [['participant'=>'team1','type'=>1]])` → only B; `findMatchingCards(board, [], '', now, [])` → both (unchanged). Assert no duplicate rows when a card matches two participants.

- [ ] **Step 2: Run it, expect failure.**

- [ ] **Step 3: Add the assignee join to `findMatchingCards`** — new trailing param `array $assignedParticipants = []`. When non-empty, build an OR of `(au.participant = :p AND au.type = :t)` pairs (or a composite `IN`), `->innerJoin('c', 'deck_assigned_users', 'au', 'au.card_id = c.id')`. Keep `selectDistinct` (already present) so multi-match cards aren't duplicated.

- [ ] **Step 4: Run mapper test, expect pass.**

- [ ] **Step 5: Write the failing service test** — mock permission check; mock the membership resolution so picked user `bob` expands to `{(bob,0),(team1,1)}`; assert `MatchingCardMapper::findMatchingCards` is called with those participants. Mirror `BoardTagServiceTest` scaffolding.

- [ ] **Step 6: Run it, expect failure.**

- [ ] **Step 7: Wire service + controller** — `BoardTagController::matchingCards(int $boardId, array $tags = [], string $due = '', array $users = [])`. `BoardTagService::matchingCards(int $boardId, array $tagTitles, string $due, array $userIds = [])`: for each picked uid, resolve `{(uid,0)} ∪ {(groupId,1) for user's groups} ∪ {(circleId,7) for user's circles}` (inject `IGroupManager` + `CirclesService`; `getUserGroupIds`, `getUserCircles`), union across picked users, pass to the mapper. **Extract the user→memberships resolution into a shared helper** (e.g. a small `AssignmentResolver` service or a method reused by F1.1's expansion) rather than duplicating.

- [ ] **Step 8: Run service test + `MatchingCardMapperTest` + `BoardTagServiceTest`, expect pass; commit**
```bash
git add lib/Db/MatchingCardMapper.php lib/Service/BoardTagService.php lib/Controller/BoardTagController.php tests/unit/Db/MatchingCardMapperTest.php tests/unit/Service/BoardTagServiceTest.php
git commit -m "feat(deck): matching-cards query filters by assigned user (incl group/team membership)"
```

---

## Task F1.3: Client filter logic + store + API

**Files:**
- Modify: `src/helpers/boardFilters.js` (`boardMatchesFilters`, add `userOptions`)
- Modify: `src/store/main.js` (state `:66-69`, mutations `:271-279`, getters `:128-139`, action `:499-502`)
- Modify: `src/services/BoardTagApi.js` (`loadMatchingCards` `:25-37`)
- Test: `src/helpers/boardFilters.spec.js`, `src/store/*.spec.js` (main store spec)

**Interfaces:**
- Produces: `boardMatchesFilters(summary, { tags, due, users })` (users = picked uids, match on `summary.users` uid intersection); `userOptions(summaries)`; `boardUserFilter` state + `setBoardUserFilter` mutation (clears `matchingCards`); `loadMatchingCards` threads `boardUserFilter`; `BoardTagApi.loadMatchingCards(boardId, tags, due, users)` appends `users[]`.

- [ ] **Step 1: Write the failing helper tests** in `boardFilters.spec.js`:
```js
it('matches a board when a picked user has a card there', () => {
	const summary = { tags: [], due: {}, users: [{ uid: 'alice' }, { uid: 'bob' }] }
	expect(boardMatchesFilters(summary, { tags: [], due: '', users: ['bob'] })).toBe(true)
	expect(boardMatchesFilters(summary, { tags: [], due: '', users: ['zoe'] })).toBe(false)
})
it('passes through when no user is picked', () => {
	expect(boardMatchesFilters({ tags: [], due: {}, users: [] }, { tags: [], due: '', users: [] })).toBe(true)
})
it('combines user with tags (AND across dimensions)', () => {
	const summary = { tags: ['x'], due: {}, users: [{ uid: 'alice' }] }
	expect(boardMatchesFilters(summary, { tags: ['x'], due: '', users: ['alice'] })).toBe(true)
	expect(boardMatchesFilters(summary, { tags: ['y'], due: '', users: ['alice'] })).toBe(false)
})
it('userOptions dedupes users across boards', () => {
	const opts = userOptions([{ users: [{ uid: 'a', displayName: 'A' }] }, { users: [{ uid: 'a', displayName: 'A' }, { uid: 'b', displayName: 'B' }] }])
	expect(opts.map(o => o.uid).sort()).toEqual(['a', 'b'])
})
```

- [ ] **Step 2: Run them, expect failure.**

- [ ] **Step 3: Extend `boardFilters.js`** — update the empty-short-circuit to `tags.length === 0 && due === '' && users.length === 0`; add a `users` branch: if `users.length > 0`, `false` unless `summary.users?.some(u => users.includes(u.uid))`. Add:
```js
export function userOptions(summaries) {
	const byUid = new Map()
	for (const summary of summaries) {
		for (const user of summary.users ?? []) {
			if (!byUid.has(user.uid)) { byUid.set(user.uid, user) }
		}
	}
	return [...byUid.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))
}
```

- [ ] **Step 4: Run helper tests, expect pass.**

- [ ] **Step 5: Extend the store** (`main.js`) — add `boardUserFilter: []`; `setBoardUserFilter(state, users) { state.boardUserFilter = users; state.matchingCards = {} }`; pass `users: state.boardUserFilter` into `boardMatchesFilters` in `boardsFilteredByTags`; add a `boardUserOptions` getter (`userOptions(visibleSummaries)`); thread `state.boardUserFilter` through `loadMatchingCards` → `boardTagApi.loadMatchingCards(boardId, state.boardTagFilter, state.boardDueFilter, state.boardUserFilter)`.

- [ ] **Step 6: Extend `BoardTagApi.loadMatchingCards`** — new `users` param; `users.forEach(u => params.append('users[]', u))`.

- [ ] **Step 7: Write + run a store mutation test** (`setBoardUserFilter` sets the list and clears `matchingCards`); expect pass.

- [ ] **Step 8: Commit**
```bash
git add src/helpers/boardFilters.js src/helpers/boardFilters.spec.js src/store/main.js src/services/BoardTagApi.js src/store/*.spec.js
git commit -m "feat(deck): client-side user filter dimension for all-boards"
```

---

## Task F1.4: Filter-bar UI + expand wiring

**Files:**
- Modify: `src/components/boards/BoardFilterBar.vue` (add user `NcSelect`, URL `user` param)
- Modify: `src/components/boards/Boards.vue` (`hasActiveFilter` `:64-66`)
- Modify: `src/components/boards/BoardItem.vue` (`hasActiveFilter` `:130-132`, `watch` `:137-148`)
- Test: `src/components/boards/BoardFilterBar.spec.js` (create if absent)

**Interfaces:**
- Consumes: `boardUserFilter`, `boardUserOptions` (F1.3).
- Produces: a user multiselect that commits `setBoardUserFilter` + round-trips a `user` URL param; `hasActiveFilter` (both components) and the expand `watch` react to the user filter.

- [ ] **Step 1: Write the failing spec** — mount `BoardFilterBar` with a store exposing `boardUserOptions` = `[{uid:'a',displayName:'A'}]`; selecting a user commits `setBoardUserFilter` with `['a']` and writes `user=a` to the route; a route with `user=a` rehydrates `selectedUsers`. Mirror the tag-select behavior; mock `NcSelect`.

- [ ] **Step 2: Run it, expect failure.**

- [ ] **Step 3: Add the user select to `BoardFilterBar.vue`** — a second `NcSelect` (`user-select`, `multiple`, `:options="userOptions"` from `boardUserOptions`, `label="displayName"`, `track-by="uid"`), bound to `selectedUsers`. Extend: `data().selectedUsers = []`; `hasActiveFilter` includes `selectedUsers.length > 0`; `commitFilters` also `commit('setBoardUserFilter', this.selectedUsers.map(u => u.uid))`; `readFiltersFromRoute` reads `query.user` (normalize to array, map uids → option objects from `boardUserOptions`); `writeFiltersToRoute` adds `user: this.selectedUsers.map(u => u.uid)`; `clearFilters` resets `selectedUsers`.

- [ ] **Step 4: Update `hasActiveFilter` in `Boards.vue` and `BoardItem.vue`** to also test `state.boardUserFilter.length > 0`; add a `'$store.state.boardUserFilter'()` watcher in `BoardItem.vue` calling `refetchIfExpanded()`.

- [ ] **Step 5: Run spec + eslint, expect pass; commit**
```bash
npx jest src/components/boards/BoardFilterBar.spec.js
npx eslint src/components/boards/BoardFilterBar.vue src/components/boards/Boards.vue src/components/boards/BoardItem.vue
git add src/components/boards/BoardFilterBar.vue src/components/boards/Boards.vue src/components/boards/BoardItem.vue src/components/boards/BoardFilterBar.spec.js
git commit -m "feat(deck): all-boards user filter bar + expand scoped to user"
```

---

## Task DEPLOY: version bump, build, ship, verify

**Files:** `appinfo/info.xml`, `js/` (built), submodule pointer in avuz-server worktree.

- [ ] **Step 1:** Full suites green — `npx jest` (all) and `~/deck-test.sh tests/unit/Service tests/unit/Db tests/unit/Activity` — plus `npx eslint` on all changed files.
- [ ] **Step 2:** Bump `appinfo/info.xml` `<version>` to `1.18.0`.
- [ ] **Step 3:** `npm run build`; `git add appinfo/info.xml js/ && git commit -m "chore(deck): build 1.18.0 (all-boards user filter + card start date)"`; `git checkout -- vendor/` if composer dirtied it; `git push avuz avuz`.
- [ ] **Step 4:** In the avuz-server worktree: bump `apps/deck` submodule to the new HEAD, commit.
- [ ] **Step 5:** `KEEP_DOCKER=1 ./scripts/build-push.sh latest staging`; `./scripts/deploy.sh -y avuz-conecta`; poll to `deck=1.18.0` + web serving (expect ~3–5 min php-fpm 502 while it boots + runs the startdate migration).
- [ ] **Step 6: Live-verify** (logged-in browser):
  - Card sidebar shows a start-date picker; set a start date → badge appears on the card; try start > due → rejected with the toast; start ≤ due persists across reload.
  - All Boards: pick a user → only boards with that user's cards remain; expand one → only that user's cards; a user assigned via a small team matches; URL carries `user=`.

## Self-Review notes (author)

- Spec coverage: F2.1–F2.5 = start date (column, persist+validate, activity, picker, badge); F1.1–F1.4 = user filter (summary users, matching query, client logic, UI). All spec Decisions mapped.
- **Membership resolution runs in two INVERSE directions** and they must agree. F1.1 (board level) expands each *assignment* to members: group → `getUsers()`, circle → `getInheritedMembers()`. F1.2 (expand + card match) expands the *picked user* to memberships: `getUserGroupIds(uid)`, `getUserCircles(uid)`. They are not the same call, so no shared helper — but the reviewer MUST confirm they agree on membership (bob ∈ team1 by `getUserGroupIds(bob)` iff team1 `getUsers()` contains bob), else a board can list at F1.1 but its card vanish at F1.2 (a new revert/flip-class inconsistency). Circles' inherited/nested members are the riskiest divergence point — check both sides resolve nested membership the same way.
- Validation lives in `CardService::update` (authoritative) with the picker `:max` as guidance (F2.4).
- No placeholders except where a task says "mirror the existing X test scaffolding" — intentional, since the mock setup is repo-specific and the implementer has the file.
