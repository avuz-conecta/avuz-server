<?php

declare(strict_types=1);

// Seeds the Avuz icon library (Lucide, Deck #417) into the External sites icon
// store: appdata `external/icons`, written through IAppData so it works on local
// disk and on S3. The admin "Icons" section lists that folder and site entries
// may only pick names from it.
//
// Each library icon is a pair, <name>.svg + <name>-dark.svg (mobile/desktop
// clients), and is offered once per instance:
//   - a pair is skipped when either file already exists (admin upload or an
//     earlier seed), so nothing is ever overwritten;
//   - every processed name is recorded in avuz_theme/external_icons_seeded, so
//     an icon the admin deletes stays deleted. Only names added to the library
//     by a later image are seeded on later boots.
//
// Usage: php seed-external-icons.php
// Prints one outcome line: seeded <pairs written> | unchanged | skipped: <reason> | failed: <reason>.

use OCP\App\IAppManager;
use OCP\Files\AppData\IAppDataFactory;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFolder;
use OCP\IAppConfig;
use OCP\Server;

const AVUZ_LIBRARY_DIR = '/var/www/html/apps/avuz_theme/img/external-icons';
const AVUZ_CONFIG_FILE = '/var/www/html/config/config.php';
const AVUZ_EXTERNAL_APP = 'external';
const AVUZ_ICONS_FOLDER = 'icons';
const AVUZ_SEEDED_APP = 'avuz_theme';
const AVUZ_SEEDED_KEY = 'external_icons_seeded';
const AVUZ_DARK_SUFFIX = '-dark';
const AVUZ_ICON_EXTENSION = '.svg';

if (PHP_SAPI !== 'cli') {
	exit(1);
}

function avuzFail(string $reason): never {
	echo "failed: $reason\n";
	exit(1);
}

// Same privilege drop as set-app-config-from-env.php: appdata files must belong
// to the config.php owner, or php-fpm cannot replace or delete them later.
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

/** @return list<string> library icon names, without the -dark variants */
function avuzLibraryNames(string $libraryDir): array {
	$paths = glob("$libraryDir/*" . AVUZ_ICON_EXTENSION) ?: [];
	$names = array_map(static fn (string $path): string => basename($path, AVUZ_ICON_EXTENSION), $paths);
	$lightNames = array_filter($names, static fn (string $name): bool => !str_ends_with($name, AVUZ_DARK_SUFFIX));
	return array_values(array_filter(
		$lightNames,
		static fn (string $name): bool => in_array($name . AVUZ_DARK_SUFFIX, $names, true),
	));
}

function avuzIconFiles(string $name): array {
	return [$name . AVUZ_ICON_EXTENSION, $name . AVUZ_DARK_SUFFIX . AVUZ_ICON_EXTENSION];
}

/**
 * @param list<string> $libraryNames
 * @param list<string> $seededNames
 * @return list<string> names to process this run (never seen before)
 */
function avuzPendingNames(array $libraryNames, array $seededNames): array {
	return array_values(array_diff($libraryNames, $seededNames));
}

function avuzSeededNames(IAppConfig $appConfig): array {
	$stored = json_decode($appConfig->getValueString(AVUZ_SEEDED_APP, AVUZ_SEEDED_KEY, '[]'), true);
	return is_array($stored) ? array_values(array_filter($stored, 'is_string')) : [];
}

function avuzIconsFolder(IAppDataFactory $appDataFactory): ISimpleFolder {
	$appData = $appDataFactory->get(AVUZ_EXTERNAL_APP);
	try {
		return $appData->getFolder(AVUZ_ICONS_FOLDER);
	} catch (NotFoundException) {
		return $appData->newFolder(AVUZ_ICONS_FOLDER);
	}
}

// Writes both files of a pair unless either one exists. Returns whether it wrote.
function avuzSeedPair(ISimpleFolder $folder, string $libraryDir, string $name): bool {
	$files = avuzIconFiles($name);
	foreach ($files as $file) {
		if ($folder->fileExists($file)) {
			return false;
		}
	}
	foreach ($files as $file) {
		$content = file_get_contents("$libraryDir/$file");
		if ($content === false) {
			throw new RuntimeException("cannot read $file");
		}
		$folder->newFile($file, $content);
	}
	return true;
}

$libraryNames = avuzLibraryNames(AVUZ_LIBRARY_DIR);
if ($libraryNames === []) {
	echo "skipped: empty icon library\n";
	exit(0);
}

avuzDropToConfigOwner();

try {
	require '/var/www/html/lib/base.php';
	if (!Server::get(IAppManager::class)->isEnabledForAnyone(AVUZ_EXTERNAL_APP)) {
		echo "skipped: external app disabled\n";
		exit(0);
	}
	$appConfig = Server::get(IAppConfig::class);
	$seededNames = avuzSeededNames($appConfig);
	$pendingNames = avuzPendingNames($libraryNames, $seededNames);
	if ($pendingNames === []) {
		echo "unchanged\n";
		exit(0);
	}

	$folder = avuzIconsFolder(Server::get(IAppDataFactory::class));
	$writtenCount = 0;
	foreach ($pendingNames as $name) {
		$writtenCount += avuzSeedPair($folder, AVUZ_LIBRARY_DIR, $name) ? 1 : 0;
	}
	$appConfig->setValueString(AVUZ_SEEDED_APP, AVUZ_SEEDED_KEY, json_encode([...$seededNames, ...$pendingNames]));
	echo "seeded $writtenCount\n";
} catch (\Throwable $exception) {
	avuzFail(get_class($exception));
}
