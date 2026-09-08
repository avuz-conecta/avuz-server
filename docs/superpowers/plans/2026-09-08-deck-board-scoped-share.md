# Board-scoped share (limit a recipient to their own cards) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-share "only assigned cards" flag so a board recipient can be limited to the cards assigned to them (directly or via a group), enforced as a real access boundary across every Deck card-read path.

**Architecture:** One ACL column (`cards_only_assigned`) drives a resolver in `PermissionService` (`isLimitedToAssignedCards`). A single predicate source — the user's assigned-participant pairs `[{participant,type}]` (self as USER + each group as GROUP) — powers both the in-memory filter on already-enriched card lists (board, archived, dashboard) and the SQL filter on `MatchingCardMapper` (All-Boards), plus a per-card check in `checkPermission` (covers single card, comments, attachments). Create auto-assigns the creator when limited.

**Tech Stack:** Nextcloud Deck fork (PHP 8, AppFramework, QBMapper, PHPUnit) at `apps/deck`; Vue 2.7 + Vuex + @nextcloud/vue frontend (jest). Build workspace: `/Users/patrickrezende/work/avuz/deck-fork`. Ship via `scripts/deploy-deck.sh`.

## Global Constraints

- Deck fork lives at the `apps/deck` submodule; ALL code + test work happens in the checkout `/Users/patrickrezende/work/avuz/deck-fork` (branch `avuz`), then commit/push there and bump the submodule.
- Backend PHPUnit tests require the Nextcloud test bootstrap (`tests/bootstrap.php` → `../../../tests/bootstrap.php`); they run inside a NC checkout / CI, NOT standalone. Locally gate PHP with `php -l`. Write the tests regardless (TDD); run them where a NC bootstrap exists.
- Frontend jest runs locally: `./node_modules/.bin/jest <path>`.
- Default of the new column is `false` (0) ⇒ every existing share keeps full visibility; no data backfill.
- `cards_only_assigned` is the exact column name; `cardsOnlyAssigned` the entity/JSON property; `isLimitedToAssignedCards` the resolver. Do not rename across tasks.
- "Assigned to the user" = an `oc_deck_assigned_users` row with `(participant=userId, type=0/USER)` OR `(participant ∈ userGroups, type=1/GROUP)`. Circles are NOT card assignees.
- Owner and any user with `PERMISSION_MANAGE` are never limited. Most-permissive wins: limited only if EVERY read-granting path is a `cards_only_assigned` board ACL and there is no full grant (owner/manage/full-ACL/folder-inherited).
- Ship with a version bump in `appinfo/info.xml` (moves NC's `?v=` asset hash).
- Out of scope (phase 2, do not build): full-text search, CalDAV feed, activity stream filtering.

---

## File structure

Backend (`apps/deck/`):
- `lib/Migration/Version11806Date20260908120000.php` — add `cards_only_assigned` to `deck_board_acl`.
- `lib/Db/Acl.php` — field, type, JSON, `@method`.
- `lib/Service/PermissionService.php` — `isLimitedToAssignedCards`, `assignedParticipantPairsForUser`, `cardIsAssignedToUser`, gate in `checkPermission`; inject `AssignmentMapper`.
- `lib/Service/CardService.php` — `filterCardsForUser` reuse point; auto-assign on `create`; inject `AssignmentService`.
- `lib/Service/StackService.php` — filter in `findAll` + `findAllArchived` when limited.
- `lib/Service/OverviewService.php` — limited-aware `findUpcomingCards`.
- `lib/Service/BoardSummaryService.php` — pass viewer pairs to `MatchingCardMapper` when limited.
- `lib/Service/BoardService.php` + `lib/Controller/BoardController.php` + `lib/Validators/BoardServiceValidator.php` — accept/validate/persist the flag + clear-on-manage.

Frontend (`apps/deck/src/`):
- `components/board/SharingTabSidebar.vue` — per-participant toggle.
- `store/board.js` (or wherever `updateAclFromCurrentBoard`/ACL actions live) — carry `cardsOnlyAssigned`.
- l10n: deck fork `l10n/*.js|json` (source strings) + `themes/avuz/apps/deck/l10n/pt_BR.json`.

---

## Task 1: DB column + Acl entity

**Files:**
- Create: `apps/deck/lib/Migration/Version11806Date20260908120000.php`
- Modify: `apps/deck/lib/Db/Acl.php`
- Test: `apps/deck/tests/unit/Db/AclTest.php` (create if absent)

**Interfaces:**
- Produces: `Acl::isCardsOnlyAssigned(): bool`, `Acl::setCardsOnlyAssigned(bool)`; column `deck_board_acl.cards_only_assigned` (bool, default 0).

- [ ] **Step 1: Write the migration**

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

class Version11806Date20260908120000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$table = $schema->getTable('deck_board_acl');
		if (!$table->hasColumn('cards_only_assigned')) {
			$table->addColumn('cards_only_assigned', Types::BOOLEAN, [
				'default' => false,
				'notnull' => false,
			]);
			return $schema;
		}
		return null;
	}
}
```

- [ ] **Step 2: Add the field to the Acl entity**

In `apps/deck/lib/Db/Acl.php`, add to the `@method` block:
```php
 * @method bool isCardsOnlyAssigned()
 * @method void setCardsOnlyAssigned(bool $cardsOnlyAssigned)
```
Add the property beside the other `permission*` props:
```php
	protected $cardsOnlyAssigned = false;
