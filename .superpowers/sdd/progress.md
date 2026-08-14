# Deck board tags — SDD progress ledger

Plan: docs/superpowers/plans/2026-07-27-deck-board-tags-filters.md
Fork: github.com/avuz-conecta/deck branch `avuz` (private)
Local clone: ~/work/avuz/deck-fork

## Harness (built once, reused by every DB task)
- Image: avuzconecta:latest (arm64, local build, PUSH=false)
- Containers on net `deck-test-net`: deck-test-db (postgres:16, deck/deck/deck), deck-test-redis (redis:7-alpine), deck-test-nc (running instance, port 8099)
- Wrappers: ~/deck-test.sh (PHPUnit, bind-mounts avuz-server tests/), ~/deck-occ.sh (occ)
- PHPUnit baseline @ Task 1: 378 tests, 6 failures (pre-existing NotifierTest pt_BR locale artifacts), 0 errors. Later tasks: failures must stay 6 + only-passing new tests.
- Known harness quirks: nextcloud/ocp removed from vendor/ (stub shadows core); tests/ stripped from image by .dockerignore, bind-mounted from checkout; jest broken out-of-box (missing vue-jest/babel-jest devDeps — Task 9 fixes).

## Tasks
Task 1: complete (commit 3bb74c08a on fork, review self-verified infra: js/ committed, composer reverted, pushed, baseline recorded)
Task 2: complete (commit 4f25aebdc on fork, review Approved; BoardServiceTest 20/20, full suite 379/6 no new failures)
  - MINOR (for final sweep): tests/unit/Service/BoardServiceTest.php:108-113 comment misdescribes the mock — the "else []" findAll branch is dead code (boardMapper->find is arg-agnostic, returns board id 1 both times). Harmless, cosmetic.
Task 3: complete (commit 145d24b34 on fork, controller-verified: migration class Version11701Date20260727120000, table oc_deck_board_assigned_labels live in harness Postgres with both named indexes, version=1.17.1). Full-suite baseline re-confirmed 379/6 after harness app changes.
  - NOTE (harness, not prod): migrations:migrate absent in this NC build; agent used `occ upgrade`, which tripped on 4 bundled apps (bruteforcesettings, files_downloadlimit, notifications, text) with stale max-version caps and left them DISABLED in the harness. Does NOT affect deck suite (baseline stable) and does NOT reflect production — prod applies the migration via targeted `app:disable deck && app:enable --force deck` in avuz_reconcile_app_versions, never a global occ upgrade. Validate the real path at Task 15.
  - NOTE (plan fix): plan Step 3 xsd whole-file validation was bogus (upstream info.xml has a pre-existing repair-steps ordering issue → false regardless of version); replaced with a semver-only regex check. 1.17.1 is valid.
Task 4: complete (commit e75b5f998 on fork, review Approved; BoardLabelMapperTest 5/5, LabelServiceTest 6/6, full suite 384/6 no new failures). Cascade verified: BoardMapper::delete iterates labelMapper->delete → deleteByLabel, so board deletion cleans attachments transitively.
  - MINOR (final sweep): setForBoard delete-then-insert not transactional (wrap at service layer if atomicity matters); deleteByBoard has no prod caller yet (later board-delete path may wire it); BoardLabelMapperTest uses bare int label_ids w/o deck_labels rows (valid — no FK by design — but add a one-line comment).
Task 5: complete (amended commit b2b15af6e on fork, review Approved after fix; BoardSummaryMapperTest 4/4, full suite 388/6 no new). FIX during task: dueMonth was catch-all (=3), corrected to forward-looking >= now (=2) per spec — overdue counts only in overdue. Plan+brief fixture corrected too. SUM(CASE) worked on Postgres, no COUNT fallback.
  - MINOR (final sweep): findDueCounts has no negative-case test for done/archived/deleted exclusion (WHERE is byte-identical to findDerivedTags which IS tested); findDirectTags untested (exercised later by Task 7 service test + Task 15 e2e); live-card 4-condition clause duplicated across two methods (kept deliberately for audit).
Task 6: complete (commit 0328ef565 on fork, review Approved; BoardTagServiceTest 5/5, full suite 393/6 no new). key()=mb_strtolower(trim()) shared by index+normalize; lowest-id via strict <; permission-before-mutation; FALLBACK_COLOR only (no color inheritance — correct scope).
  - MINOR (final sweep): getTags has no dedicated test (real logic: permission + in_array strict filter — safe today since Task 4 casts label_id to int); collision test covers only [12,4] order not [4,12]; blank/whitespace titles silently dropped (undocumented).
