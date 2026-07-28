# Deck Board Tags — Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Three enhancements to the shipped board-tags feature: (1) color the board-tile tag chips with their label color, (2) fit the filter bar on one row, (3) an expandable per-board glimpse of the cards matching the active filters.

**Architecture:** Extends the existing fork `avuz-conecta/deck` branch `avuz` (base `ff1102e6`). `#1` widens the `directTags` contract from `string[]` to `{title,color}[]`. `#3` adds one lazy-fetched endpoint returning a board's live cards that satisfy the active tag+date filters, and an inline expand in `BoardItem`. `#2` is CSS-only.

**Tech Stack:** PHP 8 / NC AppFramework (QBMapper, IQueryBuilder), PostgreSQL, Vue2/Vuex, `@nextcloud/vue`, PHPUnit 9, Jest 29.

## Global Constraints

- Work in `~/work/avuz/deck-fork` (branch `avuz`, base `ff1102e6`). Do NOT push; the controller batches pushes and bumps the server submodule pointer.
- **Database is PostgreSQL.** QueryBuilder only, no raw SQL. `archived` binds `PARAM_BOOL`; datetimes `PARAM_DATETIME_IMMUTABLE`; every count/id cast `(int)`.
- **Live card** = `c.archived=false AND c.deleted_at=0 AND c.done IS NULL AND s.deleted_at=0` — identical wherever it appears (already in `BoardSummaryMapper`).
- Due-bucket keys/semantics reuse the existing set exactly: `overdue`(`duedate<now`), `dueToday`/`dueWeek`/`dueMonth` (`now<=duedate<=now+{1d,7d,30d}`), `noDue`(`duedate IS NULL`). Forward windows start at `now`.
- Test harness (built already): `~/deck-test.sh <phpunit args>` (Postgres-backed throwaway container), `npx jest` from the fork. Full-suite baseline: **397 tests / 6 pre-existing failures** (NotifierTest pt_BR). Jest: 10 tests. Add only passing tests.
- PHP tabs + SPDX headers; Vue: `this.t(...)` in `<script>` (t/n are Vue.prototype, not globals); pt_BR msgids written directly (msgid-fallback, no l10n files).
- Color rendering reuses the existing `Color` mixin (`src/mixins/color.js`) — `textColor(hex)` for contrast, `backgroundColor: '#' + color`. Pattern precedent: `TagsTabSidebar.vue:51`.

---

## File Structure

| Path | Change |
| --- | --- |
| `lib/Db/BoardSummaryMapper.php` | `findDirectTags` returns `{title,color}` per board |
| `lib/Service/BoardSummaryService.php` | `directTags` field becomes objects |
| `lib/Db/CardMapper.php` (or a small mapper method) | `findMatchingCards(boardId, tags, due, now)` |
| `lib/Service/BoardTagService.php` | `matchingCards(boardId, tags, due)` |
| `lib/Controller/BoardTagController.php` | `matchingCards` method |
| `appinfo/routes.php` | one new route |
| `src/components/boards/BoardItem.vue` | colored chips + expandable glimpse |
| `src/components/boards/BoardFilterBar.vue` | one-row CSS |
| `src/services/BoardTagApi.js` | `loadMatchingCards` |
| `src/store/main.js` | `matchingCards` state + action |
| tests | mapper/service/controller PHP + jest |

---

### Task 1: directTags carries color

**Files:**
- Modify: `lib/Db/BoardSummaryMapper.php` (`findDirectTags`)
- Modify: `lib/Service/BoardSummaryService.php`
- Test: `tests/unit/Db/BoardSummaryMapperTest.php`, `tests/unit/Service/BoardSummaryServiceTest.php`

**Interfaces:**
- Consumes: nothing new.
- Produces: `findDirectTags(int[]): array<int, array{title:string,color:string}[]>`. `BoardSummaryService::findForCurrentUser()` `directTags` field becomes `array{title:string,color:string}[]`. `tags` and `due` unchanged. Task 3 (frontend) renders `directTags[].color`.

