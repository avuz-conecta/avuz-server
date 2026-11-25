# 3rdparty overlay

Full-file replacements for files under `3rdparty/` (the `nextcloud/3rdparty`
submodule), applied by the Dockerfile after `COPY .`.

## sabre/vobject `lib/ITip/Broker.php` (sentinel `AVUZ-ITIP-EXDATE-V1`)

**Bug:** importing a Google Calendar export dropped recurring meetings. CalDAV
`PUT` returned 500 with `in_array(): Argument #2 ($haystack) must be of type
array, null given`. For a NEW event the broker's default `$oldEventInfo` has no
`exdate` key, and PHP 8 rejects the null haystack. Trigger: new event +
recurring + `EXDATE` + the user is an attendee with a `PARTSTAT` (how Google
exports meetings).

**Fix:** upstream sabre-io/vobject master's line,
`in_array($exDate, $oldEventInfo['exdate'] ?? [], true)`. No release carries it
yet (checked 4.5.9, 4.6.1, 5.0.0 on 2026-11-25).

**Behavior after the fix (upstream's):** the import succeeds, and the broker
sends the external organizer an iTip REPLY: series accepted, EXDATE instances
declined.

**Guard:** the Dockerfile checks the SHA-256 of the 4.5.6 file
(`AVUZ_VOBJECT_BROKER_SHA256`). When `3rdparty` moves:

1. If the new `Broker.php` already has `?? []` on that line, delete this
   overlay, its Dockerfile block and the entrypoint sentinel.
2. Otherwise copy the new file here, re-apply the one-line change with the
   `AVUZ-ITIP-EXDATE-V1` comment, and update the checksum.

**Test:** `tests/broker-exdate.test.php` runs during the build. Locally:

    php docker/overlays/3rdparty/tests/broker-exdate.test.php 3rdparty/autoload.php docker/overlays/3rdparty/sabre/vobject/lib/ITip/Broker.php
