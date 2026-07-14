# Chunked Whisper Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transcribe arbitrarily long Talk call recordings by segmenting the extracted audio into <25 MB time chunks, transcribing each, and joining the text — killing the OpenAI Whisper 25 MB per-request 413 that fails 2.5–3 h calls.

**Architecture:** Extend the existing `AVUZ-AUDIO-EXTRACT-V1` patch in the `integration_openai` fork. `extractAudioForWhisper` now always encodes 48k mono (no 24k downgrade) and **streams** the source in. A new `segmentAudio` splits that mp3 by duration. `transcribeFile` loops the parts through a new `transcribeWithRetry` (transient-only retry) and joins the text. Ships as the fork submodule; image rebuilt + redeployed.

**Tech Stack:** PHP 8 (Nextcloud app), `exec()` + ffmpeg (libmp3lame, segment muxer), OpenAI Whisper REST via `OC\Http\Client`.

## Global Constraints

- Sentinel for all new/changed blocks: `AVUZ-AUDIO-CHUNK-V1` (in a code comment).
- Fork repo: `avuz-conecta/integration_openai`, branch `avuz`, submodule at `apps/integration_openai`.
- Version pin bump **4.5.1.2 → 4.5.1.3** in `appinfo/info.xml` (must stay ≥ store version so `app:update` never clobbers).
- Encode bitrate: **48k mono** (`-ac 1 -c:a libmp3lame -b:a 48k`). No downgrade path.
- Segment length: **3600 s** (60 min) → ~21.6 MB/part, headroom under the 25 MB (26214400 B) cap. Do NOT increase.
- Size limit constant: `24 * 1024 * 1024` (25165824) — the existing `$sizeLimit`.
- ffmpeg calls use `exec()` (Symfony Process is not bundled in NC), args via `escapeshellarg`, wrapped in `timeout`.
- Retry: transient only (HTTP 429, any 5xx, cURL network/timeout) → 2 retries, backoff ~2 s then ~5 s. Any other 4xx (413/400/401…) → rethrow immediately.
- Temp hygiene: every temp file/dir unlinked on all paths (`finally`), per existing discipline.
- No new config surface. No new Composer deps.
- **Testing reality:** the fork's phpunit needs the full NC server tree (`Test\TestCase`, `lib/base.php`) and is **not runnable in this deployment checkout**. Per `AVUZ-AUDIO-EXTRACT-V1` precedent the gate is: (a) runnable local checks that need no NC autoloading (real ffmpeg, `php -l`), and (b) staging e2e with a >70 min recording. Where a step says "run", the command is genuinely runnable in this checkout.

**Reference (current code, `apps/integration_openai/lib/Service/OpenAiAPIService.php`):**
- `transcribeFile()` — lines 768–793
- `extractAudioForWhisper()` — lines 803–849
- `ffmpegToMp3()` — lines 857–869
- `transcribe()` — lines 880–933 (unchanged; consumes bytes, returns text)
- Imports already present: `OCP\Files\File` (l20), `RuntimeException` (l32), `Throwable` (l33), `NotPermittedException`, `LockedException`, `GenericFileException`, `LoggerInterface`, `Application`.

---

### Task 1: Stream the source into extract; drop the 24k downgrade (48k only)

**Files:**
- Modify: `apps/integration_openai/lib/Service/OpenAiAPIService.php:803-849` (`extractAudioForWhisper`)
- Verify: local ffmpeg + `php -l` (no NC harness needed)

**Interfaces:**
- Consumes: `File $file` (`OCP\Files\File`) — `getMimeType()`, `getSize()`, `fopen('r')`, `getContent()`.
- Produces: `extractAudioForWhisper(File $file): ?string` — returns a **48k mono mp3** temp path (caller unlinks), or `null` meaning "send original bytes". Same signature as today; behaviour change = 48k-only + streamed input.

- [ ] **Step 1: Replace the method body — stream input, single 48k encode, no downgrade**

Replace lines 803–849 (the whole `private function extractAudioForWhisper(File $file): ?string { … }`) with:

