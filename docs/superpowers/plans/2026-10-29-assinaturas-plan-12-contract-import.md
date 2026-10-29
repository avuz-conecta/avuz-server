# Assinaturas Plan 12: import contracts signed elsewhere — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a company import a contract it signed elsewhere (a PDF in Drive), so the contract gets the same alerts, renewals and expiry as one signed through us. Ship it in 0.11.0 together with the "Não possui" badge.

**Architecture:**
- **Server:** an import is an envelope with one document and two new statuses.
  - `importing` means unconfirmed: owner-only, never listed.
  - `imported` means confirmed and holding a contract.
  - A new `Contract/ContractImports` service starts, confirms, deletes and sweeps imports; a new `ImportController` exposes it under `/api/v1/imports`.
  - Everything else reuses the contract machinery: alerts, lifecycle, listing, `continues_contract_id` chains.
  - The envelope never gets `zapsign_token`, `create_attempted_at`, `sent_at` or `completed_at`, so send, sync and usage leave it out without new filters.
- **Frontend:**
  - A sidebar button opens the Drive picker.
  - `POST /imports` creates the `importing` envelope, and its page (`/envelopes/:uuid`) shows a new `ImportView` form, with AI suggestions as in the Contrato step.
  - After confirming, the page is a stripped-down detail page: the "assinado fora" line, the document, the contract card.

**Tech Stack:**
- PHP 8 / Nextcloud 33 QueryBuilder, PHPUnit integration tests (`tests/env/phpunit.sh`).
- Vue 3.5 + TS, TanStack Query, Vitest.

**Spec:**
- `docs/superpowers/specs/2026-10-20-assinaturas-contract-import-design.md` (the feature).
- `docs/superpowers/specs/2026-10-28-assinaturas-contracts-in-envelope-list-design.md`, section "Importing a contract" (entry points, "Importados" chip, empty state).

Both are in the avuz-server worktree. Read both before every task.

**Repo:** all code lives in `~/work/avuz/assinaturas`. Create branch `contract-import` off `main` (`1d22c95`, 0.10.0). Run every command from that repo.

## Global Constraints

- **Add-on gate:** with `contracts_enabled` off:
  - every `/api/v1/imports` route answers 403 `contracts_disabled`;
  - the UI shows no import button, no "Importados" chip, no "Importar renovação" and no import empty-state sentence.
  - Existing imported envelopes stay stored and visible with status "Importado". Their contracts stop alerting, as all contracts do.
- **Never billed, never sent:** no code path sets `zapsign_token`, `create_attempted_at`, `sent_at` or `completed_at` on an `importing` or `imported` envelope. Nothing ever calls the signing provider for one.
- **`importing` is the owner's alone.**
  - Managers and admins don't see it either.
  - It is in no list, count, chip, notice or total.
  - It holds no contract and sends nothing.
- **`imported` follows today's rules:**
  - visibility: owner, managers (`canSeeAll`), folder rights;
  - alerts: `AlertRecipients`.
- **Who may import:** anyone who can use the app (`AccessPolicy::canUseApp`).
- **Who may delete:**
  - an `importing` envelope: its owner;
  - an `imported` one: its owner or anyone with `canSeeAll`.
  - The Drive file is never touched, copied or moved.
- **Terms:** fixed dates only (`termMode` `fixed`). `endsOn` is required and `startsOn` optional. The rest is validated exactly as `ContractTerms::fromInput`. `source` is `manual` or `ai_confirmed`.
- **Past dates at confirm:**
  - auto-renew off and `endsOn` < today: saved `expired`;
  - auto-renew on: rolled forward with `ContractTerms::rolledForward()` until `endsOn` ≥ today, saved `active`;
  - Either way, no notification. Every alert offset already due (`offset ≥ days left`) is recorded as sent without notifying.
- **Ruling (spec conflict):**
  - The spec's "Contract details" says the next lifecycle run rolls a past auto-renewing import forward. Its "Edge cases" says confirm rolls it forward, without any alert.
  - This plan follows "Edge cases", the more specific rule: rolling at confirm avoids an "auto-renewed" notification for something the person just typed in.
- **Renewal chain:**
  - "Importar renovação" exists only on contracts whose envelope is `imported`.
  - The new contract has `continues_contract_id` = old.
  - The old one goes `active|expired → renewed`, as `ContractActivation::markRenewed` does.
- **One confirmed import per Drive file:**
  - A file that backs an `imported` envelope's document is refused: 409 `file_already_imported`.
  - A file that is the source of a sent envelope may still be imported.
- **pt_BR copy fixed by the specs:**
  - "Importar contrato assinado" · "Importar renovação" · "Importado" · "Importados";
  - "Este arquivo já foi importado." · "Exclua a renovação primeiro." · "Arquivo indisponível";
  - "Assinado fora do AvuzConecta · importado por {name} em {date}";
  - empty state: "Marque um documento como contrato ao adicionar documentos, ou importe um contrato já assinado."
- **pt_BR copy decided here:**
  - form heading: "Importar contrato assinado", or "Importar renovação" for a renewal;
  - buttons: "Importar contrato" (confirm) · "Cancelar";
  - delete button: "Excluir importação";
  - dialog: "Excluir importação?" · "O contrato e seus alertas serão excluídos. O arquivo continua no Drive." · "Excluir";
  - picker title: "Escolha o contrato assinado (PDF)";
  - field: "Título".
