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
| GIF capture | Automated on staging, seeded with mock company data |
| Distribution | Standalone site + link inside NC |
| Deploy | Cloudflare Pages (free tier) → `ajuda.avuz.app`; nginx fallback |
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
├─ capture/                 # GIF automation
│  ├─ seed/                 # mock-data seeding scripts (occ / API)
│  ├─ flows/                # one capture script per task
│  └─ README.md
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
- One media block: `<app>/<task>.mp4` (muted, looped) or `.gif`.
- One `:::tip` box (atalho / boa prática).
- Optional `## Problemas comuns` (2–3 Q→A).
- Frontmatter: `title`, `description`, `sidebar.order`, `tags`.

Consistency is enforced by a page checklist in `capture/README.md` and the
verification step.

## GIF pipeline + mock data

1. **Seed** a staging AvuzConecta instance with a fake tenant "Conecta Demo
   Ltda": 2–3 demo users (pt-BR names), Drive folders/files, a Tarefas board
   with stacks+cards, Agenda events, a Talk room, contacts, one form.
   Seeding via `occ` / provisioning API scripts in `capture/seed/`, idempotent.
2. **Capture** each flow: drive the in-app browser (Claude Browser tools)
   against staging, run the scripted task, record viewport → optimize to GIF or
   muted MP4 loop. One script per task in `capture/flows/`, committed &
   re-runnable when the UI changes.
3. **Store** media in `src/assets/<app>/`, referenced from the task page.
4. **Chrome:** capture at a fixed viewport (e.g. 1280×800) with a neutral demo
   theme so frames are stable and legible.

Staging URL + a throwaway demo login are required inputs (obtained at plan time;
staging work is autonomous per project policy).

## NC integration

Add a link from inside Nextcloud to the site (opens `ajuda.avuz.app` in a new
tab). Smallest viable surface first: an entry in the user menu / help, or a
Dashboard widget, via a minimal `avuz_theme` change. Exact hook chosen in the
plan; must survive NC upgrades (theme-owned, not core patch).

## Deploy

- **Primary:** Cloudflare Pages, project root `docs-site/`, build
  `npm run build`, output `dist/`. Custom domain `ajuda.avuz.app`. Free tier
  (unlimited requests/bandwidth, 500 builds/mo) is sufficient; PR previews on.
- **Fallback:** if free-tier limits or policy block it, serve the static `dist/`
  from existing nginx infra.
- CI: build on push; a broken `astro build` blocks deploy.

## Testing / verification

- `npm run build` (astro + pagefind) exits clean, no broken internal links.
- Every task page: has ≥1 numbered step list, ≥1 media slot, a description in
  frontmatter (search snippet), correct sidebar order.
- Renders correctly light + dark, desktop + mobile (spot-check core pages).
- Pagefind search returns results for pt-BR queries ("compartilhar", "reunião").
- pt-BR proofreading pass (no leftover EN, correct accents).
- Home matches direction A; inner pages match direction B.

## Risks / open items

- **GIF staleness:** NC upgrades change UI → media drifts. Mitigation:
  committed re-runnable capture scripts; re-capture is a documented step.
- **Staging data drift:** seeding must be idempotent and self-contained so
  captures are reproducible.
- **CF Pages policy:** if free tier or account policy is a blocker, fall back to
  nginx (design supports either — output is plain static).
- **Scope creep:** admin/onboarding tiers explicitly out; revisit only after
  all 11 end-user modules ship.

## Phasing

1. **P0 — Foundation:** `docs-site/` scaffold, Starlight config, Avuz theme,
   home (A), one app skeleton (Drive) with 1 real task page end-to-end
   (incl. seeded GIF) as the proven template. Deploy pipeline live.
2. **P1 — Core 4:** Drive, Tarefas, Talk, Agenda fully written + GIFs.
3. **P2 — NC link + remaining 7 apps.**
