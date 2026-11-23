# Formulários Conditional Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Single choice and dropdown answers in Formulários can jump to a later question or to the end of the form; respondents see only the questions on their path (Deck #448).

**Architecture:** Hand-port upstream nextcloud/forms#3833 onto Forms v5.3.5 with its exact stored format (`extraSettings.goTo` / `extraSettings.next`), as one source patch in `docker/overlays/forms/`. The image ships the changed PHP files plus the rebuilt `js/` (and `css/` if emitted) over `apps/forms`, like the contacts overlay; `forms` becomes an Avuz-owned app.

**Tech Stack:** Forms 5.3.5 (PHP 8.3, Vue 3 + @nextcloud/vue 9, Vite 7, node ^24), PHPUnit, node:test.

**Spec:** `docs/superpowers/specs/2026-11-19-forms-conditional-questions-design.md`

## Global Constraints

- Base: Forms tag `v5.3.5` exactly (`apps/forms` in the image). Dockerfile fails on any other version.
- Upstream source of truth: nextcloud/forms#3833 at the head commit at port time; record the SHA in the patch header and the overlay README (today `9999a7f4478d4f3d88bd3c209a0c8a9cc0172b57`, still moving).
- Stored format exactly as upstream: `extraSettings.goTo: [{ optionId: number, target: number | 'submit' }]` (plus `{ other: true, target }` for "Outro"), `extraSettings.next: number | 'submit'`; a type has one of them, never both. Target constant `'submit'`.
- Only #3833 (radio = `multiple_unique`, `dropdown`, and the "After question N" select on text/file/color/ranking/grid). Not #3834/#3835/#3837.
- No database migration.
- Forms without jumps behave exactly as today (editor, submit view, results, CSV export).
- Every new UI string has a pt_BR entry in `themes/avuz/apps/forms/l10n/pt_BR.json`; say AvuzConecta, never Nextcloud.
- Overlay sentinel `AVUZ-FORMS-CONDITIONAL-V1`, checked at boot like spreed's.
- Before building an image from this worktree: `apps/spreed` on disk is 23.0.14 (from the Talk branch). Rebase this branch on `avuz-customization` after PR #44 merges, or restore the 23.0.1 copy for the build; never build this branch with a mismatched Talk.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A required question after a jump that skips it: submit succeeds (server and client agree on the path). Test in Task 2 (`testValidateSubmissionDoesNotRequireSkippedQuestions`) and Task 3 (fixture).
2. A form without any jump: submit view shows every question and the server requires every required one, as today. Test in Task 2 (fixture case "no jumps shows every question") and the HML check (Task 5).
3. Editing an existing submission after the respondent changes the deciding answer: answers to now-skipped questions are removed, not kept. Test in Task 2 (`testUpdateSubmission_removesAnswersToSkippedQuestions`).
4. Copying a form or a question and importing a form: jump targets and option ids map to the copies. Test in Task 2 (`testCloneFormMapsJumps`, `testCloneQuestionMapsOptionIdsOfJumps`, `testImportMapsJumps`).
5. Results and CSV export of a form with jumps: skipped questions show as empty answers, no error. Checked in Task 5 (HML).

---

### Task 1: Port tree and test environment

**Files:**
- Work tree: `<scratch>/forms-port` (clone of nextcloud/forms at `v5.3.5`, branch `avuz-conditional`)
- Create: `docker/overlays/forms/README.md` (start: what, base, upstream SHA, rebuild recipe stub)

- [ ] **Step 1:** clone `v5.3.5`, `git switch -c avuz-conditional`, `composer install` (dev deps, for PHPUnit) and `npm ci`. Fetch `gh pr diff 3833 --repo nextcloud/forms` at the recorded head SHA into the scratchpad.
- [ ] **Step 2:** a PHPUnit environment: `tests/bootstrap.php` needs an installed server (`../../../lib/base.php`). Use a throwaway local Docker container of the official server image at core 33.0.8 with SQLite (no Avuz data, no network to Avuz hosts), mount the port tree at `apps/forms`, enable the app.
- [ ] **Step 3:** run `./vendor/bin/phpunit -c tests/phpunit.xml` on the unchanged tree. Expected: green (or a recorded baseline of pre-existing failures). Run `npm run build`. Expected: exit 0, and the output equals the shipped `apps/forms/js` up to minifier naming (otherwise pin the build clock as in `docker/overlays/contacts/shift-build-date.cjs` and record it).

### Task 2: Server side (validation, cleanup, path, copy/import)

