# Avuz Conecta - Project Context

## What is this?
Nextcloud deployment with custom branding ("Avuz Conecta") running in Docker. Multi-platform builds: local (macOS/arm64) and staging (Linux/amd64).

## Architecture
- **Base image**: `scripts/build-base.sh` - PHP/nginx/supervisor base
- **App image**: `scripts/build-push.sh` - Nextcloud + customizations
- **Dockerfile**: Uses `ARG BASE_IMAGE` for dynamic base selection
- **Reverse proxy**: Nginx Proxy Manager in front (staging)

## Key Customizations

### Theming (`docker/entrypoint.sh`)
- Instance name: "Avuz Conecta"
- Primary color: `#2bb5e3`
- Default language/locale: `pt_BR`
- Theme: `avuz` (for translation/icon overrides)
- Logos: `apps/avuz_theme/img/` (logo-login.png, house-logo.svg, favicon-32.png)

### App Renaming (via theme translations)
- Files → Drive: `themes/avuz/apps/files/l10n/pt_BR.json`
- Deck → Tarefas: `themes/avuz/apps/deck/l10n/pt_BR.json`

### Icon Overrides (Lucide-style SVGs)
Location: `themes/avuz/apps/{app}/img/*.svg`
- activity → zap icon
- assinaturas (signature) — after adding or changing one on a running instance, clear the `imagePath-` distributed cache (or the old path sticks)
- calendar, contacts (users), dashboard, deck (square-kanban)
- files (folder), forms (layout-list), mail, settings, spreed (message-circle)

### CSS Customizations (`apps/avuz_theme/css/icons.css`)
- Menu link colors: `#00679e` (normal), `#2bb5e3` (active)
- SVG icon styling: stroke-based, currentColor

### Talk recording chunked upload
- spreed patched via overlay (`docker/overlays/spreed/lib/...`) applied during Docker build. Sentinel `AVUZ-CHUNKED-UPLOAD-V1` lives in the overlay's `RecordingController.php`; entrypoint verifies the running container's spreed has it.
- Bot fork lives in the **separate repo** `github.com/avuz-conecta/talk-recording`; image `registry.avuz.app/admin/talk-recording` referenced from `portainer-recording-stack.yml`.
- Lets recordings >100MB survive Cloudflare's 100MB body cap. See `docs/superpowers/plans/2026-05-21-talk-recording-chunked-upload.md`.

### Assinaturas (ZapSign e-signature)
- Avuz's own app, shipped as the `avuz-conecta/assinaturas` submodule at `apps/assinaturas` (branch `main`, built `js/` + `dist/` committed). The Dockerfile fails the build if it is not initialized and strips `src/`, `tests/`, `design/`, `docs/`, `scripts/` from the image.
- Optional stack env (see both `portainer-stack*.yml`): `ZAPSIGN_API_TOKEN` (tenant sub-account token), `ZAPSIGN_ENVIRONMENT` (`production`; `sandbox` on staging), `ZAPSIGN_COMPANY_NAME` (shown to signers), `ZAPSIGN_WEBHOOK_SECRET` (empty = app-generated). The app is enabled only when the token, a valid environment (`sandbox`/`production`) and a company name are all set; otherwise the boot disables it (data kept) and logs `– Assinaturas off: <reason>`.
- The env syncs to the app on every boot: `docker/lib-assinaturas.sh`, sourced by `docker/entrypoint.sh`.
- Webhook path: `/index.php/apps/assinaturas/webhook`. It needs a Cloudflare WAF skip rule, or ZapSign gets a challenge page.
- Access: members of `assinaturas`, company managers in `assinaturas-admins` (see/act on every envelope and folder, no Nextcloud admin), and Nextcloud admins. Envelopes nest in shareable app folders (Ver/Editar/Compartilhar/Gerenciar, inherited). The boot runs `occ assinaturas:groups:ensure` every time, so a deleted group comes back empty.
- Contract management is a paid add-on: app config `contracts_enabled` (default off), switched only by AvuzConecta admins (Avuz staff) on `/settings/admin/assinaturas`, "Gestão de contratos" section; client managers have no switch, and Uso stays usage-only. While it is off, signed contracts are still recorded (data kept), but no alerts, renewals or expiry happen. `ContractLifecycleJob` runs on plain Nextcloud cron every 12 h, not on the dedicated worker. Alerts are Nextcloud notifications; email follows each user's notification settings.
- Tenant provisioning: `docs/assinaturas-tenant-runbook.md`.
- Job worker: supervisor program `assinaturas-worker` (`docker/assinaturas-worker.sh`) runs `occ background-job:worker` for just `SendJob` and `SyncEnvelopeJob`. Nextcloud cron ticks every 300 s, but sends and webhooks must land in seconds.
- It idles (rechecks every 300 s) while the app is off or Nextcloud is not installed, so it runs on every tenant. After a worker failure it backs off 30 s. It logs state changes only.
- Contracts add-on: "Ler contratos com IA" (same admin section, AvuzConecta admins only; ON by default once the add-on is on and an AI provider exists; `contracts_ai_enabled=false` turns it off per client) reads draft PDFs through Nextcloud task processing (`core:text2text`, the `nextcloud-taskprocessing` worker); integration_openai's text-to-text provider is on only when an AI key exists (`avuz_sync_llm_provider_switch`). The Contratos screen lives at `/apps/assinaturas/contracts`.