Task 7: complete (commit 0c5e319a1 on fork, review Approved; BoardSummaryServiceTest 4/4, full suite 397/6 no new). directTags (direct-only, for tiles) vs tags (direct∪derived, for filter) distinction tested; dedup direct-first via ??=; EMPTY_COUNTS shared const; injected ITimeFactory.
  - MINOR (final sweep): testNoVisibleBoardsReturnsEmptyList doesn't assert mapper never() called; no test with populated findDueCounts (only fallback branch exercised).
Task 8: complete (commits fe20b514a + b5e45509f on fork, review Approved; BoardTagControllerTest 3/3, full suite 400/6 no new). 3 routes board_tag#summary|read|update (no collision), NoAdminRequired on all, thin passthrough verified against real service sigs. NOTE: git-tracked test dir is lowercase tests/unit/controller/ (matches upstream; macOS FS masked it).
  - MINOR (final sweep): summary/read tests use method() not expects(once()); no edge-case tests (fine for thin controller).

=== BACKEND COMPLETE (Tasks 3-8). Full suite 400 tests / 6 pre-existing failures. ===

## Frontend batch (Tasks 9-13) execution adaptation
Vue components (Tasks 10-12) can't be unit-tested in the DB harness. Subagents do: npm run build (compile-checks Vue/JS/imports) + lint/stylelint + commit. The plan's per-task "verify in browser" steps are DEFERRED to ONE consolidated browser pass the controller runs after Task 13, on a fork-mounted instance (built js + lib, sentinel bypassed) — controller has browser tools and can judge UI + drive the 6 checks competently, better than each subagent spinning a flaky browser. Task 9 (jest predicate) IS fully testable now.
Task 9: complete (commit 9c13b9181 on fork, review Approved; jest 10/10 — repo's FIRST jest test). Fixed real jest breakage: transform path node_modules/vue-jest → @vue/vue2-jest + babel-jest devDep (committed). Shared key()=trim().toLowerCase(); no-filter-before-missing-summary ordering correct. VERIFIED cross-file: DUE_FILTERS values == backend due keys exactly (no silent date-filter break).
  - MINOR (final sweep): boardFilters.js exports lack JSDoc (2 lint warnings, consistent w/ existing store files); DUE_FILTERS.NONE untested.
Task 10: complete (commit e993c2fe5 on fork, review Approved zero findings; build clean, lint clean, store additions-only 38+/0-). BoardTagApi mirrors BoardApi; boardsFilteredByTags composes on filteredBoards (not replacing); setBoardSummaries keys array→by boardId (matches Task 8 contract). NOTE for Task 11: setBoardTagFilter/setBoardDueFilter are MUTATIONS (use commit/mapMutations, not dispatch).
Task 11: complete (amended commit 36f0c9ff4 on fork, review found 1 Important bug, FIXED; build+lint+stylelint clean). Filter bar: tag NcSelect + 5 due chips (aria-pressed) + clear + aria-live count; URL sync repeated ?tag= params; this.t in script; mutation-commits. FIX: added '$route.query' watcher — vue-router reuses Boards instance across /board /board/archived /board/shared, created() fires once, so tab-switch left stale filters. readFiltersFromRoute syncs local+store, no route-write (no loop).
  - MINOR (final sweep): Boards.vue:191 inlines 2 commits in template (prefer clearFilters method); empty-state message identical for zero-boards vs zero-matches.
Task 12: complete (commit b3c9ac78a on fork, review Approved; build+lint+stylelint clean). Tiles render directTags ONLY (3+overflow hover+focus, no color); sidebar "Tags do quadro" taggable NcSelect, canManage-gated, setBoardTags dispatched as ACTION, init from directTags w/ load-if-empty. Added missing `board` prop to TagsTabSidebar (parent BoardSidebar:26 already passed it).
  - MINOR (final sweep): board prop uses default {} (prefer required:true to fail loud); Task 13 must cover strings "Tags do quadro"+hint+placeholder+aria-label.

=== ALL FRONTEND CODE COMPLETE (Tasks 9-12). Remaining: 13 l10n, consolidated browser pass, 14 ship, 15 staging. ===
Task 13: complete (NO commit — verification only). Decision (user): keep Portuguese msgids, render via NC msgid-fallback; correct for pt_BR-only deployment. No l10n/ files touched (pt_BR.js is Transifex-generated; identity entries would be wrong). Verified all 12 added user-facing strings are Portuguese (no accidental English msgid). Browser rendering confirmed in consolidated pass.

## CONSOLIDATED BROWSER PASS — STRONG PASS (controller-run on avuzconecta:latest, fork overlaid, pt_BR instance :8099)
Backend (live HTTP on Postgres): PUT /boards/{id}/tags → 200 stored titles; GET round-trips; GET /avuz/board-summary → correct {boardId,tags,directTags,due}; label auto-creation w/ FALLBACK_COLOR confirmed (Cliente X/Urgente appear as green labels).
Frontend UI:
  ✓ Boards overview filter bar renders: tag NcSelect + 5 due chips (Vencidas/Próximas 24 horas/Próximos 7 dias/Próximos 30 dias/Sem prazo) + aria-live count.
  ✓ Portuguese strings render via msgid-fallback (all correct, no raw keys/English).
  ✓ Tile chips show directTags ONLY: Cliente Alpha shows Cliente X+Urgente; welcome board shows none (default labels are derived, hidden). CONFIRMS directTags-vs-tags distinction live.
  ✓ Due filter correct: dueMonth→0 boards (no future cards), noDue→1 board (welcome, noDue=5). Count pluralizes (1 quadro/2 quadros).
  ✓ Tag filter: ?tag=Cliente X → Cliente Alpha only. OR-match works.
  ✓ URL sync bidirectional + encoded (Cliente%20X) + $route.query watcher responds to route change (the review-caught tab-switch bug fix, verified live).
  ✓ Empty state "Nenhum quadro com esses filtros" + Limpar filtros button.
  ✓ Sidebar "Tags do quadro": heading+hint+taggable NcSelect w/ current tags, ABOVE intact label editor, canManage-gated (owner sees it).
Read-only-hides-tagging: unit-verified (backend PERMISSION_MANAGE + UI canManage guard), not browser-tested (avoids 2nd-user setup).
Task 14: complete (fork commit 63ef1cfe4 pushed; server-repo commit 43a7e814b6a). Fork: golden production vendor/ (144 files, force-committed — deck autoload.php hard-requires it) + rebuilt js/ + AVUZ-BOARD-TAGS-V1 sentinel. Server repo: apps/deck now a submodule (branch avuz, pinned 63ef1cfe4); docker/overlays/deck deleted; Dockerfile cp line removed; entrypoint reapply_avuz_deck_overlay removed + AVUZ-BOARD-TAGS-V1 sentinel row added (clone-order row now says "fork" not "overlay"); CLAUDE.md deck moved to submodule line. Consistency verified: no dangling overlay refs, entrypoint bash -n OK. RESOLVED: deck composer.json has no autoload section → OCA\Deck classes load via NC convention autoloader (lib/), not vendor; new classes need no autoloader regen (browser pass proved it).

=== ALL CODE + SHIP COMPLETE (Tasks 1-14). Remaining: Task 15 staging build+deploy+verify (gated on user per checkpoint). ===

## FINAL WHOLE-BRANCH REVIEW (opus) — verdict SHIP. All 6 cross-layer contracts ✓. 2 Minor findings (both in Boards.vue, both pre-noted in Task 11 ledger) FIXED:
  1. Empty-state "Limpar filtros" bypassed route+bar → stale state. Fixed: clearFilters() now does $router.replace({query:{}}), bar's watcher re-syncs local+store (same path as bar's own clear).
  2. Empty-state showed for zero-board new users (misleading). Fixed: gated on hasActiveFilter.
  Fork fix commit ff1102e67 (pushed); submodule pointer bumped in server commit 85553307c82. Lint+build clean. Same $router path already browser-proven.

