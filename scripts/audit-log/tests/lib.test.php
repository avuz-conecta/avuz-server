<?php
declare(strict_types=1);

// php scripts/audit-log/tests/lib.test.php

namespace Avuz\AuditLog;

require __DIR__ . '/../lib.php';

$failures = 0;
function check(string $description, mixed $expected, mixed $actual): void {
	global $failures;
	if ($expected === $actual) {
		echo "ok - $description\n";
		return;
	}
	$failures++;
	echo "NOT OK - $description\n  expected: " . var_export($expected, true) . "\n  actual:   " . var_export($actual, true) . "\n";
}
function describe(string $title): void {
	echo "# $title\n";
}

// Same encoding as OC\Log\LogDetails::logDetailsAsJSON.
function auditLine(string $message): string {
	return json_encode([
		'reqId' => 'r3q',
		'level' => 1,
		'time' => '2026-10-02T10:00:00+00:00',
		'remoteAddr' => '',
		'user' => '--',
		'app' => 'admin_audit',
		'method' => '',
		'url' => '--',
		'message' => $message,
		'userAgent' => '--',
		'version' => '33.0.0.16',
		'data' => ['app' => 'admin_audit'],
	], JSON_PARTIAL_OUTPUT_ON_ERROR | JSON_UNESCAPED_SLASHES);
}
function command(string $arguments): string {
	return auditLine("Console command executed: $arguments");
}
function redactLine(string $line): string {
	$write = inspectLine($line);
	return substr_replace($line, str_repeat('*', $write->valueLength), $write->valueOffset, $write->valueLength);
}
function messageOf(string $line): string {
	return json_decode($line, true)['message'];
}

const SECRET = 'sso-"quoted"\\back/slash-é';

describe('config key detection');
check('it reads the app and key of config:app:set', 'conectamail/sso_secret',
	configKeySetOnArgv('Console command executed: config:app:set conectamail sso_secret --sensitive --value=x'));
check('it reads the key of config:system:set', 'system/mail_smtppassword',
	configKeySetOnArgv('Console command executed: config:system:set mail_smtppassword --value=x'));
check('it reads the space form of --value', 'onlyoffice/jwt_secret',
	configKeySetOnArgv('Console command executed: config:app:set onlyoffice jwt_secret --value x'));
check('ignores a config read', null,
	configKeySetOnArgv('Console command executed: config:app:get conectamail sso_secret'));
check('ignores a config write without --value', null,
	configKeySetOnArgv('Console command executed: config:app:set spreed enabled --update-only'));
check('ignores other audit events', null, configKeySetOnArgv('Login successful: "admin"'));

describe('secret classification');
check('it treats a known secret key as secret', true, isSecretWrite('integration_openai/api_key', ''));
check('it treats the SMTP password as secret', true, isSecretWrite('system/mail_smtppassword', ''));
check('it treats any --sensitive write as secret', true,
	isSecretWrite('assinaturas/other', 'Console command executed: config:app:set assinaturas other --sensitive --value=x'));
check('keeps a plain setting', false, isSecretWrite('theming/productName', 'config:app:set theming productName --value=Avuz'));
check('keeps a plain system key that merely starts like a secret one', false, isSecretWrite('system/mail_smtppassword_hint', ''));

describe('line redaction');
$line = command('config:app:set conectamail sso_secret --sensitive --value=' . SECRET);
$redacted = redactLine($line);
check('it keeps the byte length of a redacted line', strlen($line), strlen($redacted));
check('it leaves a valid JSON line whose value is masked', 1,
	preg_match('/^Console command executed: config:app:set conectamail sso_secret --sensitive --value=\*+$/', messageOf($redacted)));
check('removes every byte of the secret', false, str_contains($redacted, 'sso-'));
check('keeps the other fields', 'admin_audit', json_decode($redacted, true)['app']);
check('reports a redacted line as redacted', true, inspectLine($redacted)->redacted);

$recordingLine = command('config:app:set spreed recording_servers --value={"servers":[{"server":"https://rec","verify":true}],"secret":"rec-secret"}');
$recordingRedacted = redactLine($recordingLine);
check('it masks a JSON value to the end of the message', 'Console command executed: config:app:set spreed recording_servers --value=',
	rtrim(messageOf($recordingRedacted), '*'));
check('removes the recording secret', false, str_contains($recordingRedacted, 'rec-secret'));

$plain = inspectLine(command('config:app:set theming productName --value=Avuz Conecta'));
check('it reports a plain write without touching it', [false, null], [$plain->secret, $plain->valueOffset]);
check('ignores a line that is not JSON', null, inspectLine('not json'));

describe('file redaction');
$path = tempnam(sys_get_temp_dir(), 'audit');
$smtpLine = command('config:system:set mail_smtppassword --value=smtp-pass');
$keepLine = command('config:app:set theming productName --value=Avuz');
$partialLine = command('config:app:set onlyoffice jwt_secret --value=still-writing');
file_put_contents($path, "$line\n$keepLine\n$smtpLine\n$partialLine");

$dryRun = redactFile($path, false);
check('a dry run counts the secrets left', 2, $dryRun->secretsLeft());
check('a dry run counts the plain writes by key', 1, $dryRun->keys['theming/productName']['lines']);
check('a dry run leaves the file unchanged', "$line\n$keepLine\n$smtpLine\n$partialLine", file_get_contents($path));

$executed = redactFile($path, true);
$contents = file_get_contents($path);
check('it redacts every complete secret line in place', "$redacted\n$keepLine\n" . redactLine($smtpLine) . "\n$partialLine", $contents);
check('it keeps the file size', strlen("$line\n$keepLine\n$smtpLine\n$partialLine"), strlen($contents));
check('leaves the line still being written alone', true, str_contains($contents, 'still-writing'));
check('reports what it redacted', 1, $executed->keys['system/mail_smtppassword']['toRedact']);

$rerun = redactFile($path, false);
check('it finds no secret left after a run', 0, $rerun->secretsLeft());
check('it counts the already-redacted lines', 1, $rerun->keys['conectamail/sso_secret']['redacted']);
unlink($path);

exit($failures === 0 ? 0 : 1);
