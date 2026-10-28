# Assinaturas Plan 11: contracts inside the envelope list — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the Contratos screen into the envelope list: a "Contrato" column, a "Contratos" chip row, a contract sort, a contract view, and an "A vencer" notice. Then remove the Contratos screen.

**Architecture:**
- **Server:** `GET /api/v1/envelopes` grows a contract layer that exists only while the add-on is on.
  - A new `EnvelopeContracts` value on `EnvelopeSearch` carries the contract filter, the type and today's date.
  - `EnvelopeMapper` turns it into an `IN (SELECT c.envelope_id …)` condition, a counterparty search and a sort subquery.
  - A new `ListedContracts` service adds per-row summaries, chip counts, the notice and the totals: a few queries per page, never one per row.
- **Frontend:** the dashboard reads the new fields. With the add-on off, the response has none of them and the UI shows nothing new.

**Tech Stack:** PHP 8 / Nextcloud 33 QueryBuilder, PHPUnit integration tests (`tests/env/phpunit.sh`); Vue 3.5 + TS, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-assinaturas-contracts-in-envelope-list-design.md` (avuz-server worktree). Read it before every task.

**Repo:** all code lives in `~/work/avuz/assinaturas`. Branch `contracts-in-list` off `main` (`a52363f`, 0.9.2). Run every command from that repo.

## Global Constraints

- **Add-on off:** the list API ignores every contract parameter and returns no contract key. The UI shows no column, chips, sort option, notice, totals, type select or counterparty search. A URL with contract parameters loads the plain list, with no 422.
- **Visibility is unchanged:** `ScopeVisibility` and `EnvelopeMapper::applyVisibility`. No contract join or subquery may widen what anyone sees.
- **Renewed contracts are never listed, counted, matched, searched or summarised.** "Listed" statuses are `active`, `expired`, `ended`.
- **"A vencer" (`coming_due`):** `active` and `key_date` from today through today + 90 days, inclusive. Use `ContractListing::COMING_DUE_DAYS` (90).
- **Recently expired:** `expired` and `ends_on` from today − 30 days through today, inclusive. The new constant is `ContractFilter::RECENTLY_EXPIRED_DAYS = 30`.
- **`attention`** = coming_due OR recently expired. It has no chip of its own.
- **Dates:** "today" is `ContractCalendar::today()`, the instance timezone, default `America/Sao_Paulo`.
- **Counting:**
  - Chip counts count envelopes.
  - The notice and the totals count contracts.
  - Each chip row's counts honour the other row, scope, folder, search and file, and ignore their own row.
  - Totals honour scope, folder, search, file and type, and ignore both chip rows.
  - The notice honours scope and folder only.
- **User-facing copy:** source strings are English, with pt_BR in `l10n/` added through `node scripts/add-translations.mjs` (stdin JSON). It never names the signing provider or "Nextcloud".
- **pt_BR copy fixed by the spec:**
  - chips: "Contratos" · "Todos" · "Com contrato" · "A vencer" · "Vencidos" · "Encerrados";
  - labels: "Vigente · até {date}" · "Vence em {n} dias" · "Renova em {n} dias" · "Vencido em {date}" · "Encerrado" · "Após assinatura";
  - sort and heading: "Vencimento do contrato" · "Contratos que pedem atenção";
  - notice: "{n} contratos vencem nos próximos 90 dias" · "{n} vencidos" (singular and plural);
  - search placeholder: "Buscar por título, signatário, e-mail ou contraparte";
  - empty state: "Marque um documento como contrato ao adicionar documentos."
- **No import pieces in this plan:** no "Importados" chip, no import button, and only the first empty-state sentence.
- **Code style:** follow the repo: tabs, `final` classes, no `any`, almost no `as`, named exports, hash maps over switch, early return, descriptive names, test names in the 3rd person.
- **Commits:** Conventional Commits, no AI attribution lines.
- **Tests:**
  - Never run `tests/env/reset.sh` without Patrick's OK.
  - `tests/env/phpunit.sh` auto-resets when the `avuzconecta:latest` image is newer than `~/.assinaturas-test-image-id`. Compare `docker image inspect avuzconecta:latest --format '{{.Id}}'` with that file first. If they differ, stop and ask.

## Review Focus

1. **Terms held on an envelope that can no longer complete** (refused, cancelled, expired, failed). The cell stays empty; only `draft`, `sending`, `pending` and `finalizing` show "Após assinatura". → Task 2 test `testShowsHeldTermsOnlyWhileTheEnvelopeCanStillComplete`.
2. **An active contract whose key date has passed** (auto-renew, notice deadline gone, end still ahead). It reads "Vigente · até {endsOn}", never "Vence em −3 dias". It is not in "A vencer" or `attention`. → Task 1 `testLeavesAnActiveContractPastItsKeyDateOutOfComingDue`, Task 5 `labels an active contract past its key date as in force`.
3. **A link or bookmark with `?contract=expired&sort=contract` after the add-on is switched off.** The plain list loads, sorted by most recent, with no error. → Task 1 `testIgnoresEveryContractParameterWhileTheAddonIsOff`, Task 4 `drops the contract settings while the add-on is off`.
4. **An envelope holding both an expired and an active contract, under "Vencidos".** The row reads "Vencido em …" with "+1", and under "A vencer" it reads "Vence em …". → Task 2 `testLabelsTheMostUrgentContractAmongThoseTheChipMatches`.
5. **A member in the `shared` scope.** The notice, chip counts and totals leave out contracts in folders not shared with them. → Task 3 `testCountsOnlyWhatTheViewerSeesInTheSharedScope`.

---

## File map

**Server (`lib/`):**
- Create `Db/ContractFilter.php`: the enum of contract filters, with their SQL and PHP predicates.
- Create `Db/EnvelopeContracts.php`: the add-on part of a list request.
- Modify `Db/EnvelopeSearch.php` (`contracts` field and helpers), `Db/EnvelopeSort.php` (`Contract`), `Db/EnvelopeMapper.php` (conditions, search, sort, contract chip counts), `Db/ContractMapper.php` (`findListedByEnvelopes`, aggregates over an `EnvelopeSearch`), `Db/DocumentMapper.php` (`envelopesHoldingTerms`).
- Create `Contract/ListedContracts.php`: per-row summaries, counts, notice and totals.
- Create `Contract/MostUrgentContract.php`: a pure picker.
- Create `Contract/AnnualValue.php`: extracted from `ContractListing`.
- Modify `Contract/TaxId.php` to add `searchPrefix`, moved from `ContractListing::taxIdPrefix`.
- Modify `Controller/EnvelopeController.php` (`contract`, `type`) and `Api/EnvelopeDetails.php` (`listing` merges the rows).

**Frontend (`src/`):**
- `api/types.ts`, `api/envelopes.ts`, `dashboard/list-query.ts`.
- New `dashboard/contract-cell.ts`, `dashboard/ContractCell.vue`, `dashboard/ContractChips.vue`, `dashboard/ContractNotice.vue`, `dashboard/AttentionBar.vue`, `dashboard/contract-type-options.ts`.
- `dashboard/EnvelopeTable.vue`, `dashboard/EnvelopeCards.vue`, `dashboard/DashboardView.vue`, `dashboard/EmptyListing.vue`, `dashboard/empty-reason.ts`.
- Moved from `contracts-list/`: `ContractTotals.vue` → `dashboard/`; `valueLabel` and `counterpartyDocumentLabel` → `contracts/contract-values.ts`.
- Removed: the rest of `contracts-list/`, `listContracts`, the `contracts`/`allContracts` query keys, the nav entry and the navigation target.
- `router.ts`: the `/contracts` redirect.

**Docs:** `docs/api.md` (Listing section, error table, Contracts listing marked deprecated), `README.md` if it names the Contratos screen.

---

### Task 1: Contract filter, type, sort and counterparty search on `GET /envelopes`

**Files:**
- Create: `lib/Db/ContractFilter.php`, `lib/Db/EnvelopeContracts.php`
- Modify: `lib/Db/EnvelopeSearch.php`, `lib/Db/EnvelopeSort.php`, `lib/Db/EnvelopeMapper.php`, `lib/Contract/TaxId.php`, `lib/Contract/ContractListing.php` (use `TaxId::searchPrefix`), `lib/Controller/EnvelopeController.php`
- Test: `tests/Integration/Controller/EnvelopeContractListingTest.php` (new)

**Interfaces:**
- Produces:
  ```php
  namespace OCA\Assinaturas\Db;
  enum ContractFilter: string {
  	case With = 'with'; case ComingDue = 'coming_due'; case Expired = 'expired'; case Ended = 'ended'; case Attention = 'attention';
  	public const RECENTLY_EXPIRED_DAYS = 30;
  	/** The chip row, in order; `attention` has no chip. */
  	public const CHIPS = [self::With, self::ComingDue, self::Expired, self::Ended];
  	/** @return list<ContractStatus> active, expired, ended — never renewed */
  	public static function listedStatuses(): array;
  	/** SQL on the contracts table under `$alias`; parameters are created on `$query`. */
  	public function condition(IQueryBuilder $query, string $alias, string $today): string|ICompositeExpression;
  	/** The same rule in PHP, for picking a row's label. */
  	public function matches(Contract $contract, string $today): bool;
  }
  final class EnvelopeContracts {
  	public function __construct(public readonly ?ContractFilter $filter, public readonly ?string $type, public readonly string $today) {}
  	public function withFilter(?ContractFilter $filter): self;
  }
  // EnvelopeSearch: new last ctor param `public readonly ?EnvelopeContracts $contracts = null` (null = add-on off), plus
  public function withFilters(EnvelopeFilter $filter, ?ContractFilter $contract): self; // same search, other chip rows
  public function visibleOnly(): self; // same visibility; filter All, no text, no fileId, no contract filter
  // EnvelopeSort: case Contract = 'contract';
  // EnvelopeMapper: `applyConditions` becomes public (the aggregates of Task 3 reuse it on alias 'e')
  // TaxId: public static function searchPrefix(string $text): ?string  // "11.222.333" → "11222333"; no digit → null
  ```
- `EnvelopeController::index` gains `string $contract = '', string $type = ''` as its last two parameters.

**Rules:**
- **`condition`:**
  - `With`: status in the listed statuses.
  - `ComingDue`: active and key_date between today and today + 90.
  - `Expired`: expired.
  - `Ended`: ended.
  - `Attention`: ComingDue OR (expired AND ends_on between today − 30 and today).
- **Filter in the mapper:** while `contracts?->filter` is set, `e.id IN (SELECT c.envelope_id FROM contracts c WHERE <condition> [AND c.type = :type])`. The type counts only together with a filter.
- **Counterparty search:** while `contracts` is set and there is a search text, OR into the existing search `e.id IN (SELECT c.envelope_id … WHERE c.status IN listed AND (c.counterparty_name ILIKE %text% [OR c.counterparty_document LIKE prefix%]))`. The prefix is `TaxId::searchPrefix`.
- **Sort `Contract`, only while `contracts` is set (otherwise it falls through to recent):**
  - The key is `(SELECT MIN(c.key_date) FROM contracts c WHERE c.envelope_id = e.id AND <filter condition, or listed statuses with no filter>)`.
  - Order by `CASE WHEN key IS NULL THEN 1 ELSE 0 END`, then key ASC, then the existing `updated_at DESC, id DESC`.
  - Build the subqueries the way `applyConditions` already does: a second QueryBuilder whose parameters are created on the outer `$query`, embedded through `createFunction($sub->getSQL())`.
- **Controller:**
  - When `ContractSettings::isEnabled()` is false, skip parsing `contract`/`type` and pass `contracts: null`.
  - When it is true: an unknown `contract` (non-empty) or a trimmed `type` over `ContractLimits::MAX_TYPE_LENGTH` answers the existing 422 `list_query_invalid`. An empty `contract` means no filter.
  - Build the value with `new EnvelopeContracts($filter, $type ?: null, $this->calendar->today())`.

- [ ] **Step 1: Create the branch and the test class**

```bash
git checkout -b contracts-in-list main
```

Copy the `setUp`, the users and the `ContractFixtures` usage from `tests/Integration/Controller/ContractListControllerTest.php`:
- `setUp` enables the add-on with `Server::get(ContractSettings::class)->setEnabled(true)` and sets `$this->today` from `ContractCalendar`.
- `contractEndingIn($owner, $days, $title, $terms)` comes over unchanged.
- `listing(array $params): array` calls `EnvelopeController::index(...$params)` with named arguments and asserts 200.
- `titles(array $listing): list<string>` maps `envelopes[*].title`.

- [ ] **Step 2: Write the failing tests**

```php
public function testListsOnlyEnvelopesWithAListedContract(): void
// a signed contract "Locação", a plain draft "Rascunho", a contract set to `renewed` "Antigo" (withContractStatus)
// listing(['contract' => 'with']) titles === ['Locação']

