# Assinaturas Plan 2a: Core Envelope Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tenant user can build a draft envelope from Drive PDFs through a JSON API, send it to ZapSign, and get the signed PDFs saved back next to the originals. Webhooks and a tiered poller keep each envelope's state in sync.

**Architecture:** Plan 2a builds on Plan 1's tested `ZapSignClient`, schema and mappers (app repo `~/work/avuz/assinaturas`, head `98579f4`). Responsibilities are split into small units:

- `lib/Access/`: who may use the app.
- `lib/Draft/`: the draft domain.
- `lib/Send/`: the resumable Send steps.
- `lib/Storage/`: signed-file download and save.
- `lib/Sync/`: status mapping, completion, the synchronizer, the poller.
- `lib/Webhook/`: webhook inbox, secrets and registration.
- `lib/Api/`: presentation.
- `lib/Controller/`: thin HTTP controllers.

Background work runs as Nextcloud `QueuedJob`/`TimedJob`s. ZapSign's state, re-fetched each time, is the source of truth; webhooks only trigger that re-fetch.

**Tech Stack:** PHP 8.3, Nextcloud 33 OCP (Controllers with `#[FrontpageRoute]`, `IRootFolder`, `IGroupManager`, `IJobList`, `QueuedJob`, `TimedJob`, `IRepairStep`, `IAppConfig`, Symfony Console command), PHPUnit 9.6 in the Plan 1 Docker harness.

**Spec:** [`../specs/2026-09-28-assinaturas-zapsign-design.md`](../specs/2026-09-28-assinaturas-zapsign-design.md) · **Roadmap and carry-over:** [`2026-09-28-assinaturas-roadmap.md`](2026-09-28-assinaturas-roadmap.md) · **Sandbox truth:** [`../../zapsign/sandbox-findings.md`](../../zapsign/sandbox-findings.md) · **Plan 1:** [`2026-09-28-assinaturas-plan-1-foundation-and-spikes.md`](2026-09-28-assinaturas-plan-1-foundation-and-spikes.md)

**Out of scope (Plan 2b):**
- cancel, correct email, extend deadline, remind (and our reminder scheduler), delete of sent envelopes, copy link;
- bounce handling;
- Nextcloud notifications;
- admin panel API and usage counters;
- the list-endpoint polling optimization.

## Global Constraints

Everything in Plan 1's Global Constraints still applies:
- strict types, `final` classes, readonly DTOs;
- no abbreviations, early returns, hash-lists instead of `switch`, SNAKE_CAPS constants;
- never send `null` to ZapSign; never auto-retry non-idempotent calls;
- never log the API token, signer tokens or `sign_url`;
- tests describe behavior with third-person verb names;
- commits carry no Claude/AI attribution;
- the sandbox token lives only in the local test Nextcloud and is never printed.

Additional constraints for Plan 2a:

**JSON API**
- All routes live under `/apps/assinaturas/api/v1/…`. Keys are camelCase.
- Errors are `{"error": "<code>", "message": "<English text>"}`.
- Status codes:

  | Code | Meaning |
  |---|---|
  | `403` | Not allowed to use the app / not allowed to edit |
  | `404` | Unknown envelope, or one the user may not read |
  | `409` | Already sending |
  | `422` | Validation failure |

- **Never** return signer tokens, `sign_url`, ZapSign document tokens or the API token from any API response.

**Errors and logging**
- **Never** store or log ZapSign error messages; they can carry signer PII.
- Store only our own error codes: `provider_unreachable`, `provider_busy`, `provider_plan_required`, `provider_access_denied`, `provider_not_found`, `provider_rejected`, `provider_error`, `file_missing`, `file_changed`, `file_not_pdf`, `file_encrypted`, `file_already_signed`, `file_too_large`, `signer_mismatch`, `extra_documents_ambiguous`, `send_interrupted`.

**Time**
- Timestamps are epoch seconds (UTC).
- A deadline is the end of the chosen day (23:59:59) in the system `default_timezone`, falling back to `America/Sao_Paulo`.

**Limits**
- 10 files per envelope (sandbox-measured), 10 MB per file, 20 signers.
- Title ≤ 255 characters, signer name ≤ 255, message ≤ 500.
- `reminderDays` from 1 to 30.

**Access**
- Group id `assinaturas`, display name `Avuz Assinaturas`.
- Members and Nextcloud admins use the app.
- Owners keep read access to their own envelopes after leaving the group.
- Admins can read every envelope but not edit someone else's draft.

**ZapSign identifiers**
- `folder_path` = `/assinaturas/<envelope uuid>`.
- Document `external_id` = the envelope uuid.
- Signer `external_id` = our signer row id, as a string.
- Brand name `Avuz Conecta`, colour `#2bb5e3`, logo from app config `brand_logo_url` (omitted when empty).

**Signed files**
- Named `<name> (assinado).pdf`, with collisions as `<name> (assinado 2).pdf`, `(assinado 3)`, …; `.PDF` is matched case-insensitively.
- Saved next to the original when its folder is writable; otherwise in `/Assinaturas`.
- Downloaded only over `https` from `zapsign.s3.amazonaws.com`, with **no** Authorization header.

**Webhooks**
- Header `X-Assinaturas-Secret`; URL `<overwrite.cli.url>/index.php/apps/assinaturas/webhook`.
- Types registered: `""` (all: created/signed/refused), `doc_viewed`, `doc_expired`, `doc_deleted`, `email_bounce`.

**Account fingerprint**
- `sha256(environment + "|" + instance URL)`. It is **not** tied to the token, so rotating a token keeps every live envelope syncing.
- The instance URL is `overwrite.cli.url` without a trailing slash.

**Harness and live calls**
- Harness: `tests/env/phpunit.sh [--filter X]` runs in Docker. Run `tests/env/reset.sh` after any `info.xml` or migration change.
- Plan 2a never touches staging or production. Live calls go only to the ZapSign **sandbox**, in Task 15.

---

## File Structure

```
lib/
├── AppInfo/Application.php                      (unchanged)
├── Access/SignersGroup.php  AccessPolicy.php    who may use / read / edit
├── Migration/EnsureSignersGroup.php             repair step: create group
├── Db/  SignerStatus.php SaveStatus.php FieldType.php SendStep.php (enums)
│        Envelope/Document/Signer/Field .php     (+ enum accessors)
│        EnvelopeMapper.php                      (+ findRecent, sync queries)
├── Draft/  EnvelopeLimits.php DraftRejected.php EnvelopeDrafts.php
├── Api/EnvelopeView.php                         JSON shapes (never tokens)
├── Controller/  EnvelopeController.php WebhookController.php
├── Send/  SendFailure.php SendConflict.php PdfInspection.php SentContent.php
│          SignerMessage.php EnvelopeCreation.php EnvelopeSender.php SendJob.php
├── Storage/  SignedFileUnavailable.php SignedFileSaveFailed.php
│             SignedFileDownloader.php SignedFileStore.php
├── Sync/  ProviderOutcome.php StatusMapper.php SyncSchedule.php
│          EnvelopeEvents.php EnvelopeCompletion.php EnvelopeSynchronizer.php SyncEnvelopeJob.php
│          SyncPoller.php SyncPollerJob.php
├── Webhook/  WebhookSecrets.php WebhookInbox.php WebhookRegistrar.php
│             WebhookUrlChangeRefused.php EnsureWebhooksJob.php
├── Command/EnsureWebhooks.php                   occ assinaturas:webhook:ensure
└── ZapSign/ (Plan 1; Task 1 hardens CallMonitor, ZapSignClient, ZapSignSigner;
              Task 3 extends ZapSignSettings)
tests/
├── Fakes/ZapSignDoubles.php                     in-memory settings + client wiring
├── Integration/TestUsers.php                    real users + files helper trait
├── Integration/{Access,Draft,Controller,Send,Storage,Sync,Webhook}/…Test.php
├── Unit/{Send,Sync,Storage}/…Test.php
└── e2e/lifecycle.php                            sandbox end-to-end driver (Task 15)
docs/api.md                                      JSON API contract for Plan 3
```

---

### Task 1: Client hardening and signer model additions

This task clears the Plan 1 final-review carry-over, and it gives the synchronizer the stable signer fields it needs.

**Files:**
- Modify: `lib/ZapSign/CallMonitor.php` (the `observe` signature)
- Modify: `lib/ZapSign/ZapSignClient.php` (`buildRequest`, `findDocumentsByFolder`, `listDocumentsWithSigners`, new `decodePage`)
- Modify: `lib/ZapSign/Model/ZapSignSigner.php` (add `viewedAt`, `statusCode`)
- Test: `tests/Unit/ZapSign/CallMonitorTest.php`, `tests/Unit/ZapSign/ZapSignClientDocumentsTest.php`, `tests/Unit/ZapSign/RecordedPayloadsTest.php`

**Interfaces:**
- Produces:
  - `CallMonitor::observe(string $endpoint, array $context, #[\SensitiveParameter] callable $call): HttpResponse`.
  - `ZapSignSigner` gains `public readonly ?string $viewedAt` and `public readonly string $statusCode`, appended as the **last two** constructor parameters.
    - `viewedAt` is `first_opened_at` (detail), falling back to `data_hora_primeira_abertura` (list).
    - `statusCode` is `status_code`: `not-opened` / `signed` / `refused`, or `''` on list rows.
  - `ZapSignClient::findDocumentsByFolder` and `listDocumentsWithSigners` throw `ZapSignServerError` on a 2xx body that isn't a JSON list and has no `results` array. `[]` stays a valid empty list.
  - `ZapSignClient` throws `ZapSignRejectedRequest` with `providerCode` `invalid_payload` and **no previous exception** when a payload can't be JSON-encoded.

- [ ] **Step 1: Write the failing tests**

Add to `tests/Unit/ZapSign/CallMonitorTest.php`, inside the class:
```php
	public function testKeepsTheCapturedRequestOutOfADeepTraceDump(): void {
		$previousIgnoreArgs = ini_set('zend.exception_ignore_args', '0');
		$capturedSecret = 'captured-secret-token-xyz';
		try {
			$this->monitor->observe('POST /signers/{signer}/', [], fn (): HttpResponse => $capturedSecret === '' ? new HttpResponse(200, [], '') : throw new \RuntimeException('boom'));
			$this->fail('Expected the failure to be rethrown');
		} catch (\RuntimeException $failure) {
			$this->assertStringNotContainsString($capturedSecret, print_r($failure->getTrace(), true));
		} finally {
			if ($previousIgnoreArgs !== false) {
				ini_set('zend.exception_ignore_args', $previousIgnoreArgs);
			}
		}
	}
```

Add to `tests/Unit/ZapSign/ZapSignClientDocumentsTest.php`, inside the class. Also add `use OCA\Assinaturas\ZapSign\Exception\ZapSignRejectedRequest;` if it is missing.
```php
	/** @dataProvider malformedListBodies */
	public function testRefusesToReadAMalformedDocumentList(string $body): void {
		$this->transport->willRespond(200, $body);

		$this->expectException(ZapSignServerError::class);
		$this->client()->findDocumentsByFolder('/assinaturas/0f8fad5b-d9cb-469f-a165-70867728950e');
	}

	/** @return array<string, array{string}> */
	public static function malformedListBodies(): array {
		return [
			'proxy html page' => ['<html>proxy</html>'],
			'object without results' => ['{"detail":"ok"}'],
		];
	}

	public function testReadsAnEmptyDocumentListAsNoDocuments(): void {
		$this->transport->willRespond(200, '[]');

		$this->assertSame([], $this->client()->findDocumentsByFolder('/assinaturas/0f8fad5b-d9cb-469f-a165-70867728950e'));
	}

	public function testRejectsAPayloadThatCannotBeEncodedWithoutEchoingIt(): void {
		$invalidUtf8Title = "Contrato \xB1\x31";
		$document = new NewDocument($invalidUtf8Title, 'JVBERi0xLjcK', 'uuid-1', '/assinaturas/uuid-1', [new NewSigner('Ana Lima', 'ana@example.com', 1, 'signer-1')], false, null, new Branding('Avuz Conecta', '', '#2bb5e3'));

		try {
			$this->client()->createDocument($document);
			$this->fail('Expected a rejected request');
		} catch (ZapSignRejectedRequest $failure) {
			$this->assertSame('invalid_payload', $failure->providerCode);
			$this->assertNull($failure->getPrevious());
		}
		$this->assertCount(0, $this->transport->requests);
	}
```

Add to `tests/Unit/ZapSign/RecordedPayloadsTest.php`, inside the class. Add `use OCA\Assinaturas\ZapSign\Model\ZapSignDocumentPage;` if missing. The file already has a private static `recorded(string $name): array` helper.
```php
	public function testReadsStatusCodesAndFirstOpeningFromTheDetailEndpoint(): void {
		$pending = ZapSignDocument::fromPayload(self::recorded('recorded-created-envelope'));
		$signed = ZapSignDocument::fromPayload(self::recorded('recorded-signed-envelope'));
		$refused = ZapSignDocument::fromPayload(self::recorded('recorded-refused-envelope'));

		$this->assertSame('not-opened', $pending->signers[0]->statusCode);
		$this->assertNull($pending->signers[0]->viewedAt);
		$this->assertSame('signed', $signed->signers[0]->statusCode);
		$this->assertNotNull($signed->signers[0]->viewedAt);
		$this->assertSame('refused', $refused->signers[0]->statusCode);
	}

	public function testReadsFirstOpeningFromTheListEndpoint(): void {
		$page = ZapSignDocumentPage::fromPayload(self::recorded('recorded-documents-page'));
		$signedSigners = [];
		foreach ($page->documents as $document) {
			foreach ($document->signers as $signer) {
				if ($signer->status === 'assinou') {
					$signedSigners[] = $signer;
				}
			}
		}

		$this->assertNotEmpty($signedSigners);
		$this->assertNotNull($signedSigners[0]->viewedAt);
		$this->assertSame('', $signedSigners[0]->statusCode);
	}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter 'CallMonitorTest|ZapSignClientDocumentsTest|RecordedPayloadsTest'`

Expected failures:
- `testKeepsTheCapturedRequestOutOfADeepTraceDump` fails: the trace contains `captured-secret-token-xyz`.
- The malformed-list tests fail because no exception is thrown.
- The encoding test errors with a `JsonException`.
- The recorded tests error with `Undefined property ... statusCode`.

- [ ] **Step 3: Implement**

In `lib/ZapSign/CallMonitor.php`, change the `observe` signature and leave the body unchanged:
```php
	public function observe(string $endpoint, array $context, #[\SensitiveParameter] callable $call): HttpResponse {
```

In `lib/ZapSign/ZapSignClient.php`:

(a) Add the constant next to `COOLDOWN_CODE`:
```php
	private const INVALID_PAYLOAD_CODE = 'invalid_payload';
```

(b) In `buildRequest()`, replace the `$body = json_encode(...)` line with:
```php
		try {
			$body = json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
		} catch (\JsonException) {
			throw new ZapSignRejectedRequest('Request payload could not be encoded as JSON', self::INVALID_PAYLOAD_CODE);
		}
```

(c) In `findDocumentsByFolder()` replace `self::decode($response)` with `self::decodePage($response)`. Do the same in `listDocumentsWithSigners()`.

(d) Add this private method next to `decode()`:
```php
	/** @return array<mixed> a JSON list, or an object carrying a `results` array */
	private static function decodePage(HttpResponse $response): array {
		$decoded = json_decode($response->body, true);
		$isPage = is_array($decoded) && (array_is_list($decoded) || is_array($decoded['results'] ?? null));
		if (!$isPage) {
			throw new ZapSignServerError('ZapSign returned a document list in an unexpected shape');
		}
		return $decoded;
	}
```

Replace `lib/ZapSign/Model/ZapSignSigner.php` with:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Model;

use OCA\Assinaturas\ZapSign\PayloadReader;

final class ZapSignSigner {
	public function __construct(
		public readonly string $token,
		public readonly string $name,
		public readonly string $email,
		public readonly string $status,
		public readonly ?string $signedAt,
		public readonly ?string $signUrl,
		public readonly string $externalId,
		public readonly ?string $viewedAt,
		public readonly string $statusCode,
	) {
	}

	/**
	 * Reads both shapes: the detail endpoint (token, name, signed_at, sign_url, first_opened_at,
	 * status_code) and the list endpoint (nome, data_hora_assinatura, link_para_assinar,
	 * data_hora_primeira_abertura; no token, no status_code).
	 *
	 * @param array<mixed> $payload
	 */
	public static function fromPayload(array $payload): self {
		$reader = new PayloadReader($payload);
		$signUrl = $reader->nullableString('sign_url') ?? $reader->nullableString('link_para_assinar');
		return new self(
			$reader->nullableString('token') ?? self::tokenFromSignUrl($signUrl),
			$reader->nullableString('name') ?? $reader->string('nome'),
			$reader->string('email'),
			$reader->string('status'),
			$reader->nullableString('signed_at') ?? $reader->nullableString('data_hora_assinatura'),
			$signUrl,
			$reader->string('external_id'),
			$reader->nullableString('first_opened_at') ?? $reader->nullableString('data_hora_primeira_abertura'),
			$reader->string('status_code'),
		);
	}

