# ZapSign API — Digest for the AvuzConecta Signatures App

Crawled 2026-09-28 from docs.zapsign.com.br (llms-full.txt, 537 pages), official Java/Go SDKs, help center.
PT docs are canonical and often more complete. Append `.md` to any doc URL for raw markdown.
⚠️ = ambiguous/undocumented — verify in sandbox. 🔍 = found only in SDK/help center.

## TL;DR
1. **Auth:** static token per account, `Authorization: Bearer <token>`. Each tenant sub-account gets its **own** `api_token`, returned **only once** by `POST /api/v1/partner/company/`. No endpoint lists sub-accounts or retrieves/rotates their tokens → store at creation.
2. **Signed PDF:** single PDF, PAdES-sealed by ZapSign's ICP-Brasil cert (CN "ZAPSIGN PROCESSAMENTO DE DADOS LTDA", AC Certisign Multipla G7). **Signature report (evidence) appended as last page(s)** (help center). Separate activity log: `GET /api/v1/docs/signer-log/{doc_token}?download_pdf=true`.
3. **File URLs expire in 60 min** — download on completion; re-fetch via Detail if expired.
4. **Webhooks are NOT signed** (no HMAC/secret/IP list). Only protection = custom headers we configure. Account-level, optional `doc_token` filter. Retries on non-200, count/interval undocumented → idempotent handlers; re-verify via `GET /docs/{token}/`.
5. **Branding:** per-doc `brand_logo`, `brand_primary_color`, `brand_name` → emails read "<brand_name> via ZapSign"; signing domain stays `app.zapsign.com.br/verificar/…`. Full white-label = partner program, undocumented scope.

## 1. Environments & auth
| Env | API base | Web | Legal validity |
|---|---|---|---|
| Sandbox | `https://sandbox.api.zapsign.com.br/api/v1/` | `https://sandbox.app.zapsign.com.br` | No |
| Production | `https://api.zapsign.com.br/api/v1/` | `app.zapsign.com.br` | Yes |
| Prod BR residency | `https://br.api.zapsign.com.br/api/v1` (dedicated plans, PT docs only) | – | Yes |

- Sandbox = full replica, own account + token (Settings > Integrations > ZAPSIGN API). Prod without API plan → **402**. Wrong-env token → **403**.
- Static API token: one per org, no expiry, rotation UI-only ⚠️. (🔍 SDKs also send `?api_token=` — use header.)
- JWT (`POST /api/v1/auth/token/{organization_id}/` with user username/password; access 1h; refresh `POST /api/v1/auth/token-refresh/`) — needs a real user password → **not for us; use static token per tenant.**
- Other tokens: User Token (batch sign / refuse-by-user only), doc/signer/template tokens (UUIDs).

## 2. Object model
- **Document:** `token` (UUID, the key), `open_id` (display int), `external_id` (ours). Fields: `sandbox, name, folder_path, folder_token, status, rejected_reason, lang, original_file, signed_file, extra_docs[], created_through, deleted, deleted_at, signed_file_only_finished, disable_signer_emails, brand_logo, brand_primary_color, created_at, last_update_at, created_by{email}, template, signers[], answers[], auto_reminder` (+ newer: `metadata[], signature_report, tsa_country, use_timestamp`).
- **Envelope:** no separate object — main doc + up to 14 extra docs (15 total), same signers/flow. Extra docs can't be removed.
- **Signer:** `token`, `sign_url` = `https://app.zapsign.com.br/verificar/{signer_token}` (sandbox host ⚠️ confirm), `external_id`.
- **Template:** `token`; DOCX (dynamic) or PDF; only DOCX supports API create-from-template.
- **Folder:** no CRUD API; `folder_path` (auto-created, 255 chars, 50/level, 5 levels) or `folder_token` (from web URL `?pasta=`).
- **Doc status ⚠️ inconsistent:** `pending`, `signed` (Detail); `refused` (list filter); `"rejected"` (cancel text); `"recusado"` (refused webhook example). Expiry only via `doc_expired` event (status stays `pending`). → **Rely on `event_type`; treat unknown status as unknown.**
- **Signer status:** detail: `new, link-opened, signed`; list with signers (stable): `nao_abriu, abriu, assinou, recusou, expirou, cancelado`.
- Timestamps UTC+0 ISO-8601.

## 3. Create document
`POST /api/v1/docs/` — **JSON only**. Source (exactly one): `url_pdf` | `base64_pdf` (raw base64, no data: prefix) | `url_docx` | `base64_docx` | `markdown_text`. **10 MB max.**

