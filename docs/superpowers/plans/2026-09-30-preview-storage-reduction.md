# Preview Storage Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lower the Nextcloud preview cap to 1280 and purge every existing preview (tracked + orphaned) on the 8 S3 prod clients, so previews regenerate on demand at the smaller size.

**Architecture:** A small PHP toolkit under `scripts/previews/` — a pure, unit-tested `lib.php` (bucket walking, cutoff sweep, option parsing, preconditions) plus two thin in-container entry scripts (`scan.php`, `purge.php`). `run.sh` bundles `lib.php` + an entry script, base64-evals it inside the NC container as `www-data` via the existing Portainer exec wrappers. The entrypoint default cap changes to 1280 and ships with the next fleet rollout; each client also gets the cap set via `occ` right before its purge.

**Tech Stack:** PHP 8.3 (container; tests run on local PHP ≥ 8.3), NC 33 internals (`PrimaryObjectStoreConfig`, `ISnowflakeDecoder`, `IDBConnection`), bundled `aws/aws-sdk-php` `S3Client`, bash, Portainer exec (`scripts/portainer-exec.sh` / `portainer-exec-prod.sh`).

**Spec:** `docs/superpowers/specs/2026-09-29-preview-storage-reduction-design.md`

## Global Constraints

- New preview cap: `preview_max_x` = `preview_max_y` = **1280**. Per-stack override via `PREVIEW_MAX_X/Y` env stays.
- Purge order is fixed: truncate `oc_previews` + `oc_preview_generation` **first**, then sweep objects. Never truncate `oc_preview_locations` or `oc_preview_versions`.
- Cutoff = purge start − **10 minutes**; only objects whose Snowflake `createdAt` < cutoff are deleted.
- Sweep only the bucket from the instance's own `root` object-store config. Never a bucket that only appears in `oc_preview_locations`.
- Guardrails: 1,000 keys per list/delete request, 200 ms pause between requests, abort on any request error or any request > 5 s, progress line every 100 pages.
- `purge` without flags is a dry run. `--execute` truncates + deletes. `--sweep-only --cutoff=<ISO 8601>` resumes a sweep.
- Prod: off-hours only; every prod command (occ set, dry run, execute, scan) needs Patrick's explicit go **per client**. Staging is autonomous.
- Portainer exec does **not** propagate the container's exit code — judge every run by its output lines (`precondition FAIL`, `ABORTED`).
- Local-disk clients (avuz-app3, cartorio-veranopolis, digrepal, endopasso) are out of scope; `purge` refuses them.
- Code style: named things over comments, early returns, no abbreviations, query builder only (no raw SQL), tests in 3rd person (`ok - sweep deletes …`).

## File Structure

| Path | Responsibility |
|---|---|
| `docker/entrypoint.sh` (modify) | Default cap 2048 → 1280, comment refresh, `AVUZ_CONFIG_VERSION` bump |
| `scripts/previews/lib.php` (create) | Pure logic: `BucketClient` + `S3BucketClient`, `Guardrails`, `walkBucket`, `sweepPreviews`, `parsePurgeOptions`, `purgePreconditionProblems`, `previewIdFromKey`, `previewKeyPrefix`, `gibibytes` |
| `scripts/previews/tests/lib.test.php` (create) | Behaviour tests for `lib.php` with a fake bucket client and fake clock |
| `scripts/previews/scan.php` (create) | Read-only bucket-vs-DB report (in container) |
| `scripts/previews/purge.php` (create) | Preconditions → truncate → sweep → report (in container) |
| `scripts/previews/run.sh` (create) | Bundle + exec via Portainer, `staging`/`prod` explicit |
| `CLAUDE.md` (modify) | Short "Preview storage tools" section |
| `docs/superpowers/specs/2026-09-29-preview-storage-reduction-design.md` (modify) | Tool paths → `scripts/previews/*` |

---

### Task 1: Preview cap 1280 in the entrypoint

**Files:**
- Modify: `docker/entrypoint.sh:5` and `docker/entrypoint.sh:424-433`

**Interfaces:**
- Produces: on first boot of the new image, `occ config:system:get preview_max_x` → `1280` (unless the stack sets `PREVIEW_MAX_X`).

- [ ] **Step 1: Bring the worktree up to date with `avuz-customization`**

The worktree branched before `81f1027d438` (Assinaturas Plan 2a merge). Merge the real main branch — **not** `master` (upstream NC). If the app's sync tool targets `master`, do not use it.

```bash
git merge --no-edit avuz-customization
git show HEAD:docker/entrypoint.sh | sed -n 5p
```

Expected: merge succeeds; line 5 prints `AVUZ_CONFIG_VERSION="33.0.0-20"`. If it prints a higher number, use that number + 1 in Step 3 instead of `-21`.

- [ ] **Step 2: Replace the cap block (lines 424-433)**

Replace:

```bash
    # Preview size caps. NC defaults to 4096x4096, and on an S3 primary store
    # previews are billed but invisible: they live under the uri:oid:preview:
    # key prefix, are tracked in oc_previews (not oc_filecache), so no quota
    # counter — user, admin panel or occ — ever reports them. Measured on
    # eco-ambiental: 66 GiB of previews against 513 GiB of file data, from only
    # a quarter of the library previewed so far. Dropping to 2048 is 4x fewer
    # pixels on the largest tier; grid thumbnails are unaffected. Raise per
    # stack (no rebuild) for tenants who zoom into scans or GIS rasters.
    php occ config:system:set preview_max_x --value="${PREVIEW_MAX_X:-2048}" --type=integer
    php occ config:system:set preview_max_y --value="${PREVIEW_MAX_Y:-2048}" --type=integer
```

with:

```bash
    # Preview size caps. NC defaults to 4096x4096, and on an S3 primary store
    # previews are billed but invisible: they live under the uri:oid:preview:
    # key prefix, are tracked in oc_previews (not oc_filecache), so no quota
    # counter — user, admin panel or occ — ever reports them. NC always renders
    # the max-size tier first and derives smaller ones from it, so the cap
    # drives the cost. Measured 2026-09-29 at 2048: 348 GiB of previews across
    # the 8 S3 clients (grupo-vidalar 196, eco-ambiental 98). 1280 is ~2.5x
    # fewer pixels; grid thumbnails are unaffected, viewer images stay sharp on
    # 1080p. Raise per stack (no rebuild) for tenants who zoom into scans or GIS
    # rasters. Purge + regrow: scripts/previews/run.sh.
    php occ config:system:set preview_max_x --value="${PREVIEW_MAX_X:-1280}" --type=integer
    php occ config:system:set preview_max_y --value="${PREVIEW_MAX_Y:-1280}" --type=integer
```

- [ ] **Step 3: Bump the config version (line 5)**

```bash
AVUZ_CONFIG_VERSION="33.0.0-21"
```

- [ ] **Step 4: Verify**

```bash
bash -n docker/entrypoint.sh && echo syntax-ok
grep -n 'PREVIEW_MAX_[XY]:-' docker/entrypoint.sh
sed -n 5p docker/entrypoint.sh
```

Expected: `syntax-ok`; two lines with `:-1280`; `AVUZ_CONFIG_VERSION="33.0.0-21"`.

- [ ] **Step 5: Commit**

