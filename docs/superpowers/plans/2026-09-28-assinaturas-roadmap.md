# Assinaturas: implementation roadmap

**Spec:** [`docs/superpowers/specs/2026-09-28-assinaturas-zapsign-design.md`](../specs/2026-09-28-assinaturas-zapsign-design.md)
**API reference:** [`docs/zapsign/api-digest.md`](../../zapsign/api-digest.md)

The spec is delivered as sequential plans (Plan 2 is split into 2a and 2b). Each plan ends with software that works and is tested on its own. We write a plan's full task list only once the plan before it is done:

- Plan 1's sandbox spikes decide some mechanics in Plan 2.
- Plan 2's real API shapes feed Plan 3.

| # | Plan | Delivers | Exit criteria | Status |
|---|---|---|---|---|
| 1 | [Foundation + sandbox spikes](2026-09-28-assinaturas-plan-1-foundation-and-spikes.md) | App repo and scaffold, local PHPUnit env, DB schema (entities + mappers), a fully tested `ZapSignClient`, spike tooling, spike findings recorded | All tests green; spikes answered in `docs/zapsign/sandbox-findings.md`; Plan A/B release mechanics decided | **Done** (2026-09-29). App repo `avuz-conecta/assinaturas` at `98579f4`, 104 tests green. Findings: [`sandbox-findings.md`](../../zapsign/sandbox-findings.md) |
| 2a | [Core lifecycle](2026-09-29-assinaturas-plan-2a-core-lifecycle.md) | Client hardening, status mapping, access gate (group `assinaturas`), draft JSON API (`docs/api.md`), resumable Send (`SendJob`), signed-file download + `SignedFileStore`, completion, synchronizer, webhooks (secret header, coalesced `SyncEnvelopeJob`, `occ assinaturas:webhook:ensure`), tiered poller with lease recovery and sandbox archive | A sandbox envelope is created, sent, signed by two groups and completed through the real services; signed PDFs land next to the originals; all tests green | **Done** (2026-09-29). App branch `plan-2a-core-lifecycle` at `1d00fc9`, 397 tests green; sandbox E2E passed (see `sandbox-findings.md`) |
| 2b | [Actions + ops](2026-09-30-assinaturas-plan-2b-actions-and-ops.md) | Discard / return-to-draft for failed envelopes (2a has no exit for permanent send errors), cancel, correct email, extend deadline, remind (our scheduler), delete, copy link, notifications, admin panel API, email-bounce handling, token check (`listDocumentsWithSigners(1)`), metrics | The actions work through the JSON API against the sandbox | **Done** (2026-10-01). App branch `plan-2b-actions-and-ops` at `c7d5f6d`, 590 tests; sandbox spike + E2E passed (see `sandbox-findings.md`). Plan 3 must show the reminder/correction countdown (`lastReminderAt`, `inviteAvailableInSeconds`, 30 min per signer) |
| 3a | [Frontend foundation](2026-10-01-assinaturas-plan-3a-frontend-foundation.md) | Vue 3 + `@nextcloud/vue` 9.9 + Vite + TS toolchain, app page + members-only nav, typed API client + query keys, app shell (error boundary, sandbox banner, Novo envelope), Files action, admin settings page | Vitest + PHP green; build reproducible | **Done** (2026-10-02). Branch `plan-3a-frontend-foundation` at `496b1a1` (pushed, NOT merged), 171 vitest + 621 PHP. Needs a browser smoke test (Files action, admin page) |
| 3b | Frontend screens | Dashboard, wizard, placement editor (pdf.js), detail view | The whole flow works in the browser | Done 2026-10-02 (branch `plan-3b-screens`, pushed, not merged; 1509 vitest + 689 PHP; browser-verified vs mockups at 1100/1280/1440 + phone; real-device pinch test pending → do on avuz-conecta-2 in Plan 4 once the app ships in the image) |
| 4 | Platform integration + rollout | Live webhook delivery through Cloudflare (Plan 2a proves the receive path with tests only), avuz-server submodule, `AVUZ_OWNED_APPS`, every-boot entrypoint block (`--type=string --sensitive`), `scripts/zapsign-create-tenant.sh`, CLAUDE.md, staging deploy (sandbox), Cloudflare WAF rule, webhook smoke test, E2E on staging, then pilot tenant (production is gated) | Staging E2E passes; pilot tenant signs a real envelope | Not written |

## Contracts between plans

Later plans depend on these. Changing one means updating this roadmap.

- **Plan 1 → Plan 2:**
  - `ZapSignClient` method set and DTOs (`lib/ZapSign/**`);
  - entities, mappers and `EnvelopeMapper::transitionStatus()`;
  - `ZapSignSettings`;
  - `PlacementConverter`;
  - the spike findings.
- **Plan 2 → Plan 3:** JSON API routes and response shapes. Plans 2a/2b document them in `docs/api.md` inside the app repo.
- **Plan 2 → Plan 4:**
  - config keys `api_token`, `environment`, `company_name`, `webhook_secret`;
  - the `occ assinaturas:webhook:ensure` command;
  - group id `assinaturas`.

## Plan 2 carry-over (from the Plan 1 final review, 2026-09-29)

Plan 2a Task 1 hardens the client:
- mark `CallMonitor::observe`'s `$call` closure `#[\SensitiveParameter]` (a deep dumper can see the captured request);
- wrap `json_encode` failures in `buildRequest` in a sanitized exception (invalid UTF-8 would dump signer PII);
- make `findDocumentsByFolder` / `listDocumentsWithSigners` reject a 2xx body that isn't a real page shape (today `[]` reads as "no documents", which could re-create an envelope after an unknown outcome).

Plan 2a covers these, except where marked 2b:
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
- **(2b) `updateSignerEmail`** hits the same endpoint as release. Verify on staging that it doesn't notify, or make it non-idempotent.
- **History:** rewritten 2026-09-29. The test IP, geolocation, phone number and S3 URLs were purged from every commit and force-pushed (`c737e4e` → `98579f4`). GitHub may keep the old SHAs reachable until its own GC runs.