public function testFiltersComingDueExpiredAndEnded(): void
// contracts ending in 10 days "Breve", 200 days "Longe", one set expired "Vencido", one set ended "Fim"
// coming_due → ['Breve']; expired → ['Vencido']; ended → ['Fim']

public function testLeavesAnActiveContractPastItsKeyDateOutOfComingDue(): void
// contractEndingIn(owner, 20, 'Aviso', ['autoRenew' => true, 'renewalTermMonths' => 12, 'noticeDays' => 30]) → key date 10 days ago
// coming_due and attention → []; with → ['Aviso']

public function testAttentionCoversComingDueAndRecentlyExpired(): void
// "Breve" (10 days); expired ending 20 days ago "Recente"; expired ending 40 days ago "Antigo"; ended "Fim"
// attention, sort contract → ['Recente', 'Breve']

public function testMatchesAnEnvelopeWhenAnyOfItsContractsMatches(): void
// one envelope, main document ending in 200 days, annex set expired (annexContractEndingIn pattern)
// expired → [that title]; coming_due → []

public function testCombinesTheContractFilterWithTheStatusFilterAndType(): void
// contracts typed "Seguro" and "Locação"; listing(['contract' => 'with', 'type' => 'Seguro']) → only the Seguro one
// listing(['contract' => 'with', 'filter' => 'draft']) → []

