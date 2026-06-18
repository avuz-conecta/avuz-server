# Audio-extraction overlay for integration_openai

**Date:** 2026-06-18
**Status:** Approved design, pending implementation plan
**Owner:** Patrick Rezende

## Problem

Nextcloud Talk call recordings that fail transcription with:

```
413: Maximum content size limit (26214400) exceeded (26357664 bytes read)
```

Root cause (proven empirically, 2026-06-17):

- `spreed/lib/Service/RecordingService.php:166` schedules a core `audio2text`
  TaskProcessing job with the **whole recording fileNode** as input. NC core
  does not extract audio.
- `integration_openai` 4.5.1 (the STT provider) `transcribeFile()` calls
  `$file->getContent()` and POSTs the **entire file raw** — no ffmpeg, no
  chunking, no size check.
- A video call recording is a ~190MB webm (VP8 video + Opus audio). The whole
  video is sent to OpenAI Whisper, which has a hard 25MB (26214400 bytes) cap →
  always `413`.
- The audio track inside that webm is only ~7.4MB (Opus, 24kbps mono — the bot
  already caps it). Proven: extracting it with `ffmpeg -map 0:a -c copy` to
  `.ogg` and POSTing the 7.4MB file returns `200 OK`.

The `26357664 bytes read` number is OpenAI's read-abort cutoff, not the file
size — it varied run-to-run on the same 189MB file (26357664, then 26325230).

No upstream fix exists: NC issues #203/#205 are open; PR #204 (same ffmpeg
webm→ogg approach) was closed unmerged (maintainer wanted php-ffmpeg, not a
shell call). We fix it ourselves via the existing Docker overlay pattern.

## Goal

Transcribe the **audio**, not the video, while keeping video recordings intact
and keeping the current STT provider chain (`AI_STT_*` → OpenAI or any
OpenAI-compatible endpoint). The size cap then stops mattering on every
provider.

## Non-goals

- Changing the STT provider, self-hosting Whisper, or renting a GPU.
- Touching the talk-recording bot's audio bitrate cap (stays as-is, harmless).
- Switching Talk to audio-only recording (user wants to keep video).
- Changing `spreed` (the fix lives entirely in `integration_openai`).

## Approach

Overlay `integration_openai`'s `OpenAiAPIService::transcribeFile()` to extract a
compact audio file with ffmpeg before the upload, only when the input warrants
it. Delivered through the same build-time-copy + runtime-reapply + sentinel
mechanism already used for the `spreed` overlay.

This was chosen over overlaying `spreed` because it has the smallest blast
radius (one method, at the byte boundary just before the POST), produces no
stray Nextcloud files in the user's Talk folder, and works regardless of which
STT provider `AI_STT_*` points at.

## Design

### Interception point

File: `apps/integration_openai/lib/Service/OpenAiAPIService.php`
Method: `transcribeFile(string $userId, File $file, ...)`

Today the method does, in effect:

```php
return $this->transcribe($userId, $file->getContent(), $translate, $model, $userProvidedModel);
```

We replace the `$file->getContent()` argument with bytes that have been
audio-extracted when needed.

### Trigger (extract only when needed)

`integration_openai` is the STT provider for **all** NC `audio2text` tasks, not
just Talk, so an already-small audio file from another flow must pass through
untouched.

```
isVideo = str_starts_with($file->getMimeType(), 'video/')
tooBig  = $file->getSize() > 24 * 1024 * 1024   // headroom under OpenAI's 25MB cap
extract = isVideo || tooBig
```

If `extract` is false: behave exactly as today (send `$file->getContent()`).

### Extraction

Output format is **mp3**, not ogg. integration_openai's `transcribe()` sends the
multipart upload with a hardcoded filename `file.mp3`, and OpenAI's validator
rejects by extension (proven: a `.opus` extension returns 400). Sending ogg
bytes labeled `file.mp3` risks a 400, so we re-encode to mp3 to match. This
costs the stream-copy shortcut, but re-encoding a single call's audio is a few
seconds and removes the filename-mismatch risk. (If the deployed source turns
out to let the filename follow the input — verified in implementation Task 1 —
ogg stream-copy can be restored as a faster path.)

1. Write `$file->getContent()` to a unique temp input file in
   `sys_get_temp_dir()`.
2. Re-encode audio only, mono, to mp3:
   ```
   ffmpeg -nostdin -y -i <in> -vn -ac 1 -c:a libmp3lame -b:a 48k <out>.mp3
   ```
3. If `<out>.mp3` is still > 24MB (very long call), re-encode lower:
   ```
   ffmpeg -nostdin -y -i <in> -vn -ac 1 -c:a libmp3lame -b:a 24k <out>.mp3
   ```
4. Read `<out>.mp3` bytes and pass them to `transcribe()` in place of
   `$file->getContent()`. Filename stays `file.mp3` (unchanged from upstream).

ffmpeg is invoked via `Symfony\Component\Process\Process` (already available in
NC) with arguments as an array — no shell string, no injection surface.

### Temp-file lifecycle and error handling

- Temp input and output files use unique names and are deleted in a `finally`
  block — on success or on any throw.
- If ffmpeg is missing or exits non-zero, log a warning and **fall back to the
  original behavior** (send `$file->getContent()`). The result is never worse
  than today: worst case is the same `413`, now clearly logged with the reason.
- ffmpeg is confirmed present in the NC container (used directly this session).

### Delivery (mirrors the existing spreed overlay)

- New overlay tree:
  `docker/overlays/integration_openai/lib/Service/OpenAiAPIService.php`.
- Sentinel comment in the overlaid file: `AVUZ-AUDIO-EXTRACT-V1`.
- `integration_openai` is installed from the appstore at runtime
  (`docker/entrypoint.sh:360`), so a build-time copy alone would be clobbered.
  Add `reapply_avuz_openai_overlay()` (cp overlay tree → app dir), called:
  - after the appstore install of `integration_openai`, and
  - after `occ app:update` runs (same spots the spreed reapply already covers).
- `verify_avuz_patches()` greps the running container's file for
  `AVUZ-AUDIO-EXTRACT-V1` and fails fast if absent, exactly like the
  `AVUZ-CHUNKED-UPLOAD-V1` check.

## Verification

- **End-to-end:** run the real 198MB webm through the live transcription flow →
  expect `200` and a saved transcript (no `413`).
- **Trigger off:** a small `.mp3` (non-video, under 24MB) passes through
  untouched — ffmpeg is not invoked.
- **Trigger on:** a video input invokes extraction and sends `audio.ogg`.
- **Sentinel:** `verify_avuz_patches()` passes on a fresh container build and
  after an app update.

## Risks

- **Appstore app update changes the method signature.** Mitigation: the overlay
  pins a known-good `OpenAiAPIService.php`; the sentinel check surfaces drift on
  every boot. Pin the integration_openai version if updates prove disruptive.
- **Very long calls (>~2h) still exceed 24MB even at 24k mp3.** Mitigation: the
  worst case is the same `413` as today, now logged with the audio size. A
  duration-aware bitrate is deliberately out of scope (YAGNI) until a real call
  hits it.
- **Hardcoded `file.mp3` filename assumption is wrong** in the deployed source.
  Mitigation: implementation Task 1 reads the deployed `transcribe()` to confirm
  the filename before finalizing the output format.