```bash
git add docker/entrypoint.sh
git commit -m "feat(entrypoint): lower preview cap to 1280

Previews cost 348 GiB across the 8 S3 clients at 2048. Bump config
version to 33.0.0-21 so the new cap applies on first boot.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Preview tools library (TDD)

**Files:**
- Create: `scripts/previews/tests/lib.test.php`
- Create: `scripts/previews/lib.php`

**Interfaces:**
- Produces (namespace `Avuz\PreviewTools`, used by Task 3):
  - `interface BucketClient { listPage(string $prefix, ?string $continuationToken, int $pageSize): BucketPage; deleteKeys(array $keys): array /* list<string> errors */ }`
  - `final class S3BucketClient implements BucketClient { __construct(\Aws\S3\S3Client $client, string $bucket) }`
  - `final class Guardrails { static production(): self }` — pageSize 1000, pause 200 000 µs, slow 5.0 s, progress every 100 pages
  - `walkBucket(BucketClient, string $prefix, Guardrails, \Closure(BucketPage): ?string $onPage): WalkOutcome` — `WalkOutcome{pages, objects, bytes, slowestSeconds, elapsedSeconds, abortReason}`
  - `sweepPreviews(BucketClient, string $prefix, \DateTimeImmutable $cutoff, \Closure(string): \DateTimeImmutable $createdAt, bool $dryRun, Guardrails): SweepOutcome` — `SweepOutcome{purgeable, purgeableBytes, deleted, deletedBytes, kept, keptBytes, foreignKeys, slowestDeleteSeconds, walk}`
  - `parsePurgeOptions(list<string>): PurgeOptions{mode: PurgeMode, cutoff: ?DateTimeImmutable}`; `enum PurgeMode: string { DryRun='dry-run'; Execute='execute'; SweepOnly='sweep-only' }`
  - `purgePreconditionProblems(bool $hasObjectStore, bool $multibucket, int $previewMaxX, int $previewMaxY, int $requiredPreviewMax): list<string>`
  - `previewIdFromKey(string $key, string $prefix): ?string`, `previewKeyPrefix(array $objectStoreArguments): string`, `gibibytes(int|float): string`, `const DEFAULT_PREVIEW_PREFIX = 'uri:oid:preview:'`

- [ ] **Step 1: Write the failing tests**

Create `scripts/previews/tests/lib.test.php`:

````php
<?php
declare(strict_types=1);

namespace Avuz\PreviewTools;

require __DIR__ . '/../lib.php';

final class FakeTime {
	public float $now = 0.0;
}

final class FakeBucketClient implements BucketClient {
	/** @var array<string, int> key => size, sorted by key */
	private array $objects;
	/** @var list<list<string>> */
	public array $deleteBatches = [];
	public int $listCalls = 0;

	/**
	 * @param array<string, int> $objects
	 * @param ?int $failListOnCall 1-based list call that throws
	 * @param list<float> $listLatencies seconds added per list call, by call index (default 0.1)
	 * @param list<string> $deleteErrors returned by every delete call
	 */
	public function __construct(
		array $objects,
		private readonly FakeTime $time,
		private readonly ?int $failListOnCall = null,
		private readonly array $listLatencies = [],
		private readonly array $deleteErrors = [],
		private readonly float $deleteLatency = 0.1,
	) {
		ksort($objects, SORT_STRING);
		$this->objects = $objects;
	}

	public function listPage(string $prefix, ?string $continuationToken, int $pageSize): BucketPage {
		$this->listCalls++;
		$this->time->now += $this->listLatencies[$this->listCalls - 1] ?? 0.1;
		if ($this->listCalls === $this->failListOnCall) {
			throw new \RuntimeException('connection reset');
		}
		$matching = array_filter(
			$this->objects,
			fn (string $key): bool => str_starts_with($key, $prefix) && ($continuationToken === null || strcmp($key, $continuationToken) > 0),
			ARRAY_FILTER_USE_KEY,
		);
		$pageObjects = array_slice($matching, 0, $pageSize, true);
		$objects = [];
		foreach ($pageObjects as $key => $size) {
			$objects[] = new BucketObject((string)$key, $size);
		}
		$lastKey = array_key_last($pageObjects);
		$hasMore = count($matching) > $pageSize;
		return new BucketPage($objects, $hasMore ? (string)$lastKey : null);
	}

	public function deleteKeys(array $keys): array {
		$this->time->now += $this->deleteLatency;
		$this->deleteBatches[] = $keys;
		if ($this->deleteErrors !== []) {
			return $this->deleteErrors;
		}
		foreach ($keys as $key) {
			unset($this->objects[$key]);
		}
		return [];
	}

	/** @return list<string> */
	public function keys(): array {
		return array_map('strval', array_keys($this->objects));
	}
}

final class PauseRecorder {
	public int $calls = 0;
}

function testGuardrails(FakeTime $time, PauseRecorder $pauses, int $pageSize = 1000): Guardrails {
	return new Guardrails(
		pageSize: $pageSize,
		pauseMicroseconds: 200_000,
		slowRequestSeconds: 5.0,
		progressEveryPages: 100,
		clock: fn (): float => $time->now,
		pause: function (int $_microseconds) use ($pauses): void {
			$pauses->calls++;
		},
		progress: function (string $_line): void {
		},
	);
}

/** @return array<string, int> preview key => size; id doubles as unix creation second */
function previewObjects(int $firstId, int $count, int $size = 100): array {
	$objects = [];
	for ($id = $firstId; $id < $firstId + $count; $id++) {
		$objects[DEFAULT_PREVIEW_PREFIX . $id] = $size;
	}
	return $objects;
}

function createdAtFromUnixId(): \Closure {
	return fn (string $previewId): \DateTimeImmutable => (new \DateTimeImmutable())->setTimestamp((int)$previewId);
}

function cutoffAt(int $unixSeconds): \DateTimeImmutable {
	return (new \DateTimeImmutable())->setTimestamp($unixSeconds);
}

$failures = 0;
function assertSameValue(string $description, mixed $expected, mixed $actual): void {
	global $failures;
	if ($expected === $actual) {
		echo "ok - {$description}\n";
		return;
	}
	echo "NOT OK - {$description}\n  expected: " . var_export($expected, true) . "\n  actual:   " . var_export($actual, true) . "\n";
	$failures++;
}

// ── previewIdFromKey ──
assertSameValue('previewIdFromKey returns the numeric id', '123', previewIdFromKey('uri:oid:preview:123', DEFAULT_PREVIEW_PREFIX));
assertSameValue('previewIdFromKey rejects file objects', null, previewIdFromKey('urn:oid:123', DEFAULT_PREVIEW_PREFIX));
assertSameValue('previewIdFromKey rejects non-numeric ids', null, previewIdFromKey('uri:oid:preview:12a', DEFAULT_PREVIEW_PREFIX));
assertSameValue('previewIdFromKey rejects a bare prefix', null, previewIdFromKey('uri:oid:preview:', DEFAULT_PREVIEW_PREFIX));

// ── previewKeyPrefix ──
assertSameValue('previewKeyPrefix defaults to uri:oid:preview:', 'uri:oid:preview:', previewKeyPrefix(['bucket' => 'b']));
assertSameValue('previewKeyPrefix honours objectPrefix', 'tenant:preview:', previewKeyPrefix(['objectPrefix' => 'tenant:']));

// ── parsePurgeOptions ──
assertSameValue('no flags means dry run', PurgeMode::DryRun, parsePurgeOptions([])->mode);
assertSameValue('--execute selects execute', PurgeMode::Execute, parsePurgeOptions(['--execute'])->mode);
assertSameValue('--sweep-only keeps the given cutoff', '2026-10-01T02:00:00+00:00', parsePurgeOptions(['--sweep-only', '--cutoff=2026-10-01T02:00:00+00:00'])->cutoff?->format(DATE_ATOM));
foreach ([['--sweep-only'], ['--execute', '--cutoff=2026-10-01T02:00:00+00:00'], ['--force']] as $invalidArguments) {
	$rejected = false;
	try {
		parsePurgeOptions($invalidArguments);
	} catch (\InvalidArgumentException) {
		$rejected = true;
	}
	assertSameValue('parsePurgeOptions rejects ' . implode(' ', $invalidArguments), true, $rejected);
}

// ── purgePreconditionProblems ──
assertSameValue('S3 at 1280 has no problems', [], purgePreconditionProblems(true, false, 1280, 1280, 1280));
assertSameValue('local instance is refused', ['no primary object store (local-disk instance)'], purgePreconditionProblems(false, false, 1280, 1280, 1280));
assertSameValue('multibucket is refused', ['multibucket object store is not supported'], purgePreconditionProblems(true, true, 1280, 1280, 1280));
assertSameValue('old cap is refused', ['preview_max_x/y is 2048/2048, expected 1280'], purgePreconditionProblems(true, false, 2048, 2048, 1280));

// ── walkBucket ──
$time = new FakeTime();
$pauses = new PauseRecorder();
$client = new FakeBucketClient(previewObjects(1, 2500, 10), $time);
$walk = walkBucket($client, DEFAULT_PREVIEW_PREFIX, testGuardrails($time, $pauses), fn (BucketPage $_page): ?string => null);
assertSameValue('walk counts every object across pages', 2500, $walk->objects);
assertSameValue('walk sums sizes across pages', 25000, $walk->bytes);
assertSameValue('walk reads 3 pages of 1000', 3, $walk->pages);
assertSameValue('walk pauses between pages only', 2, $pauses->calls);
assertSameValue('walk completes without abort', null, $walk->abortReason);

$time = new FakeTime();
$client = new FakeBucketClient(previewObjects(1, 2500), $time, failListOnCall: 2);
$walk = walkBucket($client, DEFAULT_PREVIEW_PREFIX, testGuardrails($time, new PauseRecorder()), fn (BucketPage $_page): ?string => null);
assertSameValue('walk stops on a list error', 'list request error: connection reset', $walk->abortReason);
assertSameValue('walk keeps partial counts on abort', 1000, $walk->objects);

$time = new FakeTime();
$client = new FakeBucketClient(previewObjects(1, 2500), $time, listLatencies: [0.1, 6.0, 0.1]);
$walk = walkBucket($client, DEFAULT_PREVIEW_PREFIX, testGuardrails($time, new PauseRecorder()), fn (BucketPage $_page): ?string => null);
assertSameValue('walk stops on a slow list request', 'slow list request 6.0s', $walk->abortReason);
assertSameValue('walk stops after the slow page', 2, $client->listCalls);

// ── sweepPreviews ──
$time = new FakeTime();
$objects = previewObjects(1, 1500) + previewObjects(5000, 300) + ['urn:oid:42' => 999, 'uri:oid:preview:bad' => 7];
$client = new FakeBucketClient($objects, $time);
$sweep = sweepPreviews($client, DEFAULT_PREVIEW_PREFIX, cutoffAt(5000), createdAtFromUnixId(), false, testGuardrails($time, new PauseRecorder()));
assertSameValue('sweep deletes previews older than the cutoff', 1500, $sweep->deleted);
assertSameValue('sweep keeps previews at or after the cutoff', 300, $sweep->kept);
assertSameValue('sweep skips non-numeric preview keys', 1, $sweep->foreignKeys);
assertSameValue('sweep never lists file objects', true, in_array('urn:oid:42', $client->keys(), true));
assertSameValue('sweep leaves exactly the kept and foreign keys', 302, count($client->keys()));
assertSameValue('sweep deletes in batches of at most the page size', true, max(array_map('count', $client->deleteBatches)) <= 1000);
assertSameValue('sweep sends one delete per page with purgeable keys', 2, count($client->deleteBatches));
assertSameValue('sweep completes without abort', null, $sweep->walk->abortReason);

$time = new FakeTime();
$client = new FakeBucketClient(previewObjects(1, 1500), $time);
$sweep = sweepPreviews($client, DEFAULT_PREVIEW_PREFIX, cutoffAt(5000), createdAtFromUnixId(), true, testGuardrails($time, new PauseRecorder()));
assertSameValue('dry run counts purgeable previews', 1500, $sweep->purgeable);
assertSameValue('dry run deletes nothing', 0, count($client->deleteBatches));
assertSameValue('dry run leaves every object', 1500, count($client->keys()));

$time = new FakeTime();
$client = new FakeBucketClient(previewObjects(1, 1500), $time, deleteErrors: ['uri:oid:preview:1: AccessDenied denied']);
$sweep = sweepPreviews($client, DEFAULT_PREVIEW_PREFIX, cutoffAt(5000), createdAtFromUnixId(), false, testGuardrails($time, new PauseRecorder()));
assertSameValue('sweep stops on delete errors', '1 delete errors, first: uri:oid:preview:1: AccessDenied denied', $sweep->walk->abortReason);
assertSameValue('sweep counts nothing as deleted when the store refuses', 0, $sweep->deleted);

$time = new FakeTime();
$client = new FakeBucketClient(previewObjects(1, 1500), $time, deleteLatency: 7.0);
$sweep = sweepPreviews($client, DEFAULT_PREVIEW_PREFIX, cutoffAt(5000), createdAtFromUnixId(), false, testGuardrails($time, new PauseRecorder()));
assertSameValue('sweep stops on a slow delete request', 'slow delete request 7.0s', $sweep->walk->abortReason);
assertSameValue('sweep counts the slow batch as deleted', 1000, $sweep->deleted);

$time = new FakeTime();
$client = new FakeBucketClient(previewObjects(1, 1500), $time);
$guardrails = testGuardrails($time, new PauseRecorder());
sweepPreviews($client, DEFAULT_PREVIEW_PREFIX, cutoffAt(5000), createdAtFromUnixId(), false, $guardrails);
$rerun = sweepPreviews($client, DEFAULT_PREVIEW_PREFIX, cutoffAt(5000), createdAtFromUnixId(), false, $guardrails);
assertSameValue('re-running a finished sweep deletes nothing', 0, $rerun->deleted);

exit($failures === 0 ? 0 : 1);
````

- [ ] **Step 2: Run the tests to verify they fail**

```bash
php scripts/previews/tests/lib.test.php
```

Expected: fatal error `Failed opening required '.../scripts/previews/tests/../lib.php'`.

- [ ] **Step 3: Implement `scripts/previews/lib.php`**

````php
<?php
declare(strict_types=1);

namespace Avuz\PreviewTools;

const DEFAULT_PREVIEW_PREFIX = 'uri:oid:preview:';

final class BucketObject {
	public function __construct(
		public readonly string $key,
		public readonly int $size,
	) {
	}
}

final class BucketPage {
	/** @param list<BucketObject> $objects */
	public function __construct(
		public readonly array $objects,
		public readonly ?string $nextToken,
	) {
	}
}

interface BucketClient {
	public function listPage(string $prefix, ?string $continuationToken, int $pageSize): BucketPage;

	/**
	 * @param list<string> $keys
	 * @return list<string> one message per key the store refused to delete
	 */
	public function deleteKeys(array $keys): array;
}

final class S3BucketClient implements BucketClient {
	public function __construct(
		private readonly \Aws\S3\S3Client $client,
		private readonly string $bucket,
	) {
	}

	public function listPage(string $prefix, ?string $continuationToken, int $pageSize): BucketPage {
		$request = ['Bucket' => $this->bucket, 'Prefix' => $prefix, 'MaxKeys' => $pageSize];
		if ($continuationToken !== null) {
			$request['ContinuationToken'] = $continuationToken;
		}
		$result = $this->client->listObjectsV2($request);
		$objects = array_map(
			fn (array $object): BucketObject => new BucketObject($object['Key'], (int)$object['Size']),
			$result['Contents'] ?? [],
		);
		return new BucketPage($objects, $result['IsTruncated'] ? $result['NextContinuationToken'] : null);
	}

	public function deleteKeys(array $keys): array {
		if ($keys === []) {
			return [];
		}
		$result = $this->client->deleteObjects([
			'Bucket' => $this->bucket,
			'Delete' => [
				'Objects' => array_map(fn (string $key): array => ['Key' => $key], $keys),
				'Quiet' => true,
			],
		]);
		return array_map(
			fn (array $error): string => "{$error['Key']}: {$error['Code']} {$error['Message']}",
			$result['Errors'] ?? [],
		);
	}
}

final class Guardrails {
	/**
	 * @param \Closure(): float $clock seconds, monotonic
	 * @param \Closure(int): void $pause microseconds
	 * @param \Closure(string): void $progress
	 */
	public function __construct(
		public readonly int $pageSize,
		public readonly int $pauseMicroseconds,
		public readonly float $slowRequestSeconds,
		public readonly int $progressEveryPages,
		public readonly \Closure $clock,
		public readonly \Closure $pause,
		public readonly \Closure $progress,
	) {
	}

	public static function production(): self {
		return new self(
			pageSize: 1000,
			pauseMicroseconds: 200_000,
			slowRequestSeconds: 5.0,
			progressEveryPages: 100,
			clock: fn (): float => hrtime(true) / 1e9,
			pause: function (int $microseconds): void {
				usleep($microseconds);
			},
			progress: function (string $line): void {
				fwrite(STDERR, "  progress: {$line}\n");
			},
		);
	}
}

final class WalkOutcome {
	public int $pages = 0;
	public int $objects = 0;
	public int $bytes = 0;
	public float $slowestSeconds = 0.0;
	public float $elapsedSeconds = 0.0;
	public ?string $abortReason = null;
}

final class SweepOutcome {
	public int $purgeable = 0;
	public int $purgeableBytes = 0;
	public int $deleted = 0;
	public int $deletedBytes = 0;
	public int $kept = 0;
	public int $keptBytes = 0;
	public int $foreignKeys = 0;
	public float $slowestDeleteSeconds = 0.0;
	public WalkOutcome $walk;
}

enum PurgeMode: string {
	case DryRun = 'dry-run';
	case Execute = 'execute';
	case SweepOnly = 'sweep-only';
}

final class PurgeOptions {
	public function __construct(
		public readonly PurgeMode $mode,
		public readonly ?\DateTimeImmutable $cutoff,
	) {
	}
}

function previewKeyPrefix(array $objectStoreArguments): string {
	if (!isset($objectStoreArguments['objectPrefix'])) {
		return DEFAULT_PREVIEW_PREFIX;
	}
	return $objectStoreArguments['objectPrefix'] . 'preview:';
}

function previewIdFromKey(string $key, string $prefix): ?string {
	if (!str_starts_with($key, $prefix)) {
		return null;
	}
	$previewId = substr($key, strlen($prefix));
	if ($previewId === '' || !ctype_digit($previewId)) {
		return null;
	}
	return $previewId;
}

/**
 * @param list<string> $arguments CLI flags after `--`
 * @throws \InvalidArgumentException
 */
function parsePurgeOptions(array $arguments): PurgeOptions {
	$mode = PurgeMode::DryRun;
	$cutoff = null;
	foreach ($arguments as $argument) {
		if ($argument === '--execute') {
			$mode = PurgeMode::Execute;
			continue;
		}
		if ($argument === '--sweep-only') {
			$mode = PurgeMode::SweepOnly;
			continue;
		}
		if (str_starts_with($argument, '--cutoff=')) {
			$cutoff = new \DateTimeImmutable(substr($argument, strlen('--cutoff=')));
			continue;
		}
		throw new \InvalidArgumentException("unknown flag {$argument}");
	}
	if ($mode === PurgeMode::SweepOnly && $cutoff === null) {
		throw new \InvalidArgumentException('--sweep-only needs --cutoff=<ISO 8601> from the original run');
	}
	if ($mode !== PurgeMode::SweepOnly && $cutoff !== null) {
		throw new \InvalidArgumentException('--cutoff only applies to --sweep-only');
	}
	return new PurgeOptions($mode, $cutoff);
}

/** @return list<string> */
function purgePreconditionProblems(bool $hasObjectStore, bool $multibucket, int $previewMaxX, int $previewMaxY, int $requiredPreviewMax): array {
	$problems = [];
	if (!$hasObjectStore) {
		$problems[] = 'no primary object store (local-disk instance)';
	}
	if ($multibucket) {
		$problems[] = 'multibucket object store is not supported';
	}
	if ($previewMaxX !== $requiredPreviewMax || $previewMaxY !== $requiredPreviewMax) {
		$problems[] = "preview_max_x/y is {$previewMaxX}/{$previewMaxY}, expected {$requiredPreviewMax}";
	}
	return $problems;
}

/**
 * Lists every object under $prefix, one page at a time, with pauses between
 * requests. Stops at the first request error or slow request, or when
 * $onPage returns an abort reason.
 *
 * @param \Closure(BucketPage): ?string $onPage
 */
function walkBucket(BucketClient $client, string $prefix, Guardrails $guardrails, \Closure $onPage): WalkOutcome {
	$outcome = new WalkOutcome();
	$startedAt = ($guardrails->clock)();
	$continuationToken = null;

	do {
		$requestStartedAt = ($guardrails->clock)();
		try {
			$page = $client->listPage($prefix, $continuationToken, $guardrails->pageSize);
		} catch (\Throwable $error) {
			$outcome->abortReason = 'list request error: ' . $error->getMessage();
			break;
		}
		$requestSeconds = ($guardrails->clock)() - $requestStartedAt;
		$outcome->slowestSeconds = max($outcome->slowestSeconds, $requestSeconds);
		$outcome->pages++;
		foreach ($page->objects as $object) {
			$outcome->objects++;
			$outcome->bytes += $object->size;
		}

		if ($requestSeconds > $guardrails->slowRequestSeconds) {
			$outcome->abortReason = sprintf('slow list request %.1fs', $requestSeconds);
			break;
		}
		$outcome->abortReason = $onPage($page);
		if ($outcome->abortReason !== null) {
			break;
		}
		if ($outcome->pages % $guardrails->progressEveryPages === 0) {
			($guardrails->progress)(sprintf('%d pages / %d objects / %.1fs', $outcome->pages, $outcome->objects, ($guardrails->clock)() - $startedAt));
		}

		$continuationToken = $page->nextToken;
		if ($continuationToken !== null) {
			($guardrails->pause)($guardrails->pauseMicroseconds);
		}
	} while ($continuationToken !== null);

	$outcome->elapsedSeconds = ($guardrails->clock)() - $startedAt;
	return $outcome;
}

/**
 * Deletes preview objects created before $cutoff. Keys that are not
 * `<prefix><numeric id>` are never touched.
 *
 * @param \Closure(string): \DateTimeImmutable $createdAt decodes a preview id
 */
function sweepPreviews(
	BucketClient $client,
	string $prefix,
	\DateTimeImmutable $cutoff,
	\Closure $createdAt,
	bool $dryRun,
	Guardrails $guardrails,
): SweepOutcome {
	$sweep = new SweepOutcome();

	$onPage = function (BucketPage $page) use ($sweep, $prefix, $cutoff, $createdAt, $dryRun, $client, $guardrails): ?string {
		$purgeableKeys = [];
		$purgeableBytes = 0;
		foreach ($page->objects as $object) {
			$previewId = previewIdFromKey($object->key, $prefix);
			if ($previewId === null) {
				$sweep->foreignKeys++;
				continue;
			}
			if ($createdAt($previewId) >= $cutoff) {
				$sweep->kept++;
				$sweep->keptBytes += $object->size;
				continue;
			}
			$purgeableKeys[] = $object->key;
			$purgeableBytes += $object->size;
		}
		$sweep->purgeable += count($purgeableKeys);
		$sweep->purgeableBytes += $purgeableBytes;

		if ($dryRun || $purgeableKeys === []) {
			return null;
		}

		($guardrails->pause)($guardrails->pauseMicroseconds);
		$requestStartedAt = ($guardrails->clock)();
		try {
			$errors = $client->deleteKeys($purgeableKeys);
		} catch (\Throwable $error) {
			return 'delete request error: ' . $error->getMessage();
		}
		$requestSeconds = ($guardrails->clock)() - $requestStartedAt;
		$sweep->slowestDeleteSeconds = max($sweep->slowestDeleteSeconds, $requestSeconds);
		if ($errors !== []) {
			return sprintf('%d delete errors, first: %s', count($errors), $errors[0]);
		}
		$sweep->deleted += count($purgeableKeys);
		$sweep->deletedBytes += $purgeableBytes;
		if ($requestSeconds > $guardrails->slowRequestSeconds) {
			return sprintf('slow delete request %.1fs', $requestSeconds);
		}
		return null;
	};

	$sweep->walk = walkBucket($client, $prefix, $guardrails, $onPage);
	return $sweep;
}

function gibibytes(int|float $bytes): string {
	return sprintf('%.2f GiB', $bytes / 1024 ** 3);
}
````

- [ ] **Step 4: Run the tests to verify they pass**

```bash
php scripts/previews/tests/lib.test.php | grep -c '^ok - '
php scripts/previews/tests/lib.test.php | grep '^NOT OK' ; echo "exit=$?"
```

Expected: `41`; no `NOT OK` lines (`exit=1` from grep = nothing matched). Note: S3 lists keys in **string** order, so older and newer ids interleave inside a page — the batch test asserts `≤ 1000` per batch, not exact batch sizes.

- [ ] **Step 5: Commit**

```bash
git add scripts/previews/lib.php scripts/previews/tests/lib.test.php
git commit -m "feat(scripts): add preview tools library with cutoff sweep

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: scan / purge entry scripts and runner

