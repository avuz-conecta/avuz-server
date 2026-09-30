# Assinaturas Plan 2b: Actions and Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A sender can act on a sent envelope from the JSON API: cancel it, discard or reopen a failed one, extend its deadline, remind a signer, correct an email or copy a signing link. The sender can also download the signed file, the original as sent, and ZapSign's activity report. Bounced emails are detected, senders get Nextcloud notifications, and admins get a read-only status API with usage and health.

**Architecture:** Plan 2b builds on Plan 2a (app repo `~/work/avuz/assinaturas`, `main` at `1d00fc9`, 397 tests). New units:
- `lib/Action/`: one small service per action, plus `ActionRejected`.
- `lib/Download/`: download services.
- `lib/Notification/`: notifier and the listener.
- `lib/Ops/`: counters, provider health and usage.
- Two thin controllers: `EnvelopeActionController` and `AdminController`.

Cross-cutting pieces:
- Every state change stays a guarded `transitionStatus`.
- Every timeline entry goes through `EnvelopeEvents`, which now dispatches a typed `EnvelopeEventRecorded` event. Notifications hang off that event, so each one fires exactly once, because events are deduplicated.
- Reminders run inside the synchronizer's pending path.

**Tech Stack:** PHP 8.3, Nextcloud 33 OCP, all confirmed present in the `avuzconecta:latest` image:
- `OCP\Notification\{IManager, INotifier, INotification, UnknownNotificationException}`;
- `IRegistrationContext::registerNotifierService` / `registerEventListener`;
- `OCP\EventDispatcher\{IEventDispatcher, Event, IEventListener}`;
- `DataDownloadResponse`, `ICacheFactory::createDistributed`, `IGroupManager`.

Tests run on PHPUnit 9.6 in the Plan 1 Docker harness.

**Spec:** [`../specs/2026-09-28-assinaturas-zapsign-design.md`](../specs/2026-09-28-assinaturas-zapsign-design.md) §6 "Other actions", §7 "Detail view / Notifications / Admin panel", §10 · **Roadmap:** [`2026-09-28-assinaturas-roadmap.md`](2026-09-28-assinaturas-roadmap.md) · **Sandbox truth:** [`../../zapsign/sandbox-findings.md`](../../zapsign/sandbox-findings.md) · **Plan 2a:** [`2026-09-29-assinaturas-plan-2a-core-lifecycle.md`](2026-09-29-assinaturas-plan-2a-core-lifecycle.md)

**Decisions taken for this plan (Patrick, 2026-09-30):**
- The "Relatório de atividades" download comes back into v1. The activity-log API works once the ZapSign plan is active.
- Bounce detection starts with a sandbox spike (Task 1).
- Operational counters live in the admin status API, stored in app config.

**Out of scope:** frontend, pt_BR UI strings beyond notifications, and email templates (Plan 3). Platform integration and staging (Plan 4). The list-endpoint polling optimization.

## Global Constraints

Everything in Plan 1's and Plan 2a's Global Constraints still applies:
- strict types, `final` classes unless a test double must extend them, readonly DTOs;
- no abbreviations, early returns, hash-lists instead of `switch`, SNAKE_CAPS constants;
- never send `null` to ZapSign; never auto-retry non-idempotent calls;
- never log the API token, signer tokens, `sign_url`, signed-file URLs or ZapSign error messages;
- tests describe behavior with third-person verb names;
- commits carry **no** Claude/AI attribution;
- the sandbox token lives only in the local test Nextcloud and is never printed.

Additional constraints for Plan 2b:

**JSON API**
- Every action lives under `/apps/assinaturas/api/v1/envelopes/{uuid}/…`. Admin routes live under `/apps/assinaturas/api/v1/admin/…`.
- Errors keep the shape `{"error": "<code>", "message": "<English text>"}`. An action refused for the envelope's current state is **409**. Invalid input is **422**. A ZapSign failure during an action is **502**, with the provider code (`provider_unreachable`, `provider_busy`, …). A reminder cooldown is **429**, and the body adds `"retryAfterSeconds": <int>`.
- Access:

  | Who | May do |
  |---|---|
  | The owner, while allowed to use the app (`AccessPolicy::canEdit`) | Cancel, discard, reopen, extend the deadline, remind, correct an email, copy a link |
  | Anyone who can read the envelope (`canRead`: the owner, or an admin) | Download |
  | Admins only (`canSeeAll`) | Delete a sent envelope; read the admin status |

- **Sign links:** `POST …/signers/{signerId}/link` is the ONLY route that returns a `sign_url`. It is for the owner only. Every call is recorded as a `link_copied` event, and the URL is never stored or logged.
- Every other route still never returns signer tokens, `sign_url`, ZapSign document tokens or the API token.

**Events** (the timeline; `EnvelopeEvents::record` is the only writer)
- Existing types: `viewed`, `signed`, `refused`, `cancelled`, `expired`, `completed`.
- New types:
  - `cancel_requested`, `discarded`, `reopened`, `deadline_extended`;
  - `reminder_sent`, `email_corrected`, `link_copied`;
  - `email_bounced`, `send_failed`, `save_failed`.
- User-initiated events carry `actorUid`.
- `detail` holds only our own values: a sender-typed reason, a deadline epoch, or an error code. It never holds emails, tokens, URLs or provider text.

**Notifications** (Nextcloud notifications to the envelope owner, app `assinaturas`, object `envelope`/`<uuid>`)
- Subjects: `completed`, `refused`, `expired`, `send_failed`, `email_bounced`, `save_failed`.
- The admin-only subject is `provider_health`. It goes to every admin, once per state change.
- English source strings, with a pt_BR translation in `l10n/pt_BR.json` and `l10n/pt_BR.js`.

**Reminders**
- ZapSign enforces a cooldown of one resend per signer per **30 minutes**. It answers HTTP 429 with the code `cooldown_period`.
- A signer is *remindable* when all of these hold:
  - the envelope is `pending`;
  - the signer is `pending` or `viewed`;
  - the signer has a ZapSign token;
  - the signer has no `email_bounced_at`;
  - either signing order is off, or the signer's `order_group` is the lowest group among signers not yet signed or refused.
- Automatic reminders run every `reminder_days` days. Each is anchored on `last_reminder_at`, else `released_at`, else when the previous group finished signing, else `sent_at`.

**Admin status**
- Provider health is one of `ok`, `plan_required` (402), `access_denied` (403), `unreachable` or `not_configured`.
- The check is `listDocumentsWithSigners(1)`, cached 10 minutes, plus `getPlanInfo()` on a best-effort basis.
- An hourly `ProviderHealthJob` refreshes it, and notifies admins when the state changes.

**Harness and live calls**
- Run `tests/env/reset.sh` after any change to `info.xml`, `l10n/` or a migration. Plan 2b adds **no migration**; every column it writes already exists.
- Live calls go only to the ZapSign **sandbox**, in Tasks 1 and 12, which run inline with Patrick.

---

## File Structure

```
lib/
├── Access/EnvelopeAccess.php            load an envelope by uuid for the current user (read/edit/admin)
├── Action/
│   ├── ActionRejected.php               errorCode + message + HTTP status (+ retryAfterSeconds)
│   ├── ProviderFailures.php             ZapSignException → our provider_* code (shared with Send)
│   ├── EnvelopeCancellation.php         cancel (pending/expired), discard (failed), reopen (failed → draft)
│   ├── EnvelopeDeadline.php             extend the deadline (pending/expired)
│   ├── SignerReminders.php              remindable rule, manual remind, automatic sendDue()
│   ├── SignerCorrections.php            correct a signer's email, re-invite
│   ├── SignerLinks.php                  fetch a signer's sign URL for the owner (audited)
│   └── EnvelopeRemoval.php              admin delete of a sent envelope
├── Download/
│   ├── DownloadedPdf.php                filename + bytes
│   └── EnvelopeDownloads.php            signed file, original as sent, activity report
├── Draft/DeadlineCalculator.php         end-of-day epoch for a YYYY-MM-DD date (extracted from EnvelopeDrafts)
├── Notification/
│   ├── Notifier.php                     INotifier: renders our subjects in the user's language
│   └── SenderNotificationListener.php   EnvelopeEventRecorded → notification to the owner
├── Ops/
│   ├── Counters.php                     persistent operational counters (app config)
│   ├── ProviderHealth.php               cached token/plan check + admin notification on state change
│   ├── ProviderHealthJob.php            hourly refresh
│   └── UsageReport.php                  envelopes this month, stale syncs
├── Sync/EnvelopeEventRecorded.php       typed event dispatched by EnvelopeEvents
├── Webhook/BounceRecorder.php           email_bounce webhook → signer email_bounced_at + event
└── Controller/
    ├── EnvelopeActionController.php     action + download routes
    └── AdminController.php              admin status, counters reset, admin delete
l10n/pt_BR.json, l10n/pt_BR.js           notification strings
tests/e2e/lifecycle.php                  spike + action commands for Tasks 1 and 12
```

Modified:
- `Controller/EnvelopeController` uses `EnvelopeAccess`.
- `Send/EnvelopeSender` uses `ProviderFailures`, and records `send_failed`.
- `Draft/EnvelopeDrafts` uses `DeadlineCalculator`.
- `Sync/EnvelopeEvents` takes an actor and dispatches.
- `Sync/EnvelopeSynchronizer` runs reminders.
- `Sync/EnvelopeCompletion` records `save_failed`.
- `Webhook/WebhookController` and `WebhookInbox` route bounces.
- `Webhook/WebhookRegistrar` exposes `registeredTypes()`.
- `ZapSign/CallMonitor` counts 429s.
- `Api/EnvelopeView` exposes new fields.
- `Db/EnvelopeMapper` gains usage queries.
- `AppInfo/Application` registers the notifier and the listener.
- `appinfo/info.xml` is bumped to 0.3.0 with the health job.
- `docs/api.md` is updated.

---

### Task 1: Sandbox spike — bounce payload, email update, resend cooldown, original-file host (inline with Patrick)

The controller runs this task in-session with Patrick, as with Plan 1 Task 9 and Plan 2a Task 15. No subagent. It settles the facts that Tasks 6, 7 and 9 depend on.

**Files:**
- Modify: `tests/e2e/lifecycle.php` (spike commands)
- Create: `tests/fixtures/zapsign/recorded-email-bounce.json` (scrubbed)
- Modify (avuz-server repo): `docs/zapsign/sandbox-findings.md` (new "Plan 2b spike" section)

**Questions:**

| # | Question | Decides |
|---|---|---|
| S1 | What does the `email_bounce` webhook actually send? Is `token` the signer token? Does our custom header arrive? | Task 7 |
| S2 | Does `POST /signers/{token}/ {email}` (`updateSignerEmail`) email the new address by itself? | Task 6: `RELEASE_AFTER_EMAIL_UPDATE` |
| S3 | A second `releaseSigner` more than a few seconds after the first: is it a 429 `cooldown_period`, with which `retry-after`? And after 30 minutes? | Task 5 |
| S4 | Which host serves `original_file` (main and extra)? | Task 9 allowlist |
| S5 | Does `getActivityLog` return a non-empty PDF for a sent envelope? | Task 9 |
| S6 | Does `cancelDocument(…, notify_signer: true)` email the signers? | Task 3 copy |

- [ ] **Step 1: Add the spike commands to the driver**

Add these commands to `tests/e2e/lifecycle.php`, following the driver's existing helpers (`requireArguments`, `printJson`, the command map). Signers are addressed by **1-based index** in `SignerMapper::findByEnvelope` order. Nothing prints a token or URL.

```php
/** @param list<string> $arguments */
function signerAt(string $uuid, string $index): \OCA\Assinaturas\Db\Signer {
	$envelope = Server::get(EnvelopeMapper::class)->findByUuid($uuid);
	$signers = Server::get(SignerMapper::class)->findByEnvelope($envelope->getId());
	$signer = $signers[(int)$index - 1] ?? null;
	if ($signer === null || $signer->getZapsignToken() === null) {
		fwrite(STDERR, 'No sent signer at index ' . $index . PHP_EOL);
		exit(1);
	}
	return $signer;
}

/** @param list<string> $arguments */
function rawUpdateEmail(array $arguments): void {
	[$uuid, $index, $email] = requireArguments($arguments, 3, 'raw-update-email <uuid> <signerIndex> <email>');
	Server::get(ZapSignClient::class)->updateSignerEmail((string)signerAt($uuid, $index)->getZapsignToken(), $email);
	printJson(['updated' => true, 'at' => gmdate('c')]);
}

/** @param list<string> $arguments */
function rawRelease(array $arguments): void {
	[$uuid, $index] = requireArguments($arguments, 2, 'raw-release <uuid> <signerIndex>');
	try {
		Server::get(ZapSignClient::class)->releaseSigner((string)signerAt($uuid, $index)->getZapsignToken(), 'Lembrete do spike 2b.');
		printJson(['released' => true, 'at' => gmdate('c')]);
	} catch (\OCA\Assinaturas\ZapSign\Exception\ZapSignRateLimited $limited) {
		printJson(['released' => false, 'rateLimited' => true, 'isCooldown' => $limited->isCooldown, 'retryAfterSeconds' => $limited->retryAfterSeconds, 'code' => $limited->providerCode, 'at' => gmdate('c')]);
	}
}

/** @param list<string> $arguments */
function rawCancel(array $arguments): void {
	[$uuid] = requireArguments($arguments, 1, 'raw-cancel <uuid>');
	$envelope = Server::get(EnvelopeMapper::class)->findByUuid($uuid);
	Server::get(ZapSignClient::class)->cancelDocument((string)$envelope->getZapsignToken(), 'Cancelado pelo spike 2b', true);
	printJson(['cancelled' => true, 'at' => gmdate('c')]);
}

/** @param list<string> $arguments */
function activityReport(array $arguments): void {
	[$uuid] = requireArguments($arguments, 1, 'activity <uuid>');
	$envelope = Server::get(EnvelopeMapper::class)->findByUuid($uuid);
	$report = Server::get(ZapSignClient::class)->getActivityLog((string)$envelope->getZapsignToken());
	printJson(['contentType' => $report->contentType, 'bytes' => strlen($report->bytes), 'startsLikePdf' => str_starts_with($report->bytes, '%PDF-')]);
}
```

Register them as `raw-update-email`, `raw-release`, `raw-cancel` and `activity`. Extend the existing `provider` command's output with:
- `originalFileHost`: `parse_url($document->originalFileUrl ?? '', PHP_URL_HOST)`;
- `extraDocumentOriginalFileHosts`: the same, for each extra document.

Update the usage string. Lint with `tests/env/php.sh -l apps/assinaturas/tests/e2e/lifecycle.php`, then commit: `test: add Plan 2b spike commands to the sandbox driver`.

- [ ] **Step 2: Capture webhooks (Patrick OKs the temporary tunnel)**

Start the Plan 1 capture server and tunnel, as in `tests/spike/README.md` step 3 (`FAIL_FIRST=0`). Then register `email_bounce` and `all` against the tunnel URL with the Plan 1 spike runner (`tests/spike/run.php webhook-register <url> email_bounce` and `… all`). Note both webhook ids.

- [ ] **Step 3: Run the spike**

1. `setup assinaturas-bounce@simulator.amazonses.com patrick.dm.rezende@gmail.com`, then `send <uuid>`.
   - Wait up to 10 minutes for an `email_bounce` line in `tests/spike/output/webhooks.jsonl`.
   - If none arrives, repeat with a mailbox that does not exist on Patrick's domain (`assinaturas-bounce-<random>@avuz.cloud`).
   - Record the payload keys and the `X-Assinaturas-Spike` header (**S1**).
2. `raw-update-email <uuid> 1 patrick@avuz.cloud`. Patrick reports whether an invitation arrived **without** a release (**S2**). Then `raw-release <uuid> 1`: an invitation should arrive.
3. Run `raw-release <uuid> 1` again right away, then again after 2 minutes. Record the result (**S3**). Optionally repeat after 31 minutes.
4. `provider <uuid>` gives the original-file hosts (**S4**). `activity <uuid>` should show a PDF with more than 0 bytes (**S5**).
5. `raw-cancel <uuid>`. Patrick reports whether either inbox got a cancellation email (**S6**).

- [ ] **Step 4: Record and clean up**

- Save the bounce body as `tests/fixtures/zapsign/recorded-email-bounce.json`, scrubbed:
  - email → `ana@example.com`;
  - token → `11111111-2222-3333-4444-555555555555`;
  - keep every key and its type;
  - drop IPs.
- Write S1–S6 into `docs/zapsign/sandbox-findings.md` under "Plan 2b spike (2026-09-30)".
- If S2 shows that the email update invites by itself, set `SignerCorrections::RELEASE_AFTER_EMAIL_UPDATE = false` when implementing Task 6. Otherwise leave it `true`.
- If S4 shows a host other than `zapsign.s3.amazonaws.com`, add it to `SignedFileDownloader`'s allowlist in Task 9, and name the task-level constraint accordingly.
- Delete both spike webhooks (`webhook-delete <id>`) and remove the capture and tunnel containers.
- Commit the fixture: `test: record the ZapSign email_bounce webhook payload`. Commit the findings in avuz-server: `docs: record the Plan 2b sandbox spike`.

---

### Task 2: Foundation — envelope access, action rejections, provider failure codes, event dispatch

**Files:**
- Create:
  - `lib/Access/EnvelopeAccess.php`
  - `lib/Action/ActionRejected.php`
  - `lib/Action/ProviderFailures.php`
  - `lib/Sync/EnvelopeEventRecorded.php`
- Modify:
  - `lib/Sync/EnvelopeEvents.php`
  - `lib/Send/EnvelopeSender.php` (use `ProviderFailures`)
  - `lib/Controller/EnvelopeController.php` (use `EnvelopeAccess`)
  - every `new EnvelopeEvents(` call in `tests/` (new constructor argument)
- Test:
  - `tests/Integration/Access/EnvelopeAccessTest.php`
  - `tests/Unit/Action/ProviderFailuresTest.php`
  - `tests/Integration/Sync/EnvelopeEventsTest.php`

**Interfaces:**
- Consumes: `AccessPolicy`, `EnvelopeMapper`, `EventMapper::insertIfNew`, and the ZapSign exception classes.
- Produces:
  - `EnvelopeAccess`:
    - `currentUserId(): string`
    - `readable(string $uuid): ?Envelope`: null when the envelope is unknown or unreadable.
    - `mayEdit(Envelope $envelope): bool`
    - `mayAdminister(): bool`
  - `ActionRejected(string $errorCode, string $message, int $httpStatus = 409, ?int $retryAfterSeconds = null)`, with public readonly `errorCode`, `httpStatus` and `retryAfterSeconds`.
    - `ActionRejected::provider(ZapSignException $failure): self` gives a 502 carrying `ProviderFailures::codeFor($failure)`, or a 429 `reminder_cooldown` for a cooldown.
  - `ProviderFailures::codeFor(ZapSignException $failure): string`. This is the same map as Plan 2a's `EnvelopeSender::PROVIDER_FAILURE_CODES`, which it replaces.
  - `EnvelopeEvents::record(int $envelopeId, ?int $signerId, string $type, string $moment, int $occurredAt, array $detail = [], ?string $actorUid = null): bool`. It returns `true` when the event is new, and in that case dispatches `EnvelopeEventRecorded`.
  - `EnvelopeEventRecorded(int $envelopeId, ?int $signerId, string $type, array $detail)`: public readonly props, extends `OCP\EventDispatcher\Event`.

- [ ] **Step 1: Write the failing tests**

`tests/Unit/Action/ProviderFailuresTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\Action;

use OCA\Assinaturas\Action\ActionRejected;
use OCA\Assinaturas\Action\ProviderFailures;
use OCA\Assinaturas\ZapSign\Exception\ZapSignAccessDenied;
use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use OCA\Assinaturas\ZapSign\Exception\ZapSignNotFound;
use OCA\Assinaturas\ZapSign\Exception\ZapSignPlanRequired;
use OCA\Assinaturas\ZapSign\Exception\ZapSignRateLimited;
use OCA\Assinaturas\ZapSign\Exception\ZapSignRejectedRequest;
use OCA\Assinaturas\ZapSign\Exception\ZapSignServerError;
use OCA\Assinaturas\ZapSign\Exception\ZapSignUnreachable;
use PHPUnit\Framework\TestCase;

final class ProviderFailuresTest extends TestCase {
	/** @dataProvider failures */
	public function testMapsEachProviderFailureToOurCode(ZapSignException $failure, string $expectedCode): void {
		$this->assertSame($expectedCode, ProviderFailures::codeFor($failure));
	}

	/** @return array<string, array{ZapSignException, string}> */
	public static function failures(): array {
		return [
			'unreachable' => [new ZapSignUnreachable('x'), 'provider_unreachable'],
			'rate limited' => [new ZapSignRateLimited('x', 30, false), 'provider_busy'],
			'plan required' => [new ZapSignPlanRequired('x'), 'provider_plan_required'],
			'access denied' => [new ZapSignAccessDenied('x'), 'provider_access_denied'],
			'not found' => [new ZapSignNotFound('x'), 'provider_not_found'],
			'rejected' => [new ZapSignRejectedRequest('x'), 'provider_rejected'],
			'server error' => [new ZapSignServerError('x'), 'provider_error'],
		];
	}

	public function testTurnsAProviderFailureIntoABadGatewayRejection(): void {
		$rejection = ActionRejected::provider(new ZapSignUnreachable('x'));

		$this->assertSame('provider_unreachable', $rejection->errorCode);
		$this->assertSame(502, $rejection->httpStatus);
		$this->assertNull($rejection->retryAfterSeconds);
	}

	public function testTurnsACooldownIntoATooManyRequestsRejectionWithItsWait(): void {
		$rejection = ActionRejected::provider(new ZapSignRateLimited('x', 1200, true, 'cooldown_period'));

		$this->assertSame('reminder_cooldown', $rejection->errorCode);
		$this->assertSame(429, $rejection->httpStatus);
		$this->assertSame(1200, $rejection->retryAfterSeconds);
	}

	public function testNeverCarriesTheProviderMessage(): void {
		$rejection = ActionRejected::provider(new ZapSignRejectedRequest('signer ana@example.com is invalid'));

		$this->assertStringNotContainsString('ana@example.com', $rejection->getMessage());
	}
}
```

`tests/Integration/Sync/EnvelopeEventsTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Sync;

use OCA\Assinaturas\Db\Event;
use OCA\Assinaturas\Db\EventMapper;
use OCA\Assinaturas\Sync\EnvelopeEventRecorded;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\IDBConnection;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class EnvelopeEventsTest extends TestCase {
	private const ENVELOPE_ID = 987654321;

	/** @var list<EnvelopeEventRecorded> */
	private array $dispatched = [];

	protected function tearDown(): void {
		$query = Server::get(IDBConnection::class)->getQueryBuilder();
		$query->delete('assinaturas_events')->where($query->expr()->eq('envelope_id', $query->createNamedParameter(self::ENVELOPE_ID)))->executeStatement();
		parent::tearDown();
	}

	public function testDispatchesANewEventOnceWithItsActor(): void {
		$first = $this->events()->record(self::ENVELOPE_ID, null, 'cancel_requested', '', 1_790_000_000, ['reason' => 'Valores errados'], 'maria');
		$replay = $this->events()->record(self::ENVELOPE_ID, null, 'cancel_requested', '', 1_790_000_000, ['reason' => 'Valores errados'], 'maria');

		$this->assertTrue($first);
		$this->assertFalse($replay);
		$this->assertCount(1, $this->dispatched);
		$this->assertSame('cancel_requested', $this->dispatched[0]->type);
		$this->assertSame(self::ENVELOPE_ID, $this->dispatched[0]->envelopeId);
		$this->assertSame(['reason' => 'Valores errados'], $this->dispatched[0]->detail);
		$stored = Server::get(EventMapper::class)->findByEnvelope(self::ENVELOPE_ID);
		$this->assertSame(['maria'], array_map(fn (Event $event): ?string => $event->getActorUid(), $stored));
	}

	private function events(): EnvelopeEvents {
		$dispatcher = $this->createMock(IEventDispatcher::class);
		$dispatcher->method('dispatchTyped')->willReturnCallback(function (EnvelopeEventRecorded $event): void {
			$this->dispatched[] = $event;
		});
		return new EnvelopeEvents(Server::get(EventMapper::class), $dispatcher);
	}
}
```

