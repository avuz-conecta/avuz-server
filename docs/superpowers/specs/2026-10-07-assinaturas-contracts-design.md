# Assinaturas — contract management

Date: 2026-10-07 · Status: approved in brainstorm, awaiting spec review
Depends on `2026-10-07-assinaturas-folders-and-managers-design.md` (access rules, managers role).

## Goal

Assinaturas becomes a contract manager, not only a signer: it tracks each contract's term, warns the right people before the deadline that matters, shows what expires when, and can read the dates from the contract with AI.

## Add-on switch

- Sold as an add-on ("Assinaturas" vs "Assinaturas + Gestão de contratos").
- Admin page checkbox **"Gestão de contratos contratada"**, changeable by **Nextcloud admins only** (managers see its state, cannot change it). Stored in app config `contracts_enabled` (default off).
- Off: no "Contrato" wizard step, no Contratos screen, no contract card, no alerts, no AI option. Contract data entered earlier is kept and comes back when switched on.

## Contract record

One record per **document** that is a contract. Annexes without their own terms show "segue o principal" and have no record.

| Field | Rule |
|---|---|
| `starts_on` | Date, optional |
| `ends_on` | Date, required for a contract; after `starts_on` when both are set |
| `auto_renew` | Boolean |
| `renewal_term_months` | Required when `auto_renew`; positive integer |
| `notice_days` | Optional, ≥ 0 |
| `value_cents`, `value_frequency` | Optional; value > 0; frequency `once` / `monthly` / `yearly` |
| `counterparty_name`, `counterparty_document` | Pre-filled from the signers, editable; document validated as CNPJ or CPF (check digits) |
| `type` | Free text; the UI suggests types already used in this instance |
| `alert_days` | List of day offsets, default `[90, 30, 7, 0]`, editable per contract |
| `status` | `active` (Vigente), `expired` (Vencido), `ended` (Encerrado), `renewed` (Renovado — replaced by a newer contract) |
| `continues_contract_id` | Link to the contract this one renews (nullable) |
| `source` | `manual` or `ai_confirmed` |

- **Key date:** `ends_on − notice_days` when `auto_renew` (the notice deadline), otherwise `ends_on`.
- **"A vencer"** is a computed label (key date within 90 days), not a stored status.
- A contract is tracked once it is signed. Until the envelope **completes**, the contract data (and a `continues_contract_id` link from "Renovar com novo documento") is held with the envelope's documents and shown as "Aguardando assinatura"; on completion it becomes an `active` record and the daily job starts following it. A cancelled, refused or expired envelope never produces a record.

## Lifecycle (daily job)

A daily background job (`TimedJob`, every 24 h) for every `active` contract:

1. **Alerts:** for each offset in `alert_days`, when today is `key date − offset`, send the alert once. Dedup by `(contract, key date, offset)` so a re-run, a missed day or a restart never sends twice; a missed day sends the overdue alert on the next run.
2. **Automatic renewal:** when `auto_renew` and today > `ends_on`, set `starts_on = ends_on + 1 day`, `ends_on += renewal_term_months`, record "Renovado automaticamente" in the timeline; alerts restart for the new term.
3. **Expiry:** when not `auto_renew` and today > `ends_on`, set `expired`, record it, stop alerts.

User actions (require `canAct` on the envelope):

- **Renovar:** new `ends_on` (and optionally value); same record continues; timeline records old → new dates.
- **Renovar com novo documento:** creates a new draft prefilled with the same signers, folder, type, counterparty and value, linked through `continues_contract_id`. When that envelope **completes**, the old contract becomes `renewed` (alerts stop, documents stay as history) and the new one is active. If the new envelope is cancelled, refused or expires, the old contract is unchanged.
- **Encerrar:** optional reason; `ended`; alerts stop.
- **Edit fields** at any time; changing dates recomputes the key date (already-sent alerts for the old key date are not resent).

## Alerts

- Recipients: the envelope owner, everyone with **Editar** on its folder (inherited included), and the managers. Each person once per alert.
- A Nextcloud notification plus email (Nextcloud's own email/notification settings apply), opening the envelope. Examples: "Contrato 'Locação Sala 3' vence em 30 dias", "Prazo de aviso de 'Locação Sala 3' termina em 7 dias", "Contrato 'Locação Sala 3' vence hoje".

## Screens

- **Wizard step "Contrato"** (optional, after Documentos; only with the add-on): one card per document with "Este documento é um contrato" (annexes default to "segue o principal"); the fields above; AI suggestions marked "Sugerido pela IA" until edited; Continuar never waits for the AI. Skipping is allowed.
- **Envelope page "Contrato" card:** fields, status chip, chain history ("Contrato original 2025–2026 → Aditivo 2026–2027" with links), actions Editar / Renovar / Renovar com novo documento / Encerrar. A completed envelope without contract data shows "Registrar dados do contrato".
- **Contratos screen** (sidebar; only with the add-on):
  - Rows: name, counterparty, type, value, end date, status chip ("Vigente", "A vencer em 23 dias", "Prazo de aviso em 12 dias", "Vencido", "Encerrado").
  - Only the current link of each renewal chain is listed.
  - Sorted by key date, soonest first. Filters: status, type, counterparty, folder, key date range (next 30 / 90 days, custom); search on name and counterparty. Server-side, paged.
  - Totals strip: Ativos (count), A vencer em 90 dias (count), Valor anual dos ativos (monthly × 12 + yearly; one-off excluded).
  - Scopes like the dashboard: Meus, Compartilhados comigo, Toda a empresa (managers).
  - Phone: cards.

## AI suggestions

- Opt-in per client: a manager turns on **"Ler contratos com IA"** on the admin page, with a notice that the contract text is sent to an external AI provider. Off by default. Hidden when the contracts add-on is off or no AI provider is configured.
- Provider: Nextcloud's task processing API (text-to-text). On Avuz Conecta this is `integration_openai` configured to **OpenRouter with Claude Haiku** (`AI_BASE_URL` / `AI_*` stack env). The app never talks to an AI provider directly.
- Flow: when a document is added to a draft, the browser (which already loads the PDF with pdf.js) extracts its text — first and last pages first, at most 20 000 characters — and sends it once; the server schedules the task with a strict JSON prompt; the wizard polls for the result.
- Validation: dates must exist and `ends_on` must be after `starts_on`; value positive; CNPJ/CPF check digits; frequency and booleans from the allowed set; unknown fields ignored. Anything invalid is dropped, never shown.
- A PDF without a text layer (scan) gets no suggestion; the step says so. The text is never stored; only the validated suggestions are kept until the user confirms or edits them.

## Access

Contracts follow the envelope: `canSee` sees the contract (value included); `canAct` edits, renews and ends it.

## Out of scope

Registering contracts signed outside the app ("Importar contrato"), CSV export, contract templates, OCR of scans.

## White label

No user-facing string names ZapSign or the AI provider.

## Testing

- Daily job: key date with and without notice, each alert offset sent exactly once (re-run, missed day), automatic roll-forward, expiry, ended/renewed contracts ignored.
- Renewal chain: old becomes renewed only when the new envelope completes; cancel/refuse/expiry of the new one leaves the old unchanged; list shows only the current link.
- Validation: dates, CNPJ/CPF check digits, value, renewal term required with `auto_renew`.
- AI: JSON validation (bad dates, invalid CNPJ, extra fields, non-JSON answer), no provider, AI off, scan without text.
- Add-on switch hides every surface; only Nextcloud admins can change it.
- Access: contract visibility and actions follow `canSee` / `canAct`.
- Vitest: Contrato step, contract card actions, Contratos list filters, totals and chips.