**Files:**
- Create: `scripts/previews/scan.php`
- Create: `scripts/previews/purge.php`
- Create: `scripts/previews/run.sh`
- Modify: `CLAUDE.md` (new section after "S3 Primary Object Store")
- Modify: `docs/superpowers/specs/2026-09-29-preview-storage-reduction-design.md` (tool paths)

**Interfaces:**
- Consumes: everything listed under Task 2 "Produces".
- Produces: `scripts/previews/run.sh <staging|prod> <scan|purge> <container> [flags]`. `purge` output lines (tab-separated, used by Tasks 4 and 6): `mode`, `precondition FAIL …`, `bucket`, `cutoff <ISO 8601>`, `table …`, `sweep complete|ABORTED …`, `listed`, `purgeable`, `deleted`, `kept_newer_than_cutoff`, `skipped_non_preview_keys`, `resume …` (only on abort).

- [ ] **Step 1: Create `scripts/previews/scan.php`**

````php
<?php
// Read-only: compares preview objects in the bucket with oc_previews.
// Bundled after lib.php and run inside the container by run.sh.

namespace Avuz\PreviewTools;

require '/var/www/html/lib/base.php';

$db = \OCP\Server::get(\OCP\IDBConnection::class);
$storeConfig = \OCP\Server::get(\OC\Files\ObjectStore\PrimaryObjectStoreConfig::class);

