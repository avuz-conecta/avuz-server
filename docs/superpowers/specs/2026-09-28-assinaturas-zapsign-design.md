# Assinaturas — ZapSign e-signature app for AvuzConecta

**Date:** 2026-09-28
**Status:** Design approved in brainstorming; pending written-spec review
**Provider:** ZapSign (sandbox access granted). API reference: [`docs/zapsign/api-digest.md`](../../zapsign/api-digest.md)
**Background:** [`2026-09-09-avuzconecta-signature-feasibility.md`](2026-09-09-avuzconecta-signature-feasibility.md)

---

## 1. Goal

Add a Nextcloud app, **Assinaturas**, to AvuzConecta. It is a dashboard for sending documents from Drive to ZapSign, and for tracking each one until it's signed. Users can start from the Files app. Once a document is at ZapSign, its lifecycle lives in the app. The signed PDF lands back in Drive next to the original.

### Decisions

| Topic | Decision |
|---|---|
| Account model | Avuz = ZapSign **partner/master** account. One **sub-account per tenant**, each with its own API token. |
| Token delivery | Portainer **stack env vars**; the entrypoint syncs them to Nextcloud config on every boot. |
| Access | Nextcloud group **"Avuz Assinaturas"**, auto-created. Members use the app; NC admins always have access. |
| Visibility | Users see their own requests. NC admins also see all of the tenant's requests. |
| Signed file | Saved **next to the original** as `<name> (assinado).pdf`. |
| Signer delivery (v1) | ZapSign **email link**. |
| Signature placement | **Visual placement editor in v1**: drag signature/initials boxes per signer. `<<signerN>>` anchors are also honored. With no placement, ZapSign's report page is used. |
| Branding | **Avuz Conecta** brand (name, logo, `#2bb5e3`). The sender's name and company go in the message body. |
| Architecture | Native NC app in its own repo `avuz-conecta/assinaturas`, submodule at `apps/assinaturas`. |

---

## 2. Scope

### v1

- Send a PDF from Drive (Files action or in-app file picker) for signature.
- Up to 20 signers (name + email), with optional signing order.
- Visual placement editor for signature and initials boxes, plus a "rubricar todas as páginas" shortcut.
- Options: deadline, reminder interval, message.
- Dashboard with status filters and an admin "all requests" view.
- Detail view with timeline, per-signer status, reminder, cancel, and downloads (signed, original, activity log).
- Signed PDF saved automatically to Drive.
- Nextcloud notifications to the sender: completed, refused, expired, send failure.
- Read-only admin connection panel.
- Webhook plus a polling safety net.

### v2 — must-have (designed for, not built in v1)

1. **Templates** — contract models with variables.
2. **Multi-document envelopes** — up to 15 docs per request.
3. **DOCX input.**
4. **Own delivery channels** — Avuz WhatsApp sender and Avuz-branded email, using `sign_url`.
5. **Stronger signer auth** — SMS/WhatsApp token, selfie/document photo, ICP-Brasil certificate.
6. **Activity app integration.**

### Later (not scheduled)

- Central Avuz console for tenant provisioning, blocking non-payers, and usage billing via the partner CSV.
- Per-tenant quotas.

---

## 3. Architecture

```
┌─ Tenant Nextcloud (one stack) ───────────────────────────────┐
│ Files app ──"Enviar para assinatura"──┐                       │
│                                       ▼                       │
│ Assinaturas UI (Vue 3)   Dashboard · Wizard · Editor · Detail │
│        │ JSON API                                             │
│ ┌──────▼────────── PHP backend ─────────────────────────────┐ │
│ │ RequestController        WebhookController (public)        │ │
│ │ SignatureRequestService  (state machine + permissions)     │ │
│ │ ZapSignClient            (only unit that speaks ZapSign)   │ │
│ │ SignedFileStore          (Drive I/O as the owner)          │ │
│ │ SyncJob                  (TimedJob safety net)             │ │
│ │ Mappers: request · signer · field · event                  │ │
│ └────────────────────────────────────────────────────────────┘ │
│ app config ← entrypoint syncs ZAPSIGN_* env on boot           │
└──────────────────────────────┬────────────────────────────────┘
                               ▼  HTTPS, Bearer <tenant sub-account token>
                         ZapSign API (sandbox | production)
```

