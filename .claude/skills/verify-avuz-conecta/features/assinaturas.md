# Assinaturas

Assinaturas is the e-signature app (ZapSign backend, never named in the UI). It is enabled only when the stack has a token, a valid environment (`sandbox` on staging) and a company name. Access is by group: `assinaturas` members, `assinaturas-admins` managers, and admins. Contract management is an Avuz-staff add-on, off by default.

## Sub-features

- `sign-gating` the app is on or off according to the stack env, and logs the reason when off.
- `sign-access` a group member sees the app; a non-member does not.
- `sign-screens` the envelope list and folders render.
- `sign-whitelabel` no screen names the backend vendor.
- `sign-webhook` the webhook path answers, not a challenge page.

## How to get to it (user POV)

- Top navigation, `Assinaturas`.
- Admin settings, `/settings/admin/assinaturas` (admins; contracts add-on switch is for Avuz staff).

## Driving it with Playwright and curl

Preconditions:

- `scripts/doctor.sh` passes. Staging env has the signature variables set with `ZAPSIGN_ENVIRONMENT=sandbox`. A member user and a non-member user exist.

- **Gating.** `scripts/portainer-exec.sh -u www-data <container> php occ app:list`, save to a log. Expect `assinaturas` listed as enabled if the env is complete, otherwise disabled. The container boot log line `– Assinaturas off: <reason>` explains the off case; read it from the container log.
- **Member.** Log in as the member. Expect the `Assinaturas` navigation link; open it and expect the list view. Screenshot.
- **Non-member.** Log in as the non-member. Expect no `Assinaturas` link and no access at `/apps/assinaturas`. Screenshot.
- **White-label.** Search the member's rendered page text for the backend vendor name. Expect zero matches.
- **Webhook.** `curl -sS -o /dev/null -w '%{http_code}' -X POST <base-url>/index.php/apps/assinaturas/webhook`. Expect an app answer (an auth or validation error such as 401, 403 or 400), not a challenge page with HTML from the CDN. Send no secret.
- **Proof.** Screenshots, the app list log, the webhook status in the report.

## Gotchas

- Do not create or send a real envelope: it reaches the vendor and real signers. This map verifies gating and screens only.
- An app that is off because the token is missing is a precondition failure, not an app defect. Report it with the logged reason.
- The groups are recreated empty on every boot. Add the test member after any redeploy.
- The job worker (sends and webhooks within seconds) is a separate supervised process; its health is not visible in the UI.