	private static function tokenFromSignUrl(?string $signUrl): string {
		if ($signUrl === null) {
			return '';
		}
		return basename((string)parse_url($signUrl, PHP_URL_PATH));
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'CallMonitorTest|ZapSignClientDocumentsTest|RecordedPayloadsTest'`, then `tests/env/phpunit.sh`.
Expected: all green. The suite count grows from 104 to 111.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "fix: harden ZapSign client traces, list decoding and payload encoding"
```

---

### Task 2: Status enums and the provider status mapper

**Files:**
- Create: `lib/Db/SignerStatus.php`, `lib/Db/SaveStatus.php`, `lib/Db/FieldType.php`, `lib/Db/SendStep.php`
- Modify: `lib/Db/Signer.php`, `lib/Db/Document.php`, `lib/Db/Field.php` (add enum accessors)
- Create: `lib/Sync/ProviderOutcome.php`, `lib/Sync/StatusMapper.php`
- Test: `tests/Unit/Sync/StatusMapperTest.php`

**Interfaces:**
- Produces:
  - `enum SignerStatus: string { Pending='pending'; Viewed='viewed'; Signed='signed'; Refused='refused'; }`
  - `enum SaveStatus: string { Pending='pending'; Saved='saved'; SaveFailed='save_failed'; }`
  - `enum FieldType: string { Signature='signature'; Initials='initials'; }`
  - `enum SendStep: int { None=0; Created=1; ExtrasUploaded=2; Placed=3; Released=4; }`
  - Accessors: `Signer::statusValue(): SignerStatus`, `Document::saveStatusValue(): SaveStatus`, `Field::typeValue(): FieldType`.
  - `enum ProviderOutcome { Pending; Signed; Refused; Cancelled; Expired; Unknown; }`
  - `StatusMapper::outcome(ZapSignDocument $document, bool $cancelRequested, bool $deadlinePassed): ProviderOutcome`
  - `StatusMapper::signerStatus(ZapSignSigner $signer): ?SignerStatus`. Prefers `statusCode`, falls back to `status`, and returns `null` for an unknown vocabulary.

- [ ] **Step 1: Write the failing test**

`tests/Unit/Sync/StatusMapperTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\Sync;

use OCA\Assinaturas\Db\SignerStatus;
use OCA\Assinaturas\Sync\ProviderOutcome;
use OCA\Assinaturas\Sync\StatusMapper;
use OCA\Assinaturas\ZapSign\Model\ZapSignDocument;
use OCA\Assinaturas\ZapSign\Model\ZapSignSigner;
use PHPUnit\Framework\TestCase;

final class StatusMapperTest extends TestCase {
	private StatusMapper $mapper;

	protected function setUp(): void {
		$this->mapper = new StatusMapper();
	}

	public function testReadsARecordedPendingEnvelopeAsPending(): void {
		$this->assertSame(ProviderOutcome::Pending, $this->mapper->outcome(self::document('recorded-created-envelope'), false, false));
	}

	public function testReadsAPendingEnvelopePastItsDeadlineAsExpired(): void {
		$this->assertSame(ProviderOutcome::Expired, $this->mapper->outcome(self::document('recorded-created-envelope'), false, true));
	}

	public function testReadsARecordedSignedEnvelopeAsSigned(): void {
		$this->assertSame(ProviderOutcome::Signed, $this->mapper->outcome(self::document('recorded-signed-envelope'), false, false));
	}

	public function testReadsASignerRefusalAsRefused(): void {
		$this->assertSame(ProviderOutcome::Refused, $this->mapper->outcome(self::document('recorded-refused-envelope'), false, false));
	}

	public function testReadsOurOwnCancelAsCancelledNotRefused(): void {
		$this->assertSame(ProviderOutcome::Cancelled, $this->mapper->outcome(self::document('recorded-refused-envelope'), true, false));
	}

	public function testReadsADeletedEnvelopeAsCancelled(): void {
		$this->assertSame(ProviderOutcome::Cancelled, $this->mapper->outcome(self::document('recorded-created-envelope', ['deleted' => true]), false, false));
	}

	public function testReadsAnUnexpectedStatusAsUnknown(): void {
		$this->assertSame(ProviderOutcome::Unknown, $this->mapper->outcome(self::document('recorded-created-envelope', ['status' => 'arquivado']), false, false));
	}

	/** @dataProvider signerStatuses */
	public function testMapsEverySignerStatusVocabulary(string $status, string $statusCode, ?SignerStatus $expected): void {
		$signer = ZapSignSigner::fromPayload(['token' => 'signer-token', 'status' => $status, 'status_code' => $statusCode]);

		$this->assertSame($expected, $this->mapper->signerStatus($signer));
	}

	/** @return array<string, array{string, string, ?SignerStatus}> */
	public static function signerStatuses(): array {
		return [
			'detail not opened' => ['new', 'not-opened', SignerStatus::Pending],
			'detail signed' => ['signed', 'signed', SignerStatus::Signed],
			'detail refused with Portuguese status' => ['rejeitou', 'refused', SignerStatus::Refused],
			'detail refused without status code' => ['rejeitou', '', SignerStatus::Refused],
			'detail link opened' => ['link-opened', '', SignerStatus::Viewed],
			'list not opened' => ['nao_abriu', '', SignerStatus::Pending],
			'list opened' => ['abriu', '', SignerStatus::Viewed],
			'list signed' => ['assinou', '', SignerStatus::Signed],
			'list refused' => ['recusou', '', SignerStatus::Refused],
			'unknown vocabulary' => ['expirou', '', null],
		];
	}

	/** @param array<string, mixed> $overrides */
	private static function document(string $fixture, array $overrides = []): ZapSignDocument {
		$contents = (string)file_get_contents(__DIR__ . '/../../fixtures/zapsign/' . $fixture . '.json');
		$payload = json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
		return ZapSignDocument::fromPayload($overrides + $payload);
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `tests/env/phpunit.sh --filter StatusMapperTest`
Expected: ERROR `Class "OCA\Assinaturas\Sync\StatusMapper" not found`.

- [ ] **Step 3: Implement the enums and accessors**

`lib/Db/SignerStatus.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

enum SignerStatus: string {
	case Pending = 'pending';
	case Viewed = 'viewed';
	case Signed = 'signed';
	case Refused = 'refused';
}
```

`lib/Db/SaveStatus.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

enum SaveStatus: string {
	case Pending = 'pending';
	case Saved = 'saved';
	case SaveFailed = 'save_failed';
}
```

`lib/Db/FieldType.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

enum FieldType: string {
	case Signature = 'signature';
	case Initials = 'initials';
}
```

`lib/Db/SendStep.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

/** The last Send step that completed. Send resumes from the step after it. */
enum SendStep: int {
	case None = 0;
	case Created = 1;
	case ExtrasUploaded = 2;
	case Placed = 3;
	case Released = 4;
}
```

Add these accessors inside the existing entity classes, after their constructors:

`lib/Db/Signer.php`:
```php
	public function statusValue(): SignerStatus {
		return SignerStatus::from($this->getStatus());
	}
```

`lib/Db/Document.php`:
```php
	public function saveStatusValue(): SaveStatus {
		return SaveStatus::from($this->getSaveStatus());
	}
```

`lib/Db/Field.php`:
```php
	public function typeValue(): FieldType {
		return FieldType::from($this->getType());
	}
```

- [ ] **Step 4: Implement the mapper**

`lib/Sync/ProviderOutcome.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Sync;

enum ProviderOutcome {
	case Pending;
	case Signed;
	case Refused;
	case Cancelled;
	case Expired;
	case Unknown;
}
```

`lib/Sync/StatusMapper.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Sync;

use OCA\Assinaturas\Db\SignerStatus;
use OCA\Assinaturas\ZapSign\Model\ZapSignDocument;
use OCA\Assinaturas\ZapSign\Model\ZapSignSigner;

/**
 * Translates ZapSign's inconsistent vocabularies into ours. Event names are never trusted:
 * a company cancel fires doc_signed with status "recusado", so only the re-fetched document counts.
 */
final class StatusMapper {
	private const REFUSED_DOCUMENT_STATUSES = ['refused', 'rejected', 'recusado'];
	private const SIGNED_DOCUMENT_STATUS = 'signed';
	private const PENDING_DOCUMENT_STATUS = 'pending';
	private const SIGNER_STATUSES = [
		'not-opened' => SignerStatus::Pending,
		'new' => SignerStatus::Pending,
		'nao_abriu' => SignerStatus::Pending,
		'opened' => SignerStatus::Viewed,
		'link-opened' => SignerStatus::Viewed,
		'abriu' => SignerStatus::Viewed,
		'signed' => SignerStatus::Signed,
		'assinou' => SignerStatus::Signed,
		'refused' => SignerStatus::Refused,
		'rejeitou' => SignerStatus::Refused,
		'recusou' => SignerStatus::Refused,
	];

	public function outcome(ZapSignDocument $document, bool $cancelRequested, bool $deadlinePassed): ProviderOutcome {
		if ($document->deleted) {
			return ProviderOutcome::Cancelled;
		}
		if (in_array($document->status, self::REFUSED_DOCUMENT_STATUSES, true)) {
			return $cancelRequested ? ProviderOutcome::Cancelled : ProviderOutcome::Refused;
		}
		if ($document->status === self::SIGNED_DOCUMENT_STATUS) {
			return ProviderOutcome::Signed;
		}
		if ($document->status === self::PENDING_DOCUMENT_STATUS) {
			return $deadlinePassed ? ProviderOutcome::Expired : ProviderOutcome::Pending;
		}
		return ProviderOutcome::Unknown;
	}

	public function signerStatus(ZapSignSigner $signer): ?SignerStatus {
		return self::SIGNER_STATUSES[$signer->statusCode] ?? self::SIGNER_STATUSES[$signer->status] ?? null;
	}
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter StatusMapperTest`, then `tests/env/phpunit.sh`.
Expected: `OK` for 17 new tests (7 outcome tests plus 10 data sets); the full suite is green.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add lifecycle enums and the ZapSign status mapper"
```

---

### Task 3: Settings (instance-based fingerprint, webhook URL and secret, brand logo)

**Files:**
- Modify: `lib/ZapSign/ZapSignSettings.php` (full replacement below)
- Modify: `tests/Unit/ZapSign/ZapSignClientTestCase.php` (`client()` builds the new settings)
- Modify: `tests/Integration/ZapSign/ZapSignSettingsTest.php` (full replacement below)

**Interfaces:**
- Produces, on `ZapSignSettings`:
  - Constructor: `ZapSignSettings(IAppConfig $appConfig, IConfig $systemConfig, ISecureRandom $secureRandom)`.
  - Unchanged: `apiToken()`, `environment()`, `companyName()`, `isConfigured()`.
  - `brandLogoUrl(): string` reads app config `brand_logo_url`; empty means no logo.
  - `instanceUrl(): string` is `overwrite.cli.url` with no trailing slash.
  - `webhookUrl(): string` is `instanceUrl() . '/index.php/apps/assinaturas/webhook'`.
  - `accountFingerprint(): string` is `sha256(environment . '|' . instanceUrl)`; the token is **not** part of it.
  - `webhookSecret(): string` returns `''` when none is set.
  - `ensureWebhookSecret(): string` generates a 48-character alphanumeric secret once and stores it **sensitive**.
  - Key constants: `KEY_API_TOKEN`, `KEY_ENVIRONMENT`, `KEY_COMPANY_NAME`, `KEY_BRAND_LOGO_URL = 'brand_logo_url'`, `KEY_WEBHOOK_SECRET = 'webhook_secret'`.

- [ ] **Step 1: Write the failing tests**

Replace `tests/Integration/ZapSign/ZapSignSettingsTest.php` with:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\ZapSign;

use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\ZapSign\ZapSignEnvironment;
use OCA\Assinaturas\ZapSign\ZapSignSettings;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\Security\ISecureRandom;
use OCP\Server;
use Test\TestCase;

/**
 * Snapshots and restores the real keys, so a sandbox token configured for the spikes
 * survives a test run.
 *
 * @group DB
 */
final class ZapSignSettingsTest extends TestCase {
	private const KEYS = [
		ZapSignSettings::KEY_API_TOKEN,
		ZapSignSettings::KEY_ENVIRONMENT,
		ZapSignSettings::KEY_COMPANY_NAME,
		ZapSignSettings::KEY_BRAND_LOGO_URL,
		ZapSignSettings::KEY_WEBHOOK_SECRET,
	];

	private IAppConfig $appConfig;
	private ZapSignSettings $settings;
	/** @var array<string, array{value: string, sensitive: bool}> */
	private array $originalValues = [];

	protected function setUp(): void {
		parent::setUp();
		$this->appConfig = Server::get(IAppConfig::class);
		foreach (self::KEYS as $key) {
			if (!$this->appConfig->hasKey(Application::APP_ID, $key)) {
				continue;
			}
			$this->originalValues[$key] = [
				'value' => $this->appConfig->getValueString(Application::APP_ID, $key),
				'sensitive' => $this->appConfig->isSensitive(Application::APP_ID, $key),
			];
			$this->appConfig->deleteKey(Application::APP_ID, $key);
		}
		$this->settings = new ZapSignSettings($this->appConfig, Server::get(IConfig::class), Server::get(ISecureRandom::class));
	}

	protected function tearDown(): void {
		foreach (self::KEYS as $key) {
			$this->appConfig->deleteKey(Application::APP_ID, $key);
		}
		foreach ($this->originalValues as $key => $original) {
			$this->appConfig->setValueString(Application::APP_ID, $key, $original['value'], false, $original['sensitive']);
		}
		$this->originalValues = [];
		parent::tearDown();
	}

	public function testFallsBackToSandboxWhenTheEnvironmentIsUnset(): void {
		$this->assertSame(ZapSignEnvironment::Sandbox, $this->settings->environment());
		$this->assertSame('https://sandbox.api.zapsign.com.br/api/v1', $this->settings->environment()->apiBaseUrl());
	}

	public function testFallsBackToSandboxForAnUnknownEnvironmentValue(): void {
		$this->appConfig->setValueString(Application::APP_ID, ZapSignSettings::KEY_ENVIRONMENT, 'staging');

		$this->assertSame(ZapSignEnvironment::Sandbox, $this->settings->environment());
	}

	public function testReadsTheProductionEnvironment(): void {
		$this->appConfig->setValueString(Application::APP_ID, ZapSignSettings::KEY_ENVIRONMENT, 'production');

		$this->assertSame(ZapSignEnvironment::Production, $this->settings->environment());
	}

	public function testReportsNotConfiguredWithoutAToken(): void {
		$this->assertFalse($this->settings->isConfigured());
	}

	public function testDecryptsASensitiveToken(): void {
		$this->appConfig->setValueString(Application::APP_ID, ZapSignSettings::KEY_API_TOKEN, 'tenant-token-123', false, true);

		$this->assertSame('tenant-token-123', $this->settings->apiToken());
		$this->assertTrue($this->settings->isConfigured());
	}

	public function testReadsTheCompanyNameAndAnOptionalBrandLogo(): void {
		$this->appConfig->setValueString(Application::APP_ID, ZapSignSettings::KEY_COMPANY_NAME, 'Construtora Exemplo');

		$this->assertSame('Construtora Exemplo', $this->settings->companyName());
		$this->assertSame('', $this->settings->brandLogoUrl());
	}

	public function testChangesTheAccountFingerprintWhenTheEnvironmentChanges(): void {
		$sandboxFingerprint = $this->settings->accountFingerprint();

		$this->appConfig->setValueString(Application::APP_ID, ZapSignSettings::KEY_ENVIRONMENT, 'production');

		$this->assertNotSame($sandboxFingerprint, $this->settings->accountFingerprint());
		$this->assertSame(64, strlen($this->settings->accountFingerprint()));
	}

	public function testKeepsTheAccountFingerprintWhenTheTokenRotates(): void {
		$this->appConfig->setValueString(Application::APP_ID, ZapSignSettings::KEY_API_TOKEN, 'leaked-token', false, true);
		$before = $this->settings->accountFingerprint();

		$this->appConfig->deleteKey(Application::APP_ID, ZapSignSettings::KEY_API_TOKEN);
		$this->appConfig->setValueString(Application::APP_ID, ZapSignSettings::KEY_API_TOKEN, 'rotated-token', false, true);

		$this->assertSame($before, $this->settings->accountFingerprint());
	}

	public function testBuildsTheWebhookUrlFromTheInstanceUrl(): void {
		$instanceUrl = rtrim(Server::get(IConfig::class)->getSystemValueString('overwrite.cli.url'), '/');

		$this->assertSame($instanceUrl, $this->settings->instanceUrl());
		$this->assertSame($instanceUrl . '/index.php/apps/assinaturas/webhook', $this->settings->webhookUrl());
	}

	public function testGeneratesAWebhookSecretOnceAndKeepsItEncrypted(): void {
		$first = $this->settings->ensureWebhookSecret();
		$second = $this->settings->ensureWebhookSecret();

		$this->assertSame($first, $second);
		$this->assertMatchesRegularExpression('/^[A-Za-z0-9]{48}$/', $first);
		$this->assertTrue($this->appConfig->isSensitive(Application::APP_ID, ZapSignSettings::KEY_WEBHOOK_SECRET));
		$this->assertSame($first, $this->settings->webhookSecret());
	}

	public function testKeepsAConfiguredWebhookSecret(): void {
		$this->appConfig->setValueString(Application::APP_ID, ZapSignSettings::KEY_WEBHOOK_SECRET, 'configured-by-the-stack-env', false, true);

		$this->assertSame('configured-by-the-stack-env', $this->settings->ensureWebhookSecret());
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `tests/env/phpunit.sh --filter ZapSignSettingsTest`
Expected: ERROR `Undefined constant ... KEY_BRAND_LOGO_URL` or an `ArgumentCountError`.

- [ ] **Step 3: Implement**

Replace `lib/ZapSign/ZapSignSettings.php` with:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign;

use OCA\Assinaturas\AppInfo\Application;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\Security\ISecureRandom;

final class ZapSignSettings {
	public const KEY_API_TOKEN = 'api_token';
	public const KEY_ENVIRONMENT = 'environment';
	public const KEY_COMPANY_NAME = 'company_name';
	public const KEY_BRAND_LOGO_URL = 'brand_logo_url';
	public const KEY_WEBHOOK_SECRET = 'webhook_secret';
	private const INSTANCE_URL_KEY = 'overwrite.cli.url';
	private const WEBHOOK_PATH = '/index.php/apps/assinaturas/webhook';
	private const WEBHOOK_SECRET_LENGTH = 48;

	public function __construct(
		private IAppConfig $appConfig,
		private IConfig $systemConfig,
		private ISecureRandom $secureRandom,
	) {
	}

	public function apiToken(): string {
		return $this->appConfig->getValueString(Application::APP_ID, self::KEY_API_TOKEN);
	}

	public function environment(): ZapSignEnvironment {
		$configured = $this->appConfig->getValueString(Application::APP_ID, self::KEY_ENVIRONMENT);
		return ZapSignEnvironment::tryFrom($configured) ?? ZapSignEnvironment::Sandbox;
	}

	public function companyName(): string {
		return $this->appConfig->getValueString(Application::APP_ID, self::KEY_COMPANY_NAME);
	}

	public function brandLogoUrl(): string {
		return $this->appConfig->getValueString(Application::APP_ID, self::KEY_BRAND_LOGO_URL);
	}

	public function isConfigured(): bool {
		return $this->apiToken() !== '';
	}

	public function instanceUrl(): string {
		return rtrim($this->systemConfig->getSystemValueString(self::INSTANCE_URL_KEY), '/');
	}

	public function webhookUrl(): string {
		return $this->instanceUrl() . self::WEBHOOK_PATH;
	}

	/**
	 * Identifies which ZapSign account + Nextcloud instance an envelope belongs to. Tied to
	 * the environment and the instance, never to the token, so rotating a leaked token keeps
	 * every live envelope syncing, while a production database restored into staging does not.
	 */
	public function accountFingerprint(): string {
		return hash('sha256', $this->environment()->value . '|' . $this->instanceUrl());
	}

	public function webhookSecret(): string {
		return $this->appConfig->getValueString(Application::APP_ID, self::KEY_WEBHOOK_SECRET);
	}

	public function ensureWebhookSecret(): string {
		$current = $this->webhookSecret();
		if ($current !== '') {
			return $current;
		}
		$generated = $this->secureRandom->generate(self::WEBHOOK_SECRET_LENGTH, ISecureRandom::CHAR_ALPHANUMERIC);
		$this->appConfig->setValueString(Application::APP_ID, self::KEY_WEBHOOK_SECRET, $generated, false, true);
		return $generated;
	}
}
```

In `tests/Unit/ZapSign/ZapSignClientTestCase.php`, add imports `use OCP\IConfig;` and `use OCP\Security\ISecureRandom;`. Then replace the `return new ZapSignClient(...)` line of `client()` with:
```php
		$systemConfig = $this->createMock(IConfig::class);
		$systemConfig->method('getSystemValueString')->willReturnCallback(fn (string $key, string $default = ''): string => $key === 'overwrite.cli.url' ? 'https://tenant.example' : $default);
		$settings = new ZapSignSettings($appConfig, $systemConfig, $this->createMock(ISecureRandom::class));
		return new ZapSignClient($transport ?? $this->transport, $settings, new CallMonitor($this->logger), $this->backoff, $this->sleeper);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter ZapSignSettingsTest`, then `tests/env/phpunit.sh`.
Expected: `OK (11 tests, …)`; the full suite is green. The spike runner still resolves `ZapSignSettings` through DI.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: fingerprint envelopes by environment and instance, add webhook settings"
```

---

### Task 4: Access (signers group, repair step, access policy)

**Files:**
- Create: `lib/Access/SignersGroup.php`, `lib/Access/AccessPolicy.php`
- Create: `lib/Migration/EnsureSignersGroup.php`
- Modify: `appinfo/info.xml` (repair steps)
- Create: `tests/Integration/TestUsers.php` (trait, reused by later tasks)
- Test: `tests/Integration/Access/AccessPolicyTest.php`, `tests/Integration/Access/EnsureSignersGroupTest.php`

**Interfaces:**
- Produces:
  - `SignersGroup::GROUP_ID = 'assinaturas'` and `SignersGroup::DISPLAY_NAME = 'Avuz Assinaturas'`.
  - `EnsureSignersGroup implements IRepairStep`. It creates the group when it's missing and leaves an existing one untouched.
  - On `AccessPolicy`:
    - `canUseApp(string $userId): bool` — admin or group member.
    - `canRead(Envelope $envelope, string $userId): bool` — owner or admin.
    - `canEdit(Envelope $envelope, string $userId): bool` — owner who can use the app.
    - `canSeeAll(string $userId): bool` — admin.
  - Trait `OCA\Assinaturas\Tests\Integration\TestUsers`:
    - `createUser(string $displayName = 'Maria Souza'): string`
    - `addToGroup(string $userId, string $groupId): void`
    - `writeFile(string $userId, string $path, string $content): File`
    - `static minimalPdf(string $label = 'Contrato'): string`
    - `deleteCreatedUsers(): void`

- [ ] **Step 1: Write the test helper trait**

`tests/Integration/TestUsers.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration;

use OCP\Files\File;
use OCP\Files\IRootFolder;
use OCP\IGroupManager;
use OCP\IUserManager;
use OCP\Server;

/** Real Nextcloud users and files for integration tests. Call deleteCreatedUsers() in tearDown. */
trait TestUsers {
	/** @var list<string> */
	private array $createdUserIds = [];

	private function createUser(string $displayName = 'Maria Souza'): string {
		$userId = 'assinaturas-' . bin2hex(random_bytes(4));
		$user = Server::get(IUserManager::class)->createUser($userId, 'Assinaturas-' . bin2hex(random_bytes(12)) . '!Aa1');
		$user->setDisplayName($displayName);
		$this->createdUserIds[] = $userId;
		return $userId;
	}

	private function addToGroup(string $userId, string $groupId): void {
		$groupManager = Server::get(IGroupManager::class);
		$group = $groupManager->get($groupId) ?? $groupManager->createGroup($groupId);
		$group->addUser(Server::get(IUserManager::class)->get($userId));
	}

	private function writeFile(string $userId, string $path, string $content): File {
		$userFolder = Server::get(IRootFolder::class)->getUserFolder($userId);
		$directory = dirname($path);
		if ($directory !== '.' && $directory !== '/' && !$userFolder->nodeExists($directory)) {
			$userFolder->newFolder($directory);
		}
		return $userFolder->newFile($path, $content);
	}

	private static function minimalPdf(string $label = 'Contrato'): string {
		return "%PDF-1.7\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n% " . $label . "\ntrailer<</Root 1 0 R>>\n%%EOF\n";
	}

	private function deleteCreatedUsers(): void {
		$userManager = Server::get(IUserManager::class);
		foreach ($this->createdUserIds as $userId) {
			$userManager->get($userId)?->delete();
		}
		$this->createdUserIds = [];
	}
}
```

- [ ] **Step 2: Write the failing tests**

`tests/Integration/Access/AccessPolicyTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Access;

use OCA\Assinaturas\Access\AccessPolicy;
use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class AccessPolicyTest extends TestCase {
	use TestUsers;

	private const ADMIN = 'admin';

	private AccessPolicy $policy;

	protected function setUp(): void {
		parent::setUp();
		$this->policy = Server::get(AccessPolicy::class);
	}

	protected function tearDown(): void {
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testLetsGroupMembersUseTheApp(): void {
		$member = $this->createUser();
		$this->addToGroup($member, SignersGroup::GROUP_ID);

		$this->assertTrue($this->policy->canUseApp($member));
	}

	public function testKeepsNonMembersOut(): void {
		$this->assertFalse($this->policy->canUseApp($this->createUser()));
	}

	public function testLetsAdminsUseTheAppWithoutMembership(): void {
		$this->assertTrue($this->policy->canUseApp(self::ADMIN));
	}

	public function testLetsOwnersReadButNotEditTheirEnvelopeAfterLeavingTheGroup(): void {
		$formerMember = $this->createUser();
		$envelope = self::envelopeOwnedBy($formerMember);

		$this->assertTrue($this->policy->canRead($envelope, $formerMember));
		$this->assertFalse($this->policy->canEdit($envelope, $formerMember));
	}

	public function testLetsMembersEditTheirOwnEnvelope(): void {
		$member = $this->createUser();
		$this->addToGroup($member, SignersGroup::GROUP_ID);

		$this->assertTrue($this->policy->canEdit(self::envelopeOwnedBy($member), $member));
	}

	public function testLetsAdminsReadAnyEnvelopeButNotEditIt(): void {
		$envelope = self::envelopeOwnedBy($this->createUser());

		$this->assertTrue($this->policy->canRead($envelope, self::ADMIN));
		$this->assertFalse($this->policy->canEdit($envelope, self::ADMIN));
	}

	public function testKeepsOtherMembersOutOfSomeoneElsesEnvelope(): void {
		$otherMember = $this->createUser();
		$this->addToGroup($otherMember, SignersGroup::GROUP_ID);
		$envelope = self::envelopeOwnedBy($this->createUser());

		$this->assertFalse($this->policy->canRead($envelope, $otherMember));
	}

	public function testLetsOnlyAdminsSeeEveryEnvelope(): void {
		$member = $this->createUser();
		$this->addToGroup($member, SignersGroup::GROUP_ID);

		$this->assertTrue($this->policy->canSeeAll(self::ADMIN));
		$this->assertFalse($this->policy->canSeeAll($member));
	}

	private static function envelopeOwnedBy(string $userId): Envelope {
		$envelope = new Envelope();
		$envelope->setOwnerUid($userId);
		return $envelope;
	}
}
```

`tests/Integration/Access/EnsureSignersGroupTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Access;

use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Migration\EnsureSignersGroup;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\IGroupManager;
use OCP\Migration\IOutput;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class EnsureSignersGroupTest extends TestCase {
	use TestUsers;

	private IGroupManager $groupManager;

	protected function setUp(): void {
		parent::setUp();
		$this->groupManager = Server::get(IGroupManager::class);
	}

	protected function tearDown(): void {
		$this->deleteCreatedUsers();
		Server::get(EnsureSignersGroup::class)->run($this->createMock(IOutput::class));
		parent::tearDown();
	}

	public function testCreatesTheGroupWithItsDisplayName(): void {
		$this->groupManager->get(SignersGroup::GROUP_ID)?->delete();

		Server::get(EnsureSignersGroup::class)->run($this->createMock(IOutput::class));

		$group = $this->groupManager->get(SignersGroup::GROUP_ID);
		$this->assertNotNull($group);
		$this->assertSame('Avuz Assinaturas', $group->getDisplayName());
	}

	public function testLeavesAnExistingGroupAndItsMembersAlone(): void {
		$member = $this->createUser();
		$this->addToGroup($member, SignersGroup::GROUP_ID);

		Server::get(EnsureSignersGroup::class)->run($this->createMock(IOutput::class));

		$this->assertTrue($this->groupManager->isInGroup($member, SignersGroup::GROUP_ID));
	}
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter 'AccessPolicyTest|EnsureSignersGroupTest'`
Expected: ERROR `Class "OCA\Assinaturas\Access\AccessPolicy" not found`.

- [ ] **Step 4: Implement**

`lib/Access/SignersGroup.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Access;

final class SignersGroup {
	public const GROUP_ID = 'assinaturas';
	public const DISPLAY_NAME = 'Avuz Assinaturas';
}
```

`lib/Access/AccessPolicy.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Access;

use OCA\Assinaturas\Db\Envelope;
use OCP\IGroupManager;

/**
 * Enforced in the app, not through Nextcloud's "limit to groups": core treats group-limited
 * apps as disabled for anonymous requests, which would 404 the ZapSign webhook.
 */
final class AccessPolicy {
	public function __construct(
		private IGroupManager $groupManager,
	) {
	}

	public function canUseApp(string $userId): bool {
		return $this->groupManager->isAdmin($userId) || $this->groupManager->isInGroup($userId, SignersGroup::GROUP_ID);
	}

	public function canRead(Envelope $envelope, string $userId): bool {
		return $envelope->getOwnerUid() === $userId || $this->groupManager->isAdmin($userId);
	}

	public function canEdit(Envelope $envelope, string $userId): bool {
		return $envelope->getOwnerUid() === $userId && $this->canUseApp($userId);
	}

	public function canSeeAll(string $userId): bool {
		return $this->groupManager->isAdmin($userId);
	}
}
```

`lib/Migration/EnsureSignersGroup.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Migration;

use OCA\Assinaturas\Access\SignersGroup;
use OCP\IGroupManager;
use OCP\Migration\IOutput;
use OCP\Migration\IRepairStep;

final class EnsureSignersGroup implements IRepairStep {
	public function __construct(
		private IGroupManager $groupManager,
	) {
	}

	public function getName(): string {
		return 'Create the Avuz Assinaturas group';
	}

	public function run(IOutput $output): void {
		if ($this->groupManager->groupExists(SignersGroup::GROUP_ID)) {
			return;
		}
		$this->groupManager->createGroup(SignersGroup::GROUP_ID)?->setDisplayName(SignersGroup::DISPLAY_NAME);
		$output->info('Created group ' . SignersGroup::GROUP_ID);
	}
}
```

Replace `appinfo/info.xml` with:
```xml
<?xml version="1.0"?>
<info xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xsi:noNamespaceSchemaLocation="https://apps.nextcloud.com/schema/apps/info.xsd">
    <id>assinaturas</id>
    <name>Assinaturas</name>
    <summary>Assinatura eletrônica de documentos com ZapSign</summary>
    <description><![CDATA[Envie documentos do Drive para assinatura eletrônica e acompanhe cada envelope até a conclusão.]]></description>
    <version>0.1.0</version>
    <licence>agpl</licence>
    <author mail="dev@avuz.com">Avuz Team</author>
    <namespace>Assinaturas</namespace>
    <category>files</category>
    <bugs>https://github.com/avuz-conecta/assinaturas/issues</bugs>
    <dependencies>
        <php min-version="8.3"/>
        <nextcloud min-version="33" max-version="34"/>
    </dependencies>
    <repair-steps>
        <install>
            <step>OCA\Assinaturas\Migration\EnsureSignersGroup</step>
        </install>
        <post-migration>
            <step>OCA\Assinaturas\Migration\EnsureSignersGroup</step>
        </post-migration>
    </repair-steps>
</info>
```

- [ ] **Step 5: Rebuild the env and run the tests**

Run: `tests/env/reset.sh && tests/env/phpunit.sh --filter 'AccessPolicyTest|EnsureSignersGroupTest'`, then `tests/env/phpunit.sh`.

Expected:
- `reset.sh` logs nothing new; the install repair step runs silently.
- `OK (9 tests, …)`; the full suite is green.
- Confirm the group exists: `tests/env/php.sh occ group:list | grep -A1 assinaturas` shows `assinaturas: … Avuz Assinaturas`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: gate the app on the Avuz Assinaturas group and add the access policy"
```

---

### Task 5: Drafts I (create, list, delete)

**Files:**
- Create: `lib/Draft/EnvelopeLimits.php`, `lib/Draft/DraftRejected.php`, `lib/Draft/EnvelopeDrafts.php`
- Modify: `lib/Db/EnvelopeMapper.php` (add `findRecent`)
- Create: `tests/Integration/EnvelopeCleanup.php` (trait)
- Test: `tests/Integration/Draft/EnvelopeDraftsCreationTest.php`

**Interfaces:**
- Consumes:
  - `TestUsers` (Task 4);
  - `EnvelopeStatus`, `SaveStatus`, `Envelope::statusValue()`, `Document::saveStatusValue()` (Plan 1, Task 2);
  - the mappers (Plan 1).
- Produces:
  - `EnvelopeLimits` constants: `MAX_FILES=10`, `MAX_FILE_BYTES=10485760`, `MAX_SIGNERS=20`, `MAX_TITLE_LENGTH=255`, `MAX_NAME_LENGTH=255`, `MAX_MESSAGE_LENGTH=500`, `MIN_REMINDER_DAYS=1`, `MAX_REMINDER_DAYS=30`, `PDF_MIME_TYPE='application/pdf'`, `LIST_LIMIT=200`.
  - `DraftRejected(string $errorCode, string $message)` with public readonly `$errorCode`.
  - On `EnvelopeDrafts`:
    - `create(string $ownerUid, string $title, list<int> $fileIds): Envelope`
    - `listFor(string $userId, bool $everyone): list<Envelope>`
    - `delete(Envelope $envelope): void` (drafts only)
  - `EnvelopeMapper::findRecent(?string $ownerUid, int $limit): list<Envelope>`, most recently updated first; `null` owner means everyone.
  - Trait `EnvelopeCleanup::deleteEnvelopesOf(list<string> $userIds): void`.

- [ ] **Step 1: Write the cleanup trait and the failing test**

`tests/Integration/EnvelopeCleanup.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration;

use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EventMapper;
use OCA\Assinaturas\Db\FieldMapper;
use OCA\Assinaturas\Db\SignerMapper;
use OCP\Server;

/** Removes every envelope row a test created for the given users. */
trait EnvelopeCleanup {
	/** @param list<string> $userIds */
	private function deleteEnvelopesOf(array $userIds): void {
		$envelopeMapper = Server::get(EnvelopeMapper::class);
		$documentMapper = Server::get(DocumentMapper::class);
		$fieldMapper = Server::get(FieldMapper::class);
		$signerMapper = Server::get(SignerMapper::class);
		$eventMapper = Server::get(EventMapper::class);
		foreach ($userIds as $userId) {
			foreach ($envelopeMapper->findRecent($userId, 1000) as $envelope) {
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
}
```

`tests/Integration/Draft/EnvelopeDraftsCreationTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Draft;

use OCA\Assinaturas\Db\Document;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\Field;
use OCA\Assinaturas\Db\FieldMapper;
use OCA\Assinaturas\Db\SaveStatus;
use OCA\Assinaturas\Db\Signer;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Draft\DraftRejected;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class EnvelopeDraftsCreationTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;

	private EnvelopeDrafts $drafts;
	private string $owner;

	protected function setUp(): void {
		parent::setUp();
		$this->drafts = Server::get(EnvelopeDrafts::class);
		$this->owner = $this->createUser();
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testCreatesADraftWithDocumentsInTheChosenOrder(): void {
		$contract = $this->writeFile($this->owner, 'Contrato.pdf', self::minimalPdf('contrato'));
		$annex = $this->writeFile($this->owner, 'Anexos/Anexo I.pdf', self::minimalPdf('anexo'));

		$envelope = $this->drafts->create($this->owner, '  Contrato de serviços  ', [$annex->getId(), $contract->getId()]);

		$this->assertSame(EnvelopeStatus::Draft, $envelope->statusValue());
		$this->assertSame('Contrato de serviços', $envelope->getTitle());
		$this->assertMatchesRegularExpression('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/', $envelope->getUuid());
		$documents = Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId());
		$this->assertSame(['/Anexos/Anexo I.pdf', '/Contrato.pdf'], array_map(fn (Document $document): string => $document->getSourcePath(), $documents));
		$this->assertSame($annex->getEtag(), $documents[0]->getSourceEtag());
		$this->assertSame(SaveStatus::Pending, $documents[0]->saveStatusValue());
	}

	public function testRejectsAFileThatIsNotAPdf(): void {
		$notes = $this->writeFile($this->owner, 'notas.txt', 'texto');

		$this->assertRejected('file_not_pdf', fn () => $this->drafts->create($this->owner, 'Notas', [$notes->getId()]));
	}

	public function testRejectsAFileThatBelongsToAnotherUser(): void {
		$foreign = $this->writeFile($this->createUser('Outra Pessoa'), 'Contrato.pdf', self::minimalPdf());

		$this->assertRejected('file_not_found', fn () => $this->drafts->create($this->owner, 'Contrato', [$foreign->getId()]));
	}

	public function testRejectsMoreThanTenFiles(): void {
		$fileIds = [];
		for ($number = 1; $number <= 11; $number++) {
			$fileIds[] = $this->writeFile($this->owner, 'Arquivo ' . $number . '.pdf', self::minimalPdf())->getId();
		}

		$this->assertRejected('too_many_files', fn () => $this->drafts->create($this->owner, 'Muitos', $fileIds));
	}

	public function testRejectsABlankTitle(): void {
		$file = $this->writeFile($this->owner, 'Contrato.pdf', self::minimalPdf());

		$this->assertRejected('title_invalid', fn () => $this->drafts->create($this->owner, '   ', [$file->getId()]));
	}

	public function testRejectsAnEnvelopeWithoutFiles(): void {
		$this->assertRejected('no_files', fn () => $this->drafts->create($this->owner, 'Contrato', []));
	}

	public function testListsOnlyTheOwnersEnvelopesUnlessEveryoneIsRequested(): void {
		$mine = $this->drafts->create($this->owner, 'Meu', [$this->writeFile($this->owner, 'a.pdf', self::minimalPdf())->getId()]);
		$someoneElse = $this->createUser('Outra Pessoa');
		$theirs = $this->drafts->create($someoneElse, 'Deles', [$this->writeFile($someoneElse, 'b.pdf', self::minimalPdf())->getId()]);

		$myUuids = self::uuids($this->drafts->listFor($this->owner, false));
		$everyUuid = self::uuids($this->drafts->listFor($this->owner, true));

		$this->assertContains($mine->getUuid(), $myUuids);
		$this->assertNotContains($theirs->getUuid(), $myUuids);
		$this->assertContains($theirs->getUuid(), $everyUuid);
	}

	public function testDeletesADraftWithAllItsRows(): void {
		$envelope = $this->drafts->create($this->owner, 'Contrato', [$this->writeFile($this->owner, 'Contrato.pdf', self::minimalPdf())->getId()]);
		$signer = new Signer();
		$signer->setEnvelopeId($envelope->getId());
		$signer->setName('Ana Lima');
		$signer->setEmail('ana@example.com');
		$signer = Server::get(SignerMapper::class)->insert($signer);
		$document = Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId())[0];
		$field = new Field();
		$field->setDocumentId($document->getId());
		$field->setSignerId($signer->getId());
		$field->setType('signature');
		$field->setPage(0);
		$field->setX(0.1);
		$field->setY(0.1);
		$field->setWidth(0.2);
		$field->setHeight(0.1);
		Server::get(FieldMapper::class)->insert($field);

		$this->drafts->delete($envelope);

		$this->assertSame([], Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId()));
		$this->assertSame([], Server::get(SignerMapper::class)->findByEnvelope($envelope->getId()));
		$this->assertSame([], Server::get(FieldMapper::class)->findByDocument($document->getId()));
		$this->expectException(DoesNotExistException::class);
		Server::get(EnvelopeMapper::class)->findById($envelope->getId());
	}

	public function testRefusesToDeleteAnEnvelopeThatWasSent(): void {
		$envelope = $this->drafts->create($this->owner, 'Contrato', [$this->writeFile($this->owner, 'Contrato.pdf', self::minimalPdf())->getId()]);
		$envelope->setStatus(EnvelopeStatus::Pending->value);
		Server::get(EnvelopeMapper::class)->update($envelope);

		$this->assertRejected('not_a_draft', fn () => $this->drafts->delete($envelope));
	}

	private function assertRejected(string $expectedCode, callable $action): void {
		try {
			$action();
			$this->fail('Expected the draft to be rejected with ' . $expectedCode);
		} catch (DraftRejected $rejection) {
			$this->assertSame($expectedCode, $rejection->errorCode);
		}
	}

	/**
	 * @param list<Envelope> $envelopes
	 * @return list<string>
	 */
	private static function uuids(array $envelopes): array {
		return array_map(fn (Envelope $envelope): string => $envelope->getUuid(), $envelopes);
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `tests/env/phpunit.sh --filter EnvelopeDraftsCreationTest`
Expected: ERROR `Class "OCA\Assinaturas\Draft\EnvelopeDrafts" not found`.

- [ ] **Step 3: Implement**

`lib/Draft/EnvelopeLimits.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Draft;

final class EnvelopeLimits {
	public const MAX_FILES = 10;
	public const MAX_FILE_BYTES = 10 * 1024 * 1024;
	public const MAX_SIGNERS = 20;
	public const MAX_TITLE_LENGTH = 255;
	public const MAX_NAME_LENGTH = 255;
	public const MAX_MESSAGE_LENGTH = 500;
	public const MIN_REMINDER_DAYS = 1;
	public const MAX_REMINDER_DAYS = 30;
	public const PDF_MIME_TYPE = 'application/pdf';
	public const LIST_LIMIT = 200;
}
```

`lib/Draft/DraftRejected.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Draft;

/** A draft input the sender must fix. The code is stable for the UI; the message is for developers. */
final class DraftRejected extends \RuntimeException {
	public function __construct(
		public readonly string $errorCode,
		string $message,
	) {
		parent::__construct($message);
	}
}
```

In `lib/Db/EnvelopeMapper.php`, add this public method after `findByZapsignToken()`:
```php
	/** @return list<Envelope> most recently updated first; a null owner means every owner */
	public function findRecent(?string $ownerUid, int $limit): array {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->orderBy('updated_at', 'DESC')
			->addOrderBy('id', 'DESC')
			->setMaxResults($limit);
		if ($ownerUid !== null) {
			$query->where($query->expr()->eq('owner_uid', $query->createNamedParameter($ownerUid)));
		}
		return $this->findEntities($query);
	}
```

`lib/Draft/EnvelopeDrafts.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Draft;

use OCA\Assinaturas\Db\Document;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\FieldMapper;
use OCA\Assinaturas\Db\SaveStatus;
use OCA\Assinaturas\Db\SignerMapper;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\File;
use OCP\Files\IRootFolder;

/** Everything a sender does before Send: files, title, signers, signature boxes. Only drafts change. */
final class EnvelopeDrafts {
	public function __construct(
		private EnvelopeMapper $envelopeMapper,
		private DocumentMapper $documentMapper,
		private SignerMapper $signerMapper,
		private FieldMapper $fieldMapper,
		private IRootFolder $rootFolder,
		private ITimeFactory $timeFactory,
	) {
	}

	/**
	 * @param list<int> $fileIds in the order signers see them; the first is the main document
	 * @throws DraftRejected
	 */
	public function create(string $ownerUid, string $title, array $fileIds): Envelope {
		self::assertTitle($title);
		if ($fileIds === []) {
			throw new DraftRejected('no_files', 'An envelope needs at least one PDF');
		}
		if (count($fileIds) > EnvelopeLimits::MAX_FILES) {
			throw new DraftRejected('too_many_files', 'An envelope holds at most ' . EnvelopeLimits::MAX_FILES . ' files');
		}
		$files = array_map(fn (int $fileId): File => $this->sourceFile($ownerUid, $fileId), array_map('intval', $fileIds));
		$now = $this->timeFactory->getTime();
		$envelope = new Envelope();
		$envelope->setUuid(self::newUuid());
		$envelope->setOwnerUid($ownerUid);
		$envelope->setTitle(trim($title));
		$envelope->setStatus(EnvelopeStatus::Draft->value);
		$envelope->setCreatedAt($now);
		$envelope->setUpdatedAt($now);
		$envelope = $this->envelopeMapper->insert($envelope);
		$userFolder = $this->rootFolder->getUserFolder($ownerUid);
		foreach ($files as $position => $file) {
			$document = new Document();
			$document->setEnvelopeId($envelope->getId());
			$document->setPosition($position);
			$document->setSourceFileId($file->getId());
			$document->setSourcePath($userFolder->getRelativePath($file->getPath()) ?? '/' . $file->getName());
			$document->setSourceEtag($file->getEtag());
			$document->setSaveStatus(SaveStatus::Pending->value);
			$this->documentMapper->insert($document);
		}
		return $envelope;
	}

	/** @return list<Envelope> most recently updated first */
	public function listFor(string $userId, bool $everyone): array {
		return $this->envelopeMapper->findRecent($everyone ? null : $userId, EnvelopeLimits::LIST_LIMIT);
	}

	/** @throws DraftRejected */
	public function delete(Envelope $envelope): void {
		$this->assertDraft($envelope);
		foreach ($this->documentMapper->findByEnvelope($envelope->getId()) as $document) {
			foreach ($this->fieldMapper->findByDocument($document->getId()) as $field) {
				$this->fieldMapper->delete($field);
			}
			$this->documentMapper->delete($document);
		}
		foreach ($this->signerMapper->findByEnvelope($envelope->getId()) as $signer) {
			$this->signerMapper->delete($signer);
		}
		$this->envelopeMapper->delete($envelope);
	}

	private function sourceFile(string $ownerUid, int $fileId): File {
		$node = $this->rootFolder->getUserFolder($ownerUid)->getFirstNodeById($fileId);
		if (!$node instanceof File || !$node->isReadable()) {
			throw new DraftRejected('file_not_found', 'File ' . $fileId . ' is not a readable file of this user');
		}
		if ($node->getMimeType() !== EnvelopeLimits::PDF_MIME_TYPE) {
			throw new DraftRejected('file_not_pdf', 'Only PDF files can be sent for signature');
		}
		if ($node->getSize() > EnvelopeLimits::MAX_FILE_BYTES) {
			throw new DraftRejected('file_too_large', 'Each file must be at most 10 MB');
		}
		return $node;
	}

	private function assertDraft(Envelope $envelope): void {
		if ($envelope->statusValue() !== EnvelopeStatus::Draft) {
			throw new DraftRejected('not_a_draft', 'Only drafts can be changed');
		}
	}

	private static function assertTitle(string $title): void {
		$length = mb_strlen(trim($title));
		if ($length === 0 || $length > EnvelopeLimits::MAX_TITLE_LENGTH) {
			throw new DraftRejected('title_invalid', 'The title must have between 1 and ' . EnvelopeLimits::MAX_TITLE_LENGTH . ' characters');
		}
	}

	private static function newUuid(): string {
		$bytes = random_bytes(16);
		$bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
		$bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
		return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter EnvelopeDraftsCreationTest`, then `tests/env/phpunit.sh`.
Expected: `OK (9 tests, …)`; the full suite is green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: create, list and delete draft envelopes from Drive PDFs"
```

---

### Task 6: Drafts II (settings, signers, signature boxes)

**Files:**
- Modify: `lib/Draft/EnvelopeDrafts.php` (constructor plus new methods)
- Test: `tests/Integration/Draft/EnvelopeDraftsEditingTest.php`

**Interfaces:**
- Consumes: `EnvelopeDrafts`, `DraftRejected`, `EnvelopeLimits` (Task 5); `FieldType` (Task 2).
- Produces, on `EnvelopeDrafts`:
  - The constructor gains a final parameter `IConfig $systemConfig`.
  - `updateSettings(Envelope $envelope, string $title, bool $signingOrder, ?string $deadlineDate, ?int $reminderDays, string $message): Envelope`.
    - `$deadlineDate` is `YYYY-MM-DD`. It's stored as 23:59:59 on that day, in the system `default_timezone`, falling back to `America/Sao_Paulo`.
  - `replaceSigners(Envelope $envelope, list<array{name: string, email: string, orderGroup?: int}> $signers): list<Signer>`.
    - This **also deletes every signature box**, because boxes point at signers.
    - Emails are lowercased.
    - `orderGroup` is forced to 1 when signing order is off.
  - `replaceFields(Envelope $envelope, int $documentId, list<array{width: float, height: float, rotation: int}> $pages, list<array{signerId: int, type: string, page: int, x: float, y: float, width: float, height: float}> $fields): list<Field>`.
    - Stores `pages` and `page_count`.
    - Refreshes the document's `source_etag` to the file's current etag, because placement is made on that version.
  - New `DraftRejected` codes:
    - settings: `deadline_invalid`, `reminder_invalid`, `message_too_long`;
    - signers: `no_signers`, `too_many_signers`, `signer_name_invalid`, `signer_email_invalid`, `signer_email_duplicate`, `signer_order_invalid`;
    - pages and fields: `pages_invalid`, `unknown_signer`, `field_type_invalid`, `field_page_invalid`, `field_outside_page`;
    - `document_not_found`.

- [ ] **Step 1: Write the failing test**

`tests/Integration/Draft/EnvelopeDraftsEditingTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Draft;

use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\FieldMapper;
use OCA\Assinaturas\Db\Signer;
use OCA\Assinaturas\Draft\DraftRejected;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\Server;
use Test\TestCase;

/**
 * Assumes the test instance has no `default_timezone` configured, so deadlines use America/Sao_Paulo.
 *
 * @group DB
 */
final class EnvelopeDraftsEditingTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;

	private const PORTRAIT_PAGE = ['width' => 595.28, 'height' => 841.89, 'rotation' => 0];

	private EnvelopeDrafts $drafts;
	private string $owner;
	private Envelope $envelope;

	protected function setUp(): void {
		parent::setUp();
		$this->drafts = Server::get(EnvelopeDrafts::class);
		$this->owner = $this->createUser();
		$file = $this->writeFile($this->owner, 'Contrato.pdf', self::minimalPdf());
		$this->envelope = $this->drafts->create($this->owner, 'Contrato', [$file->getId()]);
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testStoresTheSettingsWithADeadlineAtTheEndOfTheDayInSaoPaulo(): void {
		$tomorrow = (new \DateTimeImmutable('tomorrow', new \DateTimeZone('America/Sao_Paulo')))->format('Y-m-d');

		$updated = $this->drafts->updateSettings($this->envelope, 'Contrato revisado', true, $tomorrow, 3, 'Por favor, assine até amanhã.');

		$this->assertSame('Contrato revisado', $updated->getTitle());
		$this->assertTrue($updated->getSigningOrder());
		$this->assertSame(3, $updated->getReminderDays());
		$this->assertSame('Por favor, assine até amanhã.', $updated->getMessage());
		$localDeadline = (new \DateTimeImmutable('@' . $updated->getDeadlineAt()))->setTimezone(new \DateTimeZone('America/Sao_Paulo'));
		$this->assertSame($tomorrow . ' 23:59:59', $localDeadline->format('Y-m-d H:i:s'));
	}

	public function testClearsTheDeadlineAndMessage(): void {
		$updated = $this->drafts->updateSettings($this->envelope, 'Contrato', false, null, null, '');

		$this->assertNull($updated->getDeadlineAt());
		$this->assertNull($updated->getMessage());
		$this->assertNull($updated->getReminderDays());
	}

	/** @dataProvider invalidSettings */
	public function testRejectsInvalidSettings(string $expectedCode, ?string $deadlineDate, ?int $reminderDays, string $message): void {
		$this->assertRejected($expectedCode, fn () => $this->drafts->updateSettings($this->envelope, 'Contrato', false, $deadlineDate, $reminderDays, $message));
	}

	/** @return array<string, array{string, ?string, ?int, string}> */
	public static function invalidSettings(): array {
		return [
			'deadline in the past' => ['deadline_invalid', '2020-01-01', null, ''],
			'deadline in another format' => ['deadline_invalid', '31/12/2030', null, ''],
			'reminder of zero days' => ['reminder_invalid', null, 0, ''],
			'reminder over thirty days' => ['reminder_invalid', null, 31, ''],
			'message over 500 characters' => ['message_too_long', null, null, str_repeat('a', 501)],
		];
	}

	public function testForcesEverySignerIntoTheFirstGroupWhenOrderIsOff(): void {
		$signers = $this->drafts->replaceSigners($this->envelope, [
			['name' => 'Ana Lima', 'email' => 'Ana@Example.com', 'orderGroup' => 2],
			['name' => 'Bruno Souza', 'email' => 'bruno@example.com', 'orderGroup' => 3],
		]);

		$this->assertSame([1, 1], array_map(fn (Signer $signer): int => $signer->getOrderGroup(), $signers));
		$this->assertSame('ana@example.com', $signers[0]->getEmail());
		$this->assertSame([0, 1], array_map(fn (Signer $signer): int => $signer->getColor(), $signers));
	}

	public function testKeepsTheGroupsWhenOrderIsOn(): void {
		$ordered = $this->drafts->updateSettings($this->envelope, 'Contrato', true, null, null, '');

		$signers = $this->drafts->replaceSigners($ordered, [
			['name' => 'Ana Lima', 'email' => 'ana@example.com', 'orderGroup' => 1],
			['name' => 'Bruno Souza', 'email' => 'bruno@example.com', 'orderGroup' => 2],
		]);

		$this->assertSame([1, 2], array_map(fn (Signer $signer): int => $signer->getOrderGroup(), $signers));
	}

	public function testClearsTheSignatureBoxesWhenSignersAreReplaced(): void {
		$signers = $this->drafts->replaceSigners($this->envelope, [['name' => 'Ana Lima', 'email' => 'ana@example.com']]);
		$documentId = $this->documentId();
		$this->drafts->replaceFields($this->envelope, $documentId, [self::PORTRAIT_PAGE], [self::box($signers[0]->getId())]);

		$this->drafts->replaceSigners($this->envelope, [['name' => 'Bruno Souza', 'email' => 'bruno@example.com']]);

		$this->assertSame([], Server::get(FieldMapper::class)->findByDocument($documentId));
	}

	/**
	 * @dataProvider invalidSigners
	 * @param list<array<string, mixed>> $signers
	 */
	public function testRejectsInvalidSigners(string $expectedCode, bool $signingOrder, array $signers): void {
		$envelope = $this->drafts->updateSettings($this->envelope, 'Contrato', $signingOrder, null, null, '');

		$this->assertRejected($expectedCode, fn () => $this->drafts->replaceSigners($envelope, $signers));
	}

	/** @return array<string, array{string, bool, list<array<string, mixed>>}> */
	public static function invalidSigners(): array {
		$twentyOne = [];
		for ($number = 1; $number <= 21; $number++) {
			$twentyOne[] = ['name' => 'Pessoa ' . $number, 'email' => 'pessoa' . $number . '@example.com'];
		}
		return [
			'no signers' => ['no_signers', false, []],
			'more than twenty' => ['too_many_signers', false, $twentyOne],
			'blank name' => ['signer_name_invalid', false, [['name' => '  ', 'email' => 'ana@example.com']]],
			'invalid email' => ['signer_email_invalid', false, [['name' => 'Ana Lima', 'email' => 'ana.example.com']]],
			'duplicate email' => ['signer_email_duplicate', false, [['name' => 'Ana Lima', 'email' => 'ana@example.com'], ['name' => 'Ana L.', 'email' => 'ANA@example.com']]],
			'missing group with order on' => ['signer_order_invalid', true, [['name' => 'Ana Lima', 'email' => 'ana@example.com']]],
		];
	}

	public function testStoresBoxesWithPageGeometryAndTheCurrentFileVersion(): void {
		$signers = $this->drafts->replaceSigners($this->envelope, [['name' => 'Ana Lima', 'email' => 'ana@example.com']]);
		$documentId = $this->documentId();
		$edited = $this->writeFile($this->owner, 'Contrato.pdf', self::minimalPdf('versão 2'));

		$fields = $this->drafts->replaceFields($this->envelope, $documentId, [self::PORTRAIT_PAGE, ['width' => 841.89, 'height' => 595.28, 'rotation' => 90]], [
			self::box($signers[0]->getId()),
			['signerId' => $signers[0]->getId(), 'type' => 'initials', 'page' => 1, 'x' => 0.8, 'y' => 0.85, 'width' => 0.14, 'height' => 0.09],
		]);

		$this->assertCount(2, $fields);
		$document = Server::get(DocumentMapper::class)->findByEnvelope($this->envelope->getId())[0];
		$this->assertSame(2, $document->getPageCount());
		$this->assertSame(90, $document->getPages()[1]['rotation']);
		$this->assertSame($edited->getEtag(), $document->getSourceEtag());
	}

	/**
	 * @dataProvider invalidBoxes
	 * @param array<string, mixed> $boxOverrides
	 * @param list<array<string, mixed>> $pages
	 */
	public function testRejectsInvalidBoxes(string $expectedCode, array $boxOverrides, array $pages): void {
		$signers = $this->drafts->replaceSigners($this->envelope, [['name' => 'Ana Lima', 'email' => 'ana@example.com']]);
		$box = $boxOverrides + self::box($signers[0]->getId());

		$this->assertRejected($expectedCode, fn () => $this->drafts->replaceFields($this->envelope, $this->documentId(), $pages, [$box]));
	}

	/** @return array<string, array{string, array<string, mixed>, list<array<string, mixed>>}> */
	public static function invalidBoxes(): array {
		$page = ['width' => 595.28, 'height' => 841.89, 'rotation' => 0];
		return [
			'unknown signer' => ['unknown_signer', ['signerId' => 999999999], [$page]],
			'unknown type' => ['field_type_invalid', ['type' => 'stamp'], [$page]],
			'page beyond the document' => ['field_page_invalid', ['page' => 1], [$page]],
			'box past the right edge' => ['field_outside_page', ['x' => 0.9, 'width' => 0.2], [$page]],
			'box past the bottom edge' => ['field_outside_page', ['y' => 0.95, 'height' => 0.1], [$page]],
			'negative position' => ['field_outside_page', ['x' => -0.1], [$page]],
			'no pages' => ['pages_invalid', [], []],
			'odd rotation' => ['pages_invalid', [], [['width' => 595.28, 'height' => 841.89, 'rotation' => 45]]],
		];
	}

	public function testRejectsADocumentOfAnotherEnvelope(): void {
		$other = $this->drafts->create($this->owner, 'Outro', [$this->writeFile($this->owner, 'Outro.pdf', self::minimalPdf())->getId()]);
		$otherDocumentId = Server::get(DocumentMapper::class)->findByEnvelope($other->getId())[0]->getId();

		$this->assertRejected('document_not_found', fn () => $this->drafts->replaceFields($this->envelope, $otherDocumentId, [self::PORTRAIT_PAGE], []));
	}

	public function testRefusesToEditAnEnvelopeThatWasSent(): void {
		$this->envelope->setStatus(EnvelopeStatus::Pending->value);
		Server::get(EnvelopeMapper::class)->update($this->envelope);

		$this->assertRejected('not_a_draft', fn () => $this->drafts->replaceSigners($this->envelope, [['name' => 'Ana Lima', 'email' => 'ana@example.com']]));
	}

	private function documentId(): int {
		return Server::get(DocumentMapper::class)->findByEnvelope($this->envelope->getId())[0]->getId();
	}

	/** @return array{signerId: int, type: string, page: int, x: float, y: float, width: float, height: float} */
	private static function box(int $signerId): array {
		return ['signerId' => $signerId, 'type' => 'signature', 'page' => 0, 'x' => 0.1, 'y' => 0.75, 'width' => 0.2, 'height' => 0.09];
	}

	private function assertRejected(string $expectedCode, callable $action): void {
		try {
			$action();
			$this->fail('Expected the draft to be rejected with ' . $expectedCode);
		} catch (DraftRejected $rejection) {
			$this->assertSame($expectedCode, $rejection->errorCode);
		}
	}
}
```

Note on `writeFile` in `testStoresBoxesWithPageGeometryAndTheCurrentFileVersion`: the file already exists, so `newFile` throws. Before running, change the trait's `writeFile` so it overwrites an existing file with `putContent`. Replace its last line (`return $userFolder->newFile($path, $content);`) with:
```php
		if ($userFolder->nodeExists($path)) {
			$existing = $userFolder->get($path);
			$existing->putContent($content);
			return $existing;
		}
		return $userFolder->newFile($path, $content);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `tests/env/phpunit.sh --filter EnvelopeDraftsEditingTest`
Expected: ERROR `Call to undefined method OCA\Assinaturas\Draft\EnvelopeDrafts::updateSettings()`.

- [ ] **Step 3: Implement**

In `lib/Draft/EnvelopeDrafts.php`:

(a) Add the imports `use OCA\Assinaturas\Db\Field;`, `use OCA\Assinaturas\Db\FieldType;`, `use OCA\Assinaturas\Db\Signer;` and `use OCP\IConfig;`.

(b) Add these constants at the top of the class:
```php
	private const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
	private const ALLOWED_ROTATIONS = [0, 90, 180, 270];
	private const COORDINATE_TOLERANCE = 0.0001;
	private const COLOR_COUNT = 8;
```

(c) Add `private IConfig $systemConfig,` as the **last** constructor parameter.

(d) Add these public methods after `delete()`:
```php
	/** @throws DraftRejected */
	public function updateSettings(Envelope $envelope, string $title, bool $signingOrder, ?string $deadlineDate, ?int $reminderDays, string $message): Envelope {
		$this->assertDraft($envelope);
		self::assertTitle($title);
		$isReminderInvalid = $reminderDays !== null && ($reminderDays < EnvelopeLimits::MIN_REMINDER_DAYS || $reminderDays > EnvelopeLimits::MAX_REMINDER_DAYS);
		if ($isReminderInvalid) {
			throw new DraftRejected('reminder_invalid', 'Reminders run every 1 to 30 days');
		}
		if (mb_strlen($message) > EnvelopeLimits::MAX_MESSAGE_LENGTH) {
			throw new DraftRejected('message_too_long', 'The message must have at most ' . EnvelopeLimits::MAX_MESSAGE_LENGTH . ' characters');
		}
		$envelope->setTitle(trim($title));
		$envelope->setSigningOrder($signingOrder);
		$envelope->setDeadlineAt($deadlineDate === null ? null : $this->endOfDay($deadlineDate));
		$envelope->setReminderDays($reminderDays);
		$envelope->setMessage($message === '' ? null : $message);
		$envelope->setUpdatedAt($this->timeFactory->getTime());
		return $this->envelopeMapper->update($envelope);
	}

	/**
	 * Replaces every signer. Signature boxes point at signers, so this also clears the boxes.
	 *
	 * @param list<array<string, mixed>> $signers each with name, email and (when ordered) orderGroup
	 * @return list<Signer>
	 * @throws DraftRejected
	 */
	public function replaceSigners(Envelope $envelope, array $signers): array {
		$this->assertDraft($envelope);
		if ($signers === []) {
			throw new DraftRejected('no_signers', 'Add at least one signer');
		}
		if (count($signers) > EnvelopeLimits::MAX_SIGNERS) {
			throw new DraftRejected('too_many_signers', 'An envelope has at most ' . EnvelopeLimits::MAX_SIGNERS . ' signers');
		}
		$emails = [];
		foreach ($signers as $signer) {
			$emails[] = self::assertSigner($signer, $envelope->getSigningOrder());
		}
		if (count(array_unique($emails)) !== count($emails)) {
			throw new DraftRejected('signer_email_duplicate', 'Each signer needs a different email');
		}
		$this->deleteSignersAndBoxes($envelope);
		$created = [];
		foreach (array_values($signers) as $index => $signer) {
			$entity = new Signer();
			$entity->setEnvelopeId($envelope->getId());
			$entity->setName(trim((string)$signer['name']));
			$entity->setEmail($emails[$index]);
			$entity->setOrderGroup($envelope->getSigningOrder() ? (int)$signer['orderGroup'] : 1);
			$entity->setColor($index % self::COLOR_COUNT);
			$created[] = $this->signerMapper->insert($entity);
		}
		$this->touch($envelope);
		return $created;
	}

	/**
	 * Replaces a document's signature boxes. The editor measured the pages on the file's current
	 * version, so that version becomes the one Send checks against.
	 *
	 * @param list<array<string, mixed>> $pages each with width, height and rotation, as displayed
	 * @param list<array<string, mixed>> $fields each with signerId, type, page, x, y, width and height (top-left origin, 0..1)
	 * @return list<Field>
	 * @throws DraftRejected
	 */
	public function replaceFields(Envelope $envelope, int $documentId, array $pages, array $fields): array {
		$this->assertDraft($envelope);
		$document = $this->documentOf($envelope, $documentId);
		self::assertPages($pages);
		$signerIds = array_map(fn (Signer $signer): int => $signer->getId(), $this->signerMapper->findByEnvelope($envelope->getId()));
		foreach ($fields as $field) {
			self::assertField($field, count($pages), $signerIds);
		}
		foreach ($this->fieldMapper->findByDocument($documentId) as $existing) {
			$this->fieldMapper->delete($existing);
		}
		$created = [];
		foreach ($fields as $field) {
			$entity = new Field();
			$entity->setDocumentId($documentId);
			$entity->setSignerId((int)$field['signerId']);
			$entity->setType((string)$field['type']);
			$entity->setPage((int)$field['page']);
			$entity->setX((float)$field['x']);
			$entity->setY((float)$field['y']);
			$entity->setWidth((float)$field['width']);
			$entity->setHeight((float)$field['height']);
			$created[] = $this->fieldMapper->insert($entity);
		}
		$document->setPages(array_map(fn (array $page): array => ['width' => (float)$page['width'], 'height' => (float)$page['height'], 'rotation' => (int)$page['rotation']], $pages));
		$document->setPageCount(count($pages));
		$document->setSourceEtag($this->currentEtag($envelope->getOwnerUid(), $document));
		$this->documentMapper->update($document);
		$this->touch($envelope);
		return $created;
	}
```

(e) Add these private methods after `assertDraft()`:
```php
	private function endOfDay(string $date): int {
		$day = \DateTimeImmutable::createFromFormat('!Y-m-d', $date, new \DateTimeZone($this->timezoneName()));
		if ($day === false || $day->format('Y-m-d') !== $date) {
			throw new DraftRejected('deadline_invalid', 'The deadline must be a date in the format YYYY-MM-DD');
		}
		$endOfDay = $day->setTime(23, 59, 59)->getTimestamp();
		if ($endOfDay <= $this->timeFactory->getTime()) {
			throw new DraftRejected('deadline_invalid', 'The deadline must be in the future');
		}
		return $endOfDay;
	}

	private function timezoneName(): string {
		$configured = $this->systemConfig->getSystemValueString('default_timezone', self::DEFAULT_TIMEZONE);
		return in_array($configured, \DateTimeZone::listIdentifiers(), true) ? $configured : self::DEFAULT_TIMEZONE;
	}

	private function deleteSignersAndBoxes(Envelope $envelope): void {
		foreach ($this->documentMapper->findByEnvelope($envelope->getId()) as $document) {
			foreach ($this->fieldMapper->findByDocument($document->getId()) as $field) {
				$this->fieldMapper->delete($field);
			}
		}
		foreach ($this->signerMapper->findByEnvelope($envelope->getId()) as $signer) {
			$this->signerMapper->delete($signer);
		}
	}

	private function documentOf(Envelope $envelope, int $documentId): Document {
		foreach ($this->documentMapper->findByEnvelope($envelope->getId()) as $document) {
			if ($document->getId() === $documentId) {
				return $document;
			}
		}
		throw new DraftRejected('document_not_found', 'This document is not part of the envelope');
	}

	private function currentEtag(string $ownerUid, Document $document): string {
		$node = $this->rootFolder->getUserFolder($ownerUid)->getFirstNodeById($document->getSourceFileId());
		if (!$node instanceof File) {
			throw new DraftRejected('file_not_found', 'The original file is no longer available');
		}
		return $node->getEtag();
	}

	private function touch(Envelope $envelope): void {
		$envelope->setUpdatedAt($this->timeFactory->getTime());
		$this->envelopeMapper->update($envelope);
	}

	/**
	 * @param array<string, mixed> $signer
	 * @return string the normalized email
	 */
	private static function assertSigner(array $signer, bool $signingOrder): string {
		$name = trim((string)($signer['name'] ?? ''));
		if ($name === '' || mb_strlen($name) > EnvelopeLimits::MAX_NAME_LENGTH) {
			throw new DraftRejected('signer_name_invalid', 'Each signer needs a name of up to ' . EnvelopeLimits::MAX_NAME_LENGTH . ' characters');
		}
		$email = strtolower(trim((string)($signer['email'] ?? '')));
		if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
			throw new DraftRejected('signer_email_invalid', 'Each signer needs a valid email');
		}
		if ($signingOrder && (int)($signer['orderGroup'] ?? 0) < 1) {
			throw new DraftRejected('signer_order_invalid', 'With signing order on, each signer needs a group of 1 or more');
		}
		return $email;
	}

	/** @param list<array<string, mixed>> $pages */
	private static function assertPages(array $pages): void {
		if ($pages === []) {
			throw new DraftRejected('pages_invalid', 'The document needs its page geometry');
		}
		foreach ($pages as $page) {
			$isValid = is_numeric($page['width'] ?? null) && (float)$page['width'] > 0
				&& is_numeric($page['height'] ?? null) && (float)$page['height'] > 0
				&& in_array((int)($page['rotation'] ?? -1), self::ALLOWED_ROTATIONS, true);
			if (!$isValid) {
				throw new DraftRejected('pages_invalid', 'Each page needs a positive width, height and a rotation of 0, 90, 180 or 270');
			}
		}
	}

	/**
	 * @param array<string, mixed> $field
	 * @param list<int> $signerIds
	 */
	private static function assertField(array $field, int $pageCount, array $signerIds): void {
		if (!in_array((int)($field['signerId'] ?? 0), $signerIds, true)) {
			throw new DraftRejected('unknown_signer', 'Each box must belong to a signer of this envelope');
		}
		if (FieldType::tryFrom((string)($field['type'] ?? '')) === null) {
			throw new DraftRejected('field_type_invalid', 'A box is either a signature or initials');
		}
		$page = (int)($field['page'] ?? -1);
		if ($page < 0 || $page >= $pageCount) {
			throw new DraftRejected('field_page_invalid', 'A box points at a page the document does not have');
		}
		$x = (float)($field['x'] ?? -1);
		$y = (float)($field['y'] ?? -1);
		$width = (float)($field['width'] ?? 0);
		$height = (float)($field['height'] ?? 0);
		$isOutside = $x < 0 || $y < 0 || $width <= 0 || $height <= 0
			|| $x + $width > 1 + self::COORDINATE_TOLERANCE
			|| $y + $height > 1 + self::COORDINATE_TOLERANCE;
		if ($isOutside) {
			throw new DraftRejected('field_outside_page', 'A box must stay inside its page');
		}
	}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'EnvelopeDraftsEditingTest|EnvelopeDraftsCreationTest'`, then `tests/env/phpunit.sh`.
Expected: `OK` for 27 tests in the editing test (10 tests plus the data-provider rows) and 9 creation tests; the full suite is green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: edit draft settings, signers and signature boxes with validation"
```

---

### Task 7: Envelope JSON API and its contract

**Files:**
- Create: `lib/Api/EnvelopeView.php`
- Create: `lib/Controller/EnvelopeController.php`
- Create: `docs/api.md`
- Test: `tests/Integration/Controller/EnvelopeControllerTest.php`

**Interfaces:**
- Consumes:
  - `AccessPolicy` (Task 4);
  - `EnvelopeDrafts`, `DraftRejected` (Tasks 5–6);
  - `SignerStatus` and entity accessors (Task 2);
  - `TestUsers`, `EnvelopeCleanup`.
- Produces:
  - `EnvelopeView::summary(Envelope, int $documentCount, list<Signer>): array` returns `uuid`, `title`, `status`, `ownerUid`, `sandbox`, `documentCount`, `signerCount`, `signedCount`, `createdAt`, `updatedAt`, `sentAt`, `completedAt`, `deadlineAt`.
  - `EnvelopeView::detail(Envelope, list<Document>, list<Signer>, array<int, list<Field>>, list<Event>): array` returns the summary plus:
    - `signingOrder`, `reminderDays`, `message`, `error`, `refusedReason`;
    - `documents[]`: `id`, `position`, `sourceFileId`, `sourcePath`, `pageCount`, `pages`, `saveStatus`, `signedFileId`, `fields[]`;
    - `signers[]`: `id`, `name`, `email`, `orderGroup`, `status`, `color`, `releasedAt`, `viewedAt`, `signedAt`, `emailBouncedAt`;
    - `events[]`: `type`, `signerId`, `occurredAt`, `actorUid`, `detail`.
  - `EnvelopeController` routes (all `#[NoAdminRequired]`):

    | Method and path | Action |
    |---|---|
    | `GET /api/v1/envelopes?scope=mine\|all` | `index` |
    | `POST /api/v1/envelopes` | `create(title, fileIds)` |
    | `GET /api/v1/envelopes/{uuid}` | `show` |
    | `PUT /api/v1/envelopes/{uuid}` | `update(title, signingOrder, deadline, reminderDays, message)` |
    | `PUT /api/v1/envelopes/{uuid}/signers` | `replaceSigners(signers)` |
    | `PUT /api/v1/envelopes/{uuid}/documents/{documentId}/fields` | `replaceFields(pages, fields)` |
    | `DELETE /api/v1/envelopes/{uuid}` | `destroy` |

    Task 9 adds `POST /api/v1/envelopes/{uuid}/send`.
  - The controller's private `editing(string $uuid, callable $action): JSONResponse` is a higher-order guard: 404 when the user can't read the envelope, 403 when they can't edit it, 422 on `DraftRejected`.

- [ ] **Step 1: Write the failing test**

`tests/Integration/Controller/EnvelopeControllerTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Controller;

use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Controller\EnvelopeController;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\AppFramework\Http;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class EnvelopeControllerTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;

	private const PORTRAIT_PAGE = ['width' => 595.28, 'height' => 841.89, 'rotation' => 0];

	private string $member;

	protected function setUp(): void {
		parent::setUp();
		$this->member = $this->createUser();
		$this->addToGroup($this->member, SignersGroup::GROUP_ID);
		self::loginAsUser($this->member);
	}

	protected function tearDown(): void {
		self::logout();
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testCreatesADraftAndShowsItWithoutProviderSecrets(): void {
		$file = $this->writeFile($this->member, 'Contrato.pdf', self::minimalPdf());

		$created = $this->controller()->create('Contrato', [$file->getId()]);
		$envelope = Server::get(EnvelopeMapper::class)->findByUuid($created->getData()['uuid']);
		$envelope->setZapsignToken('provider-document-token');
		Server::get(EnvelopeMapper::class)->update($envelope);
		$shown = $this->controller()->show($envelope->getUuid());

		$this->assertSame(Http::STATUS_CREATED, $created->getStatus());
		$this->assertSame(Http::STATUS_OK, $shown->getStatus());
		$this->assertSame('draft', $shown->getData()['status']);
		$this->assertSame('/Contrato.pdf', $shown->getData()['documents'][0]['sourcePath']);
		$serialized = json_encode($shown->getData(), JSON_THROW_ON_ERROR);
		$this->assertStringNotContainsString('provider-document-token', $serialized);
		$this->assertStringNotContainsStringIgnoringCase('token', $serialized);
		$this->assertStringNotContainsString('signUrl', $serialized);
	}

	public function testForbidsNonMembersFromCreating(): void {
		$outsider = $this->createUser('Pessoa de Fora');
		self::loginAsUser($outsider);
		$file = $this->writeFile($outsider, 'Contrato.pdf', self::minimalPdf());

		$response = $this->controller()->create('Contrato', [$file->getId()]);

		$this->assertSame(Http::STATUS_FORBIDDEN, $response->getStatus());
		$this->assertSame('forbidden', $response->getData()['error']);
	}

	public function testHidesSomeoneElsesEnvelope(): void {
		$someoneElse = $this->createUser('Outra Pessoa');
		$theirs = Server::get(EnvelopeDrafts::class)->create($someoneElse, 'Deles', [$this->writeFile($someoneElse, 'b.pdf', self::minimalPdf())->getId()]);

		$response = $this->controller()->show($theirs->getUuid());

		$this->assertSame(Http::STATUS_NOT_FOUND, $response->getStatus());
	}

	public function testReportsValidationFailuresAsUnprocessable(): void {
		$notes = $this->writeFile($this->member, 'notas.txt', 'texto');

		$response = $this->controller()->create('Notas', [$notes->getId()]);

		$this->assertSame(Http::STATUS_UNPROCESSABLE_ENTITY, $response->getStatus());
		$this->assertSame('file_not_pdf', $response->getData()['error']);
	}

	public function testListsMineUnlessAnAdminAsksForEveryone(): void {
		$mine = $this->controller()->create('Meu', [$this->writeFile($this->member, 'a.pdf', self::minimalPdf())->getId()])->getData()['uuid'];

		$memberAskingForAll = self::uuids($this->controller()->index('all')->getData());
		self::loginAsUser('admin');
		$adminAll = self::uuids($this->controller()->index('all')->getData());
		$adminMine = self::uuids($this->controller()->index('mine')->getData());

		$this->assertContains($mine, $memberAskingForAll);
		$this->assertContains($mine, $adminAll);
		$this->assertNotContains($mine, $adminMine);
	}

	public function testReplacesSignersAndBoxesOfADraft(): void {
		$uuid = $this->controller()->create('Contrato', [$this->writeFile($this->member, 'Contrato.pdf', self::minimalPdf())->getId()])->getData()['uuid'];

		$withSigners = $this->controller()->replaceSigners($uuid, [
			['name' => 'Ana Lima', 'email' => 'ana@example.com'],
			['name' => 'Bruno Souza', 'email' => 'bruno@example.com'],
		])->getData();
		$documentId = $withSigners['documents'][0]['id'];
		$signerId = $withSigners['signers'][0]['id'];
		$withBoxes = $this->controller()->replaceFields($uuid, $documentId, [self::PORTRAIT_PAGE], [
			['signerId' => $signerId, 'type' => 'signature', 'page' => 0, 'x' => 0.1, 'y' => 0.75, 'width' => 0.2, 'height' => 0.09],
		])->getData();

		$this->assertCount(2, $withSigners['signers']);
		$this->assertCount(1, $withBoxes['documents'][0]['fields']);
		$this->assertSame(1, $withBoxes['documents'][0]['pageCount']);
	}

	public function testForbidsAnAdminFromEditingSomeoneElsesDraft(): void {
		$uuid = $this->controller()->create('Contrato', [$this->writeFile($this->member, 'Contrato.pdf', self::minimalPdf())->getId()])->getData()['uuid'];
		self::loginAsUser('admin');

		$response = $this->controller()->update($uuid, 'Mudado pelo admin');

		$this->assertSame(Http::STATUS_FORBIDDEN, $response->getStatus());
	}

	public function testDeletesADraft(): void {
		$uuid = $this->controller()->create('Contrato', [$this->writeFile($this->member, 'Contrato.pdf', self::minimalPdf())->getId()])->getData()['uuid'];

		$deleted = $this->controller()->destroy($uuid);

		$this->assertSame(Http::STATUS_OK, $deleted->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->show($uuid)->getStatus());
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

- [ ] **Step 2: Run the test to verify it fails**

Run: `tests/env/phpunit.sh --filter EnvelopeControllerTest`
Expected: ERROR `Class "OCA\Assinaturas\Controller\EnvelopeController" not found`.

- [ ] **Step 3: Implement the view**

`lib/Api/EnvelopeView.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Api;

use OCA\Assinaturas\Db\Document;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\Event;
use OCA\Assinaturas\Db\Field;
use OCA\Assinaturas\Db\Signer;
use OCA\Assinaturas\Db\SignerStatus;

/** The API's JSON shapes. Never includes ZapSign document tokens, signer tokens or sign URLs. */
final class EnvelopeView {
	/**
	 * @param list<Signer> $signers
	 * @return array<string, mixed>
	 */
	public function summary(Envelope $envelope, int $documentCount, array $signers): array {
		return [
			'uuid' => $envelope->getUuid(),
			'title' => $envelope->getTitle(),
			'status' => $envelope->getStatus(),
			'ownerUid' => $envelope->getOwnerUid(),
			'sandbox' => $envelope->getSandbox(),
			'documentCount' => $documentCount,
			'signerCount' => count($signers),
			'signedCount' => count(array_filter($signers, fn (Signer $signer): bool => $signer->statusValue() === SignerStatus::Signed)),
			'createdAt' => $envelope->getCreatedAt(),
			'updatedAt' => $envelope->getUpdatedAt(),
			'sentAt' => $envelope->getSentAt(),
			'completedAt' => $envelope->getCompletedAt(),
			'deadlineAt' => $envelope->getDeadlineAt(),
		];
	}

	/**
	 * @param list<Document> $documents
	 * @param list<Signer> $signers
	 * @param array<int, list<Field>> $fieldsByDocument
	 * @param list<Event> $events
	 * @return array<string, mixed>
	 */
	public function detail(Envelope $envelope, array $documents, array $signers, array $fieldsByDocument, array $events): array {
		return $this->summary($envelope, count($documents), $signers) + [
			'signingOrder' => $envelope->getSigningOrder(),
			'reminderDays' => $envelope->getReminderDays(),
			'message' => $envelope->getMessage() ?? '',
			'error' => $envelope->getError(),
			'refusedReason' => $envelope->getRefusedReason(),
			'documents' => array_map(fn (Document $document): array => self::document($document, $fieldsByDocument[$document->getId()] ?? []), $documents),
			'signers' => array_map(self::signer(...), $signers),
			'events' => array_map(self::event(...), $events),
		];
	}

	/**
	 * @param list<Field> $fields
	 * @return array<string, mixed>
	 */
	private static function document(Document $document, array $fields): array {
		return [
			'id' => $document->getId(),
			'position' => $document->getPosition(),
			'sourceFileId' => $document->getSourceFileId(),
			'sourcePath' => $document->getSourcePath(),
			'pageCount' => $document->getPageCount(),
			'pages' => $document->getPages() ?? [],
			'saveStatus' => $document->getSaveStatus(),
			'signedFileId' => $document->getSignedFileId(),
			'fields' => array_map(self::field(...), $fields),
		];
	}

	/** @return array<string, mixed> */
	private static function field(Field $field): array {
		return [
			'id' => $field->getId(),
			'signerId' => $field->getSignerId(),
			'type' => $field->getType(),
			'page' => $field->getPage(),
			'x' => $field->getX(),
			'y' => $field->getY(),
			'width' => $field->getWidth(),
			'height' => $field->getHeight(),
		];
	}

	/** @return array<string, mixed> */
	private static function signer(Signer $signer): array {
		return [
			'id' => $signer->getId(),
			'name' => $signer->getName(),
			'email' => $signer->getEmail(),
			'orderGroup' => $signer->getOrderGroup(),
			'status' => $signer->getStatus(),
			'color' => $signer->getColor(),
			'releasedAt' => $signer->getReleasedAt(),
			'viewedAt' => $signer->getViewedAt(),
			'signedAt' => $signer->getSignedAt(),
			'emailBouncedAt' => $signer->getEmailBouncedAt(),
		];
	}

	/** @return array<string, mixed> */
	private static function event(Event $event): array {
		return [
			'type' => $event->getType(),
			'signerId' => $event->getSignerId(),
			'occurredAt' => $event->getOccurredAt(),
			'actorUid' => $event->getActorUid(),
			'detail' => $event->getDetail() ?? [],
		];
	}
}
```

- [ ] **Step 4: Implement the controller**

`lib/Controller/EnvelopeController.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Controller;

use OCA\Assinaturas\Access\AccessPolicy;
use OCA\Assinaturas\Api\EnvelopeView;
use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EventMapper;
use OCA\Assinaturas\Db\FieldMapper;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Draft\DraftRejected;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\FrontpageRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;
use OCP\IUserSession;

final class EnvelopeController extends Controller {
	private const SCOPE_EVERYONE = 'all';

	public function __construct(
		IRequest $request,
		private IUserSession $userSession,
		private AccessPolicy $accessPolicy,
		private EnvelopeMapper $envelopeMapper,
		private DocumentMapper $documentMapper,
		private SignerMapper $signerMapper,
		private FieldMapper $fieldMapper,
		private EventMapper $eventMapper,
		private EnvelopeDrafts $drafts,
		private EnvelopeView $view,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'GET', url: '/api/v1/envelopes')]
	public function index(string $scope = 'mine'): JSONResponse {
		$userId = $this->currentUserId();
		$everyone = $scope === self::SCOPE_EVERYONE && $this->accessPolicy->canSeeAll($userId);
		$envelopes = $this->drafts->listFor($userId, $everyone);
		return new JSONResponse(['envelopes' => array_map(fn (Envelope $envelope): array => $this->summary($envelope), $envelopes)]);
	}

	/** @param list<int> $fileIds */
	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'POST', url: '/api/v1/envelopes')]
	public function create(string $title, array $fileIds): JSONResponse {
		$userId = $this->currentUserId();
		if (!$this->accessPolicy->canUseApp($userId)) {
			return self::forbidden();
		}
		return self::handlingRejections(fn (): JSONResponse => new JSONResponse($this->detail($this->drafts->create($userId, $title, $fileIds)), Http::STATUS_CREATED));
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'GET', url: '/api/v1/envelopes/{uuid}')]
	public function show(string $uuid): JSONResponse {
		$envelope = $this->readableEnvelope($uuid);
		if ($envelope === null) {
			return self::notFound();
		}
		return new JSONResponse($this->detail($envelope));
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'PUT', url: '/api/v1/envelopes/{uuid}')]
	public function update(string $uuid, string $title, bool $signingOrder = false, ?string $deadline = null, ?int $reminderDays = null, string $message = ''): JSONResponse {
		return $this->editing($uuid, fn (Envelope $envelope): JSONResponse => new JSONResponse(
			$this->detail($this->drafts->updateSettings($envelope, $title, $signingOrder, $deadline, $reminderDays, $message)),
		));
	}

	/** @param list<array<string, mixed>> $signers */
	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'PUT', url: '/api/v1/envelopes/{uuid}/signers')]
	public function replaceSigners(string $uuid, array $signers): JSONResponse {
		return $this->editing($uuid, function (Envelope $envelope) use ($signers): JSONResponse {
			$this->drafts->replaceSigners($envelope, $signers);
			return new JSONResponse($this->detail($envelope));
		});
	}