```
Add to the constructor beside the other boolean `addType` calls:
```php
		$this->addType('cardsOnlyAssigned', 'boolean');
```

- [ ] **Step 3: Write the entity test**

```php
<?php
// apps/deck/tests/unit/Db/AclTest.php
namespace OCA\Deck\Db;

use Test\TestCase;

class AclTest extends TestCase {
	public function testCardsOnlyAssignedDefaultsFalse(): void {
		$acl = new Acl();
		self::assertFalse($acl->isCardsOnlyAssigned());
	}

	public function testCardsOnlyAssignedIsSettableAndSerialized(): void {
		$acl = new Acl();
		$acl->setCardsOnlyAssigned(true);
		self::assertTrue($acl->isCardsOnlyAssigned());
		self::assertArrayHasKey('cardsOnlyAssigned', $acl->jsonSerialize());
		self::assertTrue($acl->jsonSerialize()['cardsOnlyAssigned']);
	}
}
```

- [ ] **Step 4: Lint + run**

```bash
cd /Users/patrickrezende/work/avuz/deck-fork
php -l lib/Migration/Version11806Date20260908120000.php && php -l lib/Db/Acl.php
vendor/bin/phpunit --filter AclTest tests/unit/Db/AclTest.php   # runs where NC bootstrap exists
```
Expected: lint clean; test PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/Migration/Version11806Date20260908120000.php lib/Db/Acl.php tests/unit/Db/AclTest.php
git commit -m "feat(acl): add cards_only_assigned column + entity field"
```

---

## Task 2: PermissionService — limited-state resolver + participant pairs

**Files:**
- Modify: `apps/deck/lib/Service/PermissionService.php`
- Test: `apps/deck/tests/unit/Service/PermissionServiceTest.php`

**Interfaces:**
- Consumes: `Acl::isCardsOnlyAssigned()` (Task 1); `getPermissions`, `userIsBoardOwner`, `aclMapper->findAll`, `groupManager`, `circlesService` (existing).
- Produces:
  - `isLimitedToAssignedCards(int $boardId, ?string $userId = null): bool`
  - `assignedParticipantPairsForUser(?string $userId = null): array` → `list<array{participant:string,type:int}>` (self as `Acl::PERMISSION_TYPE_USER`, each group as `Acl::PERMISSION_TYPE_GROUP`).

- [ ] **Step 1: Write the failing tests**

Add to `apps/deck/tests/unit/Service/PermissionServiceTest.php` (mirror the existing setup: mocked `AclMapper`, `BoardMapper`, `IGroupManager`, `CirclesService`, `userId`).

```php
public function testOwnerIsNeverLimited(): void {
	$this->boardMapper->method('find')->willReturn($this->boardWithOwner('admin'));
	// admin owns board 1
	self::assertFalse($this->service->isLimitedToAssignedCards(1, 'admin'));
}

public function testSingleRestrictedUserAclIsLimited(): void {
	$acl = $this->userAcl('bob', cardsOnlyAssigned: true);
	$this->aclMapper->method('findAll')->willReturn([$acl]);
	$this->boardMapper->method('find')->willReturn($this->boardWithOwner('alice'));
	self::assertTrue($this->service->isLimitedToAssignedCards(1, 'bob'));
}

public function testFullGroupGrantBeatsRestrictedDirect(): void {
	$direct = $this->userAcl('bob', cardsOnlyAssigned: true);
	$group = $this->groupAcl('sales', cardsOnlyAssigned: false);
	$this->aclMapper->method('findAll')->willReturn([$direct, $group]);
	$this->groupManager->method('isInGroup')->with('bob', 'sales')->willReturn(true);
	$this->boardMapper->method('find')->willReturn($this->boardWithOwner('alice'));
	self::assertFalse($this->service->isLimitedToAssignedCards(1, 'bob'));
}

public function testManagerIsNeverLimited(): void {
	$acl = $this->userAcl('bob', cardsOnlyAssigned: true);
	$acl->setPermissionManage(true);
	$this->aclMapper->method('findAll')->willReturn([$acl]);
	$this->boardMapper->method('find')->willReturn($this->boardWithOwner('alice'));
	self::assertFalse($this->service->isLimitedToAssignedCards(1, 'bob'));
}

public function testParticipantPairsAreSelfPlusGroups(): void {
	$this->groupManager->method('getUserGroupIds')->willReturn(['sales', 'ops']);
	self::assertEquals([
		['participant' => 'bob', 'type' => Acl::PERMISSION_TYPE_USER],
		['participant' => 'sales', 'type' => Acl::PERMISSION_TYPE_GROUP],
		['participant' => 'ops', 'type' => Acl::PERMISSION_TYPE_GROUP],
	], $this->service->assignedParticipantPairsForUser('bob'));
}
```
Add the small builders `boardWithOwner`, `userAcl`, `groupAcl` if not present (an `Acl` with type/participant/`setCardsOnlyAssigned`).

- [ ] **Step 2: Run to verify they fail**

```bash
vendor/bin/phpunit --filter 'isLimited|ParticipantPairs|Manager|GroupGrant' tests/unit/Service/PermissionServiceTest.php
```
Expected: FAIL (methods not defined).

- [ ] **Step 3: Implement the resolver + pairs (memoized)**

Add fields near the other caches:
```php
	/** @var array<string, bool> */
	private array $limitedCache = [];
	/** @var array<string, list<array{participant:string,type:int}>> */
	private array $participantPairsCache = [];
```

