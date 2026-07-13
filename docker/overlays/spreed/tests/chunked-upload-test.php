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

    // ---- Task A2: key + marker + lock ----
    (function () use ($svc) {
        $room = new Room('keytok01');
        $k1 = $svc->finalizeKey($room, 'rec.webm', 'x');
        $k2 = $svc->finalizeKey($room, 'rec.webm', 'y');
        $k3 = $svc->finalizeKey($room, 'other.webm', 'x');
        check('key stable across uploadId', $k1 === $k2);
        check('key differs by fileName', $k1 !== $k3);
        check('key is 64-hex', (bool)preg_match('/^[a-f0-9]{64}$/', $k1));

        check('not finalized initially', $svc->isFinalized($room, $k1) === false);
        $svc->markFinalized($room, $k1);
        check('finalized after mark', $svc->isFinalized($room, $k1) === true);

        $h = $svc->acquireFinalizeLock($room, $k1);
        check('lock handle is a resource', is_resource($h));
        $svc->releaseFinalizeLock($h);
        check('lock file exists after acquire', is_file($svc->getRoot() . '/keytok01/' . $k1 . '.lock'));
    })();

    // key fallback to .meta when fileName omitted
    (function () use ($svc) {
        $room = new Room('metatok01');
        $uploadId = $svc->init($room, 'frommeta.webm', 4);
        $viaMeta = $svc->finalizeKey($room, null, $uploadId);
        $viaName = $svc->finalizeKey($room, 'frommeta.webm', $uploadId);
        check('null fileName falls back to meta', $viaMeta === $viaName);
    })();

    // ---- Task A3: sweepStale GCs markers/locks by TTL ----
    (function () use ($svc) {
        $room = new Room('sweeptok1');
        $key = $svc->finalizeKey($room, 'sweep.webm', 'z');
        $svc->markFinalized($room, $key);
        $lock = $svc->acquireFinalizeLock($room, $key);
        $svc->releaseFinalizeLock($lock);
        $root = $svc->getRoot();
        $done = $root . '/sweeptok1/' . $key . '.done';
        $lockf = $root . '/sweeptok1/' . $key . '.lock';

        // Fresh: sweep keeps both.
        $svc->sweepStale();
        global $failures;
        check('fresh .done kept', is_file($done));
        check('fresh .lock kept', is_file($lockf));

        // Age them past TTL: .done > 24h, .lock > 1h.
        touch($done, time() - 90000);
        touch($lockf, time() - 4000);
        $svc->sweepStale();
        check('stale .done removed', !is_file($done));
        check('stale .lock removed', !is_file($lockf));
    })();

    // ---- Task A4: finalize() assembles but does NOT clean parts ----
    (function () use ($svc) {
        $room = new Room('finaltok1');
        $uploadId = $svc->init($room, 'assemble.webm', 8);
        $svc->writeChunk($room, $uploadId, 0, 'AAAA');
        $svc->writeChunk($room, $uploadId, 1, 'BBBB');
        $file = $svc->finalize($room, $uploadId, 8);
        global $failures;
        check('finalize returns assembled bytes', @file_get_contents($file['tmp_name']) === 'AAAABBBB');
        check('finalize leaves parts dir intact', is_dir($svc->getRoot() . '/finaltok1/' . $uploadId));
        @unlink($file['tmp_name']);
    })();

    echo $failures === 0 ? "\nPASS\n" : "\n$failures FAILURE(S)\n";
    exit($failures === 0 ? 0 : 1);
}