```php
	private function extractAudioForWhisper(File $file): ?string {
		// AVUZ-AUDIO-CHUNK-V1: always encode 48k mono; size is bounded later by
		// segmentAudio (per-duration chunks), so the old 24k downgrade is gone.
		$sizeLimit = 24 * 1024 * 1024; // headroom under the 25 MB (26214400) cap
		$isVideo = str_starts_with((string)$file->getMimeType(), 'video/');
		if (!$isVideo && $file->getSize() <= $sizeLimit) {
			return null;
		}

		// Build the output path manually: tempnam() would create (and orphan) a
		// zero-byte file at the pre-suffix path. ffmpeg creates $tmpOut itself.
		$tmpIn = tempnam(sys_get_temp_dir(), 'avuz_stt_in_');
		$tmpOut = '';
		try {
			$tmpOut = sys_get_temp_dir() . '/avuz_stt_out_' . bin2hex(random_bytes(8)) . '.mp3';

			// AVUZ-AUDIO-CHUNK-V1: stream the source to disk instead of
			// getContent() so a ~190 MB video never fully materialises in the
			// worker's RAM (that path OOMs a 512 MB CLI). Fall back to
			// getContent() only if the handle can't be opened.
			$in = $file->fopen('r');
			if ($in === false) {
				file_put_contents($tmpIn, $file->getContent());
			} else {
				$out = fopen($tmpIn, 'w');
				if ($out === false) {
					fclose($in);
					throw new RuntimeException('could not open temp input for writing');
				}
				try {
					stream_copy_to_stream($in, $out);
				} finally {
					fclose($in);
					fclose($out);
				}
			}

			if (!$this->ffmpegToMp3($tmpIn, '48k', $tmpOut)) {
				throw new RuntimeException('ffmpeg mp3 encode failed');
			}
			clearstatcache(true, $tmpOut);
			if (!is_file($tmpOut) || filesize($tmpOut) === 0) {
				throw new RuntimeException('ffmpeg produced an empty mp3');
			}

			@unlink($tmpIn);
			return $tmpOut;
		} catch (NotPermittedException|LockedException|GenericFileException $e) {
			// File-access failure: let transcribeFile's handler convert it rather
			// than mask it as an extraction error (and avoid a second getContent()).
			@unlink($tmpIn);
			@unlink($tmpOut);
			throw $e;
		} catch (Throwable $e) {
			@unlink($tmpIn);
			@unlink($tmpOut);
			$this->logger->warning('[avuz] Whisper audio extraction failed, sending original file: ' . $e->getMessage(), ['app' => Application::APP_ID]);
			return null;
		}
	}
```

- [ ] **Step 2: Lint the file**

Run: `cd apps/integration_openai && php -l lib/Service/OpenAiAPIService.php`
Expected: `No syntax errors detected in lib/Service/OpenAiAPIService.php`

- [ ] **Step 3: Prove the 48k encode command locally (the encode this method runs)**

Run (synthesises 90 min of tone, encodes exactly as `ffmpegToMp3(..., '48k', ...)` does, checks size):
```bash
cd /tmp && ffmpeg -nostdin -y -f lavfi -i "sine=frequency=440:duration=5400" -ac 1 -c:a libmp3lame -b:a 48k /tmp/avuz_48k.mp3 >/dev/null 2>&1 && ls -l /tmp/avuz_48k.mp3
```
Expected: a file ~32 MB (90 min @ 48k ≈ 32 MB) — i.e. a single 90 min encode DOES exceed 24 MB, which is exactly why Task 2 must segment it. Confirms the encode works and the size premise.

- [ ] **Step 4: Commit**

```bash
cd apps/integration_openai
git add lib/Service/OpenAiAPIService.php
git commit -m "AVUZ-AUDIO-CHUNK-V1: stream input, drop 24k downgrade (48k mono only)"
```

---

### Task 2: `segmentAudio` — split the mp3 into ordered <24 MB parts

**Files:**
- Modify: `apps/integration_openai/lib/Service/OpenAiAPIService.php` (add method next to `ffmpegToMp3`, ~after line 869)
- Verify: local ffmpeg segmentation test + `php -l`

**Interfaces:**
- Consumes: `string $mp3` — path to the 48k mono mp3 from Task 1.
- Produces: `segmentAudio(string $mp3): array` (`string[]`) — ascending-ordered part paths in a temp dir. Returns `[$mp3]` unchanged if segmentation fails or yields no parts (fallback = single upload, never worse than today). Caller unlinks parts + the temp dir.