if (!$storeConfig->hasObjectStore()) {
	echo "storage\tlocal — nothing to scan\n";
	return;
}

$previewStats = function (?string $locationId, bool $legacy) use ($db): array {
	if ($locationId === null) {
		return ['previews' => 0, 'bytes' => 0];
	}
	$query = $db->getQueryBuilder();
	$query->selectAlias($query->func()->count('*'), 'previews')
		->selectAlias($query->func()->sum('size'), 'bytes')
		->from('previews')
		->where($query->expr()->eq('location_id', $query->createNamedParameter($locationId)))
		->andWhere($legacy ? $query->expr()->isNotNull('old_file_id') : $query->expr()->isNull('old_file_id'));
	$row = $query->executeQuery()->fetch();
	return ['previews' => (int)$row['previews'], 'bytes' => (int)$row['bytes']];
};

$locations = $db->getQueryBuilder();
$locations->select('id', 'bucket_name', 'object_store_name')->from('preview_locations');

$targets = [];
foreach ($locations->executeQuery()->fetchAll() as $location) {
	$targets["{$location['object_store_name']}/{$location['bucket_name']}"] = [
		'storeName' => $location['object_store_name'],
		'bucket' => $location['bucket_name'],
		'locationId' => (string)$location['id'],
	];
}
$rootStoreName = $storeConfig->resolveAlias('root');
$rootBucket = $storeConfig->getObjectStoreConfiguration('root')['arguments']['bucket'];
$targets["{$rootStoreName}/{$rootBucket}"] ??= ['storeName' => $rootStoreName, 'bucket' => $rootBucket, 'locationId' => null];

