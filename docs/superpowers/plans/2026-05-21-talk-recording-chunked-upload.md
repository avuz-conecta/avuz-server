# Talk Recording Chunked Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add chunked upload to the Talk recording upload pipeline so recordings >100 MB succeed through Cloudflare (free plan, 100 MB body cap). Patch happens entirely in the Avuz fork — spreed PHP + a forked Python recording bot — with no upstream PR dependency.

**Architecture:**
- The Avuz fork does **not** vendor `apps/spreed/` in git (it is `.gitignore`d — the fork only tracks an allowlist of customised apps). Our patched spreed files live as an overlay at `docker/overlays/spreed/...` and are layered onto the base image's spreed tree during the Docker build (`RUN cp -R docker/overlays/spreed/. /var/www/html/apps/spreed/` in the builder stage, after the main `COPY . /var/www/html/`).
- spreed (via the overlay) gains three new OCS endpoints for chunked store: `init`, `chunk PUT`, `finalize`. Each reuses the existing HMAC-SHA256 signature scheme (`validateBackendRequest`). Finalize reassembles chunks on disk then calls the existing `RecordingService::store()` path so AI summary + chat attachment flows are untouched.
- Recording bot (Python) is forked into a **separate GitHub repo** `github.com/avuz-conecta/talk-recording`. When the NC backend advertises capability `recording-chunked-v1`, the bot splits the recording into 50 MB chunks and uploads via the new endpoints; otherwise it falls back to the existing single-multipart POST. The new repo owns its own Dockerfile + build script and publishes the image `avuz/talk-recording`, which replaces `nextcloud/aio-talk-recording` in this repo's `portainer-recording-stack.yml`. This repo does **not** vendor the bot source.
- Entrypoint disables NC app store (`appstoreenabled=false`) so admins cannot overwrite our patched spreed, plus a boot-time sentinel check fails loud if our patch markers are missing from the running `/var/www/html/apps/spreed/lib/Controller/RecordingController.php` (which is the overlay-applied file).

**Tech Stack:** PHP 8.x (spreed), Python 3.13 (recording bot), Docker multi-arch (linux/amd64 staging + linux/arm64 local), Nextcloud 33, Portainer stacks.

---

## File Structure

**spreed overlay (`docker/overlays/spreed/`)** — applied during Docker build, never replaces the gitignored on-disk `apps/spreed/`.
- Create `docker/overlays/spreed/lib/Capabilities.php` — copy of the on-disk file with `'recording-chunked-v1'` added to features array.
- Create `docker/overlays/spreed/lib/Controller/RecordingController.php` — copy of the on-disk file with: `AVUZ-CHUNKED-UPLOAD-V1` sentinel comment above the class; constructor injection of `RecordingChunkedUploadService`; three new methods `storeChunkedInit`, `storeChunkedPut`, `storeChunkedFinalize`.
- Create `docker/overlays/spreed/lib/Service/RecordingChunkedUploadService.php` — net-new file (no original on-disk counterpart): chunk storage, reassembly, cleanup, sweepStale.

The overlay is **not** a patch — each file in `docker/overlays/spreed/` is a full replacement for the same-path file in the base image's spreed tree. Net-new files (the new service) are simply added by the same `cp -R`.

**Recording bot fork (separate repo, `github.com/avuz-conecta/talk-recording`)**
- New GitHub repo under the `avuz-conecta` org, initialised from `github.com/nextcloud/nextcloud-talk-recording` at the version matching `nextcloud/aio-talk-recording:latest`.
- Modify `src/nextcloud/talk/recording/BackendNotifier.py` — branch on capability, add chunked upload path.
- Keep upstream `Dockerfile`; adjust only if it pulls from PyPI instead of local source.
- Add `scripts/build.sh` for image build + push (mirrors the avuz-server pattern).
- Publish image `avuz/talk-recording:latest` to the same registry as the NC image.

**Docker integration (this repo)**
- Modify `docker/entrypoint.sh` — disable app store, bump `AVUZ_CONFIG_VERSION` to `33.0.0-10`, add sentinel check, raise `upload_max_filesize`/`post_max_size` to 64M (chunk size + envelope).
- Modify `portainer-recording-stack.yml` — swap `image:` from `nextcloud/aio-talk-recording:latest` to `avuz/talk-recording:latest`.

**Docs**
- Modify `customizations.json` — record spreed patch + recording bot fork entries.
- Modify `CLAUDE.md` — short note under "Key Customizations" pointing to this plan.

---

## Task 1: Overlay scaffold + capability flag + sentinel

**Files:**
- Create: `docker/overlays/spreed/lib/Capabilities.php` (copy of on-disk source + 1 line)
- Create: `docker/overlays/spreed/lib/Controller/RecordingController.php` (copy of on-disk source + 1 line)

- [ ] **Step 1: Copy the two originals into the overlay tree**

The on-disk source lives at `/Users/patrickrezende/work/avuz/avuz-server/apps/spreed/` (gitignored — present because NC base image extracted it). The worktree itself does **not** contain these files. Copy them across:

```bash
ORIGIN=/Users/patrickrezende/work/avuz/avuz-server/apps/spreed
mkdir -p docker/overlays/spreed/lib/Controller docker/overlays/spreed/lib/Service
cp "$ORIGIN/lib/Capabilities.php"                  docker/overlays/spreed/lib/Capabilities.php
cp "$ORIGIN/lib/Controller/RecordingController.php" docker/overlays/spreed/lib/Controller/RecordingController.php
```

- [ ] **Step 2: Add capability flag**

Edit `docker/overlays/spreed/lib/Capabilities.php` near line 86 (the features list). Add the new entry **after** `'recording-v1'`:

```php
		'recording-v1',
		'recording-chunked-v1',
		'avatar',
```

- [ ] **Step 3: Add sentinel comment to the overlay RecordingController**

Open `docker/overlays/spreed/lib/Controller/RecordingController.php`. Immediately above the `class RecordingController` declaration, insert:

