# calendar overlay (JS bundle + PHP files) — event color in the new-event popover + "Criado por"

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

## Criado por (card 455)
Events created by someone other than the calendar owner (sharee, delegate)
show "Criado por <nome>" with the creator's avatar, under the title in the
popover and under the date in the full editor. The data comes from the server:
`apps/dav/lib/CalDAV/CreatedBy/CreatedByPlugin.php` stamps
`X-AVUZ-CREATED-BY;CN=<display name>:<uid>` on create and carries it over on
every update. Events without the stamp (owner-created, older events) show
nothing. pt_BR string: `themes/avuz/apps/calendar/l10n/pt_BR.json`.

## Default calendar without a principal (Deck #542)
The settings item renders on the first Calendar render, before the
current-user principal has loaded. Upstream `Settings.vue` `defaultCalendar()`
then read `scheduleDefaultCalendarUrl` of `undefined` and logged
`[Vue error]: Error in render: TypeError: Cannot read properties of undefined
(reading 'scheduleDefaultCalendarUrl')` on every load, for every user. The
guard falls back to the first writable calendar until the principal arrives.
Users with a principal see the same default calendar as before.

## Files here
- `js/*.js` — only the 6 bundles that change. The calendar build is
  byte-reproducible: an unpatched `npm run build` of v6.2.1 matches the shipped
  bundle exactly, and chunk names are not content-hashed, so the other 162
  files stay untouched. Entry bundles embed a `?v=<hash>` per chunk, so an
  entry changes when a chunk it loads changes (`calendar-contacts-menu.js`).
  Source maps are excluded.
- `popover-event-color.patch` — the source diff (`EditSimple.vue`,
  `EditFull.vue`, `EditorMixin.js`, `PropertyColor.vue`, component test,
  `vitest.config.js`).
- `event-created-by.patch` — applies on top of the first one (`CreatedBy.vue`,
  `models/event.js`, `EditorMixin.js`, `EditSimple.vue`, `EditFull.vue`).
- `default-calendar-no-principal.patch` — applies on top of the second one
  (`Settings.vue` guard, `Settings.test.js`, and `event.test.js` updated for
  the second patch's `createdBy` field).

## How it's applied
- Dockerfile copies `js/` over `apps/calendar/js/` and **fails the build** if
  `apps/calendar` is not 6.2.1 — overlaying a 6.2.1 bundle on another version
  breaks the app.
- Entrypoint: sentinels `AVUZ-POPOVER-COLOR-V1` and `AVUZ-CREATED-BY-V1` in `js/calendar-main.js`
  (`verify_avuz_patches`), `calendar` in `AVUZ_OWNED_APPS` (custom_apps shadow
  purge), `reapply_avuz_calendar_overlay` after core upgrades.
- Browsers: bump `AVUZ_CONFIG_VERSION` with every overlay change. The config
  run calls `occ theming:config`, which bumps the theming cachebuster, which
  changes the `?v=` suffix on the calendar scripts.

## PHP files (`lib/`)
Full-file replacements of upstream 6.2.1 PHP, same idea as
`docker/overlays/spreed/`. The path under `lib/` mirrors `apps/calendar/lib/`.
The Dockerfile and `reapply_avuz_calendar_overlay` copy `lib/` over
`apps/calendar/lib/` (only `lib/` and `js/` ship; `tests/` stays out of the
image). Same 6.2.1 build guard as the JS.

| File | Sentinel | Why |
| --- | --- | --- |
| `lib/Listener/AppointmentBookedListener.php` | `AVUZ-TALK-ROOM-SAFE-V1` | A Talk error (backend down, no permission) no longer aborts the booking. The room creation is wrapped in `try/catch (\Throwable)`; a warning is logged with the config id and the booking goes ahead without a Talk link. |
| `lib/Service/Appointments/BookingService.php` | `AVUZ-INSTANT-BOOKING-V1` | New `bookInstantly()`: upstream `book()` minus the confirmation e-mail, then upstream `confirmBooking()` on the same booking (calendar event, Talk room, both info e-mails, notification). `book()` is split into `createBooking()` + the confirmation e-mail, behavior unchanged. Slot gone before confirm → row deleted, `NoSlotFoundException` (404). Calendar write fails → error log (config id, booking id), the booking stays pending and gets the normal confirmation e-mail. `confirmBooking()` (instant and e-mail-confirmed flows alike) catches a DB error from saving the confirmed booking, logs an error and still sends both booking e-mails and the organizer notification: the event is already written, so no confirmation e-mail and never a second event. One sentinel per file; the `confirmBooking()` comment points to it. |
| `lib/Controller/BookingController.php` | `AVUZ-INSTANT-BOOKING-V1` | `bookSlot` calls `bookInstantly()` when `OCA\AvuzTheme\Service\InstantBooking::isAllowed()` says so (embed header `X-Avuz-Embed-Booking: 1`, embed allowlist on, page token in `AVUZ_INSTANT_BOOKING_TOKENS`), else upstream `book()`. Same responses either way. No `avuz_theme` → upstream flow. |

Sentinels are checked at boot by `verify_avuz_patches` (`calendar` app, path
under `lib/`). On every calendar upgrade, diff each overlay file against the new
upstream file and re-apply the change by hand before bumping the version guard.

### Tests
`tests/` holds PHPUnit tests for the overlay classes. They run without a server:
`tests/bootstrap.php` autoloads `OCA\Calendar\` from `lib/` here first, then from
the pristine upstream `apps/calendar/lib/` (must be 6.2.1, else the bootstrap
aborts), plus core `OCP\`/`OC\`, `OCA\AvuzTheme\` and `3rdparty`.
`tests/stubs/OC.php` replaces core's `\OC` so a test can hand `\OCP\Server::get()`
its own container (the controller test stubs the instant-booking gate that way).
```bash
phpunit -c docker/overlays/calendar/tests/phpunit.xml
```

## Rebuild (required on every calendar upgrade)
```bash
git clone --depth 1 --branch v<NEW_VERSION> https://github.com/nextcloud/calendar
cd calendar
git apply /path/to/docker/overlays/calendar/popover-event-color.patch
git apply /path/to/docker/overlays/calendar/event-created-by.patch
git apply /path/to/docker/overlays/calendar/default-calendar-no-principal.patch
npm ci && npm run test:unit && npm run build     # node ^24, npm ^11
grep -l 'AVUZ-POPOVER-COLOR-V1\|AVUZ-CREATED-BY-V1' js/*.js   # both must be in calendar-main.js
# copy every js/*.js that differs from the release tarball, then bump
# AVUZ_CALENDAR_OVERLAY_VERSION in the Dockerfile and AVUZ_CONFIG_VERSION.
```