public function testIgnoresTheTypeWithoutAContractFilter(): void
// listing(['type' => 'Seguro']) lists every envelope

public function testSortsByContractDateWithNoContractLast(): void
// "Longe" (200 days), "Breve" (10 days), draft "Rascunho"; listing(['sort' => 'contract']) → ['Breve', 'Longe', 'Rascunho']

public function testSearchesTheCounterpartyNameAndTaxId(): void
// counterparty ['counterpartyName' => 'Porto Seguro Cia', 'counterpartyDocument' => '11222333000181']
// search 'porto seg' → found; search '11.222.333' → found; search 'zzz' → []

public function testDoesNotSearchTheCounterpartyOfARenewedContract(): void

public function testDoesNotWidenVisibilityThroughTheContractJoin(): void
// another user's signed contract in an unshared folder; member's listing(['scope' => 'shared', 'contract' => 'with']) → []
// the member's own listing(['contract' => 'with']) never contains the other user's envelope

public function testIgnoresEveryContractParameterWhileTheAddonIsOff(): void
// setEnabled(false); listing(['contract' => 'nope', 'type' => str_repeat('x', 500), 'sort' => 'contract']) → 200, plain recent order
// and no 'contract' / 'heldTerms' key in any envelope (Task 2 adds them)

/** @dataProvider invalidContractQueries */
public function testRejectsAContractQueryItCannotRead(array $query): void // ['contract' => 'soon'], ['type' => str_repeat('x', ContractLimits::MAX_TYPE_LENGTH + 1)] → 422 list_query_invalid
```

- [ ] **Step 3: Run them to verify they fail**

Run: `tests/env/phpunit.sh --filter EnvelopeContractListingTest`
Expected: errors or FAILs (unknown named parameter `contract`).

- [ ] **Step 4: Implement**

Implement the interfaces and rules above. Add a unit test for `TaxId::searchPrefix` next to the existing TaxId tests:
- `'11.222.333'` → `'11222333'`;
- `'Porto'` → `null`;
- `'ab1'` → `'AB1'`.

Point `ContractListing` at it, and delete its private `taxIdPrefix`.

- [ ] **Step 5: Run the new tests and the suites they touch**

Run:

```bash
tests/env/phpunit.sh --filter 'EnvelopeContractListingTest|EnvelopeControllerTest|EnvelopeListingScopesTest|EnvelopeMapperSearchTest|ContractListControllerTest|TaxId'
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add lib tests
git commit -m "feat(list): filter, sort and search envelopes by their contracts"
```

---

### Task 2: Per-row contract summary and held terms

**Files:**
- Create: `lib/Contract/MostUrgentContract.php`, `lib/Contract/ListedContracts.php`
- Modify: `lib/Db/ContractMapper.php`, `lib/Db/DocumentMapper.php`, `lib/Api/EnvelopeDetails.php`, `lib/Controller/EnvelopeController.php`
- Test: `tests/Unit/Contract/MostUrgentContractTest.php` (new), `tests/Integration/Controller/EnvelopeContractListingTest.php`

**Interfaces:**
- Consumes: `ContractFilter`, `EnvelopeContracts` (Task 1).
- Produces:
  ```php
  // ContractMapper
  /** @param list<int> $envelopeIds  @return list<Contract> listed statuses only */
  public function findListedByEnvelopes(array $envelopeIds): array;
  // DocumentMapper
  /** @param list<int> $envelopeIds  @return list<int> those with a document whose contract_terms is not null */
  public function envelopesHoldingTerms(array $envelopeIds): array;
  // MostUrgentContract (pure)
  /** @param list<Contract> $contracts one envelope's listed contracts */
  public static function pick(array $contracts, ?ContractFilter $filter, string $today): ?Contract;
  // ListedContracts
  /** @param list<Envelope> $envelopes  @return array<int, array{contract: ?array<string, mixed>, heldTerms: bool}> by envelope id */
  public function rows(array $envelopes, EnvelopeContracts $contracts): array;
  // EnvelopeDetails::listing gains `array $contractRows = []`; each summary is merged with `$contractRows[$id] ?? []`
  ```
- **Row `contract` shape** (null when the envelope has no listed contract):
  `{status, keyDate, endsOn, daysUntilKeyDate, autoRenew, noticeDays, counterpartyName, counterpartyDocument, type, valueCents, valueFrequency, others}`. `others` = the envelope's listed contracts − 1. `daysUntilKeyDate` uses `ContractCalendar::daysBetween($today, keyDate)`.

**Rules for `pick`:**
- The candidates are the contracts the filter matches; with no filter, all of them. If a filter matches none, fall back to all.
- Among active candidates: the earliest `keyDate` (tie: lowest id).
- With no active candidate: the expired one with the latest `endsOn`. With none expired: the ended one with the latest `endsOn`. Ties: the highest id.

**Held terms:** `heldTerms` is true only when the envelope's status is `draft`, `sending`, `pending` or `finalizing` and `envelopesHoldingTerms` lists it. Define that list as `ListedContracts::STATUSES_THAT_MAY_COMPLETE`.

- [ ] **Step 1: Write the failing unit tests (`MostUrgentContractTest`)**

Build `Contract` entities in memory with setters. Use today = `'2026-10-28'`.

```php
public function testPicksTheEarliestKeyDateAmongActiveContracts(): void   // active 2027-01-10 (id 1), active 2026-12-01 (id 2) → id 2
public function testPrefersActiveOverExpiredWithoutAFilter(): void        // expired, active → active
public function testPicksTheLatestExpiredWhenNoneIsActive(): void        // expired ends 2026-09-01, 2026-10-20 → 2026-10-20
public function testLabelsTheMostUrgentContractAmongThoseTheChipMatches(): void // active + expired; filter Expired → expired; ComingDue (active key in 30d) → active
public function testFallsBackToAllWhenTheFilterMatchesNone(): void
public function testReturnsNullForNoContracts(): void
```

- [ ] **Step 2: Write the failing integration tests (append to `EnvelopeContractListingTest`)**

```php
public function testDescribesTheContractOfEachRow(): void
// contractEndingIn(owner, 10, 'Seguro', ['type' => 'Seguro', 'counterpartyName' => 'Porto', 'valueCents' => 120000, 'valueFrequency' => 'yearly'])
// row['contract'] has status 'active', daysUntilKeyDate 10, type 'Seguro', counterpartyName 'Porto', valueCents 120000, others 0; row['heldTerms'] false