```php
// AVUZ-CHUNKED-UPLOAD-V1 — do not remove; entrypoint integrity check matches this string
```

This sentinel is what `docker/entrypoint.sh` will grep for on boot in `/var/www/html/apps/spreed/lib/Controller/RecordingController.php` (the overlay-applied path inside the running container — see Task 9).

- [ ] **Step 4: Syntax check**

```bash
php -l docker/overlays/spreed/lib/Controller/RecordingController.php
php -l docker/overlays/spreed/lib/Capabilities.php
```

Expected: `No syntax errors detected ...` for both.

- [ ] **Step 5: Commit**

```bash
git add docker/overlays/spreed/lib/Capabilities.php docker/overlays/spreed/lib/Controller/RecordingController.php
git commit -m "avuz(spreed): overlay scaffold + recording-chunked-v1 capability + sentinel"
```

---

## Task 2: Chunked upload service (PHP)

**Files:**
- Create: `docker/overlays/spreed/lib/Service/RecordingChunkedUploadService.php`

- [ ] **Step 1: Create the service class**

Create file with this exact content:

```php
<?php

declare(strict_types=1);

namespace OCA\Talk\Service;

use InvalidArgumentException;
use OCA\Talk\Room;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFolder;
use OCP\IConfig;
use Psr\Log\LoggerInterface;

class RecordingChunkedUploadService {
	private const CHUNK_TTL_SECONDS = 3600; // 1h — clean stale uploads
	private const MAX_CHUNKS = 200;          // hard cap: 200 × 50MB = 10GB

	public function __construct(
		private IAppData $appData,
		private IConfig $config,
		private LoggerInterface $logger,
	) {
	}

	public function init(Room $room, string $fileName, int $totalSize): string {
		$this->validateFileName($fileName);
		if ($totalSize <= 0) {
			throw new InvalidArgumentException('size');
		}
		$uploadId = bin2hex(random_bytes(16));
		$folder = $this->getUploadFolder($room->getToken(), $uploadId, create: true);
		$folder->newFile('.meta')->putContent(json_encode([
			'token' => $room->getToken(),
			'fileName' => $fileName,
			'totalSize' => $totalSize,
			'createdAt' => time(),
		], JSON_THROW_ON_ERROR));
		return $uploadId;
	}

	public function writeChunk(Room $room, string $uploadId, int $index, string $body): void {
		if ($index < 0 || $index >= self::MAX_CHUNKS) {
			throw new InvalidArgumentException('chunk_index');
		}
		$folder = $this->getUploadFolder($room->getToken(), $uploadId, create: false);
		$folder->newFile(sprintf('%04d.part', $index))->putContent($body);
	}

	/**
	 * @return array{tmp_name: string, name: string, size: int, type: string, error: int}
	 *         Same shape as $_FILES entry — caller hands to RecordingService::store().
	 */
	public function finalize(Room $room, string $uploadId): array {
		$folder = $this->getUploadFolder($room->getToken(), $uploadId, create: false);
		$meta = json_decode($folder->getFile('.meta')->getContent(), true, flags: JSON_THROW_ON_ERROR);

		$tmpPath = tempnam(sys_get_temp_dir(), 'avuz-rec-');
		if ($tmpPath === false) {
			throw new InvalidArgumentException('tmp_create');
		}
		$out = fopen($tmpPath, 'wb');
		if ($out === false) {
			throw new InvalidArgumentException('tmp_open');
		}

		$chunks = [];
		foreach ($folder->getDirectoryListing() as $file) {
			if (str_ends_with($file->getName(), '.part')) {
				$chunks[] = $file;
			}
		}
		usort($chunks, fn($a, $b) => strcmp($a->getName(), $b->getName()));

		$totalWritten = 0;
		foreach ($chunks as $chunk) {
			$bytes = $chunk->getContent();
			fwrite($out, $bytes);
			$totalWritten += strlen($bytes);
		}
		fclose($out);

		if ($totalWritten !== (int)$meta['totalSize']) {
			@unlink($tmpPath);
			$this->cleanup($room->getToken(), $uploadId);
			throw new InvalidArgumentException('size_mismatch');
		}

		$this->cleanup($room->getToken(), $uploadId);

		return [
			'tmp_name' => $tmpPath,
			'name' => (string)$meta['fileName'],
			'size' => $totalWritten,
			'type' => '',
			'error' => 0,
		];
	}

	public function cleanup(string $token, string $uploadId): void {
		try {
			$this->getUploadFolder($token, $uploadId, create: false)->delete();
		} catch (NotFoundException) {
			// nothing to clean
		}
	}

	public function sweepStale(): void {
		try {
			$root = $this->appData->getFolder('recording-chunks');
		} catch (NotFoundException) {
			return;
		}
		$now = time();
		foreach ($root->getDirectoryListing() as $tokenFolder) {
			if (!$tokenFolder instanceof ISimpleFolder) {
				continue;
			}
			foreach ($tokenFolder->getDirectoryListing() as $uploadFolder) {
				if (!$uploadFolder instanceof ISimpleFolder) {
					continue;
				}
				try {
					$meta = json_decode($uploadFolder->getFile('.meta')->getContent(), true);
					if (($now - (int)$meta['createdAt']) > self::CHUNK_TTL_SECONDS) {
						$uploadFolder->delete();
					}
				} catch (\Throwable $e) {
					$this->logger->warning('Failed to sweep stale recording chunk dir', ['exception' => $e]);
				}
			}
		}
	}

	private function getUploadFolder(string $token, string $uploadId, bool $create): ISimpleFolder {
		if (!preg_match('/^[a-z0-9]{4,30}$/', $token) || !preg_match('/^[a-f0-9]{32}$/', $uploadId)) {
			throw new InvalidArgumentException('id_format');
		}
		try {
			$root = $this->appData->getFolder('recording-chunks');
		} catch (NotFoundException) {
			$root = $this->appData->newFolder('recording-chunks');
		}
		$path = $token . '/' . $uploadId;
		try {
			return $root->getFolder($path);
		} catch (NotFoundException) {
			if (!$create) {
				throw new InvalidArgumentException('upload_unknown');
			}
			return $root->newFolder($path);
		}
	}

	private function validateFileName(string $fileName): void {
		if ($fileName === '' || str_contains($fileName, '/') || str_contains($fileName, "\0")) {
			throw new InvalidArgumentException('filename');
		}
	}
}
```

