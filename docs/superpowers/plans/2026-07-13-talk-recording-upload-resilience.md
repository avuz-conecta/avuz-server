# Talk Recording Upload Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chunked recording uploads survive transient Cloudflare 504s (bot retry) without ever double-posting a recording (server-side idempotent finalize), and make the rare residual failure a one-command manual recovery.

**Architecture:** Two repos. The **avuz-server** spreed overlay makes chunk writes atomic and finalize idempotent (flock + a recording-keyed `.done` marker). The **talk-recording** bot wraps its three upload POSTs in bounded retry and gains a first-class `reupload` recovery CLI. Ship server first, then bot.

**Tech Stack:** PHP 8 (spreed overlay, no framework test harness → standalone PHP script test), Python 3.8 + `requests` (bot, pytest), bash (entrypoint sentinel).

## Global Constraints

- **Single app container precondition** — chunk parts, `.done`, and `.lock` live on the local `datadirectory`; assumes one NC app container per instance (or a shared chunk volume). Re-check before any horizontal scale.
- **Correctness invariant:** a recording is posted to a conversation **exactly once**, even under retry or manual reupload.
- **Chunk size stays 50 MB** (`CHUNK_SIZE = 50 * 1024 * 1024`). Do not change.
- **Ship order:** server (idempotent finalize) before bot (retry). The server change is backward-compatible with the current bot.
- **Sentinel lockstep:** bump `AVUZ-CHUNKED-UPLOAD-V1` → `AVUZ-CHUNKED-UPLOAD-V2` in the overlay AND the matching `docker/entrypoint.sh` check in the same commit.
- **Marker TTLs:** `.done` = 24 h (`86400`), `.lock` = 1 h (`3600`).
- **Retry policy:** 5 attempts; backoff `2,4,8,16,30 s`; retry only on `408/502/503/504` and connection/timeout errors; never on other `4xx`. Bot per-request timeouts: `init 30 s`, `chunk 120 s`, `finalize 120 s`.
- **No new Python dependencies** — stdlib + `requests` (already used). PHP: `declare(strict_types=1)`, match existing overlay style.
- **`flock` requires a local filesystem.** The `datadirectory` (where chunks/markers/locks live) is local disk on all clients, even S3-primary stacks. `flock` semantics are unreliable on NFS — re-check before ever moving `datadirectory` to a network fs.
- **Single-POST ceiling:** `SINGLE_POST_MAX = 100 * 1024 * 1024` (Cloudflare body cap). A recording larger than this can only be uploaded chunked; if chunked support can't be confirmed, the bot hard-fails rather than attempt a doomed single POST.
- **Parts cleanup happens only after a successful `store()`** so a store failure leaves the chunks intact for the bot's retry (never forces manual recovery).

## File Structure

**avuz-server (ship first):**
- `docker/overlays/spreed/lib/Service/RecordingChunkedUploadService.php` — atomic `writeChunk`; new `finalizeKey`/`donePath`/`lockPath`/`isFinalized`/`markFinalized`/`acquireFinalizeLock`/`releaseFinalizeLock`; extended `sweepStale`; new TTL constants.
- `docker/overlays/spreed/lib/Controller/RecordingController.php` — idempotent `storeChunkedFinalize` (new nullable `fileName` param, lock + short-circuit + marker); sentinel bump.
- `docker/overlays/spreed/tests/chunked-upload-test.php` — **new** standalone PHP harness (stubs + assertions), runnable with plain `php`.
- `docker/entrypoint.sh:77` — sentinel string `V1` → `V2`.

**talk-recording (ship second):**
- `src/nextcloud/talk/recording/BackendNotifier.py` — new `_postWithRetry`; wire it into `uploadRecordingChunked`; send `fileName` in finalize body; lower chunk timeout.
- `src/nextcloud/talk/recording/reupload.py` — **new** recovery CLI (`python3 -m nextcloud.talk.recording.reupload`).
- `tests/test_backendnotifier_retry.py` — **new** pytest.
- `tests/test_reupload.py` — **new** pytest.
- `AVUZ_FORK.md`, `CHANGELOG.md` — doc updates.

---

## Phase 1 — avuz-server overlay (ship first)

All Phase 1 commands run from `/Users/patrickrezende/work/avuz/avuz-server`.

### Task A1: Atomic chunk write + test harness

**Files:**
- Modify: `docker/overlays/spreed/lib/Service/RecordingChunkedUploadService.php` (`writeChunk`)
- Create: `docker/overlays/spreed/tests/chunked-upload-test.php`

**Interfaces:**
- Produces: `writeChunk(Room $room, string $uploadId, int $index, string $body): void` — now atomic (temp file + `rename`).
- Produces (harness): a runnable `php docker/overlays/spreed/tests/chunked-upload-test.php` that exits non-zero on any failed assertion.

- [ ] **Step 1: Write the failing test harness**

Create `docker/overlays/spreed/tests/chunked-upload-test.php`:

```php
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
```

Note: the harness calls `$svc->getRoot()` — expose it (Step 3).

- [ ] **Step 2: Run to verify it fails**

Run: `php docker/overlays/spreed/tests/chunked-upload-test.php`
Expected: FAIL — either a fatal (`getRoot()` is private) or `no leftover .tmp files` passes but the point is the harness doesn't yet exercise atomic write. Actually expect a fatal: `Call to private method ...getRoot()`.

- [ ] **Step 3: Make `getRoot` public and `writeChunk` atomic**

