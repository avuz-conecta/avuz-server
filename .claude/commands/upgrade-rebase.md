You are running the Avuz Conecta upgrade rebase. This command guides the user through rebasing avuz customization commits onto a new Nextcloud stable branch.

## Pre-flight checks

1. Read `customizations.json` to understand all customizations and their risk levels.

2. Confirm the current branch and state:
   ```
   git status
   git branch --show-current
   ```

3. Verify upstream is fetched and the target branch exists:
   ```
   git fetch upstream --tags
   git rev-parse upstream/stable33 > /dev/null
   ```

4. Identify the custom commit range:
   ```
   git log --oneline upstream/stable{base_major}..avuz-customization
   ```

## Branch setup

5. Create the upgrade branch from avuz-customization (if not already on it):
   ```
   git checkout avuz-customization
   git checkout -b upgrade-to-v33
   ```

6. Before rebasing, inform the user:
   - How many commits will be rebased
   - Which commits are high-risk (from customizations.json)
   - The dist/ files will conflict — plan is to drop them and rebuild

## Rebase execution

7. Start the rebase:
   ```
   git rebase upstream/stable33
   ```

8. For each conflict that arises:
   - Show which file(s) conflict
   - Explain what upstream changed and why (check upstream commit messages)
   - Explain what our customization does (reference customizations.json)
   - Suggest a resolution:
     - For `apps/files/src/views/Settings.vue`: re-apply the WebDAV hiding patch on the v33 version of the file
     - For `dist/` files: accept upstream version, will rebuild later
     - For `.gitignore`/`.gitattributes`: merge both changes
     - For translation files: keep our override structure, check keys still exist
   - Ask the user to confirm before resolving

9. After each conflict resolution:
   ```
   git add <resolved files>
   git rebase --continue
   ```

## Post-rebase tasks

10. After rebase completes, rebuild dist files:
    ```
    npm ci && npm run build
    ```

11. Update version references in the codebase:
    - `docker/entrypoint.sh`: change `GIT_APPS_BRANCH` default from `stable32` to `stable33`
    - `docker/entrypoint.sh`: update viewer app download URL from `stable32` to `stable33`
    - `customizations.json`: update `base_version` to the new version
    - `CLAUDE.md`: update any version references

12. Commit the post-rebase updates:
    ```
    git add -A
    git commit -m "avuz(meta): update version references for v33 upgrade"
    ```

13. Show the final state:
    ```
    git log --oneline upstream/stable33..HEAD
    ```

14. Remind the user to run `/project:upgrade-verify` next.
