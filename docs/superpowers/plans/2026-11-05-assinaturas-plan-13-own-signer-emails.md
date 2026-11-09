# Assinaturas Plan 13: Signer Emails Sent by Avuz Conecta

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Create documents with `disable_signer_emails: true` and send the invite, next-group invite, reminder, signed copy and closing notice from Avuz Conecta, so release 0.12.0 reaches every signer with the sender's message.

**Architecture:** A new `lib/Mail/` holds everything about mail. `SignerMailer` renders and sends, `SignerInvites` decides who is due and guards against double sends, `ClosingMail` handles the two emails after an envelope closes. `SendJob` and `SyncEnvelopeJob` drive them, so the dedicated worker doesn't change. The envelope never fails because of mail.

**Tech Stack:** PHP 8, AvuzConecta 33 (`OCP\Mail\IMailer`, `IEMailTemplate`), Vue 3.5/TS, PHPUnit integration tests on Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-05-assinaturas-own-signer-emails-design.md` (avuz-server). Spike results: `docs/zapsign/sandbox-findings.md`, *Own-email spikes*.

**Repos:** tasks 1 to 7 run in `~/work/avuz/assinaturas`, branch `own-signer-emails` off `main`. Task 8 ends in the avuz-server worktree.

## Global Constraints

- From is always display name `Avuz Conecta`, address `OCP\Util::getDefaultEmailAddress('naoresponder')`. The sender's name never goes in the From.
- Reply-To is the owner's account email, omitted when they have none. The owner is the sender in every email, also when a manager presses "Reenviar".
- Email copy is hardcoded pt_BR, as `SignerMessage` already is. Signers are external and have no language setting.
- Never store or log a `sign_url` or a rendered email. Mark such parameters `#[\SensitiveParameter]`. Logs carry the envelope uuid and signer id, never an address or link.
- Never name ZapSign or AI providers in an email, in UI copy or in the owner notification.
- A mail failure never fails an envelope. No `markFailed` on mail.
- Timestamps are epoch seconds. Windows: claim stale after 600 s, retry mail every 900 s, reminder window 1800 s, closing mail gives up after 604800 s (7 days).
- UI copy has English source text with a pt_BR entry in `l10n/pt_BR.json`. Each task adds its own strings.
- Test rules: third-person test names without "should", behavior over implementation.
- Every send counts `mail_sent_<kind>` or `mail_failed_<kind>` through `Counters` (kinds: `invite`, `reminder`, `copy`, `notice`), and every failure calls `MailHealth::recordFailure`.
- Commit messages carry no AI attribution.
- Local tests: check `docker image inspect avuzconecta:latest --format '{{.Id}}'` equals `~/.assinaturas-test-image-id` before `tests/env/phpunit.sh`. If they differ, stop and ask Patrick. Never run `tests/env/reset.sh`.
- No manual or browser tests. Grok bot tests afterward. Production moves only on Patrick's word.

## Review Focus

