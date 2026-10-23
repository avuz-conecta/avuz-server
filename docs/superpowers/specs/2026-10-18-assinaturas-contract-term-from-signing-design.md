# Assinaturas: contract term counted from signing

Date: 2026-10-18 · Status: approved (Patrick chose "both modes" in chat)
Changes `2026-10-07-assinaturas-contracts-design.md` (Contract record, wizard step, AI suggestions).

## Goal

Many contracts state a duration ("vigência de 12 meses a contar da assinatura") rather than fixed dates. For those, the dates are set when the envelope is fully signed, not while the draft is being prepared.

## Behaviour

- **Two modes for a contract's term:**
  - **Datas fixas.** Today's behaviour: `startsOn` optional, `endsOn` required.
  - **A partir da assinatura.** `termMonths` is required (1..`ContractLimits` max renewal term, 120). No dates are entered.
- **When the envelope completes,** a from-signing contract gets its dates at activation:
  - `startsOn` = the calendar date (instance timezone) of the **completion time of the envelope** (`completedAt`), not of the last signer's `signedAt`. Without a completion time it falls back to the last signature's date, then to today.
  - `endsOn` = `startsOn` + `termMonths` − 1 day. Example: 12 months from 10/10/2026 ends 09/10/2027. Month-end clamping uses the same rule as auto-renewal (`ContractCalendar`).
- **After activation** the contract is an ordinary contract with fixed dates. Alerts, renewals, edits and the Contratos screen don't change.
  - `termMonths` is kept as the default length for the next term only if auto-renew has no term of its own. Auto-renew keeps its own `renewalTermMonths`, which defaults to `termMonths` when the user leaves it empty.
- **Held terms** (draft or awaiting signature) in from-signing mode show "Vigência: N meses a partir da assinatura" instead of dates. The card shows "Aguardando assinatura" as today.
- **Validation** (server = source of truth, client mirrors it):
  - Datas fixas: as today.
  - A partir da assinatura: `termMonths` is required, and `startsOn`/`endsOn` must be absent. Notice days and alert days work as today. They're applied after activation, against the computed `endsOn`.
  - Registering contract data on an already-completed envelope ("Registrar dados") with from-signing mode uses that envelope's completion date the same way.
- **AI reading:** the prompt asks for the term mode.
  - If the text gives a duration counted from signing, or a duration with no start date, the suggestion is from-signing with `termMonths`.
  - If it gives explicit dates, the suggestion is fixed dates.
  - The suggestion is validated like typed terms. Invalid fields are dropped, and the "Sugerido pela IA" marks apply as today.
- **Wizard Contrato step:**
  - A two-option control, "Datas fixas" / "A partir da assinatura", sits above the dates.
  - Switching modes hides the other mode's fields. Hidden values are never sent (same rule as the hidden notice field).
  - The default for a new card is "Datas fixas", or the AI suggestion's mode when there is one.

## Data

- Held terms JSON gains `termMode` (`fixed` | `from_signing`, default `fixed`) and `termMonths`. Existing held terms read as `fixed`.
- No schema change on `assinaturas_contracts`: activated contracts always have dates.
- API (`docs/api.md`): the terms shape gains `termMode` and `termMonths`; the from-signing validation codes are documented.

## Out of scope

- Terms counted from a date other than signing ("a partir de 1º de janeiro").
- Partial-signature start dates (first signer).

## Testing

- **PHP:**
  - validation of both modes;
  - activation computes `startsOn`/`endsOn` from the envelope's completion date, including month-end and leap-year cases;
  - "Registrar dados" on a completed envelope;
  - an AI suggestion in each mode;
  - old held terms with no mode.
- **Vitest:**
  - mode switch hides and does not send the other fields;
  - the card shows held from-signing terms;
  - a suggested mode is marked.
