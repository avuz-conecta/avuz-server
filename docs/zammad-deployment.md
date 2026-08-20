# Zammad Support — Deployment & Onboarding

Self-hosted Zammad backs in-Nextcloud support (live chat widget + ticket portal),
replacing Milldesk + Lero/WhatsApp. One shared Zammad serves all tenants; each tenant
is a Zammad **Organization** and runs its own NC instance tagged via env.

Design: `docs/superpowers/specs/2026-06-23-zammad-support-integration-design.md`
Plan:   `docs/superpowers/plans/2026-06-23-zammad-support-integration.md`

## Backend stack

- Stack file: `portainer-zammad-stack.yml` (Postgres + Elasticsearch + Redis + Memcached + Zammad).
- Domain: `https://supporthml.avuz.app` (staging), behind host-based Nginx Proxy Manager.
- Deployed via Portainer on the staging host (`avuz-conecta-hml`).

### Deploy gotchas (hit on first setup)

- **NPM is host-based, not a container** → no shared docker network. `zammad-nginx`
  publishes host port `8033:8080`; NPM proxy host forwards to `127.0.0.1:8033`.
- **Wizard "CSRF token verification failed"** = SSL-offload proxy. NPM→Zammad is plain
  http and Zammad's bundled nginx hardcodes `X-Forwarded-Proto $scheme` (=http),
  overriding NPM's https → Rails sees http → Origin mismatch. Fix: env
  **`NGINX_SERVER_SCHEME=https`** (with `ZAMMAD_HTTP_TYPE=https`, `ZAMMAD_FQDN=<domain>`).
  All three are in the stack file.
- **Env changes need Portainer redeploy/recreate**, not `docker restart` (nginx config
  regenerates only on recreate).
- **`fqdn`/`http_type` are DB Settings seeded from env only at init.** To change later:
  ```bash
  docker exec -w /opt/zammad zammad-support-zammad-railsserver-1 \
    bin/rails r "Setting.set('fqdn','<domain>'); Setting.set('http_type','https')"
  ```
- **rails CLI:** `docker exec -w /opt/zammad zammad-support-zammad-railsserver-1 bin/rails r "..."`
  (no `zammad`/`rails` in PATH). Container names: `zammad-support-zammad-<svc>-1`.

### NPM proxy host

```
Domain:           supporthml.avuz.app
Scheme:           http
Forward Hostname: 127.0.0.1
Forward Port:     8033
Websockets Support: ON          (required for live chat)
SSL: Let's Encrypt cert, Force SSL, HTTP/2
```

## Onboarding a new tenant

1. Zammad → Manage → Organizations → New → `<TenantName>`.
2. Zammad → Channels → Chat → New chat widget → note its `chatId`.
   (A single shared widget is fine — chat is conversation-only; the agent verifies
   identity. See the security model below.)
3. Set the tenant's NC stack env (below) and deploy.

## NC-side environment (per tenant instance)

| Env | Example | Meaning |
|---|---|---|
| `ZAMMAD_URL` | `https://supporthml.avuz.app` | Zammad host (chat script + CSP + ws) |
| `ZAMMAD_PORTAL_URL` | `https://supporthml.avuz.app` | "Suporte" target (defaults to `ZAMMAD_URL`) |
| `ZAMMAD_ORG` | `consulttagro` | Tenant tag (informational) |
| `ZAMMAD_CHAT_ID` | `1` | Chat widget id from Zammad |
| `ZAMMAD_CHAT_ENABLED` | `true` / `false` | Floating widget on/off (profile switch) |

Entrypoint persists these to `avuz_theme` app config (`occ config:app:set`); the app
reads them via `IAppConfig` (PHP-FPM strips Docker env at request time).

### Delivery profiles (one image, env-gated)

| Profile | `ZAMMAD_CHAT_ENABLED` | "Suporte" entry | Use |
|---|---|---|---|
| **Full (Avuz Conecta)** | `true` | yes | branded NC + floating chat + portal |
| **Slim (support-only)** | `false` | yes | minimal NC, just the Suporte portal |

## Security model — trust split by surface

- **Floating chat** (native Zammad widget, class `open-zammad-chat`): low trust,
  conversation-only, identity self-asserted → **agents verify before acting**. Exposes
  no stored data, no ticket list, no other org. Needs a CSP exception (added by
  `ZammadCspListener` when chat is enabled).
- **Suporte portal** (Zammad customer interface): the real boundary. Authenticated,
  **org-scoped** by Zammad — users see only their Organization's tickets. Reached via the
  internal `/apps/avuz_theme/support` route that 302-redirects to `ZAMMAD_PORTAL_URL`
  (NC ≥29 drops external nav hrefs, hence the redirect).

