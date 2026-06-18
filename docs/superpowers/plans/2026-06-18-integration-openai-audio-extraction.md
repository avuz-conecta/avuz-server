# integration_openai Audio-Extraction Overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Talk video recordings from 413-ing on transcription by extracting a small mp3 audio track before integration_openai uploads to the STT provider.

**Architecture:** Overlay one method (`OpenAiAPIService::transcribeFile`) in the runtime-installed `integration_openai` app. When the input is video or >24MB, ffmpeg re-encodes the audio track to a temp mp3 under the 25MB cap and that is uploaded instead of the raw file; otherwise behavior is unchanged. Delivery mirrors the existing spreed/files_downloadlimit overlay pattern: a full-file copy under `docker/overlays/`, reapplied at runtime, guarded by a boot-time sentinel check.

**Tech Stack:** PHP 8 (Nextcloud app), `Symfony\Component\Process`, ffmpeg (present in the NC container), bash (`docker/entrypoint.sh`), Docker.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-18-integration-openai-audio-extraction-design.md`.
- Do NOT change the STT provider, spreed, the talk-recording bot, or core NC.
- Extraction triggers ONLY when `mime starts with video/` OR `size > 24*1024*1024` (24 MB). Otherwise send `$file->getContent()` unchanged.
- Output format is **mp3** (matches integration_openai's hardcoded `file.mp3` upload filename).
- On any ffmpeg failure or missing ffmpeg: log a warning and fall back to the original raw upload. Never throw from the extraction path.
- Sentinel string (exact, verbatim): `AVUZ-AUDIO-EXTRACT-V1`.
- All temp files in `sys_get_temp_dir()`, unique names, unlinked on every path.
- `integration_openai` is installed from the appstore at RUNTIME (`docker/entrypoint.sh` ~line 360). It is NOT present at Docker build time, so there is NO build-time `cp` for it — only runtime reapply.
- Branch: `avuz/stt-openai-default`. Commit per task.

---

### Task 1: Extraction recipe + standalone regression test

Proves the exact ffmpeg command the PHP will run produces a valid, sub-cap mp3 from the real 198MB recording. This is the only part of the logic testable without a Nextcloud bootstrap, so it is locked in first.

**Files:**
- Create: `scripts/test-audio-extract.sh`

**Interfaces:**
- Produces: a shell recipe (mono mp3, 48k → 24k fallback) reused verbatim inside the PHP helper in Task 2.

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

On `avuz-conecta-hml`, with `/tmp/rec.webm` already copied out of the container this session:

Run: `bash scripts/test-audio-extract.sh /tmp/rec.webm`
Expected: `PASS: <N> bytes mp3 (limit 25165824)` — N well under 24MB for a 42-min call (~10-15MB at 48k mono).

- [ ] **Step 4: Commit**

```bash
git add scripts/test-audio-extract.sh
git commit -m "test: standalone Whisper audio-extraction recipe (mp3, <24MB)"
```

---

### Task 2: integration_openai overlay (the patched method)

**Files:**
- Create: `docker/overlays/integration_openai/lib/Service/OpenAiAPIService.php` (full-file copy of the deployed app file, patched)
- Reference: spec §Design

**Interfaces:**
- Consumes: the deployed `OpenAiAPIService` class (signature of `transcribeFile` and `transcribe`, the injected PSR logger property).
- Produces: patched `transcribeFile()` + private `extractAudioForWhisper(File $file): ?string`. No public signature changes.

- [ ] **Step 1: Pull the EXACT deployed file as the overlay base**

The app is not in the repo (gitignored, runtime-installed). On the staging host:

```bash
docker cp avuz-conecta-app-1:/var/www/html/apps/integration_openai/lib/Service/OpenAiAPIService.php ./OpenAiAPIService.php
docker exec avuz-conecta-app-1 cat /var/www/html/apps/integration_openai/appinfo/info.xml | grep -m1 '<version>'
```

Copy `OpenAiAPIService.php` into `docker/overlays/integration_openai/lib/Service/` in the worktree. Record the version (expected `4.5.x`) in the commit message.

- [ ] **Step 2: Reconcile three facts in the pulled file (read, do not assume)**

Open the file and confirm:
1. `transcribeFile(...)` exact signature and that its body calls `transcribe(... $file->getContent() ...)`.
2. The injected logger property name (PSR `LoggerInterface`). The code below assumes `$this->logger` — if it differs (e.g. `$this->logger` vs a different name), adjust.
3. **The multipart filename used by `transcribe()`/`request()`.** If it is hardcoded `file.mp3`, the mp3 output below is correct. If the filename instead derives from the input, note it in the commit — ogg stream-copy could be used as a faster alternative (not required; mp3 is safe either way).

- [ ] **Step 3: Ensure the Process import is present**

Near the other `use` statements, add if absent:

```php
use Symfony\Component\Process\Process;
```

- [ ] **Step 4: Add the private extraction helper**

Add this method to the class (uses only `$this->logger`; replace the logger reference if Step 2 found a different name):

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

- [ ] **Step 5: Patch transcribeFile to use the helper**

Replace the body of `transcribeFile(...)`. Keep the existing signature exactly as found in Step 2; only the body changes:

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

(If the found `transcribe(...)` argument order differs, match it — pass the extracted bytes where `$file->getContent()` was.)

- [ ] **Step 6: Lint the overlay file in the container**

```bash
docker cp docker/overlays/integration_openai/lib/Service/OpenAiAPIService.php avuz-conecta-app-1:/tmp/lint.php
docker exec avuz-conecta-app-1 php -l /tmp/lint.php
```
Expected: `No syntax errors detected in /tmp/lint.php`

- [ ] **Step 7: Confirm the sentinel is present**

Run: `grep -c AVUZ-AUDIO-EXTRACT-V1 docker/overlays/integration_openai/lib/Service/OpenAiAPIService.php`
Expected: `2` (helper docblock + transcribeFile comment).

- [ ] **Step 8: Commit**

```bash
git add docker/overlays/integration_openai/lib/Service/OpenAiAPIService.php
git commit -m "feat: integration_openai overlay — extract audio mp3 before Whisper upload (base vX.Y.Z)"
```

---

### Task 3: entrypoint wiring — reapply + boot-time sentinel + Dockerfile note

**Files:**
- Modify: `docker/entrypoint.sh` (`verify_avuz_patches` ~line 55; add `reapply_avuz_openai_overlay` after `reapply_avuz_files_downloadlimit_overlay` ~line 103; call sites ~line 366 and the two `app:update --all` blocks ~line 457 and ~line 612)
- Modify: `Dockerfile` (explanatory comment only, near the spreed overlay `cp` ~line 25)

**Interfaces:**
- Consumes: overlay tree shipped at `/var/www/html/docker/overlays/integration_openai` (via the existing `COPY . /var/www/html/`).
- Produces: `reapply_avuz_openai_overlay()`; an optional-aware `verify_avuz_patches`.

- [ ] **Step 1: Make verify_avuz_patches support optional (skip-if-absent) checks**

Replace the `verify_avuz_patches` function body so entries may carry a 4th `optional` field. Required entries keep today's strict behavior; optional entries are skipped when their target file is absent (the app may not be installed):

```bash
verify_avuz_patches() {
    # Each entry: "<sentinel>|<target-file>|<recovery-hint>[|optional]".
    # A missing required target = refuse boot. A missing 'optional' target
    # (e.g. a runtime-installed app that isn't present) = skip silently.
    local checks=(
        "AVUZ-CHUNKED-UPLOAD-V1|/var/www/html/apps/spreed/lib/Controller/RecordingController.php|spreed overlay missing — redeploy from latest image or rerun reapply_avuz_spreed_overlay"
        "Upload in progress — do not close this tab|/var/www/html/dist/files-main.js|files-main.js was not rebuilt with the upload-leave-warning patch — run 'npm run build' before baking the image"
        "admin-download-limit|/var/www/html/apps/files_downloadlimit/templates/admin.php|files_downloadlimit overlay missing — upstream 2.0.0 tarball drops this template (GH nextcloud/files_downloadlimit#421); redeploy or rerun reapply_avuz_files_downloadlimit_overlay"
        "AVUZ-AUDIO-EXTRACT-V1|/var/www/html/apps/integration_openai/lib/Service/OpenAiAPIService.php|integration_openai audio-extract overlay missing — rerun reapply_avuz_openai_overlay|optional"
    )
    local failed=0
    for entry in "${checks[@]}"; do
        local sentinel="${entry%%|*}"
        local rest="${entry#*|}"
        local target="${rest%%|*}"
        rest="${rest#*|}"
        local hint="${rest%%|*}"
        local optional="${rest#*|}"
        [ "$optional" = "$hint" ] && optional=""   # no 4th field present
        if [ ! -f "$target" ]; then
            if [ "$optional" = "optional" ]; then
                continue
            fi
            echo "✗ AVUZ PATCH MISSING: target $target not found"
            echo "  $hint"
            failed=1
            continue
        fi
        if ! grep -q "$sentinel" "$target" 2>/dev/null; then
            echo "✗ AVUZ PATCH MISSING: sentinel '$sentinel' not found in $target"
            echo "  $hint"
            failed=1
        fi
    done
    if [ "$failed" -ne 0 ]; then
        echo "  Refusing to boot — image may be corrupted."
        exit 1
    fi
    echo "✓ Avuz patches present"
}
```

- [ ] **Step 2: Add reapply_avuz_openai_overlay**

Immediately after the closing `}` of `reapply_avuz_files_downloadlimit_overlay` (~line 111), add:

```bash
# Reapply the integration_openai overlay onto /var/www/html/apps/integration_openai/.
# integration_openai is installed from the App Store at runtime, so this can only
# run after the install/enable step; it no-ops if the app isn't present.
reapply_avuz_openai_overlay() {
    local overlay="/var/www/html/docker/overlays/integration_openai"
    local app="/var/www/html/apps/integration_openai"
    if [ ! -d "$app" ]; then
        echo "• integration_openai not installed — skipping overlay reapply"
        return 0
    fi
    if [ -d "$overlay" ]; then
        cp -R "$overlay/." "$app/"
        chown -R www-data:www-data "$app"
        echo "✓ Avuz integration_openai overlay reapplied"
    else
        echo "✗ Avuz overlay missing at $overlay — image may be corrupted"
    fi
}
```

- [ ] **Step 3: Reapply right after the app is enabled**

In the AI-provider block, immediately after the line:

```bash
        php occ app:enable --force integration_openai 2>/dev/null || true
