# Modern UI (PR #36): Talk waiting sound + Deck parity

Date: 2026-11-11. Builds on PR #36 (`feat/conecta-modern-ui-ip-access`, Felipe). Lands as a PR into that branch.

## Decisions (Patrick, 2026-11-11)

- **Black primary colour `#15171b`:** keep it. Clients hear about it before the fleet roll.
- **Talk waiting sound:** turn off only the tone that plays while you are alone in a call. "Testar alto-falantes" keeps the original sound.
- **Deck:** the restyle must keep every Deck feature we ship today. Whatever "Novo cartão" lacks gets added. Required custom fields block creation until they are filled.

## 1. Talk: no waiting sound

### Why the PR's approach fails
Talk loads `img/LibremPhoneCall.{ogg,flac}` into a single audio object, `wait`. Two things play it:
- `Sounds.playWaiting()` (`src/utils/sounds.js`), the alone-in-call loop: once, then every 15 s, up to 3 more times;
- `MediaDevicesSpeakerTest`, through `soundsStore.playAudio('wait')`.

A silent file mutes both.

### Behavior
- **Joining a call where nobody else is in it:** one join chime (`join`), no waiting loop. Upstream plays the waiting loop *instead of* the join chime, which would leave the user with no audio confirmation at all.
- **Becoming alone because the last other person left:** the leave chime only, then silence.
- **"Testar alto-falantes":** unchanged, plays the original `LibremPhoneCall`.
- **"Play sounds" setting off:** no sounds, as today.

### Where
- Source patch in `~/work/avuz/spreed-fork`:
  - new branch `avuz/no-waiting-sound` on top of `avuz/stagger-request-offer` (v23.0.6);
  - patch file exported to `docker/overlays/spreed/no-waiting-sound.patch`.
- Rebuilt bundle replaces `docker/overlays/spreed/js/*.js` and `css/*.css`. Same file set as today; MediaPipe glue stays excluded (see c629e6c1fb3).
- Remove PR #36's `themes/avuz/apps/spreed/img/LibremPhoneCall.{ogg,flac}`.
- Rewrite the `talk-silent-waiting-sound` entry in `customizations.json`.

## 2. Deck "Novo cartão": custom fields + recurrence

The open-card view keeps Deck's own components (CSS restyle only). The gaps are in the new dialog (`apps/avuz_theme/js/deck-new-card.js`): it can't set custom fields or recurrence.

### Custom fields ("Campos complementares")
- **Which fields:** `store.getters.currentBoardCustomFields`, in that order. `checkbox` fields are skipped, as in Deck's `CustomFieldsSection`. No section at all when the board has no visible fields.
- **Inputs and stored values.** The value strings must pass `CustomFieldType::validateValue`:

  | type | input | value sent |
  |---|---|---|
  | text | text | as typed, trimmed |
  | number | number | numeric string (`"12.5"`) |
  | money | text with `R$` prefix, pt-BR | `"1.234,56"` → `"1234.56"` (Deck's `onMoneyChange` rule) |
  | date | date | `YYYY-MM-DD` |
  | dropdown | select, empty first option | option id |
  | multi | toggle chips | JSON array of option ids, in field option order |

- **Required fields:** the label carries "obrigatório". Submit with a required field empty:
  - no card is created;
  - an error (`role="alert"`) names the missing fields;
  - focus goes to the first missing field.
- **Saving:** after `addCard`, each filled field is saved with `store.dispatch('setCustomFieldValue', { card, fieldId, value })`. Empty fields are not sent.

### Recurrence ("Recorrência")
- **Interval:** Nenhuma (default) / Diária / Semanal / Mensal.
- **Semanal:** weekday chips Dom…Sáb (values `"0"`–`"6"`).
- **Start (Início):** required when an interval is set, default today.
- **End (Fim):** optional. End before start: the dialog shows an error and creates nothing.
- **Saving:** after `addCard`, `store.dispatch('updateCardRecurrence', { card, interval, weekdays, start, end })`:
  - `weekdays` is a comma list for Semanal, `null` otherwise;
  - dates are `YYYY-MM-DD`.

### After the card exists
Every step after `addCard` can fail on its own and the card stays: subtasks, attachments, custom fields, recurrence, and the final refresh fetch.
- The dialog closes.
- One toast lists what failed.
- The outer "Não foi possível criar o cartão" error appears only when `addCard` itself fails. Today a failed refresh fetch makes a retry create a duplicate card.

## 3. Parity check (staging-1, rendered)
Check that these still work through the restyle:
- open-card tabs: details, subtasks, time, attachments, comments, activity;
- custom fields section and recurrence chip in an open card;
- card templates ("…" on a list);
- board folders, both moving boards and the "Novo painel" folder pick;
- start and due dates;
- assigned-user filter;
- feature hints;
- board settings (custom field admin).

Anything broken gets a task before the PR.

## Out of scope
The other review items on PR #36 (rail blocker, route guards, dark mode, a11y, IP access). Felipe owns those.