`tests/Integration/Access/EnvelopeAccessTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Access;

use OCA\Assinaturas\Access\EnvelopeAccess;
use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\IGroupManager;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class EnvelopeAccessTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;

	private string $owner;
	private string $stranger;
	private string $uuid;

	protected function setUp(): void {
		parent::setUp();
		$this->owner = $this->createUser();
		$this->addToGroup($this->owner, SignersGroup::GROUP_ID);
		$this->stranger = $this->createUser();
		$this->addToGroup($this->stranger, SignersGroup::GROUP_ID);
		$file = $this->writeFile($this->owner, 'Contrato.pdf', self::minimalPdf());
		$this->uuid = Server::get(EnvelopeDrafts::class)->create($this->owner, 'Contrato', [$file->getId()])->getUuid();
	}

	protected function tearDown(): void {
		self::logout();
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testLetsTheOwnerReadAndEdit(): void {
		self::loginAsUser($this->owner);

		$envelope = $this->access()->readable($this->uuid);

		$this->assertNotNull($envelope);
		$this->assertTrue($this->access()->mayEdit($envelope));
		$this->assertFalse($this->access()->mayAdminister());
	}

	public function testHidesTheEnvelopeFromAnotherMember(): void {
		self::loginAsUser($this->stranger);

		$this->assertNull($this->access()->readable($this->uuid));
		$this->assertNull($this->access()->readable('00000000-0000-4000-8000-000000000000'));
	}

	public function testLetsAnAdminReadAndAdministerButNotEdit(): void {
		Server::get(IGroupManager::class)->get('admin')->addUser(Server::get(\OCP\IUserManager::class)->get($this->stranger));
		self::loginAsUser($this->stranger);

		$envelope = $this->access()->readable($this->uuid);

		$this->assertNotNull($envelope);
		$this->assertFalse($this->access()->mayEdit($envelope));
		$this->assertTrue($this->access()->mayAdminister());
	}

	private function access(): EnvelopeAccess {
		return Server::get(EnvelopeAccess::class);
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter 'ProviderFailuresTest|EnvelopeEventsTest|EnvelopeAccessTest'`
Expected: ERRORs of the form `Class "OCA\Assinaturas\Action\ProviderFailures" not found`, and `EnvelopeEvents::__construct()` argument count errors.

- [ ] **Step 3: Implement**

`lib/Action/ProviderFailures.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Action;

use OCA\Assinaturas\ZapSign\Exception\ZapSignAccessDenied;
use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use OCA\Assinaturas\ZapSign\Exception\ZapSignNotFound;
use OCA\Assinaturas\ZapSign\Exception\ZapSignPlanRequired;
use OCA\Assinaturas\ZapSign\Exception\ZapSignRateLimited;
use OCA\Assinaturas\ZapSign\Exception\ZapSignRejectedRequest;
use OCA\Assinaturas\ZapSign\Exception\ZapSignServerError;
use OCA\Assinaturas\ZapSign\Exception\ZapSignUnreachable;

/** Our own codes for ZapSign failures. Provider messages never leave this boundary: they can carry signer PII. */
final class ProviderFailures {
	private const CODES = [
		ZapSignUnreachable::class => 'provider_unreachable',
		ZapSignRateLimited::class => 'provider_busy',
		ZapSignPlanRequired::class => 'provider_plan_required',
		ZapSignAccessDenied::class => 'provider_access_denied',
		ZapSignNotFound::class => 'provider_not_found',
		ZapSignRejectedRequest::class => 'provider_rejected',
		ZapSignServerError::class => 'provider_error',
	];
	private const FALLBACK_CODE = 'provider_error';

	public static function codeFor(ZapSignException $failure): string {
		return self::CODES[$failure::class] ?? self::FALLBACK_CODE;
	}
}
```

`lib/Action/ActionRejected.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Action;

use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use OCA\Assinaturas\ZapSign\Exception\ZapSignRateLimited;
use OCP\AppFramework\Http;

/** An action the envelope's state, the input or ZapSign refused. Carries only our own code and text. */
final class ActionRejected extends \RuntimeException {
	public function __construct(
		public readonly string $errorCode,
		string $message,
		public readonly int $httpStatus = Http::STATUS_CONFLICT,
		public readonly ?int $retryAfterSeconds = null,
	) {
		parent::__construct($message);
	}

	public static function provider(ZapSignException $failure): self {
		if ($failure instanceof ZapSignRateLimited && $failure->isCooldown) {
			return new self('reminder_cooldown', 'ZapSign allows one message per signer every 30 minutes', Http::STATUS_TOO_MANY_REQUESTS, $failure->retryAfterSeconds);
		}
		return new self(ProviderFailures::codeFor($failure), 'ZapSign could not complete the action', Http::STATUS_BAD_GATEWAY);
	}
}
```

`lib/Sync/EnvelopeEventRecorded.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Sync;

use OCP\EventDispatcher\Event;

/** A new entry landed on an envelope's timeline. Replays never dispatch. */
final class EnvelopeEventRecorded extends Event {
	/** @param array<string, scalar> $detail */
	public function __construct(
		public readonly int $envelopeId,
		public readonly ?int $signerId,
		public readonly string $type,
		public readonly array $detail,
	) {
		parent::__construct();
	}
}
```

Replace `lib/Sync/EnvelopeEvents.php` with:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Sync;

use OCA\Assinaturas\Db\Event;
use OCA\Assinaturas\Db\EventMapper;
use OCP\EventDispatcher\IEventDispatcher;

/**
 * The envelope timeline. Events come from state changes we observed on a re-fetch or from a
 * user action, never from webhook payloads. A replay of the same change is a no-op and is not
 * dispatched again, so listeners (notifications) run exactly once per event.
 */
final class EnvelopeEvents {
	private const NO_SIGNER = '-';

	public function __construct(
		private EventMapper $eventMapper,
		private IEventDispatcher $dispatcher,
	) {
	}

	/** @param array<string, scalar> $detail */
	public function record(int $envelopeId, ?int $signerId, string $type, string $moment, int $occurredAt, array $detail = [], ?string $actorUid = null): bool {
		$event = new Event();
		$event->setEnvelopeId($envelopeId);
		$event->setSignerId($signerId);
		$event->setType($type);
		$event->setDedupeKey(implode(':', [$envelopeId, $signerId ?? self::NO_SIGNER, $type, $moment]));
		$event->setOccurredAt($occurredAt);
		$event->setActorUid($actorUid);
		$event->setDetail($detail === [] ? null : $detail);
		if (!$this->eventMapper->insertIfNew($event)) {
			return false;
		}
		$this->dispatcher->dispatchTyped(new EnvelopeEventRecorded($envelopeId, $signerId, $type, $detail));
		return true;
	}
}
```

Update every test that builds `new EnvelopeEvents(Server::get(EventMapper::class))` to pass `Server::get(IEventDispatcher::class)` as the second argument (`grep -rn "new EnvelopeEvents(" tests/`).

`lib/Access/EnvelopeAccess.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Access;

use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\IUserSession;

/** Loads envelopes for the signed-in user. Unreadable and unknown envelopes look the same (null), so existence never leaks. */
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

	public function readable(string $uuid): ?Envelope {
		try {
			$envelope = $this->envelopeMapper->findByUuid($uuid);
		} catch (DoesNotExistException) {
			return null;
		}
		return $this->accessPolicy->canRead($envelope, $this->currentUserId()) ? $envelope : null;
	}

	public function mayEdit(Envelope $envelope): bool {
		return $this->accessPolicy->canEdit($envelope, $this->currentUserId());
	}

	public function mayAdminister(): bool {
		return $this->accessPolicy->canSeeAll($this->currentUserId());
	}
}
```

`lib/Controller/EnvelopeController.php`:
- Replace the constructor parameters `IUserSession $userSession` and `EnvelopeMapper $envelopeMapper` with `private EnvelopeAccess $access`. Keep `AccessPolicy` for `canUseApp`/`canSeeAll`, and keep `EnvelopeMapper` if `detail()` still needs `findById`.
- Delete the private `readableEnvelope()` and `currentUserId()` helpers, and call `$this->access->readable($uuid)` and `$this->access->currentUserId()` instead.
- In `editing()`, replace the `canEdit` call with `$this->access->mayEdit($envelope)`.

Behaviour is unchanged, and `EnvelopeControllerTest` must stay green untouched.

In `lib/Send/EnvelopeSender.php`, delete `PROVIDER_FAILURE_CODES` and its fallback constant. Replace the lookup in `send()` with `ProviderFailures::codeFor($failure)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'ProviderFailuresTest|EnvelopeEventsTest|EnvelopeAccessTest|EnvelopeControllerTest|EnvelopeSenderTest'`, then `tests/env/phpunit.sh`.
Expected: `OK`, and the full suite green (397 + 13).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: share envelope access, provider failure codes and dispatch timeline events"
```

---

### Task 3: Cancel, discard and reopen — plus the action controller

**Files:**
- Create:
  - `lib/Api/EnvelopeDetails.php`
  - `lib/Action/EnvelopeCancellation.php`
  - `lib/Controller/EnvelopeActionController.php`
  - `tests/Integration/SentEnvelopes.php` (test trait)
- Modify:
  - `lib/Controller/EnvelopeController.php`: use `EnvelopeDetails`.
  - `lib/Api/EnvelopeView.php`: add `cancelRequestedAt` and `cancelReason` to the detail.
  - `docs/api.md`
- Test:
  - `tests/Integration/Action/EnvelopeCancellationTest.php`
  - `tests/Integration/Controller/EnvelopeActionControllerTest.php`

**Interfaces:**
- Consumes (Task 2): `EnvelopeAccess`, `ActionRejected`, `EnvelopeEvents::record(..., $actorUid)`.
- Consumes (Plan 2a):
  - `EnvelopeMapper::transitionStatus(..., $heldLease = null, $columns = [])` and `scheduleSyncNoLaterThan`;
  - `ZapSignClient::cancelDocument` and `findDocumentsByFolder`;
  - `EnvelopeCreation::FOLDER_ROOT`.
- Produces:
  - `EnvelopeDetails`: `detail(Envelope $envelope): array` (re-reads the envelope) and `summary(Envelope $envelope): array`. This logic moves out of `EnvelopeController`.
  - `EnvelopeCancellation`:
    - `cancel(Envelope $envelope, string $reason, string $actorUid): bool`. Returns `true` when ZapSign confirmed and the envelope is `cancelled`, and `false` when the outcome is unknown: the cancel is recorded and a sync is scheduled.
    - `discard(Envelope $envelope, string $actorUid): void`
    - `reopen(Envelope $envelope, string $actorUid): void`
  - Routes:

    | Route | Body | Success |
    |---|---|---|
    | `POST /api/v1/envelopes/{uuid}/cancel` | `{reason}` | 200, or 202 when the outcome is unknown, with the detail |
    | `POST /api/v1/envelopes/{uuid}/discard` | — | 200 detail |
    | `POST /api/v1/envelopes/{uuid}/reopen` | — | 200 detail |

  - Error codes:

    | Code | Status |
    |---|---|
    | `cancel_reason_invalid` | 422 |
    | `not_cancellable` | 409 |
    | `not_discardable` | 409 |
    | `not_reopenable` | 409 |
    | `provider_*` | 502 |

  - `SentEnvelopes` test trait:
    - `sentEnvelope(string $ownerUid, EnvelopeStatus $status = EnvelopeStatus::Pending, bool $signingOrder = true): Envelope` builds a real draft, then writes the Send's results directly:
      - main document token `doc-<uuid>`;
      - signer tokens `signer-<n>-<uuid>`;
      - `sendStep` 4, `sentAt` = `$this->now - 3600`;
      - `releasedAt` for group 1;
      - the fingerprint from `$this->zapSignSettings()`.
    - The signers are `Ana Lima <ana@example.com>` in group 1 and `Bruno Souza <bruno@example.com>` in group 2.
    - Also `signersOf(Envelope $envelope): list<Signer>` and `reloaded(Envelope $envelope): Envelope`.

- [ ] **Step 1: Write the test trait and the failing tests**

`tests/Integration/SentEnvelopes.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration;

use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\SendStep;
use OCA\Assinaturas\Db\Signer;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCP\Server;

/**
 * Envelopes as a finished Send leaves them, without calling ZapSign. Needs TestUsers and ZapSignDoubles.
 */
trait SentEnvelopes {
	private function sentEnvelope(string $ownerUid, EnvelopeStatus $status = EnvelopeStatus::Pending, bool $signingOrder = true): Envelope {
		$drafts = Server::get(EnvelopeDrafts::class);
		$file = $this->writeFile($ownerUid, 'Contratos/Contrato ' . bin2hex(random_bytes(3)) . '.pdf', self::minimalPdf());
		$envelope = $drafts->create($ownerUid, 'Contrato de serviços', [$file->getId()]);
		$envelope = $drafts->updateSettings($envelope, 'Contrato de serviços', $signingOrder, null, 3, 'Assine até sexta.');
		$drafts->replaceSigners($envelope, [
			['name' => 'Ana Lima', 'email' => 'ana@example.com', 'orderGroup' => 1],
			['name' => 'Bruno Souza', 'email' => 'bruno@example.com', 'orderGroup' => 2],
		]);
		$uuid = $envelope->getUuid();
		foreach (Server::get(SignerMapper::class)->findByEnvelope($envelope->getId()) as $index => $signer) {
			$signer->setZapsignToken('signer-' . ($index + 1) . '-' . $uuid);
			if ($signer->getOrderGroup() === 1 || !$signingOrder) {
				$signer->setReleasedAt($this->now - 3600);
			}
			Server::get(SignerMapper::class)->update($signer);
		}
		$main = Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId())[0];
		$main->setZapsignToken('doc-' . $uuid);
		Server::get(DocumentMapper::class)->update($main);
		$sent = Server::get(EnvelopeMapper::class)->findById($envelope->getId());
		$sent->setStatus($status->value);
		$sent->setZapsignToken('doc-' . $uuid);
		$sent->setSendStep(SendStep::Released->value);
		$sent->setSentAt($this->now - 3600);
		$sent->setCreateAttemptedAt($this->now - 3600);
		$sent->setAccountFingerprint($this->zapSignSettings()->accountFingerprint());
		return Server::get(EnvelopeMapper::class)->update($sent);
	}

	/** @return list<Signer> */
	private function signersOf(Envelope $envelope): array {
		return Server::get(SignerMapper::class)->findByEnvelope($envelope->getId());
	}

	private function reloaded(Envelope $envelope): Envelope {
		return Server::get(EnvelopeMapper::class)->findById($envelope->getId());
	}
}
```

`tests/Integration/Action/EnvelopeCancellationTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Action;

use OCA\Assinaturas\Action\ActionRejected;
use OCA\Assinaturas\Action\EnvelopeCancellation;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\Event;
use OCA\Assinaturas\Db\EventMapper;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\SentEnvelopes;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\Server;
use Psr\Log\NullLogger;
use Test\TestCase;

/**
 * @group DB
 */
final class EnvelopeCancellationTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ZapSignDoubles;
	use SentEnvelopes;

	private string $owner;

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->owner = $this->createUser();
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testCancelsAPendingEnvelopeAtZapSignAndCloses(): void {
		$envelope = $this->sentEnvelope($this->owner);
		$this->transport->willRespond(200, ['message' => 'ok']);

		$confirmed = $this->cancellation()->cancel($envelope, '  Valores errados  ', $this->owner);

		$this->assertTrue($confirmed);
		$request = $this->transport->lastRequestJson();
		$this->assertEquals(['doc_token' => 'doc-' . $envelope->getUuid(), 'rejected_reason' => 'Valores errados', 'notify_signer' => true], $request);
		$cancelled = $this->reloaded($envelope);
		$this->assertSame(EnvelopeStatus::Cancelled, $cancelled->statusValue());
		$this->assertSame('Valores errados', $cancelled->getCancelReason());
		$this->assertSame($this->now, $cancelled->getCancelRequestedAt());
		$this->assertNull($cancelled->getNextSyncAt());
		$this->assertSame([['cancel_requested', $this->owner], ['cancelled', $this->owner]], $this->timeline($envelope));
	}

	public function testCancelsAnExpiredEnvelope(): void {
		$envelope = $this->sentEnvelope($this->owner, EnvelopeStatus::Expired);
		$this->transport->willRespond(200, ['message' => 'ok']);

		$this->cancellation()->cancel($envelope, 'Prazo perdido', $this->owner);

		$this->assertSame(EnvelopeStatus::Cancelled, $this->reloaded($envelope)->statusValue());
	}

	/** @dataProvider invalidReasons */
	public function testRejectsAnInvalidReasonWithoutCallingZapSign(string $reason): void {
		$envelope = $this->sentEnvelope($this->owner);

		$rejection = $this->rejectionOf(fn () => $this->cancellation()->cancel($envelope, $reason, $this->owner));

		$this->assertSame('cancel_reason_invalid', $rejection->errorCode);
		$this->assertSame(422, $rejection->httpStatus);
		$this->assertCount(0, $this->transport->requests);
	}

	/** @return array<string, array{string}> */
	public static function invalidReasons(): array {
		return ['empty' => [''], 'blank' => ['   '], 'too long' => [str_repeat('a', 501)]];
	}

	public function testRefusesToCancelADraftOrACompletedEnvelope(): void {
		$file = $this->writeFile($this->owner, 'Rascunho.pdf', self::minimalPdf());
		$draft = Server::get(EnvelopeDrafts::class)->create($this->owner, 'Rascunho', [$file->getId()]);
		$completed = $this->sentEnvelope($this->owner, EnvelopeStatus::Completed);

		$this->assertSame('not_cancellable', $this->rejectionOf(fn () => $this->cancellation()->cancel($draft, 'x', $this->owner))->errorCode);
		$this->assertSame('not_cancellable', $this->rejectionOf(fn () => $this->cancellation()->cancel($completed, 'x', $this->owner))->errorCode);
		$this->assertCount(0, $this->transport->requests);
	}

	public function testKeepsTheRequestAndSchedulesASyncWhenTheOutcomeIsUnknown(): void {
		$envelope = $this->sentEnvelope($this->owner);
		$this->transport->willRespond(503, '');

		$confirmed = $this->cancellation()->cancel($envelope, 'Valores errados', $this->owner);

		$this->assertFalse($confirmed);
		$pending = $this->reloaded($envelope);
		$this->assertSame(EnvelopeStatus::Pending, $pending->statusValue());
		$this->assertSame($this->now, $pending->getCancelRequestedAt());
		$this->assertLessThanOrEqual($this->now, $pending->getNextSyncAt());
	}

	public function testForgetsTheRequestWhenZapSignRefusesTheCancel(): void {
		$envelope = $this->sentEnvelope($this->owner);
		$this->transport->willRespond(400, ['detail' => 'Documento já assinado por ana@example.com']);

		$rejection = $this->rejectionOf(fn () => $this->cancellation()->cancel($envelope, 'Valores errados', $this->owner));

		$this->assertSame('provider_rejected', $rejection->errorCode);
		$this->assertSame(502, $rejection->httpStatus);
		$this->assertStringNotContainsString('ana@example.com', $rejection->getMessage());
		$pending = $this->reloaded($envelope);
		$this->assertSame(EnvelopeStatus::Pending, $pending->statusValue());
		$this->assertNull($pending->getCancelRequestedAt());
		$this->assertNull($pending->getCancelReason());
	}

	public function testDiscardsAFailedEnvelopeAndCancelsItsDocumentQuietly(): void {
		$envelope = $this->sentEnvelope($this->owner, EnvelopeStatus::Failed);
		$this->transport->willRespond(200, ['message' => 'ok']);

		$this->cancellation()->discard($envelope, $this->owner);

		$this->assertSame(EnvelopeStatus::Cancelled, $this->reloaded($envelope)->statusValue());
		$this->assertFalse($this->transport->lastRequestJson()['notify_signer']);
		$this->assertSame([['discarded', $this->owner]], $this->timeline($envelope));
	}

	public function testDiscardsAFailedEnvelopeThatNeverReachedZapSignWithoutCalls(): void {
		$envelope = $this->neverCreatedFailure();

		$this->cancellation()->discard($envelope, $this->owner);

		$this->assertSame(EnvelopeStatus::Cancelled, $this->reloaded($envelope)->statusValue());
		$this->assertCount(0, $this->transport->requests);
	}

	public function testFindsAndCancelsTheDocumentOfALostCreateWhenDiscarding(): void {
		$envelope = $this->neverCreatedFailure();
		$envelope->setCreateAttemptedAt($this->now - 7200);
		Server::get(EnvelopeMapper::class)->update($envelope);
		$this->transport->willRespond(200, [['token' => 'lost-doc', 'external_id' => $envelope->getUuid(), 'status' => 'pending', 'signers' => []]])
			->willRespond(200, ['message' => 'ok']);

		$this->cancellation()->discard($this->reloaded($envelope), $this->owner);

		$this->assertCount(2, $this->transport->requests);
		$this->assertSame('lost-doc', $this->transport->lastRequestJson()['doc_token']);
	}

	public function testStillDiscardsWhenZapSignCannotCancel(): void {
		$envelope = $this->sentEnvelope($this->owner, EnvelopeStatus::Failed);
		$this->transport->willRespond(503, '');

		$this->cancellation()->discard($envelope, $this->owner);

		$this->assertSame(EnvelopeStatus::Cancelled, $this->reloaded($envelope)->statusValue());
	}

	public function testRefusesToDiscardAPendingEnvelope(): void {
		$envelope = $this->sentEnvelope($this->owner);

		$this->assertSame('not_discardable', $this->rejectionOf(fn () => $this->cancellation()->discard($envelope, $this->owner))->errorCode);
	}

	public function testReopensAFailedEnvelopeThatNeverReachedZapSignAsADraft(): void {
		$envelope = $this->neverCreatedFailure();
		$document = Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId())[0];
		$document->setSentSha256(str_repeat('a', 64));
		Server::get(DocumentMapper::class)->update($document);

		$this->cancellation()->reopen($envelope, $this->owner);

		$draft = $this->reloaded($envelope);
		$this->assertSame(EnvelopeStatus::Draft, $draft->statusValue());
		$this->assertNull($draft->getError());
		$this->assertNull(Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId())[0]->getSentSha256());
		$this->assertSame([['reopened', $this->owner]], $this->timeline($envelope));
	}

	public function testRefusesToReopenAnEnvelopeThatReachedZapSign(): void {
		$envelope = $this->sentEnvelope($this->owner, EnvelopeStatus::Failed);

		$this->assertSame('not_reopenable', $this->rejectionOf(fn () => $this->cancellation()->reopen($envelope, $this->owner))->errorCode);
	}

	private function neverCreatedFailure(): Envelope {
		$file = $this->writeFile($this->owner, 'Falhou.pdf', self::minimalPdf());
		$envelope = Server::get(EnvelopeDrafts::class)->create($this->owner, 'Falhou', [$file->getId()]);
		$envelope->setStatus(EnvelopeStatus::Failed->value);
		$envelope->setError('file_changed');
		return Server::get(EnvelopeMapper::class)->update($envelope);
	}

	/** @return list<array{string, ?string}> */
	private function timeline(Envelope $envelope): array {
		return array_map(fn (Event $event): array => [$event->getType(), $event->getActorUid()], Server::get(EventMapper::class)->findByEnvelope($envelope->getId()));
	}

	private function rejectionOf(callable $action): ActionRejected {
		try {
			$action();
		} catch (ActionRejected $rejection) {
			return $rejection;
		}
		$this->fail('Expected the action to be rejected');
	}

	private function cancellation(): EnvelopeCancellation {
		return new EnvelopeCancellation(
			Server::get(EnvelopeMapper::class),
			Server::get(DocumentMapper::class),
			$this->zapSignClient($this->zapSignSettings()),
			new EnvelopeEvents(Server::get(EventMapper::class), Server::get(IEventDispatcher::class)),
			$this->fixedClock(),
			new NullLogger(),
		);
	}
}
```

