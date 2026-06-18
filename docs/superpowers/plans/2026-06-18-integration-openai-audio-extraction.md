# integration_openai Audio-Extraction Fork — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Talk video recordings from 413-ing on transcription by extracting a small mp3 audio track before integration_openai uploads to the STT provider — delivered as a version-pinned fork shipped via git submodule.

**Architecture:** Fork `nextcloud/integration_openai` at the deployed version into `avuz-conecta/integration_openai`, patch `OpenAiAPIService::transcribeFile` to ffmpeg-extract a sub-cap mp3 when the input is video/oversized, bump the app version so the store can't update over it, and wire the fork into `avuz-server` as a submodule at `apps/integration_openai` (replacing the runtime App Store install).

**Tech Stack:** PHP 8 (Nextcloud app), `Symfony\Component\Process`, ffmpeg (present in the NC container), bash (`docker/entrypoint.sh`), git submodules, Docker.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-18-integration-openai-audio-extraction-design.md`.
- Do NOT change the STT provider, spreed, the talk-recording bot, or core NC.
- Extraction triggers ONLY when `mime starts with video/` OR `size > 24*1024*1024` (24 MB). Otherwise send `$file->getContent()` unchanged.
- Output format is **mp3** (matches integration_openai's hardcoded `file.mp3` upload filename — verify in Task 2 Step 4).
- On any ffmpeg failure or missing ffmpeg: log a warning and fall back to the original raw upload. Never throw from the extraction path.
- Sentinel string (exact, verbatim): `AVUZ-AUDIO-EXTRACT-V1`.
- All temp files in `sys_get_temp_dir()`, unique names, unlinked on every path.
- The fork's `appinfo/info.xml` `<version>` must be ≥ the App Store version so `occ app:update --all` never replaces it (e.g. upstream `4.5.1` → `4.5.1.1`).
- avuz-server branch: `avuz/stt-openai-default`. Upstream fork remote: `nextcloud/integration_openai`; fork: `avuz-conecta/integration_openai`, branch `avuz`.

---

### Task 1: Extraction recipe + standalone regression test

Proves the exact ffmpeg command the PHP will run produces a valid, sub-cap mp3 from the real 198MB recording — the only logic testable without a Nextcloud bootstrap.

**Files:**
- Create (in avuz-server): `scripts/test-audio-extract.sh`

**Interfaces:**
- Produces: the mp3 recipe (mono, 48k → 24k fallback) reused verbatim in the PHP helper (Task 2 Step 6).

- [ ] **Step 1: Write the test/extraction script**

Create `scripts/test-audio-extract.sh`:

```bash
#!/usr/bin/env bash
# AVUZ-AUDIO-EXTRACT-V1 — regression test for the Whisper audio-extraction recipe.
# Usage: scripts/test-audio-extract.sh <input-media-file>
# Asserts: produces a non-empty mp3, <= 24MB, decodable by ffprobe.
set -euo pipefail

IN="${1:?usage: test-audio-extract.sh <input-media-file>}"
LIMIT=$((24 * 1024 * 1024))
OUT="$(mktemp --suffix=.mp3)"
trap 'rm -f "$OUT"' EXIT

extract() { # $1 = bitrate
    ffmpeg -nostdin -y -i "$IN" -vn -ac 1 -c:a libmp3lame -b:a "$1" "$OUT" >/dev/null 2>&1
}

extract 48k
SIZE=$(stat -c %s "$OUT")
if [ "$SIZE" -gt "$LIMIT" ]; then
    echo "48k output ${SIZE}B > limit, retrying at 24k"
    extract 24k
    SIZE=$(stat -c %s "$OUT")
fi

[ "$SIZE" -gt 0 ] || { echo "FAIL: empty output"; exit 1; }
[ "$SIZE" -le "$LIMIT" ] || { echo "FAIL: ${SIZE}B still exceeds ${LIMIT}B"; exit 1; }
ffprobe -v error -select_streams a:0 -show_entries stream=codec_name \
    -of default=nk=1:nw=1 "$OUT" | grep -q mp3 || { echo "FAIL: not a valid mp3 audio stream"; exit 1; }