Add methods:
```php
	/**
	 * True when every read-granting path this user has on the board is a
	 * cards_only_assigned board ACL (no owner / manage / full ACL / folder grant).
	 * Owners and managers are never limited (most-permissive wins).
	 */
	public function isLimitedToAssignedCards(int $boardId, ?string $userId = null): bool {
		$userId ??= $this->userId;
		if ($userId === null) {
			return false;
		}
		$key = $boardId . '-' . $userId;
		if (isset($this->limitedCache[$key])) {
			return $this->limitedCache[$key];
		}

		$permissions = $this->getPermissions($boardId, $userId);
		if (!$permissions[Acl::PERMISSION_READ] || $permissions[Acl::PERMISSION_MANAGE]) {
			return $this->limitedCache[$key] = false;
		}
		if ($this->userIsBoardOwner($boardId, $userId)) {
			return $this->limitedCache[$key] = false;
		}

		try {
			$acls = $this->aclMapper->findAll($boardId);
		} catch (\Exception $e) {
			return $this->limitedCache[$key] = false;
		}

		$matched = array_filter($acls, fn (Acl $acl) => $this->aclMatchesUser($acl, $userId));
		if ($matched === []) {
			// Read comes from a folder grant (or nothing): not a board-ACL limit.
			return $this->limitedCache[$key] = false;
		}
		foreach ($matched as $acl) {
			if (!$acl->isCardsOnlyAssigned()) {
				return $this->limitedCache[$key] = false;
			}
		}
		return $this->limitedCache[$key] = true;
	}

	private function aclMatchesUser(Acl $acl, string $userId): bool {
		if ($acl->getType() === Acl::PERMISSION_TYPE_USER) {
			return $acl->getParticipant() === $userId;
		}
		if ($acl->getType() === Acl::PERMISSION_TYPE_GROUP) {
			return $this->groupManager->isInGroup($userId, $acl->getParticipant());
		}
		if ($acl->getType() === Acl::PERMISSION_TYPE_CIRCLE && $this->circlesService->isCirclesEnabled()) {
			try {
				return $this->circlesService->isUserInCircle($acl->getParticipant(), $userId);
			} catch (\Exception $e) {
				return false;
			}
		}
		return false;
	}

	/**
	 * The assignment participant pairs that count as "this user": the user as a
	 * USER assignee plus each of their groups as a GROUP assignee. Single source
	 * of the assignment predicate used by every read path.
	 *
	 * @return list<array{participant:string,type:int}>
	 */
	public function assignedParticipantPairsForUser(?string $userId = null): array {
		$userId ??= $this->userId;
		if ($userId === null) {
			return [];
		}
		if (isset($this->participantPairsCache[$userId])) {
			return $this->participantPairsCache[$userId];
		}
		$pairs = [['participant' => $userId, 'type' => Acl::PERMISSION_TYPE_USER]];
		foreach ($this->groupManager->getUserGroupIds($this->userManager->get($userId)) as $groupId) {
			$pairs[] = ['participant' => $groupId, 'type' => Acl::PERMISSION_TYPE_GROUP];
		}
		return $this->participantPairsCache[$userId] = $pairs;
	}
```

Note: `getUserGroupIds` takes an `IUser`; guard `userManager->get($userId)` against null (return only the self pair if the user object is missing).

- [ ] **Step 4: Run to verify pass**

```bash
vendor/bin/phpunit --filter 'isLimited|ParticipantPairs|Manager|GroupGrant' tests/unit/Service/PermissionServiceTest.php
```
Expected: PASS. Then `php -l lib/Service/PermissionService.php`.

- [ ] **Step 5: Commit**

```bash
git add lib/Service/PermissionService.php tests/unit/Service/PermissionServiceTest.php
git commit -m "feat(permission): resolve cards-only-assigned limit + participant pairs"
```

---

## Task 3: Assignment-match helper + single-card gate

**Files:**
- Modify: `apps/deck/lib/Service/PermissionService.php` (gate + inject `AssignmentMapper`)
- Modify: `apps/deck/lib/Db/AssignmentMapper.php` (only if a `findIn` for one card is missing — it already has `findIn(array $cardIds)`)
- Test: `apps/deck/tests/unit/Service/PermissionServiceTest.php`

**Interfaces:**
- Consumes: `isLimitedToAssignedCards`, `assignedParticipantPairsForUser` (Task 2); `AssignmentMapper::findIn(int[] $cardIds): Assignment[]` (existing); `Assignment::getParticipant()/getType()`.
- Produces: `cardIsAssignedToUser(int $cardId, string $userId): bool`; a 403 from `checkPermission` when a limited user reads a non-own card.

- [ ] **Step 1: Write the failing tests**