`tests/Integration/Controller/EnvelopeActionControllerTest.php`. Access and status mapping only; these paths make no ZapSign call:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Controller;

use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Controller\EnvelopeActionController;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\AppFramework\Http;
use OCP\IGroupManager;
use OCP\IUserManager;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class EnvelopeActionControllerTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;

	private string $owner;
	private string $uuid;

	protected function setUp(): void {
		parent::setUp();
		$this->owner = $this->createUser();
		$this->addToGroup($this->owner, SignersGroup::GROUP_ID);
		$file = $this->writeFile($this->owner, 'Contrato.pdf', self::minimalPdf());
		$this->uuid = Server::get(EnvelopeDrafts::class)->create($this->owner, 'Contrato', [$file->getId()])->getUuid();
	}

	protected function tearDown(): void {
		self::logout();
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testHidesAnotherUsersEnvelope(): void {
		$stranger = $this->createUser();
		$this->addToGroup($stranger, SignersGroup::GROUP_ID);
		self::loginAsUser($stranger);

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->cancel($this->uuid, 'x')->getStatus());
	}

	public function testForbidsAnAdminFromActingOnSomeoneElsesEnvelope(): void {
		$admin = $this->createUser();
		Server::get(IGroupManager::class)->get('admin')->addUser(Server::get(IUserManager::class)->get($admin));
		self::loginAsUser($admin);

		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller()->cancel($this->uuid, 'x')->getStatus());
	}

	public function testAnswersConflictForAnActionTheStatusDoesNotAllow(): void {
		self::loginAsUser($this->owner);

		$response = $this->controller()->cancel($this->uuid, 'Valores errados');

		$this->assertSame(Http::STATUS_CONFLICT, $response->getStatus());
		$this->assertSame('not_cancellable', $response->getData()['error']);
	}

	public function testAnswersUnprocessableForAnInvalidReason(): void {
		self::loginAsUser($this->owner);

		$response = $this->controller()->cancel($this->uuid, '');

		$this->assertSame(Http::STATUS_UNPROCESSABLE_ENTITY, $response->getStatus());
		$this->assertSame('cancel_reason_invalid', $response->getData()['error']);
	}

	private function controller(): EnvelopeActionController {
		return Server::get(EnvelopeActionController::class);
	}
}
```

The reason is validated before the status, so `cancel($draftUuid, '')` gives 422 and `cancel($draftUuid, 'Valores errados')` gives 409.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter 'EnvelopeCancellationTest|EnvelopeActionControllerTest'`
Expected: ERROR `Class "OCA\Assinaturas\Action\EnvelopeCancellation" not found`.

- [ ] **Step 3: Implement**

`lib/Api/EnvelopeDetails.php`: move `summary()` and `detail()` out of `EnvelopeController` unchanged, as public methods. Inject `EnvelopeMapper`, `DocumentMapper`, `SignerMapper`, `FieldMapper`, `EventMapper` and `EnvelopeView`. `EnvelopeController` then depends on `EnvelopeDetails` instead of those mappers and the view, and its tests stay green untouched.

In `lib/Api/EnvelopeView::detail()`, add two keys after `refusedReason`:
- `'cancelRequestedAt' => $envelope->getCancelRequestedAt()`
- `'cancelReason' => $envelope->getCancelReason()`

`lib/Action/EnvelopeCancellation.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Action;

use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Send\EnvelopeCreation;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use OCA\Assinaturas\ZapSign\Exception\ZapSignNotFound;
use OCA\Assinaturas\ZapSign\Exception\ZapSignUnreachable;
use OCA\Assinaturas\ZapSign\ZapSignClient;
use OCP\AppFramework\Http;
use OCP\AppFramework\Utility\ITimeFactory;
use Psr\Log\LoggerInterface;

/**
 * Ends an envelope on the sender's request. A cancel of a sent envelope is recorded before
 * ZapSign is called, so a lost response still converges: the sync reads the document as
 * refused and, because we asked, closes it as cancelled.
 */
final class EnvelopeCancellation {
	private const OPEN_STATUSES = [EnvelopeStatus::Pending, EnvelopeStatus::Expired];
	private const MAX_REASON_LENGTH = 500;
	private const DISCARD_REASON = 'Envio descartado pelo remetente';

	public function __construct(
		private EnvelopeMapper $envelopeMapper,
		private DocumentMapper $documentMapper,
		private ZapSignClient $client,
		private EnvelopeEvents $events,
		private ITimeFactory $timeFactory,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * @return bool true when ZapSign confirmed the cancel; false when its outcome is unknown and a sync will settle it
	 * @throws ActionRejected
	 */
	public function cancel(Envelope $envelope, string $reason, string $actorUid): bool {
		$reason = trim($reason);
		$length = mb_strlen($reason);
		if ($length === 0 || $length > self::MAX_REASON_LENGTH) {
			throw new ActionRejected('cancel_reason_invalid', 'A cancel reason of 1 to ' . self::MAX_REASON_LENGTH . ' characters is required', Http::STATUS_UNPROCESSABLE_ENTITY);
		}
		$current = $this->envelopeMapper->findById($envelope->getId());
		if (!in_array($current->statusValue(), self::OPEN_STATUSES, true) || $current->getZapsignToken() === null) {
			throw new ActionRejected('not_cancellable', 'Only pending or expired envelopes can be cancelled');
		}
		$now = $this->timeFactory->getTime();
		$this->requestCancel($current, $reason, $now);
		$this->events->record($current->getId(), null, 'cancel_requested', '', $now, ['reason' => $reason], $actorUid);
		try {
			$this->client->cancelDocument((string)$current->getZapsignToken(), $reason, true);
		} catch (ZapSignUnreachable) {
			$this->envelopeMapper->scheduleSyncNoLaterThan($current->getId(), $now);
			return false;
		} catch (ZapSignException $failure) {
			$this->forgetCancelRequest($current);
			throw ActionRejected::provider($failure);
		}
		$this->events->record($current->getId(), null, EnvelopeStatus::Cancelled->value, '', $now, [], $actorUid);
		$this->envelopeMapper->transitionStatus($current->getId(), self::OPEN_STATUSES, EnvelopeStatus::Cancelled, null, $now, null, ['next_sync_at' => null]);
		return true;
	}

	/** @throws ActionRejected */
	public function discard(Envelope $envelope, string $actorUid): void {
		$now = $this->timeFactory->getTime();
		$current = $this->envelopeMapper->findById($envelope->getId());
		if (!$this->envelopeMapper->transitionStatus($current->getId(), [EnvelopeStatus::Failed], EnvelopeStatus::Cancelled, null, $now, null, ['next_sync_at' => null])) {
			throw new ActionRejected('not_discardable', 'Only failed envelopes can be discarded');
		}
		$this->events->record($current->getId(), null, 'discarded', '', $now, [], $actorUid);
		$documentToken = $current->getZapsignToken() ?? $this->lostDocumentToken($current);
		if ($documentToken === null) {
			return;
		}
		try {
			$this->client->cancelDocument($documentToken, self::DISCARD_REASON, false);
		} catch (ZapSignNotFound) {
		} catch (ZapSignException $failure) {
			$this->logger->warning('A discarded envelope could not be cancelled at ZapSign', ['envelope' => $current->getUuid(), 'failure' => $failure::class]);
		}
	}

	/** @throws ActionRejected */
	public function reopen(Envelope $envelope, string $actorUid): void {
		$now = $this->timeFactory->getTime();
		$current = $this->envelopeMapper->findById($envelope->getId());
		$neverReachedZapSign = $current->getZapsignToken() === null && $current->getCreateAttemptedAt() === null;
		if (!$neverReachedZapSign || !$this->envelopeMapper->transitionStatus($current->getId(), [EnvelopeStatus::Failed], EnvelopeStatus::Draft, null, $now, null, ['error' => null])) {
			throw new ActionRejected('not_reopenable', 'Only failed envelopes that never reached ZapSign can return to draft');
		}
		foreach ($this->documentMapper->findByEnvelope($current->getId()) as $document) {
			if ($document->getSentSha256() === null) {
				continue;
			}
			$document->setSentSha256(null);
			$this->documentMapper->update($document);
		}
		$this->events->record($current->getId(), null, 'reopened', '', $now, [], $actorUid);
	}

	private function requestCancel(Envelope $envelope, string $reason, int $now): void {
		$envelope->setCancelRequestedAt($now);
		$envelope->setCancelReason($reason);
		$this->envelopeMapper->update($envelope);
	}

	private function forgetCancelRequest(Envelope $envelope): void {
		$envelope->setCancelRequestedAt(null);
		$envelope->setCancelReason(null);
		$this->envelopeMapper->update($envelope);
	}

	private function lostDocumentToken(Envelope $envelope): ?string {
		if ($envelope->getCreateAttemptedAt() === null) {
			return null;
		}
		try {
			$documents = $this->client->findDocumentsByFolder(EnvelopeCreation::FOLDER_ROOT . $envelope->getUuid());
		} catch (ZapSignException $failure) {
			$this->logger->warning('Could not look up a discarded envelope at ZapSign', ['envelope' => $envelope->getUuid(), 'failure' => $failure::class]);
			return null;
		}
		foreach ($documents as $document) {
			if ($document->externalId === $envelope->getUuid()) {
				return $document->token;
			}
		}
		return null;
	}
}
```

`lib/Controller/EnvelopeActionController.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Controller;

use OCA\Assinaturas\Access\EnvelopeAccess;
use OCA\Assinaturas\Action\ActionRejected;
use OCA\Assinaturas\Action\EnvelopeCancellation;
use OCA\Assinaturas\Api\EnvelopeDetails;
use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Draft\DraftRejected;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\FrontpageRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

/** Actions on sent envelopes. Only the owner acts; every rejection carries our own code. */
final class EnvelopeActionController extends Controller {
	public function __construct(
		IRequest $request,
		private EnvelopeAccess $access,
		private EnvelopeDetails $details,
		private EnvelopeCancellation $cancellation,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'POST', url: '/api/v1/envelopes/{uuid}/cancel')]
	public function cancel(string $uuid, string $reason = ''): JSONResponse {
		return $this->acting($uuid, function (Envelope $envelope) use ($reason): JSONResponse {
			$confirmed = $this->cancellation->cancel($envelope, $reason, $this->access->currentUserId());
			return new JSONResponse($this->details->detail($envelope), $confirmed ? Http::STATUS_OK : Http::STATUS_ACCEPTED);
		});
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'POST', url: '/api/v1/envelopes/{uuid}/discard')]
	public function discard(string $uuid): JSONResponse {
		return $this->acting($uuid, function (Envelope $envelope): JSONResponse {
			$this->cancellation->discard($envelope, $this->access->currentUserId());
			return new JSONResponse($this->details->detail($envelope));
		});
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'POST', url: '/api/v1/envelopes/{uuid}/reopen')]
	public function reopen(string $uuid): JSONResponse {
		return $this->acting($uuid, function (Envelope $envelope): JSONResponse {
			$this->cancellation->reopen($envelope, $this->access->currentUserId());
			return new JSONResponse($this->details->detail($envelope));
		});
	}

	/**
	 * Higher-order guard: the envelope must be readable (else 404) and editable by the current
	 * user (else 403); rejections become their own status with our code.
	 *
	 * @param callable(Envelope): JSONResponse $action
	 */
	private function acting(string $uuid, callable $action): JSONResponse {
		$envelope = $this->access->readable($uuid);
		if ($envelope === null) {
			return new JSONResponse(['error' => 'not_found', 'message' => 'Envelope not found'], Http::STATUS_NOT_FOUND);
		}
		if (!$this->access->mayEdit($envelope)) {
			return new JSONResponse(['error' => 'forbidden', 'message' => 'You are not allowed to do this'], Http::STATUS_FORBIDDEN);
		}
		try {
			return $action($envelope);
		} catch (ActionRejected $rejection) {
			return self::rejected($rejection);
		} catch (DraftRejected $rejection) {
			return new JSONResponse(['error' => $rejection->errorCode, 'message' => $rejection->getMessage()], Http::STATUS_UNPROCESSABLE_ENTITY);
		}
	}

	private static function rejected(ActionRejected $rejection): JSONResponse {
		$body = ['error' => $rejection->errorCode, 'message' => $rejection->getMessage()];
		if ($rejection->retryAfterSeconds !== null) {
			$body['retryAfterSeconds'] = $rejection->retryAfterSeconds;
		}
		return new JSONResponse($body, $rejection->httpStatus);
	}
}
```

`docs/api.md` changes:
- Add the three routes to the Routes table.
- Add an "Action codes" subsection under Errors: `cancel_reason_invalid` (422), `not_cancellable`, `not_discardable` and `not_reopenable` (409), and the `provider_*` codes (502 during an action).
- Add `cancelRequestedAt` and `cancelReason` to the detail shape.
- Explain the 202 answer on cancel: ZapSign's answer was lost, and the next sync settles the envelope.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'EnvelopeCancellationTest|EnvelopeActionControllerTest|EnvelopeControllerTest'`, then `tests/env/phpunit.sh`.
Expected: `OK` (15 cancellation cases, including the data sets, plus 4 controller tests), and the full suite green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: cancel sent envelopes, discard failed sends and reopen them as drafts"
```

---

### Task 4: Extend the deadline

**Files:**
- Create: `lib/Draft/DeadlineCalculator.php`, `lib/Action/EnvelopeDeadline.php`
- Modify:
  - `lib/Draft/EnvelopeDrafts.php`: use `DeadlineCalculator` in place of its private `endOfDay()`/`timezoneName()`. The `IConfig $systemConfig` constructor parameter becomes `DeadlineCalculator $deadlines`. Update every `new EnvelopeDrafts(` in `tests/`.
  - `lib/Controller/EnvelopeActionController.php`
  - `docs/api.md`
- Test: `tests/Integration/Action/EnvelopeDeadlineTest.php`, `tests/Unit/Draft/DeadlineCalculatorTest.php`

**Interfaces:**
- Consumes: `SentEnvelopes`, `ActionRejected`, `EnvelopeEvents`, and `ZapSignClient::updateDeadline(string, \DateTimeImmutable)`.
- Produces:
  - `DeadlineCalculator(IConfig $systemConfig, ITimeFactory $timeFactory)`:
    - `endOfDay(string $date): int`. Throws `DraftRejected('deadline_invalid', …)`, with the same messages as today.
    - `timezone(): \DateTimeZone`.
  - `EnvelopeDeadline::extend(Envelope $envelope, string $date, string $actorUid): void`.
    - `pending` keeps its status. `expired` becomes `pending` with `next_sync_at = now`.
    - Records a `deadline_extended` event with detail `['deadlineAt' => <epoch>]`.
  - Route `PUT /api/v1/envelopes/{uuid}/deadline`, body `{deadline: "YYYY-MM-DD"}`, 200 with the detail.
  - Error codes:

    | Code | Status |
    |---|---|
    | `deadline_invalid` | 422 |
    | `deadline_not_later` | 422 |
    | `deadline_not_extendable` | 409 |
    | `provider_*` | 502 |

- [ ] **Step 1: Write the failing tests**

`tests/Unit/Draft/DeadlineCalculatorTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\Draft;

use OCA\Assinaturas\Draft\DeadlineCalculator;
use OCA\Assinaturas\Draft\DraftRejected;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IConfig;
use PHPUnit\Framework\TestCase;

final class DeadlineCalculatorTest extends TestCase {
	private const NOW = 1_790_000_000;

	public function testEndsTheDayInTheConfiguredTimezone(): void {
		$endOfDay = $this->calculator('America/Sao_Paulo')->endOfDay('2026-12-31');

		$this->assertSame((new \DateTimeImmutable('2026-12-31 23:59:59', new \DateTimeZone('America/Sao_Paulo')))->getTimestamp(), $endOfDay);
	}

	public function testFallsBackToSaoPauloForAnUnknownTimezone(): void {
		$this->assertSame('America/Sao_Paulo', $this->calculator('Mars/Olympus')->timezone()->getName());
	}

	/** @dataProvider invalidDates */
	public function testRejectsAnInvalidOrPastDate(string $date): void {
		try {
			$this->calculator('America/Sao_Paulo')->endOfDay($date);
			$this->fail('Expected the date to be rejected');
		} catch (DraftRejected $rejection) {
			$this->assertSame('deadline_invalid', $rejection->errorCode);
		}
	}

	/** @return array<string, array{string}> */
	public static function invalidDates(): array {
		return ['wrong format' => ['31/12/2026'], 'impossible day' => ['2026-02-31'], 'in the past' => ['2020-01-01']];
	}

	private function calculator(string $timezone): DeadlineCalculator {
		$systemConfig = $this->createMock(IConfig::class);
		$systemConfig->method('getSystemValueString')->willReturn($timezone);
		$timeFactory = $this->createMock(ITimeFactory::class);
		$timeFactory->method('getTime')->willReturn(self::NOW);
		return new DeadlineCalculator($systemConfig, $timeFactory);
	}
}
```

`tests/Integration/Action/EnvelopeDeadlineTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Action;

use OCA\Assinaturas\Action\ActionRejected;
use OCA\Assinaturas\Action\EnvelopeDeadline;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\Event;
use OCA\Assinaturas\Db\EventMapper;
use OCA\Assinaturas\Draft\DeadlineCalculator;
use OCA\Assinaturas\Draft\DraftRejected;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\SentEnvelopes;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\IConfig;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class EnvelopeDeadlineTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ZapSignDoubles;
	use SentEnvelopes;

	private const NEW_DATE = '2026-12-31';

	private string $owner;

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->owner = $this->createUser();
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testExtendsAPendingEnvelopeAtZapSignAndRecordsIt(): void {
		$envelope = $this->sentEnvelope($this->owner);
		$this->transport->willRespond(200, ['token' => 'doc-' . $envelope->getUuid()]);

		$this->deadline()->extend($envelope, self::NEW_DATE, $this->owner);

		$request = $this->transport->requests[0];
		$this->assertSame('PUT', $request->method());
		$this->assertStringEndsWith('/docs/doc-' . $envelope->getUuid() . '/', $request->url());
		$this->assertArrayHasKey('date_limit_to_sign', $this->transport->lastRequestJson());
		$extended = $this->reloaded($envelope);
		$this->assertSame($this->calculator()->endOfDay(self::NEW_DATE), $extended->getDeadlineAt());
		$this->assertSame(EnvelopeStatus::Pending, $extended->statusValue());
		$events = Server::get(EventMapper::class)->findByEnvelope($envelope->getId());
		$this->assertSame(['deadline_extended'], array_map(fn (Event $event): string => $event->getType(), $events));
		$this->assertSame(['deadlineAt' => $extended->getDeadlineAt()], $events[0]->getDetail());
		$this->assertSame($this->owner, $events[0]->getActorUid());
	}

	public function testReopensAnExpiredEnvelopeForSigning(): void {
		$envelope = $this->sentEnvelope($this->owner, EnvelopeStatus::Expired);
		$envelope->setDeadlineAt($this->now - 60);
		Server::get(EnvelopeMapper::class)->update($envelope);
		$this->transport->willRespond(200, ['token' => 'doc-' . $envelope->getUuid()]);

		$this->deadline()->extend($this->reloaded($envelope), self::NEW_DATE, $this->owner);

		$reopened = $this->reloaded($envelope);
		$this->assertSame(EnvelopeStatus::Pending, $reopened->statusValue());
		$this->assertSame($this->now, $reopened->getNextSyncAt());
	}

	public function testRejectsADateNotLaterThanTheCurrentDeadline(): void {
		$envelope = $this->sentEnvelope($this->owner);
		$envelope->setDeadlineAt($this->calculator()->endOfDay(self::NEW_DATE));
		Server::get(EnvelopeMapper::class)->update($envelope);

		$rejection = $this->rejectionOf(fn () => $this->deadline()->extend($this->reloaded($envelope), '2026-12-30', $this->owner));

		$this->assertSame('deadline_not_later', $rejection->errorCode);
		$this->assertSame(422, $rejection->httpStatus);
		$this->assertCount(0, $this->transport->requests);
	}

	public function testRejectsAnInvalidDateBeforeCallingZapSign(): void {
		$envelope = $this->sentEnvelope($this->owner);

		try {
			$this->deadline()->extend($envelope, '2020-01-01', $this->owner);
			$this->fail('Expected the date to be rejected');
		} catch (DraftRejected $rejection) {
			$this->assertSame('deadline_invalid', $rejection->errorCode);
		}
		$this->assertCount(0, $this->transport->requests);
	}

	public function testRefusesToExtendAClosedEnvelope(): void {
		$envelope = $this->sentEnvelope($this->owner, EnvelopeStatus::Completed);

		$this->assertSame('deadline_not_extendable', $this->rejectionOf(fn () => $this->deadline()->extend($envelope, self::NEW_DATE, $this->owner))->errorCode);
	}

	public function testKeepsTheDeadlineWhenZapSignFails(): void {
		$envelope = $this->sentEnvelope($this->owner);
		$this->transport->willRespond(500, '')->willRespond(500, '')->willRespond(500, '');

		$rejection = $this->rejectionOf(fn () => $this->deadline()->extend($envelope, self::NEW_DATE, $this->owner));

		$this->assertSame('provider_error', $rejection->errorCode);
		$this->assertNull($this->reloaded($envelope)->getDeadlineAt());
	}

	private function rejectionOf(callable $action): ActionRejected {
		try {
			$action();
		} catch (ActionRejected $rejection) {
			return $rejection;
		}
		$this->fail('Expected the action to be rejected');
	}

	private function calculator(): DeadlineCalculator {
		return new DeadlineCalculator(Server::get(IConfig::class), $this->fixedClock());
	}

	private function deadline(): EnvelopeDeadline {
		return new EnvelopeDeadline(
			Server::get(EnvelopeMapper::class),
			$this->zapSignClient($this->zapSignSettings()),
			$this->calculator(),
			new EnvelopeEvents(Server::get(EventMapper::class), Server::get(IEventDispatcher::class)),
			$this->fixedClock(),
		);
	}
}
```

`sentEnvelope()` leaves `deadline_at` null, which is why `testKeepsTheDeadlineWhenZapSignFails` asserts null. The fixed clock (`$this->now = 1_790_000_000`, 2026-09-21) keeps 2026-12-31 in the future.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter 'EnvelopeDeadlineTest|DeadlineCalculatorTest'`
Expected: ERROR `Class "OCA\Assinaturas\Draft\DeadlineCalculator" not found`.

- [ ] **Step 3: Implement**

`lib/Draft/DeadlineCalculator.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Draft;

use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IConfig;

/** A deadline is the end of the chosen day (23:59:59) in the instance's timezone. */
final class DeadlineCalculator {
	private const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
	private const TIMEZONE_KEY = 'default_timezone';

	public function __construct(
		private IConfig $systemConfig,
		private ITimeFactory $timeFactory,
	) {
	}

	/** @throws DraftRejected */
	public function endOfDay(string $date): int {
		$day = \DateTimeImmutable::createFromFormat('!Y-m-d', $date, $this->timezone());
		if ($day === false || $day->format('Y-m-d') !== $date) {
			throw new DraftRejected('deadline_invalid', 'The deadline must be a date in the format YYYY-MM-DD');
		}
		$endOfDay = $day->setTime(23, 59, 59)->getTimestamp();
		if ($endOfDay <= $this->timeFactory->getTime()) {
			throw new DraftRejected('deadline_invalid', 'The deadline must be in the future');
		}
		return $endOfDay;
	}

	public function timezone(): \DateTimeZone {
		$configured = $this->systemConfig->getSystemValueString(self::TIMEZONE_KEY, self::DEFAULT_TIMEZONE);
		return new \DateTimeZone(in_array($configured, \DateTimeZone::listIdentifiers(), true) ? $configured : self::DEFAULT_TIMEZONE);
	}
}
```