echo "PASS: ${SIZE} bytes mp3 (limit ${LIMIT})"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/test-audio-extract.sh`

- [ ] **Step 3: Run against the real recording (on the staging host)**

On `avuz-conecta-hml`, with `/tmp/rec.webm` copied out of the container:

Run: `bash scripts/test-audio-extract.sh /tmp/rec.webm`
Expected: `PASS: <N> bytes mp3 (limit 25165824)` — N well under 24MB (~10-15MB at 48k mono for a 42-min call).

- [ ] **Step 4: Commit**

```bash
git add scripts/test-audio-extract.sh
git commit -m "test: standalone Whisper audio-extraction recipe (mp3, <24MB)"
```

---

### Task 2: Fork repo — patch + version pin

Done in the **fork repo**, not avuz-server. Produces the patched, version-bumped app the submodule will point at.

**Files (in `avuz-conecta/integration_openai`, branch `avuz`):**
- Modify: `lib/Service/OpenAiAPIService.php`
- Modify: `appinfo/info.xml` (`<version>`)

**Interfaces:**
- Consumes: upstream `OpenAiAPIService` (`transcribeFile` + `transcribe` signatures, the injected PSR logger property).
- Produces: patched `transcribeFile()` + private `extractAudioForWhisper(File $file): ?string`; version bumped ≥ store.

- [ ] **Step 1: Determine the deployed version**

On the staging host:
```bash
docker exec avuz-conecta-app-1 sh -c "grep -m1 '<version>' /var/www/html/apps/integration_openai/appinfo/info.xml"
```
Record it (call it `$VER`, e.g. `4.5.1`).

- [ ] **Step 2: Fork upstream at that version**

```bash
gh repo fork nextcloud/integration_openai --org avuz-conecta --clone
cd integration_openai
git checkout "v$VER" -b avuz   # tag name is typically v<version>; adjust if upstream differs
```
If no matching tag exists, branch from the commit whose `appinfo/info.xml` matches `$VER`.

- [ ] **Step 3: Confirm the baseline matches what's deployed**

```bash
diff <(git show HEAD:lib/Service/OpenAiAPIService.php) \
     <(docker -H ssh://avuz-conecta-hml exec avuz-conecta-app-1 cat /var/www/html/apps/integration_openai/lib/Service/OpenAiAPIService.php)
```
(Or `docker cp` the deployed file and `diff` locally.) Expected: identical, or only trivial whitespace. If they differ materially, the appstore build diverges from the tag — reconcile before patching.

- [ ] **Step 4: Reconcile three facts in the file (read, do not assume)**

1. `transcribeFile(...)` exact signature and that its body calls `transcribe(... $file->getContent() ...)`.
2. The injected logger property name (PSR `LoggerInterface`). The code below assumes `$this->logger` — adjust if different.
3. **The multipart filename used by `transcribe()`/`request()`.** If hardcoded `file.mp3`, the mp3 output is correct. If it derives from the input, note it — ogg stream-copy becomes a faster option (not required).

- [ ] **Step 5: Add the Process import**

Near the other `use` statements in `lib/Service/OpenAiAPIService.php`, add if absent:

```php
use Symfony\Component\Process\Process;
```

- [ ] **Step 6: Add the private extraction helper**

Add to the class (replace `$this->logger` if Step 4 found a different name):

```php
	/**
	 * AVUZ-AUDIO-EXTRACT-V1
	 * Re-encode oversized / video inputs to a small mono mp3 so the upload stays
	 * under OpenAI Whisper's 25MB cap. Returns a temp mp3 path the caller MUST
	 * unlink, or null meaning "send the original bytes unchanged".
	 */
	private function extractAudioForWhisper(File $file): ?string {
		$sizeLimit = 24 * 1024 * 1024; // headroom under the 25MB (26214400) cap
		$isVideo = str_starts_with((string)$file->getMimeType(), 'video/');
		if (!$isVideo && $file->getSize() <= $sizeLimit) {
			return null;
		}

		$tmpIn = tempnam(sys_get_temp_dir(), 'avuz_stt_in_');
		$tmpOut = tempnam(sys_get_temp_dir(), 'avuz_stt_out_') . '.mp3';
		try {
			file_put_contents($tmpIn, $file->getContent());

			$encode = function (string $bitrate) use ($tmpIn, $tmpOut): Process {
				$p = new Process(['ffmpeg', '-nostdin', '-y', '-i', $tmpIn,
					'-vn', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', $bitrate, $tmpOut]);
				$p->setTimeout(1800);
				$p->run();
				return $p;
			};

			$p = $encode('48k');
			if (!$p->isSuccessful() || !is_file($tmpOut) || filesize($tmpOut) === 0) {
				throw new \RuntimeException('ffmpeg mp3 encode failed: ' . $p->getErrorOutput());
			}
			if (filesize($tmpOut) > $sizeLimit) {
				$p = $encode('24k');
				if (!$p->isSuccessful() || filesize($tmpOut) === 0) {
					throw new \RuntimeException('ffmpeg mp3 re-encode failed: ' . $p->getErrorOutput());
				}
			}

			@unlink($tmpIn);
			return $tmpOut;
		} catch (\Throwable $e) {
			@unlink($tmpIn);
			@unlink($tmpOut);
			$this->logger->warning('[avuz] Whisper audio extraction failed, sending original file: ' . $e->getMessage(), ['app' => 'integration_openai']);
			return null;
		}
	}
```

- [ ] **Step 7: Patch transcribeFile**

Replace the body (keep the signature exactly as found in Step 4):

```php
		// AVUZ-AUDIO-EXTRACT-V1: extract a small mp3 from video/oversized inputs
		$extracted = $this->extractAudioForWhisper($file);
		if ($extracted === null) {
			return $this->transcribe($userId, $file->getContent(), $translate, $model, $userProvidedModel);
		}
		try {
			return $this->transcribe($userId, file_get_contents($extracted), $translate, $model, $userProvidedModel);
		} finally {
			@unlink($extracted);
		}
```

(Match the real `transcribe(...)` argument order if it differs — pass the extracted bytes where `$file->getContent()` was.)

- [ ] **Step 8: Bump the app version**

In `appinfo/info.xml`, set `<version>` to `$VER` + `.1` (e.g. `4.5.1` → `4.5.1.1`). This keeps it ≥ store so `app:update --all` skips it.

- [ ] **Step 9: Lint**

```bash
php -l lib/Service/OpenAiAPIService.php
grep -c AVUZ-AUDIO-EXTRACT-V1 lib/Service/OpenAiAPIService.php   # expect 2
```
Expected: `No syntax errors detected`, and `2`.

- [ ] **Step 10: Commit + push the fork**

```bash
git add lib/Service/OpenAiAPIService.php appinfo/info.xml
git commit -m "avuz: extract audio mp3 before Whisper upload; pin version (fix Talk 413)"
git push -u origin avuz
```

---

### Task 3: Wire the fork into avuz-server as a submodule

**Files (in avuz-server):**
- Modify: `.gitignore` (whitelist `apps/integration_openai`)
- Create: `.gitmodules` entry + submodule at `apps/integration_openai`
- Modify: `docker/entrypoint.sh` (drop store install ~line 359-365; keep enable; add required sentinel entry in `verify_avuz_patches` ~line 60-64)
- Modify: `CLAUDE.md` (fresh-checkout submodule step)
- Modify: `Dockerfile` (comment only, near the spreed overlay ~line 22)

**Interfaces:**
- Consumes: the fork's `avuz` branch (Task 2).
- Produces: `apps/integration_openai` present in the image at build; no App Store install at runtime.

- [ ] **Step 1: Whitelist the app path in .gitignore**

After the existing `!/apps/...` whitelist block, add:

```gitignore
!/apps/integration_openai
```

- [ ] **Step 2: Add the submodule**

```bash
git submodule add -b avuz https://github.com/avuz-conecta/integration_openai.git apps/integration_openai
git submodule update --init apps/integration_openai
```
Expected: `.gitmodules` gains an `[submodule "apps/integration_openai"]` entry; `apps/integration_openai` populated at the fork's `avuz` tip.

- [ ] **Step 3: Verify the sentinel + version landed via the submodule**

```bash
grep -c AVUZ-AUDIO-EXTRACT-V1 apps/integration_openai/lib/Service/OpenAiAPIService.php   # expect 2
grep -m1 '<version>' apps/integration_openai/appinfo/info.xml                            # expect the bumped version
```

- [ ] **Step 4: Remove the App Store install from entrypoint**

In the AI-provider block, delete the install conditional (it pulls the stock app over our fork):

Remove:
```bash
        if ! php occ app:list --enabled 2>/dev/null | grep -q "  - integration_openai"; then
            echo "Installing integration_openai from App Store..."
            php occ app:install integration_openai 2>/dev/null && echo "✓ integration_openai installed" \
                || echo "✗ integration_openai install failed (no internet?)"
        else
            echo "✓ integration_openai already present"
        fi
        php occ app:enable --force integration_openai 2>/dev/null || true
```

Replace with (app ships in the image; just enable it, offline-safe):
```bash
        # integration_openai ships as a version-pinned fork submodule (apps/),
        # not from the App Store. Just enable it.
        php occ app:enable --force integration_openai 2>/dev/null || true
```

- [ ] **Step 5: Add the required sentinel check**

In `verify_avuz_patches`, add to the `checks` array (REQUIRED — the app always ships in the image now):

```bash
        "AVUZ-AUDIO-EXTRACT-V1|/var/www/html/apps/integration_openai/lib/Service/OpenAiAPIService.php|integration_openai fork missing/clobbered — submodule not shipped or app:update replaced it (check appinfo version pin)"
```

- [ ] **Step 6: Document the submodule for fresh checkouts**

In `CLAUDE.md`, beside the existing `3rdparty` submodule init instruction, add `apps/integration_openai` to the submodule init step:

```bash
git submodule update --init --recursive 3rdparty apps/integration_openai
```
And note that `integration_openai` is now a vendored fork (not an App Store app), so it must NOT be added to the rsync bundled-apps loop.

- [ ] **Step 7: Add the Dockerfile comment**

Near the spreed overlay `cp` (~line 22), add:

```dockerfile
# NB: integration_openai is a version-pinned fork shipped as a git submodule at
# apps/integration_openai (NOT an App Store app, NOT an overlay). The version pin
# in its appinfo/info.xml keeps `occ app:update --all` from replacing it.
```

- [ ] **Step 8: Syntax-check entrypoint**

Run: `bash -n docker/entrypoint.sh`
Expected: no output, exit 0.

- [ ] **Step 9: Commit**

```bash
git add .gitignore .gitmodules apps/integration_openai docker/entrypoint.sh CLAUDE.md Dockerfile
git commit -m "feat: ship integration_openai as version-pinned fork submodule (fix Talk 413)"
```

---

### Task 4: Build, deploy, end-to-end + clobber verification

**Files:** none (operational).

- [ ] **Step 1: Build the staging image**

Ensure submodules are initialized in the working tree first (`git submodule update --init --recursive`), then:
Run: `./scripts/build-push.sh latest staging`
Expected: build + push succeed; image contains `apps/integration_openai` at the fork version.

- [ ] **Step 2: Redeploy and confirm boot sentinel + version**

```bash
docker exec avuz-conecta-app-1 grep -c AVUZ-AUDIO-EXTRACT-V1 /var/www/html/apps/integration_openai/lib/Service/OpenAiAPIService.php   # expect 2
docker exec avuz-conecta-app-1 sh -c "grep -m1 '<version>' /var/www/html/apps/integration_openai/appinfo/info.xml"                    # expect bumped version
```
And logs show `✓ Avuz patches present`.

- [ ] **Step 3: End-to-end — transcribe the real recording**

Trigger transcription of the 198MB recording through the normal Talk flow.
Expected: no `413` in `nextcloud.log`; a transcript is produced.
```bash
docker exec avuz-conecta-app-1 grep -i "Maximum content size\|413" /var/www/html/data/nextcloud.log | tail -5
```
Expected: no new 413 entries after the deploy timestamp.

- [ ] **Step 4: Clobber test — version pin holds**

```bash
docker exec avuz-conecta-app-1 php occ app:update --all
docker exec avuz-conecta-app-1 grep -c AVUZ-AUDIO-EXTRACT-V1 /var/www/html/apps/integration_openai/lib/Service/OpenAiAPIService.php
```
Expected: still `2` — the store did NOT replace our fork (proves the version pin). If it dropped to `0`, the pin failed; raise the bumped version above the store version.

- [ ] **Step 5: Trigger-off regression (small audio passes through)**

Transcribe a small (<24MB, non-video) audio file via any audio2text path.
Expected: success, no leftover temp files:
```bash
docker exec avuz-conecta-app-1 sh -c 'ls -1 /tmp/avuz_stt_* 2>/dev/null | wc -l'   # expect 0
```

- [ ] **Step 6: PR**

Open a PR from `avuz/stt-openai-default` into `avuz-customization` summarizing the fix and linking the spec. Note the new submodule in the PR body. Optionally open an upstream PR on `nextcloud/integration_openai` from the fork's `avuz` branch (resolves issues #203/#205); if merged, the fork can later be retired.

---

## Self-Review

- **Spec coverage:** problem/goal (Tasks 2-4), trigger (Task 2 Step 6), mp3 extraction recipe (Task 1, Task 2 Step 6), temp lifecycle/fallback (Task 2 Steps 6-7), fork + submodule + version-pin delivery (Tasks 2-3), drop App Store install (Task 3 Step 4), required sentinel (Task 3 Step 5), fresh-checkout docs (Task 3 Step 6), clobber verification (Task 4 Step 4). All spec sections map to a task.
- **Placeholders:** none — all code/commands concrete. The only "read and reconcile" step (Task 2 Step 4) is inherent to patching upstream source and states its fallback decision.
- **Type consistency:** `extractAudioForWhisper(File): ?string` defined Task 2 Step 6, consumed Step 7; sentinel `AVUZ-AUDIO-EXTRACT-V1` identical across Tasks 1-4; version-pin rule stated in Global Constraints and enforced in Task 2 Step 8 + verified Task 4 Step 4.