```php
public function testLimitedUserDeniedOnUnassignedCard(): void {
	// board 1, bob limited; card 5 assigned to alice only
	$this->makeBobLimitedOnBoard1();                       // helper sets acls + owner
	$this->assignmentMapper->method('findIn')->with([5])
		->willReturn([$this->assignment('alice', Acl::PERMISSION_TYPE_USER)]);
	$cardMapper = $this->cardMapperReturningBoard(5, 1);   // findBoardId(5)=1, find(5)=card not deleted
	$this->expectException(NoPermissionException::class);
	$this->service->checkPermission($cardMapper, 5, Acl::PERMISSION_READ, 'bob');
}

public function testLimitedUserAllowedOnOwnCard(): void {
	$this->makeBobLimitedOnBoard1();
	$this->assignmentMapper->method('findIn')->with([5])
		->willReturn([$this->assignment('bob', Acl::PERMISSION_TYPE_USER)]);
	$cardMapper = $this->cardMapperReturningBoard(5, 1);
	self::assertTrue($this->service->checkPermission($cardMapper, 5, Acl::PERMISSION_READ, 'bob'));
}

public function testLimitedUserAllowedViaGroupAssignment(): void {
	$this->makeBobLimitedOnBoard1();                       // bob ∈ 'sales'
	$this->assignmentMapper->method('findIn')->with([5])
		->willReturn([$this->assignment('sales', Acl::PERMISSION_TYPE_GROUP)]);
	$cardMapper = $this->cardMapperReturningBoard(5, 1);
	self::assertTrue($this->service->checkPermission($cardMapper, 5, Acl::PERMISSION_READ, 'bob'));
}

public function testFullReaderUnaffectedByAssignment(): void {
	$this->makeBobFullReaderOnBoard1();
	$cardMapper = $this->cardMapperReturningBoard(5, 1);
	self::assertTrue($this->service->checkPermission($cardMapper, 5, Acl::PERMISSION_READ, 'bob'));
	// assignmentMapper->findIn must NOT be needed for a full reader
}
```

- [ ] **Step 2: Run to verify they fail**

```bash
vendor/bin/phpunit --filter 'LimitedUser|FullReader' tests/unit/Service/PermissionServiceTest.php
```
Expected: FAIL.

- [ ] **Step 3: Inject `AssignmentMapper` and add the helper + gate**

Constructor: add `private AssignmentMapper $assignmentMapper,` (import `use OCA\Deck\Db\AssignmentMapper;` and `use OCA\Deck\Db\Assignment;`). Update the DI test/app wiring if it lists constructor args explicitly (it is autowired via the container, so usually nothing else to change).

Add helper:
```php
	public function cardIsAssignedToUser(int $cardId, string $userId): bool {
		$pairs = $this->assignedParticipantPairsForUser($userId);
		foreach ($this->assignmentMapper->findIn([$cardId]) as $assignment) {
			foreach ($pairs as $pair) {
				if ($assignment->getParticipant() === $pair['participant']
					&& (int)$assignment->getType() === $pair['type']) {
					return true;
				}
			}
		}
		return false;
	}
```

In `checkPermission`, inside the `if ($permissions[$permission] === true)` block, AFTER the existing deleted-card check and BEFORE `return true;`, add:
```php
			if ($mapper instanceof CardMapper
				&& $permission === Acl::PERMISSION_READ
				&& $this->isLimitedToAssignedCards($boardId, $userId)
				&& !$this->cardIsAssignedToUser((int)$id, $userId ?? (string)$this->userId)) {
				throw new NoPermissionException('Permission denied');
			}
```
(`$userId` here is the argument already resolved by `getPermissions`; when null it means the session user — pass `$this->userId` to the helper in that case, as shown.)

- [ ] **Step 4: Run to verify pass**

```bash
vendor/bin/phpunit --filter 'LimitedUser|FullReader' tests/unit/Service/PermissionServiceTest.php
php -l lib/Service/PermissionService.php
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/Service/PermissionService.php tests/unit/Service/PermissionServiceTest.php
git commit -m "feat(permission): 403 a limited user on cards not assigned to them"
```

---

## Task 4: Filter the board view + archived view

**Files:**
- Modify: `apps/deck/lib/Service/CardService.php` (add `filterCardsForBoardViewer`)
- Modify: `apps/deck/lib/Service/StackService.php` (`findAll`, `findAllArchived`)
- Test: `apps/deck/tests/unit/Service/StackServiceTest.php`

**Interfaces:**
- Consumes: `PermissionService::isLimitedToAssignedCards`, `assignedParticipantPairsForUser` (Task 2); `Card::getAssignedUsers(): Assignment[]` (set by `enrichCards`).
- Produces: `CardService::filterCardsForBoardViewer(int $boardId, array $cards): array` — returns only cards the current user may see (identity for full readers).

- [ ] **Step 1: Write the failing test**

```php
// StackServiceTest: board 1, bob limited; stack has cards A(assigned bob) B(assigned alice)
public function testFindAllHidesOthersCardsFromLimitedUser(): void {
	$this->permissionService->method('isLimitedToAssignedCards')->with(1, null)->willReturn(true);
	$this->permissionService->method('assignedParticipantPairsForUser')
		->willReturn([['participant' => 'bob', 'type' => 0]]);
	// enrichCards returns A (assignee bob) and B (assignee alice)
	$this->stubEnrichedStack([$this->cardAssigned('A', 'bob', 0), $this->cardAssigned('B', 'alice', 0)]);

	$stacks = $this->service->findAll(1);

	$titles = array_map(fn ($c) => $c->getTitle(), $stacks[0]->getCards());
	self::assertEquals(['A'], $titles);
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
vendor/bin/phpunit --filter FindAllHidesOthers tests/unit/Service/StackServiceTest.php
```
Expected: FAIL (B still present).

- [ ] **Step 3: Add the filter helper + apply it**

