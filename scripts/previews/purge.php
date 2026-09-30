<?php
// Purges every preview: truncates oc_previews (+ the previewgenerator queue),
// then deletes preview objects older than the cutoff from the instance's own
// bucket. Dry run unless --execute. Bundled after lib.php by run.sh.
// Design: docs/superpowers/specs/2026-09-29-preview-storage-reduction-design.md

namespace Avuz\PreviewTools;

require '/var/www/html/lib/base.php';

// Must equal the PREVIEW_MAX_X/Y defaults in docker/entrypoint.sh.
const REQUIRED_PREVIEW_MAX = 1280;
const PURGED_TABLES = ['previews', 'preview_generation'];
const LOCK_WAIT_SECONDS = 5;
const LOCK_TIMEOUT_MESSAGE_PATTERN = '/lock timeout|lock wait timeout|55P03/i';

$now = new \DateTimeImmutable();
try {
	$options = parsePurgeOptions(array_slice($argv, 1), $now);
} catch (\InvalidArgumentException $error) {
	fwrite(STDERR, "error: {$error->getMessage()}\n");
	exit(2);
}

$config = \OCP\Server::get(\OCP\IConfig::class);
$db = \OCP\Server::get(\OCP\IDBConnection::class);
$storeConfig = \OCP\Server::get(\OC\Files\ObjectStore\PrimaryObjectStoreConfig::class);
$snowflakes = \OCP\Server::get(\OCP\Snowflake\ISnowflakeDecoder::class);

$legacyPreviewCount = function () use ($db): int {
	if (!$db->tableExists('previews')) {
		return 0;
	}
	$query = $db->getQueryBuilder();
	$query->selectAlias($query->func()->count('*'), 'legacy')
		->from('previews')
		->where($query->expr()->isNotNull('old_file_id'));
	return (int)$query->executeQuery()->fetchOne();
};

$hasObjectStore = $storeConfig->hasObjectStore();
$rootConfig = $hasObjectStore ? $storeConfig->getObjectStoreConfiguration('root') : ['arguments' => []];
$problems = purgePreconditionProblems(
	$hasObjectStore,
	(bool)($rootConfig['arguments']['multibucket'] ?? false),
	$config->getSystemValueInt('preview_max_x', 4096),
	$config->getSystemValueInt('preview_max_y', 4096),
	REQUIRED_PREVIEW_MAX,
	$hasObjectStore ? $legacyPreviewCount() : 0,
	!$hasObjectStore || $storeConfig->resolveAlias('preview') === $storeConfig->resolveAlias('root'),
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

$cutoff = $options->cutoff ?? $now->sub(new \DateInterval(CUTOFF_MARGIN));
echo "bucket\t{$bucket} / prefix {$prefix}\n";
echo "cutoff\t{$cutoff->format(DATE_ATOM)}\n";

$rowCount = function (string $table) use ($db): int {
	$query = $db->getQueryBuilder();
	$query->selectAlias($query->func()->count('*'), 'rows')->from($table);
	return (int)$query->executeQuery()->fetchOne();
};

$oldestPreviewId = function () use ($db): ?string {
	$query = $db->getQueryBuilder();
	$query->selectAlias($query->func()->min('id'), 'oldest')->from('previews');
	$oldest = $query->executeQuery()->fetchOne();
	return $oldest === false || $oldest === null ? null : (string)$oldest;
};

if ($options->mode === PurgeMode::SweepOnly) {
	$oldestId = $oldestPreviewId();
	$oldestCreatedAt = $oldestId === null ? null : $snowflakes->decode($oldestId)->getCreatedAt();
	$cutoffProblem = sweepCutoffProblem($oldestCreatedAt, $cutoff);
	if ($cutoffProblem !== null) {
		echo "precondition\tFAIL {$cutoffProblem}\n";
		exit(1);
	}
}

$limitLockWait = function () use ($db): void {
	$statements = [
		\OCP\IDBConnection::PLATFORM_POSTGRES => sprintf("SET lock_timeout = '%ds'", LOCK_WAIT_SECONDS),
		\OCP\IDBConnection::PLATFORM_MYSQL => sprintf('SET SESSION lock_wait_timeout = %d', LOCK_WAIT_SECONDS),
		\OCP\IDBConnection::PLATFORM_MARIADB => sprintf('SET SESSION lock_wait_timeout = %d', LOCK_WAIT_SECONDS),
	];
	$statement = $statements[$db->getDatabaseProvider()] ?? null;
	if ($statement !== null) {
		$db->executeStatement($statement);
	}
};

$isLockTimeout = fn (\OCP\DB\Exception $error): bool => $error->getReason() === \OCP\DB\Exception::REASON_LOCK_WAIT_TIMEOUT
	|| preg_match(LOCK_TIMEOUT_MESSAGE_PATTERN, $error->getMessage()) === 1;

if ($options->mode === PurgeMode::Execute) {
	$limitLockWait();
}

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
		try {
			$db->truncateTable($table, false);
		} catch (\OCP\DB\Exception $error) {
			if (!$isLockTimeout($error)) {
				throw $error;
			}
			echo "table\t{$table}: FAIL lock wait exceeded — retry later\n";
			exit(1);
		}
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
