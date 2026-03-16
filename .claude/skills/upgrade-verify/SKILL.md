---
name: upgrade-verify
description: Verify all Avuz customizations survived the upgrade process. Run after upgrade-rebase.
---

You are running the Avuz Conecta upgrade verification. This command checks that all customizations survived the upgrade process.

## Instructions

1. Read `customizations.json` from the repo root.

2. Run a file presence check for every path in every entry:
   ```
   for each entry.paths: test -f <path> or test -d <path>
   ```
   Report PASS/FAIL for each.

3. Check custom app integrity:
   - `apps/avuz_theme/appinfo/info.xml` exists and has valid XML
   - The `max-version` in info.xml covers the target version
   - `apps/avuz_theme/lib/AppInfo/Application.php` has no syntax errors:
     ```
     php -l apps/avuz_theme/lib/AppInfo/Application.php
     ```
   - Run `php -l` on all PHP files in `apps/avuz_theme/lib/`

4. Check translation overrides:
   - For each translation JSON in `themes/avuz/apps/*/l10n/pt_BR.json`:
     - Verify it's valid JSON
     - Verify it has a "translations" key
     - Check that override keys exist in the corresponding upstream translation file
     - Flag any orphaned keys (our overrides for strings that no longer exist upstream)

5. Check theme icon files:
   - All SVG files in `themes/avuz/apps/*/img/` are valid (non-empty, start with `<svg` or `<?xml`)
   - All PNG files are non-empty

6. Check Docker build files:
   - `Dockerfile` exists and references `apps/avuz_theme`
   - `Dockerfile` has the `merge-l10n.sh` COPY and RUN steps
   - `docker/entrypoint.sh` references the target version branch (not the old one)
   - `docker/nginx.conf` exists
   - `docker/supervisor.conf` exists
   - `scripts/merge-l10n.sh` exists and is executable
   - `scripts/build-base.sh` exists
   - `scripts/build-push.sh` exists

7. Check the core patch:
   - `apps/files/src/views/Settings.vue` still has the WebDAV hiding comment/patch
   - If the patch is missing, flag it as FAIL with instructions to re-apply

8. Check dist files:
   - If dist/ files exist, verify they were rebuilt (modification time after rebase)
   - If dist/ files don't exist, note that `npm run build` needs to run

9. Check version consistency:
   - `customizations.json` base_version matches the actual upstream base
   - `docker/entrypoint.sh` GIT_APPS_BRANCH matches target version
   - No stale references to the old version remain

10. Output a checklist:
    ```
    [PASS] avuz-theme-app: all 9 files present
    [PASS] theme-icon-overrides: all 20 files present
    [FAIL] translation-settings: 2 orphaned keys found
    ...
    ```

11. End with a summary: X passed, Y failed, Z warnings.

12. If all checks pass, confirm the upgrade is ready for Docker build and testing.
    If any checks fail, list the remediation steps.
