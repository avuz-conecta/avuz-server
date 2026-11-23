# Formulários: address block with CEP auto-fill (Deck #449)

Status: approved by Patrick 2026-11-23 (option 1 + CEP auto-fill).

## Why

Eco-ambiental wants one "Endereço" question with sub-fields: CEP, Logradouro,
Nº, Complemento, Bairro, Estado, Município. Forms has no composite question.
Instead of a new question type (new answer format, permanent fork from
upstream), the editor inserts a ready-made block of ordinary questions, and the
answer page fills the address from the CEP.

## What changes

- **Editor:** the add-question menu gets "Bloco de endereço". One click appends
  7 questions, in this order, already configured:
  | Question | Type | Technical name | Required | Notes |
  |---|---|---|---|---|
  | CEP | short | `cep` | yes | regex validation `^\d{5}-?\d{3}$` |
  | Logradouro | short | `logradouro` | yes | |
  | Nº | short | `numero` | yes | |
  | Complemento | short | `complemento` | no | |
  | Bairro | short | `bairro` | yes | |
  | Estado | dropdown | `estado` | yes | 27 options "Acre (AC)" … "Tocantins (TO)" |
  | Município | short | `municipio` | yes | |
  The author can edit, reorder or delete them like any question. Question texts
  go through `t('forms', …)` (pt_BR in `themes/avuz/apps/forms/l10n/pt_BR.json`).
- **Answer page:** when the respondent types a complete CEP (8 digits) in a
  question named `cep`, the browser asks ViaCEP
  (`https://viacep.com.br/ws/<cep>/json/`, 5 s timeout) and fills the block's
  `logradouro`, `bairro`, `municipio` and `estado` (the option ending in
  "(UF)"). The block = the questions after that CEP question, up to the next
  question named `cep`. A field is filled only if it is empty or still holds the
  previous auto-filled value (typed text is never overwritten). The polite live
  region announces "Endereço preenchido a partir do CEP." A CEP ViaCEP does not
  know shows "CEP não encontrado. Preencha o endereço." under the CEP field
  (not blocking); network errors are silent.
- **CSP:** AvuzConecta allows `https://viacep.com.br` as a connect source
  (avuz_theme listener on `AddContentSecurityPolicyEvent`), also on public form
  pages.

## Constraints

- Only upstream Forms features (technical `name`, short-answer `regex`
  validation, dropdown options): forms built with the block keep working on
  Forms 5.5 without our overlay; only the auto-fill and the menu entry go away.
- Works with conditional questions (#448): a skipped block is never filled.
- Respects existing forms: nothing changes for forms without a question named
  `cep`.

## Approaches

1. Editor block + auto-fill (picked): ~1.5 days, nothing new to store.
2. New "Endereço" question type: closest to the client's picture, ~3–4 days,
   new answer format maintained forever.
3. Generic sub-questions/sections: clashes with upstream's planned sections.

## Tests

- Forms port: unit tests (node:test) for the ViaCEP → answers mapping and UF
  option matching; PHPUnit stays green; build + lint.
- avuz_theme PHPUnit: the CSP listener adds `https://viacep.com.br`.
- Local browser (throwaway server): menu inserts the 7 questions as above;
  answering with a real CEP fills the fields (ViaCEP reachable from the local
  machine), typed values are kept, unknown CEP shows the message.
- HML: same answer-page check as an anonymous guest.
