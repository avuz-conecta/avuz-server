<?php

declare(strict_types=1);

// Runs without a live server. OCA\Calendar\ resolves from the overlay first,
// then from the pristine upstream apps/calendar (gitignored, must be 6.2.1).
// OCP and OC come from this checkout's core, psr/* from the 3rdparty submodule,
// OCA\AvuzTheme\ from apps/avuz_theme. stubs/OC.php stands in for core's \OC.
const AVUZ_CALENDAR_REQUIRED_VERSION = '6.2.1';
const AVUZ_CALENDAR_UPSTREAM = __DIR__ . '/../../../../apps/calendar';
const AVUZ_CALENDAR_THIRD_PARTY_AUTOLOAD = __DIR__ . '/../../../../3rdparty/autoload.php';
const AVUZ_CALENDAR_AUTOLOAD_ROOTS = [
	'OCA\\Calendar\\' => [
		__DIR__ . '/../lib/',
		AVUZ_CALENDAR_UPSTREAM . '/lib/',
	],
	'OCA\\AvuzTheme\\' => [__DIR__ . '/../../../../apps/avuz_theme/lib/'],
	'OCP\\' => [__DIR__ . '/../../../../lib/public/'],
	'OC\\' => [__DIR__ . '/../../../../lib/private/'],
];

$upstreamInfoPath = AVUZ_CALENDAR_UPSTREAM . '/appinfo/info.xml';
$upstreamVersion = is_file($upstreamInfoPath)
	? (string)(simplexml_load_file($upstreamInfoPath)->version ?? '')
	: '';
if ($upstreamVersion !== AVUZ_CALENDAR_REQUIRED_VERSION) {
	fwrite(STDERR, sprintf(
		"calendar overlay tests need the pristine upstream apps/calendar at %s, found %s in %s\n",
		AVUZ_CALENDAR_REQUIRED_VERSION,
		$upstreamVersion === '' ? 'nothing' : $upstreamVersion,
		$upstreamInfoPath,
	));
	exit(1);
}

spl_autoload_register(static function (string $class): void {
	foreach (AVUZ_CALENDAR_AUTOLOAD_ROOTS as $prefix => $directories) {
		if (!str_starts_with($class, $prefix)) {
			continue;
		}
		$relativePath = str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
		foreach ($directories as $directory) {
			if (file_exists($directory . $relativePath)) {
				require_once $directory . $relativePath;
				return;
			}
		}
		return;
	}
});

if (file_exists(AVUZ_CALENDAR_THIRD_PARTY_AUTOLOAD)) {
	require_once AVUZ_CALENDAR_THIRD_PARTY_AUTOLOAD;
}

require_once __DIR__ . '/stubs/OC.php';
