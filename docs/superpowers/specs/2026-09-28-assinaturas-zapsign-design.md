# Assinaturas — ZapSign e-signature app for AvuzConecta

**Date:** 2026-09-28 (revised after adversarial review, same day)
**Status:** Design approved in brainstorming and grilled; pending written-spec review
**Provider:** ZapSign (sandbox access granted). API reference: [`docs/zapsign/api-digest.md`](../../zapsign/api-digest.md)
**Background:** [`2026-09-09-avuzconecta-signature-feasibility.md`](2026-09-09-avuzconecta-signature-feasibility.md)

---

## 1. Goal

Add a Nextcloud app, **Assinaturas**, to AvuzConecta. It is a dashboard for sending envelopes of Drive files to ZapSign and tracking each one until it's signed.

- Users can start from the Files app.
- Once an envelope is at ZapSign, its lifecycle lives in the app.
- Signed PDFs land back in Drive next to their originals.

### Billing model

This is the design driver.

- ZapSign bills per **envelope**: one or more files sent to the same set of signers. Different signers means a different envelope.
- Avuz resells to tenants as a **fixed monthly fee plus a per-envelope charge**.
- The app therefore treats the envelope as its core object and reports envelope usage.
- The billing source of truth is ZapSign's partner usage CSV (`envelopes_created` per tenant sub-account). The in-app counter is for visibility only.

### Decisions

| Topic | Decision |
|---|---|
| Account model | Avuz is the ZapSign **partner/master** account. Each tenant has **one sub-account** with its own API token. |
| Token delivery | Portainer **stack env vars**. The entrypoint syncs them to encrypted app config on **every boot**. |
| Access | Nextcloud group id `assinaturas`, display name **"Avuz Assinaturas"**, auto-created. Members and Nextcloud admins can use the app. Enforcement happens in the app (see §7). |
| Visibility | Users see their own envelopes. Admins see all of the tenant's envelopes. Owners keep read access to their own envelopes after leaving the group. |
| Admin powers on others' envelopes | View, download, cancel, remind. **"Copiar link" is owner-only** and audited. |
| Signed files | Saved **next to each original** as `<name> (assinado).pdf`, including when the folder is shared with the sender. |
| Signer delivery (v1) | ZapSign email link. |
| Signature placement | **Visual placement editor in v1.** `<<signerN>>` anchors are also honored. With no placement, ZapSign's report page is used. |
| Branding | **Avuz Conecta** brand. The sender and the tenant company name appear in the message. |
| Signers can refuse | Yes, with a required reason. |
| Cost control | No hard cap. Usage counter in the admin panel. Non-paying tenants are blocked via the partner API. |
| Retention | Minimized signer data is kept for as long as the envelope exists. Admins can delete an envelope to serve data-subject requests. No raw provider payloads are stored. |
| Architecture | Native Nextcloud app in its own repo, `avuz-conecta/assinaturas`, added as a submodule at `apps/assinaturas`. |

---

## 2. Scope

### v1

- Send an **envelope** of up to 15 PDFs to the same signers. Files come from the Files action or the in-app file picker.
- Up to 20 signers (name and email), with optional signing order.
- Visual placement editor with one tab per file. Signature and initials boxes, plus a "Rubricar todas as páginas" action.
- Options: deadline, reminder interval, message.
- Dashboard with status filters and an admin "Todos da empresa" view.
- Detail view:
  - timeline;
  - per-signer status;
  - actions: remind, **correct email** (before signing), **extend deadline**, cancel;
  - downloads: each signed file, each original as sent, activity log.
- **Bounced-email detection**: the signer is marked "e-mail não entregue" and the sender is notified.
- Signed PDFs saved to Drive automatically.
- Nextcloud notifications to the sender for: completed, refused, expired, send failure, bounced email, save failure.
- Read-only admin panel: connection status and envelope usage.
- Webhook, plus tiered polling as a safety net.

### v2 (must-have; the v1 design leaves room for these)

1. **Templates**: contract models with variables.
2. **DOCX input.**
3. **Own delivery channels**: an Avuz WhatsApp sender and Avuz-branded email, both using `sign_url`.
4. **Stronger signer auth**: SMS or WhatsApp token, selfie or document photo, ICP-Brasil certificate.
5. **Activity app integration.**