- **User-facing copy:**
  - Source strings are English. pt_BR goes in `l10n/` through `node scripts/add-translations.mjs` (stdin JSON).
  - Never name the signing provider, the AI provider or "Nextcloud".
- **Code style:**
  - Follow the repo: tabs, `final` classes, no `any`, almost no `as`, named exports, hash maps over switch, early return, descriptive names.
  - Higher-order guards in controllers, as `ContractController::onEnvelope`.
  - Test names in the 3rd person, no "should".
- **Postgres:** `ContractMapper::insertIfNew` must not run inside an open transaction.
- **Commits:** Conventional Commits, with no AI attribution lines.
- **Tests:**
  - Never run `tests/env/reset.sh` without Patrick's OK.
  - `tests/env/phpunit.sh` auto-resets when `avuzconecta:latest` is newer than `~/.assinaturas-test-image-id`. Compare `docker image inspect avuzconecta:latest --format '{{.Id}}'` with that file first. If they differ, stop and ask.

## Review Focus

1. **The hourly reading sweep wiping an import's AI reading mid-form.**
   - `DocumentMapper::clearContractReadingsOfSentEnvelopes` clears every envelope whose status is not draft, sending or failed, so it would clear `importing` too.
   - `importing` must keep its readings.
   - Test: Task 1 `testKeepsTheReadingsOfAnImportInProgress`.
2. **A manager opening another user's unconfirmed import by URL.**
   - Today `canSee` lets managers see drafts.
   - `importing` must answer 404 to everyone but the owner.
   - Test: Task 1 `testHidesAnImportInProgressFromManagers`.
3. **An imported contract whose alert days have all passed** (key date in 5 days, alerts [90, 30, 7]).
   - Confirming sends nothing, and the next lifecycle run sends nothing either.
   - The 0-day alert still fires on the key date.
   - Test: Task 3 `testSendsNoCatchUpAlertForOffsetsAlreadyDue`.
4. **Imported rows in the list.**
   - They have no signers and no deadline. The progress and deadline cells show "—", never "0 de 0" or a blank bar.
   - Test: Task 5 `shows a dash for the signing columns of an imported envelope`.
5. **Deleting the newest import of a chain whose old contract had auto-renew and a past end.**
   - The old contract comes back `active`, so the next run rolls it forward. It does not come back `expired`.
   - Test: Task 4 `testRestoresAPastAutoRenewingPredecessorAsActive`.

---

## File map

**Server (create):**
- `lib/Contract/ContractImports.php`: start, confirm, delete, sweep.
- `lib/Contract/ImportRejected.php`: an exception carrying `errorCode` and `httpStatus`, shaped like `ContractRejected`.
- `lib/Controller/ImportController.php`
- `lib/Contract/ImportSweepJob.php`: an hourly `TimedJob`.
- `lib/Migration/Version001100Date20261029000000.php`: adds `imported_at` BIGINT NULL to `assinaturas_envelopes`.
- tests: `tests/Integration/Contract/ContractImportsTest.php`, `tests/Integration/Controller/ImportControllerTest.php`.

**Server (modify):**
- `lib/Db/EnvelopeStatus.php`, `lib/Db/Envelope.php`, `lib/Db/EnvelopeFilter.php`, `lib/Db/EnvelopeMapper.php`, `lib/Db/DocumentMapper.php`
- `lib/Access/AccessPolicy.php`, `lib/Draft/EnvelopeDrafts.php` (`sourceOf`)
- `lib/Controller/ContractReadingController.php`, `lib/Action/EnvelopeRemoval.php`
- `lib/Contract/ContractAlerts.php` (`recordDueAsSent`), `lib/Api/EnvelopeDetails.php`
- `appinfo/info.xml` (version, job), `docs/api.md`, `README.md`

**Frontend (create):**
- `src/import/start-import.ts`
- `src/import/ImportView.vue`
- `src/import/import-form.ts`
- `src/detail/ImportedLine.vue`
- `src/detail/ImportDeleteDialog.vue`
- `src/api/imports.ts`
- specs beside each.

**Frontend (modify):**
- `src/api/types.ts`, `src/api/error-messages.ts`, `src/presentation/envelope-status.ts`
- `src/envelope/EnvelopeView.vue`, `src/wizard/contract-readings.ts`
- `src/layout/AppNavigation.vue`
- `src/dashboard/FilterChips.vue` (via `FILTER_ORDER`), `src/dashboard/EnvelopeTable.vue`, `src/dashboard/EnvelopeCards.vue`, `src/dashboard/EmptyListing.vue`
- `src/detail/DetailView.vue`, `src/detail/ContractCard.vue`, `src/detail/envelope-actions.ts`

---

### Task 0: Branch and bundle the "Não possui" badge

- [ ] **Step 1:** `git switch main && git switch -c contract-import && git merge --no-ff no-contract-badge -m "Merge branch 'no-contract-badge' into contract-import"`.
- [ ] **Step 2:** `npx vitest run src/dashboard`. Expected: PASS, including `labels an envelope without a contract as having none`.

No review gate: the badge was reviewed in the previous session (7140b22, full Vitest green).

