# spreed JS overlay — Talk 23.0.14 + Avuz patches

## What
Patched build of Nextcloud Talk (spreed **v23.0.14**, the same version as the
server code in `apps/spreed`, which is the official
`spreed-v23.0.14.tar.gz`; the Dockerfile fails the build on any other
`apps/spreed`). Three source patches, applied in this order:

1. `../webrtc-stagger.patch` (`src/utils/webrtc/webrtc.js`): **staggers the
   initial `requestOffer` calls** when joining a call. Upstream fires
   `requestOffer` for every participant in a single tick; on mobile browsers that
   burst closes the signaling WebSocket (clean `1000`) and the client
   reconnect-loops forever. Constant `REQUEST_OFFER_STAGGER_MS` (default `200`).
2. `../no-waiting-sound.patch` (`src/utils/sounds.js`): removes the
   alone-in-call waiting loop (LibremPhoneCall every 15 s). Joining an empty call
   plays the normal join chime. The `wait` audio object stays, so
   "Testar alto-falantes" still plays sound.
3. `../presenter-keeps-strip.patch` (`src/stores/callView.ts`,
   `src/components/CallView/CallView.vue`, Deck #503): when **you** share your
   screen, the participant strip stays open so you see the others; viewers keep
   the strip closed. Stopping restores the pre-share layout when you kept the
   layout the share started with; modes the app picks (following a video,
   switching screens) are part of the share, and ending your share during
   someone else's gives you the viewer layout back. Spec:
   `docs/superpowers/specs/2026-11-19-talk-presenter-keeps-strip-design.md`.

Until 2026-11-19 this bundle was built from v23.0.6 over 23.0.1 server code;
`docs/superpowers/specs/2026-11-19-talk-23-0-14-alignment-design.md` has why
both now move together.

## Files here
- `js/*.js` — the **full** patched build (every chunk). They ship together:
  `talk-main.js` loads chunks by exact name. Source maps are excluded, and so is
  the vendored MediaPipe glue (`vision_wasm*_internal.js`): it is loaded by a
  fixed path and must stay the pair that ships in `apps/spreed` (see
  `scripts/verify-mediapipe.sh`).
- `../css/*.css` — matching CSS build.
- `../*.patch` — the three source diffs above (`git am` format).
- `../lib/` — server-side patches (chunked recording upload), rebased on the
  23.0.14 files; sentinel `AVUZ-CHUNKED-UPLOAD-V2`.

## How it's applied
The Dockerfile checks `apps/spreed` is 23.0.14, then runs
`cp -R docker/overlays/spreed/. /var/www/html/apps/spreed/`.

## Upgrade spreed (all of this moves together)
```bash
# 1. Server code: official release tarball
gh release download v<NEW> --repo nextcloud-releases/spreed -p 'spreed-v<NEW>.tar.gz'
# replace apps/spreed (worktree AND the golden checkout) with its contents
# 2. Bundle
git clone --depth 1 --branch v<NEW> https://github.com/nextcloud/spreed && cd spreed
git am /path/to/docker/overlays/spreed/{webrtc-stagger,no-waiting-sound,presenter-keeps-strip}.patch
npm ci && npx vitest run src/stores/__tests__/callView.spec.js src/utils/__tests__/sounds.spec.js
npm run build            # needs node ^24, npm ^11
git rm -q /path/to/docker/overlays/spreed/js/*.js /path/to/docker/overlays/spreed/css/*.css
for f in js/*.js; do case "$f" in js/vision_wasm*) ;; *) cp "$f" /path/to/docker/overlays/spreed/js/ ;; esac; done
mkdir -p /path/to/docker/overlays/spreed/css && cp css/*.css /path/to/docker/overlays/spreed/css/
# 3. Rebase ../lib/*.php: diff our files against the OLD release, apply to the NEW one
# 4. Bump AVUZ_SPREED_VERSION in the Dockerfile and the hashes in scripts/verify-mediapipe.sh
```
A clean rebuild of an unpatched tag differs from the release bundle only in
minifier variable names (same file names and sizes): checked for v23.0.14.

## Verify the bundle
```bash
grep -c 'Playing waiting sound' docker/overlays/spreed/js/talk-main.js   # 0
grep -c '=200,' docker/overlays/spreed/js/talk-main.js                   # ≥1 (stagger)
grep -l presentationStartMode docker/overlays/spreed/js/*.js | wc -l     # ≥1 (#503)
ls docker/overlays/spreed/js | grep vision                               # nothing
```

## Verify at runtime
- Mobile joins a large call: `Request offer from` console lines spread over
  seconds; no `Reconnecting socket as the connection was closed unexpected`
  loop; the call joins and holds.
- Join a call alone: one join chime, then silence. "Testar alto-falantes" plays
  the test tone.
- Share your screen in a call with 2+ others: the strip with the others stays
  open; a viewer sees your screen with the strip closed.
