# Assinaturas: handoff (2026-10-14)

Read this first if you are picking up the Assinaturas work.

## Status in one minute

- **Assinaturas 0.8.8** runs on **conecta-2** staging (`:staging-2`) and is healthy. QA (Grok Bot) has passed everything through 0.8.7. The 0.8.8 notifications have not been tested yet.
- **Production:** nothing has shipped. **Plan 5** (app3 pilot, then the fleet) is **on hold** until Patrick says go. Every production build, deploy or exec needs his explicit go, per action.
- **Code:** app `main` = `6b75d60` (0.8.8), pushed. avuz-server `origin/avuz-customization` pins `apps/assinaturas` at `6b75d60`.
- **Nothing is running and no work is half done.** The open items wait on Patrick (see "Open items").

## What the product is

"Assinaturas" is Avuz's own e-signature app inside AvuzConecta, a white-labelled Nextcloud 33.

- **Provider:** **ZapSign** API v1. The UI never names ZapSign, an AI provider, or "Nextcloud". The product is "Avuz Conecta".
- **Users** send envelopes (PDF documents + signers + fields) and follow their signing status.
- **Paid add-on:** contract management, with an optional AI reading of contract dates.
- **Language:** pt_BR UI; English source strings translated in `l10n/pt_BR.{json,js}`.

## Where things live

| What | Where |
|---|---|
| App repo | `~/work/avuz/assinaturas` (GitHub `avuz-conecta/assinaturas`, branch `main`; built `js/` + `css/` committed) |
| Image repo | `~/work/avuz/avuz-server`, branch `avuz-customization` (the "main" branch). Submodule `apps/assinaturas`. |
| Worktree used for this work | `avuz-server/.claude/worktrees/avuzconecta-signature-feasibility-59ecdd`, branch `claude/avuzconecta-signature-feasibility-59ecdd`. It merges into `avuz-customization` in the primary checkout. |
| Specs | `avuz-server/docs/superpowers/specs/2026-09-28-assinaturas-zapsign-design.md` and the four `2026-10-07-assinaturas-*-design.md` specs: theme color, signer contacts, folders and managers, contracts |
| Plans | `avuz-server/docs/superpowers/plans/*assinaturas*` (roadmap, plans 1–4, 6–10) |
| Progress ledger (every task, decision, deferred minor) | `assinaturas/.superpowers/sdd/progress.md` (gitignored; per-plan briefs and reports in `.superpowers/sdd/plan-*/`) |
| API reference | `assinaturas/docs/api.md` |
| Tenant provisioning runbook | `avuz-server/docs/assinaturas-tenant-runbook.md` |
| Image integration | `avuz-server/docker/lib-assinaturas.sh`, `docker/assinaturas-worker.sh`, `docker/lib-integrations.sh` (`avuz_sync_llm_provider_switch`) |
| Project rules | `avuz-server/CLAUDE.md` ("Assinaturas" section) |

## What was built

