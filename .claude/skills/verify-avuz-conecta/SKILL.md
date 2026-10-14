---
name: verify-avuz-conecta
description: Verify Avuz Conecta (Docker-deployed collaboration suite: Drive, Tarefas/Deck, Agenda, Talk, Conecta Mail, Assinaturas) on a STAGING stack with scripted Playwright or curl. Use after a build/deploy to staging, before a fleet rollout, or to prove a feature or boot behavior (admin 2FA, branding, signatures) works. Never production.
---

# Verify Avuz Conecta

Drives a deployed staging stack the way a user does and writes a PASSED/FAILED report. Feature recipes live in [features/README.md](features/README.md). Read it, then the matching feature file.

## Hard rules

- Staging only. Never production. Refuse any URL not in the table below.
- Never log in on your own. Credentials come from the user as a temporary `chmod 600` file path (e.g. `$AVUZ_VERIFY_CREDENTIALS_FILE`). Read it inside the script. Never print, echo, log, screenshot or commit its contents. Delete it only if the hand-off says to. No file given: report the journey as blocked.
- Never touch real mail. Conecta Mail journeys use a dedicated test mailbox only.
- Be gentle on the mail provider (Zoho): minimal logins, few SSOs spaced about 1 minute apart, stop at the first throttling sign (login refusals, 4xx/5xx bursts).
- staging-2 is the pilot stack (often busy, admin TOTP enforced). Drive it only when the hand-off names it.
- Stop and ask on any 5xx from a user action, any TOTP setup page, or a rejected TOTP code. Never retry a TOTP code.

## Targets

| Name | URL | Notes |
|---|---|---|
| staging-1 | https://conectahml.avuz.app | image `:staging`, default, local-disk storage |
| staging-2 | https://conectahml2.avuz.app | image `:staging-2`, pilot; Deck 1.18.96 on 2026-10-14 (older than staging-1) |
| staging-3 | https://conectahmls3.avuz.app | S3 primary storage |
| webmail | https://conectamail.avuz.app | Conecta Mail, webmail staging stack 64 |

Test only the environment and image tag named in the hand-off.

Every recipe takes the host as a variable: export `AVUZ_BASE_URL` (one row of the table) and use `${AVUZ_BASE_URL}` in curl and scripts. Never hard-code a host, a user id or a board id; read the user id from `GET /ocs/v2.php/cloud/user?format=json` (`ocs.data.id`) and board ids from the boards API. Values that differ per stack (Deck version, color, navigation, which users exist) are read from the stack, not copied from this skill.

## Launch

Nothing to start locally; the app is a deployed Docker stack. Getting the right image onto staging is the build/deploy owner's step (`scripts/build-push.sh latest staging`, then `scripts/deploy.sh`), outside this skill. A fresh container takes up to about 6 minutes to boot (migrations, app enables, config sync). Ready means `status.php` reports `"installed":true` and `"maintenance":false`:

```bash
scripts/doctor.sh "$AVUZ_BASE_URL"
```

Paths are relative to this skill's folder. Teardown: none for the app. Remove the credentials file and test data the run created.

## Doctor

`scripts/doctor.sh <base-url>` is read-only and needs no login. It checks: URL on the staging allow-list, `/status.php` HTTP 200 with `installed:true` and `maintenance:false`, and prints the core version and the Deck version. Non-zero exit on any failure. Run it first, and again whenever something looks off.

Pass the hand-off's Deck version as the 2nd argument (`scripts/doctor.sh "$AVUZ_BASE_URL" 1.18.100`): a mismatch exits non-zero, which means the stack still runs the old image. Stop and report.

The Deck version comes from `<base-url>/apps/deck/appinfo/info.xml` (`<version>`), readable without login. Verified 2026-10-14: staging-1 `1.18.100`, staging-2 `1.18.96` (same core `33.0.8` on both). Anonymous OCS capabilities do not list `deck`; logged in, `capabilities.deck.version` does, and also matches (checked on both). Core `versionstring` is not the Deck or image version. The allow-list in `doctor.sh` holds staging-1, staging-2, staging-3 and the webmail; the staging-2 pass was checked with curl only (status.php, info.xml), not by running the script.

## Drive

