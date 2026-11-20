# forms overlay — conditional questions (Deck #448)

## What
Patched build of Nextcloud Forms **v5.3.5** for Avuz Conecta: port of upstream
nextcloud/forms PR #3833 ("Conditional questions: go to a question based on the
answer"), which is not in any release. Design:
`docs/superpowers/specs/` and plan `docs/superpowers/plans/` (Formulários
conditional questions). Work in progress: this README grows with each task.

## Base
- Forms tag `v5.3.5` (commit `9b2fb46e338fa162611d492eca55d521b1a50048`, dated
  2026-07-21), as shipped in `apps/forms` (gitignored).
- Upstream PR #3833, head commit `9999a7f4478d4f3d88bd3c209a0c8a9cc0172b57`
  (diff and description saved outside the repo, `forms-port-upstream/`).

## Port tree and tests
- Port tree: clone of `v5.3.5`, branch `avuz-conditional`
  (`~/work/avuz/forms-port`, outside the repo).
- PHPUnit: `~/work/avuz/forms-port-test.sh [phpunit args]` runs
  `vendor/bin/phpunit -c tests/phpunit.xml` in a throwaway `nextcloud:33.0.8`
  container (SQLite, port tree mounted as `apps/forms`, server `tests/` copied
  from the `v33.0.8` tag since release images lack it). Baseline on the
  unchanged tree: 391 tests, 1157 assertions, 4 skipped, green.
- Build: `npm ci && npm run build` (node 24) on the unchanged tree needs no
  clock pin: all 63 `js/` files and `css/` are byte-identical to the shipped
  `apps/forms/js` and `css`.

## Upstream fixes ported with it
Server parts of fixes split out of #3833 (merged on upstream `main`, not in
5.3.5), ported because #3833's code or tests rely on them:
- #3870 `isShownToRespondents` (questions the submit view hides are never
  required and do not decide the path); its linear-scale boolean check is not
  ported.
- #3913 the title regex of `isShownToRespondents`.
- #3904 `isListOfValues` (an answer must be a list; `[]` counts as no answer).
- #3916 `isOtherAnswer` (with "Other" allowed, other values must still be
  option ids).
- #3903 only its `normalizeNumericOptionId` line (option ids in canonical
  notation only, so the path and the stored answer agree).
- #3884 only "export keeps option ids" (import needs them to map `goTo`).

## Files here
(filled in by later tasks)

## How it's applied
(filled in by later tasks)

## Rebuild (required on every forms upgrade)
(stub: completed by later tasks)
```bash
git clone --depth 1 --branch v<NEW_VERSION> https://github.com/nextcloud/forms
cd forms
npm ci && npm run build      # unpatched build matches the release tarball
```
