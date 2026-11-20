# forms overlay — conditional questions (Deck #448)

## What
Patched build of Nextcloud Forms **v5.3.5** for Avuz Conecta: port of upstream
nextcloud/forms PR #3833 ("Conditional questions: go to a question based on the
answer"), which is not in any release (milestone 5.5). Design:
`docs/superpowers/specs/2026-11-19-forms-conditional-questions-design.md`, plan
`docs/superpowers/plans/2026-11-20-forms-conditional-questions.md`.

- Editor: single choice and dropdown questions get a "Go to" select per option
  (single choice also for "Other"); text, file, color, ranking and grid
  questions get one "After question N" select. Targets: next question, a later
  question, or end of form. Jumps only go forward.
- Stored in the question's `extraSettings` as `goTo` (option id → target) or
  `next` (one target), upstream's format: forms built now keep working on
  Forms 5.5, and this overlay is dropped then.
- Submit view shows only questions on the respondent's path; the server
  requires only those and ignores answers to skipped questions; editing a
  submission drops answers that are now skipped.
- Forms without jumps behave as in 5.3.5, with one exception: editing a
  submission whose chosen option was renamed now opens the "form has changed"
  dialog (5.3.5 dropped the answer silently).

## Base
- Forms tag `v5.3.5` (commit `9b2fb46e338fa162611d492eca55d521b1a50048`, dated
  2026-07-21), as shipped in `apps/forms` (gitignored).
- Upstream PR #3833, head commit `9999a7f4478d4f3d88bd3c209a0c8a9cc0172b57`
  (diff and description saved outside the repo, `~/work/avuz/forms-port-upstream/`).
  Recheck the PR's `goTo` / `next` format on each upstream update until 5.5.

## Upstream fixes ported with it
Server parts of fixes split out of #3833 (merged on upstream `main`, not in
5.3.5), ported because #3833's code or tests rely on them:
- #3870 `isShownToRespondents` (questions the submit view hides are never
  required and do not decide the path); its linear-scale boolean check is not
  ported.
- #3913 the title regex of `isShownToRespondents`.
- #3904 `isListOfValues` (an answer must be a list; `[]` counts as no answer).
- #3916 `isOtherAnswer` (with "Other" allowed, other values must still be
  option ids; a bare "Other" without text is a 400, as upstream).
- #3903 only its `normalizeNumericOptionId` line (option ids in canonical
  notation only, so the path and the stored answer agree).
- #3884 only "export keeps option ids" (import needs them to map `goTo`).

Front end: upstream's grid-answer parse when editing a submission (5.3.5 sent
the stored grid JSON as a string → 400); not ported: `withOfferedValues`
(stale option ids in drafts), upstream's `savingKeys` refactor, the
`AnswerInput` menu z-index and padding changes.

## Files here
- `conditional-questions.patch` — `git format-patch --stdout v5.3.5..avuz-conditional`
  of the port tree (5 commits; the last adds the sentinel). Source of truth.
- `lib/` — full-file replacements of the PHP files the patch changes
  (`Constants.php`, `Controller/ApiController.php`, `FormsMigrator.php`,
  `ResponseDefinitions.php`, `Service/FormsService.php`,
  `Service/SubmissionService.php`). `SubmissionService.php` carries the
  sentinel `AVUZ-FORMS-CONDITIONAL-V1`.
- `js/` — the whole patched build (`npm run build`), no source maps. Vite
  content-hashes the chunks, so every chunk name differs from the release;
  the release's old chunks stay on disk in the image, unused. The four entry
  files (`forms-main.mjs`, `forms-submit.mjs`, `forms-settings.mjs`,
  `forms-emptyContent.mjs`) keep their names.
- `css/` — the build's CSS (only `forms-style.css` differs from the release).
- `tests/jumps.test.mjs` — the front-end path test. It imports
  `../../src/utils/Jumps.ts` and reads `../fixtures/jump-paths.json`, so it
  runs from the port tree, not from here (see Rebuild).

## How it's applied
- Dockerfile: `ARG AVUZ_FORMS_OVERLAY_VERSION=5.3.5`, **fails the build** if
  `apps/forms` is another version, then copies `js/`, `css/` and `lib/` over
  `apps/forms/`.
- Entrypoint: `forms` in `AVUZ_OWNED_APPS` (never store-updated; a
  `custom_apps/forms` shadow copy is quarantined at boot); sentinel
  `AVUZ-FORMS-CONDITIONAL-V1` in `lib/Service/SubmissionService.php`
  (`verify_avuz_patches`, refuses to boot without it);
  `reapply_avuz_forms_overlay` after core upgrades.
- pt_BR strings for the new UI: `themes/avuz/apps/forms/l10n/pt_BR.json`
  (merged by `merge-l10n.sh` at build).
- Browsers: `scripts/deploy.sh` bumps the theming cachebuster after each
  redeploy, which gives the entry files a new `?v=`. Chunks are
  content-hashed and need no cache-bust. No `AVUZ_CONFIG_VERSION` bump: the
  overlay is baked into the image and the sentinel runs on every boot, and a
  bump would rerun the configuration on every tenant's first boot.
- Rollback: roll forward, never down. An image without this overlay rejects
  `goTo` / `next` in `extraSettings`, so forms with jumps could not be edited
  and skipped required questions would block submits again.

## Rebuild (required on every forms upgrade)
The unpatched build reproduces the release without a clock pin (all `js/` and
`css/` byte-identical to v5.3.5), unlike contacts. Node 24, npm 11.

```bash
git clone --branch v<NEW_VERSION> https://github.com/nextcloud/forms forms-port
cd forms-port
git switch -c avuz-conditional
npm ci && npm run build
#  1. unpatched build must match the release tarball (js/ css/ without .map)
git am /path/to/docker/overlays/forms/conditional-questions.patch
#     (on a new version expect conflicts: redo the port, see the spec)
#  2. tests
npm run test:jumps            # node --experimental-transform-types (Constants.ts enums); 30 pass
~/work/avuz/forms-port-test.sh  # PHPUnit in a throwaway nextcloud:33.0.8; 498 tests, 4 skipped
#  3. patched build
npm run build
```
Then refresh the overlay from the port tree:
```bash
O=/path/to/docker/overlays/forms
rm -rf "$O/js" "$O/css" "$O/lib" && mkdir -p "$O/js" "$O/css"
for f in $(git diff --name-only v<NEW_VERSION>..HEAD -- lib); do mkdir -p "$O/$(dirname "$f")"; cp "$f" "$O/$f"; done
for f in js/*; do case "$f" in *.map) ;; *) cp "$f" "$O/js/";; esac; done
cp css/*.css "$O/css/"
cp tests/javascript/jumps.test.mjs "$O/tests/"
git format-patch --stdout v<NEW_VERSION>..HEAD > "$O/conditional-questions.patch"
```
and update `AVUZ_FORMS_OVERLAY_VERSION` in the Dockerfile,
`customizations.json` and this README.

## Verify
```bash
grep -c 'AVUZ-FORMS-CONDITIONAL-V1' docker/overlays/forms/lib/Service/SubmissionService.php   # 1
grep -l 'goTo' docker/overlays/forms/js/*.mjs                                                # the Submit and SetWindowTitle (shared Jumps) chunks
# in a running container (path resolved like the boot check):
php occ app:getpath forms        # /var/www/html/apps/forms, not custom_apps
grep -c 'AVUZ-FORMS-CONDITIONAL-V1' /var/www/html/apps/forms/lib/Service/SubmissionService.php
```
Boot log: `✓ Avuz patches present` and no `forms overlay missing`.
