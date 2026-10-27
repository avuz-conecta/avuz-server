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

**Prerequisite:** multi-tenant webmail. Today prod ConectaMail (stack 98) serves one Avuz Conecta. Its `AVUZ_CONECTA_URL` (app3) drives the CSP `frame-ancestors`, SSO token verification, the postMessage origin and logout revocation. It must accept a list of tenant origins, each with its own SSO secret.

Per tenant, after the client is told:
1. Add the tenant to the webmail (origin + SSO secret) and its mail domain to `ALLOWED_DOMAINS`.
2. Set the tenant stack env: `CONECTAMAIL_BACKEND=webmail`, `WEBMAIL_AVUZ_URL=https://conectamail.avuz.app`, `WEBMAIL_AVUZ_SSO_SECRET=<that tenant's>`. Then a config run (env syncs to app config only on config runs; memory `conectamail-webmail-sso-prod`).
3. Verify Mail opens ConectaMail in embedded mode, the SSO works, and logout ends the webmail session.
4. Roundcube stays available as a fallback (unset `CONECTAMAIL_BACKEND`).

Assinaturas per tenant is separate onboarding (ZapSign sub-account token, `production`, company name, Cloudflare WAF skip rule): `docs/assinaturas-tenant-runbook.md`. app3 itself is still on ZapSign `sandbox`.

## 2FA notice for client admins (pt-BR template)

> Olá! A partir de **[data]**, por segurança, todo administrador do Avuz Conecta precisará usar verificação em duas etapas (2FA). No próximo login, o sistema vai pedir para você configurar um aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou similar) lendo um QR code. Leva menos de 2 minutos. Guarde também os códigos de backup que aparecerem. Usuários comuns não são afetados. Qualquer dúvida, fale com o suporte da Avuz.