### Units

- **`ZapSignClient`** — typed methods:
  - `createDocument`, `placeSignatures`, `releaseToSigners`, `getDocument`
  - `remindSigner`, `cancelDocument`, `getActivityLog`
  - `registerWebhook`, `getPlanInfo`

  Picks the base URL from the environment. Maps ZapSign's non-uniform errors to typed exceptions and retries on 429/5xx/timeouts (exponential backoff, 3 tries). Owns the coordinate conversion from our top-left 0..1 to ZapSign's bottom-left percentage.

- **`SignatureRequestService`** — owns the lifecycle state machine, resumable Send, status mapping from ZapSign documents, and all authorization.

- **`SignedFileStore`** — reads the original as its owner, as base64. Writes the signed copy using the collision and fallback rules in §7.

- **`WebhookController`** — checks the secret header, records the event, and triggers a re-fetch. It never trusts the payload.

- **`SyncJob`** — `TimedJob`, every 5 minutes. It:
  - re-checks pending requests, with backoff;
  - downloads completed PDFs;
  - resumes failed steps that are safe to retry;
  - flags requests stuck for more than 24h.

- **Frontend** — Vue 3 + `@nextcloud/vue` + `pdfjs-dist`. It has four parts: dashboard, 4-step wizard, placement editor, and detail view.

- **Entrypoint (avuz-server)** — handles env sync, app enablement, and group creation (§8).

---

## 4. Configuration

| Env var | Required | Purpose |
|---|---|---|
| `ZAPSIGN_API_TOKEN` | yes | Tenant sub-account token. If unset, the entrypoint disables the app (data kept). |
| `ZAPSIGN_ENVIRONMENT` | yes | `sandbox` or `production`; selects the API base URL. |
| `ZAPSIGN_WEBHOOK_SECRET` | no | Webhook header secret. If unset, the app generates a secret once and persists it in app config. |

- On each boot, the entrypoint writes these values to app config and marks the token and secret **sensitive**.
- Stack env survives image redeploys, so values persist across deploys. To rotate, change the env var and redeploy.
- The token is never sent to the browser and never logged.

### Provisioning a tenant

1. Ops runs `scripts/zapsign-create-tenant.sh "<company name>"` with the master token. It calls `POST /api/v1/partner/company/` and prints the new sub-account token. ZapSign returns this token **only once**.
2. Ops pastes the token into the tenant's Portainer stack env as `ZAPSIGN_API_TOKEN` and redeploys.
3. On boot, the app registers its webhook with ZapSign using the tenant token. This step is idempotent: the webhook id is stored in app config, and the webhook is re-registered only when the URL or secret changes.

---

## 5. Data model

All tables use the prefix `oc_assinaturas_`.

### `requests`

| Column | Notes |
|---|---|
| `id` | PK |
| `owner_uid` | sender |
| `title` | |
| `source_file_id`, `source_path` | file id is the tracking key; path is a snapshot for display |
| `zapsign_token` | unique, null until created at ZapSign |
| `status` | see §6 |
| `send_step` | last completed Send step (resume point) |
| `signing_order` | bool |
| `deadline`, `reminder_days`, `message` | |
| `sandbox` | bool, captured at send time |
| `signed_file_id` | set when the signed PDF is saved |
| `error` | last error, user-facing |
| `created_at`, `sent_at`, `completed_at`, `last_synced_at` | |

### `signers`

| Column | Notes |
|---|---|
| `id`, `request_id` | |
| `name`, `email` | |
| `order_group` | used when `signing_order` is on |
| `zapsign_token`, `sign_url` | `sign_url` is sensitive |
| `status` | `pending`, `viewed`, `signed`, `refused` |
| `viewed_at`, `signed_at` | |
| `color` | editor color index |