public function testCountsTheOtherContractsOfTheEnvelope(): void // main + annex contracts → others 1
public function testGivesNullForAnEnvelopeWithoutContract(): void // plain draft → contract null, heldTerms false
public function testShowsHeldTermsOnlyWhileTheEnvelopeCanStillComplete(): void
// draftWithTerms → heldTerms true, contract null; same envelope withStatus Pending → true; Refused, Cancelled, Expired, Failed → false
public function testLabelsTheMostUrgentContractAmongThoseTheChipMatches(): void
// annex expired + main active (key in 10 days): contract=expired → row contract status 'expired', others 1; contract=coming_due → 'active'
```

- [ ] **Step 3: Run them to verify they fail**

Run: `tests/env/phpunit.sh --filter 'MostUrgentContractTest|EnvelopeContractListingTest'`
Expected: FAIL (class not found, missing `contract` key).

- [ ] **Step 4: Implement**

- Build `rows` with one `findListedByEnvelopes` and one `envelopesHoldingTerms` per page.
- In the controller, pass `$this->listedContracts->rows($found['envelopes'], $contracts)` to `details->listing` only while the add-on is on.

- [ ] **Step 5: Run the tests**

Run: `tests/env/phpunit.sh --filter 'MostUrgentContractTest|EnvelopeContractListingTest|EnvelopeControllerTest'`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib tests
git commit -m "feat(list): describe each envelope's most urgent contract"
```

---

### Task 3: Chip counts, notice and totals; API docs

**Files:**
- Create: `lib/Contract/AnnualValue.php`
- Modify: `lib/Db/EnvelopeMapper.php`, `lib/Db/ContractMapper.php`, `lib/Contract/ListedContracts.php`, `lib/Contract/ContractListing.php` (use `AnnualValue`), `lib/Controller/EnvelopeController.php`, `docs/api.md`
- Test: `tests/Integration/Controller/EnvelopeContractListingTest.php`

**Interfaces:**
- Consumes: Task 1 (`EnvelopeSearch::withFilters`, `visibleOnly`, public `applyConditions`) and Task 2 (`ListedContracts`).
- Produces:
  ```php
  // EnvelopeMapper — envelopes per chip, honouring the search's status filter, ignoring its contract filter
  /** @return array<string, int> chip value => envelopes */
  public function countByContractFilter(EnvelopeSearch $search): array;
  // ContractMapper — contracts of the envelopes the search lists (EnvelopeMapper::applyConditions on alias 'e')
  public function countWithin(EnvelopeSearch $search, ContractFilter|ContractStatus $which, ?string $type): int;
  /** @return array<string, int> value frequency => summed cents */
  public function sumValuesWithin(EnvelopeSearch $search, ContractStatus $status, ?string $type): array;
  // AnnualValue
  /** @param array<string, int> $sums  monthly × 12 + yearly, capped at ContractListing::MAX_ANNUAL_VALUE_CENTS */
  public static function cents(array $sums): int;
  // ListedContracts
  /** @return array{contractCounts: array<string, int>, contractNotice: array{comingDue: int, recentlyExpired: int}, contractTotals?: array{active: int, comingDue: int, annualValueCents: int}} */
  public function summary(EnvelopeSearch $search): array;
  ```
- `ContractMapper` takes `EnvelopeMapper` in its constructor to reuse `applyConditions`. If that would create a cycle in the DI graph, move the two aggregate methods into a new `lib/Db/ContractAggregates.php`, keeping the same signatures, and say so in the report.

