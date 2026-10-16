# Card 539 — Mailbox password in personal settings (ConectaMail)

Users save, replace and remove their ConectaMail mailbox (e-mail) password in
**Configurações pessoais → ConectaMail**. The page shows only whether a password
is saved and when; it never shows or returns the value.

## Design

### Storage

No format change. The page writes the same user value the webmail prompt
already writes (`POST /api/credentials`):

| User value (`conectamail`) | Content | Written by | Deleted by |
|---|---|---|---|
| `email_enc_password` | Mailbox password, AES-256-CBC under `credential_key` (`CredentialService::encryptPassword`, same bytes as `Crypto::encrypt`) | Settings page, webmail prompt | Settings "Remover" |
| `email_password_updated_at` | Unix time of the last save (new, plain) | Settings page, webmail prompt | Settings "Remover" |
| `enc_password` | Avuz Conecta login password captured at login (unchanged) | Login listener | Logout |

- Encrypted at rest, decryptable by the existing token flow and the webmail
  (`docs/card-532-webmail-sso.md`, "Decrypting `enc_pass`"). Existing stored
  values keep working; they report `updated_at: null` until the next save.
- Never logged: the save/remove log lines carry only the uid.
- **Behaviour change:** logout now deletes only `enc_password`. It used to delete
  `email_enc_password` too, so a saved password vanished on any logout on any
  device and the page would show "Nenhuma senha salva" again. The mailbox
  password now stays until the user removes it.

### Endpoints

All logged-in only (`@NoAdminRequired`), CSRF-checked (`requesttoken` header),
and acting on the session user only. No endpoint takes a uid.

| Method | URL | Body | 200 response | Errors |
|---|---|---|---|---|
| GET | `/apps/conectamail/api/mailbox-password` | — | `{"saved": bool, "updated_at": int\|null}` | — |
| PUT | `/apps/conectamail/api/mailbox-password` | `{"password": "<string>"}` | `{"saved": true, "updated_at": <unix>}` | 400 `{"error":"password_required"}` (empty / not a string), 400 `{"error":"password_too_long"}` (> 256 characters), 403 password confirmation |
| DELETE | `/apps/conectamail/api/mailbox-password` | — | `{"saved": false, "updated_at": null}` | 403 password confirmation |

- The password is not trimmed (spaces may be part of it).
- PUT and DELETE use `@PasswordConfirmationRequired` (non-strict: the user's
  Avuz Conecta password, valid 30 min), the same rule Avuz Conecta applies to
  app passwords and other security settings. Users on SSO backends that cannot
  confirm a password skip it automatically.
- `POST /apps/conectamail/api/credentials` (webmail `postMessage` prompt) keeps
  working, with no password confirmation; it now shares the same validation.

### `pass_src`

`WebmailTokenService` is unchanged: it reads `email_enc_password` first
(`pass_src: "mailbox"`), else `enc_password` (`pass_src: "login"`).

- After save/replace: the next token carries the new password, `"mailbox"`.
- After removal: the next token carries the login password, `"login"`; if no
  login password was captured (token/remember-me login), no token is minted and
  the webmail shows its own prompt.

### `sso:fallback-failed:<uid>` marker

The webmail sets it when a `"login"` login fails, skips the login fallback while
it exists, and clears it on any successful login.

1. **Saving a password does not need the marker cleared.** The marker only gates
   the `"login"` fallback. A saved password goes out as `"mailbox"`, which the
   webmail tries regardless; success clears the marker.
2. **Removing can leave a stale marker, in one case.** If the marker was set,
   the user saved a mailbox password and never logged in to the webmail with it
   (or it was wrong), and then removed it, the marker remains. The next token is
   `"login"`, and the webmail skips it and shows its prompt.
   - Usually that is right: the login password failed before and still fails.
   - It is stale only if the login password now matches the mailbox (the user
     changed one of them). The webmail then never retries it until the user
     types the password into the webmail prompt once.
   - Effect: the user sees the prompt instead of a silent login. No lockout risk,
     no data loss.

### Webmail-side needs (webmail-avuz, not changed here)

Nothing is required for this card. Optional, to remove the stale case above:

- Give the marker a TTL (e.g. 24 h), so a skipped fallback is retried at most
  once a day.
- Or store `sha256(enc_pass)` as the marker value and skip only when the current
  token's `enc_pass` hash matches. Avuz Conecta re-encrypts `enc_password` with a
  fresh IV on every password login, so the fallback gets one new try after each
  Avuz Conecta login (for example after a password change), and never on every
  webmail open.

Avuz Conecta cannot clear the marker itself: it lives in the webmail's Redis.

## Layout fixes (Designer review)

1. Removing the saved password asks inline in the section, not in a modal:
   **Remover a senha do e-mail salva? O Avuz Conecta vai tentar sua senha de
   login para abrir seu e-mail.** + red **Remover** + **Cancelar** (`role="group"`,
   focus on **Cancelar**, Esc cancels, focus returns to **Remover** or the field).