- An owner with no email, or a deleted owner: Reply-To is left out, the name falls back to the uid, and the email still goes out.
- Title, message or signer name carrying HTML or line breaks: the email escapes it, and the subject can't inject a header.
- A group of two with one signature: the next group waits for both.
- A cancel requested while an invite is due, or an expired envelope: nobody is invited. Extending the deadline resumes invites.
- An address corrected while its invite is failing: the retry goes to the new address.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/Mail/SignerMailer.php` | Renders and sends the four kinds of email. Only class touching `IMailer` |
| `lib/Mail/SignerMailFailed.php` | Exception for a refused or failed send |
| `lib/Mail/SignUrls.php` | Fetches sign URLs fresh from `getDocument` |
| `lib/Mail/MailHealth.php` | Is SMTP set up; when did mail last fail |
| `lib/Mail/SignerInvites.php` | Who is due, atomic claim, failure bookkeeping |
| `lib/Mail/ClosingMail.php` | Signed copy and closing notice after an envelope closes |
| `lib/Mail/ClosingMailKind.php` | Enum: `SignedCopy` (`copy_sent_at`), `Notice` (`closing_notice_sent_at`) |
| `lib/Migration/Version001200Date20261105000000.php` | New columns |
| `tests/Fakes/RecordingMailer.php` | `IMailer` fake: records messages, can fail |

---

### Task 1: Mail foundation

**Files:**
- Create: `lib/Migration/Version001200Date20261105000000.php`, all of `lib/Mail/` except `SignerInvites.php` and `ClosingMail.php`, `tests/Fakes/RecordingMailer.php`, `tests/Integration/Mail/SignerMailerTest.php`, `tests/Integration/Mail/MailHealthTest.php`, `tests/Integration/Db/SignerClaimsTest.php`
- Modify: `lib/Db/Signer.php`, `lib/Db/Envelope.php`, `lib/Db/SignerMapper.php`, `lib/Db/EnvelopeMapper.php`, `lib/Send/SignerMessage.php`, `appinfo/info.xml`

**Interfaces:**
- Produces:
  - `SignerMailer::invite(Envelope, Signer, #[\SensitiveParameter] string $signUrl): void`, and `reminder` and `signedCopy` with the same parameters
  - `SignerMailer::closingNotice(Envelope, Signer, EnvelopeStatus $closedAs): void`
  - All four throw `SignerMailFailed`
  - `SignUrls::byZapsignToken(Envelope): array<string, string>`, throws `ZapSignException`
  - `MailHealth::isConfigured(): bool`, `recordFailure(int $at): void`, `lastFailureAt(): ?int`
  - `SignerMapper::claimInvite(int $signerId, int $now, int $staleBefore): bool`
  - `SignerMapper::claimClosingMail(int $signerId, ClosingMailKind, int $now): bool`, `releaseClosingMail(int $signerId, ClosingMailKind): void`
  - `EnvelopeMapper::scheduleClosingMail(int $envelopeId, int $until, int $now): void`, `finishClosingMail(int $envelopeId, ?int $nextSyncAt): void`
  - `SignerMessage::introduction(Envelope): string`

- [x] **Step 1: Write the failing tests**

`SignerMailerTest`, using `RecordingMailer`:

```php
public function testInviteComesFromAvuzWithTheSenderInSubjectAndReplyTo(): void;
// From name 'Avuz Conecta'; address from getDefaultEmailAddress
// Subject '{sender} enviou documentos para sua assinatura: {title}'; Reply-To = owner email
public function testInviteCarriesTheMessageFilesDeadlineAndButton(): void;
// HTML and plain parts hold the message, both file names, the deadline, 'Revisar e assinar', the URL,
// and 'Pode ser solicitado um código de verificação, enviado para este e-mail.'
public function testInviteOmitsReplyToWhenTheOwnerHasNoEmail(): void;
public function testInviteFallsBackToTheUidWhenTheOwnerIsGone(): void;
public function testInviteEscapesHtmlInTitleMessageAndName(): void;
public function testSubjectCannotInjectAHeader(): void;              // title with \r\nBcc: x
public function testReminderUsesItsOwnSubject(): void;               // 'Lembrete: {title} aguarda sua assinatura'
public function testSignedCopyLinksTheDownload(): void;              // 'Documentos assinados: {title}', 'Baixar documentos assinados'
public function testClosingNoticeForACancelCarriesTheReason(): void; // '{title} foi cancelado'
public function testClosingNoticeForARefusalNamesNoReason(): void;   // '{title} foi recusado'
public function testNoEmailNamesTheProvider(): void;                 // no 'zapsign', case-insensitive, in any rendered part
public function testAFailedRecipientThrows(): void;                  // send() returns the address → SignerMailFailed
public function testATransportErrorThrowsWithoutItsMessage(): void;  // no address or link in SignerMailFailed::getMessage()
```

`SignerClaimsTest`:

```php
public function testClaimInviteWinsOnce(): void;
public function testClaimInviteRetakesAStaleClaim(): void;
public function testClaimInviteTakesAFailedSignerAlreadyReleased(): void;
public function testClaimInviteRefusesASignerAlreadyInvited(): void;
public function testClaimClosingMailWinsOnceAndReleaseAllowsARetry(): void;
```

`MailHealthTest`: `testIsNotConfiguredWithoutASmtpHost`, `testLastFailureRoundTrips`.

- [x] **Step 2: Run them to verify they fail**

Run: `tests/env/phpunit.sh --filter 'SignerMailerTest|SignerClaimsTest|MailHealthTest'`
Expected: FAIL, classes not found.

- [x] **Step 3: Implement**

- Migration, nullable BIGINT: `invite_attempted_at`, `invite_failed_at`, `copy_sent_at`, `closing_notice_sent_at` on `assinaturas_signers`; `closing_mail_until` on `assinaturas_envelopes`. Guard with `hasColumn`, as `Version001100Date20261029000000` does.
- Entities gain the matching fields in `FIELD_TYPES`.
- `info.xml` to `0.11.1` so the migration runs. Upgrade the test DB with the recipe in `assinaturas-phpunit-auto-reset` memory; never `reset.sh`.
- `claimInvite`: one atomic `UPDATE` setting `invite_attempted_at = now` where `id` matches, `(released_at IS NULL OR invite_failed_at IS NOT NULL)` and `(invite_attempted_at IS NULL OR invite_attempted_at < staleBefore)`. Returns whether a row changed.
- `claimClosingMail`: atomic `UPDATE` where the kind's column is null. `releaseClosingMail` sets it back to null.
- `findDueForSync`: also return `cancelled` and `refused` envelopes with `closing_mail_until` set.
- Templates: `IMailer::createEMailTemplate('assinaturas.<kind>', [])`, then `addHeader`, `addHeading`, `addBodyText`, `addBodyButton`, `addFooter`. Message `setAutoSubmitted(AutoSubmitted::VALUE_AUTO_GENERATED)`.
- Deadline: `DeadlineCalculator::day()`, shown as `d/m/Y`, so it matches the detail page.
- File names: `basename($document->getSourcePath())`, from `DocumentMapper::findByEnvelope`.
- `SignerMessage::introduction` is today's first sentence. `compose` stays until Task 4. Update the class comment.
- `MailHealth`: `mail_smtphost` from system config, `last_mail_failure_at` in app config.

Exact copy not in the tests:

| Email | Heading | Body |
|---|---|---|
| Invite | `Documentos para sua assinatura` | `SignerMessage::introduction`, then the message |
| Reminder | `Sua assinatura está pendente` | `{sender} aguarda sua assinatura em "{title}".`, then the message |
| Signed copy | `Documentos assinados` | `Todas as assinaturas de "{title}" foram concluídas.` |
| Cancelled | `Assinatura cancelada` | `{sender} cancelou "{title}". O documento não seguirá para assinatura.`, then `Motivo: {reason}` |
| Refused | `Assinatura recusada` | `"{title}" foi recusado por um dos signatários. O documento não seguirá para assinatura.` |

- [x] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'SignerMailerTest|SignerClaimsTest|MailHealthTest'`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add lib/Mail lib/Migration lib/Db lib/Send/SignerMessage.php appinfo/info.xml tests
git commit -m "feat(mail): render signer emails and add the mail bookkeeping"
```

### Task 2: Invites at Send

**Files:**
- Create: `lib/Mail/SignerInvites.php`, `tests/Integration/Mail/SignerInvitesTest.php`
- Modify: `lib/Send/EnvelopeSender.php`, `lib/Send/EnvelopeCreation.php`, `lib/ZapSign/Payload/NewDocument.php`, `lib/ZapSign/Payload/NewSigner.php`, `lib/Notification/SenderNotificationListener.php`, `lib/Notification/Notifier.php`, `l10n/pt_BR.json`, `tests/Integration/Send/EnvelopeSenderTest.php`, `tests/Integration/Send/EnvelopeCreationTest.php`

**Interfaces:**
- Consumes: Task 1's classes.
- Produces:
  - `SignerInvites::inviteDue(Envelope): ?int`: invites everyone due, returns when to retry (`now + 900`) or null
  - `SignerInvites::resend(Envelope, Signer): void`: invites one signer now, ignoring turn checks already made by the caller. Throws `SignerMailFailed` or `ZapSignException` after recording the failure
  - Events `invite_sent`, `invite_failed`

- [x] **Step 1: Write the failing tests**

`SignerInvitesTest`:

```php
public function testInvitesTheFirstGroupOnly(): void;
public function testInvitesEverySignerWithoutSigningOrder(): void;
public function testWaitsForTheWholeGroupBeforeTheNext(): void;
public function testInvitesTheNextGroupOnceTheGroupFinished(): void;
public function testInvitesNobodyWhileACancelIsRequested(): void;
public function testInvitesNobodyOnAnExpiredEnvelope(): void;
public function testResumesOnceTheDeadlineIsExtended(): void;
public function testTwoRunsSendOneInvite(): void;
public function testRetakesAClaimLeftByACrash(): void;
public function testAFailureMarksTheSignerAndAsksForARetry(): void;
// inviteFailedAt set, released_at null, returns now + 900, one invite_failed event
public function testARepeatedFailureRecordsOneEvent(): void;
public function testARetrySucceedsAndClearsTheFailure(): void;
public function testAProviderFailureCountsAsAFailedAttempt(): void;  // getDocument down: nothing thrown, signers marked failed
public function testNoLogEntryCarriesTheLink(): void;
```

`EnvelopeSenderTest` additions:

```php
public function testSendEndsPendingWhenMailFails(): void;      // status pending, error null, signer inviteFailedAt set
public function testSendRefusesWithoutMailSetUp(): void;       // DraftRejected code 'mail_not_configured', 409, nothing at ZapSign
public function testCreateAsksZapSignForNoSignerEmails(): void; // payload disable_signer_emails true
```

Add to `EnvelopeCreationTest`: the signer payload has neither `custom_message` nor `send_automatic_email`.

- [x] **Step 2: Run them to verify they fail**

Run: `tests/env/phpunit.sh --filter 'SignerInvitesTest|EnvelopeSenderTest|EnvelopeCreationTest'`
Expected: FAIL.

- [x] **Step 3: Implement**

- `inviteDue`: return null unless the status is `sending` or `pending` and `cancelRequestedAt` is null. Due = `SigningTurn::isOpen`, has a ZapSign token, `emailBouncedAt` null, in the current group when signing order is on, and (`releasedAt` null or `inviteFailedAt` set). Claim each due signer, fetch `SignUrls` once only when one was claimed, send.
- On success: `released_at` keeps its first value or takes now, `invite_failed_at` null, `invite_attempted_at` null, event `invite_sent`.
- On `SignerMailFailed` or `ZapSignException`: `invite_attempted_at` null, `invite_failed_at` set only if it was null, event `invite_failed` only then.
- `EnvelopeSender`: replace `releaseFirstGroup` and `releaseOrAcceptCooldown` with a lease renewal then `inviteDue`. `SendStep::Released` now means invites attempted. `claim` checks `MailHealth::isConfigured` right after the status check, and throws `DraftRejected('mail_not_configured', …, Http::STATUS_CONFLICT)`.
- `NewDocument::toPayload`: add `'disable_signer_emails' => true`.
- `NewSigner`: drop `$message`, `custom_message` and `send_automatic_email`. `EnvelopeCreation` stops composing a message.
- Listener: add `invite_failed` to `SIGNER_SUBJECTS`. Notifier subject: `'The invitation to %2$s for "%1$s" could not be sent.'`, pt_BR `O convite para %2$s de "%1$s" não pôde ser enviado.`

- [x] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'SignerInvitesTest|EnvelopeSenderTest|EnvelopeCreationTest'`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add lib tests l10n
git commit -m "feat(send): invite the first group from Avuz Conecta"
```

### Task 3: Next group and retries in the sync

**Files:**
- Modify: `lib/Sync/EnvelopeSynchronizer.php`, `tests/Integration/Sync/EnvelopeSynchronizerTest.php`, `tests/Integration/Sync/EnvelopeLifecycleTest.php`

**Interfaces:**
- Consumes: `SignerInvites::inviteDue`.

- [x] **Step 1: Write the failing tests**

```php
public function testInvitesTheNextGroupWhenTheSyncSeesTheGroupFinished(): void;
public function testComesBackWithinFifteenMinutesWhileAnInviteFails(): void;  // next_sync_at <= now + 900
public function testRecoveryInvitesOnceAndReturnsToTheNormalSchedule(): void;
public function testADocumentNoLongerPendingInvitesNobody(): void;
```

- [x] **Step 2: Run them to verify they fail**

Run: `tests/env/phpunit.sh --filter 'EnvelopeSynchronizerTest|EnvelopeLifecycleTest'`
Expected: FAIL.

- [x] **Step 3: Implement**

In `reschedule`, while `$providerPending`, call `inviteDue` before the reminders, on a fresh row. `next_sync_at` is the earliest of the normal schedule, the next reminder and the invite retry.

- [x] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'EnvelopeSynchronizerTest|EnvelopeLifecycleTest'`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add lib/Sync tests/Integration/Sync
git commit -m "feat(sync): invite the next group and retry failed invites"
```

### Task 4: Reminders and corrections

**Files:**
- Modify: `lib/Action/SignerReminders.php`, `lib/Action/SignerCorrections.php`, `lib/Action/CorrectionResult.php`, `lib/Controller/EnvelopeActionController.php`, `lib/ZapSign/ZapSignClient.php`, `lib/Send/SignerMessage.php`, `tests/spike/run.php`, `tests/e2e/lifecycle.php`, `tests/Integration/Action/SignerRemindersTest.php`, `tests/Integration/Action/SignerCorrectionsTest.php`, plus any test still calling `releaseSigner`

**Interfaces:**
- Consumes: `SignerMailer::reminder`, `SignerInvites::resend`, `SignUrls`.
- Produces:
  - `CorrectionResult(bool $invited, bool $mailFailed)`
  - `PUT …/email` answers `invited`, and `"inviteError": "mail_failed"` when the mail failed
  - `POST …/remind` answers 502 `mail_failed`
  - `SignerReminders::cooldownEndsAt` returns null while `inviteFailedAt` is set

- [x] **Step 1: Write the failing tests**

`SignerRemindersTest`:

```php
public function testAReminderMailsTheSignerFromAvuz(): void;
public function testAManagerRemindingStillShowsTheOwnerAsSender(): void;
public function testAFailedReminderAnswersMailFailedAndStartsNoWindow(): void;
public function testAFailedAutomaticReminderRetriesInAnHour(): void;
public function testRemindingAFailedSignerSendsTheInviteAtOnce(): void;  // no cooldown, clears inviteFailedAt
public function testTheWindowHoldsAfterASuccessfulReminder(): void;      // reminder_cooldown, 1800 s
```

`SignerCorrectionsTest`:

```php
public function testACorrectedAddressIsInvitedAtOnceInsideTheWindow(): void;  // invited true, inside 1800 s
public function testAFailedInviteKeepsTheCorrectionAndReportsIt(): void;      // invited false, mailFailed true
public function testALaterGroupIsNotInvited(): void;                          // invited false, no email
public function testTheRetryGoesToTheCorrectedAddress(): void;                // correction during a failure, then inviteDue
```

- [x] **Step 2: Run them to verify they fail**

Run: `tests/env/phpunit.sh --filter 'SignerRemindersTest|SignerCorrectionsTest'`
Expected: FAIL.

- [x] **Step 3: Implement**

- `remind`: a signer with `releasedAt` null or `inviteFailedAt` set goes through `SignerInvites::resend`. Anyone else gets `SignerMailer::reminder` with a fresh URL. `SignerMailFailed` becomes `ActionRejected('mail_failed', …, 502)`, recording no reminder.
- `sendAutomatic`: on `SignerMailFailed` or `ZapSignException`, log a warning with the uuid and return `now + 3600`. Don't mark the signer reminded.
- Remove `previousGroupFinishedAt`, the `ZapSign*` catches and the comments about ZapSign's window. `COOLDOWN_SECONDS` stays, as our rule.
- `SignerCorrections`: `updateSignerEmail` stays, because the code goes to that address. If the signer is remindable, `resend` and set `lastReminderAt`. No window check. Drop `RELEASE_AFTER_EMAIL_UPDATE`.
- Remove `ZapSignClient::releaseSigner`, `SignerMessage::compose` and the `release` command in `tests/spike/run.php`. Update `tests/e2e/lifecycle.php` for the new flow.

- [x] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'SignerRemindersTest|SignerCorrectionsTest|ZapSignClient'`
Expected: PASS. `grep -rn releaseSigner lib tests` finds nothing.

- [x] **Step 5: Commit**

```bash
git add lib tests
git commit -m "feat(actions): remind and correct through our own email"
```

### Task 5: Signed copy and closing notice

**Files:**
- Create: `lib/Mail/ClosingMail.php`, `tests/Integration/Mail/ClosingMailTest.php`
- Modify: `lib/Sync/EnvelopeSynchronizer.php`, `lib/Sync/EnvelopeCompletion.php`, `lib/Action/EnvelopeCancellation.php`, `lib/Action/EnvelopeRemoval.php`, `tests/Integration/Action/EnvelopeCancellationTest.php`, `tests/Integration/Action/EnvelopeRemovalTest.php`, `tests/Integration/Sync/EnvelopeCompletionTest.php`

**Interfaces:**
- Consumes: `SignerMailer`, `SignUrls`, Task 1's mapper methods.
- Produces:
  - `ClosingMail::schedule(Envelope): void`: sets `closing_mail_until` to now + 604800, `next_sync_at` to now, and queues `SyncEnvelopeJob`
  - `ClosingMail::isDue(Envelope): bool`
  - `ClosingMail::send(Envelope): void`
  - `ClosingMail::sendBeforeRemoval(Envelope): void`: one best-effort pass, no retry
  - Event `signed_copy_sent`

- [x] **Step 1: Write the failing tests**

`ClosingMailTest`:

```php
public function testACompletedEnvelopeSendsEverySignerOneCopy(): void;
public function testACopyGoesOutEvenWhenSavingToDriveFailed(): void;
public function testACancelTellsOnlyTheSignersWhoWereInvited(): void;   // later group gets nothing
public function testACancelNoticeCarriesTheReason(): void;
public function testARefusalSkipsTheRefusingSigner(): void;
public function testTwoRunsSendOneEmail(): void;
public function testAFailureRetriesInFifteenMinutes(): void;
public function testGivesUpAfterSevenDaysAndLogsIt(): void;
public function testFinishingStopsTheSyncOfAClosedEnvelope(): void;     // next_sync_at null, closing_mail_until null
public function testFinishingLetsACompletedEnvelopeSyncOnceMore(): void; // unsaved files still retry
```

Add to `EnvelopeCancellationTest`: `testCancelAsksZapSignNotToNotify` (`notify_signer` false), `testCancelAnswersWithoutWaitingForMail` (no message sent inside `cancel`). Add to `EnvelopeRemovalTest`: `testRemovingALiveEnvelopeTellsInvitedSigners`, `testAMailFailureDoesNotBlockTheRemoval`. Add to `EnvelopeCompletionTest`: `testOnlyTheFirstCompletionSchedulesMail`.

- [x] **Step 2: Run them to verify they fail**

Run: `tests/env/phpunit.sh --filter 'ClosingMailTest|EnvelopeCancellationTest|EnvelopeRemovalTest|EnvelopeCompletionTest'`
Expected: FAIL.

- [x] **Step 3: Implement**

- `synchronize`: before the in-flight check, `if ($this->closingMail->isDue($envelope)) { $this->closingMail->send($envelope); return; }`. Closing mail takes the whole sync turn.
- `send`: each signer is claimed before sending and released on failure. Copy goes to all signers. Notice goes to signers with `releasedAt` set whose status isn't `refused`. Past `closing_mail_until`, log and finish.
- Finish: `finishClosingMail` with `next_sync_at` = now for a completed envelope, so a normal sync settles unsaved files, and null otherwise. With failures left, `next_sync_at` = now + 900.
- Schedule on the first completion only (after `release`), at the end of `close()`, and after a successful transition in `EnvelopeCancellation::cancel`. A discarded envelope failed before any invite, so it needs nothing.
- `EnvelopeCancellation` and `EnvelopeRemoval`: `notify_signer` is always false.
- `EnvelopeRemoval`: `sendBeforeRemoval` runs before the rows go, only for a live envelope. Failures are logged and ignored. **Ruling:** a deleted envelope can't retry, because its rows are gone, so this one case sends once. Spec says retry; it costs a lost notice on a rare admin action.

- [x] **Step 4: Run the tests to verify they pass**

Run: `tests/env/phpunit.sh --filter 'ClosingMailTest|EnvelopeCancellationTest|EnvelopeRemovalTest|EnvelopeCompletionTest|EnvelopeSynchronizerTest'`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add lib tests
git commit -m "feat(mail): send the signed copy and the closing notice"
```

### Task 6: Screens

**Files:**
- Modify: `src/api/types.ts`, `src/api/error-messages.ts`, `src/presentation/signer-state.ts`, `src/presentation/cooldown.ts`, `src/presentation/timeline.ts`, `src/detail/CorrectEmailDialog.vue`, `src/detail/SignersCard.vue`, `src/detail/use-signer-cooldowns.ts`, `src/test-support/envelope-fixtures.ts`, `lib/Api/EnvelopeView.php`, `l10n/pt_BR.json`, and their specs
- Test: `tests/Integration/Api/` envelope view test

**Interfaces:**
- Consumes: signer `inviteFailedAt`, `inviteError`, codes `mail_failed`, `mail_not_configured`, events from Tasks 2 and 5.

- [x] **Step 1: Write the failing tests**

```ts
it('shows a signer whose invite failed as not sent', ...)        // label 'Invitation not sent', tone 'warning'
it('keeps the waiting label for a later group', ...)
it('has no cooldown while the invite failed', ...)               // cooldownEndsAt null
it('offers Reenviar on a failed signer', ...)                    // isRemindable true, card shows the action
it('tells the owner when the correction was saved but not sent', ...)
it('names invite_sent, invite_failed and signed_copy_sent in the timeline', ...)
it('explains mail_not_configured and mail_failed', ...)
```

Add a PHP test: `EnvelopeView` returns `inviteFailedAt`.

- [x] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/presentation src/detail src/api`
Expected: FAIL.

- [x] **Step 3: Implement**

- `signerStateView`: after the waiting-group check, an open signer with `inviteFailedAt` shows `Invitation not sent`, pt_BR `Convite não enviado`, tone `warning`.
- `cooldownEndsAt`: null when `inviteFailedAt` is set.
- Remove `inviteAvailableInSeconds`, the `inviteHeld` emit and `onInviteHeld`. `EmailCorrection` gains `inviteError?: 'mail_failed'`.
- Toast on `inviteError`: `The address was saved, but the invitation could not be sent.`, pt_BR `O endereço foi salvo, mas o convite não pôde ser enviado.`
- Fix the comment in `use-signer-cooldowns.ts`: the window is ours.

| Source text | pt_BR |
|---|---|
| `Email is not set up on this instance. Contact the support team.` | `O e-mail não está configurado nesta instância. Fale com o suporte.` |
| `The email could not be sent. Try again in a few minutes.` | `O e-mail não pôde ser enviado. Tente novamente em alguns minutos.` |
| `Invitation sent to {signer}` | `Convite enviado para {signer}` |
| `Invitation to {signer} not sent` | `Convite para {signer} não enviado` |
| `Signed copy sent to {signer}` | `Cópia assinada enviada para {signer}` |

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run && npm run lint && npm run build`
Expected: PASS, build writes `js/`.

- [x] **Step 5: Commit**

```bash
git add src lib l10n js dist tests
git commit -m "feat(ui): show failed invites and drop the correction countdown"
```

### Task 7: Admin health and docs

**Files:**
- Modify: `lib/Controller/AdminController.php`, `src/admin/AdminSettings.vue`, `src/api/types.ts`, `l10n/pt_BR.json`, `docs/api.md`, `tests/Integration/Controller/` admin test, `src/admin/AdminSettings.spec.ts`

**Interfaces:**
- Consumes: `MailHealth`.
- Produces: `status` gains `"mail": {"configured": bool, "lastFailureAt": int|null}`.

- [x] **Step 1: Write the failing tests**

```php
public function testStatusReportsMailSetupAndLastFailure(): void;
```

```ts
it('warns when email is not set up', ...)
it('shows when email last failed', ...)
```

- [x] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/admin && tests/env/phpunit.sh --filter AdminController`
Expected: FAIL.

- [x] **Step 3: Implement**

Add the field and a line in the health card: `Email to signers`, `Set up` or `Not set up`, and `Last failure` with `NcDateTime`. pt_BR: `E-mail aos signatários`, `Configurado`, `Não configurado`, `Última falha`.

Update `docs/api.md`: the `remind` and `email` rows, the cooldown and correction passages, cancel and delete (no ZapSign notice, our notice to invited signers only), `inviteFailedAt`, the new codes, the new events, a short *Signer emails* section with the retry rules, and `emailBouncedAt` (now only from ZapSign's code email).

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/admin && tests/env/phpunit.sh --filter AdminController`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add lib src l10n docs tests js dist
git commit -m "feat(admin): report email health; document signer emails"
```

### Task 8: Release and pin

**Files:**
- Modify: `appinfo/info.xml`. In avuz-server: `apps/assinaturas`, `docs/assinaturas-tenant-runbook.md`, `CLAUDE.md`, this plan

- [x] **Step 1: Ask Patrick to reopen document A's links**

The links are in the scratchpad file from the spike. If the page no longer offers the signed document, stop: the spec says attach the PDFs instead.

- [x] **Step 2: Run everything**

Run in the background: `tests/env/phpunit.sh --testdox`, then `npx vitest run`, `npm run lint`, `npm run build`.
Expected: all green, and no `sign_url` in any log call.

- [x] **Step 3: Bump to 0.12.0 and commit**

```bash
git add appinfo/info.xml js dist
git commit -m "chore: release 0.12.0"
```

- [x] **Step 4: Merge into `main` and push, once Patrick says so**

- [x] **Step 5: Pin in avuz-server**

- On a branch off `avuz-customization`, point `apps/assinaturas` at the merged commit.
- Runbook step 2: drop "Set the sender text and Reply-To". Add: the instance default sender is verified in the mail provider, and check which address owns the sub-account, because that address keeps getting ZapSign's owner notices.
- `CLAUDE.md`, Assinaturas section: signer emails come from Avuz Conecta (`lib/Mail/`), ZapSign sends only the verification code, documents go out with `disable_signer_emails`, and Send needs SMTP.
- Tick this plan's boxes.

```bash
git add apps/assinaturas docs CLAUDE.md
git commit -m "chore: pin Assinaturas 0.12.0 (signer emails sent by Avuz Conecta)"
```

- [x] **Step 6: Deploy to conecta-2 once Patrick says so, then hand over**

Sandbox run: two groups, invite, reminder, correction, cancel, refusal, completion, one with SMTP broken. Confirm the next group's invite arrives within seconds of the webhook; if it only comes with the poller, stop and report. Grok bot checks signer rows and notifications. Patrick checks real inboxes, spam included, on Gmail and Outlook.