### Mandatory admin 2FA (TOTP)
- Every boot enables `twofactor_totp` + `twofactor_backupcodes` and enforces 2FA for the `admin` group (`avuz_enforce_admin_2fa` in `docker/lib-apps.sh`, called from `docker/entrypoint.sh`). Idempotent; never narrows or disables an instance's existing enforcement (non-admin users unaffected). Opt out per stack with `AVUZ_ENFORCE_ADMIN_2FA=0` (default on).
- Lost-authenticator recovery (backup code, `occ twofactorauth:disable <uid> totp` via Portainer exec, re-enroll, `occ twofactorauth:state <uid>`, automation/test-admin note): `docs/runbooks/admin-2fa-recovery.md`.

### Impersonate (Deck #504)
- The `impersonate` app (an admin logs in as a user to debug) is vendored at `apps/impersonate` from the upstream release tarball (v4.0.0, the server-33 release; sha256 in the Dockerfile, which fails the build on another version). Un-ignored in `.gitignore`. Server 34 needs v5.0.0.
- Every boot runs `avuz_impersonate_sync` (`docker/lib-impersonate.sh`): writes app config `authorized` from `AVUZ_IMPERSONATE_GROUPS` (comma-separated, default/empty = `admin`; never `[]`, which the app reads as "no restriction"), then enables the app once per instance. An admin-disabled app stays off. `AVUZ_IMPERSONATE_ENABLED=0` disables it per stack; flipping back to 1 re-enables only an env-disabled app (marker `data/.avuz_impersonate_env_off`).
- Groups set in the app's admin page are overwritten on the next boot: the env is the source of truth.
- Logging: the app writes `User X trying to impersonate user Y` / `Changing to user Y` (warning) to the Avuz Conecta log (logreader); admin_audit has no impersonate listener. Actions taken while impersonating are logged as the impersonated user.