---

### Task 1: Statuses, privacy and exclusions

**Files:**
- Modify:
  - `lib/Db/EnvelopeStatus.php`, `lib/Db/Envelope.php`, `lib/Db/EnvelopeFilter.php`
  - `lib/Db/EnvelopeMapper.php` (`applyConditions`), `lib/Db/DocumentMapper.php` (`clearContractReadingsOfSentEnvelopes`)
  - `lib/Access/AccessPolicy.php`, `lib/Draft/EnvelopeDrafts.php` (`sourceOf`)
  - `lib/Controller/ContractReadingController.php`, `lib/Action/EnvelopeRemoval.php`
- Create: `lib/Migration/Version001100Date20261029000000.php`
- Test:
  - `tests/Integration/Access/AccessPolicyTest.php`
  - `tests/Integration/Db/EnvelopeMapperSearchTest.php`
  - `tests/Integration/Contract/Ai/ContractReadingsTest.php`
  - `tests/Integration/Action/EnvelopeRemovalTest.php`
  - Add each test to the existing file of that name. If none fits, put it in the file of the class under test.

**Interfaces:**
- Produces:
  - `EnvelopeStatus::Importing = 'importing'` and `EnvelopeStatus::Imported = 'imported'`.
  - `EnvelopeStatus::OWNER_PRIVATE = [Draft, Importing]`.
  - `EnvelopeStatus::NEVER_LISTED = [Importing]`.
  - `EnvelopeStatus::READABLE_BY_AI = [Draft, Importing]`.
  - `Envelope::$importedAt` (`?int`, column `imported_at`).
  - `EnvelopeFilter::Imported = 'imported'` → `[EnvelopeStatus::Imported]`.

- [ ] **Step 1: Write the failing tests**
  - `testHidesAnImportInProgressFromManagers`: an `importing` envelope of user A, a manager B, and an A-owned folder where B has Gerenciar. Asserts `canSee` and `canAct` are false for B and true for A.
  - `testLeavesImportsInProgressOutOfEveryList`:
    - an `importing` envelope of the searcher, under the `mine` and `company` scopes;
    - asserts `search()` doesn't return it;
    - asserts `countByStatus()` has no `importing` key.
  - `testFiltersImportedEnvelopes`: the filter `imported` returns only `imported` envelopes.
  - `testKeepsTheReadingsOfAnImportInProgress`:
    - a document of an `importing` envelope with `contract_reading` set;
    - after `clearContractReadingsOfSentEnvelopes()`, the reading is still set;
    - one of an `imported` envelope is cleared.
  - `testRefusesAdminRemovalOfAnImport`:
    - `EnvelopeRemoval::remove` on an `imported` envelope throws `ActionRejected` with `errorCode` `not_removable`;
    - the envelope row is still there.

- [ ] **Step 2:** Run `tests/env/phpunit.sh --filter 'AccessPolicyTest|EnvelopeMapperSearchTest|ContractReadingsTest|EnvelopeRemovalTest'`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement**
  - **Migration:** follow `Version000800Date20261009000000` for shape. Add `imported_at` as `Types::BIGINT`, nullable. Add the getter, setter and type to `Envelope`.
  - **`AccessPolicy`:**
    - `canSee` and `canAct` return `owner === user && canUseApp(user)` when the status is `Importing`, before any other rule.
    - `sharedRight` already gives nothing for `OWNER_PRIVATE`.
  - **`EnvelopeMapper::applyConditions`:** always adds `e.status NOT IN NEVER_LISTED`.
  - **`DocumentMapper::clearContractReadingsOfSentEnvelopes`:** keeps readings of envelopes in `STATUSES_THAT_CAN_RETURN_TO_DRAFT` ∪ `[Importing]`, with a new private const `STATUSES_WITH_LIVE_READINGS`.
  - **`ContractReadingController`:** guard `in_array($status, EnvelopeStatus::READABLE_BY_AI, true)`. The error code and message are unchanged.
  - **`EnvelopeDrafts::sourceOf`:** accepts `READABLE_BY_AI` statuses instead of `assertDraft`. Keep 409 `not_a_draft` for any other.
  - **`EnvelopeRemoval::remove`:** throws `new ActionRejected('not_removable', 'Imports are deleted from their own page')` with HTTP 409 for `Importing` and `Imported`. Imports are deleted with `ContractImports::delete`, which also deletes the contract.

