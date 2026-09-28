# Assinaturas Plan 1: Foundation and Sandbox Spikes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `assinaturas` Nextcloud app repo with a local test harness, the full database schema, and a fully tested `ZapSignClient`. Then run the sandbox spikes that settle the mechanics the spec left open.

**Architecture:**
- A native Nextcloud 33 app lives in its own repo (`~/work/avuz/assinaturas`, remote `avuz-conecta/assinaturas`).
- Only `lib/ZapSign/**` speaks ZapSign.
- HTTP goes through a small `HttpTransport` interface, so tests use a fake instead of the network.
- Tests run PHPUnit inside the real `avuzconecta:latest` image against Postgres, the same harness pattern as the deck fork.
- Spikes use a CLI runner against the ZapSign sandbox, with webhooks captured through a Cloudflare quick tunnel.

**Tech Stack:** PHP 8.3, Nextcloud 33 OCP (`QBMapper`, `Entity`, `IClientService`, `IAppConfig`, `ICacheFactory`), PHPUnit 9.6, Docker, Postgres 16, Redis 7, `cloudflare/cloudflared`.

**Roadmap:** [`2026-09-28-assinaturas-roadmap.md`](2026-09-28-assinaturas-roadmap.md). **Spec:** [`../specs/2026-09-28-assinaturas-zapsign-design.md`](../specs/2026-09-28-assinaturas-zapsign-design.md). **API digest:** [`../../zapsign/api-digest.md`](../../zapsign/api-digest.md).

## Global Constraints

**App identity and platform**
- App id `assinaturas`; PHP namespace `OCA\Assinaturas`; `info.xml` requires PHP `8.3` and Nextcloud min `33`, max `34`.
- App repo path: `~/work/avuz/assinaturas`; branch `main`.

**Code style**
- Every PHP file starts with `declare(strict_types=1);`. Classes are `final` unless a test double must extend them. DTOs use `public readonly` constructor properties.
- Coding style, from the user's CLAUDE.md:
  - no abbreviations; descriptive names;
  - early returns, flat code;
  - hash-list constants instead of `switch`;
  - `SNAKE_CAPS` constants;
  - no comments that a name could replace.
- PHP files follow PSR-4 (`ClassName.php`); the kebab-case file rule applies to non-PHP files.

**ZapSign API rules**
- **Never send `null` to ZapSign.** Omit the key or send `""`.
- Each signer gets `send_automatic_email: false`. **Never** send doc-level `disable_signer_emails`.
- **Never auto-retry** `createDocument`, `uploadExtraDocument`, `releaseSigner`, `removeSigner`, `cancelDocument` or `registerWebhook`. A 5xx or transport failure on these means **outcome unknown**, so throw `ZapSignUnreachable`.
- **Never log** the API token, signer tokens or `sign_url`. Log endpoint *templates* such as `POST /signers/{signer}/`, never URLs.

**Environments and credentials**
- The sandbox token is read only from the shell env var `ZAPSIGN_SANDBOX_TOKEN`. Never print or commit it.
- Plan 1 never touches staging or production. It runs only on the local Docker env and the ZapSign **sandbox**.

**Tests and commits**
- Tests exercise behavior. Method names are `test` + third-person verb (`testRejectsADuplicateUuid`).
- Unit tests extend `PHPUnit\Framework\TestCase`. Database tests extend `Test\TestCase` with `@group DB`.
- Commit messages carry **no** Claude/AI attribution (user rule).

---

## File Structure

```
~/work/avuz/assinaturas/
├── appinfo/info.xml
├── composer.json
├── .gitignore
├── lib/
│   ├── AppInfo/Application.php                  # DI aliases (HttpTransport, Sleeper)
│   ├── Migration/Version000100Date20260928000000.php
│   ├── Db/
│   │   ├── EnvelopeStatus.php                    # enum of lifecycle states
│   │   ├── Envelope.php  EnvelopeMapper.php      # + atomic transitionStatus()
│   │   ├── Document.php  DocumentMapper.php
│   │   ├── Signer.php    SignerMapper.php
│   │   ├── Field.php     FieldMapper.php
│   │   └── Event.php     EventMapper.php         # + insertIfNew() dedupe
│   └── ZapSign/
│       ├── ZapSignEnvironment.php  ZapSignSettings.php
│       ├── Http/HttpTransport.php  HttpRequest.php  HttpResponse.php
│       │        TransportFailure.php  NextcloudHttpTransport.php
│       ├── CallMonitor.php         # monitoring higher-order wrapper
│       ├── ProviderBackoff.php     # shared 429 pause (distributed cache)
│       ├── Sleeper.php  SystemSleeper.php
│       ├── ProviderError.php  PayloadReader.php  ZapSignDateFormat.php
│       ├── Exception/ZapSignException.php + 7 subclasses
│       ├── Payload/NewDocument.php  NewSigner.php  Branding.php
│       │           FieldPlacement.php  SignatureBox.php
│       ├── Model/ZapSignDocument.php  ZapSignSigner.php  ZapSignExtraDocument.php
│       │         ZapSignDocumentPage.php  PlanInfo.php  ActivityLogPdf.php
│       ├── PlacementConverter.php
│       └── ZapSignClient.php
└── tests/
    ├── bootstrap.php  phpunit.xml
    ├── env/php.sh  reset.sh  phpunit.sh
    ├── Fakes/FakeHttpTransport.php  RecordingSleeper.php  RecordingLogger.php
    ├── fixtures/zapsign/*.json
    ├── Unit/ZapSign/…Test.php
    ├── Integration/{AppInfo,Db,ZapSign}/…Test.php
    └── spike/make-fixtures.php  webhook-capture.php  run.php  README.md
```

Findings are recorded in the **avuz-server** repo at `docs/zapsign/sandbox-findings.md`, next to the digest.

---

### Task 1: Repo scaffold and local test harness

**Files:**
- Create: `~/work/avuz/assinaturas/appinfo/info.xml`
- Create: `~/work/avuz/assinaturas/lib/AppInfo/Application.php`
- Create: `~/work/avuz/assinaturas/composer.json`
- Create: `~/work/avuz/assinaturas/.gitignore`
- Create: `~/work/avuz/assinaturas/tests/bootstrap.php`
- Create: `~/work/avuz/assinaturas/tests/phpunit.xml`
- Create: `~/work/avuz/assinaturas/tests/env/php.sh`
- Create: `~/work/avuz/assinaturas/tests/env/reset.sh`
- Create: `~/work/avuz/assinaturas/tests/env/phpunit.sh`
- Test: `~/work/avuz/assinaturas/tests/Integration/AppInfo/ApplicationTest.php`

**Interfaces:**
- Produces:
  - `OCA\Assinaturas\AppInfo\Application::APP_ID = 'assinaturas'`.
  - `tests/env/php.sh <args>` runs `php <args>` in `/var/www/html` of the test container.
  - `tests/env/phpunit.sh [phpunit args]` runs the suite.
  - `tests/env/reset.sh` rebuilds the env.

- [ ] **Step 1: Check prerequisites**

Run:
```bash
docker image inspect avuzconecta:latest --format '{{.Architecture}}' && ls ~/work/avuz/avuz-server/tests/bootstrap.php
```
Expected: prints `arm64` (or `amd64`) and the bootstrap path.

If the image is missing, build it from the golden checkout:
```bash
cd ~/work/avuz/avuz-server && ./scripts/build-push.sh latest local
```

- [ ] **Step 2: Create the repo and app metadata**

```bash
mkdir -p ~/work/avuz/assinaturas && cd ~/work/avuz/assinaturas && git init -b main
```

`appinfo/info.xml`:
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
</info>
```

`lib/AppInfo/Application.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\AppInfo;

use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;

final class Application extends App implements IBootstrap {
	public const APP_ID = 'assinaturas';

	public function __construct(array $urlParams = []) {
		parent::__construct(self::APP_ID, $urlParams);
	}

	public function register(IRegistrationContext $context): void {
	}

	public function boot(IBootContext $context): void {
	}
}
```

`composer.json`:
```json
{
	"name": "avuz-conecta/assinaturas",
	"description": "ZapSign e-signature app for AvuzConecta",
	"license": "AGPL-3.0-or-later",
	"require": {
		"php": ">=8.3"
	},
	"require-dev": {
		"phpunit/phpunit": "^9.6",
		"nextcloud/ocp": "dev-stable33"
	},
	"autoload": {
		"psr-4": {
			"OCA\\Assinaturas\\": "lib/"
		}
	},
	"autoload-dev": {
		"psr-4": {
			"OCA\\Assinaturas\\Tests\\": "tests/"
		}
	},
	"config": {
		"optimize-autoloader": true,
		"platform": {
			"php": "8.3"
		}
	},
	"scripts": {
		"lint": "find . -name \\*.php -not -path './vendor/*' -print0 | xargs -0 -n1 php -l"
	}
}
```

`.gitignore`:
```
/vendor/
/node_modules/
/tests/spike/output/
/.phpunit.result.cache
```

- [ ] **Step 3: Write the test harness scripts**

`tests/env/php.sh`:
```bash
#!/usr/bin/env bash
# Runs `php <args>` inside a throwaway avuzconecta:latest container wired to the
# local Assinaturas test env (Postgres + Redis + config/data volumes), with this
# checkout mounted as apps/assinaturas. LOCAL ONLY.
set -euo pipefail

IMAGE="${ASSINATURAS_TEST_IMAGE:-avuzconecta:latest}"
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

exec docker run --rm -i --network assinaturas-test-net -u www-data \
	-v assinaturas-test-config:/var/www/html/config \
	-v assinaturas-test-data:/var/www/html/data \
	-v "$APP_DIR:/var/www/html/apps/assinaturas" \
	--tmpfs /var/www/html/apps/assinaturas/vendor/nextcloud/ocp \
	-w /var/www/html --entrypoint php "$IMAGE" "$@"
```

`tests/env/reset.sh`:
```bash
#!/usr/bin/env bash
# Rebuilds the throwaway local test env for the Assinaturas app from scratch:
# Postgres + Redis on a private network, fresh Nextcloud install on
# avuzconecta:latest, app enabled from this checkout. LOCAL ONLY.
# The --tmpfs mask (in php.sh) hides the dev vendor/nextcloud/ocp snapshot so the
# image's own OCP wins (same fix as the deck fork harness).
set -euo pipefail

IMAGE="${ASSINATURAS_TEST_IMAGE:-avuzconecta:latest}"
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
NETWORK="assinaturas-test-net"
DB_CONTAINER="assinaturas-test-db"
REDIS_CONTAINER="assinaturas-test-redis"
CONFIG_VOLUME="assinaturas-test-config"
DATA_VOLUME="assinaturas-test-data"
IMAGE_STAMP="$HOME/.assinaturas-test-image-id"
PHP="$APP_DIR/tests/env/php.sh"

docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null
docker container inspect "$DB_CONTAINER" >/dev/null 2>&1 || docker run -d --name "$DB_CONTAINER" \
	--network "$NETWORK" -e POSTGRES_USER=assinaturas -e POSTGRES_PASSWORD=assinaturas \
	-e POSTGRES_DB=postgres postgres:16-alpine >/dev/null
docker container inspect "$REDIS_CONTAINER" >/dev/null 2>&1 || docker run -d --name "$REDIS_CONTAINER" \
	--network "$NETWORK" redis:7-alpine >/dev/null
docker start "$DB_CONTAINER" "$REDIS_CONTAINER" >/dev/null

echo "[reset] waiting for postgres"
until docker exec "$DB_CONTAINER" pg_isready -U assinaturas >/dev/null 2>&1; do sleep 1; done

echo "[reset] dropping + recreating database"
docker exec "$DB_CONTAINER" psql -U assinaturas -d postgres -v ON_ERROR_STOP=1 -q \
	-c 'DROP DATABASE IF EXISTS assinaturas WITH (FORCE)' \
	-c 'DROP ROLE IF EXISTS oc_admin' \
	-c 'CREATE DATABASE assinaturas OWNER assinaturas'

echo "[reset] recreating volumes"
docker volume rm -f "$CONFIG_VOLUME" "$DATA_VOLUME" >/dev/null
docker volume create "$CONFIG_VOLUME" >/dev/null
docker volume create "$DATA_VOLUME" >/dev/null
docker run --rm -u root -v "$CONFIG_VOLUME:/config" -v "$DATA_VOLUME:/data" --entrypoint sh "$IMAGE" \
	-c 'chown -R www-data:www-data /config /data'

docker exec "$REDIS_CONTAINER" redis-cli FLUSHALL >/dev/null

echo "[reset] installing nextcloud"
"$PHP" occ maintenance:install --no-interaction \
	--database pgsql --database-host "$DB_CONTAINER" --database-name assinaturas \
	--database-user assinaturas --database-pass assinaturas \
	--admin-user admin --admin-pass admin
"$PHP" occ config:system:set redis host --value "$REDIS_CONTAINER"
"$PHP" occ config:system:set redis port --value 6379 --type integer
"$PHP" occ config:system:set memcache.local --value '\OC\Memcache\Redis'
"$PHP" occ config:system:set memcache.locking --value '\OC\Memcache\Redis'
"$PHP" occ config:system:set memcache.distributed --value '\OC\Memcache\Redis'

echo "[reset] enabling assinaturas"
"$PHP" occ app:enable assinaturas

docker image inspect "$IMAGE" --format '{{.Id}}' > "$IMAGE_STAMP"
echo "[reset] done"
```

`tests/env/phpunit.sh`:
```bash
#!/usr/bin/env bash
# Runs the PHPUnit suite inside avuzconecta:latest against the local test env.
# Rebuilds the env automatically when the image changes.
set -euo pipefail

IMAGE="${ASSINATURAS_TEST_IMAGE:-avuzconecta:latest}"
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
AVUZ_SERVER_DIR="${AVUZ_SERVER_DIR:-$HOME/work/avuz/avuz-server}"
IMAGE_STAMP="$HOME/.assinaturas-test-image-id"

if [ "$(cat "$IMAGE_STAMP" 2>/dev/null)" != "$(docker image inspect "$IMAGE" --format '{{.Id}}')" ]; then
	echo "[phpunit] image changed -> rebuilding test env" >&2
	"$APP_DIR/tests/env/reset.sh" >&2
fi

exec docker run --rm --network assinaturas-test-net -u www-data \
	-v assinaturas-test-config:/var/www/html/config \
	-v assinaturas-test-data:/var/www/html/data \
	-v "$AVUZ_SERVER_DIR/tests:/var/www/html/tests:ro" \
	-v "$APP_DIR:/var/www/html/apps/assinaturas" \
	--tmpfs /var/www/html/apps/assinaturas/vendor/nextcloud/ocp \
	-w /var/www/html/apps/assinaturas \
	--entrypoint php "$IMAGE" \
	vendor/bin/phpunit -c tests/phpunit.xml "$@"
```

`tests/bootstrap.php`:
```php
<?php

declare(strict_types=1);

require_once __DIR__ . '/../../../tests/bootstrap.php';
require_once __DIR__ . '/../vendor/autoload.php';

\OC_App::loadApp('assinaturas');
```

`tests/phpunit.xml`:
```xml
<?xml version="1.0"?>
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="https://schema.phpunit.de/9.6/phpunit.xsd"
         bootstrap="bootstrap.php"
         colors="true"
         convertDeprecationsToExceptions="true">
	<testsuites>
		<testsuite name="assinaturas">
			<directory suffix="Test.php">./Unit</directory>
			<directory suffix="Test.php">./Integration</directory>
		</testsuite>
	</testsuites>
</phpunit>
```

```bash
chmod +x tests/env/*.sh
docker run --rm -v "$PWD":/app -w /app composer:2 install --no-interaction
```
Expected: `Generating optimized autoload files`, and `vendor/bin/phpunit` exists.

- [ ] **Step 4: Write the failing smoke test**

`tests/Integration/AppInfo/ApplicationTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\AppInfo;

use OCA\Assinaturas\AppInfo\Application;
use OCP\App\IAppManager;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class ApplicationTest extends TestCase {
	public function testRegistersUnderTheAssinaturasAppId(): void {
		$this->assertSame('assinaturas', (new Application())->getContainer()->getAppName());
	}

	public function testIsEnabledInTheTestInstance(): void {
		$this->assertTrue(Server::get(IAppManager::class)->isEnabledForAnyone(Application::APP_ID));
	}
}
```

- [ ] **Step 5: Build the env and run the tests**

Run: `tests/env/reset.sh && tests/env/phpunit.sh`
Expected: reset ends with `[reset] done`; PHPUnit reports `OK (2 tests, 2 assertions)`.

If `app:enable` fails, fix `info.xml` first: the XML must be valid, and PHP 8.3 and NC 33 must fall inside the declared range.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold assinaturas app and local test harness"
```

- [ ] **Step 7: Create the GitHub remote (ask Patrick first)**

Creating a repo in the `avuz-conecta` org is Patrick's call. Ask him in chat before running:
```bash
gh repo create avuz-conecta/assinaturas --private --source . --remote origin --push
```
Expected: `✓ Created repository avuz-conecta/assinaturas` and the `main` branch pushed.

---

### Task 2: Database schema, entities and mappers

**Files:**
- Create: `lib/Migration/Version000100Date20260928000000.php`
- Create: `lib/Db/EnvelopeStatus.php`
- Create: `lib/Db/Envelope.php`, `lib/Db/EnvelopeMapper.php`
- Create: `lib/Db/Document.php`, `lib/Db/DocumentMapper.php`
- Create: `lib/Db/Signer.php`, `lib/Db/SignerMapper.php`
- Create: `lib/Db/Field.php`, `lib/Db/FieldMapper.php`
- Create: `lib/Db/Event.php`, `lib/Db/EventMapper.php`
- Test: `tests/Integration/Db/EnvelopeMapperTest.php`
- Test: `tests/Integration/Db/DocumentMapperTest.php`
- Test: `tests/Integration/Db/SignerMapperTest.php`
- Test: `tests/Integration/Db/FieldMapperTest.php`
- Test: `tests/Integration/Db/EventMapperTest.php`

**Interfaces:**
- Produces:
  - `enum EnvelopeStatus: string` with cases `Draft='draft'`, `Sending='sending'`, `Failed='failed'`, `Pending='pending'`, `Finalizing='finalizing'`, `Completed='completed'`, `Refused='refused'`, `Expired='expired'`, `Cancelled='cancelled'`, `ArchivedSandbox='archived_sandbox'`.
  - Entities `Envelope`, `Document`, `Signer`, `Field`, `Event`, with the getters and setters in their `@method` blocks. Timestamps are `int` epoch seconds. `Envelope::statusValue(): EnvelopeStatus`.
  - `EnvelopeMapper::findById(int): Envelope`, `findByUuid(string): Envelope`, `findByZapsignToken(string): Envelope`. All throw `OCP\AppFramework\Db\DoesNotExistException`.
  - `EnvelopeMapper::transitionStatus(int $envelopeId, list<EnvelopeStatus> $fromStatuses, EnvelopeStatus $toStatus, ?int $leaseUntil, int $now): bool`. Returns true only if this call changed the row.
  - `DocumentMapper::findByEnvelope(int): list<Document>` (by position) and `findByZapsignToken(string): Document`.
  - `SignerMapper::findByEnvelope(int): list<Signer>` (by order_group, id) and `findByZapsignToken(string): Signer`.
  - `FieldMapper::findByDocument(int): list<Field>`.
  - `EventMapper::findByEnvelope(int): list<Event>` (by occurred_at, id) and `insertIfNew(Event): bool`. Returns false on a duplicate `dedupe_key`.

- [ ] **Step 1: Write the failing mapper tests**

`tests/Integration/Db/EnvelopeMapperTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Db;

use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCP\DB\Exception;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class EnvelopeMapperTest extends TestCase {
	private const NOW = 1_790_000_000;

	private EnvelopeMapper $mapper;
	/** @var list<Envelope> */
	private array $created = [];

	protected function setUp(): void {
		parent::setUp();
		$this->mapper = Server::get(EnvelopeMapper::class);
	}

	protected function tearDown(): void {
		foreach ($this->created as $envelope) {
			$this->mapper->delete($envelope);
		}
		$this->created = [];
		parent::tearDown();
	}

	public function testFindsAnEnvelopeByUuidWithTypedFields(): void {
		$envelope = $this->persistEnvelope(self::randomUuid());

		$found = $this->mapper->findByUuid($envelope->getUuid());

		$this->assertSame($envelope->getId(), $found->getId());
		$this->assertSame('maria', $found->getOwnerUid());
		$this->assertTrue($found->getSigningOrder());
		$this->assertSame(EnvelopeStatus::Draft, $found->statusValue());
		$this->assertSame(0, $found->getSendStep());
		$this->assertNull($found->getZapsignToken());
		$this->assertSame(self::NOW, $found->getCreatedAt());
	}

	public function testFindsAnEnvelopeByZapsignToken(): void {
		$envelope = $this->persistEnvelope(self::randomUuid());
		$envelope->setZapsignToken('doc-' . $envelope->getUuid());
		$this->mapper->update($envelope);

		$found = $this->mapper->findByZapsignToken('doc-' . $envelope->getUuid());

		$this->assertSame($envelope->getId(), $found->getId());
	}

	public function testClaimsTheTransitionWhenTheCurrentStatusMatches(): void {
		$envelope = $this->persistEnvelope(self::randomUuid());

		$claimed = $this->mapper->transitionStatus(
			$envelope->getId(),
			[EnvelopeStatus::Draft, EnvelopeStatus::Failed],
			EnvelopeStatus::Sending,
			self::NOW + 600,
			self::NOW + 1,
		);

		$this->assertTrue($claimed);
		$reloaded = $this->mapper->findById($envelope->getId());
		$this->assertSame(EnvelopeStatus::Sending, $reloaded->statusValue());
		$this->assertSame(self::NOW + 600, $reloaded->getLeaseUntil());
		$this->assertSame(self::NOW + 1, $reloaded->getUpdatedAt());
	}

	public function testRefusesASecondClaimOfTheSameTransition(): void {
		$envelope = $this->persistEnvelope(self::randomUuid());
		$fromStatuses = [EnvelopeStatus::Draft, EnvelopeStatus::Failed];

		$first = $this->mapper->transitionStatus($envelope->getId(), $fromStatuses, EnvelopeStatus::Sending, null, self::NOW + 1);
		$second = $this->mapper->transitionStatus($envelope->getId(), $fromStatuses, EnvelopeStatus::Sending, null, self::NOW + 2);

		$this->assertTrue($first);
		$this->assertFalse($second);
	}

	public function testClearsTheLeaseWhenTransitioningWithoutOne(): void {
		$envelope = $this->persistEnvelope(self::randomUuid());
		$this->mapper->transitionStatus($envelope->getId(), [EnvelopeStatus::Draft], EnvelopeStatus::Sending, self::NOW + 600, self::NOW + 1);

		$this->mapper->transitionStatus($envelope->getId(), [EnvelopeStatus::Sending], EnvelopeStatus::Pending, null, self::NOW + 2);

		$this->assertNull($this->mapper->findById($envelope->getId())->getLeaseUntil());
	}

	public function testRejectsADuplicateUuid(): void {
		$envelope = $this->persistEnvelope(self::randomUuid());

		$this->expectException(Exception::class);
		$this->persistEnvelope($envelope->getUuid());
	}

	private function persistEnvelope(string $uuid): Envelope {
		$envelope = new Envelope();
		$envelope->setUuid($uuid);
		$envelope->setOwnerUid('maria');
		$envelope->setTitle('Contrato de prestação de serviços');
		$envelope->setSigningOrder(true);
		$envelope->setCreatedAt(self::NOW);
		$envelope->setUpdatedAt(self::NOW);
		$inserted = $this->mapper->insert($envelope);
		$this->created[] = $inserted;
		return $inserted;
	}

	private static function randomUuid(): string {
		return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex(random_bytes(16)), 4));
	}
}
```

`tests/Integration/Db/DocumentMapperTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Db;

