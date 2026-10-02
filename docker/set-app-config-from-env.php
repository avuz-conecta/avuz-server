<?php

declare(strict_types=1);

// Writes one app config value read from an environment variable, so the value
// never reaches a command line: admin_audit logs the full argv of every occ
// call, and /proc/<pid>/cmdline is world-readable.
//
// Usage: php set-app-config-from-env.php <app> <key> <ENV_VAR_NAME> [--sensitive]
// Prints only the outcome (unchanged | set | failed: <reason>), never the value.

use OCP\IAppConfig;
use OCP\Server;

const AVUZ_USAGE = 'usage: set-app-config-from-env.php <app> <key> <ENV_VAR_NAME> [--sensitive]';
const AVUZ_SENSITIVE_FLAG = '--sensitive';
const AVUZ_OUTCOME_UNCHANGED = 'unchanged';
const AVUZ_OUTCOME_SET = 'set';
const AVUZ_CONFIG_FILE = '/var/www/html/config/config.php';

if (PHP_SAPI !== 'cli') {
	exit(1);
}

function avuzWriteAppConfig(IAppConfig $appConfig, string $app, string $key, string $value, bool $sensitive): string {
	if ($appConfig->hasKey($app, $key, null)) {
		$currentSensitive = $appConfig->isSensitive($app, $key, null);
		$currentValue = $appConfig->getValueString($app, $key, '', true);
		if ($currentValue === $value && $currentSensitive === $sensitive) {
			return AVUZ_OUTCOME_UNCHANGED;
		}
		// IAppConfig keeps an existing key's sensitivity through a value set.
		if ($currentSensitive !== $sensitive) {
			$appConfig->deleteKey($app, $key);
		}
	}
	$appConfig->setValueString($app, $key, $value, false, $sensitive);
	return AVUZ_OUTCOME_SET;
}

function avuzFail(string $reason): never {
	echo "failed: $reason\n";
	exit(1);
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
$positional = array_values(array_filter($arguments, static fn (string $argument): bool => $argument !== AVUZ_SENSITIVE_FLAG));
if (count($positional) !== 3) {
	avuzFail(AVUZ_USAGE);
}
[$app, $key, $environmentVariable] = $positional;

$value = getenv($environmentVariable);
if ($value === false) {
	avuzFail("$environmentVariable is not set");
}

avuzDropToConfigOwner();

try {
	require '/var/www/html/lib/base.php';
	echo avuzWriteAppConfig(Server::get(IAppConfig::class), $app, $key, $value, $sensitive) . "\n";
} catch (\Throwable $exception) {
	avuzFail(get_class($exception));
}
