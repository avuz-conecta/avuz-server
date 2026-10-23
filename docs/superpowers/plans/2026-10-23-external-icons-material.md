# External sites icons: Material Symbols Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the 34 External sites library icons from Lucide to Material Symbols Rounded 200 and upgrade untouched copies on existing instances at boot.

**Architecture:** A shared Python module downloads pinned glyphs for both generators. The external generator records the hash of every file it replaces in `superseded.json`. The boot seed gains an upgrade step that replaces store pairs whose files are all ours (superseded or current), gated on the hash of `superseded.json`.

**Tech Stack:** Python 3 stdlib, PHP 8 CLI (Nextcloud OCP: IAppData, IAppConfig), bash tests with PHP fakes.

**Spec:** `docs/superpowers/specs/2026-10-23-external-icons-material-design.md`

## Global Constraints

- Package `@material-symbols/svg-200@0.48.1`, style `rounded`, via `https://cdn.jsdelivr.net/npm/`.
- Light file `fill="currentColor"`, dark file `fill="#000000"`, viewBox `0 -960 960 960`, width/height 24.
- File names stay the 34 names in `ICONS` today. No renames, no additions.
- App config keys: `avuz_theme/external_icons_seeded` (unchanged), `avuz_theme/external_icons_library` (new, SHA-256 hex of `superseded.json`).
- Seed outcome lines: `seeded <n>, upgraded <m>, kept <k>` | `unchanged` | `skipped: <reason>` | `failed: <reason>`.
- Never overwrite a file that is not ours. Never create a file that is missing from the store.
- Prod is gated: no prod build, deploy or exec without Patrick's word for that action.

## Review Focus

1. `superseded.json` missing or not valid JSON in the image: the seed must print `failed: invalid superseded.json`, exit 1, write nothing and record nothing (Task 3 test).
2. A store with only `<name>-dark.svg` (admin deleted the light one): upgrade the dark file if ours, don't create the light one (Task 3 test).
3. A network failure halfway through a generator run must not leave a half-swapped library: download every glyph before writing any file (Task 2 step).
4. Re-running the generator with no glyph change must leave `superseded.json` byte-identical, or every instance re-runs the upgrade (Task 2 check).
5. An admin file with a library name but non-SVG content (e.g. PNG bytes in `globe.svg`): kept, counted in `kept` (covered by the "edited" tests).

---

### Task 1: Shared Material Symbols module

**Files:**
- Create: `scripts/material_symbols.py`
- Modify: `scripts/generate-rail-icons.py`

**Interfaces:**
- Produces: `PACKAGE`, `VERSION`, `STYLE`, `VIEW_BOX`, `LIGHT_FILL`, `DARK_FILL`; `download(path: str) -> str`; `glyph_path(file_name: str) -> str` (raises `ValueError` unless single path); `render_svg(path_data: str, fill: str) -> str`.
- Importing: each generator does `sys.path.insert(0, str(Path(__file__).resolve().parent))` before `import material_symbols` (`-I` drops the script folder).

- [ ] **Step 1:** Move the constants and the three functions out of `generate-rail-icons.py` into `material_symbols.py` unchanged; the rail generator imports them.
- [ ] **Step 2:** Run `python3 -I scripts/generate-rail-icons.py`, then `git status --short`. Expected: only the two script files changed; every generated file byte-identical.
- [ ] **Step 3:** Commit `refactor(scripts): share the Material Symbols download between icon generators`.

### Task 2: External library on Material + superseded hashes

**Files:**
- Modify: `scripts/generate-external-icons.py` (rewrite)
- Regenerate: `apps/avuz_theme/img/external-icons/*.svg`, `LICENSE`
- Create: `apps/avuz_theme/img/external-icons/superseded.json`
- Delete: `apps/avuz_theme/js/lucide.js`
- Modify: `REUSE.toml` (library annotation → `Apache-2.0`, "Google LLC"; drop `lucide.js`)

**Interfaces:**
- Consumes: Task 1 module.
- Produces: `superseded.json` = `{"<file>.svg": ["<sha256 hex>", ...]}`, keys sorted, lists sorted and unique, `json.dumps(..., indent=2, sort_keys=True) + "\n"`. Read by Task 3.

- [ ] **Step 1:** `GLYPH_BY_ICON: dict[str, str]` holds the 34 pairs from the spec table.
- [ ] **Step 2:** `main()` downloads all 34 glyphs first, then for each output file: if the file exists and its bytes differ from the new render, add the old SHA-256 to `superseded[file]`; then write. Write `superseded.json` and `LICENSE` (header: package, version, style, generator; then the package `LICENSE`) last.
- [ ] **Step 3:** Run the generator. Check: `superseded.json` has 68 keys, each with exactly the SHA-256 of `git show HEAD:apps/avuz_theme/img/external-icons/<file>`.
- [ ] **Step 4:** Run it again. Check: `git status --short` shows no change against Step 3 (idempotent, Review Focus 4).
- [ ] **Step 5:** `git grep -n lucide.js` shows only docs to fix in Task 4; delete `lucide.js`.
- [ ] **Step 6:** Commit `feat(external): Material Symbols icon library, record superseded Lucide hashes`.

### Task 3: Seed upgrade step

**Files:**
- Modify: `docker/seed-external-icons.php`
- Test: `docker/tests/seed-external-icons.test.sh`

