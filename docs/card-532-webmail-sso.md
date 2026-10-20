# Card 532 — Webmail SSO (Avuz Conecta → webmail-avuz)

SSO handover from **Avuz Conecta** to the new webmail (`webmail-avuz`), shipped
in the `conectamail` app. Runs **alongside** the Roundcube flow with its own URL,
secret, token format and audience — Roundcube is untouched.

This doc is the contract the webmail side implements to validate the token.

## Configuration

Stack env (both `portainer-stack.yml` and `portainer-stack-s3.yml`), synced to
app config by `docker/lib-integrations.sh` → `avuz_configure_conectamail` on each
configuration run only, not every boot (see [When the env is applied](#when-the-env-is-applied)):

| Env | App config key | Notes |
|-----|----------------|-------|
| `WEBMAIL_AVUZ_URL` | `webmail_avuz_url` | Base URL of the new webmail (no trailing slash needed). Plain. |
| `WEBMAIL_AVUZ_SSO_SECRET` | `webmail_avuz_sso_secret` | HMAC-SHA256 secret, **separate** from Roundcube's `sso_secret`. Sensitive (encrypted at rest). |
| `ROUNDCUBE_CREDENTIAL_KEY` | `credential_key` | **Reused** — the key that encrypts `enc_pass`. Shared so the webmail decrypts the mail password the same way Roundcube does. |
| `CONECTAMAIL_BACKEND` | `mail_backend` | What the Mail menu entry opens: `roundcube` (default) or `webmail`. Plain. Fixed literal in the stack files (no `${...}` interpolation). Applied on configuration runs only. See [Mail menu backend](#mail-menu-backend). |

Feature is **inert** when URL or secret is empty: the token builder returns null,
the embedded page falls back to the webmail root, and the standalone route 404s.

## Token format

```
base64url(payload).base64url(HMAC_SHA256(base64url(payload), WEBMAIL_AVUZ_SSO_SECRET))
```

- `base64url` = standard base64 with `+/` → `-_` and `=` padding stripped.
- The HMAC is computed over the **first segment string** (the base64url payload),
  raw-binary output, then base64url-encoded. (Roundcube uses hex over a plain
  base64 payload — deliberately different so the two tokens can't be confused.)

`payload` (JSON, before base64url):

```json
{
  "v": 1,
  "jti": "<32 hex chars, random 128-bit>",
  "uid": "<Avuz Conecta user id>",
  "email": "<mailbox address>",
  "enc_pass": "<encrypted mail password, see below>",
  "pass_src": "mailbox | login",
  "app_password": "<CardDAV app password, plaintext>",
  "iat": 1760000000,
  "exp": 1760000060,
  "aud": "webmail-avuz"
}
```

- `exp = iat + 60` (60-second TTL).
- `jti` is a fresh random id per token (replay tracking if the webmail wants it).
- `pass_src` says where `enc_pass` came from. Additive field; `v` stays 1.
  - `"mailbox"` — the mailbox password the user saved (`email_enc_password`).
  - `"login"` — no mailbox password saved, so `enc_pass` is the Avuz Conecta
    login password captured at login (`enc_password`). It may not match the
    mailbox. If the IMAP login fails with a `"login"` password, stop using it
    (do not retry on every open, or the mail provider may lock the account) and
    show the webmail's own password prompt. Saving the password there stores
    it as `email_enc_password`, so later tokens carry `"mailbox"`.

## Webmail-side validation (required)

1. Split on `.` → `[payloadSegment, sigSegment]`; reject if not exactly 2 parts.
2. Recompute `base64url(HMAC_SHA256(payloadSegment, secret))` and compare to
   `sigSegment` with a **constant-time** compare (`hash_equals` / `crypto.timingSafeEqual`).
3. base64url-decode `payloadSegment` → JSON.
4. Reject unless `v === 1` and `aud === "webmail-avuz"`.
5. Reject unless `exp > now` (optionally enforce a small clock skew; token is 60s).
6. Optionally reject a replayed `jti` (cache seen ids for ~60s).
7. Decrypt `enc_pass` (below) → the plaintext mailbox password → open the IMAP/SMTP
   session exactly as a normal password login (same shape as webmail-avuz today:
   `session.user = email`, `session.pass = encrypt(password)`).

### Decrypting `enc_pass`

Same scheme Roundcube uses. Key and steps:

```
key   = sha256(ROUNDCUBE_CREDENTIAL_KEY, raw)[0:32]        // 32-byte AES-256 key
blob  = base64_decode(enc_pass)                            // "<b64(ciphertext)>|<b64(iv)>"
ct    = base64_decode(blob.split('|')[0])
iv    = base64_decode(blob.split('|')[1])                  // 16 bytes
inner = AES-256-CBC-decrypt(ct, key, iv)                   // still base64
pass  = base64_decode(inner)                               // plaintext mail password
```

## CardDAV (contacts) — `app_password`

`app_password` is an Avuz Conecta **app password (device token)**, created once
per user and reused (regenerated automatically if the user revokes it). Named
`Conecta Mail (contatos)` in the user's security settings. Use it for CardDAV:

- Endpoint: `https://<avuz-conecta-host>/remote.php/dav/`
- HTTP Basic auth: **username = `uid`** (the `uid` claim, *not* the email),
  **password = `app_password`**.

It is a bearer for DAV only; never send it to the mail server.

## Mail menu backend

`mail_backend` picks what the Mail menu entry (`GET /apps/conectamail/`) opens:

- `roundcube` (default): the Roundcube iframe, as before.
- `webmail`: the new webmail in the same iframe, via SSO — exactly what
  `/apps/conectamail/webmail` renders (same no-mailbox card, webmail origin in
  the page CSP `frame-domain`).
- `webmail` while the webmail is unconfigured (URL or secret empty) → Roundcube.
- Empty, missing or unknown values → Roundcube (trimmed, case-insensitive).

`/apps/conectamail/sso/webmail` is unchanged.

### When the env is applied

`avuz_configure_conectamail` writes `mail_backend` from
`${CONECTAMAIL_BACKEND:-roundcube}` (unset or empty → `roundcube`). It runs from
`apply_avuz_settings` (`docker/entrypoint.sh`), only when `ROUNDCUBE_URL` or
`WEBMAIL_AVUZ_URL` is set, and `apply_avuz_settings` runs only inside
`run_avuz_configuration`. That runs on:

- a fresh install;
- a DB upgrade (`occ status` reports `needsDbUpgrade: true`: core or an app
  version bump);
- a boot where `AVUZ_CONFIG_VERSION` differs from the stamp in
  `data/.avuz_configured` (a new image that bumps it).

Plain restarts skip it ("Avuz configuration up to date, skipping"). So an
`occ` value survives restarts, but the next configuration run resets it to the
env value. The 532 image itself bumps `AVUZ_CONFIG_VERSION` (`33.0.0-22` →
`33.0.0-23`), so its first boot re-syncs from the env too.

### Rollout / switching to the new webmail

Prerequisites for `webmail` mode:

- `WEBMAIL_AVUZ_URL` and `WEBMAIL_AVUZ_SSO_SECRET` set; otherwise the Mail menu
  falls back to Roundcube.
- The webmail's `AVUZ_CONECTA_URL` is this Avuz Conecta host. Its
  `frame-ancestors` and `postMessage` checks accept one origin only.

Two ways to switch. Use the env; add `occ` only to apply it without waiting
for a configuration run.

1. **Env (durable, recommended).** The live stack compose must carry the line
   in the Avuz Conecta service's `environment:` list, as the repo stack files
   do. Edit that line itself to `- CONECTAMAIL_BACKEND=webmail` and redeploy.
   The repo line is a fixed literal, and Portainer passes only the keys the
   compose names, so a Portainer stack variable alone never reaches the
   container (seen on staging-3). The env lands in app config on the next
   configuration run; on a plain restart, also run the `occ` command below once.
2. **occ (immediate).** As www-data in the container:

   ```
   php occ config:app:set conectamail mail_backend --value=webmail
   ```

   Survives plain restarts. The next configuration run (new image with a bumped
   `AVUZ_CONFIG_VERSION`, DB upgrade, fresh install) reverts it to the env
   value, i.e. `roundcube` unless the compose line says `webmail`. On a 532
   rollout, run it after the image's first boot, not before.

Rollback: same paths with `roundcube` (compose line and/or
`occ config:app:set conectamail mail_backend --value=roundcube`).

## Entry points

### Embedded (iframe in Avuz Conecta)

`GET /apps/conectamail/webmail` renders an iframe whose `src` is
`<WEBMAIL_AVUZ_URL>/api/auth/sso?token=<token>` with the webmail origin added to
the page CSP `frame-domain`. Reuses the Roundcube page template + `resize.js`,
including its missing-password `postMessage` path.

### Standalone (own tab)

```
GET /apps/conectamail/sso/webmail?return=<relative-path>
```

- Logged-in only (unauthenticated → normal Avuz Conecta login, then back here).
- Builds a fresh token and **302**s to
  `<WEBMAIL_AVUZ_URL>/api/auth/sso?token=<token>&return=<sanitized>`.
- `return` must be a **relative path** (`/...`). Absolute URLs, `//host`, any
  scheme, backslashes and NUL are dropped (no open redirect). The webmail should
  likewise treat `return` as a relative path only.

## No stored mail password

If the user has no stored mail password yet (`enc_pass` absent — e.g. they logged
in with an app-password/remember-me session, so the raw password was never
captured), no token is minted:

- **Embedded:** iframe loads `<WEBMAIL_AVUZ_URL>/` with no token.
- **Standalone:** 302 to `<WEBMAIL_AVUZ_URL>/[?return=...]` with no token.

In that case the webmail must show its **own** login/prompt (same as Roundcube
today). When the user enters the mail password, the webmail can `postMessage`
`{type:'roundcube-sso-password', password}` to the Avuz Conecta parent frame;
`conectamail` stores it (`POST /apps/conectamail/api/credentials`) as
`email_enc_password`, and the next handover carries `enc_pass`. Users can also
save, replace or remove it in personal settings (card 539,
`docs/card-539-mailbox-password.md`); it survives logout.

## Logout

On Avuz Conecta logout (`BeforeUserLoggedOutEvent`), `WebmailSessionRevoker`
posts `{"token": ...}` to `<WEBMAIL_AVUZ_URL>/api/auth/conecta-logout` with the
`x-webmail-request: 1` header and a 3 s timeout. The token has the same format
and secret, payload `{v:1, jti, uid, iat, exp, aud:"webmail-avuz-logout"}`.
The webmail ends every session its SSO opened for that uid, in any browser.
Mailbox-password logins stay. Failures are logged and never block the logout.
Spec: `docs/superpowers/specs/2026-10-20-webmail-logout-revokes-sessions.md`.

## Security notes

- Tokens live 60s, are signed, and are **never logged** (neither are passwords).
- `enc_pass` is reversible AES-CBC under a static env key — this is password
  vaulting, inherited from the Roundcube design (card 532 approach A). Compromise
  of `ROUNDCUBE_CREDENTIAL_KEY` + the token exposes the mail password.
- The HMAC secret is distinct from Roundcube's, so leaking one webmail's secret
  does not forge tokens for the other.