- [ ] **Step 4:** Run the Step 2 command. Expected: PASS. Then run `tests/env/phpunit.sh --filter 'Envelope|Access|Reading|Removal'`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(imports): importing and imported envelope statuses`.

---

### Task 2: Start an import, abandon and sweep

**Files:**
- Create:
  - `lib/Contract/ContractImports.php` (`start`, `sweepAbandoned`)
  - `lib/Contract/ImportRejected.php`
  - `lib/Contract/ImportSweepJob.php`
  - `lib/Controller/ImportController.php` (`start`)
- Modify:
  - `appinfo/info.xml` (`<background-jobs>` gains `OCA\Assinaturas\Contract\ImportSweepJob`)
  - `lib/Api/EnvelopeDetails.php` (`renewsContractTerms`)
- Test: `tests/Integration/Contract/ContractImportsTest.php`, `tests/Integration/Controller/ImportControllerTest.php`

**Interfaces:**
- Consumes (Task 1): `EnvelopeStatus::Importing`; `EnvelopeFilter::Imported`.
- Produces:
  - `ContractImports::start(string $ownerUid, int $fileId, ?int $folderId, ?int $renewsContractId): Envelope`
  - `ContractImports::sweepAbandoned(): int` (the number deleted)
  - `ContractImports::ABANDONED_AFTER_SECONDS = 86400`
  - `POST /api/v1/imports` with `{fileId: int, folderId?: int|null, renewsContractId?: int|null}` → 201 envelope detail.
  - The envelope detail gains `renewsContractTerms: ContractTerms|null`. It is set only for an `importing` envelope with `renews_contract_id`: that contract's terms (the `toArray()` shape) plus `id`.

- [ ] **Step 1: Write the failing tests**
  - `testStartsAnImportFromAPdfOfTheOwner`:
    - status `importing`;
    - title = the file name without extension (`Apólice 2026.pdf` → `Apólice 2026`);
    - one document whose `source_file_id` is the file;
    - `zapsign_token`, `sent_at`, `completed_at` and `create_attempted_at` are null.
  - `testDeletesTheOwnersEarlierImportsInProgress`:
    - starting a second import deletes the first `importing` envelope of the same owner, with its document;
    - another user's import stays.
  - `testRefusesAFileThatBacksAConfirmedImport`: 409 `file_already_imported`. After that import is deleted, the same file starts fine.
  - `testImportsAFileAlreadySentForSignature`: the source file of a `completed` envelope starts an import.
  - `testRefusesARenewalOfAContractNotImported`: an envelope-signed contract gives 409 `not_an_imported_contract`.
  - `testRefusesARenewalWithTheFileTheOldContractUses`: 409 `file_already_imported`.
  - `testRefusesARenewalOfAClosedContract`: an `ended` or `renewed` contract gives 409 `contract_closed`.
  - `testRefusesANonPdf`: 422 `file_not_pdf`, reusing the `EnvelopeDrafts::ownerPdf` checks.
  - `testSweepsImportsInProgressOlderThanADay`:
    - one 25 h old is deleted, one 23 h old is kept;
    - an `imported` 30 days old is kept.
  - Controller tests:
    - `testAnswersForbiddenWhileTheAddonIsOff`: 403 `contracts_disabled`.
    - `testAnswersForbiddenToAUserOutsideTheApp`: 403 `forbidden`.
    - `testFilesTheImportInTheGivenFolder`: needs Editar, else 403, as `EnvelopeFiling`.
    - `testReturnsTheRenewedTermsWithARenewalImport`: the detail carries `renewsContractTerms.id`.

- [ ] **Step 2:** Run `tests/env/phpunit.sh --filter 'ContractImportsTest|ImportControllerTest'`. Expected: FAIL (class not found).

- [ ] **Step 3: Implement**
  - **Validating the file:** extract the private `EnvelopeDrafts::ownerPdf` into a public method on `EnvelopeDrafts` (`ownerPdf(string $ownerUid, int $fileId): File`) and call it. Don't copy it.
  - **The new document:** created as `EnvelopeDrafts::newDocument` does. Make that public, or move it to `DocumentMapper` as a named constructor.
  - **Duplicate check:** a `DocumentMapper::isSourceOfImport(int $fileId): bool` query joins envelopes with `status = imported`.
  - **Renewal:**
    - Load the contract; the user must `canSee` (else 404 `contract_not_found`) and `canAct` (else 403) on its envelope.
    - That envelope must be `Imported`, and the contract `Active` or `Expired`.
    - The new envelope's `renews_contract_id` = the contract id.
    - With no folder given, the renewal is filed in the old envelope's folder when the user still has Editar there, as `RenewalDrafts::keptFolder` does. Reuse it.
  - **Order of work:**
    - Run the duplicate check and the abandon-earlier deletion before inserting.
    - The deletion goes through `ContractImports::deleteImporting(Envelope)` (private), which deletes the documents, then the envelope, guarded by `deleteWhereStatus(id, [Importing])`.
  - **`ImportController`:**
    - one higher-order guard, `onImports(callable)`: add-on on, else 403 `contracts_disabled`; `canUseApp`, else 403; it maps `ImportRejected`, `DraftRejected` and `FolderRejected` like `ContractController::handlingRejections`.
    - `#[NoAdminRequired]`, `#[FrontpageRoute(verb: 'POST', url: '/api/v1/imports')]`.
  - **Sweep job:** `ImportSweepJob` runs every 3600 s and calls `sweepAbandoned()`. It logs `info` with the count only when it is > 0.

- [ ] **Step 4:** Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit** `feat(imports): start an import from a Drive PDF`.

---

### Task 3: Confirm an import

**Files:**
- Modify:
  - `lib/Contract/ContractImports.php` (`confirm`)
  - `lib/Contract/ContractAlerts.php` (`recordDueAsSent`)
  - `lib/Controller/ImportController.php` (`confirm`)
- Test: `ContractImportsTest`, `ImportControllerTest`, `tests/Integration/Contract/ContractLifecycleTest.php`

