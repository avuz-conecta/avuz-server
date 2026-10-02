# Assinaturas Plan 4: Hardening, platform integration and staging

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every deferred review finding from Plans 3a and 3b. Then ship Assinaturas inside the Avuz image, configured from the stack env on every boot. Then prove the whole flow on staging **avuz-conecta-2** with the ZapSign sandbox: real webhooks through Cloudflare, end to end, on a real phone.

**Architecture:** Three repos/places, in order:
- **Part A** hardens the app in `avuz-conecta/assinaturas` on branch `plan-4-hardening`, then merges to `main`.
- **Part B** pins that `main` as the submodule `apps/assinaturas` in avuz-server. It adds an every-boot `docker/lib-assinaturas.sh` sync (env → app config, enable/disable, `webhook:ensure`), a tenant provisioning script and a runbook.
- **Part C** is controller-run operations: build `:staging-2`, deploy to stack 46, configure the sandbox, validate in the browser, by email and on the phone.

**Tech Stack:**
- Nextcloud 33 app: PHP 8.3 and PHPUnit; Vue 3.5 + TS, Vite 7, Vitest, TanStack Vue Query, pdf.js 5.7.
- Bash entrypoint libs with plain-bash tests (`docker/tests/*.test.sh`).
- Portainer API, Cloudflare (manual rule), ZapSign sandbox.

**Spec:** [`docs/superpowers/specs/2026-09-28-assinaturas-zapsign-design.md`](../specs/2026-09-28-assinaturas-zapsign-design.md) §4, §7, §8, §10, §11. **Roadmap:** [`2026-09-28-assinaturas-roadmap.md`](2026-09-28-assinaturas-roadmap.md).

**Decisions (Patrick, 2026-10-02):**
1. The staging phase runs on **avuz-conecta-2 only** (stack 46, `:staging-2`).
2. Production pilot = **app3**, but **not in this plan**. Plan 5 covers the pilot and the fleet.
3. `brand_logo` comes from the Avuz theme: `<instance>/apps/avuz_theme/img/logo-login.png`. The theme holds only Avuz assets, so every tenant serves the same file.
4. **Fix all deferred minors first** (Part A), before shipping.

**Exit criteria:**
- All 91 OPEN inventory items are closed. App `main` carries 0.4.0, with the full suites green.
- `:staging-2` boots with the app shipped; the token in the env enables it and removing it disables it; steady restarts change nothing.
- On conecta-2 with the ZapSign sandbox, all of these work through Cloudflare:
  - webhooks arrive;
  - the 3-document ordered envelope completes;
  - signed copies land in Drive;
  - the Files action, the sidebar, the admin page and the CSP checks pass;
  - Patrick validates placement on his phone.

**Execution:** Tasks 1–11 (app repo) and 12–15 (avuz-server) are subagent tasks under SDD. Tasks 16–22 are controller-run operations with **[Patrick]** gates. Task 23 closes the plan.

## Global Constraints

- Commits carry **no** Claude/AI attribution and no `Co-Authored-By` trailer.
- Never print, log or paste API tokens, signer tokens, sign URLs, webhook secrets, registry or Portainer credentials. Never repeat preview or test credential values in chat or reports.
- Never run `tests/env/reset.sh`. Never send anything to ZapSign from the local preview. Only Part C talks to ZapSign, and only the **sandbox**.
- Staging is autonomous. Any production build, deploy or exec needs Patrick's explicit per-action word. This plan has none.
- TypeScript: no `any`; almost no `as`; named exports; no barrel/index files; async/await over `.then`; hash maps over `switch`; no magic strings or numbers (constants or enums); unused vars prefixed `_`; descriptive names, no abbreviations; early returns; flat code.
- Vue: no constants or functions declared inside components when they can be module-level and pure; data via TanStack Vue Query (query keys from `QUERY_KEYS`, never inline strings); Suspense + error boundary with retry.
- PHP: query builder only, no raw SQL strings; early returns; `#[\SensitiveParameter]` on secrets.
- Tests describe behavior, not implementation. Names use third-person verbs, never "should". Group with `describe`. Every bug fix gets a regression test.
- Helper outputs built with `t(..., { escape: false })` render **only as text** (`{{ }}` or attributes), never `v-html`.
- The look is the approved mockups (`design/mockups/*.dc.html`), pixel-exact; do not adapt to Nextcloud style. `--av-*` tokens resolve only inside `.av-root`.
- WCAG 2.0 AA: keyboard reachable, labelled controls, status never by color alone, 44px touch targets.
- Every JS change bumps the patch version in `appinfo/info.xml` and rebuilds (`npm run build`). The built `js/` and `dist/` are committed. After a bump, run `tests/env/php.sh occ upgrade` in the local env. If it complains about stale apps:
  1. disable `bruteforcesettings`, `files_downloadlimit`, `notifications` and `text`;
  2. run `occ upgrade`;
  3. run `occ maintenance:mode --off`;
  4. run `occ app:enable --force` for those four.
- Test commands (app repo):
  - `npm test` (Vitest);
  - `npm run typecheck`;
  - `npm run lint`;
  - `tests/env/phpunit.sh` (PHP; it re-seeds the preview afterwards);
  - preview `tests/env/serve.sh start|reload|stop` at localhost:8088, seeded by `tests/env/php.sh apps/assinaturas/tests/env/seed-demo.php`.
- The model floor for subagents is sonnet.

---

## Part A: hardening (app repo `~/work/avuz/assinaturas`)

Branch `plan-4-hardening` off `main` (`32fe11a`). One task per area. Each task fixes every listed item and adds the listed tests. Item ids `M<n>` come from the review inventory (`.superpowers/sdd/plan-4/minors-inventory.md`). A task's brief quotes its items in full.

### Task 1: Brand logo from the Avuz theme

**Files:**
- Modify: `lib/ZapSign/ZapSignSettings.php`
- Test: `tests/Integration/ZapSign/ZapSignSettingsTest.php`
- Modify: `docs/api.md` only if it documents `brand_logo_url`. Check with `grep -n brand docs/api.md`.

**Interfaces:**
- Produces: `ZapSignSettings::brandLogoUrl(): string`. Returns the configured `brand_logo_url` when set. Otherwise returns `instanceUrl() . '/apps/avuz_theme/img/logo-login.png'`. Returns `''` when there is no instance URL. `Branding::toPayload()` already drops empty values.

- [ ] **Step 1: Write the failing tests.** Replace `testReadsTheCompanyNameAndAnOptionalBrandLogo` and add:

```php
	public function testReadsTheCompanyName(): void {
		$this->appConfig->setValueString(Application::APP_ID, ZapSignSettings::KEY_COMPANY_NAME, 'Construtora Exemplo');

		$this->assertSame('Construtora Exemplo', $this->settings->companyName());
	}

	public function testDerivesTheBrandLogoFromTheAvuzThemeOfThisInstance(): void {
		$instanceUrl = rtrim(Server::get(IConfig::class)->getSystemValueString('overwrite.cli.url'), '/');

		$this->assertSame($instanceUrl . '/apps/avuz_theme/img/logo-login.png', $this->settings->brandLogoUrl());
	}

	public function testPrefersAConfiguredBrandLogo(): void {
		$this->appConfig->setValueString(Application::APP_ID, ZapSignSettings::KEY_BRAND_LOGO_URL, 'https://cdn.example.com/logo.png');

		$this->assertSame('https://cdn.example.com/logo.png', $this->settings->brandLogoUrl());
	}

	public function testOmitsTheBrandLogoWithoutAnInstanceUrl(): void {
		$systemConfig = $this->createMock(IConfig::class);
		$systemConfig->method('getSystemValueString')->willReturn('');
		$settings = new ZapSignSettings($this->appConfig, $systemConfig, Server::get(ISecureRandom::class));

		$this->assertSame('', $settings->brandLogoUrl());
	}
```

- [ ] **Step 2: Run them and confirm they fail.** Run `tests/env/phpunit.sh --filter ZapSignSettingsTest`. Expect `testDerivesTheBrandLogo…` to FAIL, because `''` is returned.

- [ ] **Step 3: Implement.** In `ZapSignSettings`, add `private const THEME_LOGO_PATH = '/apps/avuz_theme/img/logo-login.png';` and:

```php
	public function brandLogoUrl(): string {
		$configured = $this->appConfig->getValueString(Application::APP_ID, self::KEY_BRAND_LOGO_URL);
		if ($configured !== '') {
			return $configured;
		}
		$instanceUrl = $this->instanceUrl();
		if ($instanceUrl === '') {
			return '';
		}
		return $instanceUrl . self::THEME_LOGO_PATH;
	}
```

- [ ] **Step 4: Run the tests.** Run `tests/env/phpunit.sh --filter 'ZapSignSettingsTest|EnvelopeCreation'`. Expect all to pass. Then run the full `tests/env/phpunit.sh`: everything green.
- [ ] **Step 5: Commit.** Message: `feat: brand ZapSign emails with the Avuz theme logo of the instance`.

### How Tasks 2–10 work