In `CardService`:
```php
	/**
	 * When the current user is limited to their assigned cards on this board,
	 * drop every enriched card not assigned to them (directly or via a group).
	 * Identity for full readers. Cards must already be enriched (assignedUsers set).
	 *
	 * @param Card[] $cards
	 * @return Card[]
	 */
	public function filterCardsForBoardViewer(int $boardId, array $cards): array {
		if (!$this->permissionService->isLimitedToAssignedCards($boardId)) {
			return $cards;
		}
		$pairs = $this->permissionService->assignedParticipantPairsForUser();
		return array_values(array_filter($cards, function (Card $card) use ($pairs) {
			foreach ($card->getAssignedUsers() ?? [] as $assignment) {
				foreach ($pairs as $pair) {
					if ($assignment->getParticipant() === $pair['participant']
						&& (int)$assignment->getType() === $pair['type']) {
						return true;
					}
				}
			}
			return false;
		}));
	}
```
(Confirm `CardService` already has `permissionService` injected; it does — used in `create`.)

In `StackService::enrichStacksWithCards`, wrap the enriched cards through the filter. Change:
```php
					$stack->setCards($this->cardService->enrichCards($cards));
```
to:
```php
					$enriched = $this->cardService->enrichCards($cards);
					$stack->setCards($this->cardService->filterCardsForBoardViewer($stack->getBoardId(), $enriched));
```

In `StackService::findAllArchived`, after the per-stack `$cards = $this->cardMapper->findAllArchived($stack->id);` and its label/attachment enrichment, filter:
```php
			$cards = $this->cardService->filterCardsForBoardViewer($boardId, $this->cardService->enrichCards($cards));
```
(Archived cards must also be enriched with assignments before filtering — add `enrichCards` here if the archived path did not already call it. Keep the label/attachment enrichment that follows.)

- [ ] **Step 4: Run to verify pass**

```bash
vendor/bin/phpunit --filter 'FindAllHidesOthers|Archived' tests/unit/Service/StackServiceTest.php
php -l lib/Service/CardService.php lib/Service/StackService.php
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/Service/CardService.php lib/Service/StackService.php tests/unit/Service/StackServiceTest.php
git commit -m "feat(stack): limit board + archived views to a limited user's own cards"
```

---

## Task 5: Dashboard "upcoming" respects the limit

**Files:**
- Modify: `apps/deck/lib/Service/OverviewService.php`
- Test: `apps/deck/tests/unit/Service/OverviewServiceTest.php`

**Interfaces:**
- Consumes: `CardService::filterCardsForBoardViewer` (Task 4); `PermissionService::isLimitedToAssignedCards`.
- Produces: no leak of others'/unassigned cards of a limited board in `findUpcomingCards`.

- [ ] **Step 1: Write the failing test**

`findUpcomingCards` today merges `findToMeOrNotAssignedCards` (which includes unassigned) for shared boards. Test: bob limited on shared board 1; an unassigned due card on board 1 must NOT appear; bob's own due card must appear.

```php
public function testUpcomingHidesUnassignedOfLimitedBoard(): void {
	$this->boardMapper->method('findAllForUser')->willReturn([$this->sharedBoard(1)]);
	$this->cardMapper->method('findToMeOrNotAssignedCards')
		->willReturn([$this->dueCard('mine', 1, assignee: 'bob'), $this->dueCard('floating', 1, assignee: null)]);
	$this->permissionService->method('isLimitedToAssignedCards')->with(1)->willReturn(true);
	$this->permissionService->method('assignedParticipantPairsForUser')->willReturn([['participant' => 'bob','type' => 0]]);

	$overview = $this->service->findUpcomingCards('bob');

	$titles = $this->flattenTitles($overview);
	self::assertContains('mine', $titles);
	self::assertNotContains('floating', $titles);
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
vendor/bin/phpunit --filter UpcomingHidesUnassigned tests/unit/Service/OverviewServiceTest.php
```
Expected: FAIL (`floating` present).

- [ ] **Step 3: Filter the merged cards through the board-viewer filter**

Inject `PermissionService $permissionService` and reuse `CardService::filterCardsForBoardViewer`. After building `$foundCards` and BEFORE `enrichCards`, group by board and filter each limited board's cards. Simplest correct form: enrich first (so assignments are present), then filter per board:

```php
		$this->cardService->enrichCards($foundCards);

		$byBoard = [];
		foreach ($foundCards as $card) {
			$byBoard[$card->getRelatedBoard()->getId()][] = $card;
		}
		$foundCards = [];
		foreach ($byBoard as $boardId => $cards) {
			foreach ($this->cardService->filterCardsForBoardViewer((int)$boardId, $cards) as $card) {
				$foundCards[] = $card;
			}
		}
```
Then the existing overview-bucketing loop runs over the filtered `$foundCards`. Remove the now-redundant second `enrichCards` (cards are already enriched).

Note: `filterCardsForBoardViewer` is identity for non-limited boards, so owned/full boards are untouched.

- [ ] **Step 4: Run to verify pass**

```bash
vendor/bin/phpunit --filter UpcomingHidesUnassigned tests/unit/Service/OverviewServiceTest.php
php -l lib/Service/OverviewService.php
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/Service/OverviewService.php tests/unit/Service/OverviewServiceTest.php
git commit -m "feat(overview): dashboard upcoming hides non-own cards of a limited board"
```

---

## Task 6: All-Boards view respects the limit

**Files:**
- Modify: `apps/deck/lib/Service/BoardSummaryService.php`
- Test: `apps/deck/tests/unit/Service/BoardSummaryServiceTest.php`