### `fields`

| Column | Notes |
|---|---|
| `id`, `request_id`, `signer_id` | |
| `type` | `signature` or `initials` |
| `page` | 0-based |
| `x`, `y`, `width`, `height` | top-left origin, 0..1 relative to page |

### `events`

| Column | Notes |
|---|---|
| `id`, `request_id` | |
| `type` | e.g. `sent`, `viewed`, `signed`, `refused`, `link_copied`, `reminder_sent` |
| `dedupe_key` | unique; webhook idempotency |
| `occurred_at`, `payload` | the timeline + audit trail |

---

## 6. Lifecycle

```
draft ──Send──▶ sending ──▶ pending ──all signed──▶ completed
  │                │            ├──signer refuses──▶ refused
  │ local only,    │            ├──deadline────────▶ expired
  │ not billed     │            └──sender cancels──▶ cancelled
  delete           └──step fails──▶ failed (resumable)
```

### Send is a sequence of resumable steps

Each step is persisted before the next one starts.

1. **Create:** `POST /docs` with `base64_pdf`, Avuz branding, `external_id = request id`, and signer emails **off**. Persist `zapsign_token` and signer tokens/`sign_url` immediately; ZapSign bills from this point.
2. **Place:** `place-signatures` from `fields`. Skipped when there are no fields; the report page or anchors apply instead.
3. **Release:** trigger ZapSign's email to the signers.
4. The request moves to `pending`.

When a step fails, the request moves to `failed` and `send_step` is kept.

- **Tentar novamente** resumes from the next step and never re-creates the document, so there is no double billing.
- **Descartar** on a request that already exists at ZapSign cancels it there.

**Release mechanics depend on Spike 1 (§10).**

- **Plan A:** create with emails off, then trigger the first email by updating each signer with `send_automatic_email: true`. This requires that the signing-order progression still emails later groups.
- **Plan B, used if Plan A misbehaves:** create with emails on, then place signatures immediately in the same request cycle. The window before any signer could open the link is under a second.

The user experience is identical either way.

### Status source of truth

ZapSign's document, read via `getDocument`. Webhooks and `SyncJob` only trigger re-fetches.

Mapping is driven by signer statuses and `event_type`, because ZapSign's document status strings are inconsistent (`refused` / `rejected` / `recusado`). An unknown status keeps the request `pending` and logs a warning.

Expiry comes from the `doc_expired` event or from the deadline having passed.

### Completion

When every signer has signed:

1. Re-fetch the document to get a fresh `signed_file` URL (valid 60 minutes).
2. Download the file and save it via `SignedFileStore`.
3. Set `signed_file_id`.
4. Mark the request `completed`.
5. Notify the sender.

If the download fails, `SyncJob` retries it, re-fetching the URL each time.

---

## 7. User experience

The UI is pt_BR first and uses Nextcloud l10n.

### Access

- The **"Avuz Assinaturas"** group is created automatically if missing. Admins grant access by adding users to it in *Usuários*; there is no extra permission UI.
- Enforcement lives in the app, not in Nextcloud's "limit to groups". Core treats group-limited apps as disabled for anonymous requests ([`lib/private/App/AppManager.php:365`](../../../lib/private/App/AppManager.php)), which would break the webhook and risk the background job.
- The app therefore stays enabled for everyone. It hides the nav entry and the Files action for non-members, and returns **403** on the API for them.
- Nextcloud admins always have access.

### Entry points

- **Files:** "Enviar para assinatura" action on PDFs, shown to members only.
- **App:** "Nova solicitação" opens the Nextcloud file picker, restricted to PDFs.

### Dashboard

