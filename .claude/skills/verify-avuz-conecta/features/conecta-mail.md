# Conecta Mail

Conecta Mail is the webmail (Roundcube) reached from the main app. The `conectamail` app embeds the webmail in an iframe and stores the webmail URL and encrypted SSO secrets from the stack env.

## Sub-features

- `mail-menu` a `Mail` entry appears in the top navigation when configured.
- `mail-sso` choosing it opens the webmail already signed in, in the test mailbox.
- `mail-config` the app is enabled and points at the webmail URL.

## How to get to it (user POV)

- Top navigation, link `Mail` (`/apps/conectamail/`). The accessible name is "Mail", not "Conecta Mail".
- Direct webmail URL `https://conectamail.avuz.app` (login page only).

## Driving it with Playwright and curl

Preconditions:

- `scripts/doctor.sh https://conectamail.avuz.app` passes (HTTP 200; verified 2026-10-14).
- A dedicated TEST user and test mailbox exist and the credentials file names them. If not, run only the read-only steps and report the SSO step as blocked.

- **Config.** `scripts/portainer-exec.sh -u www-data <container> php occ config:app:get conectamail roundcube_url`. Expect the webmail URL. Do not read `sso_secret` or `credential_key`; they are secrets. Unverified (no container access in the 2026-10-14 run).
- **Menu.** Log in as a regular user. Expect `getByRole('navigation', { name: 'Menu de aplicativos' }).getByRole('link', { name: 'Mail' })`. Verified.
- **App opens.** Click it once. The page becomes `/apps/conectamail/`, title "Mail - Avuz Conecta", and the page holds an iframe at `https://webmail-staging.avuz.app/` (not `conectamail.avuz.app`: the stack's configured URL differs from the direct URL in Targets). Verified.
- **SSO.** On staging-1 the user `bri-cal455` has no mailbox: the iframe shows the "ConectaMail" login form (fields `Usuário`, `Senha`, button `ENTRAR`), not an inbox. Nothing typed. SSO to an inbox: UNVERIFIED (no test mailbox). Report PASSED for SSO only when the inbox rendered without a password prompt.
- **Proof.** Screenshot of the page (the login form is safe; with an inbox, cover the subjects). The occ output file when available.

## Gotchas

- Zoho throttles. Do at most one SSO per run, spaced at least 1 minute from any earlier mail login. Opening the app is the trigger. Stop on any refusal and report it, do not retry.
- Never open, send, move or delete real mail. Never use a real user's mailbox. Never type into the webmail login form.
- Secrets are encrypted at rest; reading them through the app config API returns ciphertext and is not a valid check.
- Webmail staging stack 64 is a separate stack from the main app; a healthy main app says nothing about it. Run doctor on both.