- [ ] **Step 2: Syntax check**

```bash
php -l docker/overlays/spreed/lib/Service/RecordingChunkedUploadService.php
```

Expected: `No syntax errors detected ...`.

- [ ] **Step 3: Commit**

```bash
git add docker/overlays/spreed/lib/Service/RecordingChunkedUploadService.php
git commit -m "avuz(spreed): add RecordingChunkedUploadService for chunked recording store"
```

---

## Task 3: Chunked upload controller endpoints (PHP)

**Files:**
- Modify: `docker/overlays/spreed/lib/Controller/RecordingController.php` (the overlay copy created in Task 1 — add three methods + constructor injection here)

- [ ] **Step 1: Add the service dependency**

Locate the existing constructor of `RecordingController` (search for `public function __construct` near the top of the class). Add `RecordingChunkedUploadService $chunkedService` to the parameter list and store it on a property `private RecordingChunkedUploadService $chunkedService` (mirror the existing pattern — every dependency in this controller is already promoted via `private`).

Also add the use statement at the top of the file (alongside other `use OCA\Talk\Service\...` imports):

```php
use OCA\Talk\Service\RecordingChunkedUploadService;
```

- [ ] **Step 2: Add the three new endpoint methods**

Insert these methods immediately **after** the existing `store(?string $owner)` method (which ends around line 446):

```php
	/**
	 * Initialize a chunked recording upload.
	 *
	 * @param ?string $owner User that will own the recording file.
	 * @param ?string $fileName Final file name (basename only).
	 * @param ?int $totalSize Total recording size in bytes.
	 * @return DataResponse<Http::STATUS_OK, array{uploadId: string}, array{}>|DataResponse<Http::STATUS_BAD_REQUEST, array{error: string}, array{}>|DataResponse<Http::STATUS_UNAUTHORIZED, array{type: string, error: array{code: string, message: string}}, array{}>
	 *
	 * 200: Upload initialised
	 * 400: Bad parameters
	 * 401: Signature invalid
	 */
	#[PublicPage]
	#[BruteForceProtection(action: 'talkRecordingSecret')]
	#[OpenAPI(scope: 'backend-recording')]
	#[RequireRoom]
	#[RequestHeader(name: 'talk-recording-random', description: 'Random seed used to generate the request checksum', indirect: true)]
	#[RequestHeader(name: 'talk-recording-checksum', description: 'Checksum over the request body to verify authenticity from the recording backend', indirect: true)]
	#[ApiRoute(verb: 'POST', url: '/api/{apiVersion}/recording/{token}/store-chunked/init', requirements: [
		'apiVersion' => '(v1)',
		'token' => '[a-z0-9]{4,30}',
	])]
	public function storeChunkedInit(?string $owner, ?string $fileName, ?int $totalSize): DataResponse {
		if (!$this->validateBackendRequest($this->room->getToken())) {
			$response = new DataResponse([
				'type' => 'error',
				'error' => ['code' => 'invalid_request', 'message' => 'The request could not be authenticated.'],
			], Http::STATUS_UNAUTHORIZED);
			$response->throttle(['action' => 'talkRecordingSecret']);
			return $response;
		}
		if ($owner === null || $fileName === null || $totalSize === null) {
			return new DataResponse(['error' => 'params'], Http::STATUS_BAD_REQUEST);
		}
		try {
			$uploadId = $this->chunkedService->init($this->room, $fileName, $totalSize);
		} catch (InvalidArgumentException $e) {
			return new DataResponse(['error' => $e->getMessage()], Http::STATUS_BAD_REQUEST);
		}
		return new DataResponse(['uploadId' => $uploadId]);
	}

	/**
	 * Upload one chunk of a recording.
	 *
	 * Body is the raw chunk bytes. Signature checksum is computed over
	 * the string "{token}:{uploadId}:{index}".
	 *
	 * @param string $uploadId Identifier returned by store-chunked/init.
	 * @param int $index Zero-based chunk index.
	 * @return DataResponse<Http::STATUS_OK, null, array{}>|DataResponse<Http::STATUS_BAD_REQUEST, array{error: string}, array{}>|DataResponse<Http::STATUS_UNAUTHORIZED, array{type: string, error: array{code: string, message: string}}, array{}>
	 *
	 * 200: Chunk stored
	 * 400: Bad parameters
	 * 401: Signature invalid
	 */
	#[PublicPage]
	#[BruteForceProtection(action: 'talkRecordingSecret')]
	#[OpenAPI(scope: 'backend-recording')]
	#[RequireRoom]
	#[RequestHeader(name: 'talk-recording-random', description: 'Random seed used to generate the request checksum', indirect: true)]
	#[RequestHeader(name: 'talk-recording-checksum', description: 'Checksum over "{token}:{uploadId}:{index}" to verify authenticity', indirect: true)]
	#[ApiRoute(verb: 'POST', url: '/api/{apiVersion}/recording/{token}/store-chunked/{uploadId}/{index}', requirements: [
		'apiVersion' => '(v1)',
		'token' => '[a-z0-9]{4,30}',
		'uploadId' => '[a-f0-9]{32}',
		'index' => '\d+',
	])]
	public function storeChunkedPut(string $uploadId, int $index): DataResponse {
		$sigData = $this->room->getToken() . ':' . $uploadId . ':' . $index;
		if (!$this->validateBackendRequest($sigData)) {
			$response = new DataResponse([
				'type' => 'error',
				'error' => ['code' => 'invalid_request', 'message' => 'The request could not be authenticated.'],
			], Http::STATUS_UNAUTHORIZED);
			$response->throttle(['action' => 'talkRecordingSecret']);
			return $response;
		}
		try {
			$this->chunkedService->writeChunk($this->room, $uploadId, $index, $this->getInputStream());
		} catch (InvalidArgumentException $e) {
			return new DataResponse(['error' => $e->getMessage()], Http::STATUS_BAD_REQUEST);
		}
		return new DataResponse(null);
	}

	/**
	 * Finalise a chunked recording upload — reassemble and hand off to RecordingService::store().
	 *
	 * @param string $uploadId Identifier returned by store-chunked/init.
	 * @param ?string $owner User that will own the recording file.
	 * @return DataResponse<Http::STATUS_OK, null, array{}>|DataResponse<Http::STATUS_BAD_REQUEST, array{error: string}, array{}>|DataResponse<Http::STATUS_UNAUTHORIZED, array{type: string, error: array{code: string, message: string}}, array{}>
	 *
	 * 200: Recording stored
	 * 400: Reassembly failed
	 * 401: Signature invalid
	 */
	#[PublicPage]
	#[BruteForceProtection(action: 'talkRecordingSecret')]
	#[OpenAPI(scope: 'backend-recording')]
	#[RequireRoom]
	#[RequestHeader(name: 'talk-recording-random', description: 'Random seed used to generate the request checksum', indirect: true)]
	#[RequestHeader(name: 'talk-recording-checksum', description: 'Checksum over "{token}:{uploadId}:finalize" to verify authenticity', indirect: true)]
	#[ApiRoute(verb: 'POST', url: '/api/{apiVersion}/recording/{token}/store-chunked/{uploadId}/finalize', requirements: [
		'apiVersion' => '(v1)',
		'token' => '[a-z0-9]{4,30}',
		'uploadId' => '[a-f0-9]{32}',
	])]
	public function storeChunkedFinalize(string $uploadId, ?string $owner): DataResponse {
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
		try {
			$file = $this->chunkedService->finalize($this->room, $uploadId);
			$this->recordingService->store($this->getRoom(), $owner, $file);
		} catch (InvalidArgumentException $e) {
			return new DataResponse(['error' => $e->getMessage()], Http::STATUS_BAD_REQUEST);
		} finally {
			if (isset($file['tmp_name']) && is_file($file['tmp_name'])) {
				@unlink($file['tmp_name']);
			}
		}
		return new DataResponse(null);
	}
```