use OCA\Assinaturas\Db\Document;
use OCA\Assinaturas\Db\DocumentMapper;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class DocumentMapperTest extends TestCase {
	private DocumentMapper $mapper;
	/** @var list<Document> */
	private array $created = [];

	protected function setUp(): void {
		parent::setUp();
		$this->mapper = Server::get(DocumentMapper::class);
	}

	protected function tearDown(): void {
		foreach ($this->created as $document) {
			$this->mapper->delete($document);
		}
		$this->created = [];
		parent::tearDown();
	}

	public function testReturnsAnEnvelopesDocumentsInPositionOrder(): void {
		$envelopeId = random_int(1_000_000, 9_000_000);
		$this->persistDocument($envelopeId, 1, 'Anexo I.pdf');
		$this->persistDocument($envelopeId, 0, 'Contrato.pdf');

		$documents = $this->mapper->findByEnvelope($envelopeId);

		$this->assertSame(['/Contrato.pdf', '/Anexo I.pdf'], array_map(fn (Document $document): string => $document->getSourcePath(), $documents));
	}

	public function testRoundTripsPageGeometryAsAnArray(): void {
		$pages = [
			['width' => 595.28, 'height' => 841.89, 'rotation' => 0],
			['width' => 841.89, 'height' => 595.28, 'rotation' => 90],
		];
		$document = $this->persistDocument(random_int(1_000_000, 9_000_000), 0, 'Contrato.pdf', $pages);

		$found = $this->mapper->findByEnvelope($document->getEnvelopeId())[0];

		$this->assertSame($pages, $found->getPages());
		$this->assertSame(2, $found->getPageCount());
		$this->assertSame('pending', $found->getSaveStatus());
	}

	public function testFindsADocumentByZapsignToken(): void {
		$document = $this->persistDocument(random_int(1_000_000, 9_000_000), 0, 'Contrato.pdf');
		$token = 'doc-' . bin2hex(random_bytes(8));
		$document->setZapsignToken($token);
		$this->mapper->update($document);

		$this->assertSame($document->getId(), $this->mapper->findByZapsignToken($token)->getId());
	}

	/** @param list<array{width: float, height: float, rotation: int}> $pages */
	private function persistDocument(int $envelopeId, int $position, string $fileName, array $pages = []): Document {
		$document = new Document();
		$document->setEnvelopeId($envelopeId);
		$document->setPosition($position);
		$document->setSourceFileId(random_int(1, 999_999));
		$document->setSourcePath('/' . $fileName);
		$document->setPageCount(count($pages));
		$document->setPages($pages);
		$inserted = $this->mapper->insert($document);
		$this->created[] = $inserted;
		return $inserted;
	}
}
```

`tests/Integration/Db/SignerMapperTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Db;

use OCA\Assinaturas\Db\Signer;
use OCA\Assinaturas\Db\SignerMapper;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class SignerMapperTest extends TestCase {
	private SignerMapper $mapper;
	/** @var list<Signer> */
	private array $created = [];

	protected function setUp(): void {
		parent::setUp();
		$this->mapper = Server::get(SignerMapper::class);
	}

	protected function tearDown(): void {
		foreach ($this->created as $signer) {
			$this->mapper->delete($signer);
		}
		$this->created = [];
		parent::tearDown();
	}

	public function testReturnsAnEnvelopesSignersInSigningOrder(): void {
		$envelopeId = random_int(1_000_000, 9_000_000);
		$this->persistSigner($envelopeId, 'Bruno Souza', 2);
		$this->persistSigner($envelopeId, 'Ana Lima', 1);

		$signers = $this->mapper->findByEnvelope($envelopeId);

		$this->assertSame(['Ana Lima', 'Bruno Souza'], array_map(fn (Signer $signer): string => $signer->getName(), $signers));
		$this->assertSame('pending', $signers[0]->getStatus());
		$this->assertNull($signers[0]->getSignedAt());
	}

	public function testFindsASignerByZapsignToken(): void {
		$signer = $this->persistSigner(random_int(1_000_000, 9_000_000), 'Ana Lima', 1);
		$token = 'signer-' . bin2hex(random_bytes(8));
		$signer->setZapsignToken($token);
		$this->mapper->update($signer);

		$this->assertSame($signer->getId(), $this->mapper->findByZapsignToken($token)->getId());
	}

	private function persistSigner(int $envelopeId, string $name, int $orderGroup): Signer {
		$signer = new Signer();
		$signer->setEnvelopeId($envelopeId);
		$signer->setName($name);
		$signer->setEmail(strtolower(str_replace(' ', '.', $name)) . '@example.com');
		$signer->setOrderGroup($orderGroup);
		$signer->setColor($orderGroup);
		$inserted = $this->mapper->insert($signer);
		$this->created[] = $inserted;
		return $inserted;
	}
}
```

`tests/Integration/Db/FieldMapperTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Db;

use OCA\Assinaturas\Db\Field;
use OCA\Assinaturas\Db\FieldMapper;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class FieldMapperTest extends TestCase {
	private FieldMapper $mapper;
	/** @var list<Field> */
	private array $created = [];

	protected function setUp(): void {
		parent::setUp();
		$this->mapper = Server::get(FieldMapper::class);
	}

	protected function tearDown(): void {
		foreach ($this->created as $field) {
			$this->mapper->delete($field);
		}
		$this->created = [];
		parent::tearDown();
	}

	public function testRoundTripsRelativeCoordinatesAsFloats(): void {
		$field = new Field();
		$field->setDocumentId(random_int(1_000_000, 9_000_000));
		$field->setSignerId(7);
		$field->setType('initials');
		$field->setPage(2);
		$field->setX(0.8125);
		$field->setY(0.875);
		$field->setWidth(0.1375);
		$field->setHeight(0.0942);
		$this->created[] = $this->mapper->insert($field);

		$found = $this->mapper->findByDocument($field->getDocumentId())[0];

		$this->assertSame('initials', $found->getType());
		$this->assertSame(2, $found->getPage());
		$this->assertEqualsWithDelta(0.8125, $found->getX(), 0.000001);
		$this->assertEqualsWithDelta(0.875, $found->getY(), 0.000001);
		$this->assertEqualsWithDelta(0.1375, $found->getWidth(), 0.000001);
		$this->assertEqualsWithDelta(0.0942, $found->getHeight(), 0.000001);
	}
}
```

`tests/Integration/Db/EventMapperTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Db;

use OCA\Assinaturas\Db\Event;
use OCA\Assinaturas\Db\EventMapper;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class EventMapperTest extends TestCase {
	private EventMapper $mapper;
	private int $envelopeId;

	protected function setUp(): void {
		parent::setUp();
		$this->mapper = Server::get(EventMapper::class);
		$this->envelopeId = random_int(1_000_000, 9_000_000);
	}

	protected function tearDown(): void {
		foreach ($this->mapper->findByEnvelope($this->envelopeId) as $event) {
			$this->mapper->delete($event);
		}
		parent::tearDown();
	}

	public function testInsertsANewEvent(): void {
		$inserted = $this->mapper->insertIfNew($this->event('signed:signer-1:2026-09-28T13:00:00Z', ['reason' => 'ok']));

		$this->assertTrue($inserted);
		$events = $this->mapper->findByEnvelope($this->envelopeId);
		$this->assertCount(1, $events);
		$this->assertSame(['reason' => 'ok'], $events[0]->getDetail());
	}

	public function testIgnoresAReplayedEvent(): void {
		$this->mapper->insertIfNew($this->event('signed:signer-1:2026-09-28T13:00:00Z'));

		$replayed = $this->mapper->insertIfNew($this->event('signed:signer-1:2026-09-28T13:00:00Z'));

		$this->assertFalse($replayed);
		$this->assertCount(1, $this->mapper->findByEnvelope($this->envelopeId));
	}

	/** @param array<string, string> $detail */
	private function event(string $dedupeSuffix, array $detail = []): Event {
		$event = new Event();
		$event->setEnvelopeId($this->envelopeId);
		$event->setType('signed');
		$event->setDedupeKey($this->envelopeId . ':' . $dedupeSuffix);
		$event->setOccurredAt(1_790_000_000);
		$event->setDetail($detail);
		return $event;
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter MapperTest`
Expected: FAIL/ERROR with `Class "OCA\Assinaturas\Db\EnvelopeMapper" not found` (and the same for the other mappers).

- [ ] **Step 3: Write the migration**

`lib/Migration/Version000100Date20260928000000.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

final class Version000100Date20260928000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$this->createEnvelopes($schema);
		$this->createDocuments($schema);
		$this->createSigners($schema);
		$this->createFields($schema);
		$this->createEvents($schema);
		return $schema;
	}

	private function createEnvelopes(ISchemaWrapper $schema): void {
		if ($schema->hasTable('assinaturas_envelopes')) {
			return;
		}
		$table = $schema->createTable('assinaturas_envelopes');
		$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$table->addColumn('uuid', Types::STRING, ['notnull' => true, 'length' => 36]);
		$table->addColumn('owner_uid', Types::STRING, ['notnull' => true, 'length' => 64]);
		$table->addColumn('title', Types::STRING, ['notnull' => true, 'length' => 255]);
		$table->addColumn('status', Types::STRING, ['notnull' => true, 'length' => 32, 'default' => 'draft']);
		$table->addColumn('send_step', Types::INTEGER, ['notnull' => true, 'default' => 0]);
		$table->addColumn('lease_until', Types::BIGINT, ['notnull' => false]);
		$table->addColumn('create_attempted_at', Types::BIGINT, ['notnull' => false]);
		$table->addColumn('zapsign_token', Types::STRING, ['notnull' => false, 'length' => 64]);
		$table->addColumn('account_fingerprint', Types::STRING, ['notnull' => false, 'length' => 64]);
		$table->addColumn('sandbox', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
		$table->addColumn('signing_order', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
		$table->addColumn('deadline_at', Types::BIGINT, ['notnull' => false]);
		$table->addColumn('reminder_days', Types::INTEGER, ['notnull' => false]);
		$table->addColumn('message', Types::TEXT, ['notnull' => false]);
		$table->addColumn('cancel_requested_at', Types::BIGINT, ['notnull' => false]);
		$table->addColumn('cancel_reason', Types::TEXT, ['notnull' => false]);
		$table->addColumn('refused_reason', Types::TEXT, ['notnull' => false]);
		$table->addColumn('error', Types::TEXT, ['notnull' => false]);
		$table->addColumn('created_at', Types::BIGINT, ['notnull' => true]);
		$table->addColumn('updated_at', Types::BIGINT, ['notnull' => true]);
		$table->addColumn('sent_at', Types::BIGINT, ['notnull' => false]);
		$table->addColumn('completed_at', Types::BIGINT, ['notnull' => false]);
		$table->addColumn('last_synced_at', Types::BIGINT, ['notnull' => false]);
		$table->addColumn('next_sync_at', Types::BIGINT, ['notnull' => false]);
		$table->setPrimaryKey(['id']);
		$table->addUniqueIndex(['uuid'], 'assin_env_uuid_uniq');
		$table->addUniqueIndex(['zapsign_token'], 'assin_env_token_uniq');
		$table->addIndex(['owner_uid', 'status'], 'assin_env_owner_status');
		$table->addIndex(['status', 'next_sync_at'], 'assin_env_status_sync');
	}

	private function createDocuments(ISchemaWrapper $schema): void {
		if ($schema->hasTable('assinaturas_documents')) {
			return;
		}
		$table = $schema->createTable('assinaturas_documents');
		$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$table->addColumn('envelope_id', Types::BIGINT, ['notnull' => true]);
		$table->addColumn('position', Types::INTEGER, ['notnull' => true, 'default' => 0]);
		$table->addColumn('source_file_id', Types::BIGINT, ['notnull' => true]);
		$table->addColumn('source_path', Types::STRING, ['notnull' => true, 'length' => 4000]);
		$table->addColumn('source_etag', Types::STRING, ['notnull' => false, 'length' => 64]);
		$table->addColumn('page_count', Types::INTEGER, ['notnull' => false]);
		$table->addColumn('pages', Types::TEXT, ['notnull' => false]);
		$table->addColumn('sent_sha256', Types::STRING, ['notnull' => false, 'length' => 64]);
		$table->addColumn('zapsign_token', Types::STRING, ['notnull' => false, 'length' => 64]);
		$table->addColumn('signed_file_id', Types::BIGINT, ['notnull' => false]);
		$table->addColumn('save_status', Types::STRING, ['notnull' => true, 'length' => 16, 'default' => 'pending']);
		$table->setPrimaryKey(['id']);
		$table->addIndex(['envelope_id'], 'assin_doc_envelope');
		$table->addUniqueIndex(['zapsign_token'], 'assin_doc_token_uniq');
	}

	private function createSigners(ISchemaWrapper $schema): void {
		if ($schema->hasTable('assinaturas_signers')) {
			return;
		}
		$table = $schema->createTable('assinaturas_signers');
		$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$table->addColumn('envelope_id', Types::BIGINT, ['notnull' => true]);
		$table->addColumn('name', Types::STRING, ['notnull' => true, 'length' => 255]);
		$table->addColumn('email', Types::STRING, ['notnull' => true, 'length' => 320]);
		$table->addColumn('order_group', Types::INTEGER, ['notnull' => true, 'default' => 1]);
		$table->addColumn('zapsign_token', Types::STRING, ['notnull' => false, 'length' => 64]);
		$table->addColumn('status', Types::STRING, ['notnull' => true, 'length' => 16, 'default' => 'pending']);
		$table->addColumn('released_at', Types::BIGINT, ['notnull' => false]);
		$table->addColumn('viewed_at', Types::BIGINT, ['notnull' => false]);
		$table->addColumn('signed_at', Types::BIGINT, ['notnull' => false]);
		$table->addColumn('last_reminder_at', Types::BIGINT, ['notnull' => false]);
		$table->addColumn('email_bounced_at', Types::BIGINT, ['notnull' => false]);
		$table->addColumn('color', Types::INTEGER, ['notnull' => true, 'default' => 0]);
		$table->setPrimaryKey(['id']);
		$table->addIndex(['envelope_id'], 'assin_sig_envelope');
		$table->addUniqueIndex(['zapsign_token'], 'assin_sig_token_uniq');
	}

	private function createFields(ISchemaWrapper $schema): void {
		if ($schema->hasTable('assinaturas_fields')) {
			return;
		}
		$table = $schema->createTable('assinaturas_fields');
		$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$table->addColumn('document_id', Types::BIGINT, ['notnull' => true]);
		$table->addColumn('signer_id', Types::BIGINT, ['notnull' => true]);
		$table->addColumn('type', Types::STRING, ['notnull' => true, 'length' => 16]);
		$table->addColumn('page', Types::INTEGER, ['notnull' => true]);
		$table->addColumn('x', Types::FLOAT, ['notnull' => true]);
		$table->addColumn('y', Types::FLOAT, ['notnull' => true]);
		$table->addColumn('width', Types::FLOAT, ['notnull' => true]);
		$table->addColumn('height', Types::FLOAT, ['notnull' => true]);
		$table->setPrimaryKey(['id']);
		$table->addIndex(['document_id'], 'assin_fld_document');
	}

	private function createEvents(ISchemaWrapper $schema): void {
		if ($schema->hasTable('assinaturas_events')) {
			return;
		}
		$table = $schema->createTable('assinaturas_events');
		$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$table->addColumn('envelope_id', Types::BIGINT, ['notnull' => true]);
		$table->addColumn('signer_id', Types::BIGINT, ['notnull' => false]);
		$table->addColumn('type', Types::STRING, ['notnull' => true, 'length' => 32]);
		$table->addColumn('dedupe_key', Types::STRING, ['notnull' => true, 'length' => 190]);
		$table->addColumn('occurred_at', Types::BIGINT, ['notnull' => true]);
		$table->addColumn('actor_uid', Types::STRING, ['notnull' => false, 'length' => 64]);
		$table->addColumn('detail', Types::TEXT, ['notnull' => false]);
		$table->setPrimaryKey(['id']);
		$table->addUniqueIndex(['dedupe_key'], 'assin_evt_dedupe_uniq');
		$table->addIndex(['envelope_id'], 'assin_evt_envelope');
	}
}
```

- [ ] **Step 4: Write the status enum and entities**

`lib/Db/EnvelopeStatus.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

enum EnvelopeStatus: string {
	case Draft = 'draft';
	case Sending = 'sending';
	case Failed = 'failed';
	case Pending = 'pending';
	case Finalizing = 'finalizing';
	case Completed = 'completed';
	case Refused = 'refused';
	case Expired = 'expired';
	case Cancelled = 'cancelled';
	case ArchivedSandbox = 'archived_sandbox';
}
```

`lib/Db/Envelope.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

use OCP\AppFramework\Db\Entity;
use OCP\DB\Types;

/**
 * @method string getUuid()
 * @method void setUuid(string $uuid)
 * @method string getOwnerUid()
 * @method void setOwnerUid(string $ownerUid)
 * @method string getTitle()
 * @method void setTitle(string $title)
 * @method string getStatus()
 * @method void setStatus(string $status)
 * @method int getSendStep()
 * @method void setSendStep(int $sendStep)
 * @method int|null getLeaseUntil()
 * @method void setLeaseUntil(?int $leaseUntil)
 * @method int|null getCreateAttemptedAt()
 * @method void setCreateAttemptedAt(?int $createAttemptedAt)
 * @method string|null getZapsignToken()
 * @method void setZapsignToken(?string $zapsignToken)
 * @method string|null getAccountFingerprint()
 * @method void setAccountFingerprint(?string $accountFingerprint)
 * @method bool getSandbox()
 * @method void setSandbox(bool $sandbox)
 * @method bool getSigningOrder()
 * @method void setSigningOrder(bool $signingOrder)
 * @method int|null getDeadlineAt()
 * @method void setDeadlineAt(?int $deadlineAt)
 * @method int|null getReminderDays()
 * @method void setReminderDays(?int $reminderDays)
 * @method string|null getMessage()
 * @method void setMessage(?string $message)
 * @method int|null getCancelRequestedAt()
 * @method void setCancelRequestedAt(?int $cancelRequestedAt)
 * @method string|null getCancelReason()
 * @method void setCancelReason(?string $cancelReason)
 * @method string|null getRefusedReason()
 * @method void setRefusedReason(?string $refusedReason)
 * @method string|null getError()
 * @method void setError(?string $error)
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $createdAt)
 * @method int getUpdatedAt()
 * @method void setUpdatedAt(int $updatedAt)
 * @method int|null getSentAt()
 * @method void setSentAt(?int $sentAt)
 * @method int|null getCompletedAt()
 * @method void setCompletedAt(?int $completedAt)
 * @method int|null getLastSyncedAt()
 * @method void setLastSyncedAt(?int $lastSyncedAt)
 * @method int|null getNextSyncAt()
 * @method void setNextSyncAt(?int $nextSyncAt)
 */
final class Envelope extends Entity {
	private const FIELD_TYPES = [
		'uuid' => Types::STRING,
		'ownerUid' => Types::STRING,
		'title' => Types::STRING,
		'status' => Types::STRING,
		'sendStep' => Types::INTEGER,
		'leaseUntil' => Types::BIGINT,
		'createAttemptedAt' => Types::BIGINT,
		'zapsignToken' => Types::STRING,
		'accountFingerprint' => Types::STRING,
		'sandbox' => Types::BOOLEAN,
		'signingOrder' => Types::BOOLEAN,
		'deadlineAt' => Types::BIGINT,
		'reminderDays' => Types::INTEGER,
		'message' => Types::TEXT,
		'cancelRequestedAt' => Types::BIGINT,
		'cancelReason' => Types::TEXT,
		'refusedReason' => Types::TEXT,
		'error' => Types::TEXT,
		'createdAt' => Types::BIGINT,
		'updatedAt' => Types::BIGINT,
		'sentAt' => Types::BIGINT,
		'completedAt' => Types::BIGINT,
		'lastSyncedAt' => Types::BIGINT,
		'nextSyncAt' => Types::BIGINT,
	];

	protected $uuid = '';
	protected $ownerUid = '';
	protected $title = '';
	protected $status = 'draft';
	protected $sendStep = 0;
	protected $leaseUntil;
	protected $createAttemptedAt;
	protected $zapsignToken;
	protected $accountFingerprint;
	protected $sandbox = false;
	protected $signingOrder = false;
	protected $deadlineAt;
	protected $reminderDays;
	protected $message;
	protected $cancelRequestedAt;
	protected $cancelReason;
	protected $refusedReason;
	protected $error;
	protected $createdAt = 0;
	protected $updatedAt = 0;
	protected $sentAt;
	protected $completedAt;
	protected $lastSyncedAt;
	protected $nextSyncAt;

	public function __construct() {
		foreach (self::FIELD_TYPES as $field => $type) {
			$this->addType($field, $type);
		}
	}

	public function statusValue(): EnvelopeStatus {
		return EnvelopeStatus::from($this->getStatus());
	}
}
```

`lib/Db/Document.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

use OCP\AppFramework\Db\Entity;
use OCP\DB\Types;

/**
 * @method int getEnvelopeId()
 * @method void setEnvelopeId(int $envelopeId)
 * @method int getPosition()
 * @method void setPosition(int $position)
 * @method int getSourceFileId()
 * @method void setSourceFileId(int $sourceFileId)
 * @method string getSourcePath()
 * @method void setSourcePath(string $sourcePath)
 * @method string|null getSourceEtag()
 * @method void setSourceEtag(?string $sourceEtag)
 * @method int|null getPageCount()
 * @method void setPageCount(?int $pageCount)
 * @method list<array{width: float, height: float, rotation: int}>|null getPages()
 * @method void setPages(?array $pages)
 * @method string|null getSentSha256()
 * @method void setSentSha256(?string $sentSha256)
 * @method string|null getZapsignToken()
 * @method void setZapsignToken(?string $zapsignToken)
 * @method int|null getSignedFileId()
 * @method void setSignedFileId(?int $signedFileId)
 * @method string getSaveStatus()
 * @method void setSaveStatus(string $saveStatus)
 */
final class Document extends Entity {
	private const FIELD_TYPES = [
		'envelopeId' => Types::BIGINT,
		'position' => Types::INTEGER,
		'sourceFileId' => Types::BIGINT,
		'sourcePath' => Types::STRING,
		'sourceEtag' => Types::STRING,
		'pageCount' => Types::INTEGER,
		'pages' => Types::JSON,
		'sentSha256' => Types::STRING,
		'zapsignToken' => Types::STRING,
		'signedFileId' => Types::BIGINT,
		'saveStatus' => Types::STRING,
	];

	protected $envelopeId = 0;
	protected $position = 0;
	protected $sourceFileId = 0;
	protected $sourcePath = '';
	protected $sourceEtag;
	protected $pageCount;
	protected $pages;
	protected $sentSha256;
	protected $zapsignToken;
	protected $signedFileId;
	protected $saveStatus = 'pending';

	public function __construct() {
		foreach (self::FIELD_TYPES as $field => $type) {
			$this->addType($field, $type);
		}
	}
}
```

`lib/Db/Signer.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

use OCP\AppFramework\Db\Entity;
use OCP\DB\Types;

/**
 * @method int getEnvelopeId()
 * @method void setEnvelopeId(int $envelopeId)
 * @method string getName()
 * @method void setName(string $name)
 * @method string getEmail()
 * @method void setEmail(string $email)
 * @method int getOrderGroup()
 * @method void setOrderGroup(int $orderGroup)
 * @method string|null getZapsignToken()
 * @method void setZapsignToken(?string $zapsignToken)
 * @method string getStatus()
 * @method void setStatus(string $status)
 * @method int|null getReleasedAt()
 * @method void setReleasedAt(?int $releasedAt)
 * @method int|null getViewedAt()
 * @method void setViewedAt(?int $viewedAt)
 * @method int|null getSignedAt()
 * @method void setSignedAt(?int $signedAt)
 * @method int|null getLastReminderAt()
 * @method void setLastReminderAt(?int $lastReminderAt)
 * @method int|null getEmailBouncedAt()
 * @method void setEmailBouncedAt(?int $emailBouncedAt)
 * @method int getColor()
 * @method void setColor(int $color)
 */
final class Signer extends Entity {
	private const FIELD_TYPES = [
		'envelopeId' => Types::BIGINT,
		'name' => Types::STRING,
		'email' => Types::STRING,
		'orderGroup' => Types::INTEGER,
		'zapsignToken' => Types::STRING,
		'status' => Types::STRING,
		'releasedAt' => Types::BIGINT,
		'viewedAt' => Types::BIGINT,
		'signedAt' => Types::BIGINT,
		'lastReminderAt' => Types::BIGINT,
		'emailBouncedAt' => Types::BIGINT,
		'color' => Types::INTEGER,
	];

	protected $envelopeId = 0;
	protected $name = '';
	protected $email = '';
	protected $orderGroup = 1;
	protected $zapsignToken;
	protected $status = 'pending';
	protected $releasedAt;
	protected $viewedAt;
	protected $signedAt;
	protected $lastReminderAt;
	protected $emailBouncedAt;
	protected $color = 0;

	public function __construct() {
		foreach (self::FIELD_TYPES as $field => $type) {
			$this->addType($field, $type);
		}
	}
}
```

`lib/Db/Field.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

use OCP\AppFramework\Db\Entity;
use OCP\DB\Types;

/**
 * @method int getDocumentId()
 * @method void setDocumentId(int $documentId)
 * @method int getSignerId()
 * @method void setSignerId(int $signerId)
 * @method string getType()
 * @method void setType(string $type)
 * @method int getPage()
 * @method void setPage(int $page)
 * @method float getX()
 * @method void setX(float $x)
 * @method float getY()
 * @method void setY(float $y)
 * @method float getWidth()
 * @method void setWidth(float $width)
 * @method float getHeight()
 * @method void setHeight(float $height)
 */
final class Field extends Entity {
	private const FIELD_TYPES = [
		'documentId' => Types::BIGINT,
		'signerId' => Types::BIGINT,
		'type' => Types::STRING,
		'page' => Types::INTEGER,
		'x' => Types::FLOAT,
		'y' => Types::FLOAT,
		'width' => Types::FLOAT,
		'height' => Types::FLOAT,
	];

	protected $documentId = 0;
	protected $signerId = 0;
	protected $type = 'signature';
	protected $page = 0;
	protected $x = 0.0;
	protected $y = 0.0;
	protected $width = 0.0;
	protected $height = 0.0;

	public function __construct() {
		foreach (self::FIELD_TYPES as $field => $type) {
			$this->addType($field, $type);
		}
	}
}
```

`lib/Db/Event.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

use OCP\AppFramework\Db\Entity;
use OCP\DB\Types;

/**
 * @method int getEnvelopeId()
 * @method void setEnvelopeId(int $envelopeId)
 * @method int|null getSignerId()
 * @method void setSignerId(?int $signerId)
 * @method string getType()
 * @method void setType(string $type)
 * @method string getDedupeKey()
 * @method void setDedupeKey(string $dedupeKey)
 * @method int getOccurredAt()
 * @method void setOccurredAt(int $occurredAt)
 * @method string|null getActorUid()
 * @method void setActorUid(?string $actorUid)
 * @method array<string, scalar>|null getDetail()
 * @method void setDetail(?array $detail)
 */
final class Event extends Entity {
	private const FIELD_TYPES = [
		'envelopeId' => Types::BIGINT,
		'signerId' => Types::BIGINT,
		'type' => Types::STRING,
		'dedupeKey' => Types::STRING,
		'occurredAt' => Types::BIGINT,
		'actorUid' => Types::STRING,
		'detail' => Types::JSON,
	];

	protected $envelopeId = 0;
	protected $signerId;
	protected $type = '';
	protected $dedupeKey = '';
	protected $occurredAt = 0;
	protected $actorUid;
	protected $detail;

	public function __construct() {
		foreach (self::FIELD_TYPES as $field => $type) {
			$this->addType($field, $type);
		}
	}
}
```

- [ ] **Step 5: Write the mappers**

`lib/Db/EnvelopeMapper.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @template-extends QBMapper<Envelope>
 */
final class EnvelopeMapper extends QBMapper {
	public const TABLE = 'assinaturas_envelopes';

	public function __construct(IDBConnection $db) {
		parent::__construct($db, self::TABLE, Envelope::class);
	}

	/** @throws DoesNotExistException */
	public function findById(int $envelopeId): Envelope {
		return $this->findOneBy('id', $envelopeId, IQueryBuilder::PARAM_INT);
	}

	/** @throws DoesNotExistException */
	public function findByUuid(string $uuid): Envelope {
		return $this->findOneBy('uuid', $uuid, IQueryBuilder::PARAM_STR);
	}

	/** @throws DoesNotExistException */
	public function findByZapsignToken(string $zapsignToken): Envelope {
		return $this->findOneBy('zapsign_token', $zapsignToken, IQueryBuilder::PARAM_STR);
	}

	/**
	 * Atomically moves an envelope between states. Returns true only for the
	 * caller whose UPDATE changed the row, so concurrent claims resolve to one winner.
	 *
	 * @param list<EnvelopeStatus> $fromStatuses
	 */
	public function transitionStatus(int $envelopeId, array $fromStatuses, EnvelopeStatus $toStatus, ?int $leaseUntil, int $now): bool {
		$query = $this->db->getQueryBuilder();
		$fromValues = array_map(fn (EnvelopeStatus $status): string => $status->value, $fromStatuses);
		$query->update(self::TABLE)
			->set('status', $query->createNamedParameter($toStatus->value))
			->set('lease_until', $query->createNamedParameter($leaseUntil, $leaseUntil === null ? IQueryBuilder::PARAM_NULL : IQueryBuilder::PARAM_INT))
			->set('updated_at', $query->createNamedParameter($now, IQueryBuilder::PARAM_INT))
			->where($query->expr()->eq('id', $query->createNamedParameter($envelopeId, IQueryBuilder::PARAM_INT)))
			->andWhere($query->expr()->in('status', $query->createNamedParameter($fromValues, IQueryBuilder::PARAM_STR_ARRAY)));
		return $query->executeStatement() === 1;
	}

	/** @throws DoesNotExistException */
	private function findOneBy(string $column, string|int $value, int $parameterType): Envelope {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->eq($column, $query->createNamedParameter($value, $parameterType)));
		return $this->findEntity($query);
	}
}
```

`lib/Db/DocumentMapper.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @template-extends QBMapper<Document>
 */
final class DocumentMapper extends QBMapper {
	public const TABLE = 'assinaturas_documents';

	public function __construct(IDBConnection $db) {
		parent::__construct($db, self::TABLE, Document::class);
	}

	/** @return list<Document> */
	public function findByEnvelope(int $envelopeId): array {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->eq('envelope_id', $query->createNamedParameter($envelopeId, IQueryBuilder::PARAM_INT)))
			->orderBy('position', 'ASC');
		return $this->findEntities($query);
	}

	/** @throws DoesNotExistException */
	public function findByZapsignToken(string $zapsignToken): Document {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->eq('zapsign_token', $query->createNamedParameter($zapsignToken)));
		return $this->findEntity($query);
	}
}
```

`lib/Db/SignerMapper.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @template-extends QBMapper<Signer>
 */
