<?php

declare(strict_types=1);

// Writes one config value read from an environment variable, so the value
// never reaches a command line: admin_audit logs the full argv of every occ
// call, and /proc/<pid>/cmdline is world-readable.
//
// Usage:
//   php set-app-config-from-env.php <app> <key> <ENV_VAR_NAME> [--sensitive] [--type=string|mixed]
//   php set-app-config-from-env.php --system <key> <ENV_VAR_NAME>
// Prints only the outcome (unchanged | set | failed: <reason>), never the value.
//
// Like `occ config:app:set`, an existing key keeps its lazy flag and, without
// --type, its value type; a new key is stored as mixed. A key whose
// sensitivity or type changes is deleted first: IAppConfig keeps an existing
// key's sensitivity through a value set and refuses a type change.

use OCP\IAppConfig;
use OCP\IConfig;
use OCP\Server;

const AVUZ_USAGE = 'usage: set-app-config-from-env.php <app> <key> <ENV_VAR_NAME> [--sensitive] [--type=string|mixed] | --system <key> <ENV_VAR_NAME>';
const AVUZ_SENSITIVE_FLAG = '--sensitive';
const AVUZ_SYSTEM_FLAG = '--system';
const AVUZ_TYPE_OPTION_PREFIX = '--type=';
const AVUZ_VALUE_TYPE_NAMES = ['string', 'mixed'];
const AVUZ_OUTCOME_UNCHANGED = 'unchanged';
const AVUZ_OUTCOME_SET = 'set';
const AVUZ_CONFIG_FILE = '/var/www/html/config/config.php';

if (PHP_SAPI !== 'cli') {
	exit(1);
}

function avuzFail(string $reason): never {
	echo "failed: $reason\n";
	exit(1);
}

// Resolved after bootstrap: IAppConfig is not autoloadable before lib/base.php.
function avuzValueTypes(): array {
	return ['string' => IAppConfig::VALUE_STRING, 'mixed' => IAppConfig::VALUE_MIXED];
}

function avuzStoreAppValue(IAppConfig $appConfig, string $app, string $key, string $value, int $type, bool $lazy, bool $sensitive): void {
	if ($type === IAppConfig::VALUE_STRING) {
		$appConfig->setValueString($app, $key, $value, $lazy, $sensitive);
		return;
	}
	$appConfig->setValueMixed($app, $key, $value, $lazy, $sensitive);
}

function avuzWriteAppConfig(IAppConfig $appConfig, string $app, string $key, string $value, bool $sensitive, ?string $requestedTypeName): string {
	$requestedType = $requestedTypeName === null ? null : avuzValueTypes()[$requestedTypeName];
	if (!$appConfig->hasKey($app, $key, null)) {
		avuzStoreAppValue($appConfig, $app, $key, $value, $requestedType ?? IAppConfig::VALUE_MIXED, false, $sensitive);
		return AVUZ_OUTCOME_SET;
	}

	$currentType = $appConfig->getValueType($app, $key);
	if (!in_array($currentType, avuzValueTypes(), true)) {
		avuzFail("$app/$key holds a non-text value type");
	}
	$type = $requestedType ?? $currentType;
	$lazy = $appConfig->isLazy($app, $key);
	$currentSensitive = $appConfig->isSensitive($app, $key, null);
	$currentValue = $appConfig->getValueString($app, $key, '', $lazy);
	if ($currentValue === $value && $currentSensitive === $sensitive && $currentType === $type) {
		return AVUZ_OUTCOME_UNCHANGED;
	}
	if ($currentSensitive !== $sensitive || $currentType !== $type) {
		$appConfig->deleteKey($app, $key);
	}
	avuzStoreAppValue($appConfig, $app, $key, $value, $type, $lazy, $sensitive);
	return AVUZ_OUTCOME_SET;
}

function avuzWriteSystemConfig(IConfig $config, string $key, string $value): string {
	if ($config->getSystemValue($key, null) === $value) {
		return AVUZ_OUTCOME_UNCHANGED;
	}
	$config->setSystemValue($key, $value);
	return AVUZ_OUTCOME_SET;
}

// The entrypoint runs as root; files Nextcloud creates (log, appdata) must
// belong to the config.php owner, as occ arranges. Unlike occ, this fails
// closed and sets the groups before the uid: once the uid drops, the process
// can no longer change its groups.
function avuzDropToConfigOwner(): void {
	if (posix_getuid() !== 0) {
		return;
	}
	$ownerUid = is_file(AVUZ_CONFIG_FILE) ? fileowner(AVUZ_CONFIG_FILE) : false;
	$owner = $ownerUid === false ? false : posix_getpwuid($ownerUid);
	if ($owner === false
		|| !posix_initgroups($owner['name'], $owner['gid'])
		|| !posix_setgid($owner['gid'])
		|| !posix_setuid($owner['uid'])) {
		avuzFail('cannot drop privileges');
	}
}

$arguments = array_slice($argv, 1);
$sensitive = in_array(AVUZ_SENSITIVE_FLAG, $arguments, true);
$system = in_array(AVUZ_SYSTEM_FLAG, $arguments, true);
$typeOptions = array_values(array_filter($arguments, static fn (string $argument): bool => str_starts_with($argument, AVUZ_TYPE_OPTION_PREFIX)));
$positional = array_values(array_filter(
	$arguments,
	static fn (string $argument): bool => !in_array($argument, [AVUZ_SENSITIVE_FLAG, AVUZ_SYSTEM_FLAG], true) && !str_starts_with($argument, AVUZ_TYPE_OPTION_PREFIX),
));

$requestedTypeName = $typeOptions === [] ? null : substr($typeOptions[0], strlen(AVUZ_TYPE_OPTION_PREFIX));
if ($requestedTypeName !== null && !in_array($requestedTypeName, AVUZ_VALUE_TYPE_NAMES, true)) {
	avuzFail(AVUZ_USAGE);
}
if ($system && ($sensitive || $requestedTypeName !== null || count($positional) !== 2)) {
	avuzFail(AVUZ_USAGE);
}
if (!$system && count($positional) !== 3) {
	avuzFail(AVUZ_USAGE);
}
$environmentVariable = $positional[count($positional) - 1];

$value = getenv($environmentVariable);
if ($value === false) {
	avuzFail("$environmentVariable is not set");
}

avuzDropToConfigOwner();

try {
	require '/var/www/html/lib/base.php';
	if ($system) {
		echo avuzWriteSystemConfig(Server::get(IConfig::class), $positional[0], $value) . "\n";
		exit(0);
	}
	echo avuzWriteAppConfig(Server::get(IAppConfig::class), $positional[0], $positional[1], $value, $sensitive, $requestedTypeName) . "\n";
} catch (\Throwable $exception) {
	avuzFail(get_class($exception));
}