- [ ] **Step 1: Add the method** (insert immediately after `ffmpegToMp3()`'s closing brace, ~line 869)

```php

	/**
	 * AVUZ-AUDIO-CHUNK-V1
	 * Split a mono mp3 into <=60 min parts (~21.6 MB each at 48k CBR) so every
	 * upload stays under OpenAI Whisper's 25 MB per-request cap. Uses the segment
	 * muxer with stream copy (no re-encode). Returns ascending-ordered part paths,
	 * or [$mp3] unchanged on any failure so transcription still attempts a single
	 * upload (never worse than the pre-chunking behaviour). Never throws.
	 */
	private function segmentAudio(string $mp3): array {
		$dir = sys_get_temp_dir() . '/avuz_stt_parts_' . bin2hex(random_bytes(8));
		try {
			if (!mkdir($dir) && !is_dir($dir)) {
				throw new RuntimeException('could not create parts dir');
			}
			$pattern = $dir . '/part_%03d.mp3';
			$cmd = sprintf(
				'timeout 600 ffmpeg -nostdin -y -i %s -f segment -segment_time 3600 -c copy %s 2>&1',
				escapeshellarg($mp3),
				escapeshellarg($pattern),
			);
			exec($cmd, $output, $code);
			if ($code !== 0) {
				$this->logger->warning('[avuz] ffmpeg segment exit ' . $code . ': ' . implode(' | ', array_slice($output, -3)), ['app' => Application::APP_ID]);
				throw new RuntimeException('ffmpeg segment failed');
			}
			$parts = glob($dir . '/part_*.mp3');
			if ($parts === false || count($parts) === 0) {
				throw new RuntimeException('segmentation produced no parts');
			}
			sort($parts); // zero-padded %03d => alphabetical == chronological
			return $parts;
		} catch (Throwable $e) {
			$this->logger->warning('[avuz] audio segmentation failed, using single upload: ' . $e->getMessage(), ['app' => Application::APP_ID]);
			// Clean any partial output; fall back to the whole file.
			foreach (glob($dir . '/part_*.mp3') ?: [] as $p) {
				@unlink($p);
			}
			@rmdir($dir);
			return [$mp3];
		}
	}
```

- [ ] **Step 2: Lint**

Run: `cd apps/integration_openai && php -l lib/Service/OpenAiAPIService.php`
Expected: `No syntax errors detected`

- [ ] **Step 3: Prove the exact segment command locally (real ffmpeg, no NC needed)**

Run (reuses the 90 min mp3 from Task 1 Step 3; runs the identical segment command; asserts ≥2 ordered parts each <24 MB):
```bash
cd /tmp && rm -rf avuz_parts && mkdir avuz_parts && \
ffmpeg -nostdin -y -i /tmp/avuz_48k.mp3 -f segment -segment_time 3600 -c copy 'avuz_parts/part_%03d.mp3' >/dev/null 2>&1 && \
ls -l avuz_parts/ && \
echo "--- max size bytes (must be < 25165824):" && \
ls -l avuz_parts/*.mp3 | awk '{print $5}' | sort -n | tail -1
```
Expected: two files `part_000.mp3`, `part_001.mp3` (90 min → 60+30); the largest < 25165824. Proves segment sizing, ordering, and the <24 MB invariant with real ffmpeg.

- [ ] **Step 4: Commit**

```bash
cd apps/integration_openai
git add lib/Service/OpenAiAPIService.php
git commit -m "AVUZ-AUDIO-CHUNK-V1: segmentAudio splits mp3 into <24MB ordered parts"
```

---

### Task 3: `transcribeWithRetry` — transient-only retry, fail-fast on 4xx

**Files:**
- Modify: `apps/integration_openai/lib/Service/OpenAiAPIService.php` (add method above `transcribeFile`, ~before line 768)
- Verify: standalone pure-logic check of the classifier + `php -l`

**Interfaces:**
- Consumes: `transcribe(?string,string,bool,string,string): string` (existing, line 880) — throws `Exception` whose `getCode()` carries the OpenAI HTTP status (e.g. `413`).
- Produces: `transcribeWithRetry(?string $userId, string $bytes, bool $translate, string $model, string $language): string` — returns transcript text; retries transient failures up to 2×; rethrows permanent 4xx immediately and the last exception on exhaustion.

- [ ] **Step 1: Add the method** (insert just above `public function transcribeFile(` at ~line 768, before its docblock)

```php
	/**
	 * AVUZ-AUDIO-CHUNK-V1
	 * Transcribe one chunk with bounded retries. Retries only transient failures
	 * (HTTP 429, any 5xx, or a network/timeout error with no HTTP code); any other
	 * 4xx (413, 400, 401, …) is permanent and rethrown immediately — retrying it
	 * only wastes backoff. Rethrows the last exception when retries are exhausted.
	 */
	private function transcribeWithRetry(
		?string $userId,
		string $bytes,
		bool $translate,
		string $model,
		string $language,
	): string {
		$backoffSeconds = [2, 5]; // attempt 2 waits 2s, attempt 3 waits 5s
		$maxAttempts = count($backoffSeconds) + 1;
		for ($attempt = 1; ; $attempt++) {
			try {
				return $this->transcribe($userId, $bytes, $translate, $model, $language);
			} catch (Throwable $e) {
				$code = $e->getCode();
				$isTransient = $code === 429 || $code >= 500 || $code === 0;
				if (!$isTransient || $attempt >= $maxAttempts) {
					throw $e;
				}
				$this->logger->warning('[avuz] chunk transcription attempt ' . $attempt . ' failed (code ' . $code . '), retrying: ' . $e->getMessage(), ['app' => Application::APP_ID]);
				sleep($backoffSeconds[$attempt - 1]);
			}
		}
	}
```

- [ ] **Step 2: Lint**

Run: `cd apps/integration_openai && php -l lib/Service/OpenAiAPIService.php`
Expected: `No syntax errors detected`

- [ ] **Step 3: Prove the classification logic in isolation (standalone, runnable locally)**

The retry decision is `$isTransient = $code === 429 || $code >= 500 || $code === 0`. Verify it with a self-contained script (no NC autoloading):
```bash
cat > /tmp/avuz_retry_test.php <<'PHP'
<?php
$classify = fn(int $code): bool => $code === 429 || $code >= 500 || $code === 0;
$cases = [
  [413, false], // permanent — fail fast (the bug we are fixing)
  [400, false], [401, false], [404, false],
  [429, true],  // rate limit — retry
  [500, true], [502, true], [503, true],
  [0,   true],  // network/timeout, no HTTP code — retry
];
$fail = 0;
foreach ($cases as [$code, $want]) {
  $got = $classify($code);
  $ok = $got === $want ? 'ok ' : 'FAIL';
  if ($got !== $want) { $fail++; }
  printf("%s code=%d transient=%s (want %s)\n", $ok, $code, var_export($got, true), var_export($want, true));
}
exit($fail === 0 ? 0 : 1);
PHP
php /tmp/avuz_retry_test.php; echo "exit=$?"
```
Expected: every line `ok `, final `exit=0`. Confirms 413/400/401/404 are permanent (no retry) and 429/5xx/0 are transient. This is the exact expression used in the method.

- [ ] **Step 4: Commit**

```bash
cd apps/integration_openai
git add lib/Service/OpenAiAPIService.php
git commit -m "AVUZ-AUDIO-CHUNK-V1: transcribeWithRetry — transient-only retry, fail-fast on 4xx"
```

---

### Task 4: Rewire `transcribeFile` — extract → segment → loop → trim/join → cleanup

**Files:**
- Modify: `apps/integration_openai/lib/Service/OpenAiAPIService.php:768-793` (`transcribeFile` body, the `try { … }` block)
- Verify: `php -l` + staging e2e (Task 6)

**Interfaces:**
- Consumes: `extractAudioForWhisper(File): ?string` (Task 1), `segmentAudio(string): string[]` (Task 2), `transcribeWithRetry(...): string` (Task 3), `transcribe(...): string` (existing, for the null/raw path).
- Produces: unchanged public signature `transcribeFile(?string,File,bool,string,string): string`; now returns the joined multi-chunk transcript.

- [ ] **Step 1: Replace the `try` block body** (lines 775–786, the current `try { … }` inside `transcribeFile`) with the chunked orchestration. The surrounding `catch (NotPermittedException|LockedException|GenericFileException $e)` (lines 787–790) and `return $transcriptionResponse;` (line 792) are replaced too — the new body returns directly and keeps the same file-access catch.

Replace the method body (everything between the `): string {` opening at line 774 and the closing `}` at line 793) with:

```php
	): string {
		// AVUZ-AUDIO-CHUNK-V1: extract audio, segment into <25MB parts, transcribe
		// each with transient-retry, join. Long calls (2.5-3h) exceed OpenAI's
		// 25MB per-request cap even at 24k mono, so a single request always 413s.
		try {
			$extracted = $this->extractAudioForWhisper($file);
			if ($extracted === null) {
				// Small non-video input: original behaviour, single raw upload.
				return $this->transcribe($userId, $file->getContent(), $translate, $model, $language);
			}

			$parts = $this->segmentAudio($extracted);
			$partsDir = dirname($parts[0]);
			$isSegmented = count($parts) > 1 || $parts[0] !== $extracted;
			try {
				$texts = [];
				foreach ($parts as $part) {
					$bytes = file_get_contents($part);
					if ($bytes === false) {
						throw new RuntimeException('could not read audio chunk ' . $part);
					}
					$texts[] = trim($this->transcribeWithRetry($userId, $bytes, $translate, $model, $language));
				}
				return implode(' ', $texts);
			} finally {
				// Unlink parts + their dir when segmentAudio produced them; always
				// unlink the extracted mp3. (On fallback, $parts[0] === $extracted.)
				if ($isSegmented) {
					foreach ($parts as $part) {
						@unlink($part);
					}
					@rmdir($partsDir);
				}
				@unlink($extracted);
			}
		} catch (NotPermittedException|LockedException|GenericFileException $e) {
			$this->logger->warning('Could not read audio file: ' . $file->getPath() . '. Error: ' . $e->getMessage(), ['app' => Application::APP_ID]);
			throw new Exception($this->l10n->t('Could not read audio file.'), Http::STATUS_INTERNAL_SERVER_ERROR);
		}
	}
```

Note the cleanup logic: `segmentAudio` returns `[$extracted]` on fallback (parts dir already removed inside it), so `$isSegmented` is false and only `$extracted` is unlinked — no double-unlink, no attempt to `rmdir` a live temp dir.

- [ ] **Step 2: Lint**

Run: `cd apps/integration_openai && php -l lib/Service/OpenAiAPIService.php`
Expected: `No syntax errors detected`

- [ ] **Step 3: Full end-to-end dry pipeline locally (real ffmpeg, mocks the API boundary only)**

Verify the extract→segment→per-part→join shape end-to-end with real ffmpeg, stubbing only the network call (the one thing needing OpenAI):
```bash
cat > /tmp/avuz_pipeline_test.php <<'PHP'
<?php
// Mirrors transcribeFile's orchestration with real ffmpeg; stubs transcribe().
$src = '/tmp/avuz_48k.mp3'; // from Task 1 Step 3 (90 min, >24MB)
if (!is_file($src)) { fwrite(STDERR, "run Task 1 Step 3 first\n"); exit(2); }
$dir = sys_get_temp_dir() . '/avuz_pl_' . bin2hex(random_bytes(4));
mkdir($dir);
exec(sprintf('ffmpeg -nostdin -y -i %s -f segment -segment_time 3600 -c copy %s 2>&1',
  escapeshellarg($src), escapeshellarg($dir . '/part_%03d.mp3')), $o, $code);
$parts = glob($dir . '/part_*.mp3'); sort($parts);
$transcribe = fn(string $p): string => ' chunk[' . basename($p) . '] '; // stub w/ leading/trailing space
$texts = [];
foreach ($parts as $p) { $texts[] = trim($transcribe($p)); }
$joined = implode(' ', $texts);
foreach ($parts as $p) { @unlink($p); } @rmdir($dir);
echo "parts=" . count($parts) . "\n";
echo "joined=[$joined]\n";
$ok = count($parts) >= 2 && $joined === 'chunk[part_000.mp3] chunk[part_001.mp3]';
echo $ok ? "PASS\n" : "FAIL\n";
exit($ok ? 0 : 1);
PHP
php /tmp/avuz_pipeline_test.php; echo "exit=$?"
```
Expected: `parts=2`, `joined=[chunk[part_000.mp3] chunk[part_001.mp3]]`, `PASS`, `exit=0`. Proves ordered iteration, trim (no leading/trailing/double space), single-space join, and cleanup — the pure orchestration, with the real segmenter.

- [ ] **Step 4: Commit**

```bash
cd apps/integration_openai
git add lib/Service/OpenAiAPIService.php
git commit -m "AVUZ-AUDIO-CHUNK-V1: transcribeFile chunks + joins segmented transcripts"
```

---

### Task 5: Bump version pin + update submodule pointer

**Files:**
- Modify: `apps/integration_openai/appinfo/info.xml:104` (`<version>`)
- Modify: `avuz-server` submodule pointer (git index entry for `apps/integration_openai`)

**Interfaces:** none (packaging).

- [ ] **Step 1: Bump the pin 4.5.1.2 → 4.5.1.3**

Edit `apps/integration_openai/appinfo/info.xml` line 104:
```xml
	<version>4.5.1.3</version>
```

- [ ] **Step 2: Verify grep**

Run: `cd apps/integration_openai && grep -n '<version>' appinfo/info.xml`
Expected: `104:	<version>4.5.1.3</version>`

- [ ] **Step 3: Commit in the fork + push**

```bash
cd apps/integration_openai
git add appinfo/info.xml
git commit -m "AVUZ-AUDIO-CHUNK-V1: bump pin 4.5.1.2 -> 4.5.1.3"
git push origin avuz
```
Expected: push succeeds to `avuz-conecta/integration_openai` branch `avuz`.

- [ ] **Step 4: Advance the submodule pointer in avuz-server + commit**

```bash
cd /Users/patrickrezende/work/avuz/avuz-server
git add apps/integration_openai
git commit -m "chore(submodule): integration_openai -> AVUZ-AUDIO-CHUNK-V1 (chunked whisper)"
```
Expected: the commit records the new submodule SHA (the Task 5 Step 3 commit).

---

### Task 6: Build, deploy-gate, deploy, recover the 2 failed recordings, e2e

**Files:** none (operational). Run against `grupo-vidalar-app-1` on host `app2`.

**Interfaces:** none.

- [ ] **Step 1: DEPLOY GATE — confirm CLI memory_limit on the running image (the OOM adjacency)**

Chunking the *output* does not fix the *input* load: `extractAudioForWhisper` still buffers via ffmpeg, and a 512 MB CLI can OOM on a big recording (see `talk-recording-cf504-worker-oom`). The Task 1 streaming change reduces PHP-side RAM, but verify the worker's CLI limit before trusting the fix:
```bash
docker exec grupo-vidalar-app-1 php -i | grep -i '^memory_limit'
docker exec grupo-vidalar-app-1 ls -la /usr/local/etc/php/conf.d/zz-avuz-memory.ini
```
Expected: `memory_limit => 3072M => 3072M` and the ini present. If it shows `512M` / ini absent, STOP — bake/confirm the 3072M CLI ini first (that memory's live fix + image-bake note) before this change is deployable.

- [ ] **Step 2: Build + push the prod image**

```bash
cd /Users/patrickrezende/work/avuz/avuz-server
./scripts/build-push.sh latest prod
```
Expected: amd64 image built on base `avuzconecta-base:latest`, pushed as `:latest`. (See `prod-build-command` memory.)

- [ ] **Step 3: Redeploy grupo-vidalar to the new image**

Pull + recreate the stack (Portainer or compose) so `grupo-vidalar-app-1` runs the new `:latest`. Then confirm the sentinel is in the running container:
```bash
docker exec grupo-vidalar-app-1 grep -c 'AVUZ-AUDIO-CHUNK-V1' /var/www/html/apps/integration_openai/lib/Service/OpenAiAPIService.php
```
Expected: `≥ 4` (the sentinel appears in each new block). Also re-confirm the pin survived:
```bash
docker exec grupo-vidalar-app-1 grep '<version>' /var/www/html/apps/integration_openai/appinfo/info.xml
```
Expected: `4.5.1.3`.

- [ ] **Step 4: e2e — a fresh >70 min recording transcribes clean (definitive gate)**

Trigger (or await) a Talk recording longer than 70 min (forces ≥2 segments). Watch the worker:
```bash
docker exec grupo-vidalar-app-1 php occ taskprocessing:task:list --output=json \
  | jq -r '.[] | select(.type=="core:audio2text") | "\(.id)\t\(.status)\t\(.userId)"'
docker exec grupo-vidalar-app-1 grep -iE 'AVUZ-AUDIO-CHUNK|audio2text|413|segment' /var/www/html/data/nextcloud.log | tail -30
```
Expected: task ends `STATUS_SUCCESSFUL`, **no 413**, transcript posted to the Talk chat; log shows no `[avuz] extracted audio still …` and no `413`. If a real >70 min recording isn't readily available, upload a >24 MB audio file and run `occ` transcription against it as a proxy.

- [ ] **Step 5: Recover the two previously-failed recordings (tasks 11, 12)**

These are STATUS_FAILED, not RUNNING-orphans — do NOT re-arm the dead task/`oc_jobs` rows (that recipe is for stuck RUNNING). Recover by re-triggering a fresh transcription of the surviving `.webm` under the fixed code.

First locate each recording + owner (task 11 = `luis@raiven.com.br`, task 12 = `adm@grupovidalar.com.br`):
```bash
docker exec grupo-vidalar-app-1 php occ user:list | grep -iE 'luis|adm@grupovidalar'
docker exec grupo-vidalar-app-1 bash -lc 'ls -la data/*/files/Talk/Recording/*/ 2>/dev/null | grep -i webm'
```
Then, for each recording, schedule a new `core:audio2text` task against that file for its owner (exact invocation — Talk's "retry summary" action vs a direct `occ` task schedule — to be confirmed against this instance in the execution session; verify the `.webm` path + owner uid first). Confirm the new task reaches `STATUS_SUCCESSFUL` and the transcript posts.

- [ ] **Step 6: Update memory**

Append the outcome to the `talk-ai-stt-chain` memory: chunking shipped (`AVUZ-AUDIO-CHUNK-V1`, pin 4.5.1.3), long-call 413 resolved, e2e-verified date, and the deploy-gate (CLI 3072M) dependency.

---

## Self-Review

**Spec coverage:**
- 48k-only extract + streamed input → Task 1 ✓
- `segmentAudio` (60 min, `-c copy`, sort) → Task 2 ✓
- `transcribeWithRetry` transient-only, fail-fast 4xx → Task 3 ✓
- `transcribeFile` loop + trim + single-space join + `finally` cleanup → Task 4 ✓
- ffmpeg-fallback (segmentation fails → single upload) → Task 2 Step 1 + Task 4 `$isSegmented` ✓
- Version pin 4.5.1.3 + submodule pointer → Task 5 ✓
- Build/deploy/recover/e2e + OOM deploy-gate → Task 6 ✓
- Quota unchanged (per-chunk `transcribe` records its own) → no task needed, noted in spec ✓
- Tests items 1–8 in spec → mapped: 1/2 (Task 4 Step 3 pipeline), 3/4/5 retry (Task 3 Step 3 classifier), 6 fallback (Task 2 Step 3 + Task 4 logic), 7 trim/join (Task 4 Step 3), 8 cleanup (Task 4 Step 3). NC-harness integration variants deferred to staging e2e per Global Constraints ✓

**Placeholder scan:** one deliberate open item — Task 6 Step 5's exact re-trigger invocation is pinned to "confirm against the instance," matching the spec's stated plan-level detail (the mechanism depends on live Talk/occ state that can't be assumed here). All code steps show complete code. No TBD/TODO in code.

**Type consistency:** `extractAudioForWhisper(File): ?string`, `segmentAudio(string): array`, `transcribeWithRetry(?string,string,bool,string,string): string`, `transcribe(...)` and `transcribeFile(...)` signatures consistent across Tasks 1–4. `$sizeLimit = 24*1024*1024`, `segment_time 3600`, `48k` consistent with Global Constraints. Sentinel `AVUZ-AUDIO-CHUNK-V1` uniform.