| Plan / version | Feature |
|---|---|
| 1–4 (0.1–0.4) | **Core.** ZapSign client, envelope lifecycle (draft → sending → pending → completed/cancelled/refused/expired/failed), the dedicated job worker for `SendJob` + `SyncEnvelopeJob`, webhooks, wizard (Documentos → Signatários → Campos → Revisão), envelope page, dashboard, Files sidebar, admin page (health, usage), white label, account branding. |
| 6 | **Theme color.** Buttons in the Avuz theme color everywhere. |
| 7 | **Signer contacts.** Signers are suggested from the user's AvuzConecta contacts and can be saved back to them. |
| 8a/8b (0.6.0) | **Folders and managers.** Nested, shareable envelope folders with Ver/Editar/Compartilhar/Gerenciar rights, inherited down the tree (Deck-like). Managers group `assinaturas-admins` sees and acts on everything. Members group: `assinaturas`. Drafts are private to their owner. |
| 9 (0.7.0) | **Contracts core (paid add-on).** Per-document contract terms in a wizard **Contrato** step. CPF/CNPJ validation, including the alphanumeric CNPJ. On completion, terms become a contract. Contract card actions: Editar, Renovar, Renovar com novo documento (renewal chain), Encerrar. **`ContractLifecycleJob`** (every 12 h): alerts, auto-renewal, expiry. Version token (`expectedUpdatedAt`) against stale edits. |
| 10 (0.8.0) | **AI + Contratos screen.** "Ler contratos com IA" reads PDF text in the browser and sends it to AvuzConecta task processing (`core:text2text`; integration_openai + OpenRouter). Validated suggestions are marked "Sugerido pela IA". The text is never stored, and the task is deleted on every path. **Contratos screen** at `/apps/assinaturas/contracts`: filters, scopes, totals, phone cards. |
| 0.8.0 settings move | **Admin-only switches.** "Gestão de contratos contratada" and "Ler contratos com IA" live only on `/settings/admin/assinaturas`. Only AvuzConecta admins (Avuz staff) can change them. **AI is ON by default** once the add-on is on and an AI key exists. Uso is usage-only. |
| 0.8.1–0.8.7 | **QA polish.** "Vigentes" wording; scan detection (per-page text floor); totals label wrap; folder-picker dialog with tree + "Nova pasta"; switch/label alignment; field errors shown on leave (CPF/CNPJ); Pastas sidebar aligned with the menu; loading skeletons + busy buttons; no refresh bar; skeleton overflow fix. |
| 0.8.8 | **Expiry/renewal notifications.** Bell notifications for **Vencido** and **Renovado automaticamente** go to the same recipients as "vence em X dias", once per contract and event (deduplicated on the timeline event key). |

### Contract alerts: who, what, how
- **Recipients:** the envelope owner, users with Editar on its folder, and members of `assinaturas-admins`. Each must be able to use the app and see the envelope. AvuzConecta admins are **not** recipients by role.
- **Events:**
  - "vence em N dias / amanhã / hoje": default offsets `[90, 30, 7, 0]`.
  - "prazo de aviso termina…": auto-renewing contracts with a notice period.
  - "venceu".
  - "renovado automaticamente até …".
- **Channels:**
  - The bell.
  - Email only through the notifications app's digest of **unread** notifications (default every 3 h). The user needs an email address.
- **Run the job on demand on conecta-2:**
  ```bash
  ./scripts/portainer-exec.sh -u www-data avuz-conecta-2-app-1 php occ background-job:execute 138250006964449280 --force-execute
  ```
  Ask Patrick before running it.

## Environments and deploy

- **conecta-2** (Portainer endpoint 3, stack 46, image `registry.avuz.app/admin/avuzconecta:staging-2`) is the Assinaturas pilot. ZapSign is **sandbox** there. Staging is autonomous; production is gated.
- **Release recipe** (app repo):
  1. Branch off `main` and do TDD.
  2. Bump `appinfo/info.xml`. **Always bump: browsers cache js by version.**
  3. `npm run build`, commit `js/` + `css/`.
  4. Fast-forward `main` and push.
  5. In the worktree: `git -C apps/assinaturas checkout <sha>`, commit the pin, then merge into `avuz-customization` in `~/work/avuz/avuz-server`.
  6. Update the submodule.
- **Build:** run this first. **The Docker disk fills up on every build**: each build adds 20–30 GB of cache. A full disk once crashed the local test DB, and once a failed build silently redeployed the old image.
  ```bash
  curl -s --unix-socket ~/.docker/run/docker.sock -X POST "http://localhost/build/prune?all=true"
  docker image prune -f
  ```
  Then build:
  ```bash
  KEEP_DOCKER=1 ./scripts/build-push.sh latest staging 2
  ```
  Deploy **only if the log contains "Successfully pushed"**: `build-push.sh` can exit 0 on failure.
- **Deploy:**
  1. Prune dangling images on the host.
  2. Pull with an explicit `X-Registry-Auth`, using credentials from `docker-credential-desktop`. Never echo them.
  3. Run `PORTAINER_ENV_FILE=$PWD/scripts/deploy.env ./scripts/deploy.sh -y avuz-conecta-2`.
  4. Poll the container's `StartedAt` and health.
  5. Verify `occ app:list` shows the new version and `needsDbUpgrade:false`.

  The script lived in a session scratchpad; recreate it from this recipe.