| Param | Notes |
|---|---|
| `name` | ≤255 |
| `signers[]` | see §4 |
| `lang` | `pt-br` default, `es`, `en` |
| `disable_signer_emails` | disables all signer emails |
| `signed_file_only_finished` | 🔍 SDK only: hides download buttons in signer UI |
| `brand_logo` / `brand_primary_color` / `brand_name` | public image URL / hex / ≤100 chars |
| `external_id` | ours |
| `folder_path` / `folder_token` | |
| `created_by` | account user email |
| `date_limit_to_sign` | `YYYY-MM-DD` or ISO |
| `signature_order_active` | bool |
| `observers` | ≤20 emails, notified on completion |
| `reminder_every_n_days` | only with automatic send; max tries 6 or 3 ⚠️ |
| `allow_refuse_signature` | default false |
| `disable_signers_get_original_file` | bool |
| `metadata` | `[{key,value}]`, echoed in webhooks |
| `has_simplified_signature` + `simplified_signature_position` | text block instead of drawn sig |
| `signature_placement` / `rubrica_placement` | anchors (§5) |

Response: Document with `token`, `status:"pending"`, `original_file`, `signed_file:null`, `signers[]` with `token` + `sign_url`.
🔍 Async variant `POST /api/v1/docs/async/` returns `{token}` only.
From template: `POST /api/v1/models/create-doc/` (`template_id`, `signer_name`, `data:[{de,para}]`, single signer; add more after). OneClick clickwrap: `one_click_active:true`.

## 4. Signers
Fields: `name`*, `email` / `phone_country` + `phone_number` (one required).
`auth_mode`: `assinaturaTela` (default, free), `tokenEmail` / `assinaturaTela-tokenEmail` (free), `tokenSms` (EN free / PT R$0.10 ⚠️), `tokenWhatsapp` (5 credits), `certificadoDigital` (5 credits, PT).
Biometrics: `selfie_validation_type`, `document_photo_url`, `require_selfie_photo`, `require_document_photo`. ID: `require_cpf`, `cpf`, `validate_cpf` (Receita), `require_rg`.
Delivery: `send_automatic_email`, `send_automatic_whatsapp` (paid), `send_automatic_whatsapp_signed_file` (paid), `custom_message` (WhatsApp: no newlines/tabs).
Order: `order_group` + doc `signature_order_active`; account pref "Block signature out of order" must be ON.
Locks/visibility: `lock_name/email/phone`, `blank_email/phone`, `hide_email/phone`. Other: `qualification`, `external_id`, `redirect_link`.
Response-only: `token, sign_url, status, times_viewed, last_view_at, signed_at, geo_*, resend_attempts, signature_image, ip, …`.

| Action | Endpoint | Notes |
|---|---|---|
| Detail | `GET /api/v1/signers/{signer_token}/` | |
| Add | `POST /api/v1/docs/{doc_token}/add-signer/` | fires `created_signer` |
| Update | `POST /api/v1/signers/{signer_token}/` | POST not PUT; before signing only; also the resend mechanism (max 1 / 30 min) |
| Delete | `DELETE /api/v1/signer/{signer_token}/remove/` | singular `signer`; not signed/not only signer |
| Bulk resend (PT) | `POST /api/v1/docs/{doc_token}/resend-notifications-bulk/` | 429 `cooldown_period` |
| Remove groups | `DELETE /api/v1/signature-group/{doc_token}/` | |
⚠️ `order_group` starts at 0 or 1 — contradiction; test.

## 5. Signature positioning
- **Anchor text:** marker e.g. `<<signer1>>` in PDF/DOCX + signer `signature_placement: "<<signer1>>"` (every occurrence gets a signature; white text hides marker).
- **Coordinates:** `POST /api/v1/docs/{doc_token}/place-signatures/` `{"rubricas":[{type:"signature"|"visto", page (0-based), relative_position_bottom, relative_position_left, relative_size_x, relative_size_y, signer_token}]}`. Origin bottom-left, percentages. A4 portrait signature 19.55×9.42, visto 13.76×9.42. Each POST replaces all; `[]` clears. Response undocumented ⚠️.
- **None:** signatures appear only on the appended signature report page.

## 6. Retrieving files & audit trail
- `GET /api/v1/docs/{doc_token}/` → `original_file`, `signed_file` = pre-signed S3 URLs, **60 min**.
- Evidence page appended to `signed_file` (help center; verify in sandbox). No separate report URL.
- `POST /api/v1/validate-pdf-signature/` (multipart `file`) → `{isValid, message, authority, signingDate, commonName}`.
- ⚠️ Whether `signed_file` is populated before all signers sign — undocumented. `doc_signed` fires per signer. **Rule: fetch PDF only when doc `status=="signed"`, re-fetch via Detail.**
- Activity log: `GET /api/v1/docs/signer-log/{doc_token}?download_pdf=true|false` → `[{time,user,event,description}]` or PDF.
- List: `GET /api/v1/docs/?page=N` filters `status, folder_path, deleted, signer_email, created_from, created_to, sort_order, include_signers`; cached 60 s; shape inconsistent ⚠️.

