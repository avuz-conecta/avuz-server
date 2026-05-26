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
```

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