In `RecordingChunkedUploadService.php`, change `private function getRoot()` to `public function getRoot()`. Replace `writeChunk`:

```php
	public function writeChunk(Room $room, string $uploadId, int $index, string $body): void {
		if ($index < 0 || $index >= self::MAX_CHUNKS) {
			throw new InvalidArgumentException('chunk_index');
		}
		$dir = $this->getUploadDir($room->getToken(), $uploadId, create: false);
		$path = $dir . '/' . sprintf('%04d.part', $index);
		// Write to a unique temp then atomically rename: a retried chunk racing the
		// slow first write can never interleave into the final part, and finalize's
		// glob of *.part never sees a partial file.
		$tmp = $path . '.tmp.' . bin2hex(random_bytes(6));
		if (file_put_contents($tmp, $body) === false) {
			@unlink($tmp);
			throw new InvalidArgumentException('chunk_write');
		}
		if (!rename($tmp, $path)) {
			@unlink($tmp);
			throw new InvalidArgumentException('chunk_rename');
		}
	}
```

- [ ] **Step 4: Run to verify it passes**

Run: `php docker/overlays/spreed/tests/chunked-upload-test.php`
Expected: `ok - chunk overwrite keeps last write intact`, `ok - no leftover .tmp files`, `PASS`.

- [ ] **Step 5: Commit**

```bash
git add docker/overlays/spreed/lib/Service/RecordingChunkedUploadService.php docker/overlays/spreed/tests/chunked-upload-test.php
git commit -m "fix(overlay): atomic chunk write (temp+rename) + standalone test harness"
```

### Task A2: Finalize dedup key, marker, and lock helpers

**Files:**
- Modify: `docker/overlays/spreed/lib/Service/RecordingChunkedUploadService.php`
- Modify: `docker/overlays/spreed/tests/chunked-upload-test.php`

**Interfaces:**
- Produces:
  - `finalizeKey(Room $room, ?string $fileName, string $uploadId): string` — `sha256(token ':' fileName)`; if `$fileName` null/empty, read it from the upload's `.meta`.
  - `isFinalized(Room $room, string $key): bool`
  - `markFinalized(Room $room, string $key): void`
  - `acquireFinalizeLock(Room $room, string $key)` — returns a `resource` holding `LOCK_EX`.
  - `releaseFinalizeLock($handle): void`

- [ ] **Step 1: Add failing tests to the harness**

In `chunked-upload-test.php`, before the final `echo`, add:

```php
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `php docker/overlays/spreed/tests/chunked-upload-test.php`
Expected: FAIL — fatal `Call to undefined method ...finalizeKey()`.

- [ ] **Step 3: Implement the helpers**

In `RecordingChunkedUploadService.php`, add near the other private path helpers:

```php
	public function finalizeKey(Room $room, ?string $fileName, string $uploadId): string {
		if ($fileName === null || $fileName === '') {
			$dir = $this->getUploadDir($room->getToken(), $uploadId, create: false);
			$meta = json_decode((string)@file_get_contents($dir . '/.meta'), true);
			$fileName = is_array($meta) ? (string)($meta['fileName'] ?? '') : '';
			if ($fileName === '') {
				throw new InvalidArgumentException('filename_unknown');
			}
		}
		return hash('sha256', $room->getToken() . ':' . $fileName);
	}

	private function markerPath(string $token, string $key, string $ext): string {
		if (!preg_match('/^[a-z0-9]{4,30}$/', $token) || !preg_match('/^[a-f0-9]{64}$/', $key)) {
			throw new InvalidArgumentException('marker_id');
		}
		$tokenDir = $this->getRoot() . '/' . $token;
		if (!is_dir($tokenDir) && !mkdir($tokenDir, 0770, true) && !is_dir($tokenDir)) {
			throw new InvalidArgumentException('mkdir');
		}
		return $tokenDir . '/' . $key . '.' . $ext;
	}

	public function isFinalized(Room $room, string $key): bool {
		return is_file($this->markerPath($room->getToken(), $key, 'done'));
	}

	public function markFinalized(Room $room, string $key): void {
		$path = $this->markerPath($room->getToken(), $key, 'done');
		file_put_contents($path, json_encode(['finalizedAt' => time()]));
	}

	/**
	 * @return resource an open handle holding LOCK_EX; pass to releaseFinalizeLock().
	 */
	public function acquireFinalizeLock(Room $room, string $key) {
		$path = $this->markerPath($room->getToken(), $key, 'lock');
		$handle = fopen($path, 'c');
		if ($handle === false || !flock($handle, LOCK_EX)) {
			throw new InvalidArgumentException('lock');
		}
		return $handle;
	}

	public function releaseFinalizeLock($handle): void {
		if (is_resource($handle)) {
			flock($handle, LOCK_UN);
			fclose($handle);
		}
	}