	/**
	 * @param list<array<string, mixed>> $pages
	 * @param list<array<string, mixed>> $fields
	 */
	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'PUT', url: '/api/v1/envelopes/{uuid}/documents/{documentId}/fields')]
	public function replaceFields(string $uuid, int $documentId, array $pages, array $fields): JSONResponse {
		return $this->editing($uuid, function (Envelope $envelope) use ($documentId, $pages, $fields): JSONResponse {
			$this->drafts->replaceFields($envelope, $documentId, $pages, $fields);
			return new JSONResponse($this->detail($envelope));
		});
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'DELETE', url: '/api/v1/envelopes/{uuid}')]
	public function destroy(string $uuid): JSONResponse {
		return $this->editing($uuid, function (Envelope $envelope): JSONResponse {
			$this->drafts->delete($envelope);
			return new JSONResponse(['deleted' => true]);
		});
	}

	/**
	 * Higher-order guard: loads an envelope the current user may edit, runs the action,
	 * and turns draft rejections into 422 responses.
	 *
	 * @param callable(Envelope): JSONResponse $action
	 */
	private function editing(string $uuid, callable $action): JSONResponse {
		$envelope = $this->readableEnvelope($uuid);
		if ($envelope === null) {
			return self::notFound();
		}
		if (!$this->accessPolicy->canEdit($envelope, $this->currentUserId())) {
			return self::forbidden();
		}
		return self::handlingRejections(fn (): JSONResponse => $action($envelope));
	}

	/** @param callable(): JSONResponse $action */
	private static function handlingRejections(callable $action): JSONResponse {
		try {
			return $action();
		} catch (DraftRejected $rejection) {
			return new JSONResponse(['error' => $rejection->errorCode, 'message' => $rejection->getMessage()], Http::STATUS_UNPROCESSABLE_ENTITY);
		}
	}

	private function readableEnvelope(string $uuid): ?Envelope {
		try {
			$envelope = $this->envelopeMapper->findByUuid($uuid);
		} catch (DoesNotExistException) {
			return null;
		}
		return $this->accessPolicy->canRead($envelope, $this->currentUserId()) ? $envelope : null;
	}

	private function currentUserId(): string {
		return $this->userSession->getUser()?->getUID() ?? '';
	}

	/** @return array<string, mixed> */
	private function summary(Envelope $envelope): array {
		return $this->view->summary(
			$envelope,
			count($this->documentMapper->findByEnvelope($envelope->getId())),
			$this->signerMapper->findByEnvelope($envelope->getId()),
		);
	}

	/** @return array<string, mixed> */
	private function detail(Envelope $envelope): array {
		$current = $this->envelopeMapper->findById($envelope->getId());
		$documents = $this->documentMapper->findByEnvelope($current->getId());
		$fieldsByDocument = [];
		foreach ($documents as $document) {
			$fieldsByDocument[$document->getId()] = $this->fieldMapper->findByDocument($document->getId());
		}
		return $this->view->detail(
			$current,
			$documents,
			$this->signerMapper->findByEnvelope($current->getId()),
			$fieldsByDocument,
			$this->eventMapper->findByEnvelope($current->getId()),
		);
	}

	private static function forbidden(): JSONResponse {
		return new JSONResponse(['error' => 'forbidden', 'message' => 'You are not allowed to do this'], Http::STATUS_FORBIDDEN);
	}

	private static function notFound(): JSONResponse {
		return new JSONResponse(['error' => 'not_found', 'message' => 'Envelope not found'], Http::STATUS_NOT_FOUND);
	}
}
```

- [ ] **Step 5: Write the API contract for Plan 3**

`docs/api.md`:
````markdown
# Assinaturas JSON API (v1)

Base path: `/index.php/apps/assinaturas/api/v1`.

- Logged-in Nextcloud session. State-changing requests send the `requesttoken` header (CSRF), as every Nextcloud frontend does.
- JSON in and out, with camelCase keys.
- Timestamps are epoch seconds (UTC).
- **Never** returned: ZapSign document tokens, signer tokens, sign URLs.

## Errors

`{"error": "<code>", "message": "<English, for developers>"}`. The UI maps `error` to pt_BR text.

| HTTP | When |
|---|---|
| 403 `forbidden` | The user can't use the app (not in the "Avuz Assinaturas" group and not an admin), or can't edit this envelope |
| 404 `not_found` | Unknown envelope, or one the user may not read |
| 409 `already_sending` | Send was requested while the envelope is already sending |
| 422 `<draft code>` | The input needs fixing. Codes are listed below |

**Draft codes:**
- files: `no_files`, `too_many_files`, `file_not_found`, `file_not_pdf`, `file_too_large`;
- envelope: `title_invalid`, `not_a_draft`, `deadline_invalid`, `reminder_invalid`, `message_too_long`;
- signers: `no_signers`, `too_many_signers`, `signer_name_invalid`, `signer_email_invalid`, `signer_email_duplicate`, `signer_order_invalid`;
- pages and boxes: `pages_invalid`, `unknown_signer`, `field_type_invalid`, `field_page_invalid`, `field_outside_page`, `document_not_found`.

## Envelope summary
```json
{"uuid": "…", "title": "Contrato", "status": "draft", "ownerUid": "maria", "sandbox": false,
 "documentCount": 2, "signerCount": 2, "signedCount": 0,
 "createdAt": 1790000000, "updatedAt": 1790000000, "sentAt": null, "completedAt": null, "deadlineAt": null}