### External sites icon library (Deck #417)
- Every boot seeds 34 Lucide icons (`apps/avuz_theme/img/external-icons/`, light + `-dark` pairs, Lucide 0.555.0) into the External sites icon store (appdata `external/icons`, via IAppData, so S3 works): `docker/seed-external-icons.php`, called by `avuz_seed_external_icons` in `docker/lib-apps.sh`.
- Each icon is offered once per instance (`avuz_theme/external_icons_seeded`): it never overwrites an existing file and never brings back an icon the admin deleted. Opt out per stack with `AVUZ_SEED_EXTERNAL_ICONS=0` (default on).
- Change the set: edit `ICONS` in `scripts/generate-external-icons.py` (reads the theme's `js/lucide.js`), run it, commit the SVGs.
- The admin Icons section points to https://lucide.dev/icons (pt_BR override in `themes/avuz/apps/external/l10n/pt_BR.json`; plain text, the template escapes it).

### Calendar "Criado por" (card 455)
- `apps/dav/lib/CalDAV/CreatedBy/CreatedByPlugin.php` stamps `X-AVUZ-CREATED-BY;CN=<name>:<uid>` when someone other than the calendar owner creates an event (share/delegation) over CalDAV. Set on create, carried over on update (clients can't drop or forge it); owner-created events untouched.
- The calendar overlay (`docker/overlays/calendar/event-created-by.patch`, sentinel `AVUZ-CREATED-BY-V1`) shows "Criado por <nome>" in the popover and full editor. Older events have no stamp.

### Contacts WhatsApp button (card 266)
- Contacts 8.4.1 overlay (`docker/overlays/contacts/`, sentinel `AVUZ-WHATSAPP-PHONE-V1`): in view mode a WhatsApp button next to each phone number opens `wa.me/<digits>` (bare 10/11 digits get `55`; none for <8 digits, Fax/Pager/Car, or edit mode). Ships `js/` and `css/`; the Dockerfile fails on any other contacts version. pt_BR label in `themes/avuz/apps/contacts/l10n/pt_BR.json`.
- Rebuild needs the build clock pinned to the release date (`shift-build-date.cjs`), or the bundle won't match upstream. See `docker/overlays/contacts/README.md`.

## Important Configs

### Nginx (`docker/nginx.conf`)
- Standard Nextcloud config
- Theme icons served from `/themes/avuz/apps/*/img/`

### Nginx Proxy Manager (staging)
**Critical**: Add `^~` modifier for theme location to prevent asset caching regex from intercepting:
```nginx
location ^~ /themes/ {
    proxy_pass http://$server:$port;
    ...
}
```

### Dockerfile Permissions
Themes folder needs explicit permissions (already added):
```dockerfile
find /var/www/html/themes -type d -exec chmod 755 {} \;
find /var/www/html/themes -type f -exec chmod 644 {} \;
```

## Build Commands
```bash
# Local (arm64)
./scripts/build-base.sh latest local
./scripts/build-push.sh latest local

# Staging (amd64)
./scripts/build-base.sh latest staging
./scripts/build-push.sh latest staging

# Optional 3rd arg = tag suffix (e.g. experimental S3 variant):
./scripts/build-push.sh latest staging s3     # → :staging-s3
./scripts/build-push.sh latest local   s3     # → :latest-s3

# Pinned prod release (app3 runs :<date>-<sha>; ~12 tenant stacks run :latest).
# --no-latest pushes only the version tag, so tenants don't roll on next restart:
./scripts/build-push.sh 2026.10.18-ccb7b8d prod --no-latest
```

staging/prod push straight from buildx (`--output type=registry,oci-mediatypes=false
--provenance=false --sbom=false`), not `--load` + `docker push`: with a containerd
image store (OrbStack, recent Docker Desktop) `docker push` uploads an OCI index with
attestation manifests and registry.avuz.app rejects it as `manifest invalid`. The
image is therefore not in the local store after a staging/prod build; `docker pull`
it to inspect. Helpers and tests: `scripts/lib-docker.sh`, `scripts/tests/lib-docker.test.sh`.

## Deploy (`scripts/deploy.sh`)

Pulls `:latest` + recreates one or more Portainer stacks via the Portainer API
(`deploy-prod.sh` = same script against `deploy.prod.env`). After each stack
redeploys, it waits (up to `CACHEBUST_WAIT`=420 s — startup can take ~6 min) for
the fresh NC container to report `installed: true`, then bumps the theming
cachebuster: reads `occ config:app:get theming cachebuster` (default 0) and sets
it +1 as www-data, inside the stack's container via the Portainer Docker-API exec
proxy (same mechanism as `portainer-exec.sh`). This changes the
`?v=<versionHash>-<cachebuster>` asset URLs so browsers + Cloudflare (6-month
immutable cache) fetch fresh l10n/JS overrides shipped without a version bump.
Non-fatal — a failed/timed-out bump warns and the deploy still succeeds. Skip
with `--no-cachebust` or `SKIP_CACHEBUST=1`.

Bump the conectamail version in `apps/conectamail/appinfo/info.xml` on every
change to conectamail so the asset `?v=` cache-busts (assets cached 6 months at
Cloudflare/browsers). The next boot sees `needsDbUpgrade: true` and runs the
entrypoint's `occ upgrade` branch on its own.

On macOS the build scripts auto-launch the Docker runtime if it's down (OrbStack when installed, else Docker Desktop; override with `DOCKER_RUNTIME=orbstack|desktop`) (`scripts/lib-docker.sh`)
and, at the end, prompt `Stop it now? [y/N]` whenever Docker is running (default: keep).
Skip the prompt with `STOP_DOCKER_AFTER_BUILD=1` (auto-stop) or `KEEP_DOCKER=1` (auto-keep);
non-interactive shells never prompt. Linux just requires the daemon to be up.

## Building from a git worktree (READ THIS before building from one)

The Docker build context is `.` (the current tree). The gitignored bundled apps
(see the next section) and the `3rdparty` submodule live on disk **only in the
primary checkout** — a linked `git worktree` has NONE of them. Building from a
worktree without fixing this ships a BROKEN image: empty `3rdparty` makes the
container crash-loop with *"Composer autoloader not found"*, and every gitignored
app is simply absent.

**You do not need to do anything manual:** `scripts/build-push.sh` detects when
it is run from a linked worktree and copies the on-disk-only apps + `3rdparty`
from the primary checkout into the context before building (missing paths only —
it never overwrites your worktree's own changes). Just run `build-push.sh` from
the worktree as usual. (The alternative — building from the primary `avuz-customization`
checkout — also works, but then your worktree's committed changes aren't in the
image unless they're on that checkout's branch.)

## Fresh Checkout Setup (REQUIRED before first build)

`.gitignore` line 22 (`/apps*/*`) excludes every NC app from version control.
A fresh `git clone` ships with only a handful of force-added apps under `apps/`.
The other ~20 bundled apps (notifications, text, activity, twofactor_totp,
suspicious_login, logreader, password_policy, calendar, contacts, spreed,
forms, viewer, notify_push, onlyoffice, files_downloadlimit, files_retention,
external, bruteforcesettings, quota_warning) live in their
own GitHub repos and must be pulled in **before** `./scripts/build-push.sh`,
otherwise the resulting image is missing them and `occ app:enable` fails with
"not found on the appstore" at runtime.

`integration_openai`, `deck` and `assinaturas` are the exceptions: all three ship as
git submodules — NOT rsync'd and NOT App Store-installed. The first two are
**version-pinned forks**; `assinaturas` is Avuz's own app (branch `main`, built
`js/` + `dist/` committed).
`avuz-conecta/integration_openai` (branch `avuz`) at `apps/integration_openai`,
and `avuz-conecta/deck` (branch `avuz`, pinned at v1.17.0 + Avuz commits) at
`apps/deck` — the deck fork carries the board-copy fix and the board-tags feature
as real commits, plus its committed `vendor/` and built `js/` (the Dockerfile
can't rebuild either). Do not add any of them to the rsync loop below; init them as
submodules instead.

Two things to do on a fresh clone:

```bash
# 1. Init submodules: 3rdparty (Composer autoloader) + the integration_openai
#    and deck forks + the assinaturas app (or the build is missing them).
git submodule update --init --recursive 3rdparty apps/integration_openai apps/deck apps/assinaturas

# 2. Populate apps/ with the bundled NC apps.
#    Simplest: clone alongside an existing working checkout and rsync them in.
for app in activity bruteforcesettings calendar contacts external \
           files_downloadlimit files_retention forms logreader notifications \
           notify_push onlyoffice password_policy quota_warning spreed \
           suspicious_login text twofactor_totp viewer; do
  rsync -a /path/to/working/avuz-server/apps/$app/ apps/$app/
done
```

Long-term TODO: replace the rsync hack with a per-app `git clone` step in
the Dockerfile or a one-shot `scripts/fetch-apps.sh` so a fresh clone is
self-sufficient. Until that lands, keep one "golden" checkout around for
seeding new ones.

## S3 Primary Object Store (optional path)

See `docs/s3-deployment.md` for end-to-end deployment. Key points:

- Entrypoint writes `config/s3.config.php` **before** `maintenance:install`
  when `OBJECTSTORE_S3_BUCKET/KEY/SECRET/HOSTNAME` envs are all set.
- Switching primary store after install is a one-way door — set envs on the
  fresh stack, don't toggle them on an existing instance.
- `memcache.distributed=Redis` is set in `run_avuz_configuration`. This is
  required to unlock NC's chunked-upload v2 path (see
  [nextcloud/server#27034](https://github.com/nextcloud/server/pull/27034)).
  Without it NC silently falls back to v1 = downloads each chunk back from
  S3 and assembles through PHP, doubling bandwidth on every big upload.
- `verify_bucket_exists=false` is used because the NC `autocreate` flag
  is Swift-only and a no-op for S3 (the sample doc is misleading).
- Use `portainer-stack-s3.yml` as the deployment template — it has distinct
  volume names so it can coexist with the local-disk stack on the same host.

## Secrets in config writes

Never pass a secret as `occ ... --value=`: admin_audit logs every occ argv to
`data/audit.log`. Write it by env var NAME through `_avuz_php_config` /
`avuz_set_sensitive_app_config` (`docker/lib-apps.sh` →
`docker/set-app-config-from-env.php`); integration blocks live in
`docker/lib-integrations.sh`, and `docker/tests/integrations.test.sh` fails if any
stubbed call's argv carries a secret. Old leaks: `scripts/audit-log/run.sh`
(runbook `docs/runbooks/audit-log-secret-redaction.md`).

## Preview storage tools (`scripts/previews/`)

NC 33 previews on S3 live under `uri:oid:preview:<snowflake id>`, tracked in
`oc_previews` only — no quota counter shows them. `lib.php` holds the tested
logic (`php scripts/previews/tests/lib.test.php`); `run.sh` bundles it with an
entry script and runs it in a container as www-data:

    scripts/previews/run.sh <staging|prod> scan  <container>   # bucket vs DB, read-only
    scripts/previews/run.sh <staging|prod> purge <container>   # dry run
    scripts/previews/run.sh <staging|prod> purge <container> --execute
    scripts/previews/run.sh <staging|prod> purge <container> --sweep-only --cutoff=<ISO 8601>

`purge` preconditions: S3 and not multibucket; `preview_max_x/y` = 1280; no
legacy rows (`old_file_id` not null — truncating them orphans their
`urn:oid:` objects); the `preview` object-store alias resolves to `root`.
`--execute` / `--sweep-only` refuse when one fails; a dry run only reports.
It truncates `oc_previews` + `oc_preview_generation` (5 s lock wait, then
`FAIL lock wait exceeded — retry later`), then deletes preview objects older
than start − 10 min from the instance's own bucket only, in 200-key
deletes throttled to Ceph's pace (wait ≥ previous delete's duration). S3
5xx/connection errors are retried after 2/5/15/30/60 s; anything else, or a
failure that outlasts the retries, aborts (resumable with `--sweep-only`). `--sweep-only`
refuses a cutoff later than the oldest remaining `oc_previews` row: reuse the
cutoff printed by the original run. Never roll an image with
`AVUZ_CONFIG_VERSION` < `33.0.0-21` to a purged tenant (it resets the cap to
2048). Portainer exec does not return the container's exit code — read the
`precondition FAIL` / `ABORTED` lines. Design:
`docs/superpowers/specs/2026-09-29-preview-storage-reduction-design.md`.

## File Structure
```
apps/avuz_theme/
├── css/icons.css
├── js/lucide-icons.js (favicon updates only)
├── img/ (logos, favicons)
└── templates/update.user.php

themes/avuz/apps/
├── {app}/l10n/pt_BR.json (translations)
└── {app}/img/*.svg (icon overrides)
```
