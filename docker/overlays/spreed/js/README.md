# spreed JS overlay — staggered offer requests + no waiting sound

## What
Patched build of Nextcloud Talk (spreed **v23.0.6**) that **staggers the initial
`requestOffer` calls** when joining a call. Upstream fires `requestOffer` for
every participant in a single tick, creating all PeerConnections at once. On
mobile browsers that burst overwhelms the device, the signaling WebSocket is
closed (clean `1000`), and the client reconnect-loops forever without joining.
(Cameras-off does not help — audio streams also trigger the offer burst.)

The patch spreads the MCU offer requests ~200ms apart so connections are built
incrementally.

A second patch (`../no-waiting-sound.patch`, `src/utils/sounds.js`) removes the
alone-in-call waiting loop (LibremPhoneCall every 15 s). Joining an empty call
plays the normal join chime instead. The `wait` audio object stays, so
"Testar alto-falantes" still plays sound.

## Files here
- `js/*.js` — the **full** patched build (talk-main.js + all chunks). These must
  ship **together**: chunk filenames are content-hashed and `talk-main.js` loads
  chunks by those exact names, so overlaying `talk-main.js` alone would reference
  chunks that don't exist. Source maps (`.map`) are intentionally excluded.
- `../css/*.css` — matching CSS build (same reason).
- `../webrtc-stagger.patch` — the source diff (`src/utils/webrtc/webrtc.js`).
- `../no-waiting-sound.patch` — the source diff (`src/utils/sounds.js`).

## How it's applied
The Dockerfile already runs `cp -R docker/overlays/spreed/. /var/www/html/apps/spreed/`,
so these files replace the shipped bundle at image-build time. **No Dockerfile
change is needed.**

## Rebuild (required on every spreed upgrade — the bundle is version-specific)
```bash
git clone --depth 1 --branch v<NEW_VERSION> https://github.com/nextcloud/spreed
cd spreed
git am /path/to/docker/overlays/spreed/webrtc-stagger.patch      # or redo the edit
git am /path/to/docker/overlays/spreed/no-waiting-sound.patch
npm ci && npm run build            # needs node ^24, npm ^11
# copy back, dropping source maps and the vendored MediaPipe glue
# (vision_wasm*_internal.js must come from apps/spreed, see c629e6c1fb3):
for f in js/*.js; do case "$f" in js/vision_wasm*) ;; *) cp "$f" /path/to/docker/overlays/spreed/js/ ;; esac; done
cp css/*.css /path/to/docker/overlays/spreed/css/
```
The stagger edit lives in `src/utils/webrtc/webrtc.js` (`usersChanged`), constant
`REQUEST_OFFER_STAGGER_MS` (default `200`). Raise it (e.g. 300) for gentler mobile
behaviour / slower join; lower (150) for faster join.

## Verify the bundle
```bash
grep -c 'Playing waiting sound' docker/overlays/spreed/js/talk-main.js   # 0
grep -o 'Hh=[0-9]*' docker/overlays/spreed/js/talk-main.js              # Hh=200 (stagger)
ls docker/overlays/spreed/js | grep vision                               # nothing
```

## Verify at runtime
Mobile joins a large call. In the browser console you should see:
- `Request offer from` lines **spread over seconds**, not all at once.
- **No** `Reconnecting socket as the connection was closed unexpected` loop.
- The call **joins and holds**.

Waiting sound: join a call alone → one join chime, then silence. Device
settings → "Testar alto-falantes" → the test tone plays.

## Source
Built from `nextcloud/spreed` v23.0.6 + both patches on branch `avuz/no-waiting-sound`
(stagger `9578932`, waiting sound `a4e5d37`). The stagger patch is an upstream PR
candidate; the waiting-sound patch is an Avuz product choice and stays.

The 2026-11-11 rebuild kept the previous `css/*.css`: the patch changes no styles
and a fresh build only differed by toolchain drift (same scoped `data-v-*` ids).
