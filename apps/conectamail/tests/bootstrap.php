<?php
declare(strict_types=1);

// Sabre (VObject) ships in Nextcloud's 3rdparty submodule. A linked git
// worktree has it empty, so fall back to the primary checkout's copy.
function conectamailThirdPartyAutoloader(): ?string {
    $serverRoot = dirname(__DIR__, 3);
    $local = $serverRoot . '/3rdparty/autoload.php';
    if (is_file($local)) {
        return $local;
    }
    $gitCommonDir = trim((string) shell_exec(
        'git -C ' . escapeshellarg($serverRoot) . ' rev-parse --path-format=absolute --git-common-dir 2>/dev/null'
    ));
    $primary = dirname($gitCommonDir) . '/3rdparty/autoload.php';
    return $gitCommonDir !== '' && is_file($primary) ? $primary : null;
}

$thirdPartyAutoloader = conectamailThirdPartyAutoloader();
if ($thirdPartyAutoloader !== null) {
    require_once $thirdPartyAutoloader;
}

spl_autoload_register(function (string $class) {
    if (str_starts_with($class, 'OCA\\Roundcube\\')) {
        // OCA\Roundcube\Service\SignatureVerifier -> lib/Service/SignatureVerifier.php
        $relative = str_replace('\\', '/', substr($class, 14));
        $path = __DIR__ . '/../lib/' . $relative . '.php';
        if (file_exists($path)) {
            require_once $path;
        }
    }
});
