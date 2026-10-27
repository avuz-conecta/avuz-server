# Fleet rollout: left rail + October work (plan)

Date: 2026-10-27 · Owner: Patrick (every prod step gated per action) · Status: planned

## Goal

Move the 10 client tenants from the 2026-10-01 image to the code app3 has run since 2026-10-27, **with no env changes**. ConectaMail and Assinaturas stay off for these tenants. Each one is activated later, client by client (phase 2).

## Decisions (Patrick, 2026-10-27)

- **Admin 2FA:** stays on, the default. Every tenant's admins enroll TOTP at their next login. Tell the client admins beforehand.
- **endopasso:** excluded again. It stays on its current image and is not redeployed.
- **Timing:** after hours, one tenant at a time, each verified before the next.
- **ConectaMail:** multi-tenant support comes first (separate work). For now every tenant stays on Roundcube. Clients are told first, then switched one by one.

## What ships

Image source: `avuz-customization` @ `41e27b53bb0`, the same code as app3's `avuzconecta:2026.10.27-41e27b5`. Config version `33.0.0-21` → `33.0.0-24`, so the first boot runs the full config pass plus app upgrades.

User-visible:
- Left rail replaces the top app bar (≥1024 px), with Material Symbols icons and External sites in the rail.
- Mandatory TOTP 2FA for admins (enforced on every boot).
- Impersonate app for admins (#18). External sites icon library is upgraded to Material (#25).
- Deck 1.18.99 (time tracking). Assinaturas code updates; the app stays off without ZapSign env.
- Calendar instant booking from the embed, new booking e-mail template and sender.
- Fixes: login contrast, WhatsApp button in Contatos (card 266), password confirm, dark shell, 500s/delete/reset.

Inert on these tenants (they have no env for it):
- ConectaMail embedded mode and logout revocation: every tenant uses Roundcube (`ROUNDCUBE_URL`, `CONECTAMAIL_BACKEND` unset → `roundcube`). With the rail there is no longer a double header; Roundcube's own bar is the only top bar inside Mail.
- Assinaturas: no `ZAPSIGN_*`, so the boot disables the app and keeps its data.

## Tenants

| Stack | Tenant | Endpoint | Storage | Order |
|---|---|---|---|---|
| 81 | arkua | 6 | disk | 1 |
| 92 | progetti | 6 | disk | 2 |
| 70 | ramires | 6 | disk | 3 |
| 69 | comprev | 6 | disk | 4 |
| 61 | eco-ambiental | 6 | disk | 5 |
| 59 | cfm-advogados | 6 | disk | 6 |
| 57 | consultt-agro | 6 | disk | 7 |
| 55 | cartorio-veranopolis | 6 | disk | 8 |
| 51 | digrepal | 6 | disk | 9 |
| 60 | grupo-vidalar | 8 | Postgres + S3 | 10 (slowest boot) |

Not in this rollout:
- **app3 (14):** already on the code; it stays pinned to `2026.10.27-41e27b5`.
- **endopasso (31):** excluded.
- **app360 (ep10):** the Digrepal product, not an Avuz Conecta tenant.

Check storage per tenant before rolling; it's unverified for the ep6 ones.

## Pre-flight (day of the rollout)

1. **Notify client admins** about mandatory 2FA (pt-BR message; template below).
2. **Record the rollback digest:** current `:latest` = `sha256:8f6d956d81afaadb322c5cf662a40e5b6f373f4799293d56ad340959197f96de`.
3. **Disk:**
   - `df -h /` on ep6 and ep8 (exec in the autoheal container). Last seen 2026-10-27: ep6 64% (16 GB free), ep8 53%.
   - Prune unused images on both first: `POST /api/endpoints/<ep>/docker/images/prune?filters={"dangling":["false"]}`, no volumes. See memory `disk-full-filesequence-crashloop`.
4. **Publish `:latest`:** pick one.
   - **Preferred:** point `:latest` at app3's exact, proven image: `docker buildx imagetools create --prefer-index=false -t registry.avuz.app/admin/avuzconecta:latest registry.avuz.app/admin/avuzconecta:2026.10.27-41e27b5`. Then confirm the manifest is still `application/vnd.docker.distribution.manifest.v2+json` and the digest equals the source.
   - **Fallback:** `./scripts/build-push.sh latest prod` from the main checkout at `41e27b53bb0` (submodules synced). Check the log for "Built and pushed" and the digest.
5. **Note:** endopasso's compose also says `:latest`. Do **not** redeploy it. Autoheal restarts reuse its local image and pull nothing.

## Per tenant (one at a time)

1. `./scripts/deploy-prod.sh -y <stack>`. Prod honors `PullImage:true` on ep6/ep8, so no registry-auth pull is needed. Leave ~10 s between stack PUTs.
2. Wait until it's healthy. Expect 3–8 min: the first boot with the config jump can outrun the 300 s start period. Autoheal may restart it **once**; the second boot is quick. Don't retry the deploy.
3. Verify:
   - The container image ID equals the new digest.
   - `occ status`: installed, no maintenance, `needsDbUpgrade: false`.
   - avuz_theme `1.0.12`, conectamail `1.2.7`.
   - Public `status.php` returns 200.
   - The login page renders.
4. **Stop rule:** more than 2 restarts, not healthy within 12 min, or `occ upgrade` failing → stop the rollout and investigate that tenant. Don't continue to the next one.

## Rollback

Prefer **rolling forward** with a fix. Per tenant, the image can go back to the old digest: set the stack image to `avuzconecta@sha256:8f6d956d…`.
- But the first boot has run app migrations (apps upgraded). Older code on a migrated DB can break things, e.g. the Forms version drift or the conectamail secret encryption (memory `forms-maxsubmissions-version-drift`, `conectamail-sensitive-appconfig`).
- Only roll back for a total outage, and check `occ status` afterwards.

## After

- Prune unused images on ep6/ep8 again.
- Update memory `fleet-rollout-latest` (date, digest, tenants, endopasso excluded).
- Spot-check 2–3 tenants in a browser: rail, Mail (Roundcube) opens, Deck, Calendar.

## Phase 2: ConectaMail per tenant (not part of this rollout)

Every prod step below is gated: no deploy, env change or exec without Patrick's word, per action. Staging (stacks 64, 8, 63) is free.

### Background: multi-tenant webmail

webmail-avuz#40 (open as of 2026-10-27; merge before the prod steps). Spec: webmail-avuz `docs/superpowers/specs/2026-10-27-multi-tenant-conecta-design.md`.

**Registry.** The webmail's legacy env (`AVUZ_CONECTA_URL` + `WEBMAIL_AVUZ_SSO_SECRET` + `ROUNDCUBE_CREDENTIAL_KEY`, domains = `ALLOWED_DOMAINS`) is tenant `primary`, which is app3 in prod. More tenants go in `CONECTA_TENANTS`, a one-line JSON list:

```json
[{"id":"arkua","url":"https://<arkua origin>","ssoSecret":"<64 hex>","domains":["<arkua mail domain>"]}]
```

**Rules.**
- The SSO secret is **unique per tenant**: the token's signature tells the webmail which tenant sent it.
- A tenant's token only opens mailboxes on that tenant's `domains`.
- The session keeps its tenant. Logout revocation, framing (`frame-ancestors`), contacts and calendar all use that tenant only.
- A bad or duplicate entry is skipped and logged (`[tenants] entrada ignorada: ...`). The other tenants keep working.

**avuz-server:** no change. conectamail already signs with the tenant's own `WEBMAIL_AVUZ_SSO_SECRET`. All prod tenants share `ROUNDCUBE_CREDENTIAL_KEY`, so entries need no `credentialKey`.

**Not supported: digrepal (stack 51).** It uses `ROUNDCUBE_PROVIDER=digrepal`, a different mail provider. The webmail's IMAP/SMTP hosts are global (Zoho), so digrepal stays on Roundcube until per-tenant mail hosts exist.

### One-time: deploy the multi-tenant webmail to prod (stack 98)

1. Build `webmail-avuz:<main sha>` (or retag the tested `347e3b0` if `git diff --quiet 347e3b0 <main>`). See memory `webmail-prod-stack98-deploy`.
2. Stack 98:
   - add `CONECTA_TENANTS: ${CONECTA_TENANTS:-}` to the compose, under `ROUNDCUBE_CREDENTIAL_KEY` (as in `deploy/stack.prod.yml`);
   - set `TAG`;
   - leave `CONECTA_TENANTS` **empty**.
   Deploy with the prod recipe: auth pull the webmail image, PUT with `pullImage:false`. That keeps redis and the sessions; expect the usual ~10 s postgres restart.
3. Verify:
   - The boot log shows `[tenants] primary https://app3.avuz.app domínios: avuz.cloud` and no `entrada ignorada`.
   - `curl -sI https://conectamail.avuz.app/ | grep -o "frame-ancestors[^;]*"` gives `'self' https://app3.avuz.app`.
   - app3 Mail opens ConectaMail with SSO.
   - app3 logout still ends the webmail session.
   - Nothing changes for app3: `primary` keeps its Redis keys, and sessions from before the deploy count as `primary`.

### Per tenant (after the client is told)

Use the stacks from the table above. digrepal is excluded.

**0. Pre-checks** (read-only; prod exec still needs an OK):
- Image ≥ the 2026-10-27 rollout: conectamail `1.2.7`+ with `WebmailSessionRevoker`.
- `ROUNDCUBE_PROVIDER=zoho`.
- **Origin:** the URL users open, i.e. `occ config:system:get overwrite.cli.url`, scheme + host.
- **Mail domains:** the domains of the tenant's mailboxes, from `MailboxAddress::resolve()` per user (see the user query in the `conectamail-webmail-sso-prod` memory) or from the client.
- Pilot user: someone with a saved mailbox password (`email_enc_password`), for the headless check.

**1. Secret:** `openssl rand -hex 32`. Store it only in Portainer: once in stack 98's `CONECTA_TENANTS`, once in the tenant stack.

**2. Webmail (stack 98):**
- **Append** the entry to `CONECTA_TENANTS` and keep the existing entries.
- Redeploy with the same `TAG` and `pullImage:false`.
- Verify:
  - the log shows `[tenants] <id> <origin> domínios: ...` and no `entrada ignorada`;
  - `frame-ancestors` on `/` now lists the new origin.
- This step alone changes nothing for the tenant's users: Mail still opens Roundcube.

**3. Tenant stack:**
- Under `ROUNDCUBE_PROVIDER=...`, add these compose lines (no prod tenant has them yet; app3 has them inline):
  ```yaml
        - WEBMAIL_AVUZ_URL=$WEBMAIL_AVUZ_URL
        - WEBMAIL_AVUZ_SSO_SECRET=$WEBMAIL_AVUZ_SSO_SECRET
        - CONECTAMAIL_BACKEND=$CONECTAMAIL_BACKEND
  ```
- Env: `WEBMAIL_AVUZ_URL=https://conectamail.avuz.app`, `WEBMAIL_AVUZ_SSO_SECRET=<step 1>`, `CONECTAMAIL_BACKEND=webmail`.
- Redeploy with `pullImage:false`, so the image stays the same. Wait until healthy.

**4. Sync env → app config.** A redeploy with the same image runs no config pass. In the app container, as `www-data`:
```bash
cd /var/www/html && source docker/lib-apps.sh && source docker/lib-integrations.sh && avuz_configure_conectamail
```
Secrets are written by env-var name, never as an `occ --value`, so nothing reaches audit.log. Check `occ config:app:get conectamail mail_backend` = `webmail` and `webmail_avuz_url`.

**5. Verify.**
- **Headless, pilot user:** mint the token in the container (`WebmailTokenService::buildToken`) and curl `/api/auth/sso` from the same PHP. Then check:
  - `302 /`;
  - `/api/auth/me` 200;
  - `frame-ancestors` on `/` with that cookie = `'self' <tenant origin>` only.
- **Logout:** run `WebmailSessionRevoker::revoke(<uid>)`, then `/api/auth/me` should be 401. `scripts/conectamail-sso-probe.php` does both checks: modes `login`, `me`, `revoker`; usage is in its header. It never prints tokens.
- **Browser (pilot user):** Mail opens ConectaMail embedded, contacts load, and logging out of Conecta ends the webmail session.
- **Users with only a login password** (`enc_password`): the first SSO tries it on Zoho. If Zoho refuses, they see the webmail login once. The password they type there is saved in Conecta (postMessage) for the next time. Tell the client.

**Rollback (tenant only):**
- `CONECTAMAIL_BACKEND=` (empty) in the tenant env, plus `occ config:app:set conectamail mail_backend --value=roundcube`. That is a plain key, so `occ --value` is fine.
- Mail opens Roundcube again at once. The webmail entry can stay: it is harmless.
- **Off-board completely:** also remove the entry from `CONECTA_TENANTS` and redeploy 98. That tenant's tokens are then refused, and its open sessions lose framing and contacts.

### Staging state (2026-10-27)

- Stack 64 runs `webmail-avuz:347e3b0`, with `CONECTA_TENANTS` = `conectahml` (stack 8, `avuz.cloud`, its own new secret).
- Stack 8 now has `CONECTAMAIL_BACKEND=webmail`, so its Mail menu opens ConectaMail. Unset it to go back to Roundcube.
- All checks passed: SSO, per-session CSP and contacts for each tenant; cross-tenant logout = 0; `domain_not_allowed`; skipped bad entries. Details are in webmail-avuz#40.

Assinaturas per tenant is separate onboarding (ZapSign sub-account token, `production`, company name, Cloudflare WAF skip rule): `docs/assinaturas-tenant-runbook.md`. app3 itself is still on ZapSign `sandbox`.

## 2FA notice for client admins (pt-BR template)

> Olá! A partir de **[data]**, por segurança, todo administrador do Avuz Conecta precisará usar verificação em duas etapas (2FA). No próximo login, o sistema vai pedir para você configurar um aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou similar) lendo um QR code. Leva menos de 2 minutos. Guarde também os códigos de backup que aparecerem. Usuários comuns não são afetados. Qualquer dúvida, fale com o suporte da Avuz.
