# Formulários: conditional questions (Deck #448)

Status: approach approved by Patrick 2026-11-19 (port upstream now). Scope
confirmed 2026-11-20: single choice and dropdown jumps only; Eco-ambiental
builds a new form with "Endereço igual ao anterior? Sim / Não" (their
attachment used a checkbox "Mesmo da anterior", which needs upstream #3834;
not ported).

## Why

Eco-ambiental wants a question to show depending on the previous answer. Their
form asks "Endereço igual ao anterior?" and the address questions should only
appear for "Não". Formulários (Forms 5.3.5 in our image) has no conditional
logic. Upstream Forms is building it ("Conditional questions", nextcloud/forms
#3833, milestone 5.5, in review; no release date, likely early 2027). Patrick
wants it for the client now.

## Goals

- A choice (radio) or dropdown answer can jump to a later question or to the
  end of the form; respondents see only the questions on their path.
- Forms created now keep working after Forms 5.5 ships with the upstream
  feature: same stored format, so we drop our port then.
- Required questions that are skipped never block submission.

## Non-goals

- Upstream's later stack parts: jumps after checkbox (#3834), date/time
  (#3835), linear scale (#3837). Port them later only if a client asks.
- Sections / "go to section" (upstream #3664).
- Upgrading Forms past 5.3.5.

## Anti-goals

- A storage format of our own (would clash with 5.5).
- Breaking existing forms or submissions: forms without jumps behave exactly
  as today, in the editor, the submit view, results and export.
- An App Store update or a `custom_apps` copy silently replacing the patched
  Forms.

## Effort

Forms 5.3.5 predates upstream's front-end refactor: question logic lives in
mixins (`src/mixins/QuestionMixin.js`, `QuestionMultipleMixin.ts`), not the
`src/composables/` the PR edits. The editor and submit-view part is a
translation, not a copy: ~3-4 days in all (was 2-3).

## Approaches

1. **Hand-port upstream #3833 onto Forms 5.3.5** (picked). It does not apply
   as a patch: upstream `main` is 288 commits past 5.4.2, and the diff
   conflicts in 14 files on 5.3.5 (10 on 5.4.2). Same data format, so it is
   forward-compatible; cost ~2-3 days plus re-checks until 5.5.
2. Wait for Forms 5.5: free, no date.
3. Own design: rejected, permanent fork that clashes with 5.5.

## What #3833 does (the behavior to port)

Source of truth: the PR description and diff of nextcloud/forms#3833 at the
head commit the port starts from (record its SHA in the patch header).

- **Editor**: radio and dropdown questions get a "Go to" select per option
  (radio also for "Other"): next question, a later question, or end of form.
  Text, file, color, ranking and grid questions get one "After question N"
  select. Jumps only go forward; moves that would break that ask first.
  Warnings name broken jumps and unreachable/skippable questions.
- **Data**: in the question's `extraSettings`: `goTo` (one target per option
  id) or `next` (one target), never both. Targets are later questions of the
  same form or `"submit"`. The server drops invalid/back jumps on update,
  reorder, copy and option delete and reports them in the `X-Forms-Adjusted`
  header. Copy/import of a form remaps targets and option ids.
- **Answers**: the path starts at the first question and follows jumps; the
  submit view shows only questions on the path; the server ignores answers to
  skipped questions and requires only questions on the path; editing a
  submission drops answers to now-skipped questions.
- `tests/fixtures/jump-paths.json`: shared path cases for PHPUnit and the
  front end.

The PR's prerequisite fixes (merged on upstream `main` separately: #3912,
#3913, #3914, #3915, #3916) are ported only where #3833 depends on them; the
builder decides which, and lists them in the overlay README.

## How it ships

- Forms source v5.3.5 + our port as one patch in `docker/overlays/forms/`
  (`conditional-questions.patch`, header names upstream PR + SHA), rebuilt
  JS (and CSS if Forms emits it) plus the changed PHP files, like
  `docker/overlays/contacts/`. Pin the build clock if the bundle needs it to
  reproduce (`nc-app-rebuild-build-date-pin` notes, `shift-build-date.cjs`).
- Dockerfile: copy the overlay over `apps/forms/` and fail the build if
  `apps/forms` is not 5.3.5.
- Add `forms` to `AVUZ_OWNED_APPS` in `docker/entrypoint.sh` (never
  store-updated, `custom_apps` shadow copies purged) and add a sentinel
  (`AVUZ-FORMS-CONDITIONAL-V1`) the boot verifies, like spreed's.
- pt_BR strings for every new UI string in
  `themes/avuz/apps/forms/l10n/pt_BR.json` (upstream's translations will not
  exist yet).
- No database migration: `extraSettings` is already a JSON column.

## Tests

- Port upstream's PHPUnit and unit tests that cover #3833 and run them on the
  5.3.5 base; the shared `jump-paths.json` cases pass on both sides.
- HML (staging-1), real browser: build Eco-ambiental's case (Sim → skip the
  address block, Não → address questions), answer both ways, check results
  and CSV export; a form without jumps behaves as before; a required skipped
  question does not block; editing a submission after changing the answer
  drops the skipped answers.

## Calls made (Claude, for Patrick to check)

- **Format freeze**: port from #3833's head commit at port time (record the
  SHA). Until 5.5 ships, recheck the PR's `goTo` / `next` format on each
  update; if it changes before merge, the 5.5 upgrade gets a one-off converter
  for forms built on our port.
- **Rollout**: ships in the shared image, so every tenant gets it at the next
  after-hours fleet roll, after the HML check (prod steps gated as always).
  Forms without jumps behave as today, so this is additive.
- **Rollback**: roll forward, never down (same rule as the Forms 5.3 drift).
  An image without the port rejects the `goTo` / `next` keys
  (`areExtraSettingsValid`), so jump questions could not be edited and skipped
  required questions would block again. No strip-before-rollback step.
- **Version freeze**: Forms stays at 5.3.5 until 5.5. A Forms security
  release means redoing the port on that version (overlay README recipe).

## Left to the builder

- Port order and which prerequisite fixes to bring.
- Whether upstream's Playwright tests are worth running locally or are
  replaced by the HML browser check.