final class SignerMapper extends QBMapper {
	public const TABLE = 'assinaturas_signers';

	public function __construct(IDBConnection $db) {
		parent::__construct($db, self::TABLE, Signer::class);
	}

	/** @return list<Signer> */
	public function findByEnvelope(int $envelopeId): array {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->eq('envelope_id', $query->createNamedParameter($envelopeId, IQueryBuilder::PARAM_INT)))
			->orderBy('order_group', 'ASC')
			->addOrderBy('id', 'ASC');
		return $this->findEntities($query);
	}

	/** @throws DoesNotExistException */
	public function findByZapsignToken(string $zapsignToken): Signer {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->eq('zapsign_token', $query->createNamedParameter($zapsignToken)));
		return $this->findEntity($query);
	}
}
```

`lib/Db/FieldMapper.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @template-extends QBMapper<Field>
 */
final class FieldMapper extends QBMapper {
	public const TABLE = 'assinaturas_fields';

	public function __construct(IDBConnection $db) {
		parent::__construct($db, self::TABLE, Field::class);
	}

	/** @return list<Field> */
	public function findByDocument(int $documentId): array {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->eq('document_id', $query->createNamedParameter($documentId, IQueryBuilder::PARAM_INT)))
			->orderBy('page', 'ASC')
			->addOrderBy('id', 'ASC');
		return $this->findEntities($query);
	}
}
```

`lib/Db/EventMapper.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\DB\Exception;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @template-extends QBMapper<Event>
 */
final class EventMapper extends QBMapper {
	public const TABLE = 'assinaturas_events';

	public function __construct(IDBConnection $db) {
		parent::__construct($db, self::TABLE, Event::class);
	}

	/** @return list<Event> */
	public function findByEnvelope(int $envelopeId): array {
		$query = $this->db->getQueryBuilder();
		$query->select('*')
			->from(self::TABLE)
			->where($query->expr()->eq('envelope_id', $query->createNamedParameter($envelopeId, IQueryBuilder::PARAM_INT)))
			->orderBy('occurred_at', 'ASC')
			->addOrderBy('id', 'ASC');
		return $this->findEntities($query);
	}

	/**
	 * Inserts the event unless one with the same dedupe key exists.
	 * Must not run inside an open transaction on Postgres: a unique violation
	 * aborts the whole transaction there.
	 *
	 * @throws Exception on any database error other than a duplicate dedupe key
	 */
	public function insertIfNew(Event $event): bool {
		try {
			$this->insert($event);
			return true;
		} catch (Exception $exception) {
			if ($exception->getReason() !== Exception::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $exception;
			}
			return false;
		}
	}
}
```

- [ ] **Step 6: Rebuild the env so the migration runs, then run the tests**

Run: `tests/env/reset.sh && tests/env/phpunit.sh`
Expected: `OK (16 tests, …)`. That's 2 from Task 1 plus 14 mapper tests.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add envelope, document, signer, field and event schema with mappers"
```

---

### Task 3: ZapSign settings and environment

**Files:**
- Create: `lib/ZapSign/ZapSignEnvironment.php`
- Create: `lib/ZapSign/ZapSignSettings.php`
- Test: `tests/Integration/ZapSign/ZapSignSettingsTest.php`

**Interfaces:**
- Produces:
  - `enum ZapSignEnvironment: string` with `Sandbox='sandbox'`, `Production='production'`, and `apiBaseUrl(): string` (no trailing slash).
  - `ZapSignSettings` constants: `KEY_API_TOKEN='api_token'`, `KEY_ENVIRONMENT='environment'`, `KEY_COMPANY_NAME='company_name'`.
  - `ZapSignSettings` methods: `apiToken(): string`, `environment(): ZapSignEnvironment` (unset or unknown → `Sandbox`), `companyName(): string`, `isConfigured(): bool`, `accountFingerprint(): string` (sha256 of `token|environment`).

- [ ] **Step 1: Write the failing test**

`tests/Integration/ZapSign/ZapSignSettingsTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\ZapSign;

use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\ZapSign\ZapSignEnvironment;
use OCA\Assinaturas\ZapSign\ZapSignSettings;
use OCP\IAppConfig;
use OCP\Server;
use Test\TestCase;

/**
 * Snapshots and restores the real keys so a sandbox token configured for the
 * spikes (Task 9) survives a test run.
 *
 * @group DB
 */
final class ZapSignSettingsTest extends TestCase {
	private const KEYS = [ZapSignSettings::KEY_API_TOKEN, ZapSignSettings::KEY_ENVIRONMENT, ZapSignSettings::KEY_COMPANY_NAME];

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
		$this->settings = new ZapSignSettings($this->appConfig);
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
		$this->assertSame('https://api.zapsign.com.br/api/v1', $this->settings->environment()->apiBaseUrl());
	}

	public function testReportsNotConfiguredWithoutAToken(): void {
		$this->assertFalse($this->settings->isConfigured());
	}

	public function testDecryptsASensitiveToken(): void {
		$this->appConfig->setValueString(Application::APP_ID, ZapSignSettings::KEY_API_TOKEN, 'tenant-token-123', false, true);

		$this->assertSame('tenant-token-123', $this->settings->apiToken());
		$this->assertTrue($this->settings->isConfigured());
	}

	public function testReadsTheCompanyName(): void {
		$this->appConfig->setValueString(Application::APP_ID, ZapSignSettings::KEY_COMPANY_NAME, 'Construtora Exemplo');

		$this->assertSame('Construtora Exemplo', $this->settings->companyName());
	}

	public function testChangesTheAccountFingerprintWhenTheEnvironmentChanges(): void {
		$this->appConfig->setValueString(Application::APP_ID, ZapSignSettings::KEY_API_TOKEN, 'tenant-token-123', false, true);
		$sandboxFingerprint = $this->settings->accountFingerprint();

		$this->appConfig->setValueString(Application::APP_ID, ZapSignSettings::KEY_ENVIRONMENT, 'production');

		$this->assertNotSame($sandboxFingerprint, $this->settings->accountFingerprint());
		$this->assertSame(64, strlen($this->settings->accountFingerprint()));
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `tests/env/phpunit.sh --filter ZapSignSettingsTest`
Expected: ERROR `Class "OCA\Assinaturas\ZapSign\ZapSignSettings" not found`.

- [ ] **Step 3: Implement**

`lib/ZapSign/ZapSignEnvironment.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign;

enum ZapSignEnvironment: string {
	case Sandbox = 'sandbox';
	case Production = 'production';

	private const API_BASE_URLS = [
		'sandbox' => 'https://sandbox.api.zapsign.com.br/api/v1',
		'production' => 'https://api.zapsign.com.br/api/v1',
	];

	public function apiBaseUrl(): string {
		return self::API_BASE_URLS[$this->value];
	}
}
```

`lib/ZapSign/ZapSignSettings.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign;

use OCA\Assinaturas\AppInfo\Application;
use OCP\IAppConfig;

final class ZapSignSettings {
	public const KEY_API_TOKEN = 'api_token';
	public const KEY_ENVIRONMENT = 'environment';
	public const KEY_COMPANY_NAME = 'company_name';

