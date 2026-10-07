<?php
// Masks secrets that occ --value arguments left in the admin_audit log.
// Bundled after lib.php and run inside the container by run.sh.
// Dry run unless --execute. Prints keys and counts, never a value.

namespace Avuz\AuditLog;

require '/var/www/html/lib/base.php';

const ROTATED_SUFFIX = '.1';
const EXECUTE_FLAG = '--execute';

$execute = in_array(EXECUTE_FLAG, $argv, true);
$config = \OCP\Server::get(\OCP\IConfig::class);

$logType = $config->getSystemValueString('log_type_audit', 'file');
if ($logType !== 'file') {
	echo "audit log\ttype $logType, not a file — nothing to redact here\n";
	return;
}
// Same resolution as OCA\AdminAudit\AuditLogger.
$logFile = $config->getSystemValueString('logfile_audit', '');
if ($logFile === '') {
	$default = $config->getSystemValue('datadirectory', \OC::$SERVERROOT . '/data') . '/audit.log';
	$logFile = $config->getAppValue('admin_audit', 'logfile', $default);
}

$secretsLeft = 0;
foreach ([$logFile, $logFile . ROTATED_SUFFIX] as $path) {
	if (!is_file($path)) {
		continue;
	}
	$report = redactFile($path, $execute);
	echo "file\t$path\t{$report->lines} lines\n";
	foreach ($report->keys as $key => $counts) {
		$kind = $counts['secret'] ? 'secret' : 'plain';
		echo "  $key\t$kind\t{$counts['lines']} set on argv\t{$counts['toRedact']} unmasked\t{$counts['redacted']} masked\n";
	}
	if ($report->unlocated > 0) {
		echo "  WARN {$report->unlocated} secret line(s) whose value could not be located — inspect by hand\n";
	}
	if ($execute) {
		$report = redactFile($path, false);
	}
	$secretsLeft += $report->secretsLeft();
}

if (!$execute) {
	echo "summary\t$secretsLeft secret value(s) to mask — dry run, pass --execute\n";
	return;
}
echo $secretsLeft === 0
	? "summary\tverified: no unmasked secret left\n"
	: "summary\tFAIL $secretsLeft secret value(s) still unmasked\n";
