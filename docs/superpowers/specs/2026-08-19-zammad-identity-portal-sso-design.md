# Zammad Identity & Portal SSO — Design

**Date:** 2026-08-19
**Branch:** `zammad-support`
**Status:** Approved design + grilled + **OIDC spiked (feasible, wired on pilot)** — pre-plan

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

## Preconditions / invariants (design rests on these)

- **No public self-registration.** Admins create every NC user per instance. So the
  email space is closed and admin-controlled — nobody can mint an account with an
  arbitrary email.
- **Agents are never NC users.** Support staff live on the reserved `@avuz.cloud`
  domain and are never provisioned as NC users on a tenant instance. So a customer's
  NC email can never collide with an agent's Zammad email in production.
  (`patrick@avuz.cloud` as a Zammad agent is a **test artifact** only.)
- **UID = email.** NC usernames are the original admin-assigned email and are
  immutable even if the user later changes their email. Reliable as a *display*
  anchor; still **advisory** for security (see chat trust note).

If any invariant breaks (self-registration enabled, an agent created as an NC user),
the auto-link safety below no longer holds — treat as a blocker.

## Non-goals (deferred — YAGNI)

- **Organizations / org-scoped ticket sharing** — pilot customers see only their own
  tickets (Zammad default, safe). Add when going multi-tenant.
- **Multi-tenant SSO** — each NC instance is its own OIDC IdP and one shared Zammad
  accepts ~one external OIDC provider, so seamless SSO across many tenants needs a
  central broker (Keycloak/Authentik). Out of scope; pilot is conecta-2 only. **Do not
  replicate the single-IdP config for a 2nd tenant** — it needs the broker.
- **API-token provisioning** — not needed; chat identity is client-side, portal
  provisioning is native to Zammad's OIDC login.
- **Inbound email (email-to-ticket)** — ZeptoMail is send-only; clients reply via the
  portal. Adding an IMAP mailbox is a separate future option.

## Architecture

Two independent tracks. No shared secret, no API token.

```
┌─ CHAT (all tenants) ──────────────┐   ┌─ PORTAL (pilot: conecta-2) ─────────┐
│ NC user logged in → widget opens  │   │ Click "Suporte" → Zammad login       │
│ user types first message          │   │  → "Avuz Conecta" (OIDC, PKCE)       │
│ → identity line sent AS message #1 │   │  → NC oidc app (already authed)      │
│   then the user's text            │   │  → back to Zammad, auto-provisioned  │
│ Operator sees name/username/email │   │    + logged in, sees own tickets     │
│ → sets ticket customer (by email) │   │                                      │
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
  `chatState(IUser $user): array` returning `url, chatId, userName, userLogin,
  userEmail, org` (`org` from the existing `zammad_org` app config).
- `apps/avuz_theme/lib/AppInfo/Application.php` — `bootZammad` already holds
  `IUserSession` (from the login-gate fix); pass the logged-in `IUser` into
  `chatState()` and provide it as the initial state.
- `apps/avuz_theme/js/zammad-chat.js` — read the new fields, send the identity line.

**Trigger — first message, not on open (avoids ghost sessions):**
- Do **not** send on panel-open (opening already queues a chat session → operators
  would get identity-only ghosts from people who just peeked).
- Intercept the user's **first outgoing message**; send the identity line **as
  message #1**, immediately followed by the user's actual text. Once per session.

**Line content (PT):** `👤 {name} · {username} · {email}`
- If `username == email`, send only one. If they differ (user changed their email),
  send both — `username` is the immutable original.
- If `org` set, append it. If `email` empty → `👤 {name} (sem e-mail cadastrado)`.

**Trust — advisory only:** the line is browser-sent, so a logged-in user with devtools
could forge a different identity. It is a **convenience hint, not proof** — operators
verify before any sensitive action. The **OIDC portal is the real, cryptographic
identity boundary.** (Consistent with the existing trust-split design.)

**Edge cases:** NC account without email → name-only line; chat already gated to
logged-in users so a user always exists.

**Cache-bust:** bump `avuz_theme` **1.1.2 → 1.1.3**.

## Track B — Portal OIDC SSO (config, pilot conecta-2)

NC `oidc` app = Identity Provider; Zammad generic OIDC = relying party.
**Flow = Authorization Code + PKCE, public client, NO client secret** (spiked).

**NC side (conecta-2) — scriptable via `occ`:**
```
occ oidc:create "Zammad Support Pilot" \
  "https://supporthml.avuz.app/auth/openid_connect/callback" \
  --type public --allowed_scopes "openid profile email"
```
- Issuer: `https://conectahml2.avuz.app` (https confirmed through CF).
- Public client → no secret to store or drift.

