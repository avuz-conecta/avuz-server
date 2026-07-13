# Talk recording upload resilience — design

**Date:** 2026-07-13
**Status:** approved, pending implementation plan
**Repos:** `avuz-server` (spreed overlay) + `avuz-conecta/talk-recording` (bot fork)

## Problem

Talk call recordings are uploaded from the recording bot to Nextcloud through the
**public, Cloudflare-fronted** URL. Uploads are chunked (50 MB parts) to stay under
Cloudflare's 100 MB request-body cap. Cloudflare intermittently returns a **504** on a
single chunk (the request never reaches origin — absent from both NPM and NC access
logs). The bot's `uploadRecordingChunked` issues each POST with a raw
`requests.post(...).raise_for_status()` and **no retry**, so one transient 504 aborts the
whole upload and the recording is lost (file *and* downstream transcript/summary).

Observed 2026-07-10 on `grupo-vidalar`: a 49-min recording died on chunk 2 with a CF 504;
chunks 0,1 were stored, the ~347 MB source survived only in the bot's `/tmp`. Recovery
required an 8-step manual re-dispatch. See memory `talk-recording-cf504-worker-oom`.

**Not in scope:** bypassing Cloudflare (per-tenant static routing rejected as
unmaintainable) and the worker OOM (fixed separately, commit `5bba33f65aa`).

## Goal

Make the chunked upload survive transient Cloudflare 504s, and make the *rare* residual
failure trivial to re-trigger by hand. Correctness constraint: **never post a recording
to the conversation twice.**

## Preconditions

Chunk parts, the `.done` dedup markers, and `.lock` files all live on the app container's
**local** `datadirectory`. This assumes **a single Nextcloud app container per instance**
(or, if ever scaled horizontally, a **shared** chunk-storage volume across containers).
With N independent app containers behind NPM, chunks scatter across containers and finalize
cannot assemble them — chunked upload is already broken today under that topology, and the
file-based lock/marker would not synchronise across containers either. All current Avuz
clients are single-container; this must be re-checked before any horizontal-scale rollout.

## Approach

One resilience layer across the two existing pieces of the path — no new components.

```
bot: uploadRecordingChunked            server: storeChunkedFinalize (overlay)
  init      ──retry──────────────────▶  (unchanged)
  chunk     ──retry (idempotent)─────▶  writeChunk (overwrites index)
  finalize  ──retry (same uploadId)──▶  idempotent finalize (marker + lock)
```

Retry alone fixes the observed bug (chunk 504). Idempotent finalize closes the one
correctness trap it would otherwise open (a slow S3 assembly can push finalize past CF's
~100 s edge timeout → 504 → a naive retry re-stores → duplicate).

## Component 1 — server-side atomic chunk writes + idempotent finalize (avuz-server overlay)

**Files:**
- `docker/overlays/spreed/lib/Controller/RecordingController.php` — `storeChunkedFinalize`
- `docker/overlays/spreed/lib/Service/RecordingChunkedUploadService.php` — `writeChunk`
  (atomic), `finalize` (lock + dedup), new dedup/lock helpers, extended `sweepStale`
- `docker/entrypoint.sh` — update the spreed-overlay integrity check string to the bumped
  sentinel (see Sentinel below)

### Atomic chunk write (fixes the concurrent-retry corruption race)

A retried chunk can race the slow first attempt writing the **same** `NNNN.part` path;
`file_put_contents` is not atomic, so the two writers can interleave → corrupt part →
finalize size-mismatch. Fix: `writeChunk` writes to `NNNN.part.tmp.<rand>` then **atomic
`rename()`** to `NNNN.part`. `rename` is atomic on the local fs → last-writer-wins cleanly,
no interleave, and `finalize`'s glob of `NNNN.part` never matches a temp/partial file.

### Idempotent finalize

