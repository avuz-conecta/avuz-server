# Conecta Mail

Conecta Mail is the webmail (Roundcube) reached from the main app through single sign-on. The `conectamail` app stores the webmail URL and encrypted SSO secrets from the stack env.

## Sub-features

- `mail-menu` a Mail entry appears in the top navigation when configured.
- `mail-sso` choosing it opens the webmail already signed in, in the test mailbox.
- `mail-config` the app is enabled and points at the webmail URL.

## How to get to it (user POV)

- Top navigation, `Conecta Mail` (the Mail icon).
- Direct webmail URL `https://conectamail.avuz.app` (login page only).

## Driving it with Playwright and curl

Preconditions:

- `scripts/doctor.sh https://conectamail.avuz.app` passes.
- A dedicated TEST user and test mailbox exist and the credentials file names them. If not, run only the read-only steps and report the SSO step as blocked.

- **Config.** `scripts/portainer-exec.sh -u www-data <container> php occ config:app:get conectamail roundcube_url`. Expect the webmail URL. Do not read `sso_secret` or `credential_key`; they are secrets.
- **Menu.** Log in as the test user. Expect a navigation link for Conecta Mail. Screenshot.
- **SSO.** Click it once. Expect the webmail inbox view of the test mailbox without a second password prompt. Screenshot the mailbox list with message subjects covered or the test mailbox only.
- **Proof.** Screenshots and the occ output file. Report PASSED only when the inbox rendered via SSO.

## Gotchas

- Zoho throttles. Do at most one SSO per run, spaced at least 1 minute from any earlier mail login. Stop on any refusal and report it, do not retry.
- Never open, send, move or delete real mail. Never use a real user's mailbox.
- Secrets are encrypted at rest; reading them through the app config API returns ciphertext and is not a valid check.
- Webmail staging stack 64 is a separate stack from the main app; a healthy main app says nothing about it. Run doctor on both.