- [ ] **Step 3: Syntax check**

```bash
php -l docker/overlays/spreed/lib/Controller/RecordingController.php
```

Expected: `No syntax errors detected ...`.

- [ ] **Step 4: Commit**

```bash
git add docker/overlays/spreed/lib/Controller/RecordingController.php
git commit -m "avuz(spreed): add storeChunked init/put/finalize endpoints"
```

---

## Task 4: Manual integration smoke (PHP side)

**Files:**
- Test: hand-driven curl against a running staging container.

This is integration-level because the fork has no PHP unit-test harness. Run after Tasks 1–3 land in an image.

- [ ] **Step 1: Build a fresh image with the patch**

```bash
./scripts/build-base.sh latest local
./scripts/build-push.sh latest local
```

Wait for both to succeed (no error). Note the image tag printed at the end.

- [ ] **Step 2: Bring the local stack up + log in once**

```bash
docker compose up -d
docker compose logs -f app | grep -E "Avuz configuration|integrity"
```

Wait for `✓ Avuz configuration up to date` or `═══ Running Avuz Conecta configuration ═══` to finish. Stop tailing with Ctrl-C.

- [ ] **Step 3: Verify capability registered**

```bash
TOKEN=$(docker exec -u www-data $(docker compose ps -q app) php occ talk:room:create --user=admin manual-test | grep -oE 'token=[a-z0-9]+' | cut -d= -f2)
SECRET=$(docker exec -u www-data $(docker compose ps -q app) php occ config:app:get spreed recording_servers | python3 -c 'import sys,json;print(json.load(sys.stdin)["secret"])')
curl -s -u admin:ChangeThisPassword123 -H 'OCS-APIRequest: true' \
  http://localhost:8080/ocs/v2.php/cloud/capabilities?format=json \
  | python3 -c 'import sys,json;f=json.load(sys.stdin)["ocs"]["data"]["capabilities"]["spreed"]["features"];print("recording-chunked-v1" in f)'
```

Expected output: `True`.

- [ ] **Step 4: Drive init/put/finalize from a one-off script**

Create `/tmp/chunk-smoke.py` on the host:

```python
import hashlib, hmac, os, secrets, sys, requests

NC = "http://localhost:8080"
TOKEN = sys.argv[1]
SECRET = sys.argv[2].encode()
OWNER = "admin"
FILE = sys.argv[3]  # path to a small ogg/webm sample

def sign(data: str):
    r = secrets.token_hex(32)
    c = hmac.new(SECRET, (r + data).encode(), hashlib.sha256).hexdigest()
    return {"Talk-Recording-Random": r, "Talk-Recording-Checksum": c}

size = os.path.getsize(FILE)
init = requests.post(
    f"{NC}/ocs/v2.php/apps/spreed/api/v1/recording/{TOKEN}/store-chunked/init",
    headers={**sign(TOKEN), "OCS-APIRequest": "true", "Accept": "application/json"},
    json={"owner": OWNER, "fileName": os.path.basename(FILE), "totalSize": size},
).json()
upload_id = init["ocs"]["data"]["uploadId"]
print("uploadId:", upload_id)

CHUNK = 50 * 1024 * 1024
with open(FILE, "rb") as fh:
    idx = 0
    while True:
        buf = fh.read(CHUNK)
        if not buf:
            break
        r = requests.post(
            f"{NC}/ocs/v2.php/apps/spreed/api/v1/recording/{TOKEN}/store-chunked/{upload_id}/{idx}",
            headers={**sign(f"{TOKEN}:{upload_id}:{idx}"), "OCS-APIRequest": "true"},
            data=buf,
        )
        print("chunk", idx, r.status_code)
        r.raise_for_status()
        idx += 1

r = requests.post(
    f"{NC}/ocs/v2.php/apps/spreed/api/v1/recording/{TOKEN}/store-chunked/{upload_id}/finalize",
    headers={**sign(f"{TOKEN}:{upload_id}:finalize"), "OCS-APIRequest": "true", "Accept": "application/json"},
    json={"owner": OWNER},
)
print("finalize:", r.status_code, r.text)
r.raise_for_status()
```