Dedup is keyed on the **recording**, not the transient uploadId:
`key = sha256(token ':' fileName)` (fileName from the upload's `.meta`, unique per recording
via its timestamp). Keying on the recording — not the uploadId — protects **both** the bot's
in-call finalize retry *and* a later manual `reupload` (which uses a fresh uploadId).

1. **Lock.** Exclusive `flock` on `<chunkRoot>/<token>/<key>.lock` around the critical
   section — serialises a retry (or a racing manual reupload) that arrives while the first
   finalize is still storing. `flock` is advisory, released when the fd closes (crash-safe).
2. **Short-circuit.** If `<chunkRoot>/<token>/<key>.done` exists → release, return HTTP 200
   without re-assembling or re-storing.
3. **Store once.** Assemble the uploadId's parts → `RecordingService::store(...)` → **write
   `<key>.done` as the very next operation** (JSON `{"finalizedAt": <unixtime>}`) → clean up
   the parts dir → release lock → return 200.

**Marker lifetimes.** `.done` is the durable dedup record — TTL **24 h** (covers same/next-day
manual recovery; beyond that the operator falls back to the check-first SOP). `.lock` is
transient — GC at **1 h**. Both live **outside** the `<uploadId>` parts dir so chunk cleanup
can't remove them. `sweepStale` is extended to unlink `.done` older than 24 h and `.lock`
older than 1 h — **TTL-gated**, so it can never remove a marker/lock that an active finalize
(seconds-to-minutes) is holding, avoiding the unlink-a-held-lock race.

**Sentinel:** bump the overlay integrity sentinel `AVUZ-CHUNKED-UPLOAD-V1` →
`AVUZ-CHUNKED-UPLOAD-V2` so a deployed image can be identified as carrying idempotent
finalize. This requires updating the matching verification string in
`docker/entrypoint.sh` (the spreed-overlay integrity check) in the same change — the two
must stay in lockstep or the entrypoint check fails.

## Component 2 — bot-side retry (talk-recording fork)

**File:** `src/nextcloud/talk/recording/BackendNotifier.py` — `uploadRecordingChunked`.

Wrap all three POSTs (`init`, each `chunk`, `finalize`) in a retry helper that mirrors the
existing `doRequest(retries=3)` pattern:

- **Retry on:** `requests.ConnectionError`/`Timeout`, and HTTP `502/503/504/408`.
- **Never retry on:** any other `4xx` (bad signature, size mismatch = a real error).
- **Backoff:** exponential, `2, 4, 8, 16, 30 s` (capped), **5 attempts**.
- **Per-request timeouts bounded** so a wedged chunk can't hang the upload for ~25 min:
  drop the chunk POST timeout `300 s → 120 s` (50 MB over the wire is seconds; 120 s covers
  a slow finalize/store), leaving `init 30 s`, `finalize 120 s`. Worst case per chunk ≈
  `5 × 120 s + 60 s backoff ≈ 11 min` before it gives up and preserves the `/tmp` file.
- `init` retry → server mints a new `uploadId`; the previous empty dir is GC'd — harmless.
- `chunk` retry → same index to the same `uploadId`; `writeChunk` overwrites — idempotent.
- `finalize` retry → same `uploadId`; server marker makes it a no-op that returns 200.

Retry stays **inside** `uploadRecordingChunked` (per-request). The outer `uploadRecording`
is **not** wrapped in a retry — so there is no path that re-inits a fresh upload and
re-stores. On exhausted retries: `raise` as today (bot reports failed to NC).

**Chunk size:** unchanged at 50 MB. (Retry fixes the transient 504 directly; smaller
chunks only add round-trips.)

## Failure handling — manual-recovery-first

- Exhausted retries → the bot reports failure to NC (existing behaviour) and **keeps the
  `/tmp` recording file** — this already happens today and MUST be preserved (no
  failure-path cleanup that deletes it).
- Failed-attempt server leftovers (orphan parts dir / `uploadId`) never block a redo: each
  attempt uses a fresh `uploadId`; `sweepStale` GCs orphans at 1 h.

