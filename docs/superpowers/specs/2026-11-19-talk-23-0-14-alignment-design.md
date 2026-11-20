# Talk: server and browser code on one version, 23.0.14

Status: option 1 approved by Patrick 2026-11-19. Ships together with Deck #503
(`2026-11-19-talk-presenter-keeps-strip-design.md`).

## Why

The image ships Talk's browser bundle built from v23.0.6 (our overlay) on top of
Talk's server code 23.0.1 (`apps/spreed`, copied from the golden checkout).
Confirmed on HML: `talk-main.js` says 23.0.6, `installed_version` 23.0.1. The
browser code reads nothing the 23.0.1 server lacks, so nothing is known broken,
but the server misses 13 releases of fixes: GHSA-x75r-65hm-cw35 (23.0.3, low,
force-mute without permission on internal signaling), federation and SIP-bridge
checks (23.0.6), signaling and sharing fixes up to 23.0.14 (2026-11-12, latest
v23, NC 33 only).

## Goals

- `apps/spreed` = official release tarball `spreed-v23.0.14.tar.gz`
  (nextcloud-releases/spreed, sha256
  `b21f29678f086eb6a3eb4e6dd36f176fe2c397e2cf2ce0bdcae415a0bce8a5c7`).
- Browser bundle rebuilt from tag v23.0.14 with our three patches:
  `webrtc-stagger.patch`, `no-waiting-sound.patch` (both apply cleanly) and
  `presenter-keeps-strip.patch` (#503).
- Our server patches rebased on 23.0.14: `lib/Capabilities.php` (adds
  `recording-chunked-v1`), `lib/Controller/RecordingController.php` (our
  `store-chunked/*` endpoints, sentinel `AVUZ-CHUNKED-UPLOAD-V2`);
  `lib/Service/RecordingChunkedUploadService.php` unchanged unless 23.0.14 APIs
  force it. The talk-recording bot keeps working unchanged.
- The build fails loud when `apps/spreed` is not 23.0.14 (Dockerfile guard,
  like contacts), so the golden checkout's stale 23.0.1 can never ship again.
- MediaPipe guard (`scripts/verify-mediapipe.sh`) pinned to the 23.0.14
  release's matched set (glue `b63d…` + wasm `6a5c…`, nosimd `2962…` +
  `8a30…`, model unchanged).

## Non-goals

- Switching recordings to upstream's own chunked upload (in Talk since
  23.0.7, `recording-chunked-upload`): separate follow-up; it could retire our
  PHP patch and bot fork.
- Any Talk 24 / NC 34 move.

## Constraints

- 23.0.14 adds two migrations (`Version23001Date20260918142246`,
  `CleanupOldShares`): roll forward only, never back to an image with 23.0.1.
- Boot already reconciles an app version jump (`avuz_reconcile_app_versions`),
  which runs the app's migrations.
- Golden checkout's `apps/spreed` must be replaced with the 23.0.14 tarball
  before anyone builds from it (the guard enforces it).

## Approaches

1. All on 23.0.14 (picked): one rebuild, all fixes, ~1-2 days.
2. Server to 23.0.6, bundle untouched: smallest, still 8 releases behind.
3. Bundle back to 23.0.1: rejected, drops browser fixes, keeps server gaps.

## Verification (HML)

Boot log shows the reconcile and `installed_version` 23.0.14; Talk opens; a
3-person call passes the #503 checks; virtual background works (MediaPipe);
a recording over 100 MB lands in the owner's Drive through the chunked path.