**Files (port tree):**
- Modify: `lib/Constants.php`, `lib/Controller/ApiController.php`, `lib/Service/FormsService.php`, `lib/Service/SubmissionService.php`, `lib/FormsMigrator.php`, `lib/ResponseDefinitions.php`
- Create: `tests/fixtures/jump-paths.json` (upstream file, unchanged)
- Test: `tests/Unit/Service/FormsServiceTest.php`, `tests/Unit/Service/SubmissionServiceTest.php`, `tests/Unit/Controller/ApiControllerTest.php`, `tests/Unit/FormsMigratorTest.php`

**Interfaces:**
- Produces (PHP, same names as upstream): `Constants::JUMP_TARGET_SUBMIT = 'submit'`; `FormsService::areJumpsOfForm(array $extraSettings, array $formQuestions): bool`; `FormsService::removeJumpsOfMissingOptions(Question $question): bool`; `areExtraSettingsValid()` accepts `goTo` / `next` for the question types upstream allows; response header `X-Forms-Adjusted: removed-jumps=(<question ids>)` (RFC 8941 inner list) on update, reorder, copy and option delete when jumps were removed; status codes and payload shapes unchanged; a target in another form = HTTP 400.
- Produces (behavior): the submission path starts at the first question and follows jumps; a missing target counts as the next question; only the first value of an answer decides; answers to skipped questions are ignored on new submissions and removed on edit; only questions on the path are required.

- [ ] **Step 1: Port the upstream tests** listed in the PR for these files (names as upstream: `testUpdateQuestionRemovesJumpsToTheQuestionItselfOrAnEarlierQuestion`, `testDeleteOptionRemovesItsJumps`, `testUpdateQuestionRejectsJumpsToQuestionsOfOtherForms`, `testUpdateQuestionRemovesJumpsOfMissingOptions`, `testReorderQuestionsRemovesJumpsThatWouldGoBack`, `testReorderQuestionsReportsQuestionsWithRemovedJumps`, `testCloneQuestionAtTheEndRemovesJumpsThatWouldGoBack`, `testCloneQuestionAtAPositionKeepsJumpsToTheQuestionsAfterIt`, `testCloneFormMapsJumps`, `testCloneQuestionMapsOptionIdsOfJumps`, `testImportMapsJumps`, `testImportDropsJumpsForOptionsOfOtherQuestions`, `testAreJumpsOfForm`, `testRemoveJumpsOfMissingOptions`, `testMapJumps*`, `testRemoveBackwardJumps`, `testJumpPaths` (data provider = `tests/fixtures/jump-paths.json`), `testValidateSubmissionDoesNotRequireSkippedQuestions`, `testValidateSubmissionRequiresNothingAfterAnOptionalQuestionWithJumpsLeftEmpty`, `testNewSubmission_storesNoAnswersWhenAnOptionalQuestionWithJumpsIsLeftEmpty`, `testUpdateSubmission_removesAnswersToSkippedQuestions`), adapting setup to 5.3.5 mocks.
- [ ] **Step 2:** run them. Expected: FAIL (methods missing / jumps ignored).
- [ ] **Step 3:** port the production code hunk by hunk from the PR diff onto the 5.3.5 files; where a hunk does not apply, re-implement the same behavior on 5.3.5's code shape. Port a prerequisite fix from #3912–#3916 only when a ported test needs it, and list it in the README.
- [ ] **Step 4:** full PHPUnit run. Expected: all new tests PASS, baseline unchanged.
- [ ] **Step 5:** commit in the port tree (`feat: conditional questions server side (port of nextcloud/forms#3833)`).

### Task 3: Submit view (respondent path)

**Files (port tree):**
- Create: `src/utils/Jumps.ts` (upstream file; adapt imports to 5.3.5 types)
- Modify: `src/views/Submit.vue`, `src/components/Questions/AnswerInput.vue`, `src/mixins/QuestionMixin.js`, `src/mixins/QuestionMultipleMixin.ts` (where upstream edits `src/composables/useQuestion.ts` / `useQuestionMultiple.ts`), `src/models/` or types file holding `FormsQuestion` (add `goTo` / `next` to extraSettings)
- Test: `tests/javascript/jumps.test.mjs` (node:test, loads `src/utils/Jumps.ts` with node 24 type stripping, or a tiny esbuild step if imports need it)

**Interfaces:**
- Consumes: the stored format (Global Constraints).
- Produces (same names as upstream): `JUMP_TARGET_SUBMIT`, `isJumpOf(jump, answer)`, `getJumpTarget(...)`, `getVisibleQuestions(questions, answers)`, `getJumpIssues(questions): JumpIssues`, `withoutBackwardJumps(questions)`, `withoutRemovedJumps(...)`, `canDecideByAnswer(question)`.