foreach ($targets as $target) {
	$config = $storeConfig->getObjectStoreConfiguration($target['storeName']);
	$config['arguments']['bucket'] = $target['bucket'];
	$prefix = previewKeyPrefix($config['arguments']);
	$store = $storeConfig->buildObjectStore($config);
	if (!$store instanceof \OC\Files\ObjectStore\S3) {
		echo "\ntarget\t{$target['bucket']}: not an S3 store, skipped\n";
		continue;
	}

	$current = $previewStats($target['locationId'], legacy: false);
	$legacy = $previewStats($target['locationId'], legacy: true);
	$rootNote = $target['locationId'] === null ? ' (root bucket, no preview rows)' : '';

	echo "\ntarget\t{$target['storeName']} / {$target['bucket']} / prefix {$prefix}{$rootNote}\n";
	echo "db_current\t{$current['previews']} previews / " . gibibytes($current['bytes']) . "\n";
	echo "db_legacy_urn_oid\t{$legacy['previews']} previews / " . gibibytes($legacy['bytes']) . " (stored as urn:oid:<old_file_id>, not in prefix scan)\n";

	$client = new S3BucketClient($store->getConnection(), $target['bucket']);
	$walk = walkBucket($client, $prefix, Guardrails::production(), fn (BucketPage $_page): ?string => null);
	$status = $walk->abortReason === null ? sprintf('complete in %.1fs', $walk->elapsedSeconds) : "ABORTED ({$walk->abortReason})";
	echo "bucket_scan\t{$status} / {$walk->pages} pages / slowest request " . sprintf('%.2fs', $walk->slowestSeconds) . "\n";
	echo "bucket_current\t{$walk->objects} objects / " . gibibytes($walk->bytes) . "\n";
	if ($walk->abortReason !== null) {
		continue;
	}
	echo "delta_bucket_minus_db\t" . ($walk->objects - $current['previews']) . ' objects / ' . gibibytes($walk->bytes - $current['bytes']) . "\n";
}
````

- [ ] **Step 2: Create `scripts/previews/purge.php`**

````php
<?php
// Purges every preview: truncates oc_previews (+ the previewgenerator queue),
// then deletes preview objects older than the cutoff from the instance's own
// bucket. Dry run unless --execute. Bundled after lib.php by run.sh.
// Design: docs/superpowers/specs/2026-09-29-preview-storage-reduction-design.md

namespace Avuz\PreviewTools;

require '/var/www/html/lib/base.php';

const REQUIRED_PREVIEW_MAX = 1280;
const CUTOFF_MARGIN = 'PT10M';
const PURGED_TABLES = ['previews', 'preview_generation'];

try {
	$options = parsePurgeOptions(array_slice($argv, 1));
} catch (\InvalidArgumentException $error) {
	fwrite(STDERR, "error: {$error->getMessage()}\n");
	exit(2);
}

$config = \OCP\Server::get(\OCP\IConfig::class);
$db = \OCP\Server::get(\OCP\IDBConnection::class);
$storeConfig = \OCP\Server::get(\OC\Files\ObjectStore\PrimaryObjectStoreConfig::class);
$snowflakes = \OCP\Server::get(\OCP\Snowflake\ISnowflakeDecoder::class);

$hasObjectStore = $storeConfig->hasObjectStore();
$rootConfig = $hasObjectStore ? $storeConfig->getObjectStoreConfiguration('root') : ['arguments' => []];
$problems = purgePreconditionProblems(
	$hasObjectStore,
	(bool)($rootConfig['arguments']['multibucket'] ?? false),
	$config->getSystemValueInt('preview_max_x', 4096),
	$config->getSystemValueInt('preview_max_y', 4096),
	REQUIRED_PREVIEW_MAX,
);