```

- [ ] **Step 4: Run to verify it passes**

Run: `php docker/overlays/spreed/tests/chunked-upload-test.php`
Expected: all new `ok` lines, `PASS`.

- [ ] **Step 5: Commit**

```bash
git add docker/overlays/spreed/lib/Service/RecordingChunkedUploadService.php docker/overlays/spreed/tests/chunked-upload-test.php
git commit -m "feat(overlay): recording-keyed finalize dedup marker + flock helpers"
```

### Task A3: Extend sweepStale to GC markers and locks

**Files:**
- Modify: `docker/overlays/spreed/lib/Service/RecordingChunkedUploadService.php` (`sweepStale`, constants)
- Modify: `docker/overlays/spreed/tests/chunked-upload-test.php`

**Interfaces:**
- Consumes: `markFinalized`, `acquireFinalizeLock` (Task A2).
- Produces: `sweepStale()` also unlinks `*.done` older than 24 h and `*.lock` older than 1 h.

- [ ] **Step 1: Add failing test**

Append before the final `echo`:

```php
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `php docker/overlays/spreed/tests/chunked-upload-test.php`
Expected: FAIL — `stale .done removed` / `stale .lock removed` FAIL (current `sweepStale` ignores marker/lock files).

- [ ] **Step 3: Add TTL constants and extend sweepStale**

Add constants next to `CHUNK_TTL_SECONDS`:

```php
	private const DONE_TTL_SECONDS = 86400; // 24h dedup window
	private const LOCK_TTL_SECONDS = 3600;  // 1h; a finalize never runs this long
```

In `sweepStale()`, inside the `foreach (... $tokenDir ...)` loop, after the inner upload-dir loop, add marker/lock GC:

```php
			$now2 = time();
			foreach (glob($tokenDir . '/*.done') ?: [] as $doneFile) {
				if (($now2 - (int)@filemtime($doneFile)) > self::DONE_TTL_SECONDS) {
					@unlink($doneFile);
				}
			}
			foreach (glob($tokenDir . '/*.lock') ?: [] as $lockFile) {
				if (($now2 - (int)@filemtime($lockFile)) > self::LOCK_TTL_SECONDS) {
					@unlink($lockFile);
				}
			}
```

- [ ] **Step 4: Run to verify it passes**

Run: `php docker/overlays/spreed/tests/chunked-upload-test.php`
Expected: all `ok`, `PASS`.

- [ ] **Step 5: Commit**

```bash
git add docker/overlays/spreed/lib/Service/RecordingChunkedUploadService.php docker/overlays/spreed/tests/chunked-upload-test.php
git commit -m "feat(overlay): sweepStale GCs .done (24h) and .lock (1h) markers"
```

### Task A4: `finalize()` stops cleaning parts; controller cleans after store

**Files:**
- Modify: `docker/overlays/spreed/lib/Service/RecordingChunkedUploadService.php` (`finalize` — remove internal `cleanup()`)
- Modify: `docker/overlays/spreed/lib/Controller/RecordingController.php` (`storeChunkedFinalize`, lines 563-587)
- Modify: `docker/overlays/spreed/tests/chunked-upload-test.php`

**Interfaces:**
- Consumes: `finalizeKey`, `isFinalized`, `markFinalized`, `acquireFinalizeLock`, `releaseFinalizeLock` (A2), `finalize`, `cleanup` (existing).
- Produces: `finalize()` no longer deletes parts (assembly only); the controller deletes parts **only after** a successful `store()` + `markFinalized()`. The endpoint accepts an optional `fileName`; a repeat finalize for the same `token+fileName` returns 200 without re-storing.

The controller needs the full NC runtime, so its idempotency dance is verified by staging e2e (Task A6). The service change (finalize leaves parts) is covered by the harness.

- [ ] **Step 1: Add failing harness test — finalize must leave parts intact**

Append to `chunked-upload-test.php` before the final `echo`:

```php
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `php docker/overlays/spreed/tests/chunked-upload-test.php`
Expected: FAIL — `finalize leaves parts dir intact` FAILs (current `finalize` calls `cleanup()` and deletes the dir).

- [ ] **Step 3: Remove `cleanup()` from `finalize()`**

In `RecordingChunkedUploadService.php`, in `finalize()`, delete the line:

```php
		$this->cleanup($room->getToken(), $uploadId);
```

(`finalize` now only assembles + validates size + returns the tmp array. `cleanup()` itself is unchanged and stays public.)

- [ ] **Step 4: Run to verify the harness passes**

Run: `php docker/overlays/spreed/tests/chunked-upload-test.php`
Expected: all `ok`, `PASS`.

- [ ] **Step 5: Rewrite `storeChunkedFinalize`**

Replace the method body (keep the attributes/docblock above it) so it takes a nullable `$fileName`, wraps assemble+store in lock + short-circuit + marker, and cleans parts **only after** store+mark succeed:

```php
	public function storeChunkedFinalize(string $uploadId, ?string $owner, ?int $actualSize = null, ?string $fileName = null): DataResponse {
		$sigData = $this->room->getToken() . ':' . $uploadId . ':finalize';
		if (!$this->validateBackendRequest($sigData)) {
			$response = new DataResponse([
				'type' => 'error',
				'error' => ['code' => 'invalid_request', 'message' => 'The request could not be authenticated.'],
			], Http::STATUS_UNAUTHORIZED);
			$response->throttle(['action' => 'talkRecordingSecret']);
			return $response;
		}
		if ($owner === null) {
			return new DataResponse(['error' => 'owner'], Http::STATUS_BAD_REQUEST);
		}

		$lock = null;
		$file = null;
		try {
			$key = $this->chunkedService->finalizeKey($this->room, $fileName, $uploadId);
			$lock = $this->chunkedService->acquireFinalizeLock($this->room, $key);
			// Already stored for this recording (retry or manual reupload) — no re-post.
			if ($this->chunkedService->isFinalized($this->room, $key)) {
				return new DataResponse(null);
			}
			$file = $this->chunkedService->finalize($this->room, $uploadId, $actualSize);
			$this->recordingService->store($this->getRoom(), $owner, $file);
			// Marker first (dedup), then drop the parts — both only after store() succeeds,
			// so a store() failure leaves the chunks intact for the bot's retry.
			$this->chunkedService->markFinalized($this->room, $key);
			$this->chunkedService->cleanup($this->room->getToken(), $uploadId);
		} catch (InvalidArgumentException $e) {
			return new DataResponse(['error' => $e->getMessage()], Http::STATUS_BAD_REQUEST);
		} finally {
			if (isset($file['tmp_name']) && is_file($file['tmp_name'])) {
				@unlink($file['tmp_name']);
			}
			if ($lock !== null) {
				$this->chunkedService->releaseFinalizeLock($lock);
			}
		}
		return new DataResponse(null);
	}
