# Boot chown/chmod gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the entrypoint from walking every `data/` inode on every boot, so large local-disk clients deploy in seconds instead of ~3 hours, without breaking ownership correctness.

**Architecture:** Extract the ownership/permission logic out of `docker/entrypoint.sh` into a sourceable, dry-run-testable lib (`docker/lib-perms.sh`). The entrypoint sets two boot signals (`DID_DB_UPGRADE`, `DID_CONFIG_RUN`) and calls the lib. Plain restarts skip the `data/` recursion entirely; config-version bumps re-chown only `appdata_*` + `nextcloud.log`; genuine NC db upgrades do one full targeted `find`. S3 clients are trivial on every path.

**Tech Stack:** Bash (entrypoint), Docker, Nextcloud `occ`. Tests are a self-contained shell script (no bats/shellcheck in this environment).

## Global Constraints

- `docker/entrypoint.sh` line 2 is `set -e` — every added command that can fail (missing file, empty glob) MUST be guarded (`|| true`, `2>/dev/null`, or `nullglob`) or it aborts the whole boot.
- `occ` runs as **root** in this image (no `USER`/`su-exec`/`gosu`). Files it creates under `data/` are root-owned; php-fpm serves as `www-data` and starts only at the final `exec supervisord`. Ownership must be reconciled before that.
- `chown www-data:www-data` and `chmod 770` are the existing conventions — keep them. Do **not** reintroduce a blind `chmod -R 770` over `data/`.
- Never walk the user-file tree (`data/<user>/files/…`) unless a genuine NC db upgrade ran. That tree is the millions-of-inodes cost.
- Spec: `docs/superpowers/specs/2026-07-08-boot-chown-gating-design.md`. The appdata-scoping decision (config-bump path skips user trees) is a **hypothesis validated in Task 5** — if that validation finds root-owned user inodes after a bump, switch the config-bump branch to a full `find` (fallback documented in Task 5).

---

## File Structure

- **Create `docker/lib-perms.sh`** — sourceable helpers: `avuz_fix_perms_small`, `avuz_reconcile_data_ownership`, and private `_avuz_*` primitives. Dry-run aware via `AVUZ_CHOWN_DRYRUN`. No side effects on source.
- **Create `docker/tests/perms.test.sh`** — self-contained assertions over the lib in dry-run mode, plus one real `set -e` no-op check. Zero external deps.
- **Modify `docker/entrypoint.sh`** — source the lib; declare + set the two signals; replace the phase-1 block (489-492) and the phase-5 block (686-688) with lib calls.
- **Modify `Dockerfile`** — add `COPY docker/lib-perms.sh /usr/local/bin/` next to the entrypoint copy (line 87) so the entrypoint can source it by absolute path.

---

### Task 1: Ownership lib + tests

**Files:**
- Create: `docker/lib-perms.sh`
- Test: `docker/tests/perms.test.sh`

**Interfaces:**
- Produces:
  - `avuz_fix_perms_small <base>` — recursive chown/chmod on `<base>/config` + `<base>/custom_apps`; non-recursive on `<base>/data`.
  - `avuz_reconcile_data_ownership <data_dir> <did_db_upgrade:0|1> <did_config_run:0|1>` — db-upgrade→full `find`; else config-run→`appdata_*` `find` loop; always→chown `nextcloud.log`.
  - Env `AVUZ_CHOWN_DRYRUN=1` makes every primitive print `CHOWN`/`CHOWN-R`/`CHMOD`/`CHMOD-R`/`FIND-RECHOWN <path>` lines instead of touching the filesystem.

- [ ] **Step 1: Write the failing test**

Create `docker/tests/perms.test.sh`:

```bash
#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/../lib-perms.sh"

fail=0
assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        echo "ok - $desc"
    else
        echo "NOT OK - $desc"; echo "  expected: [$expected]"; echo "  actual:   [$actual]"; fail=1
    fi
}

# plain restart: no db upgrade, no config run -> only the log-safety chown
out="$(AVUZ_CHOWN_DRYRUN=1 avuz_reconcile_data_ownership /data 0 0)"
assert_eq "plain restart does no data recursion" \
    "CHOWN /data/nextcloud.log" "$out"

# config bump with appdata present -> scope to appdata + log, never the user tree
tmp="$(mktemp -d)"; mkdir -p "$tmp/appdata_abc" "$tmp/user1/files"
out="$(AVUZ_CHOWN_DRYRUN=1 avuz_reconcile_data_ownership "$tmp" 0 1)"
assert_eq "config bump scopes to appdata + log" \
    "FIND-RECHOWN $tmp/appdata_abc/
CHOWN $tmp/nextcloud.log" "$out"
rm -rf "$tmp"

# config bump on S3 (no appdata on disk) -> log only, glob is a no-op
tmp="$(mktemp -d)"
out="$(AVUZ_CHOWN_DRYRUN=1 avuz_reconcile_data_ownership "$tmp" 0 1)"
assert_eq "S3 config bump = log only, glob no-op" \
    "CHOWN $tmp/nextcloud.log" "$out"
# real (non-dryrun) run must not abort under set -e when no appdata exists
( set -e; avuz_reconcile_data_ownership "$tmp" 0 1 >/dev/null 2>&1 ) \
    && echo "ok - real run no-op survives set -e" \
    || { echo "NOT OK - real run aborted under set -e"; fail=1; }
rm -rf "$tmp"

# db upgrade -> full targeted find over data root
out="$(AVUZ_CHOWN_DRYRUN=1 avuz_reconcile_data_ownership /data 1 0)"
assert_eq "db upgrade does full targeted find" \
    "FIND-RECHOWN /data
CHOWN /data/nextcloud.log" "$out"

# fix_perms_small: config/custom_apps recursive, data top-level only
out="$(AVUZ_CHOWN_DRYRUN=1 avuz_fix_perms_small /base)"
assert_eq "fix_perms_small recurses small dirs, data top-level only" \
    "CHOWN-R /base/config /base/custom_apps
CHMOD-R /base/config /base/custom_apps
CHOWN /base/data
CHMOD /base/data" "$out"

exit $fail
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash docker/tests/perms.test.sh`
Expected: FAIL — `source: docker/lib-perms.sh: No such file or directory` (lib not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `docker/lib-perms.sh`:

```bash
#!/bin/bash
# Ownership/permission helpers for the Avuz entrypoint. Sourced by
# docker/entrypoint.sh and docker/tests/perms.test.sh. No side effects on source.
#
# occ runs as root in this image, so install/upgrade/repair create root-owned
# files under data/. php-fpm serves as www-data. These helpers restore www-data
# ownership without walking the millions of user-file inodes on every boot.
#
# Set AVUZ_CHOWN_DRYRUN=1 to print planned actions instead of running them
# (used by the test harness — no root required).

_avuz_chown() {
    local recursive="$1"; shift
    if [ -n "${AVUZ_CHOWN_DRYRUN:-}" ]; then
        if [ "$recursive" -eq 1 ]; then echo "CHOWN-R $*"; else echo "CHOWN $*"; fi
        return 0
    fi
    if [ "$recursive" -eq 1 ]; then
        chown -R www-data:www-data "$@" 2>/dev/null || true
    else
        chown www-data:www-data "$@" 2>/dev/null || true
    fi
}

_avuz_chmod() {
    local recursive="$1"; shift
    if [ -n "${AVUZ_CHOWN_DRYRUN:-}" ]; then
        if [ "$recursive" -eq 1 ]; then echo "CHMOD-R $*"; else echo "CHMOD $*"; fi
        return 0
    fi
    if [ "$recursive" -eq 1 ]; then
        chmod -R 770 "$@" 2>/dev/null || true
    else
        chmod 770 "$@" 2>/dev/null || true
    fi
}

_avuz_find_rechown() {
    local dir="$1"
    if [ -n "${AVUZ_CHOWN_DRYRUN:-}" ]; then echo "FIND-RECHOWN $dir"; return 0; fi
    find "$dir" \! -user www-data -exec chown www-data:www-data {} + || true
}

avuz_fix_perms_small() {
    local base="$1"
    _avuz_chown 1 "$base/config" "$base/custom_apps"
    _avuz_chmod 1 "$base/config" "$base/custom_apps"
    _avuz_chown 0 "$base/data"
    _avuz_chmod 0 "$base/data"
}

avuz_reconcile_data_ownership() {
    local data_dir="$1" did_db_upgrade="$2" did_config_run="$3"
    if [ "$did_db_upgrade" -eq 1 ]; then
        _avuz_find_rechown "$data_dir"
    elif [ "$did_config_run" -eq 1 ]; then
        shopt -s nullglob
        local appdata
        for appdata in "$data_dir"/appdata_*/; do
            _avuz_find_rechown "$appdata"
        done
        shopt -u nullglob
    fi
    _avuz_chown 0 "$data_dir/nextcloud.log"
}
```

> Note: every real `chown`/`chmod`/`find` ends in `|| true` (and `2>/dev/null`),
> so each primitive returns 0 under `set -e` even when a path is missing or a
> non-root test process can't chown. The dry-run test asserts the *labels*; the
> real path is exercised by the `set -e` no-op check in the test.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash docker/tests/perms.test.sh; echo "exit=$?"`
Expected: every line `ok - …`, final `exit=0`.

- [ ] **Step 5: Syntax-check the lib**

Run: `bash -n docker/lib-perms.sh && echo OK`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add docker/lib-perms.sh docker/tests/perms.test.sh
git commit -m "feat(entrypoint): add dry-run-testable ownership lib with gated data walk"
```

---

### Task 2: Wire the lib into the entrypoint

**Files:**
- Modify: `docker/entrypoint.sh` (source near top; phase-1 block 489-492; upgrade branch after line 606; phase-3 gate 658-664; phase-5 block 686-688)

**Interfaces:**
- Consumes: `avuz_fix_perms_small`, `avuz_reconcile_data_ownership` from Task 1.
- Produces: entrypoint that sets `DID_DB_UPGRADE` / `DID_CONFIG_RUN` and delegates all ownership work to the lib.

- [ ] **Step 1: Source the lib and declare signals**

In `docker/entrypoint.sh`, immediately after the `UPGRADE_STATE_FILE=...` line near the top (around line 7), add:

```bash

# Ownership helpers (see docker/lib-perms.sh). Baked to /usr/local/bin by the
# Dockerfile next to this script.
source /usr/local/bin/lib-perms.sh

# Boot signals consumed by avuz_reconcile_data_ownership in phase 5.
DID_DB_UPGRADE=0   # set after `occ upgrade` (core rewrite — full data walk)
DID_CONFIG_RUN=0   # set when run_avuz_configuration runs (appdata + log scope)
```

- [ ] **Step 2: Replace the phase-1 permission block**

Find (lines ~489-492):

```bash
# Fix permissions for mounted volumes
echo "Fixing permissions..."
chown -R www-data:www-data /var/www/html/data /var/www/html/config /var/www/html/custom_apps 2>/dev/null || true
chmod -R 770 /var/www/html/data /var/www/html/config /var/www/html/custom_apps 2>/dev/null || true
```

Replace with:

```bash
# Fix permissions for mounted volumes. data/ recursion is deliberately skipped
# here — occ runs as root (ignores ownership) and php-fpm starts only at phase 5,
# which reconciles data/ ownership. Recursing data/ now would be a wasted 3h walk
# on large local-disk clients. See docker/lib-perms.sh.
echo "Fixing permissions..."
avuz_fix_perms_small /var/www/html
```

- [ ] **Step 3: Set `DID_DB_UPGRADE` after the upgrade**

Find (line ~606):

```bash
        php occ upgrade --no-interaction
        php occ maintenance:mode --off
```

Replace with:

```bash
        php occ upgrade --no-interaction
        php occ maintenance:mode --off
        DID_DB_UPGRADE=1   # core upgrade can rewrite anywhere under data/
```

- [ ] **Step 4: Set `DID_CONFIG_RUN` where configuration runs**

Find (lines ~660-664):

```bash
if [ "$NEEDS_CONFIGURATION" -eq 1 ] || [ "$CURRENT_STAMP" != "$AVUZ_CONFIG_VERSION" ]; then
    run_avuz_configuration
else
    echo "✓ Avuz configuration up to date ($AVUZ_CONFIG_VERSION), skipping"
fi
```

Replace with:

```bash
if [ "$NEEDS_CONFIGURATION" -eq 1 ] || [ "$CURRENT_STAMP" != "$AVUZ_CONFIG_VERSION" ]; then
    run_avuz_configuration
    DID_CONFIG_RUN=1   # occ-as-root wrote appdata_* + nextcloud.log this boot
else
    echo "✓ Avuz configuration up to date ($AVUZ_CONFIG_VERSION), skipping"
fi
```

- [ ] **Step 5: Replace the phase-5 permission block**

Find (lines ~686-688):

```bash
echo "Final permissions check..."
chown -R www-data:www-data /var/www/html/data /var/www/html/config /var/www/html/custom_apps
chmod -R 770 /var/www/html/data /var/www/html/config /var/www/html/custom_apps
echo "✓ Permissions set"
```

Replace with:

```bash
echo "Final permissions check..."
avuz_fix_perms_small /var/www/html
avuz_reconcile_data_ownership /var/www/html/data "$DID_DB_UPGRADE" "$DID_CONFIG_RUN"
echo "✓ Permissions set"
```

- [ ] **Step 6: Syntax-check + assert the wiring**

Run:
```bash
bash -n docker/entrypoint.sh && echo SYNTAX_OK
grep -q 'source /usr/local/bin/lib-perms.sh' docker/entrypoint.sh && echo SOURCED_OK
grep -q 'DID_DB_UPGRADE=1' docker/entrypoint.sh && echo DBFLAG_OK
grep -q 'DID_CONFIG_RUN=1' docker/entrypoint.sh && echo CFGFLAG_OK
grep -q 'avuz_reconcile_data_ownership /var/www/html/data' docker/entrypoint.sh && echo RECONCILE_OK
# the old blind recursive data walk must be gone from both phases
! grep -q 'chmod -R 770 /var/www/html/data' docker/entrypoint.sh && echo NO_BLIND_DATA_CHMOD
```
Expected: `SYNTAX_OK`, `SOURCED_OK`, `DBFLAG_OK`, `CFGFLAG_OK`, `RECONCILE_OK`, `NO_BLIND_DATA_CHMOD` — all print.

- [ ] **Step 7: Re-run the lib tests (unchanged, must still pass)**

Run: `bash docker/tests/perms.test.sh; echo "exit=$?"`
Expected: all `ok -`, `exit=0`.

- [ ] **Step 8: Commit**

```bash
git add docker/entrypoint.sh
git commit -m "feat(entrypoint): gate data/ ownership walk behind boot signals"
```

---

### Task 3: Ship the lib in the image

**Files:**
- Modify: `Dockerfile` (near line 87, the entrypoint COPY)

**Interfaces:**
- Consumes: `docker/lib-perms.sh` from Task 1.
- Produces: `/usr/local/bin/lib-perms.sh` present in the runtime image so the entrypoint's `source` resolves.

- [ ] **Step 1: Add the COPY**

Find (line ~87):

```dockerfile
COPY docker/entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh
```

Replace with:

```dockerfile
COPY docker/entrypoint.sh /usr/local/bin/
COPY docker/lib-perms.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh
```

- [ ] **Step 2: Assert the COPY is present**

Run: `grep -q 'COPY docker/lib-perms.sh /usr/local/bin/' Dockerfile && echo COPY_OK`
Expected: `COPY_OK`

> Full build verification (`./scripts/build-push.sh`) happens in Task 5 — a
> Docker build is too heavy for this task's inner loop.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "build: ship lib-perms.sh into the runtime image"
```

---

### Task 4: Build the image and smoke-test the boot locally

**Files:** none (build + run)

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: a locally-built image whose entrypoint boots without the `source`/glob regressions.

- [ ] **Step 1: Build the local image**

Run (per CLAUDE.md build commands):
```bash
./scripts/build-base.sh latest local
./scripts/build-push.sh latest local
```
Expected: build completes; no error about `lib-perms.sh` missing.

- [ ] **Step 2: Confirm the lib is in the image**

Run:
```bash
docker run --rm --entrypoint sh registry.avuz.app/admin/avuzconecta:latest \
  -c 'test -f /usr/local/bin/lib-perms.sh && echo LIB_PRESENT'
```
Expected: `LIB_PRESENT`

- [ ] **Step 3: Confirm the entrypoint sources the lib without aborting**

Run (bash `-n` inside the image, plus a source smoke test):
```bash
docker run --rm --entrypoint bash registry.avuz.app/admin/avuzconecta:latest \
  -c 'bash -n /usr/local/bin/entrypoint.sh && source /usr/local/bin/lib-perms.sh && echo BOOT_PARSE_OK'
```
Expected: `BOOT_PARSE_OK`

- [ ] **Step 4: Commit (no-op if nothing changed)**

No code change expected. If the build surfaced a fix, commit it with a clear message and re-run Steps 1-3.

---

### Task 5: Operator validation on real stacks (gates the appdata-scoping decision)

> **Operator-run, not a dev-session task.** Run against real client stacks via
> Portainer console / `docker exec`. This is where the spec's Finding 2
> (filesystem type) and Finding 3 (appdata scoping is safe) are proven. Record
> outputs in the PR description.

**Interfaces:**
- Consumes: the image from Task 4.
- Produces: go/no-go evidence; possibly a one-line fallback change if scoping is unsafe.

- [ ] **Step 1: Record baseline on a large local-disk client (before deploy)**

Inside the current (old-image) container:
```bash
stat -f %T /var/www/html/data 2>/dev/null || df -T /var/www/html/data   # filesystem type (Finding 2)
find /var/www/html/data | wc -l                                          # inode count
```
Record both. If the filesystem is NFS, note it — traversal cost stays high even with `find`.

- [ ] **Step 2: Deploy the new image to that client and time the boot**

Redeploy the stack with the new image, then time to healthy. Compare against the historical ~3h. Expect a plain-restart/config-bump boot to drop to seconds/minutes.

- [ ] **Step 3: Validate Finding 3 — the user tree stays www-data across a config bump**

After a config-version-bump boot, inside the container:
```bash
find /var/www/html/data -maxdepth 2 -path '*/files*' \! -user www-data | head
find /var/www/html/data/appdata_* \! -user www-data 2>/dev/null | wc -l
ls -ld /var/www/html/data/nextcloud.log
```
Expected: **zero** non-www-data inodes under user `files/`. Non-zero → scoping is
unsafe: change the config-bump branch in `docker/lib-perms.sh` to a full walk —

```bash
    elif [ "$did_config_run" -eq 1 ]; then
        _avuz_find_rechown "$data_dir"
```

— re-run Task 1 tests (update the "config bump scopes to appdata + log" expected
output to `FIND-RECHOWN $tmp\nCHOWN $tmp/nextcloud.log`), rebuild, redeploy.

- [ ] **Step 4: Validate the S3 path (no `set -e` abort, boot unchanged)**

On an S3-primary client, deploy the same image. Confirm the boot completes (the
`appdata_*` glob is a no-op on S3 — no boot abort) and timing is unchanged.
```bash
docker logs <container> 2>&1 | grep -i 'Final permissions check' -A2
```
Expected: reaches `✓ Permissions set` and proceeds to `exec supervisord`.

- [ ] **Step 5: Functional check**

On both clients: log in, upload and download a file, confirm `nextcloud.log` is
being written (owned www-data). Confirm no permission errors in the log.

- [ ] **Step 6: Roll wider**

Once one local-disk + one S3 client are validated, deploy to remaining stacks.
In parallel, advance S3 migration of remaining local-disk clients — that retires
this problem class entirely (see spec "Strategic context").

---

## Notes for the executor

- Line numbers above are from the spec-time snapshot of `docker/entrypoint.sh`;
  if they drift, anchor on the quoted surrounding text, not the numbers.
- Do this work in a git worktree branched off `avuz-customization` (see
  `superpowers:using-git-worktrees`) — do not commit straight to the main branch.
- No `AVUZ_CONFIG_VERSION` bump is required for this change; it is fs-side boot
  logic, not NC config.
