# Assinaturas: signer emails sent by Avuz Conecta

**Status:** approved by Patrick, 2026-11-05. Spikes pending.
**Target:** Assinaturas 0.12.0, before the Plan 5 pilot.
**Source:** ZapSign's answers in `docs/zapsign/sandbox-findings.md` (last section).

## Why

Today ZapSign sends every signer email. That gives us four problems we can't fix inside ZapSign, as they confirmed on 2026-11-05:

- The sender's message never reaches the first group. `custom_message` works only at creation, and we create before placing fields.
- The email names the account owner, not the person who sent the envelope. A client has many senders.
- Reply-To goes to the account owner, so signers' replies miss the sender.
- "via ZapSign" and the "O que é a ZapSign?" footer stay, and the logo can't be centered.

Creating documents with `disable_signer_emails: true` and mailing the `sign_url` ourselves fixes all four.

## Goals

- Avuz Conecta sends the invite, the next group's invite, reminders, the signed copy and the closing notice.
- Each email comes from Avuz and shows who is asking: the sender's name and company in the subject and body, and a Reply-To that reaches them.
- The sender's message reaches every signer in every group.
- A mail failure is visible to the sender and heals itself once mail is back.

## Non-goals

- Bounce detection for our own mail. SMTP acceptance is the only signal in this version.
- WhatsApp or SMS delivery.
- Per-tenant mail templates, or a template editor.
- A redirect on our domain in front of `sign_url`.
- Reminder or expiry notices beyond what exists today.
- Removing ZapSign from the signing page. It stays, and so does the "Acessar documentos assinados" button.

## Anti-goals

- Never store or log a `sign_url`, or a rendered email that contains one.
- Never name ZapSign in our emails. The white-label guard test covers them.
- Never turn a mail failure into a failed envelope. The document already exists at ZapSign and is billed.
- Never send a signer a second invite because two jobs raced.

## Decided by Patrick

- Build this before Plan 5.
- Emails always come from Avuz, whichever tenant or user sends them.
- The message field stays where it is and goes into our invite, to every group. No interim label.
- Typed signatures keep ZapSign's mandatory code. That code email stays ZapSign-branded, and we can't change it.

## Known limits we accept

- ZapSign's verification code still comes from ZapSign.
- Every email now spends ZeptoMail credits, and all tenants share one account. The 10/10 to 14/10 outage would now stop invites as well as other mail.
- We can't tell delivered from accepted. `viewedAt` is the real proof that a signer got the link.

## Behavior

### Which emails go out

| Email | When | To |
|---|---|---|
| Invite | The Send finishes (first group), or a group's turn arrives | Signers whose turn it is. Without signing order, all signers |
| Reminder | Manual "Reenviar" or automatic reminder | One remindable signer |
| Corrected address | The owner corrects an email and it is the signer's turn | That signer |
| Signed copy | The envelope completes | All signers |
| Closing notice | The envelope is cancelled, refused, or deleted while live | Signers who were invited and haven't refused |

A signer of a later group who was never invited gets no closing notice. Today ZapSign emails them about a document they never saw.

Imported envelopes never reach any of this: they have no signers.

### What the invite looks like

Built with the instance's mail template (`IEMailTemplate`), so tenant theming applies. Copy is pt_BR, like the rest of the app, and always includes a plain-text part.

- **From:** always Avuz. Display name `Avuz Conecta`, address = the instance's default sender (`naoresponder@avuz.app` on conecta-2 and app3). The sender's name never goes in the From.
- **Reply-To:** the owner's account email. Omitted when they have none.
- **Subject:** `{sender} enviou documentos para sua assinatura: {title}`
- **Body:** the existing `SignerMessage` introduction, the sender's message when there is one, the file names, the deadline when set, and a button "Revisar e assinar".
- **Note under the button:** "Pode ser solicitado um código de verificação, enviado para este e-mail."

The owner is always the sender, also when a manager presses "Reenviar".

Other subjects:

- Reminder: `Lembrete: {title} aguarda sua assinatura`
- Signed copy: `Documentos assinados: {title}`
- Closing notice: `{title} foi cancelado` or `{title} foi recusado`, with the cancel reason when there is one

### The signed copy

ZapSign sent this until now, so we have to replace it. The email links to the signer's `sign_url`, which should show the signed document once the envelope completes.

- Spike S3 must confirm that. If it fails, attach the PDFs instead. An envelope over the mail provider's size limit then gets a note to ask the sender for the files.
- Failing to save a signed file to Drive doesn't hold the copy back.

### Failure and retry

- `IMailer::send` throwing, or naming the signer as a failed recipient, is a failure.
- A failure sets `inviteFailedAt`, records one `invite_failed` event, and notifies the owner once per outage. The signer row shows "Convite não enviado" and "Reenviar".
- The envelope stays `pending`. The next sync tries again, and the sync comes back within 15 minutes while any invite is failing. It retries as long as the envelope is open.
- A success clears `inviteFailedAt`.
- A failed attempt doesn't start the 30-minute window, so "Reenviar" works at once.
- Signed copy and closing notice retry the same way, with no signer-row state and no owner notification. They stop after 7 days and log it.

