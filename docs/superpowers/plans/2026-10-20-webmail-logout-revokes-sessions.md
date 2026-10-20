# Plan: an Avuz Conecta logout ends the ConectaMail session

Spec: `docs/superpowers/specs/2026-10-20-webmail-logout-revokes-sessions.md`

## 1. webmail-avuz (`fix/logout-revokes-sessions`, off `origin/main`)

- [ ] `sso.ts`: `verifyLogoutToken(token, now, secret)` reusing the SSO signature/expiry checks, `aud` `webmail-avuz-logout`.
- [ ] `conecta-sessions.ts`: `rememberConectaSession` (add + prune) and `revokeConectaSessions` (destroy matching
      sessions, release IMAP, stop watchers, drop index), over a small store interface so tests use in-memory fakes.
- [ ] `routes/auth.ts`: SSO sign-in remembers the session; `POST /api/auth/conecta-logout` verifies, claims the `jti`, revokes.
- [ ] Tests (node:test): token accept/reject (`aud`, signature, expiry, SSO token refused); revoke destroys only the
      uid's SSO sessions, leaves direct logins and other users, skips sessions re-used by another uid, prunes on remember.
- [ ] `npm test`, `npm run build`. PR.

## 2. avuz-server (`apps/conectamail`, off `avuz-customization`)

- [ ] `WebmailTokenService::buildLogoutToken(uid)`: same signer, `aud` `webmail-avuz-logout`.
- [ ] `WebmailSessionRevoker::revoke(uid)`: POST to `{baseUrl}/api/auth/conecta-logout`, 3 s timeout, logs failures, never throws.
- [ ] `BeforeUserLoggedOutListener` → revoker; registered in `Application`.
- [ ] PHPUnit: token claims/signature verify with the webmail's algorithm; listener calls revoker with the uid;
      revoker posts the right body/headers, swallows HTTP errors, is inert when unconfigured.
- [ ] PR to `avuz-customization`.

## 3. Staging

- [ ] Build `webmail-avuz:<sha>` from embedded-mode (PR #35) + this fix; set stack 64 `TAG`; verify container image.
- [ ] Merge conectamail fix into `avuz-customization-staging-3`, `build-push.sh latest staging 3`, redeploy stack 63; verify image.
- [ ] Run QA T1–T7 (Playwright where possible), note results below. Hand the script to Bri.

## Results

_(filled after staging run)_
