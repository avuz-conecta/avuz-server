# Admin two-factor login

Every boot enforces TOTP two-factor auth for the `admin` group. An admin without a device is forced into enrollment after the password step. Non-admin users log in with the password alone. Opt-out per stack is `AVUZ_ENFORCE_ADMIN_2FA=0`.

## Sub-features

- `2fa-enforced` admin login is gated by a TOTP step.
- `2fa-enroll` an admin without a device must enroll (QR code plus backup codes) and cannot skip.
- `2fa-nonadmin` a non-admin logs in without a second factor.
- `2fa-enforcement-state` the `admin` group enforcement is active on the stack.

## How to get to it (user POV)

- Open `<base-url>/login`, enter admin username and password.
- Settings, Security, to see the TOTP device and backup codes.

## Driving it with Playwright and curl

Preconditions:

- `scripts/doctor.sh` passes on the target. Target is not staging-2 unless the hand-off says so.
- Credentials file holds the admin login, the non-admin login and, if enrolled, the TOTP seed. Read inside the script only.

- **Status 2026-10-14 (staging-1).** Non-admin: PASSED (verified: `bri-cal455`, password only, landed on `/apps/dashboard/` with no code prompt; [login field names in ../SKILL.md]). Admin gated, enter code, enrollment path and enforcement state: UNVERIFIED (needs admin; skipped).
- **Admin gated.** Fill the `Nome da conta ou e-mail` (the label is not "Nome de usuário") and `Senha` fields (inputs `user` and `password`), submit. Expect a second page asking for the code (TOTP) instead of the dashboard. Screenshot the page before typing any code.
- **Enter code.** Generate the 6-digit code in-script from the seed and submit. Expect the dashboard. Do not log the code.
- **Enrollment path.** For an admin with no device: after the password, expect a forced setup page with a QR code. The URL must not reach `/apps/dashboard` until a device is added. Skip and report if no un-enrolled admin exists.
- **Non-admin.** Log in as the non-admin. Expect the dashboard directly (`/apps/dashboard/`, title "Painel - Avuz Conecta"), no code prompt. Verified.
- **Enforcement state.** Run `scripts/portainer-exec.sh -u www-data <container> php occ twofactorauth:enforce` (staging env file). Expect output saying 2FA is enforced for the group `admin`. Read-only.
- **Proof.** Screenshots of each page, the occ output saved to a log file in the report folder, report links both.

## Gotchas

- Log in once per role per run. Repeated failed codes trigger brute-force throttling and can lock the test IP.
- Never run `twofactorauth:disable`, `enforce --off` or `app:disable` as a "fix". Recovery is in `docs/runbooks/admin-2fa-recovery.md` and is a human step.
- The TOTP seed is a secret. Keep it in the `chmod 600` file only; delete after.
- Code windows are 30 s. If the code is rejected right at a boundary, wait for the next window once, not in a loop.