**Interfaces:**
- Consumes: `PermissionService::isLimitedToAssignedCards`, `assignedParticipantPairsForUser`; `MatchingCardMapper::findMatchingCards(boardId, tagTitles, due, now, assignedParticipants)` (existing — takes `array{participant,type}[]`).
- Produces: the All-Boards matcher, for any board where the viewer is limited, intersects the match with the viewer's own participant pairs.

- [ ] **Step 1: Write the failing test**

```php
public function testAllBoardsLimitsMatchToViewerPairs(): void {
	$this->permissionService->method('isLimitedToAssignedCards')->with(1)->willReturn(true);
	$this->permissionService->method('assignedParticipantPairsForUser')
		->willReturn([['participant' => 'bob', 'type' => 0]]);
	$this->matchingCardMapper->expects(self::once())->method('findMatchingCards')
		->with(1, self::anything(), self::anything(), self::anything(),
			[['participant' => 'bob', 'type' => 0]])
		->willReturn([]);
	$this->service->/* the method that builds a board's matching cards */(/* board 1, no user filter */);
}
```
Adapt the call to whichever `BoardSummaryService` method invokes `findMatchingCards` (it already passes `$assignedParticipants` when the overview user-filter is active).

- [ ] **Step 2: Run to verify it fails**

```bash
vendor/bin/phpunit --filter AllBoardsLimitsMatch tests/unit/Service/BoardSummaryServiceTest.php
```
Expected: FAIL (pairs not applied when no user filter is set).

- [ ] **Step 3: Apply viewer pairs when limited**

Where `BoardSummaryService` computes `$assignedParticipants` before calling `findMatchingCards`, when `isLimitedToAssignedCards($boardId)` is true, set/intersect that list with `assignedParticipantPairsForUser()`:
- If no user filter is active → `$assignedParticipants = $this->permissionService->assignedParticipantPairsForUser();`
- If a user filter IS active → intersect: keep only pairs that are also in the viewer's own pairs (a limited user filtering by someone else must see nothing of that other person). Practically: if the filtered participant is not among the viewer's pairs, the result for that board is empty.

Guard: `filterParticipant` case — a limited viewer may only ever match their own pairs. Implement as: `$assignedParticipants = $limited ? $this->intersectWithSelf($requested) : $requested;` where `intersectWithSelf` returns the viewer's pairs when `$requested` is empty, else the intersection.

- [ ] **Step 4: Run to verify pass**

```bash
vendor/bin/phpunit --filter AllBoardsLimits tests/unit/Service/BoardSummaryServiceTest.php
php -l lib/Service/BoardSummaryService.php
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/Service/BoardSummaryService.php tests/unit/Service/BoardSummaryServiceTest.php
git commit -m "feat(all-boards): limit cross-board matches to a limited viewer's own cards"
```

---

## Task 7: Create auto-assigns a limited creator

**Files:**
- Modify: `apps/deck/lib/Service/CardService.php`
- Test: `apps/deck/tests/unit/Service/CardServiceTest.php`

**Interfaces:**
- Consumes: `PermissionService::isLimitedToAssignedCards`; `AssignmentService::assignUser(int $cardId, string $userId, int $type = Assignment::TYPE_USER): Assignment`; `StackMapper::findBoardId`.
- Produces: after `create`, a limited creator is assigned to the new card.

- [ ] **Step 1: Write the failing test**

```php
public function testCreateAutoAssignsLimitedCreator(): void {
	$this->stackMapper->method('findBoardId')->with(9)->willReturn(1);
	$this->permissionService->method('isLimitedToAssignedCards')->with(1, 'bob')->willReturn(true);
	$this->cardMapper->method('insert')->willReturnCallback(fn ($c) => $c->setId(50) ?? $c);
	$this->assignmentService->expects(self::once())->method('assignUser')
		->with(50, 'bob', Assignment::TYPE_USER);

	$this->service->create('Follow up', 9, 'plain', 999, 'bob');
}

public function testCreateDoesNotAutoAssignFullCreator(): void {
	$this->stackMapper->method('findBoardId')->with(9)->willReturn(1);
	$this->permissionService->method('isLimitedToAssignedCards')->with(1, 'alice')->willReturn(false);
	$this->cardMapper->method('insert')->willReturnCallback(fn ($c) => $c->setId(50) ?? $c);
	$this->assignmentService->expects(self::never())->method('assignUser');

	$this->service->create('Task', 9, 'plain', 999, 'alice');
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
vendor/bin/phpunit --filter CreateAutoAssigns tests/unit/Service/CardServiceTest.php
```
Expected: FAIL.

- [ ] **Step 3: Inject `AssignmentService` and auto-assign**

Add `private AssignmentService $assignmentService,` to the `CardService` constructor (import it). Watch for circular DI: if the container reports a cycle (`AssignmentService` → `CardService`), instead call the already-injected `assignedUsersMapper` to insert an `Assignment` directly. Prefer `AssignmentService::assignUser` so activity/notifications fire.

In `create`, after `$card = $this->cardMapper->insert($card);` and after the existing `activityManager`/`changeHelper` calls, before `enrichCards`:
```php
		$boardId = $this->stackMapper->findBoardId($stackId);
		if ($boardId !== null && $this->permissionService->isLimitedToAssignedCards($boardId, $owner)) {
			$this->assignmentService->assignUser($card->getId(), $owner, Assignment::TYPE_USER);
		}
```
Import `use OCA\Deck\Db\Assignment;`.