**Rules:**
- **Status counts:** `counts` (the status chips) already go through `applyConditions`, so they honour the contract filter. Keep it that way. The list `total` stays `counts[filter]`.
- **`contractCounts`:** for each value in `ContractFilter::CHIPS`, count with `$search->withFilters($search->filter, $chip)`. The status filter is applied, and the chip replaces the request's contract filter. Also include `all`, the count with no contract filter.
- **`contractNotice`:** on `$search->visibleOnly()`:
  - `comingDue` = `countWithin(…, ComingDue, null)`;
  - `recentlyExpired` = contracts that are expired with ends_on in the last 30 days. Count them through `Attention` minus `ComingDue`, or through a dedicated status-and-window helper in `ContractMapper`; the test pins the numbers, not the route.
- **`contractTotals`:** only while a contract filter is set (`attention` included), on `$search->withFilters(EnvelopeFilter::All, null)` with the request's type:
  - `active` = `countWithin(…, ContractStatus::Active, type)`;
  - `comingDue` = `countWithin(…, ComingDue, type)`;
  - `annualValueCents` = `AnnualValue::cents(sumValuesWithin(…, Active, type))`.
- Merge `summary()` into the response only while the add-on is on.

- [ ] **Step 1: Write the failing tests**

```php
public function testCountsEachContractChipWithinTheStatusFilter(): void
// 2 completed envelopes with active contracts (one in 10 days), 1 completed with an expired one, 1 draft without
// no params: contractCounts == ['all' => 4, 'with' => 3, 'coming_due' => 1, 'expired' => 1, 'ended' => 0]
// filter=draft: contractCounts['with'] === 0, contractCounts['all'] === 1

public function testCountsTheStatusChipsWithinTheContractFilter(): void
// contract=expired: counts['completed'] === 1, counts['draft'] === 0, total === 1

public function testCountsEnvelopesNotContractsOnTheChips(): void // main + annex both active → contractCounts['with'] === 1

public function testCountsTheNoticeByContractIgnoringSearchAndChips(): void
// contracts in 10 and 80 days, one expired 5 days ago, one expired 45 days ago, one ended
// listing(['search' => 'zzz', 'contract' => 'ended', 'filter' => 'draft'])['contractNotice'] === ['comingDue' => 2, 'recentlyExpired' => 1]

public function testFollowsTheFolderInTheNotice(): void // folderId=X → only contracts filed in X

public function testReturnsTotalsOnlyWhileAContractFilterIsOn(): void
// no contract param → no 'contractTotals' key; contract=expired → key present; contract=attention → present

public function testTotalsIgnoreBothChipRowsButFollowSearchAndType(): void
// active Seguro ending in 10 days, yearly 120000 + active Locação ending in 200 days, monthly 10000 + expired Seguro
// contract=expired: contractTotals == ['active' => 2, 'comingDue' => 1, 'annualValueCents' => 120000 + 12 * 10000]
// contract=expired&type=Seguro: active 1, annualValueCents 120000
// contract=with&search=Locação: active 1

public function testCountsOnlyWhatTheViewerSeesInTheSharedScope(): void
// manager files a contract (10 days) in folder A shared with the member, another in unshared folder B
// member listing(['scope' => 'shared', 'contract' => 'with']): contractNotice comingDue 1, contractCounts with 1, contractTotals active 1

public function testOmitsEveryContractKeyWhileTheAddonIsOff(): void
// setEnabled(false): no contractCounts, contractNotice, contractTotals keys
```

- [ ] **Step 2: Run them to verify they fail**

Run: `tests/env/phpunit.sh --filter EnvelopeContractListingTest`
Expected: FAIL (missing keys).

- [ ] **Step 3: Implement the interfaces and rules above**

`ContractListing` keeps working through `AnnualValue::cents`; its tests must stay green.

- [ ] **Step 4: Update `docs/api.md`**

- **Listing section:**
  - document `contract` (`with`, `coming_due`, `expired`, `ended`, `attention`), `type` (only with `contract`, exact, up to 100 characters) and `sort=contract`;
  - document the per-envelope `contract`/`heldTerms`, `contractCounts`, `contractNotice` and `contractTotals`;
  - say that all of them are ignored or absent while contract management is off.
- **Error table:** the `list_query_invalid` row gains the unknown `contract` and the overlong `type`.
- **Contracts listing:** under the heading, add "Deprecated: the UI no longer calls it; `GET /envelopes` with `contract` replaces it. It will be removed in a later release."

- [ ] **Step 5: Run the PHP suite**

Run: `tests/env/phpunit.sh`
Expected: all green. Paste the summary line in the report.

- [ ] **Step 6: Commit**

```bash
git add lib tests docs/api.md
git commit -m "feat(list): contract chip counts, the expiry notice and contract totals"
```

---

### Task 4: Frontend types, list query and API client

**Files:**
- Modify: `src/api/types.ts`, `src/api/envelopes.ts`, `src/dashboard/list-query.ts`, `src/dashboard/DashboardView.vue` (only `SORTS` → `availableSorts()`)
- Test: `src/dashboard/list-query.spec.ts`, `src/api/envelopes.spec.ts`

**Interfaces:**
- Produces (TS):
  ```ts
  export type ContractFilter = 'with' | 'coming_due' | 'expired' | 'ended' | 'attention'
  export type ContractChipFilter = Exclude<ContractFilter, 'attention'>
  export type EnvelopeSort = 'recent' | 'deadline' | 'contract'
  export interface ListedContract {
  	status: 'active' | 'expired' | 'ended'
  	keyDate: string; endsOn: string; daysUntilKeyDate: number
  	autoRenew: boolean; noticeDays: number | null
  	counterpartyName: string | null; counterpartyDocument: string | null; type: string | null
  	valueCents: number | null; valueFrequency: ContractRow['valueFrequency']
  	others: number
  }
  // EnvelopeSummary += contract?: ListedContract | null; heldTerms?: boolean
  // EnvelopeListing += contractCounts?: Record<ContractChipFilter | 'all', number>; contractNotice?: { comingDue: number, recentlyExpired: number }; contractTotals?: ContractTotals
  // EnvelopeListQuery += contract: ContractFilter | null; type: string
  // list-query.ts
  export const CONTRACT_FILTERS: readonly ContractFilter[]
  export function availableSorts(): readonly EnvelopeSort[] // 'contract' only while appConfig().contractsEnabled
  ```