- Filters: *Aguardando*, *Concluídos*, *Recusados / Expirados / Cancelados*, *Rascunhos*, *Com erro*.
- Search by title or signer.
- Rows show title, signer progress (`2/3 assinaram`), status pill, sent date, and deadline.
- Admins get a toggle **"Todos da empresa"**; the default is their own requests.

### Wizard

The wizard auto-saves as a draft. Nothing is billed until Send.

1. **Documento** — file and title.
2. **Signatários** — name and email for each signer; "Ordem de assinatura" toggle with drag-reorder; a color per signer.
3. **Posicionar** — pdf.js page view with a palette per signer (*Assinatura*, *Rubrica*).
   - Drag, resize, and delete boxes.
   - "Rubricar todas as páginas" adds initials to every page.
   - This step is optional.
   - Keyboard alternative: focus a box, use arrow keys to move and shift+arrow keys to resize.
4. **Revisar e enviar** — deadline, reminder every N days, and a message.
   - The summary shows the warning "este envio consome 1 documento do plano".
   - The user confirms, then the request is sent.

### Detail view

- Status and timeline from `events`.
- Per signer: status, viewed and signed times, plus two actions:
  - **Copiar link** — recorded as an event.
  - **Reenviar lembrete** — disabled with a countdown, since ZapSign allows 1 reminder per 30 minutes.
- Actions: **Cancelar** (with a reason), **Baixar assinado**, **Baixar original**, **Relatório de atividades (PDF)**, **Abrir no Drive**.
- Failed requests show the error plus **Tentar novamente** and **Descartar**.

### Notifications

Nextcloud notifications go to the sender for:

- **Concluído** — links to the signed file.
- **Recusado** — includes the reason.
- **Expirado.**
- **Falha de envio.**

### Admin settings (Administração → Assinaturas)

This panel is read-only:

- environment badge, with **SANDBOX** shown prominently;
- token validity, via `GET /info-plan`;
- plan name and credits;
- webhook registration status.

The token itself is never shown.

### Signer-facing content

- Branding: `brand_name = "Avuz Conecta"`, `brand_logo` = public Avuz logo URL served by `avuz_theme`, `brand_primary_color = #2bb5e3`.
- The message is prefixed with the sender and company, e.g. "Maria Souza, da Construtora X, enviou um documento para sua assinatura."

---

## 8. Deployment

- **Repo:** `avuz-conecta/assinaturas`, branch `avuz`. Built `js/` and `vendor/` are committed, because the Dockerfile can't build them (same as `deck`).
- **avuz-server:** add the submodule at `apps/assinaturas` and update the CLAUDE.md fresh-checkout steps.
- **Entrypoint, on each boot:**
  1. Sync `ZAPSIGN_*` env to app config.
  2. If `ZAPSIGN_API_TOKEN` is set, enable the app; otherwise disable it. Disabling keeps all tables and data, so restoring the token brings everything back.
  3. Create the "Avuz Assinaturas" group if it's missing.
- **App boot:** ensure the webhook is registered.
- **Webhook URL:** `https://<tenant host>/index.php/apps/assinaturas/webhook`, built from `overwrite.cli.url` so cron computes the same URL. It passes through Cloudflare and NPM like the rest of the tenant traffic.
- **Rollout:**
  1. Default staging `avuz-conecta` (stack 8) with the **sandbox** token.
  2. One pilot tenant with a **production** sub-account. Production steps are gated on explicit approval, as usual.
  3. The rest of the fleet.

---

## 9. Security

- **Secrets** — the token and webhook secret are stored as sensitive app config. The HTTP client redacts `Authorization` from logs. `sign_url` is returned only to the owner or an admin, and every copy is audited.
- **Webhook** — the only public route (`@PublicPage`, no CSRF).
  - The secret header is compared with `hash_equals`.
  - A bad secret returns 401 and triggers Nextcloud brute-force throttling on the caller IP.
  - Anonymous rate limit and a request body size cap.
  - The payload is a hint only: the handler finds the local request by doc token and re-fetches from the API.
  - An unknown token returns `200` and is ignored, so there is no enumeration signal.