- [ ] **Step 4: Run to verify pass**

```bash
vendor/bin/phpunit --filter CreateAutoAssigns tests/unit/Service/CardServiceTest.php
php -l lib/Service/CardService.php
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/Service/CardService.php tests/unit/Service/CardServiceTest.php
git commit -m "feat(card): auto-assign a limited creator to the card they make"
```

---

## Task 8: Persist + validate the flag on the ACL API

**Files:**
- Modify: `apps/deck/lib/Service/BoardService.php` (`addAcl`, `updateAcl`)
- Modify: `apps/deck/lib/Controller/BoardController.php` (`shareBoard`/`updateShare` endpoints)
- Test: `apps/deck/tests/unit/Service/BoardServiceTest.php`

**Interfaces:**
- Consumes: `Acl::setCardsOnlyAssigned` (Task 1).
- Produces: `addAcl(..., bool $cardsOnlyAssigned = false)` and `updateAcl(..., bool $cardsOnlyAssigned = false)` persist the flag; Manage + flag ⇒ flag forced false (never 400 — clear-on-manage invariant).

- [ ] **Step 1: Write the failing tests**

```php
public function testAddAclPersistsCardsOnlyAssigned(): void {
	// share as non-manage with cardsOnlyAssigned true
	$this->aclMapper->expects(self::once())->method('insert')
		->with(self::callback(fn (Acl $a) => $a->isCardsOnlyAssigned() === true));
	$this->service->addAcl(1, Acl::PERMISSION_TYPE_USER, 'bob', edit: true, share: false, manage: false, cardsOnlyAssigned: true);
}

public function testManageClearsCardsOnlyAssigned(): void {
	$this->aclMapper->expects(self::once())->method('insert')
		->with(self::callback(fn (Acl $a) => $a->isCardsOnlyAssigned() === false));
	$this->service->addAcl(1, Acl::PERMISSION_TYPE_USER, 'bob', edit: true, share: false, manage: true, cardsOnlyAssigned: true);
}
```
Add an equivalent `updateAcl` test (existing limited ACL upgraded to manage ⇒ flag cleared).

- [ ] **Step 2: Run to verify they fail**

```bash
vendor/bin/phpunit --filter 'CardsOnlyAssigned|ManageClears' tests/unit/Service/BoardServiceTest.php
```
Expected: FAIL (signature lacks the param).

- [ ] **Step 3: Thread the flag through addAcl/updateAcl**

`addAcl` signature → add `bool $cardsOnlyAssigned = false` (last param). After `[$edit, $share, $manage] = $this->applyPermissions(...)`:
```php
		$cardsOnlyAssigned = $manage ? false : $cardsOnlyAssigned;
		...
		$acl->setCardsOnlyAssigned($cardsOnlyAssigned);
```
`updateAcl` signature → add `bool $cardsOnlyAssigned = false`. After computing `[$edit, $share, $manage]`:
```php
		$acl->setCardsOnlyAssigned($manage ? false : $cardsOnlyAssigned);
```
Add `cardsOnlyAssigned` to the `boardServiceValidator->check(compact(...))` list only if the validator enforces field presence; a plain boolean needs no new rule.

- [ ] **Step 4: Controller — accept the request field**

In `BoardController`, the `shareBoard`/`updateShare` actions gain a `bool $cardsOnlyAssigned = false` parameter (NC maps request body → typed param) and pass it to `addAcl`/`updateAcl`. Confirm the exact method names (`shareBoard`, `updateShare` or similar) and forward the new arg.

- [ ] **Step 5: Run + lint + commit**

```bash
vendor/bin/phpunit --filter 'CardsOnlyAssigned|ManageClears' tests/unit/Service/BoardServiceTest.php
php -l lib/Service/BoardService.php lib/Controller/BoardController.php
git add lib/Service/BoardService.php lib/Controller/BoardController.php tests/unit/Service/BoardServiceTest.php
git commit -m "feat(board-acl): accept + persist cards_only_assigned; clear it on manage"
```

---

## Task 9: Frontend toggle + store + l10n

**Files:**
- Modify: `apps/deck/src/components/board/SharingTabSidebar.vue`
- Modify: the Vuex ACL update action (search `updateAcl`/`aclUpdate` in `apps/deck/src/store/`)
- Modify: `apps/deck/src/services/BoardApi.js` (or wherever the ACL PUT is built) to send `cardsOnlyAssigned`
- Modify: `themes/avuz/apps/deck/l10n/pt_BR.json` (repo, not submodule) + deck fork `l10n` source
- Test: `apps/deck/src/components/board/SharingTabSidebar.spec.js`

**Interfaces:**
- Consumes: the ACL object now carries `cardsOnlyAssigned` (Task 1 JSON).
- Produces: a per-participant checkbox that dispatches an ACL update with `cardsOnlyAssigned`; hidden when the participant has Manage.

- [ ] **Step 1: Write the failing jest test**

