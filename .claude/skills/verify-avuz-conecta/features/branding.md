# Branding and theme

The instance shows as "Avuz Conecta" with primary color `#2bb5e3`, Brazilian Portuguese by default, the `avuz` theme, Avuz logos and favicons, and Lucide-style app icons. Files appears as "Drive" and Deck as "Tarefas".

## Sub-features

- `brand-name` page title and login heading read "Avuz Conecta".
- `brand-assets` logo, house logo and favicons are served.
- `brand-app-names` navigation shows Drive and Tarefas, not Files and Deck.
- `brand-icons` themed app icons are served from `/themes/avuz/apps/<app>/img/`.
- `brand-locale` default language is `pt_BR`.

## How to get to it (user POV)

- Open `<base-url>/login` (logged out).
- After login, read the top navigation bar and the browser tab title.

## Driving it with Playwright and curl

Preconditions:

- `scripts/doctor.sh` passes. A non-admin test user is available for the navigation checks.

- **Login page.** curl `<base-url>/login`, expect HTTP 200 and the text `Avuz Conecta` in the body (9 matches on staging-1, none for the upstream product name). In Playwright the tab title is `Login – Avuz Conecta` and the labels are `Nome da conta ou e-mail` and `Senha`. Screenshot the page. Verified.
- **Theme assets.** For `assinaturas`, `deck`, `files`, `spreed`, `calendar`, `contacts`, `dashboard`, `forms`, `mail`, `activity`, `settings` run `curl -sS -o /dev/null -w '%{http_code} %{content_type}' <base-url>/themes/avuz/apps/<app>/img/<file>.svg`. List only plain files in `themes/avuz/apps/<app>/img/` (`spreed/dashboard` is a folder and 404s). Expect `200 image/svg+xml`. Verified on staging-1: activity (`activity`, `activity-dark`), assinaturas (`app`, `app-dark`), calendar (`calendar`, `calendar-dark`), contacts (`app`), dashboard (`dashboard`), deck (`deck`, `deck-dark`), files (`app`, `app-dark`), forms (`forms`, `forms-dark`), mail (`mail`, `mail-dark`), settings (`app`), spreed (`app`, `app-dark`): all 200.
- **Navigation.** Log in as the non-admin. Read the links of `getByRole('navigation', { name: 'Menu de aplicativos' })`. Expect, in order on staging-1: `Painel`, `Talk`, `Drive`, `Atividade`, `Contatos`, `Calendário`, `Tarefas`, `Mail`, `Formulários`. `Drive` and `Tarefas` present; no `Files` or `Deck`. `Assinaturas` is absent for a non-member. The link images point at `/themes/avuz/apps/<app>/img/*.svg`. Screenshot the bar. Verified.
- **Color and language.** `document.documentElement.lang` is `pt-BR` and `data-locale` is `pt_BR` (verified). Read the colors from the capabilities `theming` block (`GET /ocs/v2.php/cloud/capabilities?format=json`, header `OCS-APIRequest: true`) and from `getComputedStyle(document.documentElement)`. On staging-1 `--color-primary` and `theming.color` are `#1c7fa0`, NOT the documented `#2bb5e3` (`#2bb5e3` is only the favicon stroke). Whether `#1c7fa0` is a contrast-adjusted shade of `#2bb5e3` or a different stored color needs the admin theming setting: UNVERIFIED (needs admin; skipped). Report the observed value and flag the mismatch; do not report PASSED against `#2bb5e3`.
- **Proof.** Screenshots plus the curl status table saved as a text file in the report folder.

## Gotchas

- After a deploy, browsers and Cloudflare hold old assets. `scripts/deploy.sh` bumps the theming cachebuster; if navigation still shows old names, check the `?v=` on the CSS URL before declaring FAILED.
- The `/themes/` location needs the `^~` modifier on the reverse proxy. A 404 or a cached HTML body on an svg path points at the proxy, not the image.
- An icon added or changed on a running instance can stick until the `imagePath-` cache is cleared.
