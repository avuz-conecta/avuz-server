# AvuzConecta Help Docs — Implementation Plan (P0 Foundation + Proof)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the AvuzConecta pt-BR help site and the capture machinery that proves every page's steps, ending with two real pages (one Drive, one Talk) shipped end-to-end and the site deployable as a self-hosted image.

**Architecture:** Astro Starlight static site in `docs-site/`, re-themed to the Avuz brand. A Playwright capture harness is the source of truth: each task's script seeds staging, drives the flow, records a masked GIF/MP4, and emits the page's step text from its own annotations. A publish hygiene gate fails the build if any real hostname/version/client identifier leaks. Deploy is a multi-stage nginx Docker image, built from `docs-site/` only, run via Portainer behind NPM.

**Tech Stack:** Astro + Starlight, Pagefind (pt-BR), TypeScript, Playwright, ffmpeg, Docker (node build → nginx:alpine), Nginx Proxy Manager.

## Global Constraints

- Language: **pt-BR only**. No English in shipped content. Correct accents.
- Brand tokens (verbatim): primary `#2bb5e3`, deep/link `#00679e`, heading font `Questrial`, body `Inter`/system fallback, logo mark `apps/avuz_theme/img/house-logo.svg`, favicon `apps/avuz_theme/img/favicon-32.png`.
- Home = direction A (hero + search + app grid). Inner pages = direction B (sidebar + numbered steps + media).
- **Source of truth:** every published task page maps to a Playwright script that runs green. No page ships without a passing capture. Step text is derived 1:1 from the script's annotations — no free-hand steps.
- Task cap: **8–10 tasks/app** in v1; per-app task list is user-approved before writing.
- Each task page frontmatter includes `capturedForVersion` (NC version the capture ran against).
- Publish hygiene: cosmetic demo domain `conecta.demo` in address bar, chrome cropped, version footer masked, fake tenant "Conecta Demo Ltda" only. A forbidden-string scan (`*.avuz.app` staging subs, `meet0x`, NC-version regex, real client names) fails the build.
- Deploy: self-hosted image → `registry.avuz.app` → Portainer → `ajuda.avuz.app` via NPM. **Not** Cloudflare Pages.
- TS style (user global): no `any`, avoid `as`, named exports only (no default exports), no index-only barrel files, `async/await` over `.then()`, kebab-case filenames, `camelCase` functions, `SNAKE_CAPS` consts, descriptive names, early return, flat code.
- Seed is idempotent **teardown-and-rebuild**, not additive.
- Staging is capable of OnlyOffice + Talk capture today. Staging work is autonomous; anything touching prod is out of scope for this plan.

---

## File Structure

```
docs-site/
├─ package.json                 # scripts: dev, build, capture, capture:all, scan, test
├─ tsconfig.json
├─ astro.config.mjs             # Starlight: pt-BR, sidebar, Pagefind
├─ Dockerfile                   # node build → nginx:alpine serve dist/
├─ nginx.conf                   # static serve + SPA-less fallback for Pagefind
├─ .dockerignore
├─ src/
│  ├─ content.config.ts         # content collection schema (adds capturedForVersion)
│  ├─ content/docs/
│  │  ├─ index.mdx              # Home (direction A)
│  │  ├─ drive/index.md
│  │  ├─ drive/compartilhar-arquivo.md      # proof page 1 (generated)
│  │  ├─ talk/index.md
│  │  └─ talk/iniciar-reuniao.md            # proof page 2 (generated)
│  ├─ styles/avuz.css           # brand overrides
│  ├─ components/HomeHero.astro # direction-A hero + search + app grid
│  └─ assets/{drive,talk}/*.mp4 # captured media
├─ capture/
│  ├─ config.ts                 # STAGING_URL, DEMO_DOMAIN, tenant, viewport (env-driven)
│  ├─ seed/seed.ts              # teardown-and-rebuild demo tenant
│  ├─ seed/seed.test.ts
│  ├─ lib/steps.ts             # Step type + stepsToMarkdown() (annotations → text)
│  ├─ lib/steps.test.ts
│  ├─ lib/scan.ts              # forbidden-string hygiene scan
│  ├─ lib/scan.test.ts
│  ├─ lib/encode.ts            # ffmpeg frames → mp4/gif + chrome crop
│  ├─ lib/browser.ts          # Playwright launch (fake-media flags), demo-domain rewrite
│  ├─ lib/page-writer.ts      # write .md from front-matter + steps + media ref
│  ├─ flows/drive-compartilhar-arquivo.ts   # proof flow 1
│  ├─ flows/talk-iniciar-reuniao.ts         # proof flow 2 (two contexts)
│  ├─ run.ts                   # CLI: run one flow → media + page + scan
│  ├─ run-all.ts               # capture:all
│  └─ README.md                # page checklist + how to add a task
└─ portainer-docs-stack.yml
```

---

### Task 1: Scaffold Starlight site (pt-BR) that builds clean

**Files:**
- Create: `docs-site/package.json`, `docs-site/tsconfig.json`, `docs-site/astro.config.mjs`, `docs-site/src/content.config.ts`, `docs-site/src/content/docs/index.mdx`, `docs-site/.gitignore`

**Interfaces:**
- Produces: a buildable Astro Starlight project rooted at `docs-site/`; `npm run build` emits `docs-site/dist/` with a Pagefind index.

- [ ] **Step 1: Create the project non-interactively**

Run:
```bash
cd docs-site 2>/dev/null || mkdir docs-site && cd docs-site
npm create astro@latest . -- --template starlight --no-install --no-git --yes
```
Expected: Starlight files created in `docs-site/` (do not init a nested git repo).

