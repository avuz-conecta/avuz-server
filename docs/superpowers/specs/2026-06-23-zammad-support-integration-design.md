# Zammad Support Integration — Design

**Date:** 2026-06-23
**Status:** Approved (design); pending implementation plan
**Branch:** avuz-customization

## Problem

Avuz Conecta customers have no in-product way to reach support. Support runs on two tools:
**Milldesk** (ticket control + billable time tracking, no client communication) and **Lero**
(a WhatsApp bot for first contact). Every WhatsApp conversation becomes a Milldesk ticket.
Goal: centralize on **one tool** for live communication *and* ticket control *and* billing,
drop WhatsApp, and surface support directly inside each Nextcloud instance.

## Decision

Adopt **Zammad** (AGPLv3, self-hosted) as the single support backend, replacing both
Milldesk and Lero/WhatsApp.

Zammad covers every hard requirement with one tool:

| Requirement | Zammad |
|---|---|
| Live chat | Native website chat widget (JS snippet), agent presence, chat→ticket |
| Ticket control | Full helpdesk: SLA, triggers, macros, email, knowledge base |
| Billable time tracking | Time accounting per ticket; per-organization CSV export, billable/non-billable categories, API-automatable — replaces the Milldesk billing workflow |
| Multi-tenant isolation | Organizations; portal access is org-scoped by Zammad auth |
| Self-host | AGPLv3, own infrastructure, full data control |

Alternatives rejected:
- **Milldesk + WhatsApp module** — keeps WhatsApp (we want it gone), closed-source.
- **Chatwoot** — secure HMAC chat identity, but no native time tracking / billing reports;
  fails the billing requirement, would force a second tool.

### Caveat accepted
**Ops weight.** Zammad needs Ruby/Rails + PostgreSQL + Elasticsearch + Redis;
Elasticsearch wants ~2GB RAM. Runs as its own Docker stack, separate from the NC
PHP/nginx stack (same pattern as the talk-recording stack).

## Terminology

- **Client / tenant** = the company (e.g. Consulttagro, Endopasso) = **one NC instance**
  (own Docker stack, DB, domain) = **one Zammad Organization**.
- **Users** = the people (~10/tenant) who log into that instance.

## Security model — trust split by surface

The two support surfaces have different trust levels. This split is what makes the native
Zammad chat widget safe in a multi-tenant deployment.

| Surface | Trust | Identity | What the user can see |
|---|---|---|---|
| **Floating chat** (native Zammad widget) | low | self-asserted (browser JS); **agent verifies before acting** | only the live conversation — no ticket list, no stored data, no other org |
| **Suporte portal** (Zammad customer interface) | high | **authenticated login**, org-scoped | full tickets, but only the user's own Organization |

- The chat widget cannot pass a server-signed identity (no HMAC, unlike Chatwoot). That is
  acceptable because its blast radius is a single live conversation that exposes nothing
  stored. Agents confirm identity before acting on anything sensitive.
- The **portal is the real security boundary.** All stored data (tickets, history, time)
  sits behind authenticated, org-scoped login. There is no forgeable path from the chat
  widget to another tenant's tickets.

### Residual risk
- Forged name in a live chat → impersonation. Mitigated by agent identity check + zero
  stored-data exposure in chat. Worst case = social-engineering an agent in a live chat;
  low and accepted.

## Architecture

```
                    ┌─────────────────────────────┐
                    │   Zammad (1 shared stack)    │
                    │   support.avuz.com.br        │
                    │   Orgs: Consulttagro,        │
                    │         Endopasso, ...       │
                    └──────────▲───────────▲───────┘
                  chat snippet │           │ portal (authenticated)
              ┌────────────────┘           └───────────────┐
   ┌───────────────────────┐         ┌───────────────────────┐
   │ Consulttagro NC        │         │ Endopasso NC           │
   │ ZAMMAD_ORG=consulttagro│         │ ZAMMAD_ORG=endopasso   │
   │ floating chat (theme)  │         │ floating chat (theme)  │
   │ + Suporte menu icon    │         │ + Suporte menu icon    │
   └───────────────────────┘         └───────────────────────┘
```

