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

### Task A4: Idempotent storeChunkedFinalize (controller)

**Files:**
- Modify: `docker/overlays/spreed/lib/Controller/RecordingController.php` (`storeChunkedFinalize`, lines 563-587)

**Interfaces:**
- Consumes: `finalizeKey`, `isFinalized`, `markFinalized`, `acquireFinalizeLock`, `releaseFinalizeLock` (A2), `finalize` (existing).
- Produces: endpoint accepts an optional `fileName` field; a repeated finalize for the same `token+fileName` returns 200 without re-storing.

There is no local controller harness (needs full NC); this task is verified by staging e2e (Task A6). Change carefully.

- [ ] **Step 1: Rewrite `storeChunkedFinalize`**

Replace the method body (keep the attributes/docblock above it) so it takes a nullable `$fileName` and wraps assemble+store in lock + short-circuit + marker:

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
			// Write the dedup marker as the very next op after a successful store.
			$this->chunkedService->markFinalized($this->room, $key);
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

Also add a `@param ?string $fileName` line to the docblock and a matching request-body note; no route/attribute change is needed (the body is JSON-decoded into named params by the dispatcher).

- [ ] **Step 2: Lint the PHP**

Run: `php -l docker/overlays/spreed/lib/Controller/RecordingController.php`
Expected: `No syntax errors detected`.

- [ ] **Step 3: Commit**

```bash
git add docker/overlays/spreed/lib/Controller/RecordingController.php
git commit -m "feat(overlay): idempotent storeChunkedFinalize (lock + dedup marker)"
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

### Task B3: `reupload` recovery CLI

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

### Task B4: Docs + full test run

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

### Task B5: Build, deploy bot, e2e acceptance

**Files:** none (validation).

- [ ] **Step 1: Build + push the bot image**

Run the bot's build/push (per its `scripts/`) to `registry.avuz.app/admin/talk-recording`, then update the recording stack (`portainer-recording-stack.yml`).

- [ ] **Step 2: Acceptance — record + recover**

- Record a real Talk call → exactly one recording message + transcript.
- On a leftover `/tmp` recording, run `python3 -m nextcloud.talk.recording.reupload --backend https://<domain>/ --token <token> --owner <uid>` → still exactly one recording (idempotency proven end-to-end); a second run of the same command also stays single.

---

## Self-Review

- **Spec coverage:** atomic write (A1) ✓; recording-keyed dedup marker + lock (A2, A4) ✓; sweepStale TTL GC (A3) ✓; single-container precondition (Global Constraints) ✓; sentinel V2 lockstep (A5) ✓; bot retry policy + bounded timeouts (B1, B2) ✓; fileName in finalize (B2, A4) ✓; reupload CLI + manual-recovery-first (B3) ✓; standalone PHP test + bot pytest + staging e2e (A1-A3, A6, B1-B3, B5) ✓.
- **Interfaces:** `finalizeKey(Room, ?string, string)`, `isFinalized`, `markFinalized`, `acquireFinalizeLock`/`releaseFinalizeLock` used identically in A2/A4; `_postWithRetry` signature identical in B1/B2; `_discover(token, base)` and `main(argv)` identical in B3. Consistent.
- **Ship order:** server (A) accepts the current bot (fileName null → meta fallback) so Phase 1 can deploy before Phase 2.