echo "mode\t{$options->mode->value}\n";
foreach ($problems as $problem) {
	echo "precondition\tFAIL {$problem}\n";
}
if (!$hasObjectStore || ($problems !== [] && $options->mode !== PurgeMode::DryRun)) {
	exit(1);
}

$bucket = $rootConfig['arguments']['bucket'];
$prefix = previewKeyPrefix($rootConfig['arguments']);
$store = $storeConfig->buildObjectStore($rootConfig);
if (!$store instanceof \OC\Files\ObjectStore\S3) {
	echo "precondition\tFAIL root object store is not S3\n";
	exit(1);
}

$cutoff = $options->cutoff ?? (new \DateTimeImmutable())->sub(new \DateInterval(CUTOFF_MARGIN));
echo "bucket\t{$bucket} / prefix {$prefix}\n";
echo "cutoff\t{$cutoff->format(DATE_ATOM)}\n";

$rowCount = function (string $table) use ($db): int {
	$query = $db->getQueryBuilder();
	$query->selectAlias($query->func()->count('*'), 'rows')->from($table);
	return (int)$query->executeQuery()->fetchOne();
};

if ($options->mode !== PurgeMode::SweepOnly) {
	foreach (PURGED_TABLES as $table) {
		if (!$db->tableExists($table)) {
			echo "table\t{$table}: absent\n";
			continue;
		}
		$rows = $rowCount($table);
		if ($options->mode === PurgeMode::DryRun) {
			echo "table\t{$table}: {$rows} rows (would truncate)\n";
			continue;
		}
		$db->truncateTable($table, false);
		echo "table\t{$table}: truncated {$rows} rows\n";
	}
}

$sweep = sweepPreviews(
	new S3BucketClient($store->getConnection(), $bucket),
	$prefix,
	$cutoff,
	fn (string $previewId): \DateTimeImmutable => $snowflakes->decode($previewId)->getCreatedAt(),
	$options->mode === PurgeMode::DryRun,
	Guardrails::production(),
);

$walk = $sweep->walk;
$status = $walk->abortReason === null ? sprintf('complete in %.1fs', $walk->elapsedSeconds) : "ABORTED ({$walk->abortReason})";
echo "sweep\t{$status} / {$walk->pages} pages / slowest list " . sprintf('%.2fs', $walk->slowestSeconds) . ' / slowest delete ' . sprintf('%.2fs', $sweep->slowestDeleteSeconds) . "\n";
echo "listed\t{$walk->objects} objects / " . gibibytes($walk->bytes) . "\n";
echo "purgeable\t{$sweep->purgeable} objects / " . gibibytes($sweep->purgeableBytes) . "\n";
echo "deleted\t{$sweep->deleted} objects / " . gibibytes($sweep->deletedBytes) . "\n";
echo "kept_newer_than_cutoff\t{$sweep->kept} objects / " . gibibytes($sweep->keptBytes) . "\n";
echo "skipped_non_preview_keys\t{$sweep->foreignKeys}\n";
if ($walk->abortReason !== null) {
	echo "resume\trun.sh <env> purge <container> --sweep-only --cutoff={$cutoff->format(DATE_ATOM)}\n";
	exit(1);
}
````

- [ ] **Step 3: Create `scripts/previews/run.sh`**

````bash
#!/bin/bash
# Run a preview tool (scan | purge) inside a Nextcloud container through the
# Portainer exec proxy. Bundles lib.php + <tool>.php, base64-evals it as
# www-data, and passes the remaining flags to the tool.
#
# Usage:
#   scripts/previews/run.sh <staging|prod> scan  <container>
#   scripts/previews/run.sh <staging|prod> purge <container> [--execute | --sweep-only --cutoff=<ISO 8601>]
#
# purge without flags is a dry run. Every prod run needs the user's explicit go.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(dirname "$SCRIPT_DIR")"

die() { echo "error: $*" >&2; exit 1; }

[ "$#" -ge 3 ] || die "usage: $0 <staging|prod> <scan|purge> <container> [flags...]"
ENVIRONMENT="$1"; TOOL="$2"; CONTAINER="$3"; shift 3

case "$ENVIRONMENT" in
  staging) EXEC="$SCRIPTS_DIR/portainer-exec.sh" ;;
  prod)    EXEC="$SCRIPTS_DIR/portainer-exec-prod.sh" ;;
  *)       die "environment must be staging or prod, got '$ENVIRONMENT'" ;;
esac
[ -f "$SCRIPT_DIR/$TOOL.php" ] && [ "$TOOL" != "lib" ] || die "unknown tool '$TOOL' (scan | purge)"

BUNDLE_BASE64="$(cat "$SCRIPT_DIR/lib.php" "$SCRIPT_DIR/$TOOL.php" | grep -v '^<?php' | base64 | tr -d '\n')"
exec "$EXEC" -u www-data "$CONTAINER" php -r "eval(base64_decode('$BUNDLE_BASE64'));" -- "$@"
````

```bash
chmod +x scripts/previews/run.sh
```

- [ ] **Step 4: Lint the bundles exactly as `run.sh` builds them**

```bash
for tool in scan purge; do
  { echo '<?php'; cat scripts/previews/lib.php "scripts/previews/$tool.php" | grep -v '^<?php'; } > "$TMPDIR/bundle-$tool.php"
  php -l "$TMPDIR/bundle-$tool.php"
done
bash -n scripts/previews/run.sh && echo run-ok
```

Expected: `No syntax errors detected` twice, `run-ok`.

- [ ] **Step 5: Link the Portainer env files into the worktree (gitignored, never committed)**

`run.sh` calls `scripts/portainer-exec*.sh` next to it, which read `scripts/deploy.env` / `scripts/deploy.prod.env`. Those exist only in the main checkout.

```bash
MAIN=/Users/patrickrezende/work/avuz/avuz-server
ln -sf "$MAIN/scripts/deploy.env" scripts/deploy.env
ln -sf "$MAIN/scripts/deploy.prod.env" scripts/deploy.prod.env
git status --short scripts/ | grep deploy || echo "env files ignored"
```

Expected: `env files ignored`.

- [ ] **Step 6: Smoke-test read-only modes on staging**

```bash
scripts/previews/run.sh staging scan avuz-conecta-s3-app-1
scripts/previews/run.sh staging purge avuz-conecta-s3-app-1
scripts/previews/run.sh staging purge avuz-conecta-app-1 --execute
scripts/previews/run.sh staging purge avuz-conecta-s3-app-1 --sweep-only
```

Expected, in order:
1. One `target` block: `avuz-conecta-hml` → `complete`. (Before the 2026-09-30 staging fix there was also an `eco-ambiental-avuz-conecta` block ending in AccessDenied.)
2. `mode dry-run`, no `precondition FAIL` (staging cap is already 1280), `bucket avuz-conecta-hml`, `table previews: <n> rows (would truncate)`, `sweep complete`, `deleted 0 objects`. It must **not** mention any other bucket (own-bucket guard).
3. `precondition FAIL no primary object store (local-disk instance)` and nothing after it.
4. `error: --sweep-only needs --cutoff=<ISO 8601> from the original run`.

- [ ] **Step 7: Document the tools in `CLAUDE.md`**

Insert before `## File Structure`:

```markdown
## Preview storage tools (`scripts/previews/`)

NC 33 previews on S3 live under `uri:oid:preview:<snowflake id>`, tracked in
`oc_previews` only — no quota counter shows them. `lib.php` holds the tested
logic (`php scripts/previews/tests/lib.test.php`); `run.sh` bundles it with an
entry script and runs it in a container as www-data:

    scripts/previews/run.sh <staging|prod> scan  <container>   # bucket vs DB, read-only
    scripts/previews/run.sh <staging|prod> purge <container>   # dry run
    scripts/previews/run.sh <staging|prod> purge <container> --execute
    scripts/previews/run.sh <staging|prod> purge <container> --sweep-only --cutoff=<ISO 8601>

`purge` refuses unless the instance is S3 (not multibucket) and
`preview_max_x/y` = 1280. It truncates `oc_previews` + `oc_preview_generation`
first, then deletes preview objects older than start − 10 min from the
instance's own bucket only. Portainer exec does not return the container's
exit code — read the `precondition FAIL` / `ABORTED` lines. Design:
`docs/superpowers/specs/2026-09-29-preview-storage-reduction-design.md`.
```

- [ ] **Step 8: Point the spec at the real paths**

In the spec, section "### 2. Purge tool", replace the three bullets naming `scripts/preview-scan.php`, `scripts/preview-purge.php`, `scripts/preview-purge.sh <container> [--execute | --sweep-only]` with:

```markdown
- `scripts/previews/lib.php` — tested logic; `scripts/previews/tests/lib.test.php`.
- `scripts/previews/scan.php` — the read-only bucket-vs-DB scan used for the baseline.
- `scripts/previews/purge.php` — the purge.
- `scripts/previews/run.sh <staging|prod> <scan|purge> <container> [flags]` — bundles `lib.php` + the entry script and base64-evals it inside the container as `www-data` via `scripts/portainer-exec.sh` / `portainer-exec-prod.sh`.
```

- [ ] **Step 9: Commit**

```bash
git add scripts/previews/scan.php scripts/previews/purge.php scripts/previews/run.sh CLAUDE.md docs/superpowers/specs/2026-09-29-preview-storage-reduction-design.md
git commit -m "feat(scripts): add preview scan and purge runner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: End-to-end purge on staging

Staging is autonomous. Target: `avuz-conecta-s3-app-1` (stack 63, bucket `avuz-conecta-hml`).

**Rebuilt 2026-09-30:** the instance was an eco-ambiental prod DB clone whose previews pointed at the prod bucket. It was wiped (bucket, DB, host dirs) and reinstalled fresh on image `:staging` with `PREVIEW_MAX_X/Y=1280` in the stack env. It starts with only `admin`, 0 previews, and no reference to any prod bucket. Step 1 below is therefore already satisfied (re-running it is harmless).

**Files:**
- Create (scratchpad, not committed): `$SCRATCH/seed-previews.php`

**Interfaces:**
- Consumes: `run.sh` from Task 3; `purge` output lines.
- Produces: evidence (pasted outputs) that purge deletes old previews, keeps new ones, regenerates at ≤ 1280, and resumes idempotently.

- [ ] **Step 1: Set the staging cap to 1280**

```bash
for axis in x y; do scripts/portainer-exec.sh -u www-data avuz-conecta-s3-app-1 php occ config:system:set "preview_max_$axis" --value=1280 --type=integer; done
```

Expected: `System config value preview_max_x set to integer 1280` (and `_y`).

- [ ] **Step 2: Seed 30 large JPEGs and render their previews at the OLD cap**

Seeding at 2048 first makes the before/after size difference visible. Temporarily set 2048, seed, then restore 1280.

`$SCRATCH/seed-previews.php` (`$SCRATCH` = this session's scratchpad dir):

```php
require '/var/www/html/lib/base.php';

const SEED_FOLDER = 'preview-seed';
const SEED_COUNT = 30;

$users = \OCP\Server::get(\OCP\IUserManager::class);
$adminUid = array_key_first($users->search('admin', 1)) ?? throw new \RuntimeException('no admin user');
$userFolder = \OCP\Server::get(\OCP\Files\IRootFolder::class)->getUserFolder($adminUid);
$folder = $userFolder->nodeExists(SEED_FOLDER) ? $userFolder->get(SEED_FOLDER) : $userFolder->newFolder(SEED_FOLDER);
$previews = \OCP\Server::get(\OCP\IPreview::class);