```

Add a `@param ?string $fileName` line to the docblock; no route/attribute change is needed (the JSON body is decoded into named params by the dispatcher).

- [ ] **Step 6: Lint + run harness**

Run: `php -l docker/overlays/spreed/lib/Controller/RecordingController.php && php docker/overlays/spreed/tests/chunked-upload-test.php`
Expected: `No syntax errors detected` then `PASS`.

- [ ] **Step 7: Commit**

```bash
git add docker/overlays/spreed/lib/Service/RecordingChunkedUploadService.php docker/overlays/spreed/lib/Controller/RecordingController.php docker/overlays/spreed/tests/chunked-upload-test.php
git commit -m "feat(overlay): idempotent finalize; clean parts only after successful store"
```

### Task A5: Bump overlay sentinel V1 → V2 (lockstep with entrypoint)

**Files:**
- Modify: `docker/overlays/spreed/lib/Controller/RecordingController.php` (sentinel comment, line ~48)
- Modify: `docker/entrypoint.sh:77`

**Interfaces:**
- Produces: overlay + entrypoint both reference `AVUZ-CHUNKED-UPLOAD-V2`.

- [ ] **Step 1: Bump the overlay sentinel**

In `RecordingController.php`, change the sentinel comment:

```php
// AVUZ-CHUNKED-UPLOAD-V2 — do not remove; entrypoint integrity check matches this string
```

- [ ] **Step 2: Bump the entrypoint check**

In `docker/entrypoint.sh:77`, change `AVUZ-CHUNKED-UPLOAD-V1` to `AVUZ-CHUNKED-UPLOAD-V2` in the sentinel entry string.

- [ ] **Step 3: Verify lockstep**

Run: `grep -rn 'AVUZ-CHUNKED-UPLOAD-V' docker/overlays docker/entrypoint.sh`
Expected: both hits show `V2`, none show `V1`.

- [ ] **Step 4: Commit**

```bash
git add docker/overlays/spreed/lib/Controller/RecordingController.php docker/entrypoint.sh
git commit -m "chore(overlay): bump chunked-upload sentinel V1->V2 (idempotent finalize)"
```

### Task A6: Build, deploy to staging, verify idempotency e2e

**Files:** none (validation).

- [ ] **Step 1: Build + push staging image**

Run: `./scripts/build-push.sh latest staging`
Expected: build succeeds, image pushed.

- [ ] **Step 2: Deploy to a staging stack and confirm the sentinel**

Run (on the staging host, NC container `<nc>`):
`docker exec -u www-data <nc> grep -l AVUZ-CHUNKED-UPLOAD-V2 /var/www/html/apps/spreed/lib/Controller/RecordingController.php`
Expected: the path prints (V2 overlay is live).

- [ ] **Step 3: Record a real call → single recording + transcript**

Record a short Talk call. Expected: exactly one recording message in the conversation; transcript task completes (worker + 3072M from commit `5bba33f65aa`).

- [ ] **Step 4: Prove finalize idempotency**

With a leftover `/tmp` recording on the bot, run the same `uploadRecording` twice (second is the retry simulation). Expected: still exactly **one** recording message; the second finalize returns HTTP 200 (short-circuit). Confirm via the conversation and `docker exec ... ls data/avuz-recording-chunks/<token>/` showing a `<key>.done` marker.

---

## Phase 2 — talk-recording bot (ship second)

All Phase 2 commands run from `/Users/patrickrezende/work/avuz/talk-recording`.

### Task B1: `_postWithRetry` helper

**Files:**
- Modify: `src/nextcloud/talk/recording/BackendNotifier.py`
- Create: `tests/test_backendnotifier_retry.py`

**Interfaces:**
- Produces: `_postWithRetry(url, *, headers, verify, timeout, attempts=5, **kwargs) -> requests.Response` — retries on `408/502/503/504` and `ConnectionError`/`Timeout`; raises on other `4xx`/`5xx`; exponential backoff.

- [ ] **Step 1: Write the failing test**

Create `tests/test_backendnotifier_retry.py`:

```python
import requests
from nextcloud.talk.recording import BackendNotifier


class FakeResp:
    def __init__(self, status):
        self.status_code = status
        self.text = ""

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code}", response=self)


def _patch_post(monkeypatch, sequence):
    calls = {"n": 0}

    def fake_post(url, **kwargs):
        i = calls["n"]
        calls["n"] += 1
        item = sequence[i]
        if isinstance(item, Exception):
            raise item
        return FakeResp(item)

    monkeypatch.setattr(BackendNotifier.requests, "post", fake_post, raising=False)
    monkeypatch.setattr(BackendNotifier.time, "sleep", lambda *_: None)
    return calls