The companion file [`2026-10-02-assinaturas-plan-4-minors-inventory.md`](2026-10-02-assinaturas-plan-4-minors-inventory.md) holds the complete text of every item. Each entry gives the item's source, files with line numbers (on `32fe11a`), the fix, and the behavior test (spec file and test name). Items marked **Decided (Patrick, 2026-10-02)** carry his ruling verbatim. Its "Not open" section lists FIXED, DECIDED and BROWSER-CHECK items. Those are **not** in scope: browser checks run in Part C.

The controller appends a task's items to its brief:

```bash
INVENTORY=<avuz-server worktree>/docs/superpowers/plans/2026-10-02-assinaturas-plan-4-minors-inventory.md
items() { awk -v first="$1" -v last="$2" '
  /^### M[0-9]+\./ { n = substr($2, 2) + 0; keep = (n >= first && n <= last) }
  /^## / { keep = 0 }
  keep' "$INVENTORY"; }
items 1 18 >> .superpowers/sdd/task-2-brief.md
```

Every task follows the same loop, **per item**:
1. Write the item's test(s) with the exact name given and run them. A defect must fail first (RED). Test-hygiene items (the fix IS the test) skip RED.
2. Apply the fix as described. Line numbers may have drifted after earlier tasks; locate by the code shown.
3. Run the item's spec file and confirm it passes.

Commit per item or per small group of related items, with a message such as `fix(dashboard): announce polled status changes (M34)`. At the end of the task, run the whole gate once. Every command must pass:

```bash
npm run typecheck && npm run lint && npm test && npm run build && tests/env/phpunit.sh
```

The PHP suite runs only in backend tasks and in Task 11. A task that changes `src/` bumps the `appinfo/info.xml` patch version once, rebuilds, and commits `js/`, `css/` and `dist/`. Run `tests/env/php.sh occ upgrade`, using the recovery recipe in Global Constraints if it complains.

If an item's described fix proves wrong on contact with the code, do not improvise a different behavior. Report it as `DONE_WITH_CONCERNS` with the evidence, and the controller decides.

### Task 2: Backend (M1–M18)

**Files:** `lib/` and `tests/` per item. Highlights:
- `lib/Draft/*`, `lib/Controller/*`, `lib/Notification/*`, `lib/Db/EnvelopeMapper.php`;
- `lib/Listener/LoadFilesActionListener.php`;
- one new migration for the `fileId` index (M11);
- `docs/api.md` where an item changes a response.

**Items:**
- M1 one owner-file check for create, replace and source;
- M2 the source route buffers the whole PDF;
- M3 `sourceOf` `file_too_large` untested;
- M4 ViewOnlyShareTest logout outside `finally`;
- M5 private `NoUserException` import;
- M6 notifier link edge tests;
- M7 page-cap boundary test;
- M8 listing N+1;
- M9 stale kept-document name after a rename;
- M10 one "current group" rule for links and reminders;
- M11 `fileId` lookup index;
- M12 `replaceDocuments` rollback test;
- M13 `fileId` + `scope=mine` shared-file test;
- M14 non-member page test;
- M15 PageController injects `EnvelopeAccess` for the uid only;
- M16 listener test reaches into internals;
- M17 `findRecent` used only by tests/seed;
- M18 a past deadline reaching ZapSign after the create settled, and reopen stranding it.

**Interfaces:**
- Produces:
  - the M11 migration class name, which must sort after every existing migration in `lib/Migration/`;
  - any `docs/api.md` change. M2 and M8 must keep the JSON shapes unchanged, and the frontend specs stay green untouched.

- [ ] **Step 1:** Run the per-item loop for M1–M18, PHP only.
- [ ] **Step 2:** Run the gate; `tests/env/phpunit.sh` must be fully green. After the suite, run `tests/env/php.sh occ migrations:status assinaturas` to confirm the M11 migration applied.
- [ ] **Step 3:** No `src/` change means no version bump. If M11 adds a migration, bump the patch version anyway (migrations run on a version change) and run `tests/env/php.sh occ upgrade`.

### Task 3: Dev environment and tooling (M19–M23)

**Files:**
- `tsconfig.json`, `vite.config.ts`;
- `tests/env/seed-demo.php`, `tests/env/serve.sh`;
- `src/**` fixtures and harnesses moved to `src/test-support/` (M22);
- the help-launcher clearance comment.

**Items:**
- M19 TypeScript leaves optional props and the build config unchecked (`exactOptionalPropertyTypes`; include `vite.config.ts` in the typecheck);
- M20 seed timestamps contradict their events and depend on the run date;
- M21 `serve.sh` magic trusted_domains index and swallowed theme failure;
- M22 fixtures/harnesses in `src/` as non-spec modules, and the duplicated `deferred()`;
- M23 the clearance comment arithmetic.

- [ ] **Step 1:** Run the per-item loop for M19–M23. M19 may surface type errors across `src/`; fix them without `as` and without `any`. If more than ~40 errors appear, report `DONE_WITH_CONCERNS` with the count before going on.
- [ ] **Step 2:** Re-seed the preview (`tests/env/php.sh apps/assinaturas/tests/env/seed-demo.php`) and check it twice on different days by faking the date as the inventory describes (M20). Run `tests/env/serve.sh reload` (M21), then the gate.

### Task 4: API client and errors (M86–M91)

**Files:** `src/api/*`, `src/presentation/*` (error copy), the query keys module, `src/main.ts` (page config).

**Items:**
- M86 cancels and non-HTTP errors all become "no connection";
- M87 an expired session (401/412) gets the generic error;
- M88 source-download error bodies arrive as an ArrayBuffer and lose their code;
- M89 the admin client failure spec;
- M90 no spec for the query keys;
- M91 the page config from `loadState` is trusted without a check.

**Interfaces:**
- Produces: the error kinds and copy that Tasks 6–10 rely on. M86 introduces the codes `cancelled` (toasts skip it) and `unknown` (logged). M87 introduces `http_401`/`http_412` with "Sua sessão expirou. Recarregue a página." Name them in the report so later dispatches can quote them.

- [ ] **Step 1:** Run the per-item loop.
- [ ] **Step 2:** Run the gate, bump the version and rebuild.

### Task 5: UI kit and identity styles (M24–M33)

**Files:** `src/ui/*.vue` and their specs, `src/styles/identity.css` and its spec, `design/README.md`.

**Items:**
- M24 `--av-control-margin` inherits into nested buttons;
- M25 titled-banner dividers: **warning tone only** (decided);
- M26 hand-rolled kit variants (avatar ring, tone-outline banner action) become kit props;
- M27 tone unions spelled out repeatedly;
- M28 kit API mismatches;
- M29 raw colour and font-size literals become tokens;
- M30 specs for `AvCard`, `AvSkeleton` and `AvStatusPill`;
- M31 regex style specs parsing source text;
- M32 the phone-breakpoint export without a consumer;
- M33 the native search clear "×".

The look must stay pixel-identical to the artboards. M26 and M29 are refactors, not redesigns.

- [ ] **Step 1:** Run the per-item loop.
- [ ] **Step 2:** In the preview (`tests/env/serve.sh reload`), screenshot the dashboard, the wizard steps 1 and 4, and the detail at 1280. Compare them with the same screens before the task: no visual change except M25 (dividers off the non-warning tones) and M33 (no native ×).
- [ ] **Step 3:** Run the gate, bump the version and rebuild.

### Task 6: Dashboard and detail behavior (M34–M42, M50–M53)

**Files:** `src/dashboard/*`, `src/detail/*`, `src/envelope/*`, `src/layout/*` and their specs.

**Items:**
- M34 polled status changes are announced, and the failed banner is an alert;
- M35 "Tentar novamente" and "Voltar para rascunho" confirm success;
- M36 the `deadline_invalid` retry branch is logged;
- M37 open dialogs survive a refetch;
- M38 focus after deleting a draft from the table;
- M39 the aside's duplicated "Progresso" name;
- M40 one "Novo envelope" on the phone empty dashboard;
- M41 an empty filter offers "Mostrar todos";
- M42 "Ver histórico" adds no history entry;
- M50 "Meus envelopes" current on a colleague's envelope;
- M51 the nav badge gets an accessible label;
- M52 the `!canUseApp` landmark test;
- M53 the drawer-focus spec.

**Interfaces:**
- Consumes: Task 4's error kinds (cancelled is ignored; session-expired copy).

- [ ] **Step 1:** Run the per-item loop. Any new user-facing copy is pt_BR via `t()`, and the item's text gives it verbatim. If an item needs copy the inventory doesn't give, stop and report `NEEDS_CONTEXT`.
- [ ] **Step 2:** Run the gate, bump the version and rebuild.

### Task 7: Dashboard and detail structure (M43–M49)

**Files:** `src/dashboard/*`, `src/detail/*`, a new shared module for helpers per M43, and a dialog-mutation composable per M44.

**Items:**
- M43 shared helpers move out of the dashboard folder, and `currentUid` is computed once;
- M44 one composable for the six dialogs' mutation boilerplate;
- M45 the cancel counter and `maxlength` count the same text;
- M46 no secondary `TypeError` after a failed load;
- M47 specs select by role/label instead of classes;
- M48 a named `markHandled` helper for the sign-link blob `.catch`;
- M49 the unreachable `group === null` branch.

- [ ] **Step 1:** Run the per-item loop. M44 must keep every dialog's behavior identical: the existing dialog specs pass unchanged, except the class selectors M47 rewrites.
- [ ] **Step 2:** Run the gate, bump the version and rebuild.