**Interfaces:**
- Consumes (Task 2): `ContractImports::start`; `ImportRejected`.
- Produces:
  - `ContractImports::confirm(Envelope $envelope, string $title, mixed $terms, string $actorUid): void`
  - `ContractAlerts::recordDueAsSent(Contract $contract, string $today): void`
  - `POST /api/v1/imports/{uuid}/confirm` with `{title: string, terms: object}` → 200 envelope detail.

- [ ] **Step 1: Write the failing tests**
  - `testConfirmsAnImportIntoAnActiveContract`:
    - status `imported`, `imported_at` = now;
    - one contract on the document with `continues_contract_id` null and the given `source`;
    - the title is trimmed and saved.
  - `testRefusesTermsCountedFromSigning`: `termMode: 'from_signing'` gives 422 `contract_term_mode_invalid`.
  - `testSavesAPastEndAsExpiredWithoutNotifying`: `endsOn` = yesterday and auto-renew off give `expired`. No notification goes to anyone (assert through the notification manager fake used by `ContractAlertsTest`).
  - `testRollsAPastAutoRenewingContractToTheTermHoldingToday`:
    - `endsOn` = today − 400 days, auto-renew with a 12-month term;
    - result: `active` and `endsOn` ≥ today;
    - no notification.
  - `testSendsNoCatchUpAlertForOffsetsAlreadyDue`:
    - key date today + 5, alert days `[90, 30, 7, 0]`;
    - after confirm and a `ContractLifecycle::run()` today: zero notifications;
    - with the clock at the key date, `run()` sends one alert (offset 0).
  - `testAlertsTheImporterManagersAndFolderEditors`:
    - an import in a folder where C has Editar, with a 10-day alert due tomorrow;
    - `run()` tomorrow notifies the owner, a member of `assinaturas-admins` and C.
  - `testContinuesTheOldContractOnARenewalImport`: the new contract has `continues_contract_id` = old; the old one is `renewed`, with a `ContractEvent::Replaced` event.
  - `testRefusesARenewalImportWhileARenewalEnvelopeIsOpen`: an open renewal draft of the old contract gives 409 `renewal_open`.
  - `testRefusesASecondConfirmOfTheSameFile`: two `importing` envelopes of different users over one shared file; the second confirm gives 409 `file_already_imported`.
  - `testRefusesConfirmingAnImportThatIsNotInProgress`: an `imported` envelope gives 409 `not_importing`.
  - Controller test `testAnswersNotFoundToSomeoneElsesImport`: 404 `not_found` for a manager.
  - **Never counted:** add to `UsageControllerTest` (or the usage report test) `testLeavesImportsOutOfUsage`. An imported envelope adds nothing to sent, completed or billed counts.
  - **Never sent:** in `ContractImportsTest`, `testNeverReachesSendOrSync`. After confirm:
    - `EnvelopeMapper::findDueForSync` doesn't return it;
    - `SendJob`'s claim (`EnvelopeSender::claim`) throws `SendConflict`.

- [ ] **Step 2:** Run `tests/env/phpunit.sh --filter 'ContractImportsTest|ImportControllerTest|ContractLifecycleTest|Usage'`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement `confirm`**
  - **Validate first, write nothing yet:**
    - status `Importing`, else `ImportRejected('not_importing', …, 409)`;
    - title as `EnvelopeDrafts::assertTitle` (reuse it: make it public static);
    - `ContractTerms::fromInput($terms)`.
  - **Under an exclusive lock** `assinaturas/import-file/<source_file_id>` (`ILockingProvider`, as `ContractActions::renew` does; a locked file gives 409 `file_already_imported`):
    1. Re-run the duplicate check.
    2. For a renewal: take the `RenewalDrafts::LOCK_PREFIX . id` lock too. Refuse `RenewalDrafts::renewalOpen()` when `hasRenewalOf(id, OPEN_RENEWAL_STATUSES)`. Refuse `contract_closed` unless the old contract is `Active` or `Expired`.
    3. Settle past dates:

       ```php
       $settled = $terms;
       if ($settled->autoRenew) {
       	while ($settled->endsOn < $today) {
       		$settled = $settled->rolledForward();
       	}
       }
       ```

    4. `newContract(envelopeId, documentId, renewsContractId, now)`.
    5. Status: `Expired` when `!autoRenew && endsOn < today`, else `Active`.
    6. `insertIfNew`, outside any transaction. `false` gives 409 `contract_exists`.
    7. `transitionStatus(id, [Importing], Imported, …)` with the title and `imported_at`. Add `title` and `imported_at` to `EnvelopeMapper::TRANSITION_COLUMNS`. If the transition loses, delete the contract just inserted and refuse `not_importing`.
    8. For a renewal: the old contract goes `active|expired → renewed` (`ContractMapper::transition`), and record `ContractEvent::Replaced` on the old envelope, exactly as `ContractActivation::markRenewed`. Extract that into a public `ContractActivation::markRenewed(int $contractId, int $now)` and call it.
    9. `ContractAlerts::recordDueAsSent($contract, $today)`.
    10. Record `ContractEvent::Registered` on the import envelope, with `['contractId' => id]` and the actor, as `ContractActions::register`.
  - **`recordDueAsSent`:** records every offset in `dueOffsets($contract, daysBetween(today, keyDate))` via `record()`, with no notification. For an `expired` contract (days left < 0) it records nothing.

