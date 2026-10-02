# Assinaturas: tenant runbook

Each tenant gets its own ZapSign sub-account. The stack env drives the app on every boot.

## 1. One-time per Cloudflare zone

Create a WAF custom rule so ZapSign webhooks reach the app.

- Expression: `(http.request.uri.path eq "/index.php/apps/assinaturas/webhook" and http.request.method eq "POST")`
- Action: Skip all remaining custom rules, rate limiting rules, managed rules and Super Bot Fight Mode.

## 2. Provision a tenant

1. Create the sub-account and save its token (shown once, never printed). The script creates the token file first and refuses an existing file. If it says the token was NOT saved, check the ZapSign panel for the sub-account before retrying:

   ```bash
   ZAPSIGN_PARTNER_TOKEN=... scripts/zapsign-create-tenant.sh "<company name>" <token-file>
   ```

2. In the ZapSign panel, for this sub-account (by hand):
   - Configurações → Organização → Preferências: turn on "Bloquear assinatura fora da ordem definida".
   - Set the sender text and Reply-To.
3. In the tenant's Portainer stack, set:
   - `ZAPSIGN_API_TOKEN`: the token from the file.
   - `ZAPSIGN_ENVIRONMENT`: `production` (or `sandbox`).
   - `ZAPSIGN_COMPANY_NAME`: the company shown to signers.
   - `ZAPSIGN_WEBHOOK_SECRET`: optional; empty keeps the app's generated secret.
4. Redeploy the stack.
5. Delete the token file.

## 3. Verify

Run occ through Portainer as `www-data` (`scripts/portainer-exec.sh`, or `scripts/portainer-exec-prod.sh` for prod).

```bash
portainer-exec.sh -u www-data <container> php occ app:list --enabled | grep assinaturas
portainer-exec.sh -u www-data <container> php occ config:app:get assinaturas api_token --details --output=json | grep -o '"sensitive":true'
portainer-exec.sh -u www-data <container> php occ assinaturas:webhook:ensure   # expect: Webhooks: unchanged
```

- The boot log shows `✓ Assinaturas (<env>) configured`.
  `– Assinaturas off: <reason>` means the env is incomplete; fix the env named in the reason.
- Administração → Assinaturas shows a green token check and the webhook types.
- Add the tenant's users to the `assinaturas` group. Admins always pass.

Never print the token.

## 4. Webhook smoke test

- An anonymous probe to `/index.php/apps/assinaturas/webhook` returns `401` JSON from the app, not a Cloudflare challenge.
- The first real send logs `POST /index.php/apps/assinaturas/webhook … 200` in `/var/log/nginx/access.log`.

## 5. Day-2

- **Rotate the token:** change `ZAPSIGN_API_TOKEN` in the stack, then redeploy.
- **Turn off:** empty `ZAPSIGN_API_TOKEN`, then redeploy. The app is disabled; data is kept.
- **Restore a DB into another host:** `php occ assinaturas:webhook:ensure` refuses until you pass `--confirm-url-change`.
