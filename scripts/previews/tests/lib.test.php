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
	public int $deleteCalls = 0;

	/**
	 * @param array<string, int> $objects
	 * @param ?int $failListOnCall 1-based list call that throws
	 * @param list<float> $listLatencies seconds added per list call, by call index (default 0.1)
	 * @param list<string> $deleteErrors returned by every delete call
	 * @param bool $ignorePrefix list every key whatever the requested prefix, like a store that misbehaves
	 * @param int $transientListFailures the first N list calls fail with a 502-like transient error
	 * @param int $transientDeleteFailures the first N delete calls fail with a 502-like transient error
	 */
	public function __construct(
		array $objects,
		private readonly FakeTime $time,
		private readonly ?int $failListOnCall = null,
		private readonly array $listLatencies = [],
		private readonly array $deleteErrors = [],
		private readonly float $deleteLatency = 0.1,
		private readonly bool $throwOnDelete = false,
		private readonly bool $ignorePrefix = false,
		private readonly int $transientListFailures = 0,
		private readonly int $transientDeleteFailures = 0,
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
		if ($this->listCalls <= $this->transientListFailures) {
			throw new TransientBucketError('502 Bad Gateway');
		}
		$matching = array_filter(
			$this->objects,
			fn (string $key): bool => ($this->ignorePrefix || str_starts_with($key, $prefix)) && ($continuationToken === null || strcmp($key, $continuationToken) > 0),
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
		$this->deleteCalls++;
		if ($this->deleteCalls <= $this->transientDeleteFailures) {
			throw new TransientBucketError('502 Bad Gateway');
		}
		$this->deleteBatches[] = $keys;
		if ($this->throwOnDelete) {
			throw new \RuntimeException('delete connection reset');
		}
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
	/** @var list<int> */
	public array $microseconds = [];
}

function testGuardrails(FakeTime $time, PauseRecorder $pauses, int $pageSize = 1000, int $deleteBatchSize = 1000, float $slowDeleteSeconds = 5.0): Guardrails {
	return new Guardrails(
		pageSize: $pageSize,
		deleteBatchSize: $deleteBatchSize,
		pauseMicroseconds: 200_000,
		slowRequestSeconds: 5.0,
		slowDeleteSeconds: $slowDeleteSeconds,
		retryBackoffMicroseconds: [1, 2, 3],
		progressEveryPages: 100,
		clock: fn (): float => $time->now,
		pause: function (int $microseconds) use ($pauses): void {
			$pauses->calls++;
			$pauses->microseconds[] = $microseconds;
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
$now = new \DateTimeImmutable('2026-10-01T03:00:00+00:00');
$cutoffEleven = $now->sub(new \DateInterval('PT11M'))->format(DATE_ATOM);
$cutoffFive = $now->sub(new \DateInterval('PT5M'))->format(DATE_ATOM);
$cutoffFuture = $now->add(new \DateInterval('PT1H'))->format(DATE_ATOM);
assertSameValue('no flags means dry run', PurgeMode::DryRun, parsePurgeOptions([], $now)->mode);
assertSameValue('--execute selects execute', PurgeMode::Execute, parsePurgeOptions(['--execute'], $now)->mode);
assertSameValue('--sweep-only keeps a cutoff 11 minutes in the past', $cutoffEleven, parsePurgeOptions(['--sweep-only', "--cutoff={$cutoffEleven}"], $now)->cutoff?->format(DATE_ATOM));
assertSameValue('--sweep-only accepts a cutoff exactly at the margin', '2026-10-01T02:50:00+00:00', parsePurgeOptions(['--sweep-only', '--cutoff=2026-10-01T02:50:00+00:00'], $now)->cutoff?->format(DATE_ATOM));
$invalidArgumentSets = [
	'a missing cutoff for --sweep-only' => ['--sweep-only'],
	'--cutoff without --sweep-only' => ['--execute', "--cutoff={$cutoffEleven}"],
	'an unknown flag' => ['--force'],
	'--cutoff=now' => ['--sweep-only', '--cutoff=now'],
	'a future cutoff' => ['--sweep-only', "--cutoff={$cutoffFuture}"],
	'a cutoff 5 minutes in the past' => ['--sweep-only', "--cutoff={$cutoffFive}"],
	'a malformed cutoff' => ['--sweep-only', '--cutoff=garbage'],
	'a date-only cutoff' => ['--sweep-only', '--cutoff=2026-09-01'],
	'an empty cutoff' => ['--sweep-only', '--cutoff='],
	'--execute with --sweep-only' => ['--execute', '--sweep-only', "--cutoff={$cutoffEleven}"],
	'--sweep-only with --execute' => ['--sweep-only', '--execute', "--cutoff={$cutoffEleven}"],
];
foreach ($invalidArgumentSets as $description => $invalidArguments) {
	$rejected = false;
	try {
		parsePurgeOptions($invalidArguments, $now);
	} catch (\InvalidArgumentException) {
		$rejected = true;
	}
	assertSameValue("parsePurgeOptions rejects {$description}", true, $rejected);
}
$rejectionMessage = '';
try {
	parsePurgeOptions(['--sweep-only', "--cutoff={$cutoffFive}"], $now);
} catch (\InvalidArgumentException $error) {
	$rejectionMessage = $error->getMessage();
}
assertSameValue('a too recent cutoff explains the 10 minute rule', true, str_contains($rejectionMessage, 'at least 10 minutes in the past'));

// ── nextContinuationToken ──
assertSameValue('nextContinuationToken returns null on the last page', null, nextContinuationToken(false, null));
assertSameValue('nextContinuationToken ignores a token on the last page', null, nextContinuationToken(false, 'abc'));
assertSameValue('nextContinuationToken returns the token of a truncated page', 'abc', nextContinuationToken(true, 'abc'));
foreach (['missing' => null, 'empty' => ''] as $description => $token) {
	$rejectionMessage = '';
	try {
		nextContinuationToken(true, $token);
	} catch (\RuntimeException $error) {
		$rejectionMessage = $error->getMessage();
	}
	assertSameValue("nextContinuationToken rejects a truncated page with a {$description} token", 'listing truncated without a continuation token', $rejectionMessage);
}

// ── purgePreconditionProblems ──
assertSameValue('S3 at 1280 with no legacy previews has no problems', [], purgePreconditionProblems(true, false, 1280, 1280, 1280, 0, true));
assertSameValue('local instance is refused', ['no primary object store (local-disk instance)'], purgePreconditionProblems(false, false, 1280, 1280, 1280, 0, true));
assertSameValue('multibucket is refused', ['multibucket object store is not supported'], purgePreconditionProblems(true, true, 1280, 1280, 1280, 0, true));
assertSameValue('old cap is refused', ['preview_max_x/y is 2048/2048, expected 1280'], purgePreconditionProblems(true, false, 2048, 2048, 1280, 0, true));
assertSameValue('legacy previews are refused', ['3 legacy previews (old_file_id) would be orphaned by truncation'], purgePreconditionProblems(true, false, 1280, 1280, 1280, 3, true));
assertSameValue('a preview store other than root is refused', ['preview object store differs from root'], purgePreconditionProblems(true, false, 1280, 1280, 1280, 0, false));
assertSameValue('every problem is reported together', [
	'no primary object store (local-disk instance)',
	'multibucket object store is not supported',
	'preview_max_x/y is 2048/1280, expected 1280',
	'2 legacy previews (old_file_id) would be orphaned by truncation',
	'preview object store differs from root',
], purgePreconditionProblems(false, true, 2048, 1280, 1280, 2, false));

// ── sweepCutoffProblem ──
$cutoff = cutoffAt(5000);
assertSameValue('sweepCutoffProblem accepts a table with no previews', null, sweepCutoffProblem(null, $cutoff));
assertSameValue('sweepCutoffProblem accepts an oldest preview exactly at the cutoff', null, sweepCutoffProblem($cutoff, $cutoff));
assertSameValue('sweepCutoffProblem accepts an oldest preview after the cutoff', null, sweepCutoffProblem(cutoffAt(5001), $cutoff));
assertSameValue(
	'sweepCutoffProblem rejects an oldest preview before the cutoff',
	"cutoff {$cutoff->format(DATE_ATOM)} is later than the oldest remaining preview ({$cutoff->modify('-1 second')->format(DATE_ATOM)}); use the cutoff printed by the original run",
	sweepCutoffProblem($cutoff->modify('-1 second'), $cutoff),
);

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

$time = new FakeTime();
$client = new FakeBucketClient(previewObjects(1, 2500), $time);
$walk = walkBucket($client, DEFAULT_PREVIEW_PREFIX, testGuardrails($time, new PauseRecorder()), function (BucketPage $_page): ?string {
	throw new \RuntimeException('page handler exploded');
});
assertSameValue('walk reports a page processing error', 'page processing error: page handler exploded', $walk->abortReason);
assertSameValue('walk keeps counts of the page that failed to process', 1000, $walk->objects);

// ── sweepPreviews ──
$time = new FakeTime();
$objects = previewObjects(1, 1500) + previewObjects(5000, 300) + ['urn:oid:42' => 999, 'uri:oid:preview:bad' => 7];
$client = new FakeBucketClient($objects, $time);
$sweep = sweepPreviews($client, DEFAULT_PREVIEW_PREFIX, cutoffAt(5000), createdAtFromUnixId(), false, testGuardrails($time, new PauseRecorder()));
assertSameValue('sweep deletes previews older than the cutoff', 1500, $sweep->deleted);
assertSameValue('sweep keeps previews at or after the cutoff', 300, $sweep->kept);
assertSameValue('sweep skips non-numeric preview keys', 1, $sweep->foreignKeys);
assertSameValue('sweep leaves file objects in place', true, in_array('urn:oid:42', $client->keys(), true));
assertSameValue('sweep leaves exactly the kept and foreign keys', 302, count($client->keys()));

assertSameValue('sweep deletes in batches of at most the page size', true, max(array_map('count', $client->deleteBatches)) <= 1000);
assertSameValue('sweep sends one delete per page with purgeable keys', 2, count($client->deleteBatches));
assertSameValue('sweep completes without abort', null, $sweep->walk->abortReason);

$time = new FakeTime();
$objects = previewObjects(1, 10) + ['urn:oid:42' => 999, 'uri:oid:preview:bad' => 7];
$client = new FakeBucketClient($objects, $time, ignorePrefix: true);
$sweep = sweepPreviews($client, DEFAULT_PREVIEW_PREFIX, cutoffAt(5000), createdAtFromUnixId(), false, testGuardrails($time, new PauseRecorder()));
assertSameValue('sweep counts keys that are not previews as foreign', 2, $sweep->foreignKeys);
assertSameValue('sweep never deletes file objects listed by the store', true, in_array('urn:oid:42', $client->keys(), true));
assertSameValue('sweep never deletes non-numeric preview keys listed by the store', true, in_array('uri:oid:preview:bad', $client->keys(), true));
assertSameValue('sweep still deletes the previews among foreign keys', 10, $sweep->deleted);

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
$client = new FakeBucketClient(previewObjects(1, 1500), $time, throwOnDelete: true);
$sweep = sweepPreviews($client, DEFAULT_PREVIEW_PREFIX, cutoffAt(5000), createdAtFromUnixId(), false, testGuardrails($time, new PauseRecorder()));
assertSameValue('sweep stops when the delete request throws', 'delete request error: delete connection reset', $sweep->walk->abortReason);
assertSameValue('sweep counts nothing as deleted when the delete request throws', 0, $sweep->deleted);

$time = new FakeTime();
$client = new FakeBucketClient(previewObjects(1, 1500), $time);
$decodeCreatedAt = function (string $previewId): \DateTimeImmutable {
	if ($previewId === '999') {
		throw new \RuntimeException('undecodable snowflake');
	}
	return (new \DateTimeImmutable())->setTimestamp((int)$previewId);
};
$sweep = sweepPreviews($client, DEFAULT_PREVIEW_PREFIX, cutoffAt(5000), $decodeCreatedAt, false, testGuardrails($time, new PauseRecorder()));
assertSameValue('sweep reports a page processing error', 'page processing error: undecodable snowflake', $sweep->walk->abortReason);
assertSameValue('sweep keeps the deletions of pages before the failing one', 1000, $sweep->deleted);

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

// ── delete batches smaller than a page ──
$time = new FakeTime();
$client = new FakeBucketClient(previewObjects(1000, 1500), $time);
$sweep = sweepPreviews($client, DEFAULT_PREVIEW_PREFIX, cutoffAt(5000), createdAtFromUnixId(), false, testGuardrails($time, new PauseRecorder(), deleteBatchSize: 200));
assertSameValue('sweep splits each page into delete batches of at most deleteBatchSize', true, max(array_map('count', $client->deleteBatches)) <= 200);
assertSameValue('sweep sends ceil(page / deleteBatchSize) deletes per page', 8, count($client->deleteBatches));
assertSameValue('sweep deletes every purgeable object across small batches', 1500, $sweep->deleted);
assertSameValue('sweep leaves no purgeable objects behind with small batches', 0, count($client->keys()));

$time = new FakeTime();
$pauses = new PauseRecorder();
$client = new FakeBucketClient(previewObjects(1000, 400), $time);
sweepPreviews($client, DEFAULT_PREVIEW_PREFIX, cutoffAt(5000), createdAtFromUnixId(), false, testGuardrails($time, $pauses, deleteBatchSize: 200));
assertSameValue('sweep pauses before every delete batch', 2, $pauses->calls);

$time = new FakeTime();
$client = new FakeBucketClient(previewObjects(1000, 1000), $time, deleteLatency: 7.0);
$sweep = sweepPreviews($client, DEFAULT_PREVIEW_PREFIX, cutoffAt(5000), createdAtFromUnixId(), false, testGuardrails($time, new PauseRecorder(), deleteBatchSize: 200));
assertSameValue('sweep stops at the first slow delete batch', 1, count($client->deleteBatches));
assertSameValue('sweep counts only the completed slow batch as deleted', 200, $sweep->deleted);

$time = new FakeTime();
$client = new FakeBucketClient(previewObjects(1000, 600), $time, deleteErrors: ['uri:oid:preview:1000: SlowDown please']);
$sweep = sweepPreviews($client, DEFAULT_PREVIEW_PREFIX, cutoffAt(5000), createdAtFromUnixId(), false, testGuardrails($time, new PauseRecorder(), deleteBatchSize: 200));
assertSameValue('sweep stops after the first refused delete batch', 1, count($client->deleteBatches));

// ── adaptive delete throttle ──
$time = new FakeTime();
$pauses = new PauseRecorder();
$client = new FakeBucketClient(previewObjects(1000, 600), $time, deleteLatency: 7.0);
$sweep = sweepPreviews($client, DEFAULT_PREVIEW_PREFIX, cutoffAt(5000), createdAtFromUnixId(), false, testGuardrails($time, $pauses, deleteBatchSize: 200, slowDeleteSeconds: 20.0));
assertSameValue('sweep tolerates deletes slower than the list threshold but under slowDeleteSeconds', null, $sweep->walk->abortReason);
assertSameValue('sweep deletes everything when deletes are slow but tolerated', 600, $sweep->deleted);
assertSameValue('sweep waits as long as the previous delete took before the next one', [200_000, 7_000_000, 7_000_000], $pauses->microseconds);

$time = new FakeTime();
$client = new FakeBucketClient(previewObjects(1000, 600), $time, deleteLatency: 25.0);
$sweep = sweepPreviews($client, DEFAULT_PREVIEW_PREFIX, cutoffAt(5000), createdAtFromUnixId(), false, testGuardrails($time, new PauseRecorder(), deleteBatchSize: 200, slowDeleteSeconds: 20.0));
assertSameValue('sweep still stops on a delete slower than slowDeleteSeconds', 'slow delete request 25.0s', $sweep->walk->abortReason);

// ── transient S3 errors ──
$time = new FakeTime();
$pauses = new PauseRecorder();
$client = new FakeBucketClient(previewObjects(1, 1500), $time, transientListFailures: 2);
$walk = walkBucket($client, DEFAULT_PREVIEW_PREFIX, testGuardrails($time, $pauses), fn (BucketPage $_page): ?string => null);
assertSameValue('walk retries a transient list failure and completes', null, $walk->abortReason);
assertSameValue('walk still counts every object after retries', 1500, $walk->objects);
assertSameValue('walk backs off with the configured delays before retrying', [1, 2], array_slice($pauses->microseconds, 0, 2));

$time = new FakeTime();
$client = new FakeBucketClient(previewObjects(1, 1500), $time, transientListFailures: 10);
$walk = walkBucket($client, DEFAULT_PREVIEW_PREFIX, testGuardrails($time, new PauseRecorder()), fn (BucketPage $_page): ?string => null);
assertSameValue('walk stops once transient list failures outlast every retry', 'list request error after 3 retries: 502 Bad Gateway', $walk->abortReason);
assertSameValue('walk makes one attempt plus one per backoff step', 4, $client->listCalls);

$time = new FakeTime();
$client = new FakeBucketClient(previewObjects(1, 1500), $time, failListOnCall: 1);
$walk = walkBucket($client, DEFAULT_PREVIEW_PREFIX, testGuardrails($time, new PauseRecorder()), fn (BucketPage $_page): ?string => null);
assertSameValue('walk does not retry non-transient list errors', 1, $client->listCalls);

$time = new FakeTime();
$client = new FakeBucketClient(previewObjects(1000, 600), $time, transientDeleteFailures: 2);
$sweep = sweepPreviews($client, DEFAULT_PREVIEW_PREFIX, cutoffAt(5000), createdAtFromUnixId(), false, testGuardrails($time, new PauseRecorder(), deleteBatchSize: 200));
assertSameValue('sweep retries a transient delete failure and completes', null, $sweep->walk->abortReason);
assertSameValue('sweep deletes every object after delete retries', 600, $sweep->deleted);
assertSameValue('sweep leaves nothing behind after delete retries', 0, count($client->keys()));

$time = new FakeTime();
$client = new FakeBucketClient(previewObjects(1000, 600), $time, transientDeleteFailures: 10);
$sweep = sweepPreviews($client, DEFAULT_PREVIEW_PREFIX, cutoffAt(5000), createdAtFromUnixId(), false, testGuardrails($time, new PauseRecorder(), deleteBatchSize: 200));
assertSameValue('sweep stops once transient delete failures outlast every retry', 'delete request error after 3 retries: 502 Bad Gateway', $sweep->walk->abortReason);
assertSameValue('sweep counts nothing as deleted when every delete attempt failed', 0, $sweep->deleted);

exit($failures === 0 ? 0 : 1);
