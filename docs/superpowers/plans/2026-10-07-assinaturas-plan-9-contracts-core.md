# Assinaturas Plan 9 — Contract Management Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Assinaturas into a contract tracker behind a paid add-on switch: contract terms entered in the wizard ride with the draft's documents, become an active contract when everyone signs, and a twice-daily job alerts the right people, renews contracts that renew themselves and expires the rest, while the envelope page shows and edits each contract and its renewal chain.

**Architecture:** A new `OCA\Assinaturas\Contract` namespace holds the domain (validated `ContractTerms`, `ContractCalendar` date math in the instance timezone, CNPJ/CPF `TaxId`), the services (draft terms, activation on completion, user actions, renewal drafts, alerts, the lifecycle job) and the add-on switch (`ContractSettings`). Terms wait in `assinaturas_documents.contract_terms` (JSON) until the envelope's `completed` timeline event activates them into `assinaturas_contracts` rows (one per document, status `active|expired|ended|renewed`, materialized `key_date`), with alert dedup in `assinaturas_contract_alerts`. The frontend adds a conditional wizard step, a contract card with dialogs on the envelope page, timeline labels and the admin switch, all on TanStack Vue Query with keys from `QUERY_KEYS`.

**Tech Stack:** Nextcloud 33 app (PHP 8.3, QBMapper, `SimpleMigrationStep`, `TimedJob`, `INotifier`, `IEventListener`), PHPUnit 9 in the local Docker test env; Vue 3.5 + TypeScript strict, TanStack Vue Query 5, Vitest + @vue/test-utils + happy-dom, `@nextcloud/l10n`.

## Global Constraints

- Code lives in the app repo `/Users/patrickrezende/work/avuz/assinaturas`. Branch off the app's `main` (after Plan 8 merged): `feat/contracts-core`.
- App version bump in the last task: `appinfo/info.xml` → `0.7.0` (runs after Plan 8 = 0.6.0).
- Gates, each run separately, all exit 0: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` (commit built `js/` and `css/`); `composer run lint`; `tests/env/phpunit.sh` (it auto-runs `tests/env/reset.sh` when the local `avuzconecta:latest` image id differs from `~/.assinaturas-test-image-id` — never rebuild that image during the plan, and stop and ask if a reset would happen).
- Before every `tests/env/phpunit.sh` run, check the stamp: `[ "$(cat ~/.assinaturas-test-image-id)" = "$(docker image inspect avuzconecta:latest --format '{{.Id}}')" ] && echo same`. Anything but `same` means a reset would wipe the local DB and token: stop and ask Patrick.
- Dates are calendar dates in the instance timezone (America/Sao_Paulo default); use ITimeFactory for "today" so tests control time. Contract dates are `YYYY-MM-DD` strings everywhere (DB, API, frontend); "today" comes only from `ContractCalendar::today()`.
- TypeScript: no `any`, almost no `as`, named exports, no barrel files, async/await, hash maps over switch, named constants, early returns, descriptive names; TanStack Vue Query with query keys from an enum/factory (`QUERY_KEYS` in `src/api/query-keys.ts`).
- PHP: query builder only (no raw SQL), typed, early returns.
- Tests in 3rd person, never "should"; behaviour not implementation; TDD failing test first.
- WCAG 2.x AA: every control labelled, errors tied to their field (`aria-invalid` + `aria-describedby`, which `AvField` already does), focus moves to the first problem, status changes announced, chain links real links.
- White label: no user-facing string names ZapSign or any AI provider. pt_BR copy natural (e.g. "Contrato 'X' vence em 30 dias", "Prazo de aviso de 'X' termina em 7 dias"). The app's notifications already quote titles with double quotes (`Todos assinaram "X".`); contract alerts follow that house style: `Contrato "X" vence em 30 dias.`
- Commits: conventional messages, NO AI attribution lines. Branch off app `main`.
- Every new user-facing string is an English source text in `t(APP_ID, '…')` / `n(…)` (frontend) or `$l10n->t()` / the `Notifier::SUBJECTS` constant (PHP), translated in `l10n/pt_BR.json` and `l10n/pt_BR.js` through `scripts/add-translations.mjs` (Task 7). `src/l10n.spec.ts` fails on any untranslated source text and on any translation naming the provider.
- A new migration runs in the local env with `tests/env/php.sh occ migrations:execute assinaturas <version>` (no version bump needed); Task 17's bump to 0.7.0 then registers the background job through `occ upgrade`.

## What this plan relies on from Plan 8 (folders and managers)

Plan 8 lands first. This plan uses exactly these, and nothing else of it:

- `OCA\Assinaturas\Access\AccessPolicy`: `canSee(Envelope $envelope, string $userId): bool`, `canAct(Envelope $envelope, string $userId): bool`, `isManager(string $userId): bool`, `canSeeAll(string $userId): bool` (managers and Nextcloud admins), `canUseApp(string $userId): bool`.
- `OCA\Assinaturas\Access\ManagersGroup::GROUP_ID = 'assinaturas-admins'`.
- `OCA\Assinaturas\Folder\FolderAccess::userIdsWithEditOn(int $folderId): list<string>` (inherited rights and groups expanded; the folder owner included).
- `assinaturas_envelopes.folder_id` (nullable), exposed by the `Envelope` entity as `getFolderId(): ?int` / `setFolderId(?int $folderId)` (the standard `Entity` accessors for the column).
- `EnvelopeDrafts::create($ownerUid, $title, $fileIds)` keeps working with three arguments (a folder argument, if Plan 8 added one, is optional).

Task 1 Step 1 checks these exist before anything else.

## File structure

Backend (`lib/`):

| File | Responsibility |
|---|---|
| `Contract/ContractSettings.php` | The `contracts_enabled` app config flag |
| `Contract/TaxId.php` | CNPJ (numeric and alphanumeric) / CPF normalization and check digits |
| `Contract/ContractCalendar.php` | Today in the instance timezone; pure calendar math; the key date |
| `Contract/ContractLimits.php` | Field limits and default alert days |
| `Contract/ContractRejected.php` | A contract input or action refused, with our code and HTTP status |
| `Contract/ContractTerms.php` | Validated terms value object: input parsing, JSON shape, DB columns, roll-forward |
| `Contract/ContractName.php` | A contract's display name (envelope title, or the annex file name) |
| `Contract/ContractEvent.php` | Timeline event types of contracts |
| `Contract/ContractDrafts.php` | Terms held with a draft's documents |
| `Contract/ContractActivation.php` + `ContractActivationListener.php` | Completed envelope → active contracts; old link → renewed |
| `Contract/ContractDetails.php` | The envelope page's contracts, renewal chain and `canActOnContracts` |
| `Contract/ContractActions.php` | Register, edit, renew, end |
| `Contract/RenewalDrafts.php` | "Renovar com novo documento" draft |
| `Contract/AlertRecipients.php`, `ContractAlerts.php`, `ContractAlertSubject.php` | Who hears, dedup, notification subjects |
| `Contract/ContractLifecycle.php` + `ContractLifecycleJob.php` | Sweep, alerts, auto-renewal, expiry |
| `Db/Contract.php`, `Db/ContractMapper.php`, `Db/ContractStatus.php`, `Db/ContractSource.php`, `Db/ValueFrequency.php` | Contract rows |
| `Db/ContractAlert.php`, `Db/ContractAlertMapper.php` | Alert dedup rows |
| `Api/ContractView.php` | The contract JSON shape (Plan 10's list reuses it) |
| `Controller/ContractsAddonController.php`, `Controller/ContractController.php` | Routes |
| `Migration/Version000700Date20261008000000.php` | Schema |

Frontend (`src/`): `api/contracts.ts`, `contracts/tax-id.ts`, `contracts/money.ts`, `contracts/contract-form.ts`, `contracts/contract-status.ts`, `contracts/contract-facts.ts`, `contracts/ContractFields.vue`, `wizard/contract-step-state.ts`, `wizard/ContractStep.vue`, `detail/ContractCard.vue`, `detail/ContractEditDialog.vue`, `detail/ContractRenewDialog.vue`, `detail/ContractEndDialog.vue`, `admin/ContractsAddonSection.vue`; dev tool `scripts/add-translations.mjs`.

---

### Task 1: The add-on switch

**Files:**
- Create: `lib/Contract/ContractSettings.php`
- Create: `lib/Controller/ContractsAddonController.php`
- Modify: `lib/Api/ClientConfig.php`
- Test: `tests/Integration/Controller/ContractsAddonControllerTest.php` (new)
- Test: `tests/Integration/Api/ClientConfigTest.php`

**Interfaces:**
- Consumes (Plan 8): `AccessPolicy::canSeeAll(string): bool`, `ManagersGroup::GROUP_ID`.
- Produces: `ContractSettings::KEY_ENABLED = 'contracts_enabled'`, `ContractSettings::isEnabled(): bool`, `ContractSettings::setEnabled(bool $enabled): void`; routes `GET|PUT /api/v1/admin/contracts` answering `{enabled: bool, canChange: bool}`; `ClientConfig::forUser()` gains `contractsEnabled: bool`.

- [ ] **Step 1: Branch and check the ground**

```bash
cd /Users/patrickrezende/work/avuz/assinaturas
git switch main && git pull --ff-only && git switch -c feat/contracts-core
grep -c "function canSee\|function canAct\|function isManager" lib/Access/AccessPolicy.php
test -f lib/Access/ManagersGroup.php && test -f lib/Folder/FolderAccess.php && echo plan8-present
grep -c "folderId" lib/Db/Envelope.php
[ "$(cat ~/.assinaturas-test-image-id)" = "$(docker image inspect avuzconecta:latest --format '{{.Id}}')" ] && echo same
```

Expected: `3`, `plan8-present`, a count of at least `1`, `same`. Anything else: stop and ask Patrick (Plan 8 is not merged, or the test env would reset).

- [ ] **Step 2: Write the failing controller test**

Create `tests/Integration/Controller/ContractsAddonControllerTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Controller;

use OCA\Assinaturas\Access\ManagersGroup;
use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\Contract\ContractSettings;
use OCA\Assinaturas\Controller\ContractsAddonController;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\AppFramework\Http;
use OCP\IAppConfig;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class ContractsAddonControllerTest extends TestCase {
	use TestUsers;

	private const ADMIN_GROUP = 'admin';

	protected function tearDown(): void {
		self::logout();
		Server::get(IAppConfig::class)->deleteKey(Application::APP_ID, ContractSettings::KEY_ENABLED);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testStartsWithContractManagementOff(): void {
		self::loginAsUser($this->userIn(self::ADMIN_GROUP));

		$this->assertSame(['enabled' => false, 'canChange' => true], $this->controller()->show()->getData());
	}

	public function testLetsANextcloudAdminTurnContractManagementOn(): void {
		self::loginAsUser($this->userIn(self::ADMIN_GROUP));

		$response = $this->controller()->update(true);

		$this->assertSame(Http::STATUS_OK, $response->getStatus());
		$this->assertSame(['enabled' => true, 'canChange' => true], $response->getData());
		$this->assertTrue(Server::get(ContractSettings::class)->isEnabled());
	}

	public function testShowsTheStateToAManagerWithoutLettingThemChangeIt(): void {
		self::loginAsUser($this->userIn(ManagersGroup::GROUP_ID));

		$this->assertSame(['enabled' => false, 'canChange' => false], $this->controller()->show()->getData());
		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller()->update(true)->getStatus());
		$this->assertFalse(Server::get(ContractSettings::class)->isEnabled());
	}

	public function testHidesTheStateFromAMember(): void {
		self::loginAsUser($this->userIn(SignersGroup::GROUP_ID));

		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller()->show()->getStatus());
		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller()->update(true)->getStatus());
	}

	private function userIn(string $groupId): string {
		$userId = $this->createUser();
		$this->addToGroup($userId, $groupId);
		return $userId;
	}

	private function controller(): ContractsAddonController {
		return Server::get(ContractsAddonController::class);
	}
}
```

- [ ] **Step 3: Add the failing client-config test**

In `tests/Integration/Api/ClientConfigTest.php`, add the imports:

```php
use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\Contract\ContractSettings;
use OCP\IAppConfig;
```

Replace `tearDown()` with:

```php
	protected function tearDown(): void {
		Server::get(IAppConfig::class)->deleteKey(Application::APP_ID, ContractSettings::KEY_ENABLED);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}
```

Add the test:

```php
	public function testTellsTheFrontendWhetherContractManagementIsOn(): void {
		$this->assertFalse($this->configFor($this->member)['contractsEnabled']);

		Server::get(ContractSettings::class)->setEnabled(true);

		$this->assertTrue($this->configFor($this->member)['contractsEnabled']);
	}
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `tests/env/phpunit.sh --filter 'ContractsAddonControllerTest|ClientConfigTest'`
Expected: FAIL with `Error: Class "OCA\Assinaturas\Contract\ContractSettings" not found`.

- [ ] **Step 5: Implement the setting**

Create `lib/Contract/ContractSettings.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contract;

use OCA\Assinaturas\AppInfo\Application;
use OCP\IAppConfig;

/**
 * The contract management add-on ("Assinaturas + Gestão de contratos"). Off hides every contract surface and stops
 * the alerts; the contract data stays and comes back when it is switched on again.
 */
final class ContractSettings {
	public const KEY_ENABLED = 'contracts_enabled';

	public function __construct(
		private IAppConfig $appConfig,
	) {
	}

	public function isEnabled(): bool {
		return $this->appConfig->getValueBool(Application::APP_ID, self::KEY_ENABLED);
	}

	public function setEnabled(bool $enabled): void {
		$this->appConfig->setValueBool(Application::APP_ID, self::KEY_ENABLED, $enabled);
	}
}
```

- [ ] **Step 6: Implement the controller**

Create `lib/Controller/ContractsAddonController.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Controller;

use OCA\Assinaturas\Access\AccessPolicy;
use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\Contract\ContractSettings;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\FrontpageRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IGroupManager;
use OCP\IRequest;
use OCP\IUserSession;

/**
 * The add-on switch. Managers and Nextcloud admins see it; only Nextcloud admins change it, because the add-on is
 * what the company bought. `NoAdminRequired` only lets the request reach us; the check happens here.
 */
final class ContractsAddonController extends Controller {
	public function __construct(
		IRequest $request,
		private IUserSession $userSession,
		private IGroupManager $groupManager,
		private AccessPolicy $accessPolicy,
		private ContractSettings $settings,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'GET', url: '/api/v1/admin/contracts')]
	public function show(): JSONResponse {
		$userId = $this->currentUserId();
		if (!$this->accessPolicy->canSeeAll($userId)) {
			return self::forbidden();
		}
		return new JSONResponse($this->state($userId));
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'PUT', url: '/api/v1/admin/contracts')]
	public function update(bool $enabled): JSONResponse {
		$userId = $this->currentUserId();
		if (!$this->groupManager->isAdmin($userId)) {
			return self::forbidden();
		}
		$this->settings->setEnabled($enabled);
		return new JSONResponse($this->state($userId));
	}

	/** @return array{enabled: bool, canChange: bool} */
	private function state(string $userId): array {
		return ['enabled' => $this->settings->isEnabled(), 'canChange' => $this->groupManager->isAdmin($userId)];
	}

	private function currentUserId(): string {
		return $this->userSession->getUser()?->getUID() ?? '';
	}

	private static function forbidden(): JSONResponse {
		return new JSONResponse(['error' => 'forbidden', 'message' => 'You are not allowed to do this'], Http::STATUS_FORBIDDEN);
	}
}
```

- [ ] **Step 7: Tell the frontend**

In `lib/Api/ClientConfig.php`, add `use OCA\Assinaturas\Contract\ContractSettings;`, add the constructor parameter `private ContractSettings $contractSettings,` after `private ZapSignSettings $settings,`, change the return docblock to `@return array{environment: string, canUseApp: bool, isAdmin: bool, contractsEnabled: bool, limits: array<string, int>}` and add, after the `'isAdmin' => …,` line:

```php
			'contractsEnabled' => $this->contractSettings->isEnabled(),
```

- [ ] **Step 8: Run the tests to see them pass**

Run: `tests/env/phpunit.sh --filter 'ContractsAddonControllerTest|ClientConfigTest'`
Expected: `OK` (every test of both classes).

- [ ] **Step 9: Commit**

```bash
git add lib/Contract/ContractSettings.php lib/Controller/ContractsAddonController.php lib/Api/ClientConfig.php tests/Integration/Controller/ContractsAddonControllerTest.php tests/Integration/Api/ClientConfigTest.php
git commit -m "feat(contracts): add the contract management add-on switch"
```

---

### Task 2: Contract terms, dates and tax ids

**Files:**
- Create: `lib/Contract/TaxId.php`, `lib/Contract/ContractCalendar.php`, `lib/Contract/ContractLimits.php`, `lib/Contract/ContractRejected.php`, `lib/Contract/ContractTerms.php`
- Create: `lib/Db/ValueFrequency.php`, `lib/Db/ContractSource.php`
- Test: `tests/Unit/Contract/TaxIdTest.php`, `tests/Unit/Contract/ContractCalendarTest.php`, `tests/Unit/Contract/ContractTermsTest.php`

**Interfaces:**
- Consumes: `OCA\Assinaturas\Draft\DeadlineCalculator::timezone(): \DateTimeZone` (existing).
- Produces:
  - `TaxId::normalize(string $text): string`, `TaxId::isValid(string $normalized): bool`.
  - `ContractCalendar::__construct(ITimeFactory, DeadlineCalculator)`, `today(): string`, static `isDate(string): bool`, `addDays(string $date, int $days): string`, `addMonths(string $date, int $months): string`, `daysBetween(string $from, string $to): int`, `keyDate(string $endsOn, bool $autoRenew, ?int $noticeDays): string`.
  - `ContractRejected(string $errorCode, string $message, int $httpStatus = 422)` with public `errorCode`, `httpStatus`.
  - `ContractTerms` (readonly `startsOn ?string, endsOn string, autoRenew bool, renewalTermMonths ?int, noticeDays ?int, valueCents ?int, valueFrequency ?ValueFrequency, counterpartyName ?string, counterpartyDocument ?string, type ?string, alertDays list<int>, source ContractSource`), static `fromInput(mixed): self`, `with(array $changes): self`, `keyDate(): string`, `rolledForward(): self`, `toArray(): array`, `columns(): array<string, scalar|null>`.
  - Enums `ValueFrequency` (`once|monthly|yearly`), `ContractSource` (`manual|ai_confirmed`).
  - Error codes: `contract_invalid`, `contract_starts_on_invalid`, `contract_ends_on_invalid`, `contract_dates_invalid`, `contract_renewal_term_invalid`, `contract_notice_invalid`, `contract_value_invalid`, `contract_frequency_invalid`, `contract_counterparty_invalid`, `contract_tax_id_invalid`, `contract_type_invalid`, `contract_alert_days_invalid`.

- [ ] **Step 1: Write the failing tax id test**

Create `tests/Unit/Contract/TaxIdTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\Contract;

use OCA\Assinaturas\Contract\TaxId;
use PHPUnit\Framework\TestCase;

final class TaxIdTest extends TestCase {
	/** @return array<string, array{string}> */
	public static function validTaxIds(): array {
		return [
			'a CPF' => ['52998224725'],
			'a numeric CNPJ' => ['11222333000181'],
			'an alphanumeric CNPJ' => ['12ABC34501DE35'],
		];
	}

	/** @dataProvider validTaxIds */
	public function testAcceptsAValidTaxId(string $normalized): void {
		$this->assertTrue(TaxId::isValid($normalized));
	}

	/** @return array<string, array{string}> */
	public static function invalidTaxIds(): array {
		return [
			'a CPF with a wrong check digit' => ['52998224724'],
			'a CNPJ with a wrong check digit' => ['11222333000182'],
			'an alphanumeric CNPJ with a wrong check digit' => ['12ABC34501DE36'],
			'a CPF of one repeated digit' => ['11111111111'],
			'a CNPJ of zeros' => ['00000000000000'],
			'too few digits' => ['1234567890'],
			'letters in the check digits' => ['12ABC34501DEAB'],
			'lower case letters' => ['12abc34501de35'],
			'an empty text' => [''],
		];
	}

	/** @dataProvider invalidTaxIds */
	public function testRejectsAnInvalidTaxId(string $normalized): void {
		$this->assertFalse(TaxId::isValid($normalized));
	}

	public function testDropsPunctuationAndRaisesLetters(): void {
		$this->assertSame('12ABC34501DE35', TaxId::normalize(' 12.abc.345/01de-35 '));
		$this->assertSame('52998224725', TaxId::normalize('529.982.247-25'));
	}
}
```

- [ ] **Step 2: Write the failing calendar test**

Create `tests/Unit/Contract/ContractCalendarTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\Contract;

use OCA\Assinaturas\Contract\ContractCalendar;
use OCA\Assinaturas\Draft\DeadlineCalculator;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IConfig;
use PHPUnit\Framework\TestCase;

final class ContractCalendarTest extends TestCase {
	public function testReadsTodayInTheInstanceTimezone(): void {
		$lateEveningInSaoPaulo = (new \DateTimeImmutable('2026-10-08T02:00:00Z'))->getTimestamp();

		$this->assertSame('2026-10-07', $this->calendarAt($lateEveningInSaoPaulo)->today());
	}

	/** @return array<string, array{string, bool}> */
	public static function dates(): array {
		return [
			'an ordinary day' => ['2026-02-28', true],
			'a leap day' => ['2028-02-29', true],
			'a leap day of a common year' => ['2026-02-29', false],
			'a thirteenth month' => ['2026-13-01', false],
			'a two-digit year' => ['26-01-01', false],
			'a six-digit year' => ['202612-01-01', false],
			'a year before 1900' => ['1899-12-31', false],
			'a year after 2199' => ['2200-01-01', false],
		];
	}

	/** @dataProvider dates */
	public function testTellsACalendarDate(string $text, bool $isDate): void {
		$this->assertSame($isDate, ContractCalendar::isDate($text));
	}

	public function testAddsDaysAcrossMonthsAndYears(): void {
		$this->assertSame('2027-01-01', ContractCalendar::addDays('2026-12-31', 1));
		$this->assertSame('2026-02-28', ContractCalendar::addDays('2026-03-01', -1));
	}

	public function testAddsMonthsKeepingTheDayOrTheMonthsLastDay(): void {
		$this->assertSame('2026-02-28', ContractCalendar::addMonths('2026-01-31', 1));
		$this->assertSame('2027-01-15', ContractCalendar::addMonths('2026-01-15', 12));
		$this->assertSame('2027-02-28', ContractCalendar::addMonths('2026-11-30', 3));
	}

	public function testCountsTheDaysFromOneDateToAnother(): void {
		$this->assertSame(30, ContractCalendar::daysBetween('2026-10-07', '2026-11-06'));
		$this->assertSame(-2, ContractCalendar::daysBetween('2026-10-07', '2026-10-05'));
		$this->assertSame(0, ContractCalendar::daysBetween('2026-10-07', '2026-10-07'));
	}

	public function testKeysTheNoticeDeadlineOfAContractThatRenewsItself(): void {
		$this->assertSame('2026-12-01', ContractCalendar::keyDate('2026-12-31', true, 30));
		$this->assertSame('2026-12-31', ContractCalendar::keyDate('2026-12-31', true, null));
	}

	public function testKeysTheEndOfAContractThatDoesNotRenewItself(): void {
		$this->assertSame('2026-12-31', ContractCalendar::keyDate('2026-12-31', false, 30));
	}

	private function calendarAt(int $now): ContractCalendar {
		$clock = $this->createMock(ITimeFactory::class);
		$clock->method('getTime')->willReturn($now);
		$systemConfig = $this->createMock(IConfig::class);
		$systemConfig->method('getSystemValueString')->willReturnArgument(1);
		return new ContractCalendar($clock, new DeadlineCalculator($systemConfig, $clock));
	}
}
```

- [ ] **Step 3: Write the failing terms test**

Create `tests/Unit/Contract/ContractTermsTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\Contract;

use OCA\Assinaturas\Contract\ContractRejected;
use OCA\Assinaturas\Contract\ContractTerms;
use OCA\Assinaturas\Db\ContractSource;
use PHPUnit\Framework\TestCase;

final class ContractTermsTest extends TestCase {
	private const FULL_INPUT = [
		'startsOn' => '2026-01-01',
		'endsOn' => '2026-12-31',
		'autoRenew' => true,
		'renewalTermMonths' => 12,
		'noticeDays' => 30,
		'valueCents' => 450000,
		'valueFrequency' => 'monthly',
		'counterpartyName' => '  Imobiliária Central Ltda  ',
		'counterpartyDocument' => '11.222.333/0001-81',
		'type' => ' Locação ',
		'alertDays' => [7, 90, 30, 7, 0],
	];

	public function testReadsAndNormalizesEveryField(): void {
		$this->assertSame([
			'startsOn' => '2026-01-01',
			'endsOn' => '2026-12-31',
			'autoRenew' => true,
			'renewalTermMonths' => 12,
			'noticeDays' => 30,
			'valueCents' => 450000,
			'valueFrequency' => 'monthly',
			'counterpartyName' => 'Imobiliária Central Ltda',
			'counterpartyDocument' => '11222333000181',
			'type' => 'Locação',
			'alertDays' => [90, 30, 7, 0],
			'source' => 'manual',
		], ContractTerms::fromInput(self::FULL_INPUT)->toArray());
	}

	public function testNeedsOnlyTheEndDate(): void {
		$terms = ContractTerms::fromInput(['endsOn' => '2027-03-31']);

		$this->assertNull($terms->startsOn);
		$this->assertFalse($terms->autoRenew);
		$this->assertNull($terms->valueCents);
		$this->assertSame([90, 30, 7, 0], $terms->alertDays);
		$this->assertSame(ContractSource::Manual, $terms->source);
	}

	public function testDropsTheRenewalTermOfAContractThatDoesNotRenewItself(): void {
		$this->assertNull(ContractTerms::fromInput(['endsOn' => '2027-03-31', 'renewalTermMonths' => 12])->renewalTermMonths);
	}

	public function testKeepsAnEmptyAlertListAsNoAlerts(): void {
		$this->assertSame([], ContractTerms::fromInput(['endsOn' => '2027-03-31', 'alertDays' => []])->alertDays);
	}

	public function testReadsNumbersSentAsText(): void {
		$terms = ContractTerms::fromInput(['endsOn' => '2027-03-31', 'noticeDays' => '45', 'valueCents' => '99900', 'valueFrequency' => 'yearly']);

		$this->assertSame([45, 99900], [$terms->noticeDays, $terms->valueCents]);
	}

	public function testKeysTheNoticeDeadlineOfAContractThatRenewsItself(): void {
		$this->assertSame('2026-12-01', ContractTerms::fromInput(self::FULL_INPUT)->keyDate());
	}

	public function testKeysTheEndOfAContractThatDoesNotRenewItself(): void {
		$this->assertSame('2026-12-31', ContractTerms::fromInput([...self::FULL_INPUT, 'autoRenew' => false])->keyDate());
	}

	/** @return array<string, array{array<string, mixed>, string}> */
	public static function invalidInputs(): array {
		return [
			'no end date' => [['startsOn' => '2026-01-01'], 'contract_ends_on_invalid'],
			'an end date that does not exist' => [['endsOn' => '2026-02-30'], 'contract_ends_on_invalid'],
			'a six-digit year' => [['endsOn' => '202612-01-01'], 'contract_ends_on_invalid'],
			'a start date that is not a date' => [['startsOn' => 'amanhã', 'endsOn' => '2026-12-31'], 'contract_starts_on_invalid'],
			'an end on the start date' => [['startsOn' => '2026-12-31', 'endsOn' => '2026-12-31'], 'contract_dates_invalid'],
			'an end before the start' => [['startsOn' => '2027-01-01', 'endsOn' => '2026-12-31'], 'contract_dates_invalid'],
			'automatic renewal that is not a boolean' => [['endsOn' => '2026-12-31', 'autoRenew' => 'sim'], 'contract_invalid'],
			'automatic renewal without a term' => [['endsOn' => '2026-12-31', 'autoRenew' => true], 'contract_renewal_term_invalid'],
			'a renewal term of zero months' => [['endsOn' => '2026-12-31', 'autoRenew' => true, 'renewalTermMonths' => 0], 'contract_renewal_term_invalid'],
			'a negative notice period' => [['endsOn' => '2026-12-31', 'noticeDays' => -1], 'contract_notice_invalid'],
			'a value of zero' => [['endsOn' => '2026-12-31', 'valueCents' => 0, 'valueFrequency' => 'once'], 'contract_value_invalid'],
			'a value with a fraction of a cent' => [['endsOn' => '2026-12-31', 'valueCents' => 10.5, 'valueFrequency' => 'once'], 'contract_value_invalid'],
			'a value without a frequency' => [['endsOn' => '2026-12-31', 'valueCents' => 1000], 'contract_frequency_invalid'],
			'an unknown frequency' => [['endsOn' => '2026-12-31', 'valueCents' => 1000, 'valueFrequency' => 'weekly'], 'contract_frequency_invalid'],
			'a counterparty name that is too long' => [['endsOn' => '2026-12-31', 'counterpartyName' => str_repeat('a', 256)], 'contract_counterparty_invalid'],
			'a CNPJ with a wrong check digit' => [['endsOn' => '2026-12-31', 'counterpartyDocument' => '11.222.333/0001-82'], 'contract_tax_id_invalid'],
			'a type that is too long' => [['endsOn' => '2026-12-31', 'type' => str_repeat('a', 101)], 'contract_type_invalid'],
			'an alert after the key date' => [['endsOn' => '2026-12-31', 'alertDays' => [-1]], 'contract_alert_days_invalid'],
			'too many alerts' => [['endsOn' => '2026-12-31', 'alertDays' => range(1, 11)], 'contract_alert_days_invalid'],
			'alerts that are not a list' => [['endsOn' => '2026-12-31', 'alertDays' => ['a' => 30]], 'contract_alert_days_invalid'],
			'an unknown source' => [['endsOn' => '2026-12-31', 'source' => 'robot'], 'contract_invalid'],
		];
	}

	/**
	 * @dataProvider invalidInputs
	 * @param array<string, mixed> $input
	 */
	public function testRejectsInvalidTermsWithTheirOwnCode(array $input, string $errorCode): void {
		try {
			ContractTerms::fromInput($input);
			$this->fail('The terms were accepted');
		} catch (ContractRejected $rejection) {
			$this->assertSame($errorCode, $rejection->errorCode);
			$this->assertSame(422, $rejection->httpStatus);
		}
	}

	public function testRejectsInputThatIsNotAnObject(): void {
		$this->expectExceptionObject(new ContractRejected('contract_invalid', 'The contract terms must be an object'));

		ContractTerms::fromInput('2026-12-31');
	}

	public function testRollsAYearlyTermForward(): void {
		$next = ContractTerms::fromInput(self::FULL_INPUT)->rolledForward();

		$this->assertSame(['2027-01-01', '2027-12-31', '2027-12-01'], [$next->startsOn, $next->endsOn, $next->keyDate()]);
	}

	public function testRollsATermThatEndsInFebruaryToTheLeapDay(): void {
		$next = ContractTerms::fromInput(['startsOn' => '2026-03-01', 'endsOn' => '2027-02-28', 'autoRenew' => true, 'renewalTermMonths' => 12])->rolledForward();

		$this->assertSame(['2027-03-01', '2028-02-29'], [$next->startsOn, $next->endsOn]);
	}

	public function testChangesSomeFieldsAndChecksThemAgain(): void {
		$terms = ContractTerms::fromInput(self::FULL_INPUT);

		$this->assertSame('2027-12-31', $terms->with(['endsOn' => '2027-12-31'])->endsOn);
		$this->expectException(ContractRejected::class);
		$terms->with(['valueCents' => 0]);
	}

	public function testWritesTheContractColumns(): void {
		$columns = ContractTerms::fromInput(self::FULL_INPUT)->columns();

		$this->assertSame('2026-12-01', $columns['key_date']);
		$this->assertSame('[90,30,7,0]', $columns['alert_days']);
		$this->assertSame('monthly', $columns['value_frequency']);
		$this->assertTrue($columns['auto_renew']);
	}
}
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `tests/env/phpunit.sh --filter 'TaxIdTest|ContractCalendarTest|ContractTermsTest'`
Expected: FAIL with `Error: Class "OCA\Assinaturas\Contract\TaxId" not found` (and the same for the other classes).

- [ ] **Step 5: Implement `TaxId`**

Create `lib/Contract/TaxId.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contract;

/**
 * A Brazilian tax id: a CPF (11 digits) or a CNPJ (14 characters). Since July 2026 a CNPJ may carry letters in its
 * first 12 characters; its check digits weigh each character as its code point minus 48, which keeps the numeric
 * CNPJs valid as before.
 */
final class TaxId {
	private const SEPARATORS = '/[\s.\/-]/';
	private const CPF_PATTERN = '/^\d{11}\z/';
	private const CNPJ_PATTERN = '/^[0-9A-Z]{12}\d{2}\z/';
	private const CPF_BASE_LENGTH = 9;
	private const CNPJ_BASE_LENGTH = 12;
	private const CNPJ_FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
	private const CNPJ_SECOND_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
	private const ZERO_CODE_POINT = 48;
	private const MODULUS = 11;
	private const CPF_TEN_IS_ZERO = 10;
	private const CNPJ_SMALL_REMAINDER = 2;

	/** Upper case, without dots, slashes, dashes or spaces: " 12.abc.345/01de-35 " → "12ABC34501DE35". */
	public static function normalize(string $text): string {
		return strtoupper((string)preg_replace(self::SEPARATORS, '', $text));
	}

	public static function isValid(string $normalized): bool {
		if (preg_match(self::CPF_PATTERN, $normalized) === 1) {
			return self::isValidCpf($normalized);
		}
		if (preg_match(self::CNPJ_PATTERN, $normalized) === 1) {
			return self::isValidCnpj($normalized);
		}
		return false;
	}

	private static function isValidCpf(string $digits): bool {
		if (self::isRepeated($digits)) {
			return false;
		}
		$values = self::values($digits);
		$base = array_slice($values, 0, self::CPF_BASE_LENGTH);
		$first = self::cpfDigit($base);
		return $first === $values[self::CPF_BASE_LENGTH] && self::cpfDigit([...$base, $first]) === $values[self::CPF_BASE_LENGTH + 1];
	}

	private static function isValidCnpj(string $characters): bool {
		if (self::isRepeated($characters)) {
			return false;
		}
		$values = self::values($characters);
		$base = array_slice($values, 0, self::CNPJ_BASE_LENGTH);
		$first = self::cnpjDigit($base, self::CNPJ_FIRST_WEIGHTS);
		return $first === $values[self::CNPJ_BASE_LENGTH] && self::cnpjDigit([...$base, $first], self::CNPJ_SECOND_WEIGHTS) === $values[self::CNPJ_BASE_LENGTH + 1];
	}

	/** @param list<int> $values weighed from length + 1 down to 2 */
	private static function cpfDigit(array $values): int {
		$sum = 0;
		$weight = count($values) + 1;
		foreach ($values as $value) {
			$sum += $value * $weight;
			$weight--;
		}
		$remainder = ($sum * 10) % self::MODULUS;
		return $remainder === self::CPF_TEN_IS_ZERO ? 0 : $remainder;
	}

	/**
	 * @param list<int> $values
	 * @param list<int> $weights
	 */
	private static function cnpjDigit(array $values, array $weights): int {
		$sum = 0;
		foreach ($values as $index => $value) {
			$sum += $value * $weights[$index];
		}
		$remainder = $sum % self::MODULUS;
		return $remainder < self::CNPJ_SMALL_REMAINDER ? 0 : self::MODULUS - $remainder;
	}

	/** @return list<int> each character's code point minus 48: digits weigh 0-9, letters 17-42 */
	private static function values(string $text): array {
		return array_map(fn (string $character): int => ord($character) - self::ZERO_CODE_POINT, str_split($text));
	}

	private static function isRepeated(string $text): bool {
		return count(array_unique(str_split($text))) === 1;
	}
}
```

- [ ] **Step 6: Implement `ContractCalendar`**

Create `lib/Contract/ContractCalendar.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contract;

use OCA\Assinaturas\Draft\DeadlineCalculator;
use OCP\AppFramework\Utility\ITimeFactory;

/**
 * Contract dates are calendar days (`YYYY-MM-DD`). Only "today" depends on a clock and a timezone (the instance's);
 * every other calculation is plain calendar math, done in UTC so no timezone shift moves a day.
 */
final class ContractCalendar {
	private const DATE_FORMAT = 'Y-m-d';
	private const DATE_PATTERN = '/^\d{4}-\d{2}-\d{2}\z/';
	private const EARLIEST_YEAR = 1900;
	private const LATEST_YEAR = 2199;
	private const SECONDS_PER_DAY = 86400;

	public function __construct(
		private ITimeFactory $timeFactory,
		private DeadlineCalculator $deadlines,
	) {
	}

	/** Today in the instance timezone. */
	public function today(): string {
		return (new \DateTimeImmutable('@' . $this->timeFactory->getTime()))->setTimezone($this->deadlines->timezone())->format(self::DATE_FORMAT);
	}

	/** A day that exists, in the years a contract can sensibly have (no 6-digit years from a date picker overflow). */
	public static function isDate(string $text): bool {
		if (preg_match(self::DATE_PATTERN, $text) !== 1) {
			return false;
		}
		[$year, $month, $day] = array_map('intval', explode('-', $text));
		return $year >= self::EARLIEST_YEAR && $year <= self::LATEST_YEAR && checkdate($month, $day, $year);
	}

	public static function addDays(string $date, int $days): string {
		return self::day($date)->modify(sprintf('%+d days', $days))->format(self::DATE_FORMAT);
	}

	/** The same day some months later, or that month's last day when it is shorter: 2026-01-31 + 1 month = 2026-02-28. */
	public static function addMonths(string $date, int $months): string {
		$day = self::day($date);
		$targetMonth = $day->modify('first day of this month')->modify(sprintf('%+d months', $months));
		$lastDayOfTarget = (int)$targetMonth->format('t');
		return $targetMonth->setDate((int)$targetMonth->format('Y'), (int)$targetMonth->format('n'), min((int)$day->format('j'), $lastDayOfTarget))->format(self::DATE_FORMAT);
	}

	/** Whole days from one date to another; negative when `$to` comes first. */
	public static function daysBetween(string $from, string $to): int {
		return intdiv(self::day($to)->getTimestamp() - self::day($from)->getTimestamp(), self::SECONDS_PER_DAY);
	}

	/** The date that matters: the notice deadline of a contract that renews itself, else its end. */
	public static function keyDate(string $endsOn, bool $autoRenew, ?int $noticeDays): string {
		return $autoRenew ? self::addDays($endsOn, -($noticeDays ?? 0)) : $endsOn;
	}

	private static function day(string $date): \DateTimeImmutable {
		$day = \DateTimeImmutable::createFromFormat('!' . self::DATE_FORMAT, $date, new \DateTimeZone('UTC'));
		if ($day === false) {
			throw new \InvalidArgumentException('Not a calendar date: ' . $date);
		}
		return $day;
	}
}
```

- [ ] **Step 7: Implement the limits, the rejection and the enums**

Create `lib/Contract/ContractLimits.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contract;

/** What a contract's fields accept. The frontend's `CONTRACT_LIMITS` mirrors these. */
final class ContractLimits {
	/** @var list<int> */
	public const DEFAULT_ALERT_DAYS = [90, 30, 7, 0];
	public const MAX_ALERTS = 10;
	public const MAX_ALERT_DAY = 3650;
	public const MAX_NOTICE_DAYS = 3650;
	public const MAX_RENEWAL_TERM_MONTHS = 120;
	public const MAX_VALUE_CENTS = 1_000_000_000_000_000;
	public const MAX_COUNTERPARTY_LENGTH = 255;
	public const MAX_TYPE_LENGTH = 100;
	public const MAX_END_REASON_LENGTH = 500;
	public const MAX_TYPE_SUGGESTIONS = 50;
}
```

Create `lib/Contract/ContractRejected.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contract;

use OCP\AppFramework\Http;

/** A contract input or action the user must fix or cannot do. The code is stable for the UI; the message is for developers. */
final class ContractRejected extends \RuntimeException {
	public function __construct(
		public readonly string $errorCode,
		string $message,
		public readonly int $httpStatus = Http::STATUS_UNPROCESSABLE_ENTITY,
	) {
		parent::__construct($message);
	}
}
```

Create `lib/Db/ValueFrequency.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

enum ValueFrequency: string {
	case Once = 'once';
	case Monthly = 'monthly';
	case Yearly = 'yearly';
}
```

Create `lib/Db/ContractSource.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

/** Who filled the terms in: a person, or a person who confirmed what the AI read (Plan 10). */
enum ContractSource: string {
	case Manual = 'manual';
	case AiConfirmed = 'ai_confirmed';
}
```

- [ ] **Step 8: Implement `ContractTerms`**

Create `lib/Contract/ContractTerms.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contract;

use OCA\Assinaturas\Db\ContractSource;
use OCA\Assinaturas\Db\ValueFrequency;

/**
 * A contract's terms, validated. One shape for the terms held with a draft's documents, a contract row and the API.
 * Problems are found in field order, each with its own code.
 */
final class ContractTerms {
	private const INTEGER_PATTERN = '/^-?\d{1,18}\z/';

	/**
	 * @param list<int> $alertDays distinct offsets in days before the key date, largest first
	 */
	public function __construct(
		public readonly ?string $startsOn,
		public readonly string $endsOn,
		public readonly bool $autoRenew,
		public readonly ?int $renewalTermMonths,
		public readonly ?int $noticeDays,
		public readonly ?int $valueCents,
		public readonly ?ValueFrequency $valueFrequency,
		public readonly ?string $counterpartyName,
		public readonly ?string $counterpartyDocument,
		public readonly ?string $type,
		public readonly array $alertDays,
		public readonly ContractSource $source,
	) {
	}

	/** @throws ContractRejected */
	public static function fromInput(mixed $input): self {
		if (!is_array($input)) {
			throw new ContractRejected('contract_invalid', 'The contract terms must be an object');
		}
		$startsOn = self::optionalDate($input['startsOn'] ?? null, 'contract_starts_on_invalid');
		$endsOn = self::optionalDate($input['endsOn'] ?? null, 'contract_ends_on_invalid')
			?? throw new ContractRejected('contract_ends_on_invalid', 'A contract needs its end date');
		if ($startsOn !== null && $endsOn <= $startsOn) {
			throw new ContractRejected('contract_dates_invalid', 'The end date must come after the start date');
		}
		$autoRenew = $input['autoRenew'] ?? false;
		if (!is_bool($autoRenew)) {
			throw new ContractRejected('contract_invalid', 'autoRenew must be a boolean');
		}
		$renewalTermMonths = $autoRenew ? self::renewalTerm($input['renewalTermMonths'] ?? null) : null;
		$noticeDays = self::noticeDays($input['noticeDays'] ?? null);
		[$valueCents, $valueFrequency] = self::value($input['valueCents'] ?? null, $input['valueFrequency'] ?? null);
		return new self(
			$startsOn,
			$endsOn,
			$autoRenew,
			$renewalTermMonths,
			$noticeDays,
			$valueCents,
			$valueFrequency,
			self::optionalText($input['counterpartyName'] ?? null, ContractLimits::MAX_COUNTERPARTY_LENGTH, 'contract_counterparty_invalid'),
			self::taxId($input['counterpartyDocument'] ?? null),
			self::optionalText($input['type'] ?? null, ContractLimits::MAX_TYPE_LENGTH, 'contract_type_invalid'),
			self::alertDays($input['alertDays'] ?? null),
			self::source($input['source'] ?? null),
		);
	}

	/**
	 * A copy with some fields replaced (API names), validated again.
	 *
	 * @param array<string, mixed> $changes
	 * @throws ContractRejected
	 */
	public function with(array $changes): self {
		return self::fromInput(array_replace($this->toArray(), $changes));
	}

	public function keyDate(): string {
		return ContractCalendar::keyDate($this->endsOn, $this->autoRenew, $this->noticeDays);
	}

	/** The next term of a contract that renews itself: it starts the day after this one ends and lasts the renewal term. */
	public function rolledForward(): self {
		$months = $this->renewalTermMonths ?? throw new \LogicException('Only a contract that renews itself rolls forward');
		$startsOn = ContractCalendar::addDays($this->endsOn, 1);
		return $this->with([
			'startsOn' => $startsOn,
			'endsOn' => ContractCalendar::addDays(ContractCalendar::addMonths($startsOn, $months), -1),
		]);
	}

	/**
	 * @return array{startsOn: ?string, endsOn: string, autoRenew: bool, renewalTermMonths: ?int, noticeDays: ?int, valueCents: ?int, valueFrequency: ?string, counterpartyName: ?string, counterpartyDocument: ?string, type: ?string, alertDays: list<int>, source: string}
	 */
	public function toArray(): array {
		return [
			'startsOn' => $this->startsOn,
			'endsOn' => $this->endsOn,
			'autoRenew' => $this->autoRenew,
			'renewalTermMonths' => $this->renewalTermMonths,
			'noticeDays' => $this->noticeDays,
			'valueCents' => $this->valueCents,
			'valueFrequency' => $this->valueFrequency?->value,
			'counterpartyName' => $this->counterpartyName,
			'counterpartyDocument' => $this->counterpartyDocument,
			'type' => $this->type,
			'alertDays' => $this->alertDays,
			'source' => $this->source->value,
		];
	}

	/** @return array<string, scalar|null> the contract row's term columns, the key date included */
	public function columns(): array {
		return [
			'starts_on' => $this->startsOn,
			'ends_on' => $this->endsOn,
			'key_date' => $this->keyDate(),
			'auto_renew' => $this->autoRenew,
			'renewal_term_months' => $this->renewalTermMonths,
			'notice_days' => $this->noticeDays,
			'value_cents' => $this->valueCents,
			'value_frequency' => $this->valueFrequency?->value,
			'counterparty_name' => $this->counterpartyName,
			'counterparty_document' => $this->counterpartyDocument,
			'type' => $this->type,
			'alert_days' => json_encode($this->alertDays, JSON_THROW_ON_ERROR),
			'source' => $this->source->value,
		];
	}

	/** @throws ContractRejected */
	private static function optionalDate(mixed $value, string $errorCode): ?string {
		if ($value === null || $value === '') {
			return null;
		}
		if (!is_string($value) || !ContractCalendar::isDate($value)) {
			throw new ContractRejected($errorCode, 'Dates are YYYY-MM-DD and must exist');
		}
		return $value;
	}

	/** @throws ContractRejected */
	private static function renewalTerm(mixed $value): int {
		return self::boundedInteger($value, 1, ContractLimits::MAX_RENEWAL_TERM_MONTHS)
			?? throw new ContractRejected('contract_renewal_term_invalid', 'A contract that renews itself needs a renewal term of 1 to ' . ContractLimits::MAX_RENEWAL_TERM_MONTHS . ' months');
	}

	/** @throws ContractRejected */
	private static function noticeDays(mixed $value): ?int {
		if ($value === null || $value === '') {
			return null;
		}
		return self::boundedInteger($value, 0, ContractLimits::MAX_NOTICE_DAYS)
			?? throw new ContractRejected('contract_notice_invalid', 'The notice period is 0 to ' . ContractLimits::MAX_NOTICE_DAYS . ' days');
	}

	/**
	 * @return array{?int, ?ValueFrequency} no frequency without a value
	 * @throws ContractRejected
	 */
	private static function value(mixed $cents, mixed $frequency): array {
		if ($cents === null || $cents === '') {
			return [null, null];
		}
		$valueCents = self::boundedInteger($cents, 1, ContractLimits::MAX_VALUE_CENTS)
			?? throw new ContractRejected('contract_value_invalid', 'The value is a positive number of cents');
		$valueFrequency = (is_string($frequency) ? ValueFrequency::tryFrom($frequency) : null)
			?? throw new ContractRejected('contract_frequency_invalid', 'A value is charged once, monthly or yearly');
		return [$valueCents, $valueFrequency];
	}

	/** @throws ContractRejected */
	private static function optionalText(mixed $value, int $maxLength, string $errorCode): ?string {
		if ($value === null) {
			return null;
		}
		if (!is_string($value) || mb_strlen(trim($value)) > $maxLength) {
			throw new ContractRejected($errorCode, 'Text of up to ' . $maxLength . ' characters');
		}
		$text = trim($value);
		return $text === '' ? null : $text;
	}

	/** @throws ContractRejected */
	private static function taxId(mixed $value): ?string {
		if ($value === null || $value === '') {
			return null;
		}
		$normalized = is_string($value) ? TaxId::normalize($value) : '';
		if (!TaxId::isValid($normalized)) {
			throw new ContractRejected('contract_tax_id_invalid', 'The counterparty document must be a CNPJ or CPF with valid check digits');
		}
		return $normalized;
	}

	/**
	 * @return list<int> distinct, largest first
	 * @throws ContractRejected
	 */
	private static function alertDays(mixed $value): array {
		if ($value === null) {
			return ContractLimits::DEFAULT_ALERT_DAYS;
		}
		$invalid = new ContractRejected('contract_alert_days_invalid', 'Alerts are up to ' . ContractLimits::MAX_ALERTS . ' offsets of 0 to ' . ContractLimits::MAX_ALERT_DAY . ' days');
		if (!is_array($value) || !array_is_list($value) || count($value) > ContractLimits::MAX_ALERTS) {
			throw $invalid;
		}
		$days = array_values(array_unique(array_map(fn (mixed $day): int => self::boundedInteger($day, 0, ContractLimits::MAX_ALERT_DAY) ?? throw $invalid, $value)));
		rsort($days);
		return $days;
	}

	/** @throws ContractRejected */
	private static function source(mixed $value): ContractSource {
		if ($value === null) {
			return ContractSource::Manual;
		}
		return (is_string($value) ? ContractSource::tryFrom($value) : null)
			?? throw new ContractRejected('contract_invalid', 'The source is manual or ai_confirmed');
	}

	private static function boundedInteger(mixed $value, int $min, int $max): ?int {
		$integer = self::integer($value);
		return $integer !== null && $integer >= $min && $integer <= $max ? $integer : null;
	}

	/** A JSON integer, or text holding exactly one ("30abc" is not). */
	private static function integer(mixed $value): ?int {
		if (is_int($value)) {
			return $value;
		}
		if (is_float($value) && is_finite($value) && floor($value) === $value) {
			return (int)$value;
		}
		if (is_string($value) && preg_match(self::INTEGER_PATTERN, $value) === 1) {
			return (int)$value;
		}
		return null;
	}
}
```

- [ ] **Step 9: Run the tests to see them pass**

Run: `tests/env/phpunit.sh --filter 'TaxIdTest|ContractCalendarTest|ContractTermsTest'`
Expected: `OK`.

- [ ] **Step 10: Commit**

```bash
git add lib/Contract lib/Db/ValueFrequency.php lib/Db/ContractSource.php tests/Unit/Contract
git commit -m "feat(contracts): validate contract terms, dates and CNPJ/CPF check digits"
```

---

### Task 3: Contract tables, entities and mappers

**Files:**
- Create: `lib/Migration/Version000700Date20261008000000.php`
- Create: `lib/Db/Contract.php`, `lib/Db/ContractMapper.php`, `lib/Db/ContractStatus.php`, `lib/Db/ContractAlert.php`, `lib/Db/ContractAlertMapper.php`
- Modify: `lib/Db/Document.php` (new `contractTerms`), `lib/Db/Envelope.php` (new `renewsContractId`), `lib/Db/DocumentMapper.php` (new `findById`), `lib/Contract/ContractTerms.php` (`fromContract`, `newContract`)
- Modify: `tests/Integration/EnvelopeCleanup.php` (removes contracts and alerts)
- Test: `tests/Integration/Db/ContractMapperTest.php` (new)

**Interfaces:**
- Consumes: `ContractTerms`, `ContractSource`, `ValueFrequency` (Task 2).
- Produces:
  - Tables `assinaturas_contracts` (`id, envelope_id, document_id UNIQUE, status, starts_on, ends_on, key_date, auto_renew, renewal_term_months, notice_days, value_cents, value_frequency, counterparty_name, counterparty_document, type, alert_days, continues_contract_id, source, end_reason, created_at, updated_at`; indexes `(status, key_date)`, `envelope_id`, `continues_contract_id`) and `assinaturas_contract_alerts` (`id, contract_id, key_date, offset_days, sent_at`, unique `(contract_id, key_date, offset_days)`); columns `assinaturas_documents.contract_terms` (JSON text, nullable) and `assinaturas_envelopes.renews_contract_id` (nullable).
  - `enum ContractStatus: string { Active = 'active'; Expired = 'expired'; Ended = 'ended'; Renewed = 'renewed' }`.
  - `Contract` entity (getters/setters per column, `getAlertDays(): list<int>`, `statusValue(): ContractStatus`).
  - `ContractMapper::TABLE`, `findById(int): Contract` (throws `DoesNotExistException`), `findByDocument(int): ?Contract`, `findByEnvelope(int): list<Contract>`, `findContinuing(int $contractId): ?Contract`, `findActiveAfter(int $afterId, int $limit): list<Contract>`, `usedTypes(int $limit): list<string>`, `envelopesWithUnactivatedTerms(int $limit): list<int>`, `insertIfNew(Contract): bool`, `transition(int $contractId, list<ContractStatus> $fromStatuses, ContractStatus $toStatus, int $now, array<string, scalar|null> $columns = [], array<string, scalar|null> $unchanged = []): bool`.
  - `ContractAlertMapper::TABLE`, `insertIfNew(ContractAlert): bool`, `offsetsFor(int $contractId, string $keyDate): list<int>`.
  - `Document::getContractTerms(): ?array` / `setContractTerms(?array)`; `Envelope::getRenewsContractId(): ?int` / `setRenewsContractId(?int)`; `DocumentMapper::findById(int): Document`.
  - `ContractTerms::fromContract(Contract): self`, `ContractTerms::newContract(int $envelopeId, int $documentId, ?int $continuesContractId, int $now): Contract` (status `active`).

- [ ] **Step 1: Write the failing mapper test**

Create `tests/Integration/Db/ContractMapperTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Db;

use OCA\Assinaturas\Contract\ContractTerms;
use OCA\Assinaturas\Db\Contract;
use OCA\Assinaturas\Db\ContractAlert;
use OCA\Assinaturas\Db\ContractAlertMapper;
use OCA\Assinaturas\Db\ContractMapper;
use OCA\Assinaturas\Db\ContractStatus;
use OCP\IDBConnection;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class ContractMapperTest extends TestCase {
	private const NOW = 1_790_000_000;
	private const KEY_DATE = '2026-12-01';

	/** @var list<int> */
	private array $documentIds = [];

	protected function tearDown(): void {
		$mapper = Server::get(ContractMapper::class);
		foreach ($this->documentIds as $documentId) {
			$contract = $mapper->findByDocument($documentId);
			if ($contract === null) {
				continue;
			}
			$query = Server::get(IDBConnection::class)->getQueryBuilder();
			$query->delete(ContractAlertMapper::TABLE)->where($query->expr()->eq('contract_id', $query->createNamedParameter($contract->getId())))->executeStatement();
			$mapper->delete($contract);
		}
		parent::tearDown();
	}

	public function testKeepsOneContractPerDocument(): void {
		$documentId = $this->unusedDocumentId();

		$this->assertTrue(Server::get(ContractMapper::class)->insertIfNew($this->newContract($documentId)));
		$this->assertFalse(Server::get(ContractMapper::class)->insertIfNew($this->newContract($documentId)));
		$this->assertSame(self::KEY_DATE, Server::get(ContractMapper::class)->findByDocument($documentId)?->getKeyDate());
	}

	public function testReadsTheTermsBackAsTheyWereStored(): void {
		$contract = $this->stored();

		$this->assertSame(ContractTerms::fromInput(self::terms())->toArray(), ContractTerms::fromContract(Server::get(ContractMapper::class)->findById($contract->getId()))->toArray());
	}

	public function testMovesAContractOnlyFromTheStatusesItNames(): void {
		$contract = $this->stored();
		$mapper = Server::get(ContractMapper::class);

		$this->assertFalse($mapper->transition($contract->getId(), [ContractStatus::Expired], ContractStatus::Ended, self::NOW));
		$this->assertTrue($mapper->transition($contract->getId(), [ContractStatus::Active], ContractStatus::Ended, self::NOW, ['end_reason' => 'Distrato']));

		$ended = $mapper->findById($contract->getId());
		$this->assertSame(ContractStatus::Ended, $ended->statusValue());
		$this->assertSame('Distrato', $ended->getEndReason());
	}

	public function testSkipsAChangeWhenAnotherWriteMovedTheEndFirst(): void {
		$contract = $this->stored();
		$mapper = Server::get(ContractMapper::class);

		$this->assertFalse($mapper->transition($contract->getId(), [ContractStatus::Active], ContractStatus::Active, self::NOW, ['ends_on' => '2027-12-31'], ['ends_on' => '2026-06-30']));
		$this->assertSame('2026-12-31', $mapper->findById($contract->getId())->getEndsOn());
	}

	public function testRefusesToWriteAColumnOutsideTheTerms(): void {
		$this->expectException(\InvalidArgumentException::class);

		Server::get(ContractMapper::class)->transition(1, [ContractStatus::Active], ContractStatus::Active, self::NOW, ['envelope_id' => 2]);
	}

	public function testPagesThroughTheActiveContractsById(): void {
		$first = $this->stored();
		$ended = $this->stored();
		Server::get(ContractMapper::class)->transition($ended->getId(), [ContractStatus::Active], ContractStatus::Ended, self::NOW);
		$second = $this->stored();

		$page = Server::get(ContractMapper::class)->findActiveAfter($first->getId(), 1);

		$this->assertSame([$second->getId()], array_map(fn (Contract $contract): int => $contract->getId(), $page));
	}

	public function testFindsTheContractThatRenewsAnother(): void {
		$older = $this->stored();
		$newer = $this->stored($older->getId());

		$this->assertSame($newer->getId(), Server::get(ContractMapper::class)->findContinuing($older->getId())?->getId());
		$this->assertNull(Server::get(ContractMapper::class)->findContinuing($newer->getId()));
	}

	public function testListsEachTypeInUseOnceAlphabetically(): void {
		$this->stored(null, 'Serviços');
		$this->stored(null, 'Locação');
		$this->stored(null, 'Locação');

		$types = Server::get(ContractMapper::class)->usedTypes(50);

		$this->assertSame(['Locação', 'Serviços'], array_values(array_intersect($types, ['Locação', 'Serviços'])));
	}

	public function testRecordsEachAlertOnce(): void {
		$contract = $this->stored();
		$alertMapper = Server::get(ContractAlertMapper::class);

		$this->assertTrue($alertMapper->insertIfNew($this->alert($contract, 30)));
		$this->assertFalse($alertMapper->insertIfNew($this->alert($contract, 30)));
		$this->assertTrue($alertMapper->insertIfNew($this->alert($contract, 7)));

		$recorded = $alertMapper->offsetsFor($contract->getId(), self::KEY_DATE);
		sort($recorded);
		$this->assertSame([7, 30], $recorded);
		$this->assertSame([], $alertMapper->offsetsFor($contract->getId(), '2027-12-01'));
	}

	/** @return array<string, mixed> */
	private static function terms(?string $type = 'Locação'): array {
		return ['startsOn' => '2026-01-01', 'endsOn' => '2026-12-31', 'autoRenew' => true, 'renewalTermMonths' => 12, 'noticeDays' => 30, 'type' => $type, 'valueCents' => 450000, 'valueFrequency' => 'monthly'];
	}

	private function newContract(int $documentId, ?int $continues = null, ?string $type = 'Locação'): Contract {
		return ContractTerms::fromInput(self::terms($type))->newContract(random_int(1_000_000, 9_999_999), $documentId, $continues, self::NOW);
	}

	private function stored(?int $continues = null, ?string $type = 'Locação'): Contract {
		return Server::get(ContractMapper::class)->insert($this->newContract($this->unusedDocumentId(), $continues, $type));
	}

	private function alert(Contract $contract, int $offset): ContractAlert {
		$alert = new ContractAlert();
		$alert->setContractId($contract->getId());
		$alert->setKeyDate(self::KEY_DATE);
		$alert->setOffsetDays($offset);
		$alert->setSentAt(self::NOW);
		return $alert;
	}

	private function unusedDocumentId(): int {
		$documentId = random_int(1_000_000_000, 9_000_000_000);
		$this->documentIds[] = $documentId;
		return $documentId;
	}
}
```

- [ ] **Step 2: Run the test to see it fail**

Run: `tests/env/phpunit.sh --filter ContractMapperTest`
Expected: FAIL with `Error: Class "OCA\Assinaturas\Db\ContractMapper" not found`.

- [ ] **Step 3: Write the migration**

Create `lib/Migration/Version000700Date20261008000000.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Contract management: signed contracts, their alert dedup, the terms a draft's documents hold until everyone signs,
 * and the contract a renewal envelope renews.
 */
final class Version000700Date20261008000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$this->createContracts($schema);
		$this->createContractAlerts($schema);
		$this->addHeldTerms($schema);
		$this->addRenewedContract($schema);
		return $schema;
	}

	private function createContracts(ISchemaWrapper $schema): void {
		if ($schema->hasTable('assinaturas_contracts')) {
			return;
		}
		$table = $schema->createTable('assinaturas_contracts');
		$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$table->addColumn('envelope_id', Types::BIGINT, ['notnull' => true]);
		$table->addColumn('document_id', Types::BIGINT, ['notnull' => true]);
		$table->addColumn('status', Types::STRING, ['notnull' => true, 'length' => 16, 'default' => 'active']);
		$table->addColumn('starts_on', Types::STRING, ['notnull' => false, 'length' => 10]);
		$table->addColumn('ends_on', Types::STRING, ['notnull' => true, 'length' => 10]);
		$table->addColumn('key_date', Types::STRING, ['notnull' => true, 'length' => 10]);
		$table->addColumn('auto_renew', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
		$table->addColumn('renewal_term_months', Types::INTEGER, ['notnull' => false]);
		$table->addColumn('notice_days', Types::INTEGER, ['notnull' => false]);
		$table->addColumn('value_cents', Types::BIGINT, ['notnull' => false]);
		$table->addColumn('value_frequency', Types::STRING, ['notnull' => false, 'length' => 16]);
		$table->addColumn('counterparty_name', Types::STRING, ['notnull' => false, 'length' => 255]);
		$table->addColumn('counterparty_document', Types::STRING, ['notnull' => false, 'length' => 14]);
		$table->addColumn('type', Types::STRING, ['notnull' => false, 'length' => 100]);
		$table->addColumn('alert_days', Types::TEXT, ['notnull' => false]);
		$table->addColumn('continues_contract_id', Types::BIGINT, ['notnull' => false]);
		$table->addColumn('source', Types::STRING, ['notnull' => true, 'length' => 16, 'default' => 'manual']);
		$table->addColumn('end_reason', Types::TEXT, ['notnull' => false]);
		$table->addColumn('created_at', Types::BIGINT, ['notnull' => true]);
		$table->addColumn('updated_at', Types::BIGINT, ['notnull' => true]);
		$table->setPrimaryKey(['id']);
		$table->addUniqueIndex(['document_id'], 'assin_ctr_document_uniq');
		$table->addIndex(['envelope_id'], 'assin_ctr_envelope');
		$table->addIndex(['status', 'key_date'], 'assin_ctr_status_key');
		$table->addIndex(['continues_contract_id'], 'assin_ctr_continues');
	}

	private function createContractAlerts(ISchemaWrapper $schema): void {
		if ($schema->hasTable('assinaturas_contract_alerts')) {
			return;
		}
		$table = $schema->createTable('assinaturas_contract_alerts');
		$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$table->addColumn('contract_id', Types::BIGINT, ['notnull' => true]);
		$table->addColumn('key_date', Types::STRING, ['notnull' => true, 'length' => 10]);
		$table->addColumn('offset_days', Types::INTEGER, ['notnull' => true]);
		$table->addColumn('sent_at', Types::BIGINT, ['notnull' => true]);
		$table->setPrimaryKey(['id']);
		$table->addUniqueIndex(['contract_id', 'key_date', 'offset_days'], 'assin_cal_dedupe_uniq');
	}

	private function addHeldTerms(ISchemaWrapper $schema): void {
		$table = $schema->getTable('assinaturas_documents');
		if ($table->hasColumn('contract_terms')) {
			return;
		}
		$table->addColumn('contract_terms', Types::TEXT, ['notnull' => false]);
	}

	private function addRenewedContract(ISchemaWrapper $schema): void {
		$table = $schema->getTable('assinaturas_envelopes');
		if ($table->hasColumn('renews_contract_id')) {
			return;
		}
		$table->addColumn('renews_contract_id', Types::BIGINT, ['notnull' => false]);
	}
}
```

- [ ] **Step 4: Create the status enum and the contract entity**

Create `lib/Db/ContractStatus.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

/**
 * Vigente, Vencido, Encerrado, Renovado (replaced by a newer contract). "A vencer" is not a status: it is computed
 * from the key date. Terms waiting for signatures have no contract row yet.
 */
enum ContractStatus: string {
	case Active = 'active';
	case Expired = 'expired';
	case Ended = 'ended';
	case Renewed = 'renewed';
}
```

Create `lib/Db/Contract.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

use OCP\AppFramework\Db\Entity;
use OCP\DB\Types;

/**
 * A signed contract: one per document. `keyDate` is stored so listings sort and filter by it in SQL; it is rewritten
 * with every change of the terms.
 *
 * @method int getEnvelopeId()
 * @method void setEnvelopeId(int $envelopeId)
 * @method int getDocumentId()
 * @method void setDocumentId(int $documentId)
 * @method string getStatus()
 * @method void setStatus(string $status)
 * @method string|null getStartsOn()
 * @method void setStartsOn(?string $startsOn)
 * @method string getEndsOn()
 * @method void setEndsOn(string $endsOn)
 * @method string getKeyDate()
 * @method void setKeyDate(string $keyDate)
 * @method bool getAutoRenew()
 * @method void setAutoRenew(bool $autoRenew)
 * @method int|null getRenewalTermMonths()
 * @method void setRenewalTermMonths(?int $renewalTermMonths)
 * @method int|null getNoticeDays()
 * @method void setNoticeDays(?int $noticeDays)
 * @method int|null getValueCents()
 * @method void setValueCents(?int $valueCents)
 * @method string|null getValueFrequency()
 * @method void setValueFrequency(?string $valueFrequency)
 * @method string|null getCounterpartyName()
 * @method void setCounterpartyName(?string $counterpartyName)
 * @method string|null getCounterpartyDocument()
 * @method void setCounterpartyDocument(?string $counterpartyDocument)
 * @method string|null getType()
 * @method void setType(?string $type)
 * @method list<int> getAlertDays()
 * @method void setAlertDays(array $alertDays)
 * @method int|null getContinuesContractId()
 * @method void setContinuesContractId(?int $continuesContractId)
 * @method string getSource()
 * @method void setSource(string $source)
 * @method string|null getEndReason()
 * @method void setEndReason(?string $endReason)
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $createdAt)
 * @method int getUpdatedAt()
 * @method void setUpdatedAt(int $updatedAt)
 */
final class Contract extends Entity {
	private const FIELD_TYPES = [
		'envelopeId' => Types::BIGINT,
		'documentId' => Types::BIGINT,
		'status' => Types::STRING,
		'startsOn' => Types::STRING,
		'endsOn' => Types::STRING,
		'keyDate' => Types::STRING,
		'autoRenew' => Types::BOOLEAN,
		'renewalTermMonths' => Types::INTEGER,
		'noticeDays' => Types::INTEGER,
		'valueCents' => Types::BIGINT,
		'valueFrequency' => Types::STRING,
		'counterpartyName' => Types::STRING,
		'counterpartyDocument' => Types::STRING,
		'type' => Types::STRING,
		'alertDays' => Types::JSON,
		'continuesContractId' => Types::BIGINT,
		'source' => Types::STRING,
		'endReason' => Types::TEXT,
		'createdAt' => Types::BIGINT,
		'updatedAt' => Types::BIGINT,
	];

	protected $envelopeId = 0;
	protected $documentId = 0;
	protected $status = 'active';
	protected $startsOn;
	protected $endsOn = '';
	protected $keyDate = '';
	protected $autoRenew = false;
	protected $renewalTermMonths;
	protected $noticeDays;
	protected $valueCents;
	protected $valueFrequency;
	protected $counterpartyName;
	protected $counterpartyDocument;
	protected $type;
	protected $alertDays = [];
	protected $continuesContractId;
	protected $source = 'manual';
	protected $endReason;
	protected $createdAt = 0;
	protected $updatedAt = 0;

	public function __construct() {
		foreach (self::FIELD_TYPES as $field => $type) {
			$this->addType($field, $type);
			$this->markFieldUpdated($field);
		}
	}

	public function statusValue(): ContractStatus {
		return ContractStatus::from($this->getStatus());
	}
}
```

- [ ] **Step 5: Create the contract mapper**

Create `lib/Db/ContractMapper.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\Exception;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @template-extends QBMapper<Contract>
 */
final class ContractMapper extends QBMapper {
	public const TABLE = 'assinaturas_contracts';
	/** The term columns a transition may write or check; status, ids and timestamps are the mapper's own. */
	private const TRANSITION_COLUMNS = ['starts_on', 'ends_on', 'key_date', 'auto_renew', 'renewal_term_months', 'notice_days', 'value_cents', 'value_frequency', 'counterparty_name', 'counterparty_document', 'type', 'alert_days', 'source', 'end_reason'];
	private const PARAMETER_TYPES = ['NULL' => IQueryBuilder::PARAM_NULL, 'integer' => IQueryBuilder::PARAM_INT, 'string' => IQueryBuilder::PARAM_STR, 'boolean' => IQueryBuilder::PARAM_BOOL];

	public function __construct(IDBConnection $db) {
		parent::__construct($db, self::TABLE, Contract::class);
	}

	/** @throws DoesNotExistException */
	public function findById(int $contractId): Contract {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->eq('id', $query->createNamedParameter($contractId, IQueryBuilder::PARAM_INT)));
		return $this->findEntity($query);
	}

	public function findByDocument(int $documentId): ?Contract {
		return $this->firstWhere('document_id', $documentId);
	}

	/** The contract that renews this one, once its envelope completed; the oldest when two renewals both completed. */
	public function findContinuing(int $contractId): ?Contract {
		return $this->firstWhere('continues_contract_id', $contractId);
	}

	/** @return list<Contract> */
	public function findByEnvelope(int $envelopeId): array {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->eq('envelope_id', $query->createNamedParameter($envelopeId, IQueryBuilder::PARAM_INT)))
			->orderBy('id', 'ASC');
		return $this->findEntities($query);
	}

	/** @return list<Contract> active contracts with a larger id, by id: the daily job pages through them */
	public function findActiveAfter(int $afterId, int $limit): array {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->eq('status', $query->createNamedParameter(ContractStatus::Active->value)))
			->andWhere($query->expr()->gt('id', $query->createNamedParameter($afterId, IQueryBuilder::PARAM_INT)))
			->orderBy('id', 'ASC')
			->setMaxResults($limit);
		return $this->findEntities($query);
	}

	/** @return list<string> the types this instance's contracts use, each once, alphabetically */
	public function usedTypes(int $limit): array {
		$query = $this->db->getQueryBuilder();
		$query->selectDistinct('type')
			->from(self::TABLE)
			->where($query->expr()->isNotNull('type'))
			->orderBy('type', 'ASC')
			->setMaxResults($limit);
		$result = $query->executeQuery();
		$types = [];
		while (($row = $result->fetch()) !== false) {
			$types[] = (string)$row['type'];
		}
		$result->closeCursor();
		return $types;
	}

	/** @return list<int> completed envelopes holding terms on a document that has no contract yet */
	public function envelopesWithUnactivatedTerms(int $limit): array {
		$query = $this->db->getQueryBuilder();
		$query->selectDistinct('d.envelope_id')
			->from(DocumentMapper::TABLE, 'd')
			->innerJoin('d', EnvelopeMapper::TABLE, 'e', $query->expr()->eq('e.id', 'd.envelope_id'))
			->leftJoin('d', self::TABLE, 'c', $query->expr()->eq('c.document_id', 'd.id'))
			->where($query->expr()->isNotNull('d.contract_terms'))
			->andWhere($query->expr()->eq('e.status', $query->createNamedParameter(EnvelopeStatus::Completed->value)))
			->andWhere($query->expr()->isNull('c.id'))
			->setMaxResults($limit);
		$result = $query->executeQuery();
		$envelopeIds = [];
		while (($row = $result->fetch()) !== false) {
			$envelopeIds[] = (int)$row['envelope_id'];
		}
		$result->closeCursor();
		return $envelopeIds;
	}

	/**
	 * Inserts the contract unless its document already has one. Must not run inside an open transaction on Postgres:
	 * a unique violation aborts the whole transaction there.
	 *
	 * @throws Exception on any database error other than a document that already has a contract
	 */
	public function insertIfNew(Contract $contract): bool {
		try {
			$this->insert($contract);
			return true;
		} catch (Exception $exception) {
			if ($exception->getReason() !== Exception::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $exception;
			}
			return false;
		}
	}

	/**
	 * Moves a contract from one of `$fromStatuses` to `$toStatus`, writing `$columns`, only while the `$unchanged`
	 * columns still hold those values: a person's action and the daily job never overwrite each other's change.
	 *
	 * @param list<ContractStatus> $fromStatuses
	 * @param array<string, scalar|null> $columns
	 * @param array<string, scalar|null> $unchanged
	 */
	public function transition(int $contractId, array $fromStatuses, ContractStatus $toStatus, int $now, array $columns = [], array $unchanged = []): bool {
		$unknownColumns = array_diff([...array_keys($columns), ...array_keys($unchanged)], self::TRANSITION_COLUMNS);
		if ($unknownColumns !== []) {
			throw new \InvalidArgumentException('A transition cannot write or check ' . implode(', ', $unknownColumns));
		}
		$query = $this->db->getQueryBuilder();
		$query->update(self::TABLE)
			->set('status', $query->createNamedParameter($toStatus->value))
			->set('updated_at', $query->createNamedParameter($now, IQueryBuilder::PARAM_INT))
			->where($query->expr()->eq('id', $query->createNamedParameter($contractId, IQueryBuilder::PARAM_INT)))
			->andWhere($query->expr()->in('status', $query->createNamedParameter(array_map(fn (ContractStatus $status): string => $status->value, $fromStatuses), IQueryBuilder::PARAM_STR_ARRAY)));
		foreach ($columns as $column => $value) {
			$query->set($column, $query->createNamedParameter($value, self::PARAMETER_TYPES[gettype($value)]));
		}
		foreach ($unchanged as $column => $value) {
			$query->andWhere($value === null
				? $query->expr()->isNull($column)
				: $query->expr()->eq($column, $query->createNamedParameter($value, self::PARAMETER_TYPES[gettype($value)])));
		}
		return $query->executeStatement() === 1;
	}

	private function firstWhere(string $column, int $value): ?Contract {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->eq($column, $query->createNamedParameter($value, IQueryBuilder::PARAM_INT)))
			->orderBy('id', 'ASC')
			->setMaxResults(1);
		return $this->findEntities($query)[0] ?? null;
	}
}
```

- [ ] **Step 6: Create the alert entity and mapper**

Create `lib/Db/ContractAlert.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

use OCP\AppFramework\Db\Entity;
use OCP\DB\Types;

/**
 * One alert of a contract, sent (or counted as sent) for a key date and an offset. The unique triple is the dedup.
 *
 * @method int getContractId()
 * @method void setContractId(int $contractId)
 * @method string getKeyDate()
 * @method void setKeyDate(string $keyDate)
 * @method int getOffsetDays()
 * @method void setOffsetDays(int $offsetDays)
 * @method int getSentAt()
 * @method void setSentAt(int $sentAt)
 */
final class ContractAlert extends Entity {
	private const FIELD_TYPES = [
		'contractId' => Types::BIGINT,
		'keyDate' => Types::STRING,
		'offsetDays' => Types::INTEGER,
		'sentAt' => Types::BIGINT,
	];

	protected $contractId = 0;
	protected $keyDate = '';
	protected $offsetDays = 0;
	protected $sentAt = 0;

	public function __construct() {
		foreach (self::FIELD_TYPES as $field => $type) {
			$this->addType($field, $type);
			$this->markFieldUpdated($field);
		}
	}
}
```

Create `lib/Db/ContractAlertMapper.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\DB\Exception;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @template-extends QBMapper<ContractAlert>
 */
final class ContractAlertMapper extends QBMapper {
	public const TABLE = 'assinaturas_contract_alerts';

	public function __construct(IDBConnection $db) {
		parent::__construct($db, self::TABLE, ContractAlert::class);
	}

	/**
	 * Records the alert unless it was recorded before. Must not run inside an open transaction on Postgres.
	 *
	 * @throws Exception on any database error other than a duplicate alert
	 */
	public function insertIfNew(ContractAlert $alert): bool {
		try {
			$this->insert($alert);
			return true;
		} catch (Exception $exception) {
			if ($exception->getReason() !== Exception::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $exception;
			}
			return false;
		}
	}

	/** @return list<int> the offsets already recorded for this key date */
	public function offsetsFor(int $contractId, string $keyDate): array {
		$query = $this->db->getQueryBuilder();
		$query->select('offset_days')
			->from(self::TABLE)
			->where($query->expr()->eq('contract_id', $query->createNamedParameter($contractId, IQueryBuilder::PARAM_INT)))
			->andWhere($query->expr()->eq('key_date', $query->createNamedParameter($keyDate)));
		$result = $query->executeQuery();
		$offsets = [];
		while (($row = $result->fetch()) !== false) {
			$offsets[] = (int)$row['offset_days'];
		}
		$result->closeCursor();
		return $offsets;
	}
}
```

- [ ] **Step 7: Give documents and envelopes their new columns**

In `lib/Db/Document.php`:
- add to the docblock: ` * @method array<string, mixed>|null getContractTerms()` and ` * @method void setContractTerms(?array $contractTerms)`;
- add `'contractTerms' => Types::JSON,` as the last entry of `FIELD_TYPES`;
- add the property `protected $contractTerms;` after `protected $saveStatus = 'pending';`.

In `lib/Db/Envelope.php`:
- add to the docblock: ` * @method int|null getRenewsContractId()` and ` * @method void setRenewsContractId(?int $renewsContractId)`;
- add `'renewsContractId' => Types::BIGINT,` as the last entry of `FIELD_TYPES`;
- add the property `protected $renewsContractId;` after the last property.

In `lib/Db/DocumentMapper.php`, add after `findByEnvelope()`:

```php
	/** @throws DoesNotExistException */
	public function findById(int $documentId): Document {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->eq('id', $query->createNamedParameter($documentId, IQueryBuilder::PARAM_INT)));
		return $this->findEntity($query);
	}
```

- [ ] **Step 8: Build contracts from terms and back**

In `lib/Contract/ContractTerms.php`, add the imports `use OCA\Assinaturas\Db\Contract;` and `use OCA\Assinaturas\Db\ContractStatus;`, and add after `fromInput()`:

```php
	/** The terms a stored contract holds; the row was validated when written. */
	public static function fromContract(Contract $contract): self {
		$frequency = $contract->getValueFrequency();
		return new self(
			$contract->getStartsOn(),
			$contract->getEndsOn(),
			$contract->getAutoRenew(),
			$contract->getRenewalTermMonths(),
			$contract->getNoticeDays(),
			$contract->getValueCents(),
			$frequency === null ? null : ValueFrequency::from($frequency),
			$contract->getCounterpartyName(),
			$contract->getCounterpartyDocument(),
			$contract->getType(),
			array_values(array_map('intval', $contract->getAlertDays())),
			ContractSource::from($contract->getSource()),
		);
	}

	/** An active contract with these terms for a signed document. */
	public function newContract(int $envelopeId, int $documentId, ?int $continuesContractId, int $now): Contract {
		$contract = new Contract();
		$contract->setEnvelopeId($envelopeId);
		$contract->setDocumentId($documentId);
		$contract->setStatus(ContractStatus::Active->value);
		$contract->setStartsOn($this->startsOn);
		$contract->setEndsOn($this->endsOn);
		$contract->setKeyDate($this->keyDate());
		$contract->setAutoRenew($this->autoRenew);
		$contract->setRenewalTermMonths($this->renewalTermMonths);
		$contract->setNoticeDays($this->noticeDays);
		$contract->setValueCents($this->valueCents);
		$contract->setValueFrequency($this->valueFrequency?->value);
		$contract->setCounterpartyName($this->counterpartyName);
		$contract->setCounterpartyDocument($this->counterpartyDocument);
		$contract->setType($this->type);
		$contract->setAlertDays($this->alertDays);
		$contract->setContinuesContractId($continuesContractId);
		$contract->setSource($this->source->value);
		$contract->setEndReason(null);
		$contract->setCreatedAt($now);
		$contract->setUpdatedAt($now);
		return $contract;
	}
```

- [ ] **Step 9: Clean contracts up in the test cleanup**

Replace `tests/Integration/EnvelopeCleanup.php` with:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration;

use OCA\Assinaturas\Db\ContractAlertMapper;
use OCA\Assinaturas\Db\ContractMapper;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EventMapper;
use OCA\Assinaturas\Db\FieldMapper;
use OCA\Assinaturas\Db\SignerMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;
use OCP\Server;

/** Removes every envelope row a test created for the given users, their contracts and contract alerts included. */
trait EnvelopeCleanup {
	/** @param list<string> $userIds */
	private function deleteEnvelopesOf(array $userIds): void {
		$envelopeMapper = Server::get(EnvelopeMapper::class);
		$documentMapper = Server::get(DocumentMapper::class);
		$fieldMapper = Server::get(FieldMapper::class);
		$signerMapper = Server::get(SignerMapper::class);
		$eventMapper = Server::get(EventMapper::class);
		$contractMapper = Server::get(ContractMapper::class);
		foreach ($userIds as $userId) {
			foreach (OwnedEnvelopes::of($userId) as $envelope) {
				foreach ($contractMapper->findByEnvelope($envelope->getId()) as $contract) {
					self::deleteAlertsOf($contract->getId());
					$contractMapper->delete($contract);
				}
				foreach ($documentMapper->findByEnvelope($envelope->getId()) as $document) {
					foreach ($fieldMapper->findByDocument($document->getId()) as $field) {
						$fieldMapper->delete($field);
					}
					$documentMapper->delete($document);
				}
				foreach ($signerMapper->findByEnvelope($envelope->getId()) as $signer) {
					$signerMapper->delete($signer);
				}
				foreach ($eventMapper->findByEnvelope($envelope->getId()) as $event) {
					$eventMapper->delete($event);
				}
				$envelopeMapper->delete($envelope);
			}
		}
	}

	private static function deleteAlertsOf(int $contractId): void {
		$query = Server::get(IDBConnection::class)->getQueryBuilder();
		$query->delete(ContractAlertMapper::TABLE)
			->where($query->expr()->eq('contract_id', $query->createNamedParameter($contractId, IQueryBuilder::PARAM_INT)))
			->executeStatement();
	}
}
```

- [ ] **Step 10: Run the migration in the local env**

Run: `tests/env/php.sh occ migrations:execute assinaturas 000700Date20261008000000`
Expected: exits 0.

Run: `tests/env/php.sh occ migrations:status assinaturas | grep -i 'latest version'`
Expected: a line ending in `000700Date20261008000000`.

- [ ] **Step 11: Run the mapper test and the whole suite**

Run: `tests/env/phpunit.sh --filter ContractMapperTest`
Expected: `OK`.

Run: `tests/env/phpunit.sh`
Expected: `OK` (every test; the entities now write the two new columns).

- [ ] **Step 12: Commit**

```bash
git add lib/Migration/Version000700Date20261008000000.php lib/Db lib/Contract/ContractTerms.php tests/Integration/EnvelopeCleanup.php tests/Integration/Db/ContractMapperTest.php
git commit -m "feat(contracts): store contracts, alert dedup and terms held with documents"
```

---

### Task 4: Terms held with a draft's documents

**Files:**
- Create: `lib/Contract/ContractDrafts.php`
- Create: `lib/Controller/ContractController.php`
- Modify: `lib/Api/EnvelopeView.php` (`documents[].contractTerms`, `renewsContractId`)
- Test: `tests/Integration/Controller/ContractTermsControllerTest.php` (new)

**Interfaces:**
- Consumes: `ContractTerms::fromInput`, `ContractRejected`, `ContractSettings::isEnabled`, `AccessPolicy::canSee|canUseApp`, `Document::setContractTerms`.
- Produces:
  - `ContractDrafts::saveTerms(Envelope $envelope, list<mixed> $documents): void` — each entry `{documentId: int, terms: object|null}`; throws `ContractRejected` (`not_a_draft`, `document_not_found`, any terms code).
  - Route `PUT /api/v1/envelopes/{uuid}/contract-terms` body `{documents: [{documentId, terms|null}]}` → envelope detail; 403 `contracts_disabled`, 404 `not_found`, 403 `forbidden` (not the draft's owner), 422 codes.
  - Envelope detail: `documents[].contractTerms` (the `ContractTerms::toArray()` shape or null), `renewsContractId` (int or null).
  - `ContractController` private guards `onEnvelope()` and `handlingRejections()`, extended by Tasks 8 and 9.

- [ ] **Step 1: Write the failing test**

Create `tests/Integration/Controller/ContractTermsControllerTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Controller;

use OCA\Assinaturas\Access\ManagersGroup;
use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\Contract\ContractSettings;
use OCA\Assinaturas\Controller\ContractController;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\AppFramework\Http;
use OCP\IAppConfig;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class ContractTermsControllerTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;

	private const TERMS = [
		'startsOn' => '2026-01-01',
		'endsOn' => '2026-12-31',
		'counterpartyName' => 'Imobiliária Central Ltda',
		'counterpartyDocument' => '11.222.333/0001-81',
		'type' => 'Locação',
		'valueCents' => 450000,
		'valueFrequency' => 'monthly',
	];

	private string $owner;
	private Envelope $draft;

	protected function setUp(): void {
		parent::setUp();
		Server::get(ContractSettings::class)->setEnabled(true);
		$this->owner = $this->createUser();
		$this->addToGroup($this->owner, SignersGroup::GROUP_ID);
		$this->draft = Server::get(EnvelopeDrafts::class)->create($this->owner, 'Locação Sala 3', [
			$this->writeFile($this->owner, 'Contratos/Locação Sala 3.pdf', self::minimalPdf('contrato'))->getId(),
			$this->writeFile($this->owner, 'Contratos/Anexo I.pdf', self::minimalPdf('anexo'))->getId(),
		]);
	}

	protected function tearDown(): void {
		self::logout();
		Server::get(IAppConfig::class)->deleteKey(Application::APP_ID, ContractSettings::KEY_ENABLED);
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testHoldsTheTermsOfTheDraftsDocuments(): void {
		self::loginAsUser($this->owner);
		[$main, $annex] = $this->documentIds();

		$response = $this->controller()->saveTerms($this->draft->getUuid(), [
			['documentId' => $main, 'terms' => self::TERMS],
			['documentId' => $annex, 'terms' => null],
		]);

		$this->assertSame(Http::STATUS_OK, $response->getStatus());
		[$mainDetail, $annexDetail] = $response->getData()['documents'];
		$this->assertSame('2026-12-31', $mainDetail['contractTerms']['endsOn']);
		$this->assertSame('11222333000181', $mainDetail['contractTerms']['counterpartyDocument']);
		$this->assertSame([90, 30, 7, 0], $mainDetail['contractTerms']['alertDays']);
		$this->assertNull($annexDetail['contractTerms']);
		$this->assertNull($response->getData()['renewsContractId']);
	}

	public function testClearsTheTermsOfADocumentThatIsNoLongerAContract(): void {
		self::loginAsUser($this->owner);
		[$main] = $this->documentIds();
		$this->controller()->saveTerms($this->draft->getUuid(), [['documentId' => $main, 'terms' => self::TERMS]]);

		$this->controller()->saveTerms($this->draft->getUuid(), [['documentId' => $main, 'terms' => null]]);

		$this->assertNull($this->storedTerms($main));
	}

	public function testAnswersTheCodeOfInvalidTermsAndKeepsWhatWasHeld(): void {
		self::loginAsUser($this->owner);
		[$main] = $this->documentIds();

		$response = $this->controller()->saveTerms($this->draft->getUuid(), [['documentId' => $main, 'terms' => [...self::TERMS, 'endsOn' => '2026-02-30']]]);

		$this->assertSame(Http::STATUS_UNPROCESSABLE_ENTITY, $response->getStatus());
		$this->assertSame('contract_ends_on_invalid', $response->getData()['error']);
		$this->assertNull($this->storedTerms($main));
	}

	public function testRefusesADocumentOfAnotherEnvelope(): void {
		self::loginAsUser($this->owner);

		$response = $this->controller()->saveTerms($this->draft->getUuid(), [['documentId' => 987654321, 'terms' => self::TERMS]]);

		$this->assertSame(Http::STATUS_UNPROCESSABLE_ENTITY, $response->getStatus());
		$this->assertSame('document_not_found', $response->getData()['error']);
	}

	public function testLeavesTheTermsOfASentEnvelopeAlone(): void {
		self::loginAsUser($this->owner);
		[$main] = $this->documentIds();
		$sent = Server::get(EnvelopeMapper::class)->findById($this->draft->getId());
		$sent->setStatus(EnvelopeStatus::Pending->value);
		Server::get(EnvelopeMapper::class)->update($sent);

		$response = $this->controller()->saveTerms($this->draft->getUuid(), [['documentId' => $main, 'terms' => self::TERMS]]);

		$this->assertSame('not_a_draft', $response->getData()['error']);
	}

	public function testHidesTheDraftFromSomeoneWhoCannotSeeIt(): void {
		$stranger = $this->createUser();
		$this->addToGroup($stranger, SignersGroup::GROUP_ID);
		self::loginAsUser($stranger);
		[$main] = $this->documentIds();

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->saveTerms($this->draft->getUuid(), [['documentId' => $main, 'terms' => self::TERMS]])->getStatus());
	}

	public function testKeepsTheDraftToItsOwnerEvenForAManager(): void {
		$manager = $this->createUser();
		$this->addToGroup($manager, ManagersGroup::GROUP_ID);
		self::loginAsUser($manager);
		[$main] = $this->documentIds();

		$response = $this->controller()->saveTerms($this->draft->getUuid(), [['documentId' => $main, 'terms' => self::TERMS]]);

		$this->assertSame(Http::STATUS_FORBIDDEN, $response->getStatus());
		$this->assertNull($this->storedTerms($main));
	}

	public function testRefusesEverythingWhileTheAddOnIsOff(): void {
		Server::get(ContractSettings::class)->setEnabled(false);
		self::loginAsUser($this->owner);
		[$main] = $this->documentIds();

		$response = $this->controller()->saveTerms($this->draft->getUuid(), [['documentId' => $main, 'terms' => self::TERMS]]);

		$this->assertSame(Http::STATUS_FORBIDDEN, $response->getStatus());
		$this->assertSame('contracts_disabled', $response->getData()['error']);
	}

	/** @return list<int> */
	private function documentIds(): array {
		return array_map(fn ($document): int => $document->getId(), Server::get(DocumentMapper::class)->findByEnvelope($this->draft->getId()));
	}

	/** @return array<string, mixed>|null */
	private function storedTerms(int $documentId): ?array {
		return Server::get(DocumentMapper::class)->findById($documentId)->getContractTerms();
	}

	private function controller(): ContractController {
		return Server::get(ContractController::class);
	}
}
```

- [ ] **Step 2: Run the test to see it fail**

Run: `tests/env/phpunit.sh --filter ContractTermsControllerTest`
Expected: FAIL with `Error: Class "OCA\Assinaturas\Controller\ContractController" not found`.

- [ ] **Step 3: Implement `ContractDrafts`**

Create `lib/Contract/ContractDrafts.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contract;

use OCA\Assinaturas\Db\Document;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IDBConnection;

/**
 * The contract terms the wizard holds with a draft's documents. They wait there, shown as "Aguardando assinatura",
 * until everyone signs; only then does the envelope produce contracts (ContractActivation).
 */
final class ContractDrafts {
	public function __construct(
		private DocumentMapper $documentMapper,
		private EnvelopeMapper $envelopeMapper,
		private ITimeFactory $timeFactory,
		private IDBConnection $connection,
	) {
	}

	/**
	 * Replaces the terms of the listed documents; null terms mean "not a contract". Documents left out keep theirs.
	 * Nothing is written unless every entry is valid.
	 *
	 * @param list<mixed> $documents objects, each with documentId and terms
	 * @throws ContractRejected
	 */
	public function saveTerms(Envelope $envelope, array $documents): void {
		if ($envelope->statusValue() !== EnvelopeStatus::Draft) {
			throw new ContractRejected('not_a_draft', 'Only drafts can be changed');
		}
		$owned = [];
		foreach ($this->documentMapper->findByEnvelope($envelope->getId()) as $document) {
			$owned[$document->getId()] = $document;
		}
		$changes = array_map(fn (mixed $entry): array => self::change($entry, $owned), $documents);
		$this->connection->beginTransaction();
		try {
			foreach ($changes as [$document, $terms]) {
				$document->setContractTerms($terms?->toArray());
				$this->documentMapper->update($document);
			}
			$envelope->setUpdatedAt($this->timeFactory->getTime());
			$this->envelopeMapper->update($envelope);
			$this->connection->commit();
		} catch (\Throwable $failure) {
			$this->connection->rollBack();
			throw $failure;
		}
	}

	/**
	 * @param array<int, Document> $owned the draft's documents by id
	 * @return array{Document, ?ContractTerms}
	 * @throws ContractRejected
	 */
	private static function change(mixed $entry, array $owned): array {
		if (!is_array($entry) || !is_int($entry['documentId'] ?? null) || !isset($owned[$entry['documentId']])) {
			throw new ContractRejected('document_not_found', 'This document is not part of the envelope');
		}
		$terms = $entry['terms'] ?? null;
		return [$owned[$entry['documentId']], $terms === null ? null : ContractTerms::fromInput($terms)];
	}
}
```

- [ ] **Step 4: Implement the controller**

Create `lib/Controller/ContractController.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Controller;

use OCA\Assinaturas\Access\AccessPolicy;
use OCA\Assinaturas\Api\EnvelopeDetails;
use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\Contract\ContractDrafts;
use OCA\Assinaturas\Contract\ContractRejected;
use OCA\Assinaturas\Contract\ContractSettings;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\FrontpageRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;
use OCP\IUserSession;

/**
 * Contract routes. Every one needs the add-on; contracts follow their envelope's access (`canSee` reads, `canAct`
 * acts), and a draft's held terms stay with the draft's owner, like the rest of the wizard.
 */
final class ContractController extends Controller {
	public function __construct(
		IRequest $request,
		private IUserSession $userSession,
		private AccessPolicy $accessPolicy,
		private ContractSettings $settings,
		private EnvelopeMapper $envelopeMapper,
		private EnvelopeDetails $details,
		private ContractDrafts $drafts,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/** @param list<mixed> $documents */
	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'PUT', url: '/api/v1/envelopes/{uuid}/contract-terms')]
	public function saveTerms(string $uuid, array $documents = []): JSONResponse {
		return $this->onEnvelope($uuid, function (Envelope $envelope, string $userId) use ($documents): JSONResponse {
			if ($envelope->getOwnerUid() !== $userId || !$this->accessPolicy->canUseApp($userId)) {
				return self::forbidden();
			}
			$this->drafts->saveTerms($envelope, $documents);
			return new JSONResponse($this->details->detail($envelope));
		});
	}

	/**
	 * Higher-order guard: the add-on is on (else 403 `contracts_disabled`), the envelope exists and the user sees it
	 * (else 404), then the action runs; rejections become their own status with our code.
	 *
	 * @param callable(Envelope, string): JSONResponse $action
	 */
	private function onEnvelope(string $uuid, callable $action): JSONResponse {
		if (!$this->settings->isEnabled()) {
			return self::disabled();
		}
		$userId = $this->currentUserId();
		try {
			$envelope = $this->envelopeMapper->findByUuid($uuid);
		} catch (DoesNotExistException) {
			return self::envelopeNotFound();
		}
		if (!$this->accessPolicy->canSee($envelope, $userId)) {
			return self::envelopeNotFound();
		}
		return self::handlingRejections(fn (): JSONResponse => $action($envelope, $userId));
	}

	/** @param callable(): JSONResponse $action */
	private static function handlingRejections(callable $action): JSONResponse {
		try {
			return $action();
		} catch (ContractRejected $rejection) {
			return new JSONResponse(['error' => $rejection->errorCode, 'message' => $rejection->getMessage()], $rejection->httpStatus);
		}
	}

	private function currentUserId(): string {
		return $this->userSession->getUser()?->getUID() ?? '';
	}

	private static function disabled(): JSONResponse {
		return new JSONResponse(['error' => 'contracts_disabled', 'message' => 'Contract management is off for this instance'], Http::STATUS_FORBIDDEN);
	}

	private static function envelopeNotFound(): JSONResponse {
		return new JSONResponse(['error' => 'not_found', 'message' => 'Envelope not found'], Http::STATUS_NOT_FOUND);
	}

	private static function forbidden(): JSONResponse {
		return new JSONResponse(['error' => 'forbidden', 'message' => 'You are not allowed to do this'], Http::STATUS_FORBIDDEN);
	}
}
```

- [ ] **Step 5: Show the held terms and the renewal link**

In `lib/Api/EnvelopeView.php`, in `document()`, add after `'signedFileId' => $document->getSignedFileId(),`:

```php
			'contractTerms' => $document->getContractTerms(),
```

In `detail()`, add after `'cancelReason' => $envelope->getCancelReason(),`:

```php
			'renewsContractId' => $envelope->getRenewsContractId(),
```

- [ ] **Step 6: Run the test to see it pass**

Run: `tests/env/phpunit.sh --filter ContractTermsControllerTest`
Expected: `OK`.

- [ ] **Step 7: Commit**

```bash
git add lib/Contract/ContractDrafts.php lib/Controller/ContractController.php lib/Api/EnvelopeView.php tests/Integration/Controller/ContractTermsControllerTest.php
git commit -m "feat(contracts): hold contract terms with a draft's documents"
```

---

### Task 5: Contracts start when everyone signs

**Files:**
- Create: `lib/Contract/ContractEvent.php`, `lib/Contract/ContractActivation.php`, `lib/Contract/ContractActivationListener.php`
- Modify: `lib/AppInfo/Application.php` (register the listener)
- Create: `tests/Integration/ContractFixtures.php` (test support, reused by Tasks 6–10)
- Test: `tests/Integration/Contract/ContractActivationTest.php` (new)

**Interfaces:**
- Consumes: `ContractTerms::fromInput|newContract`, `ContractMapper::insertIfNew|transition|findById|envelopesWithUnactivatedTerms`, `EnvelopeEvents::record`, `EnvelopeEventRecorded`.
- Produces:
  - `enum ContractEvent: string` — `Registered = 'contract_registered'`, `Updated = 'contract_updated'`, `Renewed = 'contract_renewed'`, `AutoRenewed = 'contract_auto_renewed'`, `Expired = 'contract_expired'`, `Ended = 'contract_ended'`, `Replaced = 'contract_replaced'`.
  - `ContractActivation::activateEnvelope(int $envelopeId, int $now): void`, `ContractActivation::sweep(int $now): void`.
  - Test trait `ContractFixtures`: `draftWithTerms(string $ownerUid, array $terms, string $title = 'Locação Sala 3', bool $withAnnex = false): Envelope`, `withStatus(Envelope, EnvelopeStatus): Envelope`, `completed(Envelope, int $now = 1_790_000_000): Envelope`, `signedContract(string $ownerUid, array $terms, string $title = 'Locação Sala 3'): Contract`, `renewing(Envelope $draft, Contract $contract): Envelope`, `contractOf(Envelope): ?Contract`, `reloadedContract(Contract): Contract`, `eventTypesOf(int $envelopeId): list<string>`.

- [ ] **Step 1: Write the test support trait**

Create `tests/Integration/ContractFixtures.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration;

use OCA\Assinaturas\Contract\ContractDrafts;
use OCA\Assinaturas\Db\Contract;
use OCA\Assinaturas\Db\ContractMapper;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\Event;
use OCA\Assinaturas\Db\EventMapper;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCP\Server;

/** Envelopes whose documents hold contract terms, signed or not, without calling ZapSign. Needs TestUsers. */
trait ContractFixtures {
	/** @param array<string, mixed> $terms held with the main document */
	private function draftWithTerms(string $ownerUid, array $terms, string $title = 'Locação Sala 3', bool $withAnnex = false): Envelope {
		$suffix = bin2hex(random_bytes(3));
		$fileIds = [$this->writeFile($ownerUid, "Contratos/{$title} {$suffix}.pdf", self::minimalPdf($title))->getId()];
		if ($withAnnex) {
			$fileIds[] = $this->writeFile($ownerUid, "Contratos/Anexo I {$suffix}.pdf", self::minimalPdf('anexo'))->getId();
		}
		$envelope = Server::get(EnvelopeDrafts::class)->create($ownerUid, $title, $fileIds);
		$main = Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId())[0];
		Server::get(ContractDrafts::class)->saveTerms($envelope, [['documentId' => $main->getId(), 'terms' => $terms]]);
		return Server::get(EnvelopeMapper::class)->findById($envelope->getId());
	}

	private function withStatus(Envelope $envelope, EnvelopeStatus $status): Envelope {
		$current = Server::get(EnvelopeMapper::class)->findById($envelope->getId());
		$current->setStatus($status->value);
		return Server::get(EnvelopeMapper::class)->update($current);
	}

	/** Completes the envelope as EnvelopeCompletion does: the status, then the timeline entry that activates its contracts. */
	private function completed(Envelope $envelope, int $now = 1_790_000_000): Envelope {
		$completed = $this->withStatus($envelope, EnvelopeStatus::Completed);
		Server::get(EnvelopeEvents::class)->record($completed->getId(), null, 'completed', '', $now);
		return $completed;
	}

	/** @param array<string, mixed> $terms */
	private function signedContract(string $ownerUid, array $terms, string $title = 'Locação Sala 3'): Contract {
		$contract = $this->contractOf($this->completed($this->draftWithTerms($ownerUid, $terms, $title)));
		if ($contract === null) {
			throw new \LogicException('The completed envelope produced no contract');
		}
		return $contract;
	}

	private function renewing(Envelope $draft, Contract $contract): Envelope {
		$current = Server::get(EnvelopeMapper::class)->findById($draft->getId());
		$current->setRenewsContractId($contract->getId());
		return Server::get(EnvelopeMapper::class)->update($current);
	}

	private function contractOf(Envelope $envelope): ?Contract {
		return Server::get(ContractMapper::class)->findByEnvelope($envelope->getId())[0] ?? null;
	}

	private function reloadedContract(Contract $contract): Contract {
		return Server::get(ContractMapper::class)->findById($contract->getId());
	}

	/** @return list<string> */
	private function eventTypesOf(int $envelopeId): array {
		return array_map(fn (Event $event): string => $event->getType(), Server::get(EventMapper::class)->findByEnvelope($envelopeId));
	}
}
```

- [ ] **Step 2: Write the failing activation test**

Create `tests/Integration/Contract/ContractActivationTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Contract;

use OCA\Assinaturas\Contract\ContractActivation;
use OCA\Assinaturas\Db\ContractMapper;
use OCA\Assinaturas\Db\ContractStatus;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCA\Assinaturas\Tests\Integration\ContractFixtures;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class ContractActivationTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ContractFixtures;

	private const NOW = 1_790_000_000;
	private const TERMS = ['startsOn' => '2026-01-01', 'endsOn' => '2026-12-31', 'type' => 'Locação', 'counterpartyName' => 'Imobiliária Central Ltda'];
	private const RENEWAL_TERMS = ['startsOn' => '2027-01-01', 'endsOn' => '2027-12-31', 'type' => 'Locação'];

	private string $owner;

	protected function setUp(): void {
		parent::setUp();
		$this->owner = $this->createUser();
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testActivatesTheHeldTermsWhenEveryoneSigned(): void {
		$envelope = $this->completed($this->draftWithTerms($this->owner, self::TERMS, 'Locação Sala 3', true));

		$contracts = Server::get(ContractMapper::class)->findByEnvelope($envelope->getId());

		$this->assertCount(1, $contracts);
		$this->assertSame(ContractStatus::Active, $contracts[0]->statusValue());
		$this->assertSame(['2026-01-01', '2026-12-31', '2026-12-31'], [$contracts[0]->getStartsOn(), $contracts[0]->getEndsOn(), $contracts[0]->getKeyDate()]);
		$this->assertNull($contracts[0]->getContinuesContractId());
	}

	public function testActivatesEachDocumentOnce(): void {
		$envelope = $this->completed($this->draftWithTerms($this->owner, self::TERMS));

		Server::get(ContractActivation::class)->activateEnvelope($envelope->getId(), self::NOW);
		Server::get(ContractActivation::class)->sweep(self::NOW);

		$this->assertCount(1, Server::get(ContractMapper::class)->findByEnvelope($envelope->getId()));
	}

	/** @return array<string, array{EnvelopeStatus}> */
	public static function closedWithoutSignatures(): array {
		return [
			'cancelled' => [EnvelopeStatus::Cancelled],
			'refused' => [EnvelopeStatus::Refused],
			'expired' => [EnvelopeStatus::Expired],
		];
	}

	/** @dataProvider closedWithoutSignatures */
	public function testNeverActivatesAnEnvelopeThatDidNotComplete(EnvelopeStatus $status): void {
		$envelope = $this->withStatus($this->draftWithTerms($this->owner, self::TERMS), $status);
		Server::get(EnvelopeEvents::class)->record($envelope->getId(), null, $status->value, '', self::NOW);

		Server::get(ContractActivation::class)->activateEnvelope($envelope->getId(), self::NOW);
		Server::get(ContractActivation::class)->sweep(self::NOW);

		$this->assertNull($this->contractOf($envelope));
	}

	public function testActivatesACompletedEnvelopeWhoseActivationNeverRan(): void {
		$envelope = $this->withStatus($this->draftWithTerms($this->owner, self::TERMS), EnvelopeStatus::Completed);

		Server::get(ContractActivation::class)->sweep(self::NOW);

		$this->assertSame('2026-12-31', $this->contractOf($envelope)?->getEndsOn());
	}

	public function testKeepsTheOldContractWhileItsRenewalWaitsForSignatures(): void {
		$old = $this->signedContract($this->owner, self::TERMS);

		$this->withStatus($this->renewing($this->draftWithTerms($this->owner, self::RENEWAL_TERMS), $old), EnvelopeStatus::Pending);

		$this->assertSame(ContractStatus::Active, $this->reloadedContract($old)->statusValue());
	}

	/** @dataProvider closedWithoutSignatures */
	public function testKeepsTheOldContractWhenItsRenewalNeverCompletes(EnvelopeStatus $status): void {
		$old = $this->signedContract($this->owner, self::TERMS);
		$renewal = $this->withStatus($this->renewing($this->draftWithTerms($this->owner, self::RENEWAL_TERMS), $old), $status);

		Server::get(ContractActivation::class)->sweep(self::NOW);

		$this->assertSame(ContractStatus::Active, $this->reloadedContract($old)->statusValue());
		$this->assertNull($this->contractOf($renewal));
	}

	public function testMarksTheOldContractRenewedWhenItsRenewalCompletes(): void {
		$old = $this->signedContract($this->owner, self::TERMS);

		$renewal = $this->completed($this->renewing($this->draftWithTerms($this->owner, self::RENEWAL_TERMS), $old));

		$this->assertSame(ContractStatus::Renewed, $this->reloadedContract($old)->statusValue());
		$this->assertSame($old->getId(), $this->contractOf($renewal)?->getContinuesContractId());
		$this->assertContains('contract_replaced', $this->eventTypesOf($old->getEnvelopeId()));
	}

	public function testLeavesAnEndedContractEndedWhenItsRenewalCompletes(): void {
		$old = $this->signedContract($this->owner, self::TERMS);
		Server::get(ContractMapper::class)->transition($old->getId(), [ContractStatus::Active], ContractStatus::Ended, self::NOW);

		$renewal = $this->completed($this->renewing($this->draftWithTerms($this->owner, self::RENEWAL_TERMS), $old));

		$this->assertSame(ContractStatus::Ended, $this->reloadedContract($old)->statusValue());
		$this->assertSame($old->getId(), $this->contractOf($renewal)?->getContinuesContractId());
	}
}
```

- [ ] **Step 3: Run the test to see it fail**

Run: `tests/env/phpunit.sh --filter ContractActivationTest`
Expected: FAIL with `Error: Class "OCA\Assinaturas\Contract\ContractActivation" not found`.

- [ ] **Step 4: Implement the event types and the activation**

Create `lib/Contract/ContractEvent.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contract;

/** What a contract adds to its envelope's timeline. */
enum ContractEvent: string {
	case Registered = 'contract_registered';
	case Updated = 'contract_updated';
	case Renewed = 'contract_renewed';
	case AutoRenewed = 'contract_auto_renewed';
	case Expired = 'contract_expired';
	case Ended = 'contract_ended';
	case Replaced = 'contract_replaced';
}
```

Create `lib/Contract/ContractActivation.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contract;

use OCA\Assinaturas\Db\ContractMapper;
use OCA\Assinaturas\Db\ContractStatus;
use OCA\Assinaturas\Db\Document;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use Psr\Log\LoggerInterface;

/**
 * A contract is tracked once it is signed: when an envelope completes, the terms held with its documents become
 * active contracts. A cancelled, refused or expired envelope never completes, so it never produces one, and the
 * contract it would have renewed stays as it was.
 */
final class ContractActivation {
	private const SWEEP_LIMIT = 100;

	public function __construct(
		private EnvelopeMapper $envelopeMapper,
		private DocumentMapper $documentMapper,
		private ContractMapper $contractMapper,
		private EnvelopeEvents $events,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * Safe to run again: each document gets one contract. The first document with terms continues the contract the
	 * envelope renews, which then reads as renewed; an ended contract stays ended.
	 */
	public function activateEnvelope(int $envelopeId, int $now): void {
		$envelope = $this->envelopeMapper->findById($envelopeId);
		if ($envelope->statusValue() !== EnvelopeStatus::Completed) {
			return;
		}
		$renewedContractId = $envelope->getRenewsContractId();
		foreach ($this->documentMapper->findByEnvelope($envelopeId) as $document) {
			$terms = $this->heldTerms($envelope, $document);
			if ($terms === null) {
				continue;
			}
			$this->contractMapper->insertIfNew($terms->newContract($envelopeId, $document->getId(), $renewedContractId, $now));
			if ($renewedContractId !== null) {
				$this->markRenewed($renewedContractId, $now);
			}
			$renewedContractId = null;
		}
	}

	/** Activates the completed envelopes whose activation never ran or failed (the daily job calls this). */
	public function sweep(int $now): void {
		foreach ($this->contractMapper->envelopesWithUnactivatedTerms(self::SWEEP_LIMIT) as $envelopeId) {
			$this->activateEnvelope($envelopeId, $now);
		}
	}

	private function heldTerms(Envelope $envelope, Document $document): ?ContractTerms {
		$held = $document->getContractTerms();
		if ($held === null) {
			return null;
		}
		try {
			return ContractTerms::fromInput($held);
		} catch (ContractRejected $rejection) {
			$this->logger->warning('Held contract terms are invalid; no contract was activated', [
				'envelope' => $envelope->getUuid(),
				'document' => $document->getId(),
				'reason' => $rejection->errorCode,
			]);
			return null;
		}
	}

	private function markRenewed(int $contractId, int $now): void {
		if (!$this->contractMapper->transition($contractId, [ContractStatus::Active, ContractStatus::Expired], ContractStatus::Renewed, $now)) {
			return;
		}
		$contract = $this->contractMapper->findById($contractId);
		$this->events->record($contract->getEnvelopeId(), null, ContractEvent::Replaced->value, (string)$contractId, $now, ['contractId' => $contractId]);
	}
}
```

Create `lib/Contract/ContractActivationListener.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contract;

use OCA\Assinaturas\Sync\EnvelopeEventRecorded;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;

/**
 * Activates an envelope's contracts the moment everyone signed. The timeline dispatches "completed" once; when this
 * fails, EnvelopeEvents logs it and the daily job's sweep activates the contracts later.
 *
 * @template-implements IEventListener<Event>
 */
final class ContractActivationListener implements IEventListener {
	private const COMPLETED = 'completed';

	public function __construct(
		private ContractActivation $activation,
		private ITimeFactory $timeFactory,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof EnvelopeEventRecorded || $event->type !== self::COMPLETED || $event->signerId !== null) {
			return;
		}
		$this->activation->activateEnvelope($event->envelopeId, $this->timeFactory->getTime());
	}
}
```

- [ ] **Step 5: Register the listener**

In `lib/AppInfo/Application.php`, add `use OCA\Assinaturas\Contract\ContractActivationListener;` and, after the `SenderNotificationListener` registration line:

```php
		$context->registerEventListener(EnvelopeEventRecorded::class, ContractActivationListener::class);
```

- [ ] **Step 6: Run the test to see it pass, then the completion tests**

Run: `tests/env/phpunit.sh --filter ContractActivationTest`
Expected: `OK`.

Run: `tests/env/phpunit.sh --filter 'EnvelopeCompletionTest|EnvelopeLifecycleTest|SyncPollerTest'`
Expected: `OK` (the listener runs on every recorded "completed" and finds no terms there).

- [ ] **Step 7: Commit**

```bash
git add lib/Contract/ContractEvent.php lib/Contract/ContractActivation.php lib/Contract/ContractActivationListener.php lib/AppInfo/Application.php tests/Integration/ContractFixtures.php tests/Integration/Contract/ContractActivationTest.php
git commit -m "feat(contracts): activate held terms when the envelope completes"
```

---

### Task 6: The envelope page's contracts and their renewal chain

**Files:**
- Create: `lib/Contract/ContractName.php`, `lib/Api/ContractView.php`, `lib/Contract/ContractDetails.php`
- Modify: `lib/Api/EnvelopeDetails.php`
- Test: `tests/Integration/Contract/ContractDetailsTest.php` (new)

**Interfaces:**
- Consumes: `ContractMapper::findByEnvelope|findById|findContinuing`, `DocumentMapper::findById`, `ContractTerms::fromContract`, `ContractCalendar::today|daysBetween`, `AccessPolicy::canSee|canAct` (Plan 8), `ContractSettings::isEnabled`.
- Produces:
  - `ContractName::of(Envelope $envelope, Document $document): string` — the envelope title for the main document (position 0), else the file name without `.pdf`.
  - `ContractView::contract(Contract $contract, Envelope $envelope, Document $document, string $today): array` — the **contract DTO**: `id, envelopeUuid, documentId, name, status, keyDate, daysUntilKeyDate, continuesContractId, endReason` plus every `ContractTerms::toArray()` key.
  - `ContractDetails::forEnvelope(Envelope $envelope, list<Document> $documents): array{contracts: list<array>, canActOnContracts: bool}`; each contract is the DTO plus `chain: list<{contractId, envelopeUuid: ?string, name, startsOn, endsOn, status, isCurrent}>` (oldest first, empty when there is no other link).
  - Envelope detail gains `contracts` and `canActOnContracts` (empty / false while the add-on is off).

- [ ] **Step 1: Write the failing test**

Create `tests/Integration/Contract/ContractDetailsTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Contract;

use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Api\EnvelopeDetails;
use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\Contract\ContractCalendar;
use OCA\Assinaturas\Contract\ContractDrafts;
use OCA\Assinaturas\Contract\ContractSettings;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Tests\Integration\ContractFixtures;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\IAppConfig;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class ContractDetailsTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ContractFixtures;

	private const TERMS = [
		'startsOn' => '2026-01-01',
		'endsOn' => '2026-12-31',
		'autoRenew' => true,
		'renewalTermMonths' => 12,
		'noticeDays' => 30,
		'counterpartyDocument' => '11222333000181',
		'valueCents' => 450000,
		'valueFrequency' => 'monthly',
	];
	private const RENEWAL_TERMS = ['startsOn' => '2027-01-01', 'endsOn' => '2027-12-31'];

	private string $owner;

	protected function setUp(): void {
		parent::setUp();
		Server::get(ContractSettings::class)->setEnabled(true);
		$this->owner = $this->createUser();
		$this->addToGroup($this->owner, SignersGroup::GROUP_ID);
	}

	protected function tearDown(): void {
		self::logout();
		Server::get(IAppConfig::class)->deleteKey(Application::APP_ID, ContractSettings::KEY_ENABLED);
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testShowsTheEnvelopesContractWithItsKeyDate(): void {
		self::loginAsUser($this->owner);
		$envelope = $this->completed($this->draftWithTerms($this->owner, self::TERMS));

		$detail = $this->detailOf($envelope);

		$this->assertTrue($detail['canActOnContracts']);
		$contract = $detail['contracts'][0];
		$this->assertSame('Locação Sala 3', $contract['name']);
		$this->assertSame('active', $contract['status']);
		$this->assertSame('2026-12-01', $contract['keyDate']);
		$this->assertSame(ContractCalendar::daysBetween(Server::get(ContractCalendar::class)->today(), '2026-12-01'), $contract['daysUntilKeyDate']);
		$this->assertSame($envelope->getUuid(), $contract['envelopeUuid']);
		$this->assertSame([450000, 'monthly', '11222333000181'], [$contract['valueCents'], $contract['valueFrequency'], $contract['counterpartyDocument']]);
		$this->assertSame([], $contract['chain']);
	}

	public function testNamesAnAnnexContractAfterItsFile(): void {
		self::loginAsUser($this->owner);
		$draft = $this->draftWithTerms($this->owner, self::TERMS, 'Locação Sala 3', true);
		[$main, $annex] = Server::get(DocumentMapper::class)->findByEnvelope($draft->getId());
		Server::get(ContractDrafts::class)->saveTerms($draft, [
			['documentId' => $main->getId(), 'terms' => null],
			['documentId' => $annex->getId(), 'terms' => self::TERMS],
		]);

		$detail = $this->detailOf($this->completed($draft));

		$this->assertStringStartsWith('Anexo I ', $detail['contracts'][0]['name']);
	}

	public function testShowsNoContractsWhileTheAddOnIsOffButKeepsThem(): void {
		self::loginAsUser($this->owner);
		$envelope = $this->completed($this->draftWithTerms($this->owner, self::TERMS));
		Server::get(ContractSettings::class)->setEnabled(false);

		$detail = $this->detailOf($envelope);

		$this->assertSame([], $detail['contracts']);
		$this->assertFalse($detail['canActOnContracts']);
		$this->assertNotNull($this->contractOf($envelope));
	}

	public function testShowsTheRenewalChainOldestFirstOnBothEnvelopes(): void {
		self::loginAsUser($this->owner);
		$old = $this->signedContract($this->owner, self::TERMS, 'Contrato original');
		$renewal = $this->completed($this->renewing($this->draftWithTerms($this->owner, self::RENEWAL_TERMS, 'Aditivo'), $old));
		$oldEnvelope = Server::get(EnvelopeMapper::class)->findById($old->getEnvelopeId());

		$newChain = $this->detailOf($renewal)['contracts'][0]['chain'];
		$oldContract = $this->detailOf($oldEnvelope)['contracts'][0];

		$this->assertSame(['Contrato original', 'Aditivo'], array_column($newChain, 'name'));
		$this->assertSame([false, true], array_column($newChain, 'isCurrent'));
		$this->assertSame([$oldEnvelope->getUuid(), $renewal->getUuid()], array_column($newChain, 'envelopeUuid'));
		$this->assertSame([['2026-01-01', '2026-12-31'], ['2027-01-01', '2027-12-31']], array_map(fn (array $link): array => [$link['startsOn'], $link['endsOn']], $newChain));
		$this->assertSame('renewed', $oldContract['status']);
		$this->assertSame([true, false], array_column($oldContract['chain'], 'isCurrent'));
	}

	public function testLeavesOutTheLinkToAnEnvelopeTheViewerCannotSee(): void {
		$otherOwner = $this->createUser();
		$old = $this->signedContract($otherOwner, self::TERMS, 'Contrato original');
		self::loginAsUser($this->owner);
		$renewal = $this->completed($this->renewing($this->draftWithTerms($this->owner, self::RENEWAL_TERMS, 'Aditivo'), $old));

		$chain = $this->detailOf($renewal)['contracts'][0]['chain'];

		$this->assertNull($chain[0]['envelopeUuid']);
		$this->assertSame('Contrato original', $chain[0]['name']);
	}

	/** @return array<string, mixed> */
	private function detailOf(Envelope $envelope): array {
		return Server::get(EnvelopeDetails::class)->detail($envelope);
	}
}
```

- [ ] **Step 2: Run the test to see it fail**

Run: `tests/env/phpunit.sh --filter ContractDetailsTest`
Expected: FAIL with `Undefined array key "canActOnContracts"`.

- [ ] **Step 3: Implement the name and the contract shape**

Create `lib/Contract/ContractName.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contract;

use OCA\Assinaturas\Db\Document;
use OCA\Assinaturas\Db\Envelope;

/** What a contract is called on every screen and in every alert. */
final class ContractName {
	private const PDF_EXTENSION = '/\.pdf\z/i';

	/** The main document's contract takes the envelope's title; an annex's takes its file name without ".pdf". */
	public static function of(Envelope $envelope, Document $document): string {
		if ($document->getPosition() === 0) {
			return $envelope->getTitle();
		}
		$fileName = basename($document->getSourcePath());
		$withoutExtension = (string)preg_replace(self::PDF_EXTENSION, '', $fileName);
		return $withoutExtension === '' ? $fileName : $withoutExtension;
	}
}
```

Create `lib/Api/ContractView.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Api;

use OCA\Assinaturas\Contract\ContractCalendar;
use OCA\Assinaturas\Contract\ContractName;
use OCA\Assinaturas\Contract\ContractTerms;
use OCA\Assinaturas\Db\Contract;
use OCA\Assinaturas\Db\Document;
use OCA\Assinaturas\Db\Envelope;

/** A contract as the API shows it, on the envelope page and in the contracts listing alike. */
final class ContractView {
	/**
	 * @param string $today YYYY-MM-DD in the instance timezone, from ContractCalendar::today()
	 * @return array<string, mixed>
	 */
	public function contract(Contract $contract, Envelope $envelope, Document $document, string $today): array {
		return [
			'id' => $contract->getId(),
			'envelopeUuid' => $envelope->getUuid(),
			'documentId' => $document->getId(),
			'name' => ContractName::of($envelope, $document),
			'status' => $contract->getStatus(),
			'keyDate' => $contract->getKeyDate(),
			'daysUntilKeyDate' => ContractCalendar::daysBetween($today, $contract->getKeyDate()),
			'continuesContractId' => $contract->getContinuesContractId(),
			'endReason' => $contract->getEndReason(),
			...ContractTerms::fromContract($contract)->toArray(),
		];
	}
}
```

- [ ] **Step 4: Implement the details**

Create `lib/Contract/ContractDetails.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contract;

use OCA\Assinaturas\Access\AccessPolicy;
use OCA\Assinaturas\Api\ContractView;
use OCA\Assinaturas\Db\Contract;
use OCA\Assinaturas\Db\ContractMapper;
use OCA\Assinaturas\Db\Document;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\IUserSession;

/**
 * What an envelope's page shows about its contracts: each contract with its renewal chain, and whether the viewer may
 * act on them. A chain link names its envelope only for a viewer who can open it.
 */
final class ContractDetails {
	private const CHAIN_LIMIT = 20;

	public function __construct(
		private ContractSettings $settings,
		private ContractMapper $contractMapper,
		private EnvelopeMapper $envelopeMapper,
		private DocumentMapper $documentMapper,
		private ContractView $view,
		private ContractCalendar $calendar,
		private AccessPolicy $accessPolicy,
		private IUserSession $userSession,
	) {
	}

	/**
	 * @param list<Document> $documents the envelope's documents
	 * @return array{contracts: list<array<string, mixed>>, canActOnContracts: bool} nothing while the add-on is off
	 */
	public function forEnvelope(Envelope $envelope, array $documents): array {
		if (!$this->settings->isEnabled()) {
			return ['contracts' => [], 'canActOnContracts' => false];
		}
		$viewer = $this->userSession->getUser()?->getUID() ?? '';
		$today = $this->calendar->today();
		$documentsById = [];
		foreach ($documents as $document) {
			$documentsById[$document->getId()] = $document;
		}
		$contracts = [];
		foreach ($this->contractMapper->findByEnvelope($envelope->getId()) as $contract) {
			$document = $documentsById[$contract->getDocumentId()] ?? null;
			if ($document === null) {
				continue;
			}
			$contracts[] = [...$this->view->contract($contract, $envelope, $document, $today), 'chain' => $this->chain($contract, $viewer)];
		}
		return ['contracts' => $contracts, 'canActOnContracts' => $viewer !== '' && $this->accessPolicy->canAct($envelope, $viewer)];
	}

	/** @return list<array<string, mixed>> oldest first; empty for a contract that renews nothing and was not renewed */
	private function chain(Contract $contract, string $viewer): array {
		$links = [$contract];
		$older = $contract;
		while (count($links) < self::CHAIN_LIMIT && ($older = $this->older($older)) !== null) {
			array_unshift($links, $older);
		}
		$newer = $contract;
		while (count($links) < self::CHAIN_LIMIT && ($newer = $this->contractMapper->findContinuing($newer->getId())) !== null) {
			$links[] = $newer;
		}
		if (count($links) === 1) {
			return [];
		}
		return array_values(array_filter(array_map(fn (Contract $link): ?array => $this->link($link, $contract, $viewer), $links)));
	}

	private function older(Contract $contract): ?Contract {
		$olderId = $contract->getContinuesContractId();
		if ($olderId === null) {
			return null;
		}
		try {
			return $this->contractMapper->findById($olderId);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	/** @return array<string, mixed>|null null when an administrator removed the link's envelope */
	private function link(Contract $link, Contract $current, string $viewer): ?array {
		try {
			$envelope = $this->envelopeMapper->findById($link->getEnvelopeId());
			$document = $this->documentMapper->findById($link->getDocumentId());
		} catch (DoesNotExistException) {
			return null;
		}
		return [
			'contractId' => $link->getId(),
			'envelopeUuid' => $viewer !== '' && $this->accessPolicy->canSee($envelope, $viewer) ? $envelope->getUuid() : null,
			'name' => ContractName::of($envelope, $document),
			'startsOn' => $link->getStartsOn(),
			'endsOn' => $link->getEndsOn(),
			'status' => $link->getStatus(),
			'isCurrent' => $link->getId() === $current->getId(),
		];
	}
}
```

- [ ] **Step 5: Add them to the envelope detail**

In `lib/Api/EnvelopeDetails.php`, add `use OCA\Assinaturas\Contract\ContractDetails;`, add the constructor parameter `private ContractDetails $contractDetails,` after `private IUserManager $userManager,`, and change `detail()` so the view's array is merged with the contracts:

```php
	/** @return array<string, mixed> */
	public function detail(Envelope $envelope): array {
		$current = $this->envelopeMapper->findById($envelope->getId());
		$documents = $this->documentMapper->findByEnvelope($current->getId());
		$fieldsByDocument = [];
		foreach ($documents as $document) {
			$fieldsByDocument[$document->getId()] = $this->fieldMapper->findByDocument($document->getId());
		}
		$detail = $this->view->detail(
			$current,
			$documents,
			$this->signerMapper->findByEnvelope($current->getId()),
			$fieldsByDocument,
			$this->eventMapper->findByEnvelope($current->getId()),
			$this->driveSizes($current, $documents),
		);
		return [...$detail, ...$this->contractDetails->forEnvelope($current, $documents)];
	}
```

(If Plan 8 added more arguments or keys to this method, keep them; the change is the `$detail =` assignment and the spread on return.)

- [ ] **Step 6: Run the test to see it pass, then the controller tests**

Run: `tests/env/phpunit.sh --filter 'ContractDetailsTest|ContractTermsControllerTest|EnvelopeControllerTest'`
Expected: `OK`.

- [ ] **Step 7: Commit**

```bash
git add lib/Contract/ContractName.php lib/Api/ContractView.php lib/Contract/ContractDetails.php lib/Api/EnvelopeDetails.php tests/Integration/Contract/ContractDetailsTest.php
git commit -m "feat(contracts): show each envelope's contracts and renewal chain"
```

---

### Task 7: Contract alerts

**Files:**
- Create: `scripts/add-translations.mjs` (dev tool for every later translation step)
- Create: `lib/Contract/ContractAlertSubject.php`, `lib/Contract/AlertRecipients.php`, `lib/Contract/ContractAlerts.php`
- Modify: `lib/Notification/Notifier.php` (six subjects), `l10n/pt_BR.json`, `l10n/pt_BR.js`
- Test: `tests/Integration/Notification/NotifierTest.php`, `tests/Integration/Contract/ContractAlertsTest.php` (new)

**Interfaces:**
- Consumes: `ContractAlertMapper::insertIfNew|offsetsFor`, `ContractCalendar::daysBetween`, `ContractName::of`, `SenderNotificationListener::OBJECT_TYPE` (`'envelope'`), `FolderAccess::userIdsWithEditOn`, `ManagersGroup::GROUP_ID`, `AccessPolicy::canSee`, `Envelope::getFolderId()` (Plan 8).
- Produces:
  - `ContractAlertSubject::for(bool $isNoticeDeadline, int $daysLeft): string` and the six subject constants (`contract_ends_in|tomorrow|today`, `contract_notice_ends_in|tomorrow|today`); subject parameters `{title: contract name, extra: days left as text}`; object `('envelope', uuid)`.
  - `AlertRecipients::of(Envelope $envelope): list<string>` — owner + folder editors + managers, deduplicated, only users that exist and can see the envelope.
  - `ContractAlerts::sendDue(Contract $contract, Envelope $envelope, Document $document, string $today): void`, `ContractAlerts::coverDue(Contract $contract, string $today): void`.
  - `node scripts/add-translations.mjs` reads a JSON object of `"English source" : "pt_BR"` (a plural is `"_one_::_many_" : ["…", "…"]`) on standard input and writes both bundles.

- [ ] **Step 1: Write the translation tool**

Create `scripts/add-translations.mjs`:

```js
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const l10nDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'l10n')
const JSON_BUNDLE = join(l10nDirectory, 'pt_BR.json')
const SCRIPT_BUNDLE = join(l10nDirectory, 'pt_BR.js')
const PLURAL_FORM = 'nplurals=2; plural=(n > 1);'
const STANDARD_INPUT = 0

/**
 * Adds pt_BR translations, read as one JSON object from standard input, to both bundles Nextcloud loads: the JSON
 * file (PHP) and the script (browser), written the way Nextcloud's own tooling writes them. A source text that
 * already has another translation stops the run, so nothing is overwritten by accident.
 */
const additions = JSON.parse(readFileSync(STANDARD_INPUT, 'utf8'))
const { translations } = JSON.parse(readFileSync(JSON_BUNDLE, 'utf8'))
for (const [source, translation] of Object.entries(additions)) {
	if (source in translations && JSON.stringify(translations[source]) !== JSON.stringify(translation)) {
		throw new Error(`"${source}" already has another translation`)
	}
	translations[source] = translation
}
const entries = Object.entries(translations).map(([source, translation]) => `    ${JSON.stringify(source)} : ${JSON.stringify(translation)}`).join(',\n')
writeFileSync(JSON_BUNDLE, `{ "translations": {\n${entries}\n},"pluralForm" :"${PLURAL_FORM}"\n}\n`)
writeFileSync(SCRIPT_BUNDLE, `OC.L10N.register(\n    "assinaturas",\n    {\n${entries}\n},\n"${PLURAL_FORM}");\n`)
```

Run: `node scripts/add-translations.mjs <<< '{}' && git status --short l10n`
Expected: no output from `git status` (the tool rewrites both bundles byte for byte).

- [ ] **Step 2: Write the failing notifier test**

In `tests/Integration/Notification/NotifierTest.php`, add:

```php
	/** @return array<string, array{string, string, string}> */
	public static function contractAlerts(): array {
		return [
			'an end in 30 days' => ['contract_ends_in', '30', 'Contrato "Locação Sala 3" vence em 30 dias.'],
			'an end tomorrow' => ['contract_ends_tomorrow', '1', 'Contrato "Locação Sala 3" vence amanhã.'],
			'an end today' => ['contract_ends_today', '0', 'Contrato "Locação Sala 3" vence hoje.'],
			'a notice deadline in 7 days' => ['contract_notice_ends_in', '7', 'Prazo de aviso de "Locação Sala 3" termina em 7 dias.'],
			'a notice deadline tomorrow' => ['contract_notice_ends_tomorrow', '1', 'Prazo de aviso de "Locação Sala 3" termina amanhã.'],
			'a notice deadline today' => ['contract_notice_ends_today', '0', 'Prazo de aviso de "Locação Sala 3" termina hoje.'],
		];
	}

	/** @dataProvider contractAlerts */
	public function testRendersAContractAlertInPortugueseLinkingToTheEnvelope(string $subject, string $daysLeft, string $expected): void {
		$prepared = $this->notifier()->prepare($this->notification('assinaturas', $subject, ['title' => 'Locação Sala 3', 'extra' => $daysLeft], 'abc-uuid'), 'pt_BR');

		$this->assertSame($expected, $prepared->getParsedSubject());
		$this->assertStringEndsWith('/apps/assinaturas/envelopes/abc-uuid', $prepared->getLink());
	}
```

- [ ] **Step 3: Write the failing alerts test**

Create `tests/Integration/Contract/ContractAlertsTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Contract;

use OCA\Assinaturas\Access\ManagersGroup;
use OCA\Assinaturas\Contract\AlertRecipients;
use OCA\Assinaturas\Contract\ContractAlerts;
use OCA\Assinaturas\Db\Contract;
use OCA\Assinaturas\Db\ContractAlertMapper;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Tests\Integration\ContractFixtures;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Notification\IManager;
use OCP\Notification\INotification;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class ContractAlertsTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ContractFixtures;

	private const ENDS = ['startsOn' => '2026-01-01', 'endsOn' => '2026-12-31'];
	private const RENEWS = ['startsOn' => '2026-01-01', 'endsOn' => '2026-12-31', 'autoRenew' => true, 'renewalTermMonths' => 12, 'noticeDays' => 30];

	private string $owner;
	/** @var list<INotification> */
	private array $sent = [];

	protected function setUp(): void {
		parent::setUp();
		$this->owner = $this->createUser();
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testSendsTheAlertOfTheDayToTheOwner(): void {
		$contract = $this->signedContract($this->owner, self::ENDS);

		$this->sendDue($contract, '2026-12-01');

		$this->assertSame([[$this->owner, 'contract_ends_in', '30']], $this->sentAlerts());
		$this->assertSame(['envelope', $this->envelopeUuidOf($contract)], [$this->sent[0]->getObjectType(), $this->sent[0]->getObjectId()]);
		$this->assertSame('Locação Sala 3', $this->sent[0]->getSubjectParameters()['title']);
	}

	public function testSendsEachAlertOnceHoweverOftenItRuns(): void {
		$contract = $this->signedContract($this->owner, self::ENDS);

		$this->sendDue($contract, '2026-12-01');
		$this->sendDue($contract, '2026-12-01');

		$this->assertCount(1, $this->sent);
	}

	public function testSendsAMissedAlertOnTheNextRunWithTheDaysActuallyLeft(): void {
		$contract = $this->signedContract($this->owner, self::ENDS);
		$this->sendDue($contract, '2026-10-02');

		$this->sendDue($contract, '2026-12-02');

		$this->assertSame([[$this->owner, 'contract_ends_in', '90'], [$this->owner, 'contract_ends_in', '29']], $this->sentAlerts());
	}

	public function testCatchesUpWithOneAlertForEveryMissedOffset(): void {
		$contract = $this->signedContract($this->owner, self::ENDS);

		$this->sendDue($contract, '2026-12-27');

		$this->assertSame([[$this->owner, 'contract_ends_in', '4']], $this->sentAlerts());
		$recorded = Server::get(ContractAlertMapper::class)->offsetsFor($contract->getId(), '2026-12-31');
		sort($recorded);
		$this->assertSame([7, 30, 90], $recorded);
	}

	public function testSaysTodayAndTomorrow(): void {
		$contract = $this->signedContract($this->owner, [...self::ENDS, 'alertDays' => [1, 0]]);

		$this->sendDue($contract, '2026-12-30');
		$this->sendDue($contract, '2026-12-31');

		$this->assertSame([[$this->owner, 'contract_ends_tomorrow', '1'], [$this->owner, 'contract_ends_today', '0']], $this->sentAlerts());
	}

	public function testWarnsAboutTheNoticeDeadlineOfAContractThatRenewsItself(): void {
		$contract = $this->signedContract($this->owner, self::RENEWS);

		$this->sendDue($contract, '2026-11-24');

		$this->assertSame([[$this->owner, 'contract_notice_ends_in', '7']], $this->sentAlerts());
	}

	public function testSendsNothingOnceTheKeyDatePassed(): void {
		$contract = $this->signedContract($this->owner, self::ENDS);

		$this->sendDue($contract, '2027-01-02');

		$this->assertSame([], $this->sent);
	}

	public function testTellsTheManagersTooEachPersonOnce(): void {
		$manager = $this->createUser();
		$this->addToGroup($manager, ManagersGroup::GROUP_ID);
		$this->addToGroup($this->owner, ManagersGroup::GROUP_ID);
		$contract = $this->signedContract($this->owner, self::ENDS);

		$this->sendDue($contract, '2026-12-01');

		$recipients = array_map(fn (INotification $notification): string => $notification->getUser(), $this->sent);
		sort($recipients);
		$expected = [$this->owner, $manager];
		sort($expected);
		$this->assertSame($expected, $recipients);
	}

	public function testCountsTheAlertsAlreadyDueAsSentWithoutSendingThem(): void {
		$contract = $this->signedContract($this->owner, self::ENDS);

		$this->alerts()->coverDue($contract, '2026-12-01');
		$this->sendDue($contract, '2026-12-01');

		$this->assertSame([], $this->sent);
		$recorded = Server::get(ContractAlertMapper::class)->offsetsFor($contract->getId(), '2026-12-31');
		sort($recorded);
		$this->assertSame([30, 90], $recorded);
	}

	private function sendDue(Contract $contract, string $today): void {
		$envelope = Server::get(EnvelopeMapper::class)->findById($contract->getEnvelopeId());
		$document = Server::get(DocumentMapper::class)->findById($contract->getDocumentId());
		$this->alerts()->sendDue($this->reloadedContract($contract), $envelope, $document, $today);
	}

	/** @return list<array{string, string, string}> recipient, subject and days left of each alert, in order */
	private function sentAlerts(): array {
		return array_map(fn (INotification $notification): array => [
			$notification->getUser(),
			$notification->getSubject(),
			(string)$notification->getSubjectParameters()['extra'],
		], $this->sent);
	}

	private function envelopeUuidOf(Contract $contract): string {
		return Server::get(EnvelopeMapper::class)->findById($contract->getEnvelopeId())->getUuid();
	}

	private function alerts(): ContractAlerts {
		$notifications = $this->createMock(IManager::class);
		$notifications->method('createNotification')->willReturnCallback(fn (): INotification => Server::get(IManager::class)->createNotification());
		$notifications->method('notify')->willReturnCallback(function (INotification $notification): void {
			$this->sent[] = $notification;
		});
		return new ContractAlerts(Server::get(ContractAlertMapper::class), Server::get(AlertRecipients::class), $notifications, Server::get(ITimeFactory::class));
	}
}
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `tests/env/phpunit.sh --filter 'NotifierTest|ContractAlertsTest'`
Expected: FAIL — `UnknownNotificationException` for the contract subjects, and `Error: Class "OCA\Assinaturas\Contract\AlertRecipients" not found`.

- [ ] **Step 5: Implement the subjects**

Create `lib/Contract/ContractAlertSubject.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contract;

/** What an alert says is due (a contract's end, or the notice deadline of one that renews itself) and when. */
final class ContractAlertSubject {
	public const ENDS_IN = 'contract_ends_in';
	public const ENDS_TOMORROW = 'contract_ends_tomorrow';
	public const ENDS_TODAY = 'contract_ends_today';
	public const NOTICE_ENDS_IN = 'contract_notice_ends_in';
	public const NOTICE_ENDS_TOMORROW = 'contract_notice_ends_tomorrow';
	public const NOTICE_ENDS_TODAY = 'contract_notice_ends_today';
	private const TODAY = 0;
	private const TOMORROW = 1;

	public static function for(bool $isNoticeDeadline, int $daysLeft): string {
		$byDays = $isNoticeDeadline
			? [self::TODAY => self::NOTICE_ENDS_TODAY, self::TOMORROW => self::NOTICE_ENDS_TOMORROW]
			: [self::TODAY => self::ENDS_TODAY, self::TOMORROW => self::ENDS_TOMORROW];
		return $byDays[$daysLeft] ?? ($isNoticeDeadline ? self::NOTICE_ENDS_IN : self::ENDS_IN);
	}
}
```

In `lib/Notification/Notifier.php`, add `use OCA\Assinaturas\Contract\ContractAlertSubject;` and these entries at the end of `SUBJECTS`:

```php
		ContractAlertSubject::ENDS_IN => 'Contract "%1$s" ends in %2$s days.',
		ContractAlertSubject::ENDS_TOMORROW => 'Contract "%1$s" ends tomorrow.',
		ContractAlertSubject::ENDS_TODAY => 'Contract "%1$s" ends today.',
		ContractAlertSubject::NOTICE_ENDS_IN => 'The notice period of "%1$s" ends in %2$s days.',
		ContractAlertSubject::NOTICE_ENDS_TOMORROW => 'The notice period of "%1$s" ends tomorrow.',
		ContractAlertSubject::NOTICE_ENDS_TODAY => 'The notice period of "%1$s" ends today.',
```

Add the translations:

```bash
node scripts/add-translations.mjs <<'JSON'
{
	"Contract \"%1$s\" ends in %2$s days.": "Contrato \"%1$s\" vence em %2$s dias.",
	"Contract \"%1$s\" ends tomorrow.": "Contrato \"%1$s\" vence amanhã.",
	"Contract \"%1$s\" ends today.": "Contrato \"%1$s\" vence hoje.",
	"The notice period of \"%1$s\" ends in %2$s days.": "Prazo de aviso de \"%1$s\" termina em %2$s dias.",
	"The notice period of \"%1$s\" ends tomorrow.": "Prazo de aviso de \"%1$s\" termina amanhã.",
	"The notice period of \"%1$s\" ends today.": "Prazo de aviso de \"%1$s\" termina hoje."
}
JSON
```

- [ ] **Step 6: Implement the recipients and the alerts**

Create `lib/Contract/AlertRecipients.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contract;

use OCA\Assinaturas\Access\AccessPolicy;
use OCA\Assinaturas\Access\ManagersGroup;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Folder\FolderAccess;
use OCP\IGroupManager;
use OCP\IUser;
use OCP\IUserManager;

/** Who hears about a contract: its envelope's owner, everyone with Editar on its folder, and the managers; each once. */
final class AlertRecipients {
	public function __construct(
		private FolderAccess $folderAccess,
		private IGroupManager $groupManager,
		private IUserManager $userManager,
		private AccessPolicy $accessPolicy,
	) {
	}

	/** @return list<string> users who exist and can see the envelope */
	public function of(Envelope $envelope): array {
		$candidates = array_unique([$envelope->getOwnerUid(), ...$this->folderEditors($envelope), ...$this->managers()]);
		return array_values(array_filter(
			$candidates,
			fn (string $userId): bool => $this->userManager->userExists($userId) && $this->accessPolicy->canSee($envelope, $userId),
		));
	}

	/** @return list<string> */
	private function folderEditors(Envelope $envelope): array {
		$folderId = $envelope->getFolderId();
		return $folderId === null ? [] : $this->folderAccess->userIdsWithEditOn($folderId);
	}

	/** @return list<string> */
	private function managers(): array {
		$group = $this->groupManager->get(ManagersGroup::GROUP_ID);
		return $group === null ? [] : array_map(fn (IUser $user): string => $user->getUID(), array_values($group->getUsers()));
	}
}
```

Create `lib/Contract/ContractAlerts.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contract;

use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\Db\Contract;
use OCA\Assinaturas\Db\ContractAlert;
use OCA\Assinaturas\Db\ContractAlertMapper;
use OCA\Assinaturas\Db\Document;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Notification\SenderNotificationListener;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Notification\IManager;

/**
 * A contract's alerts: one per offset in `alert_days`, on the day `key date − offset`. Dedup is by contract, key date
 * and offset, so a re-run, a missed day or a restart never sends twice, and a new key date starts fresh alerts.
 * Each alert is a Nextcloud notification; Nextcloud's own notification settings decide whether it is also emailed.
 */
final class ContractAlerts {
	public function __construct(
		private ContractAlertMapper $alertMapper,
		private AlertRecipients $recipients,
		private IManager $notifications,
		private ITimeFactory $timeFactory,
	) {
	}

	/**
	 * Sends the most urgent alert that came due unsent, with the days actually left. Offsets that came due with it
	 * (days the job did not run, the add-on switched on late) count as sent, so a catch-up sends one alert.
	 */
	public function sendDue(Contract $contract, Envelope $envelope, Document $document, string $today): void {
		$daysLeft = ContractCalendar::daysBetween($today, $contract->getKeyDate());
		$unsent = $this->unsentDueOffsets($contract, $daysLeft);
		if ($unsent === []) {
			return;
		}
		$mostUrgent = min($unsent);
		if (!$this->record($contract, $mostUrgent)) {
			return;
		}
		foreach ($unsent as $offset) {
			if ($offset !== $mostUrgent) {
				$this->record($contract, $offset);
			}
		}
		$this->notify($contract, $envelope, $document, $daysLeft);
	}

	/** Counts the alerts already due for the contract's current key date as sent, without sending them. */
	public function coverDue(Contract $contract, string $today): void {
		foreach ($this->unsentDueOffsets($contract, ContractCalendar::daysBetween($today, $contract->getKeyDate())) as $offset) {
			$this->record($contract, $offset);
		}
	}

	/** @return list<int> offsets whose day came, for a key date that is today or ahead, not recorded yet */
	private function unsentDueOffsets(Contract $contract, int $daysLeft): array {
		if ($daysLeft < 0) {
			return [];
		}
		$due = array_filter(array_map('intval', $contract->getAlertDays()), fn (int $offset): bool => $offset >= $daysLeft);
		return array_values(array_diff($due, $this->alertMapper->offsetsFor($contract->getId(), $contract->getKeyDate())));
	}

	private function record(Contract $contract, int $offset): bool {
		$alert = new ContractAlert();
		$alert->setContractId($contract->getId());
		$alert->setKeyDate($contract->getKeyDate());
		$alert->setOffsetDays($offset);
		$alert->setSentAt($this->timeFactory->getTime());
		return $this->alertMapper->insertIfNew($alert);
	}

	private function notify(Contract $contract, Envelope $envelope, Document $document, int $daysLeft): void {
		$subject = ContractAlertSubject::for($contract->getAutoRenew(), $daysLeft);
		$parameters = ['title' => ContractName::of($envelope, $document), 'extra' => (string)$daysLeft];
		foreach ($this->recipients->of($envelope) as $userId) {
			$notification = $this->notifications->createNotification();
			$notification->setApp(Application::APP_ID)
				->setUser($userId)
				->setDateTime((new \DateTime())->setTimestamp($this->timeFactory->getTime()))
				->setObject(SenderNotificationListener::OBJECT_TYPE, $envelope->getUuid())
				->setSubject($subject, $parameters);
			$this->notifications->notify($notification);
		}
	}
}
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `tests/env/phpunit.sh --filter 'NotifierTest|ContractAlertsTest'`
Expected: `OK`.

Run: `npx vitest run src/l10n.spec.ts`
Expected: PASS (the subjects are translated in both bundles and none names the provider).

- [ ] **Step 8: Commit**

```bash
git add scripts/add-translations.mjs lib/Contract/ContractAlertSubject.php lib/Contract/AlertRecipients.php lib/Contract/ContractAlerts.php lib/Notification/Notifier.php l10n tests/Integration/Notification/NotifierTest.php tests/Integration/Contract/ContractAlertsTest.php
git commit -m "feat(contracts): alert owners, folder editors and managers before deadlines"
```

---

### Task 8: Register, edit, renew and end a contract

**Files:**
- Create: `lib/Contract/ContractActions.php`
- Modify: `lib/Controller/ContractController.php` (routes `register`, `update`, `renew`, `end`, `types`; guard `onContract`)
- Test: `tests/Integration/Controller/ContractActionsControllerTest.php` (new)

**Interfaces:**
- Consumes: `ContractTerms`, `ContractMapper::insertIfNew|transition|findById|usedTypes`, `ContractAlerts::coverDue`, `ContractCalendar`, `EnvelopeEvents::record`, `ContractEvent`, `AccessPolicy::canSee|canAct|canUseApp`.
- Produces:
  - `ContractActions::register(Envelope $envelope, int $documentId, mixed $input, string $actorUid): void`, `edit(Contract $contract, mixed $input, string $actorUid): void`, `renew(Contract $contract, string $endsOn, mixed $valueCents, mixed $valueFrequency, string $actorUid): void`, `end(Contract $contract, string $reason, string $actorUid): void`.
  - Routes (all answer the envelope detail unless noted):
    - `POST /api/v1/envelopes/{uuid}/documents/{documentId}/contract` body `{terms}` → 201; 409 `envelope_not_completed`, 409 `contract_exists`, 404 `document_not_found`.
    - `PUT /api/v1/contracts/{contractId}` body `{terms}`.
    - `POST /api/v1/contracts/{contractId}/renew` body `{endsOn, valueCents?, valueFrequency?}`; 422 `renewal_not_later`, 409 `contract_closed`, 409 `contract_changed`.
    - `POST /api/v1/contracts/{contractId}/end` body `{reason?}`; 422 `end_reason_invalid`, 409 `contract_closed`.
    - `GET /api/v1/contract-types` → `{types: list<string>}`.
    - Every route: 403 `contracts_disabled`; contract routes 404 `contract_not_found` when the contract or its envelope is not visible; 403 `forbidden` without `canAct`.

- [ ] **Step 1: Write the failing test**

Create `tests/Integration/Controller/ContractActionsControllerTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Controller;

use OCA\Assinaturas\Access\ManagersGroup;
use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\Contract\ContractCalendar;
use OCA\Assinaturas\Contract\ContractSettings;
use OCA\Assinaturas\Controller\ContractController;
use OCA\Assinaturas\Db\ContractAlertMapper;
use OCA\Assinaturas\Db\ContractMapper;
use OCA\Assinaturas\Db\ContractStatus;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\Event;
use OCA\Assinaturas\Db\EventMapper;
use OCA\Assinaturas\Tests\Integration\ContractFixtures;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\AppFramework\Http;
use OCP\IAppConfig;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class ContractActionsControllerTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ContractFixtures;

	private const NOW = 1_790_000_000;
	private const TERMS = [
		'startsOn' => '2026-01-01',
		'endsOn' => '2026-12-31',
		'type' => 'Locação',
		'counterpartyName' => 'Imobiliária Central Ltda',
		'valueCents' => 450000,
		'valueFrequency' => 'monthly',
	];

	private string $owner;

	protected function setUp(): void {
		parent::setUp();
		Server::get(ContractSettings::class)->setEnabled(true);
		$this->owner = $this->createUser();
		$this->addToGroup($this->owner, SignersGroup::GROUP_ID);
	}

	protected function tearDown(): void {
		self::logout();
		Server::get(IAppConfig::class)->deleteKey(Application::APP_ID, ContractSettings::KEY_ENABLED);
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testRecordsTheContractOfACompletedEnvelopeThatHasNone(): void {
		$envelope = $this->completed($this->draftWithTerms($this->owner, self::TERMS));
		$main = Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId())[0];
		Server::get(ContractMapper::class)->delete($this->contractOf($envelope));
		self::loginAsUser($this->owner);

		$response = $this->controller()->register($envelope->getUuid(), $main->getId(), [...self::TERMS, 'endsOn' => '2027-06-30']);

		$this->assertSame(Http::STATUS_CREATED, $response->getStatus());
		$this->assertSame('2027-06-30', $response->getData()['contracts'][0]['endsOn']);
		$this->assertSame([$this->owner], $this->actorsOf($envelope->getId(), 'contract_registered'));
	}

	public function testWaitsForEveryoneToSignBeforeRecording(): void {
		$envelope = $this->withStatus($this->draftWithTerms($this->owner, self::TERMS), EnvelopeStatus::Pending);
		$main = Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId())[0];
		self::loginAsUser($this->owner);

		$response = $this->controller()->register($envelope->getUuid(), $main->getId(), self::TERMS);

		$this->assertSame(Http::STATUS_CONFLICT, $response->getStatus());
		$this->assertSame('envelope_not_completed', $response->getData()['error']);
	}

	public function testRecordsADocumentsContractOnce(): void {
		$envelope = $this->completed($this->draftWithTerms($this->owner, self::TERMS));
		$main = Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId())[0];
		self::loginAsUser($this->owner);

		$response = $this->controller()->register($envelope->getUuid(), $main->getId(), self::TERMS);

		$this->assertSame('contract_exists', $response->getData()['error']);
	}

	public function testEditsAContractAndRecomputesItsKeyDate(): void {
		$contract = $this->signedContract($this->owner, self::TERMS);
		self::loginAsUser($this->owner);

		$response = $this->controller()->update($contract->getId(), [...self::TERMS, 'autoRenew' => true, 'renewalTermMonths' => 12, 'noticeDays' => 60]);

		$this->assertSame(Http::STATUS_OK, $response->getStatus());
		$this->assertSame('2026-11-01', $this->reloadedContract($contract)->getKeyDate());
		$this->assertSame([$this->owner], $this->actorsOf($contract->getEnvelopeId(), 'contract_updated'));
	}

	public function testDoesNotResendAlertsAlreadyDueAfterTheDatesChange(): void {
		$contract = $this->signedContract($this->owner, self::TERMS);
		$soon = ContractCalendar::addDays(Server::get(ContractCalendar::class)->today(), 20);
		self::loginAsUser($this->owner);

		$this->controller()->update($contract->getId(), [...self::TERMS, 'startsOn' => null, 'endsOn' => $soon]);

		$recorded = Server::get(ContractAlertMapper::class)->offsetsFor($contract->getId(), $soon);
		sort($recorded);
		$this->assertSame([30, 90], $recorded);
	}

	public function testBringsAnExpiredContractBackWhenItsEndMovesAhead(): void {
		$contract = $this->signedContract($this->owner, self::TERMS);
		Server::get(ContractMapper::class)->transition($contract->getId(), [ContractStatus::Active], ContractStatus::Expired, self::NOW);
		$later = ContractCalendar::addDays(Server::get(ContractCalendar::class)->today(), 200);
		self::loginAsUser($this->owner);

		$this->controller()->update($contract->getId(), [...self::TERMS, 'endsOn' => $later]);

		$this->assertSame(ContractStatus::Active, $this->reloadedContract($contract)->statusValue());
	}

	public function testRenewsAContractUntilALaterDateWithANewValue(): void {
		$contract = $this->signedContract($this->owner, self::TERMS);
		self::loginAsUser($this->owner);

		$response = $this->controller()->renew($contract->getId(), '2027-12-31', 500000, 'monthly');

		$this->assertSame(Http::STATUS_OK, $response->getStatus());
		$renewed = $this->reloadedContract($contract);
		$this->assertSame(['2026-01-01', '2027-12-31', 500000], [$renewed->getStartsOn(), $renewed->getEndsOn(), $renewed->getValueCents()]);
		$this->assertSame(['contractId' => $contract->getId(), 'fromEndsOn' => '2026-12-31', 'toEndsOn' => '2027-12-31'], $this->detailOf($contract->getEnvelopeId(), 'contract_renewed'));
	}

	public function testRenewsAnExpiredContractBackIntoForce(): void {
		$contract = $this->signedContract($this->owner, self::TERMS);
		Server::get(ContractMapper::class)->transition($contract->getId(), [ContractStatus::Active], ContractStatus::Expired, self::NOW);
		self::loginAsUser($this->owner);

		$this->controller()->renew($contract->getId(), '2027-12-31');

		$this->assertSame(ContractStatus::Active, $this->reloadedContract($contract)->statusValue());
	}

	public function testRefusesARenewalThatDoesNotMoveTheEnd(): void {
		$contract = $this->signedContract($this->owner, self::TERMS);
		self::loginAsUser($this->owner);

		$response = $this->controller()->renew($contract->getId(), '2026-12-31');

		$this->assertSame(Http::STATUS_UNPROCESSABLE_ENTITY, $response->getStatus());
		$this->assertSame('renewal_not_later', $response->getData()['error']);
	}

	public function testEndsAContractWithItsReason(): void {
		$contract = $this->signedContract($this->owner, self::TERMS);
		self::loginAsUser($this->owner);

		$this->controller()->end($contract->getId(), '  Distrato amigável ');

		$ended = $this->reloadedContract($contract);
		$this->assertSame([ContractStatus::Ended, 'Distrato amigável'], [$ended->statusValue(), $ended->getEndReason()]);
		$this->assertSame([$this->owner], $this->actorsOf($contract->getEnvelopeId(), 'contract_ended'));
	}

	public function testRefusesToRenewOrEndAnEndedContract(): void {
		$contract = $this->signedContract($this->owner, self::TERMS);
		self::loginAsUser($this->owner);
		$this->controller()->end($contract->getId(), '');

		$this->assertSame('contract_closed', $this->controller()->renew($contract->getId(), '2027-12-31')->getData()['error']);
		$this->assertSame('contract_closed', $this->controller()->end($contract->getId(), '')->getData()['error']);
	}

	public function testRefusesAnEndReasonThatIsTooLong(): void {
		$contract = $this->signedContract($this->owner, self::TERMS);
		self::loginAsUser($this->owner);

		$this->assertSame('end_reason_invalid', $this->controller()->end($contract->getId(), str_repeat('a', 501))->getData()['error']);
	}

	public function testHidesTheContractFromSomeoneWhoCannotSeeItsEnvelope(): void {
		$contract = $this->signedContract($this->owner, self::TERMS);
		$stranger = $this->createUser();
		$this->addToGroup($stranger, SignersGroup::GROUP_ID);
		self::loginAsUser($stranger);

		$this->assertSame('contract_not_found', $this->controller()->update($contract->getId(), self::TERMS)->getData()['error']);
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->renew($contract->getId(), '2027-12-31')->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->end($contract->getId(), '')->getStatus());
		$this->assertSame(ContractStatus::Active, $this->reloadedContract($contract)->statusValue());
	}

	public function testLetsAManagerActOnSomeoneElsesContract(): void {
		$contract = $this->signedContract($this->owner, self::TERMS);
		$manager = $this->createUser();
		$this->addToGroup($manager, ManagersGroup::GROUP_ID);
		self::loginAsUser($manager);

		$this->assertSame(Http::STATUS_OK, $this->controller()->renew($contract->getId(), '2027-12-31')->getStatus());
	}

	public function testListsTheContractTypesInUse(): void {
		$this->signedContract($this->owner, self::TERMS);
		self::loginAsUser($this->owner);

		$this->assertContains('Locação', $this->controller()->types()->getData()['types']);
	}

	public function testRefusesContractActionsWhileTheAddOnIsOff(): void {
		$contract = $this->signedContract($this->owner, self::TERMS);
		Server::get(ContractSettings::class)->setEnabled(false);
		self::loginAsUser($this->owner);

		$this->assertSame('contracts_disabled', $this->controller()->renew($contract->getId(), '2027-12-31')->getData()['error']);
		$this->assertSame('contracts_disabled', $this->controller()->types()->getData()['error']);
	}

	/** @return list<string|null> */
	private function actorsOf(int $envelopeId, string $type): array {
		return array_values(array_map(
			fn (Event $event): ?string => $event->getActorUid(),
			array_filter(Server::get(EventMapper::class)->findByEnvelope($envelopeId), fn (Event $event): bool => $event->getType() === $type),
		));
	}

	/** @return array<string, scalar>|null */
	private function detailOf(int $envelopeId, string $type): ?array {
		foreach (Server::get(EventMapper::class)->findByEnvelope($envelopeId) as $event) {
			if ($event->getType() === $type) {
				return $event->getDetail();
			}
		}
		return null;
	}

	private function controller(): ContractController {
		return Server::get(ContractController::class);
	}
}
```

- [ ] **Step 2: Run the test to see it fail**

Run: `tests/env/phpunit.sh --filter ContractActionsControllerTest`
Expected: FAIL with `Error: Call to undefined method OCA\Assinaturas\Controller\ContractController::register()`.

- [ ] **Step 3: Implement the actions**

Create `lib/Contract/ContractActions.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contract;

use OCA\Assinaturas\Db\Contract;
use OCA\Assinaturas\Db\ContractMapper;
use OCA\Assinaturas\Db\ContractStatus;
use OCA\Assinaturas\Db\Document;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCP\AppFramework\Http;
use OCP\AppFramework\Utility\ITimeFactory;

/** What people who may act on an envelope do to its contracts. Each change lands on the envelope's timeline. */
final class ContractActions {
	private const CHANGEABLE_STATUSES = [ContractStatus::Active, ContractStatus::Expired];

	public function __construct(
		private ContractMapper $contractMapper,
		private DocumentMapper $documentMapper,
		private EnvelopeEvents $events,
		private ContractAlerts $alerts,
		private ContractCalendar $calendar,
		private ITimeFactory $timeFactory,
	) {
	}

	/**
	 * "Registrar dados do contrato": the contract of a document of a completed envelope that has none.
	 *
	 * @throws ContractRejected
	 */
	public function register(Envelope $envelope, int $documentId, mixed $input, string $actorUid): void {
		if ($envelope->statusValue() !== EnvelopeStatus::Completed) {
			throw new ContractRejected('envelope_not_completed', 'Contract details are recorded once everyone signed', Http::STATUS_CONFLICT);
		}
		$document = $this->documentOf($envelope, $documentId);
		$terms = ContractTerms::fromInput($input);
		$now = $this->timeFactory->getTime();
		$contract = $terms->newContract($envelope->getId(), $document->getId(), null, $now);
		if (!$this->contractMapper->insertIfNew($contract)) {
			throw new ContractRejected('contract_exists', 'This document already has a contract', Http::STATUS_CONFLICT);
		}
		$this->events->record($envelope->getId(), null, ContractEvent::Registered->value, (string)$contract->getId(), $now, ['contractId' => $contract->getId()], $actorUid);
	}

	/**
	 * Changes any field, in any status. A new key date starts its own alerts, but the ones already due count as sent:
	 * an edit never sends a burst of them.
	 *
	 * @throws ContractRejected
	 */
	public function edit(Contract $contract, mixed $input, string $actorUid): void {
		$terms = ContractTerms::fromInput($input);
		$now = $this->timeFactory->getTime();
		$today = $this->calendar->today();
		$this->contractMapper->transition($contract->getId(), ContractStatus::cases(), self::statusAfterEdit($contract, $terms, $today), $now, $terms->columns());
		$edited = $this->contractMapper->findById($contract->getId());
		if ($edited->getKeyDate() !== $contract->getKeyDate()) {
			$this->alerts->coverDue($edited, $today);
		}
		$this->events->record($contract->getEnvelopeId(), null, ContractEvent::Updated->value, $contract->getId() . ':' . $now, $now, ['contractId' => $contract->getId()], $actorUid);
	}

	/**
	 * "Renovar": a later end (and optionally a new value) for the same record; an expired contract is in force again.
	 *
	 * @throws ContractRejected
	 */
	public function renew(Contract $contract, string $endsOn, mixed $valueCents, mixed $valueFrequency, string $actorUid): void {
		self::assertChangeable($contract);
		$current = ContractTerms::fromContract($contract);
		if (!ContractCalendar::isDate($endsOn)) {
			throw new ContractRejected('contract_ends_on_invalid', 'Dates are YYYY-MM-DD and must exist');
		}
		if ($endsOn <= $current->endsOn) {
			throw new ContractRejected('renewal_not_later', 'The new end date must come after the current one');
		}
		$changes = ['endsOn' => $endsOn];
		if ($valueCents !== null) {
			$changes['valueCents'] = $valueCents;
			$changes['valueFrequency'] = $valueFrequency;
		}
		$renewed = $current->with($changes);
		$now = $this->timeFactory->getTime();
		if (!$this->contractMapper->transition($contract->getId(), self::CHANGEABLE_STATUSES, ContractStatus::Active, $now, $renewed->columns(), ['ends_on' => $current->endsOn])) {
			throw new ContractRejected('contract_changed', 'The contract changed meanwhile', Http::STATUS_CONFLICT);
		}
		$this->events->record($contract->getEnvelopeId(), null, ContractEvent::Renewed->value, $contract->getId() . ':' . $endsOn, $now, [
			'contractId' => $contract->getId(),
			'fromEndsOn' => $current->endsOn,
			'toEndsOn' => $endsOn,
		], $actorUid);
	}

	/**
	 * "Encerrar": alerts stop; the reason is optional.
	 *
	 * @throws ContractRejected
	 */
	public function end(Contract $contract, string $reason, string $actorUid): void {
		self::assertChangeable($contract);
		$text = trim($reason);
		if (mb_strlen($text) > ContractLimits::MAX_END_REASON_LENGTH) {
			throw new ContractRejected('end_reason_invalid', 'The reason has at most ' . ContractLimits::MAX_END_REASON_LENGTH . ' characters');
		}
		$now = $this->timeFactory->getTime();
		if (!$this->contractMapper->transition($contract->getId(), self::CHANGEABLE_STATUSES, ContractStatus::Ended, $now, ['end_reason' => $text === '' ? null : $text])) {
			throw new ContractRejected('contract_changed', 'The contract changed meanwhile', Http::STATUS_CONFLICT);
		}
		$this->events->record($contract->getEnvelopeId(), null, ContractEvent::Ended->value, (string)$contract->getId(), $now, ['contractId' => $contract->getId(), 'reason' => $text], $actorUid);
	}

	/** An expired contract whose end moved to today or later is in force again; any other keeps its status. */
	private static function statusAfterEdit(Contract $contract, ContractTerms $terms, string $today): ContractStatus {
		$status = $contract->statusValue();
		return $status === ContractStatus::Expired && $terms->endsOn >= $today ? ContractStatus::Active : $status;
	}

	/** @throws ContractRejected */
	private static function assertChangeable(Contract $contract): void {
		if (!in_array($contract->statusValue(), self::CHANGEABLE_STATUSES, true)) {
			throw new ContractRejected('contract_closed', 'This contract was ended or replaced', Http::STATUS_CONFLICT);
		}
	}

	/** @throws ContractRejected */
	private function documentOf(Envelope $envelope, int $documentId): Document {
		foreach ($this->documentMapper->findByEnvelope($envelope->getId()) as $document) {
			if ($document->getId() === $documentId) {
				return $document;
			}
		}
		throw new ContractRejected('document_not_found', 'This document is not part of the envelope', Http::STATUS_NOT_FOUND);
	}
}
```

- [ ] **Step 4: Add the routes**

In `lib/Controller/ContractController.php`:
- add the imports `use OCA\Assinaturas\Contract\ContractActions;`, `use OCA\Assinaturas\Contract\ContractLimits;`, `use OCA\Assinaturas\Db\Contract;`, `use OCA\Assinaturas\Db\ContractMapper;`;
- add the constructor parameters `private ContractMapper $contractMapper,` and `private ContractActions $actions,` after `private ContractDrafts $drafts,`;
- add these methods after `saveTerms()`:

```php
	/** @param array<string, mixed> $terms */
	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'POST', url: '/api/v1/envelopes/{uuid}/documents/{documentId}/contract')]
	public function register(string $uuid, int $documentId, array $terms = []): JSONResponse {
		return $this->onEnvelope($uuid, function (Envelope $envelope, string $userId) use ($documentId, $terms): JSONResponse {
			if (!$this->accessPolicy->canAct($envelope, $userId)) {
				return self::forbidden();
			}
			$this->actions->register($envelope, $documentId, $terms, $userId);
			return new JSONResponse($this->details->detail($envelope), Http::STATUS_CREATED);
		});
	}

	/** @param array<string, mixed> $terms */
	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'PUT', url: '/api/v1/contracts/{contractId}')]
	public function update(int $contractId, array $terms = []): JSONResponse {
		return $this->onContract($contractId, function (Contract $contract, Envelope $envelope, string $userId) use ($terms): JSONResponse {
			$this->actions->edit($contract, $terms, $userId);
			return new JSONResponse($this->details->detail($envelope));
		});
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'POST', url: '/api/v1/contracts/{contractId}/renew')]
	public function renew(int $contractId, string $endsOn = '', ?int $valueCents = null, ?string $valueFrequency = null): JSONResponse {
		return $this->onContract($contractId, function (Contract $contract, Envelope $envelope, string $userId) use ($endsOn, $valueCents, $valueFrequency): JSONResponse {
			$this->actions->renew($contract, $endsOn, $valueCents, $valueFrequency, $userId);
			return new JSONResponse($this->details->detail($envelope));
		});
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'POST', url: '/api/v1/contracts/{contractId}/end')]
	public function end(int $contractId, string $reason = ''): JSONResponse {
		return $this->onContract($contractId, function (Contract $contract, Envelope $envelope, string $userId) use ($reason): JSONResponse {
			$this->actions->end($contract, $reason, $userId);
			return new JSONResponse($this->details->detail($envelope));
		});
	}

	/** The types this company's contracts already use, for the "Tipo" field to suggest. */
	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'GET', url: '/api/v1/contract-types')]
	public function types(): JSONResponse {
		if (!$this->settings->isEnabled()) {
			return self::disabled();
		}
		if (!$this->accessPolicy->canUseApp($this->currentUserId())) {
			return self::forbidden();
		}
		return new JSONResponse(['types' => $this->contractMapper->usedTypes(ContractLimits::MAX_TYPE_SUGGESTIONS)]);
	}
```

- add this guard after `onEnvelope()`:

```php
	/**
	 * Higher-order guard for a signed contract: the add-on is on, the contract exists and the user sees its envelope
	 * (else 404 `contract_not_found`, so existence never leaks), and the user may act on that envelope (else 403).
	 *
	 * @param callable(Contract, Envelope, string): JSONResponse $action
	 */
	private function onContract(int $contractId, callable $action): JSONResponse {
		if (!$this->settings->isEnabled()) {
			return self::disabled();
		}
		$userId = $this->currentUserId();
		try {
			$contract = $this->contractMapper->findById($contractId);
			$envelope = $this->envelopeMapper->findById($contract->getEnvelopeId());
		} catch (DoesNotExistException) {
			return self::contractNotFound();
		}
		if (!$this->accessPolicy->canSee($envelope, $userId)) {
			return self::contractNotFound();
		}
		if (!$this->accessPolicy->canAct($envelope, $userId)) {
			return self::forbidden();
		}
		return self::handlingRejections(fn (): JSONResponse => $action($contract, $envelope, $userId));
	}
```

- add this response helper next to the others:

```php
	private static function contractNotFound(): JSONResponse {
		return new JSONResponse(['error' => 'contract_not_found', 'message' => 'Contract not found'], Http::STATUS_NOT_FOUND);
	}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `tests/env/phpunit.sh --filter 'ContractActionsControllerTest|ContractTermsControllerTest'`
Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add lib/Contract/ContractActions.php lib/Controller/ContractController.php tests/Integration/Controller/ContractActionsControllerTest.php
git commit -m "feat(contracts): register, edit, renew and end contracts"
```

---

### Task 9: Renew with a new document

**Files:**
- Create: `lib/Contract/RenewalDrafts.php`
- Modify: `lib/Controller/ContractController.php` (route `createRenewalDraft`; `DraftRejected` handling)
- Test: `tests/Integration/Contract/RenewalDraftsTest.php` (new)

**Interfaces:**
- Consumes: `EnvelopeDrafts::create|updateSettings|replaceSigners|delete`, `SignerMapper::findByEnvelope`, `DocumentMapper`, `ContractTerms::fromContract|with`, `ContractCalendar::addDays|addMonths`, `AccessPolicy::isManager|canSeeAll|canUseApp`, `FolderAccess::userIdsWithEditOn`, `Envelope::getFolderId|setFolderId` (Plan 8), `Envelope::setRenewsContractId` (Task 3).
- Produces:
  - `RenewalDrafts::create(Contract $contract, Envelope $envelope, string $userId, list<mixed> $fileIds): Envelope` — a draft owned by `$userId` with the chosen PDFs, the same title, signers, signing order, reminders, message and (when the user may file into it) folder; the main document holds the next term's terms; `renews_contract_id` = the contract. Throws `ContractRejected('contract_closed', 409)` or `DraftRejected` (file codes).
  - Route `POST /api/v1/contracts/{contractId}/renewal-draft` body `{fileIds: list<int>}` → 201 with the new draft's detail.

- [ ] **Step 1: Write the failing test**

Create `tests/Integration/Contract/RenewalDraftsTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Contract;

use OCA\Assinaturas\Access\ManagersGroup;
use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\Contract\ContractSettings;
use OCA\Assinaturas\Contract\RenewalDrafts;
use OCA\Assinaturas\Controller\ContractController;
use OCA\Assinaturas\Db\Contract;
use OCA\Assinaturas\Db\ContractMapper;
use OCA\Assinaturas\Db\ContractStatus;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Tests\Integration\ContractFixtures;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\OwnedEnvelopes;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\AppFramework\Http;
use OCP\IAppConfig;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class RenewalDraftsTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ContractFixtures;

	private const NOW = 1_790_000_000;
	private const FOLDER_ID = 4242;
	private const TERMS = [
		'startsOn' => '2026-01-01',
		'endsOn' => '2026-12-31',
		'type' => 'Locação',
		'counterpartyName' => 'Imobiliária Central Ltda',
		'counterpartyDocument' => '11222333000181',
		'valueCents' => 450000,
		'valueFrequency' => 'monthly',
	];
	private const SIGNERS = [
		['name' => 'Ana Lima', 'email' => 'ana@example.com', 'orderGroup' => 1],
		['name' => 'Bruno Souza', 'email' => 'bruno@example.com', 'orderGroup' => 2],
	];

	private string $owner;
	private Contract $contract;

	protected function setUp(): void {
		parent::setUp();
		Server::get(ContractSettings::class)->setEnabled(true);
		$this->owner = $this->createUser();
		$this->addToGroup($this->owner, SignersGroup::GROUP_ID);
		$drafts = Server::get(EnvelopeDrafts::class);
		$draft = $this->draftWithTerms($this->owner, self::TERMS, 'Locação Sala 3');
		$draft = $drafts->updateSettings($draft, 'Locação Sala 3', true, null, 3, 'Assine até sexta.');
		$drafts->replaceSigners($draft, self::SIGNERS);
		$this->contract = $this->contractOf($this->completed($draft)) ?? throw new \LogicException('The completed envelope produced no contract');
	}

	protected function tearDown(): void {
		self::logout();
		Server::get(IAppConfig::class)->deleteKey(Application::APP_ID, ContractSettings::KEY_ENABLED);
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testOpensADraftForTheNextTermWithTheSameSigners(): void {
		self::loginAsUser($this->owner);

		$response = $this->controller()->createRenewalDraft($this->contract->getId(), [$this->newPdf()]);

		$this->assertSame(Http::STATUS_CREATED, $response->getStatus());
		$draft = $response->getData();
		$this->assertSame(['draft', $this->owner, 'Locação Sala 3', true], [$draft['status'], $draft['ownerUid'], $draft['title'], $draft['signingOrder']]);
		$this->assertSame(
			[['Ana Lima', 'ana@example.com', 1], ['Bruno Souza', 'bruno@example.com', 2]],
			array_map(fn (array $signer): array => [$signer['name'], $signer['email'], $signer['orderGroup']], $draft['signers']),
		);
		$terms = $draft['documents'][0]['contractTerms'];
		$this->assertSame(
			['2027-01-01', '2027-12-31', 'Locação', '11222333000181', 450000],
			[$terms['startsOn'], $terms['endsOn'], $terms['type'], $terms['counterpartyDocument'], $terms['valueCents']],
		);
		$this->assertSame($this->contract->getId(), $draft['renewsContractId']);
	}

	public function testRenewsTheOldContractOnlyOnceTheNewDraftIsSigned(): void {
		self::loginAsUser($this->owner);
		$uuid = $this->controller()->createRenewalDraft($this->contract->getId(), [$this->newPdf()])->getData()['uuid'];
		$this->assertSame(ContractStatus::Active, $this->reloadedContract($this->contract)->statusValue());

		$this->completed(Server::get(EnvelopeMapper::class)->findByUuid($uuid));

		$this->assertSame(ContractStatus::Renewed, $this->reloadedContract($this->contract)->statusValue());
	}

	public function testRefusesToRenewAnEndedContract(): void {
		Server::get(ContractMapper::class)->transition($this->contract->getId(), [ContractStatus::Active], ContractStatus::Ended, self::NOW);
		self::loginAsUser($this->owner);

		$response = $this->controller()->createRenewalDraft($this->contract->getId(), [$this->newPdf()]);

		$this->assertSame(Http::STATUS_CONFLICT, $response->getStatus());
		$this->assertSame('contract_closed', $response->getData()['error']);
	}

	public function testAnswersTheCodeOfAMissingFileAndLeavesNoDraft(): void {
		self::loginAsUser($this->owner);
		$envelopesBefore = count(OwnedEnvelopes::of($this->owner));

		$response = $this->controller()->createRenewalDraft($this->contract->getId(), []);

		$this->assertSame(Http::STATUS_UNPROCESSABLE_ENTITY, $response->getStatus());
		$this->assertSame('no_files', $response->getData()['error']);
		$this->assertCount($envelopesBefore, OwnedEnvelopes::of($this->owner));
	}

	public function testKeepsTheFolderForAManager(): void {
		$manager = $this->createUser();
		$this->addToGroup($manager, ManagersGroup::GROUP_ID);

		$draft = Server::get(RenewalDrafts::class)->create($this->contract, $this->filedInFolder(), $manager, [$this->newPdf($manager)]);

		$this->assertSame(self::FOLDER_ID, $draft->getFolderId());
		$this->assertSame($manager, $draft->getOwnerUid());
	}

	public function testLeavesTheFolderOutForSomeoneWhoCannotFileIntoIt(): void {
		$draft = Server::get(RenewalDrafts::class)->create($this->contract, $this->filedInFolder(), $this->owner, [$this->newPdf()]);

		$this->assertNull($draft->getFolderId());
	}

	private function filedInFolder(): Envelope {
		$envelope = Server::get(EnvelopeMapper::class)->findById($this->contract->getEnvelopeId());
		$envelope->setFolderId(self::FOLDER_ID);
		return Server::get(EnvelopeMapper::class)->update($envelope);
	}

	private function newPdf(?string $userId = null): int {
		return $this->writeFile($userId ?? $this->owner, 'Contratos/Aditivo ' . bin2hex(random_bytes(3)) . '.pdf', self::minimalPdf('aditivo'))->getId();
	}

	private function controller(): ContractController {
		return Server::get(ContractController::class);
	}
}
```

`FOLDER_ID` 4242 is a folder nobody has rights on: the owner (a plain member) may not file into it, a manager may file anywhere.

- [ ] **Step 2: Run the test to see it fail**

Run: `tests/env/phpunit.sh --filter RenewalDraftsTest`
Expected: FAIL with `Error: Class "OCA\Assinaturas\Contract\RenewalDrafts" not found`.

- [ ] **Step 3: Implement the renewal drafts**

Create `lib/Contract/RenewalDrafts.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contract;

use OCA\Assinaturas\Access\AccessPolicy;
use OCA\Assinaturas\Db\Contract;
use OCA\Assinaturas\Db\ContractSource;
use OCA\Assinaturas\Db\ContractStatus;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\Signer;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Draft\DraftRejected;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Folder\FolderAccess;
use OCP\AppFramework\Http;

/**
 * "Renovar com novo documento": a draft for the contract's next term with the PDFs the user chose and the rest carried
 * over (signers, signing order, reminders, message, folder, and the terms with the next term's dates). It renews the
 * contract once everyone signs it; until then, or if it is cancelled, refused or expires, the contract stays as it is.
 */
final class RenewalDrafts {
	private const RENEWABLE_STATUSES = [ContractStatus::Active, ContractStatus::Expired];
	private const DEFAULT_TERM_MONTHS = 12;

	public function __construct(
		private EnvelopeDrafts $drafts,
		private EnvelopeMapper $envelopeMapper,
		private DocumentMapper $documentMapper,
		private SignerMapper $signerMapper,
		private AccessPolicy $accessPolicy,
		private FolderAccess $folderAccess,
	) {
	}

	/**
	 * @param list<mixed> $fileIds the new PDFs; the first is the main document
	 * @throws ContractRejected|DraftRejected
	 */
	public function create(Contract $contract, Envelope $envelope, string $userId, array $fileIds): Envelope {
		if (!in_array($contract->statusValue(), self::RENEWABLE_STATUSES, true)) {
			throw new ContractRejected('contract_closed', 'This contract was ended or replaced', Http::STATUS_CONFLICT);
		}
		$draft = $this->drafts->create($userId, $envelope->getTitle(), $fileIds);
		try {
			return $this->carryOver($draft, $contract, $envelope, $userId);
		} catch (\Throwable $failure) {
			$this->drafts->delete($draft);
			throw $failure;
		}
	}

	private function carryOver(Envelope $draft, Contract $contract, Envelope $envelope, string $userId): Envelope {
		$draft = $this->drafts->updateSettings($draft, $envelope->getTitle(), $envelope->getSigningOrder(), null, $envelope->getReminderDays(), $envelope->getMessage() ?? '');
		$signers = array_map(
			fn (Signer $signer): array => ['name' => $signer->getName(), 'email' => $signer->getEmail(), 'orderGroup' => $signer->getOrderGroup()],
			$this->signerMapper->findByEnvelope($envelope->getId()),
		);
		if ($signers !== []) {
			$this->drafts->replaceSigners($draft, $signers);
		}
		$main = $this->documentMapper->findByEnvelope($draft->getId())[0];
		$main->setContractTerms(self::nextTerm(ContractTerms::fromContract($contract))->toArray());
		$this->documentMapper->update($main);
		$renewal = $this->envelopeMapper->findById($draft->getId());
		$renewal->setRenewsContractId($contract->getId());
		$renewal->setFolderId($this->keptFolder($envelope, $userId));
		return $this->envelopeMapper->update($renewal);
	}

	/** The next term starts the day after the current one ends and lasts the renewal term, or a year without one. */
	private static function nextTerm(ContractTerms $current): ContractTerms {
		$startsOn = ContractCalendar::addDays($current->endsOn, 1);
		$months = $current->renewalTermMonths ?? self::DEFAULT_TERM_MONTHS;
		return $current->with([
			'startsOn' => $startsOn,
			'endsOn' => ContractCalendar::addDays(ContractCalendar::addMonths($startsOn, $months), -1),
			'source' => ContractSource::Manual->value,
		]);
	}

	/** The old envelope's folder, when the user may file envelopes into it (Editar or more). */
	private function keptFolder(Envelope $envelope, string $userId): ?int {
		$folderId = $envelope->getFolderId();
		if ($folderId === null) {
			return null;
		}
		$mayFile = $this->accessPolicy->isManager($userId)
			|| $this->accessPolicy->canSeeAll($userId)
			|| in_array($userId, $this->folderAccess->userIdsWithEditOn($folderId), true);
		return $mayFile ? $folderId : null;
	}
}
```

- [ ] **Step 4: Add the route**

In `lib/Controller/ContractController.php`:
- add the imports `use OCA\Assinaturas\Contract\RenewalDrafts;` and `use OCA\Assinaturas\Draft\DraftRejected;`;
- add the constructor parameter `private RenewalDrafts $renewals,` after `private ContractActions $actions,`;
- add after `end()`:

```php
	/** @param list<mixed> $fileIds */
	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'POST', url: '/api/v1/contracts/{contractId}/renewal-draft')]
	public function createRenewalDraft(int $contractId, array $fileIds = []): JSONResponse {
		return $this->onContract($contractId, function (Contract $contract, Envelope $envelope, string $userId) use ($fileIds): JSONResponse {
			if (!$this->accessPolicy->canUseApp($userId)) {
				return self::forbidden();
			}
			$draft = $this->renewals->create($contract, $envelope, $userId, $fileIds);
			return new JSONResponse($this->details->detail($draft), Http::STATUS_CREATED);
		});
	}
```

- in `handlingRejections()`, add a second `catch` after the `ContractRejected` one:

```php
		} catch (DraftRejected $rejection) {
			return new JSONResponse(['error' => $rejection->errorCode, 'message' => $rejection->getMessage()], $rejection->httpStatus);
		}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `tests/env/phpunit.sh --filter 'RenewalDraftsTest|ContractActionsControllerTest'`
Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add lib/Contract/RenewalDrafts.php lib/Controller/ContractController.php tests/Integration/Contract/RenewalDraftsTest.php
git commit -m "feat(contracts): renew a contract with a new document"
```

---

### Task 10: The daily contract job

**Files:**
- Create: `lib/Contract/ContractLifecycle.php`, `lib/Contract/ContractLifecycleJob.php`
- Modify: `appinfo/info.xml` (register the job)
- Test: `tests/Integration/Contract/ContractLifecycleTest.php` (new), `tests/Integration/AppInfo/ApplicationTest.php`

**Interfaces:**
- Consumes: `ContractSettings::isEnabled`, `ContractMapper::findActiveAfter|transition`, `ContractActivation::sweep`, `ContractAlerts::sendDue`, `ContractTerms::fromContract|rolledForward|columns`, `ContractCalendar::today`, `EnvelopeEvents::record`, `ContractEvent::AutoRenewed|Expired`.
- Produces: `ContractLifecycle::run(): void`; `ContractLifecycleJob` (`TimedJob`, every 12 hours). Timeline events `contract_auto_renewed` (detail `contractId, fromEndsOn, toEndsOn`) and `contract_expired` (detail `contractId, endsOn`).

- [ ] **Step 1: Write the failing test**

Create `tests/Integration/Contract/ContractLifecycleTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Contract;

use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\Contract\AlertRecipients;
use OCA\Assinaturas\Contract\ContractActivation;
use OCA\Assinaturas\Contract\ContractAlerts;
use OCA\Assinaturas\Contract\ContractCalendar;
use OCA\Assinaturas\Contract\ContractLifecycle;
use OCA\Assinaturas\Contract\ContractSettings;
use OCA\Assinaturas\Db\ContractAlertMapper;
use OCA\Assinaturas\Db\ContractMapper;
use OCA\Assinaturas\Db\ContractStatus;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\EventMapper;
use OCA\Assinaturas\Draft\DeadlineCalculator;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCA\Assinaturas\Tests\Integration\ContractFixtures;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IAppConfig;
use OCP\Notification\IManager;
use OCP\Notification\INotification;
use OCP\Server;
use Psr\Log\NullLogger;
use Test\TestCase;

/**
 * @group DB
 */
final class ContractLifecycleTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ContractFixtures;

	private const SAO_PAULO = 'America/Sao_Paulo';
	private const ENDS = ['startsOn' => '2026-01-01', 'endsOn' => '2026-12-31'];
	private const RENEWS = ['startsOn' => '2026-01-01', 'endsOn' => '2026-12-31', 'autoRenew' => true, 'renewalTermMonths' => 12, 'noticeDays' => 30];

	private string $owner;
	private int $now = 0;
	/** @var list<INotification> */
	private array $sent = [];

	protected function setUp(): void {
		parent::setUp();
		Server::get(ContractSettings::class)->setEnabled(true);
		$this->owner = $this->createUser();
	}

	protected function tearDown(): void {
		Server::get(IAppConfig::class)->deleteKey(Application::APP_ID, ContractSettings::KEY_ENABLED);
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testSendsTheAlertOfTheDayOnceHoweverOftenItRuns(): void {
		$this->signedContract($this->owner, self::ENDS);

		$this->runOn('2026-12-01');
		$this->runOn('2026-12-01');

		$this->assertSame([['contract_ends_in', '30']], $this->alertsTo($this->owner));
	}

	public function testRollsAContractThatRenewsItselfIntoItsNextTerm(): void {
		$contract = $this->signedContract($this->owner, self::RENEWS);

		$this->runOn('2027-01-01');

		$renewed = $this->reloadedContract($contract);
		$this->assertSame(
			[ContractStatus::Active, '2027-01-01', '2027-12-31', '2027-12-01'],
			[$renewed->statusValue(), $renewed->getStartsOn(), $renewed->getEndsOn(), $renewed->getKeyDate()],
		);
		$this->assertSame(['contractId' => $contract->getId(), 'fromEndsOn' => '2026-12-31', 'toEndsOn' => '2027-12-31'], $this->eventDetail($contract->getEnvelopeId(), 'contract_auto_renewed'));
	}

	public function testRestartsTheAlertsForTheNewTerm(): void {
		$this->signedContract($this->owner, self::RENEWS);

		$this->runOn('2026-12-01');
		$this->runOn('2027-01-01');
		$this->runOn('2027-11-01');

		$this->assertSame([['contract_notice_ends_today', '0'], ['contract_notice_ends_in', '30']], $this->alertsTo($this->owner));
	}

	public function testCatchesUpEveryMissedTermInOneRenewal(): void {
		$contract = $this->signedContract($this->owner, self::RENEWS);

		$this->runOn('2029-02-01');

		$this->assertSame('2029-12-31', $this->reloadedContract($contract)->getEndsOn());
		$this->assertSame(['completed', 'contract_auto_renewed'], $this->eventTypesOf($contract->getEnvelopeId()));
	}

	public function testExpiresAContractThatDoesNotRenewItselfOnce(): void {
		$contract = $this->signedContract($this->owner, self::ENDS);

		$this->runOn('2027-01-01');
		$this->runOn('2027-01-02');

		$this->assertSame(ContractStatus::Expired, $this->reloadedContract($contract)->statusValue());
		$this->assertSame(['completed', 'contract_expired'], $this->eventTypesOf($contract->getEnvelopeId()));
		$this->assertSame([], $this->alertsTo($this->owner));
	}

	public function testLeavesEndedAndRenewedContractsAlone(): void {
		$ended = $this->signedContract($this->owner, self::ENDS);
		$renewed = $this->signedContract($this->owner, self::ENDS);
		Server::get(ContractMapper::class)->transition($ended->getId(), [ContractStatus::Active], ContractStatus::Ended, 0);
		Server::get(ContractMapper::class)->transition($renewed->getId(), [ContractStatus::Active], ContractStatus::Renewed, 0);

		$this->runOn('2026-12-01');
		$this->runOn('2027-01-01');

		$this->assertSame([], $this->alertsTo($this->owner));
		$this->assertSame(
			[ContractStatus::Ended, ContractStatus::Renewed],
			[$this->reloadedContract($ended)->statusValue(), $this->reloadedContract($renewed)->statusValue()],
		);
	}

	public function testDoesNothingWhileTheAddOnIsOff(): void {
		$contract = $this->signedContract($this->owner, self::ENDS);
		Server::get(ContractSettings::class)->setEnabled(false);

		$this->runOn('2026-12-01');
		$this->runOn('2027-01-01');

		$this->assertSame(ContractStatus::Active, $this->reloadedContract($contract)->statusValue());
		$this->assertSame([], $this->alertsTo($this->owner));
	}

	public function testActivatesACompletedEnvelopeWhoseActivationNeverRan(): void {
		$envelope = $this->withStatus($this->draftWithTerms($this->owner, self::ENDS), EnvelopeStatus::Completed);

		$this->runOn('2026-10-01');

		$this->assertNotNull($this->contractOf($envelope));
	}

	private function runOn(string $day): void {
		$this->now = (new \DateTimeImmutable($day . ' 12:00', new \DateTimeZone(self::SAO_PAULO)))->getTimestamp();
		$this->lifecycle()->run();
	}

	/** @return list<array{string, string}> subject and days left of each alert this user got, in order */
	private function alertsTo(string $userId): array {
		$received = array_filter($this->sent, fn (INotification $notification): bool => $notification->getUser() === $userId);
		return array_values(array_map(
			fn (INotification $notification): array => [$notification->getSubject(), (string)$notification->getSubjectParameters()['extra']],
			$received,
		));
	}

	/** @return array<string, scalar>|null */
	private function eventDetail(int $envelopeId, string $type): ?array {
		foreach (Server::get(EventMapper::class)->findByEnvelope($envelopeId) as $event) {
			if ($event->getType() === $type) {
				return $event->getDetail();
			}
		}
		return null;
	}

	private function lifecycle(): ContractLifecycle {
		$clock = $this->createMock(ITimeFactory::class);
		$clock->method('getTime')->willReturnCallback(fn (): int => $this->now);
		$notifications = $this->createMock(IManager::class);
		$notifications->method('createNotification')->willReturnCallback(fn (): INotification => Server::get(IManager::class)->createNotification());
		$notifications->method('notify')->willReturnCallback(function (INotification $notification): void {
			$this->sent[] = $notification;
		});
		return new ContractLifecycle(
			Server::get(ContractSettings::class),
			Server::get(ContractMapper::class),
			Server::get(EnvelopeMapper::class),
			Server::get(DocumentMapper::class),
			Server::get(ContractActivation::class),
			new ContractAlerts(Server::get(ContractAlertMapper::class), Server::get(AlertRecipients::class), $notifications, $clock),
			new ContractCalendar($clock, Server::get(DeadlineCalculator::class)),
			Server::get(EnvelopeEvents::class),
			$clock,
			new NullLogger(),
		);
	}
}
```

In `tests/Integration/AppInfo/ApplicationTest.php`, add `use OCA\Assinaturas\Contract\ContractLifecycleJob;` and the entry `'contract lifecycle job' => [ContractLifecycleJob::class],` to `entryPoints()`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `tests/env/phpunit.sh --filter 'ContractLifecycleTest|ApplicationTest'`
Expected: FAIL with `Error: Class "OCA\Assinaturas\Contract\ContractLifecycle" not found`.

- [ ] **Step 3: Implement the lifecycle**

Create `lib/Contract/ContractLifecycle.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contract;

use OCA\Assinaturas\Db\Contract;
use OCA\Assinaturas\Db\ContractMapper;
use OCA\Assinaturas\Db\ContractStatus;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Utility\ITimeFactory;
use Psr\Log\LoggerInterface;

/**
 * The daily pass over every active contract: its due alert, then automatic renewal or expiry once its end passed.
 * Off while the add-on is off; switching it back on catches up with one alert per contract and renewals rolled
 * forward to today. Ended and renewed contracts are never followed.
 */
final class ContractLifecycle {
	private const BATCH_SIZE = 200;

	public function __construct(
		private ContractSettings $settings,
		private ContractMapper $contractMapper,
		private EnvelopeMapper $envelopeMapper,
		private DocumentMapper $documentMapper,
		private ContractActivation $activation,
		private ContractAlerts $alerts,
		private ContractCalendar $calendar,
		private EnvelopeEvents $events,
		private ITimeFactory $timeFactory,
		private LoggerInterface $logger,
	) {
	}

	public function run(): void {
		if (!$this->settings->isEnabled()) {
			return;
		}
		$now = $this->timeFactory->getTime();
		$today = $this->calendar->today();
		$this->activation->sweep($now);
		$afterId = 0;
		do {
			$batch = $this->contractMapper->findActiveAfter($afterId, self::BATCH_SIZE);
			foreach ($batch as $contract) {
				$afterId = $contract->getId();
				$this->followLoggingFailures($contract, $today, $now);
			}
		} while (count($batch) === self::BATCH_SIZE);
	}

	/** One contract's failure is logged and never stops the others. */
	private function followLoggingFailures(Contract $contract, string $today, int $now): void {
		try {
			$this->follow($contract, $today, $now);
		} catch (\Throwable $failure) {
			$this->logger->error('Following a contract failed', ['contract' => $contract->getId(), 'exception' => $failure]);
		}
	}

	/** A contract whose envelope an administrator removed has nobody left to alert, so it is skipped. */
	private function follow(Contract $contract, string $today, int $now): void {
		try {
			$envelope = $this->envelopeMapper->findById($contract->getEnvelopeId());
			$document = $this->documentMapper->findById($contract->getDocumentId());
		} catch (DoesNotExistException) {
			return;
		}
		$this->alerts->sendDue($contract, $envelope, $document, $today);
		if ($today <= $contract->getEndsOn()) {
			return;
		}
		if ($contract->getAutoRenew()) {
			$this->rollForward($contract, $today, $now);
			return;
		}
		$this->expire($contract, $now);
	}

	/** Every term that ended rolls forward in one change, so a long pause still leaves one timeline entry. */
	private function rollForward(Contract $contract, string $today, int $now): void {
		$current = ContractTerms::fromContract($contract);
		$renewed = $current;
		while ($renewed->endsOn < $today) {
			$renewed = $renewed->rolledForward();
		}
		if (!$this->contractMapper->transition($contract->getId(), [ContractStatus::Active], ContractStatus::Active, $now, $renewed->columns(), ['ends_on' => $current->endsOn])) {
			return;
		}
		$this->events->record($contract->getEnvelopeId(), null, ContractEvent::AutoRenewed->value, $contract->getId() . ':' . $renewed->endsOn, $now, [
			'contractId' => $contract->getId(),
			'fromEndsOn' => $current->endsOn,
			'toEndsOn' => $renewed->endsOn,
		]);
	}

	private function expire(Contract $contract, int $now): void {
		if (!$this->contractMapper->transition($contract->getId(), [ContractStatus::Active], ContractStatus::Expired, $now, [], ['ends_on' => $contract->getEndsOn()])) {
			return;
		}
		$this->events->record($contract->getEnvelopeId(), null, ContractEvent::Expired->value, $contract->getId() . ':' . $contract->getEndsOn(), $now, [
			'contractId' => $contract->getId(),
			'endsOn' => $contract->getEndsOn(),
		]);
	}
}
```

Create `lib/Contract/ContractLifecycleJob.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contract;

use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;

/**
 * The contract lifecycle, twice a day. A 24-hour interval drifts later with every cron tick and would at some point
 * skip a whole calendar day; alert dedup and the status checks make the second run of a day change nothing.
 */
final class ContractLifecycleJob extends TimedJob {
	private const TWELVE_HOURS_SECONDS = 43200;

	public function __construct(
		ITimeFactory $time,
		private ContractLifecycle $lifecycle,
	) {
		parent::__construct($time);
		$this->setInterval(self::TWELVE_HOURS_SECONDS);
	}

	protected function run($argument): void {
		$this->lifecycle->run();
	}
}
```

In `appinfo/info.xml`, add inside `<background-jobs>` after the `ProviderHealthJob` line:

```xml
        <job>OCA\Assinaturas\Contract\ContractLifecycleJob</job>
```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

Run: `tests/env/phpunit.sh --filter 'ContractLifecycleTest|ApplicationTest'`
Expected: `OK`.

Run: `tests/env/phpunit.sh`
Expected: `OK`.

Run: `composer run lint`
Expected: exits 0 (`No syntax errors detected` for every file).

- [ ] **Step 5: Commit**

```bash
git add lib/Contract/ContractLifecycle.php lib/Contract/ContractLifecycleJob.php appinfo/info.xml tests/Integration/Contract/ContractLifecycleTest.php tests/Integration/AppInfo/ApplicationTest.php
git commit -m "feat(contracts): renew, expire and alert in a twice-daily job"
```

---

### Task 11: Frontend foundations — types, API, keys, configuration, error texts

**Files:**
- Modify: `src/api/types.ts`, `src/api/admin.ts`, `src/api/query-keys.ts`, `src/app-config.ts`, `src/api/error-messages.ts`, `src/presentation/dates.ts`
- Create: `src/api/contracts.ts`
- Modify (fixtures): `src/test-support/envelope-fixtures.ts`, `src/test-support/wizard-harness.ts`, `src/wizard/wizard-steps.spec.ts`, `src/pdf/pdf-document.spec.ts`, `src/detail/DetailView.spec.ts`, `src/placement/unopened-placement.spec.ts`, `src/new-envelope.spec.ts`, `src/files/send-for-signature-action.spec.ts`
- Test: `src/api/contracts.spec.ts` (new), `src/api/admin.spec.ts`, `src/app-config.spec.ts`, `src/presentation/dates.spec.ts`

**Interfaces:**
- Consumes: the routes of Tasks 1, 4, 8 and 9; `ClientConfig.contractsEnabled`.
- Produces:
  - Types `ContractStatus`, `ContractSource`, `ValueFrequency`, `ContractTerms`, `Contract`, `ContractLink`, `ContractDetail`, `DocumentContractTerms`, `ContractRenewal`, `ContractsAddon`; `EnvelopeDocument.contractTerms: ContractTerms | null`; `EnvelopeDetail.contracts: ContractDetail[]`, `.canActOnContracts: boolean`, `.renewsContractId: number | null`.
  - `src/api/contracts.ts`: `saveContractTerms(uuid, documents): Promise<EnvelopeDetail>`, `registerContract(uuid, documentId, terms)`, `updateContract(contractId, terms)`, `renewContract(contractId, renewal)`, `endContract(contractId, reason)`, `createRenewalDraft(contractId, fileIds)` (all `Promise<EnvelopeDetail>`), `getContractTypes(): Promise<string[]>`.
  - `src/api/admin.ts`: `getContractsAddon(): Promise<ContractsAddon>`, `setContractsAddon(enabled: boolean): Promise<ContractsAddon>`.
  - `QUERY_KEYS.contractTypes()` → `['contract-types']`, `QUERY_KEYS.contractsAddon()` → `['contracts-addon']`; `DRAFT_CHANGES` gains `'contract'`.
  - `AppConfig.contractsEnabled: boolean` (locked-down: false).
  - `ErrorCode` gains the contract codes; `formatCalendarDate(day: string): string` ("31/12/2026").

- [ ] **Step 1: Write the failing API tests**

Create `src/api/contracts.spec.ts`:

```ts
import type { ContractTerms } from './types.ts'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenewalDraft, endContract, getContractTypes, registerContract, renewContract, saveContractTerms, updateContract } from './contracts.ts'
import { DRAFT_SAVE_TIMEOUT_MILLISECONDS } from './envelopes.ts'

const { get, post, put } = vi.hoisted(() => ({
	get: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
}))

vi.mock('@nextcloud/axios', () => ({ default: { get, post, put } }))
vi.mock('@nextcloud/router', () => ({ generateUrl: (path: string) => '/index.php' + path }))

const ROOT = '/index.php/apps/assinaturas/api/v1'
const DETAIL = { uuid: 'u', title: 'Locação Sala 3' }
const CONTRACT_ID = 3
const TERMS: ContractTerms = {
	startsOn: '2026-01-01',
	endsOn: '2026-12-31',
	autoRenew: false,
	renewalTermMonths: null,
	noticeDays: null,
	valueCents: 450000,
	valueFrequency: 'monthly',
	counterpartyName: 'Imobiliária Central Ltda',
	counterpartyDocument: '11222333000181',
	type: 'Locação',
	alertDays: [90, 30, 7, 0],
	source: 'manual',
}

beforeEach(() => {
	vi.resetAllMocks()
	get.mockResolvedValue({ data: { types: ['Locação', 'Serviços'] } })
	post.mockResolvedValue({ data: DETAIL })
	put.mockResolvedValue({ data: DETAIL })
})

describe('saveContractTerms', () => {
	it('puts each document\'s terms as a draft save that gives up after 30 seconds', async () => {
		const documents = [{ documentId: 1, terms: TERMS }, { documentId: 2, terms: null }]

		expect(await saveContractTerms('u', documents)).toEqual(DETAIL)
		expect(put).toHaveBeenCalledWith(`${ROOT}/envelopes/u/contract-terms`, { documents }, { timeout: DRAFT_SAVE_TIMEOUT_MILLISECONDS })
	})
})

describe('registerContract', () => {
	it('posts the terms of a document of a completed envelope', async () => {
		expect(await registerContract('u', 7, TERMS)).toEqual(DETAIL)
		expect(post).toHaveBeenCalledWith(`${ROOT}/envelopes/u/documents/7/contract`, { terms: TERMS })
	})
})

describe('updateContract', () => {
	it('puts the new terms', async () => {
		expect(await updateContract(CONTRACT_ID, TERMS)).toEqual(DETAIL)
		expect(put).toHaveBeenCalledWith(`${ROOT}/contracts/3`, { terms: TERMS })
	})
})

describe('renewContract', () => {
	it('posts the new end and value', async () => {
		const renewal = { endsOn: '2027-12-31', valueCents: 500000, valueFrequency: 'monthly' as const }

		expect(await renewContract(CONTRACT_ID, renewal)).toEqual(DETAIL)
		expect(post).toHaveBeenCalledWith(`${ROOT}/contracts/3/renew`, renewal)
	})
})

describe('endContract', () => {
	it('posts the reason', async () => {
		expect(await endContract(CONTRACT_ID, 'Distrato')).toEqual(DETAIL)
		expect(post).toHaveBeenCalledWith(`${ROOT}/contracts/3/end`, { reason: 'Distrato' })
	})
})

describe('createRenewalDraft', () => {
	it('posts the chosen PDFs and returns the new draft', async () => {
		expect(await createRenewalDraft(CONTRACT_ID, [77, 78])).toEqual(DETAIL)
		expect(post).toHaveBeenCalledWith(`${ROOT}/contracts/3/renewal-draft`, { fileIds: [77, 78] })
	})
})

describe('getContractTypes', () => {
	it('reads the types this company uses', async () => {
		expect(await getContractTypes()).toEqual(['Locação', 'Serviços'])
		expect(get).toHaveBeenCalledWith(`${ROOT}/contract-types`)
	})
})
```

In `src/api/admin.spec.ts`:
- change the import to `import { getAdminStatus, getContractsAddon, removeEnvelope, resetCounters, setContractsAddon } from './admin.ts'`;
- change the hoisted mocks to `const { get, post, put, remove } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), remove: vi.fn() }))` and the axios mock to `vi.mock('@nextcloud/axios', () => ({ default: { get, post, put, delete: remove } }))`;
- append:

```ts
describe('getContractsAddon', () => {
	it('reads whether contract management is on and whether this user may switch it', async () => {
		get.mockResolvedValue({ data: { enabled: true, canChange: false } })

		expect(await getContractsAddon()).toEqual({ enabled: true, canChange: false })
		expect(get).toHaveBeenCalledWith(`${ROOT}/contracts`)
	})
})

describe('setContractsAddon', () => {
	it('puts the new state and returns it', async () => {
		put.mockResolvedValue({ data: { enabled: true, canChange: true } })

		expect(await setContractsAddon(true)).toEqual({ enabled: true, canChange: true })
		expect(put).toHaveBeenCalledWith(`${ROOT}/contracts`, { enabled: true })
	})
})
```

- [ ] **Step 2: Write the failing configuration and date tests**

Run: `perl -pi -e 's/^(\s+)isAdmin: false,$/$1isAdmin: false,\n$1contractsEnabled: false,/' src/app-config.spec.ts`

In `src/app-config.spec.ts`, add to the `it.each` list of malformed configurations, after `['a flag that is not a boolean', …],`:

```ts
			['a contract switch that is not a boolean', { ...SERVED_CONFIG, contractsEnabled: 'yes' }],
```

and add inside `describe('appConfig', …)`:

```ts
	it('keeps contract management off in the locked-down configuration', () => {
		loadState.mockImplementation((_app: string, _key: string, fallback: unknown) => fallback)

		expect(appConfig().contractsEnabled).toBe(false)
	})
```

In `src/presentation/dates.spec.ts`, add `formatCalendarDate` to the import from `./dates.ts` and add inside `describe('dates', …)`:

```ts
	describe('formatCalendarDate', () => {
		it('writes a calendar day as day, month and year', () => {
			expect(formatCalendarDate('2026-12-31')).toBe('31/12/2026')
		})

		it('keeps the day whatever the viewer timezone', () => {
			expect(formatCalendarDate('2027-01-01')).toBe('01/01/2027')
		})

		it('leaves a text that is not a calendar day as it is', () => {
			expect(formatCalendarDate('amanhã')).toBe('amanhã')
		})
	})
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run src/api/contracts.spec.ts src/api/admin.spec.ts src/app-config.spec.ts src/presentation/dates.spec.ts`
Expected: FAIL — `Failed to resolve import "./contracts.ts"`, `getContractsAddon is not a function`, `formatCalendarDate is not a function`, and the served configurations fall back to locked-down.

- [ ] **Step 4: Add the types**

In `src/api/types.ts`, add to `EnvelopeDocument` after `signedFileId: number | null`:

```ts
	/** The contract terms held until everyone signs; null when the document is not a contract (an annex follows the main one). */
	contractTerms: ContractTerms | null
```

Add to `EnvelopeDetail` after `events: EnvelopeEvent[]`:

```ts
	/** The envelope's signed contracts; empty while the contract add-on is off. */
	contracts: ContractDetail[]
	/** Whether the viewer may edit, renew or end them (the envelope's `canAct`). */
	canActOnContracts: boolean
	/** The contract this envelope renews once everyone signs it ("Renovar com novo documento"). */
	renewsContractId: number | null
```

Append to the end of the file:

```ts
export type ContractStatus = 'active' | 'expired' | 'ended' | 'renewed'

export type ContractSource = 'manual' | 'ai_confirmed'

export type ValueFrequency = 'once' | 'monthly' | 'yearly'

/** A contract's terms; dates are `YYYY-MM-DD` calendar days of the instance. */
export interface ContractTerms {
	startsOn: string | null
	endsOn: string
	autoRenew: boolean
	/** Set only when the contract renews itself. */
	renewalTermMonths: number | null
	noticeDays: number | null
	valueCents: number | null
	valueFrequency: ValueFrequency | null
	counterpartyName: string | null
	/** A CPF or CNPJ, digits and capital letters only. */
	counterpartyDocument: string | null
	type: string | null
	/** Days before the key date that alert, largest first. */
	alertDays: number[]
	source: ContractSource
}

/** A signed contract. `keyDate` is the notice deadline of a contract that renews itself, else its end. */
export interface Contract extends ContractTerms {
	id: number
	envelopeUuid: string
	documentId: number
	name: string
	status: ContractStatus
	keyDate: string
	/** Days from today (instance timezone) to the key date; negative once it passed. */
	daysUntilKeyDate: number
	continuesContractId: number | null
	endReason: string | null
}

/** One contract of a renewal chain; `envelopeUuid` is null when the viewer cannot open that envelope. */
export interface ContractLink {
	contractId: number
	envelopeUuid: string | null
	name: string
	startsOn: string | null
	endsOn: string
	status: ContractStatus
	isCurrent: boolean
}

export interface ContractDetail extends Contract {
	/** Oldest first; empty when the contract renews nothing and was not renewed. */
	chain: ContractLink[]
}

/** One entry of `PUT /envelopes/{uuid}/contract-terms`: null terms mean "not a contract". */
export interface DocumentContractTerms {
	documentId: number
	terms: ContractTerms | null
}

/** The body of `POST /contracts/{id}/renew`; a null value keeps the current one. */
export interface ContractRenewal {
	endsOn: string
	valueCents: number | null
	valueFrequency: ValueFrequency | null
}

/** The contract management add-on: on or off, and whether this user may switch it (Nextcloud admins only). */
export interface ContractsAddon {
	enabled: boolean
	canChange: boolean
}
```

- [ ] **Step 5: Add the API module and the admin calls**

Create `src/api/contracts.ts`:

```ts
import type { ContractRenewal, ContractTerms, DocumentContractTerms, EnvelopeDetail } from './types.ts'

import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'
import { API_ROOT } from '../app-urls.ts'
import { calling } from './api-error.ts'
import { DRAFT_SAVE_TIMEOUT_MILLISECONDS } from './envelopes.ts'

const DRAFT_SAVE = { timeout: DRAFT_SAVE_TIMEOUT_MILLISECONDS } as const

function contractUrl(contractId: number, path = ''): string {
	return generateUrl(`${API_ROOT}/contracts/${contractId}${path}`)
}

function envelopeUrl(uuid: string, path: string): string {
	return generateUrl(`${API_ROOT}/envelopes/${encodeURIComponent(uuid)}${path}`)
}

/** Holds the terms of a draft's documents until everyone signs; null terms mean "not a contract". */
export async function saveContractTerms(uuid: string, documents: DocumentContractTerms[]): Promise<EnvelopeDetail> {
	return calling(async () => (await axios.put<EnvelopeDetail>(envelopeUrl(uuid, '/contract-terms'), { documents }, DRAFT_SAVE)).data)
}

/** Records the contract of a document of a completed envelope ("Registrar dados do contrato"). */
export async function registerContract(uuid: string, documentId: number, terms: ContractTerms): Promise<EnvelopeDetail> {
	return calling(async () => (await axios.post<EnvelopeDetail>(envelopeUrl(uuid, `/documents/${documentId}/contract`), { terms })).data)
}

export async function updateContract(contractId: number, terms: ContractTerms): Promise<EnvelopeDetail> {
	return calling(async () => (await axios.put<EnvelopeDetail>(contractUrl(contractId), { terms })).data)
}

/** A later end, and optionally a new value, for the same contract. */
export async function renewContract(contractId: number, renewal: ContractRenewal): Promise<EnvelopeDetail> {
	return calling(async () => (await axios.post<EnvelopeDetail>(contractUrl(contractId, '/renew'), renewal)).data)
}

export async function endContract(contractId: number, reason: string): Promise<EnvelopeDetail> {
	return calling(async () => (await axios.post<EnvelopeDetail>(contractUrl(contractId, '/end'), { reason })).data)
}

/** Opens a draft for the contract's next term with these PDFs; it renews the contract once everyone signs it. */
export async function createRenewalDraft(contractId: number, fileIds: number[]): Promise<EnvelopeDetail> {
	return calling(async () => (await axios.post<EnvelopeDetail>(contractUrl(contractId, '/renewal-draft'), { fileIds })).data)
}

/** The contract types this company already uses, for the "Tipo" field to suggest. */
export async function getContractTypes(): Promise<string[]> {
	return calling(async () => (await axios.get<{ types: string[] }>(generateUrl(`${API_ROOT}/contract-types`))).data.types)
}
```

In `src/api/admin.ts`, change the type import to `import type { AdminStatus, ContractsAddon } from './types.ts'` and append:

```ts
/** Whether the contract management add-on is on, and whether this user may switch it. */
export async function getContractsAddon(): Promise<ContractsAddon> {
	return calling(async () => (await axios.get<ContractsAddon>(adminUrl('/contracts'))).data)
}

/** Switches the add-on (Nextcloud admins only). */
export async function setContractsAddon(enabled: boolean): Promise<ContractsAddon> {
	return calling(async () => (await axios.put<ContractsAddon>(adminUrl('/contracts'), { enabled })).data)
}
```

- [ ] **Step 6: Add the query keys and the configuration flag**

In `src/api/query-keys.ts`, change `DRAFT_CHANGES` to:

```ts
export const DRAFT_CHANGES = ['title', 'documents', 'signers', 'signingOrder', 'fields', 'settings', 'contract'] as const
```

and add to `QUERY_KEYS` after `adminStatus`:

```ts
	/** The contract types this company uses, suggested by the "Tipo" field. */
	contractTypes: (): readonly ['contract-types'] => ['contract-types'],
	contractsAddon: (): readonly ['contracts-addon'] => ['contracts-addon'],
```

In `src/app-config.ts`:
- add `contractsEnabled: boolean` to `AppConfig` after `isAdmin: boolean`;
- add `contractsEnabled: false,` to `LOCKED_DOWN` after `isAdmin: false,`;
- add `&& typeof value.contractsEnabled === 'boolean'` to `isAppConfig()` after the `isAdmin` check.

- [ ] **Step 7: Add the calendar date format**

In `src/presentation/dates.ts`, add after the `YEAR_MONTH_PATTERN` constant:

```ts
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const CALENDAR_DATE_FORMAT: Intl.DateTimeFormatOptions = { ...DATE_FORMAT, timeZone: 'UTC' }
```

and after `formatYearMonth()`:

```ts
/** 31/12/2026, from "2026-12-31". A calendar day has no timezone, so the viewer's does not move it. */
export function formatCalendarDate(day: string): string {
	const match = day.match(CALENDAR_DATE_PATTERN)
	if (match === null) {
		return day
	}
	const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
	return new Intl.DateTimeFormat(getCanonicalLocale(), CALENDAR_DATE_FORMAT).format(date)
}
```

- [ ] **Step 8: Add the error texts and their translations**

In `src/api/error-messages.ts`, add to `ERROR_SOURCE_TEXTS` before `} as const satisfies Record<string, string>`:

```ts
	contracts_disabled: 'Contract management is not active for this company.',
	contract_invalid: 'The contract details are not valid.',
	contract_starts_on_invalid: 'Enter a valid start date.',
	contract_ends_on_invalid: 'Enter a valid end date.',
	contract_dates_invalid: 'The end date must come after the start date.',
	contract_renewal_term_invalid: 'Enter a renewal term from 1 to 120 months.',
	contract_notice_invalid: 'Enter a notice period from 0 to 3650 days.',
	contract_value_invalid: 'Enter a value greater than zero.',
	contract_frequency_invalid: 'Choose how often the value is charged.',
	contract_counterparty_invalid: 'The counterparty name is too long.',
	contract_tax_id_invalid: 'Enter a valid CNPJ or CPF.',
	contract_type_invalid: 'The type is too long.',
	contract_alert_days_invalid: 'Enter up to 10 alert days from 0 to 3650, separated by commas.',
	contract_not_found: 'This contract does not exist or you cannot see it.',
	contract_closed: 'This contract was ended or replaced.',
	contract_changed: 'This contract changed meanwhile. Check it and try again.',
	contract_exists: 'This document already has contract details.',
	envelope_not_completed: 'Contract details can be recorded once everyone signed.',
	renewal_not_later: 'Choose an end date later than the current one.',
	end_reason_invalid: 'Enter a reason of up to 500 characters.',
```

(`end_reason_invalid` shares its text, and so its translation, with `cancel_reason_invalid`.)

Run:

```bash
node scripts/add-translations.mjs <<'JSON'
{
	"Contract management is not active for this company.": "A gestão de contratos não está contratada para esta empresa.",
	"The contract details are not valid.": "Os dados do contrato não são válidos.",
	"Enter a valid start date.": "Informe uma data de início válida.",
	"Enter a valid end date.": "Informe uma data de término válida.",
	"The end date must come after the start date.": "O término precisa ser depois do início.",
	"Enter a renewal term from 1 to 120 months.": "Informe um prazo de renovação de 1 a 120 meses.",
	"Enter a notice period from 0 to 3650 days.": "Informe um aviso prévio de 0 a 3650 dias.",
	"Enter a value greater than zero.": "Informe um valor maior que zero.",
	"Choose how often the value is charged.": "Escolha a frequência da cobrança.",
	"The counterparty name is too long.": "O nome da contraparte está longo demais.",
	"Enter a valid CNPJ or CPF.": "Informe um CNPJ ou CPF válido.",
	"The type is too long.": "O tipo está longo demais.",
	"Enter up to 10 alert days from 0 to 3650, separated by commas.": "Informe até 10 dias de alerta, de 0 a 3650, separados por vírgula.",
	"This contract does not exist or you cannot see it.": "Este contrato não existe ou você não pode vê-lo.",
	"This contract was ended or replaced.": "Este contrato foi encerrado ou substituído.",
	"This contract changed meanwhile. Check it and try again.": "Este contrato mudou enquanto isso. Confira e tente de novo.",
	"This document already has contract details.": "Este documento já tem dados de contrato.",
	"Contract details can be recorded once everyone signed.": "Os dados do contrato podem ser registrados depois que todos assinarem.",
	"Choose an end date later than the current one.": "Escolha um término depois do atual."
}
JSON
```

- [ ] **Step 9: Give the fixtures the new fields**

```bash
perl -pi -e 's/^(\s+)signedFileId: null,$/$1signedFileId: null,\n$1contractTerms: null,/' src/wizard/wizard-steps.spec.ts src/pdf/pdf-document.spec.ts src/detail/DetailView.spec.ts src/test-support/wizard-harness.ts
perl -pi -e 's/signedFileId: null, fields: \[\]/signedFileId: null, contractTerms: null, fields: []/' src/placement/unopened-placement.spec.ts
perl -pi -e 's/^(\s+)events: \[\],$/$1events: [],\n$1contracts: [],\n$1canActOnContracts: false,\n$1renewsContractId: null,/' src/test-support/envelope-fixtures.ts src/new-envelope.spec.ts src/files/send-for-signature-action.spec.ts
```

- [ ] **Step 10: Run the tests and the type check**

Run: `npx vitest run src/api src/app-config.spec.ts src/presentation/dates.spec.ts src/l10n.spec.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: exits 0. (A fixture the commands above missed shows up here as a missing `contractTerms` or `contracts`; add the field the same way.)

- [ ] **Step 11: Commit**

```bash
git add src/api src/app-config.ts src/app-config.spec.ts src/presentation/dates.ts src/presentation/dates.spec.ts src/test-support src/wizard/wizard-steps.spec.ts src/pdf/pdf-document.spec.ts src/detail/DetailView.spec.ts src/placement/unopened-placement.spec.ts src/new-envelope.spec.ts src/files/send-for-signature-action.spec.ts l10n
git commit -m "feat(contracts): add the contract API, types and error texts to the frontend"
```

---

### Task 12: The add-on switch on the admin page

**Files:**
- Create: `src/admin/ContractsAddonSection.vue`
- Modify: `src/admin/AdminSettings.vue`, `src/admin/AdminSettings.spec.ts` (mock the two new calls)
- Test: `src/admin/ContractsAddonSection.spec.ts` (new)

**Interfaces:**
- Consumes: `getContractsAddon`, `setContractsAddon`, `QUERY_KEYS.contractsAddon()`.
- Produces: `<ContractsAddonSection />` (no props), reusable wherever managers get an admin panel.

- [ ] **Step 1: Write the failing test**

Create `src/admin/ContractsAddonSection.spec.ts`:

```ts
import type { VueWrapper } from '@vue/test-utils'

import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ContractsAddonSection from './ContractsAddonSection.vue'
import { getContractsAddon, setContractsAddon } from '../api/admin.ts'
import { usePortugueseEnvironment } from '../test-support/pt-br-environment.ts'

vi.mock('../api/admin.ts', () => ({
	getContractsAddon: vi.fn(),
	setContractsAddon: vi.fn(),
}))
vi.mock('../logger.ts', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

usePortugueseEnvironment()

const mounted: VueWrapper[] = []

async function mountSection() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	const wrapper = mount(ContractsAddonSection, {
		attachTo: document.body,
		global: { plugins: [[VueQueryPlugin, { queryClient }]] },
	})
	mounted.push(wrapper)
	await flushPromises()
	return wrapper
}

beforeEach(() => {
	vi.mocked(getContractsAddon).mockReset()
	vi.mocked(setContractsAddon).mockReset()
})

afterEach(() => {
	mounted.splice(0).forEach((wrapper) => wrapper.unmount())
})

describe('ContractsAddonSection', () => {
	it('lets a Nextcloud admin turn contract management on', async () => {
		vi.mocked(getContractsAddon).mockResolvedValue({ enabled: false, canChange: true })
		vi.mocked(setContractsAddon).mockResolvedValue({ enabled: true, canChange: true })
		const wrapper = await mountSection()
		const checkbox = wrapper.find('input[type="checkbox"]')

		expect(wrapper.text()).toContain('Gestão de contratos contratada')
		await checkbox.setValue(true)
		await flushPromises()

		expect(setContractsAddon).toHaveBeenCalledWith(true)
		expect(wrapper.find<HTMLInputElement>('input[type="checkbox"]').element.checked).toBe(true)
	})

	it('shows a manager the state without letting them change it', async () => {
		vi.mocked(getContractsAddon).mockResolvedValue({ enabled: true, canChange: false })
		const wrapper = await mountSection()
		const checkbox = wrapper.find<HTMLInputElement>('input[type="checkbox"]')

		expect(checkbox.element.checked).toBe(true)
		expect(checkbox.attributes('disabled')).toBeDefined()
		expect(wrapper.text()).toContain('Somente administradores do Nextcloud podem alterar isto.')
	})

	it('says so when the setting cannot be loaded', async () => {
		vi.mocked(getContractsAddon).mockRejectedValue(new Error('offline'))
		const wrapper = await mountSection()

		expect(wrapper.text()).toContain('Não foi possível carregar a configuração da gestão de contratos.')
	})
})
```

In `src/admin/AdminSettings.spec.ts`, change the mock to:

```ts
vi.mock('../api/admin.ts', () => ({
	getAdminStatus: vi.fn(),
	resetCounters: vi.fn(),
	getContractsAddon: vi.fn(),
	setContractsAddon: vi.fn(),
}))
```

add `getContractsAddon` to its import from `'../api/admin.ts'`, and add to its `beforeEach`:

```ts
	vi.mocked(getContractsAddon).mockResolvedValue({ enabled: false, canChange: true })
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/admin`
Expected: FAIL with `Failed to resolve import "./ContractsAddonSection.vue"`.

- [ ] **Step 3: Implement the section**

Create `src/admin/ContractsAddonSection.vue`:

```vue
<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcSettingsSection from '@nextcloud/vue/components/NcSettingsSection'
import { getContractsAddon, setContractsAddon } from '../api/admin.ts'
import { QUERY_KEYS } from '../api/query-keys.ts'
import { APP_ID } from '../app-config.ts'
import { ICON_SIZE_INLINE } from '../icon-sizes.ts'
import { logger } from '../logger.ts'

const queryClient = useQueryClient()

const addon = useQuery({ queryKey: QUERY_KEYS.contractsAddon(), queryFn: getContractsAddon })

const toggle = useMutation({
	mutationFn: setContractsAddon,
	onSuccess: (saved) => queryClient.setQueryData(QUERY_KEYS.contractsAddon(), saved),
	onError: (error) => logger.error('Switching contract management failed', { error }),
})

function onChange(value: unknown) {
	if (typeof value !== 'boolean') {
		return
	}
	toggle.mutate(value)
}
</script>

<template>
	<NcSettingsSection
		:name="t(APP_ID, 'Contract management')"
		:description="t(APP_ID, 'Track contract terms, get alerts before deadlines and renew contracts.')">
		<NcLoadingIcon v-if="addon.isPending.value" :size="ICON_SIZE_INLINE" :name="t(APP_ID, 'Loading the contract management setting')" />
		<NcNoteCard v-else-if="addon.isError.value" type="error" :text="t(APP_ID, 'Could not load the contract management setting.')" />
		<template v-else-if="addon.data.value !== undefined">
			<NcCheckboxRadioSwitch
				:modelValue="addon.data.value.enabled"
				:disabled="!addon.data.value.canChange || toggle.isPending.value"
				@update:modelValue="onChange">
				{{ t(APP_ID, 'Contract management purchased') }}
			</NcCheckboxRadioSwitch>
			<p v-if="!addon.data.value.canChange" class="contracts-addon__note">
				{{ t(APP_ID, 'Only Nextcloud administrators can change this.') }}
			</p>
			<NcNoteCard v-if="toggle.isError.value" type="error" :text="t(APP_ID, 'Could not change the setting. Try again.')" />
		</template>
	</NcSettingsSection>
</template>

<style scoped>
.contracts-addon__note {
	color: var(--color-text-maxcontrast);
}
</style>
```

In `src/admin/AdminSettings.vue`, add `import ContractsAddonSection from './ContractsAddonSection.vue'` with the other component imports and add `<ContractsAddonSection />` as the last child of `<div class="assinaturas-admin">`.

Add the translations:

```bash
node scripts/add-translations.mjs <<'JSON'
{
	"Contract management": "Gestão de contratos",
	"Track contract terms, get alerts before deadlines and renew contracts.": "Acompanhe a vigência dos contratos, receba alertas antes dos prazos e renove contratos.",
	"Loading the contract management setting": "Carregando a configuração da gestão de contratos",
	"Could not load the contract management setting.": "Não foi possível carregar a configuração da gestão de contratos.",
	"Contract management purchased": "Gestão de contratos contratada",
	"Only Nextcloud administrators can change this.": "Somente administradores do Nextcloud podem alterar isto.",
	"Could not change the setting. Try again.": "Não foi possível alterar a configuração. Tente de novo."
}
JSON
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/admin src/l10n.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin l10n
git commit -m "feat(contracts): switch contract management on the admin page"
```

---

### Task 13: Contract form rules in the browser

**Files:**
- Create: `src/contracts/tax-id.ts`, `src/contracts/money.ts`, `src/contracts/contract-form.ts`
- Test: `src/contracts/tax-id.spec.ts`, `src/contracts/money.spec.ts`, `src/contracts/contract-form.spec.ts`

**Interfaces:**
- Consumes: `ContractTerms`, `ContractSource`, `ValueFrequency` types; `ErrorCode` (Task 11).
- Produces:
  - `normalizeTaxId(text): string`, `isValidTaxId(normalized): boolean`, `formatTaxId(normalized): string`.
  - `parseCents(text): number | null`, `formatDecimal(cents): string` ("4.500,00"), `formatMoney(cents): string` ("R$ 4.500,00").
  - `CONTRACT_LIMITS`, `DEFAULT_ALERT_DAYS`, `VALUE_FREQUENCIES`, `interface ContractForm`, `type ContractField`, `type ContractFormErrors = Partial<Record<ContractField, ErrorCode>>`, `isValueFrequency(value): value is ValueFrequency`, `isCalendarDate(text): boolean`, `isContractTerms(value): value is ContractTerms`, `emptyContractForm(counterpartyName?): ContractForm`, `contractFormFrom(terms): ContractForm`, `parseAlertDays(text): number[] | null`, `validateContractForm(form): ContractFormErrors`, `contractTermsFrom(form, source?): ContractTerms | null`, `sameTerms(first, second): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `src/contracts/tax-id.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatTaxId, isValidTaxId, normalizeTaxId } from './tax-id.ts'

describe('tax ids', () => {
	it.each([
		['a CPF', '52998224725'],
		['a numeric CNPJ', '11222333000181'],
		['an alphanumeric CNPJ', '12ABC34501DE35'],
	])('accepts %s', (_kind, normalized) => {
		expect(isValidTaxId(normalized)).toBe(true)
	})

	it.each([
		['a CPF with a wrong check digit', '52998224724'],
		['a CNPJ with a wrong check digit', '11222333000182'],
		['a CPF of one repeated digit', '11111111111'],
		['a CNPJ of zeros', '00000000000000'],
		['too few digits', '1234567890'],
		['letters in the check digits', '12ABC34501DEAB'],
	])('rejects %s', (_kind, normalized) => {
		expect(isValidTaxId(normalized)).toBe(false)
	})

	it('drops punctuation and raises letters', () => {
		expect(normalizeTaxId(' 12.abc.345/01de-35 ')).toBe('12ABC34501DE35')
	})

	it('writes a CPF and a CNPJ the way people read them', () => {
		expect(formatTaxId('52998224725')).toBe('529.982.247-25')
		expect(formatTaxId('11222333000181')).toBe('11.222.333/0001-81')
		expect(formatTaxId('12ABC34501DE35')).toBe('12.ABC.345/01DE-35')
	})
})
```

Create `src/contracts/money.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { usePortugueseEnvironment } from '../test-support/pt-br-environment.ts'
import { formatDecimal, formatMoney, parseCents } from './money.ts'

usePortugueseEnvironment()

describe('money', () => {
	it.each([
		['4.500,00', 450000],
		['4500,5', 450050],
		['4500', 450000],
		['4.500', 450000],
		['4500.50', 450050],
		['R$ 1.234.567,89', 123456789],
	])('reads %s as cents', (text, cents) => {
		expect(parseCents(text)).toBe(cents)
	})

	it.each([['quatro mil'], ['4,500,00'], ['4500,123'], ['']])('refuses %j', (text) => {
		expect(parseCents(text)).toBeNull()
	})

	it('writes cents for a form field and for reading', () => {
		expect(formatDecimal(450000)).toBe('4.500,00')
		expect(formatMoney(450000)).toBe('R$ 4.500,00')
	})
})
```

Create `src/contracts/contract-form.spec.ts`:

```ts
import type { ContractTerms } from '../api/types.ts'
import type { ContractForm } from './contract-form.ts'

import { describe, expect, it } from 'vitest'
import { usePortugueseEnvironment } from '../test-support/pt-br-environment.ts'
import { contractFormFrom, contractTermsFrom, emptyContractForm, isContractTerms, parseAlertDays, sameTerms, validateContractForm } from './contract-form.ts'

usePortugueseEnvironment()

const TERMS: ContractTerms = {
	startsOn: '2026-01-01',
	endsOn: '2026-12-31',
	autoRenew: true,
	renewalTermMonths: 12,
	noticeDays: 30,
	valueCents: 450000,
	valueFrequency: 'monthly',
	counterpartyName: 'Imobiliária Central Ltda',
	counterpartyDocument: '11222333000181',
	type: 'Locação',
	alertDays: [90, 30, 7, 0],
	source: 'manual',
}

function formWith(changes: Partial<ContractForm>): ContractForm {
	return { ...emptyContractForm(), endsOn: '2026-12-31', ...changes }
}

describe('contract form', () => {
	it('starts empty with the default alerts and the given counterparty', () => {
		expect(emptyContractForm('Ana Lima')).toMatchObject({ endsOn: '', autoRenew: false, counterpartyName: 'Ana Lima', alertDays: '90, 30, 7, 0' })
	})

	it('reads saved terms back into the same terms', () => {
		const form = contractFormFrom(TERMS)

		expect(form).toMatchObject({ value: '4.500,00', counterpartyDocument: '11.222.333/0001-81', renewalTermMonths: '12', noticeDays: '30' })
		expect(contractTermsFrom(form)).toEqual(TERMS)
	})

	it('needs nothing but the end date', () => {
		expect(validateContractForm(formWith({}))).toEqual({})
		expect(contractTermsFrom(formWith({}))).toMatchObject({ startsOn: null, valueCents: null, valueFrequency: null, counterpartyName: null, alertDays: [90, 30, 7, 0] })
	})

	it.each([
		['no end date', { endsOn: '' }, 'endsOn', 'contract_ends_on_invalid'],
		['an end date that does not exist', { endsOn: '2026-02-30' }, 'endsOn', 'contract_ends_on_invalid'],
		['an end before the start', { startsOn: '2027-01-01' }, 'endsOn', 'contract_dates_invalid'],
		['a renewal without a term', { autoRenew: true, renewalTermMonths: '' }, 'renewalTermMonths', 'contract_renewal_term_invalid'],
		['a notice period that is not a number', { noticeDays: 'trinta' }, 'noticeDays', 'contract_notice_invalid'],
		['a value of zero', { value: '0', valueFrequency: 'once' as const }, 'value', 'contract_value_invalid'],
		['a value without a frequency', { value: '100' }, 'valueFrequency', 'contract_frequency_invalid'],
		['a CNPJ with a wrong check digit', { counterpartyDocument: '11.222.333/0001-82' }, 'counterpartyDocument', 'contract_tax_id_invalid'],
		['an alert that is not a day count', { alertDays: '30, amanhã' }, 'alertDays', 'contract_alert_days_invalid'],
	])('marks %s with the server\'s code', (_case, changes, field, code) => {
		expect(validateContractForm(formWith(changes))).toEqual({ [field]: code })
		expect(contractTermsFrom(formWith(changes))).toBeNull()
	})

	it('ignores the renewal term of a contract that does not renew itself', () => {
		expect(contractTermsFrom(formWith({ autoRenew: false, renewalTermMonths: 'x' }))?.renewalTermMonths).toBeNull()
	})

	it('reads alert days in any order, once each, largest first', () => {
		expect(parseAlertDays('7; 90 30,7 0')).toEqual([90, 30, 7, 0])
		expect(parseAlertDays('')).toEqual([])
		expect(parseAlertDays('1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11')).toBeNull()
	})

	it('tells equal terms apart from changed ones', () => {
		expect(sameTerms(TERMS, { ...TERMS, alertDays: [90, 30, 7, 0] })).toBe(true)
		expect(sameTerms(TERMS, { ...TERMS, endsOn: '2027-12-31' })).toBe(false)
		expect(sameTerms(null, null)).toBe(true)
		expect(sameTerms(TERMS, null)).toBe(false)
	})

	it('recognizes terms the server or a save sent', () => {
		expect(isContractTerms(TERMS)).toBe(true)
		expect(isContractTerms({ ...TERMS, valueFrequency: 'weekly' })).toBe(false)
		expect(isContractTerms({ endsOn: '2026-12-31' })).toBe(false)
	})
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/contracts`
Expected: FAIL with `Failed to resolve import "./tax-id.ts"` (and the same for the other modules).

- [ ] **Step 3: Implement the tax ids**

Create `src/contracts/tax-id.ts`:

```ts
const SEPARATORS = /[\s./-]/g
const CPF_PATTERN = /^\d{11}$/
const CNPJ_PATTERN = /^[0-9A-Z]{12}\d{2}$/
const CPF_PARTS = /^(\d{3})(\d{3})(\d{3})(\d{2})$/
const CNPJ_PARTS = /^(.{2})(.{3})(.{3})(.{4})(.{2})$/
const CPF_BASE_LENGTH = 9
const CNPJ_BASE_LENGTH = 12
const CNPJ_FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
const CNPJ_SECOND_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
const ZERO_CODE_POINT = 48
const MODULUS = 11
const CPF_TEN_IS_ZERO = 10
const CNPJ_SMALL_REMAINDER = 2
const SECOND_TO_LAST = -2
const LAST = -1

/** Upper case, without dots, slashes, dashes or spaces: " 12.abc.345/01de-35 " → "12ABC34501DE35". */
export function normalizeTaxId(text: string): string {
	return text.replace(SEPARATORS, '').toUpperCase()
}

/** Each character's code point minus 48: digits weigh 0-9 and the letters of an alphanumeric CNPJ 17-42. */
function values(text: string): number[] {
	return Array.from(text, (character) => character.charCodeAt(0) - ZERO_CODE_POINT)
}

function isRepeated(text: string): boolean {
	return new Set(text).size === 1
}

function cpfDigit(digits: number[]): number {
	const sum = digits.reduce((total, digit, index) => total + digit * (digits.length + 1 - index), 0)
	const remainder = (sum * 10) % MODULUS
	return remainder === CPF_TEN_IS_ZERO ? 0 : remainder
}

function cnpjDigit(characterValues: number[], weights: number[]): number {
	const sum = characterValues.reduce((total, value, index) => total + value * (weights[index] ?? 0), 0)
	const remainder = sum % MODULUS
	return remainder < CNPJ_SMALL_REMAINDER ? 0 : MODULUS - remainder
}

function isValidCpf(text: string): boolean {
	const digits = values(text)
	const base = digits.slice(0, CPF_BASE_LENGTH)
	const first = cpfDigit(base)
	return !isRepeated(text) && first === digits.at(SECOND_TO_LAST) && cpfDigit([...base, first]) === digits.at(LAST)
}

function isValidCnpj(text: string): boolean {
	const characterValues = values(text)
	const base = characterValues.slice(0, CNPJ_BASE_LENGTH)
	const first = cnpjDigit(base, CNPJ_FIRST_WEIGHTS)
	return !isRepeated(text) && first === characterValues.at(SECOND_TO_LAST) && cnpjDigit([...base, first], CNPJ_SECOND_WEIGHTS) === characterValues.at(LAST)
}

const VALIDATORS: ReadonlyArray<readonly [RegExp, (text: string) => boolean]> = [
	[CPF_PATTERN, isValidCpf],
	[CNPJ_PATTERN, isValidCnpj],
]

/** A CPF, or a numeric or alphanumeric CNPJ, whose check digits match: the server checks the same. */
export function isValidTaxId(normalized: string): boolean {
	return VALIDATORS.some(([pattern, isValid]) => pattern.test(normalized) && isValid(normalized))
}

/** 529.982.247-25 or 12.ABC.345/01DE-35; anything else as given. */
export function formatTaxId(normalized: string): string {
	if (CPF_PATTERN.test(normalized)) {
		return normalized.replace(CPF_PARTS, '$1.$2.$3-$4')
	}
	if (CNPJ_PATTERN.test(normalized)) {
		return normalized.replace(CNPJ_PARTS, '$1.$2.$3/$4-$5')
	}
	return normalized
}
```

- [ ] **Step 4: Implement money**

Create `src/contracts/money.ts`:

```ts
import { getCanonicalLocale } from '@nextcloud/l10n'

const CENTS_PER_UNIT = 100
const CURRENCY = 'BRL'
const CURRENCY_SYMBOL = /R\$/g
const SPACES = /\s/g
const DOTS = /\./g
const DECIMAL = /^\d+(?:\.\d{1,2})?$/
const THOUSANDS_WITHOUT_CENTS = /^\d{1,3}(?:\.\d{3})+$/
const DECIMAL_COMMA = ','
const DECIMAL_POINT = '.'
const FRACTION_DIGITS = 2

/** "4.500,00" → "4500.00"; "4.500" → "4500" (dots grouping thousands); "4500.50" stays. */
function asDecimal(bare: string): string {
	if (bare.includes(DECIMAL_COMMA)) {
		return bare.replace(DOTS, '').replace(DECIMAL_COMMA, DECIMAL_POINT)
	}
	return THOUSANDS_WITHOUT_CENTS.test(bare) ? bare.replace(DOTS, '') : bare
}

/** Cents from a value as people type it in Brazil ("4.500,00", "4500,5", "4.500", "R$ 4500"); null for anything else. */
export function parseCents(text: string): number | null {
	const decimal = asDecimal(text.replace(CURRENCY_SYMBOL, '').replace(SPACES, ''))
	if (!DECIMAL.test(decimal)) {
		return null
	}
	return Math.round(Number(decimal) * CENTS_PER_UNIT)
}

/** "4.500,00", for a form field. */
export function formatDecimal(cents: number): string {
	return new Intl.NumberFormat(getCanonicalLocale(), { minimumFractionDigits: FRACTION_DIGITS, maximumFractionDigits: FRACTION_DIGITS }).format(cents / CENTS_PER_UNIT)
}

/** "R$ 4.500,00", for reading. */
export function formatMoney(cents: number): string {
	return new Intl.NumberFormat(getCanonicalLocale(), { style: 'currency', currency: CURRENCY }).format(cents / CENTS_PER_UNIT)
}
```

- [ ] **Step 5: Implement the form rules**

Create `src/contracts/contract-form.ts`:

```ts
import type { ErrorCode } from '../api/error-messages.ts'
import type { ContractSource, ContractTerms, ValueFrequency } from '../api/types.ts'

import { formatDecimal, parseCents } from './money.ts'
import { formatTaxId, isValidTaxId, normalizeTaxId } from './tax-id.ts'

/** What ContractTerms (PHP) accepts; the form checks the same so a problem shows before saving. */
export const CONTRACT_LIMITS = {
	maxRenewalTermMonths: 120,
	maxNoticeDays: 3650,
	maxAlertDay: 3650,
	maxAlerts: 10,
	maxValueCents: 1_000_000_000_000_000,
	maxCounterpartyLength: 255,
	maxTypeLength: 100,
	maxEndReasonLength: 500,
} as const

export const DEFAULT_ALERT_DAYS: readonly number[] = [90, 30, 7, 0]

export const VALUE_FREQUENCIES: readonly ValueFrequency[] = ['once', 'monthly', 'yearly']

const CONTRACT_SOURCES: readonly ContractSource[] = ['manual', 'ai_confirmed']

/** A contract's fields while someone types: text as typed, checked on the way out. */
export interface ContractForm {
	startsOn: string
	endsOn: string
	autoRenew: boolean
	renewalTermMonths: string
	noticeDays: string
	value: string
	valueFrequency: ValueFrequency | ''
	counterpartyName: string
	counterpartyDocument: string
	type: string
	alertDays: string
}

export type ContractField = keyof ContractForm

export type ContractFormErrors = Partial<Record<ContractField, ErrorCode>>

const DEFAULT_RENEWAL_TERM_MONTHS = '12'
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const WHOLE_NUMBER = /^\d+$/
const ALERT_SEPARATOR = /[\s,;]+/
const ALERT_LIST_SEPARATOR = ', '
const EARLIEST_YEAR = 1900
const LATEST_YEAR = 2199
const TERM_KEYS = [
	'startsOn',
	'endsOn',
	'autoRenew',
	'renewalTermMonths',
	'noticeDays',
	'valueCents',
	'valueFrequency',
	'counterpartyName',
	'counterpartyDocument',
	'type',
	'alertDays',
	'source',
] as const satisfies readonly (keyof ContractTerms)[]

export function isValueFrequency(value: unknown): value is ValueFrequency {
	return VALUE_FREQUENCIES.some((frequency) => frequency === value)
}

/** A day that exists, in the years the server accepts (1900–2199). */
export function isCalendarDate(text: string): boolean {
	if (!DATE_PATTERN.test(text)) {
		return false
	}
	const [year = 0, month = 0, day = 0] = text.split('-').map(Number)
	const date = new Date(Date.UTC(year, month - 1, day))
	return year >= EARLIEST_YEAR && year <= LATEST_YEAR && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function isNullableString(value: unknown): boolean {
	return value === null || typeof value === 'string'
}

function isNullableNumber(value: unknown): boolean {
	return value === null || typeof value === 'number'
}

/** Terms as the server or a failed save sent them. */
export function isContractTerms(value: unknown): value is ContractTerms {
	return isRecord(value)
		&& isNullableString(value.startsOn) && typeof value.endsOn === 'string' && typeof value.autoRenew === 'boolean'
		&& isNullableNumber(value.renewalTermMonths) && isNullableNumber(value.noticeDays) && isNullableNumber(value.valueCents)
		&& (value.valueFrequency === null || isValueFrequency(value.valueFrequency))
		&& isNullableString(value.counterpartyName) && isNullableString(value.counterpartyDocument) && isNullableString(value.type)
		&& Array.isArray(value.alertDays) && value.alertDays.every((day) => typeof day === 'number')
		&& CONTRACT_SOURCES.some((source) => source === value.source)
}

/** A blank form; the counterparty starts as the first signer's name, when there is one. */
export function emptyContractForm(counterpartyName = ''): ContractForm {
	return {
		startsOn: '',
		endsOn: '',
		autoRenew: false,
		renewalTermMonths: DEFAULT_RENEWAL_TERM_MONTHS,
		noticeDays: '',
		value: '',
		valueFrequency: '',
		counterpartyName,
		counterpartyDocument: '',
		type: '',
		alertDays: DEFAULT_ALERT_DAYS.join(ALERT_LIST_SEPARATOR),
	}
}

export function contractFormFrom(terms: ContractTerms): ContractForm {
	return {
		startsOn: terms.startsOn ?? '',
		endsOn: terms.endsOn,
		autoRenew: terms.autoRenew,
		renewalTermMonths: terms.renewalTermMonths === null ? DEFAULT_RENEWAL_TERM_MONTHS : String(terms.renewalTermMonths),
		noticeDays: terms.noticeDays === null ? '' : String(terms.noticeDays),
		value: terms.valueCents === null ? '' : formatDecimal(terms.valueCents),
		valueFrequency: terms.valueFrequency ?? '',
		counterpartyName: terms.counterpartyName ?? '',
		counterpartyDocument: terms.counterpartyDocument === null ? '' : formatTaxId(terms.counterpartyDocument),
		type: terms.type ?? '',
		alertDays: terms.alertDays.join(ALERT_LIST_SEPARATOR),
	}
}

function wholeNumberWithin(text: string, min: number, max: number): number | null {
	const trimmed = text.trim()
	if (!WHOLE_NUMBER.test(trimmed)) {
		return null
	}
	const number = Number(trimmed)
	return number >= min && number <= max ? number : null
}

/** "90, 30, 7, 0" → [90, 30, 7, 0], once each, largest first; null when an entry is not a day count or there are too many. */
export function parseAlertDays(text: string): number[] | null {
	const entries = text.split(ALERT_SEPARATOR).filter((entry) => entry !== '')
	const days = entries.map((entry) => wholeNumberWithin(entry, 0, CONTRACT_LIMITS.maxAlertDay))
	if (entries.length > CONTRACT_LIMITS.maxAlerts || days.includes(null)) {
		return null
	}
	const known = days.filter((day): day is number => day !== null)
	return [...new Set(known)].sort((first, second) => second - first)
}

function endsOnError(form: ContractForm): ErrorCode | null {
	if (!isCalendarDate(form.endsOn)) {
		return 'contract_ends_on_invalid'
	}
	return isCalendarDate(form.startsOn) && form.endsOn <= form.startsOn ? 'contract_dates_invalid' : null
}

function valueError(form: ContractForm): ErrorCode | null {
	if (form.value.trim() === '') {
		return null
	}
	const cents = parseCents(form.value)
	return cents !== null && cents > 0 && cents <= CONTRACT_LIMITS.maxValueCents ? null : 'contract_value_invalid'
}

type FieldCheck = (form: ContractForm) => ErrorCode | null

/** The server's rules, field by field, with its codes. */
const FIELD_CHECKS: ReadonlyArray<readonly [ContractField, FieldCheck]> = [
	['startsOn', (form) => (form.startsOn === '' || isCalendarDate(form.startsOn) ? null : 'contract_starts_on_invalid')],
	['endsOn', endsOnError],
	['renewalTermMonths', (form) => (!form.autoRenew || wholeNumberWithin(form.renewalTermMonths, 1, CONTRACT_LIMITS.maxRenewalTermMonths) !== null ? null : 'contract_renewal_term_invalid')],
	['noticeDays', (form) => (form.noticeDays.trim() === '' || wholeNumberWithin(form.noticeDays, 0, CONTRACT_LIMITS.maxNoticeDays) !== null ? null : 'contract_notice_invalid')],
	['value', valueError],
	['valueFrequency', (form) => (form.value.trim() === '' || form.valueFrequency !== '' ? null : 'contract_frequency_invalid')],
	['counterpartyName', (form) => (form.counterpartyName.trim().length <= CONTRACT_LIMITS.maxCounterpartyLength ? null : 'contract_counterparty_invalid')],
	['counterpartyDocument', (form) => (form.counterpartyDocument.trim() === '' || isValidTaxId(normalizeTaxId(form.counterpartyDocument)) ? null : 'contract_tax_id_invalid')],
	['type', (form) => (form.type.trim().length <= CONTRACT_LIMITS.maxTypeLength ? null : 'contract_type_invalid')],
	['alertDays', (form) => (parseAlertDays(form.alertDays) === null ? 'contract_alert_days_invalid' : null)],
]

/** Each field's problem, by the server's rules and codes; empty when the form can be saved. */
export function validateContractForm(form: ContractForm): ContractFormErrors {
	const errors: ContractFormErrors = {}
	for (const [field, check] of FIELD_CHECKS) {
		const error = check(form)
		if (error !== null) {
			errors[field] = error
		}
	}
	return errors
}

function emptyAsNull(text: string): string | null {
	const trimmed = text.trim()
	return trimmed === '' ? null : trimmed
}

/** The terms the form describes, or null while a field has a problem. */
export function contractTermsFrom(form: ContractForm, source: ContractSource = 'manual'): ContractTerms | null {
	if (Object.keys(validateContractForm(form)).length > 0) {
		return null
	}
	const valueCents = form.value.trim() === '' ? null : parseCents(form.value)
	return {
		startsOn: form.startsOn === '' ? null : form.startsOn,
		endsOn: form.endsOn,
		autoRenew: form.autoRenew,
		renewalTermMonths: form.autoRenew ? Number(form.renewalTermMonths.trim()) : null,
		noticeDays: form.noticeDays.trim() === '' ? null : Number(form.noticeDays.trim()),
		valueCents,
		valueFrequency: valueCents === null || form.valueFrequency === '' ? null : form.valueFrequency,
		counterpartyName: emptyAsNull(form.counterpartyName),
		counterpartyDocument: emptyAsNull(normalizeTaxId(form.counterpartyDocument)),
		type: emptyAsNull(form.type),
		alertDays: parseAlertDays(form.alertDays) ?? [...DEFAULT_ALERT_DAYS],
		source,
	}
}

/** Whether two sets of terms say the same thing (null: not a contract). */
export function sameTerms(first: ContractTerms | null, second: ContractTerms | null): boolean {
	if (first === null || second === null) {
		return first === second
	}
	return TERM_KEYS.every((key) => JSON.stringify(first[key]) === JSON.stringify(second[key]))
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run src/contracts`
Expected: PASS.

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/contracts
git commit -m "feat(contracts): check contract fields in the browser by the server's rules"
```

---

### Task 14: The contract fields component

**Files:**
- Modify: `src/ui/AvTextField.vue` (`inputmode` and `list` props), `src/ui/AvTextField.spec.ts`
- Create: `src/contracts/frequency-options.ts`, `src/contracts/ContractFields.vue`
- Test: `src/contracts/ContractFields.spec.ts` (new)

**Interfaces:**
- Consumes: `ContractForm`, `ContractFormErrors`, `CONTRACT_LIMITS`, `VALUE_FREQUENCIES`, `isValueFrequency` (Task 13), `codeMessage` (existing), `AvTextField`, `AvSelect`, `AvSwitch`.
- Produces: `frequencyOptions(): {value, label}[]` and `NO_FREQUENCY` (`src/contracts/frequency-options.ts`); `<ContractFields v-model="form" :errors :showsErrors :typeSuggestions :isPhone />` — `v-model: ContractForm` (emits a new object per change), `errors: ContractFormErrors`, `showsErrors: boolean`, `typeSuggestions: readonly string[]`, `isPhone: boolean`. Field labels (pt_BR): Início, Término, Renovação automática, Prazo de renovação (meses), Aviso prévio (dias), Valor (R$), Cobrança, Contraparte, CNPJ ou CPF, Tipo, Alertas (dias antes do prazo).

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/AvTextField.spec.ts`:

```ts
describe('AvTextField input hints', () => {
	it('passes the input mode and the suggestion list to the input', () => {
		const wrapper = mount(AvTextField, { props: { modelValue: '', label: 'Valor', inputmode: 'decimal', list: 'contract-types' } })

		const input = wrapper.find('input')

		expect([input.attributes('inputmode'), input.attributes('list')]).toEqual(['decimal', 'contract-types'])
	})
})
```

Create `src/contracts/ContractFields.spec.ts`:

```ts
import type { VueWrapper } from '@vue/test-utils'
import type { ContractForm, ContractFormErrors } from './contract-form.ts'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ContractFields from './ContractFields.vue'
import { usePortugueseEnvironment } from '../test-support/pt-br-environment.ts'
import { emptyContractForm } from './contract-form.ts'

usePortugueseEnvironment()

interface FieldsProps {
	errors?: ContractFormErrors
	showsErrors?: boolean
	typeSuggestions?: string[]
}

function mountFields(form: ContractForm, { errors = {}, showsErrors = false, typeSuggestions = [] }: FieldsProps = {}) {
	return mount(ContractFields, { props: { modelValue: form, errors, showsErrors, typeSuggestions, isPhone: false } })
}

function labels(wrapper: VueWrapper): string[] {
	return wrapper.findAll('label').map((label) => label.text())
}

function controlLabelled(wrapper: VueWrapper, text: string) {
	const label = wrapper.findAll('label').find((candidate) => candidate.text() === text)
	if (label === undefined) {
		throw new Error(`No field labelled ${text}`)
	}
	return wrapper.find(`[id="${label.attributes('for')}"]`)
}

describe('ContractFields', () => {
	it('labels every field the way the spec names it', () => {
		expect(labels(mountFields(emptyContractForm()))).toEqual([
			'Início',
			'Término',
			'Renovação automática',
			'Aviso prévio (dias)',
			'Valor (R$)',
			'Cobrança',
			'Contraparte',
			'CNPJ ou CPF',
			'Tipo',
			'Alertas (dias antes do prazo)',
		])
	})

	it('asks for the renewal term only for a contract that renews itself', () => {
		expect(labels(mountFields({ ...emptyContractForm(), autoRenew: true }))).toContain('Prazo de renovação (meses)')
	})

	it('emits the whole form with the field the user typed', async () => {
		const wrapper = mountFields(emptyContractForm())

		await controlLabelled(wrapper, 'Término').setValue('2026-12-31')

		expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([{ ...emptyContractForm(), endsOn: '2026-12-31' }])
	})

	it('emits a known frequency and nothing else', async () => {
		const wrapper = mountFields(emptyContractForm())

		await controlLabelled(wrapper, 'Cobrança').setValue('monthly')

		expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([{ ...emptyContractForm(), valueFrequency: 'monthly' }])
	})

	it('shows a field\'s problem once problems are shown, tied to the field', () => {
		const wrapper = mountFields(emptyContractForm(), { errors: { endsOn: 'contract_ends_on_invalid' }, showsErrors: true })

		const input = controlLabelled(wrapper, 'Término')

		expect(input.attributes('aria-invalid')).toBe('true')
		expect(wrapper.find(`[id="${input.attributes('aria-describedby')}"]`).text()).toBe('Informe uma data de término válida.')
	})

	it('keeps problems hidden until they are shown', () => {
		const wrapper = mountFields(emptyContractForm(), { errors: { endsOn: 'contract_ends_on_invalid' } })

		expect(controlLabelled(wrapper, 'Término').attributes('aria-invalid')).toBeUndefined()
	})

	it('suggests the types already in use', () => {
		const wrapper = mountFields(emptyContractForm(), { typeSuggestions: ['Locação', 'Serviços'] })

		const listId = controlLabelled(wrapper, 'Tipo').attributes('list')

		expect(wrapper.findAll(`datalist[id="${listId}"] option`).map((option) => option.attributes('value'))).toEqual(['Locação', 'Serviços'])
	})
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/ui/AvTextField.spec.ts src/contracts/ContractFields.spec.ts`
Expected: FAIL — `inputmode` is undefined, and `Failed to resolve import "./ContractFields.vue"`.

- [ ] **Step 3: Let text fields carry an input mode and suggestions**

In `src/ui/AvTextField.vue`, add to the props after `min?: string`:

```ts
	/** The phone keyboard to show: digits only, or digits with a decimal separator. */
	inputmode?: 'numeric' | 'decimal'
	/** The id of a `<datalist>` whose options the field suggests. */
	list?: string
```

and bind them on the `<input>` after `:min="min"`:

```vue
				:inputmode="inputmode"
				:list="list"
```

- [ ] **Step 4: Implement the fields**

Create `src/contracts/frequency-options.ts` (the "Cobrança" options, shared with the renewal dialog of Task 16):

```ts
import type { ValueFrequency } from '../api/types.ts'

import { t } from '@nextcloud/l10n'
import { APP_ID } from '../app-config.ts'
import { VALUE_FREQUENCIES } from './contract-form.ts'

/** The option for a value not charged yet. */
export const NO_FREQUENCY = ''

/** Getters, so `t` runs after the l10n bundle loads. */
const FREQUENCY_LABELS: Readonly<Record<ValueFrequency, () => string>> = {
	once: () => t(APP_ID, 'Once'),
	monthly: () => t(APP_ID, 'Monthly'),
	yearly: () => t(APP_ID, 'Yearly'),
}

/** "Escolha", then each frequency. */
export function frequencyOptions(): { value: string, label: string }[] {
	return [
		{ value: NO_FREQUENCY, label: t(APP_ID, 'Choose') },
		...VALUE_FREQUENCIES.map((frequency) => ({ value: frequency, label: FREQUENCY_LABELS[frequency]() })),
	]
}
```

Create `src/contracts/ContractFields.vue`:

```vue
<script setup lang="ts">
import type { ContractField, ContractForm, ContractFormErrors } from './contract-form.ts'

import { t } from '@nextcloud/l10n'
import { computed, useId } from 'vue'
import AvSelect from '../ui/AvSelect.vue'
import AvSwitch from '../ui/AvSwitch.vue'
import AvTextField from '../ui/AvTextField.vue'
import { codeMessage } from '../api/error-messages.ts'
import { APP_ID } from '../app-config.ts'
import { CONTRACT_LIMITS, isValueFrequency } from './contract-form.ts'
import { frequencyOptions, NO_FREQUENCY } from './frequency-options.ts'

const form = defineModel<ContractForm>({ required: true })

const props = defineProps<{
	errors: ContractFormErrors
	/** False until the user first tries to save: an untouched form shows no problems. */
	showsErrors: boolean
	typeSuggestions: readonly string[]
	isPhone: boolean
}>()

const typeListId = useId()

const options = computed(frequencyOptions)

const frequency = computed({
	get: () => form.value.valueFrequency,
	set: (value: string) => update('valueFrequency', isValueFrequency(value) ? value : NO_FREQUENCY),
})

function update<Field extends ContractField>(field: Field, value: ContractForm[Field]) {
	form.value = { ...form.value, [field]: value }
}

function errorOf(field: ContractField): string | null {
	const code = props.errors[field]
	return props.showsErrors && code !== undefined ? codeMessage(code) : null
}
</script>

<template>
	<div class="contract-fields" :class="{ 'contract-fields--phone': isPhone }">
		<AvTextField
			:modelValue="form.startsOn"
			type="date"
			:label="t(APP_ID, 'Start date')"
			:error="errorOf('startsOn')"
			@update:modelValue="update('startsOn', $event)" />
		<AvTextField
			:modelValue="form.endsOn"
			type="date"
			required
			:label="t(APP_ID, 'End date')"
			:error="errorOf('endsOn')"
			@update:modelValue="update('endsOn', $event)" />
		<AvSwitch
			class="contract-fields__wide"
			:modelValue="form.autoRenew"
			:label="t(APP_ID, 'Renews automatically')"
			:description="t(APP_ID, 'At its end it renews for the renewal term, unless someone gives notice first.')"
			@update:modelValue="update('autoRenew', $event)" />
		<AvTextField
			v-if="form.autoRenew"
			:modelValue="form.renewalTermMonths"
			inputmode="numeric"
			required
			:label="t(APP_ID, 'Renewal term (months)')"
			:error="errorOf('renewalTermMonths')"
			@update:modelValue="update('renewalTermMonths', $event)" />
		<AvTextField
			:modelValue="form.noticeDays"
			inputmode="numeric"
			:label="t(APP_ID, 'Notice period (days)')"
			:error="errorOf('noticeDays')"
			@update:modelValue="update('noticeDays', $event)" />
		<AvTextField
			:modelValue="form.value"
			inputmode="decimal"
			:label="t(APP_ID, 'Value (R$)')"
			:error="errorOf('value')"
			@update:modelValue="update('value', $event)" />
		<AvSelect
			v-model="frequency"
			:label="t(APP_ID, 'Charged')"
			:options="options"
			:error="errorOf('valueFrequency')" />
		<AvTextField
			:modelValue="form.counterpartyName"
			:label="t(APP_ID, 'Counterparty')"
			:maxlength="CONTRACT_LIMITS.maxCounterpartyLength"
			:error="errorOf('counterpartyName')"
			@update:modelValue="update('counterpartyName', $event)" />
		<AvTextField
			:modelValue="form.counterpartyDocument"
			:label="t(APP_ID, 'CNPJ or CPF')"
			autocomplete="off"
			:error="errorOf('counterpartyDocument')"
			@update:modelValue="update('counterpartyDocument', $event)" />
		<AvTextField
			:modelValue="form.type"
			:label="t(APP_ID, 'Type')"
			:list="typeListId"
			:maxlength="CONTRACT_LIMITS.maxTypeLength"
			:hint="t(APP_ID, 'For example: Lease, Services')"
			:error="errorOf('type')"
			@update:modelValue="update('type', $event)" />
		<datalist :id="typeListId">
			<option v-for="suggestion in typeSuggestions" :key="suggestion" :value="suggestion" />
		</datalist>
		<AvTextField
			class="contract-fields__wide"
			:modelValue="form.alertDays"
			:label="t(APP_ID, 'Alert days before the deadline')"
			:hint="t(APP_ID, 'Separated by commas, e.g. 90, 30, 7, 0')"
			:error="errorOf('alertDays')"
			@update:modelValue="update('alertDays', $event)" />
	</div>
</template>

<style scoped>
.contract-fields {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 16px 20px;
}

.contract-fields__wide {
	grid-column: 1 / -1;
}

.contract-fields--phone {
	grid-template-columns: minmax(0, 1fr);
}
</style>
```

Add the translations:

```bash
node scripts/add-translations.mjs <<'JSON'
{
	"Once": "Pagamento único",
	"Monthly": "Mensal",
	"Yearly": "Anual",
	"Choose": "Escolha",
	"Start date": "Início",
	"End date": "Término",
	"Renews automatically": "Renovação automática",
	"At its end it renews for the renewal term, unless someone gives notice first.": "Ao terminar, renova pelo prazo de renovação, a menos que alguém avise antes.",
	"Renewal term (months)": "Prazo de renovação (meses)",
	"Notice period (days)": "Aviso prévio (dias)",
	"Value (R$)": "Valor (R$)",
	"Charged": "Cobrança",
	"Counterparty": "Contraparte",
	"CNPJ or CPF": "CNPJ ou CPF",
	"Type": "Tipo",
	"For example: Lease, Services": "Por exemplo: Locação, Serviços",
	"Alert days before the deadline": "Alertas (dias antes do prazo)",
	"Separated by commas, e.g. 90, 30, 7, 0": "Separados por vírgula, por exemplo: 90, 30, 7, 0"
}
JSON
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/ui/AvTextField.spec.ts src/contracts src/l10n.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/AvTextField.vue src/ui/AvTextField.spec.ts src/contracts/frequency-options.ts src/contracts/ContractFields.vue src/contracts/ContractFields.spec.ts l10n
git commit -m "feat(contracts): add the contract fields form"
```

---

### Task 15: The wizard's "Contrato" step

**Files:**
- Modify: `src/wizard/wizard-steps.ts`, `src/wizard/wizard-steps.spec.ts`, `src/wizard/WizardTopBar.vue`, `src/wizard/WizardStepper.vue`, `src/wizard/WizardView.vue`, `src/wizard/WizardView.spec.ts`, `src/wizard/draft-save-state.ts`
- Create: `src/wizard/contract-step-state.ts`, `src/wizard/ContractStep.vue`
- Test: `src/wizard/contract-step-state.spec.ts`, `src/wizard/ContractStep.spec.ts` (new)

**Interfaces:**
- Consumes: `appConfig().contractsEnabled`, `saveContractTerms`, `getContractTypes`, `QUERY_KEYS.contractTypes()`, `draftChangeOptions(uuid, 'contract')`, `forgetSettledSaves`, `forgetFailures`, `latestEnvelope`, `useStepRegistration`, `ContractFields`, the form rules of Task 13.
- Produces:
  - `WIZARD_STEPS = ['documents', 'contract', 'signers', 'placement', 'review']` (every step the wizard knows) and `wizardSteps(): readonly WizardStep[]` (the steps this company runs: without `'contract'` while the add-on is off). `stepFromQuery`, `enterableStep`, `stepAfter`, `stepBefore` follow `wizardSteps()`.
  - `failedChangeVariables(queryClient, uuid, change): unknown` in `draft-save-state.ts`.
  - `contract-step-state.ts`: `interface DocumentContract { documentId; isContract; form }`, `documentContractsFrom(envelope)`, `documentContractsFromInput(input, envelope)`, `contractTermsInput(cards): DocumentContractTerms[] | null`, `contractTermsChanged(input, envelope): boolean`, `isDocumentContractTermsList(value)`.
  - `<ContractStep :envelope :isPhone />`.

- [ ] **Step 1: Write the failing step-order tests**

In `src/wizard/wizard-steps.spec.ts`:
- add after the imports:

```ts
const { company } = vi.hoisted(() => ({ company: { contractsEnabled: false } }))

vi.mock('../app-config.ts', () => ({
	APP_ID: 'assinaturas',
	appConfig: () => ({ contractsEnabled: company.contractsEnabled }),
}))
```

- change the vitest import to `import { afterEach, describe, expect, it, vi } from 'vitest'` and the import from `./wizard-steps.ts` to `import { canEnterStep, enterableStep, moveItem, STEP_LABELS, stepAfter, stepBefore, stepFromQuery, wizardSteps } from './wizard-steps.ts'`;
- replace the first two tests of `describe('wizard steps', …)` with:

```ts
	afterEach(() => {
		company.contractsEnabled = false
	})

	it('runs documents, signers, placement and review without contract management', () => {
		expect(wizardSteps()).toEqual(['documents', 'signers', 'placement', 'review'])
	})

	it('labels each step as the artboards do', () => {
		expect(wizardSteps().map((step) => STEP_LABELS[step])).toEqual(['Documentos', 'Signatários', 'Posicionamento', 'Revisão'])
	})

	describe('with contract management', () => {
		it('adds the contract step right after the documents', () => {
			company.contractsEnabled = true

			expect(wizardSteps()).toEqual(['documents', 'contract', 'signers', 'placement', 'review'])
			expect(STEP_LABELS.contract).toBe('Contrato')
			expect([stepAfter('documents'), stepBefore('signers')]).toEqual(['contract', 'contract'])
		})

		it('enters the contract step once there is a document', () => {
			company.contractsEnabled = true

			expect(canEnterStep('contract', EMPTY)).toBe(false)
			expect(canEnterStep('contract', WITH_DOCUMENTS)).toBe(true)
		})

		it('opens a link to the contract step on the documents when the add-on is off', () => {
			expect(stepFromQuery('contract')).toBe('documents')
		})
	})
```

- [ ] **Step 2: Write the failing step-state test**

Create `src/wizard/contract-step-state.spec.ts`:

```ts
import type { ContractTerms, EnvelopeDocument } from '../api/types.ts'

import { describe, expect, it } from 'vitest'
import { envelopeDetail, envelopeSigner } from '../test-support/envelope-fixtures.ts'
import { usePortugueseEnvironment } from '../test-support/pt-br-environment.ts'
import { contractTermsChanged, contractTermsInput, documentContractsFrom, documentContractsFromInput, isDocumentContractTermsList } from './contract-step-state.ts'

usePortugueseEnvironment()

const TERMS: ContractTerms = {
	startsOn: '2026-01-01',
	endsOn: '2026-12-31',
	autoRenew: false,
	renewalTermMonths: null,
	noticeDays: null,
	valueCents: null,
	valueFrequency: null,
	counterpartyName: 'Imobiliária Central Ltda',
	counterpartyDocument: null,
	type: 'Locação',
	alertDays: [90, 30, 7, 0],
	source: 'manual',
}

const MAIN: EnvelopeDocument = {
	id: 1,
	position: 0,
	sourceFileId: 101,
	sourcePath: '/Contratos/Locação Sala 3.pdf',
	name: 'Locação Sala 3.pdf',
	size: 1000,
	pageCount: 1,
	pages: [],
	saveStatus: 'pending',
	signedFileId: null,
	contractTerms: null,
	fields: [],
}
const ANNEX: EnvelopeDocument = { ...MAIN, id: 2, position: 1, sourceFileId: 102, sourcePath: '/Contratos/Anexo I.pdf', name: 'Anexo I.pdf' }

function envelopeWith(mainTerms: ContractTerms | null) {
	return envelopeDetail({ status: 'draft', documents: [{ ...MAIN, contractTerms: mainTerms }, ANNEX], signers: [envelopeSigner({ name: 'Ana Lima' })] })
}

describe('contract step state', () => {
	it('starts each document unticked with the first signer as the counterparty', () => {
		const cards = documentContractsFrom(envelopeWith(null))

		expect(cards.map(({ documentId, isContract, form }) => [documentId, isContract, form.counterpartyName])).toEqual([[1, false, 'Ana Lima'], [2, false, 'Ana Lima']])
	})

	it('ticks a document that holds terms and shows them', () => {
		const [main] = documentContractsFrom(envelopeWith(TERMS))

		expect([main?.isContract, main?.form.endsOn, main?.form.type]).toEqual([true, '2026-12-31', 'Locação'])
	})

	it('sends the ticked terms and null for the other documents', () => {
		const cards = documentContractsFrom(envelopeWith(TERMS))

		expect(contractTermsInput(cards)).toEqual([{ documentId: 1, terms: TERMS }, { documentId: 2, terms: null }])
	})

	it('sends nothing while a ticked card has a problem', () => {
		const cards = documentContractsFrom(envelopeWith(null)).map((card) => ({ ...card, isContract: true }))

		expect(contractTermsInput(cards)).toBeNull()
	})

	it('tells whether the cards differ from what the draft holds', () => {
		const saved = envelopeWith(TERMS)
		const input = contractTermsInput(documentContractsFrom(saved)) ?? []

		expect(contractTermsChanged(input, saved)).toBe(false)
		expect(contractTermsChanged(input, envelopeWith(null))).toBe(true)
	})

	it('restores the cards a failed save tried to send', () => {
		const cards = documentContractsFromInput([{ documentId: 1, terms: TERMS }], envelopeWith(null))

		expect(cards.map(({ isContract }) => isContract)).toEqual([true, false])
	})

	it('recognizes the input of a save', () => {
		expect(isDocumentContractTermsList([{ documentId: 1, terms: TERMS }, { documentId: 2, terms: null }])).toBe(true)
		expect(isDocumentContractTermsList([{ documentId: 1, terms: { endsOn: 'x' } }])).toBe(false)
		expect(isDocumentContractTermsList('terms')).toBe(false)
	})
})
```

- [ ] **Step 3: Write the failing step test**

Create `src/wizard/ContractStep.spec.ts`:

```ts
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'
import type { ContractTerms, DocumentContractTerms } from '../api/types.ts'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getContractTypes, saveContractTerms } from '../api/contracts.ts'
import { getEnvelope } from '../api/envelopes.ts'
import { epochAt } from '../test-support/envelope-fixtures.ts'
import { usePortugueseEnvironment } from '../test-support/pt-br-environment.ts'
import { ARTBOARD_DOCUMENTS, buttonNamed, DRAFT_UUID, draftDocument, draftEnvelope, mountWizard, settle, unmountWizards } from '../test-support/wizard-harness.ts'

vi.mock('../app-config.ts', () => ({
	APP_ID: 'assinaturas',
	appConfig: () => ({
		isAdmin: false,
		environment: 'production',
		contractsEnabled: true,
		limits: { maxFiles: 20, maxEnvelopeBytes: 20_000_000, maxTitleLength: 255, maxNameLength: 255, maxSigners: 20, reminderCooldownSeconds: 1800 },
	}),
}))

vi.mock(import('@nextcloud/auth'), async (importOriginal) => ({
	...await importOriginal(),
	getCurrentUser: () => ({ uid: 'patrick', displayName: 'Patrick Rezende', isAdmin: false }),
}))

vi.mock('@nextcloud/router', () => ({ generateUrl: (path: string) => `/index.php${path}` }))

vi.mock('@nextcloud/dialogs', () => ({ showError: vi.fn(), showSuccess: vi.fn(), showWarning: vi.fn() }))

vi.mock('../new-envelope.ts', () => ({ pickPdfNodes: vi.fn() }))

vi.mock(import('../api/envelopes.ts'), async (importOriginal) => ({
	...await importOriginal(),
	getEnvelope: vi.fn(),
	updateEnvelope: vi.fn(),
	replaceSigners: vi.fn(),
}))

vi.mock('../api/contracts.ts', () => ({ getContractTypes: vi.fn(), saveContractTerms: vi.fn() }))

usePortugueseEnvironment()

const NOW = epochAt('2026-10-01 18:11')
const MILLISECONDS_PER_SECOND = 1000
const HELD_TERMS: ContractTerms = {
	startsOn: '2026-01-01',
	endsOn: '2026-12-31',
	autoRenew: false,
	renewalTermMonths: null,
	noticeDays: null,
	valueCents: null,
	valueFrequency: null,
	counterpartyName: 'Imobiliária Central Ltda',
	counterpartyDocument: null,
	type: 'Locação',
	alertDays: [90, 30, 7, 0],
	source: 'manual',
}

function savedWith(documents: DocumentContractTerms[]) {
	return draftEnvelope({
		documents: ARTBOARD_DOCUMENTS.map((document) => ({ ...document, contractTerms: documents.find((entry) => entry.documentId === document.id)?.terms ?? null })),
	})
}

function cards(wrapper: VueWrapper) {
	return wrapper.findAll('section.contract-step__card')
}

function mainCard(wrapper: VueWrapper): DOMWrapper<Element> {
	const [card] = cards(wrapper)
	if (card === undefined) {
		throw new Error('No contract card')
	}
	return card
}

function controlLabelled(card: DOMWrapper<Element>, text: string) {
	const label = card.findAll('label').find((candidate) => candidate.text() === text)
	return card.find(`[id="${label?.attributes('for') ?? 'missing'}"]`)
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: NOW * MILLISECONDS_PER_SECOND })
	vi.mocked(getEnvelope).mockResolvedValue(draftEnvelope())
	vi.mocked(getContractTypes).mockResolvedValue(['Locação', 'Serviços'])
	vi.mocked(saveContractTerms).mockImplementation(async (_uuid, documents) => savedWith(documents))
})

afterEach(() => {
	unmountWizards()
	vi.clearAllMocks()
	vi.useRealTimers()
})

describe('ContractStep', () => {
	it('shows one card per document, the annexes following the main one', async () => {
		const { wrapper } = await mountWizard({ step: 'contract' })

		const shown = cards(wrapper)

		expect(shown).toHaveLength(3)
		expect(shown[0]?.text()).toContain('Documento principal')
		expect(shown[0]?.text()).not.toContain('Segue o principal')
		expect(shown[1]?.text()).toContain('Segue o principal')
	})

	it('moves on without saving when no document is a contract', async () => {
		const { wrapper, router } = await mountWizard({ step: 'contract' })

		await buttonNamed(wrapper, 'Continuar')?.trigger('click')
		await settle()

		expect(router.currentRoute.value.query.step).toBe('signers')
		expect(saveContractTerms).not.toHaveBeenCalled()
	})

	it('keeps the user on the step until a ticked contract has its end date', async () => {
		const { wrapper, router } = await mountWizard({ step: 'contract' })
		await mainCard(wrapper).find('[role="switch"]').trigger('click')

		await buttonNamed(wrapper, 'Continuar')?.trigger('click')
		await settle()

		const endDate = controlLabelled(mainCard(wrapper), 'Término')
		expect(router.currentRoute.value.query.step).toBe('contract')
		expect(endDate.attributes('aria-invalid')).toBe('true')
		expect(document.activeElement).toBe(endDate.element)
		expect(mainCard(wrapper).text()).toContain('Informe uma data de término válida.')
		expect(saveContractTerms).not.toHaveBeenCalled()
	})

	it('saves the ticked document\'s terms and none for the others, then moves on', async () => {
		const { wrapper, router } = await mountWizard({ step: 'contract' })
		await mainCard(wrapper).find('[role="switch"]').trigger('click')
		await controlLabelled(mainCard(wrapper), 'Término').setValue('2026-12-31')
		await controlLabelled(mainCard(wrapper), 'Tipo').setValue('Locação')

		await buttonNamed(wrapper, 'Continuar')?.trigger('click')
		await settle()

		expect(saveContractTerms).toHaveBeenCalledWith(DRAFT_UUID, [
			{ documentId: 1, terms: expect.objectContaining({ endsOn: '2026-12-31', type: 'Locação', counterpartyName: 'Ana Lima', alertDays: [90, 30, 7, 0], source: 'manual' }) },
			{ documentId: 2, terms: null },
			{ documentId: 3, terms: null },
		])
		expect(router.currentRoute.value.query.step).toBe('signers')
	})

	it('shows the terms the draft already holds', async () => {
		vi.mocked(getEnvelope).mockResolvedValue(draftEnvelope({ documents: [draftDocument({ contractTerms: HELD_TERMS }), ...ARTBOARD_DOCUMENTS.slice(1)] }))

		const { wrapper } = await mountWizard({ step: 'contract' })

		expect(mainCard(wrapper).find('[role="switch"]').attributes('aria-checked')).toBe('true')
		expect(controlLabelled(mainCard(wrapper), 'Término').element).toHaveProperty('value', '2026-12-31')
	})

	it('drops an unfinished contract when going back', async () => {
		const { wrapper, router } = await mountWizard({ step: 'contract' })
		await mainCard(wrapper).find('[role="switch"]').trigger('click')

		await buttonNamed(wrapper, 'Voltar')?.trigger('click')
		await settle()

		expect(router.currentRoute.value.query.step).toBe('documents')
		expect(saveContractTerms).not.toHaveBeenCalled()
	})
})
```

In `src/wizard/WizardView.spec.ts`:
- in the `vi.hoisted` block, change `session: { uid: 'patrick', isAdmin: false, sandbox: false }` to `session: { uid: 'patrick', isAdmin: false, sandbox: false, contractsEnabled: false }`;
- in the `appConfig` mock, add `contractsEnabled: session.contractsEnabled,` after `environment: …,`;
- add after the other module mocks: `vi.mock('../api/contracts.ts', () => ({ getContractTypes: vi.fn(async () => []), saveContractTerms: vi.fn() }))`;
- add inside the top-level `describe` of the file:

```ts
	describe('with contract management', () => {
		beforeEach(() => {
			session.contractsEnabled = true
		})

		afterEach(() => {
			session.contractsEnabled = false
		})

		it('opens the contract step right after the documents', async () => {
			const { wrapper, router } = await mountWizard()

			await buttonNamed(wrapper, 'Continuar')?.trigger('click')
			await settle()

			expect(router.currentRoute.value.query.step).toBe('contract')
			expect(stepper(wrapper).find('[aria-current="step"]').text()).toContain('Contrato')
			expect(wrapper.text()).toContain('Este documento é um contrato')
		})
	})
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `npx vitest run src/wizard/wizard-steps.spec.ts src/wizard/contract-step-state.spec.ts src/wizard/ContractStep.spec.ts src/wizard/WizardView.spec.ts`
Expected: FAIL — `wizardSteps is not a function`, `Failed to resolve import "./contract-step-state.ts"`, and no contract cards.

- [ ] **Step 5: Make the step list follow the add-on**

Replace the top of `src/wizard/wizard-steps.ts`, from the imports to the end of `stepBefore()`, with:

```ts
import type { EnvelopeDetail } from '../api/types.ts'

import { t } from '@nextcloud/l10n'
import { APP_ID, appConfig } from '../app-config.ts'

/** Every step the wizard knows, in order; the contract step runs only with the contract management add-on. */
export const WIZARD_STEPS = ['documents', 'contract', 'signers', 'placement', 'review'] as const

export type WizardStep = typeof WIZARD_STEPS[number]

/** The query parameter that names the open step: `?step=signers`. */
export const STEP_QUERY_KEY = 'step'

const FIRST_STEP: WizardStep = 'documents'
const CONTRACT_STEP: WizardStep = 'contract'

/** The steps this company's wizard runs. */
export function wizardSteps(): readonly WizardStep[] {
	return appConfig().contractsEnabled ? WIZARD_STEPS : WIZARD_STEPS.filter((step) => step !== CONTRACT_STEP)
}

/** Getters, so `t` runs after the l10n bundle loads. */
export const STEP_LABELS: Readonly<Record<WizardStep, string>> = {
	get documents() {
		return t(APP_ID, 'Documents')
	},
	get contract() {
		return t(APP_ID, 'Contract')
	},
	get signers() {
		return t(APP_ID, 'Signers')
	},
	get placement() {
		return t(APP_ID, 'Placement')
	},
	get review() {
		return t(APP_ID, 'Review')
	},
}

function hasDocuments(envelope: EnvelopeDetail): boolean {
	return envelope.documents.length > 0
}

function hasDocumentsAndSigners(envelope: EnvelopeDetail): boolean {
	return hasDocuments(envelope) && envelope.signers.length > 0
}

const STEP_REQUIREMENTS: Record<WizardStep, (envelope: EnvelopeDetail) => boolean> = {
	documents: () => true,
	contract: hasDocuments,
	signers: hasDocuments,
	placement: hasDocumentsAndSigners,
	review: hasDocumentsAndSigners,
}

function isWizardStep(value: unknown): value is WizardStep {
	return wizardSteps().some((step) => step === value)
}

export function stepFromQuery(value: unknown): WizardStep {
	return isWizardStep(value) ? value : FIRST_STEP
}

export function canEnterStep(step: WizardStep, envelope: EnvelopeDetail): boolean {
	return STEP_REQUIREMENTS[step](envelope)
}

/** The asked step, or the last one before it the envelope can enter (a typed URL may skip ahead). */
export function enterableStep(step: WizardStep, envelope: EnvelopeDetail): WizardStep {
	const steps = wizardSteps()
	const reachable = steps.slice(0, steps.indexOf(step) + 1).filter((candidate) => canEnterStep(candidate, envelope))
	return reachable.at(-1) ?? FIRST_STEP
}

export function stepAfter(step: WizardStep): WizardStep | null {
	const steps = wizardSteps()
	return steps[steps.indexOf(step) + 1] ?? null
}

export function stepBefore(step: WizardStep): WizardStep | null {
	const steps = wizardSteps()
	const index = steps.indexOf(step)
	return index <= 0 ? null : steps[index - 1] ?? null
}
```

(`moveItem()` below stays as it is.)

In `src/wizard/WizardTopBar.vue`, change the import to `import { STEP_LABELS, stepBefore, wizardSteps } from './wizard-steps.ts'` and the step count to:

```ts
const stepCount = computed(() => {
	const steps = wizardSteps()
	return t(APP_ID, 'Step {number} of {count}', { number: steps.indexOf(props.step) + 1, count: steps.length })
})
```

In `src/wizard/WizardStepper.vue`, change the import to `import { canEnterStep, STEP_LABELS, STEP_QUERY_KEY, wizardSteps } from './wizard-steps.ts'` and `items` to:

```ts
const items = computed(() => {
	const steps = wizardSteps()
	const currentIndex = steps.indexOf(props.step)
	return steps.map((step, index) => {
		const state = stateOf(index, currentIndex)
		const isLink = state !== 'current' && canEnterStep(step, props.envelope)
		return {
			step,
			state,
			number: index + 1,
			label: STEP_LABELS[step],
			href: isLink ? router.resolve({ query: { ...route.query, [STEP_QUERY_KEY]: step } }).href : null,
			hasConnector: index < steps.length - 1,
		}
	})
})
```

In `src/wizard/WizardView.vue`:
- change the import from `./wizard-steps.ts` to `import { enterableStep, STEP_QUERY_KEY, stepAfter, stepBefore, stepFromQuery, wizardSteps } from './wizard-steps.ts'`;
- add `import ContractStep from './ContractStep.vue'` with the other step imports;
- change `flushReasonFor()` to:

```ts
function flushReasonFor(target: WizardStep): FlushReason {
	const steps = wizardSteps()
	return steps.indexOf(target) < steps.indexOf(step.value) ? 'back' : 'continue'
}
```

- add the step to the template, after the `DocumentsStep` line:

```vue
			<ContractStep v-else-if="step === 'contract'" :envelope="envelope" :isPhone="isPhone" />
```

In `src/wizard/draft-save-state.ts`, add after `failedVariables()`:

```ts
/** What the latest save of this kind failed to send, or undefined when it did not fail. */
export function failedChangeVariables(queryClient: QueryClient, uuid: string, change: DraftChange): unknown {
	return failedVariables(queryClient, QUERY_KEYS.draftChange(uuid, change))
}
```

- [ ] **Step 6: Implement the step state**

Create `src/wizard/contract-step-state.ts`:

```ts
import type { ContractTerms, DocumentContractTerms, EnvelopeDetail } from '../api/types.ts'
import type { ContractForm } from '../contracts/contract-form.ts'

import { contractFormFrom, contractTermsFrom, emptyContractForm, isContractTerms, sameTerms } from '../contracts/contract-form.ts'

/** One document's card in the contract step: whether it is a contract, and its fields as typed. */
export interface DocumentContract {
	documentId: number
	isContract: boolean
	form: ContractForm
}

function firstSignerName(envelope: EnvelopeDetail): string {
	return envelope.signers[0]?.name ?? ''
}

function cardFor(documentId: number, terms: ContractTerms | null, counterpartyName: string): DocumentContract {
	if (terms === null) {
		return { documentId, isContract: false, form: emptyContractForm(counterpartyName) }
	}
	return { documentId, isContract: true, form: contractFormFrom(terms) }
}

/** A card per document as saved; an unticked card starts with the first signer as the counterparty. */
export function documentContractsFrom(envelope: EnvelopeDetail): DocumentContract[] {
	return envelope.documents.map((document) => cardFor(document.id, document.contractTerms, firstSignerName(envelope)))
}

/** The cards a failed save tried to send, for the documents the draft still holds; the others as saved. */
export function documentContractsFromInput(input: DocumentContractTerms[], envelope: EnvelopeDetail): DocumentContract[] {
	const sent = new Map(input.map((entry) => [entry.documentId, entry.terms]))
	return envelope.documents.map((document) => {
		const terms = sent.has(document.id) ? sent.get(document.id) ?? null : document.contractTerms
		return cardFor(document.id, terms, firstSignerName(envelope))
	})
}

/** What a save sends: each document's terms, null for one that is not a contract; null while a ticked card has a problem. */
export function contractTermsInput(cards: DocumentContract[]): DocumentContractTerms[] | null {
	const input = cards.map((card) => ({ documentId: card.documentId, terms: card.isContract ? contractTermsFrom(card.form) : null }))
	const hasProblem = cards.some((card, index) => card.isContract && input[index]?.terms === null)
	return hasProblem ? null : input
}

/** Whether the input says something the saved envelope does not. */
export function contractTermsChanged(input: DocumentContractTerms[], saved: EnvelopeDetail): boolean {
	return input.some((entry) => !sameTerms(entry.terms, saved.documents.find((document) => document.id === entry.documentId)?.contractTerms ?? null))
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

/** The variables of a contract terms save, e.g. one that failed. */
export function isDocumentContractTermsList(value: unknown): value is DocumentContractTerms[] {
	return Array.isArray(value) && value.every((entry) => isRecord(entry)
		&& typeof entry.documentId === 'number'
		&& (entry.terms === null || isContractTerms(entry.terms)))
}
```

- [ ] **Step 7: Implement the step**

Create `src/wizard/ContractStep.vue`:

```vue
<script setup lang="ts">
import type { DraftChange } from '../api/query-keys.ts'
import type { DocumentContractTerms, EnvelopeDetail } from '../api/types.ts'
import type { ContractForm } from '../contracts/contract-form.ts'
import type { DocumentContract } from './contract-step-state.ts'
import type { FlushReason } from './step-registration.ts'

import { t } from '@nextcloud/l10n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, nextTick, ref, useId, useTemplateRef } from 'vue'
import AvBanner from '../ui/AvBanner.vue'
import AvCard from '../ui/AvCard.vue'
import AvSwitch from '../ui/AvSwitch.vue'
import ContractFields from '../contracts/ContractFields.vue'
import { getContractTypes, saveContractTerms } from '../api/contracts.ts'
import { QUERY_KEYS } from '../api/query-keys.ts'
import { showApiError } from '../api/show-api-error.ts'
import { APP_ID } from '../app-config.ts'
import { validateContractForm } from '../contracts/contract-form.ts'
import { logger } from '../logger.ts'
import { contractTermsChanged, contractTermsInput, documentContractsFrom, documentContractsFromInput, isDocumentContractTermsList } from './contract-step-state.ts'
import { draftChangeOptions, failedChangeVariables, forgetFailures, forgetSettledSaves, latestEnvelope } from './draft-save-state.ts'
import { useStepRegistration } from './step-registration.ts'

const props = defineProps<{
	envelope: EnvelopeDetail
	isPhone: boolean
}>()

const uuid = props.envelope.uuid
const queryClient = useQueryClient()
const headingId = useId()
const main = useTemplateRef<HTMLElement>('main')

/** A step opening again after a failed save shows the cards it failed to send, so they can be saved or undone. */
function initialCards(): DocumentContract[] {
	const unsaved = failedChangeVariables(queryClient, uuid, 'contract')
	return isDocumentContractTermsList(unsaved) ? documentContractsFromInput(unsaved, props.envelope) : documentContractsFrom(props.envelope)
}

const contracts = ref<DocumentContract[]>(initialCards())
const showsErrors = ref(false)

const typeSuggestions = useQuery({ queryKey: QUERY_KEYS.contractTypes(), queryFn: getContractTypes })

const termsSave = useMutation({
	...draftChangeOptions(uuid, 'contract'),
	mutationFn: (documents: DocumentContractTerms[]) => saveContractTerms(uuid, documents),
	onSuccess: (detail) => {
		queryClient.setQueryData(QUERY_KEYS.envelope(uuid), detail)
		forgetSettledSaves(queryClient, uuid, 'contract')
	},
	onError: (error) => {
		logger.error('Could not save the contract details', { error })
		showApiError(error)
	},
})

const errorsByDocument = computed(() => new Map(contracts.value.map((contract) => [contract.documentId, contract.isContract ? validateContractForm(contract.form) : {}])))

const documentsById = computed(() => new Map(props.envelope.documents.map((document) => [document.id, document])))

function isMain(documentId: number): boolean {
	return documentsById.value.get(documentId)?.position === 0
}

function onToggle(documentId: number, isContract: boolean) {
	contracts.value = contracts.value.map((contract) => (contract.documentId === documentId ? { ...contract, isContract } : contract))
}

function onFormChange(documentId: number, form: ContractForm) {
	contracts.value = contracts.value.map((contract) => (contract.documentId === documentId ? { ...contract, form } : contract))
}

/** Shows every problem and focuses the first field that has one. */
async function revealProblems(): Promise<false> {
	showsErrors.value = true
	await nextTick()
	main.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
	return false
}

async function send(input: DocumentContractTerms[]): Promise<boolean> {
	try {
		await termsSave.mutateAsync(input)
		return true
	} catch {
		return false
	}
}

/**
 * Saves the cards as they read now. Continuar needs every ticked card valid; going back drops unfinished ones;
 * leaving saves what it can and leaves. Cards that read as saved send nothing and leave nothing to try again.
 */
async function saveContracts(reason: FlushReason): Promise<boolean> {
	const input = contractTermsInput(contracts.value)
	if (input === null) {
		return reason === 'continue' ? revealProblems() : true
	}
	if (!contractTermsChanged(input, latestEnvelope(queryClient, uuid, props.envelope))) {
		forgetFailures(queryClient, uuid, 'contract')
		return true
	}
	return (await send(input)) || reason === 'leave'
}

/** Whether the cards differ from what the latest contract save failed to send, whichever step instance sent it. */
function hasNewerEdits(change: DraftChange): boolean {
	if (change !== 'contract') {
		return false
	}
	const unsaved = failedChangeVariables(queryClient, uuid, 'contract')
	return isDocumentContractTermsList(unsaved) && JSON.stringify(contractTermsInput(contracts.value)) !== JSON.stringify(unsaved)
}

useStepRegistration({ flush: saveContracts, hasNewerEdits })
</script>

<template>
	<div ref="main" class="contract-step" :class="{ 'contract-step--phone': isPhone }">
		<p class="contract-step__intro">
			{{ t(APP_ID, 'Mark the documents that are contracts to follow their terms and get alerts before the deadlines. You can skip this step.') }}
		</p>
		<AvBanner
			v-if="envelope.renewsContractId !== null"
			tone="info"
			:title="t(APP_ID, 'This envelope renews a contract. Once everyone signs, the previous contract reads as renewed.')" />
		<AvCard
			v-for="contract in contracts"
			:key="contract.documentId"
			tag="section"
			class="contract-step__card"
			:aria-labelledby="`${headingId}-${contract.documentId}`">
			<div class="contract-step__heading">
				<h2 :id="`${headingId}-${contract.documentId}`" class="contract-step__name">
					{{ documentsById.get(contract.documentId)?.name }}
				</h2>
				<span class="contract-step__role">{{ isMain(contract.documentId) ? t(APP_ID, 'Main document') : t(APP_ID, 'Annex') }}</span>
			</div>
			<AvSwitch
				:modelValue="contract.isContract"
				:label="t(APP_ID, 'This document is a contract')"
				@update:modelValue="onToggle(contract.documentId, $event)" />
			<p v-if="!contract.isContract && !isMain(contract.documentId)" class="contract-step__follows">
				{{ t(APP_ID, 'Follows the main document') }}
			</p>
			<ContractFields
				v-if="contract.isContract"
				:modelValue="contract.form"
				:errors="errorsByDocument.get(contract.documentId) ?? {}"
				:showsErrors="showsErrors"
				:typeSuggestions="typeSuggestions.data.value ?? []"
				:isPhone="isPhone"
				@update:modelValue="onFormChange(contract.documentId, $event)" />
		</AvCard>
	</div>
</template>

<style scoped>
.contract-step {
	display: flex;
	flex-direction: column;
	gap: 16px;
	max-width: 880px;
}

.contract-step__intro {
	margin: 0;
	color: var(--av-muted);
}

section.contract-step__card {
	display: flex;
	flex-direction: column;
	gap: 16px;
	padding: 20px 24px;
}

.contract-step__heading {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 8px 12px;
}

.contract-step__name {
	margin: 0;
	font-size: var(--av-text-h2);
	font-weight: 400;
	overflow-wrap: anywhere;
}

.contract-step__role,
.contract-step__follows {
	margin: 0;
	color: var(--av-muted);
	font-size: var(--av-text-meta);
}

.contract-step--phone section.contract-step__card {
	padding: 16px;
}
</style>
```

Add the translations:

```bash
node scripts/add-translations.mjs <<'JSON'
{
	"Contract": "Contrato",
	"Mark the documents that are contracts to follow their terms and get alerts before the deadlines. You can skip this step.": "Marque os documentos que são contratos para acompanhar a vigência e receber alertas antes dos prazos. Você pode pular esta etapa.",
	"This envelope renews a contract. Once everyone signs, the previous contract reads as renewed.": "Este envelope renova um contrato. Quando todos assinarem, o contrato anterior passa a constar como renovado.",
	"Main document": "Documento principal",
	"Annex": "Anexo",
	"This document is a contract": "Este documento é um contrato",
	"Follows the main document": "Segue o principal"
}
JSON
```

- [ ] **Step 8: Run the tests to see them pass**

Run: `npx vitest run src/wizard src/l10n.spec.ts`
Expected: PASS (the wizard's other specs keep four steps: their configuration has no `contractsEnabled`).

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/wizard l10n
git commit -m "feat(contracts): add the Contrato step to the wizard"
```

---

### Task 16: The "Contrato" card on the envelope page

**Files:**
- Create: `src/contracts/contract-status.ts`, `src/contracts/contract-facts.ts`
- Modify: `src/contracts/contract-form.ts` (`dayAfter`), `src/contracts/contract-form.spec.ts`
- Create: `src/detail/ContractCard.vue`, `src/detail/ContractEditDialog.vue`, `src/detail/ContractRenewDialog.vue`, `src/detail/ContractEndDialog.vue`
- Modify: `src/detail/DetailView.vue`, `src/presentation/timeline.ts`
- Test: `src/contracts/contract-status.spec.ts`, `src/contracts/contract-facts.spec.ts`, `src/detail/ContractCard.spec.ts` (new), `src/presentation/timeline.spec.ts`

**Interfaces:**
- Consumes: `EnvelopeDetail.contracts|canActOnContracts`, `EnvelopeDocument.contractTerms`, the contract API (Task 11), `ContractFields`, `frequencyOptions`, the form rules (Task 13), `useDialogMutation`, `useEnvelopeCache`, `pickPdfNodes` (`src/new-envelope.ts`), `draftFromFiles`, `ROUTE_NAMES.envelope`.
- Produces:
  - `contractChip(contract: ContractChipSource): ContractChip` and `awaitingSignatureChip(): ContractChip` with `ContractChip = { label: string, tone: PillTone }`, `ContractChipSource = Pick<Contract, 'status' | 'autoRenew' | 'daysUntilKeyDate'>`, `COMING_DUE_DAYS = 90` — the chips Plan 10's list reuses ("Vigente", "A vencer em 23 dias", "Prazo de aviso em 12 dias", "Vencido", "Encerrado", "Renovado").
  - `contractFacts(terms: ContractTerms): ContractFact[]` (`{ term, detail }` lines).
  - `dayAfter(day: string): string`.
  - `<ContractCard :envelope :isPhone />` with the dialogs; timeline labels for every `contract_*` event.

- [ ] **Step 1: Write the failing presentation tests**

Create `src/contracts/contract-status.spec.ts`:

```ts
import type { PillTone } from '../ui/tones.ts'
import type { ContractChipSource } from './contract-status.ts'

import { describe, expect, it } from 'vitest'
import { usePortugueseEnvironment } from '../test-support/pt-br-environment.ts'
import { awaitingSignatureChip, contractChip } from './contract-status.ts'

usePortugueseEnvironment()

const CHIPS: Array<[string, ContractChipSource, string, PillTone]> = [
	['far from its end', { status: 'active', autoRenew: false, daysUntilKeyDate: 120 }, 'Vigente', 'success'],
	['23 days from its end', { status: 'active', autoRenew: false, daysUntilKeyDate: 23 }, 'A vencer em 23 dias', 'warning'],
	['a day from its end', { status: 'active', autoRenew: false, daysUntilKeyDate: 1 }, 'A vencer em 1 dia', 'warning'],
	['ending today', { status: 'active', autoRenew: false, daysUntilKeyDate: 0 }, 'Vence hoje', 'warning'],
	['12 days from its notice deadline', { status: 'active', autoRenew: true, daysUntilKeyDate: 12 }, 'Prazo de aviso em 12 dias', 'warning'],
	['at its notice deadline', { status: 'active', autoRenew: true, daysUntilKeyDate: 0 }, 'Prazo de aviso termina hoje', 'warning'],
	['past its notice deadline, waiting to renew', { status: 'active', autoRenew: true, daysUntilKeyDate: -5 }, 'Vigente', 'success'],
	['expired', { status: 'expired', autoRenew: false, daysUntilKeyDate: -3 }, 'Vencido', 'danger'],
	['ended', { status: 'ended', autoRenew: false, daysUntilKeyDate: 40 }, 'Encerrado', 'neutral'],
	['renewed', { status: 'renewed', autoRenew: false, daysUntilKeyDate: 40 }, 'Renovado', 'neutral'],
]

describe('contract chips', () => {
	it.each(CHIPS)('labels a contract %s', (_case, contract, label, tone) => {
		expect(contractChip(contract)).toEqual({ label, tone })
	})

	it('labels terms waiting for signatures', () => {
		expect(awaitingSignatureChip()).toEqual({ label: 'Aguardando assinatura', tone: 'brand' })
	})
})
```

Create `src/contracts/contract-facts.spec.ts`:

```ts
import type { ContractTerms } from '../api/types.ts'

import { describe, expect, it } from 'vitest'
import { usePortugueseEnvironment } from '../test-support/pt-br-environment.ts'
import { contractFacts } from './contract-facts.ts'

usePortugueseEnvironment()

const TERMS: ContractTerms = {
	startsOn: '2026-01-01',
	endsOn: '2026-12-31',
	autoRenew: true,
	renewalTermMonths: 12,
	noticeDays: 30,
	valueCents: 450000,
	valueFrequency: 'monthly',
	counterpartyName: 'Imobiliária Central Ltda',
	counterpartyDocument: '11222333000181',
	type: 'Locação',
	alertDays: [90, 30, 7, 0],
	source: 'manual',
}

describe('contract facts', () => {
	it('reads every field of a full contract', () => {
		expect(contractFacts(TERMS)).toEqual([
			{ term: 'Vigência', detail: '01/01/2026 a 31/12/2026' },
			{ term: 'Renovação', detail: 'Automática, a cada 12 meses' },
			{ term: 'Aviso prévio', detail: '30 dias antes do término' },
			{ term: 'Valor', detail: 'R$ 4.500,00 por mês' },
			{ term: 'Contraparte', detail: 'Imobiliária Central Ltda · 11.222.333/0001-81' },
			{ term: 'Tipo', detail: 'Locação' },
			{ term: 'Alertas', detail: '90, 30, 7 e 0 dias antes' },
		])
	})

	it('leaves out the fields left empty', () => {
		const minimal: ContractTerms = { ...TERMS, startsOn: null, autoRenew: false, renewalTermMonths: null, noticeDays: null, valueCents: null, valueFrequency: null, counterpartyName: null, counterpartyDocument: null, type: null, alertDays: [] }

		expect(contractFacts(minimal)).toEqual([
			{ term: 'Vigência', detail: 'Até 31/12/2026' },
			{ term: 'Renovação', detail: 'Sem renovação automática' },
			{ term: 'Alertas', detail: 'Sem alertas' },
		])
	})
})
```

In `src/contracts/contract-form.spec.ts`, add `dayAfter` to the import and:

```ts
	it('names the day after a date, across months and years', () => {
		expect(dayAfter('2026-12-31')).toBe('2027-01-01')
		expect(dayAfter('2028-02-28')).toBe('2028-02-29')
	})
```

In `src/presentation/timeline.spec.ts`, add:

```ts
describe('contract timeline entries', () => {
	it.each([
		['contract_registered', {}, 'Dados do contrato registrados'],
		['contract_updated', {}, 'Dados do contrato alterados'],
		['contract_renewed', { fromEndsOn: '2026-12-31', toEndsOn: '2027-12-31' }, 'Contrato renovado: 31/12/2026 → 31/12/2027'],
		['contract_auto_renewed', { fromEndsOn: '2026-12-31', toEndsOn: '2027-12-31' }, 'Renovado automaticamente: 31/12/2026 → 31/12/2027'],
		['contract_expired', { endsOn: '2026-12-31' }, 'Contrato vencido'],
		['contract_ended', { reason: 'Distrato' }, 'Contrato encerrado'],
		['contract_replaced', {}, 'Contrato substituído por um novo documento'],
	])('labels %s', (type, detail, label) => {
		const event: EnvelopeEvent = { type, signerId: null, occurredAt: epochAt('2026-10-02 10:00'), actorUid: null, detail }

		expect(timelineEntries(envelopeDetail({ sentAt: null, events: [event] }))[0]?.label).toBe(label)
	})
})
```

- [ ] **Step 2: Write the failing card test**

Create `src/detail/ContractCard.spec.ts`:

```ts
import type { VueWrapper } from '@vue/test-utils'
import type { ContractDetail, ContractTerms, EnvelopeDetail, EnvelopeDocument } from '../api/types.ts'

import { showSuccess } from '@nextcloud/dialogs'
import { File, Permission } from '@nextcloud/files'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import ContractCard from './ContractCard.vue'
import { createRenewalDraft, endContract, registerContract, renewContract } from '../api/contracts.ts'
import { pickPdfNodes } from '../new-envelope.ts'
import { ROUTE_NAMES } from '../router.ts'
import { envelopeDetail, envelopeSigner } from '../test-support/envelope-fixtures.ts'
import { usePortugueseEnvironment } from '../test-support/pt-br-environment.ts'

vi.mock('../app-config.ts', () => ({
	APP_ID: 'assinaturas',
	appConfig: () => ({ isAdmin: false, environment: 'production', contractsEnabled: true, limits: { maxFiles: 20, maxTitleLength: 255, reminderCooldownSeconds: 1800 } }),
}))
vi.mock('@nextcloud/router', () => ({ generateUrl: (path: string) => `/index.php${path}` }))
vi.mock('@nextcloud/dialogs', () => ({ showError: vi.fn(), showSuccess: vi.fn() }))
vi.mock('../logger.ts', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('../new-envelope.ts', () => ({ pickPdfNodes: vi.fn() }))
vi.mock('../api/contracts.ts', () => ({
	getContractTypes: vi.fn(async () => ['Locação']),
	registerContract: vi.fn(),
	updateContract: vi.fn(),
	renewContract: vi.fn(),
	endContract: vi.fn(),
	createRenewalDraft: vi.fn(),
}))

usePortugueseEnvironment()

const UUID = '00000000-0000-4000-8000-000000000001'
const OLD_UUID = '00000000-0000-4000-8000-000000000009'
const NEW_UUID = '00000000-0000-4000-8000-000000000010'
const DAV_ROOT = '/files/patrick'
const DAV_URL = `https://cloud.example.com/remote.php/dav${DAV_ROOT}`

const TERMS: ContractTerms = {
	startsOn: '2026-01-01',
	endsOn: '2026-12-31',
	autoRenew: false,
	renewalTermMonths: null,
	noticeDays: null,
	valueCents: 450000,
	valueFrequency: 'monthly',
	counterpartyName: 'Imobiliária Central Ltda',
	counterpartyDocument: '11222333000181',
	type: 'Locação',
	alertDays: [90, 30, 7, 0],
	source: 'manual',
}

const CONTRACT: ContractDetail = {
	...TERMS,
	id: 3,
	envelopeUuid: UUID,
	documentId: 1,
	name: 'Locação Sala 3',
	status: 'active',
	keyDate: '2026-12-31',
	daysUntilKeyDate: 23,
	continuesContractId: null,
	endReason: null,
	chain: [],
}

const DOCUMENT: EnvelopeDocument = {
	id: 1,
	position: 0,
	sourceFileId: 101,
	sourcePath: '/Contratos/Locação Sala 3.pdf',
	name: 'Locação Sala 3.pdf',
	size: 1000,
	pageCount: 1,
	pages: [],
	saveStatus: 'saved',
	signedFileId: 201,
	contractTerms: null,
	fields: [],
}

function signedEnvelope(overrides: Partial<EnvelopeDetail> = {}): EnvelopeDetail {
	return envelopeDetail({
		uuid: UUID,
		title: 'Locação Sala 3',
		status: 'completed',
		documents: [DOCUMENT],
		signers: [envelopeSigner({ name: 'Ana Lima' })],
		contracts: [CONTRACT],
		canActOnContracts: true,
		...overrides,
	})
}

const Blank = defineComponent({ render: () => h('p') })
const mounted: VueWrapper[] = []

async function mountCard(envelope: EnvelopeDetail) {
	const router = createRouter({
		history: createMemoryHistory(),
		routes: [
			{ path: '/', name: ROUTE_NAMES.dashboard, component: Blank },
			{ path: '/envelopes/:uuid', name: ROUTE_NAMES.envelope, component: Blank },
		],
	})
	await router.push(`/envelopes/${UUID}`)
	await router.isReady()
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
	const wrapper = mount(ContractCard, {
		props: { envelope, isPhone: false },
		attachTo: document.body,
		global: { plugins: [router, [VueQueryPlugin, { queryClient }]] },
	})
	mounted.push(wrapper)
	await flushPromises()
	return { wrapper, router }
}

function buttonNamed(wrapper: VueWrapper, name: string) {
	return wrapper.findAll('button').find((button) => button.text() === name)
}

function controlLabelled(wrapper: VueWrapper, text: string) {
	const label = wrapper.findAll('label').find((candidate) => candidate.text() === text)
	return wrapper.find(`[id="${label?.attributes('for') ?? 'missing'}"]`)
}

beforeEach(() => {
	vi.mocked(registerContract).mockResolvedValue(signedEnvelope())
	vi.mocked(renewContract).mockResolvedValue(signedEnvelope())
	vi.mocked(endContract).mockResolvedValue(signedEnvelope())
})

afterEach(() => {
	mounted.splice(0).forEach((wrapper) => wrapper.unmount())
	vi.clearAllMocks()
})

describe('ContractCard', () => {
	it('shows a signed contract with its chip and its terms', async () => {
		const { wrapper } = await mountCard(signedEnvelope())

		const text = wrapper.text()

		expect(text).toContain('A vencer em 23 dias')
		expect(text).toContain('01/01/2026 a 31/12/2026')
		expect(text).toContain('R$ 4.500,00 por mês')
		expect(text).toContain('Imobiliária Central Ltda · 11.222.333/0001-81')
	})

	it('links the earlier contracts of its renewal chain', async () => {
		const chain = [
			{ contractId: 2, envelopeUuid: OLD_UUID, name: 'Contrato original', startsOn: '2025-03-01', endsOn: '2026-02-28', status: 'renewed' as const, isCurrent: false },
			{ contractId: 3, envelopeUuid: UUID, name: 'Aditivo', startsOn: '2026-03-01', endsOn: '2027-02-28', status: 'active' as const, isCurrent: true },
		]
		const { wrapper } = await mountCard(signedEnvelope({ contracts: [{ ...CONTRACT, chain }] }))

		const history = wrapper.find('nav[aria-label="Histórico de renovações"]')

		expect(history.find('a').text()).toBe('Contrato original 2025–2026')
		expect(history.find('a').attributes('href')).toBe(`/envelopes/${OLD_UUID}`)
		expect(history.find('[aria-current="page"]').text()).toBe('Aditivo 2026–2027')
	})

	it('offers no action to someone who may only see the envelope', async () => {
		const { wrapper } = await mountCard(signedEnvelope({ canActOnContracts: false }))

		expect(buttonNamed(wrapper, 'Editar')).toBeUndefined()
		expect(buttonNamed(wrapper, 'Renovar')).toBeUndefined()
	})

	it('offers only Editar on a contract that was ended', async () => {
		const { wrapper } = await mountCard(signedEnvelope({ contracts: [{ ...CONTRACT, status: 'ended', endReason: 'Distrato' }] }))

		expect(buttonNamed(wrapper, 'Editar')).toBeDefined()
		expect(buttonNamed(wrapper, 'Renovar')).toBeUndefined()
		expect(wrapper.text()).toContain('Motivo do encerramento: Distrato')
	})

	it('renews a contract until a later date, keeping its value', async () => {
		const { wrapper } = await mountCard(signedEnvelope())
		await buttonNamed(wrapper, 'Renovar')?.trigger('click')
		await controlLabelled(wrapper, 'Novo término').setValue('2027-12-31')

		await buttonNamed(wrapper, 'Renovar contrato')?.trigger('click')
		await flushPromises()

		expect(renewContract).toHaveBeenCalledWith(3, { endsOn: '2027-12-31', valueCents: 450000, valueFrequency: 'monthly' })
		expect(showSuccess).toHaveBeenCalledWith('Contrato renovado')
	})

	it('keeps a renewal that does not move the end in the dialog', async () => {
		const { wrapper } = await mountCard(signedEnvelope())
		await buttonNamed(wrapper, 'Renovar')?.trigger('click')
		await controlLabelled(wrapper, 'Novo término').setValue('2026-12-31')

		await buttonNamed(wrapper, 'Renovar contrato')?.trigger('click')
		await flushPromises()

		expect(renewContract).not.toHaveBeenCalled()
		expect(wrapper.text()).toContain('Escolha um término depois do atual.')
	})

	it('ends a contract with its reason', async () => {
		const { wrapper } = await mountCard(signedEnvelope())
		await buttonNamed(wrapper, 'Encerrar')?.trigger('click')
		await controlLabelled(wrapper, 'Motivo (opcional)').setValue('Distrato amigável')

		await buttonNamed(wrapper, 'Encerrar contrato')?.trigger('click')
		await flushPromises()

		expect(endContract).toHaveBeenCalledWith(3, 'Distrato amigável')
	})

	it('records the contract of a completed envelope that has none', async () => {
		const { wrapper } = await mountCard(signedEnvelope({ contracts: [] }))
		await buttonNamed(wrapper, 'Registrar dados do contrato')?.trigger('click')
		await controlLabelled(wrapper, 'Término').setValue('2027-06-30')

		await buttonNamed(wrapper, 'Salvar contrato')?.trigger('click')
		await flushPromises()

		expect(registerContract).toHaveBeenCalledWith(UUID, 1, expect.objectContaining({ endsOn: '2027-06-30', counterpartyName: 'Ana Lima', source: 'manual' }))
	})

	it('opens a draft for the next term with the PDFs the user picks', async () => {
		vi.mocked(pickPdfNodes).mockResolvedValue([new File({ id: 77, source: `${DAV_URL}/Contratos/Aditivo.pdf`, owner: 'patrick', mime: 'application/pdf', permissions: Permission.ALL, root: DAV_ROOT })])
		vi.mocked(createRenewalDraft).mockResolvedValue(envelopeDetail({ uuid: NEW_UUID, status: 'draft' }))
		const { wrapper, router } = await mountCard(signedEnvelope())

		await buttonNamed(wrapper, 'Renovar com novo documento')?.trigger('click')
		await flushPromises()

		expect(createRenewalDraft).toHaveBeenCalledWith(3, [77])
		expect(router.currentRoute.value.params.uuid).toBe(NEW_UUID)
	})

	it('shows terms that wait for the signatures', async () => {
		const { wrapper } = await mountCard(signedEnvelope({ status: 'pending', contracts: [], documents: [{ ...DOCUMENT, contractTerms: TERMS }] }))

		expect(wrapper.text()).toContain('Aguardando assinatura')
		expect(buttonNamed(wrapper, 'Registrar dados do contrato')).toBeUndefined()
	})

	it('shows nothing for an envelope with no contract to show', async () => {
		const { wrapper } = await mountCard(signedEnvelope({ status: 'cancelled', contracts: [] }))

		expect(wrapper.find('section').exists()).toBe(false)
	})
})
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run src/contracts src/detail/ContractCard.spec.ts src/presentation/timeline.spec.ts`
Expected: FAIL — `Failed to resolve import "./contract-status.ts"`, `"./contract-facts.ts"`, `"./ContractCard.vue"`, `dayAfter is not a function`, and the timeline labels read "Atualização".

- [ ] **Step 4: Implement the chips, the facts and `dayAfter`**

Create `src/contracts/contract-status.ts`:

```ts
import type { Contract } from '../api/types.ts'
import type { PillTone } from '../ui/tones.ts'

import { n, t } from '@nextcloud/l10n'
import { APP_ID } from '../app-config.ts'

/** "A vencer": an active contract whose key date is this close (a computed label, never a stored status). */
export const COMING_DUE_DAYS = 90

export interface ContractChip {
	label: string
	tone: PillTone
}

export type ContractChipSource = Pick<Contract, 'status' | 'autoRenew' | 'daysUntilKeyDate'>

const TODAY = 0

/** A contract that renews itself counts down to its notice deadline; any other to its end. */
function comingDueChip(contract: ContractChipSource): ContractChip {
	const days = contract.daysUntilKeyDate
	if (days === TODAY) {
		return { label: contract.autoRenew ? t(APP_ID, 'Notice period ends today') : t(APP_ID, 'Ends today'), tone: 'warning' }
	}
	return {
		label: contract.autoRenew
			? n(APP_ID, 'Notice period in %n day', 'Notice period in %n days', days)
			: n(APP_ID, 'Ends in %n day', 'Ends in %n days', days),
		tone: 'warning',
	}
}

function activeChip(contract: ContractChipSource): ContractChip {
	const isComingDue = contract.daysUntilKeyDate >= TODAY && contract.daysUntilKeyDate <= COMING_DUE_DAYS
	return isComingDue ? comingDueChip(contract) : { label: t(APP_ID, 'In force'), tone: 'success' }
}

const CHIPS: Readonly<Record<Contract['status'], (contract: ContractChipSource) => ContractChip>> = {
	active: activeChip,
	expired: () => ({ label: t(APP_ID, 'Lapsed'), tone: 'danger' }),
	ended: () => ({ label: t(APP_ID, 'Ended'), tone: 'neutral' }),
	renewed: () => ({ label: t(APP_ID, 'Renewed'), tone: 'neutral' }),
}

/** "Vigente", "A vencer em 23 dias", "Prazo de aviso em 12 dias", "Vencido", "Encerrado", "Renovado". */
export function contractChip(contract: ContractChipSource): ContractChip {
	return CHIPS[contract.status](contract)
}

/** Terms held with an envelope that still waits for signatures. */
export function awaitingSignatureChip(): ContractChip {
	return { label: t(APP_ID, 'Awaiting signature'), tone: 'brand' }
}
```

Create `src/contracts/contract-facts.ts`:

```ts
import type { ContractTerms, ValueFrequency } from '../api/types.ts'

import { getCanonicalLocale, n, t } from '@nextcloud/l10n'
import { APP_ID } from '../app-config.ts'
import { formatCalendarDate } from '../presentation/dates.ts'
import { PLAIN_TEXT } from '../presentation/plain-text.ts'
import { formatMoney } from './money.ts'
import { formatTaxId } from './tax-id.ts'

/** One line of a contract's card: what it is and what it says. */
export interface ContractFact {
	term: string
	detail: string
}

const COUNTERPARTY_SEPARATOR = ' · '

const VALUE_WITH_FREQUENCY: Readonly<Record<ValueFrequency, (value: string) => string>> = {
	once: (value) => t(APP_ID, '{value}, paid once', { value }, undefined, PLAIN_TEXT),
	monthly: (value) => t(APP_ID, '{value} per month', { value }, undefined, PLAIN_TEXT),
	yearly: (value) => t(APP_ID, '{value} per year', { value }, undefined, PLAIN_TEXT),
}

function termFact(terms: ContractTerms): ContractFact {
	const end = formatCalendarDate(terms.endsOn)
	const detail = terms.startsOn === null
		? t(APP_ID, 'Until {end}', { end }, undefined, PLAIN_TEXT)
		: t(APP_ID, '{start} to {end}', { start: formatCalendarDate(terms.startsOn), end }, undefined, PLAIN_TEXT)
	return { term: t(APP_ID, 'Term'), detail }
}

function renewalFact(terms: ContractTerms): ContractFact {
	const detail = terms.autoRenew && terms.renewalTermMonths !== null
		? n(APP_ID, 'Automatic, every %n month', 'Automatic, every %n months', terms.renewalTermMonths)
		: t(APP_ID, 'Does not renew automatically')
	return { term: t(APP_ID, 'Renewal'), detail }
}

function noticeFacts(terms: ContractTerms): ContractFact[] {
	if (terms.noticeDays === null) {
		return []
	}
	return [{ term: t(APP_ID, 'Notice period'), detail: n(APP_ID, '%n day before the end', '%n days before the end', terms.noticeDays) }]
}

function valueFacts(terms: ContractTerms): ContractFact[] {
	if (terms.valueCents === null || terms.valueFrequency === null) {
		return []
	}
	return [{ term: t(APP_ID, 'Value'), detail: VALUE_WITH_FREQUENCY[terms.valueFrequency](formatMoney(terms.valueCents)) }]
}

function counterpartyFacts(terms: ContractTerms): ContractFact[] {
	const parts = [terms.counterpartyName, terms.counterpartyDocument === null ? null : formatTaxId(terms.counterpartyDocument)]
		.filter((part): part is string => part !== null)
	return parts.length === 0 ? [] : [{ term: t(APP_ID, 'Counterparty'), detail: parts.join(COUNTERPARTY_SEPARATOR) }]
}

function typeFacts(terms: ContractTerms): ContractFact[] {
	return terms.type === null ? [] : [{ term: t(APP_ID, 'Type'), detail: terms.type }]
}

function alertsFact(terms: ContractTerms): ContractFact {
	if (terms.alertDays.length === 0) {
		return { term: t(APP_ID, 'Alerts'), detail: t(APP_ID, 'No alerts') }
	}
	const days = new Intl.ListFormat(getCanonicalLocale(), { type: 'conjunction' }).format(terms.alertDays.map(String))
	return { term: t(APP_ID, 'Alerts'), detail: t(APP_ID, '{days} days before', { days }, undefined, PLAIN_TEXT) }
}

/** A contract's card lines in reading order; a field left empty has no line. */
export function contractFacts(terms: ContractTerms): ContractFact[] {
	return [
		termFact(terms),
		renewalFact(terms),
		...noticeFacts(terms),
		...valueFacts(terms),
		...counterpartyFacts(terms),
		...typeFacts(terms),
		alertsFact(terms),
	]
}
```

In `src/contracts/contract-form.ts`, add after `isCalendarDate()`:

```ts
const ISO_DATE_LENGTH = 10

/** "2026-12-31" → "2027-01-01". */
export function dayAfter(day: string): string {
	const [year = 0, month = 0, date = 0] = day.split('-').map(Number)
	return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, ISO_DATE_LENGTH)
}
```

- [ ] **Step 5: Label the contract events on the timeline**

In `src/presentation/timeline.ts`, add `import { formatCalendarDate } from './dates.ts'` to the existing `./dates.ts` import (it becomes `import { formatCalendarDate, formatDate } from './dates.ts'`), add before `EVENT_LABELS`:

```ts
/** The end dates a renewal moved between, or null for an event recorded without them. */
function renewalDates(event: EnvelopeEvent): { from: string, to: string } | null {
	const { fromEndsOn, toEndsOn } = event.detail
	if (typeof fromEndsOn !== 'string' || typeof toEndsOn !== 'string') {
		return null
	}
	return { from: formatCalendarDate(fromEndsOn), to: formatCalendarDate(toEndsOn) }
}

function contractRenewedLabel({ event }: LabelContext): string {
	const dates = renewalDates(event)
	return dates === null ? t(APP_ID, 'Contract renewed') : t(APP_ID, 'Contract renewed: {from} → {to}', dates, undefined, PLAIN_TEXT)
}

function contractAutoRenewedLabel({ event }: LabelContext): string {
	const dates = renewalDates(event)
	return dates === null ? t(APP_ID, 'Renewed automatically') : t(APP_ID, 'Renewed automatically: {from} → {to}', dates, undefined, PLAIN_TEXT)
}
```

add to `EVENT_LABELS` after `save_failed`:

```ts
	contract_registered: () => t(APP_ID, 'Contract details recorded'),
	contract_updated: () => t(APP_ID, 'Contract details changed'),
	contract_renewed: contractRenewedLabel,
	contract_auto_renewed: contractAutoRenewedLabel,
	contract_expired: () => t(APP_ID, 'Contract expired'),
	contract_ended: () => t(APP_ID, 'Contract ended'),
	contract_replaced: () => t(APP_ID, 'Contract replaced by a new document'),
```

and to `EVENT_TONES` after `save_failed: 'warning',`:

```ts
	contract_renewed: 'success',
	contract_auto_renewed: 'success',
	contract_expired: 'danger',
	contract_replaced: 'info',
```

- [ ] **Step 6: Implement the dialogs**

Create `src/detail/ContractEditDialog.vue`:

```vue
<script setup lang="ts">
import type { ContractDetail, ContractTerms, EnvelopeDetail } from '../api/types.ts'
import type { ContractForm } from '../contracts/contract-form.ts'

import { t } from '@nextcloud/l10n'
import { useQuery } from '@tanstack/vue-query'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import AvButton from '../ui/AvButton.vue'
import AvDialog from '../ui/AvDialog.vue'
import ContractFields from '../contracts/ContractFields.vue'
import { getContractTypes, registerContract, updateContract } from '../api/contracts.ts'
import { QUERY_KEYS } from '../api/query-keys.ts'
import { APP_ID } from '../app-config.ts'
import { contractFormFrom, contractTermsFrom, emptyContractForm, validateContractForm } from '../contracts/contract-form.ts'
import { useDialogMutation } from '../envelope-mutations/use-dialog-mutation.ts'

const props = defineProps<{
	open: boolean
	envelope: EnvelopeDetail
	/** Null records the contract of `documentId` ("Registrar dados do contrato"). */
	contract: ContractDetail | null
	documentId: number
	isPhone: boolean
}>()

const emit = defineEmits<{ close: [] }>()

interface ContractSave {
	uuid: string
	documentId: number
	contractId: number | null
	terms: ContractTerms
}

const form = ref<ContractForm>(emptyContractForm())
const showsErrors = ref(false)
const fields = useTemplateRef<HTMLElement>('fields')
const errors = computed(() => validateContractForm(form.value))
const isRegistering = computed(() => props.contract === null)

const types = useQuery({ queryKey: QUERY_KEYS.contractTypes(), queryFn: getContractTypes, enabled: computed(() => props.open) })

const { error, isPending, mutate, requestClose } = useDialogMutation({
	isOpen: () => props.open,
	close: () => emit('close'),
	mutationFn: (save: ContractSave) => (save.contractId === null ? registerContract(save.uuid, save.documentId, save.terms) : updateContract(save.contractId, save.terms)),
	envelopeUuid: ({ uuid }) => uuid,
	failureLog: 'Could not save the contract details',
	successMessage: () => t(APP_ID, 'Contract details saved'),
	afterSuccess: (detail, _variables, cache) => cache.apply(detail),
})

watch(() => props.open, (open) => {
	if (!open) {
		return
	}
	showsErrors.value = false
	form.value = props.contract === null ? emptyContractForm(props.envelope.signers[0]?.name ?? '') : contractFormFrom(props.contract)
}, { immediate: true })

async function onSave() {
	const terms = contractTermsFrom(form.value, props.contract?.source ?? 'manual')
	if (terms === null) {
		showsErrors.value = true
		await nextTick()
		fields.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
		return
	}
	mutate({ uuid: props.envelope.uuid, documentId: props.documentId, contractId: props.contract?.id ?? null, terms })
}
</script>

<template>
	<AvDialog
		:open="open"
		:title="isRegistering ? t(APP_ID, 'Record contract details') : t(APP_ID, 'Edit contract')"
		:error="error"
		@close="requestClose">
		<div ref="fields">
			<ContractFields
				v-model="form"
				:errors="errors"
				:showsErrors="showsErrors"
				:typeSuggestions="types.data.value ?? []"
				:isPhone="isPhone" />
		</div>
		<template #actions>
			<AvButton variant="secondary" :disabled="isPending" @click="requestClose">
				{{ t(APP_ID, 'Go back') }}
			</AvButton>
			<AvButton :disabled="isPending" @click="onSave">
				{{ t(APP_ID, 'Save contract') }}
			</AvButton>
		</template>
	</AvDialog>
</template>
```

Create `src/detail/ContractRenewDialog.vue`:

```vue
<script setup lang="ts">
import type { ContractDetail, ContractRenewal, EnvelopeDetail } from '../api/types.ts'
import type { ContractForm, ContractFormErrors } from '../contracts/contract-form.ts'

import { t } from '@nextcloud/l10n'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import AvButton from '../ui/AvButton.vue'
import AvDialog from '../ui/AvDialog.vue'
import AvSelect from '../ui/AvSelect.vue'
import AvTextField from '../ui/AvTextField.vue'
import { renewContract } from '../api/contracts.ts'
import { codeMessage } from '../api/error-messages.ts'
import { APP_ID } from '../app-config.ts'
import { contractFormFrom, contractTermsFrom, dayAfter, isValueFrequency, validateContractForm } from '../contracts/contract-form.ts'
import { frequencyOptions, NO_FREQUENCY } from '../contracts/frequency-options.ts'
import { useDialogMutation } from '../envelope-mutations/use-dialog-mutation.ts'
import { formatCalendarDate } from '../presentation/dates.ts'
import { PLAIN_TEXT } from '../presentation/plain-text.ts'

const props = defineProps<{
	open: boolean
	envelope: EnvelopeDetail
	contract: ContractDetail
}>()

const emit = defineEmits<{ close: [] }>()

type RenewalField = 'endsOn' | 'value' | 'valueFrequency'

const form = ref<ContractForm>(contractFormFrom(props.contract))
const showsErrors = ref(false)
const fields = useTemplateRef<HTMLElement>('fields')
const options = computed(frequencyOptions)
const earliestEnd = computed(() => dayAfter(props.contract.endsOn))

/** The contract's own rules, plus a renewal's: the end moves later. */
const errors = computed<ContractFormErrors>(() => {
	const formErrors = validateContractForm(form.value)
	const isNotLater = formErrors.endsOn === undefined && form.value.endsOn <= props.contract.endsOn
	return isNotLater ? { ...formErrors, endsOn: 'renewal_not_later' } : formErrors
})

const endsOn = computed({
	get: () => form.value.endsOn,
	set: (day: string) => {
		form.value = { ...form.value, endsOn: day }
	},
})

const value = computed({
	get: () => form.value.value,
	set: (text: string) => {
		form.value = { ...form.value, value: text }
	},
})

const frequency = computed({
	get: () => form.value.valueFrequency,
	set: (choice: string) => {
		form.value = { ...form.value, valueFrequency: isValueFrequency(choice) ? choice : NO_FREQUENCY }
	},
})

const { error, isPending, mutate, requestClose } = useDialogMutation({
	isOpen: () => props.open,
	close: () => emit('close'),
	mutationFn: ({ contractId, renewal }: { uuid: string, contractId: number, renewal: ContractRenewal }) => renewContract(contractId, renewal),
	envelopeUuid: ({ uuid }) => uuid,
	failureLog: 'Could not renew the contract',
	successMessage: () => t(APP_ID, 'Contract renewed'),
	afterSuccess: (detail, _variables, cache) => cache.apply(detail),
})

watch(() => props.open, (open) => {
	if (!open) {
		return
	}
	showsErrors.value = false
	form.value = { ...contractFormFrom(props.contract), endsOn: '' }
}, { immediate: true })

function errorOf(field: RenewalField): string | null {
	const code = errors.value[field]
	return showsErrors.value && code !== undefined ? codeMessage(code) : null
}

async function onRenew() {
	const terms = Object.keys(errors.value).length === 0 ? contractTermsFrom(form.value) : null
	if (terms === null) {
		showsErrors.value = true
		await nextTick()
		fields.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
		return
	}
	mutate({ uuid: props.envelope.uuid, contractId: props.contract.id, renewal: { endsOn: terms.endsOn, valueCents: terms.valueCents, valueFrequency: terms.valueFrequency } })
}
</script>

<template>
	<AvDialog :open="open" :title="t(APP_ID, 'Renew contract')" :error="error" @close="requestClose">
		<div ref="fields" class="contract-renew-dialog">
			<p class="contract-renew-dialog__current">
				{{ t(APP_ID, 'Current end: {date}', { date: formatCalendarDate(contract.endsOn) }, undefined, PLAIN_TEXT) }}
			</p>
			<AvTextField
				v-model="endsOn"
				type="date"
				required
				:min="earliestEnd"
				:label="t(APP_ID, 'New end date')"
				:error="errorOf('endsOn')" />
			<AvTextField
				v-model="value"
				inputmode="decimal"
				:label="t(APP_ID, 'Value (R$)')"
				:error="errorOf('value')" />
			<AvSelect
				v-model="frequency"
				:label="t(APP_ID, 'Charged')"
				:options="options"
				:error="errorOf('valueFrequency')" />
		</div>
		<template #actions>
			<AvButton variant="secondary" :disabled="isPending" @click="requestClose">
				{{ t(APP_ID, 'Go back') }}
			</AvButton>
			<AvButton :disabled="isPending" @click="onRenew">
				{{ t(APP_ID, 'Renew contract') }}
			</AvButton>
		</template>
	</AvDialog>
</template>

<style scoped>
.contract-renew-dialog {
	display: flex;
	flex-direction: column;
	gap: 16px;
}

.contract-renew-dialog__current {
	margin: 0;
	color: var(--av-muted);
}
</style>
```

Create `src/detail/ContractEndDialog.vue`:

```vue
<script setup lang="ts">
import type { ContractDetail, EnvelopeDetail } from '../api/types.ts'

import { t } from '@nextcloud/l10n'
import { computed, ref, watch } from 'vue'
import AvButton from '../ui/AvButton.vue'
import AvDialog from '../ui/AvDialog.vue'
import AvTextarea from '../ui/AvTextarea.vue'
import { endContract } from '../api/contracts.ts'
import { APP_ID } from '../app-config.ts'
import { CONTRACT_LIMITS } from '../contracts/contract-form.ts'
import { useDialogMutation } from '../envelope-mutations/use-dialog-mutation.ts'

const props = defineProps<{
	open: boolean
	envelope: EnvelopeDetail
	contract: ContractDetail
}>()

const emit = defineEmits<{ close: [] }>()

const REASON_ROWS = 4

const reason = ref('')
const counter = computed(() => `${reason.value.length}/${CONTRACT_LIMITS.maxEndReasonLength}`)

const { error, isPending, mutate, requestClose } = useDialogMutation({
	isOpen: () => props.open,
	close: () => emit('close'),
	mutationFn: ({ contractId, text }: { uuid: string, contractId: number, text: string }) => endContract(contractId, text),
	envelopeUuid: ({ uuid }) => uuid,
	failureLog: 'Could not end the contract',
	successMessage: () => t(APP_ID, 'Contract ended'),
	afterSuccess: (detail, _variables, cache) => cache.apply(detail),
})

watch(() => props.open, (open) => {
	if (!open) {
		return
	}
	reason.value = ''
}, { immediate: true })

function onConfirm() {
	mutate({ uuid: props.envelope.uuid, contractId: props.contract.id, text: reason.value.trim() })
}
</script>

<template>
	<AvDialog :open="open" :title="t(APP_ID, 'End contract?')" @close="requestClose">
		<p class="contract-end-dialog__warning">
			{{ t(APP_ID, 'Alerts stop and the contract reads as ended.') }}
		</p>
		<AvTextarea
			v-model="reason"
			:label="t(APP_ID, 'Reason (optional)')"
			:maxlength="CONTRACT_LIMITS.maxEndReasonLength"
			:rows="REASON_ROWS"
			:hint="counter"
			:error="error" />
		<template #actions>
			<AvButton variant="secondary" :disabled="isPending" @click="requestClose">
				{{ t(APP_ID, 'Go back') }}
			</AvButton>
			<AvButton variant="danger" :disabled="isPending" @click="onConfirm">
				{{ t(APP_ID, 'End contract') }}
			</AvButton>
		</template>
	</AvDialog>
</template>

<style scoped>
.contract-end-dialog__warning {
	margin: 0;
	color: var(--av-muted);
}
</style>
```

- [ ] **Step 7: Implement the card**

Create `src/detail/ContractCard.vue`:

```vue
<script lang="ts">
import type { ContractDetail, ContractLink, EnvelopeDetail, EnvelopeDocument, EnvelopeStatus } from '../api/types.ts'

type ContractDialog = 'closed' | 'edit' | 'register' | 'renew' | 'end'

/** Envelopes still on their way to every signature: the terms they hold wait for it. */
const AWAITING_STATUSES: readonly EnvelopeStatus[] = ['sending', 'pending', 'expired', 'finalizing']
const YEAR_LENGTH = 4
const PDF_EXTENSION = /\.pdf$/i

/** "Contrato original 2025–2026"; one year when the term starts and ends in it. */
function chainLabel(link: ContractLink): string {
	const endYear = link.endsOn.slice(0, YEAR_LENGTH)
	const startYear = link.startsOn?.slice(0, YEAR_LENGTH) ?? endYear
	return startYear === endYear ? `${link.name} ${endYear}` : `${link.name} ${startYear}–${endYear}`
}

/** Named as the server names a contract: the envelope's title for the main document, else the file name. */
function heldContractName(document: EnvelopeDocument, envelope: EnvelopeDetail): string {
	return document.position === 0 ? envelope.title : document.name.replace(PDF_EXTENSION, '')
}

function isChangeable(contract: ContractDetail): boolean {
	return contract.status === 'active' || contract.status === 'expired'
}
</script>

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import { useMutation } from '@tanstack/vue-query'
import { computed, ref, shallowRef, useId } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import AvButton from '../ui/AvButton.vue'
import AvCard from '../ui/AvCard.vue'
import AvStatusPill from '../ui/AvStatusPill.vue'
import ContractEditDialog from './ContractEditDialog.vue'
import ContractEndDialog from './ContractEndDialog.vue'
import ContractRenewDialog from './ContractRenewDialog.vue'
import { createRenewalDraft } from '../api/contracts.ts'
import { showApiError } from '../api/show-api-error.ts'
import { APP_ID, appConfig } from '../app-config.ts'
import { contractFacts } from '../contracts/contract-facts.ts'
import { awaitingSignatureChip, contractChip } from '../contracts/contract-status.ts'
import { draftFromFiles } from '../draft-from-files.ts'
import { useEnvelopeCache } from '../envelope-mutations/envelope-cache.ts'
import { logger } from '../logger.ts'
import { pickPdfNodes } from '../new-envelope.ts'
import { PLAIN_TEXT } from '../presentation/plain-text.ts'
import { ROUTE_NAMES } from '../router.ts'

const props = defineProps<{
	envelope: EnvelopeDetail
	isPhone: boolean
}>()

const router = useRouter()
const envelopeCache = useEnvelopeCache()
const headingId = useId()
const dialog = ref<ContractDialog>('closed')
/** The contract the last dialog opened for; kept while that dialog closes. */
const selectedContract = shallowRef<ContractDetail | null>(null)

const rows = computed(() => props.envelope.contracts.map((contract) => ({
	contract,
	chip: contractChip(contract),
	facts: contractFacts(contract),
	isChangeable: isChangeable(contract),
})))

const awaiting = computed(() => {
	if (!AWAITING_STATUSES.includes(props.envelope.status)) {
		return []
	}
	return props.envelope.documents.flatMap((document) => (document.contractTerms === null
		? []
		: [{ document, name: heldContractName(document, props.envelope), facts: contractFacts(document.contractTerms) }]))
})

const awaitingChip = computed(awaitingSignatureChip)
const mainDocumentId = computed(() => props.envelope.documents[0]?.id ?? null)
const canRegister = computed(() => props.envelope.status === 'completed' && props.envelope.contracts.length === 0 && props.envelope.canActOnContracts && mainDocumentId.value !== null)
const isShown = computed(() => rows.value.length > 0 || awaiting.value.length > 0 || canRegister.value)
const editedDocumentId = computed(() => selectedContract.value?.documentId ?? mainDocumentId.value ?? 0)

const renewal = useMutation({
	mutationFn: async (contract: ContractDetail) => {
		const nodes = await pickPdfNodes(t(APP_ID, 'Choose the PDFs of the new contract'))
		const picked = draftFromFiles(nodes, appConfig().limits.maxTitleLength)
		return picked === null ? null : createRenewalDraft(contract.id, picked.fileIds)
	},
	onSuccess: async (draft) => {
		if (draft === null) {
			return
		}
		await envelopeCache.apply(draft)
		await router.push({ name: ROUTE_NAMES.envelope, params: { uuid: draft.uuid } })
	},
	onError: (error) => {
		logger.error('Could not start the contract renewal', { error })
		showApiError(error)
	},
})

function openFor(kind: Exclude<ContractDialog, 'closed' | 'register'>, contract: ContractDetail) {
	selectedContract.value = contract
	dialog.value = kind
}

function openRegister() {
	selectedContract.value = null
	dialog.value = 'register'
}

function close() {
	dialog.value = 'closed'
}
</script>

<template>
	<template v-if="isShown">
		<AvCard
			tag="section"
			class="contract-card"
			:class="{ 'contract-card--phone': isPhone }"
			:aria-labelledby="headingId">
			<h2 :id="headingId" class="contract-card__heading">
				{{ t(APP_ID, 'Contract') }}
			</h2>
			<article v-for="row in rows" :key="row.contract.id" class="contract-card__contract" :aria-label="row.contract.name">
				<div class="contract-card__title">
					<span class="contract-card__name">{{ row.contract.name }}</span>
					<AvStatusPill :label="row.chip.label" :tone="row.chip.tone" />
				</div>
				<dl class="contract-card__facts">
					<div v-for="fact in row.facts" :key="fact.term" class="contract-card__fact">
						<dt>{{ fact.term }}</dt>
						<dd>{{ fact.detail }}</dd>
					</div>
				</dl>
				<p v-if="row.contract.endReason !== null" class="contract-card__reason">
					{{ t(APP_ID, 'Reason for ending: {reason}', { reason: row.contract.endReason }, undefined, PLAIN_TEXT) }}
				</p>
				<nav v-if="row.contract.chain.length > 0" class="contract-card__chain" :aria-label="t(APP_ID, 'Renewal history')">
					<ol class="contract-card__chain-list">
						<li v-for="link in row.contract.chain" :key="link.contractId">
							<span v-if="link.isCurrent" aria-current="page">{{ chainLabel(link) }}</span>
							<RouterLink v-else-if="link.envelopeUuid !== null" :to="{ name: ROUTE_NAMES.envelope, params: { uuid: link.envelopeUuid } }">
								{{ chainLabel(link) }}
							</RouterLink>
							<span v-else>{{ chainLabel(link) }}</span>
						</li>
					</ol>
				</nav>
				<div v-if="envelope.canActOnContracts" class="contract-card__actions">
					<AvButton variant="secondary" @click="openFor('edit', row.contract)">
						{{ t(APP_ID, 'Edit') }}
					</AvButton>
					<template v-if="row.isChangeable">
						<AvButton variant="secondary" @click="openFor('renew', row.contract)">
							{{ t(APP_ID, 'Renew') }}
						</AvButton>
						<AvButton variant="secondary" :disabled="renewal.isPending.value" @click="renewal.mutate(row.contract)">
							{{ t(APP_ID, 'Renew with a new document') }}
						</AvButton>
						<AvButton variant="danger" @click="openFor('end', row.contract)">
							{{ t(APP_ID, 'End') }}
						</AvButton>
					</template>
				</div>
			</article>
			<article v-for="held in awaiting" :key="held.document.id" class="contract-card__contract" :aria-label="held.name">
				<div class="contract-card__title">
					<span class="contract-card__name">{{ held.name }}</span>
					<AvStatusPill :label="awaitingChip.label" :tone="awaitingChip.tone" />
				</div>
				<dl class="contract-card__facts">
					<div v-for="fact in held.facts" :key="fact.term" class="contract-card__fact">
						<dt>{{ fact.term }}</dt>
						<dd>{{ fact.detail }}</dd>
					</div>
				</dl>
			</article>
			<div v-if="canRegister" class="contract-card__actions">
				<AvButton variant="secondary" @click="openRegister">
					{{ t(APP_ID, 'Record contract details') }}
				</AvButton>
			</div>
		</AvCard>
		<ContractEditDialog
			:open="dialog === 'edit' || dialog === 'register'"
			:envelope="envelope"
			:contract="dialog === 'register' ? null : selectedContract"
			:documentId="editedDocumentId"
			:isPhone="isPhone"
			@close="close" />
		<ContractRenewDialog
			v-if="selectedContract !== null"
			:open="dialog === 'renew'"
			:envelope="envelope"
			:contract="selectedContract"
			@close="close" />
		<ContractEndDialog
			v-if="selectedContract !== null"
			:open="dialog === 'end'"
			:envelope="envelope"
			:contract="selectedContract"
			@close="close" />
	</template>
</template>

<style scoped>
/* `section.` outranks AvCard's own padding, as DocumentsCard does. */
section.contract-card {
	display: flex;
	flex-direction: column;
	gap: 16px;
	padding: 20px 24px;
}

.contract-card__heading {
	margin: 0;
	font-size: var(--av-text-h2);
	font-weight: 400;
}

.contract-card__contract {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding-top: 12px;
	border-top: 1px solid var(--av-hairline-soft);
}

.contract-card__title {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}

.contract-card__name {
	font-size: var(--av-text-body);
	overflow-wrap: anywhere;
}

.contract-card__facts {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 8px 24px;
	margin: 0;
}

.contract-card__fact dt {
	color: var(--av-muted);
	font-size: var(--av-text-meta);
}

.contract-card__fact dd {
	margin: 0;
	overflow-wrap: anywhere;
}

.contract-card__reason {
	margin: 0;
	color: var(--av-muted);
}

.contract-card__chain-list {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 8px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.contract-card__chain-list li + li::before {
	content: '→ ';
	color: var(--av-muted);
}

.contract-card__actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.contract-card--phone .contract-card__facts {
	grid-template-columns: minmax(0, 1fr);
}

section.contract-card--phone {
	padding: 16px;
}
</style>
```

- [ ] **Step 8: Show the card on the envelope page**

In `src/detail/DetailView.vue`:
- add `import ContractCard from './ContractCard.vue'` with the other card imports;
- change `const { isAdmin } = appConfig()` to `const { isAdmin, contractsEnabled } = appConfig()`;
- in the phone layout, add after the `DocumentsCard` element: `<ContractCard v-if="contractsEnabled" :envelope="envelope" isPhone />`;
- in the desktop layout, add after the `DocumentsCard` element inside `detail__main`: `<ContractCard v-if="contractsEnabled" :envelope="envelope" :isPhone="false" />`.

- [ ] **Step 9: Add the translations**

```bash
node scripts/add-translations.mjs <<'JSON'
{
	"In force": "Vigente",
	"Ends today": "Vence hoje",
	"Notice period ends today": "Prazo de aviso termina hoje",
	"_Ends in %n day_::_Ends in %n days_": ["A vencer em %n dia", "A vencer em %n dias"],
	"_Notice period in %n day_::_Notice period in %n days_": ["Prazo de aviso em %n dia", "Prazo de aviso em %n dias"],
	"Lapsed": "Vencido",
	"Ended": "Encerrado",
	"Renewed": "Renovado",
	"Awaiting signature": "Aguardando assinatura",
	"Term": "Vigência",
	"{start} to {end}": "{start} a {end}",
	"Until {end}": "Até {end}",
	"Renewal": "Renovação",
	"_Automatic, every %n month_::_Automatic, every %n months_": ["Automática, a cada %n mês", "Automática, a cada %n meses"],
	"Does not renew automatically": "Sem renovação automática",
	"Notice period": "Aviso prévio",
	"_%n day before the end_::_%n days before the end_": ["%n dia antes do término", "%n dias antes do término"],
	"Value": "Valor",
	"{value} per month": "{value} por mês",
	"{value} per year": "{value} por ano",
	"{value}, paid once": "{value}, pagamento único",
	"Alerts": "Alertas",
	"{days} days before": "{days} dias antes",
	"No alerts": "Sem alertas",
	"Reason for ending: {reason}": "Motivo do encerramento: {reason}",
	"Renewal history": "Histórico de renovações",
	"Renew": "Renovar",
	"Renew with a new document": "Renovar com novo documento",
	"End": "Encerrar",
	"Record contract details": "Registrar dados do contrato",
	"Choose the PDFs of the new contract": "Escolha os PDFs do novo contrato",
	"Edit contract": "Editar contrato",
	"Save contract": "Salvar contrato",
	"Contract details saved": "Dados do contrato salvos",
	"Renew contract": "Renovar contrato",
	"Current end: {date}": "Término atual: {date}",
	"New end date": "Novo término",
	"Contract renewed": "Contrato renovado",
	"Contract renewed: {from} → {to}": "Contrato renovado: {from} → {to}",
	"Renewed automatically": "Renovado automaticamente",
	"Renewed automatically: {from} → {to}": "Renovado automaticamente: {from} → {to}",
	"End contract?": "Encerrar contrato?",
	"Alerts stop and the contract reads as ended.": "Os alertas param e o contrato passa a constar como encerrado.",
	"Reason (optional)": "Motivo (opcional)",
	"End contract": "Encerrar contrato",
	"Contract ended": "Contrato encerrado",
	"Contract details recorded": "Dados do contrato registrados",
	"Contract details changed": "Dados do contrato alterados",
	"Contract expired": "Contrato vencido",
	"Contract replaced by a new document": "Contrato substituído por um novo documento"
}
JSON
```

- [ ] **Step 10: Run the tests to see them pass**

Run: `npx vitest run src/contracts src/detail src/presentation src/l10n.spec.ts`
Expected: PASS (DetailView's own spec keeps the card hidden: its configuration has no `contractsEnabled`).

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 11: Commit**

```bash
git add src/contracts src/detail src/presentation l10n
git commit -m "feat(contracts): show, edit, renew and end contracts on the envelope page"
```

---

### Task 17: API docs, version 0.7.0 and the gates

**Files:**
- Modify: `docs/api.md`, `appinfo/info.xml`
- Commit: built `js/`, `css/` (and `dist/` when the build writes it)

**Interfaces:**
- Consumes: everything above.
- Produces: app version `0.7.0`, the background job registered in the local env, every gate green.

- [ ] **Step 1: Document the API**

In `docs/api.md`, in "## Envelope detail", add to the JSON example's document object `"contractTerms": null,` after `"signedFileId": null,` and, after `"events": [...]`, the keys `"contracts": [], "canActOnContracts": false, "renewsContractId": null`. Add these bullets to "Value notes":

```markdown
- Document `contractTerms` holds the contract terms the wizard saved for that document (the shape of a contract below, without `id`, `envelopeUuid`, `documentId`, `name`, `status`, `keyDate`, `daysUntilKeyDate`, `continuesContractId`, `endReason`), or `null` when it is not a contract. They wait there ("Aguardando assinatura") until the envelope completes; only then does a contract exist.
- `contracts` lists the envelope's signed contracts, each with its `chain`; `canActOnContracts` says whether the viewer may edit, renew or end them. Both are empty/false while contract management is off. `renewsContractId` is the contract this envelope renews once everyone signs it.
```

Append to the end of `docs/api.md`:

````markdown
## Contracts

Contract management is an add-on (`contracts_enabled` app config, default off). While it is off every route below answers 403 `contracts_disabled`; contract data is kept. Contracts follow their envelope's access: who sees the envelope sees its contracts (value included), who may act on it edits, renews and ends them.

### Contract

```json
{"id": 3, "envelopeUuid": "…", "documentId": 12, "name": "Locação Sala 3", "status": "active",
 "keyDate": "2026-12-01", "daysUntilKeyDate": 55, "continuesContractId": null, "endReason": null,
 "startsOn": "2026-01-01", "endsOn": "2026-12-31", "autoRenew": true, "renewalTermMonths": 12, "noticeDays": 30,
 "valueCents": 450000, "valueFrequency": "monthly", "counterpartyName": "Imobiliária Central Ltda",
 "counterpartyDocument": "11222333000181", "type": "Locação", "alertDays": [90, 30, 7, 0], "source": "manual",
 "chain": [{"contractId": 2, "envelopeUuid": null, "name": "Contrato original", "startsOn": "2025-01-01", "endsOn": "2025-12-31", "status": "renewed", "isCurrent": false}]}
```

- Dates are `YYYY-MM-DD` calendar days of the instance (`default_timezone`, America/Sao_Paulo when unset).
- `status`: `active` (Vigente), `expired` (Vencido), `ended` (Encerrado), `renewed` (Renovado: replaced by a newer contract). "A vencer" is computed: an active contract whose key date is 0 to 90 days away.
- `keyDate` is `endsOn − noticeDays` for a contract that renews itself (its notice deadline), else `endsOn`. `daysUntilKeyDate` counts from today in the instance timezone.
- `name` is the envelope's title for the main document, else the file name without `.pdf`.
- `counterpartyDocument` is a CPF or CNPJ (numeric or alphanumeric) with valid check digits, without punctuation.
- `alertDays` are the days before the key date that alert, largest first (default `[90, 30, 7, 0]`). Alerts go to the envelope's owner, everyone with Editar on its folder and the managers, once per (contract, key date, offset), as Nextcloud notifications; Nextcloud's notification settings decide the email.
- `chain` is oldest first and empty unless the contract renews or was renewed by another; a link's `envelopeUuid` is `null` when the viewer cannot open that envelope.

**Terms in requests** take the same keys from `startsOn` to `source`. Only `endsOn` is required; `renewalTermMonths` (1–120) is required when `autoRenew`; `valueFrequency` (`once`, `monthly`, `yearly`) is required with a `valueCents` above 0; `noticeDays` 0–3650; `alertDays` up to 10 offsets of 0–3650; `source` `manual` (default) or `ai_confirmed`.

**Contract codes** (422 unless noted): `contract_invalid`, `contract_starts_on_invalid`, `contract_ends_on_invalid`, `contract_dates_invalid` (the end is not after the start), `contract_renewal_term_invalid`, `contract_notice_invalid`, `contract_value_invalid`, `contract_frequency_invalid`, `contract_counterparty_invalid`, `contract_tax_id_invalid`, `contract_type_invalid`, `contract_alert_days_invalid`, `renewal_not_later`, `end_reason_invalid`; 404 `contract_not_found`; 409 `contract_closed` (ended or renewed), `contract_changed` (changed meanwhile), `contract_exists`, `envelope_not_completed`; 403 `contracts_disabled`.

| Method | Path | Body | Returns |
|---|---|---|---|
| PUT | `/envelopes/{uuid}/contract-terms` | `{"documents": [{"documentId": int, "terms": {…}\|null}…]}` — the draft's owner, drafts only; documents left out keep their terms; nothing is saved unless every entry is valid | detail; 422 `not_a_draft`, `document_not_found` or a contract code |
| POST | `/envelopes/{uuid}/documents/{documentId}/contract` | `{"terms": {…}}` — "Registrar dados do contrato" on a completed envelope | 201 detail |
| PUT | `/contracts/{id}` | `{"terms": {…}}` — any status; a new key date counts the alerts already due as sent | detail |
| POST | `/contracts/{id}/renew` | `{"endsOn", "valueCents"?, "valueFrequency"?}` — `active` or `expired`; the end must be later; an expired contract is in force again | detail |
| POST | `/contracts/{id}/end` | `{"reason"?}` (up to 500 characters) — `active` or `expired` | detail |
| POST | `/contracts/{id}/renewal-draft` | `{"fileIds": [int…]}` — a draft owned by the caller with these PDFs, the same signers, settings and (when the caller may file into it) folder, and the next term's terms on the main document; it renews the contract once it completes | 201 detail of the new draft; draft codes for the files |
| GET | `/contract-types` | — | `{"types": [string…]}`, the types in use, alphabetically |

### Contract management switch

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/admin/contracts` | — (managers and Nextcloud admins) | `{"enabled": bool, "canChange": bool}` |
| PUT | `/admin/contracts` | `{"enabled": bool}` (Nextcloud admins only) | `{"enabled": bool, "canChange": true}` |
````

- [ ] **Step 2: Bump the version and apply it locally**

In `appinfo/info.xml`, change `<version>…</version>` to `<version>0.7.0</version>`.

Run: `tests/env/php.sh occ upgrade`
Expected: exits 0 and lists `assinaturas` updated to `0.7.0`. If it complains about stale bundled apps, disable `bruteforcesettings`, `files_downloadlimit`, `notifications` and `text`, run `occ upgrade`, run `occ maintenance:mode --off`, then `occ app:enable --force` for those four.

Run: `tests/env/php.sh occ background-job:list --class 'OCA\Assinaturas\Contract\ContractLifecycleJob'`
Expected: one row for the job.

- [ ] **Step 3: Run every gate, each on its own**

Check the image stamp first: `[ "$(cat ~/.assinaturas-test-image-id)" = "$(docker image inspect avuzconecta:latest --format '{{.Id}}')" ] && echo same` → `same` (otherwise stop and ask).

Run: `npm run typecheck` — Expected: exits 0.
Run: `npm run lint` — Expected: exits 0.
Run: `npm test` — Expected: exits 0, every file passes.
Run: `npm run build` — Expected: exits 0.
Run: `composer run lint` — Expected: exits 0.
Run: `tests/env/phpunit.sh` — Expected: `OK`.

- [ ] **Step 4: Check the white label once more**

Run: `grep -rniE "zapsign|openai|openrouter|claude|haiku" l10n/ src/ --include='*.vue' --include='*.json' --include='*.js' | grep -v '\.spec\.' || echo clean`
Expected: `clean` (the l10n spec already enforces the provider name; this also covers AI providers in the new copy).

- [ ] **Step 5: Commit**

```bash
git add docs/api.md appinfo/info.xml js css
git add dist 2>/dev/null || true
git commit -m "chore: release 0.7.0 with contract management"
```

---

## Interfaces for Plan 10

Plan 10 (AI suggestions, "Ler contratos com IA", the Contratos list) builds on these, unchanged:

**Data**
- Table `assinaturas_contracts` (entity `OCA\Assinaturas\Db\Contract`, mapper `OCA\Assinaturas\Db\ContractMapper`, `ContractMapper::TABLE`): `id, envelope_id, document_id (unique), status, starts_on, ends_on, key_date, auto_renew, renewal_term_months, notice_days, value_cents, value_frequency, counterparty_name, counterparty_document, type, alert_days (JSON), continues_contract_id, source, end_reason, created_at, updated_at`. Dates are `YYYY-MM-DD` strings, so `ORDER BY key_date` and range filters work in SQL; index `(status, key_date)`.
- The listing's read model: one row per contract; "only the current link of each chain" is `status <> 'renewed'`; owner and folder come from joining `assinaturas_envelopes` (`owner_uid`, `folder_id`, `title`) on `envelope_id`; the name from `ContractName::of($envelope, $document)` (join `assinaturas_documents` for `position` and `source_path`). An orphan contract (its envelope removed by an admin) has no envelope row: inner-join it away.
- Annual value of active contracts: `monthly × 12 + yearly`, `once` excluded — every input is a column (`value_cents`, `value_frequency`).
- `source` column (`OCA\Assinaturas\Db\ContractSource`): `manual` | `ai_confirmed`. `ContractTerms::fromInput()` already accepts `source`, and the frontend's `contractTermsFrom(form, source)` passes it, so a confirmed AI suggestion saves as `ai_confirmed` with no schema change. AI suggestions that are not confirmed yet need their own storage (a new nullable column on `assinaturas_documents`, e.g. `contract_suggestion`); the held terms column `contract_terms` keeps meaning "what the user confirmed".
- Alerts dedup table `assinaturas_contract_alerts` (`ContractAlertMapper`): not needed by the list.

**PHP**
- `enum OCA\Assinaturas\Db\ContractStatus: string { Active = 'active'; Expired = 'expired'; Ended = 'ended'; Renewed = 'renewed' }`.
- Key date: `OCA\Assinaturas\Contract\ContractCalendar::keyDate(string $endsOn, bool $autoRenew, ?int $noticeDays): string` (static) — stored in `key_date` on every write; `ContractCalendar::today(): string` (instance timezone, ITimeFactory) and `ContractCalendar::daysBetween(string $from, string $to): int` for "A vencer em N dias".
- Settings: `OCA\Assinaturas\Contract\ContractSettings::isEnabled(): bool` / `setEnabled(bool)`, key `contracts_enabled`. Add the AI flag (`ai_enabled`, manager-switchable) to this class.
- Validation: `ContractTerms::fromInput(mixed): ContractTerms` throws `ContractRejected` (`errorCode`, `httpStatus`) — reuse it to drop invalid AI fields (`TaxId::isValid`, `ContractCalendar::isDate` for single fields).
- Contract DTO: `OCA\Assinaturas\Api\ContractView::contract(Contract $contract, Envelope $envelope, Document $document, string $today): array` → `{id, envelopeUuid, documentId, name, status, keyDate, daysUntilKeyDate, continuesContractId, endReason, startsOn, endsOn, autoRenew, renewalTermMonths, noticeDays, valueCents, valueFrequency, counterpartyName, counterpartyDocument, type, alertDays, source}`. The envelope page adds `chain` (`ContractDetails`); the list does not need it.
- Access: filter rows with `AccessPolicy::canSee($envelope, $userId)` (scopes "Meus", "Compartilhados comigo", "Toda a empresa" as the dashboard does).
- Types for a filter: `ContractMapper::usedTypes(int $limit): list<string>` (route `GET /api/v1/contract-types`).

**Frontend**
- Types in `src/api/types.ts`: `Contract`, `ContractDetail`, `ContractLink`, `ContractTerms`, `ContractStatus`, `ContractSource`, `ValueFrequency`, `DocumentContractTerms`, `ContractRenewal`, `ContractsAddon`.
- API module `src/api/contracts.ts` (`saveContractTerms`, `registerContract`, `updateContract`, `renewContract`, `endContract`, `createRenewalDraft`, `getContractTypes`); add `listContracts(query)` there. Admin calls `getContractsAddon` / `setContractsAddon` in `src/api/admin.ts`.
- Query keys in `QUERY_KEYS` (`src/api/query-keys.ts`): `contractTypes()` → `['contract-types']`, `contractsAddon()` → `['contracts-addon']`; draft change `'contract'` in `DRAFT_CHANGES`. Add `allContracts()` → `['contracts']` and `contracts(query)` → `['contracts', query]` for the list, and invalidate `allContracts()` from the contract dialogs' `afterSuccess`.
- `appConfig().contractsEnabled` gates every surface (the sidebar entry included).
- Chips: `contractChip(contract)` / `awaitingSignatureChip()` / `COMING_DUE_DAYS` in `src/contracts/contract-status.ts`; money `formatMoney` in `src/contracts/money.ts`; tax ids `formatTaxId` in `src/contracts/tax-id.ts`; form rules `src/contracts/contract-form.ts`; `<ContractFields>` already takes suggestions through its `v-model` (an AI suggestion is a `ContractForm`; mark fields "Sugerido pela IA" by comparing with the form built from the suggestion).

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| Add-on switch, Nextcloud admins only, managers see it, default off | 1, 12 |
| Off hides wizard step, card, alerts; data kept and back when on | 1 (`contractsEnabled`), 6 (detail empty), 10 (job off), 15 (step hidden), 16 (card hidden) |
| Contract record fields and validation (dates, renewal term, notice, value, CNPJ/CPF check digits, type, alert days, source) | 2, 3, 13 |
| Key date; "A vencer" computed | 2 (`keyDate`), 3 (`key_date`), 16 (chip) |
| Terms held with documents until completion ("Aguardando assinatura"); never for cancelled/refused/expired | 4, 5, 16 |
| Daily job: alerts with dedup and missed-day catch-up, auto-renewal roll-forward with timeline, expiry | 7, 10 |
| Renovar / Renovar com novo documento / Encerrar / Editar (key date recomputed, no resend) | 8, 9, 16 |
| Renewal chain, old → renewed only when the new envelope completes | 5, 6, 9, 16 |
| Alert recipients (owner, folder editors, managers, once each), notification + email, pt_BR copy | 7 |
| Wizard "Contrato" step after Documentos, annexes "segue o principal", skippable | 15 |
| Envelope page card: fields, chip, chain, actions, "Registrar dados do contrato" | 16 |
| Access via canSee / canAct | 4, 6, 8, 9 |
| White label | 7, 11–16 (l10n spec), 17 |
| AI, Contratos screen | Plan 10 |