```

**`status` values:** `draft`, `sending`, `failed`, `pending`, `finalizing`, `completed`, `refused`, `expired`, `cancelled`, `archived_sandbox`.

## Envelope detail

The summary plus:
```json
{"signingOrder": true, "reminderDays": 3, "message": "", "error": null, "refusedReason": null,
 "documents": [{"id": 12, "position": 0, "sourceFileId": 345, "sourcePath": "/Contratos/Contrato.pdf",
   "pageCount": 2, "pages": [{"width": 595.28, "height": 841.89, "rotation": 0}],
   "saveStatus": "pending", "signedFileId": null,
   "fields": [{"id": 7, "signerId": 3, "type": "signature", "page": 0, "x": 0.1, "y": 0.75, "width": 0.2, "height": 0.09}]}],
 "signers": [{"id": 3, "name": "Ana Lima", "email": "ana@example.com", "orderGroup": 1, "status": "pending",
   "color": 0, "releasedAt": null, "viewedAt": null, "signedAt": null, "emailBouncedAt": null}],
 "events": [{"type": "signed", "signerId": 3, "occurredAt": 1790000000, "actorUid": null, "detail": {}}]}
```

Value notes:
- `error` is one of our codes (see the Global Constraints of Plan 2a); it's never ZapSign text.
- `saveStatus`: `pending`, `saved`, `save_failed`.
- Signer `status`: `pending`, `viewed`, `signed`, `refused`.
- Box coordinates use a **top-left origin**, 0..1, relative to the page **as displayed**.

## Routes

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/envelopes?scope=mine\|all` | — | `{"envelopes": [summary…]}`. `all` works for admins only; others always get their own |
| POST | `/envelopes` | `{"title", "fileIds": [int…]}` (the first file is the main document) | 201 detail |
| GET | `/envelopes/{uuid}` | — | detail |
| PUT | `/envelopes/{uuid}` | `{"title", "signingOrder": bool, "deadline": "YYYY-MM-DD"\|null, "reminderDays": 1..30\|null, "message"}` | detail |
| PUT | `/envelopes/{uuid}/signers` | `{"signers": [{"name", "email", "orderGroup"}…]}`. Replaces every signer **and clears every box** | detail |
| PUT | `/envelopes/{uuid}/documents/{documentId}/fields` | `{"pages": [{"width", "height", "rotation"}…], "fields": [{"signerId", "type": "signature"\|"initials", "page", "x", "y", "width", "height"}…]}` | detail |
| DELETE | `/envelopes/{uuid}` | — (drafts only) | `{"deleted": true}` |
| POST | `/envelopes/{uuid}/send` | — | 202 `{"status": "sending"}` (added in Plan 2a, Task 9) |
````

- [ ] **Step 6: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter EnvelopeControllerTest`, then `tests/env/phpunit.sh`.
Expected: `OK (8 tests, …)`; the full suite is green.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: expose the envelope draft JSON API and document its contract"
```

---

### Task 8: Send I (content checks, message, create or adopt at ZapSign)

**Files:**
- Create: `lib/Send/SendFailure.php`, `lib/Send/PdfInspection.php`, `lib/Send/SentContent.php`, `lib/Send/SignerMessage.php`, `lib/Send/EnvelopeCreation.php`
- Create: `tests/Fakes/ZapSignDoubles.php` (trait, reused by Tasks 9, 11, 12 and 13)
- Test: `tests/Unit/Send/PdfInspectionTest.php`, `tests/Integration/Send/EnvelopeCreationTest.php`

**Interfaces:**
- Consumes:
  - `ZapSignClient::createDocument`, `findDocumentsByFolder`, `getDocument` (Plan 1 and Task 1);
  - `ZapSignSettings` (Task 3);
  - `SendStep` (Task 2);
  - `EnvelopeDrafts` (Tasks 5–6);
  - `TestUsers`, `EnvelopeCleanup`, `FakeHttpTransport`, `RecordingSleeper`.
- Produces:
  - `SendFailure(string $errorCode)` with public readonly `$errorCode`.
  - `PdfInspection::assertSendable(string $content): void`. Throws `SendFailure` with `file_not_pdf`, `file_too_large`, `file_encrypted` or `file_already_signed`.
  - `SentContent::verifiedContent(Envelope $envelope, Document $document): string`.
    - On the first read it checks the etag against `source_etag`, inspects the PDF, and pins `sent_sha256`.
    - Later reads must match that hash, or it throws `SendFailure('file_changed')`.
    - A file that no longer exists throws `SendFailure('file_missing')`.
  - `SignerMessage::compose(Envelope $envelope): string` returns `"<sender display name>, da <company>, enviou documentos para sua assinatura."`, plus a blank line and the sender's note when there is one. Without a company name: `"<name> enviou documentos para sua assinatura."`.
  - `EnvelopeCreation::createOrAdopt(Envelope $envelope): void`:
    - leaves `send_step = Created` and records the ZapSign tokens on the envelope, the main document and every signer;
    - sets `account_fingerprint` and `sandbox`;
    - `EnvelopeCreation::FOLDER_ROOT = '/assinaturas/'`.
  - Trait `ZapSignDoubles`:
    - properties `$transport` (FakeHttpTransport), `$appConfigValues` (array) and `$now` (int, 1_790_000_000);
    - `zapSignSettings(string $environment = 'sandbox', string $instanceUrl = 'https://tenant.example'): ZapSignSettings`;
    - `inMemoryAppConfig(): IAppConfig`;
    - `zapSignClient(ZapSignSettings): ZapSignClient`;
    - `fixedClock(): ITimeFactory`.

- [ ] **Step 1: Write the test doubles trait**

`tests/Fakes/ZapSignDoubles.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Fakes;

use OC\Memcache\ArrayCache;
use OCA\Assinaturas\ZapSign\CallMonitor;
use OCA\Assinaturas\ZapSign\ProviderBackoff;
use OCA\Assinaturas\ZapSign\ZapSignClient;
use OCA\Assinaturas\ZapSign\ZapSignSettings;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IAppConfig;
use OCP\ICacheFactory;
use OCP\IConfig;
use OCP\Security\ISecureRandom;
use OCP\Server;
use Psr\Log\NullLogger;

/** In-memory ZapSign wiring for tests of services built on ZapSignClient. Set $this->transport in setUp. */
trait ZapSignDoubles {
	protected FakeHttpTransport $transport;
	/** @var array<string, mixed> */
	protected array $appConfigValues = [];
	protected int $now = 1_790_000_000;

	protected function zapSignSettings(string $environment = 'sandbox', string $instanceUrl = 'https://tenant.example'): ZapSignSettings {
		$this->appConfigValues += [
			ZapSignSettings::KEY_API_TOKEN => 'sandbox-test-token',
			ZapSignSettings::KEY_ENVIRONMENT => $environment,
			ZapSignSettings::KEY_COMPANY_NAME => 'Construtora Exemplo',
		];
		$systemConfig = $this->createMock(IConfig::class);
		$systemConfig->method('getSystemValueString')->willReturnCallback(fn (string $key, string $default = ''): string => $key === 'overwrite.cli.url' ? $instanceUrl : $default);
		return new ZapSignSettings($this->inMemoryAppConfig(), $systemConfig, Server::get(ISecureRandom::class));
	}

	protected function inMemoryAppConfig(): IAppConfig {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueString')->willReturnCallback(fn (string $app, string $key, string $default = ''): string => (string)($this->appConfigValues[$key] ?? $default));
		$appConfig->method('setValueString')->willReturnCallback(function (string $app, string $key, string $value): bool {
			$this->appConfigValues[$key] = $value;
			return true;
		});
		$appConfig->method('getValueInt')->willReturnCallback(fn (string $app, string $key, int $default = 0): int => (int)($this->appConfigValues[$key] ?? $default));
		$appConfig->method('setValueInt')->willReturnCallback(function (string $app, string $key, int $value): bool {
			$this->appConfigValues[$key] = $value;
			return true;
		});
		$appConfig->method('getValueArray')->willReturnCallback(fn (string $app, string $key, array $default = []): array => (array)($this->appConfigValues[$key] ?? $default));
		$appConfig->method('setValueArray')->willReturnCallback(function (string $app, string $key, array $value): bool {
			$this->appConfigValues[$key] = $value;
			return true;
		});
		$appConfig->method('deleteKey')->willReturnCallback(function (string $app, string $key): void {
			unset($this->appConfigValues[$key]);
		});
		return $appConfig;
	}

	protected function zapSignClient(ZapSignSettings $settings): ZapSignClient {
		$cacheFactory = $this->createMock(ICacheFactory::class);
		$cacheFactory->method('createDistributed')->willReturn(new ArrayCache(''));
		return new ZapSignClient($this->transport, $settings, new CallMonitor(new NullLogger()), new ProviderBackoff($cacheFactory, $this->fixedClock()), new RecordingSleeper());
	}

	protected function fixedClock(): ITimeFactory {
		$timeFactory = $this->createMock(ITimeFactory::class);
		$timeFactory->method('getTime')->willReturnCallback(fn (): int => $this->now);
		return $timeFactory;
	}
}
```

- [ ] **Step 2: Write the failing tests**

`tests/Unit/Send/PdfInspectionTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\Send;

use OCA\Assinaturas\Draft\EnvelopeLimits;
use OCA\Assinaturas\Send\PdfInspection;
use OCA\Assinaturas\Send\SendFailure;
use PHPUnit\Framework\TestCase;

final class PdfInspectionTest extends TestCase {
	private const MINIMAL_PDF = "%PDF-1.7\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";

	public function testAcceptsAPlainPdf(): void {
		(new PdfInspection())->assertSendable(self::MINIMAL_PDF);

		$this->addToAssertionCount(1);
	}

	/** @dataProvider unsendableContents */
	public function testRejectsContentZapSignCannotSign(string $content, string $expectedCode): void {
		try {
			(new PdfInspection())->assertSendable($content);
			$this->fail('Expected ' . $expectedCode);
		} catch (SendFailure $failure) {
			$this->assertSame($expectedCode, $failure->errorCode);
		}
	}

	/** @return array<string, array{string, string}> */
	public static function unsendableContents(): array {
		return [
			'not a pdf' => ['<html>proxy</html>', 'file_not_pdf'],
			'encrypted' => ["%PDF-1.7\ntrailer<</Root 1 0 R/Encrypt 5 0 R>>\n%%EOF\n", 'file_encrypted'],
			'already signed' => ["%PDF-1.7\n9 0 obj<</Type/Sig/ByteRange [0 10 20 30]>>endobj\n%%EOF\n", 'file_already_signed'],
			'larger than ten megabytes' => ['%PDF-' . str_repeat('a', EnvelopeLimits::MAX_FILE_BYTES), 'file_too_large'],
		];
	}
}
```

`tests/Integration/Send/EnvelopeCreationTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Send;

use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\SendStep;
use OCA\Assinaturas\Db\Signer;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Send\EnvelopeCreation;
use OCA\Assinaturas\Send\SendFailure;
use OCA\Assinaturas\Send\SentContent;
use OCA\Assinaturas\Send\SignerMessage;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCA\Assinaturas\ZapSign\Exception\ZapSignUnreachable;
use OCA\Assinaturas\ZapSign\Http\TransportFailure;
use OCA\Assinaturas\ZapSign\ZapSignSettings;
use OCP\IUserManager;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class EnvelopeCreationTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ZapSignDoubles;

	private const MAIN_TOKEN = 'doc-main-token';

	private string $owner;
	private Envelope $envelope;
	/** @var list<Signer> */
	private array $signers;
	private string $contractContent;
	private ZapSignSettings $settings;

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->settings = $this->zapSignSettings();
		$this->owner = $this->createUser('Maria Souza');
		$this->contractContent = self::minimalPdf('contrato');
		$drafts = Server::get(EnvelopeDrafts::class);
		$contract = $this->writeFile($this->owner, 'Contrato.pdf', $this->contractContent);
		$annex = $this->writeFile($this->owner, 'Anexo.pdf', self::minimalPdf('anexo'));
		$envelope = $drafts->create($this->owner, 'Contrato de serviços', [$contract->getId(), $annex->getId()]);
		$this->envelope = $drafts->updateSettings($envelope, 'Contrato de serviços', true, null, null, 'Assine até sexta.');
		$this->signers = $drafts->replaceSigners($this->envelope, [
			['name' => 'Ana Lima', 'email' => 'ana@example.com', 'orderGroup' => 1],
			['name' => 'Bruno Souza', 'email' => 'bruno@example.com', 'orderGroup' => 2],
		]);
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testCreatesTheMainDocumentWithEmailsHeldBackAndRecordsEveryToken(): void {
		$this->transport->willRespond(200, $this->createdPayload());

		$this->creation()->createOrAdopt($this->envelope);

		$request = $this->transport->requests[0];
		$this->assertSame('POST', $request->method());
		$this->assertStringEndsWith('/docs/', $request->url());
		$payload = $this->transport->lastRequestJson();
		$this->assertSame($this->envelope->getUuid(), $payload['external_id']);
		$this->assertSame('/assinaturas/' . $this->envelope->getUuid(), $payload['folder_path']);
		$this->assertTrue($payload['signature_order_active']);
		$this->assertSame($this->contractContent, base64_decode($payload['base64_pdf']));
		$this->assertSame((string)$this->signers[0]->getId(), $payload['signers'][0]['external_id']);
		$this->assertSame(2, $payload['signers'][1]['order_group']);
		$this->assertFalse($payload['signers'][0]['send_automatic_email']);
		$this->assertStringStartsWith('Maria Souza, da Construtora Exemplo, enviou documentos para sua assinatura.', $payload['signers'][0]['custom_message']);
		$this->assertStringEndsWith('Assine até sexta.', $payload['signers'][0]['custom_message']);
		$this->assertArrayNotHasKey('date_limit_to_sign', $payload);
		$this->assertRecordedAsCreated();
		$document = Server::get(DocumentMapper::class)->findByEnvelope($this->envelope->getId())[0];
		$this->assertSame(hash('sha256', $this->contractContent), $document->getSentSha256());
	}

	public function testAdoptsTheDocumentWhenTheCreateResponseIsLost(): void {
		$this->transport->willFail(new TransportFailure('timeout'))
			->willRespond(200, ['count' => 1, 'next' => null, 'previous' => null, 'results' => [$this->createdPayload()]])
			->willRespond(200, $this->createdPayload());

		$this->creation()->createOrAdopt($this->envelope);

		$this->assertCount(3, $this->transport->requests);
		$this->assertStringContainsString('folder_path=%2Fassinaturas%2F' . $this->envelope->getUuid(), $this->transport->requests[1]->url());
		$this->assertStringEndsWith('/docs/' . self::MAIN_TOKEN . '/', $this->transport->requests[2]->url());
		$this->assertRecordedAsCreated();
	}

	public function testFailsWithoutRecreatingWhenTheLostCreateLeftNothingBehind(): void {
		$this->transport->willFail(new TransportFailure('timeout'))->willRespond(200, []);

		try {
			$this->creation()->createOrAdopt($this->envelope);
			$this->fail('Expected an unknown outcome');
		} catch (ZapSignUnreachable) {
		}

		$this->assertCount(2, $this->transport->requests);
		$reloaded = Server::get(EnvelopeMapper::class)->findById($this->envelope->getId());
		$this->assertSame($this->now, $reloaded->getCreateAttemptedAt());
		$this->assertNull($reloaded->getZapsignToken());
	}

	public function testAdoptsInsteadOfCreatingWhenResumingAfterAnAttempt(): void {
		$this->envelope->setCreateAttemptedAt($this->now - 60);
		Server::get(EnvelopeMapper::class)->update($this->envelope);
		$this->transport->willRespond(200, ['count' => 1, 'next' => null, 'previous' => null, 'results' => [$this->createdPayload()]])
			->willRespond(200, $this->createdPayload());

		$this->creation()->createOrAdopt($this->envelope);

		$this->assertSame(['GET', 'GET'], array_map(fn ($request): string => $request->method(), $this->transport->requests));
		$this->assertRecordedAsCreated();
	}

	public function testCreatesWhenResumingAfterAnAttemptThatLeftNothing(): void {
		$this->envelope->setCreateAttemptedAt($this->now - 60);
		Server::get(EnvelopeMapper::class)->update($this->envelope);
		$this->transport->willRespond(200, [])->willRespond(200, $this->createdPayload());

		$this->creation()->createOrAdopt($this->envelope);

		$this->assertSame(['GET', 'POST'], array_map(fn ($request): string => $request->method(), $this->transport->requests));
		$this->assertRecordedAsCreated();
	}

	public function testRefusesAFileEditedAfterPlacement(): void {
		$this->writeFile($this->owner, 'Contrato.pdf', self::minimalPdf('editado depois'));

		try {
			$this->creation()->createOrAdopt($this->envelope);
			$this->fail('Expected the edited file to be refused');
		} catch (SendFailure $failure) {
			$this->assertSame('file_changed', $failure->errorCode);
		}
		$this->assertCount(0, $this->transport->requests);
	}

	public function testMatchesSignersByEmailWhenTheProviderDropsExternalIds(): void {
		$payload = $this->createdPayload();
		foreach ($payload['signers'] as $index => $signer) {
			$payload['signers'][$index]['external_id'] = '';
		}
		$this->transport->willRespond(200, $payload);

		$this->creation()->createOrAdopt($this->envelope);

		$this->assertRecordedAsCreated();
	}

	public function testFailsWhenASignerCannotBeMatched(): void {
		$payload = $this->createdPayload();
		$payload['signers'][1]['external_id'] = '';
		$payload['signers'][1]['email'] = 'someone.else@example.com';
		$this->transport->willRespond(200, $payload);

		try {
			$this->creation()->createOrAdopt($this->envelope);
			$this->fail('Expected a signer mismatch');
		} catch (SendFailure $failure) {
			$this->assertSame('signer_mismatch', $failure->errorCode);
		}
	}

	private function creation(): EnvelopeCreation {
		return new EnvelopeCreation(
			Server::get(EnvelopeMapper::class),
			Server::get(DocumentMapper::class),
			Server::get(SignerMapper::class),
			$this->zapSignClient($this->settings),
			$this->settings,
			Server::get(SentContent::class),
			new SignerMessage(Server::get(IUserManager::class), $this->settings),
			$this->fixedClock(),
		);
	}

	private function assertRecordedAsCreated(): void {
		$envelope = Server::get(EnvelopeMapper::class)->findById($this->envelope->getId());
		$this->assertSame(self::MAIN_TOKEN, $envelope->getZapsignToken());
		$this->assertSame(SendStep::Created->value, $envelope->getSendStep());
		$this->assertSame($this->settings->accountFingerprint(), $envelope->getAccountFingerprint());
		$this->assertTrue($envelope->getSandbox());
		$this->assertSame(self::MAIN_TOKEN, Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId())[0]->getZapsignToken());
		$tokens = array_map(fn (Signer $signer): ?string => $signer->getZapsignToken(), Server::get(SignerMapper::class)->findByEnvelope($envelope->getId()));
		$this->assertSame(['signer-token-' . $this->signers[0]->getId(), 'signer-token-' . $this->signers[1]->getId()], $tokens);
	}

	/** @return array<string, mixed> */
	private function createdPayload(): array {
		return [
			'token' => self::MAIN_TOKEN,
			'status' => 'pending',
			'external_id' => $this->envelope->getUuid(),
			'folder_path' => '/assinaturas/' . $this->envelope->getUuid() . '/',
			'extra_docs' => [],
			'signers' => array_map(fn (Signer $signer): array => [
				'token' => 'signer-token-' . $signer->getId(),
				'name' => $signer->getName(),
				'email' => $signer->getEmail(),
				'status' => 'new',
				'status_code' => 'not-opened',
				'external_id' => (string)$signer->getId(),
			], $this->signers),
		];
	}
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter 'PdfInspectionTest|EnvelopeCreationTest'`
Expected: ERROR `Class "OCA\Assinaturas\Send\PdfInspection" not found`.

- [ ] **Step 4: Implement**

`lib/Send/SendFailure.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Send;

/** A Send step failed for a reason we name ourselves. The code is stored on the envelope; nothing from ZapSign is. */
final class SendFailure extends \RuntimeException {
	public function __construct(
		public readonly string $errorCode,
	) {
		parent::__construct('Send failed: ' . $errorCode);
	}
}
```

`lib/Send/PdfInspection.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Send;

use OCA\Assinaturas\Draft\EnvelopeLimits;

/**
 * Cheap byte-level checks before a PDF leaves Nextcloud: ZapSign rejects encrypted files,
 * and its seal would invalidate an existing signature.
 */
final class PdfInspection {
	private const PDF_MAGIC = '%PDF-';
	private const ENCRYPTION_MARKER = '/Encrypt';
	private const SIGNATURE_MARKERS = ['/ByteRange', '/Type/Sig', '/Type /Sig'];

	/** @throws SendFailure */
	public function assertSendable(#[\SensitiveParameter] string $content): void {
		if (!str_starts_with($content, self::PDF_MAGIC)) {
			throw new SendFailure('file_not_pdf');
		}
		if (strlen($content) > EnvelopeLimits::MAX_FILE_BYTES) {
			throw new SendFailure('file_too_large');
		}
		if (str_contains($content, self::ENCRYPTION_MARKER)) {
			throw new SendFailure('file_encrypted');
		}
		foreach (self::SIGNATURE_MARKERS as $marker) {
			if (str_contains($content, $marker)) {
				throw new SendFailure('file_already_signed');
			}
		}
	}
}
```

`lib/Send/SentContent.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Send;

use OCA\Assinaturas\Db\Document;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCP\Files\File;
use OCP\Files\IRootFolder;

/**
 * The bytes that go to ZapSign. The first read checks the file is the version the boxes were
 * placed on and pins its hash; every later read (a resumed Send) must match that hash.
 */
final class SentContent {
	public function __construct(
		private IRootFolder $rootFolder,
		private DocumentMapper $documentMapper,
		private PdfInspection $inspection,
	) {
	}

	/** @throws SendFailure */
	public function verifiedContent(Envelope $envelope, Document $document): string {
		$node = $this->rootFolder->getUserFolder($envelope->getOwnerUid())->getFirstNodeById($document->getSourceFileId());
		if (!$node instanceof File) {
			throw new SendFailure('file_missing');
		}
		$content = $node->getContent();
		$hash = hash('sha256', $content);
		$pinnedHash = $document->getSentSha256();
		if ($pinnedHash !== null) {
			if (!hash_equals($pinnedHash, $hash)) {
				throw new SendFailure('file_changed');
			}
			return $content;
		}
		if ($node->getEtag() !== $document->getSourceEtag()) {
			throw new SendFailure('file_changed');
		}
		$this->inspection->assertSendable($content);
		$document->setSentSha256($hash);
		$this->documentMapper->update($document);
		return $content;
	}
}
```

`lib/Send/SignerMessage.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Send;

use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\ZapSign\ZapSignSettings;
use OCP\IUserManager;

/** Tells signers who is asking, since every email is branded "Avuz Conecta via ZapSign". */
final class SignerMessage {
	public function __construct(
		private IUserManager $userManager,
		private ZapSignSettings $settings,
	) {
	}

	public function compose(Envelope $envelope): string {
		$senderName = $this->userManager->getDisplayName($envelope->getOwnerUid()) ?? $envelope->getOwnerUid();
		$companyName = trim($this->settings->companyName());
		$introduction = $companyName === ''
			? $senderName . ' enviou documentos para sua assinatura.'
			: $senderName . ', da ' . $companyName . ', enviou documentos para sua assinatura.';
		$note = trim((string)$envelope->getMessage());
		if ($note === '') {
			return $introduction;
		}
		return $introduction . "\n\n" . $note;
	}
}
```

`lib/Send/EnvelopeCreation.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Send;

use OCA\Assinaturas\Db\Document;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\SendStep;
use OCA\Assinaturas\Db\Signer;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use OCA\Assinaturas\ZapSign\Exception\ZapSignUnreachable;
use OCA\Assinaturas\ZapSign\Model\ZapSignDocument;
use OCA\Assinaturas\ZapSign\Model\ZapSignSigner;
use OCA\Assinaturas\ZapSign\Payload\Branding;
use OCA\Assinaturas\ZapSign\Payload\NewDocument;
use OCA\Assinaturas\ZapSign\Payload\NewSigner;
use OCA\Assinaturas\ZapSign\ZapSignClient;
use OCA\Assinaturas\ZapSign\ZapSignEnvironment;
use OCA\Assinaturas\ZapSign\ZapSignSettings;
use OCP\AppFramework\Utility\ITimeFactory;

/**
 * Step 1 of Send. Creating bills the tenant and is never retried: if the response is lost,
 * the document is looked up by its unique folder and adopted instead of being created twice.
 */
final class EnvelopeCreation {
	public const FOLDER_ROOT = '/assinaturas/';
	private const BRAND_NAME = 'Avuz Conecta';
	private const BRAND_COLOR = '#2bb5e3';

	public function __construct(
		private EnvelopeMapper $envelopeMapper,
		private DocumentMapper $documentMapper,
		private SignerMapper $signerMapper,
		private ZapSignClient $client,
		private ZapSignSettings $settings,
		private SentContent $sentContent,
		private SignerMessage $signerMessage,
		private ITimeFactory $timeFactory,
	) {
	}

	/** @throws SendFailure|ZapSignException */
	public function createOrAdopt(Envelope $envelope): void {
		$documents = $this->documentMapper->findByEnvelope($envelope->getId());
		$signers = $this->signerMapper->findByEnvelope($envelope->getId());
		$mainDocument = $documents[0];
		if ($envelope->getCreateAttemptedAt() !== null && $this->adopt($envelope, $mainDocument, $signers)) {
			return;
		}
		$mainContent = $this->sentContent->verifiedContent($envelope, $mainDocument);
		foreach (array_slice($documents, 1) as $extraDocument) {
			$this->sentContent->verifiedContent($envelope, $extraDocument);
		}
		$envelope->setCreateAttemptedAt($this->timeFactory->getTime());
		$this->envelopeMapper->update($envelope);
		try {
			$created = $this->client->createDocument($this->newDocument($envelope, $mainContent, $signers));
		} catch (ZapSignUnreachable $unknownOutcome) {
			if ($this->adopt($envelope, $mainDocument, $signers)) {
				return;
			}
			throw $unknownOutcome;
		}
		$this->record($envelope, $mainDocument, $created, $signers);
	}

	/** @param list<Signer> $signers */
	private function adopt(Envelope $envelope, Document $mainDocument, array $signers): bool {
		foreach ($this->client->findDocumentsByFolder(self::FOLDER_ROOT . $envelope->getUuid()) as $candidate) {
			if ($candidate->externalId !== $envelope->getUuid()) {
				continue;
			}
			$this->record($envelope, $mainDocument, $this->client->getDocument($candidate->token), $signers);
			return true;
		}
		return false;
	}

	/** @param list<Signer> $signers */
	private function record(Envelope $envelope, Document $mainDocument, ZapSignDocument $created, array $signers): void {
		$providerSignersByExternalId = [];
		foreach ($created->signers as $providerSigner) {
			$providerSignersByExternalId[$providerSigner->externalId] = $providerSigner;
		}
		foreach ($signers as $signer) {
			$providerSigner = $providerSignersByExternalId[(string)$signer->getId()]
				?? self::matchByEmail($created->signers, $signer)
				?? throw new SendFailure('signer_mismatch');
			$signer->setZapsignToken($providerSigner->token);
			$this->signerMapper->update($signer);
		}
		$mainDocument->setZapsignToken($created->token);
		$this->documentMapper->update($mainDocument);
		$envelope->setZapsignToken($created->token);
		$envelope->setAccountFingerprint($this->settings->accountFingerprint());
		$envelope->setSandbox($this->settings->environment() === ZapSignEnvironment::Sandbox);
		$envelope->setSendStep(SendStep::Created->value);
		$this->envelopeMapper->update($envelope);
	}

	/** @param list<Signer> $signers */
	private function newDocument(Envelope $envelope, #[\SensitiveParameter] string $mainContent, array $signers): NewDocument {
		$message = $this->signerMessage->compose($envelope);
		$deadline = $envelope->getDeadlineAt() === null ? null : new \DateTimeImmutable('@' . $envelope->getDeadlineAt());
		return new NewDocument(
			$envelope->getTitle(),
			base64_encode($mainContent),
			$envelope->getUuid(),
			self::FOLDER_ROOT . $envelope->getUuid(),
			array_map(fn (Signer $signer): NewSigner => new NewSigner(
				$signer->getName(),
				$signer->getEmail(),
				$envelope->getSigningOrder() ? $signer->getOrderGroup() : 1,
				(string)$signer->getId(),
				$message,
			), $signers),
			$envelope->getSigningOrder(),
			$deadline,
			new Branding(self::BRAND_NAME, $this->settings->brandLogoUrl(), self::BRAND_COLOR),
		);
	}

	/** @param list<ZapSignSigner> $providerSigners */
	private static function matchByEmail(array $providerSigners, Signer $signer): ?ZapSignSigner {
		foreach ($providerSigners as $providerSigner) {
			if (strtolower($providerSigner->email) === $signer->getEmail()) {
				return $providerSigner;
			}
		}
		return null;
	}
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'PdfInspectionTest|EnvelopeCreationTest'`, then `tests/env/phpunit.sh`.
Expected: `OK` for 5 `PdfInspectionTest` cases (1 test plus 4 data rows) and 8 `EnvelopeCreationTest` tests; the full suite is green.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: create envelopes at ZapSign with content checks and lost-response adoption"
```

---

### Task 9: Send II (extras, placement, release, the Send job and the send route)

**Files:**
- Create: `lib/Send/SendConflict.php`, `lib/Send/EnvelopeSender.php`, `lib/Send/SendJob.php`
- Modify: `lib/Controller/EnvelopeController.php` (add the `send` route)
- Modify: `docs/api.md` (the send row already exists; no change needed unless the wording differs)
- Test: `tests/Integration/Send/EnvelopeSenderTest.php`, and new tests in `tests/Integration/Controller/EnvelopeControllerTest.php`

**Interfaces:**
- Consumes:
  - `EnvelopeCreation`, `SentContent`, `SignerMessage`, `SendFailure` (Task 8);
  - `ZapSignClient::getDocument`, `uploadExtraDocument`, `placeSignatures`, `releaseSigner` (Plan 1);
  - `PlacementConverter`, `FieldPlacement` (Plan 1);
  - `SendStep` (Task 2).
- Produces:
  - `SendConflict extends \RuntimeException`.
  - `EnvelopeSender::claim(Envelope $envelope): void`:
    - throws `DraftRejected('no_signers')` when the envelope has no signers;
    - throws `SendConflict` unless it atomically moves the envelope from `draft|failed` to `sending` (lease 600 s);
    - queues `SendJob` with `['envelopeId' => id]`.
  - `EnvelopeSender::send(int $envelopeId): void` never throws. It runs the remaining steps from `send_step`. On success the envelope becomes `pending` with `sent_at`, `next_sync_at = now + 300` and `error = null`. On failure it becomes `failed`, keeps `send_step`, and stores an error code.
  - `SendJob extends QueuedJob` with the argument `{envelopeId: int}`.
  - `EnvelopeController::send(string $uuid): JSONResponse` at `POST /api/v1/envelopes/{uuid}/send` returns 202 `{"status": "sending"}`, or 409 `already_sending`, 422 `no_signers`, 403, 404.

- [ ] **Step 1: Write the failing tests**

`tests/Integration/Send/EnvelopeSenderTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Send;

