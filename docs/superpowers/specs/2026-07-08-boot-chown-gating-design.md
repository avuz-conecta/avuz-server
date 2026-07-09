# Boot chown/chmod gating — design

**Date:** 2026-07-08
**Branch base:** `avuz-customization`
**File touched:** `docker/entrypoint.sh`
**Status:** revised after grilling session (see "Grilling findings" below)

## Problem

The entrypoint runs `chown -R` **and** `chmod -R 770` over `/var/www/html/data`
twice per boot — phase 1 (line 491-492) and phase 5 (line 687-688). Cost scales
with inode count, not bytes. On local-disk-primary clients with millions of user
files this is **~3 hours per deploy**, and it runs on every plain restart.

## Strategic context — S3 is the end-state

**Goal: all clients move to S3 primary object store.** That structurally
dissolves this problem: with S3, file blobs, previews, and appdata live in the
bucket as `urn:oid:*` objects, so local `data/` holds only logs, cache, temp,
and the config stamp — a few hundred inodes. Every chown/chmod walk becomes
trivial regardless of file count, because it traverses the **filesystem only**;
S3 objects are invisible to it.

Consequences for this spec:

- **On S3 clients, the walk is a non-issue.** This change is then correctness +
  cleanup (kill the redundant blind `chmod -R`, clarify the two phases' distinct
  purposes), not a performance fix.
- **The 3h pain is entirely local-disk clients.** The durable fix for them is
  **migrate to S3** (one-way door — see `docs/s3-deployment.md` and the
  multi-tenant isolation notes: each stack needs its own bucket). Gating buys
  those clients relief in the interim, before/while they migrate.
- **Priority:** ship gating now for interim relief and correctness; track S3
  migration of remaining local-disk clients as the real resolution. Do not
  over-engineer the local-disk path — it is a shrinking set.

## Why the walk exists (verified — do not naively delete)

`occ` runs as **root** in this image — no `USER` directive in the Dockerfile, no
`su-exec`/`gosu`/`sudo` in the entrypoint (confirmed: zero references in repo).
So `maintenance:install`, `occ upgrade`, and `maintenance:repair
--include-expensive` create root-owned files under `data/`. php-fpm serves as
`www-data` and starts only at the final `exec supervisord`. Something must
re-chown those root files to `www-data` before serving.

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

## Grilling findings (what the first draft got wrong)

1. **"hours → seconds" was overstated.** True only for the *skip* path (plain
   restart). A deploy that bumps `AVUZ_CONFIG_VERSION` or triggers an NC db
   upgrade runs `run_avuz_configuration` → still walks `data/`. Since deploys
   are exactly when the stamp/version changes, the naive gate would not fix the
   *reported* 3h deploy — only plain restarts, which weren't the complaint.

2. **`find ! -user www-data` still stat()s every inode.** It removes the write
   syscalls (the likely-expensive journaled part) but keeps one full traversal.
   On local disk that's a big win; **on NFS a full traversal alone can be slow.
   Filesystem type of `data/` is unconfirmed and must be checked** before
   trusting any number.

3. **Scope the bump-path re-chown to what occ actually writes.** On a
   config-version bump (no NC db upgrade), occ-as-root does not rewrite user
   file blobs (`data/<user>/files/…`) — those are created by uploads via
   www-data. It writes `nextcloud.log` and `appdata_*` (preview regen). So the
   bump path should re-chown only those subtrees, skipping the millions of user
   inodes entirely. **This is a hypothesis that MUST be validated empirically**
   (snapshot `find data/<user> ! -user www-data` across a real bump boot; zero
   rows → safe; any rows → fall back to a full walk).

4. **`set -e` + unguarded glob = boot-breaker on S3.** `find
   /var/www/html/data/appdata_* …` has no on-disk match on S3 clients → bash
   passes the literal glob → `find` exits non-zero → `set -e` aborts the whole
   boot. Every data-subtree command added must be nullglob-guarded and `|| true`.

5. **`su-exec www-data` (run occ unprivileged) is the real root-cause fix but
   NOT this change's lead.** It would stop occ ever creating root files, making
   re-chown unnecessary. But: (a) no `su-exec`/`gosu` in the image → requires a
   **base-image change** (`build-base.sh`); (b) **103 `php occ` call sites** (109
   with `php -r` bootstraps) must migrate or ownership goes mixed — worse than
   today; (c) it fixes only *future* boots — clients already carrying root-owned
   files still need **one** reconciling full walk, so it spares the in-pain
   clients nothing on their next boot. Feasible (the official NC image runs occ
   as www-data), but a separate, larger initiative. See "Out of scope".

## Decisions

1. **Plain-restart posture:** skip the `data/` recursive walk entirely. Recurse
   only `config/` + `custom_apps/` (tiny) + `data/` top-level non-recursive.
2. **Phase-1 `data/`:** drop the recursive walk (occ runs as root, ignores
   ownership; php-fpm starts only at phase 5).
