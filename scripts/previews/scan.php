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
