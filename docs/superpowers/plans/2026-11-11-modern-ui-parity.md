# Modern UI parity (Talk waiting sound + Deck "Novo cartão") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Silence only Talk's alone-in-call loop, and give "Novo cartão" custom fields and recurrence. Both land as a PR into PR #36's branch.

**Architecture:**
- **Talk:** source patch to `src/utils/sounds.js` in the spreed fork, then a rebuilt overlay bundle in `docker/overlays/spreed/`.
- **Deck:** extend PR #36's DOM dialog `apps/avuz_theme/js/deck-new-card.js`. It still drives Deck's own Vuex actions (`setCustomFieldValue`, `updateCardRecurrence`).

**Tech Stack:**
- Talk: vitest + rspack (`~/work/avuz/spreed-fork`, node 24, npm 11).
- avuz_theme JS tests: `node --test` + jsdom (`apps/avuz_theme/tests/js/*.test.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-11-modern-ui-parity-design.md`

## Global Constraints
- Branches:
  - avuz-server: `feat/modern-ui-parity`, off `pr-36` (c71a696c747), PR into `feat/conecta-modern-ui-ip-access`;
  - spreed-fork: `avuz/no-waiting-sound`, off `avuz/stagger-request-offer` (9578932, v23.0.6).
- UI copy is pt-BR: "Campos complementares", "obrigatório", "Recorrência", "Nenhuma/Diária/Semanal/Mensal", "Dom Seg Ter Qua Qui Sex Sáb", "Início", "Fim".
- Do not name ZapSign/Nextcloud in UI copy.
- The overlay must not contain `vision_wasm_internal.js` / `vision_wasm_nosimd_internal.js`.
- Commit messages: no Claude Code mention in the body; end with the Co-Authored-By trailer.
- No prod action. Staging-1 (stack 8) only.

## Review Focus
1. **Money typed pt-BR style** (`"1.234,56"`, `"10"`, `"R$ 5,5"`) saves `"1234.56"`, `"10"`, `"5.5"`. Garbage (`"abc"`) counts as empty. *Test in Task 3.*
2. **Required multi with no chip pressed** is treated as empty and blocks submit. *Test in Task 3.*
3. **Dropdown whose selected option is the empty first entry** sends nothing, instead of an empty string the backend rejects. *Test in Task 3.*
4. **Recurrence end before start** blocks submit before `addCard`. *Test in Task 4.*
5. **Refresh fetch fails after create** (network error): the card is kept, the dialog closes, and no retry creates a duplicate. *Test in Task 4.*

---

### Task 1: Talk: no alone-in-call loop (spreed-fork)

**Files:**
- Modify: `~/work/avuz/spreed-fork/src/utils/sounds.js`
- Test: `~/work/avuz/spreed-fork/src/utils/__tests__/sounds.spec.js`

**Interfaces:**
- Produces: `Sounds.playJoin(force, playWaitingSound)` and `Sounds.playLeave(force, playWaitingSound)`. Signatures stay unchanged, because callers still pass the flag. `Sounds.playWaiting` is removed.

- [ ] **Step 1:** `git switch -c avuz/no-waiting-sound` in spreed-fork.
- [ ] **Step 2: Write the failing tests.** Mock `../stores/sounds.js` so `useSoundsStore()` returns `{ shouldPlaySounds: true, playAudio: vi.fn(), pauseAudio: vi.fn() }`, and use `vi.useFakeTimers()`.
  - `describe('Sounds')`:
    - `it('plays the join chime once when joining an empty call')`: `await Sounds.playJoin(true, true)` → `playAudio` called exactly with `['join']`; `vi.advanceTimersByTime(60000)` → still 1 call, no `'wait'`.
    - `it('plays only the leave chime when the last participant leaves')`: `Sounds.isInCall = true; await Sounds.playLeave(false, true)` → calls `[['leave']]`; after 60 s still no `'wait'`.
    - `it('plays nothing when sounds are off')`: `shouldPlaySounds = false; await Sounds.playJoin(true, true)` → no calls.
- [ ] **Step 3:** `npx vitest run src/utils/__tests__/sounds.spec.js`. Expected: the first two FAIL (`'wait'` played).
- [ ] **Step 4: Implement.**
  - Delete `playWaiting`, `playedWaiting` and `backgroundInterval`.
  - In `playJoin`, always `soundsStore.playAudio('join')`.
  - In `playLeave`, drop the `playWaiting` call.
  - Keep `_stopWaiting()` as `soundsStore.pauseAudio('wait')`: it still stops a running speaker test when a call event happens, as upstream does.
- [ ] **Step 5:** Re-run. Expected: PASS. Then run `npx vitest run src/utils` with no new failures.
- [ ] **Step 6: Commit** `fix(call): drop the alone-in-call waiting loop, keep speaker test sound`.

### Task 2: Rebuild the Talk overlay, drop the silent files

**Files:**
- Replace: `docker/overlays/spreed/js/*.js`, `docker/overlays/spreed/css/*.css`
- Create: `docker/overlays/spreed/no-waiting-sound.patch`
- Modify: `docker/overlays/spreed/js/README.md` (second patch: why, and the rebuild step that applies both patches)
- Modify: `customizations.json`. Rewrite entry `talk-silent-waiting-sound`: paths are the overlay and patch; the description follows spec §1.
- Delete: `themes/avuz/apps/spreed/img/LibremPhoneCall.ogg`, `themes/avuz/apps/spreed/img/LibremPhoneCall.flac`

**Interfaces:**
- Consumes: the Task 1 commit.

- [ ] **Step 1:** `npm ci && npm run build` in spreed-fork (background; it takes minutes).
- [ ] **Step 2: Copy the build.**
  - Copy `js/*.js` (no `.map`) and `css/*.css` over the overlay dirs.
  - Delete `js/vision_wasm*_internal.js` from the overlay if copied.
  - `diff <(ls before) <(ls after)` shows the same file names.
- [ ] **Step 3: Verify the bundle.**
  - `grep -c 'Playing waiting sound' docker/overlays/spreed/js/talk-main.js` → `0`.
  - `grep -c 'Request offer' …` still > 0, so the stagger patch is present.
  - `grep -o 'createAudioObject("wait","LibremPhoneCall"' …` → 1, so the speaker test still has its sound.
- [ ] **Step 4:** `git -C ~/work/avuz/spreed-fork format-patch -1 --stdout > docker/overlays/spreed/no-waiting-sound.patch`. Delete the two silent files, then edit the README and `customizations.json`.
- [ ] **Step 5: Commit** `fix(spreed): silence only the alone-in-call loop; restore speaker test sound`.

### Task 3: "Novo cartão": custom fields

**Files:**
- Modify: `apps/avuz_theme/js/deck-new-card.js`
- Modify: `apps/avuz_theme/css/deck-new-card.css` (styles for the fields grid, `.avuz-nc__required`, and the multi chips, which reuse `.avuz-nc__chip`)
- Test: `apps/avuz_theme/tests/js/deck-new-card.test.mjs`

**Interfaces:**
- Produces, inside the IIFE:
  - `customFieldValue(field, formElement) -> string | null`, the value to send (`null` = empty);
  - `parseMoney(text: string) -> string | null`.
- Task 4 reuses the submit pipeline built here.
- Test harness:
  - a jsdom page with `.app-deck` (its `__vue__ = { $store: fakeStore }`) and a stack header button `[data-cy="action:add-card"]` whose parent element's `__vue__ = { stack: { id: 1 }, clickAddCard() {} }`;
  - `fakeStore`: `{ state: { currentBoard: board }, getters: { stacksByBoard: () => [{ id: 1, title: 'A fazer' }], currentBoardLabels: [], assignables: [], currentBoardCustomFields: FIELDS }, dispatch: recorder, commit() {} }`;
  - `addCard` resolves `{ id: 42 }`;
  - stubs `window.OC` (`generateUrl`, `requestToken`, `Notification.showTemporary`) and `fetch`.
  - Export the harness as `openNewCard({ fields, dispatch })`.

- [ ] **Step 1: Write the failing tests.** `FIELDS` = text "Contrato" (required), number "Horas", money "Valor", date "Entrega", dropdown "Prioridade" (options a/b), multi "Áreas" (options a/b/c), checkbox "Faturado".
  - `describe('Novo cartão › Campos complementares')`:
    - `it('lists the board fields in order, without checkbox fields')`: labels read `['Contrato obrigatório','Horas','Valor','Entrega','Prioridade','Áreas']`.
    - `it('shows no section when the board has no fields')`.
    - `it('blocks creating while a required field is empty and names it')`: submit with a title only → no `addCard` dispatch; `[role=alert]` text includes `Contrato`; `document.activeElement` is the Contrato input.
    - `it('blocks a required multi field with nothing selected')`: same, with Áreas required.
    - `it('saves the filled fields after creating the card')`: fill Contrato `' C-77 '`, Horas `12.5`, Valor `1.234,56`, Entrega `2026-11-20`, Prioridade `b`, Áreas chips c then a. Expected `setCustomFieldValue` payloads, in order:
      ```
      {card:{id:42}, fieldId:<Contrato>, value:'C-77'}
      {fieldId:<Horas>, value:'12.5'}
      {fieldId:<Valor>, value:'1234.56'}
      {fieldId:<Entrega>, value:'2026-11-20'}
      {fieldId:<Prioridade>, value:'b'}
      {fieldId:<Áreas>, value:'["a","c"]'}
      ```
    - `it('does not send empty optional fields')`: Contrato only → exactly one `setCustomFieldValue`; an untouched dropdown sends nothing.
    - `it('reads pt-BR money')`: `parseMoney` cases `'1.234,56'→'1234.56'`, `'10'→'10'`, `'R$ 5,5'→'5.5'`, `'abc'→null`, `''→null`. Test through the form: type in Valor, submit, assert the value.
- [ ] **Step 2:** `node --test apps/avuz_theme/tests/js/deck-new-card.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Render a "Campos complementares" section after Responsáveis. Each field is labelled with `esc(field.title)`; required ones get `<small class="avuz-nc__required">obrigatório</small>`.
  - Submit order: title check → required check (message `Preencha os campos obrigatórios: X, Y.`, then focus the first) → date checks → `addCard` → custom fields loop. Each failure pushes `field.title` into `failed`.
- [ ] **Step 4:** Re-run. Expected: PASS. Then run `node --test apps/avuz_theme/tests/js/` with all green.
- [ ] **Step 5: Commit** `feat(avuz_theme): custom fields in Novo cartão, required ones block creation`.

### Task 4: "Novo cartão": recurrence + failure-tolerant post-create

**Files:**
- Modify: `apps/avuz_theme/js/deck-new-card.js`, `apps/avuz_theme/css/deck-new-card.css`
- Test: `apps/avuz_theme/tests/js/deck-new-card.test.mjs`

**Interfaces:**
- Consumes: `openNewCard` harness from Task 3.

- [ ] **Step 1: Write the failing tests.** `describe('Novo cartão › Recorrência')` and `describe('Novo cartão › depois de criar')`:
  - `it('sets a weekly recurrence with the chosen weekdays')`: pick Semanal, press Seg and Qua, start `2026-11-11` → `updateCardRecurrence` payload `{card:{id:42}, interval:'weekly', weekdays:'1,3', start:'2026-11-11', end:null}`.
  - `it('defaults the start to today and hides weekdays for Mensal')`: the start input value equals today's local `YYYY-MM-DD`; the weekday chips are hidden.
  - `it('sends no recurrence by default')`: no `updateCardRecurrence` dispatch.
  - `it('blocks an end date before the start')`: start `2026-11-20`, end `2026-11-10` → no `addCard`; the alert text contains `Fim`.
  - `it('keeps the card when a custom field fails to save')`: `setCustomFieldValue` rejects → `addCard` dispatched once, the dialog is gone, and the toast (error type) mentions `Contrato`.
  - `it('keeps the card when the refresh fetch fails')`: `fetch` rejects → the dialog is gone, `addCard` was dispatched once, and there is no `[role=alert]` in the DOM.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add a "Recorrência" row: `<select name="recurrence">` plus weekday `aria-pressed` chips (shown only for weekly) plus `<input type=date name="recurrenceStart">` and `recurrenceEnd`.
  - Wrap each post-create step in its own try/catch that pushes into `failed`. Steps run in this order: subtasks, attachments, custom fields, recurrence, refresh. The refresh failure is silent (log only).
  - Add `role="alert"` to `.avuz-nc__error`.
- [ ] **Step 4:** Run the whole `tests/js` dir. Expected: PASS.
- [ ] **Step 5: Commit** `feat(avuz_theme): recurrence in Novo cartão; post-create failures keep the card`.

### Task 5: Staging parity check, then PR

- [ ] **Step 1: Hot-patch staging-1 (stack 8)** with this branch's `apps/avuz_theme`, `themes/avuz`, and `docker/overlays/spreed/{js,css}` → `apps/spreed`. Use the `ui-iteration-hotpatch-loop` recipe, then restart php-fpm and bump the cachebuster.
- [ ] **Step 2: Verify with the verify-avuz-conecta skill (Playwright):**
  - "Novo cartão" with each field type plus recurrence; then open the card and see the values in Campos complementares and the Recorrência chip;
  - the required block;
  - Talk: join an empty call (one chime, silence for 60 s), and "Testar alto-falantes" plays sound (`audioObjectsPromises.wait` non-null);
  - the spec §3 parity list. Each item is pass or fail, with a screenshot.
- [ ] **Step 3:** Any parity failure gets its own task appended here before the PR.
- [ ] **Step 4:** Push `feat/modern-ui-parity` and open a PR into `feat/conecta-modern-ui-ip-access`. Body in PT, in the same format as PR #36.