def test_retries_504_then_succeeds(monkeypatch):
    calls = _patch_post(monkeypatch, [504, 504, 200])
    r = BackendNotifier._postWithRetry("http://x", headers={}, verify=True, timeout=5)
    assert r.status_code == 200
    assert calls["n"] == 3


def test_does_not_retry_400(monkeypatch):
    calls = _patch_post(monkeypatch, [400, 200])
    try:
        BackendNotifier._postWithRetry("http://x", headers={}, verify=True, timeout=5)
        assert False, "expected HTTPError"
    except requests.HTTPError:
        pass
    assert calls["n"] == 1


def test_retries_connection_error(monkeypatch):
    calls = _patch_post(monkeypatch, [requests.ConnectionError(), 200])
    r = BackendNotifier._postWithRetry("http://x", headers={}, verify=True, timeout=5)
    assert r.status_code == 200
    assert calls["n"] == 2
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_backendnotifier_retry.py -v`
Expected: FAIL — `AttributeError: module ... has no attribute '_postWithRetry'`.

- [ ] **Step 3: Implement `_postWithRetry`**

In `BackendNotifier.py`, ensure `import time` is present at the top (add if missing), then add above `uploadRecordingChunked`:

```python
_RETRYABLE_STATUS = {408, 502, 503, 504}
_RETRY_BACKOFF = [2, 4, 8, 16, 30]


def _postWithRetry(url, *, headers, verify, timeout, attempts=5, **kwargs):
    """POST with bounded retry on transient failures (CF 504s, conn drops).

    Retries only on 408/502/503/504 and connection/timeout errors; any other
    4xx/5xx raises immediately. Chunk writes and idempotent finalize make a
    retried POST safe to repeat.
    """
    import requests
    last = None
    for i in range(attempts):
        try:
            r = requests.post(url, headers=headers, verify=verify, timeout=timeout, **kwargs)
            if r.status_code in _RETRYABLE_STATUS:
                last = requests.HTTPError(f"HTTP {r.status_code}", response=r)
            else:
                r.raise_for_status()
                return r
        except (requests.ConnectionError, requests.Timeout) as e:
            last = e
        if i < attempts - 1:
            time.sleep(_RETRY_BACKOFF[min(i, len(_RETRY_BACKOFF) - 1)])
    if last is not None:
        raise last
    raise RuntimeError("retry exhausted")
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest tests/test_backendnotifier_retry.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/nextcloud/talk/recording/BackendNotifier.py tests/test_backendnotifier_retry.py
git commit -m "feat: bounded retry helper for chunked upload POSTs"
```

### Task B2: Wire retry into uploadRecordingChunked + send fileName

**Files:**
- Modify: `src/nextcloud/talk/recording/BackendNotifier.py` (`uploadRecordingChunked`)
- Modify: `tests/test_backendnotifier_retry.py`

**Interfaces:**
- Consumes: `_postWithRetry` (B1).
- Produces: `uploadRecordingChunked` retries all three POSTs; finalize body includes `fileName`; chunk timeout is 120 s.

- [ ] **Step 1: Add failing integration test**

Append to `tests/test_backendnotifier_retry.py`:

```python
class _InitResp(FakeResp):
    def json(self):
        return {"ocs": {"data": {"uploadId": "a" * 32}}}


