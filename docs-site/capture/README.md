# Capture harness

Records real staging UI flows with Playwright and turns them into help-center
task pages under `src/content/docs/<app>/<slug>.md`.

## The core rule

**The flow is the source of truth.** A task page exists only because a
Playwright flow (`capture/flows/<app>-<slug>.ts`) ran green against staging.
Step text is generated 1:1 from the flow's `Step[]` array — never hand-edit a
generated `.md` file's steps, and never write a page without a flow behind it.
If the UI changes, the fix is to update the flow and re-run it, not to patch
the markdown.

## Prerequisites

1. **`capture/.env`** (gitignored — never commit it):
   ```
   STAGING_URL=
   STAGING_USER=admin
   STAGING_APP_PASSWORD=
   DEMO_USER_PASSWORD=
   DEMO_DOMAIN=conecta.demo
   ```
   `STAGING_APP_PASSWORD` is an app password for `STAGING_USER` (admin) on the
   staging instance. `DEMO_USER_PASSWORD` is the shared password for the demo
   fixture users below.

2. **Demo users are fixtures, not something the harness creates.** They live
   on staging today: `demo.ana` (Ana Souza) and `demo.bruno` (Bruno Lima),
   defined in `capture/seed/seed.ts`. They were created out-of-band with
   `occ user:add` because NC 33's Provisioning API gates user creation behind
   password confirmation, which an app password can't satisfy. The seed step
   (`resetTenant()`) never creates users — it only resets `demo.ana`'s data
   over WebDAV (currently: re-puts `relatorio.pdf`, deleting any stale copy
   first). Adding a new demo user is a manual staging step, not a code change.

3. **Install the Playwright browser once:**
   ```
   npx playwright install chromium
   ```

## Commands

Node's `--env-file` loads `capture/.env` without a dotenv dependency. The
`npm run capture` script (`tsx capture/run.ts`) does **not** load the env file
itself, so run it through `node` directly rather than via `npm run capture --`:

```bash
# One flow
node --env-file=capture/.env --import tsx capture/run.ts ./flows/drive-compartilhar-arquivo.ts

# Every flow in capture/flows/ (spawns the above per file)
node --env-file=capture/.env --import tsx capture/run-all.ts
# equivalently: npm run capture:all, but only if the env is already exported
# into the shell (run-all.ts re-spawns `tsx`, not `node --env-file`)

# Hygiene scan over generated content (also runs as part of the Docker build)
npm run scan -- src

# Unit tests (scan, steps, page-writer, seed, run-all — no staging needed)
npm test
```

A successful single-flow run prints `✓ <app>/<slug> → <path>` and leaves the
video under `public/assets/<app>/` and the page under `src/content/docs/`.

## Adding a task page

Repeat this per app, 8–10 tasks per app for v1 (more on demand):

1. **Get the task list approved** by the app owner before recording anything.
2. **Copy an existing flow** as a starting point — `flows/drive-compartilhar-arquivo.ts`
   is the simple single-user reference, `flows/talk-iniciar-reuniao.ts` is the
   two-context (host + guest) reference.
3. **Seed and explore staging as a demo user** to find the real selectors and
   labels — Playwright locators in these flows are role/text based
   (`getByRole`, `getByText`, `getByPlaceholder`), matched against the actual
   pt-BR UI strings, not guessed ones.
4. **Write the annotated `Step[]`** in the flow: pt-BR, verb-first, real UI
   labels wrapped in `**bold**`, describing only actions the code actually
   performs (see the `steps` array in either reference flow).
5. **Run the flow until it's green** (see Commands above). A green run writes
   the media, writes `<app>/<slug>.md` via `capture/lib/page-writer.ts`, and
   the hygiene gate applies at build/scan time — fix any hit before committing.
6. **Build, review, commit**: `npm run build`, eyeball the rendered page, then
   commit the flow + the generated `.md` + the generated media together.

## The page contract

Every generated page (`capture/lib/steps.ts` → `stepsToMarkdown`) has:

- YAML-escaped frontmatter: `title`, `description`, `sidebar.order`,
  `capturedForVersion` (the NC version the capture ran against — grep this
  across `src/content/docs` to find pages that are stale after an upgrade).
- An H1-equivalent title reading "Como \<fazer X\>" (from `title`).
- Numbered steps (`1.`, `2.`, ...), one line each.
- One `<video>` tag, muted/autoplay/loop/controls.
- One `:::tip` block (optional per flow, but the convention is one per page).

## Media convention

Flows write frames to a temp dir; `capture/lib/encode.ts` encodes them to
`public/assets/<app>/<media>`, and the page's `<video src="/assets/<app>/<media>">`
references that same path. **Astro serves `public/` at the site root** —
`src/assets/` is build-processed and NOT what these pages use, so media must
land under `public/assets/`, never `src/assets/`.

## Hygiene rules (enforced, public site)

`capture/lib/scan.ts` walks `src` (file names and `.md`/`.mdx` content) and
fails the build (exit 1) on any hit:

- **Staging hosts**: `*.avuz.app` / `*.avuz.cloud` subdomains (`staging`,
  `app<N>`, `avuzapp<N>`, `meet<N>`, `proxy`, `registry`, `s3-site[ab]`).
- **NC version strings shown with context** (e.g. "Nextcloud 33.0.8" in body
  text — the `capturedForVersion: "33.0.8"` frontmatter key doesn't trip this
  rule because the regex needs a word boundary before "version", and
  `capturedForVersion` is one unbroken word).
- **Real client names** (the fleet roster, e.g. grupo-vidalar, endopasso,
  eco-ambiental, comprev, abvtex, coprel, adyl, raíven, digrepal, garra
  prevestibular).

Run it standalone with `npm run scan -- src`; it also runs as part of the
Docker build (`RUN npx tsx capture/lib/scan.ts src && npm run build`).

**The scanner only sees text, not pixels.** It cannot catch a real hostname
baked into a screenshot or video (e.g. a share link shown on screen). Flows
are responsible for that: every `shoot()` helper calls `maskRealHost()` first,
which walks the DOM and rewrites `STAGING_URL`'s host to `DEMO_DOMAIN`
(`conecta.demo`) in text nodes, `title`/`aria-label` attributes, and input/
textarea values before the screenshot is taken. Use the fake tenant name
**"Conecta Demo Ltda"** and the cosmetic domain for anything shown on screen —
never the real staging host or a real client name.

## Re-capture and drift

UI changes on NC upgrades = media/steps can drift out of sync with the real
app. `npm run capture:all` re-runs every flow in `capture/flows/` and
overwrites the media + pages. Use `capturedForVersion` in each page's
frontmatter to find stale pages after an upgrade (grep for the old version
string). Wiring re-capture automatically into the upgrade flow is a deliberate
later step — for now it's a manual re-run.

## Deploy (pointer)

The docs site is a static image built from `docs-site/` (`docs-site/Dockerfile`,
which runs the hygiene scan before `astro build`), served by nginx, and
deployed via `docs-site/portainer-docs-stack.yml` behind Nginx Proxy Manager
at `ajuda.avuz.app`. Not Cloudflare Pages.