- **One** Zammad stack serves all tenants. Each NC instance tagged with its org via env var.
- Zammad stack: Postgres + Elasticsearch + Redis + Zammad, via a Portainer stack template,
  behind Nginx Proxy Manager, on its own domain (e.g. `support.avuz.com.br`).

## Components

### Surface 1 — Floating chat widget (Full / Avuz Conecta profile)
- Native Zammad chat JS snippet, injected on every NC page via `avuz_theme` — same mechanism
  as the existing `apps/avuz_theme/js/lucide-icons.js`.
- New file `apps/avuz_theme/js/zammad-chat.js`; reads config from a global the entrypoint
  writes (`window.AVUZ_ZAMMAD`).
- Floating button styled to the Avuz palette (`#2bb5e3`).
- Prefills the logged-in NC user's name/email as a *convenience* (not a security control —
  agents verify identity).

### Surface 2 — "Suporte" menu icon (both profiles; primary for Slim)
- `nextcloud/external` app (already shipped in the bundled apps).
- Admin-config: menu entry "Suporte", Lucide icon, target = Zammad customer portal.
- Embed via iframe **or** new-tab link. Iframe requires Zammad to allow framing
  (X-Frame-Options / CSP). Build decides; both paths documented.

### Config delivery (entrypoint)
- New envs: `ZAMMAD_URL`, `ZAMMAD_ORG`, `ZAMMAD_CHAT_ENABLED`, `ZAMMAD_CHAT_ID`.
- Entrypoint writes a small JS config (`window.AVUZ_ZAMMAD = {...}`) and configures
  External Sites via `occ` if the entry is not already present.
- `ZAMMAD_CHAT_ENABLED=false` → no floating widget (Slim profile); menu icon still works.

## Org / tenant mapping

- Each NC instance baked with `ZAMMAD_ORG=<tenant>` (per-stack env).
- Organizations pre-created in Zammad (Consulttagro, Endopasso, …).
- **Portal:** users get Zammad accounts (password / email-invite) assigned to their
  Organization. Org isolation enforced by Zammad's native customer auth.
- **Chat:** conversation-only; org is informational. Agent verifies identity.

## Delivery profiles (one image, env-gated — same pattern as the S3 toggle)

| Profile | `ZAMMAD_CHAT_ENABLED` | External Sites "Suporte" | Use |
|---|---|---|---|
| **Full (Avuz Conecta)** | `true` | yes | branded NC + floating chat + portal |
| **Slim (support-only)** | `false` | yes | minimal NC, just the Suporte portal |

## Error handling / fallback

- Zammad down / no agent online → chat widget hides itself (native Zammad behavior).
  "Suporte" menu → portal ticket form still works (async path).
- `ZAMMAD_URL`/`ZAMMAD_CHAT_ID` unset → widget no-ops, no JS error (guard the global).
- iframe blocked by CSP → fall back to new-tab link.
- Entrypoint verifies the External Sites app is enabled; logs a clear message if the `occ`
  step fails (existing entrypoint convention).

## Testing / rollout

1. Stand up the Zammad stack on staging; create one test Organization + one chat widget.
2. Build the Full-profile image pointed at staging Zammad; verify the widget appears,
   prefills the NC user, and chat→ticket works.
3. Verify portal: log in as a test user, confirm only that Organization's tickets are
   visible; confirm time accounting CSV exports per org.
4. Build the Slim profile (`ZAMMAD_CHAT_ENABLED=false`); verify only the menu icon shows,
   no widget.
5. Verify fallback: stop Zammad → no JS errors; the portal link degrades gracefully.

## Phase B (later, out of scope)

- **SSO** (OIDC/SAML) for seamless portal login — a convenience, not a security
  prerequisite (the portal login is already the boundary). If pursued, note Zammad accepts
  a single external IdP, so multi-tenant SSO needs a central IdP (Keycloak/Authentik)
  carrying org as a signed claim.
- Migrating historical Milldesk/Lero data into Zammad.
- Official Zammad NC integration app (dashboard widget / unified search) on top.