**Zammad side — `Setting`s (scriptable via rails or admin UI):**
- `auth_openid_connect = true`
- `auth_openid_connect_credentials = { display_name:"Avuz Conecta",
  identifier:<client_id>, issuer:"https://conectahml2.avuz.app", uid_field:"sub",
  scope:"openid profile email", pkce:true,
  callback_url:"https://supporthml.avuz.app/auth/openid_connect/callback" }`
- `auth_third_party_auto_link_at_inital_login = true` — links a chat-created customer
  to the SSO login by email. **Safe under the invariants above** (no agent shares a
  customer email in production).
- Default signup role = **Customer** (verify; never Agent).
- **Enabling OIDC requires a Zammad railsserver restart** to mount the OmniAuth
  strategy — config alone is not enough.

**UX / entry point:** "Suporte" nav already 302s to the portal root → Zammad login shows
the **"Avuz Conecta"** button. No consent screen (NC did not prompt for this client in
the spike). Auto-redirect (skip the button) is a deferred nicety.

**Agent vs customer separation (the grilled hole):**
- **Agents → direct Zammad login only, never SSO.**
- **Customers → SSO-only, provisioned as Customer.**
- Safety comes from the invariants (disjoint email spaces), not domain trust.

## Secrets & reproducibility

- **Track A:** no new env, no secret.
- **Track B:** **no client secret at all** (PKCE public client). Both halves are
  **scriptable** — `occ oidc:create` (NC) + rails `Setting.set` (Zammad). The only
  shared value is the non-secret `client_id`.
- **Pilot reproducibility accepted as documented-not-fully-automated** for now: on a
  volume rebuild, re-run the two documented commands (no secret to recover). Entrypoint
  auto-wiring is deferred.
- Docs: extend `docs/zammad-deployment.md` with chat-identity behavior, the OIDC
  `occ`/rails commands, the **railsserver-restart** step, the auto-link + role
  settings, and the **multi-tenant caveat**.

## Spike results (2026-08-19) — proven on the pilot

| Check | Result |
|---|---|
| `oidc` app + occ client mgmt | ✅ v2.0.8; `oidc:create/list/remove`, `create-claim` — both halves scriptable |
| Issuer over CF | ✅ `https://conectahml2.avuz.app`, discovery 200 |
| NC `/authorize` accepts client | ✅ 303 → NC login (no `invalid_client`) |
| Zammad reaches NC discovery | ✅ 200 from inside the container |
| PKCE public client (no secret) | ✅ Zammad OIDC has no `secret` field → PKCE |
| Provider registration | ✅ after **railsserver restart** (`/auth/openid_connect/*` mounted) |
| Request phase | ⚠️ OmniAuth 2 = **POST + CSRF** (browser only; curl gets `InvalidAuthenticityToken`) |
| End-to-end human login | ✅ logged into Zammad via OIDC, **no consent prompt** |

**Live config left on the pilot:** conecta-2 has a public client `Zammad Support
Pilot`; Zammad has OIDC enabled + auto-link on + the "Avuz Conecta" button.

**Collision confirmed as expected:** logging in with `patrick@avuz.cloud` (a Zammad
agent) auto-links to the **agent** account — proves the dance, not the customer path.
Real customer-role verification is **pending** (needs a throwaway non-avuz.cloud NC
user; blocked on Portainer/VPN link at time of writing).

## Testing & rollout

**Two independent tracks, sequenced as plan phases:**
- **Track B (portal, config):** mostly done via the spike; remaining = verify
  **customer-role provisioning** with a throwaway non-avuz.cloud user, confirm
  own-tickets-only, and dedupe (chat-ticket email == SSO email → one user).
- **Track A (chat, code):** rebuild → retag `registry.avuz.app` → redeploy stack 46 →
  boot → verify. Ships to conecta-2.

**Scope gate:** pilot **conecta-2 only**. No other tenant touched.

**Test matrix:**
- *Chat:* first user message → identity line prepended as message #1 → operator sees
  name/username/email → chat→ticket auto-matches customer by email → no-email edge
  shows fallback line → no ghost sessions on mere open.
- *Portal:* Suporte → OIDC (PKCE) → seamless login → provisioned **Customer** → sees a
  seeded test ticket → **dedupe** verified → own-tickets-only.
- *Regression:* chat launcher/css/gating intact; outbound email still sends.

**Evidence:** operator's logged-in browser for both flows; rails checks for
user/role/authorization/dedup.

**Success criteria:** operator identifies the client in chat and emails them back via a
linked ticket; client SSO-logs into the portal and answers their ticket → two-way loop
closed.