def test_chunked_upload_retries_chunk_and_sends_filename(monkeypatch, tmp_path):
    # 10-byte file < 50 MB CHUNK_SIZE => exactly one chunk. Response order:
    # init(200), chunk attempt1(504 -> retry), chunk attempt2(200), finalize(200).
    src = tmp_path / "rec.webm"
    src.write_bytes(b"x" * 10)

    seen = {"finalize_json": None}
    seq = iter([200, 504, 200, 200])

    def fake_post(url, **kwargs):
        code = next(seq)
        if url.endswith("/init"):
            return _InitResp(code)
        if url.endswith("/finalize"):
            seen["finalize_json"] = kwargs.get("json")
        return FakeResp(code)

    monkeypatch.setattr(BackendNotifier.requests, "post", fake_post, raising=False)
    monkeypatch.setattr(BackendNotifier.time, "sleep", lambda *_: None)

    BackendNotifier.uploadRecordingChunked(
        backend="http://x/", secret=b"s", skipVerify=True,
        token="tok12345", fileName="rec.webm", filePath=str(src), owner="u",
    )
    assert seen["finalize_json"]["fileName"] == "rec.webm"
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_backendnotifier_retry.py::test_chunked_upload_retries_chunk_and_sends_filename -v`
Expected: FAIL — finalize body has no `fileName` (KeyError) and/or the raw `requests.post` path isn't retried.

- [ ] **Step 3: Rewrite the three POSTs to use `_postWithRetry`**

In `uploadRecordingChunked`, replace the `init`, chunk, and `fin` blocks so each goes through `_postWithRetry`, the chunk timeout is `120`, and the finalize body carries `fileName`:

```python
    init = _postWithRetry(
        base + "/init",
        headers={**common, **_sign(secret, token)},
        json={"fileName": fileName, "totalSize": size},
        verify=not skipVerify,
        timeout=30,
    )
    upload_id = init.json()["ocs"]["data"]["uploadId"]

    actualSize = 0
    with open(filePath, "rb") as fh:
        index = 0
        while True:
            buf = fh.read(CHUNK_SIZE)
            if not buf:
                break
            chunk_headers = {**common, **_sign(secret, f"{token}:{upload_id}:{index}")}
            chunk_headers["Content-Type"] = "application/octet-stream"
            _postWithRetry(
                f"{base}/{upload_id}/{index}",
                headers=chunk_headers,
                data=buf,
                verify=not skipVerify,
                timeout=120,
            )
            actualSize += len(buf)
            index += 1

    try:
        _postWithRetry(
            f"{base}/{upload_id}/finalize",
            headers={**common, **_sign(secret, f"{token}:{upload_id}:finalize")},
            json={"owner": owner, "actualSize": actualSize, "fileName": fileName},
            verify=not skipVerify,
            timeout=120,
        )
    except Exception as e:
        logger.error("Chunked finalize failed after retries: token=%s upload_id=%s: %s",
                     token, upload_id, e)
        print(f"CHUNKED_FINALIZE_FAIL token={token} upload_id={upload_id} err={e}", flush=True)
        raise
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest tests/test_backendnotifier_retry.py -v`
Expected: all passed (including the new test asserting `fileName` in finalize body).

- [ ] **Step 5: Commit**

```bash
git add src/nextcloud/talk/recording/BackendNotifier.py tests/test_backendnotifier_retry.py
git commit -m "feat: retry chunked upload POSTs, send fileName in finalize, bound chunk timeout"
```

### Task B3: Resilient capabilities fetch + no-downgrade guard

**Files:**
- Modify: `src/nextcloud/talk/recording/BackendNotifier.py` (`SINGLE_POST_MAX`, `_getWithRetry`, `_fetchCapabilities`, `uploadRecording`)
- Modify: `tests/test_backendnotifier_retry.py`

**Interfaces:**
- Consumes: `_RETRYABLE_STATUS`, `_RETRY_BACKOFF`, `time`, `FakeResp` (B1).
- Produces: `_getWithRetry(url, *, headers, verify, timeout, attempts=5) -> requests.Response`; `_fetchCapabilities` retries and propagates a hard failure instead of silently returning empty; `uploadRecording` raises for `size > SINGLE_POST_MAX` when chunked upload can't be confirmed — never attempts a doomed single POST.

Why: `uploadRecording` chooses chunked-vs-single from a `/capabilities` GET. That GET was unretried and `_fetchCapabilities` swallowed *any* error to an empty set → a transient CF 504 there silently downgraded a >100 MB recording to a single POST → CF 413 → lost.

- [ ] **Step 1: Add failing tests**

Append to `tests/test_backendnotifier_retry.py`:

```python
def test_get_with_retry_retries_504(monkeypatch):
    seq = iter([504, 200])
    monkeypatch.setattr(BackendNotifier.requests, "get",
                        lambda url, **kw: FakeResp(next(seq)), raising=False)
    monkeypatch.setattr(BackendNotifier.time, "sleep", lambda *_: None)
    r = BackendNotifier._getWithRetry("http://x", headers={}, verify=True, timeout=5)
    assert r.status_code == 200


def test_uploadRecording_hardfails_when_caps_unreachable_and_file_big(monkeypatch, tmp_path):
    f = tmp_path / "big.webm"
    f.write_bytes(b"x" * 10)
    monkeypatch.setattr(BackendNotifier, "SINGLE_POST_MAX", 5)
    monkeypatch.setattr(BackendNotifier.config, "getBackendSkipVerify", lambda b: True, raising=False)
    monkeypatch.setattr(BackendNotifier.requests, "get", lambda url, **kw: FakeResp(504), raising=False)
    monkeypatch.setattr(BackendNotifier.time, "sleep", lambda *_: None)
    reached = {"single": False, "chunked": False}
    monkeypatch.setattr(BackendNotifier, "uploadRecordingChunked",
                        lambda **kw: reached.update(chunked=True), raising=False)
    monkeypatch.setattr(BackendNotifier, "doRequest",
                        lambda *a, **k: reached.update(single=True), raising=False)
    try:
        BackendNotifier.uploadRecording("http://x/", "tok12345", str(f), "u")
        assert False, "expected hard fail"
    except RuntimeError:
        pass
    assert reached["single"] is False and reached["chunked"] is False