- [ ] **Step 4:** Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit** `feat(imports): confirm an import into a tracked contract`.

---

### Task 4: Delete an import, its document and the detail payload

**Files:**
- Modify:
  - `lib/Contract/ContractImports.php` (`delete`)
  - `lib/Controller/ImportController.php` (`destroy`, `document`)
  - `lib/Api/EnvelopeDetails.php`
- Test: `ContractImportsTest`, `ImportControllerTest`, `tests/Integration/Api/EnvelopeDetailsTest.php`

**Interfaces:**
- Produces:
  - `ContractImports::delete(Envelope $envelope, string $actorUid): void`
  - `DELETE /api/v1/imports/{uuid}` → 200 `{deleted: true}`
  - `GET /api/v1/imports/{uuid}/document` → the PDF stream, or 404 `file_unavailable`.
  - The detail of an `imported` or `importing` envelope gains:
    - `importedAt: int|null` (unix seconds);
    - `documents[].fileAvailable: boolean`: the owner can still read the file. It is true for all other statuses.
  - `permissions.deleteImport: boolean`: owner for `importing`; owner or `canSeeAll` for `imported`; false otherwise.

- [ ] **Step 1: Write the failing tests**
  - `testDeletesAnImportAndKeepsTheDriveFile`: the envelope, document, contract, contract alerts and events are gone. The Drive file still exists, with its etag unchanged.
  - `testCancelsAnImportInProgress`: the owner deletes an `importing` one.
  - `testRefusesDeletingAnImportARenewalContinues`: 409 `renewal_exists`, and nothing is deleted.
  - `testRestoresThePredecessorWhenTheNewestRenewalIsDeleted`: the old contract with `endsOn` ahead goes back to `active`; with `endsOn` past and no auto-renew, to `expired`.
  - `testRestoresAPastAutoRenewingPredecessorAsActive`: use `ContractActions::statusFor`'s rule (make it `public static`).
  - `testLetsManagersDeleteAnImport`, and `testRefusesFolderEditorsDeletingAnImport` (403).
  - `testRefusesDeletingAnEnvelopeThatIsNotAnImport`: a `completed` envelope gives 409 `not_an_import`.
  - Controller test `testStreamsTheImportedDocumentToAFolderViewer`: 200 and `application/pdf`. After the owner deletes the file: 404 `file_unavailable`.
  - Detail tests:
    - `testMarksAnImportedDocumentUnavailableOnceTheFileIsGone`;
    - `testCarriesTheImportDate`.

- [ ] **Step 2:** Run `tests/env/phpunit.sh --filter 'ContractImportsTest|ImportControllerTest|EnvelopeDetailsTest'`. Expected: FAIL.

- [ ] **Step 3: Implement**
  - **`delete`:**
    - Permission check, then status (`Importing` or `Imported`).
    - Then `ContractMapper::findContinuing(contract id) !== null` → `renewal_exists`.
    - Then, in one transaction: delete the alerts, the contract and its events; delete the document and envelope (`deleteWhereStatus` guard); restore the predecessor with `ContractMapper::transition(id, [Renewed], statusFor(terms, today), now)`.
    - Then mark the envelope's notifications processed: `INotificationManager::markProcessed` with app `assinaturas`, object type `SenderNotificationListener::OBJECT_TYPE` and the envelope uuid.
  - **`document`:**
    - stream through `PdfStreamResponse`, the same way `EnvelopeDownloads` streams a signed PDF;
    - the guard is `canSee`;
    - the file is read as the owner, with `EnvelopeDrafts::ownerPdf`; any `DraftRejected` gives 404 `file_unavailable`.

- [ ] **Step 4:** Run the Step 2 command. Expected: PASS. Then run `tests/env/phpunit.sh`. Expected: PASS (about 1750 tests, about 30 min; run it in the background).

- [ ] **Step 5: Docs**
  - `docs/api.md`: new section "Imports", after "Contracts", covering:
    - the three routes and the document route;
    - the two statuses;
    - the error codes `file_already_imported`, `not_an_imported_contract`, `not_importing`, `not_an_import`, `renewal_exists`, `file_unavailable`, `not_removable`;
    - `renewsContractTerms`, `importedAt`, `fileAvailable`, `permissions.deleteImport`.
  - Add the `imported` filter to the Listing section. Add each code to the Errors table.

- [ ] **Step 6: Commit** `feat(imports): delete an import and serve its document`.

---

### Task 5: Frontend API, list and entry points

**Files:**
- Create: `src/api/imports.ts`, `src/import/start-import.ts` (+ specs)
- Modify:
  - `src/api/types.ts`, `src/api/error-messages.ts`
  - `src/presentation/envelope-status.ts`
  - `src/dashboard/EnvelopeTable.vue`, `src/dashboard/EnvelopeCards.vue`, `src/dashboard/EmptyListing.vue`, `src/dashboard/FilterChips.vue`
  - `src/layout/AppNavigation.vue`
- Test:
  - `src/api/imports.spec.ts`, `src/import/start-import.spec.ts`
  - `src/dashboard/DashboardView.spec.ts`, `src/layout/AppFrame.spec.ts`, `src/presentation/envelope-status.spec.ts`