- **Never** `tail /proc/1/fd/1` through Portainer exec: it hangs forever.

## Testing

- **Frontend:** `npm run typecheck && npm run lint && npm test` (about 2,940 Vitest tests).
- **Backend:** `composer run lint` and `tests/env/phpunit.sh` (about 1,490 tests, roughly 20 min).
  - **Reset guard before every phpunit run:** `cat ~/.assinaturas-test-image-id` must equal `docker image inspect avuzconecta:latest --format '{{.Id}}'`. If they differ, phpunit.sh silently runs `reset.sh` and wipes the local DB. **Never run reset.sh without Patrick.**
  - **Login-based tests:** they fail if the local DB says Assinaturas needs an upgrade. Fix: `occ upgrade`.
    - If it fails on stale bundled apps (`bruteforcesettings`, `files_downloadlimit`, `notifications`, `text`): disable each, upgrade, then `app:enable --force` each.
    - After an upgrade, reset `contacts` installed_version to 8.4.1.
  - **Test containers:** `assinaturas-test-db`, `assinaturas-test-redis`. Start them if they are stopped.
- **UI checks:** Patrick's QA bot ("Grok Bot") tests the UI on conecta-2. Don't run manual or browser tests unless asked.

## Open items (waiting on Patrick)

1. **QA of 0.8.8 notifications.** Needs a *new* contract that has already ended: one without renewal, one with. The old test contracts won't re-notify. Then run the job.
2. **Alert emails for `patrick`** (patrick@avuz.cloud, an AvuzConecta admin). He gets alerts only as owner, folder editor or a member of `assinaturas-admins`. Option: add him to `assinaturas-admins`.
   - Test users on conecta-2 have no real email: `admin` = teste@zammad.tst, `manager-not-admin` has none. **Don't change anyone's email.**
   - On 2026-10-10..14 the shared ZeptoMail SMTP account ran out of credits; check it before blaming the app.
3. **ZapSign CPF instead of email code:** parked by Patrick.
   - Finding: a **typed** signature ("Assinar com Digitar") always forces an email/SMS code. That is a ZapSign account rule, confirmed with sandbox doc `694a22cb…`, which ended as `email_otp`.
   - ZapSign's Receita CPF check (`validate_cpf`) always asks for the birth date.
   - Options:
     - turn off "Digitar" account-wide (draw/upload only, no code, plus `validate_cpf`);
     - keep the code and add CPF as an extra factor;
     - ask ZapSign support for a per-document switch.
4. **Plan 5:** app3 production pilot, then fleet rollout. On hold.

## Known behaviour and backlog (not bugs unless Patrick says so)

- **Renewal date:** the auto-renewal notification shows the date as dd/mm/yyyy for every locale.
- **Stale alerts:** old "vence em" notifications stay in the bell after expiry or renewal.
- **Wizard Contrato step:** it runs before Signatários, so the counterparty isn't pre-filled from signers on the first pass. AI reading usually fills it.
- **Loading:**
  - Opening a draft briefly shows the envelope-page skeleton.
  - On a cold cache, focus doesn't land on the folder picker tree.
- **QA follow-ups, never done:**
  - no Contrato summary on Revisão;
  - "já há renovação" shows only after picking a file;
  - renewal banner only on the Contrato step.
- **Deferred minors** per task are listed in the ledger (`progress.md`).

## Working rules (Patrick)

- **Commits:** conventional; **no AI attribution / Co-Authored-By lines**. Don't push the image repo branches without reason; the app `main` is pushed on release.
- **Language:** reply in English. App copy is pt_BR. Say "AvuzConecta" (UI: "Avuz Conecta"), never "Nextcloud", and never name ZapSign or AI providers to users.
- **Process:** spec-first for non-trivial features. Run subagent-driven plans with a review after each task.
- **Reports:** Patrick's requests usually end with "Blocked on me / Changed / On you". Answer in that shape.
- **Privacy:** never print or log tokens, sign URLs, credentials or contract text.