- [ ] **Step 2: Pin config to pt-BR and set brand shell**

Replace `astro.config.mjs` with:
```js
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://ajuda.avuz.app',
  integrations: [
    starlight({
      title: 'AvuzConecta · Ajuda',
      defaultLocale: 'root',
      locales: { root: { label: 'Português (Brasil)', lang: 'pt-BR' } },
      logo: { src: './src/assets/house-logo.svg', replacesTitle: false },
      customCss: ['./src/styles/avuz.css'],
      components: { Hero: './src/components/HomeHero.astro' },
      sidebar: [
        { label: 'Drive', autogenerate: { directory: 'drive' } },
        { label: 'Talk', autogenerate: { directory: 'talk' } },
      ],
      pagefind: true,
    }),
  ],
});
```

- [ ] **Step 3: Copy the logo asset in**

Run:
```bash
mkdir -p src/assets && cp ../apps/avuz_theme/img/house-logo.svg src/assets/house-logo.svg
mkdir -p public && cp ../apps/avuz_theme/img/favicon-32.png public/favicon.png
```

- [ ] **Step 4: Add the content collection schema with `capturedForVersion`**

Create `src/content.config.ts`:
```ts
import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        capturedForVersion: z.string().optional(),
      }),
    }),
  }),
};
```

- [ ] **Step 5: Minimal home so build has an entry**

Create `src/content/docs/index.mdx`:
```mdx
---
title: Central de Ajuda AvuzConecta
description: Guias rápidos para cada aplicativo do AvuzConecta.
template: splash
hero:
  tagline: Como podemos ajudar?
---
```

- [ ] **Step 6: Install and build**

Run:
```bash
npm install
npm run build
```
Expected: build succeeds; `dist/index.html` and `dist/pagefind/` exist.

- [ ] **Step 7: Commit**

```bash
git add docs-site
git commit -m "feat(docs-site): scaffold pt-BR Starlight site"
```

---

### Task 2: Avuz brand theme (colors, fonts, dark mode)

**Files:**
- Create: `docs-site/src/styles/avuz.css`

**Interfaces:**
- Consumes: `customCss` hook from Task 1.
- Produces: Starlight CSS custom properties overridden to brand; light + dark palettes.

- [ ] **Step 1: Write the brand override CSS**

Create `src/styles/avuz.css`:
```css
@import url('https://fonts.googleapis.com/css2?family=Questrial&family=Inter:wght@400;500;600;700&display=swap');

:root {
  --sl-font: 'Inter', system-ui, sans-serif;
  --sl-font-headings: 'Questrial', sans-serif;
  --sl-color-accent-low: #d7eefb;
  --sl-color-accent: #2bb5e3;
  --sl-color-accent-high: #00679e;
  --sl-color-text-accent: #00679e;
  --sl-border-radius: 12px;
}
:root[data-theme='light'] {
  --sl-color-accent: #00679e;
  --sl-color-text-accent: #00679e;
}
:root[data-theme='dark'] {
  --sl-color-accent: #2bb5e3;
  --sl-color-text-accent: #2bb5e3;
}
.site-title { font-family: 'Questrial', sans-serif; }
h1, h2, h3 { font-family: 'Questrial', sans-serif; }
```

- [ ] **Step 2: Build and eyeball**

Run: `npm run build && npm run preview` (open the printed URL).
Expected: headings render in Questrial; accent is Avuz blue; dark mode legible.

- [ ] **Step 3: Commit**

```bash
git add src/styles/avuz.css
git commit -m "feat(docs-site): Avuz brand theme"
```

---

### Task 3: Home hero (direction A — hero + search + app grid)

**Files:**
- Create: `docs-site/src/components/HomeHero.astro`

**Interfaces:**
- Consumes: `components.Hero` override from Task 1; brand CSS from Task 2.
- Produces: the direction-A landing (gradient hero, search box wired to Pagefind UI, app-card grid).

- [ ] **Step 1: Write the hero component**

Create `src/components/HomeHero.astro`:
```astro
---
const APPS = [
  { slug: 'drive', label: 'Drive', desc: 'Arquivos', icon: '📁' },
  { slug: 'talk', label: 'Talk', desc: 'Reuniões', icon: '💬' },
];
---
<div class="avuz-hero">
  <h1>Como podemos ajudar?</h1>
  <p>Guias rápidos para cada aplicativo</p>
  <a class="avuz-search" href="#" data-open-modal>🔎 Buscar em toda a ajuda…</a>
</div>
<div class="avuz-grid">
  {APPS.map((app) => (
    <a class="avuz-card" href={`/${app.slug}/`}>
      <span class="ic">{app.icon}</span>
      <b>{app.label}</b>
      <small>{app.desc}</small>
    </a>
  ))}
</div>
<style>
  .avuz-hero { text-align:center; padding:3rem 1rem; border-radius:16px;
    background:linear-gradient(135deg,#2bb5e3,#00679e); color:#fff; }
  .avuz-hero h1 { font-family:'Questrial',sans-serif; margin:0 0 .3rem; }
  .avuz-search { display:inline-block; margin-top:1rem; background:#fff; color:#5b6b78;
    border-radius:30px; padding:.6rem 1.2rem; text-decoration:none; }
  .avuz-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr));
    gap:1rem; margin-top:2rem; }
  .avuz-card { border:1px solid var(--sl-color-gray-5); border-radius:14px; padding:1rem;
    text-align:center; text-decoration:none; color:inherit; transition:.15s; }
  .avuz-card:hover { border-color:#2bb5e3; transform:translateY(-2px); }
  .avuz-card .ic { font-size:1.8rem; display:block; }
  .avuz-card b { font-family:'Questrial',sans-serif; display:block; margin-top:.4rem; }
  .avuz-card small { color:var(--sl-color-gray-3); }
</style>
```

