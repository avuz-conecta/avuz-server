# Preview storage reduction — design

**Date:** 2026-09-29
**Status:** approved design, not implemented

## Result we want

Cut the S3 cost of Nextcloud previews across the fleet: lower the preview cap from 2048 to 1280, purge every existing preview (tracked and orphaned) on each S3 client, and let previews regenerate on demand at the new size.

## Measured baseline (prod, 2026-09-29)

Bucket scan of `uri:oid:preview:*` against `oc_previews`, all 8 S3 clients:

| Client | Bucket previews | Orphans (bucket − DB) |
|---|---:|---:|
| grupo-vidalar | 195.64 GiB / 1,141,568 obj | 148,864 obj / 12.53 GiB |
| eco-ambiental | 98.11 GiB | 267 / 0.03 GiB |
| progetti | 28.94 GiB | 0 |
| ramires | 20.80 GiB | 42,896 / 3.29 GiB |
| cfm-advogados | 2.17 GiB | 228 / 0.05 GiB |
| consultt-agro | 1.53 GiB | 2,590 / 0.07 GiB |
| comprev | 1.35 GiB | 0 |
| arkua | ~0 | 4 |

Total ≈ 348.5 GiB. No client has dangling rows (DB row without object). The full-size tier dominates: NC always generates the max-size preview first, then derives smaller ones from it. Scan load was light: slowest ListObjectsV2 1.16 s (vidalar), everything else < 0.4 s.

## Facts the design relies on

- The cap lives in `docker/entrypoint.sh` (`PREVIEW_MAX_X/Y`, default 2048) inside `run_avuz_configuration`, which only re-runs when `AVUZ_CONFIG_VERSION` changes. An `occ config:system:set` survives plain restarts.
- `Generator` writes the preview object **before** inserting its `oc_previews` row (`lib/private/Preview/Generator.php:581-594`).
- Preview ids are Snowflakes; `ISnowflakeDecoder::decode($id)->getCreatedAt()` returns creation time. Pre-snowflake (autoincrement) ids decode to times near the epoch.
- Object key = `uri:oid:preview:<id>`, or `<objectPrefix>preview:<id>` when `objectPrefix` is configured. Previews with `old_file_id` use `urn:oid:<old_file_id>`; there are 0 of these on the S3 clients.
- `PreviewMapper` left-joins `preview_locations` and `preview_versions` to resolve a preview's bucket and version.
- `oc_preview_generation` is the previewgenerator app's pre-generation queue. No cron in this repo runs `preview:pre-generate`.
- NC 33 has no distributed preview cache (only a per-process `imagick` local cache). No Redis flush is needed.

## Design

### 1. Preview cap 2048 → 1280

- `docker/entrypoint.sh`: default `PREVIEW_MAX_X/Y` 2048 → 1280; update the comment with the 2026-09-29 measurements; bump `AVUZ_CONFIG_VERSION` `33.0.0-20` → `33.0.0-21`.
- Ships with the next fleet rollout.
- On purge night, each client first gets `occ config:system:set preview_max_x|preview_max_y --value=1280 --type=integer`, so regenerated previews come out small before the image lands.
- Per-stack override (`PREVIEW_MAX_X/Y` env) stays available for tenants who need sharper viewer images.

### 2. Purge tool

Committed to the repo:

- `scripts/preview-scan.php` — the read-only bucket-vs-DB scan used for the baseline.
- `scripts/preview-purge.php` — the purge.
- `scripts/preview-purge.sh <container> [--execute | --sweep-only]` — base64-evals the PHP inside the container as `www-data` via `scripts/portainer-exec-prod.sh` (or `PORTAINER_EXEC=scripts/portainer-exec.sh` for staging).

Purge steps, in order:

1. **Preconditions** — refuse unless the instance has a primary object store, `multibucket` is off, and `preview_max_x`/`preview_max_y` equal 1280.
2. **Cutoff** — `now − 10 minutes`. The margin covers a preview whose object was written before step 3 but whose row lands after it: that preview is newer than the cutoff, so the sweep keeps its object and the row stays valid.
3. **Truncate** `oc_previews` and `oc_preview_generation` (the latter only if it exists), via `IDBConnection::truncateTable`. Keep `oc_preview_locations` and `oc_preview_versions`: an in-flight generation may already hold their ids, and deleting them would leave a row that can never resolve its bucket.
4. **Sweep** — list `<prefix>` in the instance's configured bucket, decode each id, batch objects created before the cutoff into `DeleteObjects` calls of 1,000 keys. Same guardrails as the scan: 200 ms between requests, abort on any request error or any request slower than 5 s, progress line every 100 pages.
5. **Report** — the cutoff (ISO 8601, reusable with `--sweep-only`), rows truncated, objects/GiB deleted, objects kept (newer than cutoff), elapsed time, abort reason if any.

Modes:

- default (no flag) — dry run: preconditions, row counts, and a sweep that counts what it would delete without deleting.
- `--execute` — steps 1–5.
- `--sweep-only` — step 4 only, cutoff = timestamp passed explicitly (`--cutoff=<ISO8601>`). Resumes an aborted sweep; idempotent.

**Own-bucket guard:** the sweep only touches the bucket from the instance's own `root` object store config. It never deletes in a bucket that only appears in `oc_preview_locations`. Reason: staging `avuz-conecta-s3` has 136,754 preview rows pointing at eco-ambiental's **prod** bucket (DB cloned from prod); staging creds currently get AccessDenied, but the tool must not depend on that.

### 3. Failure behaviour

- Truncate always precedes deletes. No path deletes an object whose row still exists.
- Sweep aborted midway → remaining objects are orphans only; thumbnails keep working; re-run with `--sweep-only --cutoff=<same>`.
- Truncate succeeded, sweep never ran → same as above.
- No rollback: previews are a regenerable cache.

### 4. Rollout order

Off-hours only. Each prod client needs the user's explicit go, one at a time.

1. **Staging** (`avuz-conecta-s3-app-1`): generate real previews into `avuz-conecta-hml`, dry run, execute, confirm thumbnails regenerate at ≤ 1280 and no preview errors appear. This also clears the staging rows that point at the prod bucket.
2. **Small**: arkua → comprev → cfm-advogados → consultt-agro.
3. **Medium**: progetti → ramires.
4. **eco-ambiental**.
5. **grupo-vidalar**, its own window (~1.14 M objects ≈ 1,150 list + 1,150 delete requests, ~20 min).

### 5. Verification per client

- Re-run `preview-scan.php`: bucket previews are all newer than the cutoff; delta bucket − DB ≈ 0.
- NC log has no `Unable to read preview` entries after the purge.
- Next business morning: watch app container CPU. vidalar's PDF thumbnails will regenerate as users browse.
- Spot check: a regenerated max preview row has `width`/`height` ≤ 1280.

## Out of scope

- **Local-disk clients** (avuz-app3, cartorio-veranopolis, digrepal, endopasso): previews live in `appdata_<id>/preview/` on disk and interact with `oc_filecache`, so the purge differs. Phase 2: measure them with `preview-scan.php`, then write a short addendum before touching them.
- Changing `jpeg_quality` or preview format.
- Pre-warming previews after the purge (user chose on-demand regeneration).

## Expected outcome

~348 GiB freed at once. Regrowth is bounded by the 1280 cap, at roughly 40 % of the old size.
