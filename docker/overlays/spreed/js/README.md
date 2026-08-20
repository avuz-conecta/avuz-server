# spreed JS overlay — staggered offer requests (mobile large-call join fix)

## What
Patched build of Nextcloud Talk (spreed **v23.0.6**) that **staggers the initial
`requestOffer` calls** when joining a call. Upstream fires `requestOffer` for
every participant in a single tick, creating all PeerConnections at once. On
mobile browsers that burst overwhelms the device, the signaling WebSocket is
closed (clean `1000`), and the client reconnect-loops forever without joining.
(Cameras-off does not help — audio streams also trigger the offer burst.)

The patch spreads the MCU offer requests ~200ms apart so connections are built
incrementally.

## Files here
- `js/*.js` — the **full** patched build (talk-main.js + all chunks). These must
  ship **together**: chunk filenames are content-hashed and `talk-main.js` loads
  chunks by those exact names, so overlaying `talk-main.js` alone would reference
  chunks that don't exist. Source maps (`.map`) are intentionally excluded.
- `../css/*.css` — matching CSS build (same reason).
- `../webrtc-stagger.patch` — the source diff (`src/utils/webrtc/webrtc.js`).

## How it's applied
The Dockerfile already runs `cp -R docker/overlays/spreed/. /var/www/html/apps/spreed/`,
so these files replace the shipped bundle at image-build time. **No Dockerfile
change is needed.**

## Rebuild (required on every spreed upgrade — the bundle is version-specific)
```bash
git clone --depth 1 --branch v<NEW_VERSION> https://github.com/nextcloud/spreed
cd spreed
git apply /path/to/docker/overlays/spreed/webrtc-stagger.patch   # or redo the edit
npm ci && npm run build            # needs node ^24, npm ^11
# copy back, dropping source maps:
cp js/*.js   /path/to/docker/overlays/spreed/js/
cp css/*.css /path/to/docker/overlays/spreed/css/
```
The stagger edit lives in `src/utils/webrtc/webrtc.js` (`usersChanged`), constant
`REQUEST_OFFER_STAGGER_MS` (default `200`). Raise it (e.g. 300) for gentler mobile
behaviour / slower join; lower (150) for faster join.

## Verify at runtime
Mobile joins a large call. In the browser console you should see:
- `Request offer from` lines **spread over seconds**, not all at once.
- **No** `Reconnecting socket as the connection was closed unexpected` loop.
- The call **joins and holds**.

## Source
Built from `nextcloud/spreed` v23.0.6 + patch on branch `avuz/stagger-request-offer`
(commit `9578932`). Upstream PR candidate — once merged, drop this overlay.