**Interfaces:**
- Consumes (Tasks 2–4): the routes and payload fields above.
- Produces:
  - `startImport(fileId: number, folderId: number | null, renewsContractId: number | null): Promise<EnvelopeDetail>`
  - `confirmImport(uuid: string, title: string, terms: ContractTerms): Promise<EnvelopeDetail>`
  - `deleteImport(uuid: string): Promise<void>`
  - `importDocumentUrl(uuid: string): string`
  - `startNewImport(router: Router, folderId: number | null, renewsContractId?: number | null): Promise<void>` in `src/import/start-import.ts`
  - `EnvelopeStatus` gains `'importing' | 'imported'`; `EnvelopeFilter` gains `'imported'`; `EnvelopePermissions.deleteImport`; `EnvelopeDocument.fileAvailable`; `EnvelopeDetail.importedAt` and `renewsContractTerms`.

- [ ] **Step 1: Write the failing tests**
  - `envelope-status.spec.ts`: `labels an imported envelope "Importado"`.
  - `DashboardView.spec.ts`:
    - `shows the "Importados" chip only while contract management is on`;
    - `shows a dash for the signing columns of an imported envelope`: the table and the phone cards show "—" for progress and deadline, with no progress bar;
    - `offers the import in the "Com contrato" empty state`: the full two-sentence text and an "Importar contrato assinado" button, add-on on.
  - `AppFrame.spec.ts`:
    - `puts "Importar contrato assinado" under "Adicionar documentos"`: the button comes right after the new-envelope button in DOM order;
    - `leaves the import button out while contract management is off`.
  - `start-import.spec.ts`:
    - `opens the picker for one PDF and opens the new import`: the picker is `pickDocumentNodes` with max 1 and the title "Escolha o contrato assinado (PDF)", PDF only, no conversion. It calls `startImport(fileId, folderId, null)`, then `router.push` to the envelope route.
    - `does nothing when the picker closes empty`.
    - `shows "Este arquivo já foi importado." on file_already_imported`.

- [ ] **Step 2:** Run `npx vitest run src/api src/import src/dashboard src/layout src/presentation`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement**
  - **`pickDocumentNodes`:** add an optional `mimeTypes` parameter defaulting to today's `acceptedMimeTypes(...)`. The import passes `['application/pdf']`.
  - **`FILTER_ORDER`:** becomes a function `filterOrder(contractsEnabled: boolean)` that appends `'imported'` when the add-on is on. Update its callers.
  - **Status presentation:**
    - `STATUS_LABELS.imported` = 'Imported' (pt_BR "Importado"), tone `info`;
    - `STATUS_LABELS.importing` = 'Importing' (pt_BR "Importando"), tone `neutral`;
    - `STATUS_ACTIONS.importing` = `[]` and `STATUS_ACTIONS.imported` = `[]`;
    - `'imported'` and `'importing'` are not in `DELETABLE_STATUSES`.
  - **Sidebar button:** an `AvButton` `variant="secondary"` `size="large"` under the new-envelope button, shown when `appConfig().contractsEnabled`. It calls `startNewImport(router, folderForNewEnvelope(...))`, with the same busy flag pattern.
  - **Error messages:** add the pt_BR messages for every new error code to `error-messages.ts`.

- [ ] **Step 4:** Run the Step 2 command, then `npx vue-tsc --noEmit && npx eslint src`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(imports): import entry points and imported rows in the list`.

---

### Task 6: The import form

**Files:**
- Create:
  - `src/import/ImportView.vue`
  - `src/import/import-form.ts`
  - `src/import/ImportView.spec.ts`, `src/import/import-form.spec.ts`
- Modify: `src/envelope/EnvelopeView.vue`, `src/wizard/contract-readings.ts`

**Interfaces:**
- Consumes (Task 5): `confirmImport`, `deleteImport`; `ContractFields`, `EnvelopeFolderField`; `useContractReadings` and `useContractReadingRequests`.
- Produces:
  - `initialImportForm(envelope: EnvelopeDetail): ContractForm`: the renewed contract's terms with `startsOn` and `endsOn` blanked, or `emptyContractForm()`.
  - `isReadableByAi(envelope: EnvelopeDetail | undefined): boolean`, replacing the private `isEditableDraft` in `contract-readings.ts`: status `draft` or `importing`, and `permissions.edit`.

- [ ] **Step 1: Write the failing tests**
  - `ImportView.spec.ts`:
    - `fills the form with what the AI read and marks it "Sugerido pela IA"`;
    - `works without an AI suggestion`: AI off, or the reading failed;
    - `offers fixed dates only`: no "A partir da assinatura" (`offersTermModes` false);
    - `confirms with the edited title and terms, then shows the imported envelope`;
    - `cancels by deleting the import and going back to the list`;
    - `requires an end date before confirming`;
    - `prefills a renewal from the renewed contract except its dates`, with the heading "Importar renovação";
    - `names the screen for screen readers`: one `h1` with the heading, and the error summary in a live region, as the wizard does.
  - `EnvelopeView.spec.ts`:
    - `opens the import form for the owner's import in progress`;
    - `opens the detail page for an imported envelope`.

- [ ] **Step 2:** Run `npx vitest run src/import src/envelope src/wizard`. Expected: FAIL.