### No double invites

Each invite claims the signer with an atomic update on a new `invite_attempted_at` column: it applies only when the column is null or older than 10 minutes. `released_at` is written after SMTP accepts the mail.

- Two racing jobs: one claim wins.
- A crash after the claim: the invite goes out again 10 minutes later.
- A crash after SMTP accepted but before the write: the signer gets the invite twice. A duplicate is better than a lost invite, and this window is small.

### The 30-minute window

ZapSign's cooldown no longer applies, because we don't send through it. We keep one message per signer every 30 minutes on reminders, as our own rule against flooding a signer.

A corrected address is invited at once, with the existing rate limit on that route. `inviteAvailableInSeconds` and its countdown go away.

`SignerReminders::lastSendAt` loses its `previousGroupFinishedAt` case, since every invite now sets `released_at`.

### Mail not set up

`EnvelopeSender::claim` rejects the Send with `mail_not_configured` when the instance has no SMTP host. Otherwise we'd bill a document nobody can be invited to. The admin health area shows the same condition, plus the last mail failure.

## Technical shape

- `NewDocument`: add `disable_signer_emails: true`.
- `NewSigner`: drop `custom_message` and `send_automatic_email`.
- `ZapSignClient`: remove `releaseSigner`. `updateSignerEmail` stays, because ZapSign's code goes to that address.
- `EnvelopeCancellation` and `EnvelopeRemoval`: pass `notify_signer: false`.
- New `lib/Mail/`: one class renders and sends each email, and fetches `sign_url` fresh through `getDocument`. Nothing else knows about mail.
- `SendStep::Released` keeps its place and now means "invites attempted".
- `EnvelopeSynchronizer::reschedule`: before reminders, invite signers whose turn arrived and retry failed mail.
- `EnvelopeCompletion`: mark the copy due. The sync sends it.
- Mail goes out from `SendJob` and `SyncEnvelopeJob`, so `docker/assinaturas-worker.sh` doesn't change. Only a manual "Reenviar" or an email correction sends inside a request, because the owner is waiting for the answer. A cancel answers without waiting for SMTP and schedules a sync.
- Migration: `invite_attempted_at`, `invite_failed_at` and `copy_sent_at` on signers, plus whatever closing notices need to stay at-most-once per signer.
- `Counters`: mail sent and failed, by kind. Logs carry the envelope uuid and signer id, never the address or link.

### API

- Signer gains `inviteFailedAt`.
- New codes: `mail_not_configured` (409 on send), `mail_failed` (502 on `remind`, and in the correction result).
- `PUT …/email` drops `inviteAvailableInSeconds`.
- New events: `invite_sent`, `invite_failed`, `signed_copy_sent`.
- `docs/api.md` is updated in the same change.

### Envelopes already sent

No migration and no per-envelope switch. Only sandbox envelopes exist, on conecta-2 and app3. An open one keeps ZapSign's emails on, so a signer there could get both emails for the next group. That's acceptable on the sandbox.

## Spike first (sandbox)

Run these before planning the code. Each answer can change the design.

- **S1.** With the flag on and no release call, `sign_url` opens and signing works, in both groups, with the out-of-order block on.
- **S2.** With the flag on and `notify_signer: false`, nobody gets a cancel email.
- **S3.** After completion, `sign_url` shows the signed document, also a few days later.
- **S4.** With the flag on, ZapSign's code email still goes out, to a corrected address too.
- **S5.** Nothing from ZapSign reaches signers on refusal, expiry or completion.

## Verification

- Tests for each email: recipients, Reply-To, From name, message present in every group, no `sign_url` in logs, no provider name in any rendered email.
- Tests for the failure path: SMTP down at Send leaves the envelope `pending`, recovery sends once, two racing syncs send once.
- Sandbox run on conecta-2 with two groups: invite, reminder, correction, cancel, refusal, completion, and one with SMTP broken.
- Grok bot checks the signer rows and notifications. Patrick checks real inboxes, including spam placement on Gmail and Outlook.

## Rollout

1. Spike, then update this spec.
2. Plan and build on an `assinaturas` branch, release 0.12.0, pin in `avuz-server`.
3. conecta-2, then app3 (still sandbox), with Patrick's word for each production step.
4. Update `docs/assinaturas-tenant-runbook.md`: drop the "sender text and Reply-To" panel step, add "instance default sender verified in the mail provider".
5. Update the Assinaturas section in `CLAUDE.md`.

## Left to the builder

- The exact column for closing-notice bookkeeping.
- Whether the renderer is one class per email or one class with a method per email.
- The exact wording of the owner notification and the admin health line, in the app's existing voice.