def test_uploadRecording_uses_chunked_when_capability_present(monkeypatch, tmp_path):
    f = tmp_path / "big.webm"
    f.write_bytes(b"x" * 10)
    monkeypatch.setattr(BackendNotifier, "CHUNK_SIZE", 4)
    monkeypatch.setattr(BackendNotifier.config, "getBackendSkipVerify", lambda b: True, raising=False)
    monkeypatch.setattr(BackendNotifier.config, "getBackendSecret", lambda b: "sekret", raising=False)

    class CapsResp(FakeResp):
        def json(self):
            return {"ocs": {"data": {"capabilities": {"spreed": {"features": ["recording-chunked-v1"]}}}}}

    monkeypatch.setattr(BackendNotifier.requests, "get", lambda url, **kw: CapsResp(200), raising=False)
    called = {"chunked": False}
    monkeypatch.setattr(BackendNotifier, "uploadRecordingChunked",
                        lambda **kw: called.update(chunked=True), raising=False)
    BackendNotifier.uploadRecording("http://x/", "tok12345", str(f), "u")
    assert called["chunked"] is True
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_backendnotifier_retry.py -k "caps or capability or get_with_retry" -v`
Expected: FAIL — `_getWithRetry` undefined; hard-fail test does not raise (current code downgrades to single POST).

- [ ] **Step 3: Implement**

In `BackendNotifier.py`, add next to `CHUNK_SIZE`:

```python
SINGLE_POST_MAX = 100 * 1024 * 1024  # Cloudflare request-body cap; above this, only chunked works
```

Add `_getWithRetry` (next to `_postWithRetry`):

```python
def _getWithRetry(url, *, headers, verify, timeout, attempts=5):
    """GET with the same bounded-retry policy as _postWithRetry."""
    import requests
    last = None
    for i in range(attempts):
        try:
            r = requests.get(url, headers=headers, verify=verify, timeout=timeout)
            if r.status_code in _RETRYABLE_STATUS:
                last = requests.HTTPError(f"HTTP {r.status_code}", response=r)
            else:
                r.raise_for_status()
                return r
        except (requests.ConnectionError, requests.Timeout) as e:
            last = e
        if i < attempts - 1:
            time.sleep(_RETRY_BACKOFF[min(i, len(_RETRY_BACKOFF) - 1)])
    if last is not None:
        raise last
    raise RuntimeError("retry exhausted")
```

Replace `_fetchCapabilities` so it retries and only swallows a *malformed* (but reachable) response, letting a hard network failure propagate:

```python
def _fetchCapabilities(backend: str, skipVerify: bool) -> set:
    """Return spreed feature flags. Retries transient failures; raises if the
    endpoint stays unreachable (caller decides whether that's fatal)."""
    r = _getWithRetry(
        backend.rstrip("/") + "/ocs/v2.php/cloud/capabilities",
        headers={"OCS-APIRequest": "true", "Accept": "application/json"},
        verify=not skipVerify,
        timeout=15,
    )
    try:
        return set(r.json()["ocs"]["data"]["capabilities"]["spreed"]["features"])
    except (ValueError, KeyError, TypeError):
        return set()
```

In `uploadRecording`, replace the caps/decision block (from `backendSkipVerify = ...` down to the end of the `if "recording-chunked-v1" in caps ...` block) with:

```python
    backendSkipVerify = config.getBackendSkipVerify(backend)
    size = os.path.getsize(fileName)
    try:
        caps = _fetchCapabilities(backend, backendSkipVerify)
    except Exception as e:
        logger.warning("Capabilities fetch failed after retries: %s", e)
        caps = None
    chunkedOk = caps is not None and "recording-chunked-v1" in caps

    if chunkedOk and size > CHUNK_SIZE:
        secret = config.getBackendSecret(backend).encode()
        return uploadRecordingChunked(
            backend=backend,
            secret=secret,
            skipVerify=backendSkipVerify,
            token=token,
            fileName=os.path.basename(fileName),
            filePath=fileName,
            owner=owner,
        )

    if size > SINGLE_POST_MAX:
        # Too big for a single multipart POST (Cloudflare 100 MB cap) and chunked
        # upload could not be confirmed. Fail loudly — the /tmp recording is kept
        # for `reupload` once the server/caps are reachable again.
        raise RuntimeError(
            f"cannot upload {size} B recording: chunked upload unavailable and file "
            f"exceeds the single-POST limit ({SINGLE_POST_MAX} B)"
        )
```

(The single-multipart POST code below it stays unchanged.)

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest tests/test_backendnotifier_retry.py -v`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add src/nextcloud/talk/recording/BackendNotifier.py tests/test_backendnotifier_retry.py
git commit -m "fix: retry capabilities GET, hard-fail big files when chunked upload unconfirmed"
```

### Task B4: `reupload` recovery CLI

**Files:**
- Create: `src/nextcloud/talk/recording/reupload.py`
- Create: `tests/test_reupload.py`

**Interfaces:**
- Consumes: `Config.config`, `BackendNotifier.uploadRecording`.
- Produces: `main(argv=None) -> int`; `_discover(token, base="/tmp") -> str|None`; runnable as `python3 -m nextcloud.talk.recording.reupload`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_reupload.py`:

```python
from nextcloud.talk.recording import reupload


def test_discover_finds_webm(tmp_path):
    d = tmp_path / "httpsx" / "tok12345"
    d.mkdir(parents=True)
    f = d / "rec.webm"
    f.write_bytes(b"x")
    assert reupload._discover("tok12345", base=str(tmp_path)) == str(f)


def test_discover_missing_returns_none(tmp_path):
    assert reupload._discover("nope1234", base=str(tmp_path)) is None


def test_main_invokes_upload(monkeypatch, tmp_path):
    f = tmp_path / "rec.webm"
    f.write_bytes(b"x")
    called = {}
    monkeypatch.setattr(reupload.config, "load", lambda p: called.setdefault("cfg", p))
    monkeypatch.setattr(reupload, "uploadRecording",
                        lambda b, t, fp, o: called.update(backend=b, token=t, file=fp, owner=o))
    rc = reupload.main([
        "--backend", "http://x/", "--token", "tok12345",
        "--owner", "u", "--file", str(f), "--config", "/tmp/server.conf",
    ])
    assert rc == 0
    assert called["file"] == str(f)
    assert called["cfg"] == "/tmp/server.conf"


def test_main_missing_file_returns_2(monkeypatch):
    monkeypatch.setattr(reupload.config, "load", lambda p: None)
    rc = reupload.main(["--backend", "http://x/", "--token", "tok12345", "--owner", "u"])
    assert rc == 2
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_reupload.py -v`
Expected: FAIL — `ModuleNotFoundError: ...reupload`.