use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\FieldMapper;
use OCA\Assinaturas\Db\SendStep;
use OCA\Assinaturas\Db\Signer;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Draft\DraftRejected;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Send\EnvelopeCreation;
use OCA\Assinaturas\Send\EnvelopeSender;
use OCA\Assinaturas\Send\SendConflict;
use OCA\Assinaturas\Send\SendJob;
use OCA\Assinaturas\Send\SentContent;
use OCA\Assinaturas\Send\SignerMessage;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCA\Assinaturas\ZapSign\PlacementConverter;
use OCA\Assinaturas\ZapSign\ZapSignSettings;
use OCP\BackgroundJob\IJobList;
use OCP\IUserManager;
use OCP\Server;
use Psr\Log\NullLogger;
use Test\TestCase;

/**
 * @group DB
 */
final class EnvelopeSenderTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ZapSignDoubles;

	private const MAIN_TOKEN = 'doc-main-token';
	private const EXTRA_TOKEN = 'doc-extra-token';
	private const PORTRAIT_PAGE = ['width' => 595.28, 'height' => 841.89, 'rotation' => 0];

	private string $owner;
	private ZapSignSettings $settings;
	private IJobList $jobList;
	/** @var list<array{string, mixed}> */
	private array $queuedJobs = [];

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->settings = $this->zapSignSettings();
		$this->owner = $this->createUser('Maria Souza');
		$this->jobList = $this->createMock(IJobList::class);
		$this->jobList->method('add')->willReturnCallback(function (string $job, mixed $argument): void {
			$this->queuedJobs[] = [$job, $argument];
		});
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testSendsAnOrderedEnvelopeThroughEveryStepAndReleasesOnlyTheFirstGroup(): void {
		[$envelope, $signers] = $this->draft(true, true);
		$this->sender()->claim($envelope);
		$this->transport->willRespond(200, $this->createdPayload($envelope, $signers))
			->willRespond(200, $this->createdPayload($envelope, $signers))
			->willRespond(200, ['token' => self::EXTRA_TOKEN, 'name' => 'Anexo.pdf'])
			->willRespond(200, '{}')
			->willRespond(200, '{}')
			->willRespond(200, '{}');

		$this->sender()->send($envelope->getId());

		$this->assertSame([
			'POST /docs/',
			'GET /docs/' . self::MAIN_TOKEN . '/',
			'POST /docs/' . self::MAIN_TOKEN . '/upload-extra-doc/',
			'POST /docs/' . self::MAIN_TOKEN . '/place-signatures/',
			'POST /docs/' . self::EXTRA_TOKEN . '/place-signatures/',
			'POST /signers/signer-token-' . $signers[0]->getId() . '/',
		], $this->requestLines());
		$this->assertStringStartsWith('Maria Souza, da Construtora Exemplo', $this->transport->lastRequestJson()['custom_message']);
		$sent = Server::get(EnvelopeMapper::class)->findById($envelope->getId());
		$this->assertSame(EnvelopeStatus::Pending, $sent->statusValue());
		$this->assertSame(SendStep::Released->value, $sent->getSendStep());
		$this->assertSame($this->now, $sent->getSentAt());
		$this->assertSame($this->now + 300, $sent->getNextSyncAt());
		$this->assertNull($sent->getLeaseUntil());
		$this->assertSame(self::EXTRA_TOKEN, Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId())[1]->getZapsignToken());
		$releases = array_map(fn (Signer $signer): ?int => $signer->getReleasedAt(), Server::get(SignerMapper::class)->findByEnvelope($envelope->getId()));
		$this->assertSame([$this->now, null], $releases);
		$this->assertSame([[SendJob::class, ['envelopeId' => $envelope->getId()]]], $this->queuedJobs);
	}

	public function testReleasesEverySignerAndSkipsPlacementWhenThereAreNoBoxes(): void {
		[$envelope, $signers] = $this->draft(false, false, 1);
		$this->sender()->claim($envelope);
		$this->transport->willRespond(200, $this->createdPayload($envelope, $signers))
			->willRespond(200, '{}')
			->willRespond(200, '{}');

		$this->sender()->send($envelope->getId());

		$this->assertSame([
			'POST /docs/',
			'POST /signers/signer-token-' . $signers[0]->getId() . '/',
			'POST /signers/signer-token-' . $signers[1]->getId() . '/',
		], $this->requestLines());
		$this->assertSame(EnvelopeStatus::Pending, Server::get(EnvelopeMapper::class)->findById($envelope->getId())->statusValue());
	}

	public function testAdoptsAnExtraDocumentWhoseUploadResponseWasLost(): void {
		[$envelope, $signers] = $this->draft(false, false);
		$this->pretendCreated($envelope, $signers);
		$this->sender()->claim($envelope);
		$payload = $this->createdPayload($envelope, $signers);
		$payload['extra_docs'] = [['token' => 'extra-lost', 'name' => 'Anexo.pdf']];
		$this->transport->willRespond(200, $payload)->willRespond(200, '{}')->willRespond(200, '{}');

		$this->sender()->send($envelope->getId());

		$this->assertNotContains('POST /docs/' . self::MAIN_TOKEN . '/upload-extra-doc/', $this->requestLines());
		$this->assertSame('extra-lost', Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId())[1]->getZapsignToken());
		$this->assertSame(EnvelopeStatus::Pending, Server::get(EnvelopeMapper::class)->findById($envelope->getId())->statusValue());
	}

	public function testFailsWhenZapSignHoldsSeveralUnknownExtraDocuments(): void {
		[$envelope, $signers] = $this->draft(false, false);
		$this->pretendCreated($envelope, $signers);
		$this->sender()->claim($envelope);
		$payload = $this->createdPayload($envelope, $signers);
		$payload['extra_docs'] = [['token' => 'unknown-a', 'name' => 'A.pdf'], ['token' => 'unknown-b', 'name' => 'B.pdf']];
		$this->transport->willRespond(200, $payload);

		$this->sender()->send($envelope->getId());

		$failed = Server::get(EnvelopeMapper::class)->findById($envelope->getId());
		$this->assertSame(EnvelopeStatus::Failed, $failed->statusValue());
		$this->assertSame('extra_documents_ambiguous', $failed->getError());
	}

	public function testMarksTheEnvelopeFailedWithOurCodeAndKeepsTheCompletedStep(): void {
		[$envelope, $signers] = $this->draft(true, true);
		$this->sender()->claim($envelope);
		$this->transport->willRespond(200, $this->createdPayload($envelope, $signers))
			->willRespond(200, $this->createdPayload($envelope, $signers))
			->willRespond(200, ['token' => self::EXTRA_TOKEN, 'name' => 'Anexo.pdf'])
			->willRespond(400, '{"error":"invalid_rubricas","detail":"Signatário ana@example.com inválido"}');

		$this->sender()->send($envelope->getId());

		$failed = Server::get(EnvelopeMapper::class)->findById($envelope->getId());
		$this->assertSame(EnvelopeStatus::Failed, $failed->statusValue());
		$this->assertSame('provider_rejected', $failed->getError());
		$this->assertSame(SendStep::ExtrasUploaded->value, $failed->getSendStep());
		$this->assertNull($failed->getLeaseUntil());
	}

	public function testResumesAFailedSendWithoutCreatingAgain(): void {
		[$envelope, $signers] = $this->draft(true, true);
		$this->sender()->claim($envelope);
		$this->transport->willRespond(200, $this->createdPayload($envelope, $signers))
			->willRespond(200, $this->createdPayload($envelope, $signers))
			->willRespond(200, ['token' => self::EXTRA_TOKEN, 'name' => 'Anexo.pdf'])
			->willRespond(503, 'x')->willRespond(503, 'x')->willRespond(503, 'x');
		$this->sender()->send($envelope->getId());
		$this->transport->requests = [];

		$this->sender()->claim(Server::get(EnvelopeMapper::class)->findById($envelope->getId()));
		$this->transport->willRespond(200, '{}')->willRespond(200, '{}')->willRespond(200, '{}');
		$this->sender()->send($envelope->getId());

		$this->assertNotContains('POST /docs/', $this->requestLines());
		$this->assertSame(EnvelopeStatus::Pending, Server::get(EnvelopeMapper::class)->findById($envelope->getId())->statusValue());
	}

	public function testFailsWhenAnExtraFileChangesMidSend(): void {
		[$envelope, $signers] = $this->draft(false, false);
		$this->sender()->claim($envelope);
		$this->transport->willRespond(200, $this->createdPayload($envelope, $signers))
			->willRespond(200, $this->createdPayload($envelope, $signers));
		$creation = $this->creation();
		$creation->createOrAdopt(Server::get(EnvelopeMapper::class)->findById($envelope->getId()));
		$this->writeFile($this->owner, 'Anexo.pdf', self::minimalPdf('anexo editado'));

		$this->sender()->send($envelope->getId());

		$failed = Server::get(EnvelopeMapper::class)->findById($envelope->getId());
		$this->assertSame(EnvelopeStatus::Failed, $failed->statusValue());
		$this->assertSame('file_changed', $failed->getError());
	}

	public function testRejectsASecondClaimWhileSending(): void {
		[$envelope] = $this->draft(false, false);
		$this->sender()->claim($envelope);

		$this->expectException(SendConflict::class);
		$this->sender()->claim($envelope);
	}

	public function testRefusesToSendWithoutSigners(): void {
		$file = $this->writeFile($this->owner, 'Contrato.pdf', self::minimalPdf());
		$envelope = Server::get(EnvelopeDrafts::class)->create($this->owner, 'Contrato', [$file->getId()]);

		try {
			$this->sender()->claim($envelope);
			$this->fail('Expected a draft rejection');
		} catch (DraftRejected $rejection) {
			$this->assertSame('no_signers', $rejection->errorCode);
		}
	}

	public function testDoesNothingForAnEnvelopeThatIsNotSending(): void {
		[$envelope] = $this->draft(false, false);

		$this->sender()->send($envelope->getId());

		$this->assertCount(0, $this->transport->requests);
		$this->assertSame(EnvelopeStatus::Draft, Server::get(EnvelopeMapper::class)->findById($envelope->getId())->statusValue());
	}

	/** @return array{Envelope, list<Signer>} */
	private function draft(bool $signingOrder, bool $withBoxes, int $fileCount = 2): array {
		$drafts = Server::get(EnvelopeDrafts::class);
		$fileIds = [$this->writeFile($this->owner, 'Contrato.pdf', self::minimalPdf('contrato'))->getId()];
		if ($fileCount === 2) {
			$fileIds[] = $this->writeFile($this->owner, 'Anexo.pdf', self::minimalPdf('anexo'))->getId();
		}
		$envelope = $drafts->create($this->owner, 'Contrato de serviços', $fileIds);
		$envelope = $drafts->updateSettings($envelope, 'Contrato de serviços', $signingOrder, null, null, '');
		$signers = $drafts->replaceSigners($envelope, [
			['name' => 'Ana Lima', 'email' => 'ana@example.com', 'orderGroup' => 1],
			['name' => 'Bruno Souza', 'email' => 'bruno@example.com', 'orderGroup' => 2],
		]);
		if ($withBoxes) {
			$documents = Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId());
			$drafts->replaceFields($envelope, $documents[0]->getId(), [self::PORTRAIT_PAGE], [
				['signerId' => $signers[0]->getId(), 'type' => 'signature', 'page' => 0, 'x' => 0.1, 'y' => 0.75, 'width' => 0.2, 'height' => 0.09],
				['signerId' => $signers[1]->getId(), 'type' => 'signature', 'page' => 0, 'x' => 0.6, 'y' => 0.75, 'width' => 0.2, 'height' => 0.09],
			]);
			$drafts->replaceFields($envelope, $documents[1]->getId(), [self::PORTRAIT_PAGE], [
				['signerId' => $signers[0]->getId(), 'type' => 'initials', 'page' => 0, 'x' => 0.8, 'y' => 0.85, 'width' => 0.14, 'height' => 0.09],
			]);
		}
		return [Server::get(EnvelopeMapper::class)->findById($envelope->getId()), $signers];
	}

	/** @param list<Signer> $signers */
	private function pretendCreated(Envelope $envelope, array $signers): void {
		$documentMapper = Server::get(DocumentMapper::class);
		$documents = $documentMapper->findByEnvelope($envelope->getId());
		foreach ($documents as $document) {
			$content = Server::get(SentContent::class)->verifiedContent($envelope, $document);
			$this->assertNotSame('', $content);
		}
		$main = $documentMapper->findByEnvelope($envelope->getId())[0];
		$main->setZapsignToken(self::MAIN_TOKEN);
		$documentMapper->update($main);
		foreach ($signers as $signer) {
			$signer->setZapsignToken('signer-token-' . $signer->getId());
			Server::get(SignerMapper::class)->update($signer);
		}
		$envelope->setZapsignToken(self::MAIN_TOKEN);
		$envelope->setSendStep(SendStep::Created->value);
		Server::get(EnvelopeMapper::class)->update($envelope);
	}

	private function sender(): EnvelopeSender {
		return new EnvelopeSender(
			Server::get(EnvelopeMapper::class),
			Server::get(DocumentMapper::class),
			Server::get(SignerMapper::class),
			Server::get(FieldMapper::class),
			$this->creation(),
			Server::get(SentContent::class),
			new SignerMessage(Server::get(IUserManager::class), $this->settings),
			$this->zapSignClient($this->settings),
			new PlacementConverter(),
			$this->jobList,
			$this->fixedClock(),
			new NullLogger(),
		);
	}

	private function creation(): EnvelopeCreation {
		return new EnvelopeCreation(
			Server::get(EnvelopeMapper::class),
			Server::get(DocumentMapper::class),
			Server::get(SignerMapper::class),
			$this->zapSignClient($this->settings),
			$this->settings,
			Server::get(SentContent::class),
			new SignerMessage(Server::get(IUserManager::class), $this->settings),
			$this->fixedClock(),
		);
	}

	/** @return list<string> "METHOD /path/" with the API base removed */
	private function requestLines(): array {
		return array_map(
			fn ($request): string => $request->method() . ' ' . explode('?', substr($request->url(), strlen('https://sandbox.api.zapsign.com.br/api/v1')))[0],
			$this->transport->requests,
		);
	}

	/**
	 * @param list<Signer> $signers
	 * @return array<string, mixed>
	 */
	private function createdPayload(Envelope $envelope, array $signers): array {
		return [
			'token' => self::MAIN_TOKEN,
			'status' => 'pending',
			'external_id' => $envelope->getUuid(),
			'extra_docs' => [],
			'signers' => array_map(fn (Signer $signer): array => [
				'token' => 'signer-token-' . $signer->getId(),
				'name' => $signer->getName(),
				'email' => $signer->getEmail(),
				'status' => 'new',
				'status_code' => 'not-opened',
				'external_id' => (string)$signer->getId(),
			], $signers),
		];
	}
}
```

Add these tests to `tests/Integration/Controller/EnvelopeControllerTest.php`, inside the class. Add the imports `use OCA\Assinaturas\Send\SendJob;` and `use OCP\BackgroundJob\IJobList;`.
```php
	public function testQueuesTheSendOfADraft(): void {
		$uuid = $this->controller()->create('Contrato', [$this->writeFile($this->member, 'Contrato.pdf', self::minimalPdf())->getId()])->getData()['uuid'];
		$this->controller()->replaceSigners($uuid, [['name' => 'Ana Lima', 'email' => 'ana@example.com']]);
		$envelopeId = Server::get(EnvelopeMapper::class)->findByUuid($uuid)->getId();

		$response = $this->controller()->send($uuid);

		$jobList = Server::get(IJobList::class);
		$this->assertSame(Http::STATUS_ACCEPTED, $response->getStatus());
		$this->assertSame('sending', $this->controller()->show($uuid)->getData()['status']);
		$this->assertTrue($jobList->has(SendJob::class, ['envelopeId' => $envelopeId]));
		$jobList->remove(SendJob::class, ['envelopeId' => $envelopeId]);
	}

	public function testReportsAConflictWhenSentTwice(): void {
		$uuid = $this->controller()->create('Contrato', [$this->writeFile($this->member, 'Contrato.pdf', self::minimalPdf())->getId()])->getData()['uuid'];
		$this->controller()->replaceSigners($uuid, [['name' => 'Ana Lima', 'email' => 'ana@example.com']]);
		$this->controller()->send($uuid);

		$response = $this->controller()->send($uuid);

		$this->assertSame(Http::STATUS_CONFLICT, $response->getStatus());
		$this->assertSame('already_sending', $response->getData()['error']);
		Server::get(IJobList::class)->remove(SendJob::class, ['envelopeId' => Server::get(EnvelopeMapper::class)->findByUuid($uuid)->getId()]);
	}

	public function testRejectsSendingWithoutSigners(): void {
		$uuid = $this->controller()->create('Contrato', [$this->writeFile($this->member, 'Contrato.pdf', self::minimalPdf())->getId()])->getData()['uuid'];

		$response = $this->controller()->send($uuid);

		$this->assertSame(Http::STATUS_UNPROCESSABLE_ENTITY, $response->getStatus());
		$this->assertSame('no_signers', $response->getData()['error']);
	}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter 'EnvelopeSenderTest|EnvelopeControllerTest'`
Expected: ERROR `Class "OCA\Assinaturas\Send\EnvelopeSender" not found`, and `Call to undefined method ... send()`.

- [ ] **Step 3: Implement**

`lib/Send/SendConflict.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Send;

/** The envelope is not a draft or a failed send, so another Send is already running or already done. */
final class SendConflict extends \RuntimeException {
}
```

`lib/Send/EnvelopeSender.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Send;

use OCA\Assinaturas\Db\Document;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\Field;
use OCA\Assinaturas\Db\FieldMapper;
use OCA\Assinaturas\Db\SendStep;
use OCA\Assinaturas\Db\Signer;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Draft\DraftRejected;
use OCA\Assinaturas\ZapSign\Exception\ZapSignAccessDenied;
use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use OCA\Assinaturas\ZapSign\Exception\ZapSignNotFound;
use OCA\Assinaturas\ZapSign\Exception\ZapSignPlanRequired;
use OCA\Assinaturas\ZapSign\Exception\ZapSignRateLimited;
use OCA\Assinaturas\ZapSign\Exception\ZapSignRejectedRequest;
use OCA\Assinaturas\ZapSign\Exception\ZapSignServerError;
use OCA\Assinaturas\ZapSign\Exception\ZapSignUnreachable;
use OCA\Assinaturas\ZapSign\Payload\FieldPlacement;
use OCA\Assinaturas\ZapSign\PlacementConverter;
use OCA\Assinaturas\ZapSign\ZapSignClient;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
use Psr\Log\LoggerInterface;

/**
 * Runs Send as resumable steps: create (or adopt), upload extras (or adopt a lost upload),
 * place boxes (replace-all, safe to repeat), release the first signing group. Each step is
 * persisted before the next, so "Tentar novamente" continues where Send stopped.
 */
final class EnvelopeSender {
	private const LEASE_SECONDS = 600;
	private const FIRST_SYNC_DELAY_SECONDS = 300;
	private const PROVIDER_FAILURE_CODES = [
		ZapSignUnreachable::class => 'provider_unreachable',
		ZapSignRateLimited::class => 'provider_busy',
		ZapSignPlanRequired::class => 'provider_plan_required',
		ZapSignAccessDenied::class => 'provider_access_denied',
		ZapSignNotFound::class => 'provider_not_found',
		ZapSignRejectedRequest::class => 'provider_rejected',
		ZapSignServerError::class => 'provider_error',
	];

	public function __construct(
		private EnvelopeMapper $envelopeMapper,
		private DocumentMapper $documentMapper,
		private SignerMapper $signerMapper,
		private FieldMapper $fieldMapper,
		private EnvelopeCreation $creation,
		private SentContent $sentContent,
		private SignerMessage $signerMessage,
		private ZapSignClient $client,
		private PlacementConverter $placementConverter,
		private IJobList $jobList,
		private ITimeFactory $timeFactory,
		private LoggerInterface $logger,
	) {
	}

	/** @throws DraftRejected|SendConflict */
	public function claim(Envelope $envelope): void {
		if ($this->signerMapper->findByEnvelope($envelope->getId()) === []) {
			throw new DraftRejected('no_signers', 'Add at least one signer before sending');
		}
		$now = $this->timeFactory->getTime();
		$claimed = $this->envelopeMapper->transitionStatus(
			$envelope->getId(),
			[EnvelopeStatus::Draft, EnvelopeStatus::Failed],
			EnvelopeStatus::Sending,
			$now + self::LEASE_SECONDS,
			$now,
		);
		if (!$claimed) {
			throw new SendConflict('Envelope ' . $envelope->getUuid() . ' is not a draft or a failed send');
		}
		$this->jobList->add(SendJob::class, ['envelopeId' => $envelope->getId()]);
	}

	public function send(int $envelopeId): void {
		try {
			$envelope = $this->envelopeMapper->findById($envelopeId);
		} catch (DoesNotExistException) {
			return;
		}
		if ($envelope->statusValue() !== EnvelopeStatus::Sending) {
			return;
		}
		try {
			$this->runRemainingSteps($envelope);
		} catch (SendFailure $failure) {
			$this->markFailed($envelope, $failure->errorCode);
		} catch (ZapSignException $failure) {
			$this->markFailed($envelope, self::PROVIDER_FAILURE_CODES[$failure::class] ?? 'provider_error');
		}
	}

	private function runRemainingSteps(Envelope $envelope): void {
		if ($envelope->getSendStep() < SendStep::Created->value) {
			$this->creation->createOrAdopt($envelope);
			$envelope = $this->envelopeMapper->findById($envelope->getId());
		}
		$documents = $this->documentMapper->findByEnvelope($envelope->getId());
		$signers = $this->signerMapper->findByEnvelope($envelope->getId());
		if ($envelope->getSendStep() < SendStep::ExtrasUploaded->value) {
			$this->uploadExtras($envelope, $documents);
			$this->advance($envelope, SendStep::ExtrasUploaded);
			$documents = $this->documentMapper->findByEnvelope($envelope->getId());
		}
		if ($envelope->getSendStep() < SendStep::Placed->value) {
			$this->placeBoxes($documents, $signers);
			$this->advance($envelope, SendStep::Placed);
		}
		if ($envelope->getSendStep() < SendStep::Released->value) {
			$this->releaseFirstGroup($envelope, $signers);
			$this->advance($envelope, SendStep::Released);
		}
		$this->finish($envelope);
	}

	/** @param list<Document> $documents */
	private function uploadExtras(Envelope $envelope, array $documents): void {
		$extras = array_values(array_filter($documents, fn (Document $document): bool => $document->getPosition() > 0));
		$pending = array_values(array_filter($extras, fn (Document $document): bool => $document->getZapsignToken() === null));
		if ($pending === []) {
			return;
		}
		$recordedTokens = array_values(array_filter(array_map(fn (Document $document): ?string => $document->getZapsignToken(), $extras)));
		$tokensAtZapSign = array_map(fn ($extra): string => $extra->token, $this->client->getDocument((string)$envelope->getZapsignToken())->extraDocuments);
		$unclaimedTokens = array_values(array_diff($tokensAtZapSign, $recordedTokens));
		if (count($unclaimedTokens) > 1) {
			throw new SendFailure('extra_documents_ambiguous');
		}
		foreach ($pending as $document) {
			$adoptedToken = array_shift($unclaimedTokens);
			$token = $adoptedToken ?? $this->client->uploadExtraDocument(
				(string)$envelope->getZapsignToken(),
				basename($document->getSourcePath()),
				base64_encode($this->sentContent->verifiedContent($envelope, $document)),
			)->token;
			$document->setZapsignToken($token);
			$this->documentMapper->update($document);
		}
	}

	/**
	 * @param list<Document> $documents
	 * @param list<Signer> $signers
	 */
	private function placeBoxes(array $documents, array $signers): void {
		$signerTokens = [];
		foreach ($signers as $signer) {
			$signerTokens[$signer->getId()] = (string)$signer->getZapsignToken();
		}
		foreach ($documents as $document) {
			$fields = $this->fieldMapper->findByDocument($document->getId());
			if ($fields === []) {
				continue;
			}
			$boxes = array_map(fn (Field $field) => $this->placementConverter->toSignatureBox(
				new FieldPlacement($field->getType(), $field->getPage(), $field->getX(), $field->getY(), $field->getWidth(), $field->getHeight()),
				$signerTokens[$field->getSignerId()] ?? throw new SendFailure('signer_mismatch'),
			), $fields);
			$this->client->placeSignatures((string)$document->getZapsignToken(), $boxes);
		}
	}

	/** @param list<Signer> $signers */
	private function releaseFirstGroup(Envelope $envelope, array $signers): void {
		$firstGroup = min(array_map(fn (Signer $signer): int => $signer->getOrderGroup(), $signers));
		$message = $this->signerMessage->compose($envelope);
		foreach ($signers as $signer) {
			$isLaterGroup = $envelope->getSigningOrder() && $signer->getOrderGroup() !== $firstGroup;
			if ($isLaterGroup || $signer->getReleasedAt() !== null) {
				continue;
			}
			$this->client->releaseSigner((string)$signer->getZapsignToken(), $message);
			$signer->setReleasedAt($this->timeFactory->getTime());
			$this->signerMapper->update($signer);
		}
	}

	private function advance(Envelope $envelope, SendStep $step): void {
		$envelope->setSendStep($step->value);
		$this->envelopeMapper->update($envelope);
	}

	private function finish(Envelope $envelope): void {
		$now = $this->timeFactory->getTime();
		if (!$this->envelopeMapper->transitionStatus($envelope->getId(), [EnvelopeStatus::Sending], EnvelopeStatus::Pending, null, $now)) {
			return;
		}
		$sent = $this->envelopeMapper->findById($envelope->getId());
		$sent->setSentAt($sent->getSentAt() ?? $now);
		$sent->setNextSyncAt($now + self::FIRST_SYNC_DELAY_SECONDS);
		$sent->setError(null);
		$this->envelopeMapper->update($sent);
	}

	private function markFailed(Envelope $envelope, string $errorCode): void {
		$now = $this->timeFactory->getTime();
		if (!$this->envelopeMapper->transitionStatus($envelope->getId(), [EnvelopeStatus::Sending], EnvelopeStatus::Failed, null, $now)) {
			return;
		}
		$failed = $this->envelopeMapper->findById($envelope->getId());
		$failed->setError($errorCode);
		$this->envelopeMapper->update($failed);
		$this->logger->warning('Envelope send failed', ['envelope' => $envelope->getUuid(), 'error' => $errorCode]);
	}
}
```

`lib/Send/SendJob.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Send;

use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\QueuedJob;

/** Runs Send outside the HTTP request, so a slow upload never hits Cloudflare's 100 s limit. */
final class SendJob extends QueuedJob {
	public function __construct(
		ITimeFactory $time,
		private EnvelopeSender $sender,
	) {
		parent::__construct($time);
	}

	/** @param array{envelopeId?: int} $argument */
	protected function run($argument): void {
		$this->sender->send((int)($argument['envelopeId'] ?? 0));
	}
}
```

In `lib/Controller/EnvelopeController.php`:
- add the imports `use OCA\Assinaturas\Db\EnvelopeStatus;`, `use OCA\Assinaturas\Send\EnvelopeSender;` and `use OCA\Assinaturas\Send\SendConflict;`;
- add `private EnvelopeSender $sender,` as the **last** constructor parameter;
- add this method after `destroy()`:
```php
	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'POST', url: '/api/v1/envelopes/{uuid}/send')]
	public function send(string $uuid): JSONResponse {
		return $this->editing($uuid, function (Envelope $envelope): JSONResponse {
			try {
				$this->sender->claim($envelope);
			} catch (SendConflict) {
				return new JSONResponse(['error' => 'already_sending', 'message' => 'This envelope is already being sent or was sent'], Http::STATUS_CONFLICT);
			}
			return new JSONResponse(['status' => EnvelopeStatus::Sending->value], Http::STATUS_ACCEPTED);
		});
	}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'EnvelopeSenderTest|EnvelopeControllerTest'`, then `tests/env/phpunit.sh`.
Expected: `OK` for 10 `EnvelopeSenderTest` tests and 11 `EnvelopeControllerTest` tests; the full suite is green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: send envelopes through resumable steps in a background job"
```

---

### Task 10: Signed files (trusted download and save next to the original)

**Files:**
- Create: `lib/Storage/SignedFileUnavailable.php`, `lib/Storage/SignedFileSaveFailed.php`, `lib/Storage/SignedFileDownloader.php`, `lib/Storage/SignedFileStore.php`
- Test: `tests/Unit/Storage/SignedFileDownloaderTest.php`, `tests/Unit/Storage/SignedFileStoreFallbackTest.php`, `tests/Integration/Storage/SignedFileStoreTest.php`

**Interfaces:**
- Consumes: `HttpTransport`, `HttpRequest`, `TransportFailure`, `FakeHttpTransport` (Plan 1); `TestUsers`.
- Produces:
  - `SignedFileUnavailable(string $reason)` with reasons `untrusted_host`, `url_expired`, `download_failed`. Callers retry later after re-fetching the document for a fresh URL.
  - `SignedFileSaveFailed(string $reason)` with reasons `owner_missing`, `not_permitted`, `no_space`, `fallback_folder_blocked`.
  - `SignedFileDownloader::download(string $url): string`. It only fetches `https://zapsign.s3.amazonaws.com/...`, sends no Authorization header, and requires HTTP 200 with a `%PDF-` body.
  - `SignedFileStore::save(string $ownerUid, int $sourceFileId, string $sourcePath, string $content): File`.
    - It saves next to the original if the original still exists and its folder is writable; otherwise in `/Assinaturas`.
    - The name is `<stem> (assinado).pdf`, then `(assinado 2)`, `(assinado 3)`, …
    - It rethrows `OCP\Lock\LockedException` so callers retry later.

- [ ] **Step 1: Write the failing tests**

`tests/Unit/Storage/SignedFileDownloaderTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\Storage;

use OCA\Assinaturas\Storage\SignedFileDownloader;
use OCA\Assinaturas\Storage\SignedFileUnavailable;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\ZapSign\Http\TransportFailure;
use PHPUnit\Framework\TestCase;

final class SignedFileDownloaderTest extends TestCase {
	private const SIGNED_URL = 'https://zapsign.s3.amazonaws.com/sandbox/dev/2026/9/signed.pdf';

	private FakeHttpTransport $transport;

	protected function setUp(): void {
		$this->transport = new FakeHttpTransport();
	}

	public function testDownloadsASignedPdfWithoutTheZapSignCredential(): void {
		$this->transport->willRespond(200, "%PDF-1.7\nsigned");

		$content = (new SignedFileDownloader($this->transport))->download(self::SIGNED_URL);

		$this->assertSame("%PDF-1.7\nsigned", $content);
		$this->assertSame(self::SIGNED_URL, $this->transport->requests[0]->url());
		$this->assertArrayNotHasKey('Authorization', $this->transport->requests[0]->headers());
	}

	/** @dataProvider untrustedUrls */
	public function testRefusesToFetchFromAnywhereElse(string $url): void {
		$this->assertUnavailable('untrusted_host', $url);
		$this->assertCount(0, $this->transport->requests);
	}

	/** @return array<string, array{string}> */
	public static function untrustedUrls(): array {
		return [
			'plain http' => ['http://zapsign.s3.amazonaws.com/signed.pdf'],
			'another host' => ['https://evil.example/signed.pdf'],
			'look-alike host' => ['https://zapsign.s3.amazonaws.com.evil.example/signed.pdf'],
			'internal address' => ['https://169.254.169.254/latest/meta-data'],
		];
	}

	public function testReportsAnExpiredLink(): void {
		$this->transport->willRespond(403, '<Error><Code>AccessDenied</Code></Error>');

		$this->assertUnavailable('url_expired', self::SIGNED_URL);
	}

	public function testReportsABodyThatIsNotAPdf(): void {
		$this->transport->willRespond(200, '<html>proxy</html>');

		$this->assertUnavailable('download_failed', self::SIGNED_URL);
	}

	public function testReportsATransportFailure(): void {
		$this->transport->willFail(new TransportFailure('timeout'));

		$this->assertUnavailable('download_failed', self::SIGNED_URL);
	}

	private function assertUnavailable(string $expectedReason, string $url): void {
		try {
			(new SignedFileDownloader($this->transport))->download($url);
			$this->fail('Expected ' . $expectedReason);
		} catch (SignedFileUnavailable $unavailable) {
			$this->assertSame($expectedReason, $unavailable->reason);
		}
	}
}
```

`tests/Unit/Storage/SignedFileStoreFallbackTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\Storage;

use OCA\Assinaturas\Storage\SignedFileStore;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\IUser;
use OCP\IUserManager;
use PHPUnit\Framework\TestCase;

/** The read-only case needs a share, which is costly to build in integration, so it is covered with doubles. */
final class SignedFileStoreFallbackTest extends TestCase {
	public function testSavesIntoTheFallbackFolderWhenTheOriginalsFolderIsReadOnly(): void {
		$readOnlyFolder = $this->createMock(Folder::class);
		$readOnlyFolder->method('isCreatable')->willReturn(false);
		$original = $this->createMock(File::class);
		$original->method('getParent')->willReturn($readOnlyFolder);
		$savedFile = $this->createMock(File::class);
		$fallbackFolder = $this->createMock(Folder::class);
		$fallbackFolder->method('nodeExists')->willReturn(false);
		$fallbackFolder->expects($this->once())->method('newFile')->with('Contrato (assinado).pdf', '%PDF-signed')->willReturn($savedFile);
		$userFolder = $this->createMock(Folder::class);
		$userFolder->method('getFirstNodeById')->with(42)->willReturn($original);
		$userFolder->method('nodeExists')->with('Assinaturas')->willReturn(false);
		$userFolder->expects($this->once())->method('newFolder')->with('Assinaturas')->willReturn($fallbackFolder);
		$rootFolder = $this->createMock(IRootFolder::class);
		$rootFolder->method('getUserFolder')->willReturn($userFolder);
		$userManager = $this->createMock(IUserManager::class);
		$userManager->method('get')->willReturn($this->createMock(IUser::class));

		$saved = (new SignedFileStore($rootFolder, $userManager))->save('maria', 42, '/Compartilhado/Contrato.pdf', '%PDF-signed');

		$this->assertSame($savedFile, $saved);
	}
}
```