### Later (not scheduled)

A central Avuz console for:

- tenant provisioning;
- blocking non-payers;
- billing from the partner CSV.

---

## 3. Architecture

```
┌─ Tenant Nextcloud (one stack) ──────────────────────────────────┐
│ Files app ──"Enviar para assinatura"──┐                          │
│                                       ▼                          │
│ Assinaturas UI (Vue 3)   Dashboard · Wizard · Editor · Detail    │
│        │ JSON API (polls envelope state while sending)           │
│ ┌──────▼──────────── PHP backend ─────────────────────────────┐  │
│ │ EnvelopeController            WebhookController (public)     │  │
│ │ EnvelopeService   (state machine, claims, permissions)       │  │
│ │ SendJob           (QueuedJob: runs resumable Send steps)     │  │
│ │ SyncJob           (QueuedJob per flagged envelope +          │  │
│ │                    TimedJob tiered poller + lease recovery)  │  │
│ │ ZapSignClient     (only unit that speaks ZapSign)            │  │
│ │ SignedFileStore   (Drive I/O as the owner)                   │  │
│ │ Mappers: envelope · document · signer · field · event        │  │
│ │ occ assinaturas:webhook:ensure                               │  │
│ └──────────────────────────────────────────────────────────────┘  │
│ app config (encrypted) ← entrypoint syncs ZAPSIGN_* env on boot  │
└──────────────────────────────┬───────────────────────────────────┘
                               ▼  HTTPS, Bearer <tenant sub-account token>
                         ZapSign API (sandbox | production)
```

### `ZapSignClient`

Typed methods:

- `createDocument`, `uploadExtraDocument`, `findDocumentsByFolder`
- `placeSignatures`, `releaseSigner`, `updateSignerEmail`, `removeSigner`
- `getDocument`, `listDocumentsWithSigners`
- `updateDeadline`, `cancelDocument`, `getActivityLog`
- `registerWebhook`, `deleteWebhook`, `getPlanInfo`

Behavior:

- Selects the base URL from the environment.
- Always sends a `User-Agent` header (required by cancel).
- Maps ZapSign's non-uniform errors to typed exceptions.
- Owns the conversion from our coordinates (top-left origin, 0..1) to ZapSign's (bottom-left origin, %).

Retry policy is per method:

| Method type | Retry |
|---|---|
| Idempotent (GETs, place-signatures replace-all, update deadline) | Backoff on 429, 5xx and timeouts; honors `Retry-After`; 3 tries |
| `createDocument`, `uploadExtraDocument` | **Never retried automatically** (see §6) |
| Cooldown 429s (reminders) | Never retried |

Any 429 sets a short **global backoff** that all jobs respect, because tenants on one host share ZapSign's per-IP limit.

### Other units

- **`EnvelopeService`**: the state machine, atomic claims, permission checks, and status mapping (§6).
- **`SendJob`**: runs the Send steps in the background. The HTTP request that starts Send returns immediately, and the UI polls.
- **`SyncJob`** has three jobs:
  - (a) a `QueuedJob` per envelope flagged by a webhook;
  - (b) a `TimedJob` tiered poller;
  - (c) lease recovery for `sending` and `finalizing`.
- **`SignedFileStore`**: reads originals as their owner and writes signed copies (§10).
- **`WebhookController`**: checks the secret, flags the envelope, queues a sync, and returns `200` within milliseconds. It never does API calls or file I/O.
- **`occ assinaturas:webhook:ensure`**: registers the webhooks idempotently (§4).
- **Frontend**: Vue 3, `@nextcloud/vue`, `pdfjs-dist`. Screens are the dashboard, the 4-step wizard, the placement editor and the detail view.

---

## 4. Configuration and provisioning

### Env vars (per tenant stack)

| Var | Required | Purpose |
|---|---|---|
| `ZAPSIGN_API_TOKEN` | yes | Tenant sub-account token. If unset, the entrypoint disables the app. Data is kept, so restoring the token restores everything. |
| `ZAPSIGN_ENVIRONMENT` | yes | `sandbox` or `production`. |
| `ZAPSIGN_COMPANY_NAME` | yes | Tenant company name for signer messages ("da Construtora X"). |
| `ZAPSIGN_WEBHOOK_SECRET` | no | If unset, the app generates a secret once. The env sync never overwrites a generated secret with an empty value. |