- [ ] **Step 3: Implement the CLI**

Create `src/nextcloud/talk/recording/reupload.py`:

```python
#
# SPDX-License-Identifier: AGPL-3.0-or-later
#
"""Manual recovery: re-upload a recording that failed to post.

Safe to re-run within the server's 24h dedup window — idempotent finalize
prevents a double-post.

    python3 -m nextcloud.talk.recording.reupload \\
        --backend https://<domain>/ --token <token> --owner <uid> [--file <path>]
"""
import argparse
import glob
import os
import sys

from .Config import config
from .BackendNotifier import uploadRecording


def _discover(token, base="/tmp"):
    matches = sorted(glob.glob(f"{base}/*/{token}/*.webm"), key=os.path.getmtime)
    return matches[-1] if matches else None


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python3 -m nextcloud.talk.recording.reupload")
    parser.add_argument("--backend", required=True, help="NC base URL, e.g. https://vidalar.avuz.app/")
    parser.add_argument("--token", required=True, help="conversation token")
    parser.add_argument("--owner", required=True, help="recording owner uid")
    parser.add_argument("--file", help="recording path (auto-discovered under /tmp if omitted)")
    parser.add_argument("--config", default="/etc/nextcloud-talk-recording/server.conf")
    args = parser.parse_args(argv)

    config.load(args.config)
    filePath = args.file or _discover(args.token)
    if not filePath or not os.path.isfile(filePath):
        print(f"recording file not found for token {args.token}", file=sys.stderr)
        return 2

    print(f"Re-uploading {filePath} to {args.backend} ({args.token}) as {args.owner}")
    uploadRecording(args.backend, args.token, filePath, args.owner)
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest tests/test_reupload.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/nextcloud/talk/recording/reupload.py tests/test_reupload.py
git commit -m "feat: reupload recovery CLI (idempotent-safe manual re-dispatch)"
```

### Task B5: Docs + full test run

**Files:**
- Modify: `AVUZ_FORK.md`, `CHANGELOG.md`

- [ ] **Step 1: Document the patches**

In `AVUZ_FORK.md` under "Patches applied", add:

```markdown
- `BackendNotifier`: bounded retry (`_postWithRetry`) on all chunked-upload POSTs
  (transient CF 504s); finalize sends `fileName` so the server dedups per recording.
- `reupload` CLI: `python3 -m nextcloud.talk.recording.reupload --backend <url>
  --token <token> --owner <uid> [--file <path>]` — manual recovery; safe to re-run
  within the server's 24h dedup window.
```

Add a matching `CHANGELOG.md` entry under the fork's section.

- [ ] **Step 2: Run the whole bot test suite**

Run: `python -m pytest tests/ -v`
Expected: all tests pass (new retry + reupload tests plus any pre-existing).

- [ ] **Step 3: Commit**

```bash
git add AVUZ_FORK.md CHANGELOG.md
git commit -m "docs: document upload retry + reupload recovery CLI"
```

### Task B6: Build, deploy bot, e2e acceptance

**Files:** none (validation).

- [ ] **Step 1: Build + push the bot image**

Run the bot's build/push (per its `scripts/`) to `registry.avuz.app/admin/talk-recording`, then update the recording stack (`portainer-recording-stack.yml`).

- [ ] **Step 2: Acceptance — record + recover**

- Record a real Talk call → exactly one recording message + transcript.
- On a leftover `/tmp` recording, run `python3 -m nextcloud.talk.recording.reupload --backend https://<domain>/ --token <token> --owner <uid>` → still exactly one recording (idempotency proven end-to-end); a second run of the same command also stays single.

---

## Self-Review

- **Spec coverage:** atomic write (A1) ✓; recording-keyed dedup marker + lock (A2, A4) ✓; sweepStale TTL GC (A3) ✓; cleanup-after-store so store failures stay auto-retryable (A4) ✓; single-container + local-fs `flock` precondition (Global Constraints) ✓; sentinel V2 lockstep (A5) ✓; bot retry policy + bounded timeouts (B1, B2) ✓; resilient caps GET + no-downgrade hard-fail for >100 MB (B3) ✓; fileName in finalize (B2, A4) ✓; reupload CLI + manual-recovery-first (B4) ✓; standalone PHP test + bot pytest + staging e2e (A1-A4, A6, B1-B4, B6) ✓.
- **Interfaces:** `finalizeKey(Room, ?string, string)`, `isFinalized`, `markFinalized`, `acquireFinalizeLock`/`releaseFinalizeLock`, `cleanup(token, uploadId)` used identically in A2/A4; `_postWithRetry`/`_getWithRetry` share `_RETRYABLE_STATUS`/`_RETRY_BACKOFF` (B1/B3); `SINGLE_POST_MAX` defined B3, used B3; `_discover(token, base)` and `main(argv)` identical in B4. Consistent.
- **Ship order:** server (A) accepts the current bot (fileName null → meta fallback) so Phase 1 can deploy before Phase 2.
- **Grill fixes folded:** F1 (caps retry + hard-fail, B3), F2 (cleanup after store, A4), F4 (token-dir survival — moot once cleanup follows store), F5 (local-fs `flock` precondition). F3 accepted staging-only (controller dance needs full NC to test meaningfully).
