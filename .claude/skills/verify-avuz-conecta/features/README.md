# Avuz Conecta verification map

Maintained source for verifying user-facing behavior of Avuz Conecta on staging. Read this index before driving, then use the matching feature file as the recipe.

## Baseline preconditions

- Target is a staging URL from `../SKILL.md`. `scripts/doctor.sh` passes and prints the expected version.
- Credentials arrive as a temporary `chmod 600` file from the user. Never printed, never committed.
- A non-admin test user exists for ordinary journeys. An admin test user with an enrolled TOTP device exists for admin journeys.
- Never drive production. Never touch real mail.

## Driving conventions

- Playwright headless Chromium for UI, curl for plain HTTP. Scripts live outside the repo.
- Prefer ARIA roles and accessible names. UI text is `pt_BR`.
- Start each recipe from a logged-out browser context unless stated.
- Remove test objects the recipe created. Keep the evidence.

## Proof and skip reporting

- Report to `~/work/avuz/reports/<name>.md`, linking screenshots and logs in `~/work/avuz/reports/<name>/`.
- Result is PASSED or FAILED, FAILED with a one-line defect, plus steps and a link.
- Report an unreachable path with the attempted step and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each file has an H1, one paragraph, then four H2s in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with Playwright and curl`, `Gotchas`.

## Features

- [Admin two-factor login](./admin-2fa.md) covers mandatory TOTP for admins and non-admin login.
- [Branding and theme](./branding.md) covers instance name, colors, logos, renamed apps and icons.
- [Drive and Tarefas](./drive-and-tarefas.md) covers the renamed Files and Deck apps, board and file basics.
- [Conecta Mail](./conecta-mail.md) covers the webmail SSO entry from the main app.
- [Assinaturas](./assinaturas.md) covers the e-signature app gating and screens.
- [Talk](./talk.md) covers conversations and recording availability.