### Entrypoint, every boot

This block does **not** live inside the stamp-gated `run_avuz_configuration`, which only runs when the config stamp changes.

1. Write the vars to app config. The token and secret are written with `--sensitive`, which encrypts them at rest. Changing a key's sensitivity requires deleting the key first.
2. Enable the app if a token is set; otherwise disable it.
3. Create group `assinaturas` if it is missing.
4. Run `occ assinaturas:webhook:ensure`.

The app is also added to `AVUZ_OWNED_APPS`, so shadow copies are purged and migrations reconcile when the image version bumps.

Stack env survives image redeploys. To rotate the token, change the env var and redeploy.

### `webhook:ensure`

1. Compute a fingerprint: `hash(token) + environment + webhook URL + secret`. The URL is built from `overwrite.cli.url`.
2. If the fingerprint matches the stored one, stop.
3. Otherwise, under a lock:
   - delete the stored registrations using the **old** token;
   - register one webhook per needed type: `""` (all core types), `doc_refused`, `email_bounce`, plus viewed/expired if Spike 4 finds their type values;
   - store a type → id map and the new fingerprint.
4. If the stored URL differs from the current `overwrite.cli.url`, it **refuses to re-point** unless run with `--confirm-url-change`. This protects production when a database is restored into staging.
5. `SyncJob` re-runs `ensure` daily.

### Provisioning a tenant (ops runbook)

1. `scripts/zapsign-create-tenant.sh "<company>"`, run with the master token. It calls `POST /api/v1/partner/company/` and prints the sub-account token. ZapSign returns that token **only once**.
2. In the ZapSign panel, open the new sub-account and turn on **"Block signature out of the defined order"** (Settings → Organization → Preferences). There is no API for this setting. Without it, signing order is **not** enforced.
3. Set `ZAPSIGN_API_TOKEN`, `ZAPSIGN_ENVIRONMENT` and `ZAPSIGN_COMPANY_NAME` in the tenant's Portainer stack, then redeploy.
4. Add a Cloudflare WAF skip rule for `/index.php/apps/assinaturas/webhook` on the tenant's zone.
5. Smoke-test the webhook: trigger `reprocess-doc` with `send_webhook` on a test envelope and confirm it arrives.

---

## 5. Data model

All tables are prefixed `oc_assinaturas_`.

### `envelopes`

| Column | Notes |
|---|---|
| `id`, `uuid` | `uuid` is external: used for `external_id` and for folder `/assinaturas/<uuid>` at ZapSign |
| `owner_uid`, `title` | |
| `status` | See §6 |
| `send_step` | Last completed Send step |
| `create_attempted_at` | Set before the create call; tells resume to look up by folder instead of creating |
| `lease_until` | Lease for `sending` and `finalizing` |
| `zapsign_token` | Main document token. Unique; null until created |
| `account_fingerprint` | `hash(token) + environment` at send time. Only matching envelopes sync |
| `sandbox` | |
| `signing_order` | |
| `deadline_at` | UTC; the wizard sets it to 23:59:59 in the tenant timezone, which defaults to `America/Sao_Paulo` |
| `reminder_days`, `message` | |
| `cancel_requested_at`, `cancel_reason`, `refused_reason` | |
| `error` | |
| `created_at`, `sent_at`, `completed_at` | |
| `last_synced_at`, `next_sync_at` | |

### `documents`

One row per file in the envelope.

| Column | Notes |
|---|---|
| `id`, `envelope_id`, `position` | Position 0 is the main document |
| `source_file_id`, `source_path` | |
| `source_etag`, `page_count`, `pages` | `pages` is JSON `[{width, height, rotation}]` captured when placement was done |
| `sent_sha256` | Hash of the bytes actually sent |
| `zapsign_token` | Main or extra document token |
| `signed_file_id` | |
| `save_status` | `pending`, `saved`, `save_failed` |

### `signers`

| Column | Notes |
|---|---|
| `id`, `envelope_id`, `name`, `email`, `order_group` | |
| `zapsign_token` | **A signing credential.** Never returned by list or timeline APIs |
| `status` | `pending`, `viewed`, `signed`, `refused` |
| `released_at`, `viewed_at`, `signed_at`, `last_reminder_at`, `email_bounced_at` | |
| `color` | |