## Task 15 staging — IN PROGRESS
- Build: build-push.sh latest staging running from WORKTREE (has submodule+Task14). amd64 emulated. → avuzconecta:staging pushed to registry.avuz.app.
- Deploy creds: deploy.env absent in worktree but PRESENT in main checkout (/Users/patrickrezende/work/avuz/avuz-server/scripts/deploy.env) → use PORTAINER_ENV_FILE=<main>/scripts/deploy.env for deploy.sh + portainer-exec.sh.
- OPEN: staging stack name + image-ref (template portainer-stack.yml says avuz-conecta:latest [hyphen] but build-push produces avuzconecta:staging [no hyphen] — resolve via deploy.sh --list before deploying).
- .dockerignore strips only tests/ (not vendor/apps/js) → deck submodule ships intact. Verified.

## INCIDENT (staging stack 8 down ~15min) + RECOVERY
Root cause: built staging image from the WORKTREE, which had apps/deck (submodule) but was MISSING 3rdparty/ (Composer autoloader submodule), apps/integration_openai, AND the ~20 rsync'd bundled apps. Image shipped without 3rdparty/autoload.php → occ "Composer autoloader not found" → boot crash-loop. The :staging tag was overwritten (no rollback tag). Stack 46 unaffected (pinned to old digest 6091cf...).
Fix: git submodule update --init 3rdparty apps/integration_openai + rsync 17 bundled apps from main checkout → worktree complete. Rebuilding correct image → redeploy stack 8.
Plan updated: Task 15 Step 0 (make build source complete) + post-build image completeness verify.
LESSON: worktree is NOT a complete build source. Init all submodules + rsync bundled apps first, OR build from main checkout with the branch checked out.