`lib/Action/EnvelopeDeadline.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Action;

use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Draft\DeadlineCalculator;
use OCA\Assinaturas\Draft\DraftRejected;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use OCA\Assinaturas\ZapSign\ZapSignClient;
use OCP\AppFramework\Http;
use OCP\AppFramework\Utility\ITimeFactory;

/** Gives signers more time. An expired envelope is open for signing again once ZapSign has the new date. */
final class EnvelopeDeadline {
	private const EXTENDABLE_STATUSES = [EnvelopeStatus::Pending, EnvelopeStatus::Expired];

	public function __construct(
		private EnvelopeMapper $envelopeMapper,
		private ZapSignClient $client,
		private DeadlineCalculator $deadlines,
		private EnvelopeEvents $events,
		private ITimeFactory $timeFactory,
	) {
	}

	/** @throws ActionRejected|DraftRejected */
	public function extend(Envelope $envelope, string $date, string $actorUid): void {
		$deadlineAt = $this->deadlines->endOfDay($date);
		$current = $this->envelopeMapper->findById($envelope->getId());
		if (!in_array($current->statusValue(), self::EXTENDABLE_STATUSES, true) || $current->getZapsignToken() === null) {
			throw new ActionRejected('deadline_not_extendable', 'Only pending or expired envelopes can get a new deadline');
		}
		if ($current->getDeadlineAt() !== null && $deadlineAt <= $current->getDeadlineAt()) {
			throw new ActionRejected('deadline_not_later', 'The new deadline must be later than the current one', Http::STATUS_UNPROCESSABLE_ENTITY);
		}
		try {
			$this->client->updateDeadline((string)$current->getZapsignToken(), (new \DateTimeImmutable('@' . $deadlineAt))->setTimezone($this->deadlines->timezone()));
		} catch (ZapSignException $failure) {
			throw ActionRejected::provider($failure);
		}
		$now = $this->timeFactory->getTime();
		$current->setDeadlineAt($deadlineAt);
		$this->envelopeMapper->update($current);
		$this->envelopeMapper->transitionStatus($current->getId(), [EnvelopeStatus::Expired], EnvelopeStatus::Pending, null, $now, null, ['next_sync_at' => $now]);
		$this->events->record($current->getId(), null, 'deadline_extended', (string)$deadlineAt, $now, ['deadlineAt' => $deadlineAt], $actorUid);
	}
}
```

The `Expired → Pending` transition is a harmless no-op for a pending envelope.

In `EnvelopeActionController`:
- Inject `EnvelopeDeadline $deadline`.
- Add the route:
```php
	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'PUT', url: '/api/v1/envelopes/{uuid}/deadline')]
	public function extendDeadline(string $uuid, string $deadline = ''): JSONResponse {
		return $this->acting($uuid, function (Envelope $envelope) use ($deadline): JSONResponse {
			$this->deadline->extend($envelope, $deadline, $this->access->currentUserId());
			return new JSONResponse($this->details->detail($envelope));
		});
	}
```

`docs/api.md`: add the route and the codes `deadline_not_later` (422) and `deadline_not_extendable` (409). `deadline_invalid` is already documented.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'EnvelopeDeadlineTest|DeadlineCalculatorTest|EnvelopeDrafts'`, then `tests/env/phpunit.sh`.
Expected: `OK`, and the full suite green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: extend a sent envelope's deadline and reopen expired ones"
```

---

### Task 5: Reminders — manual and automatic

**Files:**
- Create: `lib/Action/SignerReminders.php`
- Modify:
  - `lib/Sync/EnvelopeSynchronizer.php`: run due reminders on the pending path, and never schedule the next sync later than the next reminder. Update every `new EnvelopeSynchronizer(` in `tests/`.
  - `lib/Api/EnvelopeView.php`: add `lastReminderAt` to the signer.
  - `lib/Controller/EnvelopeActionController.php`, `docs/api.md`
- Test: `tests/Integration/Action/SignerRemindersTest.php`, plus one new test in `tests/Integration/Sync/EnvelopeSynchronizerTest.php`

**Interfaces:**
- Consumes: `SignerMessage::compose(Envelope): string`, `ZapSignClient::releaseSigner` (resend = release again), `ZapSignRateLimited::$isCooldown` / `$retryAfterSeconds`, and `ActionRejected::provider`.
- Produces:
  - `SignerReminders`:
    - `public const COOLDOWN_SECONDS = 1800`
    - `remindable(Envelope $envelope, array $signers): array`: `list<Signer>` in, `list<Signer>` out. Implements the "remindable" rule from the Global Constraints.
    - `remind(Envelope $envelope, int $signerId, string $actorUid): void`. Throws `ActionRejected`:
      - `signer_not_found` (404);
      - `signer_not_remindable` (409);
      - `reminder_cooldown` (429, with `retryAfterSeconds`);
      - `provider_*` (502).
    - `sendDue(Envelope $envelope): ?int` sends every overdue automatic reminder. It returns when the next one is due, or null when none is.
  - Timeline: `reminder_sent` (signer event; `actorUid` is null for automatic reminders).
  - Route `POST /api/v1/envelopes/{uuid}/signers/{signerId}/remind`, 200 with the detail.

- [ ] **Step 1: Write the failing tests**

`tests/Integration/Action/SignerRemindersTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Action;

use OCA\Assinaturas\Action\ActionRejected;
use OCA\Assinaturas\Action\SignerReminders;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\Event;
use OCA\Assinaturas\Db\EventMapper;
use OCA\Assinaturas\Db\Signer;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Db\SignerStatus;
use OCA\Assinaturas\Send\SignerMessage;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\SentEnvelopes;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\IUserManager;
use OCP\Server;
use Psr\Log\NullLogger;
use Test\TestCase;

/**
 * @group DB
 */
final class SignerRemindersTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ZapSignDoubles;
	use SentEnvelopes;

	private const DAY = 86400;

	private string $owner;

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->owner = $this->createUser();
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testRemindsOnlyTheCurrentGroupWhenOrderIsOn(): void {
		$envelope = $this->sentEnvelope($this->owner);
		[$ana, $bruno] = $this->signersOf($envelope);

		$this->assertSame([$ana->getId()], $this->ids($this->reminders()->remindable($envelope, $this->signersOf($envelope))));

		$this->markSigned($ana, $this->now - 60);
		$this->assertSame([$bruno->getId()], $this->ids($this->reminders()->remindable($envelope, $this->signersOf($envelope))));
	}

	public function testRemindsEveryOpenSignerWhenOrderIsOff(): void {
		$envelope = $this->sentEnvelope($this->owner, EnvelopeStatus::Pending, false);

		$this->assertCount(2, $this->reminders()->remindable($envelope, $this->signersOf($envelope)));
	}

	public function testSkipsASignerWhoseEmailBounced(): void {
		$envelope = $this->sentEnvelope($this->owner);
		[$ana] = $this->signersOf($envelope);
		$ana->setEmailBouncedAt($this->now - 60);
		Server::get(SignerMapper::class)->update($ana);

		$this->assertSame([], $this->reminders()->remindable($envelope, $this->signersOf($envelope)));
	}

	public function testRemindsASignerWithTheSendersMessage(): void {
		$envelope = $this->sentEnvelope($this->owner);
		[$ana] = $this->signersOf($envelope);
		$this->transport->willRespond(200, ['token' => $ana->getZapsignToken()]);

		$this->reminders()->remind($envelope, $ana->getId(), $this->owner);

		$this->assertStringEndsWith('/signers/' . $ana->getZapsignToken() . '/', $this->transport->requests[0]->url());
		$this->assertTrue($this->transport->lastRequestJson()['send_automatic_email']);
		$this->assertStringContainsString('Assine até sexta.', $this->transport->lastRequestJson()['custom_message']);
		$this->assertSame($this->now, $this->signersOf($envelope)[0]->getLastReminderAt());
		$this->assertSame([['reminder_sent', $ana->getId(), $this->owner]], $this->timeline($envelope));
	}

	public function testRefusesToRemindAGroupThatIsNotUpYet(): void {
		$envelope = $this->sentEnvelope($this->owner);
		[, $bruno] = $this->signersOf($envelope);

		$rejection = $this->rejectionOf(fn () => $this->reminders()->remind($envelope, $bruno->getId(), $this->owner));

		$this->assertSame('signer_not_remindable', $rejection->errorCode);
		$this->assertCount(0, $this->transport->requests);
	}

	public function testReportsAnUnknownSigner(): void {
		$envelope = $this->sentEnvelope($this->owner);

		$rejection = $this->rejectionOf(fn () => $this->reminders()->remind($envelope, 999999999, $this->owner));

		$this->assertSame('signer_not_found', $rejection->errorCode);
		$this->assertSame(404, $rejection->httpStatus);
	}

	public function testReportsZapSignsCooldownWithTheWait(): void {
		$envelope = $this->sentEnvelope($this->owner);
		[$ana] = $this->signersOf($envelope);
		$this->transport->willRespond(429, ['code' => 'cooldown_period', 'detail' => 'Aguarde'], ['retry-after' => '1200']);

		$rejection = $this->rejectionOf(fn () => $this->reminders()->remind($envelope, $ana->getId(), $this->owner));

		$this->assertSame('reminder_cooldown', $rejection->errorCode);
		$this->assertSame(429, $rejection->httpStatus);
		$this->assertSame(1200, $rejection->retryAfterSeconds);
		$this->assertNull($this->signersOf($envelope)[0]->getLastReminderAt());
	}

	public function testWaitsForTheReminderIntervalAfterRelease(): void {
		$envelope = $this->sentEnvelope($this->owner);

		$nextDue = $this->reminders()->sendDue($envelope);

		$this->assertCount(0, $this->transport->requests);
		$this->assertSame($this->now - 3600 + 3 * self::DAY, $nextDue);
	}

	public function testSendsAnOverdueReminderAutomatically(): void {
		$envelope = $this->sentEnvelope($this->owner);
		[$ana] = $this->signersOf($envelope);
		$ana->setReleasedAt($this->now - 4 * self::DAY);
		Server::get(SignerMapper::class)->update($ana);
		$this->transport->willRespond(200, ['token' => $ana->getZapsignToken()]);

		$nextDue = $this->reminders()->sendDue($envelope);

		$this->assertCount(1, $this->transport->requests);
		$this->assertSame($this->now + 3 * self::DAY, $nextDue);
		$this->assertSame([['reminder_sent', $ana->getId(), null]], $this->timeline($envelope));
	}

	public function testAnchorsALaterGroupOnWhenThePreviousGroupFinished(): void {
		$envelope = $this->sentEnvelope($this->owner);
		[$ana, $bruno] = $this->signersOf($envelope);
		$this->markSigned($ana, $this->now - 4 * self::DAY);
		$this->transport->willRespond(200, ['token' => $bruno->getZapsignToken()]);

		$this->reminders()->sendDue($envelope);

		$this->assertStringEndsWith('/signers/' . $bruno->getZapsignToken() . '/', $this->transport->requests[0]->url());
	}

	public function testSendsNothingWithoutAReminderInterval(): void {
		$envelope = $this->sentEnvelope($this->owner);
		$envelope->setReminderDays(null);
		Server::get(EnvelopeMapper::class)->update($envelope);

		$this->assertNull($this->reminders()->sendDue($this->reloaded($envelope)));
		$this->assertCount(0, $this->transport->requests);
	}

	public function testRetriesAfterTheCooldownWithoutFailing(): void {
		$envelope = $this->sentEnvelope($this->owner);
		[$ana] = $this->signersOf($envelope);
		$ana->setReleasedAt($this->now - 4 * self::DAY);
		Server::get(SignerMapper::class)->update($ana);
		$this->transport->willRespond(429, ['code' => 'cooldown_period', 'detail' => 'Aguarde'], ['retry-after' => '1200']);

		$this->assertSame($this->now + SignerReminders::COOLDOWN_SECONDS, $this->reminders()->sendDue($envelope));
	}

	private function markSigned(Signer $signer, int $signedAt): void {
		$signer->setStatus(SignerStatus::Signed->value);
		$signer->setSignedAt($signedAt);
		Server::get(SignerMapper::class)->update($signer);
	}

	/**
	 * @param list<Signer> $signers
	 * @return list<int>
	 */
	private function ids(array $signers): array {
		return array_map(fn (Signer $signer): int => $signer->getId(), $signers);
	}

	/** @return list<array{string, ?int, ?string}> */
	private function timeline(Envelope $envelope): array {
		return array_map(fn (Event $event): array => [$event->getType(), $event->getSignerId(), $event->getActorUid()], Server::get(EventMapper::class)->findByEnvelope($envelope->getId()));
	}

	private function rejectionOf(callable $action): ActionRejected {
		try {
			$action();
		} catch (ActionRejected $rejection) {
			return $rejection;
		}
		$this->fail('Expected the action to be rejected');
	}

	private function reminders(): SignerReminders {
		$settings = $this->zapSignSettings();
		return new SignerReminders(
			Server::get(EnvelopeMapper::class),
			Server::get(SignerMapper::class),
			$this->zapSignClient($settings),
			new SignerMessage(Server::get(IUserManager::class), $settings),
			new EnvelopeEvents(Server::get(EventMapper::class), Server::get(IEventDispatcher::class)),
			$this->fixedClock(),
			new NullLogger(),
		);
	}
}
```

Add to `tests/Integration/Sync/EnvelopeSynchronizerTest.php`, adapting to its existing `synchronizer()` wiring and document-payload helper. After this task, the wiring passes a `SignerReminders` built like the one above.
```php
	public function testSendsDueRemindersWhileTheEnvelopeIsPending(): void {
		// The envelope's first signer was released four days ago, and reminderDays is set to 1.
		// The provider still reports the document as pending, with nobody signed.
		// Expected requests: GET /docs/{doc}/, then POST /signers/{signer-1}/.
		// Expected state: next_sync_at is no later than now + 1 day.
	}
```
Write it as a real test in the file's style:
1. Set `reminderDays = 1` and `releasedAt = now - 4 days` on signer 1.
2. Queue the pending document response, then `200 ['token' => …]` for the release.
3. Assert the second request's URL ends with `/signers/<signer-1 token>/`.
4. Assert `next_sync_at <= $this->now + 86400`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter 'SignerRemindersTest|EnvelopeSynchronizerTest'`
Expected: ERROR `Class "OCA\Assinaturas\Action\SignerReminders" not found`.

- [ ] **Step 3: Implement**

`lib/Action/SignerReminders.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Action;

use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\Signer;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Db\SignerStatus;
use OCA\Assinaturas\Send\SignerMessage;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use OCA\Assinaturas\ZapSign\Exception\ZapSignRateLimited;
use OCA\Assinaturas\ZapSign\ZapSignClient;
use OCP\AppFramework\Http;
use OCP\AppFramework\Utility\ITimeFactory;
use Psr\Log\LoggerInterface;

/**
 * Reminders are ours: a resend is releasing the signer again. ZapSign allows one per signer
 * every 30 minutes. Only the group whose turn it is gets reminded, and never a bounced address.
 */
final class SignerReminders {
	public const COOLDOWN_SECONDS = 1800;
	private const DAY_SECONDS = 86400;
	private const PROVIDER_RETRY_SECONDS = 3600;
	private const REMINDER_EVENT = 'reminder_sent';
	private const OPEN_SIGNER_STATUSES = [SignerStatus::Pending, SignerStatus::Viewed];

	public function __construct(
		private EnvelopeMapper $envelopeMapper,
		private SignerMapper $signerMapper,
		private ZapSignClient $client,
		private SignerMessage $signerMessage,
		private EnvelopeEvents $events,
		private ITimeFactory $timeFactory,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * @param list<Signer> $signers
	 * @return list<Signer>
	 */
	public function remindable(Envelope $envelope, array $signers): array {
		if ($envelope->statusValue() !== EnvelopeStatus::Pending) {
			return [];
		}
		$openSigners = array_values(array_filter($signers, fn (Signer $signer): bool => in_array($signer->statusValue(), self::OPEN_SIGNER_STATUSES, true)));
		$currentGroup = $openSigners === [] ? null : min(array_map(fn (Signer $signer): int => $signer->getOrderGroup(), $openSigners));
		return array_values(array_filter($openSigners, fn (Signer $signer): bool => $signer->getZapsignToken() !== null
			&& $signer->getEmailBouncedAt() === null
			&& (!$envelope->getSigningOrder() || $signer->getOrderGroup() === $currentGroup)));
	}

	/** @throws ActionRejected */
	public function remind(Envelope $envelope, int $signerId, string $actorUid): void {
		$current = $this->envelopeMapper->findById($envelope->getId());
		$signers = $this->signerMapper->findByEnvelope($current->getId());
		$signer = self::signerWithId($signers, $signerId);
		if ($signer === null) {
			throw new ActionRejected('signer_not_found', 'This signer is not part of the envelope', Http::STATUS_NOT_FOUND);
		}
		if (self::signerWithId($this->remindable($current, $signers), $signerId) === null) {
			throw new ActionRejected('signer_not_remindable', 'This signer cannot be reminded now');
		}
		try {
			$this->client->releaseSigner((string)$signer->getZapsignToken(), $this->signerMessage->compose($current));
		} catch (ZapSignException $failure) {
			throw ActionRejected::provider($failure);
		}
		$this->recordReminder($current, $signer, $actorUid);
	}

	/** @return ?int when the next automatic reminder is due; null when none is scheduled */
	public function sendDue(Envelope $envelope): ?int {
		$reminderDays = $envelope->getReminderDays();
		if ($reminderDays === null) {
			return null;
		}
		$interval = $reminderDays * self::DAY_SECONDS;
		$now = $this->timeFactory->getTime();
		$signers = $this->signerMapper->findByEnvelope($envelope->getId());
		$nextDue = null;
		foreach ($this->remindable($envelope, $signers) as $signer) {
			$dueAt = $this->anchor($envelope, $signer, $signers) + $interval;
			$nextDue = self::earliest($nextDue, $dueAt > $now ? $dueAt : $this->sendAutomatic($envelope, $signer, $now, $interval));
		}
		return $nextDue;
	}

	private function sendAutomatic(Envelope $envelope, Signer $signer, int $now, int $interval): int {
		try {
			$this->client->releaseSigner((string)$signer->getZapsignToken(), $this->signerMessage->compose($envelope));
		} catch (ZapSignRateLimited $limited) {
			return $now + ($limited->isCooldown ? self::COOLDOWN_SECONDS : self::PROVIDER_RETRY_SECONDS);
		} catch (ZapSignException $failure) {
			$this->logger->warning('Automatic reminder failed', ['envelope' => $envelope->getUuid(), 'failure' => $failure::class]);
			return $now + self::PROVIDER_RETRY_SECONDS;
		}
		$this->recordReminder($envelope, $signer, null);
		return $now + $interval;
	}

	private function recordReminder(Envelope $envelope, Signer $signer, ?string $actorUid): void {
		$now = $this->timeFactory->getTime();
		$signer->setLastReminderAt($now);
		$this->signerMapper->update($signer);
		$this->events->record($envelope->getId(), $signer->getId(), self::REMINDER_EVENT, (string)$now, $now, [], $actorUid);
	}

	/** @param list<Signer> $signers */
	private function anchor(Envelope $envelope, Signer $signer, array $signers): int {
		return $signer->getLastReminderAt()
			?? $signer->getReleasedAt()
			?? self::previousGroupFinishedAt($signer, $signers)
			?? $envelope->getSentAt()
			?? $this->timeFactory->getTime();
	}

	/** @param list<Signer> $signers */
	private static function previousGroupFinishedAt(Signer $signer, array $signers): ?int {
		$earlierSignedAt = array_filter(array_map(
			fn (Signer $other): ?int => $other->getOrderGroup() < $signer->getOrderGroup() ? $other->getSignedAt() : null,
			$signers,
		));
		return $earlierSignedAt === [] ? null : max($earlierSignedAt);
	}

	/** @param list<Signer> $signers */
	private static function signerWithId(array $signers, int $signerId): ?Signer {
		foreach ($signers as $signer) {
			if ($signer->getId() === $signerId) {
				return $signer;
			}
		}
		return null;
	}

	private static function earliest(?int $current, int $candidate): int {
		return $current === null ? $candidate : min($current, $candidate);
	}
}
```

`lib/Sync/EnvelopeSynchronizer.php`:
- Inject `SignerReminders $reminders` as the last constructor parameter.
- In `reschedule()`, after the status guard, compute the schedule and cap it with the next reminder:
```php
		$nextSyncAt = $this->schedule->nextSyncAt($now, $current->getSentAt() ?? $now, $current->getDeadlineAt(), random_int(0, self::MAX_JITTER_SECONDS));
		$nextReminderAt = $this->reminders->sendDue($current);
		$current->setLastSyncedAt($now);
		$current->setNextSyncAt($nextReminderAt === null ? $nextSyncAt : min($nextSyncAt, $nextReminderAt));
		$this->envelopeMapper->update($current);
```

`lib/Api/EnvelopeView::signer()`: add `'lastReminderAt' => $signer->getLastReminderAt()`. With it and `SignerReminders::COOLDOWN_SECONDS`, the UI shows the countdown.

`EnvelopeActionController`: inject `SignerReminders $reminders` and add:
```php
	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'POST', url: '/api/v1/envelopes/{uuid}/signers/{signerId}/remind')]
	public function remind(string $uuid, int $signerId): JSONResponse {
		return $this->acting($uuid, function (Envelope $envelope) use ($signerId): JSONResponse {
			$this->reminders->remind($envelope, $signerId, $this->access->currentUserId());
			return new JSONResponse($this->details->detail($envelope));
		});
	}
```

`docs/api.md`:
- Add the route.
- Add the codes `signer_not_found` (404), `signer_not_remindable` (409), and `reminder_cooldown` (429, with `retryAfterSeconds`).
- Add the signer field `lastReminderAt`.
- State that there is one reminder per signer per 30 minutes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'SignerRemindersTest|EnvelopeSynchronizerTest|SyncPollerTest|LifecycleHandover'`, then `tests/env/phpunit.sh`.
Expected: `OK`, and the full suite green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: remind signers by hand and automatically every reminder interval"
```

---

### Task 6: Correct a signer's email and copy a signing link

**Files:**
- Create: `lib/Action/SignerCorrections.php`, `lib/Action/SignerLinks.php`
- Modify: `lib/Controller/EnvelopeActionController.php`, `docs/api.md`
- Test: `tests/Integration/Action/SignerCorrectionsTest.php`, `tests/Integration/Action/SignerLinksTest.php`

**Interfaces:**
- Consumes:
  - `SignerReminders::remindable`, `SignerMessage::compose`;
  - `ZapSignClient::updateSignerEmail` (idempotent), `releaseSigner`, `getDocument`;
  - `ZapSignSigner::$signUrl`.
- Produces:
  - `SignerCorrections`:
    - `public const RELEASE_AFTER_EMAIL_UPDATE = true`. Task 1 (S2) decides the final value.
    - `correctEmail(Envelope $envelope, int $signerId, string $email, string $actorUid): bool` returns whether the corrected address was invited now (false during ZapSign's cooldown). It clears `email_bounced_at`.
  - `SignerLinks::link(Envelope $envelope, int $signerId, string $actorUid): string` returns the sign URL. It is audited and never stored or logged.
  - Routes:

    | Route | Body | Success |
    |---|---|---|
    | `PUT /api/v1/envelopes/{uuid}/signers/{signerId}/email` | `{email}` | 200: the detail plus `"invited": bool` |
    | `POST /api/v1/envelopes/{uuid}/signers/{signerId}/link` | — | 200 `{"signUrl": "<url>"}`, with `Cache-Control: no-store` |

  - Error codes:

    | Code | Status |
    |---|---|
    | `signer_email_invalid` | 422 |
    | `signer_email_duplicate` | 422 |
    | `signer_email_unchanged` | 422 |
    | `email_not_correctable` | 409 |
    | `link_unavailable` | 409 when the signer or envelope isn't open; 502 when ZapSign returns no URL |
    | `signer_not_found` | 404 |
    | `provider_*` | 502 |

  - Timeline: `email_corrected`, `link_copied` (signer events with an actor).

- [ ] **Step 1: Write the failing tests**

`tests/Integration/Action/SignerCorrectionsTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Action;

