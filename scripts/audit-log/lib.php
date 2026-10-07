<?php
declare(strict_types=1);

// Finds secrets that admin_audit wrote to audit.log as occ --value arguments
// ("Console command executed: config:app:set <app> <key> --value=<secret>")
// and overwrites them in place with '*'. A redacted line keeps its byte
// length, so Nextcloud can keep appending while this runs (O_APPEND writes
// land past every offset this touches) and the line stays valid JSON.
// Nothing here ever prints a value.

namespace Avuz\AuditLog;

const SECRET_KEYS = [
	'conectamail/sso_secret',
	'conectamail/credential_key',
	'integration_openai/api_key',
	'integration_openai/stt_api_key',
	'onlyoffice/jwt_secret',
	'spreed/recording_servers',
	'assinaturas/api_token',
	'assinaturas/webhook_secret',
	'system/mail_smtppassword',
];
const SENSITIVE_OPTION = ' --sensitive';
const MESSAGE_FIELD = '"message":"';
const VALUE_OPTIONS = ['--value=', '--value '];
const VALUE_OPTION_LENGTH = 8;
const REDACTION_BYTE = '*';
const CONFIG_SET_PATTERN = '/^Console command executed: config:(?:app:set (\S+) (\S+)|system:set (\S+))\b.*?--value[= ]/s';

final class ConfigWrite {
	public function __construct(
		public readonly string $key,
		public readonly bool $secret,
		/** Byte span of the value inside the raw line; null when not a secret. */
		public readonly ?int $valueOffset = null,
		public readonly ?int $valueLength = null,
		public readonly bool $redacted = false,
	) {
	}
}

/** Returns "app/key" or "system/key" for a console command that set config through --value; null otherwise. */
function configKeySetOnArgv(string $message): ?string {
	if (!preg_match(CONFIG_SET_PATTERN, $message, $matches)) {
		return null;
	}
	return ($matches[3] ?? '') !== '' ? "system/{$matches[3]}" : "{$matches[1]}/{$matches[2]}";
}

function isSecretWrite(string $key, string $message): bool {
	return in_array($key, SECRET_KEYS, true) || str_contains($message, SENSITIVE_OPTION);
}

/** Byte offset just past the closing quote of the JSON string that starts at $start. */
function jsonStringEnd(string $line, int $start): ?int {
	$length = strlen($line);
	for ($position = $start; $position < $length; $position++) {
		if ($line[$position] === '\\') {
			$position++;
			continue;
		}
		if ($line[$position] === '"') {
			return $position;
		}
	}
	return null;
}

/** Locates the raw --value span of the message field: [offset, length], or null. */
function rawValueSpan(string $line): ?array {
	$messageField = strpos($line, MESSAGE_FIELD);
	if ($messageField === false) {
		return null;
	}
	$messageStart = $messageField + strlen(MESSAGE_FIELD);
	$messageEnd = jsonStringEnd($line, $messageStart);
	if ($messageEnd === null) {
		return null;
	}
	$rawMessage = substr($line, $messageStart, $messageEnd - $messageStart);
	$optionOffsets = array_filter(
		array_map(static fn (string $option): int|false => strpos($rawMessage, $option), VALUE_OPTIONS),
		static fn (int|false $offset): bool => $offset !== false,
	);
	if ($optionOffsets === []) {
		return null;
	}
	$valueOffset = $messageStart + min($optionOffsets) + VALUE_OPTION_LENGTH;
	return [$valueOffset, $messageEnd - $valueOffset];
}

function inspectLine(string $line): ?ConfigWrite {
	$entry = json_decode($line, true);
	if (!is_array($entry) || !is_string($entry['message'] ?? null)) {
		return null;
	}
	$key = configKeySetOnArgv($entry['message']);
	if ($key === null) {
		return null;
	}
	if (!isSecretWrite($key, $entry['message'])) {
		return new ConfigWrite($key, false);
	}
	$span = rawValueSpan($line);
	if ($span === null) {
		return new ConfigWrite($key, true);
	}
	[$valueOffset, $valueLength] = $span;
	$redacted = trim(substr($line, $valueOffset, $valueLength), REDACTION_BYTE) === '';
	return new ConfigWrite($key, true, $valueOffset, $valueLength, $redacted);
}

final class FileReport {
	/** @var array<string, array{lines: int, secret: bool, toRedact: int, redacted: int}> */
	public array $keys = [];
	public int $lines = 0;
	public int $unlocated = 0;

	public function count(ConfigWrite $write): void {
		$this->keys[$write->key] ??= ['lines' => 0, 'secret' => $write->secret, 'toRedact' => 0, 'redacted' => 0];
		$this->keys[$write->key]['lines']++;
		if ($write->secret && $write->valueOffset === null) {
			$this->unlocated++;
		}
		if ($write->secret && $write->valueOffset !== null && !$write->redacted) {
			$this->keys[$write->key]['toRedact']++;
		}
		if ($write->redacted) {
			$this->keys[$write->key]['redacted']++;
		}
	}

	public function secretsLeft(): int {
		return array_sum(array_column($this->keys, 'toRedact')) + $this->unlocated;
	}
}

/**
 * Scans a log and, with $execute, overwrites every secret value in place.
 * A trailing line without "\n" is still being written and is left alone.
 */
function redactFile(string $path, bool $execute): FileReport {
	$handle = fopen($path, $execute ? 'r+b' : 'rb');
	if ($handle === false) {
		throw new \RuntimeException("cannot open $path");
	}
	$report = new FileReport();
	$patches = [];
	try {
		while (($lineStart = ftell($handle)) !== false && ($line = fgets($handle)) !== false) {
			if (!str_ends_with($line, "\n")) {
				break;
			}
			$report->lines++;
			$write = inspectLine(rtrim($line, "\n"));
			if ($write === null) {
				continue;
			}
			$report->count($write);
			if ($write->secret && $write->valueOffset !== null && !$write->redacted) {
				$patches[] = [$lineStart + $write->valueOffset, $write->valueLength];
			}
		}
		if (!$execute) {
			return $report;
		}
		foreach ($patches as [$offset, $length]) {
			fseek($handle, $offset);
			fwrite($handle, str_repeat(REDACTION_BYTE, $length));
		}
		fflush($handle);
		return $report;
	} finally {
		fclose($handle);
	}
}