```js
// SharingTabSidebar.spec.js — mount with one non-manage participant ACL
it('shows the only-assigned toggle for a non-manage participant', () => {
	const wrapper = mountWithAcl({ permissionManage: false, cardsOnlyAssigned: false })
	expect(wrapper.find('[data-cy-acl-cards-only-assigned]').exists()).toBe(true)
})

it('hides the toggle when the participant has manage', () => {
	const wrapper = mountWithAcl({ permissionManage: true, cardsOnlyAssigned: false })
	expect(wrapper.find('[data-cy-acl-cards-only-assigned]').exists()).toBe(false)
})

it('dispatches an acl update with cardsOnlyAssigned when toggled', async () => {
	const { wrapper, store } = mountWithAcl({ permissionManage: false, cardsOnlyAssigned: false })
	await wrapper.find('[data-cy-acl-cards-only-assigned] input').setChecked(true)
	expect(store.dispatch).toHaveBeenCalledWith('updateAclFromCurrentBoard',
		expect.objectContaining({ cardsOnlyAssigned: true }))
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/patrickrezende/work/avuz/deck-fork
./node_modules/.bin/jest src/components/board/SharingTabSidebar.spec.js
```
Expected: FAIL.

- [ ] **Step 3: Add the toggle**

In the participant row of `SharingTabSidebar.vue`, add (near the edit/share/manage permission checkboxes), shown only when `!acl.permissionManage`:
```html
<NcActionCheckbox v-if="!acl.permissionManage"
	data-cy-acl-cards-only-assigned
	:checked="acl.cardsOnlyAssigned"
	@change="clickCardsOnlyAssigned(acl)">
	{{ t('deck', 'Only assigned cards') }}
</NcActionCheckbox>
```
Method:
```js
clickCardsOnlyAssigned(acl) {
	this.$store.dispatch('updateAclFromCurrentBoard', { ...acl, cardsOnlyAssigned: !acl.cardsOnlyAssigned })
}
```
Match the existing pattern for the edit/share/manage toggles in this component (same action name + payload shape).

- [ ] **Step 4: Carry the field through the store + API**

In the ACL update action + `BoardApi` ACL PUT payload, include `cardsOnlyAssigned` alongside `permissionEdit/Share/Manage` so it reaches `updateAcl`. Ensure `addAcl` (new share) also forwards it if the UI offers it at share-create time (optional; the toggle post-share is sufficient for MVP).

- [ ] **Step 5: l10n**

Add source string `"Only assigned cards"` to the deck fork l10n templates. Add to `themes/avuz/apps/deck/l10n/pt_BR.json` (in the avuz-server repo, not the submodule):
```json
"Only assigned cards" : "Apenas cards atribuídos",
```

- [ ] **Step 6: Run + commit**

```bash
./node_modules/.bin/jest src/components/board/SharingTabSidebar.spec.js
git add src/components/board/SharingTabSidebar.vue src/store src/services/BoardApi.js l10n
git commit -m "feat(share-ui): per-participant 'only assigned cards' toggle"
# themes/ change committed in the avuz-server repo, not the submodule (see Task 10)
```

---

## Task 10: Version bump, build, deploy

**Files:**
- Modify: `apps/deck/appinfo/info.xml` (version bump)
- Modify: `themes/avuz/apps/deck/l10n/pt_BR.json` (avuz-server repo — commit here)

- [ ] **Step 1: Full test sweep**

```bash
cd /Users/patrickrezende/work/avuz/deck-fork
./node_modules/.bin/jest
find lib -name '*.php' -print0 | xargs -0 -n1 php -l >/dev/null && echo "php lint clean"
# backend phpunit: run in a NC-bootstrapped environment / CI
```

- [ ] **Step 2: Deploy via the guaranteed-bump script**

```bash
cd /Users/patrickrezende/work/avuz/avuz-server/.claude/worktrees/deck-roadmap-next
scripts/deploy-deck.sh "feat(deck): board-scoped share — limit a recipient to their own cards"
```
This auto-bumps `appinfo/info.xml`, builds js, runs jest + php-lint, commits/pushes the deck fork, bumps the submodule, and commits avuz-server. (`themes/` l10n from Task 9 is committed in the avuz-server worktree before running, so the bump commit includes it.)

- [ ] **Step 3: Prod deploy (gated)** — only on the user's explicit go:

```bash
scripts/deploy-deck.sh --prod
```
Then validate on app3: create a board, share with a second user as "only assigned cards", confirm they see only their cards, a direct card URL to another card 403s, and the dashboard/All-Boards don't leak.

---

## Self-review

**Spec coverage:** data model (T1) ✓; permission resolution + most-permissive + owner/manage exemption + memoization + participant pairs (T2) ✓; single-card gate covering comments/attachments (T3) ✓; board + archived views (T4) ✓; dashboard upcoming (T5) ✓; All-Boards (T6) ✓; create auto-assign (T7) ✓; API persist + validate + clear-on-manage (T8) ✓; UI toggle + l10n (T9) ✓; version bump + deploy (T10) ✓. Phase-2 (search/CalDAV/activity) intentionally excluded.

**Placeholder scan:** T6 leaves the exact `BoardSummaryService` method name to the implementer because the fork method that calls `findMatchingCards` must be read at implementation; the behavior + the pairs to pass are fully specified. T8 controller method names likewise confirmed at implementation. No `TODO`/`add error handling`/empty-test placeholders remain; every code step shows real code.

**Type consistency:** `cardsOnlyAssigned` (property) / `cards_only_assigned` (column) / `isCardsOnlyAssigned`/`setCardsOnlyAssigned` (entity) / `isLimitedToAssignedCards` / `assignedParticipantPairsForUser` (returns `list<array{participant:string,type:int}>`) / `cardIsAssignedToUser` / `filterCardsForBoardViewer` are used identically across T1–T9. `Assignment::TYPE_USER = 0`, `Acl::PERMISSION_TYPE_GROUP = 1`.