- [ ] **Step 1: Write the failing test:** `jumps.test.mjs` runs every case of `tests/fixtures/jump-paths.json`: `assert.deepEqual(getVisibleQuestions(case.questions, case.answers).map((q) => q.id), case.visible)`. Run `node --test tests/javascript/jumps.test.mjs`. Expected: FAIL (module missing).
- [ ] **Step 2:** add `src/utils/Jumps.ts`. Run the test. Expected: PASS for every fixture case (same cases PHPUnit runs: both sides walk the same path).
- [ ] **Step 3:** Submit view shows only `getVisibleQuestions(...)`, announces path changes to screen readers (upstream's live region), keeps a skipped question's state when it comes back, and sends no answers for skipped questions; the edit-submission rule (a deciding answer no longer offered becomes required again) as upstream.
- [ ] **Step 4:** `npm run build` and `npm run lint` (if the 5.3.5 tree has it). Expected: exit 0.
- [ ] **Step 5:** commit (`feat: conditional questions submit view`).

### Task 4: Editor (jump selects and warnings)

**Files (port tree):**
- Create: `src/components/Questions/JumpTargetSelect.vue` (upstream; visible label "Go to", accessible name `After "<answer>" go to`)
- Modify: `src/components/Questions/Question.vue`, `QuestionMultiple.vue`, `QuestionDropdown.vue`, `QuestionShort.vue` (and the other types that get the "After question N" select), `src/views/Create.vue`

**Interfaces:**
- Consumes: Task 3 `Jumps.ts`; Task 2 server behavior and the `X-Forms-Adjusted` header.

- [ ] **Step 1:** per-option "Go to" select on single choice (incl. "Outro") and dropdown; one "After question N" select on text, file, color, ranking, grid; targets = next question, any later question, end of form.
- [ ] **Step 2:** moves that would break forward-only jumps ask first (move back / remove jumps); warnings and a toast name broken jumps and unreachable/skippable questions; the optional-question hint (respondents who leave it empty can submit without the questions after it); saves of one question run in sequence and structural edits wait for pending saves (upstream behavior). Read `X-Forms-Adjusted` and show removed jumps.
- [ ] **Step 3:** pt_BR strings for every new string in `themes/avuz/apps/forms/l10n/pt_BR.json` (merged by the existing l10n merge).
- [ ] **Step 4:** `npm run build`. Expected: exit 0. Re-run Task 2 PHPUnit and Task 3 node tests. Expected: PASS.
- [ ] **Step 5:** commit (`feat: conditional questions editor`), export the 3 port commits as one patch: `git format-patch --stdout v5.3.5..HEAD > <avuz-server>/docker/overlays/forms/conditional-questions.patch`.

### Task 5: Ship in the image and check on HML

**Files (avuz-server):**
- Create: `docker/overlays/forms/lib/...` (only the changed PHP files), `docker/overlays/forms/js/` (+ `css/` if emitted; full build output except source maps), `docker/overlays/forms/tests/jumps.test.mjs`, `docker/overlays/forms/README.md` (base, upstream SHA, ported prerequisite fixes, rebuild recipe, verify greps)
- Modify: `Dockerfile` (`ARG AVUZ_FORMS_OVERLAY_VERSION=5.3.5`, fail on another `apps/forms`, then copy the overlay), `docker/entrypoint.sh` (`forms` into `AVUZ_OWNED_APPS`; sentinel line `AVUZ-FORMS-CONDITIONAL-V1|forms|lib/Service/SubmissionService.php|...` next to spreed's), `themes/avuz/apps/forms/l10n/pt_BR.json`, `CLAUDE.md` (one short section)
- Test: `docker/tests/*.test.sh` if one covers the sentinel list or `AVUZ_OWNED_APPS`

- [ ] **Step 1:** add the sentinel comment to the overlay's `SubmissionService.php`; Dockerfile guard + copy; entrypoint changes. Run the docker tests (`bash:5` container). Expected: PASS.
- [ ] **Step 2:** build `:staging-1` (`KEEP_DOCKER=1 ./scripts/build-push.sh latest staging 1`, Talk constraint above), deploy from the golden checkout (`./scripts/deploy.sh -y avuz-conecta`), wait healthy; boot log shows the sentinel check passing.
- [ ] **Step 3:** HML browser check (verify-avuz-conecta skill; a test user created without e-mail, or the user's credentials file):
  - build Eco-ambiental's case: "Endereço igual ao anterior?" Sim → jump past the address block (CEP, Rua, Nº, Bairro, Cidade, UF, all required), Não → next question;
  - answer "Sim": address questions hidden, submit succeeds; answer "Não": they show and are required;
  - a form without jumps: unchanged;
  - edit a submission from "Não" to "Sim": address answers removed;
  - results and CSV export of the form with jumps: no error, skipped answers empty.
  Screenshots + report in `~/work/avuz/reports/2026-11-2x-forms-conditional.md`; delete the test forms.
- [ ] **Step 4:** commit; PR into `avuz-customization` only on Patrick's word.