**Interfaces:**
- Consumes: `superseded.json` (Task 2) at `AVUZ_LIBRARY_DIR . '/superseded.json'`.
- Produces: constant `AVUZ_LIBRARY_KEY = 'external_icons_library'`; `avuzSupersededHashes(string $libraryDir): array<string, list<string>>` (throws on missing/invalid); `avuzUpgradePair(ISimpleFolder $folder, string $libraryDir, string $name, array $superseded): 'upgraded'|'kept'|'current'`.

- [ ] **Step 1: Extend the fakes.** `FakeFolder::getFile(string $name)` returns a `FakeFile` with `getContent(): string` and `putContent(string $data): void` (throws when `state.throw`), throws `NotFoundException` when missing. `reset_instance` writes `$LIBRARY/superseded.json`; helper `supersede <file> <content>` adds `sha256(content)` for that file. Existing `seeded N` assertions become `seeded N, upgraded 0, kept 0`.
- [ ] **Step 2: Write failing tests** (one `assert_eq` each, under `# ── upgrade ──`):
  - store `globe.svg`/`globe-dark.svg` = old content listed in `superseded.json`, record has both names → `"seeded 0, upgraded 1, kept 0"`, both files equal library content.
  - admin-edited light file (`admin globe`) → `kept 1`; light keeps `admin globe`; dark keeps old content.
  - admin-edited dark file → `kept 1`; both files unchanged.
  - pair deleted → no file created; `upgraded 0`.
  - only old `globe-dark.svg` present → upgraded, `globe.svg` still absent.
  - second run → `unchanged`; FakeFolder records no `getFile` call (count reads in state).
  - `superseded.json` content changes → step runs again.
  - `throw: true` during upgrade → `failed: RuntimeException`, exit 1, `avuz_theme/external_icons_library` unset; next run with `throw: false` → `upgraded 1`.
  - `superseded.json` missing → `failed: invalid superseded.json`, exit 1, store untouched, nothing recorded. Same for `{` (invalid JSON).
  - fresh install → `seeded 2, upgraded 0, kept 0`, library key = `sha256` of `superseded.json`.
  - shipped library: `superseded.json` has an entry for each of the 68 files; no file's current hash is in its own list; seeding an empty store prints `seeded 34, upgraded 0, kept 0`.
- [ ] **Step 3:** Run `bash docker/tests/seed-external-icons.test.sh`. Expected: new cases `NOT OK`.
- [ ] **Step 4: Implement.** Read `superseded.json` before `avuzDropToConfigOwner()` (fail fast, no NC boot). After the offer step: if stored `external_icons_library` ≠ `hash_file('sha256', superseded.json)`, run `avuzUpgradePair` for every library name, then store the hash. Pair rule from the spec: ours = hash in `superseded[file]` or equal to library file; any existing file not ours → `kept`; else rewrite differing files with `putContent`; never `newFile`. Print the outcome line from Global Constraints.
- [ ] **Step 5:** Run the test file and `bash docker/tests/apps.test.sh`. Expected: all `ok`, exit 0.
- [ ] **Step 6:** Commit `feat(external): upgrade untouched library icons at boot`.

### Task 4: Admin text and docs

**Files:**
- Modify: `themes/avuz/apps/external/l10n/pt_BR.json`, `CLAUDE.md` ("External sites icon library"), `customizations.json` (theme JS entry: drop `lucide.js`; Deck #417 entry: Material, `superseded.json`, upgrade step), `docker/lib-apps.sh` and `docker/entrypoint.sh` comments, `docker-compose.yml`, `portainer-stack.yml`, `portainer-stack-s3.yml` comments, `UPGRADING.md` lines naming `lucide.js`.

- [ ] **Step 1:** pt_BR: keep the first sentence; second becomes "Baixe mais ícones no mesmo estilo dos ícones do Avuz Conecta em https://fonts.google.com/icons (estilo Rounded, peso 200, formato SVG)."
- [ ] **Step 2:** CLAUDE.md: Material 0.48.1, `superseded.json`, upgrade rule, `external_icons_library`, how to change a glyph (edit `GLYPH_BY_ICON`, run, commit SVGs + `superseded.json`).
- [ ] **Step 3:** `python3 -I -m json.tool` on both JSON files; `git grep -n -i lucide -- ':!docs/superpowers'` shows only the follow-up items listed in the spec non-goals.
- [ ] **Step 4:** Commit `docs(external): Material icon library, upgrade step`.

### Task 5: staging-1 verification

- [ ] **Step 1:** Baseline already saved: 74 store files, 68 library files byte-identical to Lucide, 6 admin files (`Elevor.png`, `conectamail.svg`, `external*.svg`, `settings*.svg`).
- [ ] **Step 2:** `./build-push.sh latest staging 1` from this branch (background). Check the pushed digest exists and stack 8's container `.Image` changed.
- [ ] **Step 3:** Boot log line: `External sites icon library: seeded 0, upgraded 34, kept 0`. Store: 68 library hashes equal the repo's Material files; the 6 admin files unchanged.
- [ ] **Step 4:** Restart the container; log shows `unchanged`.
- [ ] **Step 5:** Browser on staging-1: an External sites entry in the rail and the admin Icons section show Material glyphs (after cache: open icon URL with a cache-busting query). pt_BR text links fonts.google.com/icons.
- [ ] **Step 6:** Comment the results on the PR.

### Task 6: PR

- [ ] **Step 1:** Push `feat/external-icons-material`; open PR to `avuz-customization`, stacked on #24 (merge after it). Body: what changes, migration rule, deploy note (1-day icon cache; optional Cloudflare purge of `/apps/external/icons/*`), tests, staging-1 results. Prod untouched.
