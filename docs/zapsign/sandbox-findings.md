# ZapSign sandbox findings

**Run dates:** 2026-09-28 to 2026-09-29.
**Environment:** ZapSign sandbox.
**Runner:** `assinaturas/tests/spike/run.php`.

Signers were Patrick's two real inboxes (`patrick@avuz.cloud`, `patrick.dm.rezende@gmail.com`). Webhooks went to a local capture server through a Cloudflare quick tunnel.

Real payloads are recorded (emails, IP and geolocation scrubbed) in the app repo under `tests/fixtures/zapsign/recorded-*.json`. `RecordedPayloadsTest` proves the models parse them.

## Decisions for Plan 2

1. **Release mechanics: Plan A holds, and needs less work than expected.**
   - Create with per-signer `send_automatic_email: false`, then release **only order group 1**.
   - ZapSign emails each next group automatically after the previous one signs. Its notifications also enforce order: releasing a later group emails the current group instead.
   - ZapSign emails every signer the final signed copy.
   - **So we drop** SyncJob's next-group release and our own final-copy email.
   - We keep our own reminders, because they also serve the v2 WhatsApp channel.
2. **Signing order is NOT enforced on the link itself by default.** Signer 2 signed before signer 1 by opening their link directly. The per-sub-account preference "Block signature out of the defined order" is **mandatory**:
   - it's in the provisioning runbook;
   - the staging E2E must verify it;
   - ask ZapSign whether an API can set it.
3. **The status mapper must accept the Portuguese values.**
   - Document: `pending`, `signed`, **`recusado`** (both company cancel and signer refusal).
   - Signer detail: `new`, `signed`, **`rejeitou`**.
   - Signer list: `assinou`, `recusou`.
4. **Event names don't mean what they say.** A company cancel fires **`doc_signed` with status `recusado`**, with no `doc_refused`. A signer refusal fires `doc_refused` and then, about 40 seconds later, `doc_signed` with status `recusado` (the watermarked PDF). → Drive all state from a re-fetch, as the spec already requires.
5. **The list endpoint returns extra documents as separate rows** (they have no signers). The poller must ignore rows that aren't known main documents.
6. **Extra-document order is not stable.** The detail endpoint sorts `extra_docs` by name, and webhook payloads vary the order between deliveries. → Match extra documents by **token** only. Resume adoption compares token sets, never positions.
7. **The activity-log API returns 403** (`/docs/signer-log/...`, every variant). → Drop "Relatório de atividades" from v1 unless ZapSign enables it. The evidence page in each signed PDF is the legal artifact.
8. **`GET /info-plan` returns 404 in sandbox.** → The admin panel checks the token with a cheap call (`GET /docs/?page=1`) and shows plan info only when available.
9. **The placement editor must show the full stamp footprint.** ZapSign draws the signature in the box, then prints "Assinado digitalmente via ZapSign por … / Data …" **to the right of the box**, making the stamp about 2.5× the box width. Stamps near the right edge got clipped. ZapSign also adds a footer line at the bottom-left of every page, where boxes shouldn't go.
10. **No rotation mapping is needed.** ZapSign places boxes in the page's displayed space, including `/Rotate 90/270` and CropBox offsets. Plan 1 Task 9 Step 9 was skipped.