Scripted Playwright for UI, curl (or Node `fetch`) for HTTP. Write throwaway scripts outside the repo (`/tmp/avuz-verify-<run>/`).

- Browser: the cached Playwright browsers do not match the installed Playwright (`chromium_headless_shell-...` missing). Launch system Chrome: `chromium.launch({ channel: 'chrome' })`. Do not `npm install`.
- Talk breaks under the default `HeadlessChrome` user agent: it shows a "browser not fully supported" banner and the composer stays on "Entrando na conversa...". Create the context with a plain Chrome `userAgent` string (no `Headless`) for Talk.
- One login per run. After the login, save `context.storageState({ path })` and open later scripts with `newContext({ storageState })`. Delete the state file at the end.
- Read the password inside the script only (`fs.readFileSync(process.env.<FILE_VAR>, 'utf8').trim()`), only to fill the field. Never print or screenshot it. Never type into a password-change field or the "Autenticação necessária" dialog (stray header icons open it).
- Login form: `input[name="user"]` (label "Nome da conta ou e-mail"), `input[name="password"]` (label "Senha"), `button[type="submit"]`. Wait for the URL to leave `/login`; a regular user lands on `/apps/dashboard/`. An admin lands on `/login/challenge/totp` first (verified on staging-2): the code field is `input[name="challenge"]` (`autocomplete="one-time-code"`); submit once, then the browser lands on `/apps/dashboard/`. Wait for the URL, then `storageState` as usual. The admin's display name is a person's name, not the login id.
- Logout: avatar button (accessible name "Menu de configurações"), then link "Sair". Lands on `/login?clear=1`; opening `/apps/deck/` then redirects to `/login?redirect_url=/apps/deck/`.
- Novidade hints: a fresh account gets a queue of about 10 one-time popovers (`.feature-hint`, button "Entendi") that block clicks until dismissed. Run a dismiss loop after each navigation to Tarefas (see [features/drive-and-tarefas.md](features/drive-and-tarefas.md)). An account that already dismissed them sees none.
- Prefer ARIA roles and accessible names (`getByRole`) over CSS selectors. UI language is `pt_BR`. Navigation link names: Painel, Talk, Drive, Atividade, Contatos, Calendário, Tarefas, Mail, Formulários (`Assinaturas` between Mail and Formulários, only for members and admins; staging-2 admin sees it, staging-1 non-member does not). There is no "Agenda", "Conversas" or "Conecta Mail" link.
- Popover menus are often not exposed as `menuitem` (Deck card and board menus): use `getByText('<label>', { exact: true })`. Drive row menus and time-entry menus do expose `menuitem`.
- Deletes open a confirm dialog (`role=dialog`, buttons "Cancelar" / "Excluir"; Talk uses "Não" / "Sim"). Dialogs stack: use `getByRole('dialog').last()`.
- Login at `<base-url>/login`. Admin accounts must pass TOTP: see [features/admin-2fa.md](features/admin-2fa.md). Use a non-admin test user for features that do not need admin.
- Admin accounts add the avatar-menu entries `Configurações de administração`, `Aplicativos`, `Contas`. Viewing admin pages (`/settings/admin/security`, `/settings/admin/theming`, `/settings/admin/assinaturas`) is read-only as long as you click nothing; never click Salvar, Ativar, Desativar or Habilitar there.
- Anything that fires a 5xx on a user action (seen: Talk room create on staging-2) is a stop-and-ask, not a retry.
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

- Delete TOTP seed files and Playwright storage-state files. Delete the credentials file only if the user says it is yours to delete; never delete one the user owns.
- Delete test objects the journey created (cards, events, files, conversations) using the account that made them. Name them `[teste <user>] <run>` so they are easy to find.
- Tarefas boards are soft-deleted: the UI hides them, but `GET /index.php/apps/deck/api/v1.0/boards` still lists them with `deletedAt` set until Deck purges. Report that as the remaining state; no hard delete exists in the UI.
- Log out at the end (see Drive).
- Close the browser context you opened. Kill only processes you started, by PID, never by name.
- Never delete `~/work/avuz/reports/`. Evidence survives cleanup.

## Not covered

Fleet rollout, production checks and disaster restore have their own gated runbooks under `docs/`. Do not use this skill for them.
