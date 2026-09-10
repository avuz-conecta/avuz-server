<?php
declare(strict_types=1);

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
