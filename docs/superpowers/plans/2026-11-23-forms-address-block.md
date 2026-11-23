# Formulários Address Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Bloco de endereço" in the Forms editor inserts 7 configured address questions; the answer page fills the address from the CEP through ViaCEP (Deck #449).

**Architecture:** Two commits on the existing Forms port (`~/work/avuz/forms-port`, branch `avuz-conditional`, on top of the #448 port): an editor menu entry that creates the block through the existing question API, and a submit-view watcher that calls ViaCEP and fills sibling answers. avuz_theme allows ViaCEP in the CSP. Overlay `docker/overlays/forms/` refreshed (patch, `lib/` if changed, `js/`, `css/`, boot-check chunk names).

**Tech Stack:** Forms 5.3.5 (Vue 3, mixins), node:test, PHPUnit (`docker/overlays/forms/scripts/phpunit.sh`), avuz_theme PHPUnit (host php + `~/work/avuz/deck-fork/vendor/bin/phpunit -c apps/avuz_theme/tests/phpunit.xml`).

**Spec:** `docs/superpowers/specs/2026-11-23-forms-address-block-design.md`

## Global Constraints

- Only upstream Forms features in stored data: technical `name`, short `validationType: 'regex'` + `validationRegex`, dropdown options. No new extraSettings keys.
- Names: `cep`, `logradouro`, `numero`, `complemento`, `bairro`, `estado`, `municipio`; order and required flags as in the spec table; CEP regex `^\d{5}-?\d{3}$` (stored in the format Forms 5.3.5 uses for validationRegex, e.g. with `/…/` delimiters if that is what QuestionShort saves).
- Estado options: the 27 UFs as "Nome (UF)", alphabetical by name.
- ViaCEP URL `https://viacep.com.br/ws/<8 digits>/json/`, 5 s timeout, `erro: true` = unknown CEP.
- Fill only empty fields or fields still holding the previous auto-filled value.
- Messages (pt_BR via theme l10n, English source in `t('forms', …)`): "Endereço preenchido a partir do CEP." (polite live region), "CEP não encontrado. Preencha o endereço." (under the CEP field).
- Never "Nextcloud" in UI text. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Every Forms rebuild changes chunk hashes: update the two forms JS entries in `docker/entrypoint.sh` (sentinel list) and README.

## Review Focus

1. A form with two address blocks: each CEP fills only its own block. Test in Task 1 (mapping test).
2. Respondent typed Logradouro before the CEP: their text stays. Test in Task 1.
3. A CEP typed with or without the dash, with spaces: still looked up once 8 digits are there. Test in Task 1.
4. A UF ViaCEP returns that no option matches (author edited the options): Estado left alone, no error. Test in Task 1.
5. Address block skipped by a jump (#448): no lookup, no answers sent. Checked in the browser.

---

### Task 1: Editor block + CEP auto-fill (Forms port + overlay)

**Files (port tree):** create `src/utils/AddressBlock.ts` (block definition + `addressAnswers(viaCep, questions, answers, autoFilled)` pure mapping), `tests/javascript/address-block.test.mjs`; modify the add-question menu component used by `src/views/Create.vue` (`@addQuestion`) to offer "Bloco de endereço", `src/views/Create.vue` (create the 7 questions in order through the existing store/API calls, then name/required/validation/options), `src/views/Submit.vue` (watch CEP answers, fetch, apply mapping, live region + CEP message), `package.json` test script.
**Files (avuz-server, branch `feat/forms-address-block`):** `docker/overlays/forms/{conditional-questions.patch,js/,css/,README.md}`, `docker/entrypoint.sh` (chunk names), `themes/avuz/apps/forms/l10n/pt_BR.json`.

- [ ] Failing node tests for `addressAnswers` (fills block, keeps typed text, overwrites previous auto-fill, second block untouched, UF matching incl. no match, CEP normalisation) → implement → green.
- [ ] Editor entry + block creation; submit-view auto-fill; build, lint, `test:jumps`, new test, PHPUnit green.
- [ ] Local browser check on a throwaway server (as #448 Task 4): insert block, answer with a real CEP (e.g. 01310-100 → Avenida Paulista, Bela Vista, São Paulo, SP), typed value kept, unknown CEP (e.g. 00000-000) message.
- [ ] Port commit(s); export patch; refresh overlay + chunk sentinels + pt_BR; avuz-server commit.

### Task 2: CSP allows ViaCEP (avuz_theme)

**Files:** create `apps/avuz_theme/lib/Listener/ViaCepCspListener.php` (`AddContentSecurityPolicyEvent` → `addAllowedConnectDomain('https://viacep.com.br')`), register in `lib/AppInfo/Application.php`, test `apps/avuz_theme/tests/Unit/Listener/ViaCepCspListenerTest.php`.

- [ ] Failing test (policy after the listener allows `https://viacep.com.br` in connect-src) → implement → full avuz_theme suite green → commit.

### Task 3: HML check

- [ ] Build `:staging-1` from a branch that also contains the Deck reorder fix, deploy, verify as an anonymous guest on a public form with the block (fill from CEP), then clean up.
