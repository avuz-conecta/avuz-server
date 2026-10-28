# Assinaturas: contracts inside the envelope list

Date: 2026-10-28 · Status: approved by Patrick (2026-10-28)
Changes the Contratos screen from `2026-10-07-assinaturas-contracts-design.md`, and settles the open entry point of `2026-10-20-assinaturas-contract-import-design.md`.

## Why

A new user sees two places in the sidebar, "Envelopes" and "Contratos", and can't tell which one to use. Both list largely the same things: a signed contract is an envelope.

Patrick wants a single place. Everything stays under envelopes, the list shows which envelopes hold a contract, and contracts are managed from there.

The daily job for a client manager is "what's expiring soon, and which renewals need action". The list must answer that in one glance. A client lost track of an insurance policy, so that answer must not be buried.

## Goals

- **One list.** The envelope list is the only list. The "Contratos" sidebar entry goes away.
- **A "Contrato" column.** Every envelope that holds a contract says so in the list, with the contract's state and date.
- **Contract filters on the same list.** Show only envelopes with a contract, those coming due, expired or ended, and sort by contract date.
- **"What's expiring" up front.** It is visible without filtering, so nobody has to remember to look.
- **Contracts are managed from the envelope page.** The contract card already edits, renews, ends and registers. Nothing about that changes.
- **The contract import starts from this list.**

## Non-goals

- Changing the contract card on the envelope page, the alerts or the lifecycle.
- Changing who can see what. Visibility still follows the envelope: owner, folder rights, managers.
- A separate dashboard or report screen for contracts.

## Anti-goals (failure even if it works)

- A new user still finds two places that seem to show the same thing.
- A manager can't find what is expiring in the next weeks without knowing about a filter.
- People who don't use contracts (add-on off) see any trace of contracts: an empty column, chips or a banner.

## What the user sees (add-on on)

### "A vencer" notice at the top of the list

When contracts the viewer can see come due within 90 days, a one-line notice sits above the filters. It counts both active contracts whose key date is within 90 days and contracts that expired in the last 30 days without being renewed or ended. For example: "3 contratos vencem nos próximos 90 dias · 1 vencido". Clicking it shows those envelopes, soonest first. The notice:

- follows the current scope (mine / shared / company) and folder, like the rest of the list;
- does not show when nothing is due;
- can't be dismissed, because it is the safety net that was missing in the insurance case.

### The "Contrato" column

On desktop the column sits after Status. It shows the envelope's contract in one short label, coloured like a status pill:

| Contract state | Label (pt_BR) |
|---|---|
| Active, key date more than 90 days away | "Vigente · até 19/10/2027" |
| Active, key date within 90 days | "Vence em 12 dias" (key date; "Renova em…" when auto-renew is on and the key date is the notice deadline) |
| Expired | "Vencido em 03/10/2026" |
| Ended | "Encerrado" |
| Terms held, envelope not yet completed | "Após assinatura" |
| No contract | empty cell |

- **Several documents with contracts:** the envelope shows the most urgent one (earliest key date among active contracts, else the most recent expired), followed by "+1", "+2".
- **Renewed contracts** are never shown. Their successor is what counts.
- **Phones:** the card gets one extra line with the same label, under the status.

### Contract filters

A second row of chips, labelled "Contratos", sits under the envelope status chips: "Todos" · "Com contrato" · "A vencer" · "Vencidos" · "Encerrados".

- "Todos" is the default and means no contract filter.
- The chips combine with the envelope status chips, the scope, the folder and the search.
- Each chip shows its count, the same way the status chips do.

A new sort, "Vencimento do contrato", puts the soonest key date first and envelopes with no contract last. Choosing a contract chip other than "Todos" switches to this sort automatically, and the user can change it back. The notice link also uses it.

### When a contract chip is on

The list becomes a contract view of the same envelopes:

- **Columns:** Envelope · Contrato · Contraparte · Tipo · Valor · Atualizado. These replace Assinaturas and Prazo, which no longer matter once the envelope is signed.
- **Phones:** the card shows the counterparty and the value instead of signing progress.
- **Totals:** the three cards from today's Contratos screen appear above the list. They are "Contratos vigentes", "Vencem em 90 dias" and "Valor anual dos vigentes", and they follow the same filters.
- **Type filter:** a select appears next to the chips.

### Search

When the add-on is on, the search also matches the counterparty name and its CPF/CNPJ. The placeholder becomes "Buscar por título, signatário, e-mail ou contraparte".

### Importing a contract (entry point for the import design)

- **Sidebar:** under the "Adicionar documentos" button, a quieter second button, "Importar contrato assinado".
- **Empty states:** the "Com contrato" chip shows an empty state with both ways in. The text is "Marque um documento como contrato ao adicionar documentos, ou importe um contrato já assinado.", with the import button.
- **Phones:** the floating button stays "Adicionar documentos". Import is reached through the sidebar drawer.
- **Imported envelopes:** they get their own status chip, "Importados", among the envelope status chips. The import design gives them the status `imported`.

### What goes away

- **The "Contratos" sidebar entry and the `/contracts` screen.**
  - The old address `/contracts` redirects to the list filtered to contracts needing attention (`attention`, see below).
  - With the add-on off it redirects to the plain list, as today.
- **The range filter** ("próximos 30/90 dias", custom from/to). "A vencer" plus the contract-date sort replaces it.
- **The folder select.** The sidebar folder tree already filters the list.
- **The separate counterparty field.** The search covers it.
- **One row per contract.** The list is one row per envelope. An envelope with several contracts shows the most urgent, and the envelope page lists them all.