- **Authorization** — every endpoint checks group membership or admin status, then owner-or-admin at the request level. No IDOR: request ids from the client are always checked against the current user. Drive I/O runs as the owner through their folder view, so shares and permissions apply.
- **Validation:**
  - PDF mime type and size ≤10 MB (ZapSign's limit) are checked before Send.
  - Email format and name length are validated.
  - At most 20 signers.
  - Field coordinates must be within 0..1 and inside the page.
- **CSP** — `worker-src 'self' blob:` on the app page only, for the pdf.js worker. No iframes.

---

## 10. Error handling and edge cases

| Case | Behavior |
|---|---|
| ZapSign 429 / 5xx / timeout | Backoff and retry (3 tries), then the Send step fails and is resumable |
| ZapSign 4xx | Mapped to a pt_BR user message |
| 402 (no plan) / 403 (wrong-env token) | Admin panel turns red and admins are notified |
| Webhook never arrives | `SyncJob` re-checks with backoff; a request stuck for more than 24h is flagged |
| `signed_file` URL expired | Re-fetch the detail and retry the download |
| Original moved | Tracked by file id; the signed file is saved next to the new location |
| Original deleted, or folder read-only | Saved to the owner's `/Assinaturas/` folder |
| Name collision | `Contrato (assinado 2).pdf`, etc. |
| Owner deleted | Request kept and visible to admins; Drive write skipped and logged |
| Env switched sandbox → production | Older requests keep `sandbox = true`, show a badge, and are excluded from sync |
| Duplicate or replayed webhook | No-op via `events.dedupe_key` |
| Unknown webhook `event_type` | Logged and ignored, then a re-fetch |

**Observability:** every `ZapSignClient` call goes through a monitoring higher-order wrapper. It logs endpoint, HTTP status, duration, local request id, and ZapSign doc token. It never logs the API token or `sign_url`. The `events` table is the per-request audit trail.

---

## 11. Testing

Tests describe behavior, use third-person verbs, and group cases with `describe` blocks. Every bug fix adds a regression test.

### PHP (PHPUnit, Docker test env following `~/deck-test.sh`)

- **`ZapSignClient`** — runs against a faked NC HTTP client, using fixtures recorded from real sandbox responses (including error shapes).
- **`SignatureRequestService`:**
  - Send resumes from the failed step without re-creating;
  - replayed webhooks are no-ops;
  - status mapping handles each document and signer shape;
  - non-members get 403;
  - non-owners can't read others' requests;
  - admins see all.
- **`SignedFileStore`** — collision names, moved original, deleted original, read-only folder fallback.
- **Coordinate conversion** — portrait and landscape pages, boxes at page edges.

### Frontend (Vitest)

Editor geometry: drag, resize, clamp to page, "rubricar todas".

### End-to-end (sandbox, staging)

A script runs create → place → release. A human then signs in the sandbox. The script verifies the webhook arrives and the signed PDF appears next to the original in Drive.

---

## 12. Sandbox spikes (first plan tasks)

These decide small mechanics, not the design.

1. **Release:** does updating a signer with `send_automatic_email: true` send the *first* email? Does the signing-order progression still email later groups when the doc was created with emails off? The answer picks Plan A or Plan B (§6).
2. **Signed file:** does `signed_file` include the evidence/report page? Is it populated only after the last signature?
3. **Formats:** sandbox `sign_url` host; whether `order_group` starts at 0 or 1; how placement behaves on landscape pages.
4. **Webhook types:** the `type` values for subscribing to `doc_viewed` and `doc_expired`.

## 13. Open questions for ZapSign (in parallel)

- Webhook retry count and interval; any HMAC or source IP list.
- Canonical document status values; whether an `expired` status exists.
- Rotating and deleting sub-account tokens; listing sub-accounts.
- Partner white-label scope: removing "via ZapSign" from emails, custom signing domain, report branding.
- Maximum signers per document and maximum page count.