```

add:

```bash
        reapply_avuz_openai_overlay
```

- [ ] **Step 4: Reapply after each `app:update --all`**

In BOTH places where the spreed/files_downloadlimit overlays are reapplied after `app:update --all` (the `run_avuz_configuration` block ~line 457-458 and the upgrade block ~line 612-613), add a third line alongside them:

```bash
    reapply_avuz_spreed_overlay
    reapply_avuz_files_downloadlimit_overlay
    reapply_avuz_openai_overlay
```

- [ ] **Step 5: Add the Dockerfile explanatory comment**

Near the spreed overlay `cp` (~line 22-25), add a comment so future maintainers know why integration_openai has no build-time copy:

```dockerfile
# NB: integration_openai is installed from the App Store at RUNTIME (see
# docker/entrypoint.sh), so it has no build-time overlay copy here — its overlay
# ships under docker/overlays/integration_openai and is applied by
# reapply_avuz_openai_overlay after the runtime install.
```

- [ ] **Step 6: Syntax-check the script**

Run: `bash -n docker/entrypoint.sh`
Expected: no output, exit 0.

- [ ] **Step 7: Verify the function parser logic with a dry sentinel run**

Run:
```bash
bash -c 'source <(sed -n "/^verify_avuz_patches()/,/^}/p" docker/entrypoint.sh); \
  command -v verify_avuz_patches >/dev/null && echo "function parses OK"'
