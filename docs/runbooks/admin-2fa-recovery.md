# Runbook — admin locked out of TOTP two-factor auth

Every Avuz Conecta admin must pass TOTP two-factor auth. The entrypoint enables
`twofactor_totp` + `twofactor_backupcodes` and enforces 2FA for the `admin`
group on every boot (`avuz_enforce_admin_2fa` in `docker/lib-apps.sh`, called
from `docker/entrypoint.sh`). Regular users are untouched. This runbook covers an
admin who lost their authenticator app.

Opt out for one stack with `AVUZ_ENFORCE_ADMIN_2FA=0` (default `1` = on). The
stack files (`portainer-stack.yml`, `portainer-stack-s3.yml`) pass it to the
container in their `environment:` list; change the value there and recreate the
stack. A stack created from an older template lacks the line — add
`- AVUZ_ENFORCE_ADMIN_2FA=0` to its `environment:` list, or the opt-out never
reaches the container. It only skips the *enforce* step; the apps stay enabled.
Use it to park enforcement on a stack mid-incident, not as a permanent setting.

## Backup codes are not automatic

Enrolling TOTP does **not** create backup codes. Right after enrolling, every
admin must open **Configurações pessoais → Segurança** and click
**"Gerar códigos de backup"**. That creates ten one-time codes, 16 characters
each, shown once (the request takes a few seconds). Store them offline. An admin
without them has no self-service recovery — only option 2 below.

## Recovery options (fastest first)

### 1. The admin uses a backup code

Only works if the admin generated backup codes after enrolling (see above).
An admin who has them needs no operator:

1. At the login 2FA prompt, pick **"Use o código de backup"**.
2. Enter one unused code. Each works once.
3. Once logged in, open **Configurações pessoais → Segurança**. There is no
   "delete device" control: switch **"Ativar TOTP"** off, then on again, and
   scan the new QR code to re-enroll on the new phone.
4. Click **"Regerar códigos de backup"** and store the new set offline.

### 2. Another admin disables the lost device via Portainer exec

If the locked-out admin has no backup codes, a *second* admin clears their TOTP
provider so they can log in with a password and re-enroll. Run `occ` as
`www-data` through the Portainer exec proxy (no SSH to the host):

```bash
# staging (scripts/deploy.env)
scripts/portainer-exec.sh -u www-data <container> \
  php occ twofactorauth:disable <uid> totp

# prod (scripts/deploy.prod.env) — ask Patrick first, every run
scripts/portainer-exec-prod.sh -u www-data <container> \
  php occ twofactorauth:disable <uid> totp
```

Expected output:

```
Two-factor provider totp disabled for user <uid>.
```

The admin logs in with their password. Because 2FA stays **enforced** for the
`admin` group, Avuz Conecta forces them straight into TOTP re-enrollment on
that login — they cannot skip it. They scan a new QR code, then must click
**"Gerar códigos de backup"** (or "Regerar…") in **Configurações pessoais →
Segurança** — re-enrolling does not create codes.

`occ twofactorauth:disable` turns off one provider for one user. It does **not**
disable the `twofactor_totp` app or lift enforcement, so it is safe. Never run
`occ twofactorauth:enforce --off` or `occ app:disable twofactor_totp` to unblock
someone — both change policy for everyone and the next boot reverts them anyway.

### 3. Last resort — no second admin

If no other admin can log in, exec into the container (option 2 is the same
command; you only need *any* shell with `occ` as `www-data`). A plain
`twofactorauth:disable` on one admin uid is enough to break the deadlock; start
there before anything heavier.

## Check a user's 2FA state

```bash
scripts/portainer-exec.sh -u www-data <container> \
  php occ twofactorauth:state <uid>
```

```
Two-factor authentication is enabled for user <uid>

Enabled providers:
- totp
- backup_codes
```

`twofactorauth:state` reports per-provider status. "not enabled" + enforcement on
means that user will be forced to enroll at next login.

Check the enforcement scope itself (no args = read-only):

```bash
scripts/portainer-exec.sh -u www-data <container> php occ twofactorauth:enforce
# → Two-factor authentication is enforced for members of the group(s) admin
```

## Automation and test admin accounts (staging)

Any account in the `admin` group is forced into TOTP — including service and test
admins. An admin account that cannot complete a TOTP prompt is locked out, not
exempt.

- **Test admins on staging**: enroll TOTP in a password manager / authenticator
  that stores the secret, then click "Gerar códigos de backup" and keep the
  codes. Log in with a backup code when scripting the first session.
- **Automation**: do not drive the web UI as an `admin` user. Use an app password
  + the OCS/WebDAV APIs (app passwords bypass the 2FA challenge), or a dedicated
  non-admin service user. If an automation account genuinely must be an admin and
  cannot do TOTP, set `AVUZ_ENFORCE_ADMIN_2FA=0` in that stack file only — understanding
  it drops enforcement for *every* admin there.