	public function __construct(
		private IAppConfig $appConfig,
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

	public function isConfigured(): bool {
		return $this->apiToken() !== '';
	}

	public function accountFingerprint(): string {
		return hash('sha256', $this->apiToken() . '|' . $this->environment()->value);
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter ZapSignSettingsTest`
Expected: `OK (7 tests, …)`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add ZapSign settings with sandbox-safe environment fallback"
```

---

### Task 4: HTTP transport, call monitor and provider backoff

**Files:**
- Create: `lib/ZapSign/Http/HttpTransport.php`, `HttpRequest.php`, `HttpResponse.php`, `TransportFailure.php`, `NextcloudHttpTransport.php`
- Create: `lib/ZapSign/CallMonitor.php`, `lib/ZapSign/ProviderBackoff.php`, `lib/ZapSign/Sleeper.php`, `lib/ZapSign/SystemSleeper.php`
- Modify: `lib/AppInfo/Application.php` (register DI aliases)
- Create: `tests/Fakes/FakeHttpTransport.php`, `tests/Fakes/RecordingSleeper.php`, `tests/Fakes/RecordingLogger.php`
- Test: `tests/Unit/ZapSign/CallMonitorTest.php`
- Test: `tests/Unit/ZapSign/ProviderBackoffTest.php`

**Interfaces:**
- Produces:
  - `interface HttpTransport { send(HttpRequest $request): HttpResponse; }`. Throws `TransportFailure` when no HTTP response exists (connect error, timeout).
  - `HttpRequest(string $method, string $url, array<string,string> $headers, ?string $body, int $timeoutSeconds)`.
  - `HttpResponse(int $statusCode, array<string,string> $headers, string $body)`. Header names are lowercased.
  - `CallMonitor::observe(string $endpoint, array<string, scalar|null> $context, callable(): HttpResponse $call): HttpResponse`. This is the monitoring higher-order wrapper: it logs endpoint, status and duration, and never the URL or exception messages.
  - `ProviderBackoff::remainingSeconds(): int` and `ProviderBackoff::pauseFor(int $seconds): void`. Both are shared across processes through the distributed cache.
  - `interface Sleeper { sleepMicroseconds(int $microseconds): void; }` and `SystemSleeper`.
  - Test doubles:
    - `FakeHttpTransport` — `willRespond(int, array|string, array $headers = []): self`, `willFail(\Throwable): self`, public `$requests`, `lastRequestJson(): array`.
    - `RecordingSleeper` — public `$sleptMicroseconds`.
    - `RecordingLogger` — public `$records` as `list<array{level: string, message: string, context: array}>`.

- [ ] **Step 1: Write the test doubles**

`tests/Fakes/FakeHttpTransport.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Fakes;

use OCA\Assinaturas\ZapSign\Http\HttpRequest;
use OCA\Assinaturas\ZapSign\Http\HttpResponse;
use OCA\Assinaturas\ZapSign\Http\HttpTransport;

final class FakeHttpTransport implements HttpTransport {
	/** @var list<HttpRequest> */
	public array $requests = [];
	/** @var list<HttpResponse|\Throwable> */
	private array $queue = [];

	/**
	 * @param array<mixed>|string $body
	 * @param array<string, string> $headers
	 */
	public function willRespond(int $statusCode, array|string $body, array $headers = []): self {
		$encoded = is_string($body) ? $body : json_encode($body, JSON_THROW_ON_ERROR);
		$this->queue[] = new HttpResponse($statusCode, $headers, $encoded);
		return $this;
	}

	public function willFail(\Throwable $failure): self {
		$this->queue[] = $failure;
		return $this;
	}

	public function send(HttpRequest $request): HttpResponse {
		$this->requests[] = $request;
		$next = array_shift($this->queue);
		if ($next === null) {
			throw new \LogicException('No fake response queued for ' . $request->method . ' ' . $request->url);
		}
		if ($next instanceof \Throwable) {
			throw $next;
		}
		return $next;
	}

	/** @return array<mixed> */
	public function lastRequestJson(): array {
		$lastRequest = $this->requests[array_key_last($this->requests)];
		return json_decode($lastRequest->body ?? '[]', true, 512, JSON_THROW_ON_ERROR);
	}
}
```

`tests/Fakes/RecordingSleeper.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Fakes;

use OCA\Assinaturas\ZapSign\Sleeper;

final class RecordingSleeper implements Sleeper {
	/** @var list<int> */
	public array $sleptMicroseconds = [];

	public function sleepMicroseconds(int $microseconds): void {
		$this->sleptMicroseconds[] = $microseconds;
	}
}
```

`tests/Fakes/RecordingLogger.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Fakes;

use Psr\Log\AbstractLogger;

final class RecordingLogger extends AbstractLogger {
	/** @var list<array{level: string, message: string, context: array<mixed>}> */
	public array $records = [];

	public function log($level, string|\Stringable $message, array $context = []): void {
		$this->records[] = ['level' => (string)$level, 'message' => (string)$message, 'context' => $context];
	}

	public function serialized(): string {
		return json_encode($this->records, JSON_THROW_ON_ERROR);
	}
}
```

- [ ] **Step 2: Write the failing tests**

`tests/Unit/ZapSign/CallMonitorTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\ZapSign;

use OCA\Assinaturas\Tests\Fakes\RecordingLogger;
use OCA\Assinaturas\ZapSign\CallMonitor;
use OCA\Assinaturas\ZapSign\Http\HttpResponse;
use OCA\Assinaturas\ZapSign\Http\TransportFailure;
use PHPUnit\Framework\TestCase;
use Psr\Log\LogLevel;

final class CallMonitorTest extends TestCase {
	private RecordingLogger $logger;
	private CallMonitor $monitor;

	protected function setUp(): void {
		$this->logger = new RecordingLogger();
		$this->monitor = new CallMonitor($this->logger);
	}

	public function testLogsEndpointStatusAndDurationOfASuccessfulCall(): void {
		$response = $this->monitor->observe('GET /docs/{doc}/', ['document' => 'doc-1'], fn (): HttpResponse => new HttpResponse(200, [], '{}'));

		$this->assertSame(200, $response->statusCode);
		$record = $this->logger->records[0];
		$this->assertSame(LogLevel::INFO, $record['level']);
		$this->assertSame('GET /docs/{doc}/', $record['context']['endpoint']);
		$this->assertSame(200, $record['context']['status']);
		$this->assertSame('doc-1', $record['context']['document']);
		$this->assertIsInt($record['context']['durationMs']);
	}

	public function testLogsErrorResponsesAsWarnings(): void {
		$this->monitor->observe('GET /docs/{doc}/', [], fn (): HttpResponse => new HttpResponse(404, [], '{"detail":"Not found."}'));

		$this->assertSame(LogLevel::WARNING, $this->logger->records[0]['level']);
	}

	public function testRethrowsFailuresWithoutLoggingTheirMessage(): void {
		$failure = new TransportFailure('cURL error 28 for https://sandbox.api.zapsign.com.br/api/v1/signers/secret-signer-token/');

		try {
			$this->monitor->observe('POST /signers/{signer}/', [], fn (): HttpResponse => throw $failure);
			$this->fail('Expected the failure to be rethrown');
		} catch (TransportFailure $rethrown) {
			$this->assertSame($failure, $rethrown);
		}

		$this->assertSame(TransportFailure::class, $this->logger->records[0]['context']['failure']);
		$this->assertStringNotContainsString('secret-signer-token', $this->logger->serialized());
	}
}
```

`tests/Unit/ZapSign/ProviderBackoffTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\ZapSign;

use OC\Memcache\ArrayCache;
use OCA\Assinaturas\ZapSign\ProviderBackoff;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\ICacheFactory;
use PHPUnit\Framework\TestCase;

final class ProviderBackoffTest extends TestCase {
	private int $now = 1_790_000_000;
	private ProviderBackoff $backoff;

	protected function setUp(): void {
		$cacheFactory = $this->createMock(ICacheFactory::class);
		$cacheFactory->method('createDistributed')->willReturn(new ArrayCache(''));
		$timeFactory = $this->createMock(ITimeFactory::class);
		$timeFactory->method('getTime')->willReturnCallback(fn (): int => $this->now);
		$this->backoff = new ProviderBackoff($cacheFactory, $timeFactory);
	}

	public function testIsOpenByDefault(): void {
		$this->assertSame(0, $this->backoff->remainingSeconds());
	}

	public function testReportsTheRemainingPause(): void {
		$this->backoff->pauseFor(60);
		$this->now += 20;

		$this->assertSame(40, $this->backoff->remainingSeconds());
	}

	public function testReopensWhenThePauseElapses(): void {
		$this->backoff->pauseFor(60);
		$this->now += 61;

		$this->assertSame(0, $this->backoff->remainingSeconds());
	}

	public function testKeepsTheLongerPauseWhenAShorterOneArrives(): void {
		$this->backoff->pauseFor(120);
		$this->backoff->pauseFor(10);

		$this->assertSame(120, $this->backoff->remainingSeconds());
	}
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter 'CallMonitorTest|ProviderBackoffTest'`
Expected: ERROR `Class "OCA\Assinaturas\ZapSign\CallMonitor" not found`.

- [ ] **Step 4: Implement the transport**

`lib/ZapSign/Http/HttpTransport.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Http;

interface HttpTransport {
	/** @throws TransportFailure when no HTTP response was received (connect error, timeout) */
	public function send(HttpRequest $request): HttpResponse;
}
```

`lib/ZapSign/Http/HttpRequest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Http;

final class HttpRequest {
	/** @param array<string, string> $headers */
	public function __construct(
		public readonly string $method,
		public readonly string $url,
		public readonly array $headers,
		public readonly ?string $body,
		public readonly int $timeoutSeconds,
	) {
	}
}
```

`lib/ZapSign/Http/HttpResponse.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Http;

final class HttpResponse {
	/** @param array<string, string> $headers lowercased header name => value */
	public function __construct(
		public readonly int $statusCode,
		public readonly array $headers,
		public readonly string $body,
	) {
	}
}
```

`lib/ZapSign/Http/TransportFailure.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Http;

final class TransportFailure extends \RuntimeException {
}
```

`lib/ZapSign/Http/NextcloudHttpTransport.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Http;

use OCP\Http\Client\IClientService;

final class NextcloudHttpTransport implements HttpTransport {
	public function __construct(
		private IClientService $clientService,
	) {
	}

	public function send(HttpRequest $request): HttpResponse {
		$options = [
			'headers' => $request->headers,
			'timeout' => $request->timeoutSeconds,
			'http_errors' => false,
		];
		if ($request->body !== null) {
			$options['body'] = $request->body;
		}
		try {
			$response = $this->clientService->newClient()->request($request->method, $request->url, $options);
		} catch (\Throwable $failure) {
			throw new TransportFailure('HTTP transport failed', 0, $failure);
		}
		return new HttpResponse(
			$response->getStatusCode(),
			self::lowercaseHeaders($response->getHeaders()),
			self::bodyAsString($response->getBody()),
		);
	}

	/**
	 * @param array<string, string|list<string>> $headers
	 * @return array<string, string>
	 */
	private static function lowercaseHeaders(array $headers): array {
		$lowercased = [];
		foreach ($headers as $name => $values) {
			$lowercased[strtolower((string)$name)] = is_array($values) ? implode(', ', $values) : (string)$values;
		}
		return $lowercased;
	}

	private static function bodyAsString(mixed $body): string {
		if (is_resource($body)) {
			return (string)stream_get_contents($body);
		}
		return (string)$body;
	}
}
```

- [ ] **Step 5: Implement the monitor, backoff and sleeper**

`lib/ZapSign/CallMonitor.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign;

use OCA\Assinaturas\ZapSign\Http\HttpResponse;
use Psr\Log\LoggerInterface;
use Psr\Log\LogLevel;

/**
 * Monitoring higher-order wrapper for every ZapSign HTTP call. Logs the endpoint
 * template, status and duration. Never logs URLs, headers, bodies or exception
 * messages, because those can carry the API token or signer tokens.
 */
final class CallMonitor {
	private const FIRST_ERROR_STATUS = 400;
	private const NANOSECONDS_PER_MILLISECOND = 1_000_000;

	public function __construct(
		private LoggerInterface $logger,
	) {
	}

	/**
	 * @param array<string, scalar|null> $context
	 * @param callable(): HttpResponse $call
	 */
	public function observe(string $endpoint, array $context, callable $call): HttpResponse {
		$startedAt = hrtime(true);
		try {
			$response = $call();
		} catch (\Throwable $failure) {
			$this->logger->warning('ZapSign call failed', $context + [
				'endpoint' => $endpoint,
				'durationMs' => self::elapsedMilliseconds($startedAt),
				'failure' => $failure::class,
			]);
			throw $failure;
		}
		$level = $response->statusCode >= self::FIRST_ERROR_STATUS ? LogLevel::WARNING : LogLevel::INFO;
		$this->logger->log($level, 'ZapSign call', $context + [
			'endpoint' => $endpoint,
			'status' => $response->statusCode,
			'durationMs' => self::elapsedMilliseconds($startedAt),
		]);
		return $response;
	}

	private static function elapsedMilliseconds(int $startedAt): int {
		return intdiv(hrtime(true) - $startedAt, self::NANOSECONDS_PER_MILLISECOND);
	}
}
```

`lib/ZapSign/ProviderBackoff.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign;

use OCP\AppFramework\Utility\ITimeFactory;
use OCP\ICache;
use OCP\ICacheFactory;

/**
 * Shared pause after a ZapSign 429. Tenants on one host share ZapSign's per-IP
 * limit, and every process of this tenant must respect the same pause, so it
 * lives in the distributed cache.
 */
final class ProviderBackoff {
	private const CACHE_PREFIX = 'assinaturas';
	private const CACHE_KEY = 'zapsign_paused_until';

	private ICache $cache;

	public function __construct(
		ICacheFactory $cacheFactory,
		private ITimeFactory $timeFactory,
	) {
		$this->cache = $cacheFactory->createDistributed(self::CACHE_PREFIX);
	}

	public function remainingSeconds(): int {
		$pausedUntil = (int)($this->cache->get(self::CACHE_KEY) ?? 0);
		return max(0, $pausedUntil - $this->timeFactory->getTime());
	}

	public function pauseFor(int $seconds): void {
		if ($seconds <= $this->remainingSeconds()) {
			return;
		}
		$this->cache->set(self::CACHE_KEY, $this->timeFactory->getTime() + $seconds, $seconds);
	}
}
```

`lib/ZapSign/Sleeper.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign;

interface Sleeper {
	public function sleepMicroseconds(int $microseconds): void;
}
```

`lib/ZapSign/SystemSleeper.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign;

final class SystemSleeper implements Sleeper {
	public function sleepMicroseconds(int $microseconds): void {
		usleep($microseconds);
	}
}
```

Replace the empty `register()` in `lib/AppInfo/Application.php` with the DI aliases:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\AppInfo;

use OCA\Assinaturas\ZapSign\Http\HttpTransport;
use OCA\Assinaturas\ZapSign\Http\NextcloudHttpTransport;
use OCA\Assinaturas\ZapSign\Sleeper;
use OCA\Assinaturas\ZapSign\SystemSleeper;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;

final class Application extends App implements IBootstrap {
	public const APP_ID = 'assinaturas';

	public function __construct(array $urlParams = []) {
		parent::__construct(self::APP_ID, $urlParams);
	}

	public function register(IRegistrationContext $context): void {
		$context->registerServiceAlias(HttpTransport::class, NextcloudHttpTransport::class);
		$context->registerServiceAlias(Sleeper::class, SystemSleeper::class);
	}

	public function boot(IBootContext $context): void {
	}
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'CallMonitorTest|ProviderBackoffTest'`
Expected: `OK (7 tests, …)`.

Then the full suite: `tests/env/phpunit.sh`. Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add HTTP transport, call monitor and shared ZapSign backoff"
```

---

### Task 5: ZapSign client request pipeline

**Files:**
- Create: `lib/ZapSign/Exception/ZapSignException.php`
- Create: `lib/ZapSign/Exception/ZapSignUnreachable.php`
- Create: `lib/ZapSign/Exception/ZapSignRateLimited.php`
- Create: `lib/ZapSign/Exception/ZapSignPlanRequired.php`
- Create: `lib/ZapSign/Exception/ZapSignAccessDenied.php`
- Create: `lib/ZapSign/Exception/ZapSignNotFound.php`
- Create: `lib/ZapSign/Exception/ZapSignRejectedRequest.php`
- Create: `lib/ZapSign/Exception/ZapSignServerError.php`
- Create: `lib/ZapSign/ProviderError.php`, `lib/ZapSign/PayloadReader.php`
- Create: `lib/ZapSign/Model/PlanInfo.php`
- Create: `lib/ZapSign/ZapSignClient.php` (the pipeline plus `getPlanInfo()`)
- Create: `tests/fixtures/zapsign/plan-info.json`
- Test: `tests/Unit/ZapSign/ZapSignClientTestCase.php` (abstract base)
- Test: `tests/Unit/ZapSign/ProviderErrorTest.php`
- Test: `tests/Unit/ZapSign/ZapSignClientPipelineTest.php`

**Interfaces:**
- Consumes: `HttpTransport`, `HttpRequest`, `HttpResponse`, `TransportFailure`, `CallMonitor`, `ProviderBackoff` and `Sleeper` (Task 4); `ZapSignSettings` (Task 3).
- Produces:
  - `abstract class ZapSignException extends \RuntimeException` with public readonly `?string $providerCode`. Subclasses:
    - `ZapSignUnreachable` — outcome unknown.
    - `ZapSignRateLimited` — adds `int $retryAfterSeconds` and `bool $isCooldown`.
    - `ZapSignPlanRequired` (402), `ZapSignAccessDenied` (403), `ZapSignNotFound` (404).
    - `ZapSignRejectedRequest` — other 4xx.
    - `ZapSignServerError` — 5xx on an idempotent call, after retries.
  - `ProviderError::fromBody(string): ProviderError` with `?string $code` and `string $message`.
  - `PayloadReader(array)`: `string()`, `nullableString()`, `integer()`, `boolean()`, `objects()`.
  - `PlanInfo(name, credits, status, ?currentPeriodEnd)` and `PlanInfo::fromPayload(array)`.
  - `ZapSignClient::__construct(HttpTransport, ZapSignSettings, CallMonitor, ProviderBackoff, Sleeper)`.
  - `ZapSignClient::getPlanInfo(): PlanInfo`.
  - Private pipeline `call(method, path, endpoint, ?payload, idempotent, logContext, timeoutSeconds, query): HttpResponse`, used by Tasks 6 and 7.
  - Test base `ZapSignClientTestCase` with `client(string $environment = 'sandbox'): ZapSignClient`, `fixture(string $name): array`, and protected `$transport`, `$sleeper`, `$logger`, `$backoff`, `$now`.

- [ ] **Step 1: Write the fixture and the test base**

`tests/fixtures/zapsign/plan-info.json`:
```json
{
	"name": "API Sandbox",
	"number_of_credits": 1000,
	"status": "paid",
	"period": "monthly",
	"current_period_end": "2026-10-28"
}
```

`tests/Unit/ZapSign/ZapSignClientTestCase.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\ZapSign;

use OC\Memcache\ArrayCache;
use OCA\Assinaturas\Tests\Fakes\FakeHttpTransport;
use OCA\Assinaturas\Tests\Fakes\RecordingLogger;
use OCA\Assinaturas\Tests\Fakes\RecordingSleeper;
use OCA\Assinaturas\ZapSign\CallMonitor;
use OCA\Assinaturas\ZapSign\ProviderBackoff;
use OCA\Assinaturas\ZapSign\ZapSignClient;
use OCA\Assinaturas\ZapSign\ZapSignSettings;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IAppConfig;
use OCP\ICacheFactory;
use PHPUnit\Framework\TestCase;

abstract class ZapSignClientTestCase extends TestCase {
	protected const SANDBOX_BASE_URL = 'https://sandbox.api.zapsign.com.br/api/v1';
	protected const API_TOKEN = 'sandbox-test-token';

	protected FakeHttpTransport $transport;
	protected RecordingSleeper $sleeper;
	protected RecordingLogger $logger;
	protected ProviderBackoff $backoff;
	protected int $now = 1_790_000_000;

	protected function setUp(): void {
		$this->transport = new FakeHttpTransport();
		$this->sleeper = new RecordingSleeper();
		$this->logger = new RecordingLogger();
		$cacheFactory = $this->createMock(ICacheFactory::class);
		$cacheFactory->method('createDistributed')->willReturn(new ArrayCache(''));
		$timeFactory = $this->createMock(ITimeFactory::class);
		$timeFactory->method('getTime')->willReturnCallback(fn (): int => $this->now);
		$this->backoff = new ProviderBackoff($cacheFactory, $timeFactory);
	}

	protected function client(string $environment = 'sandbox'): ZapSignClient {
		$values = [
			ZapSignSettings::KEY_API_TOKEN => self::API_TOKEN,
			ZapSignSettings::KEY_ENVIRONMENT => $environment,
			ZapSignSettings::KEY_COMPANY_NAME => 'Construtora Exemplo',
		];
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueString')->willReturnCallback(fn (string $app, string $key): string => $values[$key] ?? '');
		return new ZapSignClient($this->transport, new ZapSignSettings($appConfig), new CallMonitor($this->logger), $this->backoff, $this->sleeper);
	}

	/** @return array<mixed> */
	protected static function fixture(string $name): array {
		$contents = (string)file_get_contents(__DIR__ . '/../../fixtures/zapsign/' . $name . '.json');
		return json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
	}
}
```

- [ ] **Step 2: Write the failing tests**

`tests/Unit/ZapSign/ProviderErrorTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\ZapSign;

use OCA\Assinaturas\ZapSign\ProviderError;
use PHPUnit\Framework\TestCase;

final class ProviderErrorTest extends TestCase {
	public function testReadsTheDetailKey(): void {
		$error = ProviderError::fromBody('{"detail":"Não encontrado."}');

		$this->assertSame('Não encontrado.', $error->message);
		$this->assertNull($error->code);
	}

	public function testTreatsASnakeCaseMessageAsTheCode(): void {
		$error = ProviderError::fromBody('{"error":"document_already_signed"}');

		$this->assertSame('document_already_signed', $error->code);
	}

	public function testPrefersAnExplicitCodeKey(): void {
		$error = ProviderError::fromBody('{"message":"Aguarde antes de reenviar.","code":"cooldown_period"}');

		$this->assertSame('cooldown_period', $error->code);
		$this->assertSame('Aguarde antes de reenviar.', $error->message);
	}

	public function testReadsNonFieldErrors(): void {
		$error = ProviderError::fromBody('{"non_field_errors":["Signatário inválido."]}');

		$this->assertSame('Signatário inválido.', $error->message);
	}

	public function testFallsBackToAPlainTextBody(): void {
		$error = ProviderError::fromBody('Status updated successfully');

		$this->assertSame('Status updated successfully', $error->message);
	}

	public function testTruncatesLongBodies(): void {
		$error = ProviderError::fromBody(str_repeat('x', 1000));

		$this->assertSame(300, mb_strlen($error->message));
	}
}
```

`tests/Unit/ZapSign/ZapSignClientPipelineTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\ZapSign;

use OCA\Assinaturas\ZapSign\Exception\ZapSignAccessDenied;
use OCA\Assinaturas\ZapSign\Exception\ZapSignNotFound;
use OCA\Assinaturas\ZapSign\Exception\ZapSignPlanRequired;
use OCA\Assinaturas\ZapSign\Exception\ZapSignRateLimited;
use OCA\Assinaturas\ZapSign\Exception\ZapSignRejectedRequest;
use OCA\Assinaturas\ZapSign\Exception\ZapSignServerError;
use OCA\Assinaturas\ZapSign\Http\TransportFailure;

final class ZapSignClientPipelineTest extends ZapSignClientTestCase {
	public function testSendsTheBearerTokenToTheSandboxApi(): void {
		$this->transport->willRespond(200, self::fixture('plan-info'));

		$plan = $this->client()->getPlanInfo();

		$request = $this->transport->requests[0];
		$this->assertSame('GET', $request->method);
		$this->assertSame(self::SANDBOX_BASE_URL . '/info-plan', $request->url);
		$this->assertSame('Bearer ' . self::API_TOKEN, $request->headers['Authorization']);
		$this->assertSame('application/json', $request->headers['Accept']);
		$this->assertStringStartsWith('AvuzConecta-Assinaturas/', $request->headers['User-Agent']);
		$this->assertNull($request->body);
		$this->assertSame('API Sandbox', $plan->name);
		$this->assertSame(1000, $plan->credits);
		$this->assertSame('paid', $plan->status);
		$this->assertSame('2026-10-28', $plan->currentPeriodEnd);
	}

	public function testUsesTheProductionApiWhenConfigured(): void {
		$this->transport->willRespond(200, self::fixture('plan-info'));

		$this->client('production')->getPlanInfo();

		$this->assertSame('https://api.zapsign.com.br/api/v1/info-plan', $this->transport->requests[0]->url);
	}

	public function testRetriesAnIdempotentCallAfterAServerError(): void {
		$this->transport->willRespond(503, 'Service Unavailable')->willRespond(200, self::fixture('plan-info'));

		$plan = $this->client()->getPlanInfo();

		$this->assertSame('API Sandbox', $plan->name);
		$this->assertCount(2, $this->transport->requests);
		$this->assertCount(1, $this->sleeper->sleptMicroseconds);
	}

	public function testRetriesAnIdempotentCallAfterATransportFailure(): void {
		$this->transport->willFail(new TransportFailure('timeout'))->willRespond(200, self::fixture('plan-info'));

		$this->client()->getPlanInfo();

		$this->assertCount(2, $this->transport->requests);
	}

	public function testGivesUpAfterThreeServerErrors(): void {
		$this->transport->willRespond(502, 'Bad Gateway')->willRespond(502, 'Bad Gateway')->willRespond(502, 'Bad Gateway');

		$this->expectException(ZapSignServerError::class);
		try {
			$this->client()->getPlanInfo();
		} finally {
			$this->assertCount(3, $this->transport->requests);
		}
	}

	/** @dataProvider clientErrors */
	public function testMapsClientErrorsToTypedExceptions(int $statusCode, string $body, string $expectedException, ?string $expectedCode): void {
		$this->transport->willRespond($statusCode, $body);

		try {
			$this->client()->getPlanInfo();
			$this->fail('Expected ' . $expectedException);
		} catch (\Throwable $failure) {
			$this->assertInstanceOf($expectedException, $failure);
			$this->assertSame($expectedCode, $failure->providerCode);
		}
		$this->assertCount(1, $this->transport->requests);
	}

	/** @return array<string, array{int, string, class-string, ?string}> */
	public static function clientErrors(): array {
		return [
			'no API plan' => [402, '{"detail":"Payment Required"}', ZapSignPlanRequired::class, null],
			'wrong environment token' => [403, '{"detail":"Invalid token."}', ZapSignAccessDenied::class, null],
			'already signed' => [403, '{"error":"document_already_signed"}', ZapSignAccessDenied::class, 'document_already_signed'],
			'not found' => [404, '{"detail":"Not found."}', ZapSignNotFound::class, null],
			'validation' => [400, '{"error":"missing_rejected_reason"}', ZapSignRejectedRequest::class, 'missing_rejected_reason'],
		];
	}

	public function testPausesEveryCallerAfterARateLimit(): void {
		$this->transport->willRespond(429, '{"detail":"Request was throttled."}', ['retry-after' => '45']);

		try {
			$this->client()->getPlanInfo();
			$this->fail('Expected a rate limit');
		} catch (ZapSignRateLimited $failure) {
			$this->assertSame(45, $failure->retryAfterSeconds);
			$this->assertFalse($failure->isCooldown);
		}
		$this->assertSame(45, $this->backoff->remainingSeconds());
	}

	public function testRefusesToCallZapSignWhileThePauseIsActive(): void {
		$this->backoff->pauseFor(30);

		$this->expectException(ZapSignRateLimited::class);
		try {
			$this->client()->getPlanInfo();
		} finally {
			$this->assertCount(0, $this->transport->requests);
		}
	}

	public function testDoesNotPauseEveryoneForAPerSignerCooldown(): void {
		$this->transport->willRespond(429, '{"error":"cooldown_period"}');

		try {
			$this->client()->getPlanInfo();
			$this->fail('Expected a cooldown');
		} catch (ZapSignRateLimited $failure) {
			$this->assertTrue($failure->isCooldown);
		}
		$this->assertSame(0, $this->backoff->remainingSeconds());
	}

	public function testDefaultsTheRetryAfterWhenTheHeaderIsMissing(): void {
		$this->transport->willRespond(429, '{"detail":"Request was throttled."}');

		try {
			$this->client()->getPlanInfo();
			$this->fail('Expected a rate limit');
		} catch (ZapSignRateLimited $failure) {
			$this->assertSame(60, $failure->retryAfterSeconds);
		}
	}

	public function testNeverLogsTheApiToken(): void {
		$this->transport->willRespond(200, self::fixture('plan-info'));

		$this->client()->getPlanInfo();

		$this->assertStringNotContainsString(self::API_TOKEN, $this->logger->serialized());
		$this->assertSame('GET /info-plan', $this->logger->records[0]['context']['endpoint']);
	}
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter 'ProviderErrorTest|ZapSignClientPipelineTest'`
Expected: ERROR `Class "OCA\Assinaturas\ZapSign\ProviderError" not found`.

- [ ] **Step 4: Implement the exceptions**

`lib/ZapSign/Exception/ZapSignException.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Exception;

abstract class ZapSignException extends \RuntimeException {
	public function __construct(
		string $message,
		public readonly ?string $providerCode = null,
		?\Throwable $previous = null,
	) {
		parent::__construct($message, 0, $previous);
	}
}
```

`lib/ZapSign/Exception/ZapSignUnreachable.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Exception;

/** No usable response: for non-idempotent calls the outcome at ZapSign is unknown. */
final class ZapSignUnreachable extends ZapSignException {
}
```

`lib/ZapSign/Exception/ZapSignRateLimited.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Exception;

final class ZapSignRateLimited extends ZapSignException {
	public function __construct(
		string $message,
		public readonly int $retryAfterSeconds,
		public readonly bool $isCooldown,
		?string $providerCode = null,
	) {
		parent::__construct($message, $providerCode);
	}
}
```

`lib/ZapSign/Exception/ZapSignPlanRequired.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Exception;

final class ZapSignPlanRequired extends ZapSignException {
}
```

`lib/ZapSign/Exception/ZapSignAccessDenied.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Exception;

final class ZapSignAccessDenied extends ZapSignException {
}
```

`lib/ZapSign/Exception/ZapSignNotFound.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Exception;

final class ZapSignNotFound extends ZapSignException {
}
```

`lib/ZapSign/Exception/ZapSignRejectedRequest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Exception;

final class ZapSignRejectedRequest extends ZapSignException {
}
```

`lib/ZapSign/Exception/ZapSignServerError.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Exception;

final class ZapSignServerError extends ZapSignException {
}
```

- [ ] **Step 5: Implement the error parser, payload reader and plan model**

`lib/ZapSign/ProviderError.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign;

/** Normalizes ZapSign's non-uniform error bodies: detail | message | error | non_field_errors | plain text. */
final class ProviderError {
	private const MESSAGE_KEYS = ['detail', 'message', 'error'];
	private const MAX_MESSAGE_LENGTH = 300;
	private const CODE_PATTERN = '/^[a-z][a-z_]+$/';

	private function __construct(
		public readonly ?string $code,
		public readonly string $message,
	) {
	}

	public static function fromBody(string $body): self {
		$decoded = json_decode($body, true);
		if (!is_array($decoded)) {
			return self::fromMessage(trim($body), null);
		}
		$explicitCode = is_string($decoded['code'] ?? null) ? $decoded['code'] : null;
		foreach (self::MESSAGE_KEYS as $key) {
			$value = $decoded[$key] ?? null;
			if (is_string($value) && $value !== '') {
				return self::fromMessage($value, $explicitCode);
			}
		}
		$nonFieldError = $decoded['non_field_errors'][0] ?? null;
		if (is_string($nonFieldError)) {
			return self::fromMessage($nonFieldError, $explicitCode);
		}
		return self::fromMessage($body, $explicitCode);
	}

	private static function fromMessage(string $message, ?string $explicitCode): self {
		$truncated = mb_substr($message, 0, self::MAX_MESSAGE_LENGTH);
		if ($explicitCode !== null) {
			return new self($explicitCode, $truncated);
		}
		$looksLikeCode = preg_match(self::CODE_PATTERN, $truncated) === 1;
		return new self($looksLikeCode ? $truncated : null, $truncated);
	}
}
```

`lib/ZapSign/PayloadReader.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign;

/** Tolerant typed access to ZapSign JSON: missing or mistyped keys fall back to defaults. */
final class PayloadReader {
	/** @param array<mixed> $payload */
	public function __construct(
		private array $payload,
	) {
	}

	public function string(string $key, string $default = ''): string {
		$value = $this->payload[$key] ?? null;
		return is_scalar($value) ? (string)$value : $default;
	}

	public function nullableString(string $key): ?string {
		$value = $this->payload[$key] ?? null;
		return is_scalar($value) && $value !== '' ? (string)$value : null;
	}

	public function integer(string $key, int $default = 0): int {
		$value = $this->payload[$key] ?? null;
		return is_numeric($value) ? (int)$value : $default;
	}

	public function boolean(string $key, bool $default = false): bool {
		$value = $this->payload[$key] ?? null;
		return is_bool($value) ? $value : $default;
	}

	/** @return list<array<mixed>> */
	public function objects(string $key): array {
		$value = $this->payload[$key] ?? null;
		return is_array($value) ? array_values(array_filter($value, 'is_array')) : [];
	}
}
```

`lib/ZapSign/Model/PlanInfo.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Model;

use OCA\Assinaturas\ZapSign\PayloadReader;

final class PlanInfo {
	public function __construct(
		public readonly string $name,
		public readonly int $credits,
		public readonly string $status,
		public readonly ?string $currentPeriodEnd,
	) {
	}

	/** @param array<mixed> $payload */
	public static function fromPayload(array $payload): self {
		$reader = new PayloadReader($payload);
		return new self(
			$reader->string('name'),
			$reader->integer('number_of_credits'),
			$reader->string('status'),
			$reader->nullableString('current_period_end'),
		);
	}
}
```

- [ ] **Step 6: Implement the client pipeline**

`lib/ZapSign/ZapSignClient.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign;

use OCA\Assinaturas\ZapSign\Exception\ZapSignAccessDenied;
use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use OCA\Assinaturas\ZapSign\Exception\ZapSignNotFound;
use OCA\Assinaturas\ZapSign\Exception\ZapSignPlanRequired;
use OCA\Assinaturas\ZapSign\Exception\ZapSignRateLimited;
use OCA\Assinaturas\ZapSign\Exception\ZapSignRejectedRequest;
use OCA\Assinaturas\ZapSign\Exception\ZapSignServerError;
use OCA\Assinaturas\ZapSign\Exception\ZapSignUnreachable;
use OCA\Assinaturas\ZapSign\Http\HttpRequest;
use OCA\Assinaturas\ZapSign\Http\HttpResponse;
use OCA\Assinaturas\ZapSign\Http\HttpTransport;
use OCA\Assinaturas\ZapSign\Http\TransportFailure;
use OCA\Assinaturas\ZapSign\Model\PlanInfo;

/**
 * The only unit that speaks ZapSign. Idempotent calls retry on 5xx/transport
 * failures; non-idempotent calls never retry, and a 5xx or transport failure on
 * them surfaces as ZapSignUnreachable (outcome unknown), so callers look up
 * before re-creating.
 */
final class ZapSignClient {
	private const USER_AGENT = 'AvuzConecta-Assinaturas/0.1';
	private const DEFAULT_TIMEOUT_SECONDS = 20;
	private const MAX_IDEMPOTENT_ATTEMPTS = 3;
	private const RETRY_DELAYS_MICROSECONDS = [500_000, 1_500_000];
	private const DEFAULT_RETRY_AFTER_SECONDS = 60;
	private const COOLDOWN_CODE = 'cooldown_period';
	private const RATE_LIMITED_STATUS = 429;
	private const FIRST_ERROR_STATUS = 400;
	private const FIRST_SERVER_ERROR_STATUS = 500;
	private const EXCEPTIONS_BY_STATUS = [
		402 => ZapSignPlanRequired::class,
		403 => ZapSignAccessDenied::class,
		404 => ZapSignNotFound::class,
	];

	public function __construct(
		private HttpTransport $transport,
		private ZapSignSettings $settings,
		private CallMonitor $monitor,
		private ProviderBackoff $backoff,
		private Sleeper $sleeper,
	) {
	}

	public function getPlanInfo(): PlanInfo {
		$response = $this->call('GET', '/info-plan', 'GET /info-plan', null, true);
		return PlanInfo::fromPayload(self::decode($response));
	}

	/**
	 * @param array<string, mixed>|null $payload
	 * @param array<string, scalar|null> $logContext
	 * @param array<string, string> $query
	 * @throws ZapSignException
	 */
	private function call(
		string $method,
		string $path,
		string $endpoint,
		?array $payload,
		bool $idempotent,
		array $logContext = [],
		int $timeoutSeconds = self::DEFAULT_TIMEOUT_SECONDS,
		array $query = [],
	): HttpResponse {
		$pausedSeconds = $this->backoff->remainingSeconds();
		if ($pausedSeconds > 0) {
			throw new ZapSignRateLimited('ZapSign backoff active', $pausedSeconds, false);
		}
		$request = $this->buildRequest($method, $path, $payload, $timeoutSeconds, $query);
		$maxAttempts = $idempotent ? self::MAX_IDEMPOTENT_ATTEMPTS : 1;
		$attempt = 1;
		while (true) {
			$outcome = $this->attempt($request, $endpoint, $logContext, $idempotent);
			if ($outcome instanceof HttpResponse) {
				return $outcome;
			}
			$isRetryable = $outcome instanceof ZapSignServerError || ($idempotent && $outcome instanceof ZapSignUnreachable);
			if (!$isRetryable || $attempt >= $maxAttempts) {
				throw $outcome;
			}
			$this->sleeper->sleepMicroseconds(self::RETRY_DELAYS_MICROSECONDS[$attempt - 1]);
			$attempt++;
		}
	}

	/** @param array<string, scalar|null> $logContext */
	private function attempt(HttpRequest $request, string $endpoint, array $logContext, bool $idempotent): HttpResponse|ZapSignException {
		try {
			$response = $this->monitor->observe($endpoint, $logContext, fn (): HttpResponse => $this->transport->send($request));
		} catch (TransportFailure $transportFailure) {
			return new ZapSignUnreachable('ZapSign unreachable', null, $transportFailure);
		}
		if ($response->statusCode < self::FIRST_ERROR_STATUS) {
			return $response;
		}
		$failure = $this->toException($response, $idempotent);
		if ($failure instanceof ZapSignRateLimited && !$failure->isCooldown) {
			$this->backoff->pauseFor($failure->retryAfterSeconds);
		}
		return $failure;
	}

	private function toException(HttpResponse $response, bool $idempotent): ZapSignException {
		$error = ProviderError::fromBody($response->body);
		if ($response->statusCode === self::RATE_LIMITED_STATUS) {
			$retryAfter = (int)($response->headers['retry-after'] ?? 0);
			return new ZapSignRateLimited(
				$error->message,
				$retryAfter > 0 ? $retryAfter : self::DEFAULT_RETRY_AFTER_SECONDS,
				$error->code === self::COOLDOWN_CODE,
				$error->code,
			);
		}
		if ($response->statusCode >= self::FIRST_SERVER_ERROR_STATUS) {
			return $idempotent
				? new ZapSignServerError($error->message, $error->code)
				: new ZapSignUnreachable('ZapSign outcome unknown after HTTP ' . $response->statusCode, $error->code);
		}
		$exceptionClass = self::EXCEPTIONS_BY_STATUS[$response->statusCode] ?? ZapSignRejectedRequest::class;
		return new $exceptionClass($error->message, $error->code);
	}

	/**
	 * @param array<string, mixed>|null $payload
	 * @param array<string, string> $query
	 */
	private function buildRequest(string $method, string $path, ?array $payload, int $timeoutSeconds, array $query): HttpRequest {
		$queryString = $query === [] ? '' : '?' . http_build_query($query);
		$url = $this->settings->environment()->apiBaseUrl() . $path . $queryString;
		$headers = [
			'Authorization' => 'Bearer ' . $this->settings->apiToken(),
			'Accept' => 'application/json',
			'User-Agent' => self::USER_AGENT,
		];
		if ($payload === null) {
			return new HttpRequest($method, $url, $headers, null, $timeoutSeconds);
		}
		$body = json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
		return new HttpRequest($method, $url, $headers + ['Content-Type' => 'application/json'], $body, $timeoutSeconds);
	}

	/** @return array<mixed> */
	private static function decode(HttpResponse $response): array {
		$decoded = json_decode($response->body, true);
		return is_array($decoded) ? $decoded : [];
	}
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'ProviderErrorTest|ZapSignClientPipelineTest'`
Expected: `OK (21 tests, …)`.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: add ZapSign client pipeline with typed errors, retry policy and shared backoff"
```

---

### Task 6: Document operations and response models

**Files:**
- Create: `lib/ZapSign/ZapSignDateFormat.php`
- Create: `lib/ZapSign/Payload/Branding.php`, `lib/ZapSign/Payload/NewSigner.php`, `lib/ZapSign/Payload/NewDocument.php`
- Create: `lib/ZapSign/Model/ZapSignSigner.php`, `lib/ZapSign/Model/ZapSignExtraDocument.php`, `lib/ZapSign/Model/ZapSignDocument.php`, `lib/ZapSign/Model/ZapSignDocumentPage.php`, `lib/ZapSign/Model/ActivityLogPdf.php`
- Modify: `lib/ZapSign/ZapSignClient.php` (add the document methods)
- Create: `tests/fixtures/zapsign/document-created.json`, `document-signed.json`, `documents-page.json`, `documents-list.json`, `extra-document-created.json`
- Test: `tests/Unit/ZapSign/ZapSignClientDocumentsTest.php`

**Interfaces:**
- Consumes: the `ZapSignClient` pipeline, `PayloadReader`, and the exceptions (Task 5).
- Produces:
  - `ZapSignDateFormat::format(\DateTimeImmutable): string`, which returns UTC `Y-m-d\TH:i:s.u\Z`.
  - `Branding(string $name, string $logoUrl, string $primaryColor)` with `toPayload(): array`. Empty values are omitted.
  - `NewSigner(string $name, string $email, int $orderGroup, string $externalId, string $message = '')` with `toPayload(): array`. The payload always has `send_automatic_email=false` and `send_automatic_whatsapp=false`, plus `lock_name` and `lock_email`.
  - `NewDocument(string $name, string $base64Pdf, string $externalId, string $folderPath, list<NewSigner> $signers, bool $signingOrder, ?\DateTimeImmutable $deadline, Branding $branding)` with `toPayload(): array`. The payload always has `allow_refuse_signature=true` and `lang=pt-br`.
  - Models:
    - `ZapSignSigner` — `token`, `name`, `email`, `status`, `?signedAt`, `?signUrl`, `externalId`.
    - `ZapSignExtraDocument` — `token`, `name`, `?signedFileUrl`, `?originalFileUrl`.
    - `ZapSignDocument` — `token`, `name`, `status`, `deleted`, `?signedFileUrl`, `?originalFileUrl`, `?rejectedReason`, `?lastUpdateAt`, `folderPath`, `externalId`, `list<ZapSignSigner> signers`, `list<ZapSignExtraDocument> extraDocuments`.
    - `ZapSignDocumentPage` — `list<ZapSignDocument> documents`, `bool hasNextPage`.
    - `ActivityLogPdf` — `contentType`, `bytes`.
    - Each model has a static `fromPayload(array)`.
  - `ZapSignClient` methods:
    - `createDocument(NewDocument): ZapSignDocument` — never retried.
    - `uploadExtraDocument(string $documentToken, string $name, string $base64Pdf): ZapSignExtraDocument` — never retried.
    - `getDocument(string): ZapSignDocument`.
    - `findDocumentsByFolder(string $folderPath): list<ZapSignDocument>`.
    - `listDocumentsWithSigners(int $page, ?string $status = null): ZapSignDocumentPage`.
    - `updateDeadline(string $documentToken, \DateTimeImmutable): void`.
    - `cancelDocument(string $documentToken, string $reason, bool $notifySigners): void` — never retried.
    - `getActivityLog(string $documentToken): ActivityLogPdf`.

- [ ] **Step 1: Write the fixtures**

These are **provisional** shapes taken from the docs. Task 9 adds recorded sandbox responses and a test that parses them.

`tests/fixtures/zapsign/document-created.json`:
```json
{
	"sandbox": true,
	"external_id": "0f8fad5b-d9cb-469f-a165-70867728950e",
	"open_id": 42,
	"token": "b7f0c0de-1111-4a2b-9c3d-aaaaaaaaaaaa",
	"name": "Contrato de prestação de serviços",
	"folder_path": "/assinaturas/0f8fad5b-d9cb-469f-a165-70867728950e",
	"status": "pending",
	"rejected_reason": null,
	"lang": "pt-br",
	"original_file": "https://zapsign.s3.amazonaws.com/sandbox/original.pdf?X-Amz-Expires=3600",
	"signed_file": null,
	"extra_docs": [],
	"created_through": "api",
	"deleted": false,
	"deleted_at": null,
	"brand_primary_color": "#2bb5e3",
	"created_at": "2026-09-28T13:00:00.000000Z",
	"last_update_at": "2026-09-28T13:00:00.000000Z",
	"signers": [
		{
			"token": "5a1e0000-aaaa-4bbb-8ccc-000000000001",
			"sign_url": "https://sandbox.app.zapsign.com.br/verificar/5a1e0000-aaaa-4bbb-8ccc-000000000001",
			"status": "new",
			"name": "Ana Lima",
			"email": "ana@example.com",
			"external_id": "signer-1",
			"signed_at": null
		},
		{
			"token": "5a1e0000-aaaa-4bbb-8ccc-000000000002",
			"sign_url": "https://sandbox.app.zapsign.com.br/verificar/5a1e0000-aaaa-4bbb-8ccc-000000000002",
			"status": "new",
			"name": "Bruno Souza",
			"email": "bruno@example.com",
			"external_id": "signer-2",
			"signed_at": null
		}
	]
}
```

`tests/fixtures/zapsign/document-signed.json`:
```json
{
	"external_id": "0f8fad5b-d9cb-469f-a165-70867728950e",
	"token": "b7f0c0de-1111-4a2b-9c3d-aaaaaaaaaaaa",
	"name": "Contrato de prestação de serviços",
	"folder_path": "/assinaturas/0f8fad5b-d9cb-469f-a165-70867728950e",
	"status": "signed",
	"rejected_reason": null,
	"original_file": "https://zapsign.s3.amazonaws.com/sandbox/original.pdf?X-Amz-Expires=3600",
	"signed_file": "https://zapsign.s3.amazonaws.com/sandbox/signed.pdf?X-Amz-Expires=3600",
	"deleted": false,
	"last_update_at": "2026-09-28T15:30:00.000000Z",
	"extra_docs": [
		{
			"token": "e0e0e0e0-2222-4a2b-9c3d-bbbbbbbbbbbb",
			"name": "Anexo I",
			"original_file": "https://zapsign.s3.amazonaws.com/sandbox/anexo.pdf?X-Amz-Expires=3600",
			"signed_file": "https://zapsign.s3.amazonaws.com/sandbox/anexo-signed.pdf?X-Amz-Expires=3600"
		}
	],
	"signers": [
		{
			"token": "5a1e0000-aaaa-4bbb-8ccc-000000000001",
			"status": "signed",
			"name": "Ana Lima",
			"email": "ana@example.com",
			"external_id": "signer-1",
			"signed_at": "2026-09-28T14:00:00.000000Z"
		}
	]
}
```

`tests/fixtures/zapsign/documents-page.json`:
```json
{
	"count": 1,
	"next": "https://sandbox.api.zapsign.com.br/api/v1/docs/?page=2",
	"previous": null,
	"results": [
		{
			"token": "b7f0c0de-1111-4a2b-9c3d-aaaaaaaaaaaa",
			"name": "Contrato de prestação de serviços",
			"status": "pending",
			"folder_path": "/assinaturas/0f8fad5b-d9cb-469f-a165-70867728950e",
			"signers": [
				{"token": "5a1e0000-aaaa-4bbb-8ccc-000000000001", "status": "abriu", "name": "Ana Lima", "email": "ana@example.com"}
			]
		}
	]
}
```

`tests/fixtures/zapsign/documents-list.json`:
```json
[
	{
		"token": "b7f0c0de-1111-4a2b-9c3d-aaaaaaaaaaaa",
		"name": "Contrato de prestação de serviços",
		"status": "refused",
		"folder_path": "/assinaturas/0f8fad5b-d9cb-469f-a165-70867728950e",
		"signers": [
			{"token": "5a1e0000-aaaa-4bbb-8ccc-000000000001", "status": "recusou", "name": "Ana Lima", "email": "ana@example.com"}
		]
	}
]
```

`tests/fixtures/zapsign/extra-document-created.json`:
```json
{
	"token": "e0e0e0e0-2222-4a2b-9c3d-bbbbbbbbbbbb",
	"name": "Anexo I",
	"original_file": "https://zapsign.s3.amazonaws.com/sandbox/anexo.pdf?X-Amz-Expires=3600",
	"signed_file": null
}
```

- [ ] **Step 2: Write the failing tests**

`tests/Unit/ZapSign/ZapSignClientDocumentsTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\ZapSign;

use OCA\Assinaturas\ZapSign\Exception\ZapSignServerError;
use OCA\Assinaturas\ZapSign\Exception\ZapSignUnreachable;
use OCA\Assinaturas\ZapSign\Http\TransportFailure;
use OCA\Assinaturas\ZapSign\Payload\Branding;
use OCA\Assinaturas\ZapSign\Payload\NewDocument;
use OCA\Assinaturas\ZapSign\Payload\NewSigner;

final class ZapSignClientDocumentsTest extends ZapSignClientTestCase {
	private const DOCUMENT_TOKEN = 'b7f0c0de-1111-4a2b-9c3d-aaaaaaaaaaaa';

	public function testCreatesADocumentWithSignerEmailsHeldBack(): void {
		$this->transport->willRespond(200, self::fixture('document-created'));

		$document = $this->client()->createDocument($this->newDocument(new \DateTimeImmutable('2026-10-15 23:59:59', new \DateTimeZone('America/Sao_Paulo'))));

		$request = $this->transport->requests[0];
		$this->assertSame('POST', $request->method);
		$this->assertSame(self::SANDBOX_BASE_URL . '/docs/', $request->url);
		$this->assertSame('application/json', $request->headers['Content-Type']);
		$payload = $this->transport->lastRequestJson();
		$this->assertSame('JVBERi0xLjcK', $payload['base64_pdf']);
		$this->assertSame('0f8fad5b-d9cb-469f-a165-70867728950e', $payload['external_id']);
		$this->assertSame('/assinaturas/0f8fad5b-d9cb-469f-a165-70867728950e', $payload['folder_path']);
		$this->assertTrue($payload['signature_order_active']);
		$this->assertTrue($payload['allow_refuse_signature']);
		$this->assertSame('pt-br', $payload['lang']);
		$this->assertSame('Avuz Conecta', $payload['brand_name']);
		$this->assertSame('#2bb5e3', $payload['brand_primary_color']);
		$this->assertArrayNotHasKey('brand_logo', $payload);
		$this->assertArrayNotHasKey('disable_signer_emails', $payload);
		$this->assertSame('2026-10-16T02:59:59.000000Z', $payload['date_limit_to_sign']);
		$this->assertFalse($payload['signers'][0]['send_automatic_email']);
		$this->assertFalse($payload['signers'][0]['send_automatic_whatsapp']);
		$this->assertTrue($payload['signers'][0]['lock_email']);
		$this->assertSame(2, $payload['signers'][1]['order_group']);
		$this->assertSame('Maria Souza, da Construtora Exemplo, enviou documentos para sua assinatura.', $payload['signers'][0]['custom_message']);
		$this->assertSame(self::DOCUMENT_TOKEN, $document->token);
		$this->assertSame('pending', $document->status);
		$this->assertSame('5a1e0000-aaaa-4bbb-8ccc-000000000002', $document->signers[1]->token);
		$this->assertSame('https://sandbox.app.zapsign.com.br/verificar/5a1e0000-aaaa-4bbb-8ccc-000000000001', $document->signers[0]->signUrl);
	}

	public function testOmitsTheDeadlineInsteadOfSendingNull(): void {
		$this->transport->willRespond(200, self::fixture('document-created'));

		$this->client()->createDocument($this->newDocument(null));

		$payload = $this->transport->lastRequestJson();
		$this->assertArrayNotHasKey('date_limit_to_sign', $payload);
		$this->assertNotContains(null, $payload);
	}

	public function testNeverRetriesCreationAfterATimeout(): void {
		$this->transport->willFail(new TransportFailure('timeout'));

		$this->expectException(ZapSignUnreachable::class);
		try {
			$this->client()->createDocument($this->newDocument(null));
		} finally {
			$this->assertCount(1, $this->transport->requests);
		}
	}

	public function testTreatsAGatewayErrorOnCreationAsAnUnknownOutcome(): void {
		$this->transport->willRespond(502, 'Bad Gateway');

		$this->expectException(ZapSignUnreachable::class);
		try {
			$this->client()->createDocument($this->newDocument(null));
		} finally {
			$this->assertCount(1, $this->transport->requests);
		}
	}

	public function testUploadsAnExtraDocumentWithoutRetrying(): void {
		$this->transport->willRespond(200, self::fixture('extra-document-created'));

		$extraDocument = $this->client()->uploadExtraDocument(self::DOCUMENT_TOKEN, 'Anexo I', 'JVBERi0xLjcK');

		$this->assertSame(self::SANDBOX_BASE_URL . '/docs/' . self::DOCUMENT_TOKEN . '/upload-extra-doc/', $this->transport->requests[0]->url);
		$this->assertSame(['name' => 'Anexo I', 'base64_pdf' => 'JVBERi0xLjcK'], $this->transport->lastRequestJson());
		$this->assertSame('e0e0e0e0-2222-4a2b-9c3d-bbbbbbbbbbbb', $extraDocument->token);
	}

	public function testNeverRetriesAnExtraDocumentUploadAfterAServerError(): void {
		$this->transport->willRespond(500, 'Internal Server Error');

		$this->expectException(ZapSignUnreachable::class);
		try {
			$this->client()->uploadExtraDocument(self::DOCUMENT_TOKEN, 'Anexo I', 'JVBERi0xLjcK');
		} finally {
			$this->assertCount(1, $this->transport->requests);
		}
	}

	public function testReadsASignedEnvelopeWithItsExtraDocuments(): void {
		$this->transport->willRespond(200, self::fixture('document-signed'));

		$document = $this->client()->getDocument(self::DOCUMENT_TOKEN);

		$this->assertSame(self::SANDBOX_BASE_URL . '/docs/' . self::DOCUMENT_TOKEN . '/', $this->transport->requests[0]->url);
		$this->assertSame('signed', $document->status);
		$this->assertFalse($document->deleted);
		$this->assertStringContainsString('signed.pdf', (string)$document->signedFileUrl);
		$this->assertSame('e0e0e0e0-2222-4a2b-9c3d-bbbbbbbbbbbb', $document->extraDocuments[0]->token);
		$this->assertStringContainsString('anexo-signed.pdf', (string)$document->extraDocuments[0]->signedFileUrl);
		$this->assertSame('2026-09-28T14:00:00.000000Z', $document->signers[0]->signedAt);
	}

	public function testRetriesReadingADocumentAfterAServerError(): void {
		$this->transport->willRespond(503, 'Service Unavailable')->willRespond(200, self::fixture('document-signed'));

		$this->client()->getDocument(self::DOCUMENT_TOKEN);

		$this->assertCount(2, $this->transport->requests);
	}

	public function testFindsDocumentsByFolderInThePaginatedShape(): void {
		$this->transport->willRespond(200, self::fixture('documents-page'));

		$documents = $this->client()->findDocumentsByFolder('/assinaturas/0f8fad5b-d9cb-469f-a165-70867728950e');

		$url = $this->transport->requests[0]->url;
		$this->assertStringStartsWith(self::SANDBOX_BASE_URL . '/docs/?', $url);
		$this->assertStringContainsString('folder_path=%2Fassinaturas%2F0f8fad5b-d9cb-469f-a165-70867728950e', $url);
		$this->assertStringContainsString('include_signers=true', $url);
		$this->assertSame(self::DOCUMENT_TOKEN, $documents[0]->token);
		$this->assertSame('abriu', $documents[0]->signers[0]->status);
	}

	public function testListsDocumentsInTheBareListShape(): void {
		$this->transport->willRespond(200, self::fixture('documents-list'));

		$page = $this->client()->listDocumentsWithSigners(1, 'refused');

		$this->assertStringContainsString('status=refused', $this->transport->requests[0]->url);
		$this->assertFalse($page->hasNextPage);
		$this->assertSame('recusou', $page->documents[0]->signers[0]->status);
	}

	public function testReportsANextPage(): void {
		$this->transport->willRespond(200, self::fixture('documents-page'));

		$this->assertTrue($this->client()->listDocumentsWithSigners(1)->hasNextPage);
	}

	public function testUpdatesTheDeadlineInUtc(): void {
		$this->transport->willRespond(200, '{}');

		$this->client()->updateDeadline(self::DOCUMENT_TOKEN, new \DateTimeImmutable('2026-11-01 23:59:59', new \DateTimeZone('America/Sao_Paulo')));

		$this->assertSame('PUT', $this->transport->requests[0]->method);
		$this->assertSame(['date_limit_to_sign' => '2026-11-02T02:59:59.000000Z'], $this->transport->lastRequestJson());
	}

	public function testCancelsWithAReasonAndNeverRetries(): void {
		$this->transport->willRespond(503, 'Service Unavailable');

		try {
			$this->client()->cancelDocument(self::DOCUMENT_TOKEN, 'Enviado por engano', true);
			$this->fail('Expected an unknown outcome');
		} catch (ZapSignUnreachable) {
		}

		$request = $this->transport->requests[0];
		$this->assertCount(1, $this->transport->requests);
		$this->assertSame(self::SANDBOX_BASE_URL . '/refuse/', $request->url);
		$this->assertStringStartsWith('AvuzConecta-Assinaturas/', $request->headers['User-Agent']);
		$this->assertSame(['doc_token' => self::DOCUMENT_TOKEN, 'rejected_reason' => 'Enviado por engano', 'notify_signer' => true], $this->transport->lastRequestJson());
	}

	public function testDownloadsTheActivityLog(): void {
		$this->transport->willRespond(200, '%PDF-1.7 activity', ['content-type' => 'application/pdf']);

		$activityLog = $this->client()->getActivityLog(self::DOCUMENT_TOKEN);

		$this->assertStringContainsString('/docs/signer-log/' . self::DOCUMENT_TOKEN, $this->transport->requests[0]->url);
		$this->assertStringContainsString('download_pdf=true', $this->transport->requests[0]->url);
		$this->assertSame('application/pdf', $activityLog->contentType);
		$this->assertSame('%PDF-1.7 activity', $activityLog->bytes);
	}

	public function testRaisesAServerErrorWhenReadsKeepFailing(): void {
		$this->transport->willRespond(500, 'x')->willRespond(500, 'x')->willRespond(500, 'x');

		$this->expectException(ZapSignServerError::class);
		$this->client()->getDocument(self::DOCUMENT_TOKEN);
	}

	private function newDocument(?\DateTimeImmutable $deadline): NewDocument {
		$message = 'Maria Souza, da Construtora Exemplo, enviou documentos para sua assinatura.';
		return new NewDocument(
			'Contrato de prestação de serviços',
			'JVBERi0xLjcK',
			'0f8fad5b-d9cb-469f-a165-70867728950e',
			'/assinaturas/0f8fad5b-d9cb-469f-a165-70867728950e',
			[
				new NewSigner('Ana Lima', 'ana@example.com', 1, 'signer-1', $message),
				new NewSigner('Bruno Souza', 'bruno@example.com', 2, 'signer-2', $message),
			],
			true,
			$deadline,
			new Branding('Avuz Conecta', '', '#2bb5e3'),
		);
	}
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter ZapSignClientDocumentsTest`
Expected: ERROR `Class "OCA\Assinaturas\ZapSign\Payload\Branding" not found`.

- [ ] **Step 4: Implement the payloads**

`lib/ZapSign/ZapSignDateFormat.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign;

final class ZapSignDateFormat {
	private const FORMAT = 'Y-m-d\TH:i:s.u\Z';

	public static function format(\DateTimeImmutable $moment): string {
		return $moment->setTimezone(new \DateTimeZone('UTC'))->format(self::FORMAT);
	}
}
```

`lib/ZapSign/Payload/Branding.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Payload;

final class Branding {
	public function __construct(
		public readonly string $name,
		public readonly string $logoUrl,
		public readonly string $primaryColor,
	) {
	}

	/** @return array<string, string> */
	public function toPayload(): array {
		$payload = [
			'brand_name' => $this->name,
			'brand_logo' => $this->logoUrl,
			'brand_primary_color' => $this->primaryColor,
		];
		return array_filter($payload, fn (string $value): bool => $value !== '');
	}
}
```

`lib/ZapSign/Payload/NewSigner.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Payload;

final class NewSigner {
	public function __construct(
		public readonly string $name,
		public readonly string $email,
		public readonly int $orderGroup,
		public readonly string $externalId,
		public readonly string $message = '',
	) {
	}

	/** @return array<string, string|int|bool> */
	public function toPayload(): array {
		$payload = [
			'name' => $this->name,
			'email' => $this->email,
			'order_group' => $this->orderGroup,
			'external_id' => $this->externalId,
			'send_automatic_email' => false,
			'send_automatic_whatsapp' => false,
			'lock_name' => true,
			'lock_email' => true,
		];
		if ($this->message === '') {
			return $payload;
		}
		return $payload + ['custom_message' => $this->message];
	}
}
```

`lib/ZapSign/Payload/NewDocument.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Payload;

use OCA\Assinaturas\ZapSign\ZapSignDateFormat;

final class NewDocument {
	private const LANGUAGE = 'pt-br';

	/** @param list<NewSigner> $signers */
	public function __construct(
		public readonly string $name,
		public readonly string $base64Pdf,
		public readonly string $externalId,
		public readonly string $folderPath,
		public readonly array $signers,
		public readonly bool $signingOrder,
		public readonly ?\DateTimeImmutable $deadline,
		public readonly Branding $branding,
	) {
	}

	/** @return array<string, mixed> */
	public function toPayload(): array {
		$payload = [
			'name' => $this->name,
			'base64_pdf' => $this->base64Pdf,
			'external_id' => $this->externalId,
			'folder_path' => $this->folderPath,
			'signers' => array_map(fn (NewSigner $signer): array => $signer->toPayload(), $this->signers),
			'signature_order_active' => $this->signingOrder,
			'allow_refuse_signature' => true,
			'lang' => self::LANGUAGE,
		] + $this->branding->toPayload();
		if ($this->deadline === null) {
			return $payload;
		}
		return $payload + ['date_limit_to_sign' => ZapSignDateFormat::format($this->deadline)];
	}
}
```

- [ ] **Step 5: Implement the models**

`lib/ZapSign/Model/ZapSignSigner.php`:
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
	) {
	}

	/** @param array<mixed> $payload */
	public static function fromPayload(array $payload): self {
		$reader = new PayloadReader($payload);
		return new self(
			$reader->string('token'),
			$reader->string('name'),
			$reader->string('email'),
			$reader->string('status'),
			$reader->nullableString('signed_at'),
			$reader->nullableString('sign_url'),
			$reader->string('external_id'),
		);
	}
}
```

`lib/ZapSign/Model/ZapSignExtraDocument.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Model;

use OCA\Assinaturas\ZapSign\PayloadReader;

final class ZapSignExtraDocument {
	public function __construct(
		public readonly string $token,
		public readonly string $name,
		public readonly ?string $signedFileUrl,
		public readonly ?string $originalFileUrl,
	) {
	}

	/** @param array<mixed> $payload */
	public static function fromPayload(array $payload): self {
		$reader = new PayloadReader($payload);
		return new self(
			$reader->string('token'),
			$reader->string('name'),
			$reader->nullableString('signed_file'),
			$reader->nullableString('original_file'),
		);
	}
}
```

`lib/ZapSign/Model/ZapSignDocument.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Model;

use OCA\Assinaturas\ZapSign\PayloadReader;

final class ZapSignDocument {
	/**
	 * @param list<ZapSignSigner> $signers
	 * @param list<ZapSignExtraDocument> $extraDocuments
	 */
	public function __construct(
		public readonly string $token,
		public readonly string $name,
		public readonly string $status,
		public readonly bool $deleted,
		public readonly ?string $signedFileUrl,
		public readonly ?string $originalFileUrl,
		public readonly ?string $rejectedReason,
		public readonly ?string $lastUpdateAt,
		public readonly string $folderPath,
		public readonly string $externalId,
		public readonly array $signers,
		public readonly array $extraDocuments,
	) {
	}

	/** @param array<mixed> $payload */
	public static function fromPayload(array $payload): self {
		$reader = new PayloadReader($payload);
		return new self(
			$reader->string('token'),
			$reader->string('name'),
			$reader->string('status'),
			$reader->boolean('deleted'),
			$reader->nullableString('signed_file'),
			$reader->nullableString('original_file'),
			$reader->nullableString('rejected_reason'),
			$reader->nullableString('last_update_at'),
			$reader->string('folder_path'),
			$reader->string('external_id'),
			array_map(ZapSignSigner::fromPayload(...), $reader->objects('signers')),
			array_map(ZapSignExtraDocument::fromPayload(...), $reader->objects('extra_docs')),
		);
	}
}
```

`lib/ZapSign/Model/ZapSignDocumentPage.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Model;

use OCA\Assinaturas\ZapSign\PayloadReader;

/** ZapSign's list endpoint returns either a DRF page {count,next,previous,results} or a bare array. */
final class ZapSignDocumentPage {
	/** @param list<ZapSignDocument> $documents */
	public function __construct(
		public readonly array $documents,
		public readonly bool $hasNextPage,
	) {
	}

	/** @param array<mixed> $payload */
	public static function fromPayload(array $payload): self {
		if (array_is_list($payload)) {
			$documents = array_values(array_filter($payload, 'is_array'));
			return new self(array_map(ZapSignDocument::fromPayload(...), $documents), false);
		}
		$reader = new PayloadReader($payload);
		return new self(
			array_map(ZapSignDocument::fromPayload(...), $reader->objects('results')),
			$reader->nullableString('next') !== null,
		);
	}
}
```

`lib/ZapSign/Model/ActivityLogPdf.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Model;

final class ActivityLogPdf {
	public function __construct(
		public readonly string $contentType,
		public readonly string $bytes,
	) {
	}
}
```

- [ ] **Step 6: Add the document methods to `ZapSignClient`**

Add these imports to `lib/ZapSign/ZapSignClient.php`:
```php
use OCA\Assinaturas\ZapSign\Model\ActivityLogPdf;
use OCA\Assinaturas\ZapSign\Model\ZapSignDocument;
use OCA\Assinaturas\ZapSign\Model\ZapSignDocumentPage;
use OCA\Assinaturas\ZapSign\Model\ZapSignExtraDocument;
use OCA\Assinaturas\ZapSign\Payload\NewDocument;
```

Add this constant next to `DEFAULT_TIMEOUT_SECONDS`:
```php
	private const UPLOAD_TIMEOUT_SECONDS = 120;
```

Add these public methods after `getPlanInfo()`:
```php
	/** Never retried: a lost response means the outcome is unknown (look up by folder before re-creating). */
	public function createDocument(NewDocument $document): ZapSignDocument {
		$response = $this->call('POST', '/docs/', 'POST /docs/', $document->toPayload(), false, ['envelope' => $document->externalId], self::UPLOAD_TIMEOUT_SECONDS);
		return ZapSignDocument::fromPayload(self::decode($response));
	}

	/** Never retried: a lost response means the outcome is unknown (re-read the envelope before re-uploading). */
	public function uploadExtraDocument(string $documentToken, string $name, string $base64Pdf): ZapSignExtraDocument {
		$response = $this->call(
			'POST',
			'/docs/' . rawurlencode($documentToken) . '/upload-extra-doc/',
			'POST /docs/{doc}/upload-extra-doc/',
			['name' => $name, 'base64_pdf' => $base64Pdf],
			false,
			['document' => $documentToken],
			self::UPLOAD_TIMEOUT_SECONDS,
		);
		return ZapSignExtraDocument::fromPayload(self::decode($response));
	}

	public function getDocument(string $documentToken): ZapSignDocument {
		$response = $this->call('GET', '/docs/' . rawurlencode($documentToken) . '/', 'GET /docs/{doc}/', null, true, ['document' => $documentToken]);
		return ZapSignDocument::fromPayload(self::decode($response));
	}

	/** @return list<ZapSignDocument> */
	public function findDocumentsByFolder(string $folderPath): array {
		$query = ['folder_path' => $folderPath, 'include_signers' => 'true', 'page' => '1'];
		$response = $this->call('GET', '/docs/', 'GET /docs/?folder_path', null, true, [], self::DEFAULT_TIMEOUT_SECONDS, $query);
		return ZapSignDocumentPage::fromPayload(self::decode($response))->documents;
	}

	public function listDocumentsWithSigners(int $page, ?string $status = null): ZapSignDocumentPage {
		$query = ['page' => (string)$page, 'include_signers' => 'true', 'sort_order' => 'desc'];
		if ($status !== null) {
			$query['status'] = $status;
		}
		$response = $this->call('GET', '/docs/', 'GET /docs/?page', null, true, [], self::DEFAULT_TIMEOUT_SECONDS, $query);
		return ZapSignDocumentPage::fromPayload(self::decode($response));
	}

	public function updateDeadline(string $documentToken, \DateTimeImmutable $deadline): void {
		$payload = ['date_limit_to_sign' => ZapSignDateFormat::format($deadline)];
		$this->call('PUT', '/docs/' . rawurlencode($documentToken) . '/', 'PUT /docs/{doc}/', $payload, true, ['document' => $documentToken]);
	}

	/** Never retried. ZapSign requires a User-Agent here; every request already carries one. */
	public function cancelDocument(string $documentToken, string $reason, bool $notifySigners): void {
		$payload = ['doc_token' => $documentToken, 'rejected_reason' => $reason, 'notify_signer' => $notifySigners];
		$this->call('POST', '/refuse/', 'POST /refuse/', $payload, false, ['document' => $documentToken]);
	}

	public function getActivityLog(string $documentToken): ActivityLogPdf {
		$response = $this->call(
			'GET',
			'/docs/signer-log/' . rawurlencode($documentToken),
			'GET /docs/signer-log/{doc}',
			null,
			true,
			['document' => $documentToken],
			self::DEFAULT_TIMEOUT_SECONDS,
			['download_pdf' => 'true'],
		);
		return new ActivityLogPdf($response->headers['content-type'] ?? 'application/octet-stream', $response->body);
	}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter ZapSignClientDocumentsTest`
Expected: `OK (15 tests, …)`.

Then the full suite: `tests/env/phpunit.sh`. Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: add ZapSign document operations and response models"
```

---

### Task 7: Placement conversion, signer operations and webhook operations

**Files:**
- Create: `lib/ZapSign/Payload/FieldPlacement.php`, `lib/ZapSign/Payload/SignatureBox.php`
- Create: `lib/ZapSign/PlacementConverter.php`
- Modify: `lib/ZapSign/ZapSignClient.php` (add the placement, signer and webhook methods)
- Test: `tests/Unit/ZapSign/PlacementConverterTest.php`
- Test: `tests/Unit/ZapSign/ZapSignClientSignersAndWebhooksTest.php`

**Interfaces:**
- Consumes: the `ZapSignClient` pipeline (Task 5).
- Produces:
  - `FieldPlacement(string $type, int $page, float $x, float $y, float $width, float $height)`:
    - `type` is `signature` or `initials`;
    - `page` is 0-based;
    - coordinates are top-left origin, 0..1, as the page is displayed.
  - `SignatureBox(string $signerToken, string $zapSignType, int $page, float $left, float $bottom, float $width, float $height)` with `toPayload(): array`. The box is in ZapSign space: percentages, bottom-left origin.
  - `PlacementConverter::toSignatureBox(FieldPlacement, string $signerToken): SignatureBox`. Rounds to 2 decimals, clamps inside the page, and maps `initials → visto`.
  - `ZapSignClient` methods:
    - `placeSignatures(string $documentToken, list<SignatureBox>): void` — replace-all, idempotent.
    - `releaseSigner(string $signerToken): void` — never retried.
    - `updateSignerEmail(string $signerToken, string $email): void`.
    - `removeSigner(string $signerToken): void` — never retried.
    - `registerWebhook(string $url, string $type, array<string,string> $headers): int` — never retried; returns the webhook id.
    - `deleteWebhook(int $webhookId): void`.

- [ ] **Step 1: Write the failing tests**

`tests/Unit/ZapSign/PlacementConverterTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\ZapSign;

use OCA\Assinaturas\ZapSign\Payload\FieldPlacement;
use OCA\Assinaturas\ZapSign\PlacementConverter;
use PHPUnit\Framework\TestCase;

final class PlacementConverterTest extends TestCase {
	private PlacementConverter $converter;

	protected function setUp(): void {
		$this->converter = new PlacementConverter();
	}

	public function testFlipsATopLeftBoxToZapSignsBottomLeftPercentages(): void {
		$box = $this->converter->toSignatureBox(new FieldPlacement('signature', 0, 0.10, 0.75, 0.1955, 0.0942), 'signer-token');

		$this->assertSame('signature', $box->zapSignType);
		$this->assertSame(0, $box->page);
		$this->assertSame(10.0, $box->left);
		$this->assertSame(15.58, $box->bottom);
		$this->assertSame(19.55, $box->width);
		$this->assertSame(9.42, $box->height);
		$this->assertSame('signer-token', $box->signerToken);
	}

	public function testMapsInitialsToZapSignsVisto(): void {
		$box = $this->converter->toSignatureBox(new FieldPlacement('initials', 3, 0.8, 0.85, 0.1376, 0.0942), 'signer-token');

		$this->assertSame('visto', $box->zapSignType);
		$this->assertSame(3, $box->page);
	}

	public function testPlacesABoxTouchingTheBottomEdgeAtZero(): void {
		$box = $this->converter->toSignatureBox(new FieldPlacement('signature', 0, 0.0, 0.9058, 0.1955, 0.0942), 'signer-token');

		$this->assertSame(0.0, $box->bottom);
		$this->assertSame(0.0, $box->left);
	}

	public function testClampsABoxOverflowingTheRightAndBottomEdges(): void {
		$box = $this->converter->toSignatureBox(new FieldPlacement('signature', 0, 0.95, 0.99, 0.1955, 0.0942), 'signer-token');

		$this->assertLessThanOrEqual(100.0, $box->left + $box->width);
		$this->assertGreaterThanOrEqual(0.0, $box->bottom);
		$this->assertLessThanOrEqual(100.0, $box->bottom + $box->height);
	}

	public function testRejectsAnUnknownFieldType(): void {
		$this->expectException(\InvalidArgumentException::class);

		$this->converter->toSignatureBox(new FieldPlacement('stamp', 0, 0.1, 0.1, 0.1, 0.1), 'signer-token');
	}

	public function testSerializesToZapSignsRubricaShape(): void {
		$box = $this->converter->toSignatureBox(new FieldPlacement('signature', 1, 0.10, 0.75, 0.1955, 0.0942), 'signer-token');

		$this->assertSame([
			'type' => 'signature',
			'page' => 1,
			'relative_position_left' => 10.0,
			'relative_position_bottom' => 15.58,
			'relative_size_x' => 19.55,
			'relative_size_y' => 9.42,
			'signer_token' => 'signer-token',
		], $box->toPayload());
	}
}
```

`tests/Unit/ZapSign/ZapSignClientSignersAndWebhooksTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\ZapSign;

use OCA\Assinaturas\ZapSign\Exception\ZapSignUnreachable;
use OCA\Assinaturas\ZapSign\Http\TransportFailure;
use OCA\Assinaturas\ZapSign\Payload\FieldPlacement;
use OCA\Assinaturas\ZapSign\PlacementConverter;

final class ZapSignClientSignersAndWebhooksTest extends ZapSignClientTestCase {
	private const DOCUMENT_TOKEN = 'b7f0c0de-1111-4a2b-9c3d-aaaaaaaaaaaa';
	private const SIGNER_TOKEN = '5a1e0000-aaaa-4bbb-8ccc-000000000001';

	public function testPlacesSignaturesAsOneReplaceAllCall(): void {
		$this->transport->willRespond(200, '{}');
		$box = (new PlacementConverter())->toSignatureBox(new FieldPlacement('signature', 0, 0.10, 0.75, 0.1955, 0.0942), self::SIGNER_TOKEN);

		$this->client()->placeSignatures(self::DOCUMENT_TOKEN, [$box]);

		$this->assertSame(self::SANDBOX_BASE_URL . '/docs/' . self::DOCUMENT_TOKEN . '/place-signatures/', $this->transport->requests[0]->url);
		$this->assertSame(['rubricas' => [$box->toPayload()]], $this->transport->lastRequestJson());
	}

	public function testRetriesPlacementBecauseItReplacesEverything(): void {
		$this->transport->willRespond(503, 'x')->willRespond(200, '{}');

		$this->client()->placeSignatures(self::DOCUMENT_TOKEN, []);

		$this->assertCount(2, $this->transport->requests);
		$this->assertSame(['rubricas' => []], $this->transport->lastRequestJson());
	}

	public function testReleasesASignerWithoutRetrying(): void {
		$this->transport->willFail(new TransportFailure('timeout'));

		try {
			$this->client()->releaseSigner(self::SIGNER_TOKEN);
			$this->fail('Expected an unknown outcome');
		} catch (ZapSignUnreachable) {
		}

		$this->assertCount(1, $this->transport->requests);
		$this->assertSame(self::SANDBOX_BASE_URL . '/signers/' . self::SIGNER_TOKEN . '/', $this->transport->requests[0]->url);
		$this->assertSame(['send_automatic_email' => true], $this->transport->lastRequestJson());
	}

	public function testUpdatesASignersEmail(): void {
		$this->transport->willRespond(200, '{}');

		$this->client()->updateSignerEmail(self::SIGNER_TOKEN, 'ana.lima@example.com');

		$this->assertSame('POST', $this->transport->requests[0]->method);
		$this->assertSame(['email' => 'ana.lima@example.com'], $this->transport->lastRequestJson());
	}

	public function testRemovesASignerThroughTheSingularPath(): void {
		$this->transport->willRespond(200, '{}');

		$this->client()->removeSigner(self::SIGNER_TOKEN);

		$this->assertSame('DELETE', $this->transport->requests[0]->method);
		$this->assertSame(self::SANDBOX_BASE_URL . '/signer/' . self::SIGNER_TOKEN . '/remove/', $this->transport->requests[0]->url);
	}

	public function testRegistersAWebhookWithCustomHeaders(): void {
		$this->transport->willRespond(200, ['id' => 987]);

		$webhookId = $this->client()->registerWebhook('https://tenant.example/index.php/apps/assinaturas/webhook', 'doc_refused', ['X-Assinaturas-Secret' => 'shh']);

		$this->assertSame(987, $webhookId);
		$this->assertSame([
			'url' => 'https://tenant.example/index.php/apps/assinaturas/webhook',
			'type' => 'doc_refused',
			'headers' => [['name' => 'X-Assinaturas-Secret', 'value' => 'shh']],
		], $this->transport->lastRequestJson());
	}

	public function testOmitsWebhookHeadersWhenNoneAreGiven(): void {
		$this->transport->willRespond(200, ['id' => 988]);

		$this->client()->registerWebhook('https://tenant.example/webhook', '', []);

		$this->assertSame(['url' => 'https://tenant.example/webhook', 'type' => ''], $this->transport->lastRequestJson());
	}

	public function testDeletesAWebhookById(): void {
		$this->transport->willRespond(200, '{}');

		$this->client()->deleteWebhook(987);

		$this->assertSame('DELETE', $this->transport->requests[0]->method);
		$this->assertSame(self::SANDBOX_BASE_URL . '/user/company/webhook/delete/', $this->transport->requests[0]->url);
		$this->assertSame(['id' => 987], $this->transport->lastRequestJson());
	}

	public function testKeepsSignerTokensOutOfTheLogs(): void {
		$this->transport->willRespond(200, '{}')->willRespond(200, '{}')->willRespond(200, '{}');

		$this->client()->releaseSigner(self::SIGNER_TOKEN);
		$this->client()->updateSignerEmail(self::SIGNER_TOKEN, 'ana@example.com');
		$this->client()->removeSigner(self::SIGNER_TOKEN);

		$this->assertStringNotContainsString(self::SIGNER_TOKEN, $this->logger->serialized());
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter 'PlacementConverterTest|ZapSignClientSignersAndWebhooksTest'`
Expected: ERROR `Class "OCA\Assinaturas\ZapSign\PlacementConverter" not found`.

- [ ] **Step 3: Implement the placement types and converter**

`lib/ZapSign/Payload/FieldPlacement.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Payload;

/** A box as drawn in our editor: top-left origin, 0..1 relative to the page as displayed. */
final class FieldPlacement {
	public function __construct(
		public readonly string $type,
		public readonly int $page,
		public readonly float $x,
		public readonly float $y,
		public readonly float $width,
		public readonly float $height,
	) {
	}
}
```

`lib/ZapSign/Payload/SignatureBox.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Payload;

/** A box in ZapSign's space: bottom-left origin, percentages 0..100. */
final class SignatureBox {
	public function __construct(
		public readonly string $signerToken,
		public readonly string $zapSignType,
		public readonly int $page,
		public readonly float $left,
		public readonly float $bottom,
		public readonly float $width,
		public readonly float $height,
	) {
	}

	/** @return array{type: string, page: int, relative_position_left: float, relative_position_bottom: float, relative_size_x: float, relative_size_y: float, signer_token: string} */
	public function toPayload(): array {
		return [
			'type' => $this->zapSignType,
			'page' => $this->page,
			'relative_position_left' => $this->left,
			'relative_position_bottom' => $this->bottom,
			'relative_size_x' => $this->width,
			'relative_size_y' => $this->height,
			'signer_token' => $this->signerToken,
		];
	}
}
```

`lib/ZapSign/PlacementConverter.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign;

use OCA\Assinaturas\ZapSign\Payload\FieldPlacement;
use OCA\Assinaturas\ZapSign\Payload\SignatureBox;

final class PlacementConverter {
	private const ZAPSIGN_TYPES = ['signature' => 'signature', 'initials' => 'visto'];
	private const FULL_PAGE_PERCENT = 100.0;
	private const DECIMALS = 2;

	public function toSignatureBox(FieldPlacement $field, string $signerToken): SignatureBox {
		$zapSignType = self::ZAPSIGN_TYPES[$field->type] ?? throw new \InvalidArgumentException('Unknown field type: ' . $field->type);
		$width = self::percent($field->width);
		$height = self::percent($field->height);
		$left = min(self::percent($field->x), self::FULL_PAGE_PERCENT - $width);
		$bottom = min(self::percent(1.0 - $field->y - $field->height), self::FULL_PAGE_PERCENT - $height);
		return new SignatureBox($signerToken, $zapSignType, $field->page, max(0.0, $left), max(0.0, $bottom), $width, $height);
	}

	private static function percent(float $fraction): float {
		return round($fraction * self::FULL_PAGE_PERCENT, self::DECIMALS);
	}
}
```

- [ ] **Step 4: Add the signer, placement and webhook methods to `ZapSignClient`**

Add this import to `lib/ZapSign/ZapSignClient.php`:
```php
use OCA\Assinaturas\ZapSign\Payload\SignatureBox;
```

Add these public methods after `getActivityLog()`. Signer tokens go **only** into the URL path, never into the log context or the endpoint template.
```php
	/**
	 * Replace-all: each call replaces every placement on the document, so retrying is safe.
	 *
	 * @param list<SignatureBox> $boxes
	 */
	public function placeSignatures(string $documentToken, array $boxes): void {
		$payload = ['rubricas' => array_map(fn (SignatureBox $box): array => $box->toPayload(), $boxes)];
		$this->call('POST', '/docs/' . rawurlencode($documentToken) . '/place-signatures/', 'POST /docs/{doc}/place-signatures/', $payload, true, ['document' => $documentToken]);
	}

	/** Never retried: a duplicate would email the signer twice and hit ZapSign's 30-minute cooldown. */
	public function releaseSigner(string $signerToken): void {
		$this->call('POST', '/signers/' . rawurlencode($signerToken) . '/', 'POST /signers/{signer}/ release', ['send_automatic_email' => true], false);
	}

	public function updateSignerEmail(string $signerToken, string $email): void {
		$this->call('POST', '/signers/' . rawurlencode($signerToken) . '/', 'POST /signers/{signer}/ email', ['email' => $email], true);
	}

	public function removeSigner(string $signerToken): void {
		$this->call('DELETE', '/signer/' . rawurlencode($signerToken) . '/remove/', 'DELETE /signer/{signer}/remove/', null, false);
	}

	/**
	 * Never retried: ZapSign has no endpoint to list webhooks, so a duplicate could never be found and removed.
	 *
	 * @param array<string, string> $headers
	 */
	public function registerWebhook(string $url, string $type, array $headers): int {
		$payload = ['url' => $url, 'type' => $type];
		if ($headers !== []) {
			$payload['headers'] = array_map(
				fn (string $name, string $value): array => ['name' => $name, 'value' => $value],
				array_keys($headers),
				array_values($headers),
			);
		}
		$response = $this->call('POST', '/user/company/webhook/', 'POST /user/company/webhook/', $payload, false);
		return (new PayloadReader(self::decode($response)))->integer('id');
	}

	public function deleteWebhook(int $webhookId): void {
		$this->call('DELETE', '/user/company/webhook/delete/', 'DELETE /user/company/webhook/delete/', ['id' => $webhookId], true);
	}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'PlacementConverterTest|ZapSignClientSignersAndWebhooksTest'`
Expected: `OK (15 tests, …)`.

Then the full suite: `tests/env/phpunit.sh`. Expected: all green (81 tests).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add signature placement conversion, signer and webhook operations"
```

---

### Task 8: Sandbox spike tooling

**Files:**
- Create: `tests/spike/make-fixtures.php`
- Create: `tests/spike/webhook-capture.php`
- Create: `tests/spike/run.php`
- Create: `tests/spike/README.md`

**Interfaces:**
- Consumes: `ZapSignClient`, `PlacementConverter`, the payloads and models (Tasks 5–7), plus `HttpTransport` and `ZapSignSettings` for raw GETs.
- Produces:
  - `tests/env/php.sh apps/assinaturas/tests/spike/make-fixtures.php` writes the test PDFs to `tests/spike/output/pdfs/`.
  - `tests/env/php.sh apps/assinaturas/tests/spike/run.php <command> …` runs the spike commands listed in `help`.
  - `webhook-capture.php` is a router for `php -S`. It appends each request to `tests/spike/output/webhooks.jsonl` and answers 500 for the first `FAIL_FIRST` requests.

- [ ] **Step 1: Write the PDF fixture generator**

`tests/spike/make-fixtures.php`:
```php
<?php

declare(strict_types=1);

/**
 * Writes minimal test PDFs for the sandbox spikes into tests/spike/output/pdfs/.
 * Each page prints its name and rotation plus corner labels drawn in the
 * UNROTATED page space, so a human can tell where ZapSign put a signature.
 *   tests/env/php.sh apps/assinaturas/tests/spike/make-fixtures.php
 */

const A4_PORTRAIT = [595.28, 841.89];
const A4_LANDSCAPE = [841.89, 595.28];
const ELEVEN_MEGABYTES = 11 * 1024 * 1024;

$outputDirectory = __DIR__ . '/output/pdfs';

$fixtures = [
	'portrait.pdf' => [['size' => A4_PORTRAIT, 'rotate' => 0, 'label' => 'portrait']],
	'landscape.pdf' => [['size' => A4_LANDSCAPE, 'rotate' => 0, 'label' => 'landscape']],
	'rotated-90.pdf' => [['size' => A4_PORTRAIT, 'rotate' => 90, 'label' => 'portrait rotate 90']],
	'rotated-270.pdf' => [['size' => A4_PORTRAIT, 'rotate' => 270, 'label' => 'portrait rotate 270']],
	'cropbox-offset.pdf' => [['size' => [700.0, 950.0], 'rotate' => 0, 'cropBox' => [50.0, 60.0, 645.28, 901.89], 'label' => 'cropbox offset']],
	'mixed-pages.pdf' => [
		['size' => A4_PORTRAIT, 'rotate' => 0, 'label' => 'mixed page 1 portrait'],
		['size' => A4_LANDSCAPE, 'rotate' => 0, 'label' => 'mixed page 2 landscape'],
		['size' => A4_PORTRAIT, 'rotate' => 0, 'label' => 'mixed page 3 portrait'],
	],
];

if (!is_dir($outputDirectory) && !mkdir($outputDirectory, 0775, true) && !is_dir($outputDirectory)) {
	fwrite(STDERR, "Cannot create $outputDirectory" . PHP_EOL);
	exit(1);
}

foreach ($fixtures as $fileName => $pages) {
	file_put_contents($outputDirectory . '/' . $fileName, buildPdf($pages, 0));
	fwrite(STDOUT, "wrote $fileName" . PHP_EOL);
}
file_put_contents($outputDirectory . '/large-11mb.pdf', buildPdf([['size' => A4_PORTRAIT, 'rotate' => 0, 'label' => 'large 11 MB']], ELEVEN_MEGABYTES));
fwrite(STDOUT, 'wrote large-11mb.pdf' . PHP_EOL);

function formatNumber(float $value): string {
	return rtrim(rtrim(sprintf('%.2F', $value), '0'), '.');
}

/** @param array{0: float, 1: float, 2: float, 3: float} $visibleBox */
function pageContent(array $visibleBox, string $label): string {
	[$left, $bottom, $right, $top] = $visibleBox;
	$text = fn (float $size, float $x, float $y, string $value): string => 'BT /F1 ' . formatNumber($size) . ' Tf ' . formatNumber($x) . ' ' . formatNumber($y) . ' Td (' . $value . ') Tj ET';
	return implode("\n", [
		$text(26, $left + 40, ($bottom + $top) / 2, strtoupper($label)),
		$text(12, $left + 12, $top - 24, 'UNROTATED TOP-LEFT'),
		$text(12, $right - 160, $top - 24, 'UNROTATED TOP-RIGHT'),
		$text(12, $left + 12, $bottom + 14, 'UNROTATED BOTTOM-LEFT'),
		$text(12, $right - 180, $bottom + 14, 'UNROTATED BOTTOM-RIGHT'),
	]);
}

/** @param list<array{size: array{0: float, 1: float}, rotate: int, label: string, cropBox?: array{0: float, 1: float, 2: float, 3: float}}> $pages */
function buildPdf(array $pages, int $paddingBytes): string {
	$objects = [
		1 => '<< /Type /Catalog /Pages 2 0 R >>',
		3 => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
	];
	$pageReferences = [];
	$nextObjectId = 4;
	foreach ($pages as $page) {
		[$width, $height] = $page['size'];
		$visibleBox = $page['cropBox'] ?? [0.0, 0.0, $width, $height];
		$pageId = $nextObjectId++;
		$contentId = $nextObjectId++;
		$stream = pageContent($visibleBox, $page['label']);
		$objects[$contentId] = '<< /Length ' . strlen($stream) . " >>\nstream\n" . $stream . "\nendstream";
		$cropBox = isset($page['cropBox']) ? ' /CropBox [' . implode(' ', array_map('formatNumber', $page['cropBox'])) . ']' : '';
		$objects[$pageId] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' . formatNumber($width) . ' ' . formatNumber($height) . ']'
			. $cropBox . ' /Rotate ' . $page['rotate']
			. ' /Resources << /Font << /F1 3 0 R >> >> /Contents ' . $contentId . ' 0 R >>';
		$pageReferences[] = $pageId . ' 0 R';
	}
	$objects[2] = '<< /Type /Pages /Kids [' . implode(' ', $pageReferences) . '] /Count ' . count($pageReferences) . ' >>';
	if ($paddingBytes > 0) {
		$padding = random_bytes($paddingBytes);
		$objects[$nextObjectId++] = '<< /Length ' . strlen($padding) . " >>\nstream\n" . $padding . "\nendstream";
	}
	ksort($objects);

	$pdf = "%PDF-1.7\n";
	$offsets = [];
	foreach ($objects as $objectId => $body) {
		$offsets[$objectId] = strlen($pdf);
		$pdf .= $objectId . " 0 obj\n" . $body . "\nendobj\n";
	}
	$crossReferenceOffset = strlen($pdf);
	$objectCount = max(array_keys($objects)) + 1;
	$pdf .= "xref\n0 " . $objectCount . "\n0000000000 65535 f \n";
	for ($objectId = 1; $objectId < $objectCount; $objectId++) {
		$pdf .= sprintf("%010d 00000 n \n", $offsets[$objectId]);
	}
	return $pdf . "trailer\n<< /Size " . $objectCount . " /Root 1 0 R >>\nstartxref\n" . $crossReferenceOffset . "\n%%EOF\n";
}
```

- [ ] **Step 2: Generate the fixtures and eyeball one**

Run: `tests/env/php.sh apps/assinaturas/tests/spike/make-fixtures.php && ls -la tests/spike/output/pdfs && open tests/spike/output/pdfs/rotated-90.pdf`
Expected:
- The script lists 7 files. `large-11mb.pdf` is about 11 MB.
- Preview opens `rotated-90.pdf` as a **landscape-displayed** page. The label `PORTRAIT ROTATE 90` and the `UNROTATED …` corner labels appear rotated.

- [ ] **Step 3: Write the webhook capture server**

`tests/spike/webhook-capture.php`:
```php
<?php

declare(strict_types=1);

/**
 * Router for `php -S` that records every request ZapSign sends. Set FAIL_FIRST=N
 * to answer HTTP 500 to the first N requests and observe ZapSign's retry cadence.
 * Appends one JSON line per request to tests/spike/output/webhooks.jsonl.
 */

$outputDirectory = __DIR__ . '/output';
$counterFile = $outputDirectory . '/webhook-counter';
$failFirst = (int)(getenv('FAIL_FIRST') ?: 0);

if (!is_dir($outputDirectory)) {
	mkdir($outputDirectory, 0775, true);
}
$previousCount = is_file($counterFile) ? (int)file_get_contents($counterFile) : 0;
$requestNumber = $previousCount + 1;
file_put_contents($counterFile, (string)$requestNumber);
$status = $requestNumber <= $failFirst ? 500 : 200;

$entry = [
	'requestNumber' => $requestNumber,
	'receivedAt' => gmdate('c'),
	'respondedWith' => $status,
	'method' => $_SERVER['REQUEST_METHOD'] ?? '',
	'path' => $_SERVER['REQUEST_URI'] ?? '',
	'headers' => function_exists('getallheaders') ? getallheaders() : [],
	'body' => file_get_contents('php://input'),
];
file_put_contents($outputDirectory . '/webhooks.jsonl', json_encode($entry, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL, FILE_APPEND | LOCK_EX);

http_response_code($status);
echo $status === 200 ? 'ok' : 'failing on purpose';
```

- [ ] **Step 4: Write the spike runner**

`tests/spike/run.php`:
```php
<?php

declare(strict_types=1);

/**
 * ZapSign sandbox spike runner (Plan 1). Runs inside the test container:
 *   tests/env/php.sh apps/assinaturas/tests/spike/run.php <command> [arguments...]
 * Needs the sandbox token in app config (see tests/spike/README.md).
 */

use OCA\Assinaturas\ZapSign\Exception\ZapSignException;
use OCA\Assinaturas\ZapSign\Http\HttpRequest;
use OCA\Assinaturas\ZapSign\Http\HttpTransport;
use OCA\Assinaturas\ZapSign\Model\ZapSignDocument;
use OCA\Assinaturas\ZapSign\Model\ZapSignSigner;
use OCA\Assinaturas\ZapSign\Payload\Branding;
use OCA\Assinaturas\ZapSign\Payload\FieldPlacement;
use OCA\Assinaturas\ZapSign\Payload\NewDocument;
use OCA\Assinaturas\ZapSign\Payload\NewSigner;
use OCA\Assinaturas\ZapSign\PlacementConverter;
use OCA\Assinaturas\ZapSign\ZapSignClient;
use OCA\Assinaturas\ZapSign\ZapSignSettings;
use OCP\Server;

require_once '/var/www/html/lib/base.php';

const PDF_DIRECTORY = __DIR__ . '/output/pdfs';
const OUTPUT_DIRECTORY = __DIR__ . '/output';
const SPIKE_FOLDER_ROOT = '/assinaturas-spike/';
const GEOMETRY_FILES = [
	'landscape.pdf' => 1,
	'rotated-90.pdf' => 1,
	'rotated-270.pdf' => 1,
	'cropbox-offset.pdf' => 1,
	'mixed-pages.pdf' => 3,
];
const MAX_EXTRA_DOCUMENTS_TO_TRY = 20;

function printJson(mixed $value): void {
	fwrite(STDOUT, json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL);
}

/**
 * @param list<string> $arguments
 * @return list<string>
 */
function requireArguments(array $arguments, int $count, string $usage): array {
	if (count($arguments) < $count) {
		fwrite(STDERR, 'Usage: run.php ' . $usage . PHP_EOL);
		exit(2);
	}
	return array_slice($arguments, 0, $count);
}

function pdfBase64(string $fileName): string {
	$path = PDF_DIRECTORY . '/' . $fileName;
	if (!is_file($path)) {
		fwrite(STDERR, "Missing $path — run make-fixtures.php first" . PHP_EOL);
		exit(2);
	}
	return base64_encode((string)file_get_contents($path));
}

function spikeUuid(): string {
	return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex(random_bytes(16)), 4));
}

function client(): ZapSignClient {
	return Server::get(ZapSignClient::class);
}

/**
 * @param list<ZapSignSigner> $signers
 * @return list<array<string, string|null>>
 */
function describeSigners(array $signers): array {
	return array_map(fn (ZapSignSigner $signer): array => [
		'name' => $signer->name,
		'email' => $signer->email,
		'token' => $signer->token,
		'signUrl' => $signer->signUrl,
	], $signers);
}

/** @param list<NewSigner> $signers */
function createSpikeDocument(string $title, string $mainPdf, array $signers, bool $signingOrder): ZapSignDocument {
	$uuid = spikeUuid();
	$branding = new Branding('Avuz Conecta', (string)getenv('SPIKE_BRAND_LOGO_URL'), '#2bb5e3');
	return client()->createDocument(new NewDocument($title, pdfBase64($mainPdf), $uuid, SPIKE_FOLDER_ROOT . $uuid, $signers, $signingOrder, null, $branding));
}

/** @param list<string> $arguments */
function sendOrdered(array $arguments): void {
	[$firstEmail, $secondEmail] = requireArguments($arguments, 2, 'send-ordered <firstSignerEmail> <secondSignerEmail>');
	$converter = new PlacementConverter();
	$document = createSpikeDocument('Spike 1 — ordem de assinatura', 'portrait.pdf', [
		new NewSigner('Signatário Um', $firstEmail, 1, 'spike-signer-1', 'SPIKE custom_message para o signatário 1'),
		new NewSigner('Signatário Dois', $secondEmail, 2, 'spike-signer-2', 'SPIKE custom_message para o signatário 2'),
	], true);
	$extraDocument = client()->uploadExtraDocument($document->token, 'Anexo com páginas mistas', pdfBase64('mixed-pages.pdf'));
	[$firstSigner, $secondSigner] = $document->signers;
	client()->placeSignatures($document->token, [
		$converter->toSignatureBox(new FieldPlacement('signature', 0, 0.10, 0.75, 0.20, 0.09), $firstSigner->token),
		$converter->toSignatureBox(new FieldPlacement('signature', 0, 0.60, 0.75, 0.20, 0.09), $secondSigner->token),
	]);
	client()->placeSignatures($extraDocument->token, [
		$converter->toSignatureBox(new FieldPlacement('initials', 1, 0.80, 0.85, 0.14, 0.09), $firstSigner->token),
	]);
	printJson(['document' => $document->token, 'extraDocument' => $extraDocument->token, 'signers' => describeSigners($document->signers)]);
}

/** @param list<string> $arguments */
function sendGeometry(array $arguments): void {
	[$email] = requireArguments($arguments, 1, 'send-geometry <signerEmail>');
	$converter = new PlacementConverter();
	$mainFile = array_key_first(GEOMETRY_FILES);
	$document = createSpikeDocument('Spike 3 — geometria', $mainFile, [new NewSigner('Signatário Geometria', $email, 1, 'spike-geometry')], false);
	$signerToken = $document->signers[0]->token;
	$documentTokens = [$mainFile => $document->token];
	foreach (array_keys(array_slice(GEOMETRY_FILES, 1, null, true)) as $fileName) {
		$documentTokens[$fileName] = client()->uploadExtraDocument($document->token, $fileName, pdfBase64($fileName))->token;
	}
	foreach ($documentTokens as $fileName => $documentToken) {
		$boxes = [];
		for ($page = 0; $page < GEOMETRY_FILES[$fileName]; $page++) {
			$boxes[] = $converter->toSignatureBox(new FieldPlacement('signature', $page, 0.05, 0.05, 0.20, 0.09), $signerToken);
			$boxes[] = $converter->toSignatureBox(new FieldPlacement('initials', $page, 0.81, 0.86, 0.14, 0.09), $signerToken);
		}
		client()->placeSignatures($documentToken, $boxes);
	}
	printJson([
		'documents' => $documentTokens,
		'signers' => describeSigners($document->signers),
		'expected' => 'On every page AS DISPLAYED: signature near the top-left corner, initials near the bottom-right corner.',
	]);
}

/** @param list<string> $arguments */
function sendOrderGroupZero(array $arguments): void {
	[$email] = requireArguments($arguments, 1, 'send-order-group-zero <signerEmail>');
	try {
		$document = createSpikeDocument('Spike 3 — order_group 0', 'portrait.pdf', [new NewSigner('Grupo Zero', $email, 0, 'spike-group-zero')], true);
		printJson(['accepted' => true, 'document' => $document->token]);
	} catch (ZapSignException $failure) {
		printJson(['accepted' => false, 'failure' => $failure::class, 'message' => $failure->getMessage(), 'code' => $failure->providerCode]);
	}
}

/** @param list<string> $arguments */
function sendLimits(array $arguments): void {
	[$email] = requireArguments($arguments, 1, 'send-limits <signerEmail>');
	$document = createSpikeDocument('Spike 6 — limites', 'portrait.pdf', [new NewSigner('Limites', $email, 1, 'spike-limits')], false);
	$results = ['document' => $document->token, 'extraDocuments' => []];
	for ($index = 1; $index <= MAX_EXTRA_DOCUMENTS_TO_TRY; $index++) {
		try {
			client()->uploadExtraDocument($document->token, 'Anexo ' . $index, pdfBase64('portrait.pdf'));
			$results['extraDocuments'][] = ['index' => $index, 'accepted' => true];
		} catch (ZapSignException $failure) {
			$results['extraDocuments'][] = ['index' => $index, 'accepted' => false, 'message' => $failure->getMessage(), 'code' => $failure->providerCode];
			break;
		}
	}
	try {
		createSpikeDocument('Spike 6 — arquivo de 11 MB', 'large-11mb.pdf', [new NewSigner('Limites', $email, 1, 'spike-large')], false);
		$results['elevenMegabytePdf'] = 'accepted';
	} catch (ZapSignException $failure) {
		$results['elevenMegabytePdf'] = $failure::class . ': ' . $failure->getMessage();
	}
	printJson($results);
}

/** @param list<string> $arguments */
function release(array $arguments): void {
	[$signerToken] = requireArguments($arguments, 1, 'release <signerToken>');
	try {
		client()->releaseSigner($signerToken);
		printJson(['released' => true]);
	} catch (ZapSignException $failure) {
		printJson(['released' => false, 'failure' => $failure::class, 'message' => $failure->getMessage(), 'code' => $failure->providerCode]);
	}
}

/** @param list<string> $arguments */
function rawGet(array $arguments): void {
	[$path] = requireArguments($arguments, 1, 'raw <pathWithQuery>   e.g. raw /docs/<token>/');
	$settings = Server::get(ZapSignSettings::class);
	$headers = ['Authorization' => 'Bearer ' . $settings->apiToken(), 'Accept' => 'application/json', 'User-Agent' => 'AvuzConecta-Assinaturas-Spike'];
	$response = Server::get(HttpTransport::class)->send(new HttpRequest('GET', $settings->environment()->apiBaseUrl() . $path, $headers, null, 60));
	$contentType = $response->headers['content-type'] ?? '';
	if (str_contains($contentType, 'pdf')) {
		$savedTo = OUTPUT_DIRECTORY . '/raw-' . gmdate('YmdHis') . '.pdf';
		file_put_contents($savedTo, $response->body);
		printJson(['status' => $response->statusCode, 'contentType' => $contentType, 'savedTo' => $savedTo]);
		return;
	}
	fwrite(STDOUT, 'HTTP ' . $response->statusCode . ' ' . $contentType . PHP_EOL . $response->body . PHP_EOL);
}

/** @param list<string> $arguments */
function inspect(array $arguments): void {
	[$documentToken] = requireArguments($arguments, 1, 'inspect <documentToken>');
	rawGet(['/docs/' . $documentToken . '/']);
}

/** Pre-signed S3 URLs must be fetched WITHOUT the ZapSign Authorization header. */
function download(array $arguments): void {
	[$url, $fileName] = requireArguments($arguments, 2, 'download <preSignedUrl> <fileName>');
	$response = Server::get(HttpTransport::class)->send(new HttpRequest('GET', $url, ['User-Agent' => 'AvuzConecta-Assinaturas-Spike'], null, 120));
	$savedTo = OUTPUT_DIRECTORY . '/' . basename($fileName);
	file_put_contents($savedTo, $response->body);
	printJson(['status' => $response->statusCode, 'bytes' => strlen($response->body), 'savedTo' => $savedTo]);
}

/** @param list<string> $arguments */
function webhookRegister(array $arguments): void {
	[$url, $type] = requireArguments($arguments, 2, 'webhook-register <url> <type|all>');
	$zapSignType = $type === 'all' ? '' : $type;
	try {
		printJson(['type' => $type, 'accepted' => true, 'id' => client()->registerWebhook($url, $zapSignType, ['X-Assinaturas-Spike' => 'spike-secret'])]);
	} catch (ZapSignException $failure) {
		printJson(['type' => $type, 'accepted' => false, 'failure' => $failure::class, 'message' => $failure->getMessage()]);
	}
}

/** @param list<string> $arguments */
function webhookDelete(array $arguments): void {
	[$webhookId] = requireArguments($arguments, 1, 'webhook-delete <id>');
	client()->deleteWebhook((int)$webhookId);
	printJson(['deleted' => (int)$webhookId]);
}

/** @param list<string> $arguments */
function cancel(array $arguments): void {
	[$documentToken] = requireArguments($arguments, 1, 'cancel <documentToken>');
	client()->cancelDocument($documentToken, 'Spike: cancelamento de teste', false);
	printJson(['cancelRequested' => true]);
}

function help(): void {
	fwrite(STDOUT, implode(PHP_EOL, [
		'Commands:',
		'  plan',
		'  send-ordered <firstSignerEmail> <secondSignerEmail>',
		'  send-geometry <signerEmail>',
		'  send-order-group-zero <signerEmail>',
		'  send-limits <signerEmail>',
		'  release <signerToken>',
		'  inspect <documentToken>',
		'  raw <pathWithQuery>',
		'  download <preSignedUrl> <fileName>',
		'  webhook-register <url> <type|all>',
		'  webhook-delete <id>',
		'  cancel <documentToken>',
	]) . PHP_EOL);
}

$commands = [
	'plan' => fn (array $arguments) => printJson(client()->getPlanInfo()),
	'send-ordered' => sendOrdered(...),
	'send-geometry' => sendGeometry(...),
	'send-order-group-zero' => sendOrderGroupZero(...),
	'send-limits' => sendLimits(...),
	'release' => release(...),
	'inspect' => inspect(...),
	'raw' => rawGet(...),
	'download' => download(...),
	'webhook-register' => webhookRegister(...),
	'webhook-delete' => webhookDelete(...),
	'cancel' => cancel(...),
	'help' => fn (array $arguments) => help(),
];

$arguments = array_slice($argv, 1);
$command = array_shift($arguments) ?? 'help';
($commands[$command] ?? $commands['help'])($arguments);
```

- [ ] **Step 5: Write the spike README**

`tests/spike/README.md`:
````markdown
# ZapSign sandbox spikes

These tools answer the open questions in spec §12. **Sandbox only.** Documents
have no legal validity and there is no billing.

## One-time setup

```bash
# 1. Sandbox token: Patrick exports it in his shell (never paste it in chat or commit it).
export ZAPSIGN_SANDBOX_TOKEN=...   # ZapSign sandbox > Configurações > Integrações > ZAPSIGN API
tests/env/php.sh occ config:app:set assinaturas api_token --value="$ZAPSIGN_SANDBOX_TOKEN" --type=string --sensitive
tests/env/php.sh occ config:app:set assinaturas environment --value=sandbox --type=string
tests/env/php.sh occ config:app:set assinaturas company_name --value="Avuz Spike" --type=string

# 2. Test PDFs
tests/env/php.sh apps/assinaturas/tests/spike/make-fixtures.php

# 3. Webhook capture server + public tunnel (both in Docker, nothing installed on the host)
docker run -d --name assinaturas-webhook-capture -p 8099:8099 -e FAIL_FIRST=0 \
  -v "$PWD/tests/spike:/spike" php:8.3-cli php -S 0.0.0.0:8099 /spike/webhook-capture.php
docker run -d --name assinaturas-webhook-tunnel cloudflare/cloudflared:latest \
  tunnel --no-autoupdate --url http://host.docker.internal:8099
sleep 8 && docker logs assinaturas-webhook-tunnel 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | head -1
```

## Run

```bash
tests/env/php.sh apps/assinaturas/tests/spike/run.php help
tests/env/php.sh apps/assinaturas/tests/spike/run.php plan
```

Captured webhooks: `tests/spike/output/webhooks.jsonl`. Downloads: `tests/spike/output/`.

## Teardown

```bash
docker rm -f assinaturas-webhook-capture assinaturas-webhook-tunnel
```
````

- [ ] **Step 6: Lint the new scripts**

Run: `tests/env/php.sh -l apps/assinaturas/tests/spike/run.php && tests/env/php.sh -l apps/assinaturas/tests/spike/webhook-capture.php && tests/env/php.sh -l apps/assinaturas/tests/spike/make-fixtures.php`
Expected: `No syntax errors detected` three times.

Then `tests/env/php.sh apps/assinaturas/tests/spike/run.php help`. Expected: the command list prints. (It needs no token.)

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "test: add ZapSign sandbox spike tooling (PDF fixtures, webhook capture, runner)"
```

---

### Task 9: Run the sandbox spikes and record the findings

This task needs **Patrick**:
- he provides the sandbox token (exported in his shell);
- he provides **two email inboxes he controls** for the test signers, e.g. `dev+s1@…` and `dev+s2@…`;
- he signs in the sandbox where a step says "human signs";
- he confirms before the webhook tunnel is opened.

The agent runs the commands and fills in the findings file.

**Files:**
- Create: `~/work/avuz/avuz-server/.claude/worktrees/avuzconecta-signature-feasibility-59ecdd/docs/zapsign/sandbox-findings.md` (avuz-server repo)
- Create: `~/work/avuz/assinaturas/tests/fixtures/zapsign/recorded-signed-envelope.json`
- Create: `~/work/avuz/assinaturas/tests/fixtures/zapsign/recorded-created-envelope.json`
- Create: `~/work/avuz/assinaturas/tests/Unit/ZapSign/RecordedPayloadsTest.php`
- Modify, only if Spike 3 shows rotated pages land wrong: `lib/ZapSign/Payload/FieldPlacement.php`, `lib/ZapSign/PlacementConverter.php`, `tests/Unit/ZapSign/PlacementConverterTest.php`
- Modify: the spec's §6 and §12 and the digest's ⚠️ items, in the avuz-server repo

**Interfaces:**
- Consumes: the spike runner (Task 8) and the models (Task 6).
- Produces:
  - `docs/zapsign/sandbox-findings.md`, which Plan 2 reads to pick the release mechanics;
  - recorded fixtures plus a test proving the models parse real sandbox responses.

- [ ] **Step 1: Create the findings file**

In the avuz-server worktree, create `docs/zapsign/sandbox-findings.md`:
```markdown
# ZapSign sandbox findings

Run date: YYYY-MM-DD. Environment: ZapSign sandbox. Runner: `assinaturas/tests/spike/run.php`.

## Spike 1: Release and emails
| Question | Observed | Evidence |
|---|---|---|
| 1a. Does `releaseSigner` (update `send_automatic_email: true`) send the FIRST email? | | |
| 1b. After group 1 signs, does ZapSign email group 2 automatically? | | |
| 1c. Does releasing group 2 BEFORE group 1 signs email it out of order? Can it sign? | | |
| 1d. Do signers receive the final signed copy by email? | | |
| 1e. Where does `custom_message` appear in the email? | | |
| 1f. Does a second `releaseSigner` within 30 min return `cooldown_period` (429)? | | |
| **Decision:** Plan A holds / needs next-group release by SyncJob / needs our own final-copy email | | |

## Spike 2: Signed files
| Question | Observed | Evidence |
|---|---|---|
| 2a. Is the evidence (report) page appended to the main document's signed PDF? | | |
| 2b. Is it appended to EACH extra document's signed PDF too? | | |
| 2c. When does `signed_file` get populated (after each signature / only when status=signed)? | | |
| 2d. Activity log (`signer-log?download_pdf=true`): content-type and shape | | |

## Spike 3: Formats and geometry
| Question | Observed | Evidence |
|---|---|---|
| 3a. Sandbox `sign_url` host | | |
| 3b. `order_group` 0 accepted? | | |
| 3c. Landscape page: boxes land where displayed? | | |
| 3d. `/Rotate 90` and `/Rotate 270`: boxes land where DISPLAYED, or in unrotated space? | | |
| 3e. CropBox-offset page: boxes relative to the CropBox (visible) or the MediaBox? | | |
| 3f. Extra document placement via its own token works? | | |

## Spike 4: Webhooks
| Question | Observed | Evidence |
|---|---|---|
| 4a. Accepted `type` values (`all`, `doc_signed`, `doc_refused`, `email_bounce`, `doc_viewed`, `doc_expired`, `doc_created`, `doc_deleted`) | | |
| 4b. Custom header delivered as configured? | | |
| 4c. Payload of an event on an extra document: which token is at the top level? | | |
| 4d. Retry cadence with FAIL_FIRST=3 (timestamps of attempts) | | |
| 4e. Event when we cancel (`doc_refused`? `doc_signed`?) and the status string | | |

## Spike 5: Inbox noise
| Question | Observed | Evidence |
|---|---|---|
| 5. Does the sandbox account owner receive emails for API-created documents? (The partner/sub-account case is re-checked on the pilot in Plan 4.) | | |

## Spike 6: Limits
| Question | Observed | Evidence |
|---|---|---|
| 6a. Max extra documents per envelope | | |
| 6b. 11 MB PDF accepted? | | |
```

- [ ] **Step 2: Configure the token and generate PDFs**

Ask Patrick to run `export ZAPSIGN_SANDBOX_TOKEN=...` in the shell the agent uses. The agent must never ask for the value in chat. Then run:
```bash
cd ~/work/avuz/assinaturas
tests/env/php.sh occ config:app:set assinaturas api_token --value="$ZAPSIGN_SANDBOX_TOKEN" --type=string --sensitive
tests/env/php.sh occ config:app:set assinaturas environment --value=sandbox --type=string
tests/env/php.sh occ config:app:set assinaturas company_name --value="Avuz Spike" --type=string
tests/env/php.sh apps/assinaturas/tests/spike/make-fixtures.php
tests/env/php.sh apps/assinaturas/tests/spike/run.php plan
```
Expected: `plan` prints JSON with `name`, `credits` and `status`. That proves the token and pipeline work against the real sandbox.

- [ ] **Step 3: Start the webhook capture and register webhooks (Spike 4a/4b)**

Confirm with Patrick first: this opens a temporary public `trycloudflare.com` URL that forwards to the local capture server.
```bash
docker run -d --name assinaturas-webhook-capture -p 8099:8099 -e FAIL_FIRST=0 \
  -v "$PWD/tests/spike:/spike" php:8.3-cli php -S 0.0.0.0:8099 /spike/webhook-capture.php
docker run -d --name assinaturas-webhook-tunnel cloudflare/cloudflared:latest \
  tunnel --no-autoupdate --url http://host.docker.internal:8099
sleep 8 && TUNNEL_URL=$(docker logs assinaturas-webhook-tunnel 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | head -1) && echo "$TUNNEL_URL"
for type in all doc_signed doc_refused email_bounce doc_viewed doc_expired doc_created doc_deleted; do
  tests/env/php.sh apps/assinaturas/tests/spike/run.php webhook-register "$TUNNEL_URL/webhook" "$type"
done
```
Record in 4a which types returned `accepted: true` and their ids. **Keep the ids**: webhooks can't be listed later.

- [ ] **Step 4: Spike 1 and 2 (ordered envelope, release, signing)**

Run with Patrick's two inboxes:
```bash
tests/env/php.sh apps/assinaturas/tests/spike/run.php send-ordered "<inbox1>" "<inbox2>"
```
Save the printed document token, extra-document token and signer tokens. Right away, before any release, run `inspect <documentToken>` and save the JSON body (everything after the `HTTP 200` line) as `tests/fixtures/zapsign/recorded-created-envelope.json`. Replace the two inbox addresses with `ana@example.com` / `bruno@example.com`.

1. Wait 2 minutes and check **both** inboxes. Record that **no** email arrived; this confirms emails are held back at creation.
2. Release signer 1:
   ```bash
   tests/env/php.sh apps/assinaturas/tests/spike/run.php release <signer1Token>
   ```
   → Did inbox 1 get the email (1a)? Where does `SPIKE custom_message` appear (1e)?
3. Run `release <signer1Token>` again right away → record the result (1f).
4. **Human signs** as signer 1 from the email link (or the `signUrl`). Then check inbox 2 for up to 5 minutes (1b).
5. Run:
   ```bash
   tests/env/php.sh apps/assinaturas/tests/spike/run.php inspect <documentToken>
   ```
   → Is `signed_file` null or set after the first signature (2c)?
6. If inbox 2 got nothing, run `release <signer2Token>`. **Human signs** as signer 2.
7. Run `inspect <documentToken>` → the status should be `signed`. Save the full JSON body (everything after the `HTTP 200` line) as `tests/fixtures/zapsign/recorded-signed-envelope.json`. Replace the two inbox addresses with `ana@example.com` / `bruno@example.com`.
8. Download both signed PDFs with `download "<signed_file url>" main-signed.pdf` and `download "<extra signed_file url>" extra-signed.pdf`. Open them and record whether the evidence page is appended to each (2a, 2b).
9. Run:
   ```bash
   tests/env/php.sh apps/assinaturas/tests/spike/run.php raw "/docs/signer-log/<documentToken>?download_pdf=true"
   ```
   → record the content type and shape (2d).
10. Check both inboxes for the final signed copy (1d). Check the sandbox owner's inbox for any notification (5).

Out-of-order check (1c):
1. Run `send-ordered "<inbox1>" "<inbox2>"` again.
2. Release **signer 2 first**: `release <signer2Token>`.
3. Record whether inbox 2 got an email and whether its link lets signer 2 sign before signer 1.
4. Then run `cancel <documentToken>`. Read `webhooks.jsonl` to see which event and status the cancel produced (4e).

- [ ] **Step 5: Spike 3 (geometry and order group)**

```bash
tests/env/php.sh apps/assinaturas/tests/spike/run.php send-geometry "<inbox1>"
tests/env/php.sh apps/assinaturas/tests/spike/run.php send-order-group-zero "<inbox1>"
```

1. Record the `send-order-group-zero` result (3b) and the `signUrl` host (3a).
2. **Human signs** the geometry envelope from its `signUrl`.
3. Download every signed file.
4. For each page, record where the signature and initials landed relative to the page **as displayed** (3c–3f). The expected spots are top-left and bottom-right on every page. The `UNROTATED …` labels show which space ZapSign used.

- [ ] **Step 6: Spike 4d (webhook retries) and Spike 6 (limits)**

```bash
docker rm -f assinaturas-webhook-capture
docker run -d --name assinaturas-webhook-capture -p 8099:8099 -e FAIL_FIRST=3 \
  -v "$PWD/tests/spike:/spike" php:8.3-cli php -S 0.0.0.0:8099 /spike/webhook-capture.php
rm -f tests/spike/output/webhook-counter
tests/env/php.sh apps/assinaturas/tests/spike/run.php send-limits "<inbox1>"
```

1. `send-limits` creates a document, which fires `doc_created`.
2. Wait 30 minutes. Read `tests/spike/output/webhooks.jsonl` and record the retry attempts and their timestamps (4d).
3. Record the `send-limits` results (6a, 6b).
4. Record 4c from any captured event on an extra document.
5. Record 4b: is `X-Assinaturas-Spike` present in the captured headers?

- [ ] **Step 7: Tear down the tunnel and webhooks**

```bash
for id in <every webhook id from Step 3>; do tests/env/php.sh apps/assinaturas/tests/spike/run.php webhook-delete "$id"; done
docker rm -f assinaturas-webhook-capture assinaturas-webhook-tunnel
```
Expected: each delete prints `{"deleted": <id>}`, and both containers are gone.

- [ ] **Step 8: Write the recorded-payload test**

`tests/Unit/ZapSign/RecordedPayloadsTest.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\ZapSign;

use OCA\Assinaturas\ZapSign\Model\ZapSignDocument;
use OCA\Assinaturas\ZapSign\Model\ZapSignSigner;
use PHPUnit\Framework\TestCase;

/** Proves the models parse real sandbox responses, not just the shapes the docs describe. */
final class RecordedPayloadsTest extends TestCase {
	public function testParsesARecordedSignedEnvelope(): void {
		$document = ZapSignDocument::fromPayload(self::recorded('recorded-signed-envelope'));

		$this->assertNotSame('', $document->token);
		$this->assertSame('signed', $document->status);
		$this->assertNotNull($document->signedFileUrl);
		$this->assertNotEmpty($document->extraDocuments);
		$this->assertNotNull($document->extraDocuments[0]->signedFileUrl);
		$this->assertCount(2, $document->signers);
		foreach ($document->signers as $signer) {
			$this->assertSame('signed', $signer->status);
			$this->assertNotNull($signer->signedAt);
		}
	}

	public function testParsesARecordedPendingEnvelope(): void {
		$document = ZapSignDocument::fromPayload(self::recorded('recorded-created-envelope'));

		$this->assertNotSame('', $document->token);
		$this->assertNotSame('signed', $document->status);
		$this->assertNotEmpty($document->signers);
		$signerTokens = array_map(fn (ZapSignSigner $signer): string => $signer->token, $document->signers);
		$this->assertNotContains('', $signerTokens);
	}

	/** @return array<mixed> */
	private static function recorded(string $name): array {
		$contents = (string)file_get_contents(__DIR__ . '/../../fixtures/zapsign/' . $name . '.json');
		return json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
	}
}
```

Run: `tests/env/phpunit.sh --filter RecordedPayloadsTest`
Expected: `OK (2 tests, …)`.

If a model assertion fails, the model is wrong about the real shape. Fix the model's `fromPayload` to match the recorded JSON, re-run until green, and note the difference in the findings file.

- [ ] **Step 9: Only if Spike 3d shows boxes land in unrotated space on rotated pages, add rotation mapping**

Skip this step if rotated pages placed the boxes where they are displayed.

Add `pageRotation` to `lib/ZapSign/Payload/FieldPlacement.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign\Payload;

/** A box as drawn in our editor: top-left origin, 0..1 relative to the page as displayed. */
final class FieldPlacement {
	public function __construct(
		public readonly string $type,
		public readonly int $page,
		public readonly float $x,
		public readonly float $y,
		public readonly float $width,
		public readonly float $height,
		public readonly int $pageRotation = 0,
	) {
	}
}
```

Replace `lib/ZapSign/PlacementConverter.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\ZapSign;

use OCA\Assinaturas\ZapSign\Payload\FieldPlacement;
use OCA\Assinaturas\ZapSign\Payload\SignatureBox;

/**
 * ZapSign places boxes in the UNROTATED page space (Spike 3d), while our editor
 * draws on the page as displayed. Rotation maps displayed → unrotated before the
 * y-flip to ZapSign's bottom-left percentages. PDF /Rotate is clockwise.
 */
final class PlacementConverter {
	private const ZAPSIGN_TYPES = ['signature' => 'signature', 'initials' => 'visto'];
	private const FULL_PAGE_PERCENT = 100.0;
	private const DECIMALS = 2;

	public function toSignatureBox(FieldPlacement $field, string $signerToken): SignatureBox {
		$zapSignType = self::ZAPSIGN_TYPES[$field->type] ?? throw new \InvalidArgumentException('Unknown field type: ' . $field->type);
		[$x, $y, $boxWidth, $boxHeight] = self::toUnrotatedSpace($field);
		$width = self::percent($boxWidth);
		$height = self::percent($boxHeight);
		$left = min(self::percent($x), self::FULL_PAGE_PERCENT - $width);
		$bottom = min(self::percent(1.0 - $y - $boxHeight), self::FULL_PAGE_PERCENT - $height);
		return new SignatureBox($signerToken, $zapSignType, $field->page, max(0.0, $left), max(0.0, $bottom), $width, $height);
	}

	/** @return array{0: float, 1: float, 2: float, 3: float} x, y, width, height in unrotated top-left space */
	private static function toUnrotatedSpace(FieldPlacement $field): array {
		$mappings = [
			0 => fn (): array => [$field->x, $field->y, $field->width, $field->height],
			90 => fn (): array => [$field->y, 1.0 - $field->x - $field->width, $field->height, $field->width],
			180 => fn (): array => [1.0 - $field->x - $field->width, 1.0 - $field->y - $field->height, $field->width, $field->height],
			270 => fn (): array => [1.0 - $field->y - $field->height, $field->x, $field->height, $field->width],
		];
		$normalizedRotation = (($field->pageRotation % 360) + 360) % 360;
		$mapping = $mappings[$normalizedRotation] ?? throw new \InvalidArgumentException('Unsupported page rotation: ' . $field->pageRotation);
		return $mapping();
	}

	private static function percent(float $fraction): float {
		return round($fraction * self::FULL_PAGE_PERCENT, self::DECIMALS);
	}
}
```

Add these tests to `tests/Unit/ZapSign/PlacementConverterTest.php`:
```php
	public function testMapsADisplayedTopLeftBoxOnAPageRotated90ToTheUnrotatedBottomLeft(): void {
		$box = $this->converter->toSignatureBox(new FieldPlacement('signature', 0, 0.05, 0.05, 0.20, 0.09, 90), 'signer-token');

		$this->assertSame(5.0, $box->left);
		$this->assertSame(5.0, $box->bottom);
		$this->assertSame(9.0, $box->width);
		$this->assertSame(20.0, $box->height);
	}

	public function testMapsADisplayedTopLeftBoxOnAPageRotated270ToTheUnrotatedTopRight(): void {
		$box = $this->converter->toSignatureBox(new FieldPlacement('signature', 0, 0.05, 0.05, 0.20, 0.09, 270), 'signer-token');

		$this->assertSame(86.0, $box->left);
		$this->assertSame(75.0, $box->bottom);
		$this->assertSame(9.0, $box->width);
		$this->assertSame(20.0, $box->height);
	}

	public function testRejectsAnUnsupportedRotation(): void {
		$this->expectException(\InvalidArgumentException::class);

		$this->converter->toSignatureBox(new FieldPlacement('signature', 0, 0.1, 0.1, 0.1, 0.1, 45), 'signer-token');
	}
```

Why these values: `/Rotate` turns the page clockwise.
- On a page rotated 90°, the displayed top-left is the unrotated **bottom-left**. ZapSign gets left 5, bottom 5.
- On a page rotated 270°, the displayed top-left is the unrotated **top-right**. ZapSign gets left 86, bottom 75.
- The box's width and height swap in both cases.

The signed geometry PDF from Spike 3 is the source of truth. If a rotated page still misplaces the box, that rotation's direction is inverted: swap the 90 and 270 closures in `toUnrotatedSpace()` and the expected values in these two tests.

Run: `tests/env/phpunit.sh --filter PlacementConverterTest`
Expected: all pass.

Re-run the geometry spike (`send-geometry`), sign, and download. Confirm the rotated pages now show the boxes top-left and bottom-right as displayed. Update 3d in the findings.

- [ ] **Step 10: Commit the app repo**

```bash
cd ~/work/avuz/assinaturas
git add -A && git commit -m "test: record sandbox payloads and prove models parse real ZapSign responses"
```

- [ ] **Step 11: Fold the findings back into the spec and digest (avuz-server repo)**

In the avuz-server worktree:

1. `docs/zapsign/sandbox-findings.md` — every row filled; the Spike 1 **Decision** line completed.
2. `docs/superpowers/specs/2026-09-28-assinaturas-zapsign-design.md`:
   - §6 "Release and reminders": replace "depends on Spike 1" with the decided mechanics.
   - §12: mark each spike answered, with a link to the findings file.
3. `docs/zapsign/api-digest.md`: resolve each ⚠️ that a spike answered (status strings, `order_group` base, `sign_url` host, webhook types, retry cadence, signed-file timing, limits).
4. `docs/superpowers/plans/2026-09-28-assinaturas-roadmap.md`: set Plan 1 status to `Done` and add a one-line pointer to the findings.

```bash
cd ~/work/avuz/avuz-server/.claude/worktrees/avuzconecta-signature-feasibility-59ecdd
git add docs/zapsign/sandbox-findings.md docs/zapsign/api-digest.md docs/superpowers/specs/2026-09-28-assinaturas-zapsign-design.md docs/superpowers/plans/2026-09-28-assinaturas-roadmap.md
git commit -m "docs: record ZapSign sandbox spike findings and settle release mechanics"
```

- [ ] **Step 12: Final verification**

Run: `cd ~/work/avuz/assinaturas && tests/env/phpunit.sh`
Expected: the full suite is green: 83 tests, or 86 if the Step 9 rotation tests were added.

Then confirm the Plan 1 exit criteria from the roadmap:
- all tests green;
- every row of `sandbox-findings.md` filled;
- the Spike 1 decision written;
- the spec and digest updated.

Report to Patrick with a summary of the findings that change Plan 2.
