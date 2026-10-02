# Assinaturas: deferred minors inventory for Plan 4

Repo `~/work/avuz/assinaturas`, verified against `main` at 32fe11a on 2026-10-02. Line numbers refer to that commit.

Sources:
- the ledgers `plan-3a/progress.md`, `plan-3b/progress.md` and `plan-3b/final-minors.md`;
- the final fix brief and report (their items are counted FIXED);
- the full outputs of all 65 review subagents of session 78b12568. That covers 6 per-task reviews and the final review for 3a; for 3b, every task review, re-review and the 4 final area reviews.

Every review "Minor", "Should" and "Later" item was traced to the code.

Counts:
- OPEN: 91.
- FIXED: 191 entries (some group related items).
- DECIDED: 22.
- BROWSER-CHECK: 7.

| Area | OPEN items |
|---|---|
| backend-php | 18 (M1–M18) |
| dev-env | 5 (M19–M23) |
| kit-styles | 10 (M24–M33) |
| dashboard-detail | 20 (M34–M53) |
| files-sidebar-admin | 11 (M54–M64) |
| wizard-state | 11 (M65–M75) |
| pdf-placement | 10 (M76–M85) |
| api-client | 6 (M86–M91) |

Test names follow the repo's styles. PHPUnit uses `testThirdPersonVerb…`. Vitest uses `it('third-person verb…')` inside the existing `describe` blocks.

---

## backend-php

### M1. One owner-file check for create, replace and source
- **Source:** 3b T3 review and re-review; final backend "Can wait".
- **Files:**
  - `lib/Draft/EnvelopeDrafts.php:116-136` (`sourceOf`), `:345-360` (`sourceFile`), `:369-373` (`assertDraft`), `:316-317`, `:410-415`;
  - the same `getFirstNodeById` + `instanceof File` lookup in `lib/Send/SentContent.php:29`, `lib/Api/EnvelopeDetails.php:85` and `lib/Download/EnvelopeDownloads.php:100`.
- **Problem:** `sourceOf` repeats `sourceFile`'s mime, download and size checks in a different order (download before mime), so a file with two problems gets a different code per route.
- **Fix:**
  - Add one private `ownerPdf(string $owner, int $fileId, int $missingStatus): File` that checks existence, mime, download permission and size in one order. `sourceFile` and `sourceOf` both call it.
  - Give `assertDraft` a `$status` parameter (default 422), so `sourceOf` calls `assertDraft($envelope, Http::STATUS_CONFLICT)`.
  - Optionally move the shared lookup into a small `OwnerFiles` service used by the other three call sites.
- **Test:** `tests/Integration/Draft/EnvelopeDraftsEditingTest.php::testReportsTheSameCodeForAFileWithTwoProblemsOnCreateAndOnSource`.

### M2. Source route buffers the whole PDF in memory
- **Source:** 3b T3 minor; final backend "Can wait" (capped by `MAX_FILE_BYTES`).
- **Files:** `lib/Draft/EnvelopeDrafts.php:135` (`$file->getContent()`), `lib/Download/DownloadedPdf.php`, `lib/Controller/EnvelopeController.php` (`source`).
- **Fix:** `sourceOf` returns the `File`, or a stream from `$file->fopen('rb')`. The controller answers with a `StreamResponse` and keeps `Content-Type: application/pdf` and `Cache-Control: no-store`.
- **Test:** `tests/Integration/Controller/EnvelopeControllerTest.php::testStreamsTheCurrentDriveBytesOfADraftDocumentWithoutCaching`. Adapt it to read the streamed body, and assert the bytes and headers are unchanged.

### M3. `sourceOf` `file_too_large` is untested
- **Source:** 3b T3 re-review; final backend "Can wait".
- **Files:** `lib/Draft/EnvelopeDrafts.php:132-134`.
- **Fix:** test only. Grow the file's recorded size through its storage cache (`getStorage()->getCache()->update($id, ['size' => MAX_FILE_BYTES + 1])`) instead of writing a 20 MB fixture.
- **Test:** `tests/Integration/Draft/EnvelopeDraftsEditingTest.php::testRefusesTheSourceOfAFileThatGrewPastTheLimit` (422 `file_too_large`).

### M4. ViewOnlyShareTest logs out outside `finally`
- **Source:** 3b T3 re-review; final backend "Can wait".
- **Files:** `tests/Integration/Access/ViewOnlyShareTest.php:84-98`.
- **Fix:** wrap the call in `try { … } finally { self::logout(); }`, so a throw cannot leave the session logged in for later classes. This is a test-hygiene fix; the fix is the test change.

