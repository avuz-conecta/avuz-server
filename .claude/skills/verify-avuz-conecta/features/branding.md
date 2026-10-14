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

- **Login page.** curl `<base-url>/login`, expect HTTP 200 and the text `Avuz Conecta` in the body. Screenshot the page.
- **Theme assets.** For `assinaturas`, `deck`, `files`, `spreed`, `calendar`, `contacts`, `dashboard`, `forms`, `mail`, `activity`, `settings` run `curl -sS -o /dev/null -w '%{http_code}' <base-url>/themes/avuz/apps/<app>/img/<file>.svg`. Take the file name from the repo folder `themes/avuz/apps/<app>/img/`. Expect HTTP 200 for each.
- **Navigation.** Log in as the non-admin. Use `getByRole('navigation')` and read link names. Expect `Drive` and `Tarefas`, and no `Files` or `Deck`. Screenshot the bar.
- **Color and language.** Read `getComputedStyle(document.documentElement).getPropertyValue('--color-primary')` through Playwright. Expect `#2bb5e3` (case-insensitive). Expect `document.documentElement.lang` to start with `pt`.
- **Proof.** Screenshots plus the curl status table saved as a text file in the report folder.

## Gotchas

- After a deploy, browsers and Cloudflare hold old assets. `scripts/deploy.sh` bumps the theming cachebuster; if navigation still shows old names, check the `?v=` on the CSS URL before declaring FAILED.
- The `/themes/` location needs the `^~` modifier on the reverse proxy. A 404 or a cached HTML body on an svg path points at the proxy, not the image.
- An icon added or changed on a running instance can stick until the `imagePath-` cache is cleared.
