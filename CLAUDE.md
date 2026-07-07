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
- Logos: `apps/avuz_theme/img/` (logo2.png, house-logo.svg, favicon-32.png)

### App Renaming (via theme translations)
- Files → Drive: `themes/avuz/apps/files/l10n/pt_BR.json`
- Deck → Tarefas: `themes/avuz/apps/deck/l10n/pt_BR.json`

### Icon Overrides (Lucide-style SVGs)
Location: `themes/avuz/apps/{app}/img/*.svg`
- activity → zap icon
- calendar, contacts (users), dashboard, deck (square-kanban)
- files (folder), forms (layout-list), mail, settings, spreed (message-circle)

### CSS Customizations (`apps/avuz_theme/css/icons.css`)
- Menu link colors: `#00679e` (normal), `#2bb5e3` (active)
- SVG icon styling: stroke-based, currentColor

### Talk recording chunked upload
- spreed patched via overlay (`docker/overlays/spreed/lib/...`) applied during Docker build. Sentinel `AVUZ-CHUNKED-UPLOAD-V1` lives in the overlay's `RecordingController.php`; entrypoint verifies the running container's spreed has it.
- Bot fork lives in the **separate repo** `github.com/avuz-conecta/talk-recording`; image `10.50.100.103:8080/admin/talk-recording` referenced from `portainer-recording-stack.yml`.
- Lets recordings >100MB survive Cloudflare's 100MB body cap. See `docs/superpowers/plans/2026-05-21-talk-recording-chunked-upload.md`.

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
```

On macOS the build scripts auto-launch Docker Desktop if it's down (`scripts/lib-docker.sh`)
and, at the end, prompt `Stop it now? [y/N]` whenever Docker is running (default: keep).
Skip the prompt with `STOP_DOCKER_AFTER_BUILD=1` (auto-stop) or `KEEP_DOCKER=1` (auto-keep);
non-interactive shells never prompt. Linux just requires the daemon to be up.

## Fresh Checkout Setup (REQUIRED before first build)

`.gitignore` line 22 (`/apps*/*`) excludes every NC app from version control.
A fresh `git clone` ships with only a handful of force-added apps under `apps/`.
The other ~20 bundled apps (notifications, text, activity, twofactor_totp,
suspicious_login, logreader, password_policy, calendar, contacts, deck, spreed,
forms, viewer, notify_push, onlyoffice, files_downloadlimit, files_retention,
external, bruteforcesettings, quota_warning) live in their
own GitHub repos and must be pulled in **before** `./scripts/build-push.sh`,
otherwise the resulting image is missing them and `occ app:enable` fails with
"not found on the appstore" at runtime.

`integration_openai` is the exception: it is a **version-pinned fork**
(`avuz-conecta/integration_openai`, branch `avuz`) shipped as a git submodule at
`apps/integration_openai` — NOT rsync'd and NOT App Store-installed. Do not add
it to the rsync loop below; init it as a submodule instead.

Two things to do on a fresh clone:

```bash
# 1. Init submodules: 3rdparty (Composer autoloader) + the integration_openai
#    fork (or the build is missing them).
git submodule update --init --recursive 3rdparty apps/integration_openai

# 2. Populate apps/ with the bundled NC apps.
#    Simplest: clone alongside an existing working checkout and rsync them in.
for app in activity bruteforcesettings calendar contacts deck external \
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
