# Chunked Whisper transcription — design

**Date:** 2026-07-14
**Sentinel:** `AVUZ-AUDIO-CHUNK-V1`
**Fork:** `avuz-conecta/integration_openai` branch `avuz` (submodule `apps/integration_openai`)
**Supersedes the size-ceiling behaviour of:** `2026-06-18-integration-openai-audio-extraction-design.md` (`AVUZ-AUDIO-EXTRACT-V1`)

## Problem

Talk call recordings on client **grupo-vidalar** run 2.5–3 h routinely. The
`AVUZ-AUDIO-EXTRACT-V1` patch extracts a mono mp3 before uploading to OpenAI
Whisper, downgrading 48k→24k when the result exceeds 24 MB. For long calls even
24k mono overflows OpenAI's **hard 25 MB (26214400 bytes) per-request cap**:

```
[avuz] extracted audio still 28763276 bytes (> 25165824); upload may 413
→ 413 Maximum content size limit (26214400) exceeded
→ core:audio2text task FAILED → user gets "transcript failed" push
```

Observed prod: tasks 11 (`luis@raiven`) and 12 (`adm@grupovidalar`) FAILED.
28.7 MB @ 24k mono ≈ a ~2h40m call. Bitrate downgrade bottoms out; no bitrate
fits an arbitrarily long call under a fixed per-request byte cap.

## Root cause

The cap is **per request**, not per bitrate. Trading quality for a few more
minutes only moves the ceiling. The durable fix is to remove the single-request
assumption: split the audio into time segments that each fit, transcribe each,
and join the text.

## Approach (chosen)

**Time-segment the extracted 48k mono mp3; transcribe each segment; join text.**

Chunking bounds upload size by segment *duration*, so the bitrate downgrade path
is deleted — always encode at **48k mono** (best quality; Whisper resamples to
16 kHz internally regardless). At CBR 48 kbps, 60 min ≈ 21.6 MB, safe headroom
under the 25 MB cap. Short calls produce a single segment (unchanged cost/path).

Rejected alternatives:
- *Keep bitrate fallback, only chunk when 24k overflows* — two code paths, more
  state, no benefit over always-segment (a short call is just 1 segment).
- *Lower the bitrate floor to 16k/12k* — still a fixed ceiling, only pushes the
  failure to ~4 h calls. Not durable.
- *Self-hosted Whisper (no cap)* — CPU too slow (1.5–2.5 h/call for large-v3),
  needs a GPU. Out of scope; see `talk-ai-stt-chain` memory.

## Components

`transcribeFile()` in `lib/Service/OpenAiAPIService.php` orchestrates. Two new
private helpers keep each unit single-purpose and independently testable.

| unit | responsibility | signature |
|---|---|---|
| `extractAudioForWhisper(File)` | video/oversized → **48k mono** mp3 temp path; else `null` (send raw). Drops the 24k downgrade block. | `?string` |
| `segmentAudio(string $mp3)` **new** | ffmpeg `-f segment` → ordered part paths under a temp dir. Returns `[mp3]` unchanged if segmentation fails or yields nothing (fallback = never worse than single-file). | `string[]` |
| `transcribeWithRetry(?string,string,bool,string,string)` **new** | one chunk's bytes → text; up to 2 retries on transient failure with backoff; rethrows after exhaustion. | `string` |
| `transcribeFile()` | extract → segment → loop `transcribeWithRetry` in order → join with `' '` → cleanup all temps in `finally`. | `string` |

### Data flow

```
transcribeFile(File)
 ├─ extractAudioForWhisper → $mp3 (or null → single transcribe of raw bytes, as today)
 ├─ segmentAudio($mp3)     → [part_000.mp3, part_001.mp3, …]  (1+ )
 ├─ for each part (in order):
 │    transcribeWithRetry(file_get_contents(part), …) → text
 │    accumulate
 ├─ join texts with ' '
 └─ finally: unlink every part, the parts dir, and $mp3
```

### ffmpeg commands

Extract (unchanged shape, 48k only, no downgrade):
```
timeout 1800 ffmpeg -nostdin -y -i <in> -vn -ac 1 -c:a libmp3lame -b:a 48k <out.mp3>
```

Segment (new; `-c copy` = no re-encode, fast, exact CBR sizing):
```
timeout 600 ffmpeg -nostdin -y -i <out.mp3> -f segment -segment_time 3600 \
  -c copy <dir>/part_%03d.mp3
```
`segment_time 3600` (60 min) → ~21.6 MB/part at 48k CBR. Parts read back via
`glob(dir/part_*.mp3)` sorted ascending (zero-padded `%03d` sorts correctly).

## Error handling

- **ffmpeg extract fails** → existing behaviour: log, return `null`, transcribe
  raw bytes (may 413 for huge raw video, but never worse than today).
- **ffmpeg segment fails / 0 parts** → log, fall back to `[$mp3]` (single upload).
- **Chunk fails after 2 retries** (transient 5xx/429/network, or a genuine 413)
  → rethrow → `core:audio2text` task FAILED + push. Same failure surface as
  today, now reached only on real errors, not on size.
- **A single segment still > 24 MB** (should not happen at 60 min/48k) → log
  warning, still attempt the upload (best effort).
- **Temp hygiene** → parts dir + source mp3 unlinked on every path via `finally`,
  matching the existing `AVUZ-AUDIO-EXTRACT-V1` discipline.

### Retry policy

`transcribeWithRetry`: attempt → on `Throwable` from `transcribe()`, retry after
a short sleep (attempt 1: ~2 s, attempt 2: ~5 s), max 2 retries (3 attempts
total). Rethrow the last exception if all fail. Backoff bounds are literals; no
config surface.

## Quota

`transcribe()` already records duration-based quota per call (from the
`verbose_json` `segments`). Each chunk records its own slice; the sum equals the
whole-call duration. No change.

## Testing (behaviour, not implementation)

Unit-level, mocking `transcribe()` and ffmpeg helpers:
1. **short input, single segment** → one `transcribe` call, returns its text.
2. **long input, 3 segments** → three ordered `transcribe` calls, texts joined
   with a space in order.
3. **chunk 2 transient-fails once then succeeds** → retried, full transcript
   returned (proves retry).
4. **chunk 2 fails all retries** → `transcribeFile` throws (proves atomic fail).
5. **segmentation fails** → falls back to single upload of the extracted mp3.
6. **all temp files unlinked** on both success and throw paths.

e2e on staging: a >70 min recording (forces ≥2 segments) → clean joined
transcript, no 413, temps gone.

## Delivery

1. Implement on fork branch `avuz`; commit with sentinel `AVUZ-AUDIO-CHUNK-V1`.
2. Bump `appinfo/info.xml` version pin **4.5.1.2 → 4.5.1.3** (keeps `app:update`
   from clobbering; must stay ≥ store version).
3. Update submodule pointer in avuz-server; commit.
4. Rebuild + push image: `./scripts/build-push.sh latest prod` (amd64, `:latest`).
5. Deploy to grupo-vidalar stack.
6. **Recover the 2 failed recordings** (tasks 11, 12): source `.webm` survives in
   each owner's `Talk/Recording/<token>/`. Re-arm the tasks (per
   `talk-recording-cf504-worker-oom` recovery recipe) or re-trigger transcription
   so the fixed code reprocesses them.

## Out of scope (YAGNI)

Seam overlap/dedup, `[gap]` partial-transcript markers, parallel chunk uploads,
self-hosted Whisper, any admin-configurable segment size or bitrate.