use OCA\Assinaturas\Action\ActionRejected;
use OCA\Assinaturas\Action\SignerCorrections;
use OCA\Assinaturas\Action\SignerReminders;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\Event;
use OCA\Assinaturas\Db\EventMapper;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Db\SignerStatus;
use OCA\Assinaturas\Send\SignerMessage;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\SentEnvelopes;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\IUserManager;
use OCP\Server;
use Psr\Log\NullLogger;
use Test\TestCase;

/**
 * @group DB
 */
final class SignerCorrectionsTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ZapSignDoubles;
	use SentEnvelopes;

	private string $owner;

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->owner = $this->createUser();
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testCorrectsTheEmailAtZapSignAndInvitesTheNewAddress(): void {
		$envelope = $this->sentEnvelope($this->owner);
		[$ana] = $this->signersOf($envelope);
		$ana->setEmailBouncedAt($this->now - 600);
		Server::get(SignerMapper::class)->update($ana);
		$this->transport->willRespond(200, ['token' => $ana->getZapsignToken()])->willRespond(200, ['token' => $ana->getZapsignToken()]);

		$invited = $this->corrections()->correctEmail($envelope, $ana->getId(), '  Ana.Lima@Example.com ', $this->owner);

		$this->assertTrue($invited);
		$this->assertSame(['email' => 'ana.lima@example.com'], json_decode((string)$this->transport->requests[0]->body(), true));
		$this->assertTrue(json_decode((string)$this->transport->requests[1]->body(), true)['send_automatic_email']);
		$corrected = $this->signersOf($envelope)[0];
		$this->assertSame('ana.lima@example.com', $corrected->getEmail());
		$this->assertNull($corrected->getEmailBouncedAt());
		$types = array_map(fn (Event $event): string => $event->getType(), Server::get(EventMapper::class)->findByEnvelope($envelope->getId()));
		$this->assertContains('email_corrected', $types);
	}

	public function testKeepsTheCorrectionWhenZapSignsCooldownBlocksTheInvite(): void {
		$envelope = $this->sentEnvelope($this->owner);
		[$ana] = $this->signersOf($envelope);
		$this->transport->willRespond(200, ['token' => $ana->getZapsignToken()])
			->willRespond(429, ['code' => 'cooldown_period', 'detail' => 'Aguarde'], ['retry-after' => '900']);

		$invited = $this->corrections()->correctEmail($envelope, $ana->getId(), 'ana.lima@example.com', $this->owner);

		$this->assertFalse($invited);
		$this->assertSame('ana.lima@example.com', $this->signersOf($envelope)[0]->getEmail());
	}

	public function testDoesNotInviteASignerWhoseTurnHasNotCome(): void {
		$envelope = $this->sentEnvelope($this->owner);
		[, $bruno] = $this->signersOf($envelope);
		$this->transport->willRespond(200, ['token' => $bruno->getZapsignToken()]);

		$invited = $this->corrections()->correctEmail($envelope, $bruno->getId(), 'bruno.souza@example.com', $this->owner);

		$this->assertFalse($invited);
		$this->assertCount(1, $this->transport->requests);
	}

	/** @dataProvider invalidEmails */
	public function testRejectsAnInvalidAddressWithoutCallingZapSign(string $email, string $expectedCode): void {
		$envelope = $this->sentEnvelope($this->owner);
		[$ana] = $this->signersOf($envelope);

		$rejection = $this->rejectionOf(fn () => $this->corrections()->correctEmail($envelope, $ana->getId(), $email, $this->owner));

		$this->assertSame($expectedCode, $rejection->errorCode);
		$this->assertSame(422, $rejection->httpStatus);
		$this->assertCount(0, $this->transport->requests);
	}

	/** @return array<string, array{string, string}> */
	public static function invalidEmails(): array {
		return [
			'not an email' => ['ana-at-example', 'signer_email_invalid'],
			'same as before' => ['ANA@example.com', 'signer_email_unchanged'],
			'another signer' => ['bruno@example.com', 'signer_email_duplicate'],
		];
	}

	public function testRefusesToCorrectASignerWhoAlreadySigned(): void {
		$envelope = $this->sentEnvelope($this->owner);
		[$ana] = $this->signersOf($envelope);
		$ana->setStatus(SignerStatus::Signed->value);
		Server::get(SignerMapper::class)->update($ana);

		$this->assertSame('email_not_correctable', $this->rejectionOf(fn () => $this->corrections()->correctEmail($envelope, $ana->getId(), 'nova@example.com', $this->owner))->errorCode);
	}

	private function rejectionOf(callable $action): ActionRejected {
		try {
			$action();
		} catch (ActionRejected $rejection) {
			return $rejection;
		}
		$this->fail('Expected the action to be rejected');
	}

	private function corrections(): SignerCorrections {
		$settings = $this->zapSignSettings();
		$client = $this->zapSignClient($settings);
		$events = new EnvelopeEvents(Server::get(EventMapper::class), Server::get(IEventDispatcher::class));
		$message = new SignerMessage(Server::get(IUserManager::class), $settings);
		$reminders = new SignerReminders(Server::get(EnvelopeMapper::class), Server::get(SignerMapper::class), $client, $message, $events, $this->fixedClock(), new NullLogger());
		return new SignerCorrections(Server::get(EnvelopeMapper::class), Server::get(SignerMapper::class), $client, $message, $reminders, $events, $this->fixedClock(), new NullLogger());
	}
}
```

`tests/Integration/Action/SignerLinksTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Action;

use OCA\Assinaturas\Action\ActionRejected;
use OCA\Assinaturas\Action\SignerLinks;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\Event;
use OCA\Assinaturas\Db\EventMapper;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\SentEnvelopes;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class SignerLinksTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ZapSignDoubles;
	use SentEnvelopes;

	private const SIGN_URL = 'https://sandbox.app.zapsign.com.br/verificar/signer-secret';

	private string $owner;

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->owner = $this->createUser();
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testReturnsTheSignersLinkAndRecordsWhoCopiedIt(): void {
		$envelope = $this->sentEnvelope($this->owner);
		[$ana] = $this->signersOf($envelope);
		$this->transport->willRespond(200, $this->document($envelope));

		$url = $this->links()->link($envelope, $ana->getId(), $this->owner);

		$this->assertSame(self::SIGN_URL, $url);
		$events = Server::get(EventMapper::class)->findByEnvelope($envelope->getId());
		$this->assertSame([['link_copied', $ana->getId(), $this->owner, null]], array_map(fn (Event $event): array => [$event->getType(), $event->getSignerId(), $event->getActorUid(), $event->getDetail()], $events));
	}

	public function testRefusesALinkForAClosedEnvelope(): void {
		$envelope = $this->sentEnvelope($this->owner, EnvelopeStatus::Completed);
		[$ana] = $this->signersOf($envelope);

		$this->assertSame('link_unavailable', $this->rejectionOf(fn () => $this->links()->link($envelope, $ana->getId(), $this->owner))->errorCode);
		$this->assertCount(0, $this->transport->requests);
	}

	public function testReportsAnUnknownSigner(): void {
		$envelope = $this->sentEnvelope($this->owner);

		$this->assertSame('signer_not_found', $this->rejectionOf(fn () => $this->links()->link($envelope, 999999999, $this->owner))->errorCode);
	}

	/** @return array<string, mixed> */
	private function document(Envelope $envelope): array {
		$signers = array_map(fn ($signer): array => [
			'token' => $signer->getZapsignToken(),
			'email' => $signer->getEmail(),
			'status' => 'new',
			'sign_url' => $signer->getOrderGroup() === 1 ? self::SIGN_URL : 'https://sandbox.app.zapsign.com.br/verificar/other',
		], $this->signersOf($envelope));
		return ['token' => 'doc-' . $envelope->getUuid(), 'status' => 'pending', 'signers' => $signers, 'extra_docs' => []];
	}

	private function rejectionOf(callable $action): ActionRejected {
		try {
			$action();
		} catch (ActionRejected $rejection) {
			return $rejection;
		}
		$this->fail('Expected the action to be rejected');
	}

	private function links(): SignerLinks {
		return new SignerLinks(
			Server::get(SignerMapper::class),
			$this->zapSignClient($this->zapSignSettings()),
			new EnvelopeEvents(Server::get(EventMapper::class), Server::get(IEventDispatcher::class)),
			$this->fixedClock(),
		);
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter 'SignerCorrectionsTest|SignerLinksTest'`
Expected: ERROR `Class "OCA\Assinaturas\Action\SignerCorrections" not found`.

- [ ] **Step 3: Implement**

`lib/Action/SignerCorrections.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Action;

use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\Signer;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Db\SignerStatus;
use OCA\Assinaturas\Send\SignerMessage;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use OCA\Assinaturas\ZapSign\ZapSignClient;
use OCP\AppFramework\Http;
use OCP\AppFramework\Utility\ITimeFactory;
use Psr\Log\LoggerInterface;

/** Fixes a wrong or bounced address before the signer signs, then invites the new address when it is their turn. */
final class SignerCorrections {
	/** Set by the Plan 2b spike (S2): true because updating the email does not send an invitation by itself. */
	public const RELEASE_AFTER_EMAIL_UPDATE = true;
	private const MAX_EMAIL_LENGTH = 320;
	private const OPEN_ENVELOPE_STATUSES = [EnvelopeStatus::Pending, EnvelopeStatus::Expired];
	private const OPEN_SIGNER_STATUSES = [SignerStatus::Pending, SignerStatus::Viewed];

	public function __construct(
		private EnvelopeMapper $envelopeMapper,
		private SignerMapper $signerMapper,
		private ZapSignClient $client,
		private SignerMessage $signerMessage,
		private SignerReminders $reminders,
		private EnvelopeEvents $events,
		private ITimeFactory $timeFactory,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * @return bool whether the corrected address was invited now
	 * @throws ActionRejected
	 */
	public function correctEmail(Envelope $envelope, int $signerId, string $email, string $actorUid): bool {
		$email = mb_strtolower(trim($email));
		if (mb_strlen($email) > self::MAX_EMAIL_LENGTH || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
			throw new ActionRejected('signer_email_invalid', 'Each signer needs a valid email', Http::STATUS_UNPROCESSABLE_ENTITY);
		}
		$current = $this->envelopeMapper->findById($envelope->getId());
		$signers = $this->signerMapper->findByEnvelope($current->getId());
		$signer = $this->correctableSigner($current, $signers, $signerId, $email);
		try {
			$this->client->updateSignerEmail((string)$signer->getZapsignToken(), $email);
		} catch (ZapSignException $failure) {
			throw ActionRejected::provider($failure);
		}
		$now = $this->timeFactory->getTime();
		$signer->setEmail($email);
		$signer->setEmailBouncedAt(null);
		$this->signerMapper->update($signer);
		$this->events->record($current->getId(), $signer->getId(), 'email_corrected', (string)$now, $now, [], $actorUid);
		return self::RELEASE_AFTER_EMAIL_UPDATE && $this->invite($current, $signer, $now);
	}

	/**
	 * @param list<Signer> $signers
	 * @throws ActionRejected
	 */
	private function correctableSigner(Envelope $envelope, array $signers, int $signerId, string $email): Signer {
		$signer = null;
		foreach ($signers as $candidate) {
			if ($candidate->getId() === $signerId) {
				$signer = $candidate;
			}
		}
		if ($signer === null) {
			throw new ActionRejected('signer_not_found', 'This signer is not part of the envelope', Http::STATUS_NOT_FOUND);
		}
		$isOpen = in_array($envelope->statusValue(), self::OPEN_ENVELOPE_STATUSES, true)
			&& in_array($signer->statusValue(), self::OPEN_SIGNER_STATUSES, true)
			&& $signer->getZapsignToken() !== null;
		if (!$isOpen) {
			throw new ActionRejected('email_not_correctable', 'Only a signer who has not signed yet can get a new email');
		}
		if ($signer->getEmail() === $email) {
			throw new ActionRejected('signer_email_unchanged', 'This is already the signer\'s email', Http::STATUS_UNPROCESSABLE_ENTITY);
		}
		foreach ($signers as $other) {
			if ($other->getId() !== $signerId && $other->getEmail() === $email) {
				throw new ActionRejected('signer_email_duplicate', 'Each signer needs a different email', Http::STATUS_UNPROCESSABLE_ENTITY);
			}
		}
		return $signer;
	}

	private function invite(Envelope $envelope, Signer $signer, int $now): bool {
		$remindable = $this->reminders->remindable($envelope, $this->signerMapper->findByEnvelope($envelope->getId()));
		$isTheirTurn = array_filter($remindable, fn (Signer $candidate): bool => $candidate->getId() === $signer->getId()) !== [];
		if (!$isTheirTurn) {
			return false;
		}
		try {
			$this->client->releaseSigner((string)$signer->getZapsignToken(), $this->signerMessage->compose($envelope));
		} catch (ZapSignException $failure) {
			$this->logger->info('The corrected signer will be invited later', ['envelope' => $envelope->getUuid(), 'failure' => $failure::class]);
			return false;
		}
		$signer->setReleasedAt($signer->getReleasedAt() ?? $now);
		$signer->setLastReminderAt($now);
		$this->signerMapper->update($signer);
		return true;
	}
}
```

`lib/Action/SignerLinks.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Action;

use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Db\SignerStatus;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use OCA\Assinaturas\ZapSign\ZapSignClient;
use OCP\AppFramework\Http;
use OCP\AppFramework\Utility\ITimeFactory;

/**
 * The owner can hand a signer their link directly (e.g. over WhatsApp). The link is fetched
 * fresh, returned once, recorded as copied, and never stored or logged.
 */
final class SignerLinks {
	private const OPEN_SIGNER_STATUSES = [SignerStatus::Pending, SignerStatus::Viewed];

	public function __construct(
		private SignerMapper $signerMapper,
		private ZapSignClient $client,
		private EnvelopeEvents $events,
		private ITimeFactory $timeFactory,
	) {
	}

	/** @throws ActionRejected */
	public function link(Envelope $envelope, int $signerId, string $actorUid): string {
		$signer = null;
		foreach ($this->signerMapper->findByEnvelope($envelope->getId()) as $candidate) {
			if ($candidate->getId() === $signerId) {
				$signer = $candidate;
			}
		}
		if ($signer === null) {
			throw new ActionRejected('signer_not_found', 'This signer is not part of the envelope', Http::STATUS_NOT_FOUND);
		}
		$isOpen = $envelope->statusValue() === EnvelopeStatus::Pending
			&& in_array($signer->statusValue(), self::OPEN_SIGNER_STATUSES, true)
			&& $signer->getZapsignToken() !== null;
		if (!$isOpen) {
			throw new ActionRejected('link_unavailable', 'This signer has no open signing link');
		}
		try {
			$document = $this->client->getDocument((string)$envelope->getZapsignToken());
		} catch (ZapSignException $failure) {
			throw ActionRejected::provider($failure);
		}
		foreach ($document->signers as $providerSigner) {
			if ($providerSigner->token === $signer->getZapsignToken() && $providerSigner->signUrl !== null) {
				$now = $this->timeFactory->getTime();
				$this->events->record($envelope->getId(), $signer->getId(), 'link_copied', (string)$now, $now, [], $actorUid);
				return $providerSigner->signUrl;
			}
		}
		throw new ActionRejected('link_unavailable', 'ZapSign did not return a signing link', Http::STATUS_BAD_GATEWAY);
	}
}
```

`EnvelopeActionController`: inject `SignerCorrections $corrections` and `SignerLinks $links`, then add:
```php
	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'PUT', url: '/api/v1/envelopes/{uuid}/signers/{signerId}/email')]
	public function correctEmail(string $uuid, int $signerId, string $email = ''): JSONResponse {
		return $this->acting($uuid, function (Envelope $envelope) use ($signerId, $email): JSONResponse {
			$invited = $this->corrections->correctEmail($envelope, $signerId, $email, $this->access->currentUserId());
			return new JSONResponse($this->details->detail($envelope) + ['invited' => $invited]);
		});
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'POST', url: '/api/v1/envelopes/{uuid}/signers/{signerId}/link')]
	public function signLink(string $uuid, int $signerId): JSONResponse {
		return $this->acting($uuid, function (Envelope $envelope) use ($signerId): JSONResponse {
			$response = new JSONResponse(['signUrl' => $this->links->link($envelope, $signerId, $this->access->currentUserId())]);
			$response->addHeader('Cache-Control', 'no-store');
			return $response;
		});
	}
```

`docs/api.md`:
- Add both routes and their codes.
- State plainly that `/link` is the only route that returns a sign URL, for the owner only, and that each call is recorded.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'SignerCorrectionsTest|SignerLinksTest|EnvelopeActionControllerTest'`, then `tests/env/phpunit.sh`.
Expected: `OK`, and the full suite green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: correct a signer's email and hand the owner a signer's link"
```

---

### Task 7: Detect bounced emails

**Files:**
- Create: `lib/Webhook/BounceRecorder.php`
- Modify: `lib/Webhook/WebhookInbox.php`, `lib/Controller/WebhookController.php`, `docs/api.md`
- Test:
  - `tests/Integration/Webhook/BounceRecorderTest.php`
  - new cases in `tests/Integration/Webhook/WebhookControllerTest.php`

**Interfaces:**
- Consumes: the `email_bounce` payload from Task 1 (S1). The documented shape is `{email, token (SIGNER token), type, status, status_code, error, delivered: false, event_type: "email_bounce"}`.
- Consumes: `SignerMapper::findByZapsignToken`, `EnvelopeEvents`.
- Produces:
  - `BounceRecorder::record(string $signerToken, string $email): void`. It marks `email_bounced_at` once and records an `email_bounced` signer event, which Task 10 turns into a notification to the sender.
  - Stale bounces are ignored: those for an address the signer no longer has, and those for a signer who already signed or refused.
  - `WebhookInbox::accept(string $token, string $eventType = '', string $email = ''): void`.
    - `email_bounce`: `token` is a signer token, so the call goes to `BounceRecorder`, which is a DB write only.
    - Any other event type: the coalesced re-sync by document token, as before.
  - `WebhookController` reads `event_type` and `email` alongside `token`. Nothing else in the payload is used or logged.

If Task 1 showed a different key for the signer token, or a different `event_type` value, use the recorded ones. The fixture `tests/fixtures/zapsign/recorded-email-bounce.json` is the source of truth; the tests below read it.

- [ ] **Step 1: Write the failing tests**

`tests/Integration/Webhook/BounceRecorderTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Webhook;

use OCA\Assinaturas\Db\Event;
use OCA\Assinaturas\Db\EventMapper;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Db\SignerStatus;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\SentEnvelopes;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCA\Assinaturas\Webhook\BounceRecorder;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class BounceRecorderTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ZapSignDoubles;
	use SentEnvelopes;

	private string $owner;

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->owner = $this->createUser();
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testMarksTheSignerOnceAndRecordsTheBounce(): void {
		$envelope = $this->sentEnvelope($this->owner);
		[$ana] = $this->signersOf($envelope);

		$this->recorder()->record((string)$ana->getZapsignToken(), 'ANA@example.com');
		$this->now += 60;
		$this->recorder()->record((string)$ana->getZapsignToken(), 'ana@example.com');

		$this->assertSame($this->now - 60, $this->signersOf($envelope)[0]->getEmailBouncedAt());
		$events = Server::get(EventMapper::class)->findByEnvelope($envelope->getId());
		$this->assertSame([['email_bounced', $ana->getId()]], array_map(fn (Event $event): array => [$event->getType(), $event->getSignerId()], $events));
	}

	public function testIgnoresABounceForAnAddressTheSignerNoLongerHas(): void {
		$envelope = $this->sentEnvelope($this->owner);
		[$ana] = $this->signersOf($envelope);

		$this->recorder()->record((string)$ana->getZapsignToken(), 'old-address@example.com');

		$this->assertNull($this->signersOf($envelope)[0]->getEmailBouncedAt());
	}

	public function testIgnoresABounceForASignerWhoAlreadySigned(): void {
		$envelope = $this->sentEnvelope($this->owner);
		[$ana] = $this->signersOf($envelope);
		$ana->setStatus(SignerStatus::Signed->value);
		Server::get(SignerMapper::class)->update($ana);

		$this->recorder()->record((string)$ana->getZapsignToken(), 'ana@example.com');

		$this->assertNull($this->signersOf($envelope)[0]->getEmailBouncedAt());
	}

	public function testIgnoresAnUnknownSigner(): void {
		$this->recorder()->record('someone-elses-signer', 'x@example.com');

		$this->addToAssertionCount(1);
	}

	private function recorder(): BounceRecorder {
		return new BounceRecorder(
			Server::get(SignerMapper::class),
			new EnvelopeEvents(Server::get(EventMapper::class), Server::get(IEventDispatcher::class)),
			$this->fixedClock(),
		);
	}
}
```

In `tests/Integration/Webhook/WebhookControllerTest.php`:
- Extend its request mock so that `getParam` also serves `event_type` and `email` from a per-test payload array.
- Add `testRecordsABounceWithoutQueueingASync`:
  - Use the recorded fixture with its `token` replaced by a real signer token of the test envelope, and its `email` by that signer's email.
  - Call `receive()`.
  - Assert 200, that the signer's `email_bounced_at` is set, and that `$this->queuedJobs === []`.
  - The test needs a signer with a token. Give the existing envelope in `setUp` one via `SignerMapper`, following the file's pattern.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter 'BounceRecorderTest|WebhookControllerTest'`
Expected: ERROR `Class "OCA\Assinaturas\Webhook\BounceRecorder" not found`.

- [ ] **Step 3: Implement**

`lib/Webhook/BounceRecorder.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Webhook;

use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Db\SignerStatus;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Utility\ITimeFactory;

/**
 * ZapSign reports undeliverable invitations only by webhook: a re-fetch never shows them. The
 * secret header proves the sender; the payload's signer token and address are the only fields used.
 */
final class BounceRecorder {
	private const OPEN_SIGNER_STATUSES = [SignerStatus::Pending, SignerStatus::Viewed];

	public function __construct(
		private SignerMapper $signerMapper,
		private EnvelopeEvents $events,
		private ITimeFactory $timeFactory,
	) {
	}

	public function record(string $signerToken, string $email): void {
		if ($signerToken === '') {
			return;
		}
		try {
			$signer = $this->signerMapper->findByZapsignToken($signerToken);
		} catch (DoesNotExistException) {
			return;
		}
		$isStale = ($email !== '' && mb_strtolower(trim($email)) !== $signer->getEmail())
			|| !in_array($signer->statusValue(), self::OPEN_SIGNER_STATUSES, true)
			|| $signer->getEmailBouncedAt() !== null;
		if ($isStale) {
			return;
		}
		$now = $this->timeFactory->getTime();
		$signer->setEmailBouncedAt($now);
		$this->signerMapper->update($signer);
		$this->events->record($signer->getEnvelopeId(), $signer->getId(), 'email_bounced', (string)$now, $now);
	}
}
```

`lib/Webhook/WebhookInbox.php`:
- Inject `BounceRecorder $bounces` as the last constructor parameter.
- Change `accept` to:
```php
	public const BOUNCE_EVENT = 'email_bounce';

	public function accept(string $token, string $eventType = '', string $email = ''): void {
		if ($eventType === self::BOUNCE_EVENT) {
			$this->bounces->record($token, $email);
			return;
		}
		$this->queueSync($token);
	}
```
Move the existing body into `private function queueSync(string $documentToken): void`.