`tests/Integration/Storage/SignedFileStoreTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Storage;

use OCA\Assinaturas\Storage\SignedFileSaveFailed;
use OCA\Assinaturas\Storage\SignedFileStore;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\Files\IRootFolder;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class SignedFileStoreTest extends TestCase {
	use TestUsers;

	private const SIGNED_CONTENT = "%PDF-1.7\nassinado";

	private SignedFileStore $store;
	private string $owner;

	protected function setUp(): void {
		parent::setUp();
		$this->store = Server::get(SignedFileStore::class);
		$this->owner = $this->createUser();
	}

	protected function tearDown(): void {
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testSavesTheSignedCopyNextToTheOriginal(): void {
		$original = $this->writeFile($this->owner, 'Contratos/Contrato.pdf', self::minimalPdf());

		$saved = $this->store->save($this->owner, $original->getId(), '/Contratos/Contrato.pdf', self::SIGNED_CONTENT);

		$this->assertSame('/Contratos/Contrato (assinado).pdf', $this->relativePath($saved->getPath()));
		$this->assertSame(self::SIGNED_CONTENT, $saved->getContent());
	}

	public function testNumbersTheCopyWhenTheNameIsTaken(): void {
		$original = $this->writeFile($this->owner, 'Contrato.pdf', self::minimalPdf());

		$first = $this->store->save($this->owner, $original->getId(), '/Contrato.pdf', self::SIGNED_CONTENT);
		$second = $this->store->save($this->owner, $original->getId(), '/Contrato.pdf', self::SIGNED_CONTENT);
		$third = $this->store->save($this->owner, $original->getId(), '/Contrato.pdf', self::SIGNED_CONTENT);

		$this->assertSame(['/Contrato (assinado).pdf', '/Contrato (assinado 2).pdf', '/Contrato (assinado 3).pdf'], [
			$this->relativePath($first->getPath()),
			$this->relativePath($second->getPath()),
			$this->relativePath($third->getPath()),
		]);
	}

	public function testHandlesAnUppercaseExtension(): void {
		$original = $this->writeFile($this->owner, 'SCAN.PDF', self::minimalPdf());

		$saved = $this->store->save($this->owner, $original->getId(), '/SCAN.PDF', self::SIGNED_CONTENT);

		$this->assertSame('/SCAN (assinado).pdf', $this->relativePath($saved->getPath()));
	}

	public function testSavesIntoTheAssinaturasFolderWhenTheOriginalWasDeleted(): void {
		$original = $this->writeFile($this->owner, 'Contratos/Contrato.pdf', self::minimalPdf());
		$originalId = $original->getId();
		$original->delete();

		$saved = $this->store->save($this->owner, $originalId, '/Contratos/Contrato.pdf', self::SIGNED_CONTENT);

		$this->assertSame('/Assinaturas/Contrato (assinado).pdf', $this->relativePath($saved->getPath()));
	}

	public function testFailsWhenTheOwnerNoLongerExists(): void {
		try {
			$this->store->save('assinaturas-ghost-user', 1, '/Contrato.pdf', self::SIGNED_CONTENT);
			$this->fail('Expected a failed save');
		} catch (SignedFileSaveFailed $failure) {
			$this->assertSame('owner_missing', $failure->reason);
		}
	}

	private function relativePath(string $absolutePath): string {
		return (string)Server::get(IRootFolder::class)->getUserFolder($this->owner)->getRelativePath($absolutePath);
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter 'SignedFileDownloaderTest|SignedFileStore'`
Expected: ERROR `Class "OCA\Assinaturas\Storage\SignedFileDownloader" not found`.

- [ ] **Step 3: Implement**

`lib/Storage/SignedFileUnavailable.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Storage;

/** The signed PDF could not be fetched right now. Re-fetch the document for a fresh URL and try later. */
final class SignedFileUnavailable extends \RuntimeException {
	public function __construct(
		public readonly string $reason,
	) {
		parent::__construct('Signed file unavailable: ' . $reason);
	}
}
```

`lib/Storage/SignedFileSaveFailed.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Storage;

final class SignedFileSaveFailed extends \RuntimeException {
	public function __construct(
		public readonly string $reason,
	) {
		parent::__construct('Signed file could not be saved: ' . $reason);
	}
}
```

`lib/Storage/SignedFileDownloader.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Storage;

use OCA\Assinaturas\ZapSign\Http\HttpRequest;
use OCA\Assinaturas\ZapSign\Http\HttpTransport;
use OCA\Assinaturas\ZapSign\Http\TransportFailure;

/**
 * Fetches ZapSign's pre-signed S3 links. The host is allowlisted, because the URL comes from a
 * provider response (SSRF), and no ZapSign credential is ever sent to S3.
 */
final class SignedFileDownloader {
	private const ALLOWED_HOSTS = ['zapsign.s3.amazonaws.com'];
	private const REQUIRED_SCHEME = 'https';
	private const DOWNLOAD_TIMEOUT_SECONDS = 120;
	private const USER_AGENT = 'AvuzConecta-Assinaturas/0.1';
	private const EXPIRED_LINK_STATUS = 403;
	private const SUCCESS_STATUS = 200;
	private const PDF_MAGIC = '%PDF-';

	public function __construct(
		private HttpTransport $transport,
	) {
	}

	/** @throws SignedFileUnavailable */
	public function download(#[\SensitiveParameter] string $url): string {
		$scheme = parse_url($url, PHP_URL_SCHEME);
		$host = parse_url($url, PHP_URL_HOST);
		if ($scheme !== self::REQUIRED_SCHEME || !in_array($host, self::ALLOWED_HOSTS, true)) {
			throw new SignedFileUnavailable('untrusted_host');
		}
		try {
			$response = $this->transport->send(new HttpRequest('GET', $url, ['User-Agent' => self::USER_AGENT], null, self::DOWNLOAD_TIMEOUT_SECONDS));
		} catch (TransportFailure) {
			throw new SignedFileUnavailable('download_failed');
		}
		if ($response->statusCode === self::EXPIRED_LINK_STATUS) {
			throw new SignedFileUnavailable('url_expired');
		}
		if ($response->statusCode !== self::SUCCESS_STATUS || !str_starts_with($response->body, self::PDF_MAGIC)) {
			throw new SignedFileUnavailable('download_failed');
		}
		return $response->body;
	}
}
```

`lib/Storage/SignedFileStore.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Storage;

use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\NotEnoughSpaceException;
use OCP\Files\NotPermittedException;
use OCP\IUserManager;
use OCP\Lock\LockedException;

/** Saves "<name> (assinado).pdf" next to the original, as its owner, or in /Assinaturas when that is impossible. */
final class SignedFileStore {
	private const FALLBACK_FOLDER = 'Assinaturas';
	private const SIGNED_MARKER = ' (assinado';
	private const PDF_EXTENSION = '.pdf';
	private const PDF_EXTENSION_PATTERN = '/\.pdf$/i';
	private const FIRST_NUMBERED_COPY = 2;

	public function __construct(
		private IRootFolder $rootFolder,
		private IUserManager $userManager,
	) {
	}

	/**
	 * @throws SignedFileSaveFailed
	 * @throws LockedException when another process holds the target; retry later
	 */
	public function save(string $ownerUid, int $sourceFileId, string $sourcePath, #[\SensitiveParameter] string $content): File {
		if ($this->userManager->get($ownerUid) === null) {
			throw new SignedFileSaveFailed('owner_missing');
		}
		$folder = $this->targetFolder($this->rootFolder->getUserFolder($ownerUid), $sourceFileId);
		try {
			return $folder->newFile($this->availableName($folder, self::stem($sourcePath)), $content);
		} catch (NotEnoughSpaceException) {
			throw new SignedFileSaveFailed('no_space');
		} catch (NotPermittedException) {
			throw new SignedFileSaveFailed('not_permitted');
		}
	}

	private function targetFolder(Folder $userFolder, int $sourceFileId): Folder {
		$parent = $userFolder->getFirstNodeById($sourceFileId)?->getParent();
		if ($parent instanceof Folder && $parent->isCreatable()) {
			return $parent;
		}
		return $this->fallbackFolder($userFolder);
	}

	private function fallbackFolder(Folder $userFolder): Folder {
		if (!$userFolder->nodeExists(self::FALLBACK_FOLDER)) {
			try {
				return $userFolder->newFolder(self::FALLBACK_FOLDER);
			} catch (NotPermittedException) {
				throw new SignedFileSaveFailed('not_permitted');
			}
		}
		$existing = $userFolder->get(self::FALLBACK_FOLDER);
		if (!$existing instanceof Folder) {
			throw new SignedFileSaveFailed('fallback_folder_blocked');
		}
		return $existing;
	}

	private function availableName(Folder $folder, string $stem): string {
		$firstName = $stem . self::SIGNED_MARKER . ')' . self::PDF_EXTENSION;
		if (!$folder->nodeExists($firstName)) {
			return $firstName;
		}
		for ($copyNumber = self::FIRST_NUMBERED_COPY; ; $copyNumber++) {
			$candidate = $stem . self::SIGNED_MARKER . ' ' . $copyNumber . ')' . self::PDF_EXTENSION;
			if (!$folder->nodeExists($candidate)) {
				return $candidate;
			}
		}
	}

	private static function stem(string $sourcePath): string {
		return (string)preg_replace(self::PDF_EXTENSION_PATTERN, '', basename($sourcePath));
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'SignedFileDownloaderTest|SignedFileStore'`, then `tests/env/phpunit.sh`.
Expected: `OK` for 8 downloader cases, 1 fallback test and 5 store tests; the full suite is green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: download signed PDFs from ZapSign's bucket and save them next to the originals"
```

---

### Task 11: Sync schedule, envelope events and completion

**Files:**
- Create: `lib/Sync/SyncSchedule.php`, `lib/Sync/EnvelopeEvents.php`, `lib/Sync/EnvelopeCompletion.php`
- Test: `tests/Unit/Sync/SyncScheduleTest.php`, `tests/Integration/Sync/EnvelopeCompletionTest.php`

**Interfaces:**
- Consumes:
  - `SignedFileDownloader`, `SignedFileStore` and their exceptions (Task 10);
  - `ZapSignDocument` (Plan 1);
  - `SaveStatus`, `EnvelopeStatus`;
  - `EventMapper::insertIfNew`;
  - `ZapSignDoubles`, `TestUsers`, `EnvelopeCleanup`.
- Produces:
  - `SyncSchedule::nextSyncAt(int $now, int $sentAt, ?int $deadlineAt, int $jitterSeconds = 0): int`. The interval grows with the envelope's age, and gets shorter when the deadline is near:

    | Condition | Interval |
    |---|---|
    | Less than 1 h since sent | +300 s |
    | Less than 1 day since sent | +3600 s |
    | Otherwise | +21600 s |
    | Deadline within 24 h | at most +3600 s |

  - `EnvelopeEvents::record(int $envelopeId, ?int $signerId, string $type, string $moment, int $occurredAt, array<string, scalar> $detail = []): void` builds the dedupe key `"<envelopeId>:<signerId|->:<type>:<moment>"`, so replays are no-ops.
  - `EnvelopeCompletion::complete(Envelope $envelope, ZapSignDocument $providerDocument): void`:
    - `pending|expired` → claims `finalizing` (lease 600 s), saves the signed files, then `completed` with `completed_at` and a `completed` event, recorded once;
    - `completed` → only retries documents that aren't saved yet;
    - `finalizing` → does nothing, because another process holds the lease;
    - a document the store can't save becomes `save_failed`;
    - any document still unsaved keeps `next_sync_at = now + 300`; once every document is saved, `next_sync_at` is `null`.

- [ ] **Step 1: Write the failing tests**

`tests/Unit/Sync/SyncScheduleTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\Sync;

use OCA\Assinaturas\Sync\SyncSchedule;
use PHPUnit\Framework\TestCase;

final class SyncScheduleTest extends TestCase {
	private const NOW = 1_790_000_000;

	/** @dataProvider schedules */
	public function testSpacesChecksByTheEnvelopesAgeAndDeadline(int $secondsSinceSent, ?int $secondsToDeadline, int $expectedDelay): void {
		$deadline = $secondsToDeadline === null ? null : self::NOW + $secondsToDeadline;

		$nextSync = (new SyncSchedule())->nextSyncAt(self::NOW, self::NOW - $secondsSinceSent, $deadline);

		$this->assertSame(self::NOW + $expectedDelay, $nextSync);
	}

	/** @return array<string, array{int, ?int, int}> */
	public static function schedules(): array {
		return [
			'first hour' => [600, null, 300],
			'first day' => [7200, null, 3600],
			'after the first day' => [3 * 86400, null, 21600],
			'old envelope with a deadline tomorrow' => [3 * 86400, 20 * 3600, 3600],
			'old envelope with a distant deadline' => [3 * 86400, 10 * 86400, 21600],
		];
	}

	public function testAddsJitter(): void {
		$this->assertSame(self::NOW + 300 + 17, (new SyncSchedule())->nextSyncAt(self::NOW, self::NOW, null, 17));
	}
}
```

`tests/Integration/Sync/EnvelopeCompletionTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Sync;

use OCA\Assinaturas\Db\Document;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\Event;
use OCA\Assinaturas\Db\EventMapper;
use OCA\Assinaturas\Db\SaveStatus;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Storage\SignedFileDownloader;
use OCA\Assinaturas\Storage\SignedFileStore;
use OCA\Assinaturas\Sync\EnvelopeCompletion;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCA\Assinaturas\ZapSign\Model\ZapSignDocument;
use OCP\Files\IRootFolder;
use OCP\Server;
use Psr\Log\NullLogger;
use Test\TestCase;

/**
 * @group DB
 */