### Task 8: Files sidebar, Files action and admin page (M54–M64)

**Files:** `src/files/*`, `src/shims/*`, the admin settings components and their specs. The backend summary endpoint changes only if M58 needs it; then update `docs/api.md` and the PHP tests.

**Items:**
- M54 a failed chunk load of the Files action is caught and translated;
- M55 a failed background refresh keeps the sidebar list and is logged;
- M56 a node without a file id;
- M57 the sidebar polls sending/finalizing envelopes;
- M58 sidebar cards stop fetching the full envelope just for avatars;
- M59 a spec running the real `registerSidebarTab` through the `is-svg` shim, and the shim's scope documented;
- M60 admin specs count fetches;
- M61 redundant `health` narrowing;
- M62 the usage month shown;
- M63 the reset button hidden when there are no counters;
- M64 the first admin section's duplicated name.

**Interfaces:**
- Consumes: Task 4's error kinds.

- [ ] **Step 1:** Run the per-item loop. If M58 changes the backend, run `tests/env/phpunit.sh` too.
- [ ] **Step 2:** Run the gate, bump the version and rebuild.

### Task 9: Wizard save state (M65–M75)

**Files:** `src/wizard/*` and its specs; `src/placement/placement-draft.ts` (M74 selection helper).

**Items:**
- M65 a reorder spec that catches a one-microtask lag;
- M66 async "Tentar novamente", with a throwing retry logged;
- M67 a queued router move gets its own answer;
- M68 four move flags become one state;
- M69 on the send path, deadline focus never lands on a disabled field;
- M70 save-state selection without rebuilt closures or a second envelope observer;
- M71 a signers failure clears when the rows are typed back;
- M72 a replayed new signer gets its stable colour;
- M73 the grip keyboard hint (copy **approved**);
- M74 **auto-place unopened documents when leaving step 3** (decided; new copy "Posicionando assinaturas…");
- M75 leaving is no longer refused during a hung retry.

**Interfaces:**
- Consumes:
  - `autoPlace → { boxes, unplacedSignerIds }` and the page-geometry loader from `src/placement` / `src/pdf`;
  - the fields-save mutation keyed `QUERY_KEYS.draftChange(uuid, 'fields')` (per document);
  - `flush(reason)` / `hasNewerEdits(change)`.
- Produces: M74's selection helper, e.g. `documentsNeedingAutoPlacement(envelope, savedFields): DocumentId[]`. Pick the name from the existing vocabulary and report it.

- [ ] **Step 1:** Run the per-item loop. M74 is the largest item. Write its two `WizardView` specs and the helper spec first.
- [ ] **Step 2:** In the preview, take a seeded draft with three documents. Open only the first in step 3, press Continuar, and confirm the review counts boxes on all three. Reopen step 3: the other two show auto-placed boxes. Make **no** ZapSign send.
- [ ] **Step 3:** Run the gate, bump the version and rebuild.

### Task 10: PDF rendering and placement (M76–M85)

**Files:** `src/pdf/*`, `src/placement/*` and their specs.

**Items:**
- M76 a cancelled in-flight open destroys its loading task;
- M77 no transient destroyed-worker error on replace;
- M78 a failed pdf.js chunk load can be retried;
- M79 one shared pdf.js worker;
- M80 the drawable-page type without method bivariance;
- M81 preload-margin hysteresis;
- M82 the overlap warning covers signature-over-signature;
- M83 a zero-area box move is clamped;
- M84 the auto-placement spec gaps;
- M85 per-scale label spec assertions, and the duplicated sheet gap.

- [ ] **Step 1:** Run the per-item loop. For M79, run the preview with two documents in step 3 and check DevTools → Sources/Threads: one `pdf.worker` thread.
- [ ] **Step 2:** Run the gate, bump the version and rebuild.

### Task 11: Release the hardened app

- [ ] **Step 1:** Bump `appinfo/info.xml` to **0.4.0**, rebuild, and run the whole gate, including `tests/env/phpunit.sh`. Then:
  - re-seed the preview;
  - check the dashboard, wizard 1–4, the detail and the Files sidebar at 1280 and at phone width (390) against the artboards;
  - check nothing regressed from Tasks 2–10.
- [ ] **Step 2:** The controller dispatches the final whole-branch review on the most capable model, with:
  - the package `scripts/review-package $(git merge-base main HEAD) HEAD`;
  - the inventory;
  - the global constraints.

  One fix round goes to a single fixer subagent.
- [ ] **Step 3:** Merge to `main` with `--no-ff`, as `Merge Plan 4 hardening`, and push `main`. Record the merge SHA as **APP_MAIN_SHA**; Task 14 pins it.

---

## Part B: ship the app in the Avuz image (avuz-server)

Work in the avuz-server worktree `.claude/worktrees/avuzconecta-signature-feasibility-59ecdd`, branch `claude/avuzconecta-signature-feasibility-59ecdd`. Before the first Part B task, the controller brings the branch level with `avuz-customization`. Its `docker/` is behind: config `33.0.0-16` here versus `33.0.0-21` there.

```bash
git merge-base --is-ancestor HEAD avuz-customization && git merge --ff-only avuz-customization
```

If HEAD isn't an ancestor, merge `avuz-customization` with `--no-ff` and resolve. Never sync with `master`, which is upstream Nextcloud. Bash tests run with macOS `/bin/bash` 3.2 and with the image's bash 5. Empty-array expansion must therefore use the `${array[@]+"${array[@]}"}` idiom under `set -u`.

### Task 12: Move the sensitive app-config helper into `lib-apps.sh`

**Files:**
- Modify: `docker/lib-apps.sh` (add `avuz_set_sensitive_app_config` after `_avuz_occ`)
- Modify: `docker/entrypoint.sh` (delete `set_sensitive_app_config`, ~line 366; repoint the two `conectamail` calls, ~line 491)
- Test: `docker/tests/apps.test.sh` (append a section)

**Interfaces:**
- Produces: `avuz_set_sensitive_app_config <app> <key> <value> [type]`. Uses `_avuz_occ`, so tests can stub it. The optional `type` adds `--type=<type>`.

- [ ] **Step 1: Write the failing tests.** Append to `docker/tests/apps.test.sh`, before the final `exit`/summary lines:

```bash
# ── avuz_set_sensitive_app_config ──
SENSITIVE_LOG="$(mktemp)"
FAKE_SENSITIVE_DETAILS='{}'
_avuz_occ() {
    printf '%s\n' "$*" >> "$SENSITIVE_LOG"
    case "$*" in
        *" --details --output=json") echo "$FAKE_SENSITIVE_DETAILS" ;;
    esac
    return 0
}

: > "$SENSITIVE_LOG"; FAKE_SENSITIVE_DETAILS='{"sensitive":false}'
avuz_set_sensitive_app_config conectamail sso_secret s3cret >/dev/null
assert_eq "deletes a plaintext key before storing it sensitive" \
"config:app:get conectamail sso_secret --details --output=json
config:app:delete conectamail sso_secret
config:app:set conectamail sso_secret --sensitive --value=s3cret" "$(cat "$SENSITIVE_LOG")"

: > "$SENSITIVE_LOG"; FAKE_SENSITIVE_DETAILS='{"sensitive":true}'
avuz_set_sensitive_app_config conectamail sso_secret s3cret >/dev/null
assert_eq "sets an already-sensitive key in place" \
"config:app:get conectamail sso_secret --details --output=json
config:app:set conectamail sso_secret --sensitive --value=s3cret" "$(cat "$SENSITIVE_LOG")"

: > "$SENSITIVE_LOG"; FAKE_SENSITIVE_DETAILS='{"sensitive":true}'
avuz_set_sensitive_app_config assinaturas api_token tok string >/dev/null
assert_eq "passes the value type when given" \
"config:app:get assinaturas api_token --details --output=json
config:app:set assinaturas api_token --type=string --sensitive --value=tok" "$(cat "$SENSITIVE_LOG")"
unset -f _avuz_occ; source "$HERE/../lib-apps.sh"
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `bash docker/tests/apps.test.sh`. Expect `NOT OK` lines plus `avuz_set_sensitive_app_config: command not found`.

- [ ] **Step 3: Implement.** In `docker/lib-apps.sh`, after `_avuz_occ`:

```bash
# Stores an app config value encrypted at rest ($AppConfigEncryption$ prefix).
# IAppConfig refuses to flip an existing key's sensitivity through a value set,
# so a plaintext key is deleted first. Already-sensitive keys are set in place
# (no DB write when the value is unchanged). Readers must use IAppConfig — the
# deprecated IConfig::getAppValue returns the ciphertext.
avuz_set_sensitive_app_config() {
    local app="$1" key="$2" value="$3" type="${4:-}"
    local type_option=()
    [ -n "$type" ] && type_option=(--type="$type")
    if ! _avuz_occ config:app:get "$app" "$key" --details --output=json 2>/dev/null \
        | grep -q '"sensitive":true'; then
        _avuz_occ config:app:delete "$app" "$key" >/dev/null 2>&1 || true
    fi
    _avuz_occ config:app:set "$app" "$key" ${type_option[@]+"${type_option[@]}"} --sensitive --value="$value"
}
```

In `docker/entrypoint.sh`:
- delete the `set_sensitive_app_config` function and its comment block;
- replace both calls with `avuz_set_sensitive_app_config conectamail sso_secret "$ROUNDCUBE_SSO_SECRET"` and `avuz_set_sensitive_app_config conectamail credential_key "$ROUNDCUBE_CREDENTIAL_KEY"`.

- [ ] **Step 4: Run all docker tests.**

```bash
for test in docker/tests/*.test.sh; do bash "$test" | grep -v '^ok' ; done; bash -n docker/entrypoint.sh
```

Expect no `NOT OK` lines, and no output from `bash -n`.

- [ ] **Step 5: Commit.** Message: `refactor(entrypoint): move the sensitive app-config helper into lib-apps.sh`.

### Task 13: Every-boot Assinaturas sync

**Files:**
- Create: `docker/lib-assinaturas.sh`
- Create: `docker/tests/assinaturas.test.sh`
- Modify: `docker/entrypoint.sh`:
  - source the lib next to the other three (~line 17);
  - add `"assinaturas"` to `AVUZ_OWNED_APPS` (~line 83);
  - call the sync right after `avuz_reconcile_app_versions "${ENABLE_APPS[@]}"` (~line 984).

**Interfaces:**
- Consumes:
  - `_avuz_occ`, `avuz_set_sensitive_app_config` (Task 12), `avuz_reconcile_app_versions` (lib-apps.sh);
  - app config keys `api_token`, `environment`, `company_name`, `webhook_secret`;
  - command `assinaturas:webhook:ensure`.
- Produces:
  - `avuz_assinaturas_env_problem <token> <environment> <company>`: pure; echoes a reason, or nothing when the env can enable the app.
  - `avuz_assinaturas_sync`: reads `ZAPSIGN_API_TOKEN`, `ZAPSIGN_ENVIRONMENT`, `ZAPSIGN_COMPANY_NAME`, `ZAPSIGN_WEBHOOK_SECRET`. Sets the global `AVUZ_ASSINATURAS_CHANGED` to `1` when it enabled, upgraded or disabled the app, else `0`. Always returns 0. It never prints the token.

Behavior, from spec §4 with Patrick's 2026-10-02 decisions:

| Env | App state before | Action |
|---|---|---|
| token empty, or environment not `sandbox`/`production`, or company empty | enabled | `app:disable` (data kept), print `– Assinaturas off: <reason>`, CHANGED=1 |
| same | disabled | print the reason only, CHANGED=0 |
| valid | disabled | `app:enable --force`; on failure print `✗` and stop |
| valid | any | reconcile the app version (disable+enable when code > installed, which runs its migrations); write `api_token` (sensitive string), `environment`, `company_name` (strings), `webhook_secret` (sensitive string, only when the env var is non-empty); run `assinaturas:webhook:ensure`. A failed config write prints `✗` and skips ensure. A failed ensure prints `✗` and continues: the daily `EnsureWebhooksJob` retries and the poller covers the gap. **Nothing here may abort the boot**: the entrypoint runs under `set -e` |

The group `assinaturas` comes from the app's own install/post-migration repair step (`EnsureSignersGroup`). The entrypoint does not create it.

- [ ] **Step 1: Write the failing tests** in `docker/tests/assinaturas.test.sh`:

```bash
#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/../lib-apps.sh"
source "$HERE/../lib-assinaturas.sh"

fail=0
assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        echo "ok - $desc"
    else
        echo "NOT OK - $desc"; echo "  expected: [$expected]"; echo "  actual:   [$actual]"; fail=1
    fi
}
assert_has() {
    local desc="$1" needle="$2" haystack="$3"
    if printf '%s\n' "$haystack" | grep -qxF -- "$needle"; then echo "ok - $desc"; else
        echo "NOT OK - $desc"; echo "  missing line: [$needle]"; echo "  in: [$haystack]"; fail=1; fi
}
assert_lacks() {
    local desc="$1" needle="$2" haystack="$3"
    if printf '%s\n' "$haystack" | grep -qF -- "$needle"; then
        echo "NOT OK - $desc"; echo "  unexpected: [$needle]"; fail=1; else echo "ok - $desc"; fi
}

OCC_LOG="$(mktemp)"
FAKE_APP_DIR="$(mktemp -d)"
mkdir -p "$FAKE_APP_DIR/appinfo"
printf '<info>\n    <version>0.4.0</version>\n</info>\n' > "$FAKE_APP_DIR/appinfo/info.xml"
TEST_TOKEN="test-token-value"

_avuz_occ() {
    printf '%s\n' "$*" >> "$OCC_LOG"
    case "$*" in
        "config:app:get assinaturas enabled") echo "$FAKE_ENABLED" ;;
        "config:app:get assinaturas installed_version") echo "$FAKE_INSTALLED" ;;
        "app:getpath assinaturas") echo "$FAKE_APP_DIR" ;;
        "config:app:get assinaturas "*" --details --output=json") echo "$FAKE_DETAILS" ;;
        "app:enable --force assinaturas")
            [ "$FAKE_ENABLE_FAILS" = "yes" ] && return 1
            FAKE_ENABLED="yes"; FAKE_INSTALLED="0.4.0" ;;
        "assinaturas:webhook:ensure") [ "$FAKE_ENSURE_FAILS" = "yes" ] && return 1 ;;
        "config:app:set assinaturas environment "*) [ "$FAKE_SET_FAILS" = "yes" ] && return 1 ;;
    esac
    return 0
}

reset_fakes() {
    : > "$OCC_LOG"
    FAKE_ENABLED="no"; FAKE_INSTALLED=""; FAKE_DETAILS='{"sensitive":false}'
    FAKE_ENABLE_FAILS="no"; FAKE_ENSURE_FAILS="no"; FAKE_SET_FAILS="no"
    unset ZAPSIGN_API_TOKEN ZAPSIGN_ENVIRONMENT ZAPSIGN_COMPANY_NAME ZAPSIGN_WEBHOOK_SECRET
}
configure_env() {
    export ZAPSIGN_API_TOKEN="$TEST_TOKEN" ZAPSIGN_ENVIRONMENT="sandbox" ZAPSIGN_COMPANY_NAME="Construtora Teste"
}
writes() { grep -v '^config:app:get\|^app:getpath' "$OCC_LOG" || true; }
# Runs the sync in THIS shell (a $(...) subshell would lose AVUZ_ASSINATURAS_CHANGED).
SYNC_OUT="$(mktemp)"
sync_now() { avuz_assinaturas_sync > "$SYNC_OUT"; }
synced() { cat "$SYNC_OUT"; }

# ── avuz_assinaturas_env_problem ──
assert_eq "reports a missing token" "no ZAPSIGN_API_TOKEN" "$(avuz_assinaturas_env_problem "" sandbox Acme)"
assert_eq "reports an unknown environment" "ZAPSIGN_ENVIRONMENT must be sandbox or production (got 'staging')" \
    "$(avuz_assinaturas_env_problem tok staging Acme)"
assert_eq "reports an empty environment" "ZAPSIGN_ENVIRONMENT must be sandbox or production (got '')" \
    "$(avuz_assinaturas_env_problem tok "" Acme)"
assert_eq "reports a missing company" "no ZAPSIGN_COMPANY_NAME" "$(avuz_assinaturas_env_problem tok production "")"
assert_eq "accepts a complete env" "" "$(avuz_assinaturas_env_problem tok production Acme)"

# ── unconfigured ──
reset_fakes
sync_now
assert_eq "leaves a disabled app alone without a token" "" "$(writes)"
assert_eq "reports no change when nothing was enabled" "0" "$AVUZ_ASSINATURAS_CHANGED"
assert_has "says why the app is off" "– Assinaturas off: no ZAPSIGN_API_TOKEN" "$(synced)"

reset_fakes; FAKE_ENABLED="yes"
sync_now
assert_eq "disables an enabled app when the token is removed" "app:disable assinaturas" "$(writes)"
assert_eq "flags the disable as a change" "1" "$AVUZ_ASSINATURAS_CHANGED"

reset_fakes; FAKE_ENABLED="yes"; configure_env; export ZAPSIGN_ENVIRONMENT="prod"
sync_now
assert_eq "disables the app on an invalid environment" "app:disable assinaturas" "$(writes)"

# ── configured, first boot ──
reset_fakes; configure_env
sync_now
assert_eq "enables, configures and registers webhooks in order" \
"app:enable --force assinaturas
config:app:delete assinaturas api_token
config:app:set assinaturas api_token --type=string --sensitive --value=$TEST_TOKEN
config:app:set assinaturas environment --type=string --value=sandbox
config:app:set assinaturas company_name --type=string --value=Construtora Teste
assinaturas:webhook:ensure" "$(writes)"
assert_eq "flags the enable as a change" "1" "$AVUZ_ASSINATURAS_CHANGED"
assert_has "confirms the configuration" "✓ Assinaturas (sandbox) configured" "$(synced)"
assert_lacks "never prints the token" "$TEST_TOKEN" "$(synced)"

# ── configured, steady state ──
reset_fakes; configure_env; FAKE_ENABLED="yes"; FAKE_INSTALLED="0.4.0"; FAKE_DETAILS='{"sensitive":true}'
sync_now
assert_lacks "skips app:enable when already enabled" "app:enable" "$(writes)"
assert_lacks "keeps an already-sensitive token in place" "config:app:delete" "$(writes)"
assert_eq "reports no change on a steady boot" "0" "$AVUZ_ASSINATURAS_CHANGED"

# ── configured, new app version in the image ──
reset_fakes; configure_env; FAKE_ENABLED="yes"; FAKE_INSTALLED="0.3.44"
sync_now
assert_has "re-enables to run the app upgrade" "app:disable assinaturas" "$(writes)"
assert_eq "flags the upgrade as a change" "1" "$AVUZ_ASSINATURAS_CHANGED"

# ── webhook secret from env ──
reset_fakes; configure_env; FAKE_ENABLED="yes"; FAKE_INSTALLED="0.4.0"; export ZAPSIGN_WEBHOOK_SECRET="env-secret"
sync_now
assert_has "stores an env webhook secret as sensitive" \
    "config:app:set assinaturas webhook_secret --type=string --sensitive --value=env-secret" "$(writes)"
reset_fakes; configure_env; FAKE_ENABLED="yes"; FAKE_INSTALLED="0.4.0"
sync_now
assert_lacks "keeps the generated secret when the env has none" "webhook_secret" "$(writes)"

# ── failures ──
reset_fakes; configure_env; FAKE_ENABLE_FAILS="yes"
sync_now
assert_eq "stops after a failed enable" "app:enable --force assinaturas" "$(writes)"
assert_has "reports the failed enable" "✗ Assinaturas: app:enable failed (is apps/assinaturas in the image?)" "$(synced)"

reset_fakes; configure_env; FAKE_ENABLED="yes"; FAKE_INSTALLED="0.4.0"; FAKE_SET_FAILS="yes"
if sync_now; then rc=0; else rc=1; fi
assert_eq "never fails the boot on a config write error" "0" "$rc"
assert_lacks "skips webhooks after a config write error" "assinaturas:webhook:ensure" "$(writes)"
assert_has "reports the config write failure" \
    "✗ Assinaturas: could not write the app config — webhooks left as they were" "$(synced)"

reset_fakes; configure_env; FAKE_ENABLED="yes"; FAKE_INSTALLED="0.4.0"; FAKE_ENSURE_FAILS="yes"
if sync_now; then rc=0; else rc=1; fi
assert_eq "never fails the boot on a webhook error" "0" "$rc"
assert_has "reports the webhook failure" \
    "✗ Assinaturas: webhook:ensure failed — EnsureWebhooksJob retries daily; the poller covers the gap" "$(synced)"

rm -rf "$OCC_LOG" "$FAKE_APP_DIR" "$SYNC_OUT"
exit "$fail"
```

- [ ] **Step 2: Run the test and confirm it fails.** Run `bash docker/tests/assinaturas.test.sh`. Expect a `No such file` error for `lib-assinaturas.sh`.

- [ ] **Step 3: Implement** `docker/lib-assinaturas.sh`:

```bash
#!/bin/bash
# Assinaturas (Avuz's ZapSign e-signature app) boot sync. Sourced by
# docker/entrypoint.sh and docker/tests/assinaturas.test.sh after lib-apps.sh.
# No side effects on source.
#
# Runs EVERY boot (not stamp-gated): the stack env is the source of truth, so
# setting or removing the token takes effect on the next redeploy.
#   ZAPSIGN_API_TOKEN       tenant sub-account token; empty -> app disabled (data kept)
#   ZAPSIGN_ENVIRONMENT     sandbox | production
#   ZAPSIGN_COMPANY_NAME    tenant company shown to signers
#   ZAPSIGN_WEBHOOK_SECRET  optional; empty -> the app keeps its generated secret

AVUZ_ASSINATURAS_APP="assinaturas"
AVUZ_ASSINATURAS_ENVIRONMENTS=" sandbox production "
AVUZ_ASSINATURAS_CHANGED=0

# Pure: why the env cannot enable the app; empty when it can.
avuz_assinaturas_env_problem() {
    local token="$1" environment="$2" company="$3"
    if [ -z "$token" ]; then echo "no ZAPSIGN_API_TOKEN"; return; fi
    if [ -z "$environment" ] || [[ "$AVUZ_ASSINATURAS_ENVIRONMENTS" != *" $environment "* ]]; then
        echo "ZAPSIGN_ENVIRONMENT must be sandbox or production (got '$environment')"; return
    fi
    if [ -z "$company" ]; then echo "no ZAPSIGN_COMPANY_NAME"; return; fi
}

avuz_assinaturas_is_enabled() {
    [ "$(_avuz_occ config:app:get "$AVUZ_ASSINATURAS_APP" enabled 2>/dev/null | tr -d '[:space:]')" = "yes" ]
}

avuz_assinaturas_disable() {
    local reason="$1"
    if avuz_assinaturas_is_enabled; then
        _avuz_occ app:disable "$AVUZ_ASSINATURAS_APP" >/dev/null || true
        AVUZ_ASSINATURAS_CHANGED=1
    fi
    echo "– Assinaturas off: $reason"
}

# Each write returns on failure: callers run it under `if !`, where set -e is off.
avuz_assinaturas_write_config() {
    avuz_set_sensitive_app_config "$AVUZ_ASSINATURAS_APP" api_token "$ZAPSIGN_API_TOKEN" string >/dev/null || return 1
    _avuz_occ config:app:set "$AVUZ_ASSINATURAS_APP" environment --type=string --value="$ZAPSIGN_ENVIRONMENT" >/dev/null || return 1
    _avuz_occ config:app:set "$AVUZ_ASSINATURAS_APP" company_name --type=string --value="$ZAPSIGN_COMPANY_NAME" >/dev/null || return 1
    [ -z "${ZAPSIGN_WEBHOOK_SECRET:-}" ] && return 0
    avuz_set_sensitive_app_config "$AVUZ_ASSINATURAS_APP" webhook_secret "$ZAPSIGN_WEBHOOK_SECRET" string >/dev/null
}

avuz_assinaturas_sync() {
    AVUZ_ASSINATURAS_CHANGED=0
    local problem reconcile_output
    problem="$(avuz_assinaturas_env_problem "${ZAPSIGN_API_TOKEN:-}" "${ZAPSIGN_ENVIRONMENT:-}" "${ZAPSIGN_COMPANY_NAME:-}")"
    if [ -n "$problem" ]; then
        avuz_assinaturas_disable "$problem"
        return 0
    fi
    if ! avuz_assinaturas_is_enabled; then
        if ! _avuz_occ app:enable --force "$AVUZ_ASSINATURAS_APP" >/dev/null; then
            echo "✗ Assinaturas: app:enable failed (is apps/assinaturas in the image?)"
            return 0
        fi
        AVUZ_ASSINATURAS_CHANGED=1
    fi
    reconcile_output="$(avuz_reconcile_app_versions "$AVUZ_ASSINATURAS_APP")"
    if [ -n "$reconcile_output" ]; then
        echo "$reconcile_output"
        AVUZ_ASSINATURAS_CHANGED=1
    fi
    if ! avuz_assinaturas_write_config; then
        echo "✗ Assinaturas: could not write the app config — webhooks left as they were"
        return 0
    fi
    if ! _avuz_occ assinaturas:webhook:ensure >/dev/null; then
        echo "✗ Assinaturas: webhook:ensure failed — EnsureWebhooksJob retries daily; the poller covers the gap"
        return 0
    fi
    echo "✓ Assinaturas ($ZAPSIGN_ENVIRONMENT) configured"
}
```

Wire it into `docker/entrypoint.sh`:

```bash
source /var/www/html/docker/lib-assinaturas.sh
```

Add `"assinaturas"` as the last entry of `AVUZ_OWNED_APPS`. After `avuz_reconcile_app_versions "${ENABLE_APPS[@]}"`:

```bash
# Assinaturas follows the stack env on every boot: token set -> enabled and
# configured; token removed -> disabled, data kept. See docker/lib-assinaturas.sh.
avuz_assinaturas_sync
if [ "$AVUZ_ASSINATURAS_CHANGED" -eq 1 ]; then
    DID_CONFIG_RUN=1   # app enable/upgrade ran occ as root: re-chown appdata_*
fi
```

Confirm `DID_CONFIG_RUN` is initialized to `0` before that line. Read the top of the PHASE 3 section; if it isn't, initialize it next to `DID_DB_UPGRADE`.

- [ ] **Step 4: Run all docker tests** with the loop from Task 12, Step 4, plus `bash -n docker/lib-assinaturas.sh`. Expect no `NOT OK` lines.
- [ ] **Step 5: Commit.** Message: `feat(entrypoint): sync Assinaturas from the stack env on every boot`.

### Task 14: Ship `apps/assinaturas` as a submodule

**Files:**
- Modify: `.gitmodules` (via `git submodule add`); new gitlink `apps/assinaturas`
- Modify: `Dockerfile` (after the Deck comment block, before `RUN npm run build`)
- Modify: `CLAUDE.md` (Fresh Checkout Setup; a new "Assinaturas" section)
- Modify: `portainer-stack.yml`, `portainer-stack-s3.yml` (env block after the AI block)

**Interfaces:**
- Consumes: app repo `main` at the commit Task 11 pushed. The controller passes the SHA in the dispatch.

- [ ] **Step 1: Add the submodule pinned to the released commit.**

```bash
git submodule add --force -b main https://github.com/avuz-conecta/assinaturas.git apps/assinaturas
git -C apps/assinaturas checkout <APP_MAIN_SHA>
git add .gitmodules apps/assinaturas
```

Expect `.gitmodules` to gain this entry, matching the deck one:

```
[submodule "apps/assinaturas"]
	path = apps/assinaturas
	url = https://github.com/avuz-conecta/assinaturas.git
	branch = main
```

- [ ] **Step 2: Dockerfile.** Add after the Deck comment:

```dockerfile
# Assinaturas (Avuz's own ZapSign e-signature app) ships as the
# avuz-conecta/assinaturas submodule at apps/assinaturas (branch main) with its
# built js/ and dist/ committed — the Dockerfile cannot build it. Fail loud if
# the submodule was not initialized, then drop what only development needs
# (sources, tests with local preview fixtures, design mockups, docs).
RUN test -f apps/assinaturas/js/assinaturas-main.mjs \
      || { echo "apps/assinaturas has no built js — run: git submodule update --init apps/assinaturas"; exit 1; } \
    && rm -rf apps/assinaturas/.git apps/assinaturas/src apps/assinaturas/tests \
              apps/assinaturas/design apps/assinaturas/docs apps/assinaturas/scripts \
              apps/assinaturas/node_modules apps/assinaturas/.superpowers
```

- [ ] **Step 3: Stack templates.** In both `portainer-stack.yml` and `portainer-stack-s3.yml`, after the AI block:

```yaml
      # Assinaturas — ZapSign e-signature (optional). Empty token = app disabled,
      # data kept. Provisioning: docs/assinaturas-tenant-runbook.md
      - ZAPSIGN_API_TOKEN=                 # tenant sub-account token (shown once at creation)
      - ZAPSIGN_ENVIRONMENT=production     # sandbox on staging
      - ZAPSIGN_COMPANY_NAME=              # tenant company, shown to signers
      - ZAPSIGN_WEBHOOK_SECRET=            # optional; empty = app-generated
```

- [ ] **Step 4: CLAUDE.md.** Make three edits:
  - The fresh-checkout submodule command becomes `git submodule update --init --recursive 3rdparty apps/integration_openai apps/deck apps/assinaturas`.
  - The exceptions paragraph names `assinaturas`: Avuz's own app, branch `main`, built `js/`+`dist/` committed, never rsync'd.
  - Add an "Assinaturas (ZapSign e-signature)" section under Key Customizations. Content:
    - the four env vars and what an empty token does;
    - the every-boot sync lives in `docker/lib-assinaturas.sh`;
    - webhook path `/index.php/apps/assinaturas/webhook`, which needs the Cloudflare WAF skip rule;
    - the access group `assinaturas` (admins always pass);
    - a pointer to `docs/assinaturas-tenant-runbook.md`.

- [ ] **Step 5: Verify.**

```bash
git diff --cached --stat; git -C apps/assinaturas rev-parse HEAD
grep -n "assinaturas" .gitmodules Dockerfile CLAUDE.md portainer-stack.yml portainer-stack-s3.yml
```

Expect the gitlink to point at `<APP_MAIN_SHA>`. Expect each file to mention the app.

- [ ] **Step 6: Commit.** Message: `feat: ship the Assinaturas app as a submodule in the image`.

### Task 15: Tenant provisioning script and runbook

**Files:**
- Create: `scripts/zapsign-create-tenant.sh`
- Create: `scripts/tests/zapsign-create-tenant.test.sh`
- Create: `docs/assinaturas-tenant-runbook.md`

**Interfaces:**
- Produces: `ZAPSIGN_PARTNER_TOKEN=… scripts/zapsign-create-tenant.sh "<company name>" <token-file>`.
  - `ZAPSIGN_API_BASE` overrides the API base; the default is production `https://api.zapsign.com.br/api/v1`.
  - Exit 0 prints `✓ Sub-account <id> created for "<company>". Token saved to <token-file> (mode 600).` plus the next steps.
  - It never prints the token or the response body.

- [ ] **Step 1: Write the failing tests** in `scripts/tests/zapsign-create-tenant.test.sh`. They put a fake `curl` first on `PATH`. The fake writes `$FAKE_BODY` to the `-o` file, records its args in `$CURL_ARGS_LOG`, and prints `$FAKE_STATUS`:

```bash
#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../zapsign-create-tenant.sh"
fail=0
assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then echo "ok - $desc"; else
        echo "NOT OK - $desc"; echo "  expected: [$expected]"; echo "  actual:   [$actual]"; fail=1; fi
}

WORK="$(mktemp -d)"
mkdir -p "$WORK/bin"
cat > "$WORK/bin/curl" <<'FAKE'
#!/bin/bash
out=""
while [ $# -gt 0 ]; do
    printf '%s\n' "$1" >> "$CURL_ARGS_LOG"
    [ "$1" = "-o" ] && out="$2"
    shift
done
printf '%s' "$FAKE_BODY" > "$out"
printf '%s' "$FAKE_STATUS"
FAKE
chmod +x "$WORK/bin/curl"
export PATH="$WORK/bin:$PATH" CURL_ARGS_LOG="$WORK/curl-args" ZAPSIGN_PARTNER_TOKEN="partner-test-token"

run() { bash "$SCRIPT" "$@" 2>&1; }

export FAKE_STATUS=200 FAKE_BODY='{"id":4242,"name":"Construtora Teste","api_token":"sub-test-token"}'
out="$(run "Construtora Teste" "$WORK/tenant.token")"
assert_eq "saves the sub-account token" "sub-test-token" "$(cat "$WORK/tenant.token")"
assert_eq "restricts the token file to its owner" "600" "$(stat -f '%Lp' "$WORK/tenant.token" 2>/dev/null || stat -c '%a' "$WORK/tenant.token")"
assert_eq "reports the sub-account id" "1" "$(grep -c 'Sub-account 4242 created for "Construtora Teste"' <<< "$out")"
assert_eq "never prints the token" "0" "$(grep -c 'sub-test-token' <<< "$out" || true)"
assert_eq "posts the company name" "1" "$(grep -c '"company_name":"Construtora Teste"' "$CURL_ARGS_LOG")"
assert_eq "keeps the partner token off the command line" "0" "$(grep -c 'partner-test-token' "$CURL_ARGS_LOG" || true)"

if run "Construtora Teste" "$WORK/tenant.token" >/dev/null; then rc=0; else rc=1; fi
assert_eq "refuses to overwrite an existing token file" "1" "$rc"

export FAKE_STATUS=401 FAKE_BODY='{"detail":"secret account data"}'
if out="$(run "Outra" "$WORK/other.token")"; then rc=0; else rc=1; fi
assert_eq "fails on an HTTP error" "1" "$rc"
assert_eq "withholds the error body" "0" "$(grep -c 'secret account data' <<< "$out" || true)"
assert_eq "leaves no token file after an error" "no" "$([ -e "$WORK/other.token" ] && echo yes || echo no)"

export FAKE_STATUS=200 FAKE_BODY='{"id":1}'
if run "Sem token" "$WORK/none.token" >/dev/null; then rc=0; else rc=1; fi
assert_eq "fails when the response has no api_token" "1" "$rc"

unset ZAPSIGN_PARTNER_TOKEN
if run "Acme" "$WORK/acme.token" >/dev/null; then rc=0; else rc=1; fi
assert_eq "requires the partner token" "1" "$rc"

rm -rf "$WORK"
exit "$fail"
```

- [ ] **Step 2: Run the test and confirm it fails.** Run `bash scripts/tests/zapsign-create-tenant.test.sh`. Expect `No such file`.

- [ ] **Step 3: Implement** `scripts/zapsign-create-tenant.sh`:

```bash
#!/bin/bash
# Creates a ZapSign sub-account for one tenant (partner API) and saves its API
# token to a 0600 file. ZapSign shows the token ONCE: keep the file until the
# token is in the tenant's Portainer stack (ZAPSIGN_API_TOKEN), then delete it.
#
# Usage:
#   ZAPSIGN_PARTNER_TOKEN=... scripts/zapsign-create-tenant.sh "<company name>" <token-file>
# ZAPSIGN_API_BASE overrides the API base (default: production).
# Never prints the token or ZapSign's response body.
set -euo pipefail

ZAPSIGN_PRODUCTION_API="https://api.zapsign.com.br/api/v1"
SUBACCOUNT_COUNTRY="BR"
SUBACCOUNT_LANG="pt-br"
AVUZ_PRIMARY_COLOR="#2bb5e3"

die() { echo "error: $*" >&2; exit 1; }
command -v jq >/dev/null || die "jq is required"
company="${1:-}"
token_file="${2:-}"
[ -n "$company" ] && [ -n "$token_file" ] || die "usage: $0 \"<company name>\" <token-file>"
[ -n "${ZAPSIGN_PARTNER_TOKEN:-}" ] || die "ZAPSIGN_PARTNER_TOKEN is not set"
[ -e "$token_file" ] && die "$token_file exists — refusing to overwrite a token ZapSign shows only once"

api="${ZAPSIGN_API_BASE:-$ZAPSIGN_PRODUCTION_API}"
payload="$(jq -cn --arg name "$company" --arg country "$SUBACCOUNT_COUNTRY" \
    --arg lang "$SUBACCOUNT_LANG" --arg color "$AVUZ_PRIMARY_COLOR" \
    '{company_name: $name, country: $country, lang: $lang, primary_color: $color}')"
response="$(mktemp)"
trap 'rm -f "$response"' EXIT

status="$(curl -sS -o "$response" -w '%{http_code}' -X POST "$api/partner/company/" \
    -H @<(printf 'Authorization: Bearer %s\n' "$ZAPSIGN_PARTNER_TOKEN") \
    -H 'Content-Type: application/json' --data "$payload")"
[[ "$status" == 2?? ]] || die "ZapSign answered HTTP $status (body withheld: it can carry account data)"

api_token="$(jq -r '.api_token // empty' "$response")"
subaccount_id="$(jq -r '.id // empty' "$response")"
[ -n "$api_token" ] || die "ZapSign's answer has no api_token — check the partner account in the ZapSign panel"
(umask 077; printf '%s\n' "$api_token" > "$token_file")

echo "✓ Sub-account $subaccount_id created for \"$company\". Token saved to $token_file (mode 600)."
echo "Next (docs/assinaturas-tenant-runbook.md):"
echo "  1. ZapSign panel → sub-account → Preferências: turn ON 'Bloquear assinatura fora da ordem definida'."
echo "  2. Same panel: set the sender text and Reply-To for this tenant."
echo "  3. Portainer stack: ZAPSIGN_API_TOKEN (from the file), ZAPSIGN_ENVIRONMENT=production, ZAPSIGN_COMPANY_NAME. Redeploy."
echo "  4. Delete $token_file."
```

Fix the fake `curl` if needed: `-H @<(...)` passes `@/dev/fd/N` as an argument, so the token never appears in args. Keep the "keeps the partner token off the command line" test green.

- [ ] **Step 4: Write `docs/assinaturas-tenant-runbook.md`.** Keep it short and in the imperative. Sections:
  1. **One-time per zone:** the Cloudflare WAF skip rule. Expression: `(http.request.uri.path eq "/index.php/apps/assinaturas/webhook" and http.request.method eq "POST")`. Action: Skip all remaining custom rules, rate limiting rules, managed rules and Super Bot Fight Mode.
  2. **Provision a tenant:**
     - run the script;
     - in the ZapSign panel, turn on the out-of-order block and set the sender text and Reply-To;
     - set the Portainer env, then redeploy;
     - delete the token file.
  3. **Verify:**
     - `occ app:list --enabled | grep assinaturas`;
     - `occ config:app:get assinaturas api_token --details --output=json | grep -o '"sensitive":true'`;
     - `occ assinaturas:webhook:ensure` → `Webhooks: unchanged`;
     - container log line `✓ Assinaturas (<env>) configured`;
     - Administração → Assinaturas shows a green token check and the webhook types;
     - add the tenant's users to the `assinaturas` group.
  4. **Webhook smoke test:** an anonymous probe gets `401` JSON from the app, not a Cloudflare challenge. The first real send logs `POST /index.php/apps/assinaturas/webhook … 200` in `/var/log/nginx/access.log`.
  5. **Rotate the token:** change the env, then redeploy. **Turn off:** empty the token, then redeploy; the data is kept. **Restore a DB into another host:** `webhook:ensure` refuses until `--confirm-url-change`.

- [ ] **Step 5: Run the tests.** Run `bash scripts/tests/zapsign-create-tenant.test.sh && bash -n scripts/zapsign-create-tenant.sh`. Expect all `ok`.
- [ ] **Step 6: Commit.** Message: `feat(scripts): ZapSign tenant provisioning script and runbook`.

---

## Part C: staging on avuz-conecta-2 (controller-run)

The controller runs these tasks itself; they are operations, not subagent tasks. Staging is autonomous. Steps marked **[Patrick]** wait for him.

`<scratchpad>` below means the controller session's scratchpad directory. Target: stack **46**, container `avuz-conecta-2-app-1`, image `registry.avuz.app/admin/avuzconecta:staging-2`, `https://conectahml2.avuz.app`, Portainer endpoint 3. Every `portainer-exec.sh` call needs `PORTAINER_ENV_FILE=/Users/patrickrezende/work/avuz/avuz-server/scripts/deploy.env`. Run occ as `-u www-data`. The commands below abbreviate this as `c2exec`:

```bash
c2exec() { PORTAINER_ENV_FILE=/Users/patrickrezende/work/avuz/avuz-server/scripts/deploy.env \
  /Users/patrickrezende/work/avuz/avuz-server/scripts/portainer-exec.sh -u www-data avuz-conecta-2-app-1 "$@"; }
```

### Task 16: Build `:staging-2` from the golden checkout and deploy (no token yet)

- [ ] Merge the worktree branch into `avuz-customization` in the golden checkout `~/work/avuz/avuz-server`, with `--no-ff`. Leave its unrelated dirty files (`scripts/users.csv.example`, `scripts/who-was-on.sh`) untouched. Then:

```bash
cd ~/work/avuz/avuz-server && git submodule update --init apps/assinaturas
git -C apps/assinaturas rev-parse HEAD        # = APP_MAIN_SHA
ls 3rdparty/autoload.php apps/deck/vendor/autoload.php apps/integration_openai/vendor/autoload.php; ls apps | wc -l   # 55
```

- [ ] Build:

```bash
KEEP_DOCKER=1 ./scripts/build-push.sh latest staging 2 2>&1 | tee <scratchpad>/build-staging-2.log
```

The script exits 0 even on failure (memory trap 1). Require both `Successfully pushed` and a fresh `staging-2: digest: sha256:` line in the log.

- [ ] Inspect the image before deploying:

```bash
docker run --rm --platform linux/amd64 --entrypoint sh registry.avuz.app/admin/avuzconecta:staging-2 -c '
  cd /var/www/html/apps/assinaturas && ls && test -f js/assinaturas-main.mjs && ls dist/*.mjs \
  && test ! -e tests && test ! -e src && test ! -e design && grep -q assinaturas /var/www/html/docker/entrypoint.sh && echo IMAGE-OK'
```

Expect `IMAGE-OK`.

- [ ] Deploy around the known traps (memory `conecta-2-staging-deck-deploy`):
  1. Prune dangling images on endpoint 3.
  2. Do an explicit authenticated pull: `POST /api/endpoints/3/docker/images/create?fromImage=registry.avuz.app%2Fadmin%2Favuzconecta&tag=staging-2`, with `X-API-Key` and `X-Registry-Auth`. The registry credentials come from `docker-credential-desktop get <<< registry.avuz.app`; never echo them. Re-run the pull once on an overlayfs extract error.
  3. Run `./scripts/deploy.sh -y avuz-conecta-2`.
  4. Poll until the container's `ImageID` equals the pulled image and `c2exec php occ status` shows `installed: true`. A 2–3 minute `Restarting` window during the upgrade is normal.

- [ ] Verify the boot:
  - `c2exec php occ app:getpath assinaturas` → `/var/www/html/apps/assinaturas`.
  - `c2exec php occ app:list --enabled | grep -c assinaturas` → `0`, because there is no token yet.
  - The container logs show `– Assinaturas off: no ZAPSIGN_API_TOKEN`.
  - No `✗` lines. `custom_apps/assinaturas` is absent.
  - The deck, calendar and conectamail sentinels still pass, with `✓ Avuz patches present`.

### Task 17: Configure the sandbox on conecta-2

- [ ] **[Patrick]** In Portainer, open stack 46 → Editor and add under `environment:`:
  - `ZAPSIGN_API_TOKEN=<sandbox token>`
  - `ZAPSIGN_ENVIRONMENT=sandbox`
  - `ZAPSIGN_COMPANY_NAME=Avuz Conecta (homologação)`

  Then click "Update the stack". The token never passes through chat. Also confirm in the **sandbox** ZapSign panel that "Bloquear assinatura fora da ordem definida" is on.
- [ ] Verify:
  - `c2exec php occ config:system:get overwrite.cli.url` → `https://conectahml2.avuz.app`. If it differs, stop and ask: the webhook URL is built from it.
  - The logs show `✓ Assinaturas (sandbox) configured`.
  - `c2exec php occ app:list --enabled | grep assinaturas` shows the version from the image.
  - `c2exec php occ config:app:get assinaturas api_token --details --output=json | grep -o '"sensitive":true'` (prints only the flag).
  - `c2exec php occ assinaturas:webhook:ensure` → `Webhooks: unchanged`.
  - `c2exec php occ group:list | grep -A2 assinaturas` shows the group exists.
- [ ] Restart the container once (Portainer container restart) and check the boot is steady: no `app:disable`/`app:enable` and no `Reconciling assinaturas` in the logs; `✓ Assinaturas (sandbox) configured` again.

### Task 18: Webhook reachability through Cloudflare

- [ ] Run an anonymous probe from this machine:

```bash
curl -sS -D - -o <scratchpad>/probe.json -X POST https://conectahml2.avuz.app/index.php/apps/assinaturas/webhook -H 'Content-Type: application/json' -d '{}'
```

  Expect HTTP `401` with body `{"error":"unauthorized"}` from the app. A Cloudflare challenge would show `cf-mitigated: challenge` or a 403 HTML page.
- [ ] **[Patrick]** Add the zone-wide WAF skip rule from `docs/assinaturas-tenant-runbook.md` §1 on the `avuz.app` zone. Do it even when the probe passes: ZapSign's servers are scored differently from ours. Patrick confirms when it's done.
- [ ] Real delivery is verified in Task 20, step 2.

### Task 19: Browser smoke test on staging (desktop)

The in-app browser at 1280×800. **[Patrick]** signs in once in the browser pane; the controller never types passwords on staging. Patrick's account must be an admin or in the `assinaturas` group.

- [ ] Put the E2E PDFs in Patrick's Drive folder `Assinaturas E2E`:
  - `tests/spike/output/pdfs/portrait.pdf`
  - `tests/spike/output/geo-mixed-pages.pdf`
  - `tests/spike/output/geo-rotated-90.pdf`
  - a JPEG2000 scan made with `sips -s format jpeg2000 <any png> --out <scratchpad>/scan.jp2` and the generator below.

  Upload them with a Docker archive `PUT` into `data/<patrick-uid>/files/Assinaturas E2E/`. Use `tar --no-xattrs --no-mac-metadata`, then run `c2exec php occ files:scan --path="<patrick-uid>/files/Assinaturas E2E"`. Find the uid with `c2exec php occ user:list`. The JPX generator, kept in the scratchpad and not committed:

```php
<?php
// php make-jpx-pdf.php scan.jp2 scan.pdf <widthPx> <heightPx>
[, $jp2Path, $outPath, $width, $height] = $argv;
$jp2 = file_get_contents($jp2Path);
$content = 'q 595 0 0 842 0 0 cm /Im1 Do Q';
$objects = [
	'<< /Type /Catalog /Pages 2 0 R >>',
	'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
	'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>',
	"<< /Type /XObject /Subtype /Image /Width $width /Height $height /Filter /JPXDecode /Length " . strlen($jp2) . " >>\nstream\n$jp2\nendstream",
	'<< /Length ' . strlen($content) . " >>\nstream\n$content\nendstream",
];
$pdf = "%PDF-1.5\n";
$offsets = [];
foreach ($objects as $index => $body) {
	$offsets[$index + 1] = strlen($pdf);
	$pdf .= ($index + 1) . " 0 obj\n$body\nendobj\n";
}
$xref = strlen($pdf);
$pdf .= sprintf("xref\n0 %d\n0000000000 65535 f \n", count($objects) + 1);
foreach ($offsets as $offset) {
	$pdf .= sprintf("%010d 00000 n \n", $offset);
}
$pdf .= sprintf("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", count($objects) + 1, $xref);
file_put_contents($outPath, $pdf);
```

- [ ] Check each item, keeping the console open (`read_console_messages`, `onlyErrors`) and watching the network:
  1. The Files row menu on one PDF shows "Enviar para assinatura" and opens a new draft wizard with that document.
  2. A multi-select of two PDFs → the bulk action → one draft with both.
  3. Selecting a non-PDF hides the action.
  4. The sidebar tab "Assinaturas" on a PDF in a sent envelope shows its status; on a plain PDF it shows the empty state.
  5. Administração → Assinaturas: badge "Sandbox", token check green, webhook types listed, company name shown.
  6. The lazy chunks (`js/*.chunk.mjs`), `dist/pdf.worker.min-*.mjs` and `js/pdfjs/**` all load with 200.
  7. **No CSP violation** in the console.
  8. The JPX scan renders in the placement editor. Record any JpxImage/wasm warning.
  9. The rotated and mixed-size PDFs show auto-placed boxes on the correct pages. The Avuz help launcher doesn't cover "Próxima página" or the FAB.
  10. Screenshots match the artboards at 1280 for the dashboard, wizard steps 1–4 and the detail view. Log any regression as a fix task.

### Task 20: Sandbox end-to-end on staging

Signers: `patrick@avuz.cloud` (group 1) and `patrick.dm.rezende@gmail.com` (group 2). **[Patrick]** reads both inboxes and signs.

- [ ] **Envelope 1:**
  - three documents (portrait, mixed pages, rotated 90);
  - ordered signers in two groups;
  - Rubrica toggled on for the first document;
  - auto placement plus one manual drag;
  - send.
- [ ] Verify:
  1. The envelope status is "Aguardando assinaturas".
  2. The access log shows a `doc_created` webhook within a minute: `c2exec sh -c "grep 'apps/assinaturas/webhook' /var/log/nginx/access.log | tail -5"` shows `POST … 200`.
  3. Signer 1's email arrives. Record **whether the custom message "…, da Avuz Conecta (homologação), enviou documentos…" shows in the released email**. This is spec §7's open item; record it in `sandbox-findings.md`.
  4. Signer 2 opens their direct link before signer 1 signs; the signature must be blocked.
  5. "Lembrar" on signer 1 respects the cooldown copy ("Disponível em N min").
  6. Signer 1 signs → group 2 is emailed by ZapSign → signer 2 signs.
  7. Within ~5 minutes (cron): status "Concluído", and the signed PDFs sit next to each original as `<name> (assinado).pdf`.
  8. Both signers receive their copy, and the sender's Nextcloud notification arrives.
  9. The detail timeline lists every step.
- [ ] **Envelope 2 (bounce + correction):**
  - signer `zz-avuz-bounce-<random>@gmail.com`; send;
  - wait up to 30 minutes for an `email_bounce` webhook. Record the outcome either way; spec §10 says to verify a real bounce on staging;
  - then use "Corrigir e-mail" to `patrick.dm.rezende@gmail.com` and check the cooldown copy ("Convite sai em N min") and the delivery.
- [ ] **Envelope 3 (cancel):** send, cancel with a reason. Check the status "Cancelado" and the ZapSign cancel email.
- [ ] **Envelope 4 (deadline):** extend the deadline on a pending envelope; check the detail shows the new date.
- [ ] Record the results in `docs/zapsign/sandbox-findings.md` under a new section "Plan 4 staging E2E (conecta-2)". Each failure becomes a fix task: app repo → info.xml bump → submodule pin bump → rebuild → redeploy, as in C1. **After any JS-only redeploy, Patrick purges the Cloudflare cache.** NC serves app JS under the core `?v=` hash, which a JS rebuild doesn't change (memory `deck-js-cachebust-version-bump`).

### Task 21: Real-phone validation

- [ ] **[Patrick]** opens `https://conectahml2.avuz.app` on his phone and signs in. On a draft with the three PDFs he checks:
  - placement: pinch-zoom anchored under the fingers; one-finger scroll through pages; drag a box; resize from the outward handles and the small-box single handle; select/delete; no blank pages after a pinch;
  - the phone dashboard (cards, FAB, search) and the phone detail (signer actions, sheet);
  - the wizard steps 1–4.

  Patrick reports what's off. Each defect becomes a fix task with the same loop as C5.
- [ ] The controller records the result in the ledger and in `design/README.md`'s known differences, if any remain by decision.

### Task 22: Rebuild the local test image

- [ ] From the golden checkout: `KEEP_DOCKER=1 ./scripts/build-push.sh latest local`. This is arm64 and carries the help-widget pointer-events fix `f8b15136ee0` plus the app.
- [ ] In the app repo, run:
  - `tests/env/phpunit.sh`: the image change rebuilds the test env, then the suite re-seeds the preview;
  - `npm test`;
  - `tests/env/serve.sh reload`.

  Expect both suites green. At localhost:8088, the dashboard's bottom-right controls ("Próxima página", the phone FAB) take clicks with the help launcher present.

---

## Part D: close

### Task 23: Docs, roadmap, memory

- [ ] Spec (`docs/superpowers/specs/2026-09-28-assinaturas-zapsign-design.md`):
  - §8: the app has no runtime Composer dependencies, so no `vendor/` is shipped; only `js/` and `dist/` are committed builds.
  - §7 Signer-facing content: `brand_logo` = `<overwrite.cli.url>/apps/avuz_theme/img/logo-login.png`. The theme holds only Avuz assets (Patrick, 2026-10-02). An app-config `brand_logo_url` override wins.
  - §4: the entrypoint validates the env (the app is disabled on an invalid environment or a missing company) and reconciles the app version every boot. The group comes from the app's repair step.
  - §8 Rollout: step 1 = **avuz-conecta-2** (stack 46), Patrick 2026-10-02; the pilot = **app3**, in Plan 5.
- [ ] Roadmap: Plan 4 row = Done with commits, the staging result and the minors closed. Add a **Plan 5** row, "Production pilot (app3) + fleet", that is not written yet. Its scope:
  - production sub-account via the script;
  - Spike 5 owner-inbox check;
  - sender text and Reply-To;
  - first real envelope;
  - then the fleet via `deploy-prod.sh`, gated per action.
- [ ] `docs/zapsign/sandbox-findings.md` carries the C5 results.
- [ ] Memory: update `signature-module-feasibility.md` and its MEMORY.md line (Plan 4 done; staging on conecta-2; Plan 5 next).
- [ ] Commit in the avuz-server worktree, then merge into `avuz-customization`.