`lib/Controller/WebhookController::receive()`: after the size check, replace the token read with:
```php
		$token = $this->request->getParam('token');
		$eventType = $this->request->getParam('event_type');
		$email = $this->request->getParam('email');
		$this->inbox->accept(
			is_string($token) ? $token : '',
			is_string($eventType) ? $eventType : '',
			is_string($email) ? $email : '',
		);
```

`docs/api.md`: add the signer field `emailBouncedAt` (already present in the view), with a note that it is set by ZapSign's bounce webhook and cleared by an email correction.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'BounceRecorderTest|WebhookControllerTest|WebhookInbox'`, then `tests/env/phpunit.sh`.
Expected: `OK`, and the full suite green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: mark signers whose invitation bounced from ZapSign's webhook"
```

---

### Task 8: Admin delete of a sent envelope

**Files:**
- Create: `lib/Action/EnvelopeRemoval.php`, `lib/Controller/AdminController.php`
- Modify: `docs/api.md`
- Test: `tests/Integration/Action/EnvelopeRemovalTest.php`, `tests/Integration/Controller/AdminControllerTest.php`

**Interfaces:**
- Consumes: `EnvelopeMapper::deleteWhereStatus`, all mappers, `ZapSignClient::cancelDocument`, `EnvelopeAccess::mayAdminister`.
- Produces:
  - `EnvelopeRemoval::remove(Envelope $envelope, string $actorUid): void`:
    - A `pending` or `expired` envelope is cancelled at ZapSign first (notifying the signers). `ZapSignNotFound` counts as gone. Any other failure aborts with `provider_*` (502).
    - Then the envelope's local rows (fields, documents, signers, events, envelope) are deleted in one transaction, guarded on the status the envelope had when read.
    - Drive files are never touched.
    - An audit line is logged with the uuid and the actor.
    - `sending` and `finalizing` answer `envelope_busy` (409).
  - `AdminController`, with the route `DELETE /api/v1/admin/envelopes/{uuid}`:
    - 200 `{"deleted": true}`;
    - 403 `forbidden` for a non-admin;
    - 404 `not_found`.

- [ ] **Step 1: Write the failing tests**

`tests/Integration/Action/EnvelopeRemovalTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Action;

use OCA\Assinaturas\Action\ActionRejected;
use OCA\Assinaturas\Action\EnvelopeRemoval;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\EventMapper;
use OCA\Assinaturas\Db\FieldMapper;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\RecordingLogger;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\SentEnvelopes;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\Files\IRootFolder;
use OCP\IDBConnection;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class EnvelopeRemovalTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ZapSignDoubles;
	use SentEnvelopes;

	private string $owner;
	private RecordingLogger $logger;

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->logger = new RecordingLogger();
		$this->owner = $this->createUser();
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testCancelsAPendingEnvelopeThenRemovesItsRowsButNotTheFiles(): void {
		$envelope = $this->sentEnvelope($this->owner);
		$sourceFileId = Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId())[0]->getSourceFileId();
		$this->transport->willRespond(200, ['message' => 'ok']);

		$this->removal()->remove($envelope, 'admin');

		$this->assertTrue($this->transport->lastRequestJson()['notify_signer']);
		$this->assertGone($envelope);
		$this->assertNotNull(Server::get(IRootFolder::class)->getUserFolder($this->owner)->getFirstNodeById($sourceFileId));
		$this->assertStringContainsString('admin', $this->logger->serialized());
	}

	public function testRemovesAClosedEnvelopeWithoutCallingZapSign(): void {
		$envelope = $this->sentEnvelope($this->owner, EnvelopeStatus::Completed);

		$this->removal()->remove($envelope, 'admin');

		$this->assertCount(0, $this->transport->requests);
		$this->assertGone($envelope);
	}

	public function testTreatsADocumentZapSignNoLongerHasAsGone(): void {
		$envelope = $this->sentEnvelope($this->owner);
		$this->transport->willRespond(404, ['detail' => 'Not found.']);

		$this->removal()->remove($envelope, 'admin');

		$this->assertGone($envelope);
	}

	public function testKeepsEverythingWhenZapSignCannotCancel(): void {
		$envelope = $this->sentEnvelope($this->owner);
		$this->transport->willRespond(503, '');

		try {
			$this->removal()->remove($envelope, 'admin');
			$this->fail('Expected the removal to be rejected');
		} catch (ActionRejected $rejection) {
			$this->assertSame('provider_unreachable', $rejection->errorCode);
		}
		$this->assertSame(EnvelopeStatus::Pending, $this->reloaded($envelope)->statusValue());
	}

	public function testRefusesAnEnvelopeThatIsBeingProcessed(): void {
		$envelope = $this->sentEnvelope($this->owner, EnvelopeStatus::Sending);

		try {
			$this->removal()->remove($envelope, 'admin');
			$this->fail('Expected the removal to be rejected');
		} catch (ActionRejected $rejection) {
			$this->assertSame('envelope_busy', $rejection->errorCode);
		}
	}

	private function assertGone(Envelope $envelope): void {
		$this->assertSame([], Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId()));
		$this->assertSame([], Server::get(SignerMapper::class)->findByEnvelope($envelope->getId()));
		$this->assertSame([], Server::get(EventMapper::class)->findByEnvelope($envelope->getId()));
		try {
			Server::get(EnvelopeMapper::class)->findById($envelope->getId());
			$this->fail('Expected the envelope row to be gone');
		} catch (DoesNotExistException) {
			$this->addToAssertionCount(1);
		}
	}

	private function removal(): EnvelopeRemoval {
		return new EnvelopeRemoval(
			Server::get(EnvelopeMapper::class),
			Server::get(DocumentMapper::class),
			Server::get(SignerMapper::class),
			Server::get(FieldMapper::class),
			Server::get(EventMapper::class),
			$this->zapSignClient($this->zapSignSettings()),
			Server::get(IDBConnection::class),
			$this->logger,
		);
	}
}
```

`tests/Integration/Controller/AdminControllerTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Controller;

use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Controller\AdminController;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\AppFramework\Http;
use OCP\IGroupManager;
use OCP\IUserManager;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class AdminControllerTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;

	private string $owner;
	private string $uuid;

	protected function setUp(): void {
		parent::setUp();
		$this->owner = $this->createUser();
		$this->addToGroup($this->owner, SignersGroup::GROUP_ID);
		$file = $this->writeFile($this->owner, 'Contrato.pdf', self::minimalPdf());
		$this->uuid = Server::get(EnvelopeDrafts::class)->create($this->owner, 'Contrato', [$file->getId()])->getUuid();
	}

	protected function tearDown(): void {
		self::logout();
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testForbidsDeletionToAnOwnerWhoIsNotAdmin(): void {
		self::loginAsUser($this->owner);

		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller()->destroy($this->uuid)->getStatus());
	}

	public function testLetsAnAdminDeleteADraftOfSomeoneElse(): void {
		$admin = $this->createUser();
		Server::get(IGroupManager::class)->get('admin')->addUser(Server::get(IUserManager::class)->get($admin));
		self::loginAsUser($admin);

		$response = $this->controller()->destroy($this->uuid);

		$this->assertSame(Http::STATUS_OK, $response->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->destroy($this->uuid)->getStatus());
	}

	private function controller(): AdminController {
		return Server::get(AdminController::class);
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter 'EnvelopeRemovalTest|AdminControllerTest'`
Expected: ERROR `Class "OCA\Assinaturas\Action\EnvelopeRemoval" not found`.

- [ ] **Step 3: Implement**

`lib/Action/EnvelopeRemoval.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Action;

use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\EventMapper;
use OCA\Assinaturas\Db\FieldMapper;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use OCA\Assinaturas\ZapSign\Exception\ZapSignNotFound;
use OCA\Assinaturas\ZapSign\ZapSignClient;
use OCP\IDBConnection;
use Psr\Log\LoggerInterface;

/**
 * Admin-only removal. A live envelope is cancelled at ZapSign first so nobody keeps signing a
 * document we no longer track; ZapSign keeps its own record and signed files stay in Drive.
 */
final class EnvelopeRemoval {
	private const BUSY_STATUSES = [EnvelopeStatus::Sending, EnvelopeStatus::Finalizing];
	private const LIVE_STATUSES = [EnvelopeStatus::Pending, EnvelopeStatus::Expired];
	private const REMOVAL_REASON = 'Excluído por um administrador';

	public function __construct(
		private EnvelopeMapper $envelopeMapper,
		private DocumentMapper $documentMapper,
		private SignerMapper $signerMapper,
		private FieldMapper $fieldMapper,
		private EventMapper $eventMapper,
		private ZapSignClient $client,
		private IDBConnection $connection,
		private LoggerInterface $logger,
	) {
	}

	/** @throws ActionRejected */
	public function remove(Envelope $envelope, string $actorUid): void {
		$current = $this->envelopeMapper->findById($envelope->getId());
		$status = $current->statusValue();
		if (in_array($status, self::BUSY_STATUSES, true)) {
			throw new ActionRejected('envelope_busy', 'This envelope is being processed; try again in a few minutes');
		}
		if (in_array($status, self::LIVE_STATUSES, true) && $current->getZapsignToken() !== null) {
			$this->cancelAtZapSign((string)$current->getZapsignToken());
		}
		$this->deleteRows($current, $status);
		$this->logger->info('Envelope removed by an administrator', ['envelope' => $current->getUuid(), 'actor' => $actorUid]);
	}

	/** @throws ActionRejected */
	private function cancelAtZapSign(string $documentToken): void {
		try {
			$this->client->cancelDocument($documentToken, self::REMOVAL_REASON, true);
		} catch (ZapSignNotFound) {
		} catch (ZapSignException $failure) {
			throw ActionRejected::provider($failure);
		}
	}

	/** @throws ActionRejected */
	private function deleteRows(Envelope $envelope, EnvelopeStatus $status): void {
		$this->connection->beginTransaction();
		try {
			if (!$this->envelopeMapper->deleteWhereStatus($envelope->getId(), [$status])) {
				throw new ActionRejected('envelope_busy', 'This envelope changed while removing it; try again');
			}
			foreach ($this->documentMapper->findByEnvelope($envelope->getId()) as $document) {
				foreach ($this->fieldMapper->findByDocument($document->getId()) as $field) {
					$this->fieldMapper->delete($field);
				}
				$this->documentMapper->delete($document);
			}
			foreach ($this->signerMapper->findByEnvelope($envelope->getId()) as $signer) {
				$this->signerMapper->delete($signer);
			}
			foreach ($this->eventMapper->findByEnvelope($envelope->getId()) as $event) {
				$this->eventMapper->delete($event);
			}
			$this->connection->commit();
		} catch (\Throwable $failure) {
			$this->connection->rollBack();
			throw $failure;
		}
	}
}
```

`lib/Controller/AdminController.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Controller;

use OCA\Assinaturas\Access\EnvelopeAccess;
use OCA\Assinaturas\Action\ActionRejected;
use OCA\Assinaturas\Action\EnvelopeRemoval;
use OCA\Assinaturas\AppInfo\Application;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\FrontpageRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

/**
 * Admin endpoints. `NoAdminRequired` only lets the request reach us: the check against the
 * app's own policy happens here, so every refusal carries our JSON error shape.
 */
final class AdminController extends Controller {
	public function __construct(
		IRequest $request,
		private EnvelopeAccess $access,
		private EnvelopeRemoval $removal,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'DELETE', url: '/api/v1/admin/envelopes/{uuid}')]
	public function destroy(string $uuid): JSONResponse {
		if (!$this->access->mayAdminister()) {
			return self::forbidden();
		}
		$envelope = $this->access->readable($uuid);
		if ($envelope === null) {
			return new JSONResponse(['error' => 'not_found', 'message' => 'Envelope not found'], Http::STATUS_NOT_FOUND);
		}
		try {
			$this->removal->remove($envelope, $this->access->currentUserId());
		} catch (ActionRejected $rejection) {
			return new JSONResponse(['error' => $rejection->errorCode, 'message' => $rejection->getMessage()], $rejection->httpStatus);
		}
		return new JSONResponse(['deleted' => true]);
	}

	private static function forbidden(): JSONResponse {
		return new JSONResponse(['error' => 'forbidden', 'message' => 'You are not allowed to do this'], Http::STATUS_FORBIDDEN);
	}
}
```

`docs/api.md`: add an "Admin" section with this route and `envelope_busy` (409).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'EnvelopeRemovalTest|AdminControllerTest'`, then `tests/env/phpunit.sh`.
Expected: `OK`, and the full suite green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: let admins remove an envelope after cancelling it at ZapSign"
```

---

### Task 9: Downloads — signed file, original as sent, activity report

**Files:**
- Create: `lib/Download/DownloadedPdf.php`, `lib/Download/EnvelopeDownloads.php`
- Modify:
  - `lib/Controller/EnvelopeActionController.php`: read-level routes.
  - `lib/Storage/SignedFileDownloader.php`: only if Task 1 (S4) found another host for `original_file`.
  - `docs/api.md`
- Test: `tests/Integration/Download/EnvelopeDownloadsTest.php`

**Interfaces:**
- Consumes:
  - `SignedFileDownloader::download(string): string` (the allowlisted host, no redirects);
  - `ZapSignClient::getDocument`, whose `originalFileUrl`/`signedFileUrl` come on the main document and on each extra document;
  - `ZapSignClient::getActivityLog(): ActivityLogPdf{contentType, bytes}`;
  - `IRootFolder`.
- Produces:
  - `DownloadedPdf(string $filename, string $bytes)`, readonly.
  - `EnvelopeDownloads`:
    - `signedFile(Envelope $envelope, int $documentId): DownloadedPdf` reads the Drive copy when it exists. Otherwise it re-fetches from ZapSign, for completed envelopes only.
    - `originalFile(Envelope $envelope, int $documentId): DownloadedPdf` returns the exact bytes ZapSign received.
    - `activityReport(Envelope $envelope): DownloadedPdf`
  - Routes: `GET`, readers only (owner or admin), `#[NoCSRFRequired]` so the browser can follow a plain link. Each answers `application/pdf` with a download filename.
    - `/api/v1/envelopes/{uuid}/documents/{documentId}/signed`
    - `/api/v1/envelopes/{uuid}/documents/{documentId}/original`
    - `/api/v1/envelopes/{uuid}/activity-report`
  - Error codes:

    | Code | Status |
    |---|---|
    | `document_not_found` | 404 |
    | `not_signed_yet` | 409 |
    | `not_sent` | 409 |
    | `download_failed` | 502 |
    | `provider_*` | 502 |

  - Filenames:

    | Download | Filename |
    |---|---|
    | Signed | `<stem> (assinado).pdf`, or the Drive file's name |
    | Original | the source file's name |
    | Activity report | `<title> - relatório de atividades.pdf` |

- [ ] **Step 1: Write the failing tests**

`tests/Integration/Download/EnvelopeDownloadsTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Download;

use OCA\Assinaturas\Action\ActionRejected;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Download\EnvelopeDownloads;
use OCA\Assinaturas\Storage\SignedFileDownloader;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\SentEnvelopes;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\Files\IRootFolder;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class EnvelopeDownloadsTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ZapSignDoubles;
	use SentEnvelopes;

	private const FILE_HOST = 'https://zapsign.s3.amazonaws.com/sandbox/';

	private string $owner;

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->owner = $this->createUser();
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testServesTheSignedCopyFromDrive(): void {
		$envelope = $this->sentEnvelope($this->owner, EnvelopeStatus::Completed);
		$document = $this->mainDocument($envelope);
		$signed = $this->writeFile($this->owner, 'Contratos/Contrato (assinado).pdf', "%PDF-1.7\nassinado");
		$document->setSignedFileId($signed->getId());
		Server::get(DocumentMapper::class)->update($document);

		$download = $this->downloads()->signedFile($envelope, $document->getId());

		$this->assertSame('Contrato (assinado).pdf', $download->filename);
		$this->assertSame("%PDF-1.7\nassinado", $download->bytes);
		$this->assertCount(0, $this->transport->requests);
	}

	public function testFetchesTheSignedCopyFromZapSignWhenDriveHasNone(): void {
		$envelope = $this->sentEnvelope($this->owner, EnvelopeStatus::Completed);
		$this->transport->willRespond(200, $this->providerDocument($envelope))->willRespond(200, "%PDF-1.7\nassinado remoto");

		$download = $this->downloads()->signedFile($envelope, $this->mainDocument($envelope)->getId());

		$this->assertSame("%PDF-1.7\nassinado remoto", $download->bytes);
		$this->assertStringEndsWith(' (assinado).pdf', $download->filename);
		$this->assertFalse($this->transport->requests[1]->followRedirects());
	}

	public function testRefusesASignedCopyBeforeCompletion(): void {
		$envelope = $this->sentEnvelope($this->owner);

		$this->assertSame('not_signed_yet', $this->rejectionOf(fn () => $this->downloads()->signedFile($envelope, $this->mainDocument($envelope)->getId()))->errorCode);
	}

	public function testServesTheOriginalExactlyAsSent(): void {
		$envelope = $this->sentEnvelope($this->owner);
		$this->transport->willRespond(200, $this->providerDocument($envelope))->willRespond(200, "%PDF-1.7\noriginal");

		$download = $this->downloads()->originalFile($envelope, $this->mainDocument($envelope)->getId());

		$this->assertSame("%PDF-1.7\noriginal", $download->bytes);
		$this->assertSame(basename($this->mainDocument($envelope)->getSourcePath()), $download->filename);
	}

	public function testServesTheActivityReport(): void {
		$envelope = $this->sentEnvelope($this->owner);
		$this->transport->willRespond(200, "%PDF-1.7\natividades", ['content-type' => 'application/pdf']);

		$download = $this->downloads()->activityReport($envelope);

		$this->assertSame('Contrato de serviços - relatório de atividades.pdf', $download->filename);
		$this->assertSame("%PDF-1.7\natividades", $download->bytes);
	}

	public function testReportsAnActivityReportZapSignRefuses(): void {
		$envelope = $this->sentEnvelope($this->owner);
		$this->transport->willRespond(403, 'Access denied');

		$rejection = $this->rejectionOf(fn () => $this->downloads()->activityReport($envelope));

		$this->assertSame('provider_access_denied', $rejection->errorCode);
		$this->assertSame(502, $rejection->httpStatus);
	}

	public function testReportsADocumentOfAnotherEnvelope(): void {
		$envelope = $this->sentEnvelope($this->owner);

		$this->assertSame('document_not_found', $this->rejectionOf(fn () => $this->downloads()->originalFile($envelope, 999999999))->errorCode);
	}

	private function mainDocument(Envelope $envelope): \OCA\Assinaturas\Db\Document {
		return Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId())[0];
	}

	/** @return array<string, mixed> */
	private function providerDocument(Envelope $envelope): array {
		return [
			'token' => 'doc-' . $envelope->getUuid(),
			'status' => 'signed',
			'original_file' => self::FILE_HOST . 'original.pdf?X-Amz-Signature=x',
			'signed_file' => self::FILE_HOST . 'signed.pdf?X-Amz-Signature=x',
			'signers' => [],
			'extra_docs' => [],
		];
	}

	private function rejectionOf(callable $action): ActionRejected {
		try {
			$action();
		} catch (ActionRejected $rejection) {
			return $rejection;
		}
		$this->fail('Expected the download to be rejected');
	}

	private function downloads(): EnvelopeDownloads {
		return new EnvelopeDownloads(
			Server::get(DocumentMapper::class),
			Server::get(IRootFolder::class),
			$this->zapSignClient($this->zapSignSettings()),
			new SignedFileDownloader($this->transport),
		);
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter EnvelopeDownloadsTest`
Expected: ERROR `Class "OCA\Assinaturas\Download\EnvelopeDownloads" not found`.

- [ ] **Step 3: Implement**

`lib/Download/DownloadedPdf.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Download;

final class DownloadedPdf {
	public function __construct(
		public readonly string $filename,
		#[\SensitiveParameter] public readonly string $bytes,
	) {
	}
}
```

`lib/Download/EnvelopeDownloads.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Download;

use OCA\Assinaturas\Action\ActionRejected;
use OCA\Assinaturas\Db\Document;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Storage\SignedFileDownloader;
use OCA\Assinaturas\Storage\SignedFileUnavailable;
use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use OCA\Assinaturas\ZapSign\Model\ZapSignDocument;
use OCA\Assinaturas\ZapSign\ZapSignClient;
use OCP\AppFramework\Http;
use OCP\Files\File;
use OCP\Files\IRootFolder;
use OCP\Files\NotPermittedException;

/** Files a reader can take away. ZapSign's file URLs are fetched server-side and never handed out. */
final class EnvelopeDownloads {
	private const SIGNED_SUFFIX = ' (assinado).pdf';
	private const ACTIVITY_REPORT_SUFFIX = ' - relatório de atividades.pdf';
	private const PDF_EXTENSION_PATTERN = '/\.pdf$/i';

	public function __construct(
		private DocumentMapper $documentMapper,
		private IRootFolder $rootFolder,
		private ZapSignClient $client,
		private SignedFileDownloader $downloader,
	) {
	}

	/** @throws ActionRejected */
	public function signedFile(Envelope $envelope, int $documentId): DownloadedPdf {
		$document = $this->documentOf($envelope, $documentId);
		$driveCopy = $this->driveCopy($envelope, $document);
		if ($driveCopy !== null) {
			return $driveCopy;
		}
		if ($envelope->statusValue() !== EnvelopeStatus::Completed) {
			throw new ActionRejected('not_signed_yet', 'This document is not signed by everyone yet');
		}
		$url = self::fileUrl($this->providerDocument($envelope), $document, true);
		return new DownloadedPdf(self::stem($document) . self::SIGNED_SUFFIX, $this->fetch($url));
	}

	/** @throws ActionRejected */
	public function originalFile(Envelope $envelope, int $documentId): DownloadedPdf {
		$document = $this->documentOf($envelope, $documentId);
		if ($document->getZapsignToken() === null) {
			throw new ActionRejected('not_sent', 'This document was not sent to ZapSign');
		}
		$url = self::fileUrl($this->providerDocument($envelope), $document, false);
		return new DownloadedPdf(basename($document->getSourcePath()), $this->fetch($url));
	}

	/** @throws ActionRejected */
	public function activityReport(Envelope $envelope): DownloadedPdf {
		if ($envelope->getZapsignToken() === null) {
			throw new ActionRejected('not_sent', 'This envelope was not sent to ZapSign');
		}
		try {
			$report = $this->client->getActivityLog((string)$envelope->getZapsignToken());
		} catch (ZapSignException $failure) {
			throw ActionRejected::provider($failure);
		}
		return new DownloadedPdf($envelope->getTitle() . self::ACTIVITY_REPORT_SUFFIX, $report->bytes);
	}

	/** @throws ActionRejected */
	private function documentOf(Envelope $envelope, int $documentId): Document {
		foreach ($this->documentMapper->findByEnvelope($envelope->getId()) as $document) {
			if ($document->getId() === $documentId) {
				return $document;
			}
		}
		throw new ActionRejected('document_not_found', 'This document is not part of the envelope', Http::STATUS_NOT_FOUND);
	}

	private function driveCopy(Envelope $envelope, Document $document): ?DownloadedPdf {
		if ($document->getSignedFileId() === null) {
			return null;
		}
		$node = $this->rootFolder->getUserFolder($envelope->getOwnerUid())->getFirstNodeById($document->getSignedFileId());
		if (!$node instanceof File) {
			return null;
		}
		try {
			return new DownloadedPdf($node->getName(), $node->getContent());
		} catch (NotPermittedException) {
			return null;
		}
	}

	/** @throws ActionRejected */
	private function providerDocument(Envelope $envelope): ZapSignDocument {
		try {
			return $this->client->getDocument((string)$envelope->getZapsignToken());
		} catch (ZapSignException $failure) {
			throw ActionRejected::provider($failure);
		}
	}

	/** @throws ActionRejected */
	private function fetch(#[\SensitiveParameter] ?string $url): string {
		if ($url === null) {
			throw new ActionRejected('download_failed', 'ZapSign has no file for this document yet', Http::STATUS_BAD_GATEWAY);
		}
		try {
			return $this->downloader->download($url);
		} catch (SignedFileUnavailable) {
			throw new ActionRejected('download_failed', 'The file could not be downloaded from ZapSign', Http::STATUS_BAD_GATEWAY);
		}
	}

	private static function fileUrl(#[\SensitiveParameter] ZapSignDocument $providerDocument, Document $document, bool $signed): ?string {
		if ($document->getZapsignToken() === $providerDocument->token) {
			return $signed ? $providerDocument->signedFileUrl : $providerDocument->originalFileUrl;
		}
		foreach ($providerDocument->extraDocuments as $extraDocument) {
			if ($extraDocument->token === $document->getZapsignToken()) {
				return $signed ? $extraDocument->signedFileUrl : $extraDocument->originalFileUrl;
			}
		}
		return null;
	}

	private static function stem(Document $document): string {
		return (string)preg_replace(self::PDF_EXTENSION_PATTERN, '', basename($document->getSourcePath()));
	}
}
```