- Move `ContractRow['valueFrequency']` and `ContractTotals` if Task 8 deletes their source types: keep them in `types.ts`.

**Rules:**
- The route query names are `contract` and `type`.
- **With the add-on off:** `contract` → `null`, `type` → `''`, `sort=contract` → `'recent'`.
- **With it on:** an invalid `contract` → `null`; a `type` over 100 characters → `''`.
- `routeQueryFromList` omits defaults (`contract: null`, `type: ''`).
- `listEnvelopes` sends `contract` and `type` only when they are set.

- [ ] **Step 1: Write the failing tests (`list-query.spec.ts`)**

```ts
describe('listQueryFromRoute', () => {
	describe('with the contracts add-on on', () => {
		it('reads the contract filter, type and contract sort', () => { /* {contract:'expired', type:'Seguro', sort:'contract'} → same */ })
		it('drops an unknown contract filter', () => { /* contract:'soon' → null */ })
	})
	describe('with the add-on off', () => {
		it('drops the contract settings while the add-on is off', () => { /* contract:'expired', type:'X', sort:'contract' → null, '', 'recent' */ })
	})
})
describe('routeQueryFromList', () => {
	it('writes the contract filter and type, leaving defaults out', () => { /* {contract:'attention', sort:'contract'} → {contract:'attention', sort:'contract'} */ })
})
describe('availableSorts', () => {
	it('offers the contract sort only with the add-on on', () => { /* ['recent','deadline','contract'] vs ['recent','deadline'] */ })
})
```