### M5. Private `OC\User\NoUserException` import
- **Source:** 3b T3 minor; final backend "Later: NoUserException → userExists".
- **Files:** `lib/Api/EnvelopeDetails.php:7,80`.
- **Fix:**
  - Inject `IUserManager` and return `null` sizes when `!userExists($owner)` before `getUserFolder()`.
  - Catch only `NotPermittedException`.
  - Drop the `OC\` import, so `lib/` has no private Nextcloud API left.
- **Test:** `tests/Integration/Controller/EnvelopeControllerTest.php::testShowsANullSizeToAnAdminWhenTheOwnerWasDeleted` already exists; it must stay green. No `OC\` import remains in `lib/` (grep in CI).

### M6. Notifier link edge tests
- **Source:** 3b T4 re-review.
- **Files:** `lib/Notification/Notifier.php:63-70`, `tests/Integration/Notification/NotifierTest.php:60-66`.
- **Fix:**
  - Pin the empty link for an unknown object type.
  - Tighten the provider test from `assertStringContainsString` to `assertStringEndsWith('/settings/admin/assinaturas', …)`.
- **Test:** `NotifierTest::testLeavesTheLinkEmptyForAnUnknownObjectType`, plus the tightened `testLinksProviderHealthToTheAdminSettingsInsteadOfAnEnvelope`.

### M7. Page-cap boundary is tested only at `PHP_INT_MAX`
- **Source:** 3b T2 re-review; final backend "Can wait".
- **Files:** `lib/Controller/EnvelopeController.php:52`, `tests/Integration/Controller/EnvelopeControllerTest.php:164`.
- **Fix:** test only.
- **Test:** `EnvelopeControllerTest::testAcceptsTheLastPageBeforeTheCapAndRefusesTheNext`. `intdiv(PHP_INT_MAX, 100)` answers 200, and that value plus one answers 422.

### M8. Listing runs two summary queries per envelope (N+1)
- **Source:** 3b T2 review; ledger; final backend "Can wait".
- **Files:** `lib/Api/EnvelopeDetails.php:33-47` (`summary` per row in `listing`), `lib/Api/EnvelopeView.php` (`summary`), `lib/Db/SignerMapper.php`, `lib/Db/DocumentMapper.php`.
- **Fix:**
  - Add mapper methods that count signers, signed signers and documents for a list of envelope ids in one grouped query each, using the query builder.
  - `listing()` passes those maps into `EnvelopeView::summary`.
- **Test:** `tests/Integration/Db/SignerMapperTest.php::testCountsTheSignersOfManyEnvelopesInOneCall`, plus the existing listing tests staying green.

### M9. A kept document's `name` goes stale after a Drive rename
- **Source:** final backend "Later".
- **Files:** `lib/Draft/EnvelopeDrafts.php:97-102` (kept branch of `replaceDocuments`), `docs/api.md:107`.
- **Fix:** in the kept branch, also `setSourcePath($userFolder->getRelativePath($file->getPath()))`, so `name` follows the file like `size` already does.
- **Test:** `EnvelopeControllerTest::testShowsTheCurrentNameOfAKeptDocumentAfterItWasRenamed`.

### M10. Links and reminders compute "current group" differently
- **Source:** final backend "Later: shared current-group helper".
- **Files:** `lib/Action/SignerLinks.php:51,70-80`, `lib/Action/SignerReminders.php:57-66`.
- **Problem:** links use any not-signed signer; reminders use pending or viewed signers. Links also ignore `cancelRequestedAt`.
- **Fix:**
  - Add one `SigningTurn::currentGroup(array $signers): ?int` over open signers (pending or viewed), used by both.
  - `SignerLinks` refuses `link_unavailable` while `cancelRequestedAt !== null`, as reminders do.
- **Test:**
  - `tests/Integration/Action/SignerLinksTest.php::testRefusesALinkWhileTheCancellationIsOnItsWay`;
  - `tests/Unit/Action/SigningTurnTest.php::testTakesTheLowestGroupWithAnOpenSigner`.

### M11. No index for the Files-sidebar `fileId` lookup
- **Source:** final backend "Later: fileId index migration".
- **Files:** `lib/Db/EnvelopeMapper.php:140-147`; `lib/Migration/Version000100Date20260928000000.php:70,77` (columns without index).
- **Fix:** add a new migration step that adds indexes `assin_doc_source_file` on `source_file_id` and `assin_doc_signed_file` on `signed_file_id`, guarded by `hasIndex`. Bump `info.xml`.
- **Test:** `tests/Integration/Db/DocumentMapperTest.php::testIndexesTheSourceAndSignedFileIds`, which checks the schema has both indexes.

### M12. `replaceDocuments` has no rollback test
- **Source:** final backend "Later".
- **Files:** `lib/Draft/EnvelopeDrafts.php:81-105`.
- **Fix:** test only. Use a failing `DocumentMapper` double, like `tests/Fakes/FailingSignerMapper.php`, that throws on the second insert.
- **Test:** `EnvelopeDraftsEditingTest::testKeepsTheOldDocumentsWhenReplacingThemFailsMidway`.

### M13. `fileId` + `scope=mine` on a file shared between members is unpinned
- **Source:** final backend "Later".
- **Files:** `lib/Db/EnvelopeMapper.php:136-147`, `tests/Integration/Controller/EnvelopeControllerTest.php:199-209`.
- **Fix:** test only.
- **Test:** `EnvelopeControllerTest::testListsOnlyMyEnvelopesOfAFileAnotherMemberAlsoSent`.

### M14. No controller-level page test for a non-member
- **Source:** 3a T2 review and ledger MINOR.
- **Files:** `tests/Integration/Controller/PageControllerTest.php:72-83`.
- **Fix:** test only. Log in a user outside the signers group, call `index()`, and assert the provided config has `canUseApp` false.
- **Test:** `PageControllerTest::testHandsANonMemberAConfigurationThatCannotUseTheApp`.

### M15. PageController injects `EnvelopeAccess` only to read the user id
- **Source:** 3a T2 review.
- **Files:** `lib/Controller/PageController.php:7,29,49`.
- **Fix:** inject `IUserSession` and read `getUser()?->getUID()`, a lighter dependency with the same behaviour.
- **Test:** the existing `PageControllerTest::testHandsTheCurrentUsersConfigurationToTheFrontend` and M14 cover it.

### M16. LoadFilesActionListenerTest reaches into Nextcloud internals
- **Source:** 3a T5 review and ledger MINOR.
- **Files:** `tests/Integration/Listener/LoadFilesActionListenerTest.php:11,15,43-46,56,100`; also `PageControllerTest.php:7` (`OC\InitialStateService`).
- **Fix:**
  - Move the four `ReflectionProperty` resets and the `getInitialStates()` read into one test helper, e.g. `tests/Integration/NextcloudPageState.php`, with a one-line Nextcloud-version note.
  - Sort the `use` block (`OC\…` before `OCA\…`).
- **Test:** this is a test-hygiene fix; the fix is the helper. Both test classes use it and stay green.

### M17. `EnvelopeMapper::findRecent` is production code used only by tests and the seed
- **Source:** final backend minor.
- **Files:** `lib/Db/EnvelopeMapper.php:89`; callers `tests/Integration/EnvelopeCleanup.php:24`, `tests/env/seed-demo.php:145`.
- **Fix:** move the query into a test-support function (query builder) used by both callers, and delete it from the mapper.
- **Test:** the existing suites that rely on `EnvelopeCleanup` stay green. The seed still prints 7 envelopes.

### M18. A past deadline can still reach ZapSign after the create settled, and reopen strands it
- **Source:** 3b T18 review ("Remaining gap", "Follow-up"); final backend minor (`claim` exemption, midnight race).
- **Files:**
  - `lib/Send/EnvelopeSender.php:61-94` (`claim`, `wouldCreateWithPastDeadline`);
  - `lib/Send/EnvelopeCreation.php:55-72` (adopt or create after the 600 s window);
  - `lib/Action/EnvelopeCancellation.php:111` (`reopen` refuses when `createAttemptedAt` is set).
- **Fix:**
  - (a) `EnvelopeCreation` re-checks the deadline right before a fresh create, i.e. when not adopting. A passed deadline fails the send with `deadline_invalid` and no ZapSign call.
  - (b) `reopen` accepts a failed envelope whose create settled and whose folder lookup found nothing: it clears `createAttemptedAt`.
- **Test:**
  - `tests/Integration/Send/EnvelopeSenderTest.php::testFailsASendWhoseDeadlinePassedBeforeTheCreate`;
  - `tests/Integration/Action/EnvelopeCancellationTest.php::testReopensAFailedSendWhoseLostCreateWasNotFoundAtZapSign`.

---

## dev-env

### M19. TypeScript leaves optional props and the build config unchecked
- **Source:** 3a T1 review and ledger MINOR.
- **Files:** `tsconfig.json` (no `exactOptionalPropertyTypes`; `include` only `src/`); `vite.config.ts` and `eslint.config.js` are not type-checked.
- **Fix:**
  - Turn on `"exactOptionalPropertyTypes": true` and fix the fallout (mostly `prop?: T` passed `undefined`).
  - Add a `tsconfig.node.json` that includes `vite.config.ts`, `eslint.config.js` and `scripts/*.mjs` (with `checkJs`).
  - Run both from `npm run typecheck`.
- **Test:** `npm run typecheck` clean. Configuration only; no spec.

### M20. Seed timestamps contradict their own events and depend on the run date
- **Source:** 3b T1 ledger MINOR and re-review.
- **Files:** `tests/env/seed-demo.php:196-210`, `:272-286`, the fixed `deadline` values; `design/README.md`.
- **Problems:**
  - The Contrato's `updatedAt` is "2 hours ago", but its events run up to 5 minutes ago.
  - The expired envelope's `updatedAt` is "1 day ago", before its 2026-09-30 23:59:59 expiry.
  - The fixed deadlines fall into the past on later runs.
- **Fix:**
  - Derive each `updatedAt` from the latest timeline moment, and set the expired envelope's to its deadline end.
  - Write deadlines relative to the run ("+4 days 23:59:59").
  - Add one line to `design/README.md` Known differences: dates match the artboards only when seeded on 2026-10-01.
- **Test:** dev script, no spec. Verify by running `tests/env/seed-demo.php`: the dashboard order and detail timeline agree, and no live envelope shows an overdue deadline.

### M21. `serve.sh` uses a magic trusted_domains index and swallows the theme failure
- **Source:** 3b T1 ledger MINOR and review.
- **Files:** `tests/env/serve.sh:33,35`.
- **Fix:**
  - Compute the next free `trusted_domains` index from `occ config:system:get trusted_domains`, or name it in a variable with its reason.
  - Replace `|| true` on `app:enable avuz_theme` with an explicit "skip when the app is absent" check (`occ app:list`), so a real failure stops the script.
- **Test:** dev script; verify `serve.sh start` on a fresh `reset.sh` instance.

### M22. Test fixtures and harnesses live in `src/` as non-spec modules, and `deferred()` is duplicated
- **Source:** 3b T7 ledger MINOR ("fixtures not .spec.ts"); 3b T12 review (duplicated `deferred`).
- **Files:**
  - `src/presentation/envelope-fixtures.ts`, `src/presentation/pt-br-environment.ts`, `src/wizard/wizard-harness.ts`;
  - `src/detail/SignersCard.spec.ts:98` (copy of `deferred` from `wizard-harness.ts:91`).
- **Fix:**
  - Move the test-only modules to `src/test-support/`, excluded from the build entries and coverage.
  - Export `deferred()` once from there, and update imports.
- **Test:** this is a test-hygiene fix; the move is the fix. vitest, typecheck and lint stay green, and the built `js/` doesn't change.

### M23. Help-launcher clearance comment has the wrong arithmetic
- **Source:** 3b T8 ledger TODO and T9 re-review ("launcher comment arithmetic confusing").
- **Files:** `src/styles/identity.css:59`, `design/README.md:22`.
- **Problem:** the comment reads "21 + 40 + 11 = 72". The CSS offset is 18px, and 21px is a measured edge, so the sum mixes two bases.
- **Fix:** rewrite it as "18px offset + 40px button = 58px; 72px leaves a 14px gap". Say the same in the README line.
- **Test:** documentation only; no spec.

---

## kit-styles

### M24. `--av-control-margin` inherits into nested kit buttons
- **Source:** 3b T5 re-review round 2 and ledger MINOR; final core "Can wait".
- **Files:** `src/styles/identity.css:121-123`. Users are `AppNavigation.vue:107`, `EmptyListing.vue:84`, `SignerRow.vue:257` and `PlacementSheet.vue:172`, all set on the button today.
- **Fix:** register `@property --av-control-margin { syntax: '*'; inherits: false; }` in identity.css. A container that sets it then cannot space every nested button.
- **Test:** `src/styles/identity.spec.ts`, `it('registers --av-control-margin as a property that does not inherit')`.

### M25. Titled-banner info and danger dividers have no artboard source
- **Source:** 3b T5 re-review and ledger MINOR; final core "Leave for Task 19" (never decided).
- **Files:** `src/ui/AvBanner.vue:115-136` (`--av-banner-divider` for info, neutral and danger).
- **Fix:** **Decided (Patrick, 2026-10-02): warning tone only.** The titled shape draws its divider only for `tone="warning"`, which the artboards show. Delete the derived info, neutral and danger divider colours.
- **Test:** `src/ui/AvBanner.spec.ts`, `it('draws the titled divider only for the warning tone')`.
### M26. Screens hand-roll kit variants (avatar ring, tone-outline banner action)
- **Source:** 3b T5 review ("The task that first needs each one should add it, not hand-roll it") and ledger MINOR.
- **Files:**
  - `src/files/SidebarEnvelopeCard.vue:222-226` (32px avatar with a 2px panel ring and a 12px font);
  - `src/detail/BounceBanner.vue:33-40` (outline button in the banner's colour).
- **Fix:**
  - Add `ring?: boolean` to `AvAvatar`: a 2px `var(--av-panel)` border, content-box.
  - Add an `AvButton` variant `tone-outline`: transparent fill, `currentColor` border and text, 40px.
  - Use both, and delete the scoped overrides.
- **Test:**
  - `src/ui/AvAvatar.spec.ts`, `it('rings a stacked avatar in the panel colour')`;
  - `src/ui/AvButton.spec.ts`, `it('paints a tone-outline button in the colour of its container')`.

### M27. Tone unions are spelled out in several places
- **Source:** final core minor.
- **Files:** `src/ui/AvBanner.vue:6`, `src/ui/AvProgress.vue:8`, `src/ui/AvStatusPill.vue:6`, `src/presentation/envelope-status.ts:9,25`, `src/presentation/timeline.ts:9`.
- **Fix:** export `PillTone = Tone | 'brand'`, `BannerTone` and `ProgressTone` from `src/ui/tones.ts`, and import them everywhere.
- **Test:** type-level refactor; `npm run typecheck`. No behavioural spec.

### M28. Kit API mismatches
- **Source:** final core minor; 3b T9 ledger MINOR ("AvTextarea required no kit spec").
- **Files:**
  - `src/ui/AvTextField.vue:10` (`type?: string`);
  - `src/ui/AvTextarea.vue:15,43-44` (`required` only here; `aria-required` repeats native `required`);
  - `src/ui/AvSelect.vue:8-16` (no `error` or `hint`);
  - `src/ui/AvSkeleton.vue:3-4` and `src/ui/AvProgress.vue:9` (free CSS strings, unlike `AvAvatar`'s typed sizes).
- **Fix:**
  - Type `type` as `'text' | 'email' | 'date' | 'search'`.
  - Drop the redundant `aria-required`, and give AvTextField and AvSelect the same `required` prop.
  - Give `AvSelect` `error` and `hint` through `AvField`.
  - Type skeleton and progress sizes as numbers in px.
- **Test:**
  - `src/ui/AvTextarea.spec.ts`, `it('marks a required textarea as required')`;
  - `src/ui/AvSelect.spec.ts`, `it('describes its error and hint to assistive technology')`.

### M29. Raw colour and font-size literals
- **Source:** final core minor; 3b T11 review (12px).
- **Files:**
  - `src/ui/AvDialog.vue:168` (`rgba(29, 39, 48, 0.4)`);
  - `src/ui/AvAvatar.vue:57` (`13px` instead of `var(--av-text-meta)`);
  - 23 `font-size: 14px` in `src/` without a token;
  - `src/files/SidebarEnvelopeCard.vue:225` (12px).
- **Fix:** add `--av-backdrop` and `--av-text-small: 14px` (plus a 12px token if kept) to the identity tokens, and replace the literals.
- **Test:** `src/styles/identity.spec.ts`, `it('keeps every font size of the components on a --av-text token')`. This is a source scan over `src/**/*.vue`, in the style of the existing guards.

### M30. No specs for `AvCard`, `AvSkeleton` and `AvStatusPill`
- **Source:** final core minor.
- **Files:** `src/ui/AvCard.vue`, `src/ui/AvSkeleton.vue`, `src/ui/AvStatusPill.vue`.
- **Fix:** add behaviour specs.
- **Test:**
  - `src/ui/AvCard.spec.ts`, `it('renders as the element it is given')`;
  - `src/ui/AvSkeleton.spec.ts`, `it('hides itself from assistive technology')`;
  - `src/ui/AvStatusPill.spec.ts`, `it('shows its label in its tone')`.

### M31. Style specs parse source text with regexes
- **Source:**
  - 3b T5 re-review (identity.spec checks text, not cascade);
  - T11 re-review (`sidebar-tab-styles.spec`);
  - T18 re-review (`wizard-bottom-bar-styles.spec`, `AvTextField.spec`);
  - final re-review (`narrow-desktop-styles.spec`, `envelope-cards-styles.spec`).
- **Files:**
  - `src/styles/identity.spec.ts`;
  - `src/files/sidebar-tab-styles.spec.ts` (also no blank line after the imports, line 2-3);
  - `src/wizard/wizard-bottom-bar-styles.spec.ts`;
  - `src/ui/AvTextField.spec.ts:43-48`;
  - `src/layout/narrow-desktop-styles.spec.ts`;
  - `src/dashboard/envelope-cards-styles.spec.ts`.
- **Fix:**
  - Add one `src/test-support/css-rules.ts` that parses a `<style>` block with `postcss` (already in the Vite toolchain) and looks rules up by selector and property.
  - Rewrite these specs on it, so reordering or reformatting doesn't break them.
  - Keep the names as "guards …" claims.
- **Test:** this is a test-hygiene fix; the rewritten specs are the fix. They still fail if the guarded declaration is removed.

### M32. Phone-breakpoint constant exported without a consumer
- **Source:** 3b T6 ledger MINOR and re-review round 2.
- **Files:** `src/layout/viewport.ts:6`. `PHONE_MAX_WIDTH_PX` is used only inside the file; `PHONE_MEDIA_QUERY` is used by specs.
- **Fix:** stop exporting `PHONE_MAX_WIDTH_PX`. Keep the name as the documented source of truth for the hand-synced 1023px CSS literal.
- **Test:** typecheck only.

### M33. Native search clear "×" shows where the artboard has none
- **Source:** 3b T8 ledger MINOR and browser check.
- **Files:** `src/dashboard/DashboardView.vue:219` (`type="search"`), kit `src/ui/AvTextField.vue`.
- **Fix:** in identity.css hide `::-webkit-search-cancel-button` and `::-webkit-search-decoration` on `.av-input[type=search]`; the empty-state "Limpar busca" stays. The alternative is a Known-differences line, if Patrick prefers the native ×.
- **Test:** `src/styles/identity.spec.ts`, `it('guards against the browser clear button on a kit search field')`.

---

## dashboard-detail

### M34. Status changes from polling aren't announced; the failed banner isn't an alert
- **Source:** final screens minor.
- **Files:** `src/ui/AvBanner.vue:15` (`role="status"` mounted already filled), `src/detail/EnvelopeBanners.vue:145,182` (failed and danger banners), `src/detail/DetailView.vue`.
- **Fix:**
  - Mount one persistent, empty `role="status"` region in DetailView, and write the envelope's status label into it when `envelope.status` changes after the first load.
  - Give the failed-send banner `role="alert"`.
- **Test:** `src/detail/DetailView.spec.ts`, `it('announces the new status when polling finds the send failed')`.

### M35. "Tentar novamente" and "Voltar para rascunho" succeed silently
- **Source:** final screens minor.
- **Files:** `src/detail/EnvelopeBanners.vue:52-68` (`retry`, `reopen` `onSuccess`).
- **Fix:** toast after success, after any dialog closed: "Envio retomado" and "Envelope voltou para rascunho" (new l10n keys). This matches every other mutation.
- **Test:** `src/detail/DetailView.spec.ts`:
  - `it('confirms with a toast once the send is tried again')`;
  - `it('confirms with a toast once the envelope is back to draft')`.

### M36. The `deadline_invalid` retry branch isn't logged
- **Source:** 3b T18 re-review and ledger MINOR.
- **Files:** `src/detail/EnvelopeBanners.vue:55-60`.
- **Fix:** call `logger.warn('Could not send the envelope again: its deadline passed', { error, uuid })` before setting `hasRetryMetPassedDeadline`.
- **Test:** `src/detail/DetailView.spec.ts`, `it('logs a retry refused because the deadline passed')`.

### M37. Open dialogs unmount when a refetch changes the actions
- **Source:** final screens minor.
- **Files:** `src/detail/DetailView.vue:129-143` (`v-if="actions.includes(…)"`), `src/detail/SignersCard.vue:205-211` (`v-if="hasCorrectableSigner"`).
- **Fix:** keep a dialog mounted while it is open: `v-if="actions.includes('cancel') || openDialog === 'cancel'"`, and the same for the others and for `correctingSigner !== null`.
- **Test:** `src/detail/DetailView.spec.ts`, `it('keeps the cancel dialog and its text when a refetch removes the cancel action')`.

### M38. Focus falls to `<body>` after deleting a draft from the table
- **Source:** final screens minor.
- **Files:** `src/dashboard/DashboardView.vue:89-96` (`deletion.onSuccess`).
- **Fix:** after the row disappears, focus the page heading (`titleId`, `tabindex="-1"`) or the next row's menu trigger.
- **Test:** `src/dashboard/DashboardView.spec.ts`, `it('moves the focus to the page heading once the draft is deleted')`.

### M39. The desktop aside repeats the "Progresso" heading as its name
- **Source:** final screens minor.
- **Files:** `src/detail/DetailView.vue:123`, `src/detail/ProgressCard.vue` (h2).
- **Fix:** `aria-labelledby` pointing at the ProgressCard heading id (exposed via prop or `useId` passed down), or drop the `aria-label`.
- **Test:** `src/detail/DetailView.spec.ts`, `it('names the progress area after its heading')`.

### M40. The phone empty dashboard shows two "Novo envelope" buttons
- **Source:** final screens minor.
- **Files:** `src/dashboard/EmptyListing.vue:35-44`, `src/dashboard/DashboardView.vue:271-281` (floating pill).
- **Fix:** hide the floating pill while the empty state's own "Novo envelope" is shown (`reason === 'none'`).
- **Test:** `src/dashboard/DashboardView.spec.ts`, `it('offers one "Novo envelope" on an empty phone dashboard')`.

### M41. An empty filter offers no way back to all envelopes
- **Source:** final screens minor.
- **Files:** `src/dashboard/EmptyListing.vue:45-51` (only `search` has an action), `src/dashboard/empty-reason.ts`.
- **Fix:** for the filter reason, add a secondary "Mostrar todos" button that emits `clearFilter`. DashboardView then calls `onFilter('all')`.
- **Test:** `src/dashboard/DashboardView.spec.ts`, `it('lists every envelope again from an empty filter')`.

### M42. "Ver histórico" adds a browser history entry
- **Source:** final screens minor.
- **Files:** `src/detail/ProgressCard.vue:26` (`href="#…"`).
- **Fix:** make it a button that scrolls the timeline into view and focuses its heading (`tabindex="-1"`) without changing the URL.
- **Test:** `src/detail/DetailView.spec.ts`, `it('moves to the history without adding a browser history entry')`.

### M43. Shared helpers live in the dashboard folder; `currentUid` is computed twice
- **Source:** final screens minor.
- **Files:**
  - `src/dashboard/envelope-row.ts`, imported by `src/detail/ProgressCard.vue:8`, `src/detail/DetailHeader.vue:14` and `src/files/SidebarEnvelopeCard.vue:17`;
  - `src/envelope/EnvelopeView.vue:42` and `src/detail/DetailView.vue:63`.
- **Fix:** move `envelope-row.ts` to `src/presentation/` (name it for what it holds, e.g. `signing-progress.ts`). Add `src/current-user.ts` exporting `currentUid()`.
- **Test:** refactor; the existing presentation and detail specs move with it.

### M44. Six dialogs repeat the same mutation boilerplate
- **Source:** final screens minor ("useDialogMutation would make fixes 2 and 3 a single change").
- **Files:**
  - `src/detail/CancelDialog.vue`, `DeadlineDialog.vue`, `CorrectEmailDialog.vue` and `DeleteDialog.vue`;
  - `src/detail/EnvelopeBanners.vue` (discard);
  - `src/dashboard/DashboardView.vue:87-104` (delete draft).
- **Fix:** add `src/detail/use-dialog-mutation.ts`. It resets the error on open, refuses close while pending, and on success closes, waits `nextTick`, toasts and updates the cache. On error it logs, sets the inline error and refreshes after an `ApiError`. The six call sites use it.
- **Test:** `src/detail/use-dialog-mutation.spec.ts`:
  - `it('closes the dialog before the success toast')`;
  - `it('reads the envelope again after a refusal')`.

### M45. Cancel counter counts trimmed text while `maxlength` caps the raw text
- **Source:** final screens "Should"; 3b T9 ledger MINOR.
- **Files:** `src/detail/CancelDialog.vue:50-51,83`.
- **Fix:** show `reason.length` against `REASON_MAX_LENGTH` (what `maxlength` caps), and keep sending the trimmed text.
- **Test:** `src/detail/DetailView.spec.ts`, `it('counts every character the reason field holds against the 500 allowed')`.

### M46. A failed detail or dashboard load also logs a secondary `TypeError`
- **Source:** 3b T9 review and ledger MINOR ("cross-view fix later"); final screens "Defer".
- **Files:**
  - `src/envelope/EnvelopeView.vue:39,53`;
  - `src/dashboard/DashboardView.vue:85,201`;
  - `src/detail/DetailView.spec.ts:838-843`, which checks only `errorsReachingTheFrame[0]`.
- **Fix:** after `await query.suspense()`, render nothing when `data` is still undefined (`v-if` on the root, or return early from setup by throwing the query error). Only the `ApiError` then reaches the frame.
- **Test:** `src/detail/DetailView.spec.ts`, `it('hands exactly one failure to the frame')` (`toEqual([apiError])`), plus the same in `DashboardView.spec.ts`.

### M47. Specs select by implementation classes
- **Source:** 3b T9 review and ledger MINOR; final screens "Defer".
- **Files:** `src/detail/DetailView.spec.ts` has about 24 `find('.…')` calls (`.documents-card__row`, `.detail-header__meta`, `.av-banner--danger`, …); also `SignersCard.spec.ts` and `DashboardView.spec.ts`.
- **Fix:** query by role and accessible name (`listitem` in the "Documentos" list, `role="alert"`, headings).
- **Test:** this is a test-hygiene fix; the rewritten specs are the fix.

### M48. The sign-link blob relies on a long comment beside a bare `.catch`
- **Source:** 3b T10 re-review round 2 and ledger MINOR.
- **Files:** `src/detail/sign-link-clipboard.ts:33-34`.
- **Fix:** add a named helper `markHandled(promise)` (in `src/promises.ts`) and call it in place of the comment and the `.catch`.
- **Test:** `src/detail/sign-link-clipboard.spec.ts`, `it('leaves no unhandled rejection when the clipboard refuses before the link fails')` (keep or add).

### M49. Unreachable `group === null` branch in the signer state
- **Source:** 3b T7 ledger MINOR.
- **Files:** `src/presentation/signer-state.ts:62-67` (`groupBefore` can't be null for a signer waiting for their turn).
- **Fix:** type `groupBefore` for a waiting signer as `number` (derive it from `currentSigningGroup`), and drop the `null` detail branch.
- **Test:** `src/presentation/signer-state.spec.ts`, `it('names the group before a waiting signer')` (existing). Coverage shows no dead branch.

### M50. "Meus envelopes" stays current on a colleague's envelope opened from "Toda a empresa"
- **Source:** final core minor.
- **Files:** `src/layout/AppNavigation.vue:26-27` (`isMyEnvelopes` true for every envelope route); `src/layout/AppFrame.spec.ts:223-227` pins the current behaviour.
- **Fix:** an envelope route marks "Meus envelopes" current only when `envelope.ownerUid === currentUid`, else "Toda a empresa" for admins. Read the owner from the cached envelope query.
- **Test:** `src/layout/AppFrame.spec.ts`, `it('marks "Toda a empresa" current on a colleague\'s envelope')`.

### M51. The navigation badge is read as a bare number
- **Source:** final core minor.
- **Files:** `src/layout/NavigationLink.vue:35`.
- **Fix:** make the badge `aria-hidden`, and append a visually hidden "{n} envelopes" (plural l10n) to the link name.
- **Test:** `src/layout/AppFrame.spec.ts`, `it('reads the badge as the number of envelopes')`.

### M52. The `!canUseApp` half of `landmarkFor` is untested
- **Source:** 3b T6 re-review round 2 and ledger MINOR.
- **Files:** `src/layout/AppFrame.vue:52-60`.
- **Fix:** test only, or drop the half if the spec shows it changes nothing.
- **Test:** `src/layout/AppFrame.spec.ts`, `it('leaves the drawer closed when a user without access follows "Skip to navigation" on a phone')`.

### M53. The drawer-focus spec checks only text
- **Source:** 3b T6 re-review round 2.
- **Files:** `src/layout/AppFrame.spec.ts:414-421`.
- **Fix:** assert that `document.activeElement` is the "Novo envelope" `<button>` element (role and name), not just its text.
- **Test:** this is a test-hygiene fix; the tightened spec is the fix.

---

## files-sidebar-admin

### M54. A failed load of the Files action's create flow is neither caught nor translated
- **Source:** 3a T5 ledger MINOR (the 3a final deferred it as "Files already toasts").
- **Files:** `src/files/send-for-signature-action.ts:18-21`.
- **Fix:** wrap the dynamic `import()` in `try/catch`. Log with `logger.error` and `showError(t(APP_ID, 'Could not create the envelope'))`, so the user sees our pt_BR text instead of Files' generic "failed".
- **Test:** `src/files/send-for-signature-action.spec.ts`, `it('logs and explains a create flow that cannot load')`.

### M55. A failed background refresh replaces the sidebar list, and isn't logged
- **Source:** final screens minor.
- **Files:** `src/files/FilesSidebarTab.vue:39-43,54-61`.
- **Fix:**
  - Show the error banner only while `envelopes === undefined`. With data, keep the cards and show a small inline "Não foi possível atualizar" with retry.
  - Log failures (`watch(envelopesQuery.error)` → `logger.warn`).
- **Test:** `src/files/FilesSidebarTab.spec.ts`:
  - `it('keeps the listed envelopes when a later refresh fails')`;
  - `it('logs a listing that fails')`.

### M56. A node without a file id shows "Carregando…" forever
- **Source:** 3b T11 review; final screens minor.
- **Files:** `src/files/FilesSidebarTab.vue:39-43,62-67`.
- **Fix:** when `node.fileid === undefined`, render the "This file has not been sent for signature yet." state instead of the skeleton.
- **Test:** `src/files/FilesSidebarTab.spec.ts`, `it('explains a node without a file id instead of loading forever')`. Extend the spec at line 122.

### M57. The Files sidebar doesn't poll a sending or finalizing envelope
- **Source:** final screens minor.
- **Files:** `src/files/FilesSidebarTab.vue:39-43`; `src/presentation/envelope-polling.ts`.
- **Fix:** add `refetchInterval` returning `POLL_INTERVAL_MILLISECONDS` while any listed envelope `isProcessedInBackground(status)`, as DashboardView does.
- **Test:** `src/files/FilesSidebarTab.spec.ts`, `it('lists again while an envelope of the file is being sent')`.

### M58. Each sidebar card fetches the full envelope only for avatars
- **Source:** 3b T11 ledger MINOR (long term: initials and colours on the summary); final screens "Defer".
- **Files:** `src/files/SidebarEnvelopeCard.vue:52-65`; `lib/Api/EnvelopeView.php` (summary); `src/api/types.ts` (`EnvelopeSummary`); `docs/api.md`.
- **Fix:** add `signers: [{ name, color }]` to the summary (one query per page, after M8). The card reads it and drops its `getEnvelope` query.
- **Test:**
  - `tests/Integration/Controller/EnvelopeControllerTest.php::testListsEachEnvelopesSignerNamesAndColours`;
  - `src/files/FilesSidebarTab.spec.ts`, `it('shows the signers without reading each envelope')`.

### M59. The `is-svg` shim is untested against the real `registerSidebarTab`, and its scope isn't documented
- **Source:** 3b T11 re-review and ledger MINOR; final core minor (alias also replaces it for `@nextcloud/sharing`).
- **Files:** `src/shims/is-svg.ts:4`; `vite.config.ts:15`; `src/files/sidebar-tab.spec.ts:9-12` (mocks `registerSidebarTab`).
- **Fix:**
  - Add one spec that calls the real `registerSidebarTab` (through the alias) with `SIGNATURE_SVG`.
  - Extend the shim's doc: deliberately lenient, checks only our static icon, and also aliased for `@nextcloud/sharing`.
- **Test:** `src/files/sidebar-tab-registration.spec.ts`, `it('registers the tab with the real Files check and the Assinaturas icon')`.

### M60. Admin "Check now" and reset specs don't count fetches
- **Source:** 3a T6 review and ledger MINOR.
- **Files:** `src/admin/AdminSettings.spec.ts:166-177,191-204`.
- **Fix:** add `expect(getAdminStatus).toHaveBeenCalledTimes(2)` (initial load plus check or refetch) to both.
- **Test:** this is a test-hygiene fix; the tightened specs are the fix.

### M61. Redundant `health` narrowing and about 15 repeated `status.data.value.`
- **Source:** 3a T6 review and ledger MINOR.
- **Files:** `src/admin/AdminSettings.vue:47,62-136`.
- **Fix:** one computed `view` (status plus described health), rendered under `v-else-if="view !== undefined"`, reading `view.usage.sent` and similar.
- **Test:** refactor; the existing `AdminSettings.spec.ts` stays green.

### M62. The usage month isn't shown
- **Source:** 3a T6 review and ledger MINOR.
- **Files:** `src/admin/AdminSettings.vue:120-122` ("Usage this month"); the API already sends `usage.monthStart` (`docs/api.md:205`).
- **Fix:** add the month to the heading or description, e.g. "Uso em outubro de 2026", from `usage.monthStart` in the user's locale.
- **Test:** `src/admin/AdminSettings.spec.ts`, `it('names the month the usage counts')`.

### M63. "Reset counters" is disabled without saying why
- **Source:** 3a T6 review and ledger MINOR.
- **Files:** `src/admin/AdminSettings.vue:165`.
- **Fix:** hide the button when there are no counters. The "No counters" text already explains the state.
- **Test:** `src/admin/AdminSettings.spec.ts`, `it('offers no reset when there are no counters')`.

### M64. The first admin section repeats the sidebar's "Assinaturas" name
- **Source:** 3a T6 review.
- **Files:** `src/admin/AdminSettings.vue:63-64`; the sidebar entry comes from `lib/Settings/AdminSection.php:29`.
- **Fix:** rename the inner `NcSettingsSection` to "Conexão com a ZapSign" (new l10n key).
- **Test:** `src/admin/AdminSettings.spec.ts`, `it('heads the connection section "Conexão com a ZapSign"')`.

---

## wizard-state

### M65. The reorder spec cannot catch a one-microtask lag
- **Source:** 3b T13 re-review and ledger MINOR.
- **Files:** `src/wizard/DocumentsStep.spec.ts:182`.
- **Fix:** dispatch the keyboard move with `element.dispatchEvent` (no `await trigger`), and assert the order synchronously before any `nextTick` or timer flush.
- **Test:** this is a test-hygiene fix. Prove it RED by reintroducing the mutation-derived order.


### M66. "Tentar novamente" mixes `.then` into async code and a throwing retry goes unlogged
- **Source:** wizard fix round 3 re-review and ledger MINOR.
- **Files:** `src/wizard/WizardView.vue:213-227` (`retrySave().then(() => false)`, no `catch`).
- **Fix:** add an `async` helper `retryNeverMoves = async () => { await retrySave(); return false }`. Wrap the call in `try/catch` with `logger.error('Could not save the draft again', { error })`, as `changeStep` does.
- **Test:** `src/wizard/WizardView.spec.ts`, `it('logs a retry that throws and enables Continuar again')`.

### M67. A queued router move shares the first move's answer
- **Source:** 3b T13 ledger MINOR and re-review round 2.
- **Files:** `src/wizard/WizardView.vue:197-207` (`flushForRouter` returns `pendingFlush.mayMove` whatever the reason).
- **Problem:** a "leave" queued behind a failed "back" is refused, though leaving normally goes ahead on failure.
- **Fix:** when the pending flush is a router move with a different reason, await it, then run `flushForRouter(reason)` for the new reason. The same reason keeps sharing.
- **Test:** `src/wizard/WizardView.spec.ts`, `it('lets a leave through after a queued back failed to save')`.

### M68. Four move flags could be one state
- **Source:** final wizard minor ("Possible simplification").
- **Files:** `src/wizard/WizardView.vue:44-51` (`isNavigating`, `isSending`, `isChangingStep`, `pendingFlush`).
- **Fix:** one `move` ref, e.g. `{ kind: 'idle' } | { kind: 'step' | 'router' | 'retry' | 'send', mayMove }`, from which the guards and the bottom-bar `disabled` derive.
- **Test:** refactor; the existing WizardView, ReviewStep and SignersStep specs on guards and retries stay green.

### M69. On the send path the passed-deadline focus lands on a disabled field
- **Source:** 3b T18 re-review and ledger MINOR.
- **Files:** `src/wizard/WizardView.vue:123-135` (`isSending = true` before the flush); `src/wizard/ReviewStep.vue:183-196,323` (`focusDeadline` inside `<fieldset :disabled="isSending">`).
- **Fix:** set `isSending` only after `flushFor('continue')` resolves true, or have `send()` call `focusDeadline` after `isSending` resets.
- **Test:** `src/wizard/ReviewStep.spec.ts`, `it('focuses the deadline when it passed just before Send was pressed')`. Advance `useNow` past midnight between render and click.

### M70. Save-state selection rebuilds closures and adds a second envelope observer
- **Source:** final re-review minors 3 and 6.
- **Files:** `src/wizard/draft-save-state.ts:185-213` (`select` returns an `isOrphaned` closure; `useQuery(envelopeQueryOptions(uuid))` at 188).
- **Fix:**
  - `select` returns `{ subject, status, documentId: fieldsDocumentId(mutation) }`, and the computed compares the ids.
  - `useDraftSaveState` takes `documentIds: Ref<readonly number[] | null>` from WizardView instead of observing the envelope again.
- **Test:** refactor; `src/placement/PlacementStep.spec.ts` "forgets the failed boxes of a document removed from the draft" and the WizardView save-state specs stay green.

### M71. A signers failure clears only on flush, not when rows are typed back
- **Source:** 3b T13 ledger MINOR.
- **Files:** `src/wizard/SignersStep.vue:236-243` (the `forgetFailures` call lives only in `saveRows`).
- **Fix:** `watch(drafts, …, { deep: true })`. When `!signersChanged(drafts, latestEnvelope().signers)`, call `forgetFailures(queryClient, uuid, 'signers')`, like W1 did for the title.
- **Test:** `src/wizard/SignersStep.spec.ts`, `it('reads as saved once the rows are typed back to the saved ones')`.

### M72. A replayed new signer keeps a positional colour until the step reopens
- **Source:** 3b T13 ledger MINOR and re-review round 2.
- **Files:** `src/wizard/SignersStep.vue:130-136` (`savedColors` keyed by draft key; new rows keep `new-N`).
- **Fix:** for a `new-…` key, fall back to the saved signer with the same email (case-insensitive) before using the position.
- **Test:** `src/wizard/SignersStep.spec.ts`, `it('gives a replayed new signer the colour the server chose')`.

### M73. The document grip gives keyboard users no instructions
- **Source:** 3b T12 review ("once Patrick provides copy").
- **Files:** `src/wizard/DocumentsStep.vue:329-338`.
- **Fix:** **Copy approved (Patrick, 2026-10-02):** a visually hidden hint "Use as setas para cima e para baixo para mudar a ordem" (one element, a stable id), referenced by `aria-describedby` on every grip.
- **Test:** `src/wizard/DocumentsStep.spec.ts`, `it('tells keyboard users how to move a document')`.
### M74. A document never opened in the placement step goes out without boxes, unflagged
- **Source:** final wizard minor (product question).
- **Files:** `src/wizard/review-summary.ts`, `src/wizard/ReviewStep.vue` (Campos card shows totals only).
- **Fix:** **Decided (Patrick, 2026-10-02): auto-place on leaving step 3.** On any forward move into step 4 (Continuar, or the stepper), find the documents that have no saved fields and were never auto-placed. For each one, load its page geometry through the existing pdf loader (sizes only, no render). Run the same `autoPlace` the editor runs on first open, with the current signers and that document's initials toggle. Save the result through the same fields-save mutation, so flush, retry and failure states apply unchanged. While this runs, the bottom bar shows "Posicionando assinaturas…". A failure keeps the user on step 3 with that document's failed-save state, the same as a failed edit. Review then counts every document's boxes. Keep it pure where possible: put the choice of documents in a helper next to `review-summary.ts` / `placement-draft.ts`.
- **Test:** `src/wizard/WizardView.spec.ts` (or the step-move spec that owns `flush`), `it('auto-places documents never opened before entering the review')` and `it('stays on placement when auto-placing an unopened document fails')`. Also a unit spec for the selection helper, `it('selects documents with no fields that were never placed')`.
### M75. Leaving is refused for as long as a hung retry runs
- **Source:** wizard round 3 re-review ("behaviour note"), ledger MINOR "leave refused during a hung retry".
- **Files:** `src/wizard/WizardView.vue:213-227,261`.
- **Fix:** give retry and flush requests a bound: an axios `timeout` for draft-save calls in `src/api/envelopes.ts`, e.g. 30 s, named. A hung PUT then fails, releases `pendingFlush`, and leaving works.
- **Test:** `src/wizard/WizardView.spec.ts`, `it('lets the owner leave once a hung retry gives up')`. Use fake timers and a never-resolving mock that rejects on abort.

---

## pdf-placement

### M76. A cancelled in-flight open leaks its PDF and worker
- **Source:** 3b T14 re-review and ledger MINOR; final wizard "Can wait".
- **Files:** `src/pdf/pdf-document.ts:33-44,63` (`queryFn` ignores `signal`).
- **Fix:** pass `signal` into `openPdf`. On `abort`, call `loadingTask.destroy()`, and destroy an already-opened PDF that the cache will discard.
- **Test:** `src/pdf/pdf-document.spec.ts`, `it('closes a PDF whose opening was cancelled')`.

### M77. Replacing a PDF logs one transient destroyed-worker render error
- **Source:** 3b T14 re-review and ledger MINOR.
- **Files:** `src/pdf/PdfPageCanvas.vue:138-152` (`draw` logs unless superseded; the cache destroys the old PDF before Vue re-renders).
- **Fix:** treat a render failure whose `props.pdf` changed since the draw started as superseded; capture the pdf at the start and compare it in the `catch`.
- **Test:** `src/pdf/PdfPageCanvas.spec.ts`, `it('stays quiet when the PDF it was drawing is replaced')`.

### M78. A failed pdf.js chunk load can't recover
- **Source:** 3b T14 ledger MINOR; final wizard "Can wait" (a reload can recover).
- **Files:** `src/pdf/pdf-loader.ts:22-25`; the placement load-error state in `src/placement/PlacementStep.vue`.
- **Fix:** when `loadPdfjs` rejects with a chunk-load error, show the `StepLoadError` with `offersReload` ("Recarregar página") instead of a retry that re-reads the browser's cached failure.
- **Test:** `src/placement/PlacementStep.spec.ts`, `it('offers to reload the page when pdf.js cannot load')`.

### M79. Each opened document runs its own pdf.js worker
- **Source:** 3b T14 review (optional); final wizard minor ("worth a memory check on phones").
- **Files:** `src/pdf/pdf-document.ts:35` (`pdfjs.getDocument({ data, … })`), `src/pdf/pdfjs-runtime.ts`.
- **Fix:** create one shared `pdfjs.PDFWorker` lazily in `pdfjs-runtime.ts`, and pass it as `worker` to every `getDocument`. It is destroyed only with the page.
- **Test:** `src/pdf/pdf-document.spec.ts`, `it('opens every document with one worker')`.

### M80. The drawable-page type relies on method-parameter bivariance
- **Source:** 3b T14 review.
- **Files:** `src/pdf/drawable-pdf.ts:13-20`.
- **Fix:** make the viewport opaque. `DrawablePage<Viewport extends PageSize>` returns a `Viewport` from `getViewport`, and `render` takes the same `Viewport`, so pdf.js's types are checked strictly.
- **Test:** type-level; `npm run typecheck`. The spec `accepts a pdf.js PDFDocumentProxy` stays.

### M81. Preload margin has no hysteresis
- **Source:** 3b T17 round 2 re-review and ledger MINOR.
- **Files:** `src/pdf/PdfPageCanvas.vue:155-163` (`followVisibility`), `:3` (`PRELOAD_MARGIN`).
- **Fix:** draw at the 50% margin and release only beyond a wider one. Use a second observer with e.g. `'100% 0px'` for release, so a page at the edge doesn't release and redraw repeatedly.
- **Test:** `src/pdf/PdfPageCanvas.spec.ts`, `it('keeps the drawing of a page that moves back and forth across the preload edge')`.

### M82. The overlap warning covers only initials over a signature
- **Source:** 3b T16 ledger MINOR.
- **Files:** `src/placement/geometry.ts:144-160` (`hasInitialsOverSignature`), `src/placement/PlacementCanvas.vue:95,263-266`.
- **Fix:** `hasOverlappingBoxes(boxes)` checks any two boxes on the same page, including a signature's stamp footprint. The notice uses it.
- **Test:** `src/placement/PlacementCanvas.spec.ts`, `it('warns when two signatures overlap')`.

### M83. Moving a box without area skips the page clamp
- **Source:** 3b T15 re-review and ledger MINOR.
- **Files:** `src/placement/geometry.ts:71-87` (`clampBox` returns a zero-area box unchanged; `moveBox` relies on it).
- **Fix:** with no area, still clamp `x` and `y` into the page and keep the size.
- **Test:** `src/placement/geometry.spec.ts`, `it('keeps a box without area on its page when moved')`. It replaces "returns a box without area unchanged".

### M84. Auto-placement spec gaps
- **Source:** 3b T15 re-review and ledger MINOR.
- **Files:**
  - `src/placement/auto-placement.spec.ts:78-85` (passes vacuously on no boxes) and `:91` (`boxes[0]!`);
  - `src/placement/auto-placement.ts:56-58` (`RangeError` untested).
- **Fix:**
  - Assert `boxes` is not empty in the narrow-page spec.
  - Replace `boxes[0]!` with a defined guard.
  - Pin the guard.
- **Test:** this is test hygiene, plus `src/placement/auto-placement.spec.ts`, `it('refuses a placement slot without a signer')`.

### M85. Per-scale label spec asserts nothing at some scales; the sheet gap is duplicated
- **Source:** 3b T16 re-review (weak per-scale test); 3b T17 round 2 re-review and ledger MINOR (`-12px` gap).
- **Files:** `src/placement/PlacementCanvas.spec.ts:188-194`; `src/placement/PlacementSheet.vue:104,121-123`.
- **Fix:**
  - Assert the spec reads at least one label at every scale ≥ 0.75.
  - Hold the sheet gap in one custom property (`--placement-sheet-gap: 12px`), used by `gap` and the `:empty` negative margin.
- **Test:** this is a test-hygiene fix for the label spec, plus `src/placement/PlacementStepPhone.spec.ts`, `it('keeps the sheet gap and the empty status offset equal')` (style source guard per M31).

---

## api-client

### M86. Cancels and non-HTTP errors all become "No connection"
- **Source:** 3a T3 review and ledger MINOR (`CanceledError` → `network_error`); final core minor (every non-axios throw).
- **Files:** `src/api/api-error.ts:34-40`.
- **Fix:**
  - `isCancel(error)` gives `ApiError('cancelled', 0, …)`, skipped by toasts.
  - An axios error with a request but no response stays `network_error`.
  - Anything else becomes `unknown`, generic text, and is logged.
- **Test:** `src/api/api-error.spec.ts`:
  - `it('keeps a cancelled request apart from a lost connection')`;
  - `it('reports a programming error as unknown, not as a lost connection')`.

### M87. An expired session (401/412) gets "Something went wrong"
- **Source:** final core minor.
- **Files:** `src/api/error-messages.ts:12-13` (no `http_401` or `http_412`).
- **Fix:** add `http_401` and `http_412` with the text "Sua sessão expirou. Recarregue a página." (one new l10n key).
- **Test:** `src/api/error-messages.spec.ts`, `it('asks to reload the page when the session expired')`.

### M88. Error bodies of the source download arrive as an ArrayBuffer and lose their code
- **Source:** final core minor; 3b T3 review (no error-path spec).
- **Files:** `src/api/envelopes.ts:57-59` (`responseType: 'arraybuffer'`); `src/api/api-error.ts:42-46`; `src/api/envelopes.spec.ts:131-137`.
- **Fix:** in `toApiError`, when `data` is an `ArrayBuffer`, decode it with `TextDecoder` and `JSON.parse` in a try, then read the body as usual.
- **Test:** `src/api/envelopes.spec.ts`, `it('reports the server\'s code when the source is refused')` (409 `not_a_draft`).

### M89. The admin client's failure spec is vague and covers only a lost connection
- **Source:** 3a T3 review.
- **Files:** `src/api/admin.spec.ts:48-54` (`describe('failures')`).
- **Fix:** rename it to `describe('when the server refuses')`, and add a coded-error case.
- **Test:** `src/api/admin.spec.ts`, `it('rejects with the server\'s code when the reset is refused')`.

### M90. No spec for the query keys
- **Source:** 3a T3 review and ledger MINOR (3a final kept it deferred).
- **Files:** `src/api/query-keys.ts`.
- **Fix:** add a behaviour spec of the prefix contract the bottom bar relies on.
- **Test:** `src/api/query-keys.spec.ts`, `it('files every draft change and every document\'s boxes under the envelope\'s draft-save key')`.

### M91. The page configuration from `loadState` is trusted without a check
- **Source:** 3a T1 review and ledger MINOR (the PHP key-set test landed; the runtime guard was deferred).
- **Files:** `src/app-config.ts:35-37`.
- **Fix:** add an `isAppConfig(value)` guard: environment union, booleans, and all 9 numeric `limits`. On failure, log and return `LOCKED_DOWN`.
- **Test:** `src/app-config.spec.ts`, `it('falls back to the locked-down configuration when a limit is missing')`.

---

## Not open

### FIXED (191 entries)

#### Plan 3a ledger and reviews
- 3a fileid-less title mismatch, UTF-16 title cut, `PDF_EXTENSION` duplicated: `src/draft-from-files.ts` (fd7d3ca).
- 3a magic icon sizes: `src/icon-sizes.ts`.
- 3a `.pdf`-only empty title: `draft-from-files.ts`.
- 3a double-click guard on "Novo envelope": `AppFrame.spec.ts:200`.
- 3a `<Suspense>`/`router.onError`: `src/main.ts:13`.
- 3a lazy views/pdf.js: pdf.js lives only in the `pdfjs-runtime` chunk.
- 3a T1:
  - package version and license: `package.json:4`, no version;
  - vitest globals and `consistent-type-assertions`: ledger FIX 0e27b1d;
  - app-config spec `toEqual` on whole state: `src/app-config.spec.ts:20`.
- 3a T3:
  - axios declared: `package.json`;
  - `require-jsdoc` off: ledger;
  - `isErrorBody` message type: `api-error.ts:45`;
  - `http_429` text: `error-messages.ts:13`.
- 3a T4:
  - nav active on envelope: `AppNavigation.vue:27`;
  - builder-call coverage: `new-envelope.spec.ts:147-152`;
  - non-ApiError toast: `new-envelope.spec.ts:177,213`;
  - picker label at 0: ledger FIX 3a8a5d8;
  - appName convention: `README.md:43`.
- 3a final:
  - limits key set: ClientConfigTest (fix batch 5);
  - URL roots: `src/app-urls.ts`;
  - ErrorBoundary spec counts fetches: fix batch 5;
  - prod sourcemaps off: `vite.config.ts:16`;
  - `MILLISECONDS_PER_SECOND` in module: `src/time-units.ts`;
  - action `enabled` order: `send-for-signature-action.ts:29-31`;
  - `app.config.errorHandler`: `src/log-uncaught-error.ts`.

#### Plan 3b, Tasks 1–6
- T1:
  - seed `refused` magic string and `signedAt` on a refused signer: `seed-demo.php:267` (`refusedAt`);
  - positional signer arrays: named `demoSigner(...)`;
  - preview user pt_BR: `seed-demo.php:127-128`;
  - `serve.sh reload`: `serve.sh:41`;
  - re-seed after PHPUnit plus atomic seed: final fix A5 and 6479649;
  - "preview envelopes deleted" mystery: explained and closed by A5;
  - row-order note: `design/README.md:24`.
- T2:
  - huge `page` → 422: `EnvelopeController.php:52`;
  - `archived_sandbox` only under All: `EnvelopeMapperSearchTest.php:81`;
  - paging limits in `EnvelopeLimits`: `EnvelopeLimits.php:17-18`.
- T3:
  - view-only share on source: `ViewOnlyShareTest.php:84`;
  - non-owner `PUT /documents` 404: `EnvelopeControllerTest.php:483`;
  - "Draft codes" docs heading: `docs/api.md:23`;
  - source unknown documentId 404: final fix A4.
- T4: `IURLGenerator` import order, `Notifier.php`.
- T5:
  - kit shield browser check: ledger CONTROLLER BROWSER CHECK;
  - AvSwitch sizes: `compact`/`large`, final core;
  - trailing-icon field and 24/11 avatar: final core;
  - AvTextarea 150px on review: `ReviewStep.vue:567-568`;
  - AvBanner titled padding and radius: `AvBanner.vue:58-63`;
  - slot wrappers now `<div>`: `AvBanner.vue:33`;
  - AvMenu z-index and padding tokens: `AvMenu.vue:200,215`;
  - AvDialog double close: `AvDialog.vue:39-55`;
  - AvButton/AvIconButton duplication: `AvPressable.vue`;
  - focused-select cursor: `identity.css:186-188`;
  - specificity comment (1,2,0): `identity.css:209`;
  - `margin: var(--av-control-margin, 0)` contract: `identity.css:123`;
  - identity.spec names reworded as "guards …": `identity.spec.ts:38-118`.
- T6:
  - `$el` narrowing: final fix A7;
  - drawer reopen after resize: `AppFrame.spec.ts:437`;
  - menu `aria-expanded`: `AppFrame.spec.ts:423`;
  - skip-nav in phone full-page: `AppFrame.vue:56`;
  - unmount test asserts `defaultPrevented`: `AppFrame.spec.ts:321-331`;
  - `useFrameLayout` doc: `frame-layout.ts:25-33`;
  - LoadingView px sourced: `LoadingView.vue:19-26`;
  - drawer strip 56px sourced: `AvDialog.vue:115-119`;
  - phone sandbox banner keeps body: `SandboxBanner.vue:14`;
  - `errorMessage` Proxy detour: `error-messages.ts:84-91`;
  - weak app-bar title spec: `AppFrame.spec.ts:392`;
  - phone inset contract: `AppFrame.vue:186`;
  - stale css chunks: `scripts/clean-build-output.mjs`;
  - drawer focus on "Novo envelope": ledger browser check;
  - `--av-phone-max` doc: final fix A11.

#### Plan 3b, Tasks 7–11
- T7:
  - bounced pill decision and "Lembrar: disponível em N min": Task 10;
  - `v-html` rule: no `v-html` in `src`.
- T8:
  - delete dialog Cancel/Esc guarded while pending, errors inline: final fix S2;
  - empty state while past last page: `DashboardView.vue:106-109`;
  - error predicate comment: `DashboardView.vue:55-60`, with specs at `DashboardView.spec.ts:603-623`;
  - table accessible name: `EnvelopeTable.vue:64`;
  - build cleans orphan chunks: `scripts/clean-build-output.mjs`;
  - blank-line nit.
- T9:
  - status list duplicated: `envelope-actions.ts:60` `isLiveEnvelope`;
  - envelope query duplicated: `src/api/envelope-query.ts`;
  - overflow filter duplicated: `action-menu.ts:79`;
  - `driveUrl` twice: `DocumentsCard.vue:54-58`;
  - "Assinado" while finalizing: `DocumentsCard.vue:56`;
  - cancel reason `required`: `CancelDialog.vue:82`;
  - clean script `existsSync`: final fix A8.
- T10:
  - server-side group guard: `SignerLinks.php:51`;
  - remind refresh on any ApiError: `SignersCard.vue:74-76`;
  - `REMINDER_HOLDS` typed by `ErrorCode`: `use-signer-cooldowns.ts:35`;
  - `heldInvitations` cleared per uuid: `SignersCard.vue:50`;
  - per-signer busy sets for remind and copy: `SignersCard.vue:46-48`;
  - `cache.apply` strips correction fields: `CorrectEmailDialog.vue:43-45`;
  - phone waiting state column: `SignerRow.vue:266-268`;
  - code-less 429 on remind and correction: `SignersCard.spec.ts:279,420`;
  - unhandled blob rejection: `sign-link-clipboard.ts:34`;
  - stale timeline after refused clipboard: `SignersCard.vue:96`;
  - copy-link rule equals reminder rule: `signer-state.ts:85-87`;
  - narrow desktop signer row: final fix S1 plus 913037a (580px, `SignerRow.vue:152`).
- T11:
  - eager is-svg payload: `vite.config.ts:15`;
  - double async load: static import `sidebar-tab-element.ts:3`;
  - detail errors logged: `SidebarEnvelopeCard.vue:58`;
  - `fileid` guard test: `FilesSidebarTab.spec.ts:122`;
  - `useId` prefix: `sidebar-tab-element.ts:12`;
  - `defineTabElement` race: final fix S5;
  - launcher clearance on the sidebar: browser-verified.

#### Plan 3b, Tasks 12–16
- T12:
  - title lost on route update: `DocumentsStep.spec.ts:111`;
  - grip click drops pending order: `DocumentsStep.vue:229`;
  - limits card counts in-flight files: `DocumentsStep.spec.ts:324`;
  - `PRIMARY_BUTTON` shared: `src/pointer.ts:2`;
  - bottom-bar clearance minus gutter: `WizardBottomBar.vue:84`;
  - focus after move or remove: `DocumentsStep.spec.ts:203,254`;
  - timezone note: `docs/api.md:105`;
  - later visit starts clean: `WizardView.spec.ts:427`;
  - optimistic retried order: `WizardView.spec.ts:455`;
  - title replay reads cached envelope: `draft-save-state.ts:55`;
  - blank field after failure: `WizardView.spec.ts:320`;
  - `Mutation` import: `draft-save-state.ts:1`;
  - `settledDeadline` docblock wrapped;
  - "saved exactly once" and "newer edit not replayed" tests: `WizardView.spec.ts:305,320`.
- T13:
  - typed-during-PUT rows kept: `SignersStep.vue:111-113`;
  - retry double PUT: `draft-save-state.ts:228-238`;
  - list error announced: `SignersStep.spec.ts:417`;
  - group-2 hint only with order: `SignersStep.vue:357`;
  - grid and `FIRST_GROUP` duplication: `signer-form.ts:26`, `signerColumns`;
  - dialog close paths: `SignersStep.spec.ts:555-581`;
  - focus after removing row: `SignersStep.spec.ts:276,285`;
  - history double-save, retry guard, `:key=uuid`, `hasNewerEdits` early return: round 3 c14e572.
- T14:
  - PDF cleanup per query hash;
  - `dist/` accumulation: `vite.config.ts:11`;
  - `renderTask` cleared plus superseded check: `PdfPageCanvas.vue:97-103`;
  - destroy rejection keeps error: `pdf-document.ts:46-53`;
  - corrupt PDF not retried: `pdf-document.ts:56-58`;
  - copy script throws, skips QuickJS: `copy-pdfjs-assets.mjs:7,25-28`;
  - `PRELOAD_MARGIN` in module script: `PdfPageCanvas.vue:3`;
  - type-pin spec renamed;
  - observer root: final fix W3, `PdfPageCanvas.vue:175`.
- T15:
  - keyboard resize directions;
  - shrink key growing an undersized box: `geometry.ts:113`;
  - mixed-page alignment test: `auto-placement.spec.ts:106-113`;
  - `?? 0` fallbacks: `RangeError`, `auto-placement.ts:57`;
  - zero-width NaN: `geometry.ts:71-73,96`;
  - short-page negative y: boxes always clamped.
- T16:
  - toolbar clamp: `PlacementBox.vue:177-183`;
  - `send` without placement: `placement-draft.ts:105-118`;
  - restored boxes of deleted signers: `SignersStep.vue:110`;
  - fields mutation growth: `forgetSettledFieldsSaves`;
  - `lostpointercapture`: `pointer-drag.ts:34,41`;
  - notices off the footer: `PlacementCanvas.vue:349-354`;
  - footer label hidden when short: `PlacementCanvas.vue:235`;
  - Escape in toolbar: `PlacementBox.vue:236,310`;
  - toolbar vs zoom pills layers: `identity.css:65,68`;
  - step chunk failure: `retryable-async-component.ts`;
  - pt_BR missing verb: `l10n/pt_BR.json:351`;
  - float noise: `placement-draft.ts:41-49`;
  - single-line line height: `box-label.ts:16,68`;
  - prop typing through `:is`: generic `useRetryableAsyncComponent`;
  - reload after repeated failure: `retryable-async-component.ts:8`;
  - line-height 1 plus `title` tooltip: `design/README.md` deviation;
  - "else no text" wording: `design/README.md`;
  - overlap copy without gate: `pt_BR.json:353`;
  - selection cleared after re-flow;
  - `StepLoadError` gap token: `StepLoadError.vue:46`;
  - T16 untested behaviours now covered: dispose save `placement-draft.spec.ts:251`, concurrent flush `:471`, failed boxes on reopen `:277`, focus after Delete `PlacementCanvas.spec.ts:286`.

#### Plan 3b, Tasks 17–18
- T17:
  - phone save status and retry: `PlacementSheet.vue:45`;
  - scroll clears selection: `PlacementCanvas.vue:167-179`;
  - hint live region: `PlacementStep.vue:373`;
  - switcher `aria-current`: `DocumentSwitcher.vue:115`;
  - constants in module script: `PlacementStep.vue:5-10`;
  - bitmap release and double buffer: `PdfPageCanvas.vue:93-130`;
  - ctrl+wheel re-anchor, `beginPinch` on touch-count change, hint-height token, shared `px()`: `src/css-pixels.ts`;
  - `forgetDrawing` on unmount: `PdfPageCanvas.vue:181-184`;
  - nested live region: `SaveStatusLine.vue:43`;
  - `DocumentRail` `px` duplicate.
- T18:
  - phone send button specificity;
  - send scoped after saves and refused while failed;
  - deadline banner copy;
  - date padding;
  - Campos "0 assinatura" copy;
  - `create_outcome_pending` PHP test;
  - `claim()` status first: `EnvelopeSender.php:62-64`;
  - form disabled while sending: `ReviewStep.vue:323`;
  - `requiresInitials` every page: `ReviewStep.spec.ts:192`;
  - today rule: `ReviewStep.vue:72-74,329`;
  - AvSelect deviation comment: `ReviewStep.vue:337`;
  - dead `av-banner__icon`: now the `#icon` slot;
  - `focusDeadline` via ref: `ReviewStep.vue:183-186`;
  - `hasRetryMetPassedDeadline` per uuid: `DetailView :key`, final fix S5.