### `fields`

| Column | Notes |
|---|---|
| `id`, `document_id`, `signer_id` | |
| `type` | `signature` or `initials` |
| `page`, `x`, `y`, `width`, `height` | Top-left origin, 0..1, relative to the page as displayed |

### `events`

| Column | Notes |
|---|---|
| `id`, `envelope_id`, `signer_id` | `signer_id` is nullable |
| `type`, `dedupe_key`, `occurred_at` | `dedupe_key` is unique |
| `actor_uid` | Nullable |
| `detail` | Small JSON with **no PII from the provider**, e.g. a refusal reason |

Events are **derived from state changes observed on re-fetch**, never copied from webhook payloads. `dedupe_key` = `envelope + signer + new status + provider timestamp`, so webhook- and poll-detected changes collapse into one event.

---

## 6. Lifecycle

```
draft ──Send──▶ sending ──▶ pending ──doc signed──▶ finalizing ──▶ completed
  │                │           ├──signer refuses───▶ refused
  │ local only,    │           ├──deadline─────────▶ expired ──late signature──▶ finalizing
  │ not billed     │           └──sender cancels───▶ cancelled
  delete           ├──step fails / lease expired──▶ failed ──Tentar novamente──▶ sending
                   │                                   └──Descartar──▶ cancelled (at ZapSign if created)
sandbox envelopes after switch to production ──▶ archived_sandbox (terminal)
```

### Claiming Send

Send claims the envelope atomically:

```sql
UPDATE ... SET status='sending', lease_until=now()+10m
WHERE id=? AND status IN ('draft','failed')
```

If no row changed, the request fails with 409 and the UI shows the current state. Double-clicks, two tabs and Cloudflare timeouts can't produce a second envelope.

### Send steps

Send runs in `SendJob`. Each step is persisted before the next starts.

1. **Validate**: re-read each file. If its etag differs from the one captured at placement, stop with "o arquivo mudou; revise o posicionamento". Enforce magic-byte PDF, not encrypted, ≤10 MB decoded, and envelope limits.
2. **Create main document**:
   - Persist `create_attempted_at` first.
   - `POST /docs` with `base64_pdf`, Avuz branding, `external_id = uuid`, `folder_path = /assinaturas/<uuid>`, `allow_refuse_signature = true`, `date_limit_to_sign`, and signers with **per-signer `send_automatic_email: false`**. Never use doc-level `disable_signer_emails`.
   - Persist the doc and signer tokens.
   - **Never auto-retried.** If the outcome is unknown (timeout, crash), resume first calls `findDocumentsByFolder(/assinaturas/<uuid>)` and adopts an existing document instead of creating a new one.
3. **Upload extra documents**, one call per file, persisting each token right after its response. Also never auto-retried. On resume, re-fetch the envelope:
   - if ZapSign has one more extra document than we persisted, adopt it;
   - then continue with the next file.
4. **Place signatures** per document token from `fields`. This is replace-all, so it is safe to retry. Skipped for documents with no fields.
5. **Release** order group 1, or all signers when unordered. Set `released_at` per signer. The exact mechanism is decided by Spike 1.
6. Move to `pending`.

On failure: go to `failed`, keep `send_step`, notify the sender.

- **Resume happens only on user action** ("Tentar novamente"). SyncJob never resumes Send steps.
- SyncJob only moves envelopes with an expired `sending` lease to `failed`.
- "Descartar" on an envelope that exists at ZapSign cancels it there. It has already been billed.

### Release and reminders

These depend on Spike 1.

- **Signing order:** ZapSign may auto-email the next group once the previous group signs. If it doesn't when emails were off at creation, SyncJob releases the next group once the previous one has signed.
- **Reminders are ours.** SyncJob re-sends to released, unsigned signers every `reminder_days`, respecting ZapSign's 30-minute cooldown. We don't depend on `reminder_every_n_days`, which only works with automatic send. The same scheduler will drive the v2 WhatsApp channel.
- **Final signed copy to signers:** if Spike 1 shows ZapSign no longer emails it, the app sends the signed PDFs to signers itself, via the Nextcloud mailer.

### Syncing

