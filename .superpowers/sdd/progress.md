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