final class EnvelopeCompletionTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ZapSignDoubles;

	private const MAIN_TOKEN = 'doc-main-token';
	private const EXTRA_TOKEN = 'doc-extra-token';
	private const MAIN_URL = 'https://zapsign.s3.amazonaws.com/sandbox/main-signed.pdf';
	private const EXTRA_URL = 'https://zapsign.s3.amazonaws.com/sandbox/extra-signed.pdf';

	private string $owner;
	private Envelope $envelope;

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->owner = $this->createUser();
		$drafts = Server::get(EnvelopeDrafts::class);
		$envelope = $drafts->create($this->owner, 'Contrato', [
			$this->writeFile($this->owner, 'Contratos/Contrato.pdf', self::minimalPdf('contrato'))->getId(),
			$this->writeFile($this->owner, 'Contratos/Anexo.pdf', self::minimalPdf('anexo'))->getId(),
		]);
		$documentMapper = Server::get(DocumentMapper::class);
		[$main, $extra] = $documentMapper->findByEnvelope($envelope->getId());
		$main->setZapsignToken(self::MAIN_TOKEN);
		$documentMapper->update($main);
		$extra->setZapsignToken(self::EXTRA_TOKEN);
		$documentMapper->update($extra);
		$envelope->setStatus(EnvelopeStatus::Pending->value);
		$envelope->setZapsignToken(self::MAIN_TOKEN);
		$envelope->setSentAt($this->now - 3600);
		$this->envelope = Server::get(EnvelopeMapper::class)->update($envelope);
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testSavesEverySignedFileAndCompletesOnce(): void {
		$this->transport->willRespond(200, "%PDF-1.7\nmain assinado")->willRespond(200, "%PDF-1.7\nanexo assinado");

		$this->completion()->complete($this->envelope, self::signedDocument(self::MAIN_URL, self::EXTRA_URL));
		$this->completion()->complete($this->reloaded(), self::signedDocument(self::MAIN_URL, self::EXTRA_URL));

		$completed = $this->reloaded();
		$this->assertSame(EnvelopeStatus::Completed, $completed->statusValue());
		$this->assertSame($this->now, $completed->getCompletedAt());
		$this->assertNull($completed->getNextSyncAt());
		$this->assertCount(2, $this->transport->requests);
		$this->assertSame([SaveStatus::Saved, SaveStatus::Saved], array_map(fn (Document $document): SaveStatus => $document->saveStatusValue(), $this->documents()));
		$userFolder = Server::get(IRootFolder::class)->getUserFolder($this->owner);
		$this->assertSame("%PDF-1.7\nmain assinado", $userFolder->get('Contratos/Contrato (assinado).pdf')->getContent());
		$this->assertTrue($userFolder->nodeExists('Contratos/Anexo (assinado).pdf'));
		$this->assertSame(['completed'], $this->eventTypes());
	}

	public function testKeepsRetryingAFileWhoseLinkExpired(): void {
		$this->transport->willRespond(200, "%PDF-1.7\nmain assinado")->willRespond(403, 'expired');
		$this->completion()->complete($this->envelope, self::signedDocument(self::MAIN_URL, self::EXTRA_URL));
		$afterFirstAttempt = $this->reloaded();

		$this->transport->willRespond(200, "%PDF-1.7\nanexo assinado");
		$this->completion()->complete($afterFirstAttempt, self::signedDocument(self::MAIN_URL, self::EXTRA_URL));

		$this->assertSame(EnvelopeStatus::Completed, $afterFirstAttempt->statusValue());
		$this->assertSame($this->now + 300, $afterFirstAttempt->getNextSyncAt());
		$this->assertNull($this->reloaded()->getNextSyncAt());
		$this->assertSame([SaveStatus::Saved, SaveStatus::Saved], array_map(fn (Document $document): SaveStatus => $document->saveStatusValue(), $this->documents()));
	}

	public function testWaitsForASignedFileThatIsNotReadyYet(): void {
		$this->completion()->complete($this->envelope, self::signedDocument(null, null));

		$this->assertCount(0, $this->transport->requests);
		$this->assertSame(EnvelopeStatus::Completed, $this->reloaded()->statusValue());
		$this->assertSame($this->now + 300, $this->reloaded()->getNextSyncAt());
		$this->assertSame([SaveStatus::Pending, SaveStatus::Pending], array_map(fn (Document $document): SaveStatus => $document->saveStatusValue(), $this->documents()));
	}

	public function testMarksAFileThatCannotBeSavedAndStillCompletes(): void {
		$this->envelope->setOwnerUid('assinaturas-ghost-owner');
		Server::get(EnvelopeMapper::class)->update($this->envelope);
		$this->transport->willRespond(200, "%PDF-1.7\nmain assinado")->willRespond(200, "%PDF-1.7\nanexo assinado");

		$this->completion()->complete($this->reloaded(), self::signedDocument(self::MAIN_URL, self::EXTRA_URL));

		$this->assertSame(EnvelopeStatus::Completed, $this->reloaded()->statusValue());
		$this->assertSame([SaveStatus::SaveFailed, SaveStatus::SaveFailed], array_map(fn (Document $document): SaveStatus => $document->saveStatusValue(), $this->documents()));
		$this->envelope->setOwnerUid($this->owner);
		Server::get(EnvelopeMapper::class)->update($this->envelope);
	}

	public function testLeavesAnEnvelopeAnotherProcessIsFinalizing(): void {
		Server::get(EnvelopeMapper::class)->transitionStatus($this->envelope->getId(), [EnvelopeStatus::Pending], EnvelopeStatus::Finalizing, $this->now + 600, $this->now);

		$this->completion()->complete($this->reloaded(), self::signedDocument(self::MAIN_URL, self::EXTRA_URL));

		$this->assertCount(0, $this->transport->requests);
		$this->assertSame(EnvelopeStatus::Finalizing, $this->reloaded()->statusValue());
	}

	private function completion(): EnvelopeCompletion {
		return new EnvelopeCompletion(
			Server::get(EnvelopeMapper::class),
			Server::get(DocumentMapper::class),
			new EnvelopeEvents(Server::get(EventMapper::class)),
			new SignedFileDownloader($this->transport),
			Server::get(SignedFileStore::class),
			$this->fixedClock(),
			new NullLogger(),
		);
	}

	private function reloaded(): Envelope {
		return Server::get(EnvelopeMapper::class)->findById($this->envelope->getId());
	}

	/** @return list<Document> */
	private function documents(): array {
		return Server::get(DocumentMapper::class)->findByEnvelope($this->envelope->getId());
	}

	/** @return list<string> */
	private function eventTypes(): array {
		return array_map(fn (Event $event): string => $event->getType(), Server::get(EventMapper::class)->findByEnvelope($this->envelope->getId()));
	}

	private static function signedDocument(?string $mainUrl, ?string $extraUrl): ZapSignDocument {
		return ZapSignDocument::fromPayload([
			'token' => self::MAIN_TOKEN,
			'status' => 'signed',
			'signed_file' => $mainUrl,
			'extra_docs' => [['token' => self::EXTRA_TOKEN, 'name' => 'Anexo.pdf', 'signed_file' => $extraUrl]],
			'signers' => [],
		]);
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter 'SyncScheduleTest|EnvelopeCompletionTest'`
Expected: ERROR `Class "OCA\Assinaturas\Sync\SyncSchedule" not found`.

- [ ] **Step 3: Implement**

`lib/Sync/SyncSchedule.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Sync;

/** When to re-check an in-flight envelope. Webhooks are the fast path; this is the safety net. */
final class SyncSchedule {
	private const FIRST_HOUR_SECONDS = 3600;
	private const FIRST_DAY_SECONDS = 86400;
	private const INTERVAL_IN_FIRST_HOUR = 300;
	private const INTERVAL_IN_FIRST_DAY = 3600;
	private const INTERVAL_AFTER_FIRST_DAY = 21600;
	private const INTERVAL_NEAR_DEADLINE = 3600;

	public function nextSyncAt(int $now, int $sentAt, ?int $deadlineAt, int $jitterSeconds = 0): int {
		$interval = self::intervalForAge($now - $sentAt);
		$isDeadlineNear = $deadlineAt !== null && $deadlineAt - $now < self::FIRST_DAY_SECONDS;
		if ($isDeadlineNear) {
			$interval = min($interval, self::INTERVAL_NEAR_DEADLINE);
		}
		return $now + $interval + $jitterSeconds;
	}

	private static function intervalForAge(int $ageSeconds): int {
		if ($ageSeconds < self::FIRST_HOUR_SECONDS) {
			return self::INTERVAL_IN_FIRST_HOUR;
		}
		if ($ageSeconds < self::FIRST_DAY_SECONDS) {
			return self::INTERVAL_IN_FIRST_DAY;
		}
		return self::INTERVAL_AFTER_FIRST_DAY;
	}
}
```

`lib/Sync/EnvelopeEvents.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Sync;

use OCA\Assinaturas\Db\Event;
use OCA\Assinaturas\Db\EventMapper;

/**
 * The envelope timeline. Events come from state changes we observed on a re-fetch, never
 * from webhook payloads, and a replay of the same change is a no-op.
 */
final class EnvelopeEvents {
	private const NO_SIGNER = '-';

	public function __construct(
		private EventMapper $eventMapper,
	) {
	}

	/** @param array<string, scalar> $detail */
	public function record(int $envelopeId, ?int $signerId, string $type, string $moment, int $occurredAt, array $detail = []): void {
		$event = new Event();
		$event->setEnvelopeId($envelopeId);
		$event->setSignerId($signerId);
		$event->setType($type);
		$event->setDedupeKey(implode(':', [$envelopeId, $signerId ?? self::NO_SIGNER, $type, $moment]));
		$event->setOccurredAt($occurredAt);
		$event->setDetail($detail === [] ? null : $detail);
		$this->eventMapper->insertIfNew($event);
	}
}
```

`lib/Sync/EnvelopeCompletion.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Sync;

use OCA\Assinaturas\Db\Document;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\SaveStatus;
use OCA\Assinaturas\Storage\SignedFileDownloader;
use OCA\Assinaturas\Storage\SignedFileSaveFailed;
use OCA\Assinaturas\Storage\SignedFileStore;
use OCA\Assinaturas\Storage\SignedFileUnavailable;
use OCA\Assinaturas\ZapSign\Model\ZapSignDocument;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Lock\LockedException;
use Psr\Log\LoggerInterface;

/**
 * Every signature is in. The envelope is claimed once (webhook and poller can race), each
 * signed PDF is saved next to its original, and files that could not be saved yet are retried later.
 */
final class EnvelopeCompletion {
	private const FINALIZING_LEASE_SECONDS = 600;
	private const SAVE_RETRY_DELAY_SECONDS = 300;
	private const COMPLETED_EVENT = 'completed';
	private const FIRST_COMPLETION_STATUSES = [EnvelopeStatus::Pending, EnvelopeStatus::Expired];

	public function __construct(
		private EnvelopeMapper $envelopeMapper,
		private DocumentMapper $documentMapper,
		private EnvelopeEvents $events,
		private SignedFileDownloader $downloader,
		private SignedFileStore $store,
		private ITimeFactory $timeFactory,
		private LoggerInterface $logger,
	) {
	}

	public function complete(Envelope $envelope, ZapSignDocument $providerDocument): void {
		$now = $this->timeFactory->getTime();
		$isFirstCompletion = in_array($envelope->statusValue(), self::FIRST_COMPLETION_STATUSES, true);
		if (!$isFirstCompletion && $envelope->statusValue() !== EnvelopeStatus::Completed) {
			return;
		}
		if ($isFirstCompletion && !$this->envelopeMapper->transitionStatus($envelope->getId(), self::FIRST_COMPLETION_STATUSES, EnvelopeStatus::Finalizing, $now + self::FINALIZING_LEASE_SECONDS, $now)) {
			return;
		}
		$allSaved = $this->saveSignedFiles($envelope, $providerDocument);
		if ($isFirstCompletion) {
			$this->envelopeMapper->transitionStatus($envelope->getId(), [EnvelopeStatus::Finalizing], EnvelopeStatus::Completed, null, $now);
			$this->events->record($envelope->getId(), null, self::COMPLETED_EVENT, '', $now);
		}
		$completed = $this->envelopeMapper->findById($envelope->getId());
		$completed->setCompletedAt($completed->getCompletedAt() ?? $now);
		$completed->setLastSyncedAt($now);
		$completed->setNextSyncAt($allSaved ? null : $now + self::SAVE_RETRY_DELAY_SECONDS);
		$this->envelopeMapper->update($completed);
	}

	private function saveSignedFiles(Envelope $envelope, ZapSignDocument $providerDocument): bool {
		$allSaved = true;
		foreach ($this->documentMapper->findByEnvelope($envelope->getId()) as $document) {
			if ($document->saveStatusValue() === SaveStatus::Saved) {
				continue;
			}
			$allSaved = $this->saveSignedFile($envelope, $document, $providerDocument) && $allSaved;
		}
		return $allSaved;
	}

	private function saveSignedFile(Envelope $envelope, Document $document, ZapSignDocument $providerDocument): bool {
		$url = self::signedFileUrl($document, $providerDocument);
		if ($url === null) {
			return false;
		}
		try {
			$content = $this->downloader->download($url);
			$file = $this->store->save($envelope->getOwnerUid(), $document->getSourceFileId(), $document->getSourcePath(), $content);
		} catch (SignedFileUnavailable|LockedException) {
			return false;
		} catch (SignedFileSaveFailed $failure) {
			$document->setSaveStatus(SaveStatus::SaveFailed->value);
			$this->documentMapper->update($document);
			$this->logger->warning('Signed file could not be saved', ['envelope' => $envelope->getUuid(), 'reason' => $failure->reason]);
			return false;
		}
		$document->setSignedFileId($file->getId());
		$document->setSaveStatus(SaveStatus::Saved->value);
		$this->documentMapper->update($document);
		return true;
	}

	private static function signedFileUrl(Document $document, ZapSignDocument $providerDocument): ?string {
		if ($document->getZapsignToken() === $providerDocument->token) {
			return $providerDocument->signedFileUrl;
		}
		foreach ($providerDocument->extraDocuments as $extraDocument) {
			if ($extraDocument->token === $document->getZapsignToken()) {
				return $extraDocument->signedFileUrl;
			}
		}
		return null;
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'SyncScheduleTest|EnvelopeCompletionTest'`, then `tests/env/phpunit.sh`.
Expected: `OK` for 6 schedule cases and 5 completion tests; the full suite is green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: complete signed envelopes once and save every signed PDF with retries"
```

---

### Task 12: Envelope synchronizer

**Files:**
- Create: `lib/Sync/EnvelopeSynchronizer.php`
- Test: `tests/Integration/Sync/EnvelopeSynchronizerTest.php`

**Interfaces:**
- Consumes:
  - `StatusMapper`, `ProviderOutcome` (Task 2);
  - `SyncSchedule`, `EnvelopeEvents`, `EnvelopeCompletion` (Task 11);
  - `ZapSignClient::getDocument`.
- Produces:
  - `EnvelopeSynchronizer::synchronizeById(int $envelopeId): void`, which ignores unknown ids.
  - `EnvelopeSynchronizer::synchronize(Envelope $envelope): void`:
    - works only on `pending`, `expired` and `completed` envelopes that have a ZapSign token;
    - re-fetches the document;
    - updates signers and never downgrades a `signed` or `refused` signer;
    - records one event per signer status change;
    - applies the outcome, as below;
    - always sets `last_synced_at`;
    - lets `ZapSignException` propagate to the caller.

  | Outcome | Effect |
  |---|---|
  | Signed | `EnvelopeCompletion::complete` |
  | Refused | `refused`, with `refused_reason` and a `refused` event; no further sync |
  | Cancelled | `cancelled` plus a `cancelled` event; no further sync |
  | Expired | `pending` → `expired` plus an `expired` event; re-checked every 6 h |
  | Pending or Unknown | rescheduled by `SyncSchedule` with 0–30 s jitter; Unknown also logs a warning |

- [ ] **Step 1: Write the failing test**

`tests/Integration/Sync/EnvelopeSynchronizerTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Sync;

use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\Event;
use OCA\Assinaturas\Db\EventMapper;
use OCA\Assinaturas\Db\Signer;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Db\SignerStatus;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Storage\SignedFileDownloader;
use OCA\Assinaturas\Storage\SignedFileStore;
use OCA\Assinaturas\Sync\EnvelopeCompletion;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCA\Assinaturas\Sync\EnvelopeSynchronizer;
use OCA\Assinaturas\Sync\StatusMapper;
use OCA\Assinaturas\Sync\SyncSchedule;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\Server;
use Psr\Log\NullLogger;
use Test\TestCase;

/**
 * @group DB
 */
final class EnvelopeSynchronizerTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ZapSignDoubles;

	private const MAIN_TOKEN = 'doc-main-token';
	private const SIGNED_URL = 'https://zapsign.s3.amazonaws.com/sandbox/main-signed.pdf';

	private string $owner;
	private Envelope $envelope;
	/** @var list<Signer> */
	private array $signers;

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->owner = $this->createUser();
		$drafts = Server::get(EnvelopeDrafts::class);
		$envelope = $drafts->create($this->owner, 'Contrato', [$this->writeFile($this->owner, 'Contrato.pdf', self::minimalPdf())->getId()]);
		$this->signers = $drafts->replaceSigners($envelope, [
			['name' => 'Ana Lima', 'email' => 'ana@example.com'],
			['name' => 'Bruno Souza', 'email' => 'bruno@example.com'],
		]);
		foreach ($this->signers as $signer) {
			$signer->setZapsignToken('signer-token-' . $signer->getId());
			Server::get(SignerMapper::class)->update($signer);
		}
		$main = Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId())[0];
		$main->setZapsignToken(self::MAIN_TOKEN);
		Server::get(DocumentMapper::class)->update($main);
		$envelope->setStatus(EnvelopeStatus::Pending->value);
		$envelope->setZapsignToken(self::MAIN_TOKEN);
		$envelope->setSentAt($this->now - 600);
		$this->envelope = Server::get(EnvelopeMapper::class)->update($envelope);
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testRecordsSignerProgressOnceAndReschedules(): void {
		$progress = $this->document('pending', [
			['status' => 'signed', 'status_code' => 'signed', 'signed_at' => '2026-09-21T15:00:00.000000Z', 'first_opened_at' => '2026-09-21T14:55:00.000000Z'],
			['status' => 'new', 'status_code' => 'not-opened'],
		]);
		$this->transport->willRespond(200, $progress)->willRespond(200, $progress);

		$this->synchronizer()->synchronize($this->envelope);
		$this->synchronizer()->synchronize($this->reloaded());

		[$ana, $bruno] = Server::get(SignerMapper::class)->findByEnvelope($this->envelope->getId());
		$this->assertSame(SignerStatus::Signed, $ana->statusValue());
		$this->assertSame(strtotime('2026-09-21T15:00:00Z'), $ana->getSignedAt());
		$this->assertSame(strtotime('2026-09-21T14:55:00Z'), $ana->getViewedAt());
		$this->assertSame(SignerStatus::Pending, $bruno->statusValue());
		$this->assertSame(['signed'], $this->eventTypes());
		$reloaded = $this->reloaded();
		$this->assertSame($this->now, $reloaded->getLastSyncedAt());
		$this->assertGreaterThanOrEqual($this->now + 300, $reloaded->getNextSyncAt());
		$this->assertLessThanOrEqual($this->now + 330, $reloaded->getNextSyncAt());
	}

	public function testNeverDowngradesASignedSigner(): void {
		$this->signers[0]->setStatus(SignerStatus::Signed->value);
		Server::get(SignerMapper::class)->update($this->signers[0]);
		$this->transport->willRespond(200, $this->document('pending', [['status' => 'link-opened'], ['status' => 'new']]));

		$this->synchronizer()->synchronize($this->envelope);

		$this->assertSame(SignerStatus::Signed, Server::get(SignerMapper::class)->findByEnvelope($this->envelope->getId())[0]->statusValue());
	}

	public function testCompletesASignedEnvelopeAndSavesItsFile(): void {
		$this->transport->willRespond(200, $this->document('signed', [['status' => 'signed', 'status_code' => 'signed'], ['status' => 'signed', 'status_code' => 'signed']], self::SIGNED_URL))
			->willRespond(200, "%PDF-1.7\nassinado");

		$this->synchronizer()->synchronize($this->envelope);

		$this->assertSame(EnvelopeStatus::Completed, $this->reloaded()->statusValue());
		$this->assertNotNull(Server::get(DocumentMapper::class)->findByEnvelope($this->envelope->getId())[0]->getSignedFileId());
	}

	public function testMarksASignerRefusalWithItsReason(): void {
		$refusal = $this->document('recusado', [['status' => 'rejeitou', 'status_code' => 'refused', 'signed_at' => '2026-09-21T15:00:00.000000Z'], ['status' => 'new']]);
		$refusal['rejected_reason'] = 'Valores errados na cláusula 3';
		$this->transport->willRespond(200, $refusal);

		$this->synchronizer()->synchronize($this->envelope);

		$refused = $this->reloaded();
		$this->assertSame(EnvelopeStatus::Refused, $refused->statusValue());
		$this->assertSame('Valores errados na cláusula 3', $refused->getRefusedReason());
		$this->assertNull($refused->getNextSyncAt());
		$ana = Server::get(SignerMapper::class)->findByEnvelope($this->envelope->getId())[0];
		$this->assertSame(SignerStatus::Refused, $ana->statusValue());
		$this->assertNull($ana->getSignedAt());
		$this->assertContains('refused', $this->eventTypes());
	}

	public function testTreatsOurOwnCancelAsCancelled(): void {
		$this->envelope->setCancelRequestedAt($this->now - 30);
		Server::get(EnvelopeMapper::class)->update($this->envelope);
		$this->transport->willRespond(200, $this->document('recusado', [['status' => 'new'], ['status' => 'new']]));

		$this->synchronizer()->synchronize($this->reloaded());

		$this->assertSame(EnvelopeStatus::Cancelled, $this->reloaded()->statusValue());
		$this->assertSame(['cancelled'], $this->eventTypes());
	}

	public function testCancelsAnEnvelopeDeletedAtZapSign(): void {
		$deleted = $this->document('pending', [['status' => 'new'], ['status' => 'new']]);
		$deleted['deleted'] = true;
		$this->transport->willRespond(200, $deleted);

		$this->synchronizer()->synchronize($this->envelope);

		$this->assertSame(EnvelopeStatus::Cancelled, $this->reloaded()->statusValue());
	}

	public function testExpiresAPendingEnvelopePastItsDeadlineAndKeepsWatchingIt(): void {
		$this->envelope->setDeadlineAt($this->now - 10);
		Server::get(EnvelopeMapper::class)->update($this->envelope);
		$this->transport->willRespond(200, $this->document('pending', [['status' => 'new'], ['status' => 'new']]));

		$this->synchronizer()->synchronize($this->reloaded());

		$expired = $this->reloaded();
		$this->assertSame(EnvelopeStatus::Expired, $expired->statusValue());
		$this->assertSame($this->now + 21600, $expired->getNextSyncAt());
		$this->assertSame(['expired'], $this->eventTypes());
	}

	public function testCompletesAnExpiredEnvelopeThatWasSignedLate(): void {
		Server::get(EnvelopeMapper::class)->transitionStatus($this->envelope->getId(), [EnvelopeStatus::Pending], EnvelopeStatus::Expired, null, $this->now);
		$this->transport->willRespond(200, $this->document('signed', [['status' => 'signed'], ['status' => 'signed']], self::SIGNED_URL))
			->willRespond(200, "%PDF-1.7\nassinado");

		$this->synchronizer()->synchronize($this->reloaded());

		$this->assertSame(EnvelopeStatus::Completed, $this->reloaded()->statusValue());
	}

	public function testLeavesTheStateAloneOnAnUnknownProviderStatus(): void {
		$this->transport->willRespond(200, $this->document('arquivado', [['status' => 'new'], ['status' => 'new']]));

		$this->synchronizer()->synchronize($this->envelope);

		$this->assertSame(EnvelopeStatus::Pending, $this->reloaded()->statusValue());
		$this->assertNotNull($this->reloaded()->getNextSyncAt());
	}

	public function testSkipsEnvelopesThatAreNotInFlight(): void {
		$draft = Server::get(EnvelopeDrafts::class)->create($this->owner, 'Rascunho', [$this->writeFile($this->owner, 'Rascunho.pdf', self::minimalPdf())->getId()]);

		$this->synchronizer()->synchronize($draft);
		$this->synchronizer()->synchronizeById(999999999);

		$this->assertCount(0, $this->transport->requests);
	}

	private function synchronizer(): EnvelopeSynchronizer {
		$settings = $this->zapSignSettings();
		$events = new EnvelopeEvents(Server::get(EventMapper::class));
		$completion = new EnvelopeCompletion(
			Server::get(EnvelopeMapper::class),
			Server::get(DocumentMapper::class),
			$events,
			new SignedFileDownloader($this->transport),
			Server::get(SignedFileStore::class),
			$this->fixedClock(),
			new NullLogger(),
		);
		return new EnvelopeSynchronizer(
			Server::get(EnvelopeMapper::class),
			Server::get(SignerMapper::class),
			$this->zapSignClient($settings),
			new StatusMapper(),
			new SyncSchedule(),
			$completion,
			$events,
			$this->fixedClock(),
			new NullLogger(),
		);
	}

	private function reloaded(): Envelope {
		return Server::get(EnvelopeMapper::class)->findById($this->envelope->getId());
	}

	/** @return list<string> */
	private function eventTypes(): array {
		return array_map(fn (Event $event): string => $event->getType(), Server::get(EventMapper::class)->findByEnvelope($this->envelope->getId()));
	}

	/**
	 * @param list<array<string, string>> $signerStates one per signer, in signer order
	 * @return array<string, mixed>
	 */
	private function document(string $status, array $signerStates, ?string $signedFileUrl = null): array {
		$signers = [];
		foreach ($this->signers as $index => $signer) {
			$signers[] = ['token' => 'signer-token-' . $signer->getId(), 'email' => $signer->getEmail()] + $signerStates[$index];
		}
		return ['token' => self::MAIN_TOKEN, 'status' => $status, 'deleted' => false, 'signed_file' => $signedFileUrl, 'extra_docs' => [], 'signers' => $signers];
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `tests/env/phpunit.sh --filter EnvelopeSynchronizerTest`
Expected: ERROR `Class "OCA\Assinaturas\Sync\EnvelopeSynchronizer" not found`.

- [ ] **Step 3: Implement**

`lib/Sync/EnvelopeSynchronizer.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Sync;

use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\Signer;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Db\SignerStatus;
use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use OCA\Assinaturas\ZapSign\Model\ZapSignDocument;
use OCA\Assinaturas\ZapSign\Model\ZapSignSigner;
use OCA\Assinaturas\ZapSign\ZapSignClient;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Utility\ITimeFactory;
use Psr\Log\LoggerInterface;

/** Reconciles one envelope with ZapSign. The re-fetched document is the only source of truth. */
final class EnvelopeSynchronizer {
	private const SYNCABLE_STATUSES = [EnvelopeStatus::Pending, EnvelopeStatus::Expired, EnvelopeStatus::Completed];
	private const OPEN_STATUSES = [EnvelopeStatus::Pending, EnvelopeStatus::Expired];
	private const FINAL_SIGNER_STATUSES = [SignerStatus::Signed, SignerStatus::Refused];
	private const EXPIRED_RECHECK_SECONDS = 21600;
	private const MAX_JITTER_SECONDS = 30;

	public function __construct(
		private EnvelopeMapper $envelopeMapper,
		private SignerMapper $signerMapper,
		private ZapSignClient $client,
		private StatusMapper $statusMapper,
		private SyncSchedule $schedule,
		private EnvelopeCompletion $completion,
		private EnvelopeEvents $events,
		private ITimeFactory $timeFactory,
		private LoggerInterface $logger,
	) {
	}

	/** @throws ZapSignException */
	public function synchronizeById(int $envelopeId): void {
		try {
			$envelope = $this->envelopeMapper->findById($envelopeId);
		} catch (DoesNotExistException) {
			return;
		}
		$this->synchronize($envelope);
	}

	/** @throws ZapSignException the caller decides when to retry */
	public function synchronize(Envelope $envelope): void {
		$isInFlight = in_array($envelope->statusValue(), self::SYNCABLE_STATUSES, true) && $envelope->getZapsignToken() !== null;
		if (!$isInFlight) {
			return;
		}
		$now = $this->timeFactory->getTime();
		$providerDocument = $this->client->getDocument((string)$envelope->getZapsignToken());
		$this->updateSigners($envelope, $providerDocument, $now);
		$deadlinePassed = $envelope->getDeadlineAt() !== null && $envelope->getDeadlineAt() < $now;
		$outcome = $this->statusMapper->outcome($providerDocument, $envelope->getCancelRequestedAt() !== null, $deadlinePassed);
		$this->applyOutcome($envelope, $outcome, $providerDocument, $now);
	}

	private function applyOutcome(Envelope $envelope, ProviderOutcome $outcome, ZapSignDocument $providerDocument, int $now): void {
		if ($outcome === ProviderOutcome::Signed) {
			$this->completion->complete($envelope, $providerDocument);
			return;
		}
		if ($outcome === ProviderOutcome::Refused) {
			$this->close($envelope, EnvelopeStatus::Refused, $now, (string)$providerDocument->rejectedReason);
			return;
		}
		if ($outcome === ProviderOutcome::Cancelled) {
			$this->close($envelope, EnvelopeStatus::Cancelled, $now, null);
			return;
		}
		if ($outcome === ProviderOutcome::Expired) {
			$this->expire($envelope, $now);
			return;
		}
		if ($outcome === ProviderOutcome::Unknown) {
			$this->logger->warning('ZapSign reported an unexpected document status', ['envelope' => $envelope->getUuid()]);
		}
		$this->reschedule($envelope, $now);
	}

	private function updateSigners(Envelope $envelope, ZapSignDocument $providerDocument, int $now): void {
		$providerSigners = [];
		foreach ($providerDocument->signers as $providerSigner) {
			$providerSigners[$providerSigner->token] = $providerSigner;
		}
		foreach ($this->signerMapper->findByEnvelope($envelope->getId()) as $signer) {
			$providerSigner = $providerSigners[(string)$signer->getZapsignToken()] ?? null;
			if ($providerSigner === null) {
				continue;
			}
			$this->updateSigner($envelope, $signer, $providerSigner, $now);
		}
	}

	private function updateSigner(Envelope $envelope, Signer $signer, ZapSignSigner $providerSigner, int $now): void {
		$viewedAt = self::timestamp($providerSigner->viewedAt);
		$isFirstView = $signer->getViewedAt() === null && $viewedAt !== null;
		if ($isFirstView) {
			$signer->setViewedAt($viewedAt);
		}
		$newStatus = $this->statusMapper->signerStatus($providerSigner);
		$isStatusChange = $newStatus !== null
			&& $newStatus->value !== $signer->getStatus()
			&& !in_array($signer->statusValue(), self::FINAL_SIGNER_STATUSES, true);
		if (!$isStatusChange) {
			if ($isFirstView) {
				$this->signerMapper->update($signer);
			}
			return;
		}
		$signer->setStatus($newStatus->value);
		if ($newStatus === SignerStatus::Signed) {
			$signer->setSignedAt(self::timestamp($providerSigner->signedAt) ?? $now);
		}
		$this->signerMapper->update($signer);
		$moment = $providerSigner->signedAt ?? $providerSigner->viewedAt ?? '';
		$this->events->record($envelope->getId(), $signer->getId(), $newStatus->value, $moment, self::timestamp($moment) ?? $now);
	}

	private function close(Envelope $envelope, EnvelopeStatus $finalStatus, int $now, ?string $refusedReason): void {
		if (!$this->envelopeMapper->transitionStatus($envelope->getId(), self::OPEN_STATUSES, $finalStatus, null, $now)) {
			return;
		}
		$closed = $this->envelopeMapper->findById($envelope->getId());
		$closed->setNextSyncAt(null);
		$closed->setLastSyncedAt($now);
		if ($refusedReason !== null) {
			$closed->setRefusedReason($refusedReason);
		}
		$this->envelopeMapper->update($closed);
		$detail = $refusedReason === null || $refusedReason === '' ? [] : ['reason' => $refusedReason];
		$this->events->record($envelope->getId(), null, $finalStatus->value, '', $now, $detail);
	}

	private function expire(Envelope $envelope, int $now): void {
		$becameExpired = $this->envelopeMapper->transitionStatus($envelope->getId(), [EnvelopeStatus::Pending], EnvelopeStatus::Expired, null, $now);
		if ($becameExpired) {
			$this->events->record($envelope->getId(), null, EnvelopeStatus::Expired->value, '', $now);
		}
		$expired = $this->envelopeMapper->findById($envelope->getId());
		$expired->setLastSyncedAt($now);
		$expired->setNextSyncAt($now + self::EXPIRED_RECHECK_SECONDS);
		$this->envelopeMapper->update($expired);
	}

	private function reschedule(Envelope $envelope, int $now): void {
		$current = $this->envelopeMapper->findById($envelope->getId());
		$current->setLastSyncedAt($now);
		$current->setNextSyncAt($this->schedule->nextSyncAt($now, $current->getSentAt() ?? $now, $current->getDeadlineAt(), random_int(0, self::MAX_JITTER_SECONDS)));
		$this->envelopeMapper->update($current);
	}

	private static function timestamp(?string $isoMoment): ?int {
		if ($isoMoment === null || $isoMoment === '') {
			return null;
		}
		$parsed = strtotime($isoMoment);
		return $parsed === false ? null : $parsed;
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter EnvelopeSynchronizerTest`, then `tests/env/phpunit.sh`.
Expected: `OK (10 tests, …)`; the full suite is green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: reconcile envelopes with ZapSign's state without trusting event names"
```

---

### Task 13: Webhooks (receive, coalesce, register)

**Files:**
- Create: `lib/Webhook/WebhookSecrets.php`, `lib/Webhook/WebhookInbox.php`, `lib/Webhook/WebhookRegistrar.php`, `lib/Webhook/WebhookUrlChangeRefused.php`, `lib/Webhook/EnsureWebhooksJob.php`
- Create: `lib/Sync/SyncEnvelopeJob.php`, `lib/Controller/WebhookController.php`, `lib/Command/EnsureWebhooks.php`
- Modify: `appinfo/info.xml` (command + daily job)
- Test: `tests/Integration/Webhook/WebhookControllerTest.php`, `tests/Unit/Webhook/WebhookRegistrarTest.php`

**Interfaces:**
- Consumes:
  - `ZapSignSettings::ensureWebhookSecret`, `webhookSecret`, `webhookUrl`, `apiToken`, `environment`, `isConfigured` (Task 3);
  - `ZapSignClient::registerWebhook`, `deleteWebhook`;
  - `EnvelopeSynchronizer::synchronizeById` (Task 12).
- Produces:
  - On `WebhookSecrets`:
    - `accepts(string $provided): bool` accepts the current secret, or the previous one within 24 h of its retirement.
    - `retire(string $previousSecret): void`.
  - `WebhookInbox::accept(string $documentToken): void` finds the envelope by its main or extra document token and queues `SyncEnvelopeJob` unless one is already queued. Unknown tokens do nothing.
  - `SyncEnvelopeJob extends QueuedJob` with the argument `{envelopeId: int}`.
  - `WebhookController::receive(): JSONResponse` at `POST /webhook`:
    - `#[PublicPage]`, `#[NoCSRFRequired]`, `#[AnonRateLimit(limit: 300, period: 60)]`;
    - a wrong secret returns 401, a body over 1 MB returns 413, otherwise 200 `{"received": true}`;
    - `WebhookController::SECRET_HEADER = 'X-Assinaturas-Secret'`.
  - `WebhookRegistrar::ensure(bool $confirmUrlChange = false): string` returns `not_configured`, `unchanged`, `registered` or `busy`. It throws `WebhookUrlChangeRefused` when the stored registration URL differs from this instance's URL and the change isn't confirmed.
  - `occ assinaturas:webhook:ensure [--confirm-url-change]`.
  - `EnsureWebhooksJob` runs daily.

- [ ] **Step 1: Write the failing tests**

`tests/Integration/Webhook/WebhookControllerTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Webhook;

use OCA\Assinaturas\Controller\WebhookController;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Sync\SyncEnvelopeJob;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCA\Assinaturas\Webhook\WebhookInbox;
use OCA\Assinaturas\Webhook\WebhookSecrets;
use OCA\Assinaturas\ZapSign\ZapSignSettings;
use OCP\AppFramework\Http;
use OCP\BackgroundJob\IJobList;
use OCP\IRequest;
use OCP\Server;
use Psr\Log\NullLogger;
use Test\TestCase;

/**
 * @group DB
 */
final class WebhookControllerTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ZapSignDoubles;

	private const SECRET = 'current-webhook-secret';
	private const MAIN_TOKEN = 'doc-main-token-webhook';
	private const EXTRA_TOKEN = 'doc-extra-token-webhook';

	private Envelope $envelope;
	/** @var list<array{string, mixed}> */
	private array $queuedJobs = [];
	private IJobList $jobList;

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->appConfigValues[ZapSignSettings::KEY_WEBHOOK_SECRET] = self::SECRET;
		$owner = $this->createUser();
		$envelope = Server::get(EnvelopeDrafts::class)->create($owner, 'Contrato', [
			$this->writeFile($owner, 'Contrato.pdf', self::minimalPdf())->getId(),
			$this->writeFile($owner, 'Anexo.pdf', self::minimalPdf())->getId(),
		]);
		$envelope->setZapsignToken(self::MAIN_TOKEN);
		$this->envelope = Server::get(EnvelopeMapper::class)->update($envelope);
		$extra = Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId())[1];
		$extra->setZapsignToken(self::EXTRA_TOKEN);
		Server::get(DocumentMapper::class)->update($extra);
		$this->jobList = $this->createMock(IJobList::class);
		$this->jobList->method('has')->willReturnCallback(fn (string $job, mixed $argument): bool => in_array([$job, $argument], $this->queuedJobs, true));
		$this->jobList->method('add')->willReturnCallback(function (string $job, mixed $argument): void {
			$this->queuedJobs[] = [$job, $argument];
		});
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testQueuesASyncForTheEnvelopeOfTheMainDocument(): void {
		$response = $this->controller(self::SECRET, self::MAIN_TOKEN)->receive();

		$this->assertSame(Http::STATUS_OK, $response->getStatus());
		$this->assertSame([[SyncEnvelopeJob::class, ['envelopeId' => $this->envelope->getId()]]], $this->queuedJobs);
	}

	public function testQueuesASyncWhenTheTokenIsAnExtraDocument(): void {
		$this->controller(self::SECRET, self::EXTRA_TOKEN)->receive();

		$this->assertSame([[SyncEnvelopeJob::class, ['envelopeId' => $this->envelope->getId()]]], $this->queuedJobs);
	}

	public function testQueuesOneSyncForABurstOfEvents(): void {
		$this->controller(self::SECRET, self::MAIN_TOKEN)->receive();
		$this->controller(self::SECRET, self::MAIN_TOKEN)->receive();
		$this->controller(self::SECRET, self::MAIN_TOKEN)->receive();

		$this->assertCount(1, $this->queuedJobs);
	}

	public function testAcknowledgesAnUnknownTokenWithoutQueueing(): void {
		$response = $this->controller(self::SECRET, 'someone-elses-document')->receive();

		$this->assertSame(Http::STATUS_OK, $response->getStatus());
		$this->assertSame([], $this->queuedJobs);
	}

	public function testRejectsAWrongSecret(): void {
		$response = $this->controller('guessed-secret', self::MAIN_TOKEN)->receive();

		$this->assertSame(Http::STATUS_UNAUTHORIZED, $response->getStatus());
		$this->assertSame([], $this->queuedJobs);
	}

	public function testAcceptsThePreviousSecretDuringItsGracePeriod(): void {
		$this->secrets()->retire('previous-webhook-secret');
		$this->now += 3600;

		$response = $this->controller('previous-webhook-secret', self::MAIN_TOKEN)->receive();

		$this->assertSame(Http::STATUS_OK, $response->getStatus());
	}

	public function testRejectsThePreviousSecretAfterItsGracePeriod(): void {
		$this->secrets()->retire('previous-webhook-secret');
		$this->now += 86401;

		$response = $this->controller('previous-webhook-secret', self::MAIN_TOKEN)->receive();

		$this->assertSame(Http::STATUS_UNAUTHORIZED, $response->getStatus());
	}

	public function testRejectsAnOversizedBody(): void {
		$response = $this->controller(self::SECRET, self::MAIN_TOKEN, 2_000_000)->receive();

		$this->assertSame(Http::STATUS_REQUEST_ENTITY_TOO_LARGE, $response->getStatus());
		$this->assertSame([], $this->queuedJobs);
	}

	private function controller(string $secretHeader, string $documentToken, int $contentLength = 2000): WebhookController {
		$request = $this->createMock(IRequest::class);
		$request->method('getHeader')->willReturnCallback(fn (string $name): string => [
			WebhookController::SECRET_HEADER => $secretHeader,
			'Content-Length' => (string)$contentLength,
		][$name] ?? '');
		$request->method('getParam')->willReturnCallback(fn (string $key, mixed $default = null): mixed => $key === 'token' ? $documentToken : $default);
		$inbox = new WebhookInbox(Server::get(EnvelopeMapper::class), Server::get(DocumentMapper::class), $this->jobList);
		return new WebhookController($request, $this->secrets(), $inbox, new NullLogger());
	}

	private function secrets(): WebhookSecrets {
		return new WebhookSecrets($this->zapSignSettings(), $this->inMemoryAppConfig(), $this->fixedClock());
	}
}
```

`tests/Unit/Webhook/WebhookRegistrarTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\Webhook;

use OC\Memcache\ArrayCache;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\Webhook\WebhookRegistrar;
use OCA\Assinaturas\Webhook\WebhookSecrets;
use OCA\Assinaturas\Webhook\WebhookUrlChangeRefused;
use OCA\Assinaturas\ZapSign\ZapSignSettings;
use OCP\ICacheFactory;
use Test\TestCase;

final class WebhookRegistrarTest extends TestCase {
	use ZapSignDoubles;

	private const TYPE_COUNT = 5;

	private ArrayCache $locks;

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->locks = new ArrayCache('');
		$this->appConfigValues[ZapSignSettings::KEY_WEBHOOK_SECRET] = 'secret-a';
	}

	public function testRegistersEveryTypeWithTheSecretHeaderOnce(): void {
		$this->respondToRegistrations(100);

		$first = $this->registrar()->ensure();
		$second = $this->registrar()->ensure();

		$this->assertSame(WebhookRegistrar::RESULT_REGISTERED, $first);
		$this->assertSame(WebhookRegistrar::RESULT_UNCHANGED, $second);
		$this->assertCount(self::TYPE_COUNT, $this->transport->requests);
		$types = [];
		foreach ($this->transport->requests as $request) {
			$payload = json_decode((string)$request->body(), true, 512, JSON_THROW_ON_ERROR);
			$this->assertSame('https://tenant.example/index.php/apps/assinaturas/webhook', $payload['url']);
			$this->assertSame([['name' => 'X-Assinaturas-Secret', 'value' => 'secret-a']], $payload['headers']);
			$types[] = $payload['type'];
		}
		$this->assertSame(['', 'doc_viewed', 'doc_expired', 'doc_deleted', 'email_bounce'], $types);
	}

	public function testSkipsWhenNoTokenIsConfigured(): void {
		$this->appConfigValues[ZapSignSettings::KEY_API_TOKEN] = '';

		$this->assertSame(WebhookRegistrar::RESULT_NOT_CONFIGURED, $this->registrar()->ensure());
		$this->assertCount(0, $this->transport->requests);
	}

	public function testReplacesTheRegistrationsWhenTheTokenRotates(): void {
		$this->respondToRegistrations(100);
		$this->registrar()->ensure();
		$this->transport->requests = [];
		$this->appConfigValues[ZapSignSettings::KEY_API_TOKEN] = 'rotated-token';
		for ($index = 0; $index < self::TYPE_COUNT; $index++) {
			$this->transport->willRespond(200, '{}');
		}
		$this->respondToRegistrations(200);

		$result = $this->registrar()->ensure();

		$this->assertSame(WebhookRegistrar::RESULT_REGISTERED, $result);
		$methods = array_map(fn ($request): string => $request->method(), $this->transport->requests);
		$this->assertSame(array_merge(array_fill(0, self::TYPE_COUNT, 'DELETE'), array_fill(0, self::TYPE_COUNT, 'POST')), $methods);
	}

	public function testTreatsAnAlreadyDeletedWebhookAsGone(): void {
		$this->respondToRegistrations(100);
		$this->registrar()->ensure();
		$this->appConfigValues[ZapSignSettings::KEY_API_TOKEN] = 'rotated-token';
		for ($index = 0; $index < self::TYPE_COUNT; $index++) {
			$this->transport->willRespond(404, '{"detail":"Not found."}');
		}
		$this->respondToRegistrations(200);

		$this->assertSame(WebhookRegistrar::RESULT_REGISTERED, $this->registrar()->ensure());
	}

	public function testRefusesToRepointWebhooksRegisteredForAnotherInstance(): void {
		$this->appConfigValues['webhook_url'] = 'https://production-tenant.example/index.php/apps/assinaturas/webhook';

		try {
			$this->registrar()->ensure();
			$this->fail('Expected the URL change to be refused');
		} catch (WebhookUrlChangeRefused) {
		}
		$this->assertCount(0, $this->transport->requests);

		$this->respondToRegistrations(100);
		$this->assertSame(WebhookRegistrar::RESULT_REGISTERED, $this->registrar()->ensure(true));
	}

	public function testKeepsThePreviousSecretValidAfterItChanges(): void {
		$this->respondToRegistrations(100);
		$this->registrar()->ensure();
		$this->appConfigValues[ZapSignSettings::KEY_WEBHOOK_SECRET] = 'secret-b';
		for ($index = 0; $index < self::TYPE_COUNT; $index++) {
			$this->transport->willRespond(200, '{}');
		}
		$this->respondToRegistrations(200);

		$this->registrar()->ensure();

		$this->assertTrue($this->secrets()->accepts('secret-a'));
		$this->assertTrue($this->secrets()->accepts('secret-b'));
	}

	public function testReportsBusyWhileAnotherProcessRegisters(): void {
		$this->locks->add('webhook_registration', 1, 120);

		$this->assertSame(WebhookRegistrar::RESULT_BUSY, $this->registrar()->ensure());
		$this->assertCount(0, $this->transport->requests);
	}

	private function respondToRegistrations(int $firstId): void {
		for ($index = 0; $index < self::TYPE_COUNT; $index++) {
			$this->transport->willRespond(200, ['id' => $firstId + $index]);
		}
	}

	private function registrar(): WebhookRegistrar {
		$settings = $this->zapSignSettings();
		$cacheFactory = $this->createMock(ICacheFactory::class);
		$cacheFactory->method('createLocking')->willReturn($this->locks);
		return new WebhookRegistrar($this->zapSignClient($settings), $settings, $this->secrets(), $this->inMemoryAppConfig(), $cacheFactory);
	}

	private function secrets(): WebhookSecrets {
		return new WebhookSecrets($this->zapSignSettings(), $this->inMemoryAppConfig(), $this->fixedClock());
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter 'WebhookControllerTest|WebhookRegistrarTest'`
Expected: ERROR `Class "OCA\Assinaturas\Controller\WebhookController" not found`.

- [ ] **Step 3: Implement**

`lib/Webhook/WebhookSecrets.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Webhook;

use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\ZapSign\ZapSignSettings;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IAppConfig;

/**
 * ZapSign does not sign its webhooks, so each tenant's registration carries a secret header.
 * After the secret changes, the old one stays valid for a day, so in-flight retries still land.
 */
final class WebhookSecrets {
	public const KEY_PREVIOUS_SECRET = 'previous_webhook_secret';
	public const KEY_PREVIOUS_VALID_UNTIL = 'previous_webhook_secret_valid_until';
	private const ROTATION_GRACE_SECONDS = 86400;

	public function __construct(
		private ZapSignSettings $settings,
		private IAppConfig $appConfig,
		private ITimeFactory $timeFactory,
	) {
	}

	public function accepts(#[\SensitiveParameter] string $provided): bool {
		if ($provided === '') {
			return false;
		}
		$current = $this->settings->webhookSecret();
		if ($current !== '' && hash_equals($current, $provided)) {
			return true;
		}
		$previous = $this->appConfig->getValueString(Application::APP_ID, self::KEY_PREVIOUS_SECRET);
		$validUntil = $this->appConfig->getValueInt(Application::APP_ID, self::KEY_PREVIOUS_VALID_UNTIL);
		return $previous !== '' && $validUntil > $this->timeFactory->getTime() && hash_equals($previous, $provided);
	}

	public function retire(#[\SensitiveParameter] string $previousSecret): void {
		$this->appConfig->setValueString(Application::APP_ID, self::KEY_PREVIOUS_SECRET, $previousSecret, false, true);
		$this->appConfig->setValueInt(Application::APP_ID, self::KEY_PREVIOUS_VALID_UNTIL, $this->timeFactory->getTime() + self::ROTATION_GRACE_SECONDS);
	}
}
```

`lib/Webhook/WebhookInbox.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Webhook;

use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Sync\SyncEnvelopeJob;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\BackgroundJob\IJobList;

/**
 * Turns a webhook into one coalesced re-sync of its envelope. The payload is never trusted:
 * only its document token is used, and the sync re-fetches the truth from ZapSign.
 */
final class WebhookInbox {
	public function __construct(
		private EnvelopeMapper $envelopeMapper,
		private DocumentMapper $documentMapper,
		private IJobList $jobList,
	) {
	}

	public function accept(string $documentToken): void {
		$envelopeId = $this->envelopeIdFor($documentToken);
		if ($envelopeId === null) {
			return;
		}
		$argument = ['envelopeId' => $envelopeId];
		if ($this->jobList->has(SyncEnvelopeJob::class, $argument)) {
			return;
		}
		$this->jobList->add(SyncEnvelopeJob::class, $argument);
	}

	private function envelopeIdFor(string $documentToken): ?int {
		if ($documentToken === '') {
			return null;
		}
		try {
			return $this->envelopeMapper->findByZapsignToken($documentToken)->getId();
		} catch (DoesNotExistException) {
		}
		try {
			return $this->documentMapper->findByZapsignToken($documentToken)->getEnvelopeId();
		} catch (DoesNotExistException) {
			return null;
		}
	}
}
```

`lib/Sync/SyncEnvelopeJob.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Sync;

use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\QueuedJob;
use Psr\Log\LoggerInterface;

final class SyncEnvelopeJob extends QueuedJob {
	public function __construct(
		ITimeFactory $time,
		private EnvelopeSynchronizer $synchronizer,
		private LoggerInterface $logger,
	) {
		parent::__construct($time);
	}

	/** @param array{envelopeId?: int} $argument */
	protected function run($argument): void {
		try {
			$this->synchronizer->synchronizeById((int)($argument['envelopeId'] ?? 0));
		} catch (ZapSignException $failure) {
			$this->logger->warning('Webhook-triggered sync failed; the poller retries', ['failure' => $failure::class]);
		}
	}
}
```

`lib/Controller/WebhookController.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Controller;

use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\Webhook\WebhookInbox;
use OCA\Assinaturas\Webhook\WebhookSecrets;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\AnonRateLimit;
use OCP\AppFramework\Http\Attribute\FrontpageRoute;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;
use Psr\Log\LoggerInterface;

/** The app's only public route. No brute-force throttle: a stale registration would get ZapSign's own IP blocked. */
final class WebhookController extends Controller {
	public const SECRET_HEADER = 'X-Assinaturas-Secret';
	private const MAX_BODY_BYTES = 1_048_576;

	public function __construct(
		IRequest $request,
		private WebhookSecrets $secrets,
		private WebhookInbox $inbox,
		private LoggerInterface $logger,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[PublicPage]
	#[NoCSRFRequired]
	#[AnonRateLimit(limit: 300, period: 60)]
	#[FrontpageRoute(verb: 'POST', url: '/webhook')]
	public function receive(): JSONResponse {
		if (!$this->secrets->accepts($this->request->getHeader(self::SECRET_HEADER))) {
			$this->logger->warning('Rejected a ZapSign webhook with a wrong secret');
			return new JSONResponse(['error' => 'unauthorized'], Http::STATUS_UNAUTHORIZED);
		}
		if ((int)$this->request->getHeader('Content-Length') > self::MAX_BODY_BYTES) {
			return new JSONResponse(['error' => 'too_large'], Http::STATUS_REQUEST_ENTITY_TOO_LARGE);
		}
		$token = $this->request->getParam('token');
		$this->inbox->accept(is_string($token) ? $token : '');
		return new JSONResponse(['received' => true]);
	}
}
```

`lib/Webhook/WebhookUrlChangeRefused.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Webhook;

/** Protects production: a database restored into staging must not re-point production webhooks to staging. */
final class WebhookUrlChangeRefused extends \RuntimeException {
	public function __construct(string $registeredUrl, string $currentUrl) {
		parent::__construct('Webhooks are registered for ' . $registeredUrl . ' but this instance is ' . $currentUrl
			. '. Run occ assinaturas:webhook:ensure --confirm-url-change only if this instance really moved.');
	}
}
```

`lib/Webhook/WebhookRegistrar.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Webhook;

use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\Controller\WebhookController;
use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use OCA\Assinaturas\ZapSign\Exception\ZapSignNotFound;
use OCA\Assinaturas\ZapSign\ZapSignClient;
use OCA\Assinaturas\ZapSign\ZapSignSettings;
use OCP\IAppConfig;
use OCP\ICacheFactory;
use OCP\IMemcache;

/**
 * Keeps exactly one set of ZapSign webhooks pointing at this instance. ZapSign cannot list
 * webhooks, so the ids we registered are stored and deleted before registering again.
 */
final class WebhookRegistrar {
	public const RESULT_NOT_CONFIGURED = 'not_configured';
	public const RESULT_UNCHANGED = 'unchanged';
	public const RESULT_REGISTERED = 'registered';
	public const RESULT_BUSY = 'busy';
	private const WEBHOOK_TYPES = [
		'all' => '',
		'doc_viewed' => 'doc_viewed',
		'doc_expired' => 'doc_expired',
		'doc_deleted' => 'doc_deleted',
		'email_bounce' => 'email_bounce',
	];
	private const KEY_IDS = 'webhook_ids';
	private const KEY_FINGERPRINT = 'webhook_fingerprint';
	private const KEY_URL = 'webhook_url';
	private const KEY_REGISTERED_SECRET = 'registered_webhook_secret';
	private const LOCK_PREFIX = 'assinaturas';
	private const LOCK_KEY = 'webhook_registration';
	private const LOCK_SECONDS = 120;

	private IMemcache $locks;

	public function __construct(
		private ZapSignClient $client,
		private ZapSignSettings $settings,
		private WebhookSecrets $secrets,
		private IAppConfig $appConfig,
		ICacheFactory $cacheFactory,
	) {
		$this->locks = $cacheFactory->createLocking(self::LOCK_PREFIX);
	}

	/** @throws WebhookUrlChangeRefused|ZapSignException */
	public function ensure(bool $confirmUrlChange = false): string {
		if (!$this->settings->isConfigured()) {
			return self::RESULT_NOT_CONFIGURED;
		}
		$secret = $this->settings->ensureWebhookSecret();
		$url = $this->settings->webhookUrl();
		if ($this->fingerprint($url, $secret) === $this->stored(self::KEY_FINGERPRINT)) {
			return self::RESULT_UNCHANGED;
		}
		$registeredUrl = $this->stored(self::KEY_URL);
		if ($registeredUrl !== '' && $registeredUrl !== $url && !$confirmUrlChange) {
			throw new WebhookUrlChangeRefused($registeredUrl, $url);
		}
		if (!$this->locks->add(self::LOCK_KEY, 1, self::LOCK_SECONDS)) {
			return self::RESULT_BUSY;
		}
		try {
			$this->replaceRegistrations($url, $secret);
		} finally {
			$this->locks->remove(self::LOCK_KEY);
		}
		return self::RESULT_REGISTERED;
	}

	private function replaceRegistrations(string $url, #[\SensitiveParameter] string $secret): void {
		foreach ($this->appConfig->getValueArray(Application::APP_ID, self::KEY_IDS) as $webhookId) {
			try {
				$this->client->deleteWebhook((int)$webhookId);
			} catch (ZapSignNotFound) {
			}
		}
		$registeredIds = [];
		foreach (self::WEBHOOK_TYPES as $name => $type) {
			$registeredIds[$name] = $this->client->registerWebhook($url, $type, [WebhookController::SECRET_HEADER => $secret]);
			$this->appConfig->setValueArray(Application::APP_ID, self::KEY_IDS, $registeredIds);
		}
		$previousSecret = $this->stored(self::KEY_REGISTERED_SECRET);
		if ($previousSecret !== '' && !hash_equals($previousSecret, $secret)) {
			$this->secrets->retire($previousSecret);
		}
		$this->appConfig->setValueString(Application::APP_ID, self::KEY_REGISTERED_SECRET, $secret, false, true);
		$this->appConfig->setValueString(Application::APP_ID, self::KEY_URL, $url);
		$this->appConfig->setValueString(Application::APP_ID, self::KEY_FINGERPRINT, $this->fingerprint($url, $secret));
	}

	private function fingerprint(string $url, #[\SensitiveParameter] string $secret): string {
		return hash('sha256', implode('|', [
			hash('sha256', $this->settings->apiToken()),
			$this->settings->environment()->value,
			$url,
			hash('sha256', $secret),
		]));
	}

	private function stored(string $key): string {
		return $this->appConfig->getValueString(Application::APP_ID, $key);
	}
}
```

`lib/Command/EnsureWebhooks.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Command;

use OCA\Assinaturas\Webhook\WebhookRegistrar;
use OCA\Assinaturas\Webhook\WebhookUrlChangeRefused;
use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

final class EnsureWebhooks extends Command {
	private const OPTION_CONFIRM_URL_CHANGE = 'confirm-url-change';

	public function __construct(
		private WebhookRegistrar $registrar,
	) {
		parent::__construct();
	}

	protected function configure(): void {
		$this->setName('assinaturas:webhook:ensure')
			->setDescription('Registers the ZapSign webhooks for this instance when they are missing or out of date')
			->addOption(self::OPTION_CONFIRM_URL_CHANGE, null, InputOption::VALUE_NONE, 'Allow re-pointing webhooks registered for a different instance URL');
	}

	protected function execute(InputInterface $input, OutputInterface $output): int {
		try {
			$result = $this->registrar->ensure((bool)$input->getOption(self::OPTION_CONFIRM_URL_CHANGE));
		} catch (WebhookUrlChangeRefused $refusal) {
			$output->writeln('<error>' . $refusal->getMessage() . '</error>');
			return self::FAILURE;
		} catch (ZapSignException $failure) {
			$output->writeln('<error>ZapSign refused the webhook registration (' . $failure::class . ')</error>');
			return self::FAILURE;
		}
		$output->writeln('Webhooks: ' . $result);
		return self::SUCCESS;
	}
}
```

`lib/Webhook/EnsureWebhooksJob.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Webhook;

use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;
use Psr\Log\LoggerInterface;

final class EnsureWebhooksJob extends TimedJob {
	private const ONE_DAY_SECONDS = 86400;

	public function __construct(
		ITimeFactory $time,
		private WebhookRegistrar $registrar,
		private LoggerInterface $logger,
	) {
		parent::__construct($time);
		$this->setInterval(self::ONE_DAY_SECONDS);
	}

	protected function run($argument): void {
		try {
			$this->registrar->ensure();
		} catch (WebhookUrlChangeRefused|ZapSignException $failure) {
			$this->logger->warning('ZapSign webhook registration needs attention', ['failure' => $failure::class]);
		}
	}
}
```

Replace `appinfo/info.xml` with:
```xml
<?xml version="1.0"?>
<info xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xsi:noNamespaceSchemaLocation="https://apps.nextcloud.com/schema/apps/info.xsd">
    <id>assinaturas</id>
    <name>Assinaturas</name>
    <summary>Assinatura eletrônica de documentos com ZapSign</summary>
    <description><![CDATA[Envie documentos do Drive para assinatura eletrônica e acompanhe cada envelope até a conclusão.]]></description>
    <version>0.1.0</version>
    <licence>agpl</licence>
    <author mail="dev@avuz.com">Avuz Team</author>
    <namespace>Assinaturas</namespace>
    <category>files</category>
    <bugs>https://github.com/avuz-conecta/assinaturas/issues</bugs>
    <dependencies>
        <php min-version="8.3"/>
        <nextcloud min-version="33" max-version="34"/>
    </dependencies>
    <background-jobs>
        <job>OCA\Assinaturas\Webhook\EnsureWebhooksJob</job>
    </background-jobs>
    <repair-steps>
        <install>
            <step>OCA\Assinaturas\Migration\EnsureSignersGroup</step>
        </install>
        <post-migration>
            <step>OCA\Assinaturas\Migration\EnsureSignersGroup</step>
        </post-migration>
    </repair-steps>
    <commands>
        <command>OCA\Assinaturas\Command\EnsureWebhooks</command>
    </commands>
</info>
```

- [ ] **Step 4: Rebuild the env and run the tests**

Run: `tests/env/reset.sh && tests/env/phpunit.sh --filter 'WebhookControllerTest|WebhookRegistrarTest'`, then `tests/env/phpunit.sh`.

Expected:
- `OK` for 8 controller tests and 7 registrar tests; the full suite is green.
- Also run `tests/env/php.sh occ list assinaturas`. It lists `assinaturas:webhook:ensure`.
- Also run `tests/env/php.sh occ assinaturas:webhook:ensure`. It prints `Webhooks: not_configured` on a fresh env, where no token is set.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: receive, coalesce and register ZapSign webhooks with a per-tenant secret"
```

---

### Task 14: The poller (tiered sync, lease recovery, sandbox archive)

**Files:**
- Modify: `lib/Db/EnvelopeMapper.php` (add `findDueForSync`, `findWithExpiredLease`, `findSandboxLeftovers`)
- Create: `lib/Sync/SyncPoller.php`, `lib/Sync/SyncPollerJob.php`
- Modify: `appinfo/info.xml` (poller job; version `0.2.0`)
- Test: `tests/Integration/Sync/SyncPollerTest.php`

**Interfaces:**
- Consumes: `EnvelopeSynchronizer` (Task 12); `ZapSignSettings::accountFingerprint`, `environment`, `isConfigured`; `ProviderBackoff`.
- Produces:
  - On `EnvelopeMapper`:
    - `findDueForSync(int $now, string $accountFingerprint, int $limit): list<Envelope>` returns `pending`, `expired` and `completed` envelopes with `next_sync_at <= now` and a matching fingerprint, oldest due first.
    - `findWithExpiredLease(EnvelopeStatus $status, int $now, int $limit): list<Envelope>`.
    - `findSandboxLeftovers(string $accountFingerprint, int $limit): list<Envelope>` returns `sandbox = true` envelopes in `sending`, `failed`, `pending`, `expired` or `finalizing` whose fingerprint is missing or differs.
  - `SyncPoller::run(): void`, in order:
    1. Do nothing without a token.
    2. Recover expired leases: `sending` → `failed` with `send_interrupted`; `finalizing` → `pending` with `next_sync_at = now`.
    3. In production only, archive sandbox leftovers as `archived_sandbox`.
    4. Sync up to 60 due envelopes. Stop on backoff or a 429. Postpone an envelope whose sync failed by 900 s.
  - `SyncPollerJob extends TimedJob`, every 300 s.

- [ ] **Step 1: Write the failing test**

`tests/Integration/Sync/SyncPollerTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Sync;

use OC\Memcache\ArrayCache;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\EventMapper;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Storage\SignedFileDownloader;
use OCA\Assinaturas\Storage\SignedFileStore;
use OCA\Assinaturas\Sync\EnvelopeCompletion;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCA\Assinaturas\Sync\EnvelopeSynchronizer;
use OCA\Assinaturas\Sync\StatusMapper;
use OCA\Assinaturas\Sync\SyncPoller;
use OCA\Assinaturas\Sync\SyncSchedule;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\ZapSignDoubles;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCA\Assinaturas\ZapSign\ProviderBackoff;
use OCA\Assinaturas\ZapSign\ZapSignSettings;
use OCP\ICacheFactory;
use OCP\Server;
use Psr\Log\NullLogger;
use Test\TestCase;

/**
 * @group DB
 */
final class SyncPollerTest extends TestCase {
	use TestUsers;
	use EnvelopeCleanup;
	use ZapSignDoubles;

	private string $owner;
	private ZapSignSettings $settings;

	protected function setUp(): void {
		parent::setUp();
		$this->transport = new FakeHttpTransport();
		$this->owner = $this->createUser();
		$this->settings = $this->zapSignSettings();
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testSynchronizesOnlyDueEnvelopesOfThisAccount(): void {
		$due = $this->inFlight('due-token', EnvelopeStatus::Pending, $this->now - 1, $this->settings->accountFingerprint());
		$this->inFlight('foreign-token', EnvelopeStatus::Pending, $this->now - 1, 'another-account');
		$this->inFlight('later-token', EnvelopeStatus::Pending, $this->now + 600, $this->settings->accountFingerprint());
		$this->transport->willRespond(200, ['token' => 'due-token', 'status' => 'pending', 'signers' => [], 'extra_docs' => []]);

		$this->poller()->run();

		$this->assertCount(1, $this->transport->requests);
		$this->assertStringEndsWith('/docs/due-token/', $this->transport->requests[0]->url());
		$this->assertSame($this->now, $this->reloaded($due)->getLastSyncedAt());
	}

	public function testRecoversAnInterruptedSend(): void {
		$interrupted = $this->inFlight(null, EnvelopeStatus::Sending, null, null, $this->now - 1);

		$this->poller()->run();

		$failed = $this->reloaded($interrupted);
		$this->assertSame(EnvelopeStatus::Failed, $failed->statusValue());
		$this->assertSame('send_interrupted', $failed->getError());
	}

	public function testReturnsAStuckFinalizationToPending(): void {
		$stuck = $this->inFlight('stuck-token', EnvelopeStatus::Finalizing, null, $this->settings->accountFingerprint(), $this->now - 1);
		$this->transport->willRespond(200, ['token' => 'stuck-token', 'status' => 'pending', 'signers' => [], 'extra_docs' => []]);

		$this->poller()->run();

		$this->assertSame(EnvelopeStatus::Pending, $this->reloaded($stuck)->statusValue());
	}

	public function testArchivesSandboxLeftoversAfterSwitchingToProduction(): void {
		$leftover = $this->inFlight('old-sandbox-token', EnvelopeStatus::Pending, $this->now - 1, $this->settings->accountFingerprint(), null, true);
		$this->appConfigValues[ZapSignSettings::KEY_ENVIRONMENT] = 'production';

		$this->poller()->run();

		$this->assertSame(EnvelopeStatus::ArchivedSandbox, $this->reloaded($leftover)->statusValue());
		$this->assertCount(0, $this->transport->requests);
	}

	public function testKeepsSandboxEnvelopesWhileStillInSandbox(): void {
		$sandboxEnvelope = $this->inFlight('sandbox-token', EnvelopeStatus::Pending, $this->now + 600, 'an-older-fingerprint', null, true);

		$this->poller()->run();

		$this->assertSame(EnvelopeStatus::Pending, $this->reloaded($sandboxEnvelope)->statusValue());
	}

	public function testStopsTheRunWhenZapSignRateLimits(): void {
		$this->inFlight('first-token', EnvelopeStatus::Pending, $this->now - 20, $this->settings->accountFingerprint());
		$this->inFlight('second-token', EnvelopeStatus::Pending, $this->now - 10, $this->settings->accountFingerprint());
		$this->transport->willRespond(429, '{"detail":"Request was throttled."}', ['retry-after' => '30']);

		$this->poller()->run();

		$this->assertCount(1, $this->transport->requests);
	}

	public function testPostponesAnEnvelopeWhoseSyncFailed(): void {
		$missing = $this->inFlight('missing-token', EnvelopeStatus::Pending, $this->now - 1, $this->settings->accountFingerprint());
		$this->transport->willRespond(404, '{"detail":"Not found."}');

		$this->poller()->run();

		$postponed = $this->reloaded($missing);
		$this->assertSame(EnvelopeStatus::Pending, $postponed->statusValue());
		$this->assertSame($this->now + 900, $postponed->getNextSyncAt());
	}

	public function testDoesNothingWithoutAToken(): void {
		$this->appConfigValues[ZapSignSettings::KEY_API_TOKEN] = '';
		$this->inFlight('due-token', EnvelopeStatus::Pending, $this->now - 1, $this->settings->accountFingerprint());

		$this->poller()->run();

		$this->assertCount(0, $this->transport->requests);
	}

	private function inFlight(?string $token, EnvelopeStatus $status, ?int $nextSyncAt, ?string $fingerprint, ?int $leaseUntil = null, bool $sandbox = false): Envelope {
		$envelope = Server::get(EnvelopeDrafts::class)->create($this->owner, 'Contrato', [$this->writeFile($this->owner, 'Contrato ' . bin2hex(random_bytes(3)) . '.pdf', self::minimalPdf())->getId()]);
		$envelope->setStatus($status->value);
		$envelope->setZapsignToken($token);
		$envelope->setNextSyncAt($nextSyncAt);
		$envelope->setAccountFingerprint($fingerprint);
		$envelope->setLeaseUntil($leaseUntil);
		$envelope->setSandbox($sandbox);
		$envelope->setSentAt($this->now - 7200);
		return Server::get(EnvelopeMapper::class)->update($envelope);
	}

	private function reloaded(Envelope $envelope): Envelope {
		return Server::get(EnvelopeMapper::class)->findById($envelope->getId());
	}

	private function poller(): SyncPoller {
		$cacheFactory = $this->createMock(ICacheFactory::class);
		$cacheFactory->method('createDistributed')->willReturn(new ArrayCache(''));
		$backoff = new ProviderBackoff($cacheFactory, $this->fixedClock());
		$settings = $this->zapSignSettings();
		$events = new EnvelopeEvents(Server::get(EventMapper::class));
		$synchronizer = new EnvelopeSynchronizer(
			Server::get(EnvelopeMapper::class),
			Server::get(SignerMapper::class),
			$this->zapSignClient($settings),
			new StatusMapper(),
			new SyncSchedule(),
			new EnvelopeCompletion(Server::get(EnvelopeMapper::class), Server::get(DocumentMapper::class), $events, new SignedFileDownloader($this->transport), Server::get(SignedFileStore::class), $this->fixedClock(), new NullLogger()),
			$events,
			$this->fixedClock(),
			new NullLogger(),
		);
		return new SyncPoller(Server::get(EnvelopeMapper::class), $synchronizer, $settings, $backoff, $this->fixedClock(), new NullLogger());
	}
}
```

A note on `testStopsTheRunWhenZapSignRateLimits`: the client's backoff and the poller's backoff are separate `ArrayCache` instances in this test. The poller stops because it catches `ZapSignRateLimited` from the first sync. The shared-backoff path is covered by the Plan 1 pipeline tests.

- [ ] **Step 2: Run the test to verify it fails**

Run: `tests/env/phpunit.sh --filter SyncPollerTest`
Expected: ERROR `Class "OCA\Assinaturas\Sync\SyncPoller" not found`.

- [ ] **Step 3: Implement**

In `lib/Db/EnvelopeMapper.php`, add these public methods after `findRecent()`:
```php
	/** @return list<Envelope> in-flight envelopes of this account whose next check is due, oldest first */
	public function findDueForSync(int $now, string $accountFingerprint, int $limit): array {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->in('status', $query->createNamedParameter(
				[EnvelopeStatus::Pending->value, EnvelopeStatus::Expired->value, EnvelopeStatus::Completed->value],
				IQueryBuilder::PARAM_STR_ARRAY,
			)))
			->andWhere($query->expr()->lte('next_sync_at', $query->createNamedParameter($now, IQueryBuilder::PARAM_INT)))
			->andWhere($query->expr()->eq('account_fingerprint', $query->createNamedParameter($accountFingerprint)))
			->orderBy('next_sync_at', 'ASC')
			->setMaxResults($limit);
		return $this->findEntities($query);
	}

	/** @return list<Envelope> */
	public function findWithExpiredLease(EnvelopeStatus $status, int $now, int $limit): array {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->eq('status', $query->createNamedParameter($status->value)))
			->andWhere($query->expr()->lt('lease_until', $query->createNamedParameter($now, IQueryBuilder::PARAM_INT)))
			->setMaxResults($limit);
		return $this->findEntities($query);
	}

	/** @return list<Envelope> sandbox envelopes left behind after this instance switched account or environment */
	public function findSandboxLeftovers(string $accountFingerprint, int $limit): array {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->eq('sandbox', $query->createNamedParameter(true, IQueryBuilder::PARAM_BOOL)))
			->andWhere($query->expr()->in('status', $query->createNamedParameter(
				[EnvelopeStatus::Sending->value, EnvelopeStatus::Failed->value, EnvelopeStatus::Pending->value, EnvelopeStatus::Expired->value, EnvelopeStatus::Finalizing->value],
				IQueryBuilder::PARAM_STR_ARRAY,
			)))
			->andWhere($query->expr()->orX(
				$query->expr()->isNull('account_fingerprint'),
				$query->expr()->neq('account_fingerprint', $query->createNamedParameter($accountFingerprint)),
			))
			->setMaxResults($limit);
		return $this->findEntities($query);
	}
```

`lib/Sync/SyncPoller.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Sync;

use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use OCA\Assinaturas\ZapSign\Exception\ZapSignRateLimited;
use OCA\Assinaturas\ZapSign\ProviderBackoff;
use OCA\Assinaturas\ZapSign\ZapSignEnvironment;
use OCA\Assinaturas\ZapSign\ZapSignSettings;
use OCP\AppFramework\Utility\ITimeFactory;
use Psr\Log\LoggerInterface;

/**
 * The safety net under webhooks, which ZapSign retries only once. Every run also recovers work
 * a crashed process left behind and stops early when ZapSign asks everyone to slow down.
 */
final class SyncPoller {
	private const MAX_ENVELOPES_PER_RUN = 60;
	private const FAILED_SYNC_RETRY_SECONDS = 900;
	private const SEND_INTERRUPTED = 'send_interrupted';
	private const LEFTOVER_STATUSES = [
		EnvelopeStatus::Sending,
		EnvelopeStatus::Failed,
		EnvelopeStatus::Pending,
		EnvelopeStatus::Expired,
		EnvelopeStatus::Finalizing,
	];

	public function __construct(
		private EnvelopeMapper $envelopeMapper,
		private EnvelopeSynchronizer $synchronizer,
		private ZapSignSettings $settings,
		private ProviderBackoff $backoff,
		private ITimeFactory $timeFactory,
		private LoggerInterface $logger,
	) {
	}

	public function run(): void {
		if (!$this->settings->isConfigured()) {
			return;
		}
		$now = $this->timeFactory->getTime();
		$this->recoverExpiredLeases($now);
		$this->archiveSandboxLeftovers($now);
		foreach ($this->envelopeMapper->findDueForSync($now, $this->settings->accountFingerprint(), self::MAX_ENVELOPES_PER_RUN) as $envelope) {
			if ($this->backoff->remainingSeconds() > 0) {
				return;
			}
			try {
				$this->synchronizer->synchronize($envelope);
			} catch (ZapSignRateLimited) {
				return;
			} catch (ZapSignException $failure) {
				$this->postpone($envelope, $now);
				$this->logger->warning('Envelope sync failed; retrying later', ['envelope' => $envelope->getUuid(), 'failure' => $failure::class]);
			}
		}
	}

	private function recoverExpiredLeases(int $now): void {
		foreach ($this->envelopeMapper->findWithExpiredLease(EnvelopeStatus::Sending, $now, self::MAX_ENVELOPES_PER_RUN) as $interrupted) {
			if (!$this->envelopeMapper->transitionStatus($interrupted->getId(), [EnvelopeStatus::Sending], EnvelopeStatus::Failed, null, $now)) {
				continue;
			}
			$failed = $this->envelopeMapper->findById($interrupted->getId());
			$failed->setError(self::SEND_INTERRUPTED);
			$this->envelopeMapper->update($failed);
		}
		foreach ($this->envelopeMapper->findWithExpiredLease(EnvelopeStatus::Finalizing, $now, self::MAX_ENVELOPES_PER_RUN) as $stuck) {
			if (!$this->envelopeMapper->transitionStatus($stuck->getId(), [EnvelopeStatus::Finalizing], EnvelopeStatus::Pending, null, $now)) {
				continue;
			}
			$pending = $this->envelopeMapper->findById($stuck->getId());
			$pending->setNextSyncAt($now);
			$this->envelopeMapper->update($pending);
		}
	}

	private function archiveSandboxLeftovers(int $now): void {
		if ($this->settings->environment() !== ZapSignEnvironment::Production) {
			return;
		}
		foreach ($this->envelopeMapper->findSandboxLeftovers($this->settings->accountFingerprint(), self::MAX_ENVELOPES_PER_RUN) as $leftover) {
			$this->envelopeMapper->transitionStatus($leftover->getId(), self::LEFTOVER_STATUSES, EnvelopeStatus::ArchivedSandbox, null, $now);
		}
	}

	private function postpone(Envelope $envelope, int $now): void {
		$current = $this->envelopeMapper->findById($envelope->getId());
		$current->setNextSyncAt($now + self::FAILED_SYNC_RETRY_SECONDS);
		$this->envelopeMapper->update($current);
	}
}
```

`lib/Sync/SyncPollerJob.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Sync;

use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;

final class SyncPollerJob extends TimedJob {
	private const FIVE_MINUTES_SECONDS = 300;

	public function __construct(
		ITimeFactory $time,
		private SyncPoller $poller,
	) {
		parent::__construct($time);
		$this->setInterval(self::FIVE_MINUTES_SECONDS);
	}

	protected function run($argument): void {
		$this->poller->run();
	}
}
```

In `appinfo/info.xml`:
- change `<version>0.1.0</version>` to `<version>0.2.0</version>`;
- replace the `<background-jobs>` block with:
```xml
    <background-jobs>
        <job>OCA\Assinaturas\Sync\SyncPollerJob</job>
        <job>OCA\Assinaturas\Webhook\EnsureWebhooksJob</job>
    </background-jobs>
```

- [ ] **Step 4: Rebuild the env and run the tests**

Run: `tests/env/reset.sh && tests/env/phpunit.sh --filter SyncPollerTest`, then `tests/env/phpunit.sh`.

Expected:
- `OK (8 tests, …)`; the full suite is green.
- Also run `tests/env/php.sh occ background-job:list | grep -i assinaturas`. It lists `SyncPollerJob` and `EnsureWebhooksJob`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: poll in-flight envelopes on a tiered schedule and recover interrupted work"
```

---

### Task 15: End-to-end against the ZapSign sandbox (inline with Patrick)

This task is interactive. The controller runs it in-session with Patrick, as Plan 1 Task 9 did, and does not dispatch a subagent.

- The sandbox token is already in the local test Nextcloud from Plan 1. A `reset.sh` in Tasks 4, 13 and 14 wipes it, so **Patrick re-runs** the one `occ config:app:set … --sensitive` command from `tests/spike/README.md` in his own terminal.
- Signer inboxes: `patrick@avuz.cloud` (group 1) and `patrick.dm.rezende@gmail.com` (group 2).
- **Live webhook delivery is out of scope here.** The local test Nextcloud serves no HTTP, and delivery through Cloudflare is exactly what Plan 4 verifies on staging. Plan 2a proves the receive path with integration tests, and the poller drives this E2E.

**Files:**
- Create: `tests/e2e/lifecycle.php` (driver)
- Modify, in the avuz-server repo: `docs/superpowers/plans/2026-09-28-assinaturas-roadmap.md` (Plan 2a done) and `docs/zapsign/sandbox-findings.md` (E2E observations)

- [ ] **Step 1: Write the driver**

`tests/e2e/lifecycle.php`:
```php
<?php

declare(strict_types=1);

/**
 * Sandbox end-to-end driver for Plan 2a. Runs inside the test container:
 *   tests/env/php.sh apps/assinaturas/tests/e2e/lifecycle.php <command> [arguments...]
 * Uses the real services exactly as the API and background jobs do. It never prints tokens.
 */

use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Db\DocumentMapper;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Send\EnvelopeSender;
use OCA\Assinaturas\Send\SendJob;
use OCA\Assinaturas\Sync\EnvelopeSynchronizer;
use OCA\Assinaturas\Sync\SyncPoller;
use OCP\BackgroundJob\IJobList;
use OCP\Files\IRootFolder;
use OCP\IGroupManager;
use OCP\IUserManager;
use OCP\Server;

require_once '/var/www/html/lib/base.php';

const E2E_USER = 'assinaturas-e2e';
const E2E_FOLDER = 'E2E';
const SPIKE_PDFS = __DIR__ . '/../spike/output/pdfs';

function printJson(mixed $value): void {
	fwrite(STDOUT, json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL);
}

/** @param list<string> $arguments */
function requireArguments(array $arguments, int $count, string $usage): array {
	if (count($arguments) < $count) {
		fwrite(STDERR, 'Usage: lifecycle.php ' . $usage . PHP_EOL);
		exit(2);
	}
	return array_slice($arguments, 0, $count);
}

function ensureUser(): void {
	$userManager = Server::get(IUserManager::class);
	$user = $userManager->get(E2E_USER) ?? $userManager->createUser(E2E_USER, 'Assinaturas-' . bin2hex(random_bytes(12)) . '!Aa1');
	$user->setDisplayName('Maria Souza');
	$groupManager = Server::get(IGroupManager::class);
	$group = $groupManager->get(SignersGroup::GROUP_ID) ?? $groupManager->createGroup(SignersGroup::GROUP_ID);
	$group->addUser($user);
}

function envelopeReport(string $uuid): array {
	$envelope = Server::get(EnvelopeMapper::class)->findByUuid($uuid);
	return [
		'uuid' => $envelope->getUuid(),
		'status' => $envelope->getStatus(),
		'sendStep' => $envelope->getSendStep(),
		'error' => $envelope->getError(),
		'nextSyncAt' => $envelope->getNextSyncAt(),
		'signers' => array_map(fn ($signer): array => ['name' => $signer->getName(), 'status' => $signer->getStatus(), 'releasedAt' => $signer->getReleasedAt(), 'signedAt' => $signer->getSignedAt()], Server::get(SignerMapper::class)->findByEnvelope($envelope->getId())),
		'documents' => array_map(fn ($document): array => ['path' => $document->getSourcePath(), 'saveStatus' => $document->getSaveStatus(), 'signedFileId' => $document->getSignedFileId()], Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId())),
	];
}

/** @param list<string> $arguments */
function setup(array $arguments): void {
	[$firstEmail, $secondEmail] = requireArguments($arguments, 2, 'setup <firstSignerEmail> <secondSignerEmail>');
	ensureUser();
	$userFolder = Server::get(IRootFolder::class)->getUserFolder(E2E_USER);
	if (!$userFolder->nodeExists(E2E_FOLDER)) {
		$userFolder->newFolder(E2E_FOLDER);
	}
	$stamp = gmdate('His');
	$contract = $userFolder->newFile(E2E_FOLDER . '/Contrato ' . $stamp . '.pdf', (string)file_get_contents(SPIKE_PDFS . '/portrait.pdf'));
	$annex = $userFolder->newFile(E2E_FOLDER . '/Anexo ' . $stamp . '.pdf', (string)file_get_contents(SPIKE_PDFS . '/mixed-pages.pdf'));
	$drafts = Server::get(EnvelopeDrafts::class);
	$envelope = $drafts->create(E2E_USER, 'E2E Plan 2a ' . $stamp, [$contract->getId(), $annex->getId()]);
	$envelope = $drafts->updateSettings($envelope, 'E2E Plan 2a ' . $stamp, true, null, 1, 'Teste ponta a ponta do Plano 2a.');
	$signers = $drafts->replaceSigners($envelope, [
		['name' => 'Signatário Um', 'email' => $firstEmail, 'orderGroup' => 1],
		['name' => 'Signatário Dois', 'email' => $secondEmail, 'orderGroup' => 2],
	]);
	[$main, $extra] = Server::get(DocumentMapper::class)->findByEnvelope($envelope->getId());
	$portrait = ['width' => 595.28, 'height' => 841.89, 'rotation' => 0];
	$landscape = ['width' => 841.89, 'height' => 595.28, 'rotation' => 0];
	$drafts->replaceFields($envelope, $main->getId(), [$portrait], [
		['signerId' => $signers[0]->getId(), 'type' => 'signature', 'page' => 0, 'x' => 0.08, 'y' => 0.70, 'width' => 0.20, 'height' => 0.09],
		['signerId' => $signers[1]->getId(), 'type' => 'signature', 'page' => 0, 'x' => 0.08, 'y' => 0.82, 'width' => 0.20, 'height' => 0.09],
	]);
	$drafts->replaceFields($envelope, $extra->getId(), [$portrait, $landscape, $portrait], [
		['signerId' => $signers[0]->getId(), 'type' => 'initials', 'page' => 1, 'x' => 0.80, 'y' => 0.80, 'width' => 0.14, 'height' => 0.09],
	]);
	printJson(['uuid' => $envelope->getUuid()]);
}

/** @param list<string> $arguments */
function send(array $arguments): void {
	[$uuid] = requireArguments($arguments, 1, 'send <uuid>');
	$envelope = Server::get(EnvelopeMapper::class)->findByUuid($uuid);
	$sender = Server::get(EnvelopeSender::class);
	$sender->claim($envelope);
	Server::get(IJobList::class)->remove(SendJob::class, ['envelopeId' => $envelope->getId()]);
	$sender->send($envelope->getId());
	printJson(envelopeReport($uuid));
}

/** @param list<string> $arguments */
function status(array $arguments): void {
	[$uuid] = requireArguments($arguments, 1, 'status <uuid>');
	printJson(envelopeReport($uuid));
}

/** @param list<string> $arguments */
function sync(array $arguments): void {
	[$uuid] = requireArguments($arguments, 1, 'sync <uuid>');
	Server::get(EnvelopeSynchronizer::class)->synchronizeById(Server::get(EnvelopeMapper::class)->findByUuid($uuid)->getId());
	printJson(envelopeReport($uuid));
}

function poll(): void {
	Server::get(SyncPoller::class)->run();
	printJson(['polled' => true]);
}

function files(): void {
	$folder = Server::get(IRootFolder::class)->getUserFolder(E2E_USER)->get(E2E_FOLDER);
	printJson(array_map(fn ($node): array => ['name' => $node->getName(), 'size' => $node->getSize()], $folder->getDirectoryListing()));
}

$commands = [
	'setup' => setup(...),
	'send' => send(...),
	'status' => status(...),
	'sync' => sync(...),
	'poll' => fn (array $arguments) => poll(),
	'files' => fn (array $arguments) => files(),
];
$arguments = array_slice($argv, 1);
$command = array_shift($arguments) ?? '';
if (!isset($commands[$command])) {
	fwrite(STDERR, 'Commands: setup <email1> <email2> | send <uuid> | status <uuid> | sync <uuid> | poll | files' . PHP_EOL);
	exit(2);
}
$commands[$command]($arguments);
```

Lint it and commit:
```bash
tests/env/php.sh -l apps/assinaturas/tests/e2e/lifecycle.php
git add tests/e2e/lifecycle.php && git commit -m "test: add the Plan 2a sandbox end-to-end driver"
```

- [ ] **Step 2: Prepare**

1. Ask Patrick to re-run the sandbox token command from `tests/spike/README.md` in his terminal.
2. Then run:
   ```bash
   tests/env/php.sh occ config:app:set assinaturas environment --value=sandbox --type=string
   tests/env/php.sh occ config:app:set assinaturas company_name --value="Avuz Spike" --type=string
   tests/env/php.sh apps/assinaturas/tests/spike/make-fixtures.php
   ```

- [ ] **Step 3: Run the lifecycle**

```bash
tests/env/php.sh apps/assinaturas/tests/e2e/lifecycle.php setup patrick@avuz.cloud patrick.dm.rezende@gmail.com
tests/env/php.sh apps/assinaturas/tests/e2e/lifecycle.php send <uuid>
```
Expected: `status` is `pending`, `sendStep` is 4, and signer 1 has `releasedAt` set while signer 2 has `null`.

Then, with Patrick:
1. He confirms **only patrick@avuz.cloud** got the email.
2. He notes whether the sender line shows up (finding Q6).
3. He signs as signer 1.
4. Run `sync <uuid>`. Expected: signer 1 is `signed`, and the envelope stays `pending`.
5. He confirms patrick.dm.rezende@gmail.com got its email automatically, then signs as signer 2.
6. Run `sync <uuid>`. If `saveStatus` is still `pending` because ZapSign is still generating the PDF, wait a minute and run `sync <uuid>` again.
   Expected: the envelope is `completed` and both documents are `saved`.
7. Run `files`. Expected: `Contrato … (assinado).pdf` and `Anexo … (assinado).pdf` are listed next to the originals.
8. Run `poll`. Expected: `{"polled": true}` and no errors in `tests/env/php.sh occ log:tail` (or `nextcloud.log`).

- [ ] **Step 4: Record the outcome**

In the avuz-server worktree, update `docs/superpowers/plans/2026-09-28-assinaturas-roadmap.md`:
- set the Plan 2a row's status to **Done**, with the date, the app repo head SHA and the test count;
- add the E2E observations (sender line in the first email — Q6; auto-email of group 2; signed-file readiness delay) to `docs/zapsign/sandbox-findings.md`.

```bash
git add docs/superpowers/plans/2026-09-28-assinaturas-roadmap.md docs/zapsign/sandbox-findings.md
git commit -m "docs: mark Assinaturas Plan 2a done and record its sandbox E2E findings"
```

- [ ] **Step 5: Final verification**

Run: `cd ~/work/avuz/assinaturas && tests/env/phpunit.sh`
Expected: the full suite is green.

Then run the whole-branch review and report the Plan 2a result to Patrick.