2. The success message (**Senha salva.**, **Senha removida.**) shows in the
   success color with spacing above it.
3. The field gets a red border only while it is invalid (`aria-invalid`), and
   the border clears as soon as the value becomes valid.
4. A wrong password in the Avuz Conecta confirmation dialog (save or remove)
   shows **Senha de confirmação incorreta. Tente de novo.** in red; the field is
   not marked invalid. On Avuz Conecta 33 the core dialog closes the same way on
   a wrong password and on cancel (`/login/confirm` answers 403 without the
   `X-Nextcloud-Password-Confirmation` header the dialog needs to stay open), so
   the page tells them apart by whether a non-empty password was submitted in
   the dialog. Cancelling the dialog shows no message. Other failures stay
   generic.
5. Opening the inline remove confirmation clears any previous message
   (e.g. **Senha salva.**).

## Test handoff

Run on staging (e.g. `avuz-conecta`, stack 8), with a user whose ConectaMail
mailbox exists. Language pt_BR.

### UI flow

1. Log in as a normal (non-admin) user and open
   `https://<host>/settings/user/conectamail` (avatar menu → **Configurações
   pessoais** → **ConectaMail** in the left list).
2. Status reads **Nenhuma senha salva** (fresh user) and **Remover** is hidden.
3. Type a password in **Nova senha do e-mail** → **Salvar**. If asked, confirm
   your Avuz Conecta password.
   - Expect: **Senha salva.**, status **Senha do e-mail salva**, **Atualizada em
     <data>**, field empty, **Remover** visible.
4. Reload the page. Status persists; the field stays empty and the page source
   contains no password or ciphertext.
5. **Salvar** with an empty field → **Digite a senha.** (no request sent).
6. Save a different password (replace) → **Atualizada em** changes.
7. Log out and back in → status still **Senha do e-mail salva**.
8. **Remover** → inline **Remover a senha do e-mail salva? O Avuz Conecta vai tentar
   sua senha de login para abrir seu e-mail.** with a red **Remover** and
   **Cancelar** (no modal) → red **Remover**.
   - Expect: **Senha removida.**, status **Nenhuma senha salva**, **Remover**
     hidden, focus in the field. **Cancelar** (or Esc) changes nothing and puts
     focus back on **Remover**.
9. Keyboard only: Tab reaches the field, **Salvar** and **Remover**; Enter in the
   field saves. Opening the confirmation focuses **Cancelar**.
10. Phone width (~360 px): the confirmation text and buttons wrap, nothing
    overflows.
11. Wrong password in the confirmation dialog (save, then remove) →
    **Senha de confirmação incorreta. Tente de novo.** in red. Cancel the dialog
    → no message. After **Senha salva.**, **Remover** → the message is gone.

### API (browser devtools console on any Avuz Conecta page)

```js
const url = OC.generateUrl('/apps/conectamail/api/mailbox-password')
const headers = { 'Content-Type': 'application/json', requesttoken: OC.requestToken }
await (await fetch(url, { headers })).json()                                     // {saved, updated_at}
await (await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ password: 'x' }) })).json()
await (await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ password: '' }) })).json() // 400 password_required
await (await fetch(url, { method: 'DELETE', headers })).json()                   // {saved:false, updated_at:null}
```

- PUT/DELETE return 403 if the password was not confirmed in the last 30 min:
  run the UI flow once first.
- Without the `requesttoken` header: 412 (CSRF check failed). Logged out: 401.

### Confirm `pass_src`

The token is short-lived (60 s); decode it, never paste it into tickets.

1. With a saved password, open `https://<host>/apps/conectamail/sso/webmail` with
   devtools → Network → "Preserve log" on.
2. The 302 `Location` is `<webmail>/api/auth/sso?token=<payload>.<sig>`. Decode
   in the console: `JSON.parse(atob(payload.replace(/-/g,'+').replace(/_/g,'/')))`
   → `pass_src: "mailbox"`.
3. Remove the password, repeat → `pass_src: "login"` (needs a password login in
   this session; after a remember-me/token login there is no login password, so
   the 302 goes to the webmail root without a token).
4. Mailbox login result: the webmail opens the inbox with the saved password.
   A wrong saved password shows the webmail's own error/prompt.

### Limitations

- `updated_at` is null for passwords saved before this card (until re-saved).
- The page does not check the password against the mail server; a wrong
  password is only noticed when the webmail logs in.
- The webmail `postMessage` prompt saves without password confirmation (same as
  before).
- Stale fallback marker edge case above; fix belongs to the webmail.
- Unit tests in `apps/conectamail/tests/Unit/Service/MailboxPasswordTest.php`
  were written but not run in this card.
