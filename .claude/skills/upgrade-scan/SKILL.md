---
name: upgrade-scan
description: Analyze conflict risk between Avuz customizations and a target Nextcloud version. Run before starting any upgrade.
---

You are running the Avuz Conecta upgrade scan. This command analyzes conflict risk between current customizations and a target Nextcloud version.

## Instructions

1. Read `customizations.json` from the repo root to get the list of all customizations and the target version.

2. Fetch upstream if not already done:
   ```
   git fetch upstream --tags
   ```

3. Determine the source and target refs:
   - Source: `upstream/stable{base_version_major}` (e.g. upstream/stable32)
   - Target: `upstream/stable{target_version_major}` (e.g. upstream/stable33)

4. For each entry in `customizations.json`, check if upstream changed those files between source and target:
   ```
   git diff --name-only upstream/stable32..upstream/stable33 -- <paths>
   ```

5. For entries where upstream DID change files, inspect the actual diff to understand what changed:
   ```
   git diff upstream/stable32..upstream/stable33 -- <path>
   ```

6. For translation entries specifically:
   - Check if the source language strings (English keys) changed between versions
   - Check if the translation file structure changed
   - Flag any keys in our overrides that no longer exist upstream

7. Generate a conflict probability report with three categories:

   **SAFE** (green): Upstream did not touch these files. Carry forward as-is.

   **REVIEW** (yellow): Upstream changed nearby files or the same app. Manual review recommended but conflicts unlikely.

   **CONFLICT** (red): Upstream changed the exact same files. Will definitely conflict during rebase.

8. For each CONFLICT entry, show:
   - What upstream changed and why (read the upstream commit messages)
   - What our customization does
   - Suggested resolution strategy

9. Also check:
   - Whether `apps/avuz_theme/lib/Mail/EMailTemplate.php` parent class (`OC\Mail\EMailTemplate`) changed in v33
   - Whether Nextcloud v33 changed the theme loading mechanism
   - Whether any apps in the entrypoint.sh lists were removed/renamed in v33
   - Whether the `notify_push` binary path structure changed

10. Output the full report in a readable format. End with a summary count: X safe, Y review, Z conflict.
