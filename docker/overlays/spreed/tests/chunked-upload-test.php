<?php
// Standalone test for RecordingChunkedUploadService. No NC autoloader: we define
// minimal stubs for the three dependencies the service actually uses, so `php
// docker/overlays/spreed/tests/chunked-upload-test.php` runs anywhere.

namespace OCP {
    interface IConfig {
        public function getSystemValue($key, $default = '');
    }
}
namespace OCA\Talk {
    class Room {
        public function __construct(private string $token) {}
        public function getToken(): string { return $this->token; }
    }
}
namespace Psr\Log {
    interface LoggerInterface {
        public function warning($message, array $context = []): void;
    }
}

namespace {
    use OCA\Talk\Room;
    use OCA\Talk\Service\RecordingChunkedUploadService;

    require __DIR__ . '/../lib/Service/RecordingChunkedUploadService.php';

    $failures = 0;
    function check(string $name, bool $ok): void {
        global $failures;
        if ($ok) { echo "  ok   - $name\n"; }
        else { echo "  FAIL - $name\n"; $failures++; }
    }

    $dataDir = sys_get_temp_dir() . '/avuz-chunk-test-' . bin2hex(random_bytes(4));
    mkdir($dataDir, 0770, true);

    $config = new class($dataDir) implements \OCP\IConfig {
        public function __construct(private string $dir) {}
        public function getSystemValue($key, $default = '') {
            return $key === 'datadirectory' ? $this->dir : $default;
        }
    };
    $logger = new class implements \Psr\Log\LoggerInterface {
        public function warning($message, array $context = []): void {}
    };
    $svc = new RecordingChunkedUploadService($config, $logger);

    // ---- Task A1: atomic chunk write ----
    (function () use ($svc) {
        $room = new Room('atomictok');
        $uploadId = $svc->init($room, 'rec.webm', 8);
        $svc->writeChunk($room, $uploadId, 0, 'AAAA');
        $svc->writeChunk($room, $uploadId, 0, 'BBBB'); // overwrite same index
        global $failures;
        $root = $svc->getRoot();
        $part = $root . '/atomictok/' . $uploadId . '/0000.part';
        check('chunk overwrite keeps last write intact', @file_get_contents($part) === 'BBBB');
        check('no leftover .tmp files', count(glob($root . '/atomictok/' . $uploadId . '/*.tmp*') ?: []) === 0);
    })();

    echo $failures === 0 ? "\nPASS\n" : "\n$failures FAILURE(S)\n";
    exit($failures === 0 ? 0 : 1);
}
