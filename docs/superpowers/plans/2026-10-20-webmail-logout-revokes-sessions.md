# Plan: an Avuz Conecta logout ends the ConectaMail session

Spec: `docs/superpowers/specs/2026-10-20-webmail-logout-revokes-sessions.md`

## 1. webmail-avuz (`fix/logout-revokes-sessions`, off `origin/main`)

- [x] `sso.ts`: `verifyLogoutToken(token, now, secret)` reusing the SSO signature/expiry checks, `aud` `webmail-avuz-logout`.
- [x] `conecta-sessions.ts`: `rememberConectaSession` (add + prune) and `revokeConectaSessions` (destroy matching
      sessions, release IMAP, stop watchers, drop index), over a small store interface so tests use in-memory fakes.
- [x] `routes/auth.ts`: SSO sign-in remembers the session; `POST /api/auth/conecta-logout` verifies, claims the `jti`, revokes.
- [x] Tests (node:test): token accept/reject (`aud`, signature, expiry, SSO token refused); revoke destroys only the
      uid's SSO sessions, leaves direct logins and other users, skips sessions re-used by another uid, prunes on remember.
- [x] `npm test`, `npm run build`. PR.

## 2. avuz-server (`apps/conectamail`, off `avuz-customization`)

- [x] `WebmailTokenService::buildLogoutToken(uid)`: same signer, `aud` `webmail-avuz-logout`.
- [x] `WebmailSessionRevoker::revoke(uid)`: POST to `{baseUrl}/api/auth/conecta-logout`, 3 s timeout, logs failures, never throws.
- [x] `BeforeUserLoggedOutListener` → revoker; registered in `Application`.
- [x] PHPUnit: token claims/signature verify with the webmail's algorithm; listener calls revoker with the uid;
      revoker posts the right body/headers, swallows HTTP errors, is inert when unconfigured.
- [x] PR to `avuz-customization`.

## 3. Staging

- [x] Build `webmail-avuz:<sha>` from embedded-mode (PR #35) + this fix; set stack 64 `TAG`; verify container image.
- [x] `build-push.sh latest staging 3` from this branch (avuz-customization + fix; the `-staging-3` branch is stale), redeploy stack 63; verify image.
- [ ] Run QA T1–T7 in a browser (Bri, manual). No test credentials were available to the agent, so it did not log in.

## Results

Deployed 2026-10-21:

- webmail stack 64: `webmail-avuz:c978bf8` (PR #35 embedded mode + PR #36 this fix). Container image confirmed.
- staging-3 stack 63: `avuzconecta:staging-3` @ `sha256:3b3450…` (avuz-customization `ebfa357` + this branch). Container image confirmed changed (was `89a500…`); `status.php` ready after 160 s.

Unit tests: webmail `npm test` 855/855; conectamail phpunit 57/57 (12 new).

Staging server chain (no browser login). Fake sessions were seeded in the webmail Redis for uid `verify-logout-probe`: 2 SSO sessions (indexed), 1 mailbox-password session (also in the index), and 1 SSO session of another uid. Then `BeforeUserLoggedOutEvent` was dispatched in the staging-3 container.

- NC → `https://conectamailhml.avuz.app/api/auth/conecta-logout` through Cloudflare: OK (34 ms).
- Webmail log: `logout do Avuz Conecta: 2 sessão(ões) encerrada(s)`.
- Both SSO sessions were gone. The mailbox-password session and the other uid's session were kept. The uid index was emptied.
- Endpoint without `x-webmail-request`: 403. Bad token: 400.
- Probe data removed afterwards.

QA T1–T7: pending, for Bri. Sessions opened before the deploy are not in the index, so start every test with a fresh Mail open (T1 step 1 already does).
