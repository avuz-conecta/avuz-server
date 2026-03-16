# Upgrading Avuz Conecta (Nextcloud Fork)

This document describes how to upgrade from one Nextcloud major version to the next while preserving all Avuz customizations.

## Prerequisites

- Upstream remote configured: `git remote add upstream https://github.com/nextcloud/server.git`
- Claude Code with project commands available (`/project:upgrade-scan`, `/project:upgrade-rebase`, `/project:upgrade-verify`)
- `customizations.json` up to date at repo root

## Upgrade Process

### 1. Prepare

Fetch upstream tags and branches:

```bash
git fetch upstream --tags
```

Verify the target branch exists (e.g. for v33):

```bash
git rev-parse upstream/stable33
```

### 2. Scan for Conflicts

Run the scan command to analyze conflict risk:

```
/project:upgrade-scan
```

This checks every path in `customizations.json` against upstream changes between versions. Review the output — pay attention to:

- **CONFLICT** entries: files upstream changed that we also modified
- **REVIEW** entries: apps where upstream made structural changes
- Translation keys that were renamed or removed upstream

### 3. Rebase

Create the upgrade branch and rebase:

```
/project:upgrade-rebase
```

This walks you through:

1. Creating `upgrade-to-v{XX}` branch from `avuz-customization`
2. Rebasing 19 custom commits onto the new upstream stable branch
3. Resolving conflicts one by one with context about what changed and why
4. Rebuilding dist files via `npm run build`
5. Updating version references (entrypoint.sh, customizations.json)

#### Common conflict resolutions

**`apps/files/src/views/Settings.vue`** (WebDAV hiding patch):
Re-apply the patch on the v33 version. Look for `FilesAppSettingsWebDav` import and template usage, comment them out with `// Avuz:` prefix.

**`dist/` files**:
Accept upstream version during rebase. Rebuild after rebase with `npm run build`.

**`.gitignore` / `.gitattributes`**:
Merge both changes — keep our additions, accept upstream additions.

**Translation files**:
Our override files only contain partial keys. The `merge-l10n.sh` script merges them with upstream at build time. Check that our override keys still match upstream source strings.

### 4. Verify

Run the verification command:

```
/project:upgrade-verify
```

This checks:
- All customization files are present
- PHP syntax is valid
- Translation JSON is valid and keys exist upstream
- Docker files reference the correct version
- Core patches are in place

### 5. Build and Test

```bash
# Build locally
./scripts/build-base.sh latest local
./scripts/build-push.sh latest local

# Or for staging
./scripts/build-base.sh latest staging
./scripts/build-push.sh latest staging
```

Test checklist:
- [ ] Login page shows split-screen layout with Avuz branding
- [ ] Navigation icons are Lucide-style SVGs
- [ ] "Files" appears as "Drive" in pt_BR
- [ ] "Deck" appears as "Tarefas" in pt_BR
- [ ] New user creation triggers Avuz welcome board
- [ ] Email template uses Avuz logo
- [ ] Favicons are Avuz-branded
- [ ] WebDAV settings are hidden in Files app
- [ ] Dark mode icons load correctly
- [ ] Dashboard shows Avuz styling (white cards, light background)

### 6. Finalize

After testing, merge the upgrade branch:

```bash
git checkout avuz-customization
git merge upgrade-to-v{XX}
git branch -d upgrade-to-v{XX}
```

Update `master` if needed:

```bash
git checkout master
git reset --hard avuz-customization
```

Push to origin:

```bash
git push origin avuz-customization
git push origin master
```

## Commit Convention

All Avuz-specific commits use the `avuz()` prefix:

| Prefix | Scope |
|---|---|
| `avuz(theme)` | CSS, JS, images, login page, icons |
| `avuz(app)` | avuz_theme PHP app (listeners, services, mail) |
| `avuz(core)` | Patches to upstream Nextcloud source files |
| `avuz(docker)` | Dockerfile, entrypoint, nginx, compose, build scripts |
| `avuz(translation)` | Translation overrides in themes/avuz/ |
| `avuz(meta)` | customizations.json, UPGRADING.md, commands, CLAUDE.md |

Examples:
```
avuz(core): hide WebDAV settings from Files app
avuz(theme): add dark mode icon variants for deck and forms
avuz(translation): update pt_BR overrides for deck activity strings
avuz(docker): update entrypoint GIT_APPS_BRANCH to stable33
avuz(app): add custom welcome board for new users
avuz(meta): update customizations.json for v33
```

## File Reference

| File | Purpose |
|---|---|
| `customizations.json` | Machine-readable registry of all customizations |
| `.claude/commands/upgrade-scan.md` | Conflict analysis command |
| `.claude/commands/upgrade-rebase.md` | Guided rebase command |
| `.claude/commands/upgrade-verify.md` | Post-upgrade verification command |
| `scripts/merge-l10n.sh` | Merges translation overrides with upstream at Docker build time |
| `docker/entrypoint.sh` | Runtime config, app management, upgrade logic |

## Customization Architecture

```
apps/avuz_theme/          # Custom Nextcloud app (PHP, CSS, JS, images)
  ├── lib/                # Event listeners, services, mail template
  ├── css/                # Login, theme, header, icons styling
  ├── js/                 # Lucide icons, favicon, header centering
  ├── img/                # Logos, favicons, network diagram
  └── templates/          # Maintenance page override

themes/avuz/              # Nextcloud theme layer (icons + translations)
  ├── core/img/           # Favicon overrides
  ├── apps/*/img/         # Navigation icon overrides (SVG)
  ├── apps/*/l10n/        # Translation overrides (merged at build time)
  └── custom_apps/*/      # Same overrides for App Store apps

docker/                   # Container runtime config
scripts/                  # Build and translation scripts
```

Key design principle: customizations are isolated from upstream code. Only `apps/files/src/views/Settings.vue` directly modifies an upstream file. Everything else uses Nextcloud's theme layer, custom app APIs, or Docker configuration.
