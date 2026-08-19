# Zammad Identity & Portal SSO — Design

**Date:** 2026-08-19
**Branch:** `zammad-support`
**Status:** Approved design, pre-implementation

## Problem

The Zammad support integration works (live chat + ticket portal, outbound email now
configured), but two gaps block real support workflow:

1. **Chat visitors are anonymous.** The widget has no identity field, so operators
   don't know who they're talking to and can't reliably link a chat-created ticket to
   a real, emailable customer.
2. **No authenticated portal path.** After a ticket exists, operators can email the
   client (outbound works), but the client has no way to log into the Suporte portal
   to see/answer their tickets asynchronously.

## Goal

- **Chat:** operators always see who they're chatting with, and can convert the chat
  into a ticket already linked to the right customer (by email).
- **Portal:** pilot clients (conecta-2) get **authenticated** portal access with a
  real, provisioned customer record.

Email is the join key across both surfaces.

## Non-goals (deferred — YAGNI)

- **Organizations / org-scoped ticket sharing** — pilot customers see only their own
  tickets (Zammad default, safe). Add when going multi-tenant.
- **Multi-tenant SSO** — each NC instance is its own OIDC IdP and one shared Zammad
  accepts ~one external OIDC provider, so seamless SSO across many tenants needs a
  central broker (Keycloak/Authentik). Out of scope; pilot is conecta-2 only.
- **API-token provisioning** — not needed; chat identity is client-side, portal
  provisioning is native to Zammad's OIDC login.
- **Inbound email (email-to-ticket)** — ZeptoMail is send-only; clients reply via the
  portal. Adding an IMAP mailbox is a separate future option.

## Architecture

Two independent tracks. No shared secret, no API token.

```
┌─ CHAT (all tenants) ──────────────┐   ┌─ PORTAL (pilot: conecta-2) ─────────┐
│ NC user logged in → widget opens  │   │ Click "Suporte" → Zammad portal      │
│ zammad-chat.js auto-sends 1 line: │   │  → "Entrar com Avuz" (OIDC)          │
│  identity from initial state      │   │  → NC oidc app (already authed)      │
│ Operator sees name+email          │   │  → back to Zammad, auto-provisioned  │
│ → sets ticket customer (by email) │   │    + logged in, sees own tickets     │
└───────────────────────────────────┘   └──────────────────────────────────────┘
                    │                                    │
                    └──────── join by EMAIL ─────────────┘
        (chat-created ticket + OIDC login = same Zammad user, deduped)
```

- **Chat side** = client-side only. Ships to every tenant via the image.
- **Portal side** = config only (NC `oidc` app + Zammad generic OIDC). No image change.
  Pilot: conecta-2.

## Track A — Chat identity injection (code, all tenants)

**Files:**
- `apps/avuz_theme/lib/Service/ZammadConfig.php` — add
  `chatState(IUser $user): array` returning `url, chatId, userName, userEmail, org`
  (`org` from the existing `zammad_org` app config).
- `apps/avuz_theme/lib/AppInfo/Application.php` — `bootZammad` already holds
  `IUserSession` (from the login-gate fix); pass the logged-in `IUser` into
  `chatState()` and provide that as the initial state.
- `apps/avuz_theme/js/zammad-chat.js` — read the new fields, auto-send one identity
  line.

**Mechanism (JS):**
- On the first panel-open with the session connected, set the widget textarea value to
  the identity line and call the `ZammadChat` instance's `sendMessage()` (verified to
  exist in `chat-no-jquery.min.js`).
- Reuse the existing launcher MutationObserver; fire a **once-per-page-load** flag when
  the panel first opens.
- Guard: send only if `userName` present (and include email when present), only once.

**Line format (PT, tweakable):**
```
👤 Patrick Rezende · patrick@avuz.cloud · Avuz Conecta
```
- Composed from `userName · userEmail · org`. If `org` empty → drop it.
- If `userEmail` empty → `👤 Patrick Rezende (sem e-mail cadastrado)` so the operator
  knows to ask.

**Edge cases:**
- NC account without an email → name-only line (flagged as above).
- Reopen same session → no re-send (once per load). A brand-new session after a full
  close is an accepted rare re-ask.
