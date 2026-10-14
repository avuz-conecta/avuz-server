---
name: verify-avuz-conecta
description: Verify Avuz Conecta (Docker-deployed collaboration suite: Drive, Tarefas/Deck, Agenda, Talk, Conecta Mail, Assinaturas) on a STAGING stack with scripted Playwright or curl. Use after a build/deploy to staging, before a fleet rollout, or to prove a feature or boot behavior (admin 2FA, branding, signatures) works. Never production.
---

# Verify Avuz Conecta

Drives a deployed staging stack the way a user does and writes a PASSED/FAILED report. Feature recipes live in [features/README.md](features/README.md). Read it, then the matching feature file.

## Hard rules

- Staging only. Never production. Refuse any URL not in the table below.
- Never log in on your own. Credentials come from the user as a temporary `chmod 600` file path (e.g. `$AVUZ_VERIFY_CREDENTIALS_FILE`). Read it inside the script. Never print, echo, log, screenshot or commit its contents. Delete it when done. No file given: report the journey as blocked.
- Never touch real mail. Conecta Mail journeys use a dedicated test mailbox only.
- Be gentle on the mail provider (Zoho): minimal logins, few SSOs spaced about 1 minute apart, stop at the first throttling sign (login refusals, 4xx/5xx bursts).
- staging-2 is reserved for the 349 TOTP test. Do not deploy to or drive it unless the hand-off says so.

## Targets

| Name | URL | Notes |
|---|---|---|
| staging-1 | https://conectahml.avuz.app | image `:staging`, default, local-disk storage |
| staging-2 | reserved (349 TOTP test) | image `:staging-2`, hand-off only |
| staging-3 | https://conectahmls3.avuz.app | S3 primary storage |
| webmail | https://conectamail.avuz.app | Conecta Mail, webmail staging stack 64 |

Test only the environment and image tag named in the hand-off.

## Launch

Nothing to start locally; the app is a deployed Docker stack. Getting the right image onto staging is the build/deploy owner's step (`scripts/build-push.sh latest staging`, then `scripts/deploy.sh`), outside this skill. A fresh container takes up to about 6 minutes to boot (migrations, app enables, config sync). Ready means `status.php` reports `"installed":true` and `"maintenance":false`:

```bash
scripts/doctor.sh https://conectahml.avuz.app
```

Paths are relative to this skill's folder. Teardown: none for the app. Remove the credentials file and test data the run created.

## Doctor

`scripts/doctor.sh <base-url>` is read-only and needs no login. It checks: URL on the staging allow-list, `/status.php` HTTP 200 with `installed:true` and `maintenance:false`, and prints the version. Non-zero exit on any failure. Run it first, and again whenever something looks off. If the printed version differs from the hand-off, the stack still runs the old image: stop and report.

## Drive

Scripted Playwright (headless Chromium) for UI, curl for HTTP. Write throwaway scripts outside the repo (`/tmp/avuz-verify-<run>/`).

- Prefer ARIA roles and accessible names (`getByRole`) over CSS selectors. UI language is `pt_BR`: Drive, Tarefas, Agenda, Conversas.
- Login at `<base-url>/login`. Admin accounts must pass TOTP: see [features/admin-2fa.md](features/admin-2fa.md). Use a non-admin test user for features that do not need admin.
- Unauthenticated checks: `curl -sS -o /dev/null -w '%{http_code}'`. Anything needing a session goes through Playwright.
- In-container commands (`occ`) go through `scripts/portainer-exec.sh -u www-data <container> php occ ...` with the staging env file only. Never pass secrets as `--value`: audit logging records every argument.
- Static assets are cached hard (Cloudflare, long immutable cache). A "missing" theme or translation change right after deploy may be the theming cachebuster; check the `?v=` URL changed before declaring FAILED.

## Evidence

Reports go to `~/work/avuz/reports/<name>.md` (e.g. `2026-10-14-admin-2fa.md`). Screenshots and logs sit in `~/work/avuz/reports/<name>/`. The report links them, never pastes them.

Each journey in the report has:

- Result: PASSED or FAILED. FAILED carries a one-line defect.
- Steps run (user actions, in order) with a link to the screenshot or log.
- Target, image tag, and the version doctor printed.

Proof standards: exercise the real user path, not internal endpoints. Capture the action and the resulting state. Verify side effects (stored value, notification, row) with a second view. A skipped entry point is reported as skipped, never as verified through another path. A missing precondition is a FAILED or blocked result with the reason; never weaken the journey. Check screenshots show no tokens, codes or passwords before saving.

## Cleanup

- Delete the credentials file, TOTP seed file and Playwright storage-state files.
- Delete test objects the journey created (cards, events, files) using the account that made them.
- Close the browser context you opened. Kill only processes you started, by PID, never by name.
- Never delete `~/work/avuz/reports/`. Evidence survives cleanup.

## Not covered

Fleet rollout, production checks and disaster restore have their own gated runbooks under `docs/`. Do not use this skill for them.