## Task 15 staging — COMPLETE (after incident recovery)
Corrected image (54 apps, 3rdparty+deck autoloaders, deck 1.17.1, sentinel) rebuilt + pushed + redeployed to stack 8 (avuz-conecta). Verified on staging:
  ✓ Boots clean, verify_avuz_patches "Avuz patches present" (sentinel gate passed).
  ✓ occ app:getpath deck = /var/www/html/apps/deck — NOT shadowed (no deck in custom_apps).
  ✓ Migration applied, installed_version 1.17.1, table oc_deck_board_assigned_labels EXISTS.
  ✓ PERF (design's one unknown, RETIRED): due-counts aggregate over 35 live boards / 131 cards = 8.3 ms. No cache needed.
  ✓ Same code fully browser-verified locally.
  NOT done (needs staging user creds I don't have): authenticated HTTP e2e on app3.avuz.app; endpoint routing proven via routes.php + local browser pass instead.

## FINDING (deploy note + follow-up): deck migration did NOT auto-apply on deploy.
avuz_reconcile_app_versions (entrypoint:862) ran but did NOT bump deck (no boot-time "Reconciling deck" line); installed stayed 1.17.0 until MANUAL `occ app:disable deck && occ app:enable --force deck` (which worked → 1.17.1 + table). Not custom_apps shadowing (only one deck copy). Likely avuz_app_path/getpath timing at line 862 (runs before PHASE 4 app-enable). Mechanism works for other apps (forms precedent). DEPLOY RULE: after deploying this feature, verify installed_version=1.17.1 + table exists; if not, run the manual reconcile. Prod will likely need it too.

## ENHANCEMENTS PHASE (plan 2026-07-27-deck-board-tags-enhancements.md, base ff1102e6)
Task 1: directTags carries color (backend). Task 2: matching-cards endpoint. Task 3: FE colored chips + one-row bar. Task 4: FE expandable glimpse.
Enh Task 1: complete (commit a0716561e, review Approved zero findings). directTags now {title,color}[] w/ Postgres color round-trip test; tags stays title-only; derived untouched. Full suite 401/6. NOTE: fork vendor is production (Task 14) → no phpunit; agent reinstalled dev deps in the harness container (persists for later tasks).
Enh Task 2: complete (commit 446bcf066, review Approved). MatchingCardMapper live-card+buckets byte-identical to findDueCounts; conditional tag join; intersection (tag AND date) tested; PERMISSION_READ before query; route board_tag#matchingCards. Full suite 406/6.
  - MINOR (final sweep): deleted_at legs (soft-deleted stack/card) not independently tested (covered by code-identity); applyDue fails-open on unknown bucket.
Enh Task 3: complete (commit a750f7143, review Approved zero findings). Tile chips colored via Color mixin (textColor contrast); all directTags uses read objects; overflow chip neutral; filter bar one-row (flex 0 1 320px). Build+lint+stylelint clean.
Enh Task 4: complete (amended commit 38efc51e1, review Approved w/ 1 Important fixed). Expandable glimpse: chevron gated on hasActiveFilter, @click.stop.prevent (chevron inside router-link), lazy-fetch-once, 3-state (list/direct-note/loading), moment format('L'). FIX: added watch on both filter refs → refetchIfExpanded (self-heal stuck-loading on filter change); removed dead clearMatchingCards. Build+lint clean.

=== ALL 4 ENHANCEMENT TASKS COMPLETE. Next: consolidated browser verify + ship. ===

## ENHANCEMENTS CONSOLIDATED BROWSER PASS — STRONG PASS (local avuzconecta:latest, fork overlaid)
  ✓ #1 tile chips colored: Cliente X green (31CC7C), Urgente red (E9322D), contrast text via Color mixin. board-summary directTags carries {title,color}.
  ✓ #2 filter bar one row: tag NcSelect (capped) + 5 due chips + count on a single row.
  ✓ #3 glimpse: Vencidas filter → chevron on matching board → expand → "Enviar proposta · A Fazer · 01/07/2026" (title, list, formatted due). Lazy-fetch + 3-state (loading/list/direct-note) work.
  NOTE (deploy): matching-cards route 404'd until Redis FLUSHALL — NC caches compiled routes in Redis; hot-overlaying a new route needs a flush. A clean image boot registers it fresh (no action needed on real deploy). Same class as the migration-reconcile finding.

## SHIP enhancements
Fork pushed 8d338390c (all 4 enh tasks + rebuilt bundle); server submodule bumped to it (commit 14c85570492). Sentinels + MatchingCardMapper + built js verified at pointer.
=== ENHANCEMENTS COMPLETE + SHIPPED to fork + submodule. Staging redeploy = next step (not auto-done; base feature already on stack 8). ===

## BUGFIX: glimpse tag-only filter showed all cards
Root cause: BoardTagApi.loadMatchingCards sent `?tag=X` (name `tag`, and PHP parses repeated `tag=a&tag=b` as scalar), but controller expects `array $tags` → NC never populated it → $tags=[] → no tag filter → all cards. Confirmed empirically: ?tag=Cliente X returned both cards; ?tags[]=Cliente X returned only the tagged one. Fix: `params.append('tags[]', t)`. Regression test src/services/BoardTagApi.spec.js (asserts tags%5B%5D in URL). Browser-verified: tag-only filter → glimpse shows only "Enviar proposta", not "Sem tag". Fork b3ed8ecea, submodule bumped (server 5672354472b). Rebuilding+redeploying staging.
### PATH STANDARD (fix for CF Task 2 stale-brief mix-up): all CF briefs/reports live in DECK-FORK sdd dir
- Canonical dir for CF briefs/reports/review-diffs: `/Users/patrickrezende/work/avuz/deck-fork/.superpowers/sdd/` (where review-package writes).
- task-brief default OUTFILE depends on cwd's git root → was inconsistent (task-1 landed in avuz-server worktree, task-2 in deck-fork). FIX: always pass explicit OUTFILE under deck-fork sdd dir, and point implementers/reviewers at the deck-fork path.
- Purged the stale board-tags task-2..12 briefs/reports that were sitting in the avuz-server worktree sdd dir (they caused CF Task 2's first dispatch to read the wrong "matching-cards" brief). Ledger (progress.md) + task-1 brief/report remain there.
CF Task 2: complete (commit 0f988449e; review Spec ✅ + Quality Approved, zero findings). CustomFieldMapper mirrors LabelMapper; array_key_exists lastModified fix verified correct + test-proven. Full suite 412/6.
  - Implementer FIXED a brief bug: `in_array('lastModified', getUpdatedFields())` is loose-comparison (values are true → always matches) → changed to `array_key_exists`. Correct fix, test proves stamping.
  - PRE-EXISTING BUG (final sweep / possible separate task): the fork's real LabelMapper.php:99 has the SAME loose-in_array guard → labels likely never stamp lastModified on insert (store 0). Not in CF scope; flag upstream later.
CF Task 3: complete (commit 8b11a5ede; review Spec ✅ + Quality Approved). Portable setValue (SELECT-then-insert/update/delete, no ON CONFLICT); null deletes. Test 3/3.
  - HARNESS QUIRK (future DB tasks 7,8): inline `/** @group DB */` silently fails "not allowed to access the database"; MUST use multi-line docblock form. Fixed here.
  - MINOR (final sweep): findRow catches DoesNotExistException only (not MultipleObjectsReturned — safe via unique index); null-value-no-existing-row branch untested (correct by inspection).
CF Task 4: complete (commit bc8cdce36; review Spec ✅ + Quality Approved). CustomFieldType 7-type enum + validateValue (date-only, checkbox strict, dropdown/multi option membership); validator field_type rule. Tests 10/10.
  - MINOR (final sweep): CustomFieldType multi branch uses is_array($decoded) — a JSON object {"0":"o1"} also decodes to array, could slip through; harden w/ array_is_list. FE never sends objects; low risk.
CF Task 5: complete (amended commit e14a8705d; review Spec ✅ + Quality Approved after fixes). All 4 security invariants hold (perm-before-effect, stable option-id mint, cross-board reject, no update-path value purge). FIXES applied: setValue checkPermission before findBoardId; archived guards on delete+reorder; +2 security tests (cross-board reject, option-id reuse). Test 5/5.
CF Task 6: complete (amended commit 834aa2d84; review Spec ✅ + Quality Approved). Controller thin passthrough, 6 routes no collision, sentinel, setCardValue returns fresh values. Blank-line nit fixed+amended. Test 1/1.
CF Task 7: complete (commit fecea3f1b; review Spec ✅ + Quality Approved). Board.customFields + Card.customFieldValues; BoardService separate always-run enrichWithCustomFields (verified enrichWithLabels early-returns on 0 labels); P1 no-batch-enrich guard holds (CardService untouched); jsonSerialize ripple fixed (BoardTest+CardTest expected arrays, no masking). Full suite 432/6.
CF Task 8: complete (amended commit 64b265873; Spec-then-fixes; remap tested asserts new field id 200, cross-board guard skips value copy, clone tests green, full suite 436t/6f).
  - FLAG (future): cross-board single-card cloneCard carries original field ids (no cross-board field-clone primitive); matches task scope.
=== BACKEND COMPLETE (CF Tasks 1-8). Full suite 436 tests / 6 pre-existing failures. ===
  - FOLLOW-UP TICKET (spawn_task task_32707e0d): cross-board single-card clone needs cloneFieldIfNotExists primitive (mirror cloneLabelIfNotExists) to CARRY values across boards; currently safely SKIPS them.

## Frontend batch (CF Tasks 9-12) execution note
- Task 9 (CustomFieldApi.js) + Task 10 (store) are jest-testable. Tasks 11-12 (Vue components) can't unit-test in DB harness → build via `npm run build` + lint + commit; browser verification DEFERRED to ONE consolidated pass after Task 13 (controller-run, like prior project).
CF Task 9: complete (commit 6504b66fd; review Spec ✅ + Quality Approved). CustomFieldApi 6 methods all cross-checked vs Task 6 backend routes (reorder {fieldIds} + setValue {value} correct). jest 3/3.
  - MINOR (final sweep): spec asserts only create/setValue/getCardValues; reorder/update/delete untested (payloads verified-by-read, correct).
CF Task 10: complete (commit feb73bbc2; review Spec ✅ + Quality Approved). Store wiring, all action↔mutation↔api pairings verified, customFieldValues string correct in both card actions. jest 17/17, lint clean.
  - ENV NOTE (Task 11-12 specs): importing store/card.js unmocked pulls @nextcloud/axios ESM chain jest cant parse; mock CardApi/BoardApi to sidestep.

## CF Vue-component tasks (11-12) verification adaptation
- Vue components cant jest-unit-test in this repo (@nextcloud ESM chain unparseable + NcVue mount flaky) — proven in prior project. Tasks 11-12 verify via `npm run build` (compiles Vue/JS/imports/templates) + `npm run lint` + `npm run stylelint` + commit. UI behavior DEFERRED to ONE consolidated browser pass after Task 13 (controller-run).
CF Task 11: complete (commit 262d3f26c; review Spec ✅ + Quality Approved). Board-settings tab: 7-type picker, option editor dropdown/multi-only, required toggle, reorder, canManage gate, type NcSelect disabled on edit (UI immutability). t() deferred to this.t() (Vue-prototype-bound). build+lint+stylelint clean.
CF Task 12: complete (commit baa289c61 + fix 555b474f6; review Spec ✅ code/Quality Approved-otherwise). Per-type widgets encode/decode all 7 types matching backend validateValue (checkbox 0/1, multi JSON-array string, dropdown id, date YYYY-MM-DD, empty→null); soft-required badge skip checkbox; fetch-on-open. build+lint+stylelint clean.
  - CRITICAL FIX (555b474f6, cross-task bug caught by Task 12 review): CustomField had no jsonSerialize override → RelationalEntity emitted raw getOptions() JSON STRING, frontend .find/.filter crashed on dropdown/multi. Fixed: CustomField::jsonSerialize decodes options via getOptionsArray(). +2 tests. CustomFieldTest 5/5.
=== ALL FRONTEND CODE COMPLETE (CF Tasks 9-12). Remaining: Task 13 (version+build), consolidated browser pass, ship. ===
CF Task 13: complete (commit 15cd1ab27). Version 1.17.2; authoritative js/ bundle built+committed (grep-confirmed contains currentBoardCustomFields/CustomFieldsSection); PHP suite 438t/6f (baseline+2 new), jest 17/17; all UI strings Portuguese (no English msgid), l10n files untouched (msgid-fallback per prior project). vendor NOT staged.
  - MINOR (final review): "(removida)" label for a value referencing a REMOVED dropdown/multi option is not rendered by CustomFieldInput.vue — value is KEPT (backend no-purge verified Task 5), just shows blank/unlabeled, not "(removida)". No data loss. Spec cosmetic gap.
=== ALL 13 CF TASKS COMPLETE. Fork HEAD 15cd1ab27 (deck 1.17.2). Next: final whole-branch review → browser pass → ship. ===

## FINAL WHOLE-BRANCH REVIEW (opus) — verdict SHIP
All 6 cross-layer contracts ✅ (value round-trip all 7 types, options decode round-trip fully closed, route/payload align, permission gates precede effects, P1 no-batch-enrich confirmed via grep findForCards never called, clone remap old→new + cross-board guard). No Critical/Important. All 5 deferred Minors triaged DEFER-OK.
CONTROLLER FIXES post-review:
  1. (555b474f6) CustomField::jsonSerialize decodes options→array (caught by Task 12 review; dropdown/multi were crashing on raw string).
  2. (e2491c543) options-required for dropdown/multi enforced server-side (was UI-only; raw API could make unfillable field) + permission-before-validation ordering. Service test 6/6.
DEFER-OK (not shipped, tracked): findRow single-exception (unique index makes it dead code); multi is_array vs array_is_list (FE never sends objects); reorder/update/delete API spec untested (verified-by-read); "(removida)" label unrendered (value kept, cosmetic); cross-board single-card clone skips values (ticketed).

=== CF FEATURE CODE COMPLETE + REVIEWED SHIP. Fork ~/work/avuz/deck-fork branch avuz HEAD e2491c543, deck 1.17.2. NOT yet: pushed to fork remote, submodule bump in avuz-server, browser pass, build image, deploy (all gated on user). ===

---

# Deck BOARD FOLDERS (P6) — SDD progress ledger  [starts 2026-08-13]
Plan: docs/superpowers/plans/2026-08-13-deck-board-folders.md (11 tasks)
Spec: docs/superpowers/specs/2026-08-13-deck-board-folders-design.md
Fork: ~/work/avuz/deck-fork branch `avuz`. BASE before P6 Task 1 = 2230de301 (P1 fully pushed to avuz/avuz).
Same harness/env rules as P1 (see above): tests via ~/deck-test.sh (harness UP: deck-test-db/redis); @group DB = multi-line docblock; commit discipline (targeted git add, never vendor/js unless plan says); briefs/reports in deck-fork/.superpowers/sdd/; PHP files = <?php + blank + SPDX; lastModified stamp via array_key_exists.
## P6 Tasks
P6 Task 1: complete (commit aefc68ab0; review Spec ✅ + Quality Approved, zero issues). Folder entity + Version11703 (nullable parent_id + boards.folder_id, no FKs) + Board.folderId scalar. FolderTest 2/2.
  - HARNESS NOTE (P6): Task 1's migration 11703 wasn't applied to the shared harness DB volumes (Task 1 test was non-DB). Task 2 ran `occ upgrade` on the deck-test image/volumes → deck_folders + boards.folder_id now live in the harness. Durable for remaining P6 @group DB tasks.
P6 Task 2: complete (commit fb900a489; review Spec ✅ + Quality Approved). FolderMapper (maxOrder IS NULL correct, array_key_exists stamp) + BoardMapper.findInFolder. 10 tests/22 assertions.
P6 Task 3: complete (commit f6f37897b; controller self-verified — rules id-numeric + title constraints match spec, header+blank ok, scope clean). Test 2/2.
P6 Task 4: complete (commit ee6f55852; review Spec ✅ + Quality Approved). FolderService cycle-walk traced correct+terminating, delete-guard both branches, order-seed correct. Test 5/8.
  - BY DESIGN (not a gap): FolderService has NO PermissionService/ChangeHelper — folder create/rename/delete are open to any authenticated user per spec; the only permission (board MANAGE) is in BoardService::setFolder (Task 5). Controller uses #[NoAdminRequired] = auth gate. Don't re-flag in Task 5/6.
  - MINOR (final sweep): move() re-fetches find(parentId) after isDescendant already fetched it (harmless extra round-trip); no positive-path move/rename tests; count()>0 vs !empty style.
P6 Task 5: complete (commit 86da557ad; review Spec ✅ + Quality Approved). setFolder MANAGE-before-effect verified, FolderMapper mock pos #10 matches, null-root skips check. BoardServiceTest 28/131.
P6 Task 6: complete (commit 79e7c0f00; review Spec ✅ + Quality Approved, no deviations). FolderController + 6 routes + BoardController.setFolder + sentinel.
P6 Task 7: complete (commit 10837e400; review Spec ✅ + Quality Approved). FolderApi 6 methods, moveFolder /parent + body keys verified vs backend. jest 6/6.
P6 Task 8: complete (commit 83e481220; review Spec ✅ + Quality Approved). boardTree traced correct (empty folders survive, no dup, setBoardFolder syncs via addBoard). new spec 12/12, full jest 35/35.
  - NOTE for Task 10: folder-delete action is named removeFolder (not deleteFolder). UI must dispatch removeFolder.
P6 Task 9: complete (commit 9a018c23b; review Spec ✅ + Quality Approved). Recursive AppNavigationFolder (self-ref via name), keys present, archived/shared untouched, rootBoards rendered, loadFolders on mount. build+lint+stylelint clean.
  - MINOR (final sweep): new inline All-boards item lacks alphabetical sort + open-on-add-boards of AppNavigationBoardCategory.
P6 Task 10: complete (amended commit d2c08eb12; review Spec ✅ + Quality Approved after fix). Folder/board menu actions + recursive sort. FIX: added catch+showError to applyRename/createSubfolder/createRootFolder (were silent try/finally) + icon-add→FolderPlusOutline. build+lint+stylelint clean.
=== ALL P6 FEATURE CODE COMPLETE (Tasks 1-10). Remaining: Task 11 version+build, browser pass, ship. ===
P6 Task 11: complete (commit 4aaad8d6f after msgid fix; also cbebc8791 BoardTest folderId=>null fixture fix). Version 1.17.3, js/ bundle built (grep-confirmed AppNavigationFolder/boardTree). PHP 455t/6f (baseline), jest 36/36. FIX by controller: 'Folder name' English msgid → 'Nome da pasta' (3 placeholders) + rebuild + amend.
  - NOTE: Task 1 added Board.folderId but didn't update BoardTest jsonSerialize expected arrays → 4 failures surfaced only at Task 11 full-sweep (BoardTest not run in Tasks 1-2). Fixed cbebc8791. Lesson: entity prop adds need the serialization-test fixture updated.
=== ALL P6 CODE COMPLETE (Tasks 1-11). Fork avuz HEAD 4aaad8d6f, deck 1.17.3. Next: final whole-branch review → browser pass → ship (submodule bump + staging deploy). ===

## FINAL WHOLE-BRANCH REVIEW (opus) — verdict SHIP-AFTER-FIXES → FIXED → SHIP
All 6 cross-layer contracts ✅ (folder CRUD round-trip, board-placement MANAGE gate+UI parity, permission model incl delete-when-empty, cycle prevention + non-hanging tree getter, no-prune sorted tree, serialization). i18n confirmed clean (only 'Nome da pasta' etc.).
IMPORTANT bug FIXED (commit a725e7b04): BoardService::setFolder returned un-enriched board → store addBoard replaced enriched board → canManage/acl/labels stripped till reload. Fix = store-side surgical merge: setBoardFolder action commits new setBoardFolderId mutation (Vue.set folderId on existing board), never replaces. folders.store 15/15, full jest 38/38.
DEFER-OK minors: move re-fetches find(parentId); move missing-parent throws DoesNotExist not BadRequest; no positive-path move/rename test; buildBoardTree no cycle guard (proven non-hanging); folder-picker paddingLeft + submenu exclusivity (browser-pass, logic sound).
=== P6 CODE COMPLETE + REVIEWED SHIP. Fork avuz HEAD a725e7b04, deck 1.17.3. Next: submodule bump + staging build/deploy + browser pass. ===

## STAGING DEPLOY (P6) — 2026-08-14
Image built+pushed registry.avuz.app/admin/avuzconecta:staging (digest e0d161cc). Deploy avuz-conecta stack via Portainer.
- Deploy #1 curl(56) timeout (VPN); #2 OK "redeployed".
- Container crash-looped: "Fail to create file sequence directory" (Snowflake FileSequence:52) = HOST DISK 100% (96G/92G used/0 free). NOT P6. New image pull tipped an already-near-full host (70 imgs/120 vols/78G layers).
- Fix: Portainer images/prune dangling → 70→59 imgs, freed 16G (→83%/15.8G free); restarted container → healthy.
- VERIFIED: deck installed_version=1.17.3; oc_deck_folders table OK; oc_deck_boards.folder_id OK (pgsql). Container healthy, 200s.
- TODO: proper host cleanup pass (unused images -a + orphan volumes audit) — host chronically near-full. Cloudflare JS purge (on Patrick) after browser pass.

## P6 UX PASS (staging, Chrome-driven) — 2026-08-14 — ALL GREEN
Verified live at conectahml.avuz.app (CF purged, new JS active):
1. Create root folder (QA Espaço) ✓ persist
2. Create nested subfolder (Orçamento) ✓ indented
3. Rename folder (→ Orçamentos Raíven) ✓ PUT /folders/1 200
4. Move board into 3-level nest (Administrativo→Orçamento) ✓
5. Folder-picker indentation (Orçamento indented under parent) ✓ [flagged detail #1 OK]
6. ENRICHMENT FIX (a725e7b04): moved board kept full MANAGE menu (Editar/Clonar/Exportar/Mover/Excluir) ✓ — not stripped
7. Move board→Raiz ✓ PUT /boards/61/folder 200, re-rendered at root
8. Delete-non-empty BLOCKED ✓ DELETE /folders/2 400, folder survived
9. Delete-empty SUCCESS ✓ DELETE /folders/2 200, removed
Cleanup: both test folders deleted, sidebar restored flat. Board list intact.
Host disk: prune -a freed +7G (50 imgs). Now 53%/42.7G free (was 0). Healthy.
=== P6 SHIPPED + VERIFIED LIVE ON STAGING. ===