- Chat is already gated to logged-in users, so a user always exists.

**Cache-bust:** bump `avuz_theme` **1.1.2 → 1.1.3**.

## Track B — Portal OIDC SSO (config, pilot conecta-2)

NC `oidc` app = Identity Provider; Zammad generic OIDC = relying party. Verified:
Zammad 7.1.0 exposes `auth_openid_connect` settings; the `oidc` app is already
installed + enabled by the entrypoint.

**NC side (conecta-2) — register Zammad as an OIDC client:**
- Create a client in the `oidc` app → `client_id` + `client_secret`.
- Redirect URI (Zammad callback): `https://supporthml.avuz.app/auth/openid_connect/callback`
  *(exact OmniAuth path to verify during impl).*
- Scopes released: `openid profile email` → claims `sub`, `name`, `email`.
- Discovery/issuer URL from the app *(verify exact URL; may require an `occ`
  keypair-generate step first).*

**Zammad side — Security → Third-party → OpenID Connect:**
- Enable; fill issuer/discovery URL, `client_id`, `client_secret`, scopes
  `openid email profile`.
- **Automatic account linking by email = ON** (`auth_third_party_auto_link_at_inital_login`)
  — so a customer already created by a chat→ticket links instead of erroring on first
  SSO login.
- Default signup role = **Customer** (never Agent) — verify the Zammad signup-role
  setting.

**UX / entry point:**
- "Suporte" nav already 302s to the portal root → Zammad shows login with an
  **"Entrar com Avuz"** (OIDC) button. Auto-redirect to the provider (one-click) is a
  deferred nicety.

**Proxy/redirect notes:**
- Both hosts are behind CF + NPM over https. NC must emit an **https issuer** (relies on
  the existing trusted-proxy / `overwrite.cli.url` setup); Zammad already has
  `NGINX_SERVER_SCHEME=https`. Redirect URI must match the NC client registration
  exactly.

**Result:**
- First SSO login → Zammad **Customer** (email+name), no org (deferred) → sees only own
  tickets; dedupes with chat-created tickets by email.

**Risks to verify during impl:** exact NC `oidc` discovery URL + any keypair-gen `occ`
step; Zammad callback path; NC consent-screen behavior on first login.

## Secrets & reproducibility

- **Track A:** no new env, no secret.
- **Track B:** `client_id` + `client_secret` live in two persistent DBs (NC `oidc` app +
  Zammad settings) — **never in the repo or image**. No new stack env for the pilot.
- Capture the Zammad-side OIDC config as an **idempotent rails snippet**, `client_secret`
  pasted by the operator at apply time (same pattern as the SMTP fix).
- Docs: extend `docs/zammad-deployment.md` with chat-identity behavior, OIDC setup
  steps, the account-link setting, secret handling, and the **multi-tenant caveat**
  (only conecta-2 wired; a 2nd tenant needs the broker — do not replicate the single-IdP
  config naively).

## Testing & rollout

**Two independent tracks, sequenced as plan phases:**
- **Track A (chat, code):** rebuild → retag `registry.avuz.app` → redeploy stack 46 →
  boot → verify. Ships to conecta-2.
- **Track B (portal, config):** no rebuild; apply on NC + Zammad, validate immediately.
- Order independent; do **B first** (config-only, fast feedback), then A.

**Scope gate:** pilot **conecta-2 only**. No other tenant touched.

**Test matrix:**
- *Chat:* identity line auto-sends → operator sees it → chat→ticket auto-matches the
  customer by email → no-email edge shows the fallback line.
- *Portal:* Suporte → OIDC → seamless login → provisioned Customer → sees a seeded test
  ticket → **dedupe** (chat-ticket email == SSO email, one user) → role=Customer,
  own-tickets-only.
- *Regression:* chat launcher/css/gating intact; outbound email still sends.

**Evidence:** the operator's logged-in browser for both flows; rails checks for
user/role/org/dedup.

**Success criteria:** operator identifies the client in chat and emails them back via a
linked ticket; client SSO-logs into the portal and answers their ticket → two-way loop
closed.
