# AvuzConecta Help Docs — SDD progress ledger

Plan: docs/superpowers/plans/2026-09-09-avuzconecta-help-docs.md
Scope this run: Tasks 1–5 (machinery, no staging needed)
Branch: claude/avuzconecta-pt-docs-3bb647
Base commit at run start: 5802d0d60f6ef7e2745897a5a5e3e9129dd4cbd7

## Tasks
Task 1: complete (commits 5802d0d..1a4aebef8d9; scaffold 4f5992e5fee + favicon fix; review clean after favicon fix)
  - Deviations (authorized): customCss omitted (Task 2 re-adds it), Hero omitted (Task 3), sidebar syntax migrated to Starlight v0.42 items[] form.
  - MINOR (final sweep): docs-site/README.md still stock Starlight starter text ("Seasoned astronaut? Delete this file"); AGENTS.md/.vscode stock scaffold — cosmetic.
  - Task 2 must: re-add `customCss: ['./src/styles/avuz.css']` to astro.config.mjs. Favicon already wired (favicon.png) — don't touch.
Task 2: complete (commits 1a4aebef8d9..95e30817e83; theme e5e836f6100 + dark-contrast fix; customCss re-added, verified)
  - Critical fixed: dark-mode WCAG contrast — accent-low/high now overridden in dark block (#003653/#bfe6f7). Root cause = plan's example CSS Step-1 was incomplete.
  - PLAN NOTE (final sweep): plan doc Task 2 example CSS lacks the dark accent-low/high overrides; patch plan if reused.
  - Task 3 must: re-add `components: { Hero: './src/components/HomeHero.astro' }` to astro.config.mjs (Task 1 omitted it).
Task 3: complete (commit 5232b54c373; home hero direction A; review Approved, no issues)
  - Impl fixed a real search open-then-close propagation bug + AA scrim contrast beyond the brief snippet. Grid home-only (Starlight Page.astro gates Hero on `hero` frontmatter). components.Hero re-added.
  - Expected: /drive/ /talk/ 404 until content tasks (P1).
Task 4: complete (commit 06075f42c0d; step model + stepsToMarkdown; review Approved)
  - Types Step/TaskDoc + stepsToMarkdown signature = verbatim, downstream depends. Test asserts real output. vitest/tsx/typescript/@playwright/test devDeps + scripts added.
  - TASK 7 (page-writer) MUST: YAML-escape title/description in frontmatter — pt-BR titles like "Como fazer: X" contain colons → invalid frontmatter. Latent bug in steps.ts by design (verbatim brief). Also cosmetic: steps.ts:19 `sidebar:` template literal → plain string.
Task 5: complete (commits 06075f42c0d..b549798e573; hygiene scan fff1c53451a + fix b549798e573; full suite 12/12)
  - Fixed 3 Important: bare meet.avuz.app now caught (\d*), nc-version no longer false-matches pt-BR dd.mm.yyyy dates (\d{1,2} segs), added internal-host + bare-meet + date-passes tests. garra→'garra prevestibular'.
  - MINOR carry (final sweep): CLI guard `import.meta.url===file://argv[1]` not symlink-safe (breaks under /tmp→/private/tmp); works in worktree. Harden later.

## Run summary
Tasks 1–5 (machinery) DONE. Branch tip b549798e573. Build green, test 12/12.
NEXT (needs user inputs): Task 6 seed (STAGING_URL + demo admin app-password), Task 7 browser/encode/page-writer, Tasks 8-9 proof captures (healthy HPB for Talk), then 10-12. Plus per-app 8-10 task lists to approve before P1 content.
No final whole-branch review yet — plan is mid-flight (5/12); run it before merge.

## Staging setup (2026-09-10)
- Target: conectahml.avuz.app = Portainer container `avuz-conecta-app-1` (stack avuz-conecta), NC 33.0.8.
- Portainer exec: `PORTAINER_ENV_FILE=/Users/patrickrezende/work/avuz/avuz-server/scripts/deploy.env ./scripts/portainer-exec.sh -u www-data avuz-conecta-app-1 php occ ...` (deploy.env lives in MAIN checkout, not worktree).
- Creds in docs-site/capture/.env (gitignored): admin app-password + DEMO_USER_PASSWORD=ConectaDemo!2026.
- Demo users created via occ (FIXTURES, do not re-provision): demo.ana (Ana Souza), demo.bruno (Bruno Lima). WebDAV as demo.ana → 207 OK.
- BLOCKER learned: NC33 Provisioning API user create/delete needs session password-confirm → app-password 403. So seed is DATA-ONLY (WebDAV); users provisioned out-of-band via occ.

## Approved per-app task lists (v1)
Drive: 1 enviar 2 criar pastas 3 compartilhar link 4 compartilhar c/ pessoas 5 editar OnlyOffice[infra] 6 baixar 7 lixeira 8 versões 9 buscar/favoritar 10(opt) solicitar arquivos.
Talk: 1 iniciar reunião 2 convidar/link 3 entrar[2ctx] 4 câmera/mic 5 compartilhar tela[2ctx] 6 chat 7 moderar[2ctx] 8 agendar 9 reações 10(opt) gravar[infra].
Proof pages first: Drive#1(share) + Talk#1(iniciar).

Task 6: complete (commits b549798e573..d57e973e427; seed 84b5bffd2c7 + PDF/config fix; review Approved after fix)
  - Data-only WebDAV reset of demo.ana/relatorio.pdf, idempotent (twice identical, 207). Valid xref PDF. loadConfig() named helper. 15/15 tests.
  - Users are FIXTURES (occ-provisioned), seed never touches accounts.

Plan Task 7 SPLIT by controller:
  - 7a = page-writer.ts + test, AND fix steps.ts to YAML-quote/escape title+description (the deferred Task-4 concern). TDD, no staging.
  - 7b = browser.ts (launch fake-media + demo.ana login helper) + encode.ts (ffmpeg) + run.ts (Flow contract). Integration; proven E2E by Task 8 Drive flow. (resetTenant already wired in Task 6 — remove that step from plan Task 7.)
Task 7a: complete (commits d57e973e427..6e7b2ee6e3c; page-writer+YAML 3fb44be31b0 + scan-fix 6e7b2ee6e3c; review Approved). 21/21 tests.
  - YAML-safe frontmatter (yamlString escapes \ then "). page-writer throws+no-write on hygiene hit (contentRoot param). CRITICAL scan self-block fixed: nc-version now requires NC context word → capturedForVersion passes, labeled leaks still caught, dates pass.
  - MINOR carry (final sweep): scan.ts nc-version intentionally lets a bare unlabeled version pass (spec tradeoff — bare NN.N.N would block our own frontmatter); yamlString doesn't escape literal newlines (titles are single-line).
Task 7b: browser.ts (launch fake-media + login helper) + encode.ts + run.ts (Flow contract) — in progress.
  Flow contract decided: Flow={capturedForVersion, fakeMedia?, fakeVideo?, run(browser,framesDir)=>TaskDoc}; launch(opts)=>Browser; login(browser,uid,pw)=>{context,page}. run.ts: resetTenant→launch→flow.run→encodeFrames(src/assets/<app>/<media>)→writeTaskPage(...,'src/content/docs'). Proven E2E by Task 8.
Task 7b: complete (commit eb3af60e0d1; browser/login+encode+run; review Approved). 25/25, tsc clean, LIVE login smoke OK (demo.ana→dashboard, Files loaded, relatorio.pdf visible). frame glob = frame-%04d.png. ffmpeg has -y.
  - MINOR carry: dynamic import in run.ts not compile-checked (malformed flow fails at runtime); -y flag untested.
  - HYGIENE NOTE for capture flows: Playwright shoots page viewport (no address bar) so URL bar never leaks; BUT share-link panels show real host in the link text — P0 has no frame OCR, so flows MUST rewrite any visible real host to cosmetic conecta.demo before screenshotting.
Task 8: complete (commits eb3af60e0d1..e0412f6c2fb; flow 7c8cf5a5c0b + text-sync e0412f6c2fb; review Approved). PIPELINE PROVEN E2E.
  - Real share-by-link capture of relatorio.pdf (4 frames), mp4 served 200, build green, NO host leak (share link is clipboard-only in NC UI; maskRealHost wired defensively anyway).
  - PIPELINE FIX (cross-file, disclosed): media moved src/assets → public/assets/<app>/<media>, video src=/assets/<app>/<media> (Astro serves public/ at root). Touched run.ts + steps.ts. All future flows use this.
  - Step text tightened to match code actions (removed permission-toggle claim step4, tab-name claim step2).
  - Selectors that worked: row by getByText relatorio.pdf; "Opções de compartilhamento"/"Criar link público"; copied toast "Link copiado". Frame names frame-000N.png.
Task 9: SALVAGED + committed deac24f5dca (review in progress). Talk iniciar-reuniao two-context capture.
  - Controller killed the agent mid-post-run-verification (misread a 204-byte unflushed transcript as a hang); work was actually GREEN — salvaged uncommitted files, verified: build green, extracted mp4 frame shows real 2-tile call (Reunião Conecta Demo, 2 participants, Bruno joined, synthetic camera), talk text clean. Committed manually.
  - LESSON: subagent .output transcript file is NOT flushed live — do NOT judge liveness by its size/mtime. Check working-tree file timestamps + ListAgents instead before killing.
  - COSMETIC follow-up: fake camera = garish testsrc color bars; swap for a calmer synthetic/still for polish. y4m is 3.4MB in git (acceptable).
Task 9: complete (commit deac24f5dca; review Approved, minors only). P0 PROOF DONE — Drive + Talk two-context both captured E2E.
Next: Task 10 (capture:all runner + pagefind check), Task 11 (Docker image), Task 12 (README). Then P1 content (8-10 tasks/app) + P2. Pre-merge whole-branch review still pending.
Task 10: complete (commits deac24f5dca..fc9d4cd60ae; run-all b73817e153c + path-fix fc9d4cd60ae; review found+fixed CRITICAL). 29/29.
  - CRITICAL fixed: run-all passed `capture/flows/<f>` but run.ts resolves arg relative to capture/ → doubled path, every flow failed. Now emits `./flows/<f>` (proven form). Resolution check both flows -> true. (Slipped because Task 10 intentionally skipped a live capture:all run.)
  - Pagefind pt-BR confirmed (compartilhar in drive fragments, reuni in talk fragments); hygiene scan clean.
Task 11: complete (commit aca58a02786; Docker image + Portainer stack; review Approved, no issues). Image builds w/ scan+build gate, NO .env in image (literal capture/.env in .dockerignore, verified), home/drive/mp4 200 in-container. NOT pushed.
Task 12: complete (commit e8b2719d52b; capture/README.md). Accurate to real harness, no secret values, correct working commands.
  - USABILITY carry (final sweep): package.json `capture`/`capture:all` npm scripts DON'T load env → bare `npm run capture` fails; working form is `node --env-file=capture/.env --import tsx capture/run(-all).ts ...` (README documents this). Fix = bake `--env-file=capture/.env` into the npm scripts.

## P0 COMPLETE — all 12 tasks done + reviewed. Branch tip e8b2719d52b.
Deliverables: Starlight pt-BR site (home A + Drive/Talk pages B), capture harness (steps emitter, hygiene scan, seed, browser/login, encode, run + run-all), 2 proven capture pages (Drive share + Talk two-context), self-hosted nginx image + Portainer stack, README.
Next: final whole-branch review, then decide merge P0 vs continue P1 content (8-10 tasks/app Core 4).

### Minor carry-forward list for final review:
- scan.ts nc-version lets bare unlabeled version pass (intended tradeoff); yamlString no newline escape (titles single-line).
- run.ts dynamic import not compile-checked; encode.ts -y flag untested; scan CLI guard not symlink-safe.
- steps.ts:19 `sidebar:` template literal cosmetic; TaskDoc app/slug typed as plain string.
- talk flow: manual polling loop + glyph-match toast dismiss + TreeWalker style (carried from drive flow).
- npm scripts don't load env (above). y4m 3.4MB in git. fake camera = garish testsrc (cosmetic).
- docs-site/README.md still stock Starlight starter text; plan doc Task 2 CSS lacks dark overrides.