- **Webhook:** checks the secret, then looks up the envelope by main or extra document token.
  - Unknown token: `200`, ignored.
  - Known token: set `next_sync_at = now` (coalesced, at most once per 30 seconds per envelope), queue a sync, return `200`.
- **Tiered poller:** picks envelopes where `next_sync_at <= now` **and** `account_fingerprint` matches the current account. Each run:
  - makes at most 60 API calls;
  - uses jitter;
  - respects the global backoff;
  - prefers `listDocumentsWithSigners` pages over one GET per envelope.
- **Next-sync schedule** after each check:

  | Envelope age / state | Next sync |
  |---|---|
  | First hour | +5 min |
  | First day | +1 h |
  | After that | +6 h |
  | Deadline in <24 h | +1 h |

- **Flagging:** an envelope with no successful sync in 24 hours is flagged in the admin panel. A long-pending envelope is normal.

### Status mapping

The source of truth is ZapSign's state on re-fetch. Evaluate these rules in order:

| Observed | Local result |
|---|---|
| `cancel_requested_at` set, and ZapSign status is `refused`, `rejected` or `recusado` | `cancelled`, no "Recusado" notification |
| status `signed` | claim `pending/expired → finalizing` (below) |
| status `refused`, `rejected` or `recusado` | `refused`; the refusing signer comes from the list endpoint (`recusou`); reason = `rejected_reason` |
| `deleted = true` | `cancelled` ("removido na ZapSign") |
| `doc_expired` seen, or the list endpoint reports signers as `expirou` | `expired`, provisional; a later signature → `finalizing` |
| `pending` | `pending`; update signers |
| anything else | unchanged, and log a warning |

Signer status mapping:

| Source | ZapSign value | Local value |
|---|---|---|
| Detail endpoint | `new` | `pending` |
| Detail endpoint | `link-opened` | `viewed` |
| Detail endpoint | `signed` | `signed` |
| List endpoint | `nao_abriu` | `pending` |
| List endpoint | `abriu` | `viewed` |
| List endpoint | `assinou` | `signed` |
| List endpoint | `recusou` | `refused` |
| List endpoint | `expirou`, `cancelado` | follow the envelope status |

### Completion

Completion is atomic. `UPDATE … SET status='finalizing', lease_until=… WHERE status IN ('pending','expired')`. Only the winner proceeds.

For each document with `signed_file_id IS NULL`:

1. Re-fetch to get a fresh URL. If `signed_file` is still null, retry later with backoff; this is not an error.
2. Download the file.
3. Save it through `SignedFileStore`.
4. Set `signed_file_id`.

When all documents are saved, move to `completed` and notify once.

If a `finalizing` lease expires (process died), SyncJob returns the envelope to `pending` with `next_sync_at = now`. The next sync claims it again and continues with the documents still unsaved.

A save failure sets `save_status = save_failed` and notifies the sender. SyncJob retries, and the file stays downloadable in the app through a freshly fetched URL.

### Other actions

- **Cancel:** persist `cancel_requested_at` and the reason, then call `POST /refuse/` with `notify_signer`.
- **Correct email:** only for a signer who hasn't signed. Calls `updateSignerEmail`, then re-releases that signer.
- **Extend deadline:** `PUT /docs/{token}` with the new `date_limit_to_sign`. Allowed on `pending` and `expired`.
- **Delete (admin):**
  - pending envelopes are cancelled at ZapSign first;
  - local rows are removed;
  - signed files in Drive are untouched;
  - ZapSign keeps its own record.
- **Sandbox → production switch:** envelopes whose fingerprint no longer matches become `archived_sandbox`.

---

## 7. User experience

pt_BR first, using Nextcloud l10n. Screens meet WCAG 2.0 AA: keyboard reachable, labelled controls, and status not conveyed by color alone.

### Access

- Enforcement lives in the app, not in Nextcloud's "limit to groups" setting. Core treats group-limited apps as disabled for anonymous requests ([`lib/private/App/AppManager.php:365`](../../../lib/private/App/AppManager.php)), which would 404 the webhook.
- The app stays enabled for everyone, and:
  - registers the nav entry per user through `INavigationManager`;
  - loads the Files action only for members;
  - returns 403 on the API for non-members.

### Entry points

- **Files:** an "Enviar para assinatura" action on one or more selected PDFs.
- **App:** "Novo envelope" opens a multi-select file picker restricted to PDFs.