- [ ] **Step 1: Update the DB test to assert color**

In `tests/unit/Db/BoardSummaryMapperTest.php`, the direct-tags coverage must assert the color comes back. Add (using the existing fixture helpers `makeLabel` which sets color `31CC7C`, and `BoardLabelMapper`):

```php
	public function testDirectTagsCarryLabelColor(): void {
		$label = $this->makeLabel('Cliente X'); // makeLabel sets color 31CC7C
		$boardLabelMapper = new BoardLabelMapper(Server::get(\OCP\IDBConnection::class));
		$boardLabelMapper->setForBoard($this->board->getId(), [$label->getId()]);

		$direct = $this->mapper->findDirectTags([$this->board->getId()]);

		$this->assertSame(
			[['title' => 'Cliente X', 'color' => '31CC7C']],
			$direct[$this->board->getId()],
		);
	}
```

Add `use OCA\Deck\Db\BoardLabelMapper;` if not present. If `makeLabel` doesn't exist in this test file, create the label inline via `$this->labelMapper->insert(...)` matching the other fixtures (color `31CC7C`).

- [ ] **Step 2: Run it — watch it fail**

```bash
~/deck-test.sh tests/unit/Db/BoardSummaryMapperTest.php --filter testDirectTagsCarryLabelColor 2>&1 | tail -15
```

Expected: FAIL — current `findDirectTags` returns bare strings, not `{title,color}`.

- [ ] **Step 3: Return color from findDirectTags**

In `lib/Db/BoardSummaryMapper.php`, change `findDirectTags` to select the color and build objects (do NOT reuse `groupTitlesByBoard`, which is title-only — `findDerivedTags` still uses it and stays `string[]`):

```php
	/**
	 * @param int[] $boardIds
	 * @return array<int, array{title: string, color: string}[]>
	 */
	public function findDirectTags(array $boardIds): array {
		if ($boardIds === []) {
			return [];
		}

		$qb = $this->db->getQueryBuilder();
		$qb->selectDistinct(['bal.board_id', 'l.title', 'l.color'])
			->from('deck_board_assigned_labels', 'bal')
			->innerJoin('bal', 'deck_labels', 'l', $qb->expr()->eq('l.id', 'bal.label_id'))
			->where($qb->expr()->in('bal.board_id', $qb->createNamedParameter($boardIds, IQueryBuilder::PARAM_INT_ARRAY)));

		$result = $qb->executeQuery();
		$tags = [];
		foreach ($result->fetchAll() as $row) {
			$tags[(int)$row['board_id']][] = [
				'title' => (string)$row['title'],
				'color' => (string)$row['color'],
			];
		}
		$result->closeCursor();

		return $tags;
	}
```

- [ ] **Step 4: Run it — watch it pass**

```bash
~/deck-test.sh tests/unit/Db/BoardSummaryMapperTest.php 2>&1 | tail -15
```

Expected: OK (all BoardSummaryMapper tests, incl. the new one).

- [ ] **Step 5: Propagate through BoardSummaryService**

`BoardSummaryService::findForCurrentUser()` currently sets `'directTags' => $direct[$boardId] ?? []` — that already passes the mapper's new shape straight through, so no logic change is needed there. BUT the merge for `tags` uses `$direct[$boardId]` as a `string[]`. Verify: `mergeTitles(array $direct, array $derived)` receives direct titles. Now `$direct[$boardId]` is `{title,color}[]`, so `tags` would break.

Fix `findForCurrentUser` to pass **titles** into the merge while keeping objects for `directTags`:

```php
		$directForBoard = $direct[$boardId] ?? [];
		$directTitles = array_map(static fn (array $t): string => $t['title'], $directForBoard);
		$summaries[] = [
			'boardId' => $boardId,
			'tags' => $this->mergeTitles($directTitles, $derived[$boardId] ?? []),
			'directTags' => $directForBoard,
			'due' => $counts[$boardId] ?? self::EMPTY_COUNTS,
		];
```

- [ ] **Step 6: Update the service test**