#### Final reviews and fix round
- Screens: 1024–1280 layout, toasts with dialog open, refresh after ApiError, phone card tap target, `DetailView :key`, sidebar define race, shared poll constants (`src/presentation/envelope-polling.ts`).
- Backend: duplicate file ids (B1), source 404 (A4), phpunit re-seed (A5).
- Wizard: W1–W3, router moves while sending (A1), settled-save pruning (A2), `isAutoPlaced` function (A3), stale fields failure on page-count mismatch (W2).
- Core: disabled-field shield (A6), clean script (A8), stale l10n key and `SIGNER_PALETTE` (A9), skip-link module script and `adminSettingsUrl` (A10).
- Final re-review:
  - SignerRow threshold 580px (913037a);
  - DashboardView delete uses `envelopeCache.refresh`: `DashboardView.vue:101`.
- Task 19: Known-differences entries added to `design/README.md`.

### DECIDED (22)
- **Search over full `source_path` (folder names match):** documented and kept (ledger 3b T2).
- **`create()` validates all ids as integers before lookups:** the code-winner change is disclosed and judged acceptable (3b T3 re-review).
- **"Aguarda a vez" names the group right before; English keys "Finished"/"Sent out"/"Completed envelopes":** RATIFIED DEVIATION (3b T7). Translator context comments are not needed while only pt_BR ships.
- **`'A signer'` sentinel and `deadline_extended` fallback:** reviewer judged them defensive and reasonable (3b T7).
- **Bounced signer keeps "Visualizou"; copy link hidden outside the current group:** ledger DECISIONS (3b T10).
- **A viewed signer of a later group shows neither the waiting label nor a copy button:** reviewer says correct to stay (3b T10 round 2).
- **"Corrigir e-mail" for waiting signers, the "Com erro" chip, the phone pager, no phone sort, no phone draft delete:** Patrick kept them (`design/README.md` Known differences).
- **Signed copy saved next to each original "(assinado)":** Patrick kept it (`design/README.md`).
- **Placeholder colour `var(--av-muted)`:** a11y deviation logged (3b T5).
- **AvBanner 1023px hand-synced with `PHONE_MAX_WIDTH_PX`:** CSS `@media` can't read the constant; documented (final core, A11).
- **`!important` focus ring on everything inside `.av-root`:** accepted; later screens use `!important` where needed (3b T5 re-review).
- **`app.svg` white-only:** `img/app-dark.svg` covers light backgrounds (3a final).
- **Help widget constants and order in the listener:** reviewer said "Nothing to do" (3a T2).
- **`ERROR_MESSAGES` production export used by specs:** "Fine to keep" (final core).
- **MDI icons in AdminSettings and the Files action:** Task 19 kept them; ledger "→ kept".
- **`SKELETON_HEIGHT` 190px:** named and documented; reviewer judged it acceptable (3b T11).
- **Initials overflow at 65 or more signers:** unreachable with `MAX_SIGNERS` 20 (3b T15). The A4 + initials fit of 16 of 20 is logged as deviation 4.
- **Saves during a drag go out back to back:** harmless, one in flight and the latest wins (3b T16).
- **Non-passive `touchstart` and the native pan mixing with the pinch:** reviewer said keep it as is unless a device lags (3b T17).
- **`subscribePdfCleanup` ignores data present before subscription:** it doesn't apply, since `main.ts` subscribes first (3b T14).
- **`tests/env/preview-user.env` commits a local preview credential:** local, 127.0.0.1-bound preview only. Keep it out of any shared env (final backend).
- **Process items: frontend spec without a RED run (3b T2), commit 2ec591c message, and commits 708c52b/2ce3fd9 without built assets:** history, not code.

### BROWSER-CHECK (7)
- **Files row action:** menu and multi-select visibility, the redirect, and the lazy import under CSP (3a T5 "NEEDS MANUAL BROWSER SMOKE"). Do it on conecta-2 in Plan 4.
- **Real-phone placement:** pinch, drag and scroll, plus peak 2× canvas memory during a redraw on iOS (3b T17, Patrick's phone validation, conecta-2).
- **JPX/scanned PDF in the editor:** watch for JpxImage wasm warnings (3b T14).
- **Old view during a Suspense swap:** the old view shows in the new layout while the swap resolves (3b T6).
- **Drawer closes on a real keyboard Esc:** the tool's synthetic Esc can't trigger it (3b T6 controller note).
- **AvSwitch focus ring shape:** the ring is drawn on the switch row; check it is not a square around the pill (3b T5).
- **Local `avuzconecta:latest` image:** it predates the help-widget `pointer-events` fix. Rebuild it for previews; this is not an app bug (3b Task 19 finding).

### Could not classify
None.
