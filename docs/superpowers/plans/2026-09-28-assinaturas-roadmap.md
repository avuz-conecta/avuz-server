# Assinaturas: implementation roadmap

**Spec:** [`docs/superpowers/specs/2026-09-28-assinaturas-zapsign-design.md`](../specs/2026-09-28-assinaturas-zapsign-design.md)
**API reference:** [`docs/zapsign/api-digest.md`](../../zapsign/api-digest.md)

The spec is delivered as four sequential plans. Each plan ends with software that works and is tested on its own. We write a plan's full task list only once the plan before it is done:

- Plan 1's sandbox spikes decide some mechanics in Plan 2.
- Plan 2's real API shapes feed Plan 3.

| # | Plan | Delivers | Exit criteria | Status |
|---|---|---|---|---|
| 1 | [Foundation + sandbox spikes](2026-09-28-assinaturas-plan-1-foundation-and-spikes.md) | App repo and scaffold, local PHPUnit env, DB schema (entities + mappers), a fully tested `ZapSignClient`, spike tooling, spike findings recorded | All tests green; spikes answered in `docs/zapsign/sandbox-findings.md`; Plan A/B release mechanics decided | Written |
| 2 | Envelope lifecycle (backend) | Access gate, draft API, resumable Send (`SendJob`), sync (webhook + tiered poller + lease recovery + reminders + next-group release), status mapping, completion + `SignedFileStore`, actions (cancel, correct email, extend deadline, remind, delete, copy link), `occ assinaturas:webhook:ensure`, notifications, admin panel API | Full lifecycle driven through the JSON API against the ZapSign sandbox on the local env (webhooks via tunnel), signed PDFs land next to originals | Not written |
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