- [ ] **Step 3: Implement**
  - **`EnvelopeView`:** `importing` with `permissions.edit` renders `ImportView` (async component, like `WizardView`), in the `navigation` layout.
  - **`ImportView` layout:** one column with:
    - the heading;
    - the file name, as a link through `importDocumentUrl`;
    - "Título" (`AvTextField`, max `appConfig().limits.maxTitleLength`);
    - `EnvelopeFolderField`;
    - `ContractFields` (`offersTermModes: false`);
    - then "Cancelar" and "Importar contrato".
  - **Phones:** the buttons sit in a bottom bar, as `WizardBottomBar`.
  - **AI suggestions:** applied once per reading, the same way `ContractStep` does (`suggestedForm`, `applySuggestion` and `suggestedFields`). Extract the shared piece from `ContractStep` into `src/contracts/contract-suggestion.ts` instead of copying it.
  - **Mutations:** `useDialogMutation` patterns. A confirm success replaces the envelope cache with the returned detail; the page re-renders as the detail page.

- [ ] **Step 4:** Run the Step 2 command, then `npx vue-tsc --noEmit && npx eslint src`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(imports): import form with AI suggestions`.

---

### Task 7: The imported envelope page

**Files:**
- Create: `src/detail/ImportedLine.vue`, `src/detail/ImportDeleteDialog.vue`
- Modify: `src/detail/DetailView.vue`, `src/detail/ContractCard.vue`, `src/detail/DocumentsCard.vue`
- Test: `src/detail/DetailView.spec.ts`, `src/detail/ContractCard.spec.ts`

**Interfaces:**
- Consumes (Task 5): `deleteImport`, `importDocumentUrl`, `startNewImport`; `permissions.deleteImport`, `importedAt`, `fileAvailable`.

- [ ] **Step 1: Write the failing tests**
  - `DetailView.spec.ts`:
    - `shows that an imported envelope was signed elsewhere`: "Assinado fora do AvuzConecta · importado por Ana Souza em 29/10/2026";
    - `shows no signers, progress, timeline or reminders for an imported envelope`;
    - `shows "Arquivo indisponível" when the imported file is gone`;
    - `offers "Excluir importação" only with permissions.deleteImport`;
    - `deletes the import after confirming and goes back to the list`;
    - `shows "Exclua a renovação primeiro." when a renewal continues it`.
  - `ContractCard.spec.ts`:
    - `offers "Importar renovação" on an imported contract only`;
    - `starts a renewal import for the contract`: calls `startNewImport(router, envelope.folderId, contract.id)`;
    - `keeps "Renovar" next to "Importar renovação"`;
    - `hides "Importar renovação" on an ended or renewed contract`.

- [ ] **Step 2:** Run `npx vitest run src/detail`. Expected: FAIL.

- [ ] **Step 3: Implement**
  - **`DetailView`:** for `status === 'imported'`, render `DetailHeader`, `ImportedLine`, `DocumentsCard` and `ContractCard` only, on desktop and phone. No `SignersCard`, `ProgressCard`, `TimelineCard` or `EnvelopeBanners`, and no aside column.
  - **`DocumentsCard`:**
    - for imported documents, a link "Abrir" to `importDocumentUrl`;
    - "Arquivo indisponível" (muted text, no link) when `fileAvailable` is false.
  - **`ImportDeleteDialog`:** follows `DeleteDialog`, with the Global Constraints copy.
  - **`ContractCard`:** the "Importar renovação" button sits beside "Renovar". Its condition is `envelope.status === 'imported' && envelope.canActOnContracts && contract changeable`.
  - **Date format:** "importado em" uses `formatCalendarDate` on the instance-local day of `importedAt`.

- [ ] **Step 4:** Run `npx vitest run` (the full suite), then `npx vue-tsc --noEmit && npx eslint src`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(imports): imported envelope page and renewal import`.

---

### Task 8: Release 0.11.0 and pin

**Files:**
- Modify (assinaturas): `appinfo/info.xml` (version `0.11.0`), `README.md` (one line on imports), `l10n/*`, built `js/` and `dist/`.
- Modify (avuz-server worktree):
  - `apps/assinaturas` submodule pointer;
  - `CLAUDE.md`: one sentence on imports in the Assinaturas contracts bullet;
  - this plan: tick boxes.

- [ ] **Step 1:** `node scripts/add-translations.mjs` with every new string. Then `npx vitest run src/l10n.spec.ts`. Expected: PASS (no untranslated source string).
- [ ] **Step 2:** `npm run build`. Expected: exit 0, and `js/` changed.
- [ ] **Step 3:** The full PHP suite (`tests/env/phpunit.sh`, background) and `npx vitest run`. Expected: both green.
- [ ] **Step 4:** Commit `chore: release 0.11.0`. Merge `contract-import` into `main` with `--no-ff`, then push `main`. This is Patrick's go.
- [ ] **Step 5:** In avuz-server, `git -C apps/assinaturas fetch && git -C apps/assinaturas checkout <0.11.0 sha>`. Commit `chore: pin Assinaturas 0.11.0 (contract import, "Não possui" badge)`, with the CLAUDE.md line.

Deploying to conecta-2 (`:staging-2`) is a separate step after this plan, using the usual recipe.
