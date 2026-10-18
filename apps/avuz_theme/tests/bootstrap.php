<?php

declare(strict_types=1);

// Runs without a live server: OCA\AvuzTheme from lib/, OCP and OC from this
// checkout's core lib/public and lib/private, their dependencies (psr/*) from
// the 3rdparty submodule.
const AVUZ_THEME_THIRD_PARTY_AUTOLOAD = __DIR__ . '/../../../3rdparty/autoload.php';
const AVUZ_THEME_AUTOLOAD_ROOTS = [
	'OCA\\AvuzTheme\\' => __DIR__ . '/../lib/',
	'OCP\\' => __DIR__ . '/../../../lib/public/',
	'OC\\' => __DIR__ . '/../../../lib/private/',
];

spl_autoload_register(static function (string $class): void {
	foreach (AVUZ_THEME_AUTOLOAD_ROOTS as $prefix => $directory) {
		if (!str_starts_with($class, $prefix)) {
			continue;
		}
		$path = $directory . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
		if (file_exists($path)) {
			require_once $path;
		}
		return;
	}
});

if (file_exists(AVUZ_THEME_THIRD_PARTY_AUTOLOAD)) {
	require_once AVUZ_THEME_THIRD_PARTY_AUTOLOAD;
}