```
Expected: `function parses OK`

- [ ] **Step 8: Commit**

```bash
git add docker/entrypoint.sh Dockerfile
git commit -m "feat: reapply + boot-verify integration_openai audio-extract overlay"
```

---

### Task 4: Build, deploy, end-to-end verification

**Files:** none (operational).

- [ ] **Step 1: Build the staging image**

Run: `./scripts/build-push.sh latest staging`
Expected: build + push succeed.

- [ ] **Step 2: Redeploy and confirm the sentinel passes at boot**

After redeploying the stack, check the container logs for:
```
✓ Avuz integration_openai overlay reapplied
✓ Avuz patches present
```
And confirm the patch landed:
```bash
docker exec avuz-conecta-app-1 grep -c AVUZ-AUDIO-EXTRACT-V1 /var/www/html/apps/integration_openai/lib/Service/OpenAiAPIService.php
```
Expected: `2`.

- [ ] **Step 3: End-to-end — transcribe the real recording**

Trigger transcription of the 198MB call recording through the normal Talk flow (re-run the summary/transcription on the existing recording, or record a fresh test call and let it finish).
Expected: NO `413` in `nextcloud.log`; a transcript is produced and saved. Confirm:
```bash
docker exec avuz-conecta-app-1 grep -i "Maximum content size\|413" /var/www/html/data/nextcloud.log | tail -5
```
Expected: no new 413 entries after the deploy timestamp.

- [ ] **Step 4: Trigger-off regression (small audio passes through)**

Transcribe a small (<24MB, non-video) audio file via any audio2text path.
Expected: success, and no `avuz_stt_` temp files left behind:
```bash
docker exec avuz-conecta-app-1 sh -c 'ls -1 /tmp/avuz_stt_* 2>/dev/null | wc -l'
```
Expected: `0`.

- [ ] **Step 5: Final commit / PR**

Open a PR from `avuz/stt-openai-default` into `avuz-customization` summarizing the fix and linking the spec.

---

## Self-Review

- **Spec coverage:** interception point (Task 2 Step 5), trigger (Task 2 Step 4 helper), extraction mp3 recipe (Task 1, Task 2 Step 4), temp lifecycle/fallback (Task 2 Step 4-5), delivery via overlay + reapply + sentinel (Task 3), verification incl. trigger-off and sentinel (Task 4). All spec sections map to a task.
- **Placeholders:** none — all code is concrete; the only "read and reconcile" step (Task 2 Step 2) is inherent to overlaying a file that lives outside the repo, and provides the fallback decision explicitly.
- **Type consistency:** `extractAudioForWhisper(File): ?string` defined in Task 2 Step 4 and consumed in Step 5; sentinel `AVUZ-AUDIO-EXTRACT-V1` identical across Task 2 (Steps 4,7,8), Task 3 (Steps 1,2), Task 4 (Step 2); `reapply_avuz_openai_overlay` defined Task 3 Step 2, called Steps 3-4.