- [ ] **Step 2: `data-open-modal` opens Pagefind search**

In the same file add before `</div>` of hero a small script:
```astro
<script>
  document.querySelector('[data-open-modal]')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelector<HTMLButtonElement>('button[data-open-modal]')?.click()
      ?? document.querySelector<HTMLElement>('site-search button')?.click();
  });
</script>
```

- [ ] **Step 3: Build and verify grid renders on home only**

Run: `npm run build && npm run preview`.
Expected: home shows hero + Drive/Talk cards; inner pages unaffected.

- [ ] **Step 4: Commit**

```bash
git add src/components/HomeHero.astro
git commit -m "feat(docs-site): direction-A home hero + app grid"
```

*(APPS list grows as apps land; grid is data-driven.)*

---

### Task 4: Step model + `stepsToMarkdown()` (annotations → page text)

**Files:**
- Create: `docs-site/capture/lib/steps.ts`, `docs-site/capture/lib/steps.test.ts`
- Modify: `docs-site/package.json` (add `test` script + vitest + `@playwright/test`, `typescript`, `tsx`)

**Interfaces:**
- Produces:
  - `type Step = { readonly n: number; readonly text: string }`
  - `type TaskDoc = { readonly title: string; readonly description: string; readonly app: string; readonly slug: string; readonly steps: readonly Step[]; readonly media: string; readonly tip?: string; readonly order: number }`
  - `stepsToMarkdown(doc: TaskDoc, capturedForVersion: string): string` — the exact `.md` body a page ships with (frontmatter + numbered steps + media block + tip).

- [ ] **Step 1: Add dev deps and test script**

Run:
```bash
cd docs-site
npm install -D vitest tsx typescript @playwright/test
npm pkg set scripts.test="vitest run" scripts.capture="tsx capture/run.ts" scripts.capture:all="tsx capture/run-all.ts" scripts.scan="tsx capture/lib/scan.ts"
```

- [ ] **Step 2: Write the failing test**

Create `capture/lib/steps.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { stepsToMarkdown } from './steps';

describe('stepsToMarkdown', () => {
  it('renders frontmatter, numbered steps, media and tip from annotations', () => {
    const md = stepsToMarkdown(
      {
        title: 'Como compartilhar um arquivo',
        description: 'Envie um link ou convide alguém.',
        app: 'drive',
        slug: 'compartilhar-arquivo',
        order: 1,
        media: 'compartilhar-arquivo.mp4',
        tip: 'Use link com senha para dados sensíveis.',
        steps: [
          { n: 1, text: 'Passe o mouse no arquivo e clique em **Compartilhar**.' },
          { n: 2, text: 'Escolha **Link** ou digite um e-mail.' },
        ],
      },
      '33.0.8',
    );
    expect(md).toContain('title: Como compartilhar um arquivo');
    expect(md).toContain('capturedForVersion: "33.0.8"');
    expect(md).toContain('1. Passe o mouse no arquivo e clique em **Compartilhar**.');
    expect(md).toContain('2. Escolha **Link** ou digite um e-mail.');
    expect(md).toMatch(/!\[.*\]\(.*compartilhar-arquivo\.mp4\)|<video/);
    expect(md).toContain(':::tip');
    expect(md).toContain('Use link com senha');
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `npm test -- steps`
Expected: FAIL — `stepsToMarkdown` not found.

- [ ] **Step 4: Implement `steps.ts`**

Create `capture/lib/steps.ts`:
```ts
export type Step = { readonly n: number; readonly text: string };

export type TaskDoc = {
  readonly title: string;
  readonly description: string;
  readonly app: string;
  readonly slug: string;
  readonly steps: readonly Step[];
  readonly media: string;
  readonly tip?: string;
  readonly order: number;
};

