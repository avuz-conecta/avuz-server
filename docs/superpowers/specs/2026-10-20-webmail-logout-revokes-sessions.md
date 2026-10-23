# Spec: an Avuz Conecta logout ends the ConectaMail session

**Date:** 2026-10-20
**Repos:** avuz-server (`apps/conectamail`), webmail-avuz (`server/`)
**QA:** `docs/superpowers/qa/2026-10-20-webmail-session-after-logout.md` (branch `feat/left-rail-nav`), T1–T7

## Problem

After a user logs out of Avuz Conecta, their ConectaMail session survives on the webmail origin.
Opening the webmail URL directly in the same browser shows their inbox for up to a week
(`SESSION_LIFETIME_MINUTES`, rolling). On a shared computer the next person reads the previous user's mail.

Inside Avuz Conecta there is no leak: every Mail page load mints a fresh SSO token and the webmail replaces
(or destroys) its session. The gap is only a direct visit to the webmail origin.

Found while reading the code: `UserLoggedOutListener` reads the user from `IUserSession`, but Nextcloud fires
`UserLoggedOutEvent` after `setUser(null)` and `session->clear()`. The user is always `null` there, so
`clearLoginPassword()` never runs today. This spec does not change that (see "Out of scope").

## Decision: server-to-server revocation

On logout, conectamail calls a new signed webmail endpoint. The webmail destroys every session that SSO
created for that Avuz Conecta user.

Why not a front-channel hop (logout page loads the webmail `/api/auth/logout` in an iframe or redirect)?
It needs third-party cookies (Safari and Brave block them), depends on the page staying alive, and misses
logouts that don't render a page. The server call works even if the browser never comes back.

Why revoke by Avuz Conecta user, not by Avuz Conecta browser session? Nextcloud's PHP session dies when the
browser closes. With "Lembre-se de mim" the next visit gets a new session, but the webmail cookie from before
still points at the old webmail session. A per-browser binding would miss that session. Revoking by user
closes it.

## Behavior

| Webmail session | On Avuz Conecta logout of user U |
|---|---|
| Created by SSO for U (`conectaUid === U`), any browser | Destroyed |
| Created by SSO for another user | Untouched |
| Direct login with the mailbox password (no `conectaUid`) | Untouched. Its own "Sair" owns it (T5) |

Consequences:

- Logging out on one device ends U's SSO webmail sessions on U's other devices too. Inside Avuz Conecta the
  next Mail page load signs in again silently. A Mail tab already open gets a 401 and shows the webmail login
  screen ("Entrar com Avuz Conecta" works).
- Same-user re-login (T3) and "Lembre-se de mim" (T4) keep working: each Mail load runs SSO again.
- A webmail outage never blocks the Avuz Conecta logout: short timeout, errors logged, logout continues.

## Contract

`POST {webmail}/api/auth/conecta-logout`

- Headers: `Content-Type: application/json`, `x-webmail-request: 1` (the webmail's CSRF gate for writes).
- Body: `{"token": "<payload>.<signature>"}`. Never in the URL, so it stays out of access logs.
- Token: same format and secret as SSO (`WEBMAIL_AVUZ_SSO_SECRET`, HMAC-SHA256, base64url).
  Payload `{v: 1, aud: "webmail-avuz-logout", jti, uid, iat, exp}`, 60 s lifetime.
  The distinct `aud` means an SSO token can't revoke and a logout token can't sign in.
- Single use: the `jti` is claimed in Redis like SSO tokens.
- Responses: `200 {"revoked": n}`; `400` on a bad or replayed token; `404` when SSO is off on the webmail.

Webmail bookkeeping: Redis set `sso:sessions:<uid>` holds the session ids that SSO created for that uid.
SSO sign-in adds the new id and drops ids whose session no longer exists. Revocation reads the set, destroys
each session whose stored `conectaUid` still equals the uid, closes its IMAP connections, stops its watchers,
and deletes the set. No TTL: the set is bounded by the user's live sessions and pruned on every SSO.

Avuz Conecta side: a listener on `BeforeUserLoggedOutEvent` (the user is still known there) signs the token and
posts it with a 3 s timeout. Inert when the webmail URL or secret is unset.

## Acceptance

QA T1 flips to PASS. T2–T5 and T7 stay PASS. T6 (open Mail tab, logout in another tab): the next click in Mail
shows the login screen.

## Out of scope (follow-ups)

- `clearLoginPassword()` on logout is dead code today (see Problem). Making it work changes behavior for users
  on the login-password fallback with sessions on several devices. Needs its own decision.
- Avuz Conecta sessions that expire without a logout do not end the webmail session.