## Spike 1: Release and emails
| Question | Observed | Evidence |
|---|---|---|
| 0. Emails at creation (per-signer `send_automatic_email:false`)? | **None** sent at creation | Both inboxes empty until release (created 17:05:04 BRT, first email 17:05:57) |
| 1a. Does `releaseSigner` send the FIRST email? | **Yes** | Email "Assinar documento: Spike 1 — ordem de assinatura" at 17:05; `signature_notification_sent` webhook at 20:05:59Z |
| 1b. After group 1 signs, is group 2 emailed automatically? | **Yes** | Signer 2's email arrived right after signer 1 signed; `signature_notification_sent` at 20:44:25Z |
| 1c. Releasing group 2 before group 1 signs? | **ZapSign emailed signer 1 (the current group) instead.** Notifications follow the order. **But signer 2 could still sign via their direct link before signer 1.** The account preference was off (default) | Doc `60136b81`: signer 2 signed 20:56:15Z, signer 1 20:57:12Z |
| 1d. Do signers receive the final signed copy? | **Yes, both** | Patrick confirmed. The "completed" email arrived before the per-signer receipts (a cosmetic ZapSign ordering quirk) |
| 1e. Where does `custom_message` appear? | Shown in italics under the intro in **ZapSign-originated** emails (auto progression, order-redirected release). **Not shown** in the email triggered by our direct `releaseSigner` of that same signer. The signer API never echoes `custom_message` | Screenshots 1–3. Whether sending `custom_message` inside the release payload fixes it is **unverified** → include it in the release call in Plan 2 and verify on the staging E2E |
| 1f. Second `releaseSigner` within seconds? | HTTP 200, **no second email, no 429** (deduplicated) | Release ×2 at 20:05:57Z; one email received |
| Email branding | From "**Avuz Conecta via ZapSign**". Body: "Sua assinatura foi solicitada por **<ZapSign account owner email>** de **<brand_name>**". **Reply-To = account owner email.** ZapSign logo (no `brand_logo` sent) and "O que é a ZapSign?" footer with ZapSign seals | Screenshots. In production the owner is the partner/sub-account owner → **signers' replies go to that inbox, not the tenant sender.** Partner white-label question for ZapSign |
| **Decision** | **Plan A holds.** Release group 1 only; ZapSign handles progression and the final copy. Add `custom_message` to the release payload (verify on staging) | |

## Spike 2: Signed files
| Question | Observed | Evidence |
|---|---|---|
| 2a. Evidence page appended to the main signed PDF? | **Yes.** 1 page → 2. PAdES seal CN "ZAPSIGN PROCESSAMENTO DE DADOS LTDA". `use_timestamp: true` | `pdfinfo` and `pdfsig` on `main-signed.pdf` |
| 2b. Appended to each extra document too? | **Yes**, each file is sealed separately. 3 pages → 4 | `extra-signed.pdf` |
| 2c. When is `signed_file` populated? | **After the FIRST signature, while status is still `pending`** (partial PDF). → Finalize only on status `signed` | Inspect after signer 1 signed: `status=pending`, `signed_file` set |
| 2d. Activity log (`signer-log?download_pdf=true`) | **HTTP 403 "Access denied"** (text/html) for every path variant; `/docs/{t}/signer-log/` → 404 | Runner `raw` calls |

## Spike 3: Formats and geometry
| Question | Observed | Evidence |
|---|---|---|
| 3a. Sandbox `sign_url` host | `https://sandbox.app.zapsign.com.br/verificar/{signer_token}` | Create response |
| 3b. `order_group` 0 accepted? | **Yes** | `send-order-group-zero` → accepted |
| 3c. Landscape page | Boxes land as placed | `geo-sheet.png` |
| 3d. `/Rotate 90` and `/Rotate 270` | Boxes land where **displayed** (top-left and bottom-right as seen), stamps upright. **No rotation mapping needed** | `geo-sheet.png`; signed PDFs keep `/Rotate` |
| 3e. CropBox-offset page | Placed relative to the **visible (CropBox)** area | `geo-sheet.png` |
| 3f. Extra-document placement via its own token | **Works**, including mixed page sizes in one file | Mixed pages 1–3 correct |
| Stamp footprint | The signature box holds the drawn signature; the attestation text sits **to the right, outside the box** (about 2.5× the box width); it clipped at the right edge | `main-p-1.png` |
| Page footer | ZapSign prints a footer line at the bottom-left of **every** page | All renders |
| Response shape | Signer objects **have no `order_group` key**. `folder_path` is returned **with a trailing slash**. Documents carry `original_file_hash`. **`sandbox: false` even in the sandbox** → trust our own environment config | Recorded fixtures |
| Adoption lookup | `GET /docs/?folder_path=` finds the main document **with or without** the trailing slash, and returns only the main document | `findDocumentsByFolder` both forms → `e65cc5d6(main)` |

