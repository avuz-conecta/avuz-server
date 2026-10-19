# ConectaMail SSO — production rollout (app3 → conectamail.avuz.app)

Card 532 (+ 539). Turns on "Login com Avuz Conecta" between app3 prod and the
prod webmail. Contract: `docs/card-532-webmail-sso.md`. Status: **executed 2026-10-19** (approved by Patrick). See [Result](#result-2026-10-19).

## Current state (read 2026-10-19)

| Side | Stack | State |
|------|-------|-------|
| app3 | `avuz-app3` id 14, endpoint 6 | Image `avuzconecta:2026.10.18-ccb7b8d` = `avuz-customization` @ `ccb7b8d0083`. Already ships `conectamail` 1.2.6 with #7 (SSO), #8 (mailbox password, `pass_src`) and #11 (no-mailbox card). Config stamp `33.0.0-24`. Compose carries `ROUNDCUBE_*` inline, no `WEBMAIL_*` lines. |
| app3 (stale) | `avuz-app3` id 13, endpoint 4 | Container-less duplicate. Not touched. |
| webmail | `webmail-avuz` id 98, endpoint 5 | `TAG=7398e69`. Compose already maps `AVUZ_CONECTA_URL`, `WEBMAIL_AVUZ_SSO_SECRET`, `ROUNDCUBE_CREDENTIAL_KEY` from stack variables; the variables are missing, so SSO is off. |

**No new image is needed on either side.** Only env and app config change.

### Finding: staging holds the prod mail keys

app3's `ROUNDCUBE_CREDENTIAL_KEY` and `ROUNDCUBE_SSO_SECRET` hash the same as
staging-3 (stack 63) and the staging webmail (stack 64). The prod webmail must use
app3's credential key, because it decrypts `enc_pass` that app3 encrypted. So the
"new prod values" rule in webmail `PROD-RELEASE-PLAN.md` cannot apply to that key.
Rotating the prod key would invalidate every stored mail password on app3 and
break prod Roundcube SSO. Fix the other side instead: rotate staging's keys
(follow-up, not part of this rollout).

`WEBMAIL_AVUZ_SSO_SECRET` gets a **new** prod value. It is never reused from staging.

## Why app config needs a manual step

`avuz_configure_conectamail` copies env into app config only on a configuration
run (fresh install, DB upgrade, `AVUZ_CONFIG_VERSION` change). A redeploy with the
same image skips it. Staging-3 hit exactly this: `webmail_avuz_url` still pointed
at prod after its env changed. So after the app3 redeploy we write the two keys
ourselves, and the env lines keep the next configuration run from wiping them.

The secret is written by PHP reading the container env (`IAppConfig::setValueString(..., sensitive: true)`),
never as an `occ --value` argument, which `admin_audit` would log. Method tested on staging-3.

## Steps

Order: app3 first. app3's Mail menu stays on Roundcube (`CONECTAMAIL_BACKEND` unset),
so a half-configured app3 is invisible to users. Doing the webmail first would show
an "Entrar com Avuz Conecta" button that fails.

0. **Backup.** Save stack 14 and stack 98 (compose + variables) to the scratchpad. Note app3's container image id.
1. **Secret.** Generate `WEBMAIL_AVUZ_SSO_SECRET` locally (`openssl rand -hex 32`, 64 chars) into a `0600` scratchpad file. Never printed.
2. **app3 stack 14** — add to the app service `environment:`, next to the `ROUNDCUBE_*` lines:
   ```
   - WEBMAIL_AVUZ_URL=https://conectamail.avuz.app
   - WEBMAIL_AVUZ_SSO_SECRET=<new secret>
   ```
   Same image tag, `PullImage: false`, env preserved. **Recreates the app3 container** (plain boot, about 1–3 min of unavailability).
3. **app3 app config** (as www-data, after healthy):
   - `occ config:app:set conectamail webmail_avuz_url --value=https://conectamail.avuz.app` (plain value).
   - PHP setter for `webmail_avuz_sso_secret` from the env (sensitive).
   - Check: env hash = app config hash; `mail_backend` still `roundcube`; `credential_key` hash unchanged.
4. **webmail stack 98** — add stack variables, same `TAG=7398e69`, `PullImage: false`:
   - `AVUZ_CONECTA_URL=https://app3.avuz.app`
   - `WEBMAIL_AVUZ_SSO_SECRET=<new secret>`
   - `ROUNDCUBE_CREDENTIAL_KEY=<copied from stack 14>`
   Check: `/api/health` 200; CSP `frame-ancestors` includes `https://app3.avuz.app`; container env hashes = app3's.
5. **Smoke test** (Patrick logs in to app3; Claude drives):
   - garbage/forged token → `/?sso=failed`;
   - iframe `https://app3.avuz.app/apps/conectamail/webmail` opens the inbox;
   - `https://conectamail.avuz.app` → "Entrar com Avuz Conecta" → back logged in;
   - user with no saved mailbox password → webmail prompt, then later handovers carry `pass_src: mailbox`.

## Rollback

- webmail: blank the three variables and redeploy stack 98 (password login keeps working).
- app3: `occ config:app:set conectamail webmail_avuz_url --value=` makes the feature inert at once. Remove the two env lines at the next app3 redeploy.
- No data migration in either direction. Roundcube is untouched throughout.

## Decisions

- **539 logout:** logout clears only the captured login password; a saved mailbox
  password stays until the user removes it in Configurações pessoais → ConectaMail
  (behaviour shipped in #8). Recommendation: keep.

## Result (2026-10-19)

Staging retest (staging-3 → conectamailhml), done headless (no browser login available):
the app's own `WebmailTokenService` minted tokens inside the container and the
webmail was called with them.

- `patrick` (saved mailbox password): `pass_src=mailbox`, `/api/auth/sso` 302 → `/`, cookie `HttpOnly; Secure; SameSite=None`, `/api/auth/me` 200. Replay → `/?sso=failed`.
- `bri-fallback` (login password only, wrong for the mailbox): first token → `mail_login_failed`; second fresh token → `login_password_rejected` with no IMAP attempt (no lockout loop).
- No stored password → iframe URL is the webmail root, no token.
- Garbage, missing and forged-signature tokens → `/?sso=failed`.
- Standalone `SsoController::webmail()` → 302 with token; `return=/inbox` kept, `https://evil.example/x` and `//evil.example` dropped.
- Iframe page CSP `frame-src` = webmail origin; webmail `frame-ancestors` = Avuz Conecta origin.
- Found and fixed: staging-3 `webmail_avuz_url` still pointed at prod after its env changed (no configuration run). Set via occ.

Prod:

- app3 stack 14 redeployed 10:51 BRT (same image), healthy after ~90 s. App config written; env = app config = local secret (hash `3e9492cb…`); `credential_key` unchanged (`45391f60…`); `mail_backend=roundcube`.
- webmail stack 98 redeployed 10:54 BRT (same `TAG=7398e69`), healthy in 10 s. Env hashes equal app3's. `/api/auth/sso-config` → `https://app3.avuz.app/apps/conectamail/sso/webmail`. `frame-ancestors 'self' https://app3.avuz.app`.
- End to end with Patrick's app3 account (`pass_src=login`): 302 → `/`, `/api/auth/me` 200 `patrick@avuz.cloud`; replay rejected.
- Patrick clicked through both in a browser: the iframe inside app3 and the "Entrar com Avuz Conecta" button. Both worked.

### Later the same day: webmail image

Slow first inbox loads (10–11.5 s) were not caused by SSO. They came from webmail PR #27 (date sort reads every inbox Date header, because Zoho has no IMAP SORT). Fixed in webmail-avuz PR #34 (`5cbed75`). Stack 98 now runs `TAG=f0c4a5e` (same code as that `main`); inbox list 2.3 s after a fresh login. Webmail rollback: `TAG=7398e69` (no migration). The SSO variables are unchanged.

Backups of both stacks (with secrets) and the new secret stay in the session scratchpad only.

## Mail menu switched to ConectaMail on app3 (2026-10-19, 14:43 BRT)

Approved by Patrick. app3's Mail menu entry now opens ConectaMail in the iframe (SSO) for every app3 user, instead of Roundcube.

- Stack 14 compose: `- CONECTAMAIL_BACKEND=webmail` added after `WEBMAIL_AVUZ_SSO_SECRET` (durable across configuration runs). Same image; container recreated, healthy after ~80 s.
- `occ config:app:set conectamail mail_backend --value=webmail` (no configuration run on the same image).
- Check: `MailBackend::effective()` = `webmail`; `PageController::index()` for `patrick@avuz.cloud` renders the iframe to `https://conectamail.avuz.app/api/auth/sso` with a token; page `frame-src` = `https://conectamail.avuz.app`.
- Users at switch time: 6 active, all `@avuz.cloud` (matches webmail `ALLOWED_DOMAINS`); 4 with a saved mailbox password, 2 with only the captured login password (may see the webmail password prompt once).
- Rollback: `occ config:app:set conectamail mail_backend --value=roundcube` (instant), then set the compose line to `roundcube` at the next app3 redeploy. Roundcube stays up at `webmail-01.avuz.app`.