In `tests/unit/Service/BoardSummaryServiceTest.php`, the mock of `findDirectTags` and the `directTags` assertions must use the new shape. Change the mocked return and assertions from `['Cliente X']` to `[['title' => 'Cliente X', 'color' => '31CC7C']]`, and confirm `tags` (which the test also checks) still merges correctly by title. Update every `findDirectTags` mock + `directTags` assertion in the file.

- [ ] **Step 7: Run the service test**

```bash
~/deck-test.sh tests/unit/Service/BoardSummaryServiceTest.php 2>&1 | tail -15
```

Expected: OK. Then the full suite:

```bash
~/deck-test.sh 2>&1 | tail -4
```

Expected: 397 base + no new failures (still 6).

- [ ] **Step 8: Commit**

```bash
cd ~/work/avuz/deck-fork && git add lib/Db/BoardSummaryMapper.php lib/Service/BoardSummaryService.php tests/ && git commit -m "feat(tags): directTags carry label color"
```

---

### Task 2: matching-cards endpoint

**Files:**
- Create: `lib/Db/MatchingCardMapper.php` (or add a method to an existing mapper — a new small mapper keeps it focused)
- Modify: `lib/Service/BoardTagService.php` (`matchingCards`)
- Modify: `lib/Controller/BoardTagController.php` (`matchingCards`)
- Modify: `appinfo/routes.php`
- Test: `tests/unit/Db/MatchingCardMapperTest.php`, `tests/unit/Controller/BoardTagControllerTest.php`

**Interfaces:**
- Consumes: `BoardTagService`'s existing deps; `ITimeFactory`.
- Produces:
  - `MatchingCardMapper::findMatchingCards(int $boardId, string[] $tagTitles, string $due, \DateTimeImmutable $now): array` → list of `{id:int, title:string, duedate:?string, listTitle:string}` for the board's LIVE cards where (tagTitles empty OR the card has a label whose title is in tagTitles) AND (due empty OR the card is in that bucket).
  - `BoardTagService::matchingCards(int $boardId, string[] $tagTitles, string $due): array` — checks `PERMISSION_READ`, resolves `$now` from `ITimeFactory`, delegates.
  - `BoardTagController::matchingCards(int $boardId, array $tags = [], string $due = ''): array`.
  - Route `GET /boards/{boardId}/matching-cards`.

- [ ] **Step 1: Write the DB test (failing)**

Create `tests/unit/Db/MatchingCardMapperTest.php`, mirroring `BoardSummaryMapperTest`'s fixture style (real board+stack+cards+labels; `@group DB`). Assert:

```php
	public function testReturnsLiveCardsMatchingTagAndDate(): void {
		$now = new \DateTimeImmutable('2026-07-27 12:00:00');
		$label = $this->makeLabel('Cliente X');
		$soon = $this->makeCard('Soon', '2026-07-27 20:00:00');   // dueToday
		$later = $this->makeCard('Later', '2026-08-15 10:00:00');  // dueMonth, not week
		$this->cardMapper->assignLabel($soon->getId(), $label->getId());
		$this->cardMapper->assignLabel($later->getId(), $label->getId());

		// tag-only: both cards
		$byTag = $this->mapper->findMatchingCards($this->board->getId(), ['Cliente X'], '', $now);
		$this->assertEqualsCanonicalizing(['Soon', 'Later'], array_column($byTag, 'title'));

		// tag AND date (dueWeek): only Soon
		$byBoth = $this->mapper->findMatchingCards($this->board->getId(), ['Cliente X'], 'dueWeek', $now);
		$this->assertSame(['Soon'], array_column($byBoth, 'title'));

		// date-only (dueToday): only Soon (no tag filter)
		$byDate = $this->mapper->findMatchingCards($this->board->getId(), [], 'dueToday', $now);
		$this->assertSame(['Soon'], array_column($byDate, 'title'));
	}

	public function testExcludesDoneArchivedDeletedCards(): void {
		$now = new \DateTimeImmutable('2026-07-27 12:00:00');
		$this->makeCard('Done', '2026-07-27 20:00:00', false, '2026-01-01 10:00:00');
		$this->makeCard('Archived', '2026-07-27 20:00:00', true);
		$this->assertSame([], $this->mapper->findMatchingCards($this->board->getId(), [], 'dueToday', $now));
	}
```