Run with a small sample webm/ogg (anything from `/tmp/httpsconectahmlavuzapp` on the recording host, scp'd over):

```bash
python3 /tmp/chunk-smoke.py "$TOKEN" "$SECRET" /tmp/sample.ogg
```

Expected: `init` returns `uploadId`, each chunk returns 200, finalize returns 200, and the recording appears under the admin user's Talk recordings folder.

- [ ] **Step 5: Negative test — bad signature**

Repeat one chunk with the wrong secret. Expected: HTTP 401 `invalid_request`.

- [ ] **Step 6: Commit nothing, but record results in the PR description**

No code change here. If anything failed, fix the offending Task 2/3 step before continuing.

---

## Task 5: Fork the recording bot into `avuz-conecta/talk-recording`

**Files:**
- New external repo: `github.com/avuz-conecta/talk-recording` (not in this repo).
- All work in this task happens in `/tmp/talk-recording-fork` or another scratch checkout — **nothing is committed to avuz-server here.**

- [ ] **Step 1: Pin upstream version**

Find the upstream tag matching `nextcloud/aio-talk-recording:latest`:

```bash
docker pull nextcloud/aio-talk-recording:latest
docker inspect nextcloud/aio-talk-recording:latest --format '{{json .Config.Labels}}' | python3 -m json.tool
```

Note the `org.opencontainers.image.version` (or commit SHA). The new repo will be pinned to that exact ref.

- [ ] **Step 2: Create the new GitHub repo**

Using the `gh` CLI (or the GitHub web UI):

```bash
gh repo create avuz-conecta/talk-recording \
  --private \
  --description "Avuz fork of nextcloud-talk-recording with chunked upload support for files >50MB" \
  --clone=false
```

(Confirmed `--private` is the choice for this org.)

- [ ] **Step 3: Seed the new repo from the pinned upstream tag**

```bash
git clone --branch <pinned-tag-from-step-1> --single-branch \
  https://github.com/nextcloud/nextcloud-talk-recording.git /tmp/talk-recording-fork
cd /tmp/talk-recording-fork
git remote set-url origin git@github.com:avuz-conecta/talk-recording.git
git checkout -b main
git push -u origin main
```

This produces a fresh `main` on the avuz-conecta repo that is a verbatim copy of the upstream tag — no patches yet.

- [ ] **Step 4: Add `AVUZ_FORK.md` documenting the upstream pin**

Create `/tmp/talk-recording-fork/AVUZ_FORK.md`:

```markdown
# avuz-conecta/talk-recording

Fork of [nextcloud/nextcloud-talk-recording](https://github.com/nextcloud/nextcloud-talk-recording).

## Pinned upstream
- Tag: `<TAG>`
- Commit: `<SHA>`

## Patches applied
- `BackendNotifier.uploadRecording`: detect the spreed `recording-chunked-v1` capability
  and use the chunked endpoints for recordings >50 MB. Falls back to the upstream
  single-multipart POST otherwise.

## Rebase against newer upstream
1. `git fetch upstream && git checkout -b rebase/<TAG> upstream/<TAG>`
2. Cherry-pick the chunked-upload commits from `main`.
3. Re-run staging validation (see avuz-server plan
   `docs/superpowers/plans/2026-05-21-talk-recording-chunked-upload.md`, Task 11).
```

Replace `<TAG>` / `<SHA>` with the values from Step 1. Commit + push to `main`.

- [ ] **Step 5: Wire upstream as a git remote for future rebases**

```bash
cd /tmp/talk-recording-fork
git remote add upstream https://github.com/nextcloud/nextcloud-talk-recording.git
git fetch upstream
```

Document in `AVUZ_FORK.md` (already done in Step 4).

No commit in the avuz-server repo for this task — the work product is the new external repo on GitHub.

---

## Task 6: Patch the bot for chunked upload

**Files (in the external `avuz-conecta/talk-recording` repo, scratch checkout at `/tmp/talk-recording-fork`):**
- Modify: `src/nextcloud/talk/recording/BackendNotifier.py`

- [ ] **Step 1: Read upstream `uploadRecording` to anchor the patch**

```bash
cd /tmp/talk-recording-fork
grep -n "def uploadRecording\|def doRequest\|MultipartEncoder\|getRandomAndChecksum" src/nextcloud/talk/recording/BackendNotifier.py
```

Note the line numbers of `uploadRecording`, the helper that builds random + HMAC checksum (it'll be called something like `_getRandomAndChecksum` or computed inline), and `doRequest`.

- [ ] **Step 2: Add capability probe**

Append (or insert near other top-level helpers) this function in `src/nextcloud/talk/recording/BackendNotifier.py`:

```python
def _fetchCapabilities(backend: str, skipVerify: bool) -> set[str]:
    """Return spreed feature flags advertised by the NC backend."""
    import requests
    try:
        r = requests.get(
            backend.rstrip("/") + "/ocs/v2.php/cloud/capabilities",
            headers={"OCS-APIRequest": "true", "Accept": "application/json"},
            verify=not skipVerify,
            timeout=15,
        )
        r.raise_for_status()
        return set(r.json()["ocs"]["data"]["capabilities"]["spreed"]["features"])
    except Exception:
        return set()
```

- [ ] **Step 3: Add the chunked upload path**

Add this function alongside `uploadRecording`:

```python
import hashlib
import hmac
import os
import secrets

CHUNK_SIZE = 50 * 1024 * 1024  # 50 MB, under Cloudflare 100 MB cap


def _sign(secret: bytes, data: str) -> dict[str, str]:
    random = secrets.token_hex(32)
    checksum = hmac.new(secret, (random + data).encode(), hashlib.sha256).hexdigest()
    return {"Talk-Recording-Random": random, "Talk-Recording-Checksum": checksum}


def uploadRecordingChunked(backend: str, secret: bytes, skipVerify: bool, token: str, fileName: str, filePath: str, owner: str) -> None:
    import requests

    size = os.path.getsize(filePath)
    base = backend.rstrip("/") + f"/ocs/v2.php/apps/spreed/api/v1/recording/{token}/store-chunked"
    common = {"OCS-APIRequest": "true", "Accept": "application/json"}

    init = requests.post(
        base + "/init",
        headers={**common, **_sign(secret, token)},
        json={"owner": owner, "fileName": os.path.basename(fileName), "totalSize": size},
        verify=not skipVerify,
        timeout=30,
    )
    init.raise_for_status()
    upload_id = init.json()["ocs"]["data"]["uploadId"]

    with open(filePath, "rb") as fh:
        index = 0
        while True:
            buf = fh.read(CHUNK_SIZE)
            if not buf:
                break
            r = requests.post(
                f"{base}/{upload_id}/{index}",
                headers={**common, **_sign(secret, f"{token}:{upload_id}:{index}")},
                data=buf,
                verify=not skipVerify,
                timeout=300,
            )
            r.raise_for_status()
            index += 1

    fin = requests.post(
        f"{base}/{upload_id}/finalize",
        headers={**common, **_sign(secret, f"{token}:{upload_id}:finalize")},
        json={"owner": owner},
        verify=not skipVerify,
        timeout=120,
    )
    fin.raise_for_status()
```

- [ ] **Step 4: Branch in `uploadRecording`**

Locate the existing `def uploadRecording(...)` signature. At the top of the function (after argument unpacking, before the `MultipartEncoder` block), insert:

```python
    caps = _fetchCapabilities(backend, backendSkipVerify)
    if "recording-chunked-v1" in caps and os.path.getsize(fileName) > CHUNK_SIZE:
        return uploadRecordingChunked(
            backend=backend,
            secret=backendSecret.encode() if isinstance(backendSecret, str) else backendSecret,
            skipVerify=backendSkipVerify,
            token=token,
            fileName=os.path.basename(fileName),
            filePath=fileName,
            owner=owner,
        )
```

(Variable names must match the existing function signature — adapt if upstream uses different names. The grep in Step 1 tells you the actual names.)

- [ ] **Step 5: Lint check**

```bash
cd /tmp/talk-recording-fork
python3 -m py_compile src/nextcloud/talk/recording/BackendNotifier.py
```

Expected: no output (success).

- [ ] **Step 6: Commit + push to the avuz-conecta repo**

```bash
cd /tmp/talk-recording-fork
git add src/nextcloud/talk/recording/BackendNotifier.py
git commit -m "feat: chunked upload path for files >50MB

Detects spreed 'recording-chunked-v1' capability and uploads via
POST /store-chunked/{init,put,finalize}. Falls back to upstream
single multipart POST otherwise."
git push origin main
```

---

## Task 7: Build + push the bot image (work in the external repo)

**Files (in `/tmp/talk-recording-fork`):**
- Possibly modify: `Dockerfile` (only if upstream installs from PyPI rather than local source).
- Create: `scripts/build.sh`.

- [ ] **Step 1: Confirm Dockerfile builds from local source**

```bash
cd /tmp/talk-recording-fork
grep -E "^FROM|^COPY|^RUN" Dockerfile | head
```

If you see `RUN pip install nextcloud-talk-recording` (or any reference to the PyPI package), patch the Dockerfile to install from the working copy instead:

```dockerfile
COPY . /app
RUN pip install /app
```

Commit + push if changed:

```bash
git add Dockerfile
git commit -m "build: install from local source instead of PyPI"
git push origin main
```

- [ ] **Step 2: Create the build script in the external repo**

Create `/tmp/talk-recording-fork/scripts/build.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

TAG="${1:-latest}"
TARGET="${2:-local}"   # local | staging
IMAGE="avuz/talk-recording"

case "$TARGET" in
    local)
        PLATFORM="linux/arm64"
        LOAD="--load"
        PUSH=""
        ;;
    staging)
        PLATFORM="linux/amd64"
        LOAD=""
        PUSH="--push"
        ;;
    *)
        echo "Unknown target: $TARGET (expected: local|staging)" >&2
        exit 1
        ;;
esac

cd "$(dirname "$0")/.."
docker buildx build \
    --platform "$PLATFORM" \
    -t "$IMAGE:$TAG" \
    $LOAD $PUSH \
    .

echo "✓ Built $IMAGE:$TAG for $PLATFORM"
```

Make it executable:

```bash
chmod +x /tmp/talk-recording-fork/scripts/build.sh
```

Commit + push:

```bash
cd /tmp/talk-recording-fork
git add scripts/build.sh
git commit -m "build: add multi-arch local/staging build script"
git push origin main
```

- [ ] **Step 3: Build locally**

```bash
cd /tmp/talk-recording-fork
./scripts/build.sh latest local
```

Expected: `✓ Built avuz/talk-recording:latest for linux/arm64`.

- [ ] **Step 4: Smoke run**

```bash
docker run --rm avuz/talk-recording:latest --help 2>&1 | head
```

Expected: upstream help text (or absence of import errors).

- [ ] **Step 5: Build + push staging**

Confirm `docker login` is set against the same registry that hosts the NC image (compare with `scripts/build-push.sh` in avuz-server for the registry URL).

```bash
cd /tmp/talk-recording-fork
./scripts/build.sh latest staging
```

Expected: push success, `avuz/talk-recording:latest` pullable from staging hosts.

No commit in the avuz-server repo for this task.

---

## Task 8: Dockerfile overlay step + stack image + PHP limits

**Files:**
- Modify: `Dockerfile` (apply spreed overlay in builder stage)
- Modify: `portainer-recording-stack.yml`
- Modify: `docker/entrypoint.sh` (PHP ini values + AVUZ_CONFIG_VERSION)

- [ ] **Step 1: Apply the spreed overlay in the Dockerfile builder stage**

Open `Dockerfile`. Locate the builder stage's `COPY . /var/www/html/` line. **After** that line (so the overlay wins over anything the bare COPY would have placed) and **before** the `RUN npm run build` line, insert:

```dockerfile
# Apply Avuz spreed overlay (chunked recording upload patches).
# Each file under docker/overlays/spreed/ is a full replacement for the same
# relative path under apps/spreed/. Net-new files are added by the same cp -R.
RUN cp -R /var/www/html/docker/overlays/spreed/. /var/www/html/apps/spreed/
```

Verify the existing builder permission step still picks up the new files:

```bash
grep -n "find /var/www/html/apps -type" Dockerfile
```

If that `find ... -exec chmod` line already runs **after** the overlay step (it does, given the standard ordering in this Dockerfile), no further change is needed. Otherwise, move it to run after.

- [ ] **Step 2: Swap image in recording stack**

In `portainer-recording-stack.yml`, change:

```yaml
    image: nextcloud/aio-talk-recording:latest
```

to:

```yaml
    image: avuz/talk-recording:latest
```

- [ ] **Step 3: Raise PHP per-request limits in entrypoint**

Open `docker/entrypoint.sh`. Inside `run_avuz_configuration()`, after the existing `php occ config:system:set` calls but before the Talk block, add:

```bash
    # Per-chunk PHP limits — must exceed CHUNK_SIZE (50MB) plus multipart envelope.
    # The new chunked recording endpoint POSTs each chunk as raw bytes; this ceiling
    # caps the largest single chunk we will accept.
    cat > /usr/local/etc/php/conf.d/avuz-upload.ini <<'PHPINI'
upload_max_filesize = 64M
post_max_size = 64M
PHPINI
```

(If a similar file already exists, update it instead of overwriting.)

- [ ] **Step 4: Bump version stamp**

In `docker/entrypoint.sh` line 5, change:

```bash
AVUZ_CONFIG_VERSION="33.0.0-9"
```

to:

```bash
AVUZ_CONFIG_VERSION="33.0.0-10"
```

- [ ] **Step 5: Commit**

```bash
git add Dockerfile portainer-recording-stack.yml docker/entrypoint.sh
git commit -m "avuz(docker): apply spreed overlay, swap recording image, raise PHP limits 64M"
```

---

## Task 9: Lock down NC app store + sentinel integrity check

**Files:**
- Modify: `docker/entrypoint.sh`

- [ ] **Step 1: Disable app store**

Inside `run_avuz_configuration()`, add (near the other `config:system:set` calls):

```bash
    # Avuz owns the app upgrade cycle via image rebuilds. Disable the in-app store
    # so admins cannot overwrite our patched spreed (which carries the chunked
    # upload endpoints).
    php occ config:system:set appstoreenabled --value=false --type=boolean
```

- [ ] **Step 2: Sentinel integrity check**

Add a new function above the `run_avuz_configuration` definition (line ~58):

```bash
verify_avuz_patches() {
    local sentinel="AVUZ-CHUNKED-UPLOAD-V1"
    local target="/var/www/html/apps/spreed/lib/Controller/RecordingController.php"
    if ! grep -q "$sentinel" "$target" 2>/dev/null; then
        echo "✗ AVUZ PATCH MISSING: sentinel '$sentinel' not found in $target"
        echo "  Refusing to boot — image may be corrupted or an admin reinstalled spreed."
        echo "  Recover: redeploy from the latest avuz-server image."
        exit 1
    fi
    echo "✓ Avuz spreed patches present"
}
```

Then call it early in the main flow — directly after the `set -e` line (so it runs before configuration logic that depends on the patch). Locate the existing top-level section right before the `if [ "$NEEDS_CONFIGURATION" -eq 1 ] ...` line (around line 457) and insert:

```bash
verify_avuz_patches
```

- [ ] **Step 3: Syntax check the shell script**

```bash
bash -n docker/entrypoint.sh
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add docker/entrypoint.sh
git commit -m "avuz(docker): disable appstore + sentinel integrity check for spreed patches"
```

---

## Task 10: Docs + customizations registry

**Files:**
- Modify: `customizations.json`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append both entries to `customizations.json` `entries` array**

Schema in this repo uses `id`, `type`, `paths` (array), `description`, `risk`, `notes`. Append these two objects to the `entries` array:

```json
{
  "id": "spreed-chunked-recording-upload",
  "type": "overlay",
  "paths": [
    "docker/overlays/spreed/lib/Capabilities.php",
    "docker/overlays/spreed/lib/Controller/RecordingController.php",
    "docker/overlays/spreed/lib/Service/RecordingChunkedUploadService.php",
    "Dockerfile"
  ],
  "description": "Spreed overlay (full-file replacements applied at Docker build time) that adds POST /store-chunked/{init,put,finalize} endpoints and the 'recording-chunked-v1' capability so Talk recordings >100MB succeed through Cloudflare (free plan 100MB body cap). Reuses the existing Talk-Recording HMAC signature scheme. Finalize hands off to RecordingService::store() so AI summary + chat attachment flows are untouched.",
  "risk": "medium",
  "notes": "Overlay applied via Dockerfile builder stage: `RUN cp -R docker/overlays/spreed/. /var/www/html/apps/spreed/`. Sentinel 'AVUZ-CHUNKED-UPLOAD-V1' in RecordingController.php; entrypoint verify_avuz_patches() fails boot if missing. Requires the matching avuz/talk-recording bot image. On upstream spreed bumps, re-derive each overlay file from the new base; rebase guide in docs/superpowers/plans/2026-05-21-talk-recording-chunked-upload.md."
},
{
  "id": "recording-bot-chunked-upload",
  "type": "external-fork",
  "paths": [
    "portainer-recording-stack.yml"
  ],
  "description": "Fork of nextcloud/nextcloud-talk-recording maintained in the separate repo github.com/avuz-conecta/talk-recording. BackendNotifier.uploadRecording branches on the 'recording-chunked-v1' capability and uploads files >50MB in 50MB chunks via the new spreed endpoints. Image published as avuz/talk-recording, referenced from portainer-recording-stack.yml; replaces nextcloud/aio-talk-recording.",
  "risk": "medium",
  "notes": "Source + Dockerfile + build script live in github.com/avuz-conecta/talk-recording. Upstream pin tracked in that repo's AVUZ_FORK.md. Rebase = pull next upstream tag in avuz-conecta/talk-recording, cherry-pick chunked-upload commits, rebuild, redeploy."
}
```

- [ ] **Step 2: Note in CLAUDE.md**

Append under "Key Customizations" in `CLAUDE.md`:

```markdown
### Talk recording chunked upload
- spreed patched via overlay (`docker/overlays/spreed/lib/...`) applied during Docker build. Sentinel `AVUZ-CHUNKED-UPLOAD-V1` lives in the overlay's `RecordingController.php`; entrypoint verifies the running container's spreed has it.
- Bot fork lives in the **separate repo** `github.com/avuz-conecta/talk-recording`; image `avuz/talk-recording` referenced from `portainer-recording-stack.yml`.
- Lets recordings >100MB survive Cloudflare's 100MB body cap. See `docs/superpowers/plans/2026-05-21-talk-recording-chunked-upload.md`.
```

- [ ] **Step 3: Commit**

```bash
git add customizations.json CLAUDE.md
git commit -m "avuz(docs): register chunked-upload customizations"
```

---

## Task 11: Staging end-to-end validation

**Files:**
- No code changes. Real call against the staging environment.

- [ ] **Step 1: Build + push staging images**

```bash
# avuz-server (this repo)
./scripts/build-base.sh latest staging
./scripts/build-push.sh latest staging

# avuz-conecta/talk-recording (external repo)
(cd /tmp/talk-recording-fork && ./scripts/build.sh latest staging)
```

All three must succeed.

- [ ] **Step 2: Redeploy stacks**

In Portainer:
1. Update the NC stack — `avuz-conecta-server:latest` (or whatever tag your push produced). Click "Update the stack" with re-pull enabled.
2. Update the recording stack — confirm `image: avuz/talk-recording:latest` is in effect, re-pull, redeploy.

- [ ] **Step 3: Confirm both containers are healthy**

```bash
# from the staging host
docker logs --tail 50 <nc-container>     | grep -E "Avuz patches|Avuz configuration|appstoreenabled"
docker logs --tail 20 nextcloud-talk-recording
```

Expected NC log: `✓ Avuz spreed patches present`, then `═══ Running Avuz Conecta configuration ═══` and `✓ Avuz configuration up to date (33.0.0-10) ...` on subsequent boots. Recording bot logs should not show "No secret configured" anymore (we kept `NC_DOMAIN=conectahml.avuz.app` from the revert).

- [ ] **Step 4: Confirm capability advertised**

```bash
curl -s -u admin:<pwd> -H 'OCS-APIRequest: true' \
  https://conectahml.avuz.app/ocs/v2.php/cloud/capabilities?format=json \
  | python3 -c 'import sys,json;f=json.load(sys.stdin)["ocs"]["data"]["capabilities"]["spreed"]["features"];print("chunked:", "recording-chunked-v1" in f)'
```

Expected: `chunked: True`.

- [ ] **Step 5: Short recording (< 50 MB) — fallback path**

Start a call in Talk → record for 2 min → stop. Confirm:
- File appears in chat.
- AI summary fires (`docker exec <nc> tail -200 /var/www/html/data/nextcloud.log | grep -iE 'audio2text|summary|recording'`).
- Bot logs show **no** `/store-chunked/` requests (fell back to single POST).

- [ ] **Step 6: Long recording (~20 min, > 100 MB) — chunked path**

Start a call → record for 20 min → stop. Confirm:
- Bot logs show `POST .../store-chunked/init`, multiple `/store-chunked/{uploadId}/{index}` (HTTP 200), then `/finalize` (HTTP 200).
- No 413 anywhere.
- File appears in chat, AI summary fires.

- [ ] **Step 7: Cleanup leftover stuck file**

```bash
docker exec nextcloud-talk-recording rm -rf /tmp/httpsconectahmlavuzapp
```

- [ ] **Step 8: Negative — confirm app store really disabled**

Browser → NC admin → Apps. The "Update" / "Enable" actions should be hidden (or yield a "disabled by config" message). If you still see them, recheck Task 9 Step 1 in production state.

- [ ] **Step 9: Commit nothing — capture results in the PR description**

---

## Risks + mitigations

- **Disk pressure during reassembly.** `RecordingChunkedUploadService::finalize` reads each chunk then writes to a `tempnam` file. Worst case: 2× recording size on disk briefly. Mitigated by the `MAX_CHUNKS = 200` (10 GB hard ceiling) and by the `cleanup` call in `finally`.
- **Stale chunks orphaned on bot crash.** `sweepStale` exists but is not wired into a cron in this plan — wire later via `OC\BackgroundJob` if it becomes a problem. Today the disk impact is bounded by `MAX_CHUNKS * CHUNK_SIZE = 10 GB`.
- **Capability cached.** NC caches capabilities per-session. Bot fetches per-upload — fresh GET each time, no cache hit risk.
- **Bot upstream drift.** Re-pinning to a newer upstream tag = re-clone, re-apply Task 6 diff. Document in `recording-bot/AVUZ_FORK.md`.
- **Integrity warning in NC admin UI.** Patching core/app files trips NC's `php occ integrity:check-app spreed`. The warning is cosmetic but visible. Acceptable for now; future task: regenerate signature file with our own key (out of scope).

---

## Out of scope
- Replaying the already-failed `bevgu828` recording. The file at `/tmp/httpsconectahmlavuzapp/` on staging stays as-is — copy out manually if the meeting content matters.
- Video bitrate tuning. Audio-only fallback is no longer needed once chunked works for arbitrary sizes.
- Background cron for `sweepStale`. Add only if disk usage becomes a measured problem.