## 7. Webhooks
- Create: `POST /api/v1/user/company/webhook/` `{url*, type*, doc_token?, headers?:[{name,value}]}` → `{id}`. Account-level; free.
- `type`: `""` (all = created/signed/deleted/refused only), `doc_signed`, `doc_created`, `doc_deleted`, PT adds `doc_refused`, `email_bounce` (separate registration). ⚠️ type values for viewed/expired/etc undocumented.
- Add headers: `POST /api/v1/user/company/webhook/header/` `{id, headers}`. Delete: `DELETE /api/v1/user/company/webhook/delete/` `{id}`. ⚠️ No list/get.
- Reprocess: `POST /api/v1/docs/{doc_token}/reprocess-doc/` `{send_webhook, resign_doc}`.
- Events (`event_type`): `doc_created`, `created_signer`, `doc_signed` (each signer; `signer_who_signed{}`), `doc_refused` (`rejected_reason`), `doc_deleted`, `doc_viewed`, `doc_read_confirmation`, `signature_notification_sent`, `email_bounce` (small payload), `signer_authentication_failed`, `doc_expired`, `doc_expiration_alert` (7/3/1 days), `background_check_completed`.
- Payload = full Document object (except `email_bounce`).
- **Security:** no signature/HMAC/IP list → per-tenant secret custom header + re-fetch state. Return 200. No event ID → build idempotency key from `event_type + token + (signer token | signed_at | last_update_at)`. Ignore unknown events.

## 8. Embedded signing (widget)
`<iframe src="https://app.zapsign.com.br/verificar/{signer_token}" allow="camera">`; `postMessage` bare strings: `zs-doc-loaded`, `zs-doc-signed`, `zs-signed-file-ready`. No branding params. NC CSP needs `frame-src` for ZapSign.

## 9. Branding
Per doc: `brand_logo`, `brand_primary_color`, `brand_name`. Account: UI only (paid); API only at sub-account creation (`primary_color`, `logo_url` ⚠️ base64?). Full white-label scope → partner team.

## 10. Partner / reseller API (complete set)
| Endpoint | Purpose |
|---|---|
| `POST /api/v1/partner/company/` | Create sub-account. Req: `country`, `lang`, `company_name`; opt `email` (Member), `phone_*`, `primary_color`, `logo_url`. Resp `{id, name, api_token, created_at, credits_balance, lang, timezone}` |
| `POST /api/v1/partner/update-payment-status/` | partner token; `{client_api_token, payment_status: adimplente|inadimplente}` |
| `GET /api/v1/info-plan/partners-csv/?start_date&end_date` | usage CSV per linked account (≤30 days): documents_created, envelopes_created, qty_sms, qty_whatsapp, qty_digital_certificate, qty_biometry…, qty_facial_recognition… |
- Partner owner becomes owner of each sub-account. Sub-accounts can't nest. **All usage billed to partner.**
- ⚠️ Not available: list sub-accounts, get/rotate token, delete sub-account, partner-side webhook setup (use sub-account token), credit transfer.

## 11. Other
- Update doc: `PUT /api/v1/docs/{doc_token}/` (name, date_limit_to_sign, folder, extra_docs names).
- Extra doc: `POST /api/v1/docs/{doc_token}/upload-extra-doc/`.
- Delete: `DELETE /api/v1/docs/{doc_token}/` (soft, irreversible).
- **Cancel:** `POST /api/v1/refuse/` `{doc_token*, rejected_reason*, notify_signer?}` — in-progress only, "Rejected document" watermark, async, **User-Agent header mandatory**.
- Plan info: `GET /api/v1/info-plan` → `{name, number_of_credits, status, period, current_period_end}`.
- Users: `GET /api/v1/users/`, `POST /api/v1/users/create-user` (role member|admin|self_docs_limited), `DELETE /api/v1/users/{email}/`.
- Timestamp add-on: `POST /api/v1/timestamp/`.
- **Rate limit:** 500 req/min per IP **or** token; 429; tenants on same host share egress IP ⚠️.
- Errors: 400/401/402/403/404/406/429; bodies non-uniform (`detail|message|error|non_field_errors|string`).
- Conventions: omit or `""`, never `null` for strings; real JSON booleans; UTC.
- Limits: 10 MB/file; 15 docs/envelope; 20 observers; signers/doc & page count undocumented ⚠️.

## 12. Pricing concepts
- Needs API plan (monthly/annual). **Every created document counts, even deleted/unsigned.**
- 1 credit = R$0.10 (PT). WhatsApp token/send = 5 credits (R$0.50); SMS R$0.10 (PT) / free (EN) ⚠️; certificadoDigital 5; liveness 15–25; face-match-datavalid 35; identity-verification-global 50.
- Sub-account usage billed to partner.

## Open questions for ZapSign
1. Webhook retry count/interval; any HMAC/IP list?
2. Does `signed_file` always include the report page? Populated before completion?
3. Canonical doc status values (refused/rejected/recusado)? `expired` status?
4. API `type` for doc_viewed / doc_expired / other events?
5. List sub-accounts / get-rotate token / delete sub-account? Partner white-label scope (no "via ZapSign", custom domain, report branding)?
6. Max signers per doc, max pages? Sandbox `sign_url` host?
7. `order_group` 0 or 1?
8. Are `/docs/async/` endpoints officially supported?
