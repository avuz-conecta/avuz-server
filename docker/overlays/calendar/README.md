# calendar JS overlay — event color in the new-event popover

## What
Patched build of Nextcloud Calendar **v6.2.1**. The quick popover (click an
empty slot / click an event) shows the same color control as "Mais detalhes"
— eyedropper icon + `PropertyColor` (NcColorPicker swatch, reset button) —
inline to the right of the calendar name in the header. Users pick the event
color without opening the full editor. In view mode a custom color shows as a
read-only swatch.

Also: the swatch follows the calendar color when the user switches calendar in
the popover header and the event has no custom color (upstream set it once on
mount), and the read-only swatch has a size (upstream rendered it 0×0, in
the full editor too).

## Files here
- `js/*.js` — only the 3 bundles that change. The calendar build is
  byte-reproducible: an unpatched `npm run build` of v6.2.1 matches the shipped
  bundle exactly, and chunk names are not content-hashed, so the other 165
  files stay untouched. Source maps are excluded.
- `popover-event-color.patch` — the source diff (`EditSimple.vue`,
  `EditFull.vue`, `EditorMixin.js`, `PropertyColor.vue`, component test,
  `vitest.config.js`).

## How it's applied
- Dockerfile copies `js/` over `apps/calendar/js/` and **fails the build** if
  `apps/calendar` is not 6.2.1 — overlaying a 6.2.1 bundle on another version
  breaks the app.
- Entrypoint: sentinel `AVUZ-POPOVER-COLOR-V1` in `js/calendar-main.js`
  (`verify_avuz_patches`), `calendar` in `AVUZ_OWNED_APPS` (custom_apps shadow
  purge), `reapply_avuz_calendar_overlay` after core upgrades.
- Browsers: bump `AVUZ_CONFIG_VERSION` with every overlay change. The config
  run calls `occ theming:config`, which bumps the theming cachebuster, which
  changes the `?v=` suffix on the calendar scripts.

## Rebuild (required on every calendar upgrade)
```bash
git clone --depth 1 --branch v<NEW_VERSION> https://github.com/nextcloud/calendar
cd calendar
git apply /path/to/docker/overlays/calendar/popover-event-color.patch
npm ci && npm run test:unit && npm run build     # node ^24, npm ^11
grep -l AVUZ-POPOVER-COLOR-V1 js/*.js            # sentinel must be in calendar-main.js
# copy every js/*.js that differs from the release tarball, then bump
# AVUZ_CALENDAR_OVERLAY_VERSION in the Dockerfile and AVUZ_CONFIG_VERSION.
```