`EnvelopeActionController`:
- Inject `EnvelopeDownloads $downloads`.
- Add a read-level guard next to `acting()`:
```php
	/** @param callable(Envelope): DownloadedPdf $download */
	private function downloading(string $uuid, callable $download): Response {
		$envelope = $this->access->readable($uuid);
		if ($envelope === null) {
			return new JSONResponse(['error' => 'not_found', 'message' => 'Envelope not found'], Http::STATUS_NOT_FOUND);
		}
		try {
			$pdf = $download($envelope);
		} catch (ActionRejected $rejection) {
			return self::rejected($rejection);
		}
		return new DataDownloadResponse($pdf->bytes, $pdf->filename, 'application/pdf');
	}
```
- Add three routes: `downloadSigned(string $uuid, int $documentId)`, `downloadOriginal(string $uuid, int $documentId)` and `downloadActivityReport(string $uuid)`. Give each `#[NoAdminRequired]`, `#[NoCSRFRequired]` and `#[FrontpageRoute(verb: 'GET', url: …)]`. Each calls `$this->downloading($uuid, fn (Envelope $envelope): DownloadedPdf => $this->downloads->…)`.
- Import `OCP\AppFramework\Http\Response`, `DataDownloadResponse` and `NoCSRFRequired`.

If Task 1 (S4) found `original_file` on a host other than `zapsign.s3.amazonaws.com`, add that exact host to `SignedFileDownloader`'s allowlist constant, and add an "accepts" row for it in `SignedFileDownloaderTest`.

`docs/api.md`: add the three GET routes, the codes, and a note that downloads are plain links (no CSRF token) for the owner and admins.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'EnvelopeDownloadsTest|EnvelopeActionControllerTest|SignedFileDownloaderTest'`, then `tests/env/phpunit.sh`.
Expected: `OK`, and the full suite green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: download signed files, originals as sent and the activity report"
```

---

### Task 10: Notifications to the sender

**Files:**
- Create:
  - `lib/Notification/Notifier.php`
  - `lib/Notification/SenderNotificationListener.php`
  - `l10n/pt_BR.json`, `l10n/pt_BR.js`
- Modify:
  - `lib/AppInfo/Application.php`: register the notifier and the listener.
  - `lib/Send/EnvelopeSender.php`: record `send_failed`, and inject `EnvelopeEvents` as the last constructor parameter. Update every `new EnvelopeSender(` in `tests/`.
  - `lib/Sync/EnvelopeCompletion.php`: record `save_failed`.
- Test:
  - `tests/Integration/Notification/NotifierTest.php`
  - `tests/Integration/Notification/SenderNotificationListenerTest.php`
  - one new test each in `EnvelopeSenderTest` and `EnvelopeCompletionTest`

**Interfaces:**
- Consumes: `EnvelopeEventRecorded` (Task 2); the `refused` envelope-level event with detail `reason`; the `email_bounced` signer event (Task 7).
- Produces:
  - `SenderNotificationListener`, which implements `IEventListener`. On an `EnvelopeEventRecorded` of type `completed`, `refused`, `expired`, `send_failed` or `save_failed` (envelope-level, `signerId === null`), or `email_bounced` (signer-level), it notifies the envelope owner.
    - Notification: app `assinaturas`, object `envelope`/`<uuid>`, subject = the event type.
    - Subject params: `['title' => <envelope title>, 'extra' => <refusal reason | bounced signer's name | ''>]`.
    - It skips owners that no longer exist.
  - `Notifier`, which implements `INotifier`. `getID() = 'assinaturas'`. `prepare()` renders the subjects `completed`, `refused`, `expired`, `send_failed`, `email_bounced`, `save_failed` and `provider_health` in the user's language, and throws `UnknownNotificationException` for anything else.
  - New timeline events:
    - `send_failed`: moment `(string)now`, detail `['error' => <our code>]`, recorded only when `markFailed`'s compare-and-swap wins.
    - `save_failed`: moment `'document:<id>'`, detail `['reason' => <our reason code>]`. Not recorded for a missing owner.

- [ ] **Step 1: Write the failing tests**

`tests/Integration/Notification/NotifierTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Notification;

use OCA\Assinaturas\Notification\Notifier;
use OCP\L10N\IFactory;
use OCP\Notification\IManager;
use OCP\Notification\INotification;
use OCP\Notification\UnknownNotificationException;
use OCP\Server;
use Test\TestCase;

final class NotifierTest extends TestCase {
	public function testRendersACompletionInPortuguese(): void {
		$prepared = $this->notifier()->prepare($this->notification('assinaturas', 'completed', ['title' => 'Contrato de serviços', 'extra' => '']), 'pt_BR');

		$this->assertSame('Todos assinaram "Contrato de serviços". Os arquivos assinados estão no seu Drive.', $prepared->getParsedSubject());
	}

	public function testShowsTheRefusalReasonAsTheMessage(): void {
		$prepared = $this->notifier()->prepare($this->notification('assinaturas', 'refused', ['title' => 'Contrato', 'extra' => 'Valores errados']), 'pt_BR');

		$this->assertSame('Valores errados', $prepared->getParsedMessage());
	}

	public function testRendersInEnglishForOtherLanguages(): void {
		$prepared = $this->notifier()->prepare($this->notification('assinaturas', 'email_bounced', ['title' => 'Contrato', 'extra' => 'Ana Lima']), 'en');

		$this->assertSame('The invitation to Ana Lima for "Contrato" could not be delivered.', $prepared->getParsedSubject());
	}

	public function testRefusesAnotherAppsNotification(): void {
		$this->expectException(UnknownNotificationException::class);

		$this->notifier()->prepare($this->notification('files', 'completed', []), 'pt_BR');
	}

	public function testRefusesAnUnknownSubject(): void {
		$this->expectException(UnknownNotificationException::class);

		$this->notifier()->prepare($this->notification('assinaturas', 'something_else', []), 'pt_BR');
	}

	/** @param array<string, string> $parameters */
	private function notification(string $app, string $subject, array $parameters): INotification {
		return Server::get(IManager::class)->createNotification()
			->setApp($app)
			->setUser('someone')
			->setDateTime(new \DateTime())
			->setObject('envelope', '00000000-0000-4000-8000-000000000000')
			->setSubject($subject, $parameters);
	}

	private function notifier(): Notifier {
		return new Notifier(Server::get(IFactory::class));
	}
}
```

`tests/Integration/Notification/SenderNotificationListenerTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Notification;

use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Notification\SenderNotificationListener;
use OCA\Assinaturas\Sync\EnvelopeEventRecorded;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\SentEnvelopes;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\IUserManager;
use OCP\Notification\IManager;
use OCP\Notification\INotification;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class SenderNotificationListenerTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ZapSignDoubles;
	use SentEnvelopes;

	private string $owner;
	/** @var list<INotification> */
	private array $sent = [];

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->owner = $this->createUser();
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testNotifiesTheOwnerWhenEveryoneSigned(): void {
		$envelope = $this->sentEnvelope($this->owner);

		$this->listener()->handle(new EnvelopeEventRecorded($envelope->getId(), null, 'completed', []));

		$this->assertCount(1, $this->sent);
		$this->assertSame($this->owner, $this->sent[0]->getUser());
		$this->assertSame('completed', $this->sent[0]->getSubject());
		$this->assertSame(['title' => 'Contrato de serviços', 'extra' => ''], $this->sent[0]->getSubjectParameters());
		$this->assertSame($envelope->getUuid(), $this->sent[0]->getObjectId());
	}

	public function testCarriesTheRefusalReason(): void {
		$envelope = $this->sentEnvelope($this->owner);

		$this->listener()->handle(new EnvelopeEventRecorded($envelope->getId(), null, 'refused', ['reason' => 'Valores errados']));

		$this->assertSame('Valores errados', $this->sent[0]->getSubjectParameters()['extra']);
	}

	public function testNamesTheSignerWhoseInvitationBounced(): void {
		$envelope = $this->sentEnvelope($this->owner);
		[$ana] = $this->signersOf($envelope);

		$this->listener()->handle(new EnvelopeEventRecorded($envelope->getId(), $ana->getId(), 'email_bounced', []));

		$this->assertSame('Ana Lima', $this->sent[0]->getSubjectParameters()['extra']);
	}

	public function testStaysQuietForSignerProgressAndUnknownEnvelopes(): void {
		$envelope = $this->sentEnvelope($this->owner);
		[$ana] = $this->signersOf($envelope);

		$this->listener()->handle(new EnvelopeEventRecorded($envelope->getId(), $ana->getId(), 'refused', []));
		$this->listener()->handle(new EnvelopeEventRecorded($envelope->getId(), $ana->getId(), 'viewed', []));
		$this->listener()->handle(new EnvelopeEventRecorded(999999999, null, 'completed', []));

		$this->assertSame([], $this->sent);
	}

	private function listener(): SenderNotificationListener {
		$manager = $this->createMock(IManager::class);
		$manager->method('createNotification')->willReturnCallback(fn (): INotification => Server::get(IManager::class)->createNotification());
		$manager->method('notify')->willReturnCallback(function (INotification $notification): void {
			$this->sent[] = $notification;
		});
		return new SenderNotificationListener(
			Server::get(EnvelopeMapper::class),
			Server::get(SignerMapper::class),
			$manager,
			Server::get(IUserManager::class),
			$this->fixedClock(),
		);
	}
}
```

Add to `EnvelopeSenderTest`:
- `testRecordsASendFailureOnTheTimeline`. Make a send fail with a known code, for example `file_changed` by editing the file after placement, following the file's existing failure tests. Assert one `send_failed` event with detail `['error' => 'file_changed']`.

Add to `EnvelopeCompletionTest`:
- `testRecordsAFileThatCouldNotBeSaved`. Make the store fail with a `SignedFileSaveFailed`, following the file's existing failure test. Assert one `save_failed` event with detail `['reason' => <that reason>]`, and that no `save_failed` is recorded when the owner is missing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter 'NotifierTest|SenderNotificationListenerTest|EnvelopeSenderTest|EnvelopeCompletionTest'`
Expected: ERROR `Class "OCA\Assinaturas\Notification\Notifier" not found`, and failures on the two new timeline tests.

- [ ] **Step 3: Implement**

`lib/Notification/Notifier.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Notification;

use OCA\Assinaturas\AppInfo\Application;
use OCP\L10N\IFactory;
use OCP\Notification\INotification;
use OCP\Notification\INotifier;
use OCP\Notification\UnknownNotificationException;

final class Notifier implements INotifier {
	private const SUBJECTS = [
		'completed' => 'All signers signed "%1$s". The signed files are in your Drive.',
		'refused' => 'A signer refused "%1$s".',
		'expired' => 'The deadline for "%1$s" passed before everyone signed.',
		'send_failed' => 'Sending "%1$s" failed. Open it to try again or discard it.',
		'email_bounced' => 'The invitation to %2$s for "%1$s" could not be delivered.',
		'save_failed' => 'A signed file of "%1$s" could not be saved to your Drive.',
		'provider_health' => 'Assinaturas: the ZapSign connection is now "%1$s".',
	];
	private const SUBJECTS_WITH_MESSAGE = ['refused'];

	public function __construct(
		private IFactory $l10nFactory,
	) {
	}

	public function getID(): string {
		return Application::APP_ID;
	}

	public function getName(): string {
		return $this->l10nFactory->get(Application::APP_ID)->t('Signatures');
	}

	public function prepare(INotification $notification, string $languageCode): INotification {
		$template = self::SUBJECTS[$notification->getSubject()] ?? null;
		if ($notification->getApp() !== Application::APP_ID || $template === null) {
			throw new UnknownNotificationException();
		}
		$parameters = $notification->getSubjectParameters();
		$title = (string)($parameters['title'] ?? '');
		$extra = (string)($parameters['extra'] ?? '');
		$l10n = $this->l10nFactory->get(Application::APP_ID, $languageCode);
		$notification->setParsedSubject($l10n->t($template, [$title, $extra]));
		if ($extra !== '' && in_array($notification->getSubject(), self::SUBJECTS_WITH_MESSAGE, true)) {
			$notification->setParsedMessage($extra);
		}
		return $notification;
	}
}
```

`lib/Notification/SenderNotificationListener.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Notification;

use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Sync\EnvelopeEventRecorded;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IUserManager;
use OCP\Notification\IManager;

/**
 * Tells the sender about outcomes that need their attention. It runs once per timeline event,
 * because replayed events are never dispatched.
 *
 * @template-implements IEventListener<Event>
 */
final class SenderNotificationListener implements IEventListener {
	private const ENVELOPE_SUBJECTS = ['completed', 'refused', 'expired', 'send_failed', 'save_failed'];
	private const SIGNER_SUBJECTS = ['email_bounced'];
	private const OBJECT_TYPE = 'envelope';

	public function __construct(
		private EnvelopeMapper $envelopeMapper,
		private SignerMapper $signerMapper,
		private IManager $notifications,
		private IUserManager $userManager,
		private ITimeFactory $timeFactory,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof EnvelopeEventRecorded || !self::isNotified($event)) {
			return;
		}
		try {
			$envelope = $this->envelopeMapper->findById($event->envelopeId);
		} catch (DoesNotExistException) {
			return;
		}
		if (!$this->userManager->userExists($envelope->getOwnerUid())) {
			return;
		}
		$notification = $this->notifications->createNotification();
		$notification->setApp(Application::APP_ID)
			->setUser($envelope->getOwnerUid())
			->setDateTime((new \DateTime())->setTimestamp($this->timeFactory->getTime()))
			->setObject(self::OBJECT_TYPE, $envelope->getUuid())
			->setSubject($event->type, ['title' => $envelope->getTitle(), 'extra' => $this->extra($event)]);
		$this->notifications->notify($notification);
	}

	private static function isNotified(EnvelopeEventRecorded $event): bool {
		return $event->signerId === null
			? in_array($event->type, self::ENVELOPE_SUBJECTS, true)
			: in_array($event->type, self::SIGNER_SUBJECTS, true);
	}

	private function extra(EnvelopeEventRecorded $event): string {
		if ($event->signerId === null) {
			return (string)($event->detail['reason'] ?? '');
		}
		foreach ($this->signerMapper->findByEnvelope($event->envelopeId) as $signer) {
			if ($signer->getId() === $event->signerId) {
				return $signer->getName();
			}
		}
		return '';
	}
}
```

`lib/AppInfo/Application::register()`: add
```php
		$context->registerNotifierService(Notifier::class);
		$context->registerEventListener(EnvelopeEventRecorded::class, SenderNotificationListener::class);
```

`l10n/pt_BR.json`:
```json
{ "translations": {
    "Signatures" : "Assinaturas",
    "All signers signed \"%1$s\". The signed files are in your Drive." : "Todos assinaram \"%1$s\". Os arquivos assinados estão no seu Drive.",
    "A signer refused \"%1$s\"." : "Um signatário recusou \"%1$s\".",
    "The deadline for \"%1$s\" passed before everyone signed." : "O prazo de \"%1$s\" terminou antes de todos assinarem.",
    "Sending \"%1$s\" failed. Open it to try again or discard it." : "O envio de \"%1$s\" falhou. Abra para tentar novamente ou descartar.",
    "The invitation to %2$s for \"%1$s\" could not be delivered." : "O convite para %2$s em \"%1$s\" não pôde ser entregue.",
    "A signed file of \"%1$s\" could not be saved to your Drive." : "Um arquivo assinado de \"%1$s\" não pôde ser salvo no seu Drive.",
    "Assinaturas: the ZapSign connection is now \"%1$s\"." : "Assinaturas: a conexão com a ZapSign agora está \"%1$s\"."
},"pluralForm" :"nplurals=2; plural=(n > 1);"
}
```
`l10n/pt_BR.js`: the same pairs in `OC.L10N.register("assinaturas", { … }, "nplurals=2; plural=(n > 1);");`.

`lib/Send/EnvelopeSender::markFailed()`: after the compare-and-swap wins and before the log line, add
```php
		$this->events->record($envelope->getId(), null, 'send_failed', (string)$now, $now, ['error' => $errorCode]);
```

`lib/Sync/EnvelopeCompletion::markSaveFailed()`: after updating the document, add
```php
		$now = $this->timeFactory->getTime();
		$this->events->record($envelope->getId(), null, 'save_failed', 'document:' . $document->getId(), $now, ['reason' => $reason]);
```
`giveUpOnMissingOwner()` stays silent: there is nobody to notify.

- [ ] **Step 4: Rebuild the env and run the tests**

Run: `tests/env/reset.sh && tests/env/phpunit.sh --filter 'NotifierTest|SenderNotificationListenerTest|EnvelopeSenderTest|EnvelopeCompletionTest'`, then `tests/env/phpunit.sh`.
Expected: `OK`, and the full suite green. The reset is needed for the new `l10n/` files.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: notify senders about completions, refusals, expiries, bounces and failures"
```

---

### Task 11: Admin status — provider health, usage, counters

**Files:**
- Create:
  - `lib/Ops/Counters.php`
  - `lib/Ops/ProviderHealth.php`
  - `lib/Ops/ProviderHealthJob.php`
  - `lib/Ops/UsageReport.php`
- Modify:
  - `lib/Db/EnvelopeMapper.php`: usage counts.
  - `lib/Webhook/WebhookRegistrar.php`: `registeredTypes()`.
  - `lib/ZapSign/CallMonitor.php`: count 429s. It takes `Counters`; update every `new CallMonitor(` in `tests/`, including `ZapSignDoubles` and `ZapSignClientTestCase`, to pass `new Counters(<an in-memory IAppConfig>)`.
  - `lib/Controller/WebhookController.php`: count bad secrets.
  - `lib/Send/EnvelopeSender.php`: count send failures by code.
  - `lib/Controller/AdminController.php`: `status`, `resetCounters`.
  - `appinfo/info.xml`: version `0.3.0`, and register `ProviderHealthJob`.
  - `docs/api.md`
- Test:
  - `tests/Unit/Ops/CountersTest.php`
  - `tests/Unit/Ops/ProviderHealthTest.php`
  - `tests/Integration/Ops/UsageReportTest.php`
  - new cases in `AdminControllerTest`

**Interfaces:**
- Produces:
  - `Counters(IAppConfig)`:
    - constants `WEBHOOK_BAD_SECRET = 'webhook_bad_secret'`, `PROVIDER_RATE_LIMITED = 'provider_rate_limited'`, `SEND_FAILED_PREFIX = 'send_failed_'`;
    - `increment(string $name): void`, `all(): array<string, int>`, `reset(): void`.
    - Keys are stored as `counter_<name>`, with an index `counter_names`. Counts are soft: read-modify-write, not atomic.
  - `ProviderHealth(ZapSignClient, ZapSignSettings, ICacheFactory, IAppConfig, IManager, IGroupManager, ITimeFactory)`:
    - constants `STATE_OK`, `STATE_PLAN_REQUIRED`, `STATE_ACCESS_DENIED`, `STATE_UNREACHABLE`, `STATE_NOT_CONFIGURED`;
    - `current(bool $refresh = false): array{state: string, checkedAt: int, plan: ?array{name: string, credits: int, status: string, currentPeriodEnd: ?string}}`, cached for 600 s. On a state change it notifies every admin once with subject `provider_health`. On the very first check it notifies only when the state is not `ok`.
  - `ProviderHealthJob`: a `TimedJob` running every 3600 s that calls `current(true)`.
  - `UsageReport(EnvelopeMapper, DeadlineCalculator, ITimeFactory)`:
    - `thisMonth(): array{monthStart: int, sent: int, completed: int, closedButBilled: int, staleSyncs: int}`. The month starts in the instance timezone. "Stale" means in flight and not synced for more than 24 h.
  - `EnvelopeMapper`: `countSentSince(int $from): int`, `countCompletedSince(int $from): int`, `countClosedBilledSince(int $from): int`, `countStaleSyncs(int $syncedBefore): int`.
  - `WebhookRegistrar::registeredTypes(): list<string>`: the type names we registered, from the stored ids.
  - Routes, admins only (403 `forbidden` otherwise):
    - `GET /api/v1/admin/status` → `{environment, configured, companyName, health, webhooks, usage, counters, outOfOrderSigningMustBeBlocked: true}`
    - `POST /api/v1/admin/counters/reset` → `{"counters": {}}`

**Never let a test reach the real ZapSign.** The local test instance may hold Patrick's sandbox token. Test `ProviderHealth` with the fake transport, and in `AdminControllerTest` only assert the 403 paths and the counters reset.

- [ ] **Step 1: Write the failing tests**

`tests/Unit/Ops/CountersTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\Ops;

use OCA\Assinaturas\Ops\Counters;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use PHPUnit\Framework\TestCase;

final class CountersTest extends TestCase {
	use ZapSignDoubles;

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
	}

	public function testCountsByNameAndResets(): void {
		$counters = new Counters($this->inMemoryAppConfig());

		$counters->increment(Counters::WEBHOOK_BAD_SECRET);
		$counters->increment(Counters::WEBHOOK_BAD_SECRET);
		$counters->increment(Counters::SEND_FAILED_PREFIX . 'file_changed');

		$this->assertSame([Counters::WEBHOOK_BAD_SECRET => 2, 'send_failed_file_changed' => 1], $counters->all());
		$counters->reset();
		$this->assertSame([], $counters->all());
	}
}
```

`tests/Unit/Ops/ProviderHealthTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\Ops;

use OC\Memcache\ArrayCache;
use OCA\Assinaturas\Ops\ProviderHealth;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\ZapSign\ZapSignSettings;
use OCP\ICacheFactory;
use OCP\IGroup;
use OCP\IGroupManager;
use OCP\IUser;
use OCP\Notification\IManager;
use OCP\Notification\INotification;
use Test\TestCase;

final class ProviderHealthTest extends TestCase {
	use ZapSignDoubles;