## Spike 4: Webhooks
| Question | Observed | Evidence |
|---|---|---|
| 4a. Accepted `type` values | **ZapSign accepts ANY string**, even `bogus_type_xyz`, so acceptance proves nothing. Types seen **delivering**: `all` (created, signed, refused), `doc_created`, `doc_signed`, `doc_refused`, `doc_viewed`, `doc_read_confirmation`, `signature_notification_sent`. Registered but never triggered here: `email_bounce`, `doc_expired`, `doc_deleted`, `created_signer`, `doc_expiration_alert`, `signer_authentication_failed`. The bogus type delivered nothing | One registration per path, `webhooks.jsonl` |
| 4b. Custom header delivered? | **Yes, verbatim** (`X-Assinaturas-Spike: spike-secret`) | Captured headers |
| 4c. Payload of an event on an envelope with extra documents | The top-level `token` is always the **main** document. `extra_docs` are nested, **in varying order** between deliveries | Geometry envelope events |
| 4d. Retry cadence (FAIL_FIRST=3) | Registration `doc_created`: failed at 12:43:49, **retried 6s later**, succeeded. Registration `all`: failed at 12:43:50 and 12:43:55, then **no further attempt** in the observation window. → Retries are few and quick; **the poller safety net is essential** | `webhooks.jsonl` (retry test) |
| 4e. Company cancel | Fires **`doc_signed` with status `recusado`**, not `doc_refused`. After cancel: `status=recusado`, `deleted=false`, `rejected_reason` set, watermarked `signed_file` present | Doc `aac889eb` |
| Signer refusal | `doc_refused` (status `recusado`), then `doc_signed` with status `recusado` about 40s later. Detail signer status **`rejeitou`**; list signer status `recusou`. **ZapSign's refuse UI requires a minimum reason length** (15 characters rejected, 22 accepted) | Doc `a70d727e` |
| Duplicates | `doc_viewed` fired 3× within one second for one view, and again after completion | `webhooks.jsonl` |

## Spike 5: Inbox noise
| Question | Observed | Evidence |
|---|---|---|
| 5. Does the account owner receive emails for API-created documents? | **Not isolatable in the sandbox**: the owner (`patrick@avuz.cloud`) was also signer 1. No separate "document created" notification arrived. What *is* clear: the owner's email appears in the signer email body and as Reply-To (see Spike 1). **Re-check on the pilot sub-account (Plan 4)** | — |

## Spike 6: Limits
| Question | Observed | Evidence |
|---|---|---|
| 6a. Maximum extra documents per envelope | **9 extras = 10 files** in the sandbox ("Limite de documentos extra (9) atingido."). The docs say 14 and the commercial terms mention 20 → **confirm the production plan's limit** | `send-limits` |
| 6b. 11 MB PDF accepted? | **Accepted.** Keep our 10 MB validation as the documented bound unless ZapSign confirms more | `send-limits` |

## Questions for ZapSign (updated)
1. Can the "Block signature out of the defined order" preference be set via API per sub-account?
2. The activity-log endpoint returns 403: is it plan-gated?
3. What is the webhook retry policy? We observed at most one retry about 5 seconds later.
4. Envelope file limit on our production plan (sandbox: 10 files).
5. Partner white-label scope:
   - Can the Reply-To and the "solicitada por <owner email>" text use the tenant sender?
   - Can the ZapSign footer be removed, and "via ZapSign" dropped?
6. The email triggered by the release call (update signer) omits the creation-time `custom_message`. Is that expected, and does passing `custom_message` in the update apply it?