3. **Bump path (config-version change, no db upgrade):** re-chown only
   `appdata_*` + `nextcloud.log` — **pending empirical validation** (finding 3).
4. **NC db upgrade path only:** full targeted `find ! -user www-data` over
   `data/` (occ upgrade can rewrite anywhere; rare; justified).
5. **No blind `chmod -R 770` on `data/` ever again** — NC sets its own file
   modes; the 770 blanket was cargo-cult.
6. **su-exec root-cause fix:** out of scope here, documented for later.

## Changes to `docker/entrypoint.sh`

### Signals

Two distinct flags — coarser than the first draft's single flag, because the db
upgrade and the config bump need different scopes:

```bash
DID_DB_UPGRADE=0      # set inside the `occ upgrade` branch (phase 2)
DID_CONFIG_RUN=0      # set where run_avuz_configuration is invoked (phase 3)
```

- In phase 2's upgrade branch, after `php occ upgrade`, set `DID_DB_UPGRADE=1`.
- In phase 3, set `DID_CONFIG_RUN=1` in the same branch that calls
  `run_avuz_configuration` (fresh install or stamp mismatch).

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

if [ "$DID_DB_UPGRADE" -eq 1 ]; then
    # NC core upgrade can rewrite anywhere under data/ — full targeted walk.
    find /var/www/html/data \! -user www-data -exec chown www-data:www-data {} + || true
elif [ "$DID_CONFIG_RUN" -eq 1 ]; then
    # Config-version bump: occ-as-root only wrote appdata_* + log. Scope to
    # those, skip the user-file tree. nullglob so S3 (no on-disk appdata) is a
    # no-op instead of a set -e abort.
    shopt -s nullglob
    for _appdata in /var/www/html/data/appdata_*/; do
        find "$_appdata" \! -user www-data -exec chown www-data:www-data {} + || true
    done
    shopt -u nullglob
fi

# Cheap always-on safety: occ-as-root most often clobbers the log. One stat,
# instant — keeps logging alive even on a skipped plain restart.
chown www-data:www-data /var/www/html/data/nextcloud.log 2>/dev/null || true
```

## Net behavior

| Boot type | data/ handling |
|-----------|----------------|
| Plain restart | none (phase-1 dropped, phase-5 gated) — seconds |
| Fresh install | `DID_CONFIG_RUN` → appdata scope; data/ empty anyway — cheap |
| Config-version bump | `DID_CONFIG_RUN` → appdata_* + log only — bounded, fast |
| NC db upgrade | `DID_DB_UPGRADE` → full targeted `find ! -user www-data` — one slow walk, rare |
| S3 client (any path) | trivial — data/ is a few hundred inodes; appdata glob is a no-op |

Honest claim: **seconds on skip-path and config-bump-path; one unavoidable slow
walk only on a genuine NC db upgrade** (and only for local-disk clients — S3 is
trivial everywhere).

## Verification

**Local-disk client (the case that hurts):**
- `stat -f %T /var/www/html/data` (or `df -T`) — confirm filesystem type
  (local vs NFS). Finding 2: NFS changes the traversal math.
- `find /var/www/html/data | wc -l` — record inode count.
- Time each path: plain restart, a config-version bump, and (if possible) a db
  upgrade — before vs after. Plain restart + bump expect → seconds/minutes.
- **Validate finding 3:** on a config-version-bump boot, snapshot
  `find /var/www/html/data/<user> \! -user www-data | wc -l` before and after.
  Must be 0 after. Non-zero → the appdata scoping is unsafe; fall back to the
  full `find` for the bump path too.
- After each path confirm `www-data` ownership on: `data/nextcloud.log`,
  `data/appdata_*`, and a sample user file. Confirm login + upload/download work.

**S3 client:**
- Confirm boot behavior and timing unchanged (already fast).
- Confirm the `appdata_*` glob is a silent no-op (no `set -e` abort) — finding 4.

## Risk / rollout

- Touches boot on live client stacks. Branch off `avuz-customization` in a
  worktree.
- `AVUZ_CONFIG_VERSION` bump **not required** — this is fs-side boot logic, not
  NC config.
- Roll out: one local-disk client first (validate finding 3 there) → one S3
  client (confirm the glob no-op) → wider.
- Prefer, in parallel, advancing the S3 migration of remaining local-disk
  clients — that retires this whole problem class.

## Out of scope (documented, not lost)

- **`su-exec www-data` root-cause fix.** Run occ unprivileged so it never
  creates root files → no re-chown anywhere, ever. Requires: install a
  privilege-drop tool in the base image (`build-base.sh`); migrate all 103 `php
  occ` + `php -r` call sites to www-data via a single `occ()` wrapper; accept
  that already-affected clients still need one reconciling walk on first boot
  after adoption. Feasible (official NC image does this) but a separate, larger
  initiative with a base-image blast radius.
- **NC-side `trusted_proxies` / real-IP work** — separate, already shipped.