In `envelopes.spec.ts`: `it('sends the contract filter and type only when set')`. Assert on the axios params the way the existing list test does.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/dashboard/list-query.spec.ts src/api/envelopes.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Mock `appConfig` the way the existing `list-query.spec.ts` does for `canSeeAll`.

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run src/dashboard src/api && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat(list): carry the contract filter, type and sort in the list query"
```

---

### Task 5: The "Contrato" column and phone line

**Files:**
- Create: `src/dashboard/contract-cell.ts`, `src/dashboard/ContractCell.vue`
- Modify: `src/dashboard/EnvelopeTable.vue`, `src/dashboard/EnvelopeCards.vue`, `l10n/pt_BR.json` + `l10n/pt_BR.js` (via the script)
- Test: `src/dashboard/contract-cell.spec.ts` (new), `src/dashboard/DashboardView.spec.ts`

**Interfaces:**
- Consumes: `ListedContract` (Task 4), `ContractChip` and `PillTone` from `src/contracts/contract-status.ts`, `formatCalendarDate` from `src/presentation/dates.ts`, `COMING_DUE_DAYS`.
- Produces:
  ```ts
  /** The column's pill, or null for an empty cell. */
  export function contractCell(contract: ListedContract | null | undefined, heldTerms: boolean | undefined): ContractChip | null
  ```
- `ContractCell.vue` props: `{ contract?: ListedContract | null, heldTerms?: boolean }`.
  - It renders `AvStatusPill` with the label.
  - With `others > 0` it adds a visible `+{others}` and a visually hidden "mais N contrato(s)".
  - It renders nothing when `contractCell` returns null.
- `EnvelopeTable` and `EnvelopeCards` get a prop `showsContracts: boolean`, which is `appConfig().contractsEnabled` from `DashboardView`.
  - **Table:** a "Contrato" column after Status.
  - **Cards:** one extra line under the status.

**Labels (English source → pt_BR):**

| State | Source | pt_BR | Tone |
|---|---|---|---|
| no contract, held terms | `After signature` | `Após assinatura` | brand |
| active, `daysUntilKeyDate` < 0 or > 90 | `In force · until {date}` (endsOn) | `Vigente · até {date}` | success |
| active, 0, notice-keyed (`autoRenew && noticeDays > 0`) | `Renews today` | `Renova hoje` | warning |
| active, 1–90, notice-keyed | `_Renews in %n day_::_Renews in %n days_` | `["Renova em %n dia","Renova em %n dias"]` | warning |
| active, 0 | `Due today` | `Vence hoje` | warning |
| active, 1–90 | `_Due in %n day_::_Due in %n days_` | `["Vence em %n dia","Vence em %n dias"]` | warning |
| expired | `Lapsed on {date}` (endsOn) | `Vencido em {date}` | danger |
| ended | `Ended` (exists) | `Encerrado` | neutral |
| others | `_%n more contract_::_%n more contracts_` | `["mais %n contrato","mais %n contratos"]` | — |

Also add the column heading `Contract`. It already exists → `Contrato`; reuse it.

- [ ] **Step 1: Write the failing tests (`contract-cell.spec.ts`)**

Pin `getCanonicalLocale` to `pt-BR` the way `dates` specs do.

```ts
describe('contractCell', () => {
	it('shows nothing without a contract or held terms', () => expect(contractCell(null, false)).toBeNull())
	it('labels held terms as after signature', () => /* label 'After signature', tone 'brand' */)
	it('labels a far contract as in force until its end', () => /* days 200, endsOn '2027-10-19' → 'In force · until 19/10/2027', 'success' */)
	it('labels an active contract past its key date as in force', () => /* days -3 → 'In force · until …' */)
	it('counts down to the key date within 90 days', () => /* days 12 → 'Due in 12 days', 'warning'; days 90 → 'Due in 90 days' */)
	it('says due today on the key date', () => /* days 0 → 'Due today' */)
	it('says renews when the key date is the notice deadline', () => /* autoRenew, noticeDays 30, days 12 → 'Renews in 12 days'; days 0 → 'Renews today' */)
	it('labels an expired contract with its end date', () => /* endsOn '2026-10-03' → 'Lapsed on 03/10/2026', 'danger' */)
	it('labels an ended contract', () => /* 'Ended', 'neutral' */)
})
```

In `DashboardView.spec.ts`, add a `describe('contract column')` with:
- `it('shows the contract label and the count of other contracts')`: the listing mock has `contract: {…others: 2}`; the column header "Contract" and "+2" are visible.
- `it('shows no contract column while the add-on is off')`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/dashboard/contract-cell.spec.ts src/dashboard/DashboardView.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement, then add the translations**

```bash
node scripts/add-translations.mjs <<'JSON'
{"After signature":"Após assinatura","In force · until {date}":"Vigente · até {date}","Renews today":"Renova hoje","_Renews in %n day_::_Renews in %n days_":["Renova em %n dia","Renova em %n dias"],"Due today":"Vence hoje","_Due in %n day_::_Due in %n days_":["Vence em %n dia","Vence em %n dias"],"Lapsed on {date}":"Vencido em {date}","_%n more contract_::_%n more contracts_":["mais %n contrato","mais %n contratos"]}
JSON
```

If the script stops on a source that already has another translation, pick a new English source that keeps the pt_BR text, and report it.

- [ ] **Step 4: Run the tests, the type check and lint**

Run: `npx vitest run src/dashboard && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src l10n
git commit -m "feat(list): show each envelope's contract in the list"
```

---

### Task 6: "Contratos" chip row, contract sort, contract view, search and empty state

**Files:**
- Create: `src/dashboard/ContractChips.vue`, `src/dashboard/contract-type-options.ts` (`typeFilterOptions`, moved from `contracts-list/contract-list-query.ts` with its tests)
- Move: `src/contracts-list/ContractTotals.vue` → `src/dashboard/ContractTotals.vue`; `valueLabel` and `counterpartyDocumentLabel` → `src/contracts/contract-values.ts` (with their tests from `contract-list-parts.spec.ts`)
- Modify: `src/dashboard/DashboardView.vue`, `EnvelopeTable.vue`, `EnvelopeCards.vue`, `EmptyListing.vue`, `empty-reason.ts`, `l10n/*`
- Test: `src/dashboard/DashboardView.spec.ts`, `src/dashboard/empty-reason.spec.ts` (new if absent)

**Interfaces:**
- Consumes: Tasks 4–5; `getContractTypes` and `QUERY_KEYS.contractTypes()` (existing).
- Produces:
  - **`ContractChips.vue`:** props `{ counts: Record<ContractChipFilter | 'all', number>, active: ContractFilter | null, scrollable?: boolean }`, emits `select: [filter: ContractChipFilter | null]` (`null` = "Todos"). It is a `role="group"` with a visible label "Contracts" (exists → "Contratos"), linked with `aria-labelledby`. `active === 'attention'` presses no chip.
  - **`EnvelopeTable`/`EnvelopeCards` prop `contractView: boolean`:**
    - Table columns become Envelope · Contrato · Contraparte · Tipo · Valor · Atualizado (Assinaturas and Prazo go).
    - Cards show the counterparty and `valueLabel` instead of signing progress.
  - `EmptyReason` gains `'contract'`: an empty page while a contract chip is on and there is no search.

**Rules:**
- **The chip row and sort item:** only while `appConfig().contractsEnabled` and the account isn't empty. The row sits under the status `FilterChips`. The sort item is "Contract due date".
- **Choosing a chip:** `updateList({ contract, page: 1, sort: contract === null ? listQuery.sort : 'contract' })`.
- **`contractView`:** `listQuery.contract !== null`.
- **Contract view:**
  - `ContractTotals` shows above the list from `listing.contractTotals`.
  - An `AvSelect` labelled "Type" shows next to the chips, with options from `typeFilterOptions(types, query.type, t('All types'))`. Fetch the types with `useQuery({ queryKey: QUERY_KEYS.contractTypes(), queryFn: getContractTypes, enabled: contractView })`. Changing it resets `page` to 1.
- **Search placeholder with the add-on on (desktop):** "Search by title, signer, email or counterparty".
- **Empty state `contract`:** title "No envelopes found" (exists), text "Mark a document as a contract when adding documents.", and the existing "clear filter" action, which sets `contract: null`.

**New translations:**

```json
{"All contracts":"Todos","With contract":"Com contrato","Lapsed contracts":"Vencidos","Ended contracts":"Encerrados","Contract due date":"Vencimento do contrato","Search by title, signer, email or counterparty":"Buscar por título, signatário, e-mail ou contraparte","Mark a document as a contract when adding documents.":"Marque um documento como contrato ao adicionar documentos."}
```

"A vencer" reuses the existing source `Coming due`.

- [ ] **Step 1: Write the failing tests (`DashboardView.spec.ts`, `describe('contract chips')`)**

```ts
it('shows the contract chips with their counts under the status chips')       // group named "Contracts"; "With contract 3"
it('filters and switches to the contract sort when a chip is picked')        // click "Lapsed contracts" → router.replace query {contract:'expired', sort:'contract'}
it('keeps the sort when "All contracts" is picked')                           // from contract=expired&sort=deadline → {sort:'deadline'}
it('swaps the signing columns for the contract columns in the contract view') // contract=with → headers include Counterparty, Type, Value; not Signers
it('shows the contract totals and the type filter in the contract view')      // "Contracts in force" + select "Type"
it('searches the counterparty too')                                           // placeholder text
it('explains how to add a contract when a contract chip lists nothing')
it('shows no contract chips, sort, totals or type filter while the add-on is off')
```

Also add `empty-reason.spec.ts` with `it('gives contract when a contract filter lists nothing without a search')`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/dashboard`
Expected: FAIL.

- [ ] **Step 3: Implement, move the files and add the translations** (same script as in Task 5)

- [ ] **Step 4: Run the tests, the type check and lint**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src l10n
git commit -m "feat(list): contract chips, contract sort and the contract view"
```

---

### Task 7: The "A vencer" notice and the attention view

**Files:**
- Create: `src/dashboard/ContractNotice.vue`, `src/dashboard/AttentionBar.vue`
- Modify: `src/dashboard/DashboardView.vue`, `l10n/*`
- Test: `src/dashboard/DashboardView.spec.ts`

**Interfaces:**
- Consumes: `listing.contractNotice`, `EnvelopeListQuery`.
- Produces:
  - **`ContractNotice.vue`:**
    - Props: `{ notice: { comingDue: number, recentlyExpired: number }, to: RouteLocationRaw }`.
    - It renders a single `RouterLink` above the filters whose accessible name is the full text, and renders nothing when both numbers are 0.
    - Text: the `n()` forms below, joined with " · ". A zero part is left out.
  - **`AttentionBar.vue`:** props `{ clearTo: RouteLocationRaw }`. It renders "Contracts needing attention" and a "Clear filters" link (exists → "Limpar filtros").

**Rules:**
- **Notice link target:** `{ name: ROUTE_NAMES.dashboard, query: routeQueryFromList({ ...defaults, scope, folderId, contract: 'attention', sort: 'contract' }) }`. That keeps only scope and folder.
- **The bar:** it shows instead of the contract chip selection while `listQuery.contract === 'attention'`. Its clear link drops `contract` and resets `sort` to `recent` and `page` to 1.
- **The notice:** it shows whenever the add-on is on and `listing.contractNotice` has a non-zero number, the attention view included.

**Translations:**

```json
{"_%n contract due in the next 90 days_::_%n contracts due in the next 90 days_":["%n contrato vence nos próximos 90 dias","%n contratos vencem nos próximos 90 dias"],"_%n lapsed_::_%n lapsed_":["%n vencido","%n vencidos"],"Contracts needing attention":"Contratos que pedem atenção"}
```

- [ ] **Step 1: Write the failing tests (`describe('contract notice')`)**

```ts
it('announces the contracts coming due and recently lapsed')        // {comingDue:3, recentlyExpired:1} → link named "3 contracts due in the next 90 days · 1 lapsed"
it('leaves out a zero part')                                         // {comingDue:0, recentlyExpired:2} → "2 lapsed"
it('shows no notice when nothing is due')                            // {0,0} → no link
it('opens the attention view keeping only scope and folder')         // from scope=company&folderId=4&search=x&filter=draft → click → query {scope:'company', folderId:'4', contract:'attention', sort:'contract'}
it('heads the attention view and clears it')                        // contract=attention → "Contracts needing attention"; click "Clear filters" → query without contract, sort
it('presses no contract chip in the attention view')
it('shows no notice while the add-on is off')
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/dashboard/DashboardView.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement and add the translations**

- [ ] **Step 4: Run the tests, the type check and lint**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src l10n
git commit -m "feat(list): the contracts-due notice and the attention view"
```

---

### Task 8: Remove the Contratos screen

**Files:**
- Modify: `src/router.ts`, `src/layout/AppNavigation.vue`, `src/layout/navigation-target.ts`, `src/api/contracts.ts` (drop `listContracts`), `src/api/query-keys.ts` (drop `contracts`, `allContracts`), `src/envelope-mutations/envelope-cache.ts`, `src/folders/use-folders.ts`, `src/api/types.ts` (drop `ContractListQuery`/`ContractListing` if unused)
- Delete: whatever is left in `src/contracts-list/` after Task 6's moves
- Test: `src/router` spec (or `src/layout/AppFrame.spec.ts` / `navigation-target.spec.ts`, wherever routes and navigation are tested today), and the specs touching `allContracts`

**Rules:**
- **`/contracts`:** keep the route record with no component, `beforeEnter` → `{ name: dashboard, query: { contract: 'attention', sort: 'contract' } }` while `contractsEnabled`, else `{ name: dashboard }`. Old links and notification bookmarks keep working.
- **Sidebar:** no "Contracts" entry.
- **Cache invalidation:** drop the `allContracts` invalidations. `allEnvelopes` already refreshes the list after a contract edit, renewal, end or folder move.
- `ContractListController` and `ContractListing` stay on the server: deprecated, not removed.

- [ ] **Step 1: Write the failing tests**

```ts
it('redirects /contracts to the attention view')           // contractsEnabled → route query {contract:'attention', sort:'contract'}
it('redirects /contracts to the plain list without the add-on')
it('has no Contracts entry in the navigation')             // AppNavigation with contractsEnabled → no link named "Contracts"
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/layout src/router*`
Expected: FAIL.

- [ ] **Step 3: Implement and delete. Then look for leftovers:**

```bash
grep -rn "contracts-list\|allContracts\|listContracts\|NAVIGATION_TARGETS.contracts" src
```

Expected: no output.

- [ ] **Step 4: Run the full frontend checks and build**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all PASS, and the build writes `js/`.

- [ ] **Step 5: Commit**

```bash
git add -A src js css l10n
git commit -m "feat(list): retire the Contratos screen; /contracts opens the attention view"
```

---

### Task 9: Release 0.10.0 and deploy to conecta-2

**Files:**
- Modify: `appinfo/info.xml` (`<version>0.10.0</version>`), `README.md` if it mentions the Contratos screen, the avuz-server `CLAUDE.md` Assinaturas bullet ("The Contratos screen lives at `/apps/assinaturas/contracts`" becomes "Contracts are managed from the envelope list; `/apps/assinaturas/contracts` opens its attention view")

- [ ] **Step 1: Run the whole suite one last time**

```bash
tests/env/phpunit.sh
npm test
npm run typecheck
npm run lint
```

Expected: everything green. Do the image-stamp check from Global Constraints first.

- [ ] **Step 2: Bump the version and build twice**

Run `npm run build` twice. The second run must leave no diff.

- [ ] **Step 3: Merge and push**

```bash
git checkout main
git merge --ff-only contracts-in-list
git commit -am "chore: release 0.10.0"
git push
```

- [ ] **Step 4: Pin the submodule in the avuz-server worktree**

```bash
git -C apps/assinaturas fetch
git -C apps/assinaturas checkout origin/main
```

Then commit "chore: pin Assinaturas 0.10.0 (contracts inside the envelope list)" and push.

- [ ] **Step 5: Build and deploy conecta-2**

```bash
KEEP_DOCKER=1 ./scripts/build-push.sh latest staging 2
```

- Gate on the `staging-2@sha256` line, not on a plain `grep -q`.
- Deploy with the scratchpad `deploy-conecta2.sh` recipe.
- Confirm with `portainer-exec.sh -u www-data avuz-conecta-2-app-1 php occ app:list --enabled | grep assinaturas` → `0.10.0`.
- Stay on staging only; prod is gated.