	private ArrayCache $cache;
	/** @var list<array{string, string, array<string, string>}> */
	private array $notified = [];

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->cache = new ArrayCache('');
	}

	public function testReportsAHealthyConnectionWithThePlan(): void {
		$this->transport->willRespond(200, ['results' => [], 'next' => null])
			->willRespond(200, ['name' => 'Parceiros', 'number_of_credits' => 100, 'status' => 'active', 'current_period_end' => null]);

		$health = $this->health()->current();

		$this->assertSame(ProviderHealth::STATE_OK, $health['state']);
		$this->assertSame('Parceiros', $health['plan']['name']);
		$this->assertSame([], $this->notified);
	}

	/** @dataProvider failures */
	public function testClassifiesAFailingConnection(int $status, string $expectedState): void {
		$this->transport->willRespond($status, ['detail' => 'x'])->willRespond($status, ['detail' => 'x'])->willRespond($status, ['detail' => 'x']);

		$this->assertSame($expectedState, $this->health()->current()['state']);
	}

	/** @return array<string, array{int, string}> */
	public static function failures(): array {
		return [
			'no plan' => [402, ProviderHealth::STATE_PLAN_REQUIRED],
			'wrong environment token' => [403, ProviderHealth::STATE_ACCESS_DENIED],
			'server down' => [500, ProviderHealth::STATE_UNREACHABLE],
		];
	}

	public function testReportsAMissingToken(): void {
		$this->appConfigValues[ZapSignSettings::KEY_API_TOKEN] = '';

		$this->assertSame(ProviderHealth::STATE_NOT_CONFIGURED, $this->health()->current()['state']);
		$this->assertCount(0, $this->transport->requests);
	}

	public function testServesTheCachedResultUntilARefresh(): void {
		$this->transport->willRespond(200, ['results' => [], 'next' => null])->willRespond(404, ['detail' => 'x']);
		$this->health()->current();

		$this->health()->current();

		$this->assertCount(2, $this->transport->requests);
	}

	public function testNotifiesAdminsOncePerStateChange(): void {
		$this->transport->willRespond(200, ['results' => [], 'next' => null])->willRespond(404, ['detail' => 'x']);
		$this->health()->current(true);
		$this->transport->willRespond(402, ['detail' => 'x']);
		$this->health()->current(true);
		$this->transport->willRespond(402, ['detail' => 'x']);
		$this->health()->current(true);

		$this->assertSame([['admin-1', 'provider_health', ['title' => ProviderHealth::STATE_PLAN_REQUIRED, 'extra' => '']]], $this->notified);
	}

	private function health(): ProviderHealth {
		$settings = $this->zapSignSettings();
		$cacheFactory = $this->createMock(ICacheFactory::class);
		$cacheFactory->method('createDistributed')->willReturn($this->cache);
		$admin = $this->createMock(IUser::class);
		$admin->method('getUID')->willReturn('admin-1');
		$adminGroup = $this->createMock(IGroup::class);
		$adminGroup->method('getUsers')->willReturn([$admin]);
		$groupManager = $this->createMock(IGroupManager::class);
		$groupManager->method('get')->willReturn($adminGroup);
		$manager = $this->createMock(IManager::class);
		$manager->method('createNotification')->willReturnCallback(fn (): INotification => \OCP\Server::get(IManager::class)->createNotification());
		$manager->method('notify')->willReturnCallback(function (INotification $notification): void {
			$this->notified[] = [$notification->getUser(), $notification->getSubject(), $notification->getSubjectParameters()];
		});
		return new ProviderHealth($this->zapSignClient($settings), $settings, $cacheFactory, $this->inMemoryAppConfig(), $manager, $groupManager, $this->fixedClock());
	}
}
```

`tests/Integration/Ops/UsageReportTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Ops;

use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Draft\DeadlineCalculator;
use OCA\Assinaturas\Ops\UsageReport;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\SentEnvelopes;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\IConfig;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class UsageReportTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ZapSignDoubles;
	use SentEnvelopes;

	private string $owner;

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->owner = $this->createUser();
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testCountsThisMonthsBilledAndCompletedEnvelopes(): void {
		$before = $this->report()->thisMonth();
		$this->sentEnvelope($this->owner);
		$completed = $this->sentEnvelope($this->owner, EnvelopeStatus::Completed);
		$completed->setCompletedAt($this->now);
		Server::get(EnvelopeMapper::class)->update($completed);
		$this->sentEnvelope($this->owner, EnvelopeStatus::Cancelled);

		$after = $this->report()->thisMonth();

		$this->assertSame($before['sent'] + 3, $after['sent']);
		$this->assertSame($before['completed'] + 1, $after['completed']);
		$this->assertSame($before['closedButBilled'] + 1, $after['closedButBilled']);
	}

	public function testCountsEnvelopesNotSyncedForADay(): void {
		$before = $this->report()->thisMonth()['staleSyncs'];
		$stale = $this->sentEnvelope($this->owner);
		$stale->setLastSyncedAt($this->now - 2 * 86400);
		Server::get(EnvelopeMapper::class)->update($stale);
		$fresh = $this->sentEnvelope($this->owner);
		$fresh->setLastSyncedAt($this->now - 60);
		Server::get(EnvelopeMapper::class)->update($fresh);

		$this->assertSame($before + 1, $this->report()->thisMonth()['staleSyncs']);
	}

	private function report(): UsageReport {
		return new UsageReport(Server::get(EnvelopeMapper::class), new DeadlineCalculator(Server::get(IConfig::class), $this->fixedClock()), $this->fixedClock());
	}
}
```

Add to `AdminControllerTest`:
- `testForbidsTheStatusToANonAdmin`: 403.
- `testLetsAnAdminResetTheCounters`: 200 `['counters' => []]`, after one `Counters::increment` done through `Server::get(Counters::class)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter 'CountersTest|ProviderHealthTest|UsageReportTest|AdminControllerTest'`
Expected: ERROR `Class "OCA\Assinaturas\Ops\Counters" not found`.

- [ ] **Step 3: Implement**

`lib/Ops/Counters.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Ops;

use OCA\Assinaturas\AppInfo\Application;
use OCP\IAppConfig;

/** Soft operational counters for the admin panel. Increments are read-modify-write, not atomic. */
final class Counters {
	public const WEBHOOK_BAD_SECRET = 'webhook_bad_secret';
	public const PROVIDER_RATE_LIMITED = 'provider_rate_limited';
	public const SEND_FAILED_PREFIX = 'send_failed_';
	private const KEY_PREFIX = 'counter_';
	private const KEY_NAMES = 'counter_names';

	public function __construct(
		private IAppConfig $appConfig,
	) {
	}

	public function increment(string $name): void {
		$names = $this->names();
		if (!in_array($name, $names, true)) {
			$this->appConfig->setValueArray(Application::APP_ID, self::KEY_NAMES, [...$names, $name]);
		}
		$key = self::KEY_PREFIX . $name;
		$this->appConfig->setValueInt(Application::APP_ID, $key, $this->appConfig->getValueInt(Application::APP_ID, $key) + 1);
	}

	/** @return array<string, int> */
	public function all(): array {
		$counts = [];
		foreach ($this->names() as $name) {
			$counts[$name] = $this->appConfig->getValueInt(Application::APP_ID, self::KEY_PREFIX . $name);
		}
		return $counts;
	}

	public function reset(): void {
		foreach ($this->names() as $name) {
			$this->appConfig->deleteKey(Application::APP_ID, self::KEY_PREFIX . $name);
		}
		$this->appConfig->deleteKey(Application::APP_ID, self::KEY_NAMES);
	}

	/** @return list<string> */
	private function names(): array {
		return array_values(array_map('strval', $this->appConfig->getValueArray(Application::APP_ID, self::KEY_NAMES)));
	}
}
```

`lib/Ops/ProviderHealth.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Ops;

use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\ZapSign\Exception\ZapSignAccessDenied;
use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use OCA\Assinaturas\ZapSign\Exception\ZapSignPlanRequired;
use OCA\Assinaturas\ZapSign\ZapSignClient;
use OCA\Assinaturas\ZapSign\ZapSignSettings;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IAppConfig;
use OCP\ICache;
use OCP\ICacheFactory;
use OCP\IGroupManager;
use OCP\Notification\IManager;

/**
 * Whether this tenant's ZapSign token works. Checked with the cheapest call, cached for ten
 * minutes, and admins hear about it once per change, never once per failure.
 */
final class ProviderHealth {
	public const STATE_OK = 'ok';
	public const STATE_PLAN_REQUIRED = 'plan_required';
	public const STATE_ACCESS_DENIED = 'access_denied';
	public const STATE_UNREACHABLE = 'unreachable';
	public const STATE_NOT_CONFIGURED = 'not_configured';
	private const CACHE_KEY = 'provider_health';
	private const CACHE_SECONDS = 600;
	private const KEY_LAST_STATE = 'provider_health_state';
	private const ADMIN_GROUP = 'admin';
	private const NOTIFICATION_SUBJECT = 'provider_health';
	private const OBJECT_TYPE = 'provider';
	private const FAILURE_STATES = [
		ZapSignPlanRequired::class => self::STATE_PLAN_REQUIRED,
		ZapSignAccessDenied::class => self::STATE_ACCESS_DENIED,
	];

	private ICache $cache;

	public function __construct(
		private ZapSignClient $client,
		private ZapSignSettings $settings,
		ICacheFactory $cacheFactory,
		private IAppConfig $appConfig,
		private IManager $notifications,
		private IGroupManager $groupManager,
		private ITimeFactory $timeFactory,
	) {
		$this->cache = $cacheFactory->createDistributed(Application::APP_ID);
	}

	/** @return array{state: string, checkedAt: int, plan: ?array{name: string, credits: int, status: string, currentPeriodEnd: ?string}} */
	public function current(bool $refresh = false): array {
		$cached = $refresh ? null : $this->cache->get(self::CACHE_KEY);
		if (is_array($cached)) {
			return $cached;
		}
		$health = ['state' => $this->checkState(), 'checkedAt' => $this->timeFactory->getTime(), 'plan' => null];
		if ($health['state'] === self::STATE_OK) {
			$health['plan'] = $this->plan();
		}
		$this->cache->set(self::CACHE_KEY, $health, self::CACHE_SECONDS);
		$this->announceChange($health['state']);
		return $health;
	}

	private function checkState(): string {
		if (!$this->settings->isConfigured()) {
			return self::STATE_NOT_CONFIGURED;
		}
		try {
			$this->client->listDocumentsWithSigners(1);
		} catch (ZapSignException $failure) {
			return self::FAILURE_STATES[$failure::class] ?? self::STATE_UNREACHABLE;
		}
		return self::STATE_OK;
	}

	/** @return ?array{name: string, credits: int, status: string, currentPeriodEnd: ?string} */
	private function plan(): ?array {
		try {
			$plan = $this->client->getPlanInfo();
		} catch (ZapSignException) {
			return null;
		}
		return ['name' => $plan->name, 'credits' => $plan->credits, 'status' => $plan->status, 'currentPeriodEnd' => $plan->currentPeriodEnd];
	}

	private function announceChange(string $state): void {
		$previous = $this->appConfig->getValueString(Application::APP_ID, self::KEY_LAST_STATE);
		if ($previous === $state) {
			return;
		}
		$this->appConfig->setValueString(Application::APP_ID, self::KEY_LAST_STATE, $state);
		$isQuietFirstCheck = $previous === '' && $state === self::STATE_OK;
		if ($isQuietFirstCheck) {
			return;
		}
		foreach ($this->groupManager->get(self::ADMIN_GROUP)?->getUsers() ?? [] as $admin) {
			$notification = $this->notifications->createNotification();
			$notification->setApp(Application::APP_ID)
				->setUser($admin->getUID())
				->setDateTime((new \DateTime())->setTimestamp($this->timeFactory->getTime()))
				->setObject(self::OBJECT_TYPE, $state)
				->setSubject(self::NOTIFICATION_SUBJECT, ['title' => $state, 'extra' => '']);
			$this->notifications->notify($notification);
		}
	}
}
```

In the "once per state change" test, the first refresh goes from `''` to `ok` and stays quiet. The second goes to `plan_required` and notifies. The third is unchanged and stays quiet.

`lib/Ops/ProviderHealthJob.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Ops;

use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;

final class ProviderHealthJob extends TimedJob {
	private const ONE_HOUR_SECONDS = 3600;

	public function __construct(
		ITimeFactory $time,
		private ProviderHealth $health,
	) {
		parent::__construct($time);
		$this->setInterval(self::ONE_HOUR_SECONDS);
	}

	protected function run($argument): void {
		$this->health->current(true);
	}
}
```

`lib/Ops/UsageReport.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Ops;

use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Draft\DeadlineCalculator;
use OCP\AppFramework\Utility\ITimeFactory;

/** This month's envelopes as ZapSign bills them (one per sent envelope), plus envelopes the sync lost track of. */
final class UsageReport {
	private const STALE_AFTER_SECONDS = 86400;

	public function __construct(
		private EnvelopeMapper $envelopeMapper,
		private DeadlineCalculator $deadlines,
		private ITimeFactory $timeFactory,
	) {
	}

	/** @return array{monthStart: int, sent: int, completed: int, closedButBilled: int, staleSyncs: int} */
	public function thisMonth(): array {
		$now = $this->timeFactory->getTime();
		$monthStart = (new \DateTimeImmutable('@' . $now))->setTimezone($this->deadlines->timezone())->modify('first day of this month')->setTime(0, 0)->getTimestamp();
		return [
			'monthStart' => $monthStart,
			'sent' => $this->envelopeMapper->countSentSince($monthStart),
			'completed' => $this->envelopeMapper->countCompletedSince($monthStart),
			'closedButBilled' => $this->envelopeMapper->countClosedBilledSince($monthStart),
			'staleSyncs' => $this->envelopeMapper->countStaleSyncs($now - self::STALE_AFTER_SECONDS),
		];
	}
}
```

`lib/Db/EnvelopeMapper.php`: add
```php
	public function countSentSince(int $from): int {
		$query = $this->db->getQueryBuilder();
		$query->select($query->func()->count('id', 'total'))
			->from(self::TABLE)
			->where($query->expr()->isNotNull('zapsign_token'))
			->andWhere($query->expr()->gte('create_attempted_at', $query->createNamedParameter($from, IQueryBuilder::PARAM_INT)));
		return self::total($query);
	}

	public function countCompletedSince(int $from): int {
		$query = $this->db->getQueryBuilder();
		$query->select($query->func()->count('id', 'total'))
			->from(self::TABLE)
			->where($query->expr()->gte('completed_at', $query->createNamedParameter($from, IQueryBuilder::PARAM_INT)));
		return self::total($query);
	}

	public function countClosedBilledSince(int $from): int {
		$query = $this->db->getQueryBuilder();
		$query->select($query->func()->count('id', 'total'))
			->from(self::TABLE)
			->where($query->expr()->in('status', $query->createNamedParameter([EnvelopeStatus::Cancelled->value, EnvelopeStatus::Failed->value], IQueryBuilder::PARAM_STR_ARRAY)))
			->andWhere($query->expr()->isNotNull('zapsign_token'))
			->andWhere($query->expr()->gte('create_attempted_at', $query->createNamedParameter($from, IQueryBuilder::PARAM_INT)));
		return self::total($query);
	}

	public function countStaleSyncs(int $syncedBefore): int {
		$query = $this->db->getQueryBuilder();
		$before = $query->createNamedParameter($syncedBefore, IQueryBuilder::PARAM_INT);
		$query->select($query->func()->count('id', 'total'))
			->from(self::TABLE)
			->where($query->expr()->in('status', $query->createNamedParameter([EnvelopeStatus::Pending->value, EnvelopeStatus::Expired->value], IQueryBuilder::PARAM_STR_ARRAY)))
			->andWhere($query->expr()->orX(
				$query->expr()->lt('last_synced_at', $before),
				$query->expr()->andX($query->expr()->isNull('last_synced_at'), $query->expr()->lt('sent_at', $before)),
			));
		return self::total($query);
	}

	private static function total(IQueryBuilder $query): int {
		$result = $query->executeQuery();
		$total = (int)$result->fetchOne();
		$result->closeCursor();
		return $total;
	}
```

`lib/Webhook/WebhookRegistrar.php`: add
```php
	/** @return list<string> the webhook type names currently registered for this instance */
	public function registeredTypes(): array {
		return array_values(array_map('strval', array_keys($this->appConfig->getValueArray(Application::APP_ID, self::KEY_IDS))));
	}
```

`lib/ZapSign/CallMonitor.php`:
- The constructor becomes `(private LoggerInterface $logger, private Counters $counters)`.
- After a response arrives, add `if ($response->statusCode === 429) { $this->counters->increment(Counters::PROVIDER_RATE_LIMITED); }`.
- Update the doubles:
  - `ZapSignDoubles::zapSignClient()` passes `new CallMonitor(new NullLogger(), new Counters($this->inMemoryAppConfig()))`.
  - `ZapSignClientTestCase` does the same with a mocked `IAppConfig`.

`lib/Controller/WebhookController.php`: inject `Counters $counters`. In the wrong-secret branch, add `$this->counters->increment(Counters::WEBHOOK_BAD_SECRET);`.

`lib/Send/EnvelopeSender.php`: inject `Counters $counters` (last parameter). In `markFailed`, after the compare-and-swap wins, add `$this->counters->increment(Counters::SEND_FAILED_PREFIX . $errorCode);`.

`lib/Controller/AdminController.php`:
- Inject `ZapSignSettings $settings`, `ProviderHealth $health`, `WebhookRegistrar $registrar`, `UsageReport $usage` and `Counters $counters`.
- Add:
```php
	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'GET', url: '/api/v1/admin/status')]
	public function status(): JSONResponse {
		if (!$this->access->mayAdminister()) {
			return self::forbidden();
		}
		return new JSONResponse([
			'environment' => $this->settings->environment()->value,
			'configured' => $this->settings->isConfigured(),
			'companyName' => $this->settings->companyName(),
			'health' => $this->health->current(),
			'webhooks' => $this->registrar->registeredTypes(),
			'usage' => $this->usage->thisMonth(),
			'counters' => $this->counters->all(),
			'outOfOrderSigningMustBeBlocked' => true,
		]);
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'POST', url: '/api/v1/admin/counters/reset')]
	public function resetCounters(): JSONResponse {
		if (!$this->access->mayAdminister()) {
			return self::forbidden();
		}
		$this->counters->reset();
		return new JSONResponse(['counters' => []]);
	}
```

`appinfo/info.xml`:
- Set `<version>0.3.0</version>`.
- Add `<job>OCA\Assinaturas\Ops\ProviderHealthJob</job>` to `<background-jobs>`.
- Change nothing else.

`docs/api.md`: document the two admin routes and the status shape field by field, including every health state and what each counter means.

- [ ] **Step 4: Rebuild the env and run the tests**

Run: `tests/env/reset.sh && tests/env/phpunit.sh --filter 'CountersTest|ProviderHealthTest|UsageReportTest|AdminControllerTest|WebhookControllerTest|EnvelopeSenderTest|ZapSign'`, then `tests/env/phpunit.sh`.

Expected:
- `OK`, and the full suite green.
- `tests/env/php.sh occ background-job:list | grep -i ProviderHealthJob` shows the job.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: admin status with provider health, monthly usage and operational counters"
```

---

### Task 12: End-to-end against the ZapSign sandbox (inline with Patrick)

The controller runs this task in-session with Patrick; there is no subagent. The sandbox token must be in the local test Nextcloud; after any `reset.sh`, Patrick re-runs the one `occ config:app:set … api_token … --sensitive` command. The test user is `assinaturas-e2e`, the E2E driver's owner.

**Files:**
- Modify: `tests/e2e/lifecycle.php` (action commands)
- Modify, in the avuz-server repo:
  - `docs/superpowers/plans/2026-09-28-assinaturas-roadmap.md`
  - `docs/zapsign/sandbox-findings.md`

- [ ] **Step 1: Add action commands to the driver**

Every command runs as the envelope owner, through the real services, and prints only non-sensitive facts:
- statuses, counts, byte sizes and filenames;
- `linkReturned: true` plus the link's **host**, never the URL.

Signers are addressed by 1-based index, as in Task 1.

| Command | Calls |
|---|---|
| `remind <uuid> <n>` | `SignerReminders::remind`. Prints `ok`, or the rejection's code and `retryAfterSeconds` |
| `correct-email <uuid> <n> <email>` | `SignerCorrections::correctEmail`. Prints `invited` |
| `link <uuid> <n>` | `SignerLinks::link`. Prints `linkReturned` and `linkHost` |
| `extend <uuid> <YYYY-MM-DD>` | `EnvelopeDeadline::extend` |
| `cancel <uuid> <reason…>` | `EnvelopeCancellation::cancel`. Prints `confirmed` |
| `remove <uuid>` | `EnvelopeRemoval::remove` with actor `admin` |
| `download <uuid> signed\|original <documentIndex>` and `download <uuid> activity` | `EnvelopeDownloads`. Prints `filename`, `bytes` and `startsLikePdf` |
| `timeline <uuid>` | Lists the events as `{type, signerIndex, actor, detail}` |
| `notifications` | Lists the subjects of the Nextcloud notifications of `assinaturas-e2e`, via `OCP\Notification\IManager`'s notification table. It counts them by subject and prints no content |
| `admin-status` | The `AdminController::status` payload, built from the same services |

Catch `ActionRejected` in the driver's dispatcher and print `{rejected: code, httpStatus, retryAfterSeconds}`. Lint, then commit: `test: add Plan 2b action commands to the sandbox driver`.

- [ ] **Step 2: Run the lifecycle with Patrick**

1. `setup patrick@avuz.cloud patrick.dm.rezende@gmail.com`, then `send <uuid>`. Signer 1 is invited.
2. `remind <uuid> 1`:
   - Patrick confirms a reminder email, and whether our message shows in it.
   - Running `remind <uuid> 1` again right away returns `reminder_cooldown` with `retryAfterSeconds`.
3. `correct-email <uuid> 1 patrick.dm.rezende+e2e@gmail.com` answers `invited` false during the cooldown. Patrick waits out the cooldown, then runs `remind <uuid> 1`; the corrected address gets the invitation.
4. `link <uuid> 1` shows `linkReturned: true` and a sandbox host. `timeline` shows `link_copied` with actor `assinaturas-e2e`.
5. `extend <uuid> <a date 30 days ahead>` succeeds, and `timeline` shows `deadline_extended`.
6. Patrick signs as signer 1 and then signer 2. Run `sync <uuid>` until `completed`. Then `notifications` shows `completed`.
7. Check the downloads:
   - `download <uuid> signed 1` gives a PDF.
   - `download <uuid> original 1` gives a PDF of the same size as the Drive original.
   - `download <uuid> activity` gives a PDF.
8. A second envelope: `setup` + `send`, then `cancel <uuid2> Teste de cancelamento`. It ends `cancelled`, and Patrick reports whether the signers were emailed.
9. A third envelope: `setup` + `send`, then `remove <uuid3>`. The rows are gone, and ZapSign shows the document cancelled (`provider <uuid3>`).
10. `admin-status` shows health `ok` with the plan, the webhooks list (empty locally), this month's usage including these envelopes, and the counters.
11. Scan `occ log:tail -n 500` for `verificar/`, `X-Amz-Signature` and `signer-` token fragments. Expect 0 hits.

- [ ] **Step 3: Record the outcome**

In the avuz-server worktree:
- Roadmap:
  - Plan 2b row → **Done**, with the date, the app head SHA and the test count.
  - Plan 3's row gains the admin UI and the countdown, backed by `lastReminderAt` and `COOLDOWN_SECONDS`.
- `sandbox-findings.md`: record the E2E observations, in particular whether reminders and the corrected-address invitation show the custom message (Q6), and the cancel email behaviour.

Commit: `docs: mark Assinaturas Plan 2b done with its sandbox E2E results`.

- [ ] **Step 4: Final verification**

Run: `tests/env/phpunit.sh`
Expected: the full suite is green. Then run the whole-branch review, and report the Plan 2b result to Patrick.

---

## Self-review notes (for the executor)

- **Order:** Task 1 (the spike) runs first, because Tasks 6, 7 and 9 read its results. The spike does not block Tasks 2–5, so if Patrick is unavailable, run 2–5 first and the spike before 6.
- **Constructor changes that ripple into tests:**

  | Class | Task |
  |---|---|
  | `EnvelopeEvents` | 2 |
  | `EnvelopeDrafts` | 4 |
  | `EnvelopeSynchronizer` | 5 |
  | `EnvelopeSender` | 10 and 11 |
  | `CallMonitor` | 11 |

  Each task says so. Grep `new <Class>(` in `tests/` and `tests/e2e/`.
- **No migration:** every column written already exists. The columns are `cancel_requested_at`, `cancel_reason`, `last_reminder_at`, `email_bounced_at`, and `actor_uid` on events.