for ($index = 0; $index < SEED_COUNT; $index++) {
	$name = "seed-{$index}.jpg";
	if (!$folder->nodeExists($name)) {
		$image = new \Imagick();
		$image->newPseudoImage(4000, 3000, 'plasma:');
		$image->setImageFormat('jpeg');
		$folder->newFile($name, $image->getImageBlob());
	}
	$previews->getPreview($folder->get($name), 256, 256);
}
echo "seeded " . SEED_COUNT . " files for {$adminUid} in /" . SEED_FOLDER . "\n";
```

```bash
scripts/portainer-exec.sh -u www-data avuz-conecta-s3-app-1 php occ config:system:set preview_max_x --value=2048 --type=integer
scripts/portainer-exec.sh -u www-data avuz-conecta-s3-app-1 php occ config:system:set preview_max_y --value=2048 --type=integer
SEED_BASE64=$(base64 < "$SCRATCH/seed-previews.php" | tr -d '\n')
scripts/portainer-exec.sh -u www-data avuz-conecta-s3-app-1 php -r "eval(base64_decode('$SEED_BASE64'));"
for axis in x y; do scripts/portainer-exec.sh -u www-data avuz-conecta-s3-app-1 php occ config:system:set "preview_max_$axis" --value=1280 --type=integer; done
scripts/previews/run.sh staging scan avuz-conecta-s3-app-1
```

Expected: `seeded 30 files …`; scan shows a `avuz-conecta-hml` target with ~60 previews (max + 256 per file) both in DB and bucket, delta 0. Record the GiB.

- [ ] **Step 3: Dry run**

```bash
scripts/previews/run.sh staging purge avuz-conecta-s3-app-1
```

Expected: no `precondition FAIL`; `table previews: ~60 rows (would truncate)`; `purgeable ~60 objects`; `deleted 0`.

- [ ] **Step 4: Execute**

```bash
scripts/previews/run.sh staging purge avuz-conecta-s3-app-1 --execute | tee "$SCRATCH/staging-purge.txt"
```

Expected: `table previews: truncated <n> rows`; `sweep complete`; `deleted ~60 objects`; `kept_newer_than_cutoff 0`. Save the `cutoff` value.

- [ ] **Step 5: Verify empty state, then regrow at 1280**

```bash
scripts/previews/run.sh staging scan avuz-conecta-s3-app-1
SEED_BASE64=$(base64 < "$SCRATCH/seed-previews.php" | tr -d '\n')
scripts/portainer-exec.sh -u www-data avuz-conecta-s3-app-1 php -r "eval(base64_decode('$SEED_BASE64'));"
scripts/previews/run.sh staging scan avuz-conecta-s3-app-1
```

Expected: first scan — only the `avuz-conecta-hml` target, `db_current 0`, `bucket_current 0`. Second scan — ~60 previews again, **smaller GiB** than Step 2.

Confirm the max tier is ≤ 1280:

```bash
MAX_BASE64=$(printf '%s' 'require "/var/www/html/lib/base.php"; $db=\OCP\Server::get(\OCP\IDBConnection::class); $q=$db->getQueryBuilder(); $q->selectAlias($q->func()->max("width"),"w")->selectAlias($q->func()->max("height"),"h")->from("previews")->where($q->expr()->eq("max",$q->createNamedParameter(true, \OCP\DB\QueryBuilder\IQueryBuilder::PARAM_BOOL))); $r=$q->executeQuery()->fetch(); echo "max_preview {$r["w"]}x{$r["h"]}\n";' | base64 | tr -d '\n')
scripts/portainer-exec.sh -u www-data avuz-conecta-s3-app-1 php -r "eval(base64_decode('$MAX_BASE64'));"
```

Expected: `max_preview 1280x960`.

- [ ] **Step 6: Resume is idempotent and keeps new previews**

```bash
scripts/previews/run.sh staging purge avuz-conecta-s3-app-1 --sweep-only --cutoff=<cutoff from Step 4>
```

Expected: `deleted 0 objects`; `kept_newer_than_cutoff ~60 objects`. The regrown previews survive.

- [ ] **Step 7: No broken-preview errors**

```bash
scripts/portainer-exec.sh -u www-data avuz-conecta-s3-app-1 sh -c 'LOG=$(php occ config:system:get logfile || echo /var/www/html/data/nextcloud.log); tail -n 5000 "$LOG" | grep -c "Unable to read preview" || true'
```

Expected: `0` for entries after the purge time (if older entries exist, check their timestamps predate the cutoff).

- [ ] **Step 8: Clean up the seed folder**

```bash
scripts/portainer-exec.sh -u www-data avuz-conecta-s3-app-1 php occ files:delete --help >/dev/null 2>&1 && echo has-files-delete
```

If `has-files-delete`: `php occ files:delete /<adminUid>/files/preview-seed`. Otherwise leave it (staging, harmless) and note it.

No commit (ops only). Paste Step 2–7 outputs into the task review.

---

### Task 5: Ship the cap in the image (staging)

**Files:** none (merge + build + deploy).

**Interfaces:**
- Consumes: commits from Tasks 1–3.
- Produces: `avuz-customization` contains the cap + tools; `:staging` image boots with `preview_max_x = 1280`.

- [ ] **Step 1: Merge into `avuz-customization` from the main checkout**

```bash
cd /Users/patrickrezende/work/avuz/avuz-server
git checkout avuz-customization
git merge --no-ff claude/production-preview-sizes-3f7f80 -m "Merge preview storage reduction (1280 cap + purge tools) into avuz-customization"
git submodule update apps/deck 3rdparty apps/integration_openai
```

Expected: clean merge; submodules at recorded commits.

- [ ] **Step 2: Build and deploy default staging**

```bash
./scripts/build-push.sh latest staging
./scripts/deploy.sh -y avuz-conecta
```

Expected: build ends with a pushed `:staging` digest (build-push exits 0 even on a failed build — confirm the digest line). Deploy recreates `avuz-conecta-app-1`.

- [ ] **Step 3: Verify the cap after boot**

```bash
./scripts/portainer-exec.sh -u www-data avuz-conecta-app-1 php occ config:system:get preview_max_x
./scripts/portainer-exec.sh -u www-data avuz-conecta-app-1 sh -c 'cat /var/www/html/data/.avuz_configured'
```

Expected: `1280`; `33.0.0-21`.

The prod image ships with the **next fleet rollout** (not part of this plan; add to the pending-rollout list). Prod clients get 1280 via `occ` in Task 6 meanwhile.

---

### Task 6: Prod purge runbook (gated, off-hours, one client at a time)

**Files:**
- Modify: this plan — fill the results table at the end of the task.

**Interfaces:**
- Consumes: `run.sh prod …`; baseline numbers from the spec.

Order: arkua → comprev → cfm-advogados → consultt-agro → progetti → ramires → eco-ambiental → grupo-vidalar (own window).

Containers: `arkua-app-1`, `comprev-app-1`, `cfm-advogados-app-1`, `consultt-agro-app-1`, `progetti-app-1`, `ramires-app-1`, `eco-ambiental-app-1`, `grupo-vidalar-app-1`.

For **each** client, repeat Steps 1–6. Do not batch clients in one command.

- [ ] **Step 1: Ask Patrick for the go for `<client>`** — state the client, current preview GiB (spec baseline), and that it is off-hours. Wait for an explicit yes.

- [ ] **Step 2: Set the cap**

```bash
for axis in x y; do scripts/portainer-exec-prod.sh -u www-data <container> php occ config:system:set "preview_max_$axis" --value=1280 --type=integer; done
```

Expected: two `set to integer 1280` lines. If the stack env sets `PREVIEW_MAX_X/Y`, stop and ask — the env would win at the next config run.

- [ ] **Step 3: Dry run**

```bash
scripts/previews/run.sh prod purge <container> | tee "$SCRATCH/purge-dry-<client>.txt"
```

Expected: no `precondition FAIL`; `bucket <client bucket>`; `purgeable` ≈ spec baseline objects (± new previews since 2026-09-29). If the bucket name is not the client's own bucket, stop.

- [ ] **Step 4: Execute**

```bash
scripts/previews/run.sh prod purge <container> --execute | tee "$SCRATCH/purge-<client>.txt"
```

Expected: `sweep complete`; `deleted` ≈ dry-run `purgeable`. If `ABORTED`: do not retry blindly — report the reason; after Patrick's go, run the printed `resume` line (`--sweep-only --cutoff=…`).

- [ ] **Step 5: Verify**

```bash
scripts/previews/run.sh prod scan <container>
scripts/portainer-exec-prod.sh -u www-data <container> sh -c 'LOG=$(php occ config:system:get logfile || echo /var/www/html/data/nextcloud.log); tail -n 5000 "$LOG" | grep "Unable to read preview" | tail -3'
```

Expected: scan `db_current` small (only previews regenerated since the purge), `delta_bucket_minus_db` ≈ 0 plus at most a handful from the 10-min window; no `Unable to read preview` lines stamped after the purge.

Spot-check the regenerated max tier (run once users have browsed a bit, e.g. next morning):

```bash
MAX_BASE64=$(printf '%s' 'require "/var/www/html/lib/base.php"; $db=\OCP\Server::get(\OCP\IDBConnection::class); $q=$db->getQueryBuilder(); $q->selectAlias($q->func()->max("width"),"w")->selectAlias($q->func()->max("height"),"h")->from("previews")->where($q->expr()->eq("max",$q->createNamedParameter(true, \OCP\DB\QueryBuilder\IQueryBuilder::PARAM_BOOL))); $r=$q->executeQuery()->fetch(); echo "max_preview {$r["w"]}x{$r["h"]}\n";' | base64 | tr -d '\n')
scripts/portainer-exec-prod.sh -u www-data <container> php -r "eval(base64_decode('$MAX_BASE64'));"
```

Expected: both numbers ≤ 1280.

- [ ] **Step 6: Record the result**

Add a row to the results table below and report it to Patrick before asking for the next client.

| Client | Date | Cutoff | Rows truncated | Objects deleted | GiB freed | Post-scan delta | Notes |
|---|---|---|---:|---:|---:|---:|---|

- [ ] **Step 7 (after all clients): Next-morning check** — for grupo-vidalar and eco-ambiental, check app container CPU during business hours the day after (Portainer stats) and the log for preview errors. Report.

---

### Task 7: Record what was learned

**Files:** memory only (`/Users/patrickrezende/.claude/projects/-Users-patrickrezende-work-avuz-avuz-server/memory/`).

- [ ] **Step 1:** Update `ceph-migration-preview-dangling-rows.md`: NC 33 has no distributed preview cache (no `FLUSHALL` needed); keep `preview_locations`/`preview_versions` when truncating on a live instance; point at `scripts/previews/`.
- [ ] **Step 2:** Update `s3-storage-accounting-gaps.md` "Budget previews" line with the 2026-09-29 baseline, the 1280 cap, and purge results.
- [x] **Step 3:** Memory `staging-s3-cloned-prod-db.md` written 2026-09-30 (staging `avuz-conecta-s3` = eco-ambiental prod DB clone; preview rows pointed at the prod bucket; cleared).
- [ ] **Step 4:** Update `fleet-rollout-latest.md` / `staging-environments.md` pending-rollout note: config `33.0.0-21` (preview cap 1280) waits for the next fleet roll.
- [ ] **Step 5:** Update `MEMORY.md` index lines accordingly.

---

## Out of scope (phase 2)

Local-disk clients (avuz-app3, cartorio-veranopolis, digrepal, endopasso): previews live in `appdata_<instanceid>/preview/` and interact with `oc_filecache`. Measure with a read-only DB + `du` report first (after Patrick's go), then write a spec addendum before touching them.