## Add-on off

Nothing changes from today's envelope list. There is no column, no contract chips, no sort option, no notice, no import button and no counterparty search. Contract data stays stored, as today.

## Server

- The envelope list API (`GET /api/v1/envelopes`) gains:
  - **`contract` filter:** `with`, `coming_due`, `expired`, `ended`, plus `attention`, which the notice uses.
  - **Contract sort:** sort value `contract`.
  - **`type` filter:** applies while a contract filter is on.
  - **Per row:** a `contract` summary, the most urgent one as defined above: label inputs (status, key date, ends on, auto-renew), counterparty, type, value, frequency, and the count of other contracts. It is `null` when there is none, plus a flag for held terms.
  - **Counts:** `counts` gains the contract chip counts.
  - **Totals:** the contract totals come back when a contract filter is on.
  - **Notice counts:** the two numbers for the notice come back on every list call with the add-on on.
  - With the add-on off, all of these are ignored and absent.
- **Visibility is unchanged:** `ScopeVisibility` and `EnvelopeMapper::applyVisibility`. The contract join must not widen what anyone sees.
- **`GET /api/v1/contracts` stays for now** (my call). Nothing in the UI uses it any more, so it can be removed in a later cleanup. `docs/api.md` marks it deprecated.

## Copy (pt_BR)

- "Contrato" (column), "Contratos" (chip row label)
- "Com contrato", "A vencer", "Vencidos", "Encerrados", "Importados"
- "Vigente · até {date}", "Vence em {days} dias", "Renova em {days} dias", "Vencido em {date}", "Encerrado", "Após assinatura"
- "Vencimento do contrato" (sort)
- "Contratos que pedem atenção" (heading while `attention` is on)
- "{n} contratos vencem nos próximos 90 dias", "{n} vencidos": singular and plural forms
- "Contraparte", "Tipo", "Valor"
- "Importar contrato assinado"
- "Buscar por título, signatário, e-mail ou contraparte"

The UI never names the signing provider or "Nextcloud".

## My calls (Patrick to check)

- The 90-day window, and expired within 30 days, for the notice.
- Contract chips combine with the envelope status chips instead of replacing them.
- Choosing a contract chip switches the sort to contract date and the columns to the contract view.
- The range filter, folder select and separate counterparty field are dropped.
- One row per envelope, not per contract.
- `/contracts` redirects to the `attention` view.
- The import button sits under "Adicionar documentos" in the sidebar.
- The contracts API stays, deprecated.

## Rules settled after review (my calls)

- **Build order.**
  - This redesign ships first, without the import pieces: no "Importados" chip, no import button, and an empty state with only the first sentence.
  - The import plan adds them when it lands, using the places this design reserves for them.
  - The import gets its own plan right after.
- **What the notice links to.** A dedicated filter `attention` (no chip of its own) covers:
  - active contracts with a key date within 90 days;
  - contracts expired in the last 30 days that were neither renewed nor ended.

  The notice link and the `/contracts` redirect both apply `attention` with the contract-date sort, so the list count matches the notice. While `attention` is on, no contract chip is selected. A short line above the list says "Contratos que pedem atenção", with a link to clear it.
- **What the notice counts.** It follows scope and folder only. It ignores the search and both chip rows, so it stays a stable safety net. It counts contracts, not envelopes.
- **Envelopes with several contracts.**
  - An envelope matches a contract chip when any of its contracts matches (`EXISTS`).
  - The label shows the most urgent contract among those that match the active chip, so a row under "Vencidos" never reads "Vigente".
  - Chip counts count envelopes, because they count rows. The notice and the totals count contracts.
- **"Com contrato" means real contracts only.**
  - Envelopes that only hold terms (draft or awaiting signature) show "Após assinatura" in the column.
  - They don't match any contract chip.
  - They sort last under "Vencimento do contrato", like envelopes with no contract.
- **Counts and totals.**
  - Each chip row's counts honour the other row, plus scope, folder and search, but ignore their own row. That's the usual faceted behaviour: picking "Concluídos" narrows the contract counts, and vice versa.
  - The totals cards follow scope, folder, search and type, and ignore both chip rows, as today's totals ignore status. "Contratos vigentes" therefore stays meaningful under "Vencidos".

## Left to the builder

- Exact visual layout of the notice, the second chip row and the contract columns, within the existing design system (`Av*` components) and readable on phones.
- How the most urgent contract per envelope is computed in SQL, as long as it is one query per page and not one per row.
- URL query names, keeping today's sync of filters to the URL.
- Moving or deleting the `src/contracts-list/` code. The totals cards and type select may be reused.

## Testing

- **PHP:**
  - the `contract` filters and the sort;
  - the per-row contract summary, picking the most urgent and skipping renewed contracts;
  - counts and totals follow scope, folder and search;
  - the contract join doesn't widen visibility (a folder viewer, another user's draft);
  - the notice counts;
  - the add-on off ignores every contract parameter;
  - counterparty search.
- **Vitest:**
  - the column labels for each state;
  - chips combine and update the URL;
  - the contract view swaps the columns and shows the totals;
  - the notice shows only when something is due, and its link applies the filter and sort;
  - with the add-on off, nothing contract-related shows;
  - `/contracts` redirects;
  - the "Contratos" sidebar entry is gone;
  - the import button is under "Adicionar documentos".
- **a11y:**
  - the notice is a link with a clear name;
  - the chip rows are labelled groups;
  - the column label isn't conveyed by colour alone.