### Recovery CLI (new — the "easy re-trigger" deliverable)

Replace today's ad-hoc base64 / `python -c` recovery with a first-class command in the bot:

```
python3 -m nextcloud.talk.recording.reupload \
  --backend https://<domain>/ --token <token> --owner <uid> [--file <path>] \
  [--config /etc/nextcloud-talk-recording/server.conf]
```

- Loads `server.conf` (so `Config.getBackendSecret` resolves), then calls the **same**
  `uploadRecordingChunked` (with the new retry).
- `--file` optional → auto-discovers `/tmp/https<domain>/<token>/*.webm`.
- `--config` defaults to the standard path.
- Safe to re-run **within the 24 h dedup window**: the recording-keyed `.done` marker makes
  finalize a no-op even with a fresh uploadId — so a reupload after the bot already stored the
  recording (finalize succeeded, response lost) does **not** double-post. Beyond 24 h the
  marker is GC'd → SOP: check the conversation before rerunning.
- Documented in `AVUZ_FORK.md`.

## Edge cases

| Case | Handling |
|------|----------|
| `init` retry after lost response | new `uploadId`; old empty dir GC'd |
| chunk retry racing slow first write | temp-file + atomic `rename` — no interleave/corruption |
| finalize retry after successful store | recording-keyed `.done` marker → 200, no re-store |
| concurrent finalize (retry vs still-running first) | `flock` on `<key>` serialises; second sees `.done` → 200 |
| manual `reupload` after bot gave up (finalize had succeeded) | fresh uploadId, but same `token+fileName` key → `.done` hit → no double-post (within 24 h) |
| PHP fatal between store-success and marker-write | accepted residual (µs window, requires store already done); marker written as the next op |
| `4xx` (bad signature/size) | no retry, fail fast → manual recovery |
| stale `.done` / `.lock` | `sweepStale` unlinks `.done` >24 h, `.lock` >1 h — TTL-gated, never touches an active finalize |
| retries exhausted | raise; `/tmp` file preserved; `reupload` CLI recovers |

## Testing

**Bot** (`tests/`, pytest):
- retry helper: `504,504,200` → succeeds after retries; `400` → not retried; connection
  error → retried.
- chunk idempotency: re-POST same index → server accepts (mock).
- finalize retry: second call returns 200 (mock marker).
- `reupload` CLI: smoke test (arg parsing, config load, auto-discovery of `/tmp` file).

**Server overlay** — the lock/marker logic is the trickiest code and has the weakest
coverage, so add a **standalone PHP script test** (precedent: the audio-extraction recipe)
that exercises `RecordingChunkedUploadService` against a temp dir with a mocked `IConfig`:
- atomic write: concurrent `writeChunk` to the same index → resulting `NNNN.part` is one
  intact copy, never interleaved.
- idempotent finalize: two `finalize` calls for the same `token+fileName` (even different
  uploadIds) → store path invoked **once**, second returns the short-circuit.
- `sweepStale`: `.done` <24 h and `.lock` <1 h are kept; older are removed.
Plus staging e2e: call `finalize` twice for one recording → exactly one recording message.

**Acceptance (staging):**
- record a real call → single recording message + transcript.
- run `reupload` against a leftover `/tmp` file → still a single recording (idempotency
  proven end-to-end).

## Rollout

- Bot: rebuild/push `registry.avuz.app/admin/talk-recording`, update the recording stack.
- Server: entrypoint-only? No — overlay is applied at Docker build, so rebuild the app
  image (`build-push.sh latest prod`/`staging`) and redeploy. The entrypoint's overlay
  integrity check (sentinel `AVUZ-CHUNKED-UPLOAD-V2`) confirms the new build is running.
- Order: ship the **server** (idempotent finalize) first, then the **bot** (retry) — so
  finalize is already idempotent before the bot can start retrying it.
