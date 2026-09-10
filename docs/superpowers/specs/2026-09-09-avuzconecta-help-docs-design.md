# AvuzConecta — Central de Ajuda (End-User Docs)

**Date:** 2026-09-09
**Status:** Approved design, pre-plan
**Owner:** Patrick Rezende

## Goal

Ship a premium, Brazilian-Portuguese, end-user help site for AvuzConecta
(branded Nextcloud). Concise, task-first, one module per enabled app. Must look
bespoke — not a recognizable docs template — to make a strong first impression
on client users.

## Non-goals

- No admin, onboarding, or internal-ops content (end users only).
- No English or other locales in v1 (pt-BR only).
- No CMS / editor UI — docs are Markdown in the repo.
- No auth wall — the site is public (no client data in examples, only seeded
  demo data).

## Decisions (locked in brainstorming)

| Area | Decision |
|------|----------|
| Engine | Astro Starlight, heavily re-themed to Avuz brand |
| Home | Direction A — landing: hero + search + app grid |
| Inner pages | Direction B — sidebar docs, numbered steps + GIF |
| Audience | End users only |
| Language | pt-BR only |
| Module shape | Task recipes (intro + per-task pages) |
| Media | Text + short GIFs (muted MP4 loop allowed) |
| First release | Core 4: Drive, Tarefas, Talk, Agenda (full). Rest after. |
| Task cap | 8–10 tasks/app in v1; list proposed → user-approved before writing; expand on demand |
| GIF capture | Playwright harness on staging, seeded with mock company data |
| Source of truth | Playwright capture script; text derived 1:1 from a green run; no page ships without a passing capture |
| Distribution | Standalone site + link inside NC |
| Deploy | Multi-stage nginx image built from `docs-site/`, pushed to `registry.avuz.app`, wired via NPM → `ajuda.avuz.app` |
| Repo | Same repo, new `docs-site/` folder |

## Brand tokens

- Primary: `#2bb5e3` (Avuz Blue)
- Deep/link: `#00679e`
- Heading font: `Questrial`; body: system/Inter fallback
- Logo mark: `apps/avuz_theme/img/house-logo.svg` (Lucide-style, currentColor)
- Favicons: `apps/avuz_theme/img/favicon-32.png`

## Apps to document

User-facing enabled apps (from `docker/entrypoint.sh`):

| Slug | Site label | Release |
|------|-----------|---------|
| files (+sharing/versions/trashbin/viewer/text) | **Drive** | Core 4 |
| deck | **Tarefas** | Core 4 |
| spreed | **Talk** | Core 4 |
| calendar | **Agenda** | Core 4 |
| conectamail / mail | **E-mail** | Phase 2 |
| forms | **Formulários** | Phase 2 |
| contacts | **Contatos** | Phase 2 |
| onlyoffice | **Documentos** (OnlyOffice) | Phase 2 |
| dashboard | **Painel** | Phase 2 |
| activity | **Atividade** | Phase 2 |
| settings/user (senha, 2FA, perfil) | **Minha conta** | Phase 2 |

Labels mirror the theme translations (Files→Drive, Deck→Tarefas).

## Architecture

Static Astro Starlight site. No runtime server.

```
docs-site/
├─ astro.config.mjs        # Starlight config: pt-BR, sidebar, Pagefind
├─ package.json
├─ src/
│  ├─ content/docs/
│  │  ├─ index.mdx         # Home (splash / direction A)
│  │  ├─ drive/
│  │  │  ├─ index.md       # "O que é / pra que serve" + task list
│  │  │  ├─ enviar-arquivos.md
│  │  │  ├─ compartilhar.md
│  │  │  └─ ...
│  │  ├─ tarefas/ ...
│  │  ├─ talk/ ...
│  │  └─ agenda/ ...
│  ├─ assets/<app>/*.mp4|gif   # captured media
│  ├─ styles/avuz.css       # brand overrides (colors, fonts, radius)
│  └─ components/           # custom home hero + app-grid overrides
├─ capture/                 # Playwright capture harness (source of truth)
│  ├─ seed/                 # mock-data seeding (occ / provisioning API), idempotent teardown+rebuild
│  ├─ flows/                # one Playwright script per task; annotated numbered steps
│  ├─ lib/                  # browser launch (fake media flags), ffmpeg encode, chrome-crop, hygiene scan
│  └─ README.md             # page checklist + capture/run instructions
├─ Dockerfile               # multi-stage: node build → nginx serve dist/
└─ public/                  # favicon, static
```

- **Search:** Pagefind (Starlight built-in), pt-BR stop words.
- **Theme:** `avuz.css` overrides Starlight CSS custom props + a custom home
  template component for the hero+grid. Dark mode kept (free), palette tuned.
- **Content collection:** Starlight's `docs` collection, frontmatter drives
  sidebar order, title, description (search snippet).

## Module template (every app repeats)

**`<app>/index.md`**
- H1 = app label.
- 2–3 sentence "O que é / pra que serve".
- Card list linking every task page.

**`<app>/<task>.md`**
- H1 = "Como <fazer X>" (verb-first, 3rd person infinitive PT).
- Optional 1-line "Quando usar".
- Numbered steps (`1.` `2.` …), imperative, UI labels in **bold**.
  **Derived 1:1 from the task's passing Playwright script** — the script's
  annotated steps generate the text. No free-hand steps.
- One media block: `<app>/<task>.mp4` (muted, looped) or `.gif`, produced by the
  same green capture run.
- One `:::tip` box (atalho / boa prática).
- Optional `## Problemas comuns` (2–3 Q→A).
- Frontmatter: `title`, `description`, `sidebar.order`, `tags`,
  `capturedForVersion` (NC version the capture ran against — greppable for drift).

