# Boot chown/chmod gating — design

**Date:** 2026-07-08
**Branch base:** `avuz-customization`
**File touched:** `docker/entrypoint.sh`

## Problem

The entrypoint runs `chown -R` **and** `chmod -R 770` over `/var/www/html/data`
twice per boot — once in phase 1 (line 491-492) and again in phase 5 (line
687-688). Cost scales with inode count, not bytes. On local-disk-primary
clients with millions of user files this is **~3 hours per deploy**, and it
runs on every plain restart.

## Why it exists (verified, do not naively delete)

`occ` runs as **root** in this image — no `USER` directive in the Dockerfile,
no `su-exec`/`gosu`/`sudo` in the entrypoint. So `maintenance:install`,
`occ upgrade`, and `maintenance:repair --include-expensive` all create
root-owned files under `data/`. php-fpm serves as `www-data` and starts only at
the final `exec supervisord`. Something must re-chown those root files to
`www-data` before serving.

Map of every recursive `data/` walk:

| Where | Line | Runs on | Cost |
|-------|------|---------|------|
| Phase 1 | 491-492 | every boot | 3h on big local-disk |
| Phase 2 fresh install | 559-560 | fresh install only | cheap — data/ empty |
| Phase 2 upgrade | 566-567 | upgrade only — **config only, not data** | n/a |
| Phase 5 | 687-688 | every boot | 3h on big local-disk |

The two killers are phase 1 and phase 5, both on **plain restarts**. Phase 5 is
load-bearing: on the upgrade path it is the **only** step that re-chowns `data/`
(phase-2 upgrade touches `config/` only). It must not be removed — only gated.

## S3-primary clients are unaffected

With S3 as primary object store, file blobs, previews, and appdata live in the
bucket as `urn:oid:*` objects. Local `data/` holds only logs, cache, temp, and
the config stamp — a few hundred inodes. The recursive walk traverses the
**filesystem only**; S3 objects are invisible to it. So S3 clients boot fast
regardless of file count. No separate code path — the same entrypoint serves
both storage modes.

## Decisions

1. **Plain restart posture:** skip the `data/` recursive walk entirely. Chown
   only `config/` + `custom_apps/` (tiny) recursively, plus `data/` top-level
   non-recursive.
2. **Phase 1 `data/`:** drop the recursive walk. Safe because occ runs as root
   (ignores ownership) and php-fpm starts only at phase 5.

## Changes to `docker/entrypoint.sh`

### Gating flag

Set a flag in the same branch that runs `run_avuz_configuration` (the block
guarded by `NEEDS_CONFIGURATION==1` or stamp mismatch, line 660) — that block
is exactly what runs occ-as-root writes into `data/`:

```bash
DID_ROOT_DATA_WRITES=0
if [ "$NEEDS_CONFIGURATION" -eq 1 ] || [ "$CURRENT_STAMP" != "$AVUZ_CONFIG_VERSION" ]; then
    run_avuz_configuration
    DID_ROOT_DATA_WRITES=1
else
    echo "✓ Avuz configuration up to date ($AVUZ_CONFIG_VERSION), skipping"
fi
```

Fresh install and upgrade both set `NEEDS_CONFIGURATION=1`, so both flip the
flag. On a plain restart the flag stays 0.

### Phase 1 (replaces line 491-492)

```bash
chown -R www-data:www-data /var/www/html/config /var/www/html/custom_apps 2>/dev/null || true
chmod -R 770               /var/www/html/config /var/www/html/custom_apps 2>/dev/null || true
chown www-data:www-data /var/www/html/data 2>/dev/null || true
chmod 770               /var/www/html/data 2>/dev/null || true
```

### Phase 5 (replaces line 687-688)

```bash
chown -R www-data:www-data /var/www/html/config /var/www/html/custom_apps
chmod -R 770               /var/www/html/config /var/www/html/custom_apps
chown www-data:www-data /var/www/html/data
chmod 770               /var/www/html/data

# Only re-chown data/ contents when root wrote into it this boot (install /
# upgrade / config-version bump). Targeted find touches only mis-owned files;
# no blind chmod (NC sets its own file modes — the 770 blanket was cargo-cult).
if [ "$DID_ROOT_DATA_WRITES" -eq 1 ]; then
    find /var/www/html/data \! -user www-data -exec chown www-data:www-data {} +
fi

# Cheap always-on safety: occ-as-root most often clobbers the log. One stat,
# instant — keeps logging alive even on a skipped plain restart.
chown www-data:www-data /var/www/html/data/nextcloud.log 2>/dev/null || true
```

## Net behavior

| Boot type | data/ recursive walk |
|-----------|----------------------|
| Plain restart | none (phase-1 dropped, phase-5 gated) |
| Fresh install | one, in phase-2 — data/ empty = cheap |
| Upgrade / version bump | one targeted `find ! -user www-data` in phase-5 |
| S3 client (any) | trivial — data/ is a few hundred inodes |

## Verification

**Local-disk client:**
- `find /var/www/html/data | wc -l` — record inode count.
- Time a plain restart before vs after — expect hours → seconds.
- After restart confirm `www-data` ownership on: `data/nextcloud.log`,
  `data/appdata_*`, and a sample user file.
- Confirm login writes and a file upload/download still work.

**S3 client:**
- Confirm boot behavior and timing unchanged (already fast).

## Risk / rollout

- Touches boot on live client stacks. Branch off `avuz-customization` in a
  worktree.
- `AVUZ_CONFIG_VERSION` bump **not required** — this change is nginx/fs-side
  boot logic, not NC config. Leave the stamp unless another change needs it.
- Roll out: one local-disk client first → one S3 client → wider.

## Out of scope

- Switching occ to run as `www-data` (larger change; would remove the root-file
  problem at the source but risks other permission assumptions).
- NC-side `trusted_proxies` / real-IP work (separate, already shipped).