## Identity & Portal SSO (pilot: conecta-2)

Two surfaces, joined by **email**. See the design spec
`docs/superpowers/specs/2026-08-19-zammad-identity-portal-sso-design.md`.

### Chat identity (all tenants, in the image)

- `avuz_theme` (≥ 1.1.4) sends a PT identity line as the **first message** of each chat
  conversation: `👤 {name} · {username} · {email} · {org}` (username/email deduped when
  equal). Built from the logged-in NC user via the `zammad` initial state; the chat is
  gated to authenticated users, and the line **re-arms per conversation** (reset on each
  chat open, not once per page load).
- **Advisory only.** The line is browser-sent, so treat it as a hint, not proof —
  operators verify before sensitive actions. It is a chat *message*: Zammad does **not**
  use it to populate ticket fields.
- **Chat→ticket is not auto-filled** (decision: keep it manual). Zammad's chat session is
  anonymous by design (`chat_session_init` hardcodes `name: ''`, no `user_id`), so a
  ticket made from a chat has a blank customer. The operator reads the email off the
  identity line and sets the customer (Zammad auto-matches / creates by email). Real
  tracked support goes through the **portal**, where the customer is authenticated.
  (Auto-fill would require a version-pinned overlay on Zammad's `chat_session_init.rb`
  plus a widget WS-injection — deliberately not built.)

### Portal OIDC SSO (pilot conecta-2)

NC `oidc` app = IdP; Zammad generic OIDC = relying party. **Authorization Code + PKCE,
public client, NO secret** — only the non-secret `client_id` is shared. Both halves are
scriptable.

NC side (creates/inspects the client):
```bash
occ oidc:create "Zammad Support Pilot" \
  "https://supporthml.avuz.app/auth/openid_connect/callback" \
  --type public --allowed_scopes "openid profile email"
occ oidc:list      # verify
```

Zammad side (idempotent; run via rails, then **restart railsserver** — OmniAuth mounts
the strategy at boot):
```ruby
Setting.set('auth_openid_connect', true)
Setting.set('auth_openid_connect_credentials', {
  'display_name'=>'Avuz Conecta', 'identifier'=>'<client_id>',
  'issuer'=>'https://conectahml2.avuz.app', 'uid_field'=>'sub',
  'scope'=>'openid profile email', 'pkce'=>true,
  'callback_url'=>'https://supporthml.avuz.app/auth/openid_connect/callback' })
Setting.set('auth_third_party_auto_link_at_inital_login', true)  # links chat-created customer by email
# default signup role must be Customer:
#   Role.where(name:['Agent','Admin']).update_all(default_at_signup:false)
#   Role.find_by(name:'Customer').update!(default_at_signup:true)
```
Then restart: `POST /api/endpoints/<eid>/docker/containers/<railsserver>/restart`.

- The "Suporte" nav 302s to the portal root → Zammad shows the **"Avuz Conecta"** button.
  Request phase is POST+CSRF (OmniAuth 2) — a browser carries the token; `curl` gets
  `InvalidAuthenticityToken` (that still proves the strategy is mounted).
- **Invariants the auto-link safety rests on:** no public self-registration (admins
  create every NC user); agents are never NC users (reserved `@avuz.cloud` domain); NC
  UID = original email. If any breaks, auto-link-by-email is unsafe.
- **Reproducibility:** no secret to store; on a volume rebuild re-run the two commands
  above (entrypoint auto-wiring is deferred).
- **Multi-tenant caveat:** only conecta-2 is wired. One shared Zammad accepts ~one
  external OIDC provider, and each NC instance is its own IdP → a 2nd tenant needs a
  central broker (Keycloak/Authentik). **Do not replicate the single-IdP config** for
  another tenant.

### Time Accounting gotcha

`time_accounting` is a **frontend-delivered** setting — the agent UI reads it only at
page load (hard-reload / re-login after enabling). The dialog fires on an agent update
that **adds an article** (note/reply); a pure attribute change (e.g. just closing) does
not prompt. Default selector `{}` = prompt on every qualifying update.

## Billing

Zammad → System → Time Accounting (enable). Agents log time per ticket; export per-org
CSV (billable/non-billable categories) — replaces the Milldesk billing workflow.

## Phase B (later)

SSO (OIDC/SAML) for seamless portal login — a convenience, not a security prerequisite
(portal login is already the boundary). Zammad accepts one external IdP, so multi-tenant
SSO needs a central broker (Keycloak/Authentik) carrying org as a signed claim.
