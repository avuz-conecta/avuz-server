# Assinaturas: import contracts signed elsewhere

Date: 2026-10-20 · Status: written, awaiting Patrick's approval
Builds on `2026-10-07-assinaturas-contracts-design.md` and `2026-10-18-assinaturas-contract-term-from-signing-design.md`.

## Why

A client had an insurance policy expire without anyone noticing, and they had to rush to fix it. They had bought the policy; they were not the seller. The insurer had them sign it on another platform, and the signed PDF arrived by email. AvuzConecta never knew the policy existed, so it could not warn anyone.

Contract management today only covers contracts signed through our envelopes. This feature lets a company bring in a contract it signed elsewhere, so it gets the same expiry and renewal warnings.

## What it does

Someone in the company:

1. picks the signed PDF from their Drive;
2. confirms the contract details: the AI fills them in when it can, otherwise they type them;
3. saves.

From then on it is an ordinary contract:
- it is on the Contratos screen;
- it has the same alerts, auto-renewal, notice period, edits, renewal and end;
- the same people are warned.

## Goals

- Import one signed PDF and track its expiry with the same warnings as contracts signed through us.
- Warn the person who imported it and the Assinaturas admins (`assinaturas-admins`), plus anyone with Editar on its folder, the same rule as today.
- Alerts are set exactly as in the Contrato step today: alert days, auto-renew, renewal term, notice days.
- AI reading suggests the details from the PDF when the AI switch is on, marked "Sugerido pela IA" as today.
- Renewing an imported contract by importing the new signed PDF. Insurance policies renew with a new document from the insurer.

## Non-goals

- Checking that the PDF is really signed. We trust the person who imports it.
- Files other than PDF. A signed contract arrives as a PDF.
- Bulk import of many files at once.
- Importing straight from email.
- Reading scanned PDFs that have no text layer. The AI gets nothing, so the person types the details.
- Where imported contracts appear once the Contratos screen and the envelope list are redesigned. That is a separate design (the Contratos-vs-envelopes question), so this one keeps today's screens.

## Anti-goals (failure even if it works)

- An imported contract counts as a sent or completed envelope in Uso, in usage figures or in anything billed per envelope. It never talks to the signing provider.
- An imported contract looks as if it was signed through AvuzConecta. It must say clearly that it was signed elsewhere.
- An import someone started but never confirmed sends alerts, shows to anyone but its owner, or lingers forever.

## Decisions (Patrick)

- The input is the signed PDF; the expiry date is what matters.
- Warnings go to the person who imported it and the Assinaturas admins, set as in the Contrato step today.
- After import it behaves like any other signed contract.
- AI reading fills in the details for confirmation.
- Import only exists while the contract management add-on (`contracts_enabled`) is on.
- No signature check.

## How it fits the current model (my calls, for Patrick to check)

### An imported contract lives on an "imported envelope"

Today a contract always belongs to an envelope document: `envelope_id` and `document_id` are NOT NULL, and listing, access, alerts and notifications all go through the envelope.

So an import creates an envelope with one document, marked as imported, and the contract attaches to it as usual. That reuses as is:
- **Access:** `AccessPolicy`. The owner is the importer. Managers see everything. Folder rights apply.
- **Alerts:** `AlertRecipients` and `ContractAlerts`.
- **Notifications:** they link to the envelope page.
- **Listing:** `ContractListing`, with its joins and scopes.
- **Lifecycle:** `ContractLifecycle`.
- **Actions:** `ContractActions` (edit, renew, end).

The alternative, a standalone contract with nullable ids, would touch every one of those.

**The imported envelope:**
- **Status:** a new envelope status `imported`.
  - It is never sent, synced or reminded.
  - It has no signers and no signing-provider fields.
  - Every job and query that handles sent or completed envelopes must leave it out: send, sync, reminders, Uso and usage counts, and anything billed per envelope.