Reuse the exact `makeCard`/`makeLabel` fixture helpers from `BoardSummaryMapperTest` (copy them into this test's `setUp` region). `CardMapper::assignLabel(int $card, int $label)` — card first.

- [ ] **Step 2: Run — watch it fail**

```bash
~/deck-test.sh tests/unit/Db/MatchingCardMapperTest.php 2>&1 | tail -15
```

Expected: FAIL — class not found.

- [ ] **Step 3: Write the mapper**

Create `lib/Db/MatchingCardMapper.php`. The due-bucket predicate MUST match `BoardSummaryMapper::findDueCounts` exactly (forward windows from `now`):

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

class MatchingCardMapper {
	public function __construct(
		private IDBConnection $db,
	) {
	}

	/**
	 * @param string[] $tagTitles
	 * @return list<array{id: int, title: string, duedate: ?string, listTitle: string}>
	 */
	public function findMatchingCards(int $boardId, array $tagTitles, string $due, \DateTimeImmutable $now): array {
		$qb = $this->db->getQueryBuilder();
		$qb->selectDistinct(['c.id', 'c.title', 'c.duedate', 's.title AS list_title'])
			->from('deck_cards', 'c')
			->innerJoin('c', 'deck_stacks', 's', $qb->expr()->eq('s.id', 'c.stack_id'))
			->where($qb->expr()->eq('s.board_id', $qb->createNamedParameter($boardId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('c.archived', $qb->createNamedParameter(false, IQueryBuilder::PARAM_BOOL)))
			->andWhere($qb->expr()->eq('c.deleted_at', $qb->createNamedParameter(0, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->isNull('c.done'))
			->andWhere($qb->expr()->eq('s.deleted_at', $qb->createNamedParameter(0, IQueryBuilder::PARAM_INT)));

		if ($tagTitles !== []) {
			$qb->innerJoin('c', 'deck_assigned_labels', 'al', $qb->expr()->eq('al.card_id', 'c.id'))
				->innerJoin('al', 'deck_labels', 'l', $qb->expr()->eq('l.id', 'al.label_id'))
				->andWhere($qb->expr()->in('l.title', $qb->createNamedParameter($tagTitles, IQueryBuilder::PARAM_STR_ARRAY)));
		}

		$this->applyDue($qb, $due, $now);

		$result = $qb->executeQuery();
		$cards = [];
		foreach ($result->fetchAll() as $row) {
			$cards[] = [
				'id' => (int)$row['id'],
				'title' => (string)$row['title'],
				'duedate' => $row['duedate'] !== null ? (string)$row['duedate'] : null,
				'listTitle' => (string)$row['list_title'],
			];
		}
		$result->closeCursor();

		return $cards;
	}

	private function applyDue(IQueryBuilder $qb, string $due, \DateTimeImmutable $now): void {
		if ($due === '') {
			return;
		}
		$nowP = $qb->createNamedParameter($now, IQueryBuilder::PARAM_DATETIME_IMMUTABLE);
		if ($due === 'noDue') {
			$qb->andWhere($qb->expr()->isNull('c.duedate'));
			return;
		}
		if ($due === 'overdue') {
			$qb->andWhere($qb->expr()->isNotNull('c.duedate'))
				->andWhere($qb->expr()->lt('c.duedate', $nowP));
			return;
		}
		$offsets = ['dueToday' => '+1 day', 'dueWeek' => '+7 days', 'dueMonth' => '+30 days'];
		if (!isset($offsets[$due])) {
			return; // unknown bucket → no date narrowing
		}
		$upper = $qb->createNamedParameter($now->modify($offsets[$due]), IQueryBuilder::PARAM_DATETIME_IMMUTABLE);
		$qb->andWhere($qb->expr()->gte('c.duedate', $nowP))
			->andWhere($qb->expr()->lte('c.duedate', $upper));
	}
}
```

Note `PARAM_STR_ARRAY` for the title `IN` list (titles are strings, may contain commas — safe as bound params).

- [ ] **Step 4: Run — watch it pass**

```bash
~/deck-test.sh tests/unit/Db/MatchingCardMapperTest.php 2>&1 | tail -15
```

Expected: OK (2 tests). If Postgres rejects `selectDistinct` with the `duedate` column while joining labels (distinct + text), it won't here — all selected columns are concrete. If a driver error appears, report it; do not switch to raw SQL.

- [ ] **Step 5: Add the service method**

In `lib/Service/BoardTagService.php`, inject `MatchingCardMapper` and `ITimeFactory` into the constructor (append to the existing param list — keep existing params in order), and add:

```php
	/**
	 * @param string[] $tagTitles
	 * @return list<array{id: int, title: string, duedate: ?string, listTitle: string}>
	 */
	public function matchingCards(int $boardId, array $tagTitles, string $due): array {
		$this->permissionService->checkPermission($this->boardMapper, $boardId, Acl::PERMISSION_READ);
		$now = \DateTimeImmutable::createFromMutable($this->timeFactory->getDateTime());
		return $this->matchingCardMapper->findMatchingCards($boardId, $tagTitles, $due, $now);
	}
```

Add `use OCP\AppFramework\Utility\ITimeFactory;` and the constructor property `private MatchingCardMapper $matchingCardMapper, private ITimeFactory $timeFactory`.

- [ ] **Step 6: Add the controller method + route**

In `lib/Controller/BoardTagController.php`:

```php
	/**
	 * @param string[] $tags
	 */
	#[NoAdminRequired]
	public function matchingCards(int $boardId, array $tags = [], string $due = ''): array {
		return $this->boardTagService->matchingCards($boardId, $tags, $due);
	}
```

In `appinfo/routes.php`, beside the other `board_tag#` routes:

```php
		['name' => 'board_tag#matchingCards', 'url' => '/boards/{boardId}/matching-cards', 'verb' => 'GET'],
```

- [ ] **Step 7: Controller test**

In `tests/unit/Controller/BoardTagControllerTest.php`, mock `BoardTagService::matchingCards` and assert delegation with args, mirroring the existing `update`/`read` tests:

```php
	public function testMatchingCardsDelegates(): void {
		$expected = [['id' => 5, 'title' => 'Soon', 'duedate' => null, 'listTitle' => 'A Fazer']];
		$this->tagService->expects($this->once())
			->method('matchingCards')->with(7, ['Cliente X'], 'dueWeek')->willReturn($expected);

		$this->assertSame($expected, $this->controller->matchingCards(7, ['Cliente X'], 'dueWeek'));
	}
```

- [ ] **Step 8: Run controller + service tests + full suite**

```bash
~/deck-test.sh tests/unit/Controller/BoardTagControllerTest.php 2>&1 | tail -8
~/deck-test.sh tests/unit/Service/BoardTagServiceTest.php 2>&1 | tail -8
~/deck-test.sh 2>&1 | tail -4
```

Expected: all green; full suite no new failures.

Note: adding constructor params to `BoardTagService` may require updating its unit test's `setUp` to pass the two new mocks (`MatchingCardMapper`, `ITimeFactory`). Update it if the test constructs the service directly.

- [ ] **Step 9: Commit**

```bash
cd ~/work/avuz/deck-fork && git add lib/ appinfo/routes.php tests/ && git commit -m "feat(tags): matching-cards endpoint for the glimpse"
```

---

### Task 3: Frontend — colored chips + one-row filter bar

**Files:**
- Modify: `src/components/boards/BoardItem.vue`
- Modify: `src/components/boards/BoardFilterBar.vue`

**Interfaces:**
- Consumes: `directTags` now `{title,color}[]` (Task 1).

- [ ] **Step 1: Color the tile chips**

`directTags` are now objects. In `BoardItem.vue`:
- Import the color mixin: `import Color from '../../mixins/color.js'` and add `mixins: [Color]` (gives `textColor(hex)`).
- Update the computed `directTags`/`visibleTags`/`hiddenTags` to work on objects. `visibleTags` = first 3 objects; `hiddenTags` = rest; `hiddenTagCount` unchanged.
- Template: render each chip with the label color:

```vue
			<span v-for="tag in visibleTags"
				:key="tag.title"
				class="board-tag-chip"
				:style="{ backgroundColor: `#${tag.color}`, color: textColor(tag.color) }">
				{{ tag.title }}
			</span>
```

- The `+N` overflow's `:title`/`:aria-label` must join titles now: `hiddenTags.map(t => t.title).join(', ')`.
- Remove the flat `background-color: var(--color-background-dark)` from `.board-tag-chip` (the inline style provides it); keep the overflow chip's neutral background (it's a count, not a tag).

- [ ] **Step 2: One-row filter bar**

In `BoardFilterBar.vue`'s style, cap the tag select so it doesn't hog the row:

```scss
		&__tags {
			flex: 0 1 320px;
			min-width: 200px;
			max-width: 360px;
		}
```

Keep the outer `.board-filter-bar { flex-wrap: wrap }` so it still stacks on narrow viewports. Verify the row order in the template is: tags, due chips, clear, count (count already `margin-inline-start: auto`).

- [ ] **Step 3: Build + lint + stylelint**

```bash
cd ~/work/avuz/deck-fork && npm run build 2>&1 | tail -5 && npm run lint 2>&1 | tail -8 && npm run stylelint 2>&1 | tail -8
```

Expected: build passes, lint/stylelint clean for the two files. A `directTags` shape mismatch (still treating as strings) surfaces as a runtime bug, not a build error — re-read the diff and confirm every `directTags` use handles objects.

- [ ] **Step 4: Commit**

```bash
cd ~/work/avuz/deck-fork && git add src/components/boards/ && git commit -m "feat(tags): color tile chips with label color; one-row filter bar"
```

---

### Task 4: Frontend — expandable glimpse

**Files:**
- Modify: `src/services/BoardTagApi.js`, `src/store/main.js`
- Modify: `src/components/boards/BoardItem.vue`

**Interfaces:**
- Consumes: the matching-cards endpoint (Task 2), `boardTagFilter`/`boardDueFilter` store state, `hasActiveFilter`-style logic.

- [ ] **Step 1: API client method**

In `src/services/BoardTagApi.js`, add:

```js
	async loadMatchingCards(boardId, tags, due) {
		const params = new URLSearchParams()
		tags.forEach((t) => params.append('tag', t))
		if (due) {
			params.append('due', due)
		}
		const response = await axios.get(this.url(`/boards/${boardId}/matching-cards?${params}`))
		return response.data
	}
```

- [ ] **Step 2: Store state + action**

In `src/store/main.js`:
- state: `matchingCards: {}` (keyed by board id).
- mutation `setMatchingCards(state, { boardId, cards })` → `Vue.set(state.matchingCards, boardId, cards)`.
- mutation `clearMatchingCards(state)` → `state.matchingCards = {}` (called when filters change so stale expansions refetch).
- action:

```js
			async loadMatchingCards({ commit, state }, boardId) {
				const cards = await boardTagApi.loadMatchingCards(boardId, state.boardTagFilter, state.boardDueFilter)
				commit('setMatchingCards', { boardId, cards })
			},
```
- In the existing `setBoardTagFilter`/`setBoardDueFilter` mutations, also reset `state.matchingCards = {}` so an open expansion refetches against the new filter (prevents showing stale cards from a prior filter).

- [ ] **Step 3: BoardItem expand UI**

In `BoardItem.vue`:
- Add data `expanded: false`.
- Computed `hasActiveFilter` (read `this.$store.state.boardTagFilter.length > 0 || this.$store.state.boardDueFilter !== ''`).
- Computed `matchingCards` → `this.$store.state.matchingCards[this.board.id]` (may be undefined until fetched).
- A disclosure button, shown only when `hasActiveFilter`, that does NOT trigger the row's board-navigation (stop propagation). Chevron rotates on `expanded`:

```vue
		<NcButton v-if="hasActiveFilter"
			type="tertiary"
			:aria-label="t('deck', 'Mostrar cartões correspondentes')"
			:aria-expanded="expanded ? 'true' : 'false'"
			@click.stop.prevent="toggleExpand">
			<template #icon>
				<ChevronDownIcon v-if="!expanded" :size="20" />
				<ChevronUpIcon v-else :size="20" />
			</template>
		</NcButton>
```

Icon imports (confirmed path pattern — `vue-material-design-icons/<Name>.vue`, as `CommentItem.vue:85` etc.):

```js
import ChevronDownIcon from 'vue-material-design-icons/ChevronDown.vue'
import ChevronUpIcon from 'vue-material-design-icons/ChevronUp.vue'
import { NcButton } from '@nextcloud/vue'
```
- Method:

```js
		async toggleExpand() {
			this.expanded = !this.expanded
			if (this.expanded && this.matchingCards === undefined) {
				await this.$store.dispatch('loadMatchingCards', this.board.id)
			}
		},
```
- Below the row, when `expanded`, render the matching cards (or a note). Since `BoardItem` is one `.board-list-row`, put the expansion as a sibling block within the component root (wrap the row + expansion in a fragment/div):

```vue
		<div v-if="expanded" class="board-matching-cards">
			<ul v-if="matchingCards && matchingCards.length">
				<li v-for="card in matchingCards" :key="card.id">
					<span class="card-title">{{ card.title }}</span>
					<span class="card-list">{{ card.listTitle }}</span>
					<span v-if="card.duedate" class="card-due">{{ formatDue(card.duedate) }}</span>
				</li>
			</ul>
			<p v-else-if="matchingCards" class="board-matching-cards__empty">
				{{ t('deck', 'Marcado diretamente no quadro') }}
			</p>
			<p v-else class="board-matching-cards__loading">{{ t('deck', 'Carregando…') }}</p>
		</div>
```
- `formatDue(iso)`: use `@nextcloud/moment` (the codebase's date lib, e.g. `src/mixins/relativeDate.js`):

```js
import moment from '@nextcloud/moment'
// ...
		formatDue(iso) {
			return moment(iso).format('L')   // locale-aware short date, pt_BR-aware
		},
```

- [ ] **Step 4: Build + lint + stylelint**

```bash
cd ~/work/avuz/deck-fork && npm run build 2>&1 | tail -5 && npm run lint 2>&1 | tail -8 && npm run stylelint 2>&1 | tail -8
```

Expected: clean. Confirm `@click.stop.prevent` on the chevron so expanding does NOT navigate into the board.

- [ ] **Step 5: Commit**

```bash
cd ~/work/avuz/deck-fork && git add src/ && git commit -m "feat(tags): expandable glimpse of cards matching the active filters"
```

---

## Verification (controller-run, after all tasks)

Rebuild the fork bundle, re-overlay onto the local `deck-test-nc` instance (the harness from the main feature), and browser-verify:
1. Tile chips now show label colors (Cliente X / Urgente in their label colors, readable text).
2. Filter bar sits on one row at desktop width; wraps on narrow.
3. With a due or tag filter active, each matching board row shows a chevron; clicking it expands to the matching cards (title, list, due), respecting tag AND date together; a pure direct-tag board shows the "Marcado diretamente no quadro" note; the chevron click does not open the board.

Then the controller ships: rebuild bundle + `git add -f js/`, commit, push the fork, and bump the server submodule pointer.

## Rebase note
These changes touch `BoardSummaryMapper`, `BoardSummaryService`, `BoardTagService`, `BoardTagController`, `routes.php`, `BoardItem.vue`, `BoardFilterBar.vue`, `store/main.js`, `BoardTagApi.js` — all already Avuz-owned files from the base feature, so a future upstream rebase conflicts only where it already did.