### Dashboard

- **Filters:** *Aguardando*, *Concluídos*, *Recusados / Expirados / Cancelados*, *Rascunhos*, *Com erro*.
- Search by title, file name or signer.
- **Rows:** title, file count, signer progress (`2/3 assinaram`), status pill with icon and text, sent date, deadline.
- **Admin toggle:** "Todos da empresa".
- **Sandbox banner:** a persistent **SANDBOX — sem validade jurídica** banner on every screen while the environment is `sandbox`.

### Wizard

Auto-saves as a draft. Nothing is billed until Send.

1. **Documentos.** Add, remove or reorder files (up to 15). Set the envelope title.
2. **Signatários.**
   - Name and email per signer, with a color per signer.
   - "Ordem de assinatura" toggle with drag-reorder.
3. **Posicionar** (optional). Uses pdf.js.
   - One tab per file.
   - Palette per signer: *Assinatura* and *Rubrica*.
   - Drag, resize (**aspect ratio locked**), delete.
   - "Rubricar todas as páginas" is computed in absolute page points, so it also works on documents with mixed page sizes.
   - Keyboard: focus a box, arrow keys move it, shift+arrows resize it.
4. **Revisar e enviar.**
   - Deadline, reminder interval ("lembrar a cada N dias"), message.
   - A summary with the warning **"este envio consome 1 envelope"**.
   - Confirm starts Send. The UI shows step progress until the envelope is `pending` or `failed`.

### Detail view

- **Header:** status, timeline, and an error message with *Tentar novamente* / *Descartar* when failed.
- **Per signer:**
  - status, and "e-mail não entregue" when an email bounced;
  - viewed and signed times;
  - *Reenviar lembrete*, disabled with a countdown during ZapSign's cooldown and for groups not yet released;
  - *Corrigir e-mail*, before signing;
  - *Copiar link*, owner only, audited.
- **Envelope actions:** *Prorrogar prazo*, *Cancelar* (reason required), *Excluir* (admin only).
- **Per file:** *Baixar assinado*, *Baixar original enviado* (served from ZapSign, i.e. the exact bytes that were sent), *Abrir no Drive*.
- **Envelope-wide:** *Relatório de atividades (PDF)*.

### Notifications to the sender

Nextcloud notifications are sent for:

- concluído, linking to the signed files;
- recusado, with the reason;
- expirado;
- falha de envio;
- e-mail não entregue;
- falha ao salvar no Drive.

### Admin panel (Administração → Assinaturas, read-only)

- Environment badge.
- Token validity and plan/credits, via `info-plan`, cached for 10 minutes.
- Webhook registrations by type.
- Company name in use.
- **Envelopes this month:** created, completed, cancelled/failed-but-billed.
- Envelopes with no sync in 24 hours.
- A reminder that the "block out-of-order signing" setting must be on in ZapSign.
- 402 or 403 from ZapSign turns the panel red. Admins get **one notification per state change**, not one per failure.

### Signer-facing content

- `brand_name = "Avuz Conecta"`.
- `brand_logo` = one **central static URL** for the Avuz logo, not the tenant host.
- `brand_primary_color = #2bb5e3`.
- `lang = pt-br`.
- The message is prefixed: "Maria Souza, da {ZAPSIGN_COMPANY_NAME}, enviou documentos para sua assinatura." Where ZapSign carries the message (per-signer `custom_message`) is confirmed in Spike 1.

---

## 8. Deployment

- **Repo:** `avuz-conecta/assinaturas`, branch `main`.
  - Built `js/` and `vendor/` are committed, because the Dockerfile can't build them (same as `deck`).
  - `info.xml`: Nextcloud min 33, max 34.
- **avuz-server:**
  - add the submodule at `apps/assinaturas`;
  - add the app to `AVUZ_OWNED_APPS`;
  - add the every-boot entrypoint block from §4;
  - add `scripts/zapsign-create-tenant.sh`;
  - update the CLAUDE.md fresh-checkout steps.
- **Webhook URL:** `https://<tenant host>/index.php/apps/assinaturas/webhook`, built from `overwrite.cli.url`.
- **Cron:** background jobs run on the existing 5-minute cron loop. Webhook-triggered syncs therefore land within about 5 minutes, and status updates are shown when the sync completes.
- **Rollout:**
  1. Default staging `avuz-conecta` (stack 8) with the **sandbox** token.
  2. One pilot tenant with a **production** sub-account. Production steps are gated on explicit approval.
  3. The rest of the fleet.

