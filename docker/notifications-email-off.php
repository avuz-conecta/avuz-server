<?php

declare(strict_types=1);

// Sets every user's notification e-mail frequency to "never" (Deck #530): the
// bell and push already deliver each notification, and every e-mail is a paid
// ZeptoMail send. Pairs with the admin default setting_batchtime=0.
//
// batch_time 0 + next_send_time 0 is exactly what the notifications app writes
// when a user picks "Never" (SettingsMapper::setBatchSettingForUser), and the
// send job only reads rows with next_send_time > 0. Rows with batch_time 5
// ("follow the admin default") are reset too: with the default at 0 they would
// otherwise be e-mailed on every cron run once next_send_time turns positive.
//
// Usage: php notifications-email-off.php
// Prints one outcome line: reset <users> | unchanged | failed: <reason>.

use OCP\IDBConnection;
use OCP\Server;

const AVUZ_CONFIG_FILE = '/var/www/html/config/config.php';
const AVUZ_SETTINGS_TABLE = 'notifications_settings';
const AVUZ_EMAIL_NEVER = 0;

if (PHP_SAPI !== 'cli') {
	exit(1);
}

function avuzFail(string $reason): never {
	echo "failed: $reason\n";
	exit(1);
}

// Same privilege drop as seed-external-icons.php: a log line written as root
// would leave nextcloud.log unwritable for php-fpm.
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

function avuzResetEmailFrequency(IDBConnection $connection): int {
	$query = $connection->getQueryBuilder();
	$never = $query->createNamedParameter(AVUZ_EMAIL_NEVER);
	$query->update(AVUZ_SETTINGS_TABLE)
		->set('batch_time', $never)
		->set('next_send_time', $never)
		->where($query->expr()->orX(
			$query->expr()->neq('batch_time', $never),
			$query->expr()->neq('next_send_time', $never),
		));
	return $query->executeStatement();
}

avuzDropToConfigOwner();

try {
	require '/var/www/html/lib/base.php';
	$connection = Server::get(IDBConnection::class);
	if (!$connection->tableExists(AVUZ_SETTINGS_TABLE)) {
		echo "unchanged\n";
		exit(0);
	}
	$resetUsers = avuzResetEmailFrequency($connection);
} catch (\Throwable $exception) {
	avuzFail($exception::class);
}

echo $resetUsers === 0 ? "unchanged\n" : "reset $resetUsers\n";