**Definition of done, per app:** 8–10 task pages in v1. The task list is
proposed per app and **user-approved before any writing**. More tasks added on
demand. **A page only ships once its capture script runs green** — this is the
accuracy gate (a passing script proves the steps are real against the live fork).

## Capture pipeline + mock data

**Harness = Playwright** (not the MCP browser): only a real Chrome launch can
set the flags Talk needs and run two browser contexts at once.

1. **Seed** staging with a fake tenant "Conecta Demo Ltda": 2–3 demo users
   (pt-BR names, plausible fake identities — never a real client), Drive
   folders/files, a Tarefas board with stacks+cards, Agenda events, a Talk room,
   contacts, one form. Seeding in `capture/seed/` via `occ` / provisioning API,
   **idempotent teardown-and-rebuild** (a re-run reproduces identical UI state,
   not additive drift).
2. **Capture** each task with a Playwright script in `capture/flows/`: annotated
   numbered steps drive the flow; frames → ffmpeg → muted MP4 loop (or GIF).
   - **Talk:** two orchestrated browser contexts; fake media via
     `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`,
     `--use-file-for-fake-video-capture=<demo.y4m>` so a real 2-person call
     renders.
   - Fixed viewport (1280×800); the **step text is emitted from the script's
     annotations** (source of truth).
3. **Publish hygiene gate** (fails the build if violated):
   - **Cosmetic demo domain** in the address bar (e.g. `conecta.demo` via a
     hosts/proxy rewrite), never the real staging host.
   - **Crop** the viewport above browser chrome; **mask** any NC version footer.
   - **Fake tenant identities** only.
   - **Forbidden-string scan** over media filenames + rendered page text + a
     frame OCR/text pass: real hostnames (`*.avuz.app` staging subs, `meet0x`),
     NC version regex, real client names → **build fails**.
4. **Store** media in `src/assets/<app>/`; each page stamps `capturedForVersion`.
5. **Re-capture:** a single `capture:all` command re-runs the whole suite green.
   Wiring it to the upgrade flow is a **non-blocking** follow-up (the stamp makes
   drift greppable in the meantime).

Staging URL + a throwaway demo login are required inputs (obtained at plan time;
staging is capable of OnlyOffice + Talk capture today; staging work is
autonomous per project policy).

## NC integration

Add a link from inside Nextcloud to the site (opens `ajuda.avuz.app` in a new
tab). Smallest viable surface first: an entry in the user menu / help, or a
Dashboard widget, via a minimal `avuz_theme` change. Exact hook chosen in the
plan; must survive NC upgrades (theme-owned, not core patch).

## Deploy

Self-hosted, on Avuz infra — **not** Cloudflare Pages (CF Pages would clone the
whole NC monorepo + private submodules on every build; rejected).

- **Artifact:** multi-stage Docker image. Stage 1 `node` runs `astro build`
  (+ Pagefind); stage 2 `nginx:alpine` serves `dist/`. Build context is
  `docs-site/` only — no submodules, no monorepo drag.
- **Registry:** push to `registry.avuz.app` (same pattern as other stacks).
- **Run:** a small Portainer stack; domain `ajuda.avuz.app` wired via NPM
  (same front proxy as the rest of the estate).
- **Gate:** a broken `astro build` or a failed hygiene scan blocks the image
  build.

## Testing / verification

- `npm run build` (astro + pagefind) exits clean, no broken internal links.
- **Every published task page maps to a Playwright script that runs green** —
  the accuracy gate. No page without a passing capture.
- Every task page: ≥1 numbered step list, exactly 1 media block, a description
  in frontmatter, `capturedForVersion` set, correct sidebar order.
- **Hygiene scan passes:** no real hostname, NC version, or client identifier in
  any media/text (build fails otherwise).
- Each app ships 8–10 approved task pages (v1 cap).
- Renders correctly light + dark, desktop + mobile (spot-check core pages).
- Pagefind search returns results for pt-BR queries ("compartilhar", "reunião").
- pt-BR proofreading pass (no leftover EN, correct accents).
- Home matches direction A; inner pages match direction B.

## Risks / open items

- **Capture staleness:** NC upgrades change UI → media drifts. Mitigation:
  committed `capture:all` suite + `capturedForVersion` stamp. Wiring re-capture
  to the upgrade flow is a deliberate **non-blocking** follow-up.
- **Staging data drift:** seed is teardown-and-rebuild idempotent so captures
  reproduce identically.
- **Talk capture complexity:** two contexts + fake media streams; highest-effort
  flow. Proven on one Talk task in P0 before committing the rest.
- **Scope creep:** 8–10 tasks/app cap; admin/onboarding tiers explicitly out;
  revisit only after all 11 end-user modules ship.
- **Open (plan-time, non-blocking):** exact NC→site link hook (user menu vs
  dashboard widget); Pagefind pt-BR stemming quality (validate during P0).

## Phasing

1. **P0 — Foundation + proof:** `docs-site/` scaffold, Starlight config, Avuz
   theme, home (A). Capture harness (Playwright + seed + ffmpeg + hygiene scan).
   Prove the full chain end-to-end on **two** task pages — one Drive task
   (simple) and one Talk task (two-context/fake-media, the hard case) — each with
   a green script, derived text, clean media past the hygiene gate. Deploy image
   + Portainer stack live. Validate Pagefind pt-BR.
2. **P1 — Core 4:** Drive, Tarefas, Talk, Agenda — 8–10 approved tasks each,
   fully captured.
3. **P2 — NC link + remaining 7 apps.**