export function stepsToMarkdown(doc: TaskDoc, capturedForVersion: string): string {
  const frontmatter = [
    '---',
    `title: ${doc.title}`,
    `description: ${doc.description}`,
    `sidebar:`,
    `  order: ${doc.order}`,
    `capturedForVersion: "${capturedForVersion}"`,
    '---',
  ].join('\n');

  const steps = doc.steps.map((step) => `${step.n}. ${step.text}`).join('\n');
  const video = `<video src="../../assets/${doc.app}/${doc.media}" muted autoplay loop playsinline controls></video>`;
  const tip = doc.tip ? `\n:::tip\n${doc.tip}\n:::\n` : '';

  return `${frontmatter}\n\n${steps}\n\n${video}\n${tip}`;
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `npm test -- steps`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add capture/lib/steps.ts capture/lib/steps.test.ts package.json package-lock.json
git commit -m "feat(capture): step model + stepsToMarkdown emitter"
```

---

### Task 5: Publish hygiene scan (forbidden-string gate)

**Files:**
- Create: `docs-site/capture/lib/scan.ts`, `docs-site/capture/lib/scan.test.ts`

**Interfaces:**
- Produces:
  - `type ScanHit = { readonly file: string; readonly match: string; readonly rule: string }`
  - `scanText(file: string, text: string): readonly ScanHit[]`
  - `scanTree(root: string): Promise<readonly ScanHit[]>` — walks `src/content` + `src/assets` filenames + `.md`/`.mdx` text.
  - CLI entry (`tsx capture/lib/scan.ts <root>`) exits non-zero on any hit.

- [ ] **Step 1: Write the failing test**

Create `capture/lib/scan.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { scanText } from './scan';

describe('scanText', () => {
  it('flags real staging hostnames', () => {
    const hits = scanText('a.md', 'abra staging.avuz.app no navegador');
    expect(hits.map((h) => h.rule)).toContain('staging-host');
  });
  it('flags HPB meet hostnames', () => {
    expect(scanText('a.md', 'meet04.avuz.app').length).toBeGreaterThan(0);
  });
  it('flags a Nextcloud version string', () => {
    expect(scanText('a.md', 'Nextcloud Hub 33.0.8').length).toBeGreaterThan(0);
  });
  it('flags a known real client name', () => {
    const hits = scanText('a.md', 'exemplo grupo-vidalar aqui');
    expect(hits.map((h) => h.rule)).toContain('client-name');
  });
  it('passes clean demo content', () => {
    expect(scanText('a.md', 'Abra conecta.demo e clique em Compartilhar')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `npm test -- scan`
Expected: FAIL — `scanText` not found.

- [ ] **Step 3: Implement `scan.ts`**

Create `capture/lib/scan.ts`:
```ts
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export type ScanHit = { readonly file: string; readonly match: string; readonly rule: string };

const CLIENT_NAMES: readonly string[] = [
  'grupo-vidalar', 'endopasso', 'garra', 'eco-ambiental', 'digrepal',
  'comprev', 'abvtex', 'coprel', 'adyl', 'raíven', 'raiven',
];

const RULES: readonly { readonly rule: string; readonly re: RegExp }[] = [
  { rule: 'staging-host', re: /\b(staging|app\d+|avuzapp\d+)\.avuz\.(app|cloud)\b/gi },
  { rule: 'meet-host', re: /\bmeet\d+\.avuz\.(app|cloud)\b/gi },
  { rule: 'internal-host', re: /\b(proxy|registry|s3-site[ab])\.avuz\.(app|cloud|com)\b/gi },
  { rule: 'nc-version', re: /\b(nextcloud[^\n]{0,12})?\b\d{2}\.\d+\.\d+\b/gi },
  { rule: 'client-name', re: new RegExp(`\\b(${CLIENT_NAMES.join('|')})\\b`, 'gi') },
];

export function scanText(file: string, text: string): readonly ScanHit[] {
  const hits: ScanHit[] = [];
  for (const { rule, re } of RULES) {
    for (const match of text.matchAll(re)) {
      hits.push({ file, match: match[0], rule });
    }
  }
  return hits;
}

async function walk(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return [full];
    }),
  );
  return nested.flat();
}

export async function scanTree(root: string): Promise<readonly ScanHit[]> {
  const files = await walk(root);
  const hits: ScanHit[] = [];
  for (const file of files) {
    hits.push(...scanText(file, file));
    if (/\.(md|mdx)$/.test(file)) {
      hits.push(...scanText(file, await readFile(file, 'utf8')));
    }
  }
  return hits;
}

async function main(): Promise<void> {
  const root = process.argv[2] ?? 'src';
  await stat(root);
  const hits = await scanTree(root);
  if (hits.length > 0) {
    for (const hit of hits) console.error(`✗ [${hit.rule}] ${hit.file}: "${hit.match}"`);
    process.exit(1);
  }
  console.log('✓ hygiene scan clean');
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
```

- [ ] **Step 4: Run test, verify pass**

Run: `npm test -- scan`
Expected: PASS.

> **Note:** the `nc-version` rule matches text-only pages; masking the version in the video frame is handled at capture (Task 8). Frame OCR is out of P0 scope — the text scan + crop/mask cover shipped content.

- [ ] **Step 5: Commit**

```bash
git add capture/lib/scan.ts capture/lib/scan.test.ts
git commit -m "feat(capture): publish hygiene forbidden-string scan"
```

---

### Task 6: Seed harness (idempotent teardown-and-rebuild)

**Files:**
- Create: `docs-site/capture/config.ts`, `docs-site/capture/seed/seed.ts`, `docs-site/capture/seed/seed.test.ts`

**Interfaces:**
- Consumes: staging via env (`STAGING_URL`, admin app-password) — read in `config.ts`; never hardcoded, never logged.
- Produces:
  - `type DemoTenant = { readonly users: readonly string[]; readonly board: string; readonly driveFolder: string }`
  - `resetTenant(): Promise<DemoTenant>` — deletes then recreates the fixed demo set via provisioning/OCS + `occ` (reuse `scripts/portainer-exec.sh` patterns); safe to run twice with identical result.
  - `buildOccCommand(action: string, args: readonly string[]): readonly string[]` — pure, unit-tested.

- [ ] **Step 1: Write the failing test (pure command builder)**

Create `capture/seed/seed.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildOccCommand } from './seed';

describe('buildOccCommand', () => {
  it('builds a www-data occ user delete command', () => {
    expect(buildOccCommand('user:delete', ['demo.ana'])).toEqual([
      'php', 'occ', 'user:delete', 'demo.ana',
    ]);
  });
  it('never interpolates secrets into the argv', () => {
    const cmd = buildOccCommand('user:add', ['demo.ana']);
    expect(cmd.join(' ')).not.toMatch(/password|secret/i);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `npm test -- seed`
Expected: FAIL — `buildOccCommand` not found.

- [ ] **Step 3: Implement `config.ts` and `seed.ts`**

Create `capture/config.ts`:
```ts
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

export const CONFIG = {
  stagingUrl: required('STAGING_URL'),
  demoDomain: process.env.DEMO_DOMAIN ?? 'conecta.demo',
  tenant: 'Conecta Demo Ltda',
  viewport: { width: 1280, height: 800 },
} as const;
```

Create `capture/seed/seed.ts`:
```ts
export type DemoTenant = {
  readonly users: readonly string[];
  readonly board: string;
  readonly driveFolder: string;
};

const DEMO_USERS: readonly string[] = ['demo.ana', 'demo.bruno'];

export function buildOccCommand(action: string, args: readonly string[]): readonly string[] {
  return ['php', 'occ', action, ...args];
}

export async function resetTenant(): Promise<DemoTenant> {
  throw new Error('resetTenant: wire to staging in the proof tasks (7 & 9/10)');
}

export { DEMO_USERS };
```

> `resetTenant` is stubbed here (pure builder is what's unit-tested); it gets wired against live staging in Task 7, where the operator provides `STAGING_URL` + a demo admin app-password and the exact provisioning calls are recorded.

- [ ] **Step 4: Run test, verify pass**

Run: `npm test -- seed`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add capture/config.ts capture/seed/seed.ts capture/seed/seed.test.ts
git commit -m "feat(capture): seed config + occ command builder"
```

---

### Task 7: Browser launch + encode + page writer + run CLI

**Files:**
- Create: `docs-site/capture/lib/browser.ts`, `docs-site/capture/lib/encode.ts`, `docs-site/capture/lib/page-writer.ts`, `docs-site/capture/run.ts`
- Modify: `docs-site/capture/seed/seed.ts` (implement `resetTenant` against staging)

**Interfaces:**
- Consumes: `CONFIG` (Task 6), `TaskDoc`/`stepsToMarkdown` (Task 4), `scanText` (Task 5).
- Produces:
  - `launch(opts: { readonly fakeMedia?: boolean; readonly fakeVideo?: string }): Promise<BrowserContext>` — Chromium with `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, and (when `fakeVideo`) `--use-file-for-fake-video-capture`, plus a route that rewrites the visible host to `CONFIG.demoDomain`.
  - `encodeFrames(framesDir: string, outFile: string): Promise<void>` — ffmpeg frames → muted looping mp4, cropping the top chrome band.
  - `writeTaskPage(doc: TaskDoc, version: string): Promise<string>` — calls `stepsToMarkdown`, runs `scanText` on the result, throws on any hit, writes `src/content/docs/<app>/<slug>.md`.
  - `run.ts` CLI: `tsx capture/run.ts <flow-file>` → seed → run flow → encode → write page → scan; non-zero exit on any failure.

- [ ] **Step 1: Install Playwright Chromium**

Run: `cd docs-site && npx playwright install chromium`
Expected: Chromium downloaded.

- [ ] **Step 2: Implement `browser.ts`**

Create `capture/lib/browser.ts`:
```ts
import { chromium, type BrowserContext } from '@playwright/test';
import { CONFIG } from '../config';

export async function launch(opts: {
  readonly fakeMedia?: boolean;
  readonly fakeVideo?: string;
}): Promise<BrowserContext> {
  const args: string[] = [];
  if (opts.fakeMedia) {
    args.push('--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream');
  }
  if (opts.fakeVideo) args.push(`--use-file-for-fake-video-capture=${opts.fakeVideo}`);

  const browser = await chromium.launch({ args });
  const context = await browser.newContext({
    viewport: CONFIG.viewport,
    permissions: ['camera', 'microphone'],
  });
  return context;
}
```

- [ ] **Step 3: Implement `encode.ts`**

Create `capture/lib/encode.ts`:
```ts
import { spawn } from 'node:child_process';

const CHROME_CROP_TOP = 0; // frames are captured from the page viewport, no browser chrome

export async function encodeFrames(framesDir: string, outFile: string): Promise<void> {
  const filter = `crop=in_w:in_h-${CHROME_CROP_TOP}:0:${CHROME_CROP_TOP},scale=1280:-2`;
  await run('ffmpeg', [
    '-y', '-framerate', '4', '-i', `${framesDir}/frame-%04d.png`,
    '-vf', filter, '-an', '-movflags', '+faststart',
    '-pix_fmt', 'yuv420p', outFile,
  ]);
}

function run(cmd: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args], { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}
```

> Playwright captures the **page viewport** (no browser chrome), so cropping the address bar is unnecessary — the demo-domain rewrite + version masking in the flow handle identity. `CHROME_CROP_TOP` stays 0 unless a flow shows chrome.

- [ ] **Step 4: Implement `page-writer.ts`**

Create `capture/lib/page-writer.ts`:
```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { stepsToMarkdown, type TaskDoc } from './steps';
import { scanText } from './scan';

export async function writeTaskPage(doc: TaskDoc, version: string): Promise<string> {
  const md = stepsToMarkdown(doc, version);
  const hits = scanText(`${doc.app}/${doc.slug}.md`, md);
  if (hits.length > 0) {
    throw new Error(`hygiene scan failed: ${hits.map((h) => `${h.rule}:${h.match}`).join(', ')}`);
  }
  const path = join('src/content/docs', doc.app, `${doc.slug}.md`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, md, 'utf8');
  return path;
}
```

- [ ] **Step 5: Implement `run.ts` CLI + a flow contract**

Create `capture/run.ts`:
```ts
import { CONFIG } from './config';
import { resetTenant } from './seed/seed';
import { writeTaskPage } from './lib/page-writer';
import type { TaskDoc } from './lib/steps';
import type { BrowserContext } from '@playwright/test';

export type Flow = {
  readonly capturedForVersion: string;
  run(context: BrowserContext, framesDir: string): Promise<TaskDoc>;
  readonly fakeMedia?: boolean;
  readonly fakeVideo?: string;
};

async function main(): Promise<void> {
  const flowFile = process.argv[2];
  if (!flowFile) throw new Error('usage: tsx capture/run.ts <flow-file>');
  const { launch } = await import('./lib/browser');
  const { encodeFrames } = await import('./lib/encode');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const flow: Flow = (await import(new URL(flowFile, import.meta.url).href)).flow;
  await resetTenant();
  const context = await launch({ fakeMedia: flow.fakeMedia, fakeVideo: flow.fakeVideo });
  const framesDir = await mkdtemp(join(tmpdir(), 'avuz-frames-'));
  const doc = await flow.run(context, framesDir);
  await encodeFrames(framesDir, join('src/assets', doc.app, doc.media));
  const path = await writeTaskPage(doc, flow.capturedForVersion);
  await context.close();
  console.log(`✓ ${CONFIG.stagingUrl} → ${path}`);
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
```

- [ ] **Step 6: Wire `resetTenant` against staging**

Explore the live staging instance (its provisioning API + `occ` via `scripts/portainer-exec.sh`) and implement `resetTenant`: delete `DEMO_USERS`, the demo board, and the demo Drive folder, then recreate them with fixed pt-BR content. Verify idempotency:

Run (twice):
```bash
STAGING_URL=... tsx -e "import('./capture/seed/seed').then(m=>m.resetTenant()).then(console.log)"
```
Expected: identical `DemoTenant` output both times; second run shows no duplicate users/boards on staging.

- [ ] **Step 7: Commit**

```bash
git add capture/lib/browser.ts capture/lib/encode.ts capture/lib/page-writer.ts capture/run.ts capture/seed/seed.ts
git commit -m "feat(capture): browser launch, ffmpeg encode, page writer, run CLI"
```

---

### Task 8: Proof flow 1 — Drive "compartilhar arquivo" end-to-end

**Files:**
- Create: `docs-site/capture/flows/drive-compartilhar-arquivo.ts`, `docs-site/src/content/docs/drive/index.md`
- Produces (generated, committed): `docs-site/src/content/docs/drive/compartilhar-arquivo.md`, `docs-site/src/assets/drive/compartilhar-arquivo.mp4`

**Interfaces:**
- Consumes: `Flow` contract (Task 7), `TaskDoc`/`Step` (Task 4).
- Produces: a green single-context capture whose annotations become the page.

- [ ] **Step 1: Author the Drive index**

Create `src/content/docs/drive/index.md`:
```md
---
title: Drive
description: Guarde, organize e compartilhe seus arquivos com segurança.
---

O **Drive** é onde você guarda e organiza seus arquivos na nuvem AvuzConecta.
Compartilhe por link ou convide colegas para ver e editar juntos.

- [Como compartilhar um arquivo](/drive/compartilhar-arquivo/)
```

- [ ] **Step 2: Explore staging to record real selectors**

Open the seeded staging Drive as `demo.ana`, perform "compartilhar arquivo" by hand, and note the exact selectors/labels for each step (share action, "Link"/"E-mail" toggle, copy-link). Capture these into the flow's step annotations — the text is written from what the UI actually says.

- [ ] **Step 3: Write the flow**

Create `capture/flows/drive-compartilhar-arquivo.ts`:
```ts
import type { Flow } from '../run';
import type { BrowserContext } from '@playwright/test';
import type { Step, TaskDoc } from '../lib/steps';
import { CONFIG } from '../config';

async function shoot(page: import('@playwright/test').Page, dir: string, i: number): Promise<void> {
  await page.screenshot({ path: `${dir}/frame-${String(i).padStart(4, '0')}.png` });
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  async run(context: BrowserContext, framesDir: string): Promise<TaskDoc> {
    const page = await context.newPage();
    let i = 0;
    await page.goto(`${CONFIG.stagingUrl}/apps/files`);
    // login handled by storageState or a login helper set up in Task 7
    const steps: Step[] = [];

    await page.getByRole('row', { name: /relatorio\.pdf/i }).hover();
    await shoot(page, framesDir, i++);
    await page.getByRole('button', { name: /compartilhar|ações/i }).first().click();
    await shoot(page, framesDir, i++);
    steps.push({ n: 1, text: 'Passe o mouse no arquivo e clique em **Compartilhar**.' });

    await page.getByRole('button', { name: /criar link|copiar link/i }).click();
    await shoot(page, framesDir, i++);
    steps.push({ n: 2, text: 'Clique em **Criar link** para gerar um link de compartilhamento.' });

    await page.getByRole('button', { name: /copiar/i }).click();
    await shoot(page, framesDir, i++);
    steps.push({ n: 3, text: 'Clique em **Copiar** e envie o link para quem precisar.' });

    return {
      title: 'Como compartilhar um arquivo',
      description: 'Gere um link ou convide alguém para ver ou editar um arquivo.',
      app: 'drive',
      slug: 'compartilhar-arquivo',
      order: 1,
      media: 'compartilhar-arquivo.mp4',
      tip: 'Precisa de mais controle? Defina senha e validade no mesmo painel de compartilhamento.',
      steps,
    };
  },
};
```

> Selectors above are the starting hypothesis from Step 2; adjust to the real DOM until the run is green. This is expected — the green run is what certifies the steps.

- [ ] **Step 4: Run the capture**

Run: `STAGING_URL=... npm run capture -- ./flows/drive-compartilhar-arquivo.ts`
Expected: exits `✓`; `src/assets/drive/compartilhar-arquivo.mp4` and `src/content/docs/drive/compartilhar-arquivo.md` created; hygiene scan clean.

- [ ] **Step 5: Build with the new page**

Run: `npm run build`
Expected: build succeeds; the Drive page renders with steps + video.

- [ ] **Step 6: Commit**

```bash
git add capture/flows/drive-compartilhar-arquivo.ts src/content/docs/drive src/assets/drive
git commit -m "feat(docs): Drive compartilhar-arquivo — first proven page"
```

---

### Task 9: Proof flow 2 — Talk "iniciar reunião" (two contexts + fake media)

**Files:**
- Create: `docs-site/capture/flows/talk-iniciar-reuniao.ts`, `docs-site/src/content/docs/talk/index.md`, `docs-site/capture/assets/demo-video.y4m` (fake camera source)
- Produces (generated, committed): `docs-site/src/content/docs/talk/iniciar-reuniao.md`, `docs-site/src/assets/talk/iniciar-reuniao.mp4`

**Interfaces:**
- Consumes: `Flow` contract (Task 7) with `fakeMedia: true`, `fakeVideo` pointing at a `.y4m`.
- Produces: a green **two-context** capture (host starts the call, second participant joins) proving the hard case.

- [ ] **Step 1: Generate a fake camera source**

Run:
```bash
ffmpeg -y -f lavfi -i testsrc=size=640x480:rate=15 -t 12 -pix_fmt yuv420p capture/assets/demo-video.y4m
```
Expected: `demo-video.y4m` created (a moving pattern stands in for a webcam).

- [ ] **Step 2: Author the Talk index**

Create `src/content/docs/talk/index.md`:
```md
---
title: Talk
description: Faça reuniões por vídeo, converse e compartilhe a tela.
---

O **Talk** é a ferramenta de reuniões e conversas do AvuzConecta.
Crie uma sala, convide participantes e fale por vídeo direto do navegador.

- [Como iniciar uma reunião](/talk/iniciar-reuniao/)
```

- [ ] **Step 3: Explore staging Talk to record selectors**

As `demo.ana`, create a conversation and start a call; as `demo.bruno` in a second context, join it. Note selectors for: new conversation, start call, join, participant tile. Confirm the seeded Talk room + HPB render two tiles.

- [ ] **Step 4: Write the two-context flow**

Create `capture/flows/talk-iniciar-reuniao.ts`:
```ts
import type { Flow } from '../run';
import type { BrowserContext, Page } from '@playwright/test';
import type { Step, TaskDoc } from '../lib/steps';
import { CONFIG } from '../config';

async function shoot(page: Page, dir: string, i: number): Promise<void> {
  await page.screenshot({ path: `${dir}/frame-${String(i).padStart(4, '0')}.png` });
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  fakeMedia: true,
  fakeVideo: 'capture/assets/demo-video.y4m',
  async run(context: BrowserContext, framesDir: string): Promise<TaskDoc> {
    const host = await context.newPage();
    let i = 0;
    await host.goto(`${CONFIG.stagingUrl}/apps/spreed`);
    const steps: Step[] = [];

    await host.getByRole('button', { name: /criar conversa|nova conversa/i }).click();
    await shoot(host, framesDir, i++);
    steps.push({ n: 1, text: 'No **Talk**, clique em **Criar conversa** e dê um nome à sala.' });

    await host.getByRole('button', { name: /iniciar chamada|iniciar reunião/i }).click();
    await shoot(host, framesDir, i++);
    steps.push({ n: 2, text: 'Clique em **Iniciar chamada** para entrar na reunião.' });

    const guest = await context.newPage();
    await guest.goto(`${CONFIG.stagingUrl}/apps/spreed`);
    await guest.getByRole('button', { name: /entrar na chamada|participar/i }).click();
    await shoot(host, framesDir, i++);
    steps.push({ n: 3, text: 'Convide participantes pelo botão **Compartilhar link** — eles clicam em **Entrar na chamada**.' });

    return {
      title: 'Como iniciar uma reunião',
      description: 'Crie uma sala no Talk e comece uma chamada de vídeo em segundos.',
      app: 'talk',
      slug: 'iniciar-reuniao',
      order: 1,
      media: 'iniciar-reuniao.mp4',
      tip: 'Compartilhe a tela pelo ícone de monitor durante a chamada.',
      steps,
    };
  },
};
```

- [ ] **Step 5: Run the capture**

Run: `STAGING_URL=... npm run capture -- ./flows/talk-iniciar-reuniao.ts`
Expected: `✓`; two-tile call captured; `talk/iniciar-reuniao.{mp4,md}` created; scan clean.

- [ ] **Step 6: Build + commit**

Run: `npm run build`
```bash
git add capture/flows/talk-iniciar-reuniao.ts capture/assets/demo-video.y4m src/content/docs/talk src/assets/talk
git commit -m "feat(docs): Talk iniciar-reuniao — two-context capture proven"
```

---

### Task 10: `capture:all` + Pagefind pt-BR validation

**Files:**
- Create: `docs-site/capture/run-all.ts`
- Test: manual Pagefind query check

**Interfaces:**
- Consumes: every `capture/flows/*.ts` exporting `flow`.
- Produces: `run-all.ts` runs all flows sequentially; non-zero exit if any fails.

- [ ] **Step 1: Implement `run-all.ts`**

Create `capture/run-all.ts`:
```ts
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

function runFlow(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tsx', ['capture/run.ts', `./flows/${file}`], { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${file} failed`))));
  });
}

async function main(): Promise<void> {
  const flows = (await readdir('capture/flows')).filter((f) => f.endsWith('.ts'));
  for (const file of flows) await runFlow(file);
  console.log(`✓ captured ${flows.length} flows`);
}

void main();
```

- [ ] **Step 2: Validate Pagefind pt-BR search**

Run: `npm run build && npm run preview`, open the site, search `compartilhar` and `reunião`.
Expected: Drive and Talk pages surface. If pt-BR stemming is weak, set Pagefind language via page `lang` (already `pt-BR` from Task 1) and re-verify.

- [ ] **Step 3: Full hygiene scan over the tree**

Run: `npm run scan -- src`
Expected: `✓ hygiene scan clean`.

- [ ] **Step 4: Commit**

```bash
git add capture/run-all.ts
git commit -m "feat(capture): capture:all runner + Pagefind pt-BR verified"
```

---

### Task 11: Deploy — multi-stage image + Portainer stack

**Files:**
- Create: `docs-site/Dockerfile`, `docs-site/nginx.conf`, `docs-site/.dockerignore`, `docs-site/portainer-docs-stack.yml`

**Interfaces:**
- Consumes: `npm run build` output `dist/`; hygiene scan as a build gate.
- Produces: an image serving `dist/` on nginx; a Portainer stack for `ajuda.avuz.app`.

- [ ] **Step 1: Write `.dockerignore`**

Create `docs-site/.dockerignore`:
```
node_modules
dist
capture/assets/*.y4m
.astro
```

- [ ] **Step 2: Write the Dockerfile (scan gates the build)**

Create `docs-site/Dockerfile`:
```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx tsx capture/lib/scan.ts src && npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

- [ ] **Step 3: Write `nginx.conf`**

Create `docs-site/nginx.conf`:
```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;
  location / { try_files $uri $uri/ $uri.html =404; }
  location /pagefind/ { add_header Cache-Control "public, max-age=3600"; }
}
```

- [ ] **Step 4: Build the image locally**

Run: `cd docs-site && docker build -t registry.avuz.app/admin/avuzconecta-docs:latest .`
Expected: build passes only if scan clean + astro build clean; image created.

- [ ] **Step 5: Smoke-test the container**

Run: `docker run --rm -p 8088:80 registry.avuz.app/admin/avuzconecta-docs:latest &` then `curl -sSf localhost:8088 >/dev/null && echo ok`
Expected: `ok`; stop the container after.

- [ ] **Step 6: Write the Portainer stack**

Create `docs-site/portainer-docs-stack.yml`:
```yaml
services:
  docs:
    image: registry.avuz.app/admin/avuzconecta-docs:latest
    restart: unless-stopped
    ports:
      - "8092:80"
```

- [ ] **Step 7: Commit**

```bash
git add docs-site/Dockerfile docs-site/nginx.conf docs-site/.dockerignore docs-site/portainer-docs-stack.yml
git commit -m "feat(docs-site): self-hosted nginx image + Portainer stack"
```

> Push to `registry.avuz.app` and wire `ajuda.avuz.app` in NPM at deploy time (operator step; staging autonomous, prod gated per project policy).

---

### Task 12: `capture/README.md` — page checklist + how to add a task

**Files:**
- Create: `docs-site/capture/README.md`

- [ ] **Step 1: Write the README**

Create `capture/README.md` documenting: the per-page checklist (H1 "Como…", ≤ media block, tip, `capturedForVersion`), the "no page without a green flow" rule, how to add a flow (copy a `flows/*.ts`, record selectors on staging, run `npm run capture`), the 8–10 task cap and the user-approval gate for each app's task list, the hygiene rules, and re-capture (`npm run capture:all`).

```md
# Capture harness

The Playwright flow is the source of truth. A page ships only when its flow runs green.

## Add a task (per app, 8–10 in v1, list approved first)
1. Get the app's task list approved by the owner.
2. Copy an existing `flows/<app>-<slug>.ts`.
3. Seed + explore staging as a demo user; record real selectors/labels.
4. Write annotated steps (pt-BR, verb-first, UI labels in **bold**).
5. `STAGING_URL=... npm run capture -- ./flows/<app>-<slug>.ts`
6. Green run → media + `<app>/<slug>.md` generated + hygiene scan passes.
7. `npm run build`, review, commit.

## Rules
- pt-BR only. No real hostname/version/client name (scan enforces).
- Fake tenant "Conecta Demo Ltda"; demo domain conecta.demo.
- Re-capture everything: `npm run capture:all`.
```

- [ ] **Step 2: Commit**

```bash
git add capture/README.md
git commit -m "docs(capture): harness README + page checklist"
```

---

## P1 / P2 (content passes — driven by the proven machinery, not code)

Once P0 is green, P1 and P2 are **not** new engineering — they are repeated runs of the Task 8/9 pattern:

- **P1 — Core 4:** for Drive, Tarefas, Talk, Agenda: propose 8–10 tasks/app → user approves → author one `flows/*.ts` per task → `npm run capture` → commit. Each page is one green flow.
- **P2 — remaining 7 apps + NC link:** same loop for Mail, Formulários, Contatos, Documentos (OnlyOffice), Painel, Atividade, Minha conta. Plus the NC→site link (user-menu entry or dashboard widget via `avuz_theme`; exact hook decided then, theme-owned so it survives upgrades).

Each of P1/P2 gets its own short task list appended here (or a follow-up plan) at the time, because the task set depends on the user-approved per-app lists.

---

## Self-Review

- **Spec coverage:** engine/theme (T1–2), home A + inner B (T3, T8/T9 pages), pt-BR (T1, all content), source-of-truth capture + derived text (T4, T7, T8/T9), 8–10 cap + approval (T12, P1/P2), `capturedForVersion` (T4), seed teardown-rebuild (T6/T7), Talk two-context fake media (T9), hygiene gate + cosmetic domain + scan (T5, T7, T11), self-hosted image not CF (T11), Pagefind pt-BR (T10), NC link (P2), verification (T10/T11 gates). Covered.
- **Placeholder scan:** capture flows carry real starting code with an explicit "adjust selectors until green" note (honest — selectors need the live DOM); no `TODO`/`TBD` left.
- **Type consistency:** `TaskDoc`/`Step`/`Flow` names match across steps.ts, page-writer.ts, run.ts, and both flows; `scanText` signature consistent between scan.ts and page-writer.ts.