---

## 9. Security

- **Secrets:**
  - The API token and webhook secret are sensitive app config, encrypted at rest (NC33 `$AppConfigEncryption$`).
  - The HTTP client redacts `Authorization` from logs.
  - Signer tokens (equivalent to `sign_url`) are never returned by list or timeline APIs. "Copiar link" fetches the URL on demand, owner only, and records an event.
- **Webhook** (the only public route: `@PublicPage`, no CSRF):
  - The secret header is checked with `hash_equals`. The previous secret is also accepted for 24 hours after a rotation.
  - Anonymous rate limit and a body size cap. **No brute-force throttle**, because it would block ZapSign's own IP after a stale registration. Bad-secret hits are logged as a metric.
  - The payload is only used to find the token. An unknown token gets `200`, so callers learn nothing from the response.
  - There is no synchronous outbound call. Forged webhooks can only move `next_sync_at` earlier, which is coalesced and rate-limited.
- **Authorization:**
  - Every endpoint checks group membership or admin status.
  - Then it checks owner or admin at the envelope level. Former members keep read access to their own envelopes.
  - IDs from the client are never trusted on their own (no IDOR).
  - Drive I/O runs as the owner through their folder view.
- **Validation:**
  - Files: magic-byte PDF check; encrypted PDFs rejected; already-signed PDFs rejected with an explanation; ≤10 MB decoded per file; up to 15 files.
  - Signers: email format, name length, ≤20 signers.
  - Fields: inside page bounds, coordinates within 0..1.
- **CSP:** the pdf.js worker is served from `'self'` with `isEvalSupported: false`. Add `'wasm-unsafe-eval'` only if the scanned-PDF test in Spike 3 needs it. The policy applies to the app page only. No iframes.
- **LGPD:**
  - Store only the fields the app needs: name, email, status and timestamps per signer. Refusal reasons are stored as event detail.
  - Never store IP addresses, geolocation, signature images, selfie URLs or CPF from provider payloads. ZapSign's evidence page already carries that evidence.
  - Data is kept with the envelope. Admin delete serves data-subject requests.

---

## 10. Error handling and edge cases

| Case | Behavior |
|---|---|
| Create or upload outcome unknown (timeout, crash) | Envelope → `failed` via the lease. Resume looks up by folder and adopts what exists. It never blindly re-creates |
| 429 from ZapSign | Global backoff and honor `Retry-After`. Cooldown 429s are never retried |
| 5xx or timeout on an idempotent call | Backoff, 3 tries |
| Other 4xx | Mapped to a pt_BR message |
| 402 (no plan) or 403 (wrong-environment token) | Admin panel turns red; one notification per state change |
| Webhook missed | The tiered poller catches it |
| Cloudflare challenges the webhook | Prevented by the WAF skip rule. The poller covers any gap, and the rollout smoke test detects it |
| Duplicate completion (webhook and poller) | The atomic `finalizing` claim wins once. Files are written only when `signed_file_id IS NULL` |
| `signed_file` null right after the last signature | Retry later with backoff; not an error |
| Signed-file URL expired | Re-fetch and retry |
| File edited between placement and Send | Send blocks and asks the user to re-check placement |
| Page rotation, CropBox offset, mixed page sizes | Page geometry is stored at placement; conversion accounts for rotation; covered by Spike 3 |
| Original moved | Tracked by file ID; the signed copy is saved next to the new location |
| Original deleted, or folder read-only | Saved to the owner's `/Assinaturas/` |
| Folder shared with the sender and writable | Saved next to the original (decided) |
| Quota full or FileLocked (S3) | Retry with backoff, then `save_failed`, a notification, and the file stays downloadable from the app |
| Name collision / extension case | `Contrato (assinado 2).pdf`. `.PDF` is handled case-insensitively |
| Owner deleted | Envelope kept for admins; the Drive write is skipped and logged |
| Sandbox → production switch | Old envelopes become `archived_sandbox` |
| Production DB restored into staging | The fingerprint mismatch means no sync. `webhook:ensure` refuses the URL change without `--confirm-url-change` |
| Expired, then signed late | `expired → finalizing → completed` |
| Signer email bounced | Signer marked, sender notified, *Corrigir e-mail* offered |
| Unknown webhook `event_type` | Only the token is used, then re-fetch; the type itself is ignored |

