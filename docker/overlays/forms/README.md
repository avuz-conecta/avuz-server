# forms overlay — conditional questions (Deck #448) + address block (Deck #449)

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

Address block (Deck #449, design
`docs/superpowers/specs/2026-11-23-forms-address-block-design.md`):
- Editor: the add and insert question menus get "Bloco de endereço", which
  adds 7 configured questions (technical names `cep`, `logradouro`, `numero`,
  `complemento`, `bairro`, `estado`, `municipio`; CEP regex; Estado = the 27
  states). Only upstream features are stored: these forms keep working
  without the overlay, only the menu entry and the auto-fill go away.
- Answer page: a `cep` answer with 8 digits is looked up on
  `https://viacep.com.br/ws/<cep>/json/` (browser `fetch`, 5 s timeout, no
  credentials) and fills Logradouro, Bairro, Município and Estado of its
  block (the questions up to the next `cep`), only where empty or still
  holding the earlier auto-fill. Needs the avuz_theme CSP listener
  (`ViaCepCspListener`); without it the lookup is blocked and silently skipped.

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
  of the port tree (6 commits: the #448 port, its sentinel and two fixes, then
  the #449 address block). Source of truth.
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
- `scripts/phpunit.sh` — runs the Forms PHPUnit suite in a throwaway
  nextcloud:33.0.8 container against the port tree. Paths are overridable:
  `FORMS_PORT_TREE`, `FORMS_PORT_SERVER_TESTS`.
- The front-end tests (`tests/javascript/jumps.test.mjs`,
  `tests/javascript/address-block.test.mjs`) live in the port tree and in
  `conditional-questions.patch`; they run from the port tree.

## How it's applied
- Dockerfile: `ARG AVUZ_FORMS_OVERLAY_VERSION=5.3.5`, **fails the build** if
  `apps/forms` is another version, then copies `js/`, `css/` and `lib/` over
  `apps/forms/`.
- Entrypoint: `forms` in `AVUZ_OWNED_APPS` (never store-updated; a
  `custom_apps/forms` shadow copy is quarantined at boot); sentinel
  `AVUZ-FORMS-CONDITIONAL-V1` in `lib/Service/SubmissionService.php`
  plus `removed-jumps` in `js/SetWindowTitle-BM9d6PYL.chunk.mjs` and the Submit chunk name in
  `js/forms-submit.mjs` (update both on every rebuild)
  (`verify_avuz_patches`, refuses to boot without them);
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
npm run test:address          # address block + ViaCEP mapping; 33 pass
/path/to/docker/overlays/forms/scripts/phpunit.sh  # PHPUnit in a throwaway nextcloud:33.0.8; 498 tests, 4 skipped
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