- **Title:** the file name without its extension; the person can edit it.
- **Document:** the picked Drive file, kept where it is and never copied, as a source document is today. There is no separate "signed copy": the file is the signed copy.
- **Folder:** optional, picked as in the wizard. With no folder, only the owner and the managers see it (today's rule for `folderId` null).

### While the import is being filled in

Picking the file creates the imported envelope in an unconfirmed state (`importing`), so AI reading can key on its document as it does for drafts. While unconfirmed:
- it is private to its owner, like a draft;
- it holds no contract, sends no alerts and is not counted anywhere;
- it doesn't show in any list.

Confirming creates the contract and moves the envelope to `imported`. Cancelling deletes it. Unconfirmed imports older than 24 h are deleted by the existing hourly cleanup. The Drive file is never touched.

### Contract details

The same form as the Contrato step, with one difference: the term is **fixed dates only**. "A partir da assinatura" doesn't apply, since we don't know when it was signed.
- `endsOn` is required.
- `startsOn` is optional.
- Type, counterparty, value, auto-renew, renewal term, notice days and alert days work as today.

The contract's `source` is `manual` or `ai_confirmed`, as today.

**Dates already in the past are allowed.**
- An expiry that has already passed gives an `expired` contract right away, with no catch-up alerts for offsets already gone.
- With auto-renew on and `endsOn` past, the next lifecycle run rolls it forward as it does today.

### Renewing an imported contract

The contract card of an imported contract offers **"Importar renovação"**. It runs the same import flow, and the new contract continues the old one (`continues_contract_id`). The old one becomes `renewed`, exactly as an envelope renewal does today. The existing "Renovar" (send a new envelope for signature) is still there too.

"Importar renovação" is offered **only on imported contracts** (Patrick):
- A contract signed through AvuzConecta is renewed through AvuzConecta.
- If one is renewed outside instead, the new PDF is imported as an ordinary new contract, not linked to the old one. The old contract keeps its alerts, and auto-renewal if it's on, until someone ends it with "Encerrar", as today.

### Where it starts

- **Entry point: open.** Where "Importar contrato assinado" lives (button, menu, empty state) is decided by the Contratos-vs-envelopes design, since that design may fold the Contratos screen into the envelope list (Patrick, 2026-10-28). Whatever it decides, the import is offered only where the add-on is on.
- **Who can import:** anyone who can use the app (`assinaturas` group, managers, admins).
- **Add-on off:** the button and the endpoints are gone (403 `contracts_disabled`). Existing imported contracts stay stored and stop alerting, the same as other contracts.

### The envelope page of an imported contract

It shows the document, the contract card and one line: "Assinado fora do AvuzConecta · importado por <nome> em <data>". There are no signers, signing order, timeline steps or reminders. The owner and managers can delete the import: that removes the envelope and its contract, and the Drive file stays.

### The envelope list

Imported envelopes appear there with the status "Importado" and can be filtered by it. They are never counted as sent or completed. The Contratos-vs-envelopes redesign may change this; that design decides.

### Edge cases (my calls)

- **A contract that is already past at import.** Its state is settled when the import is confirmed, not at the next lifecycle run, and with no notifications for it: the person just typed it in.
  - With auto-renew off, it is saved `expired`.
  - With auto-renew on, it is rolled forward, without any alert, to the term that contains today.
  - From then on alerts work as for any contract. Offsets already gone are never sent.
- **Importing the same file twice.**
  - Refused while that Drive file backs a confirmed import: "Este arquivo já foi importado." It becomes possible again once that import is deleted.
  - A renewal import of the file the old contract already uses is refused too.
  - A file that is already the source document of a sent envelope can still be imported. That case is rare, and refusing it would block legitimate re-imports of documents we sent.
- **Deleting an import in a renewal chain.**
  - Deleting the newest import of a chain (a renewal made by mistake) restores the contract it continued: `active`, or `expired` if its `endsOn` has passed.
  - Deleting an import whose contract a later one continues is refused: "Exclua a renovação primeiro."
  - Contracts signed through envelopes are never deletable. This only covers imports.
- **Abandoned imports.**
  - An unconfirmed import is not resumed.
  - Starting a new import deletes the owner's earlier unconfirmed imports.
  - The 24 h cleanup catches the rest.
  - AI readings of a deleted unconfirmed import are cancelled, as for a deleted draft.
- **Changes to the Drive file after import.**
  - We store no hash and accept the risk. The contract tracks dates, not evidence.
  - If the file is deleted or no longer readable by its owner, the alerts keep running and the envelope page shows "Arquivo indisponível".

## Copy (pt_BR)

- "Importar contrato assinado"
- "Importar renovação"
- "Importado"
- "Este arquivo já foi importado."
- "Exclua a renovação primeiro."
- "Arquivo indisponível"
- "Assinado fora do AvuzConecta · importado por {name} em {date}"
- Empty-state wording: set by the Contratos-vs-envelopes design, together with the entry point.

The UI never names the signing provider or "Nextcloud".

## Left to the builder

- Screen layout of the import: a dialog or a page, as long as it works on phones and with a screen reader.
- API shape and error codes. They follow `docs/api.md` conventions, and `docs/api.md` is updated.
- Migration details for the new statuses.
- How the existing listing and usage queries leave out `imported` and `importing` envelopes.

## Testing

**PHP:**
- the import creates an `imported` envelope and a contract;
- the importer gets alerts, and so do managers and folder editors;
- the lifecycle (alerts, expiry, auto-renew) works on imported contracts;
- `importing` envelopes are private, not counted and cleaned after 24 h;
- imported envelopes never reach send or sync and are not counted in Uso;
- a past expiry imports as `expired` without catch-up alerts;
- "Importar renovação" continues the old contract;
- the add-on off gives 403;
- deleting an import keeps the Drive file.

**Vitest:**
- the import flow with and without an AI suggestion;
- the form offers fixed dates only;
- the import entry point shows only with the add-on on;
- the imported envelope page shows the "assinado fora" line and no signers;
- the envelope list shows "Importado".
