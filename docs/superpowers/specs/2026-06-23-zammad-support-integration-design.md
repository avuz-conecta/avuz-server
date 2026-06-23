# Zammad Support Integration — Design

**Date:** 2026-06-23
**Status:** Approved (design); pending implementation plan
**Branch:** avuz-customization

## Problem

Avuz Conecta customers have no in-product way to reach support. Today support runs on
two tools: **Milldesk** (ticket control, no client communication) and **Lero** (a
WhatsApp bot for first contact). Every WhatsApp conversation becomes a Milldesk ticket.
The goal is to centralize on **one tool** for both live communication and ticket control,
drop WhatsApp, and surface support directly inside each Nextcloud instance.

## Decision

Adopt **Zammad** (AGPLv3, self-hosted) as the single support backend.

Zammad is the only evaluated option that covers all three requirements *and* has a
first-party Nextcloud integration:

| Requirement | Zammad |
|---|---|
| Live chat | Website chat widget via JS snippet; one-click chat→ticket; themable colors |
| Ticket control | Full helpdesk: SLA, triggers, macros, email, knowledge base |
| Self-host | AGPLv3, own infrastructure, full data control |
| NC-native | Official Zammad integration app (dashboard widget, unified search, notifications) |

Alternatives rejected:
- **Milldesk + WhatsApp module** — keeps WhatsApp (we want it gone) and stays closed-source.
- **Chatwoot** — best pure-chat UX, but weaker ITSM-style ticketing than Zammad.

### Caveats accepted
1. **Ops weight.** Zammad needs Ruby/Rails + PostgreSQL + Elasticsearch + Redis;
   Elasticsearch wants ~2GB RAM. Runs as its own Docker stack, separate from the NC
   PHP/nginx stack (same pattern as the talk-recording stack).
2. **Chat widget visibility.** The widget only shows when an agent is online with chat
   capacity. Offline → no chat button; the ticket portal/email path remains.

## Terminology

- **Client / tenant** = the company (e.g. Consulttagro, Endopasso) = **one NC instance**
  (own Docker stack, DB, domain) = **one Zammad Organization**.
- **Users** = the people (~10/tenant) who log into that instance.

## Architecture

```
                    ┌─────────────────────────────┐
                    │   Zammad (1 shared stack)    │
                    │   support.avuz.com.br        │
                    │   Orgs: Consulttagro,        │
                    │         Endopasso, ...       │
                    └──────────▲───────────▲───────┘
                       chat JS │           │ portal (iframe/link)
              ┌────────────────┘           └───────────────┐
   ┌───────────────────────┐         ┌───────────────────────┐
   │ Consulttagro NC        │         │ Endopasso NC           │
   │ ZAMMAD_ORG=consulttagro│         │ ZAMMAD_ORG=endopasso   │
   │ floating widget (theme)│         │ floating widget (theme)│
   │ + Suporte menu icon    │         │ + Suporte menu icon    │
   └───────────────────────┘         └───────────────────────┘
```

- **One** Zammad stack serves all tenants. Each NC instance is tagged with its org via env var.
- Zammad stack: Postgres + Elasticsearch + Redis + Zammad, deployed via a Portainer stack
  template, behind Nginx Proxy Manager, on its own domain (e.g. `support.avuz.com.br`).

## Components

### Surface 1 — Floating chat widget (Avuz Conecta / Full profile)
- Zammad chat JS snippet, injected on every NC page via `avuz_theme` — same mechanism as
  the existing `apps/avuz_theme/js/lucide-icons.js`.
- New file `apps/avuz_theme/js/zammad-chat.js`. Reads config from a global the entrypoint
  writes (`window.AVUZ_ZAMMAD`).
- Floating button styled to the Avuz palette (`#2bb5e3`).
- Passes the logged-in NC user (name + email + org) to Zammad as chat prefill.

### Surface 2 — "Suporte" menu icon (both profiles; primary for Slim)
- `nextcloud/external` app (already shipped in the bundled apps).
- Admin-config: menu entry "Suporte", Lucide icon, target = Zammad portal.
- Embed via iframe **or** new-tab link. Iframe requires Zammad to allow framing
  (X-Frame-Options / CSP). Build decides; both paths documented.

### Config delivery (entrypoint)
- New envs: `ZAMMAD_URL`, `ZAMMAD_ORG`, `ZAMMAD_CHAT_ENABLED`.
- Entrypoint writes a small JS config (`window.AVUZ_ZAMMAD = {...}`) and configures
  External Sites via `occ` if the entry is not already present.
- `ZAMMAD_CHAT_ENABLED=false` → no floating widget (Slim profile); menu icon still works.

## Org / Identity mapping

- Each NC instance is baked with `ZAMMAD_ORG=<tenant>` (per-stack env).
- Widget reads the logged-in NC user from the page (`OC.getCurrentUser()` → uid,
  displayName; email via `OCP`/config) and passes `name`, `email`, plus a custom var for
  org to the Zammad chat prefill.
- Zammad side: Organizations are pre-created (Consulttagro, Endopasso, …). A new chat user
  is assigned to its org via the passed var / email-domain rule.
- **Phase B (later, out of scope):** OIDC/SAML SSO (NC as IdP or a shared IdP) for true
  single login, org derived from a claim. Config keys are reserved so this slots in later.

## Delivery profiles (one image, env-gated — same pattern as the S3 toggle)

| Profile | `ZAMMAD_CHAT_ENABLED` | External Sites "Suporte" | Use |
|---|---|---|---|
| **Full (Avuz Conecta)** | `true` | yes | branded NC + floating chat + portal |
| **Slim (support-only)** | `false` | yes | minimal NC, just the Suporte portal |

## Error handling / fallback

- Zammad down / no agent online → chat widget hides itself (native Zammad behavior).
  "Suporte" menu → portal ticket form still works (async path).
- `ZAMMAD_URL` unset → widget no-ops, no JS error (guard the global).
- iframe blocked by CSP → fall back to new-tab link.
- Entrypoint verifies the External Sites app is enabled; logs a clear message if the `occ`
  step fails (existing entrypoint convention).

## Testing / rollout

1. Stand up the Zammad stack on staging; create one test Organization.
2. Build the Full-profile image pointed at staging Zammad; verify the widget appears,
   prefills the NC user, and chat→ticket lands in the correct Org.
3. Build the Slim profile (`ZAMMAD_CHAT_ENABLED=false`); verify only the menu icon shows,
   no widget.
4. Verify fallback: stop Zammad → no JS errors; the portal link degrades gracefully.

## Out of scope

- Phase B SSO (OIDC/SAML).
- Migrating historical Milldesk/Lero data into Zammad.
- The official Zammad NC integration app (dashboard widget / unified search) — can be added
  later on top; not required for the chat + portal surfaces.
