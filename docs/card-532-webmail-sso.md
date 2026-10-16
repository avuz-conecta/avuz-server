# Card 532 — Webmail SSO (Avuz Conecta → webmail-avuz)

SSO handover from **Avuz Conecta** to the new webmail (`webmail-avuz`), shipped
in the `conectamail` app. Runs **alongside** the Roundcube flow with its own URL,
secret, token format and audience — Roundcube is untouched.

This doc is the contract the webmail side implements to validate the token.

## Configuration

Stack env (both `portainer-stack.yml` and `portainer-stack-s3.yml`), synced to
app config on every boot by `docker/lib-integrations.sh` → `avuz_configure_conectamail`:

| Env | App config key | Notes |
|-----|----------------|-------|
| `WEBMAIL_AVUZ_URL` | `webmail_avuz_url` | Base URL of the new webmail (no trailing slash needed). Plain. |
| `WEBMAIL_AVUZ_SSO_SECRET` | `webmail_avuz_sso_secret` | HMAC-SHA256 secret, **separate** from Roundcube's `sso_secret`. Sensitive (encrypted at rest). |
| `ROUNDCUBE_CREDENTIAL_KEY` | `credential_key` | **Reused** — the key that encrypts `enc_pass`. Shared so the webmail decrypts the mail password the same way Roundcube does. |
| `CONECTAMAIL_BACKEND` | `mail_backend` | What the Mail menu entry opens: `roundcube` (default) or `webmail`. Plain. See [Mail menu backend](#mail-menu-backend). |

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

The env is the source of truth: the boot rewrites `mail_backend` from
`CONECTAMAIL_BACKEND` (unset → `roundcube`), so a bare `occ config:app:set` is
lost on restart. `/apps/conectamail/sso/webmail` is unchanged.

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

## Security notes

- Tokens live 60s, are signed, and are **never logged** (neither are passwords).
- `enc_pass` is reversible AES-CBC under a static env key — this is password
  vaulting, inherited from the Roundcube design (card 532 approach A). Compromise
  of `ROUNDCUBE_CREDENTIAL_KEY` + the token exposes the mail password.
- The HMAC secret is distinct from Roundcube's, so leaking one webmail's secret
  does not forge tokens for the other.