**Observability:**

- Every `ZapSignClient` call goes through a monitoring higher-order wrapper. It logs the endpoint, HTTP status, duration, envelope `uuid` and ZapSign doc token. It never logs the API token or signer tokens.
- Counters: bad webhook secret, 429s, send failures by step.
- `events` is the per-envelope audit trail.

---

## 11. Testing

Tests describe behavior, use third-person verbs, and group cases with `describe`. Every bug fix adds a regression test.

**PHP (PHPUnit)** runs in a Docker test env following `~/deck-test.sh`.

- **`ZapSignClient`**, against a faked NC HTTP client with fixtures recorded from sandbox (including error shapes). It:
  - never retries create or upload;
  - retries idempotent calls;
  - honors `Retry-After`;
  - converts coordinates correctly, including rotated pages.
- **`EnvelopeService`:**
  - a double Send creates one envelope;
  - a crash after create resumes by adoption without a second create;
  - an extra-document upload that is already present is adopted;
  - an expired `sending` lease becomes `failed`;
  - a concurrent webhook and poller complete once and write once;
  - a cancel never produces "Recusado";
  - late signatures after expiry complete;
  - the status mapping tables hold;
  - permissions: non-member 403, former member keeps read access to own envelopes, "Copiar link" is owner-only, admin sees all.
- **`SignedFileStore`:** moved, deleted, read-only, shared-writable, quota full, FileLocked, collisions, `.PDF`.
- **Webhook:**
  - bad secret → 401 without throttling;
  - rotated secret accepted during the grace period;
  - unknown token → 200;
  - no outbound calls during the request.
- **`webhook:ensure`:** idempotent; re-registers on fingerprint change; refuses a URL change without `--confirm-url-change`.

**Frontend (Vitest):** editor geometry — drag, locked-aspect resize, clamping to the page, "Rubricar todas" on mixed page sizes, rotated pages.

**End-to-end (sandbox, on staging):**

1. A script sends a 3-file envelope with ordered signers.
2. A human signs in the sandbox.
3. Verify that the webhook arrives, the order is enforced, reminders go out, the signed PDFs appear next to each original, and signers receive their copy.

---

## 12. Sandbox spikes (first plan tasks)

1. **Release and emails.** With per-signer `send_automatic_email: false` at creation:
   - Does updating a signer to `true` send the **first** email?
   - Does the next order group get emailed automatically after the previous one signs?
   - Does releasing group 2 early email it out of order?
   - Do signers receive the **final signed copy**?
   - Where does `custom_message` appear?
   - Does resending hit the 30-minute cooldown on first release?
2. **Signed files.**
   - Is the evidence page appended to each file of the envelope, or only the main one?
   - When is `signed_file` populated?
3. **Formats and geometry.**
   - Sandbox `sign_url` host.
   - Does `order_group` start at 0 or 1?
   - Placement on landscape pages, `/Rotate` 90/270 pages, CropBox-offset pages, and extra documents.
   - A scanned JPEG2000 PDF in pdf.js under our CSP.
4. **Webhooks.**
   - Type values for viewed and expired events.
   - Does the payload of an extra document carry its own token or the main one?
   - Actual retry behavior.
5. **Inbox noise.** Does the Avuz master (partner owner) inbox receive emails for every tenant's envelopes? If so, set `created_by` / owner email preferences to avoid it.
6. **Limits.** Files per envelope (docs say 15; commercial terms may say 20) and size limits (docs say 10 MB per file).

## 13. Questions for ZapSign (asked in parallel)

- Webhook retry count and interval; HMAC signing or a source IP list.
- Canonical document statuses; is there an `expired` status?
- An API to set "block out-of-order signing" per sub-account.
- Rotating and deleting sub-account tokens; listing sub-accounts.
- Partner white-label scope: removing "via ZapSign", a custom signing domain, branding on the evidence report.
- Envelope limits (files, total MB), max signers, max pages.
- Does a cancelled envelope count toward billing? (Docs say every created document counts.)
