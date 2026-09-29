# Assinaturas: implementation roadmap

**Spec:** [`docs/superpowers/specs/2026-09-28-assinaturas-zapsign-design.md`](../specs/2026-09-28-assinaturas-zapsign-design.md)
**API reference:** [`docs/zapsign/api-digest.md`](../../zapsign/api-digest.md)

The spec is delivered as four sequential plans. Each plan ends with software that works and is tested on its own. We write a plan's full task list only once the plan before it is done:

- Plan 1's sandbox spikes decide some mechanics in Plan 2.
- Plan 2's real API shapes feed Plan 3.

| # | Plan | Delivers | Exit criteria | Status |
|---|---|---|---|---|
| 1 | [Foundation + sandbox spikes](2026-09-28-assinaturas-plan-1-foundation-and-spikes.md) | App repo and scaffold, local PHPUnit env, DB schema (entities + mappers), a fully tested `ZapSignClient`, spike tooling, spike findings recorded | All tests green; spikes answered in `docs/zapsign/sandbox-findings.md`; Plan A/B release mechanics decided | **Done** (2026-09-29). App repo `avuz-conecta/assinaturas` at `98579f4`, 104 tests green. Findings: [`sandbox-findings.md`](../../zapsign/sandbox-findings.md) |
| 2 | Envelope lifecycle (backend) | Access gate, draft API, resumable Send (`SendJob`), sync (webhook + tiered poller + lease recovery + reminders; ZapSign handles next-group emails), status mapping, completion + `SignedFileStore`, actions (cancel, correct email, extend deadline, remind, delete, copy link), `occ assinaturas:webhook:ensure`, notifications, admin panel API | Full lifecycle driven through the JSON API against the ZapSign sandbox on the local env (webhooks via tunnel), signed PDFs land next to originals | Not written |
| 3 | Frontend | Vue 3 + `@nextcloud/vue` + `pdfjs-dist`: dashboard, 4-step wizard, placement editor, detail view, Files action, admin settings page, pt_BR l10n, WCAG 2.0 AA; JPEG2000 scanned-PDF check under our CSP | The whole flow works in the browser on the local env; Vitest green | Not written |
| 4 | Platform integration + rollout | avuz-server submodule, `AVUZ_OWNED_APPS`, every-boot entrypoint block (`--type=string --sensitive`), `scripts/zapsign-create-tenant.sh`, CLAUDE.md, staging deploy (sandbox), Cloudflare WAF rule, webhook smoke test, E2E on staging, then pilot tenant (production is gated) | Staging E2E passes; pilot tenant signs a real envelope | Not written |

## Contracts between plans

Later plans depend on these. Changing one means updating this roadmap.

- **Plan 1 → Plan 2:**
  - `ZapSignClient` method set and DTOs (`lib/ZapSign/**`);
  - entities, mappers and `EnvelopeMapper::transitionStatus()`;
  - `ZapSignSettings`;
  - `PlacementConverter`;
  - the spike findings.
- **Plan 2 → Plan 3:** JSON API routes and response shapes. Plan 2 documents them in `docs/api.md` inside the app repo.
- **Plan 2 → Plan 4:**
  - config keys `api_token`, `environment`, `company_name`, `webhook_secret`;
  - the `occ assinaturas:webhook:ensure` command;
  - group id `assinaturas`.

## Plan 2 carry-over (from the Plan 1 final review, 2026-09-29)

Plan 2's first task hardens the client:
- mark `CallMonitor::observe`'s `$call` closure `#[\SensitiveParameter]` (a deep dumper can see the captured request);
- wrap `json_encode` failures in `buildRequest` in a sanitized exception (invalid UTF-8 would dump signer PII);
- make `findDocumentsByFolder` / `listDocumentsWithSigners` reject a 2xx body that isn't a real page shape (today `[]` reads as "no documents", which could re-create an envelope after an unknown outcome).

Plan 2 design must account for:
- **Status normalization.** Detail endpoint: `pending`/`signed`/`recusado`; signer `new`/`signed`/`rejeitou`, plus `status_code`. List endpoint: Portuguese signer values (`assinou`/`recusou`).
- **Refusing signers have `signed_at` set.** Read `first_opened_at`/`last_view_at` for `viewed_at`.
- **`signed_file` isn't a completion signal**: it's present while `pending` and when `recusado`. Finalize on status `signed` only.
- **Envelope identity:**
  - normalize `folder_path`'s trailing slash;
  - ignore list rows for extra documents;
  - after adopting by folder, call `getDocument` to get signer tokens;
  - `original_file_hash` could check adoption against `sent_sha256`.
- **Signed-file download:** fetch pre-signed S3 URLs **without** Authorization, from an allowlisted host (SSRF), and re-fetch the document on expiry.
- **Fingerprint (spec fix needed).** Today `sha256(token|env)`, so rotating a leaked token would archive every live envelope. Base it on environment + instance URL, with an explicit re-key command for domain moves.
- **Token check:** in the sandbox `info-plan` is 404, so check the token with `listDocumentsWithSigners(1)`.
- **Jobs:**
  - turn `ZapSignRateLimited` into a reschedule, keeping the per-signer cooldown separate from the global pause;
  - treat `ZapSignNotFound` on webhook delete as success;
  - never pass provider messages (they can contain PII) to logs;
  - `insertIfNew` stays outside transactions;
  - list rows grow about 10× with extra documents.
- **Spec vs code on 429:** the spec's retry table says idempotent calls retry; the code pauses globally and throws. Retry lives at the job layer, so align the spec.
- **`updateSignerEmail`** hits the same endpoint as release. Verify on staging that it doesn't notify, or make it non-idempotent.
- **History:** rewritten 2026-09-29. The test IP, geolocation, phone number and S3 URLs were purged from every commit and force-pushed (`c737e4e` → `98579f4`). GitHub may keep the old SHAs reachable until its own GC runs.
