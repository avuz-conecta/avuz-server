<?php
declare(strict_types=1);

namespace Avuz\PreviewTools;

const DEFAULT_PREVIEW_PREFIX = 'uri:oid:preview:';
const CUTOFF_MARGIN = 'PT10M';
const REQUEST_TIMEOUT_SECONDS = 10;
const DELETE_TIMEOUT_SECONDS = 90;

/** A 5xx or connection-level S3 failure: safe to retry, since list and delete are idempotent. */
final class TransientBucketError extends \RuntimeException {
}

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
	private const BOUNDED_REQUEST = [
		'@http' => ['timeout' => REQUEST_TIMEOUT_SECONDS, 'connect_timeout' => REQUEST_TIMEOUT_SECONDS],
		'@retries' => 0,
	];
	private const BOUNDED_DELETE = [
		'@http' => ['timeout' => DELETE_TIMEOUT_SECONDS, 'connect_timeout' => REQUEST_TIMEOUT_SECONDS],
		'@retries' => 0,
	];

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
		$result = $this->send(fn () => $this->client->listObjectsV2($request + self::BOUNDED_REQUEST));
		$objects = array_map(
			fn (array $object): BucketObject => new BucketObject($object['Key'], (int)$object['Size']),
			$result['Contents'] ?? [],
		);
		return new BucketPage($objects, nextContinuationToken((bool)$result['IsTruncated'], $result['NextContinuationToken'] ?? null));
	}

	public function deleteKeys(array $keys): array {
		if ($keys === []) {
			return [];
		}
		$result = $this->send(fn () => $this->client->deleteObjects([
			'Bucket' => $this->bucket,
			'Delete' => [
				'Objects' => array_map(fn (string $key): array => ['Key' => $key], $keys),
				'Quiet' => true,
			],
		] + self::BOUNDED_DELETE));
		return array_map(
			fn (array $error): string => "{$error['Key']}: {$error['Code']} {$error['Message']}",
			$result['Errors'] ?? [],
		);
	}

	/** @throws TransientBucketError on a 5xx response or no response at all (connection error, timeout) */
	private function send(\Closure $request): \Aws\Result {
		try {
			return $request();
		} catch (\Aws\Exception\AwsException $error) {
			$status = $error->getResponse()?->getStatusCode();
			if ($status !== null && $status < 500) {
				throw $error;
			}
			$reason = $status === null ? $error->getMessage() : "{$status} {$error->getAwsErrorCode()}";
			throw new TransientBucketError($reason, 0, $error);
		}
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
		public readonly int $deleteBatchSize,
		public readonly int $pauseMicroseconds,
		public readonly float $slowRequestSeconds,
		public readonly float $slowDeleteSeconds,
		/** @var list<int> */
		public readonly array $retryBackoffMicroseconds,
		public readonly int $progressEveryPages,
		public readonly \Closure $clock,
		public readonly \Closure $pause,
		public readonly \Closure $progress,
	) {
	}

	public static function production(): self {
		return new self(
			pageSize: 1000,
			deleteBatchSize: 200,
			pauseMicroseconds: 200_000,
			slowRequestSeconds: 5.0,
			slowDeleteSeconds: 60.0,
			retryBackoffMicroseconds: [2_000_000, 5_000_000, 15_000_000, 30_000_000, 60_000_000],
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

function nextContinuationToken(bool $isTruncated, ?string $token): ?string {
	if (!$isTruncated) {
		return null;
	}
	if ($token === null || $token === '') {
		throw new \RuntimeException('listing truncated without a continuation token');
	}
	return $token;
}

function parseCutoff(string $value, \DateTimeImmutable $now): \DateTimeImmutable {
	$cutoff = \DateTimeImmutable::createFromFormat(DATE_ATOM, $value);
	$parseErrors = \DateTimeImmutable::getLastErrors();
	if ($cutoff === false || ($parseErrors !== false && ($parseErrors['warning_count'] > 0 || $parseErrors['error_count'] > 0))) {
		throw new \InvalidArgumentException("--cutoff must look like 2026-10-01T02:00:00+00:00, got {$value}");
	}
	if ($cutoff > $now->sub(new \DateInterval(CUTOFF_MARGIN))) {
		throw new \InvalidArgumentException('--cutoff must be at least 10 minutes in the past');
	}
	return $cutoff;
}

/**
 * @param list<string> $arguments CLI flags after `--`
 * @throws \InvalidArgumentException
 */
function parsePurgeOptions(array $arguments, \DateTimeImmutable $now): PurgeOptions {
	$execute = false;
	$sweepOnly = false;
	$cutoff = null;
	foreach ($arguments as $argument) {
		if ($argument === '--execute') {
			$execute = true;
			continue;
		}
		if ($argument === '--sweep-only') {
			$sweepOnly = true;
			continue;
		}
		if (str_starts_with($argument, '--cutoff=')) {
			$cutoff = parseCutoff(substr($argument, strlen('--cutoff=')), $now);
			continue;
		}
		throw new \InvalidArgumentException("unknown flag {$argument}");
	}
	if ($execute && $sweepOnly) {
		throw new \InvalidArgumentException('--execute and --sweep-only are mutually exclusive');
	}
	if ($sweepOnly && $cutoff === null) {
		throw new \InvalidArgumentException('--sweep-only needs --cutoff=<ISO 8601> from the original run');
	}
	if (!$sweepOnly && $cutoff !== null) {
		throw new \InvalidArgumentException('--cutoff only applies to --sweep-only');
	}
	$mode = match (true) {
		$sweepOnly => PurgeMode::SweepOnly,
		$execute => PurgeMode::Execute,
		default => PurgeMode::DryRun,
	};
	return new PurgeOptions($mode, $cutoff);
}

/** @return list<string> */
function purgePreconditionProblems(
	bool $hasObjectStore,
	bool $multibucket,
	int $previewMaxX,
	int $previewMaxY,
	int $requiredPreviewMax,
	int $legacyPreviewCount,
	bool $previewStoreIsRoot,
): array {
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
	if ($legacyPreviewCount > 0) {
		$problems[] = "{$legacyPreviewCount} legacy previews (old_file_id) would be orphaned by truncation";
	}
	if (!$previewStoreIsRoot) {
		$problems[] = 'preview object store differs from root';
	}
	return $problems;
}

function sweepCutoffProblem(?\DateTimeImmutable $oldestRemainingPreview, \DateTimeImmutable $cutoff): ?string {
	if ($oldestRemainingPreview === null || $oldestRemainingPreview >= $cutoff) {
		return null;
	}
	return "cutoff {$cutoff->format(DATE_ATOM)} is later than the oldest remaining preview ({$oldestRemainingPreview->format(DATE_ATOM)}); use the cutoff printed by the original run";
}

/**
 * Lists every object under $prefix, one page at a time, with pauses between
 * requests. Stops at the first request error or slow request, or when
 * $onPage returns an abort reason.
 *
 * @param \Closure(BucketPage): ?string $onPage
 */
/**
 * Runs $request, retrying TransientBucketError after each configured backoff.
 * Any other error, or a transient one that outlasts every retry, is thrown.
 *
 * @template T
 * @param \Closure(): T $request
 * @return T
 */
function withTransientRetries(Guardrails $guardrails, string $operation, \Closure $request): mixed {
	foreach ($guardrails->retryBackoffMicroseconds as $retry => $backoffMicroseconds) {
		try {
			return $request();
		} catch (TransientBucketError $error) {
			($guardrails->progress)(sprintf('%s failed (%s), retry %d in %.0fs', $operation, $error->getMessage(), $retry + 1, $backoffMicroseconds / 1_000_000));
			($guardrails->pause)($backoffMicroseconds);
		}
	}
	return $request();
}

function walkBucket(BucketClient $client, string $prefix, Guardrails $guardrails, \Closure $onPage): WalkOutcome {
	$outcome = new WalkOutcome();
	$startedAt = ($guardrails->clock)();
	$continuationToken = null;

	do {
		$requestSeconds = 0.0;
		$listPage = function () use ($client, $prefix, $continuationToken, $guardrails, &$requestSeconds): BucketPage {
			$requestStartedAt = ($guardrails->clock)();
			$page = $client->listPage($prefix, $continuationToken, $guardrails->pageSize);
			$requestSeconds = ($guardrails->clock)() - $requestStartedAt;
			return $page;
		};
		try {
			$page = withTransientRetries($guardrails, 'list', $listPage);
		} catch (TransientBucketError $error) {
			$outcome->abortReason = sprintf('list request error after %d retries: %s', count($guardrails->retryBackoffMicroseconds), $error->getMessage());
			break;
		} catch (\Throwable $error) {
			$outcome->abortReason = "list request error: {$error->getMessage()}";
			break;
		}
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
		try {
			$outcome->abortReason = $onPage($page);
		} catch (\Throwable $error) {
			$outcome->abortReason = "page processing error: {$error->getMessage()}";
		}
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

	$previousDeleteMicroseconds = 0;

	/** @param list<BucketObject> $batch */
	$deleteBatch = function (array $batch) use ($sweep, $client, $guardrails, &$previousDeleteMicroseconds): ?string {
		($guardrails->pause)(max($guardrails->pauseMicroseconds, $previousDeleteMicroseconds));
		$keys = array_map(fn (BucketObject $object): string => $object->key, $batch);
		$requestSeconds = 0.0;
		$deleteKeys = function () use ($client, $keys, $guardrails, &$requestSeconds): array {
			$requestStartedAt = ($guardrails->clock)();
			$errors = $client->deleteKeys($keys);
			$requestSeconds = ($guardrails->clock)() - $requestStartedAt;
			return $errors;
		};
		try {
			$errors = withTransientRetries($guardrails, 'delete', $deleteKeys);
		} catch (TransientBucketError $error) {
			return sprintf('delete request error after %d retries: %s', count($guardrails->retryBackoffMicroseconds), $error->getMessage());
		} catch (\Throwable $error) {
			return "delete request error: {$error->getMessage()}";
		}
		$previousDeleteMicroseconds = (int)round($requestSeconds * 1_000_000);
		$sweep->slowestDeleteSeconds = max($sweep->slowestDeleteSeconds, $requestSeconds);
		if ($errors !== []) {
			return sprintf('%d delete errors, first: %s', count($errors), $errors[0]);
		}
		$sweep->deleted += count($batch);
		$sweep->deletedBytes += array_sum(array_map(fn (BucketObject $object): int => $object->size, $batch));
		if ($requestSeconds > $guardrails->slowDeleteSeconds) {
			return sprintf('slow delete request %.1fs', $requestSeconds);
		}
		return null;
	};

	$onPage = function (BucketPage $page) use ($sweep, $prefix, $cutoff, $createdAt, $dryRun, $deleteBatch, $guardrails): ?string {
		$purgeableObjects = [];
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
			$purgeableObjects[] = $object;
			$sweep->purgeable++;
			$sweep->purgeableBytes += $object->size;
		}

		if ($dryRun) {
			return null;
		}
		foreach (array_chunk($purgeableObjects, $guardrails->deleteBatchSize) as $batch) {
			$abortReason = $deleteBatch($batch);
			if ($abortReason !== null) {
				return $abortReason;
			}
		}
		return null;
	};

	$sweep->walk = walkBucket($client, $prefix, $guardrails, $onPage);
	return $sweep;
}

function gibibytes(int|float $bytes): string {
	return sprintf('%.2f GiB', $bytes / 1024 ** 3);
}
