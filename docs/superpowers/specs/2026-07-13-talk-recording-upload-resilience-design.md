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

## Component 1 — server-side idempotent finalize (avuz-server overlay)

**Files:**
- `docker/overlays/spreed/lib/Controller/RecordingController.php` — `storeChunkedFinalize`
- `docker/overlays/spreed/lib/Service/RecordingChunkedUploadService.php` — `finalize`,
  new marker/lock helpers, extended `sweepStale`
- `docker/entrypoint.sh` — update the spreed-overlay integrity check string to the bumped
  sentinel (see Sentinel below)

A finalize call for a given `uploadId` becomes safe to issue more than once:

1. **Lock.** Acquire an exclusive `flock` on `<chunkRoot>/<token>/<uploadId>.lock` around
   the critical section. This serialises a retry that arrives while the first finalize is
   *still running* server-side (bot timed out, origin did not) — the real double-post race.
   `flock` is advisory and process-crash-safe (released when the fd closes).
2. **Short-circuit.** If `<chunkRoot>/<token>/<uploadId>.done` exists → release lock,
   return HTTP 200 without re-assembling or re-storing.
3. **Store once.** Otherwise: assemble parts → `RecordingService::store(...)` → **write the
   `.done` marker** → clean up the parts dir → release lock → return 200.

The `.done` marker is stored **outside** the `<uploadId>` parts directory so the existing
chunk cleanup cannot delete it. Its content is not read by the bot (which only checks HTTP
status); write a JSON stamp `{"finalizedAt": <unixtime>}` — enough for debugging and for
`sweepStale` age checks.

`sweepStale` is extended to also unlink stale `*.done` and `*.lock` files (same 1 h TTL
as the upload dirs) so markers/locks don't accumulate.

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
- Safe to re-run: idempotent finalize guarantees no double-post.
- Documented in `AVUZ_FORK.md`.

## Edge cases

| Case | Handling |
|------|----------|
| `init` retry after lost response | new `uploadId`; old empty dir GC'd |
| chunk retry | same index overwrites — idempotent |
| finalize retry after successful store | `.done` marker → 200, no re-store |
| concurrent finalize (retry vs still-running first) | `flock` serialises; second sees `.done` → 200 |
| `4xx` (bad signature/size) | no retry, fail fast → manual recovery |
| stale `.done`/`.lock` | `sweepStale` unlinks at 1 h |
| retries exhausted | raise; `/tmp` file preserved; `reupload` CLI recovers |

## Testing

**Bot** (`tests/`, pytest):
- retry helper: `504,504,200` → succeeds after retries; `400` → not retried; connection
  error → retried.
- chunk idempotency: re-POST same index → server accepts (mock).
- finalize retry: second call returns 200 (mock marker).
- `reupload` CLI: smoke test (arg parsing, config load, auto-discovery of `/tmp` file).

**Server overlay** (PHP, no local harness → staging e2e):
- call `finalize` twice for one `uploadId` → exactly one recording in the conversation,
  second call returns 200.

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
