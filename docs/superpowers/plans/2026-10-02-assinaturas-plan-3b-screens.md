# Assinaturas Plan 3b: Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build every user-facing screen of Assinaturas exactly as the approved mockups show them:
- the dashboard with server-side search;
- the full-page 4-step wizard;
- the placement editor on desktop and phone;
- the envelope detail;
- the Files sidebar tab.

**Architecture:**
- The backend gains:
  - a paged, filtered, searchable list;
  - document editing on drafts;
  - a route that streams a draft's source PDF;
  - notification links.
- The frontend gets its own small UI kit (`src/ui/`). It reproduces the mockups' visual language pixel for pixel on native, accessible elements. It does **not** restyle `@nextcloud/vue` components.
- Screens are lazy-loaded routes on TanStack Vue Query data.
- pdf.js renders pages for the placement editor. Placement geometry and auto-placement are pure, unit-tested TypeScript.

**Tech Stack:**
- Already in place from Plan 3a: Vue 3.5, vue-router 4, `@tanstack/vue-query` 5, Vite 7 via `@nextcloud/vite-config` 2.5, Vitest 4 + happy-dom.
- New: `lucide-vue-next` for icons and `pdfjs-dist` **5.7.284**.
- Backend: PHP 8 / Nextcloud 33 with the PHPUnit Docker harness.

**Spec:** [`../specs/2026-09-28-assinaturas-zapsign-design.md`](../specs/2026-09-28-assinaturas-zapsign-design.md), §7 "Frontend decisions (Patrick, 2026-10-02)".
**API contract:** `docs/api.md` in the app repo. Every task that changes a route updates it.
**Approved design (MANDATORY):** canvas https://claude.ai/artifact/7Qs5Jz6mJcSH6sY8KTbGGx. The artboard sources are committed by Task 1 to `design/mockups/*.dc.html` in the app repo.

## The mockups are the spec

Patrick, 2026-10-02: *"the mockup is the mandatory … we should not adapt to nextcloud style"*.

**Rules:**
- **Values:** every colour, size, radius, spacing, font size and string comes from the artboard's `.dc.html` source. Read the inline styles. Do not eyeball the rendered result, and do not round values.
- **Copy:** the Portuguese copy in the artboards is the pt_BR translation. Source strings stay English (`t('assinaturas', 'Meus envelopes')` is wrong; `t('assinaturas', 'My envelopes')` with pt_BR `"Meus envelopes"` is right).
- **Components:** use the UI kit in `src/ui/`, not `NcButton`, `NcTextField`, `NcAppNavigation*`, `NcEmptyContent`, `NcSelect` or `NcDialog`. The kit is built on native elements (`<button>`, `<a>`, `<input>`, `<select>`, `<dialog>`), so accessibility comes from the platform.
  - Still allowed: `@nextcloud/dialogs` toasts and `pickNodes`, `@nextcloud/l10n`, `@nextcloud/router`, `@nextcloud/axios`, `@nextcloud/files`.
- **Allowed deviations:** only these, each listed in the task that makes it:
  1. **The Nextcloud header stays.** The phone artboards show only the app bar, but on a real phone Nextcloud's own header sits above it. Hiding it would cut users off from the other apps.
  2. **ZapSign's stamp is wider than the box.** ZapSign prints the attestation text to the right of each box, about 2.5× the box width (sandbox finding 9). Auto-placement therefore wraps the boxes into rows sized to that footprint (two per row on A4) instead of three in one row. The editor draws the footprint as a faint extension of each box.
  3. **Status changes need feedback the mockups don't show.** Toasts (`@nextcloud/dialogs`), loading skeletons and dialogs follow the kit's vocabulary.
- **Conformance:** Task 19 compares every screen against its artboard in a browser, at 1440×900 and 390×844.

## Global Constraints

Plan 1, 2a, 2b and 3a constraints still apply:
- never log or return ZapSign tokens or sign URLs, except through the one sign-link route;
- commits carry no AI attribution;
- tests never reach the real ZapSign;
- never run `tests/env/reset.sh` (it wipes the sandbox token).

**TypeScript and code style** (Patrick's guidelines, unchanged from 3a)
- No `any`. Almost never use `as`; `as const` is fine. Type guards over casts. API types live once in `src/api/types.ts`.
- Named exports only, no barrels. `async`/`await`. Early returns. Hash maps instead of `switch`.
- SNAKE_CAPS constants, camelCase functions, kebab-case `.ts` files, PascalCase `.vue` files. No abbreviations.
- No magic strings or numbers: query keys only from `src/api/query-keys.ts`; design tokens only from `src/styles/identity.css` custom properties (`var(--av-…)`); route names only from `ROUTE_NAMES`.
- No module-level mutable state in components. No data fetching in `onMounted` or watchers; use `useQuery`/`useMutation`.
- Props named `appName`/`appVersion` must be written hyphenated, because vite-config replaces those identifiers.

**Accessibility** (WCAG 2.0 AA)
- Real elements; every control labelled; icon-only buttons carry `aria-label`; touch targets ≥ 44px (chips 40px tall, inside a 44px row).
- Text contrast ≥ 4.5:1. That is why primary fills are `#00679e`, not the brand `#2bb5e3`.
- Status is never colour alone: always a dot or icon plus text.
- Visible focus ring: `outline: 2px solid var(--av-brand); outline-offset: 2px` on `:focus-visible` for every kit control.

**l10n**
- English source strings through `t`/`n`. Every new string goes into `l10n/pt_BR.json` and `l10n/pt_BR.js` in the same task, with the exact mockup copy as its translation.
- Plural keys use `"_singular_::_plural_"` (guarded by `src/l10n.spec.ts`).

**Build and deploy**
- Run `npm run build` (production) before each commit that touches `src/`.
- Commit built `js/`, `css/` and `js/pdfjs/` assets together with their sources.
- Bump `appinfo/info.xml` `<version>` (patch) once per task that changes built JS or PHP routes. Apply the bump with `tests/env/php.sh occ upgrade`.
  - If upgrade complains about stale bundled apps: disable `bruteforcesettings`, `files_downloadlimit`, `notifications` and `text`; run `occ upgrade`; run `occ maintenance:mode --off`; then `occ app:enable --force` for those four.
  - Run `occ upgrade` BEFORE the PHP tests after a bump.
- Check `docker ps` for stray phpunit containers before running PHP tests. Never leave a test run going.

**Tests**
- Vitest specs in `src/**/*.spec.ts` test behaviour (rendered text, emitted events, API calls), not implementation. Mock `@nextcloud/axios` with `vi.mock`.
- PHP integration tests follow `tests/Integration/Controller/EnvelopeControllerTest.php`: `@group DB`, `TestUsers`, `EnvelopeCleanup`.
- Test names use third-person verbs (`it('lists …')`, `testListsOnlyDrafts`). Use nested `describe` blocks freely.

**Responsive**
- Desktop layout at ≥ 1024px; phone layout below 1024px.
- One breakpoint token: `--av-phone-max: 1023px` in CSS, and `PHONE_MEDIA_QUERY = '(max-width: 1023px)'` in `src/layout/viewport.ts`.

---

## File Structure (app repo `~/work/avuz/assinaturas`)

```
design/mockups/*.dc.html, design/README.md     approved artboards (read-only reference)
tests/env/serve.sh                             local web server for the preview env (localhost:8088)
tests/env/seed-demo.php                        demo data matching the mockups
tests/env/preview-user.env                     preview login (test-only, localhost)
lib/Db/EnvelopeFilter.php                      status filter groups (enum)
lib/Db/EnvelopeSort.php                        list orderings (enum)
lib/Db/EnvelopeSearch.php                      list query value object
lib/Db/EnvelopeMapper.php                      + search(), countByStatus()
lib/Draft/EnvelopeDrafts.php                   + search(), replaceDocuments(), sourceOf()
lib/Api/EnvelopeDetails.php, EnvelopeView.php  + listing(), document name/size
lib/Controller/EnvelopeController.php          list params, PUT documents, GET source
lib/Notification/Notifier.php                  + link + icon
src/styles/identity.css                        design tokens + base
src/ui/                                        UI kit (Av*.vue)
src/layout/                                    AppFrame, AppNavigation, PhoneAppBar, frame-layout, viewport
src/presentation/                              status/signer/event/date/colour/cooldown helpers
src/api/error-messages.ts                      error code → pt_BR text
src/dashboard/                                 dashboard screen
src/envelope/EnvelopeView.vue                  draft → wizard, else detail
src/detail/                                    detail screen
src/wizard/                                    wizard shell + documents/signers/review steps
src/pdf/                                       pdf.js loader, document query, page canvas
src/placement/                                 geometry, auto-placement, editor
src/files/sidebar-tab.ts, FilesSidebarTab.vue  Files sidebar tab
scripts/copy-pdfjs-assets.mjs                  copies pdf.js cmaps/fonts/wasm into js/pdfjs/
```

Remove `src/views/ComingSoonView.vue` and `src/components/AppShell.vue` when the routes stop using them (Task 6).

---

### Task 1: Mockups in the repo and a local preview environment

The controller copies the artboards before dispatching this task:

```bash
mkdir -p ~/work/avuz/assinaturas/design/mockups
cp /private/tmp/claude-501/-Users-patrickrezende-work-avuz-avuz-server--claude-worktrees-avuzconecta-signature-feasibility-59ecdd/78b12568-bfdb-4272-be12-5483097da8a5/scratchpad/assinaturas-design/project/*.dc.html ~/work/avuz/assinaturas/design/mockups/
```

**Files:**
- Create: `design/README.md`, `tests/env/serve.sh`, `tests/env/seed-demo.php`, `tests/env/preview-user.env`
- Modify: `README.md` (a "Preview" section)

**Interfaces:**
- Produces:
  - `tests/env/serve.sh start|stop`. It serves the test env at `http://localhost:8088` with this checkout mounted as `apps/assinaturas`.
  - `tests/env/php.sh apps/assinaturas/tests/env/seed-demo.php`. It creates the preview user (credentials in `tests/env/preview-user.env`), Drive PDFs and the demo envelopes the mockups show.
  - Every UI task and Task 19 use these.

- [ ] **Step 1: `design/README.md`**

```markdown
# Approved design

Canvas: https://claude.ai/artifact/7Qs5Jz6mJcSH6sY8KTbGGx (approved by Patrick on 2026-10-02).
`mockups/*.dc.html` are the artboard sources. They are the visual spec: copy colours, sizes,
radii, spacing and copy from their inline styles. Do not edit them; ask for a canvas change instead.

| Artboard | Screen | Size |
|---|---|---|
| Main.dc.html | Dashboard | 1440×900 |
| Wizard-Documents.dc.html | Wizard step 1 | 1440×900 |
| Wizard-Signers.dc.html | Wizard step 2 | 1440×900 |
| Wizard-Placement.dc.html | Wizard step 3 (editor) | 1440×900 |
| Wizard-Review.dc.html | Wizard step 4 | 1440×900 |
| Detail.dc.html | Envelope detail | 1440×900 |
| Files-Sidebar.dc.html | Files sidebar tab | 1440×900 |
| Phone-Dashboard.dc.html | Dashboard (phone) | 390×844 |
| Phone-Placement.dc.html | Editor (phone) | 390×844 |
| Phone-Detail.dc.html | Detail (phone) | 390×844 |
```

- [ ] **Step 2: `tests/env/preview-user.env`.** These are test-only credentials for the local preview at localhost:8088. Never reuse them anywhere else.

```bash
PREVIEW_USER=patrick.preview
PREVIEW_DISPLAY_NAME="Patrick Rezende"
PREVIEW_PASSWORD=preview-only-Assinaturas-2026
```

- [ ] **Step 3: Find how the image serves HTTP.** Run:

```bash
docker run --rm --entrypoint sh avuzconecta:latest -c 'command -v nginx php-fpm php-fpm8.3 php-fpm83 supervisord; ls /etc/nginx /etc/supervisor* 2>/dev/null | head -40'
```

Write `serve.sh` with the binaries and config paths it reports. The expected shape:

```bash
#!/usr/bin/env bash
# Serves the local Assinaturas test env at http://localhost:8088 for visual checks.
# LOCAL ONLY. Uses the same config/data volumes and network as php.sh / phpunit.sh.
set -euo pipefail

IMAGE="${ASSINATURAS_TEST_IMAGE:-avuzconecta:latest}"
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CONTAINER=assinaturas-test-web
PORT=8088

stop() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }

start() {
	stop
	docker run -d --name "$CONTAINER" --network assinaturas-test-net -p "127.0.0.1:$PORT:80" \
		-v assinaturas-test-config:/var/www/html/config \
		-v assinaturas-test-data:/var/www/html/data \
		-v "$APP_DIR:/var/www/html/apps/assinaturas" \
		--tmpfs /var/www/html/apps/assinaturas/vendor/nextcloud/ocp \
		--entrypoint sh "$IMAGE" -c 'php-fpm -D && exec nginx -g "daemon off;"' >/dev/null
	"$(dirname "$0")/php.sh" occ config:system:set trusted_domains 9 --value="localhost:$PORT" >/dev/null
	"$(dirname "$0")/php.sh" occ config:system:set overwrite.cli.url --value="http://localhost:$PORT" >/dev/null
	"$(dirname "$0")/php.sh" occ app:enable avuz_theme >/dev/null || true
	echo "http://localhost:$PORT"
}

case "${1:-start}" in
	start) start ;;
	stop) stop ;;
	*) echo "usage: $0 start|stop" >&2; exit 64 ;;
esac
```

If the image's nginx config expects a different user, socket or port, adapt the `-c` command, not the volumes. Do NOT run the image's own entrypoint. It rewrites config and theming.

- [ ] **Step 4: `seed-demo.php`.** It bootstraps Nextcloud and is idempotent: it deletes the preview user's envelopes first, using the `EnvelopeCleanup` logic. It creates:
  - the user from `preview-user.env`, read with `parse_ini_file`, in group `SignersGroup::GROUP_ID`, plus the admin flag;
  - Drive PDFs `Contratos/2026/Contrato de prestação de serviços.pdf` (6 pages), `Anexo I — Escopo.pdf` (2), `Anexo II — Tabela de preços.pdf` (1), `Proposta comercial — 4º trimestre.pdf` (1), built by `demoPdf()` below;
  - the 7 envelopes of `design/mockups/Main.dc.html`'s `ROWS`, with the same titles, statuses, signer counts and deadlines.
    - "Contrato de prestação de serviços" gets the 3 documents and the signers Ana Lima (group 1, signed), Bruno Costa (group 1, viewed, `email_bounced_at` set, `last_reminder_at` = now − 6 min), and Carla Souza (group 2, pending). It also gets the Detail artboard's timeline events.
    - The draft "Termo de confidencialidade" gets 1 document and no signers.

Non-draft statuses are written straight through the mappers. The seed never calls ZapSign.

```php
<?php

declare(strict_types=1);

// Usage: tests/env/php.sh apps/assinaturas/tests/env/seed-demo.php
// LOCAL PREVIEW ONLY: writes demo envelopes straight into the test database.

require_once '/var/www/html/lib/base.php';

use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Db\EnvelopeMapper;
use OCA\Assinaturas\Db\EnvelopeStatus;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Db\SignerStatus;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Sync\EnvelopeEvents;
use OCP\Files\IRootFolder;
use OCP\IGroupManager;
use OCP\IUserManager;
use OCP\Server;

/** A valid PDF with $pageCount A4 pages, each showing $title and grey text bars. */
function demoPdf(string $title, int $pageCount): string {
	$objects = [];
	$objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
	$kids = [];
	$fontId = 3;
	$objects[$fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
	$next = 4;
	for ($page = 1; $page <= $pageCount; $page++) {
		$pageId = $next++;
		$contentId = $next++;
		$kids[] = "$pageId 0 R";
		$bars = '';
		for ($line = 0; $line < 18; $line++) {
			$width = 400 - (($line * 37) % 160);
			$top = 700 - $line * 28;
			$bars .= "0.85 g 72 $top $width 8 re f\n";
		}
		$text = sprintf("BT /F1 18 Tf 0 g 72 760 Td (%s - pagina %d) Tj ET\n", preg_replace('/[^\x20-\x7E]/', '', $title), $page);
		$stream = $text . $bars;
		$objects[$contentId] = sprintf("<< /Length %d >>\nstream\n%sendstream", strlen($stream), $stream);
		$objects[$pageId] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 $fontId 0 R >> >> /Contents $contentId 0 R >>";
	}
	$objects[2] = sprintf('<< /Type /Pages /Kids [%s] /Count %d >>', implode(' ', $kids), $pageCount);
	ksort($objects);
	$pdf = "%PDF-1.4\n";
	$offsets = [];
	foreach ($objects as $id => $body) {
		$offsets[$id] = strlen($pdf);
		$pdf .= "$id 0 obj\n$body\nendobj\n";
	}
	$xref = strlen($pdf);
	$pdf .= sprintf("xref\n0 %d\n0000000000 65535 f \n", count($objects) + 1);
	foreach ($offsets as $offset) {
		$pdf .= sprintf("%010d 00000 n \n", $offset);
	}
	return $pdf . sprintf("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", count($objects) + 1, $xref);
}
```

The rest of the script follows the steps above. Use `EnvelopeDrafts::create($uid, $title, $fileIds)` and `EnvelopeDrafts::replaceSigners(...)`, checking the exact signatures in `lib/Draft/EnvelopeDrafts.php`. Then set status, `sentAt` and `deadlineAt` with `EnvelopeMapper::update`, signer state with `SignerMapper::update`, and events with `EnvelopeEvents::record($envelopeId, $signerId, $type, $dedupeMoment, $occurredAt, $detail, $actorUid)`. Print one line per envelope created. It prints no secrets: the password lives only in the env file.

- [ ] **Step 5: Verify.** Run `tests/env/serve.sh start`, then `tests/env/php.sh apps/assinaturas/tests/env/seed-demo.php`. Then `curl -s -o /dev/null -w '%{http_code}' http://localhost:8088/status.php` should return `200`, and running the seed a second time should print the same envelopes, not duplicates.

- [ ] **Step 6: README "Preview" section, then commit.** The README section shows the two commands and says it is for local visual checks only. Then commit:

```bash
git add design tests/env/serve.sh tests/env/seed-demo.php tests/env/preview-user.env README.md
git commit -m "chore: add the approved mockups and a local preview environment"
```

---

### Task 2: Server-side listing (search, filters, paging, counts, file lookup)

**Files:**
- Create: `lib/Db/EnvelopeFilter.php`, `lib/Db/EnvelopeSort.php`, `lib/Db/EnvelopeSearch.php`, `tests/Integration/Db/EnvelopeMapperSearchTest.php`
- Modify: `lib/Db/EnvelopeMapper.php`, `lib/Draft/EnvelopeDrafts.php` (`search()`; keep `listFor` until the controller switches, then delete it), `lib/Api/EnvelopeDetails.php` (`listing()`), `lib/Controller/EnvelopeController.php` (`index`), `tests/Integration/Controller/EnvelopeControllerTest.php`, `docs/api.md`, `appinfo/info.xml`
- Frontend: `src/api/types.ts`, `src/api/envelopes.ts` (`listEnvelopes`), `src/api/query-keys.ts`, `src/api/envelopes.spec.ts`

**Interfaces:**
- Produces (HTTP): `GET /api/v1/envelopes?scope=mine|all&filter=all|draft|pending|completed|refused|expired|cancelled|failed&search=<text>&sort=recent|deadline&page=1&perPage=25&fileId=<int>`. It answers 200 `{"envelopes": [summary…], "total": int, "page": int, "perPage": int, "counts": {"all": int, "draft": int, "pending": int, "completed": int, "refused": int, "expired": int, "cancelled": int, "failed": int}}`.
  - `counts` honour scope, search and fileId, but not filter, so each chip shows how many it would list.
  - `pending` covers `pending`, `sending` and `finalizing`.
  - `all` includes `archived_sandbox`. No other filter does.
  - Invalid params answer 422 `list_query_invalid`:
    - unknown filter or sort;
    - `page` < 1;
    - `perPage` outside 1..100;
    - `search` longer than 100 characters after trimming.
  - `fileId` matches envelopes whose documents have `source_file_id` or `signed_file_id` equal to it.
- Produces (TS):
  - `type EnvelopeFilter = 'all' | 'draft' | 'pending' | 'completed' | 'refused' | 'expired' | 'cancelled' | 'failed'`
  - `type EnvelopeSort = 'recent' | 'deadline'`
  - `interface EnvelopeListQuery { scope: EnvelopeScope; filter: EnvelopeFilter; search: string; sort: EnvelopeSort; page: number; perPage: number; fileId: number | null }`
  - `interface EnvelopeListing { envelopes: EnvelopeSummary[]; total: number; page: number; perPage: number; counts: Record<EnvelopeFilter, number> }`
  - `listEnvelopes(query: EnvelopeListQuery): Promise<EnvelopeListing>`
  - `QUERY_KEYS.envelopes(query: EnvelopeListQuery)` → `['envelopes', query]`
  - `QUERY_KEYS.allEnvelopes()` → `['envelopes']` (prefix used for invalidation)

- [ ] **Step 1: Write the failing mapper test** (`tests/Integration/Db/EnvelopeMapperSearchTest.php`). Use the same base class, traits and setUp/tearDown as `EnvelopeControllerTest`. Create drafts through `EnvelopeDrafts::create` with files from `writeFile`, then set statuses with `EnvelopeMapper::update`. Cases, each its own test:
  - `testFiltersByStatusGroup`: a `sending` and a `pending` envelope both match `EnvelopeFilter::Pending`, and a `draft` does not.
  - `testSearchesTitleFileNameAndSignerCaseInsensitively`: titles "Contrato A" and "Proposta". A file named `Anexo Zeta.pdf` on the second. Signer "Carla Souza" <carla@x.com> on the first. `search: 'contrato'` finds the first only; `'zeta'` the second only; `'CARLA@'` the first only; `'50%'` finds nothing (the `%` is escaped, not a wildcard).
  - `testLimitsToOwnerUnlessEveryone`: another user's envelope is excluded when `ownerUid` is set and included when it is null.
  - `testPagesNewestFirst`: 3 envelopes with ascending `updated_at`, offset 1 limit 1 returns the middle one.
  - `testSortsByDeadlineWithoutDeadlineLast`: deadlines `+5d`, null and `+1d` come back in the order `+1d`, `+5d`, null.
  - `testFindsByFileIdInSourceOrSignedCopy`: a match on `source_file_id`, a match on `signed_file_id`, and no match on another file.
  - `testCountsPerStatusIgnoringFilter`: `countByStatus(...)` returns `['draft' => 1, 'pending' => 1, 'sending' => 1]` for those three.

- [ ] **Step 2: Run the test and see it fail.** Run `tests/env/phpunit.sh --filter EnvelopeMapperSearchTest`. Expected: an error that the class `EnvelopeFilter` was not found.

- [ ] **Step 3: Implement the enums and the value object.**

```php
<?php
// lib/Db/EnvelopeFilter.php
declare(strict_types=1);

namespace OCA\Assinaturas\Db;

/** The dashboard's status chips; each groups one or more envelope statuses. */
enum EnvelopeFilter: string {
	case All = 'all';
	case Draft = 'draft';
	case Pending = 'pending';
	case Completed = 'completed';
	case Refused = 'refused';
	case Expired = 'expired';
	case Cancelled = 'cancelled';
	case Failed = 'failed';

	/** @return list<EnvelopeStatus>|null null = no status condition */
	public function statuses(): ?array {
		return match ($this) {
			self::All => null,
			self::Draft => [EnvelopeStatus::Draft],
			self::Pending => [EnvelopeStatus::Pending, EnvelopeStatus::Sending, EnvelopeStatus::Finalizing],
			self::Completed => [EnvelopeStatus::Completed],
			self::Refused => [EnvelopeStatus::Refused],
			self::Expired => [EnvelopeStatus::Expired],
			self::Cancelled => [EnvelopeStatus::Cancelled],
			self::Failed => [EnvelopeStatus::Failed],
		};
	}
}
```

```php
<?php
// lib/Db/EnvelopeSort.php
declare(strict_types=1);

namespace OCA\Assinaturas\Db;

enum EnvelopeSort: string {
	case Recent = 'recent';
	case Deadline = 'deadline';
}
```

```php
<?php
// lib/Db/EnvelopeSearch.php
declare(strict_types=1);

namespace OCA\Assinaturas\Db;

/** One dashboard list request, already validated. */
final class EnvelopeSearch {
	public function __construct(
		public readonly ?string $ownerUid,
		public readonly EnvelopeFilter $filter,
		public readonly ?string $text,
		public readonly ?int $fileId,
		public readonly EnvelopeSort $sort,
		public readonly int $offset,
		public readonly int $limit,
	) {
	}
}
```

- [ ] **Step 4: Implement the mapper.** Add to `EnvelopeMapper`. The search conditions live in a sub-select on documents and signers, and every parameter is bound on the outer query.

```php
	private const ALIAS = 'e';

	/** @return list<Envelope> */
	public function search(EnvelopeSearch $search): array {
		$query = $this->db->getQueryBuilder();
		$query->select(self::ALIAS . '.*')->from(self::TABLE, self::ALIAS);
		$this->applyConditions($query, $search);
		$statuses = $search->filter->statuses();
		if ($statuses !== null) {
			$query->andWhere($query->expr()->in(self::ALIAS . '.status', $query->createNamedParameter(
				array_map(fn (EnvelopeStatus $status): string => $status->value, $statuses),
				IQueryBuilder::PARAM_STR_ARRAY,
			)));
		}
		$this->applySort($query, $search->sort);
		$query->setFirstResult($search->offset)->setMaxResults($search->limit);
		return $this->findEntities($query);
	}

	/** @return array<string, int> status value => number of envelopes */
	public function countByStatus(EnvelopeSearch $search): array {
		$query = $this->db->getQueryBuilder();
		$query->select(self::ALIAS . '.status')
			->selectAlias($query->func()->count(self::ALIAS . '.id'), 'total')
			->from(self::TABLE, self::ALIAS)
			->groupBy(self::ALIAS . '.status');
		$this->applyConditions($query, $search);
		$result = $query->executeQuery();
		$counts = [];
		while (($row = $result->fetch()) !== false) {
			$counts[(string)$row['status']] = (int)$row['total'];
		}
		$result->closeCursor();
		return $counts;
	}

	private function applyConditions(IQueryBuilder $query, EnvelopeSearch $search): void {
		if ($search->ownerUid !== null) {
			$query->andWhere($query->expr()->eq(self::ALIAS . '.owner_uid', $query->createNamedParameter($search->ownerUid)));
		}
		if ($search->fileId !== null) {
			$file = $query->createNamedParameter($search->fileId, IQueryBuilder::PARAM_INT);
			$documents = $this->db->getQueryBuilder();
			$documents->select('d.envelope_id')->from(DocumentMapper::TABLE, 'd')->where($documents->expr()->orX(
				$documents->expr()->eq('d.source_file_id', $file),
				$documents->expr()->eq('d.signed_file_id', $file),
			));
			$query->andWhere($query->expr()->in(self::ALIAS . '.id', $query->createFunction($documents->getSQL())));
		}
		if ($search->text === null) {
			return;
		}
		$pattern = $query->createNamedParameter('%' . $this->db->escapeLikeParameter($search->text) . '%');
		$documents = $this->db->getQueryBuilder();
		$documents->select('d.envelope_id')->from(DocumentMapper::TABLE, 'd')->where($documents->expr()->iLike('d.source_path', $pattern));
		$signers = $this->db->getQueryBuilder();
		$signers->select('s.envelope_id')->from(SignerMapper::TABLE, 's')->where($signers->expr()->orX(
			$signers->expr()->iLike('s.name', $pattern),
			$signers->expr()->iLike('s.email', $pattern),
		));
		$query->andWhere($query->expr()->orX(
			$query->expr()->iLike(self::ALIAS . '.title', $pattern),
			$query->expr()->in(self::ALIAS . '.id', $query->createFunction($documents->getSQL())),
			$query->expr()->in(self::ALIAS . '.id', $query->createFunction($signers->getSQL())),
		));
	}

	private function applySort(IQueryBuilder $query, EnvelopeSort $sort): void {
		if ($sort === EnvelopeSort::Deadline) {
			$query->orderBy($query->createFunction('CASE WHEN ' . self::ALIAS . '.deadline_at IS NULL THEN 1 ELSE 0 END'), 'ASC')
				->addOrderBy(self::ALIAS . '.deadline_at', 'ASC');
		}
		$query->addOrderBy(self::ALIAS . '.updated_at', 'DESC')->addOrderBy(self::ALIAS . '.id', 'DESC');
	}
```

The `CASE` text is a constant expression with no user input. It is the only portable way to put NULL deadlines last on both PostgreSQL and MySQL. Run the mapper test: PASS.

- [ ] **Step 5: Write the failing controller tests.** Add a `describe`-style group of methods to `EnvelopeControllerTest`:
  - `testListReturnsPageTotalsAndCounts`: 3 drafts, `perPage: 2`. Expect 2 envelopes, `total` 3, `page` 1, `perPage` 2, `counts['all']` 3 and `counts['draft']` 3.
  - `testListRejectsUnknownFilter`: `filter: 'x'` returns 422 `list_query_invalid`.
  - `testListRejectsPerPageOutOfRange`: 0 and 101 both return 422.
  - `testListRejectsLongSearch`: 101 `a` characters return 422.
  - `testListForNonAdminIgnoresScopeAll`: another user's envelope does not appear.
  - `testListFindsEnvelopesOfAFile`: `fileId` of a file in envelope A returns only A.

- [ ] **Step 6: Implement the service, view and controller.**

`EnvelopeDrafts`:
```php
	public const SEARCH_MAX_LENGTH = 100;
	public const PER_PAGE_MAX = 100;

	/** @return array{envelopes: list<Envelope>, total: int, counts: array<string, int>} */
	public function search(EnvelopeSearch $search): array {
		$counts = $this->envelopeMapper->countByStatus($search);
		$byFilter = [];
		foreach (EnvelopeFilter::cases() as $filter) {
			$statuses = $filter->statuses();
			$byFilter[$filter->value] = $statuses === null
				? array_sum($counts)
				: array_sum(array_map(fn (EnvelopeStatus $status): int => $counts[$status->value] ?? 0, $statuses));
		}
		return ['envelopes' => $this->envelopeMapper->search($search), 'total' => $byFilter[$search->filter->value], 'counts' => $byFilter];
	}
```

`EnvelopeController::index`:
```php
	private const DEFAULT_PER_PAGE = 25;

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'GET', url: '/api/v1/envelopes')]
	public function index(string $scope = 'mine', string $filter = 'all', string $search = '', string $sort = 'recent', int $page = 1, int $perPage = self::DEFAULT_PER_PAGE, ?int $fileId = null): JSONResponse {
		$userId = $this->access->currentUserId();
		$parsedFilter = EnvelopeFilter::tryFrom($filter);
		$parsedSort = EnvelopeSort::tryFrom($sort);
		$text = trim($search);
		$isValid = $parsedFilter !== null && $parsedSort !== null && $page >= 1
			&& $perPage >= 1 && $perPage <= EnvelopeDrafts::PER_PAGE_MAX
			&& mb_strlen($text) <= EnvelopeDrafts::SEARCH_MAX_LENGTH;
		if (!$isValid) {
			return new JSONResponse(['error' => 'list_query_invalid', 'message' => 'Unknown filter or sort, or page, perPage or search out of range'], Http::STATUS_UNPROCESSABLE_ENTITY);
		}
		$everyone = $scope === self::SCOPE_EVERYONE && $this->accessPolicy->canSeeAll($userId);
		$result = $this->drafts->search(new EnvelopeSearch(
			$everyone ? null : $userId, $parsedFilter, $text === '' ? null : $text, $fileId, $parsedSort, ($page - 1) * $perPage, $perPage,
		));
		return new JSONResponse([
			'envelopes' => array_map(fn (Envelope $envelope): array => $this->details->summary($envelope), $result['envelopes']),
			'total' => $result['total'],
			'page' => $page,
			'perPage' => $perPage,
			'counts' => $result['counts'],
		]);
	}
```
Delete `EnvelopeDrafts::listFor` and `EnvelopeLimits::LIST_LIMIT` if nothing else uses them. The `EnvelopeCleanup` trait keeps `findRecent`.

- [ ] **Step 7: Run the tests.** Run `tests/env/phpunit.sh --filter 'EnvelopeMapperSearchTest|EnvelopeControllerTest'`. Expected: PASS.

- [ ] **Step 8: Update the TS client and its spec.** In `src/api/types.ts`, add the types listed under Interfaces. In `src/api/envelopes.ts`:

```ts
/** One page of envelopes plus per-filter counts. */
export async function listEnvelopes(query: EnvelopeListQuery): Promise<EnvelopeListing> {
	const { fileId, ...rest } = query
	const params = fileId === null ? rest : { ...rest, fileId }
	return calling(async () => (await axios.get<EnvelopeListing>(envelopesUrl(), { params })).data)
}
```

In `src/api/query-keys.ts`:
```ts
	allEnvelopes: (): readonly ['envelopes'] => ['envelopes'],
	envelopes: (query: EnvelopeListQuery): readonly ['envelopes', EnvelopeListQuery] => ['envelopes', query],
```

The spec asserts two things: the GET params, without `fileId` when it is null; and that the listing is returned.

- [ ] **Step 9: Update the docs, bump the version and commit.**
  - In `docs/api.md`, replace the list route row and the "Limits" line about 200 with the new parameters and response. Add `list_query_invalid` to the error list.
  - Bump `info.xml` (patch) and run `occ upgrade`.
  - Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`.

```bash
git add lib tests src docs appinfo js css
git commit -m "feat: search, filter, sort and page the envelope list on the server"
```

---

### Task 3: Draft documents editing and the source PDF

**Files:**
- Modify:
  - `lib/Draft/EnvelopeDrafts.php`: `replaceDocuments()`, `sourceOf()`
  - `lib/Api/EnvelopeDetails.php` and `lib/Api/EnvelopeView.php`: document `name` and `size`
  - `lib/Controller/EnvelopeController.php`: two routes
  - `tests/Integration/Draft/EnvelopeDraftsEditingTest.php`, `tests/Integration/Controller/EnvelopeControllerTest.php`
  - `docs/api.md`, `appinfo/info.xml`
  - `src/api/types.ts`, `src/api/envelopes.ts`, `src/api/envelopes.spec.ts`

**Interfaces:**
- Produces (HTTP):
  - `PUT /api/v1/envelopes/{uuid}/documents` with body `{"fileIds": [int…]}`. Drafts only; the first id is the main document. It answers 200 with the detail.
    - Documents whose `sourceFileId` stays keep their row, pages and boxes. New ids are validated exactly like create (`file_not_found`, `file_not_pdf`, `file_not_downloadable`, `file_too_large`). Removed documents lose their boxes.
    - Order follows `fileIds`. Limits: 1..20 files and 20 MB total (`no_files`, `too_many_files`, `envelope_too_large`). A duplicate id answers 422 `file_duplicate`.
  - `GET /api/v1/envelopes/{uuid}/documents/{documentId}/source`: owner only, drafts only. It returns the CURRENT Drive bytes as `application/pdf` with `Cache-Control: no-store`.
    - `not_a_draft` 409 when the envelope is not a draft.
    - `file_not_found` 404 when the Drive file is gone.
    - `file_not_downloadable` 422.
  - Document JSON gains `"name": string` (the basename of `sourcePath`) and `"size": int|null` (the current Drive size; null when the file is gone).
- Produces (TS):
  - `EnvelopeDocument` gains `name: string; size: number | null`.
  - `replaceDocuments(uuid: string, fileIds: number[]): Promise<EnvelopeDetail>`
  - `getDocumentSource(uuid: string, documentId: number): Promise<ArrayBuffer>`
  - `QUERY_KEYS.documentSource(uuid: string, documentId: number, sourceFileId: number)` → `['document-source', uuid, documentId, sourceFileId]`

- [ ] **Step 1: Write failing service tests** in `EnvelopeDraftsEditingTest`, one method each:
  - **Kept document:** after `[a, b]` → `[b, a]`, b keeps its row id and boxes, and the positions are 0 and 1.
  - **Removed document:** after `[a, b]` → `[a]`, b's row and its boxes are gone.
  - **Added document:** `[a]` → `[a, c]` gives c a new row with `pageCount` null.
  - **Validation:** a non-PDF id answers `file_not_pdf`, and nothing changes.
  - **Duplicate id:** `[a, a]` answers `file_duplicate`.
  - **Too large:** 21 ids answer `too_many_files`.
  - **Not a draft:** a sent envelope answers `not_a_draft`.

- [ ] **Step 2: Run them and see them fail.** Run `tests/env/phpunit.sh --filter EnvelopeDraftsEditingTest`. Expected: FAIL (the method is undefined).

- [ ] **Step 3: Implement `replaceDocuments`.** Reuse `assertDraft`, `integer`, `sourceFile`, `sumFileSizes`, `assertWithinBudget`, `inTransaction`, `touch` and the box-deletion loop from `deleteSignersAndBoxes` (`FieldMapper::findByDocument`).

```php
	/** @param list<mixed> $fileIds */
	public function replaceDocuments(Envelope $envelope, array $fileIds): Envelope {
		$this->assertDraft($envelope);
		if ($fileIds === []) {
			throw new DraftRejected('no_files', 'An envelope needs at least one PDF');
		}
		if (count($fileIds) > EnvelopeLimits::MAX_FILES) {
			throw new DraftRejected('too_many_files', 'An envelope holds at most 20 files');
		}
		$ids = array_map(fn (mixed $id): int => self::integer($id) ?? throw new DraftRejected('file_not_found', 'Unknown file'), $fileIds);
		if (count(array_unique($ids)) !== count($ids)) {
			throw new DraftRejected('file_duplicate', 'Each file can appear once');
		}
		$owner = $envelope->getOwnerUid();
		$files = array_map(fn (int $id): File => $this->sourceFile($owner, $id), $ids);
		$this->assertWithinBudget($this->sumFileSizes($files));
		$existing = [];
		foreach ($this->documentMapper->findByEnvelope($envelope->getId()) as $document) {
			$existing[$document->getSourceFileId()] = $document;
		}
		$userFolder = $this->rootFolder->getUserFolder($owner);
		$this->inTransaction(function () use ($envelope, $files, $existing, $userFolder): void {
			foreach ($existing as $fileId => $document) {
				if (!in_array($fileId, array_map(fn (File $file): int => $file->getId(), $files), true)) {
					foreach ($this->fieldMapper->findByDocument($document->getId()) as $field) {
						$this->fieldMapper->delete($field);
					}
					$this->documentMapper->delete($document);
				}
			}
			foreach ($files as $position => $file) {
				$document = $existing[$file->getId()] ?? null;
				if ($document !== null) {
					$document->setPosition($position);
					$this->documentMapper->update($document);
					continue;
				}
				$this->documentMapper->insert($this->newDocument($envelope, $file, $position, $userFolder));
			}
			$this->touch($envelope);
		});
		return $envelope;
	}
```
Extract the document construction from `create()` into a private `newDocument(Envelope $envelope, File $file, int $position, Folder $userFolder): Document`, and use it in both places. Run the tests: PASS.

- [ ] **Step 4: `sourceOf`.**

```php
	/** The current Drive bytes of a draft's document, for the placement editor. */
	public function sourceOf(Envelope $envelope, int $documentId): DownloadedPdf {
		if ($envelope->getStatus() !== EnvelopeStatus::Draft->value) {
			throw new DraftRejected('not_a_draft', 'Only drafts expose their source file', Http::STATUS_CONFLICT);
		}
		$document = $this->documentOf($envelope, $documentId);
		$file = $this->rootFolder->getUserFolder($envelope->getOwnerUid())->getFirstNodeById($document->getSourceFileId());
		if (!$file instanceof File || !$file->isReadable()) {
			throw new DraftRejected('file_not_found', 'The Drive file is gone', Http::STATUS_NOT_FOUND);
		}
		if (!$this->downloadPermission->allows($envelope->getOwnerUid(), $file)) {
			throw new DraftRejected('file_not_downloadable', 'The file is shared without download permission');
		}
		return new DownloadedPdf($file->getName(), $file->getContent());
	}
```
- If `DraftRejected` has no HTTP status today, give it an optional `public readonly int $httpStatus = Http::STATUS_UNPROCESSABLE_ENTITY` constructor argument. `EnvelopeController::editing` must answer with that status; existing callers keep 422.
- Check that `EnvelopeStatus` has `->value` comparisons consistent with `assertDraft`.
- Tests:
  - the owner gets the bytes of a draft;
  - a sent envelope answers 409;
  - a deleted file answers 404;
  - another member gets 404 (the envelope is unreadable);
  - an admin who is not the owner gets 403 (cannot edit).

- [ ] **Step 5: Add the controller routes.**

```php
	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'PUT', url: '/api/v1/envelopes/{uuid}/documents')]
	public function replaceDocuments(string $uuid, array $fileIds = []): JSONResponse {
		return $this->editing($uuid, fn (Envelope $envelope): array => $this->details->detail($this->drafts->replaceDocuments($envelope, $fileIds)));
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'GET', url: '/api/v1/envelopes/{uuid}/documents/{documentId}/source')]
	public function source(string $uuid, int $documentId): Response {
		$envelope = $this->access->readable($uuid);
		if ($envelope === null) {
			return self::notFound();
		}
		if (!$this->access->mayEdit($envelope)) {
			return self::forbidden();
		}
		try {
			$pdf = $this->drafts->sourceOf($envelope, $documentId);
		} catch (DraftRejected $rejection) {
			return new JSONResponse(['error' => $rejection->errorCode, 'message' => $rejection->getMessage()], $rejection->httpStatus);
		}
		$response = new DataDownloadResponse($pdf->bytes, $pdf->filename, 'application/pdf');
		$response->addHeader('Cache-Control', 'no-store');
		return $response;
	}
```
`self::notFound()` and `self::forbidden()` are the 404/403 JSON bodies that `editing()` builds today. Extract them into private static helpers (and use them in `editing()` too) rather than duplicating the arrays.

- [ ] **Step 6: Add document name and size.** `EnvelopeDetails::detail()` looks up each document's Drive file once (owner's folder, `getFirstNodeById`) and passes `array<int, int|null> $sizes` to `EnvelopeView::detail`. `EnvelopeView::document` adds `'name' => basename($document->getSourcePath())` and `'size' => $sizes[$document->getId()] ?? null`. Write a test asserting both keys for an existing file and `size: null` after the file is deleted.

- [ ] **Step 7: Add the TS client functions and their spec.**

```ts
/** Replaces a draft's documents; the first file is the main document. */
export async function replaceDocuments(uuid: string, fileIds: number[]): Promise<EnvelopeDetail> {
	return calling(async () => (await axios.put<EnvelopeDetail>(envelopeUrl(uuid, '/documents'), { fileIds })).data)
}

/** The current Drive bytes of a draft document (placement editor only). */
export async function getDocumentSource(uuid: string, documentId: number): Promise<ArrayBuffer> {
	return calling(async () => (await axios.get<ArrayBuffer>(envelopeUrl(uuid, `/documents/${documentId}/source`), { responseType: 'arraybuffer' })).data)
}
```

- [ ] **Step 8: Docs, version bump, full suites, commit.** Document both routes, the two new document keys and `file_duplicate` in `docs/api.md`. Bump the version and run `occ upgrade`. Run `tests/env/phpunit.sh` (full suite), then `npm test` and `npm run build`.

```bash
git add lib tests src docs appinfo js css
git commit -m "feat: edit a draft's documents and stream its source PDF for placement"
```

---

### Task 4: Notification links

**Files:**
- Modify: `lib/Notification/Notifier.php`, `tests/Integration/Notification/NotifierTest.php`

**Interfaces:**
- Produces: every prepared notification links to `/apps/assinaturas/envelopes/{uuid}` (absolute) and carries the app icon. The object id is already the uuid (`SenderNotificationListener` sets `setObject('envelope', $uuid)`).

- [ ] **Step 1: Write the failing test.** `testLinksToTheEnvelopePage`: prepare a `completed` notification for object id `abc-uuid`. Assert that `getLink()` ends with `/apps/assinaturas/envelopes/abc-uuid` and that `getIcon()` ends with `app-dark.svg`.
- [ ] **Step 2: Run it and see it fail.** Run `tests/env/phpunit.sh --filter NotifierTest`. Expected: FAIL (the link is empty).
- [ ] **Step 3: Implement it.** Inject `IURLGenerator $urlGenerator` into the Notifier, then in `prepare()` before returning:

```php
	private const PAGE_ROUTE = 'assinaturas.page.envelope';
	private const ICON = 'app-dark.svg';
	// in prepare(), after setParsedSubject:
		$notification->setLink($this->urlGenerator->linkToRouteAbsolute(self::PAGE_ROUTE, ['uuid' => $notification->getObjectId()]));
		$notification->setIcon($this->urlGenerator->getAbsoluteURL($this->urlGenerator->imagePath(Application::APP_ID, self::ICON)));
```
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit.** No version bump is needed: no route or JS changed.

```bash
git add lib tests
git commit -m "feat: link sender notifications to the envelope page"
```

---
### Task 5: Avuz identity tokens and the UI kit

Every screen is built from these pieces. Values come from `design/mockups/Main.dc.html` (and the other artboards for the pieces they introduce).

**Files:**
- Create: `src/styles/identity.css`, `src/ui/AvButton.vue`, `src/ui/AvIconButton.vue`, `src/ui/AvChip.vue`, `src/ui/AvTextField.vue`, `src/ui/AvTextarea.vue`, `src/ui/AvSelect.vue`, `src/ui/AvSwitch.vue`, `src/ui/AvDialog.vue`, `src/ui/AvMenu.vue`, `src/ui/AvStatusPill.vue`, `src/ui/AvAvatar.vue`, `src/ui/AvProgress.vue`, `src/ui/AvCard.vue`, `src/ui/AvBanner.vue`, `src/ui/AvSkeleton.vue`, `src/ui/tones.ts`, `src/ui/*.spec.ts` (one per interactive component)
- Modify: `package.json` (`lucide-vue-next`), `src/main.ts` and `src/files-init.ts` (import `./styles/identity.css`)

**Interfaces:**
- Produces:
  - **Root class:** `.av-root` scopes every token.
  - **Tone:** `type Tone = 'neutral' | 'info' | 'success' | 'danger' | 'warning'` (`src/ui/tones.ts`).
  - **Signer palette:** `SIGNER_PALETTE: readonly { stroke: string; fill: string }[]` (6 entries, `src/ui/tones.ts`). Use `var(--av-signer-N-stroke)` / `var(--av-signer-N-fill)` in CSS. `signerTone(color: number)` returns the palette entry at `color % 6`.
  - **Components** (all props typed with `defineProps<…>()`):
    - `AvButton`: `variant?: 'primary' | 'secondary' | 'danger' | 'ghost'` (default primary), `size?: 'default' | 'large'` (44 / 52px), `to?: RouteLocationRaw`, `href?: string`, `download?: boolean`, `type?: 'button' | 'submit'`, `disabled?: boolean`, `block?: boolean`. Slots: `icon`, `default`. Renders a `RouterLink` when `to` is set, `<a>` when `href`, else `<button>`.
    - `AvIconButton`: `label: string` (aria-label), `variant?: 'plain' | 'outline'`, `disabled?: boolean`, `to?`, `href?`. Slot `default` = icon. 44×44 circle.
    - `AvChip`: `pressed: boolean`, `count?: number`. Slot label. Emits `click`.
    - `AvTextField`: `v-model: string`, `label: string`, `labelHidden?: boolean`, `type?: string`, `placeholder?: string`, `error?: string | null`, `hint?: string`, `autocomplete?: string`, `maxlength?: number`. Slot `leading` (icon). Uses `useId()`; `aria-invalid` and `aria-describedby` are wired.
    - `AvTextarea`: like `AvTextField`, plus `rows?: number`.
    - `AvSelect`: `v-model: string`, `label: string`, `labelHidden?: boolean`, `options: { value: string; label: string }[]`.
    - `AvSwitch`: `v-model: boolean`, `label: string`, `description?: string`. A `<button role="switch" :aria-checked>`.
    - `AvDialog`: `open: boolean`, `title: string`. Emits `close`. Slots `default`, `actions`. Native `<dialog>` with `showModal()`/`close()`. Esc and backdrop click emit `close`.
    - `AvMenu`: `label: string` (trigger aria-label), `items: { id: string; label: string; tone?: 'danger'; href?: string; disabled?: boolean }[]`. Emits `select(id)`. Slot `trigger-icon`. ARIA menu button pattern: Enter/Space/ArrowDown opens, arrows move, Esc closes and returns focus.
    - `AvStatusPill`: `label: string`, `tone: Tone | 'brand'`. Dot plus text.
    - `AvAvatar`: `name: string`, `color: number`, `size?: 32 | 36`. Initials of the first and last words, uppercased. `aria-hidden` when `decorative`, else `role="img" :aria-label="name"`.
    - `AvProgress`: `value: number` (0..1), `tone?: 'info' | 'success' | 'danger'`, `width?: string`. `role="progressbar"` with `aria-valuenow` (0–100) and an `aria-label` prop.
    - `AvCard`: slot.
    - `AvBanner`: `tone: 'info' | 'warning' | 'danger'`, `title: string`. Slots `default` and `action`.
    - `AvSkeleton`: `width?: string`, `height?: string`, `radius?: string`.

- [ ] **Step 1: Install icons.** Run `npm install lucide-vue-next@^0` (record the exact resolved version in `package.json`, caret on the minor). Icons are imported per name (`import { Search } from 'lucide-vue-next'`), so the bundle is tree-shaken. Use `stroke-width="1.5"` on 20px icons, as the artboards do. From this task on, new code uses lucide only. Task 6 replaces the 3a `vue-material-design-icons` uses, and Task 19 drops the dependency when nothing imports it.

- [ ] **Step 2: Write `src/styles/identity.css`** with the canvas values:

```css
/* Avuz identity for Assinaturas — values from design/mockups (approved 2026-10-02). */
.av-root {
	--av-ground: #f1f1f1;
	--av-panel: #ffffff;
	--av-ink: #1d2730;
	--av-muted: #55626d;
	--av-disabled: #a3adb5;
	--av-hairline: #e3e7eb;
	--av-hairline-soft: #eef1f3;
	--av-input-border: #c9d1d8;
	--av-subtle-fill: #f6f8f9;
	--av-canvas-fill: #f1f4f6;
	--av-brand: #2bb5e3;
	--av-action: #00679e;
	--av-action-hover: #004f7a;
	--av-tint: #e3f5fc;
	--av-tint-text: #00557f;
	--av-neutral-fill: #eef1f3;
	--av-neutral-text: #45525c;
	--av-neutral-dot: #8a96a0;
	--av-info-fill: #e3f5fc;
	--av-info-text: #00557f;
	--av-info-dot: #00679e;
	--av-brand-dot: #2bb5e3;
	--av-success-fill: #dcf3e3;
	--av-success-text: #137a3a;
	--av-success-dot: #1f9a4c;
	--av-danger-fill: #fde8e6;
	--av-danger-text: #a8261b;
	--av-danger-dot: #d93a2b;
	--av-danger-border: #f0c4bf;
	--av-warning-fill: #fdf0d9;
	--av-warning-text: #7a4f00;
	--av-warning-dot: #d08a00;
	--av-signer-0-stroke: #00679e; --av-signer-0-fill: #e3f5fc;
	--av-signer-1-stroke: #c2410c; --av-signer-1-fill: #fdeee6;
	--av-signer-2-stroke: #6d28d9; --av-signer-2-fill: #f1eafd;
	--av-signer-3-stroke: #0f766e; --av-signer-3-fill: #e2f4f1;
	--av-signer-4-stroke: #be185d; --av-signer-4-fill: #fce8f1;
	--av-signer-5-stroke: #4d5a12; --av-signer-5-fill: #eef2dc;
	--av-radius-panel: 35px;
	--av-radius-card: 20px;
	--av-radius-sheet: 28px;
	--av-radius-tile: 12px;
	--av-radius-pill: 999px;
	--av-control-height: 44px;
	--av-control-height-large: 52px;
	--av-chip-height: 40px;
	--av-gutter: 8px;
	--av-shadow-float: 0 8px 32px rgba(29, 39, 48, 0.14);
	--av-font: 'Questrial', 'Helvetica Neue', sans-serif;
	--av-text-h1: 30px;
	--av-text-h2: 20px;
	--av-text-body: 15px;
	--av-text-meta: 13px;
	--av-text-label: 13px;
	--av-label-tracking: 0.3px;
	font-family: var(--av-font);
	color: var(--av-ink);
	font-size: var(--av-text-body);
}

.av-root :focus-visible {
	outline: 2px solid var(--av-brand);
	outline-offset: 2px;
}

.av-root .av-visually-hidden {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip: rect(0 0 0 0);
	white-space: nowrap;
}

.av-root h1, .av-root h2, .av-root h3 {
	font-weight: 400;
	margin: 0;
}
```
Questrial has a single weight, so no rule may set `font-weight` above 400.

- [ ] **Step 3: Write the failing kit specs.** Each spec mounts the component and asserts behaviour:
  - **AvButton:**
    - renders `<a href>` for `href` and a RouterLink for `to` (use a memory router in the spec);
    - `disabled` sets `disabled` on a `<button>` and `aria-disabled` plus no `href` on links;
    - the `primary` class is present by default.
  - **AvChip:** `aria-pressed` reflects `pressed`; the count renders; click emits.
  - **AvTextField:**
    - the label's `for` matches the input `id`;
    - `error` sets `aria-invalid="true"` and `aria-describedby` points at the error element containing the text;
    - typing emits `update:modelValue`.
  - **AvSwitch:** `role="switch"`, `aria-checked` toggles, and click emits the toggled value.
  - **AvDialog:**
    - when `open` turns true it calls `showModal` (stub `HTMLDialogElement.prototype.showModal`/`close` in happy-dom when missing);
    - a `cancel` event (Esc) emits `close`;
    - the title is the dialog's accessible name (`aria-labelledby`).
  - **AvMenu:**
    - the trigger has `aria-haspopup="menu"` and `aria-expanded`;
    - ArrowDown opens and focuses the first item;
    - Esc closes and refocuses the trigger;
    - selecting emits `select` with the id;
    - a disabled item does not emit.
  - **AvAvatar:** "Ana Lima" renders "AL" and "Carla" renders "C"; the background is `var(--av-signer-2-stroke)` for `color: 8` (8 % 6 = 2).
  - **AvProgress:** `aria-valuenow` is 33 for `value: 1/3`.

- [ ] **Step 4: Run them and see them fail.** Run `npx vitest run src/ui`. Expected: FAIL (components missing).

- [ ] **Step 5: Implement the components.** Exact visual values:

| Component | Style (from the artboards) |
|---|---|
| AvButton primary | `height: var(--av-control-height)`, `padding: 0 20px`, `border-radius: var(--av-radius-pill)`, `background: var(--av-action)`, `color: #fff`, `gap: 10px`, `font-size: 15px`, no border. Hover `var(--av-action-hover)`. Disabled: `background: var(--av-hairline); color: var(--av-muted)` |
| AvButton secondary | white, `border: 1px solid var(--av-input-border)`, `color: var(--av-ink)` |
| AvButton danger | white, `border: 1px solid var(--av-danger-border)`, `color: var(--av-danger-text)` |
| AvButton ghost | transparent, no border, `color: var(--av-action)` (text links such as "Corrigir e-mail", "Editar") |
| AvButton large | `height: var(--av-control-height-large)`, `font-size: 16px` |
| AvIconButton | 44×44, `border-radius: 999px`, plain = transparent with `color: var(--av-muted)`; outline = `1px solid var(--av-input-border)` and `color: var(--av-ink)`; disabled outline = `border-color: var(--av-hairline); color: var(--av-disabled)` |
| AvChip | `height: var(--av-chip-height)`, `padding: 0 16px`, `gap: 8px`, `font-size: 14px`, pill. Off: white, `1px solid var(--av-input-border)`. Pressed: `background: var(--av-ink); color: #fff; border-color: var(--av-ink)`. Count `font-size: 13px; opacity: 0.8` |
| AvTextField | input `height: 44px`, pill, `border: 1px solid var(--av-input-border)`, `padding: 0 18px` (`0 18px 0 44px` with a leading icon placed `left: 16px`, 18px icon, `color: var(--av-muted)`). Label above: `font-size: 13px; color: var(--av-muted); margin-bottom: 6px`. Error: `border-color: var(--av-danger-text)`, message `font-size: 13px; color: var(--av-danger-text)` |
| AvTextarea | same, but `border-radius: var(--av-radius-card); padding: 14px 18px` |
| AvSelect | an AvTextField-like pill wrapping a native `<select>` (`appearance: none`) plus a lucide `ChevronDown` 16px at `right: 14px` |
| AvSwitch | track 44×24 pill (`var(--av-action)` on, `var(--av-input-border)` off), 20px white knob; label 15px, description 13px muted; whole row ≥ 44px |
| AvDialog | `border: none; border-radius: var(--av-radius-sheet); padding: 28px; max-width: 480px; width: calc(100vw - 32px)`; `::backdrop { background: rgba(29, 39, 48, 0.4) }`; title `font-size: var(--av-text-h2)`; actions row `justify-content: flex-end; gap: 12px; margin-top: 24px` |
| AvMenu | popover `background: #fff; border-radius: var(--av-radius-card); box-shadow: var(--av-shadow-float); padding: 8px; min-width: 220px`; items 44px tall, pill hover `var(--av-subtle-fill)`; danger items `var(--av-danger-text)` |
| AvStatusPill | `height: 30px; padding: 0 12px; gap: 8px; border-radius: 999px; font-size: 13px`; 8px dot; colours `--av-<tone>-fill/-text/-dot`; tone `brand` = info fill/text with `--av-brand-dot` |
| AvProgress | track `height: 6px; border-radius: 999px; background: #e6eaee`; fill `var(--av-info-dot)` / `--av-success-dot` / `--av-danger-dot` |
| AvCard | `border: 1px solid var(--av-hairline); border-radius: var(--av-radius-card); padding: 24px; background: #fff` |
| AvBanner | `border-radius: var(--av-radius-card); padding: 14px 18px; gap: 12px`; tone fill and text from `--av-<tone>-*`; leading lucide icon 20px (`TriangleAlert` for warning and danger, `Info` for info) |
| AvSkeleton | `background: var(--av-hairline-soft)`; a pulse animation respecting `prefers-reduced-motion` |

Each component's `<style scoped>` uses only `var(--av-…)` tokens and the pixel values of the table, with no other literals except in this table's sizes.

- [ ] **Step 6: Run the tests.** Run `npx vitest run src/ui`. Expected: PASS. Also run `npm run typecheck && npm run lint`.

- [ ] **Step 7: Commit.** The kit is not yet used by a built entry, so there is no build or bump.

```bash
git add package.json package-lock.json src/styles src/ui src/main.ts src/files-init.ts
git commit -m "feat: add the Avuz identity tokens and the UI kit from the approved mockups"
```

---

### Task 6: App frame, navigation, lazy routes and error messages

**Files:**
- Create:
  - layout: `src/layout/AppFrame.vue`, `src/layout/AppNavigation.vue`, `src/layout/PhoneAppBar.vue`, `src/layout/frame-layout.ts`, `src/layout/viewport.ts`
  - views: `src/views/LoadingView.vue`, `src/views/NotFoundView.vue`
  - `src/api/error-messages.ts`
  - specs: `src/layout/AppFrame.spec.ts`, `src/api/error-messages.spec.ts`
- Modify: `src/main.ts`, `src/router.ts`, `src/components/SandboxBanner.vue`, `src/components/ErrorBoundary.vue` (restyle with the kit), `l10n/pt_BR.{json,js}`
- Delete: `src/components/AppShell.vue` (replaced by AppFrame)

**Interfaces:**
- Consumes: the Task 5 kit.
- Produces:
  - `ROUTE_NAMES = { dashboard: 'dashboard', envelope: 'envelope' }`; routes are lazy (`component: () => import(...)`). The dashboard scope comes from the query (`?scope=all`). Wizard steps use `?step=documents|signers|placement|review`.
  - `type FrameLayout = 'navigation' | 'full-page'`; `provideFrameLayout(): Ref<FrameLayout>` (AppFrame); `useFrameLayout(layout: FrameLayout)`, which a view calls to set its layout and which resets to `'navigation'` on unmount.
  - `PHONE_MEDIA_QUERY = '(max-width: 1023px)'`; `useIsPhone(): Readonly<Ref<boolean>>` (matchMedia, listener removed on scope dispose).
  - `errorMessage(error: unknown): string`: pt_BR text for every API code; never the server message.
  - `router.onError` logs failed lazy imports with `logger.error` and shows `showError(t(APP_ID, 'Could not load this screen. Reload the page.'))`.

- [ ] **Step 1: Write the failing `error-messages.spec.ts`.**

```ts
import { describe, expect, it } from 'vitest'
import { ApiError } from './api-error.ts'
import { ERROR_MESSAGES, errorMessage } from './error-messages.ts'
import translations from '../../l10n/pt_BR.json'

describe('errorMessage', () => {
	it('maps a known code to its text', () => {
		expect(errorMessage(new ApiError('not_cancellable', 409, null, 'x'))).toBe(ERROR_MESSAGES.not_cancellable)
	})

	it('maps Nextcloud throttling to a wait message', () => {
		expect(errorMessage(new ApiError('http_429', 429, null, 'x'))).toBe(ERROR_MESSAGES.http_429)
	})

	it('falls back to a generic text for unknown codes and non-API errors', () => {
		expect(errorMessage(new ApiError('something_new', 500, null, 'server text'))).toBe(ERROR_MESSAGES.unknown)
		expect(errorMessage(new TypeError('boom'))).toBe(ERROR_MESSAGES.unknown)
	})

	it('never returns the server message', () => {
		expect(errorMessage(new ApiError('something_new', 500, null, 'ZapSign said X'))).not.toContain('ZapSign said')
	})

	it('has a pt_BR translation for every source text', () => {
		for (const source of Object.values(ERROR_SOURCE_TEXTS)) {
			expect(translations.translations).toHaveProperty([source])
		}
	})
})
```
(Import `ERROR_SOURCE_TEXTS` too. `ERROR_MESSAGES` is the translated map, built lazily so `t()` runs after the l10n bundle loads.)

- [ ] **Step 2: Implement `src/api/error-messages.ts`.** `ERROR_SOURCE_TEXTS: Record<ErrorCode, string>` holds English source strings. It covers every code in `docs/api.md` (draft codes, action codes, send codes, provider codes) plus `forbidden`, `not_found`, `already_sending`, `envelope_busy`, `list_query_invalid`, `file_duplicate`, `not_a_draft`, `network_error`, `http_429` and `unknown`. Example entries:

```ts
export const ERROR_SOURCE_TEXTS = {
	forbidden: 'You cannot do this.',
	not_found: 'This envelope does not exist or you cannot see it.',
	network_error: 'No connection to the server. Check your connection and try again.',
	http_429: 'Too many attempts. Wait a few minutes and try again.',
	unknown: 'Something went wrong. Try again.',
	reminder_cooldown: 'ZapSign allows one message every 30 minutes for each signer.',
	not_cancellable: 'Only envelopes waiting for signatures or expired can be cancelled.',
	file_changed: 'A file changed in Drive after placement. Review the placement and send again.',
	provider_unreachable: 'ZapSign did not answer. Try again in a few minutes.',
	// …every other code, one line each, in plain words for the sender
} as const satisfies Record<string, string>

export type ErrorCode = keyof typeof ERROR_SOURCE_TEXTS

function isErrorCode(code: string): code is ErrorCode {
	return Object.hasOwn(ERROR_SOURCE_TEXTS, code)
}

export function errorMessage(error: unknown): string {
	const code = error instanceof ApiError && isErrorCode(error.code) ? error.code : 'unknown'
	return t(APP_ID, ERROR_SOURCE_TEXTS[code])
}
```
`ERROR_MESSAGES` is a getter-backed object (`Object.fromEntries` over the keys with `t`) used by tests. Add every string with a natural pt_BR translation to `l10n/pt_BR.{json,js}`. Run the spec: PASS. Then replace the ad-hoc error toasts from 3a (`new-envelope.ts`, `create-envelope-from-files.ts`, `AdminSettings.vue`) with `errorMessage(error)` where they show API failures.

- [ ] **Step 3: Write the failing `AppFrame.spec.ts`.**
  - **Desktop, navigation layout:** renders a `<nav aria-label="Assinaturas">` with "Novo envelope", "Meus envelopes" (`aria-current="page"` on `/`), and, for admins only, "Toda a empresa" and "Configurações".
  - **Full-page layout:** a child view that calls `useFrameLayout('full-page')` hides the nav panel.
  - **Phone:** with `matchMedia` returning true, the nav panel is replaced by `PhoneAppBar` (a menu button `aria-label="Abrir menu"` and the title "Assinaturas"). The menu button opens the navigation as a modal drawer (`AvDialog`-style `<dialog>`), and Esc closes it.
  - **Sandbox:** in sandbox, `SandboxBanner` renders with the text "SANDBOX — sem validade jurídica".
  - **No access:** a user without `canUseApp` sees "Você não tem acesso a Assinaturas" and no nav.

- [ ] **Step 4: Implement the frame.** Match `Main.dc.html` and `Phone-Dashboard.dc.html` exactly.
  - **`AppFrame.vue`:**
    - Root `<div class="av-root av-frame">`: `display: flex; gap: var(--av-gutter); padding: 0 var(--av-gutter) var(--av-gutter); background: var(--av-ground); height: 100%; box-sizing: border-box`. Verify in the preview that Nextcloud's `#content` gives it the full height under the header. If not, use `height: calc(100dvh - var(--header-height))`.
    - Nav panel: `<AppNavigation>` 280px, white, `border-radius: var(--av-radius-panel)`, `padding: 24px 16px`.
    - Main panel: `<main>`, white, radius 35px, `padding: 32px 40px 24px`, `min-width: 0`, scrolling inside (`overflow: auto`).
    - In `full-page` layout only the main panel renders.
    - Inside main: `<SandboxBanner>`, then `<ErrorBoundary><RouterView v-slot="{ Component }"><Suspense><component :is="Component" /><template #fallback><LoadingView /></template></Suspense></RouterView></ErrorBoundary>`.
  - **`AppNavigation.vue`:** the markup of the Main artboard's `<nav>`.
    - "Novo envelope": a 48px primary pill (`height: 48px` is an artboard value; keep it), `margin-bottom: 20px`, which calls `startNewEnvelope(router)`. Disable it while running so a double click cannot open two pickers.
    - Links 44px tall, pill, `padding: 0 16px`, `gap: 12px`, 15px.
    - Active link: `background: var(--av-tint); color: var(--av-tint-text)`, with `aria-current="page"`.
    - "Meus envelopes" carries the `counts.all` badge: read from the query cache with `useQueryClient().getQueryData`. No extra fetch; hide the badge when no listing is cached.
    - Lucide icons: `Plus`, `Inbox`, `Building2`, `Settings`.
    - "Configurações" goes to `generateUrl('/settings/admin/assinaturas')` and pins to the bottom with a flex spacer.
  - **`PhoneAppBar.vue`:** 56px, `padding: 0 8px`. `AvIconButton` menu (`Menu` icon), the title "Assinaturas" (17px), and an `AvAvatar` of `getCurrentUser()` (`@nextcloud/auth`, already a transitive dependency; add it to `package.json` explicitly).
    - On phone the main panel loses its radius on the sides: `border-radius: var(--av-radius-panel) var(--av-radius-panel) 0 0`, `padding: 16px`, with the ground colour around it, as in `Phone-Dashboard.dc.html`.
  - **`SandboxBanner.vue`:** an `AvBanner tone="warning"` with the title "SANDBOX — sem validade jurídica" and the line "Envios de teste não são cobrados e não têm valor legal." (from `Wizard-Review.dc.html`). It renders at the top of the main panel on every screen while the environment is `sandbox`.
  - **`ErrorBoundary.vue`:** same behaviour; restyle with `AvButton` and a lucide `CircleAlert` in a 64px tinted circle.
  - **`router.ts`:**

```ts
export const ROUTES: RouteRecordRaw[] = [
	{ path: '/', name: ROUTE_NAMES.dashboard, component: () => import('./dashboard/DashboardView.vue') },
	{ path: '/envelopes/:uuid', name: ROUTE_NAMES.envelope, component: () => import('./envelope/EnvelopeView.vue'), props: true },
	{ path: '/:pathMatch(.*)*', component: () => import('./views/NotFoundView.vue') },
]
```
Until Tasks 8 and 9 land, create minimal `DashboardView.vue` and `EnvelopeView.vue` that render the old "Esta tela está a caminho" text, so the build works. Then delete `ComingSoonView.vue`. `main.ts` mounts `AppFrame` and registers `router.onError`.

- [ ] **Step 5: Run the tests, build, bump and commit.** Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`. Bump `info.xml` and run `occ upgrade`. With the preview server running, open `http://localhost:8088/apps/assinaturas/` and fix any frame-height issue now.

```bash
git add src l10n js css appinfo package.json package-lock.json
git commit -m "feat: frame the app in the Avuz layout with lazy routes and pt_BR error texts"
```

---

### Task 7: Presentation helpers

Pure TypeScript, unit-tested. The screens show no logic of their own.

**Files:**
- Create:
  - `src/presentation/envelope-status.ts`, `signer-state.ts`, `cooldown.ts`, `dates.ts`, `timeline.ts`, `use-now.ts`, `use-debounced.ts`
  - specs: `envelope-status.spec.ts`, `signer-state.spec.ts`, `cooldown.spec.ts`, `dates.spec.ts`, `timeline.spec.ts`
- Modify: `l10n/pt_BR.{json,js}`

**Interfaces:**
- Produces:
  - `envelopeStatusView(status: EnvelopeStatus): { label: string; tone: Tone | 'brand' }`. Labels: Rascunho, Enviando, Falha no envio, Aguardando assinaturas, Finalizando, Concluído, Recusado, Expirado, Cancelado, Arquivado (sandbox). Tones as in `Main.dc.html`'s `STATUS` map; `finalizing` → brand, `archived_sandbox` → neutral.
  - `FILTER_LABELS: Record<EnvelopeFilter, string>` (Todos, Rascunhos, Aguardando, Concluídos, Recusados, Expirados, Cancelados, Com erro) and `FILTER_ORDER: readonly EnvelopeFilter[]` (all, draft, pending, completed, refused, expired, cancelled, failed).
  - `progressTone(status: EnvelopeStatus): 'info' | 'success' | 'danger'`: completed → success; refused or failed → danger; else info.
  - `currentSigningGroup(signers: EnvelopeSigner[]): number | null`: the lowest `orderGroup` with a signer not `signed`; null when all signed.
  - `signerStateView(signer: EnvelopeSigner, envelope: EnvelopeDetail, nowSeconds: number): { label: string; tone: Tone; detail: string | null }`:
    - signed → "Assinou", success, "em 01/10 às 14:32";
    - refused → "Recusou", danger;
    - viewed → "Visualizou", info, "há 40 min";
    - pending, signing order on, and its group after the current one → "Aguarda a vez", neutral, "Recebe o convite quando o Grupo {group} assinar" (gender-neutral wording; the artboard's "Será convidada" assumed a woman);
    - pending → "Aguardando", neutral.
  - `isRemindable(signer, envelope): boolean`: envelope `pending`; signer `pending` or `viewed`; `emailBouncedAt === null`; and, with signing order on, `orderGroup === currentSigningGroup`.
  - `isEmailCorrectable(signer, envelope): boolean`: envelope `pending` or `expired`, signer `pending` or `viewed`.
  - `cooldownEndsAt(signer: EnvelopeSigner, cooldownSeconds: number): number | null`: `max(releasedAt, lastReminderAt) + cooldownSeconds`, ignoring nulls; null when both are null.
  - `secondsUntil(endsAt: number | null, nowSeconds: number): number`: clamped at 0.
  - `availableInLabel(seconds: number): string`: "Disponível em {n} min", using `Math.ceil(seconds / 60)`; `n()` plural.
  - `formatDate(epoch)` → `15/10/2026`. `formatDayMonth(epoch)` → `28/09`. `formatDayTime(epoch)` → `01/10 10:02`. `formatSignedAt(epoch)` → `em 01/10 às 14:32`. `formatRelative(epoch, now)` → `agora` (< 60 s), `há {n} min` (< 60 min), `há {n} h` (same day), `ontem`, `dd/MM` (same year), `dd/MM/yyyy`. All use `Intl.DateTimeFormat(getCanonicalLocale())` with `timeZone` left to the browser.
  - `timelineEntries(envelope: EnvelopeDetail): { id: string; label: string; at: number }[]`, newest first. It merges synthetic "Criado" (`createdAt`) and "Enviado" (`sentAt`) with the events, which carry signer names. The event → label map:

| type | label (pt_BR) |
|---|---|
| `viewed` | {signer} visualizou |
| `signed` | {signer} assinou |
| `refused` (with signer) | {signer} recusou |
| `reminder_sent` | Lembrete enviado para {signer}; when `actorUid === null`: Lembrete automático enviado para {signer} |
| `email_bounced` | Convite para {signer} não entregue |
| `email_corrected` | E-mail de {signer} corrigido |
| `link_copied` | Link de assinatura de {signer} copiado |
| `cancel_requested` | Cancelamento solicitado |
| `cancelled` | Envelope cancelado |
| `discarded` | Envio descartado |
| `reopened` | Voltou a rascunho |
| `deadline_extended` | Prazo alterado para {date} (`detail.deadlineAt`) |
| `completed` | Todos assinaram |
| `expired` | Prazo encerrado |
| `refused` (no signer) | Envelope recusado |
| `send_failed` | Falha no envio |
| `save_failed` | Cópia assinada não salva no Drive |
| any other | Atualização |

  - `useNow(intervalMilliseconds = 1000): Readonly<Ref<number>>`: epoch seconds, updated by `setInterval` and cleared on scope dispose.
  - `useDebounced<Value>(source: Ref<Value>, delayMilliseconds: number): Readonly<Ref<Value>>`.

- [ ] **Step 1: Write the failing specs.**
  - **`dates.spec.ts`:** fix `now` with `vi.setSystemTime` and use `timeZone: 'America/Sao_Paulo'` through `process.env.TZ` in the spec. Assert each format above, including `há 2 h`, `ontem` and the cross-year `dd/MM/yyyy`.
  - **`signer-state.spec.ts`:** use the Detail artboard's data:
    - Ana signed → "Assinou" with "em 01/10 às 14:32";
    - Bruno viewed → "Visualizou";
    - Carla in group 2 pending while group 1 is unfinished → "Aguarda a vez" with "Recebe o convite quando o Grupo 1 assinar";
    - `isRemindable` is false for Carla, false for a bounced Bruno, true for Bruno with `emailBouncedAt` null, and false when the envelope is `expired`.
  - **`cooldown.spec.ts`:**
    - `cooldownEndsAt` with `releasedAt` 1000 and `lastReminderAt` 2000 → 3800;
    - both null → null;
    - `availableInLabel(1430)` → "Disponível em 24 min" (pt_BR through the mocked `n`).
  - **`timeline.spec.ts`:** ordering (newest first), the synthetic entries, an automatic vs manual reminder, and an unknown type → "Atualização".
  - **`envelope-status.spec.ts`:** every `EnvelopeStatus` has a label (iterate a const list of all ten), and `FILTER_ORDER` covers every `EnvelopeFilter`.

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run src/presentation`. Expected: FAIL.

- [ ] **Step 3: Implement.** Use hash maps keyed by status or event type (no `switch`). Add every label to `l10n` with the pt_BR text from the table.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/presentation l10n
git commit -m "feat: add status, signer, cooldown, date and timeline presentation helpers"
```

---

### Task 8: Dashboard (desktop and phone)

**Artboards:** `Main.dc.html`, `Phone-Dashboard.dc.html`.

**Files:**
- Create:
  - `src/dashboard/DashboardView.vue` (replaces the stub), `EnvelopeTable.vue`, `EnvelopeCards.vue`, `FilterChips.vue`, `ListPagination.vue`, `EmptyListing.vue`
  - `src/dashboard/list-query.ts`, `list-query.spec.ts`, `DashboardView.spec.ts`
- Modify: `l10n/pt_BR.{json,js}`

**Interfaces:**
- Consumes: `listEnvelopes`, `QUERY_KEYS.envelopes`, `EnvelopeListQuery`, `deleteDraft`, the kit, `envelopeStatusView`, `FILTER_LABELS`, `FILTER_ORDER`, `progressTone`, `formatRelative`, `formatDate`, `useDebounced`, `useIsPhone`, `appConfig().isAdmin`.
- Produces:
  - `listQueryFromRoute(query: LocationQuery): EnvelopeListQuery`, which validates and falls back to defaults (`scope=mine`, `filter=all`, `search=''`, `sort=recent`, `page=1`, `perPage=25`, `fileId=null`; `scope=all` only when `isAdmin`).
  - `routeQueryFromList(query: EnvelopeListQuery): LocationQueryRaw`, which omits defaults.
  - `PER_PAGE = 25`.

- [ ] **Step 1: Write the failing `list-query.spec.ts`.** It covers:
  - the round trip;
  - garbage values (`filter=x`, `page=-3`, `page=abc`) give defaults;
  - `scope=all` for a non-admin gives `mine`;
  - defaults are omitted from the route query.

- [ ] **Step 2: Write the failing `DashboardView.spec.ts`.** Mock `../api/envelopes.ts` and mount with a memory router and a fresh QueryClient. Cases:
  - **Data:** renders the heading "Meus envelopes" (or "Toda a empresa" with `?scope=all` for an admin) and the description "Documentos que você enviou para assinatura.". Renders a row per envelope with title, documents meta ("3 documentos" / "1 documento"), status pill text, "1 de 3 assinaram" / "1 de 1 assinou", deadline (`—` when null) and updated time.
  - **Chips:** render in `FILTER_ORDER` with `counts`, and the active chip is `aria-pressed="true"`. Clicking "Concluídos" calls `listEnvelopes` with `filter: 'completed', page: 1` and updates the URL query.
  - **Search:** typing "carla" calls `listEnvelopes` with `search: 'carla'` after 300 ms (fake timers), with page reset to 1.
  - **Sort:** the sort control is an `AvMenu` labelled by its current choice ("Mais recentes" / "Prazo mais próximo"); choosing the other refetches with `sort: 'deadline'`.
  - **Pagination:** "1–7 de 26 envelopes". Previous is disabled on page 1. Next calls page 2.
  - **Titles:** a row title links to `/envelopes/<uuid>`.
  - **Draft row menu:** offers "Continuar editando" and "Excluir rascunho". Delete asks in an `AvDialog` ("Excluir rascunho?" / "O rascunho e seus campos são apagados. Os arquivos no Drive não mudam.") and calls `deleteDraft`, then invalidates `QUERY_KEYS.allEnvelopes()`.
  - **Empty, no search:** zero envelopes and no search show the empty state "Nenhum envelope ainda" with a "Novo envelope" button.
  - **Empty, with search:** zero results with a search show "Nenhum envelope encontrado" with a "Limpar busca" button.
  - **Phone:** `matchMedia` true renders cards (`EnvelopeCards`) instead of the table, plus the floating "Novo envelope" pill.
  - **Polling:** an envelope `sending` in the page sets `refetchInterval` to 5000 ms (assert by advancing fake timers and counting calls).

- [ ] **Step 3: Run them and see them fail.** Run `npx vitest run src/dashboard`. Expected: FAIL.

- [ ] **Step 4: Implement.** Copy the layout of `Main.dc.html`'s `<main>` and of `Phone-Dashboard.dc.html` literally.
  - **Header row:** h1 30px with the description 15px muted beneath (`gap: 6px`). To the right, the search `AvTextField` 380px wide with the `Search` leading icon, placeholder "Buscar por título, signatário ou e-mail" and visually hidden label "Buscar envelopes". Then the sort `AvMenu`, whose trigger is a secondary pill with the `ArrowUpDown` icon and the label.
  - **Chips:** a row with `gap: 8px; flex-wrap: wrap` and `role="group" aria-label="Filtrar por situação"`.
  - **Table:**
    - `<table>` with the header row uppercase 13px muted, `letter-spacing: 0.3px`, and a bottom hairline `#e3e7eb`.
    - Column widths: Situação 210, Signatários 250, Prazo 120, Atualizado 120, actions 44.
    - Body cells `padding: 12px` with a bottom hairline `#eef1f3`.
    - Title cell: a 40×40 tile with radius 12, `#f1f4f6` fill, `#00679e` `FileText` icon, and gap 14.
    - Progress: an `AvProgress` 160px wide under a 13px muted label.
  - **Pagination row:** `margin-top: auto`, "1–7 de 26 envelopes" (14px muted) and two outline `AvIconButton`s with `aria-label` "Página anterior" / "Próxima página".
  - **Phone:**
    - heading 26px;
    - full-width search;
    - chips in one non-wrapping row with `overflow-x: auto` (scroll, do not clip; `scroll-snap-type: x proximity`);
    - cards white with radius 20 on the ground colour, stacked with `gap: 12px`;
    - the floating pill fixed `right: 16px; bottom: 16px`, 56px tall, primary, `Plus` icon.
  - **Query and state:**
    - The query is `useQuery({ queryKey: computed(() => QUERY_KEYS.envelopes(listQuery.value)), queryFn: () => listEnvelopes(listQuery.value), placeholderData: keepPreviousData, refetchInterval })`.
    - `refetchInterval` returns `5000` when any listed envelope is `sending` or `finalizing`, else `false`.
    - Route query and list query sync through `router.replace` (`list-query.ts`).
  - **Loading and Suspense:** use `await query.suspense()` in `setup` so the first load shows the frame's Suspense fallback (LoadingView renders 7 `AvSkeleton` rows). Later page changes keep the previous data.
  - **Empty states:** a 64px circle `var(--av-tint)` with a lucide `Inbox` or `SearchX` icon in `var(--av-action)`, the title 20px and the action button.

- [ ] **Step 5: Run the tests, build, bump and check in the preview.** Run `npm test`, `typecheck`, `lint` and `build`. Bump the version and run `occ upgrade`. Load `http://localhost:8088/apps/assinaturas/` with the seed data, then compare it with `Main.dc.html` at 1440×900 and with `Phone-Dashboard.dc.html` at 390×844 (the controller does this in Task 19; the implementer only checks that it renders with no console errors, using `curl` plus the build).

- [ ] **Step 6: Commit.**

```bash
git add src l10n js css appinfo
git commit -m "feat: build the dashboard with server-side search, filters and paging"
```

---

### Task 9: Envelope route and detail (header, actions, documents, timeline)

**Artboards:** `Detail.dc.html`, `Phone-Detail.dc.html`.

**Files:**
- Create:
  - `src/envelope/EnvelopeView.vue` (replaces the stub)
  - `src/detail/DetailView.vue`, `DetailHeader.vue`, `EnvelopeBanners.vue`, `DocumentsCard.vue`, `ProgressCard.vue`, `TimelineCard.vue`, `CancelDialog.vue`, `DeadlineDialog.vue`, `DeleteDialog.vue`
  - `src/detail/envelope-actions.ts`, `envelope-actions.spec.ts`, `DetailView.spec.ts`
- Modify: `l10n/pt_BR.{json,js}`

**Interfaces:**
- Consumes: `getEnvelope`, `sendEnvelope`, `cancelEnvelope`, `discardEnvelope`, `reopenEnvelope`, `extendDeadline`, `deleteAdminEnvelope` (add to `src/api/admin.ts` if missing: `DELETE /admin/envelopes/{uuid}`), `signedFileUrl`, `originalFileUrl`, `activityReportUrl`, `QUERY_KEYS.envelope`, the presentation helpers, `useFrameLayout`, `useIsPhone`.
- Produces:
  - `EnvelopeView`:
    - reads the detail with `useQuery` + `suspense()`;
    - on `ApiError` 404 renders `NotFoundView` ("Envelope não encontrado");
    - when `status === 'draft'` and the user can edit it (owner), renders `WizardView` lazily and calls `useFrameLayout('full-page')`;
    - otherwise renders `DetailView`.
    - Until Task 12 exists, the draft branch renders `DetailView` with a "Rascunho" header; Task 12 swaps it in.
  - `envelopeActions(envelope: EnvelopeDetail, isOwner: boolean, isAdmin: boolean): EnvelopeAction[]`, where `EnvelopeAction = 'download-originals' | 'download-signed' | 'activity-report' | 'cancel' | 'extend-deadline' | 'retry-send' | 'reopen' | 'discard' | 'delete'`. The rules, as data:

| status | owner actions | admin extra |
|---|---|---|
| sending, finalizing | — | — |
| failed | retry-send, reopen, discard | delete |
| pending | download-originals, activity-report, cancel, extend-deadline | delete |
| expired | download-originals, activity-report, cancel, extend-deadline | delete |
| completed | download-signed, download-originals, activity-report | delete |
| refused, cancelled | download-originals, activity-report | delete |
| archived_sandbox | — | delete |

    Downloads are allowed to the owner and admins, so a non-owner admin also gets the download and report actions. Mutating actions are owner-only. While `cancelRequestedAt` is set on a pending or expired envelope, `cancel` is hidden.
  - `DetailView` polls every 5000 ms while `status` is `sending` or `finalizing`, or `cancelRequestedAt !== null`.

- [ ] **Step 1: Write the failing `envelope-actions.spec.ts`.** Write a table-driven test over every row above, for owner, non-owner admin and owner-with-cancel-requested.

- [ ] **Step 2: Write the failing `DetailView.spec.ts`.** Use the seed-like detail fixture: 3 documents, Ana signed, Bruno viewed and bounced, Carla in group 2. Cases:
  - **Header:** a back link (`aria-label` "Voltar aos envelopes") to the dashboard, the h1 title, the "Aguardando assinaturas" pill, and the meta "Enviado em 01/10/2026 por Patrick Rezende · Prazo 15/10/2026" with "Alterar prazo". The owner display name comes from the detail; if the API has only `ownerUid`, show the current user's display name when `ownerUid` matches `getCurrentUser().uid`, else the uid.
  - **Download menu:** "Baixar originais" with 3 documents opens an `AvMenu` listing each document as a link to `originalFileUrl`. With 1 document it is a direct link.
  - **Cancel:** "Cancelar envelope" opens `CancelDialog`, whose reason textarea is required (1–500 characters, counter shown). The dialog warns "Todos os signatários recebem um e-mail da ZapSign avisando do cancelamento, inclusive quem ainda não foi convidado.". Confirming calls `cancelEnvelope(uuid, reason)`.
    - On 200 it updates the cache with `setQueryData` and shows a toast "Envelope cancelado".
    - On 202 (a detail still `pending` with `cancelRequestedAt`) it shows the info banner "Cancelamento em andamento. A ZapSign confirma em alguns minutos." and the toast "Cancelamento solicitado".
  - **Deadline:** `DeadlineDialog` takes a date input (`type="date"`, `min` = tomorrow, and later than the current deadline) and calls `extendDeadline(uuid, 'YYYY-MM-DD')`. A 422 `deadline_not_later` shows the `errorMessage` text inline.
  - **Failed:** a failed envelope shows a danger banner with `errorMessage` for its `error` code, plus "Tentar novamente" (calls `sendEnvelope`, then refetches), "Voltar a rascunho" (`reopenEnvelope`) and "Descartar" (`discardEnvelope`, confirm dialog).
  - **Closed:** a refused envelope shows its `refusedReason` in a danger banner "Recusado: …". A cancelled one shows `cancelReason` in a neutral banner.
  - **Documents card:** each document shows its name and pages, then "Original" (sent envelopes), "Assinado" (completed, or when `signedFileId` is set) and "Abrir no Drive" (`generateUrl('/f/{id}')` with `signedFileId ?? sourceFileId`). The muted line reads "As cópias assinadas serão salvas em {folder} quando todos assinarem." (folder = dirname of the main document's `sourcePath` + "/Assinados"). A `save_failed` document shows the warning "Não foi possível salvar a cópia assinada no Drive.".
  - **Progress card:** "Andamento", "1 de 3 assinaram", and an `AvProgress`.
  - **Timeline:** `timelineEntries` rendered as an `<ol>`, newest first, with dots and connecting lines as in the artboard.
  - **Polling:** a `sending` envelope triggers a refetch after 5 s.
  - **Not found:** a 404 renders "Envelope não encontrado" with a link back.
  - **Phone:** the phone layout (matchMedia true) shows the stacked layout and the sticky bottom bar with "Cancelar envelope" when cancel is allowed.

- [ ] **Step 3: Run them and see them fail.** Run `npx vitest run src/detail src/envelope`. Expected: FAIL.

- [ ] **Step 4: Implement.** Copy the layout from `Detail.dc.html` and `Phone-Detail.dc.html`.
  - **Desktop:**
    - two columns: left `flex: 1`, right `width: 360px`, `gap: 24px`;
    - the top row has the back `AvIconButton` (outline, `ArrowLeft`), the h1, the pill, the meta line, and the actions right-aligned (secondary "Baixar originais" with `Download`, danger "Cancelar envelope", an overflow `AvMenu` with `EllipsisVertical` for the remaining actions and admin "Excluir").
  - **Phone:** the app bar "Envelope" with back and overflow, then the 26px title, pill, meta, progress card, banners, signers (Task 10), the "3 documentos" disclosure button (`aria-expanded`), and the sticky bottom bar.
  - **Mutations:** `useMutation` whose `onSuccess` calls `queryClient.setQueryData(QUERY_KEYS.envelope(uuid), detail)` and `invalidateQueries({ queryKey: QUERY_KEYS.allEnvelopes() })`. `onError` shows `showError(errorMessage(error))`, except inline errors in dialogs.
  - **Admin delete:** `DeleteDialog` warns about notifying signers on live envelopes (copy: "Os signatários recebem um e-mail de cancelamento da ZapSign. Os arquivos no Drive não mudam."). It navigates to the dashboard on success.

- [ ] **Step 5: Run the tests, build, bump and commit.**

```bash
git add src l10n js css appinfo
git commit -m "feat: show the envelope detail with its actions, documents and timeline"
```

---

### Task 10: Detail signers and per-signer actions

**Artboards:** `Detail.dc.html` (signers card, bounce banner), `Phone-Detail.dc.html` (signer cards).

**Files:**
- Create: `src/detail/SignersCard.vue`, `src/detail/SignerRow.vue`, `src/detail/BounceBanner.vue`, `src/detail/CorrectEmailDialog.vue`, `src/detail/use-signer-cooldowns.ts`, `src/detail/SignersCard.spec.ts`, `src/detail/use-signer-cooldowns.spec.ts`
- Modify: `src/detail/DetailView.vue` (mount them), `l10n/pt_BR.{json,js}`

**Interfaces:**
- Consumes: `remindSigner`, `correctSignerEmail`, `copySignLink`, `signerStateView`, `isRemindable`, `isEmailCorrectable`, `cooldownEndsAt`, `secondsUntil`, `availableInLabel`, `useNow`, `appConfig().limits.reminderCooldownSeconds`.
- Produces:
  - `useSignerCooldowns(uuid: Ref<string>): { endsAt(signer: EnvelopeSigner): number | null; hold(signerId: number, seconds: number): void }`.
  - Local holds come from `reminder_cooldown` (`retryAfterSeconds`), from `provider_unreachable` on remind (the reminder may have gone out, so hold the full cooldown, per `docs/api.md`), and from `inviteAvailableInSeconds` after a correction.
  - Holds live in a component-scoped `ref(new Map())` created inside the composable, not at module level.
  - `endsAt` returns the later of the server-derived end and the local hold.

- [ ] **Step 1: Write the failing `use-signer-cooldowns.spec.ts`.**
  - The server end comes from `releasedAt` and `lastReminderAt`.
  - A hold beyond the server end wins.
  - A hold for one signer does not affect another.

- [ ] **Step 2: Write the failing `SignersCard.spec.ts`.** Use the Detail fixture with `now` fixed. Cases:
  - **Groups:** "Grupo 1" and "Grupo 2" headings show when `signingOrder` is true; there are no group headings when it is false.
  - **Rows:** each row shows the avatar (signer colour), name, email, `AvStatusPill` with the state label, and the detail text.
  - **Reminder countdown:** Bruno's "Lembrar" (lucide `Clock`) is disabled with the visible text "Disponível em 24 min" and `aria-label` "Lembrar: disponível em 24 min" while the cooldown runs. Advancing time past the end enables it and shows "Lembrar".
  - **Remind:** clicking "Lembrar" calls `remindSigner` and shows the toast "Lembrete enviado para Bruno Costa".
    - A 429 `reminder_cooldown` with `retryAfterSeconds: 600` shows "Disponível em 10 min".
    - A 502 `provider_unreachable` shows the toast `errorMessage` and holds the full 30 minutes.
  - **No remind button:** a signer who is not remindable (signed, waiting for their turn, bounced) has no "Lembrar" button.
  - **Correct email:** "Corrigir e-mail" (ghost button) opens `CorrectEmailDialog` with the email prefilled. Saving calls `correctSignerEmail`.
    - `invited: true` → toast "Convite enviado para {email}".
    - `inviteAvailableInSeconds: 1080` → toast "E-mail corrigido. O convite sai em 18 min." and a hold, so "Reenviar" appears on that row once the hold ends (same remind action, label "Reenviar").
    - `invited: false` without seconds → toast "E-mail corrigido. O convite chega na vez deste signatário.".
  - **Validation:** the dialog shows inline errors for `signer_email_invalid`, `signer_email_unchanged` and `signer_email_duplicate`.
  - **Copy link:** "Copiar link de assinatura" (`AvIconButton` with `Link` icon) calls `copySignLink`, then `navigator.clipboard.writeText` (mocked), then the toast "Link copiado. Ele dá acesso à assinatura: envie só para {name}.". The URL is never rendered and never passed to `logger`. Assert the logger mock was not called with it.
  - **Bounce banner:** a bounced signer adds a warning banner above the card: "O convite para {email} não pôde ser entregue." with a "Corrigir e-mail" action opening the same dialog.
  - **Visibility rules:** actions render only for the owner, and only on `pending` (remind, link) or `pending`/`expired` (correct).

- [ ] **Step 3: Run them and see them fail.** Then implement, matching the artboards:
  - rows `padding: 16px 0` with a hairline between them;
  - avatar 36px;
  - name 15px; email 13px muted;
  - actions right-aligned with `gap: 8px`;
  - the disabled "Lembrar" uses `color: var(--av-muted)` on `var(--av-subtle-fill)` with a `var(--av-hairline)` border, and the icon is `var(--av-disabled)` (this keeps 4.5:1 text contrast, as the Detail artboard notes);
  - phone: one card per signer (radius 20, border), with the actions wrapping under the status.

- [ ] **Step 4: Run the tests, build, bump and commit.**

```bash
git add src l10n js css appinfo
git commit -m "feat: let the sender remind, correct and copy links per signer with ZapSign's cooldown"
```

---

### Task 11: Files sidebar tab

**Artboard:** `Files-Sidebar.dc.html`, the right panel only. The Files app around it is Nextcloud's own.

**Files:**
- Create: `src/files/sidebar-tab.ts`, `src/files/FilesSidebarTab.vue`, `src/files/sidebar-tab.spec.ts`, `src/files/FilesSidebarTab.spec.ts`, `src/icons/signature-svg.ts`
- Modify: `src/files-init.ts` (call `registerAssinaturasSidebarTab()`), `l10n/pt_BR.{json,js}`

**Interfaces:**
- Consumes:
  - `registerSidebarTab`, `FileType` and `INode` from `@nextcloud/files` 4.1;
  - `isPublicShare` from `@nextcloud/sharing/public`;
  - `listEnvelopes` with `fileId`;
  - `envelopePageUrl(uuid)` from `src/app-urls.ts`;
  - `createEnvelopeFromFiles` from `src/files/create-envelope-from-files.ts` (3a);
  - `createQueryClient`, `VueQueryPlugin`, the kit, `envelopeStatusView`.
- Produces:
  - `SIDEBAR_TAB_ID = 'assinaturas'`, `SIDEBAR_TAG_NAME = 'assinaturas-files-sidebar-tab'`, `SIDEBAR_TAB_ORDER = 95`.
  - `registerAssinaturasSidebarTab(): void`, called once from `files-init.ts`. The bundle is already loaded only for members, via the `LoadAdditionalScriptsEvent` listener; Files dispatches that event before the sidebar renders.
  - `isSidebarTabEnabled(node: INode): boolean`: `node.type === FileType.File && node.mime === PDF_MIME_TYPE && !isPublicShare()`.

- [ ] **Step 1: Write the failing `sidebar-tab.spec.ts`.** Mock `@nextcloud/files`. It checks:
  - `registerSidebarTab` is called once with the id, tag name, order, `displayName` "Assinaturas" and an `iconSvgInline` that starts with `<svg`;
  - `enabled` is true for a PDF file, false for a folder, false for a `.docx`, and false on a public share;
  - `onInit` defines the custom element once, and a second call does not throw (guard with `customElements.get`).

- [ ] **Step 2: Implement `sidebar-tab.ts`.**

```ts
import { FileType, registerSidebarTab } from '@nextcloud/files'
import type { INode } from '@nextcloud/files'
import { t } from '@nextcloud/l10n'
import { isPublicShare } from '@nextcloud/sharing/public'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { defineAsyncComponent, defineCustomElement } from 'vue'
import { APP_ID } from '../app-config.ts'
import { PDF_MIME_TYPE } from '../draft-from-files.ts'
import { SIGNATURE_SVG } from '../icons/signature-svg.ts'
import { createQueryClient } from '../query-client.ts'

export const SIDEBAR_TAB_ID = 'assinaturas'
export const SIDEBAR_TAG_NAME = 'assinaturas-files-sidebar-tab'
export const SIDEBAR_TAB_ORDER = 95

export function isSidebarTabEnabled(node: INode): boolean {
	return node.type === FileType.File && node.mime === PDF_MIME_TYPE && !isPublicShare()
}

async function defineTabElement(): Promise<void> {
	if (window.customElements.get(SIDEBAR_TAG_NAME) !== undefined) {
		return
	}
	const FilesSidebarTab = defineAsyncComponent(() => import('./FilesSidebarTab.vue'))
	window.customElements.define(SIDEBAR_TAG_NAME, defineCustomElement(FilesSidebarTab, {
		shadowRoot: false,
		configureApp(app) {
			app.use(VueQueryPlugin, { queryClient: createQueryClient() })
		},
	}))
}

export function registerAssinaturasSidebarTab(): void {
	registerSidebarTab({
		id: SIDEBAR_TAB_ID,
		tagName: SIDEBAR_TAG_NAME,
		order: SIDEBAR_TAB_ORDER,
		displayName: t(APP_ID, 'Signatures'),
		iconSvgInline: SIGNATURE_SVG,
		enabled: ({ node }) => isSidebarTabEnabled(node),
		onInit: defineTabElement,
	})
}
```
`src/icons/signature-svg.ts` exports the lucide "signature" icon as a raw SVG string (`viewBox="0 0 24 24"`, `stroke="currentColor"`, `stroke-width="1.5"`, paths copied from `Main.dc.html`'s Assinaturas header icon). If `defineCustomElement`'s `configureApp` is missing from the installed Vue typings, upgrade `vue` within `^3.5` (it was added in 3.5).

- [ ] **Step 3: Write the failing `FilesSidebarTab.spec.ts`.** Props: `active: boolean`, `node: INode`. Cases:
  - **Lookup:** it lists envelopes from `listEnvelopes({ scope: 'mine', filter: 'all', search: '', sort: 'recent', page: 1, perPage: 10, fileId: node.fileid })`, refetching when `node.fileid` changes (query key includes it).
  - **Open envelopes:** each `pending`, `sending`, `finalizing`, `draft`, `failed` or `expired` envelope shows a card: title, `AvStatusPill`, "1 de 3 assinaram" with `AvProgress`, and an "Abrir envelope" link to `envelopePageUrl(uuid)`.
  - **Closed envelopes:** `completed`, `refused` and `cancelled` envelopes are collapsed cards (title + pill) with a disclosure button (`aria-expanded="false"`) that expands the same body.
  - **Send button:** "Enviar para assinatura" (primary, full width, `Signature` icon) calls `createEnvelopeFromFiles([node])`.
  - **Empty:** zero envelopes show "Este arquivo ainda não foi enviado para assinatura." above the button.
  - **Inactive tab:** `active: false` does not fetch (`enabled: computed(() => props.active)`).

- [ ] **Step 4: Implement `FilesSidebarTab.vue`** with the artboard's right-panel content. The root is `<div class="av-root">`, so the tokens apply; Questrial comes from the Avuz theme, like the rest of Files. Then run the tests: PASS.

- [ ] **Step 5: Build, bump and commit.** Run `npm run build`. Confirm `js/assinaturas-files-init.mjs` stays small (the tab component is a separate chunk) and record its size in the commit message body. Bump the version and run `occ upgrade`.

```bash
git add src l10n js css appinfo
git commit -m "feat: show a PDF's envelopes in a Files sidebar tab"
```

---
### Task 12: Wizard shell and step 1 (Documentos)

**Artboards:** `Wizard-Documents.dc.html`. The shell (top bar, stepper, bottom bar) is identical across the four wizard artboards.

**Files:**
- Create:
  - `src/wizard/WizardView.vue`, `WizardTopBar.vue`, `WizardStepper.vue`, `WizardBottomBar.vue`, `DocumentsStep.vue`, `LimitsCard.vue`
  - `src/wizard/wizard-steps.ts`, `wizard-steps.spec.ts`, `envelope-settings.ts`, `envelope-settings.spec.ts`, `step-registration.ts`
  - `src/wizard/DocumentsStep.spec.ts`, `WizardView.spec.ts`
- Modify:
  - `src/envelope/EnvelopeView.vue`: draft → `WizardView` (lazy) + `useFrameLayout('full-page')`
  - `src/new-envelope.ts`: export `pickPdfNodes(title: string): Promise<Node[]>`, used here and by the Files action; reuse 3a's picker code
  - `l10n/pt_BR.{json,js}`

**Interfaces:**
- Consumes: `replaceDocuments`, `updateEnvelope`, `deleteDraft`, `QUERY_KEYS.envelope`, the kit, `appConfig().limits`, `errorMessage`.
- Produces:
  - `WIZARD_STEPS = ['documents', 'signers', 'placement', 'review'] as const`; `type WizardStep = typeof WIZARD_STEPS[number]`.
  - `stepFromQuery(value: unknown): WizardStep`, which defaults to `documents`.
  - `STEP_LABELS: Record<WizardStep, string>`: Documentos, Signatários, Posicionamento, Revisão.
  - `canEnterStep(step: WizardStep, envelope: EnvelopeDetail): boolean`:
    - documents is always enterable;
    - signers needs ≥ 1 document;
    - placement and review need ≥ 1 document and ≥ 1 signer.
  - `settingsFrom(envelope: EnvelopeDetail, patch: Partial<EnvelopeSettings>): EnvelopeSettings`. It converts `deadlineAt` (epoch) to `YYYY-MM-DD` in the browser timezone, or null.
  - `provideStepRegistration()` / `useStepRegistration(flush: () => Promise<boolean>)`. The active step registers a `flush` that saves pending edits and resolves `false` when they are invalid. `WizardView` awaits it before changing steps.
  - The bottom bar's save state comes from `useIsMutating({ mutationKey: ['draft-save', uuid] })` and the last mutation error: "Rascunho salvo automaticamente" / "Salvando…" / "Não foi possível salvar" + "Tentar novamente". Every draft mutation in the wizard uses `mutationKey: ['draft-save', uuid]`; add it to `QUERY_KEYS` as `draftSave(uuid)`.

- [ ] **Step 1: Write the failing `wizard-steps.spec.ts` and `envelope-settings.spec.ts`.**
  - `stepFromQuery('signers')` → `signers`; `stepFromQuery('x')` → `documents`.
  - `canEnterStep` for each rule.
  - `settingsFrom` keeps the other fields and converts a deadline epoch to its calendar date in `America/Sao_Paulo`.

- [ ] **Step 2: Write the failing `WizardView.spec.ts`.** Cases:
  - **Top bar:** the back link "Voltar aos envelopes", the envelope title and the "Rascunho" pill.
  - **Stepper:**
    - an `<ol aria-label="Etapas do envelope">` with 4 items;
    - the current item has `aria-current="step"`;
    - done steps are links (they navigate);
    - steps that cannot be entered are not interactive.
  - **Continuar:** it awaits the step's `flush`. `true` moves to the next step (`?step=` in the URL); `false` stays.
  - **Voltar:** on step 1 it is a link to the dashboard.
  - **Save state:** while a `draft-save` mutation runs, the bottom bar says "Salvando…".

- [ ] **Step 3: Write the failing `DocumentsStep.spec.ts`.** Cases:
  - **Title:** the title field "Título do envelope", edited, calls `updateEnvelope` once after 600 ms with `settingsFrom(envelope, { title })`. An empty title shows "Informe um título." and does not save.
  - **Rows:** each document row shows name, "6 páginas · 1,8 MB · Drive / Contratos / 2026", and the "Principal" tag on the first.
    - The meta uses `pageCount` (or "Páginas após abrir o posicionamento" when null), `size` with a pt-BR decimal comma, and `dirname(sourcePath)` with `/` shown as ` / ` after "Drive".
    - A document whose `size` is null shows the danger text "Arquivo não encontrado no Drive".
  - **Reorder with the keyboard:** the grip button ("Reordenar {name}") with ArrowUp/ArrowDown moves the row. It calls `replaceDocuments` with the new order and announces "{name} movido para a posição 2" in an `aria-live="polite"` region.
  - **Reorder with the pointer:** dragging the grip reorders too. Test the pure reorder function `moveItem(list, from, to)` in `wizard-steps.spec.ts`; the pointer wiring is checked in the Task 19 browser pass.
  - **Remove:** "Remover {name}" calls `replaceDocuments` without it. It is disabled when only one document is left (`aria-disabled`, with the title "Um envelope precisa de pelo menos um documento").
  - **Add:** "Adicionar do Drive" calls `pickPdfNodes`, then `replaceDocuments(uuid, [...current, ...picked ids without duplicates])`. A rejection (`file_not_pdf`, `envelope_too_large`, …) shows `errorMessage` as a toast and leaves the list unchanged.
  - **Limits card:**
    - "3 de 20 arquivos" and "2,7 MB de 20 MB" with `AvProgress` bars (`aria-hidden`; the text carries the numbers);
    - "Cada envio consome 1 envelope do plano.";
    - "Somente PDF.";
    - the hint "O primeiro documento é o principal; arraste para reordenar.".
    - Bytes → MB uses 1 MB = 1,000,000 bytes, matching the server's `MAX_ENVELOPE_BYTES = 20_000_000`.
  - **Flush:** `flush` resolves `true` when there is ≥ 1 document and a valid title, after any pending title save finishes.

- [ ] **Step 4: Run them and see them fail.** Then implement, copying `Wizard-Documents.dc.html`:
  - **Shell:**
    - a single white panel, radius 35;
    - top bar `padding: 24px 32px`, bottom hairline, back button, title 20px, pill;
    - stepper circles 32px:
      - done: `var(--av-action)` fill with a white `Check`;
      - current: `var(--av-ink)` fill with a white number;
      - upcoming: white with a `var(--av-input-border)` border and `var(--av-muted)` number;
    - labels 14px, and 1px connecting lines 32px long;
    - bottom bar `padding: 16px 32px` with a top hairline: the left status has a `CloudCheck` icon and 14px muted text; the right side has "Voltar" (secondary) and "Continuar" (primary);
    - content area: two columns `minmax(0, 896px)` and `440px` with `gap: 24px`, scrolling inside.
  - **Phone:** the top bar becomes an app bar with back, the title and "Passo 1 de 4". The stepper becomes that meta line. Content is one column. The bottom bar is sticky with full-width buttons.
  - **Mutations:** `useMutation` with `mutationKey: QUERY_KEYS.draftSave(uuid)` and `onSuccess` → `setQueryData(QUERY_KEYS.envelope(uuid), detail)`.

- [ ] **Step 5: Run the tests, build, bump and commit.**

```bash
git add src l10n js css appinfo
git commit -m "feat: open drafts in a full-page wizard and edit their documents"
```

---

### Task 13: Step 2 (Signatários)

**Artboard:** `Wizard-Signers.dc.html`.

**Files:**
- Create: `src/wizard/SignersStep.vue`, `src/wizard/SignerFormRow.vue`, `src/wizard/signer-form.ts`, `src/wizard/signer-form.spec.ts`, `src/wizard/SignersStep.spec.ts`
- Modify: `l10n/pt_BR.{json,js}`

**Interfaces:**
- Consumes: `replaceSigners`, `updateEnvelope`, `settingsFrom`, `useStepRegistration`, `appConfig().limits` (`maxSigners`, `maxNameLength`), the kit.
- Produces:
  - `interface SignerDraft { key: string; name: string; email: string; orderGroup: number }`
  - `signerDraftsFrom(signers: EnvelopeSigner[]): SignerDraft[]`
  - `validateSigners(drafts: SignerDraft[], limits: EnvelopeLimits): Map<string, { name?: string; email?: string }>`:
    - name required ("Informe o nome."), at most `maxNameLength`;
    - email matches `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` after trim + lowercase ("Informe um e-mail válido."), at most 320;
    - duplicate emails get "Este e-mail já está na lista.";
    - more than `maxSigners` gives a list-level error.
  - `toSignerInputs(drafts: SignerDraft[]): SignerInput[]`: trims, lowercases emails, and renumbers groups to be dense starting at 1, keeping relative order.
  - `signersChanged(drafts: SignerDraft[], signers: EnvelopeSigner[]): boolean`.

- [ ] **Step 1: Write the failing `signer-form.spec.ts`.**
  - **Validation:** each error case, the duplicate check ignoring case and spaces, and dense renumbering (groups `[1, 3, 3]` → `[1, 2, 2]`).
  - **Change detection:** `signersChanged` is false for an untouched list.

- [ ] **Step 2: Write the failing `SignersStep.spec.ts`.**
  - **Signing-order switch:** the switch "Definir ordem de assinatura" with the description "Signatários do mesmo grupo assinam ao mesmo tempo." Toggling it saves `signingOrder` through `updateEnvelope` right away.
  - **Order on:** rows are grouped into "Grupo N" cards with hints ("Assinam primeiro" / "Assinam depois do grupo {n-1}"). Each row has a group `AvSelect` (options Grupo 1 … Grupo {count}).
  - **Order off:** a single card without groups or selects.
  - **Rows:** each row has an avatar (`color` = saved signer colour or the row index), "Nome" and "E-mail" fields (visible column headers once per card; per-input labels visually hidden, as the artboard notes), and "Remover {name}".
  - **Adding:** "Adicionar signatário" appends an empty row in the last group and focuses its name field. It is disabled at `maxSigners`.
  - **Errors:** shown after blur or after a failed `flush`, with `aria-invalid` and the message under the field.
  - **`flush` when nothing changed:** resolves true without calling the API.
  - **`flush` with valid changes:**
    - if any document has fields, it first asks in an `AvDialog`: "Alterar os signatários apaga os campos posicionados. Eles são posicionados de novo automaticamente.", with "Continuar" / "Voltar";
    - it then calls `replaceSigners(uuid, toSignerInputs(drafts))` and resolves true.
  - **`flush` with invalid rows:** resolves false and moves focus to the first invalid field.
  - **Side card:** "Como funciona" with the three lines of the artboard.
  - **Server errors:** a 422 from the server (`signer_email_duplicate`, …) maps through `errorMessage` to a toast, and `flush` resolves false.

- [ ] **Step 3: Run them and see them fail, then implement.** Copy `Wizard-Signers.dc.html`: group cards radius 20 with a border; rows 44px; the visual column headers once per card; the error row style; the side card. Phone: one column, each signer a card with stacked fields.

- [ ] **Step 4: Run the tests, build, bump and commit.**

```bash
git add src l10n js css appinfo
git commit -m "feat: type signers by hand with optional signing groups"
```

---

### Task 14: PDF rendering foundation

**Files:**
- Create: `scripts/copy-pdfjs-assets.mjs`, `src/pdf/pdf-loader.ts`, `src/pdf/pdf-document.ts`, `src/pdf/PdfPageCanvas.vue`, `src/pdf/pdf-document.spec.ts`, `src/pdf/PdfPageCanvas.spec.ts`
- Modify: `package.json` (`pdfjs-dist` exactly `5.7.284`; `"build": "node scripts/copy-pdfjs-assets.mjs && vite --mode production build"`, and the same prefix for `dev`), `src/main.ts` (`subscribePdfCleanup(queryClient)`), `lib/Controller/PageController.php` (CSP check), `.gitignore` (nothing: `js/pdfjs/` is committed)

**Interfaces:**
- Consumes: `getDocumentSource`, `QUERY_KEYS.documentSource`.
- Produces:
  - `loadPdfjs(): Promise<typeof import('pdfjs-dist')>` sets `GlobalWorkerOptions.workerSrc` from `pdfjs-dist/build/pdf.worker.min.mjs?url`. It is a lazy import, so the main chunk stays without pdf.js.
  - `PDFJS_ASSET_URLS`: `{ cMapUrl, standardFontDataUrl, wasmUrl }` built with `generateFilePath(APP_ID, '', 'js/pdfjs/<folder>/')`.
  - `interface OpenedPdf { document: PDFDocumentProxy; pages: EnvelopePage[] }`, where `pages[i] = { width, height, rotation }` comes from `getPage(i + 1)` (`getViewport({ scale: 1 })`, rotation = `page.rotate`). Width and height are the DISPLAYED size in points, as the API's top-left 0..1 box coordinates expect.
  - `usePdfDocument(uuid: Ref<string>, document: Ref<EnvelopeDocument | null>)`, a `useQuery` with:
    - key `QUERY_KEYS.documentSource(uuid, document.id, document.sourceFileId)`;
    - `queryFn` = fetch the bytes, then `getDocument({ data, cMapUrl, cMapPacked: true, standardFontDataUrl, wasmUrl }).promise`, then the pages;
    - `staleTime: Infinity`, `gcTime: 300_000`, `structuralSharing: false`, `enabled` when the document is non-null.
  - `subscribePdfCleanup(queryClient: QueryClient): () => void` calls `document.destroy()` when a `document-source` query is removed from the cache.
  - `PdfPageCanvas` props: `pdf: PDFDocumentProxy`, `pageIndex: number`, `scale: number`, `label: string`.
    - It renders into a `<canvas role="img" :aria-label="label">` at `scale * devicePixelRatio`, with CSS size `width * scale`.
    - It cancels the previous `RenderTask` when props change.
    - It emits `rendered`.
    - Rendering only starts once the canvas is visible (IntersectionObserver), so thumbnail lists stay cheap.

- [ ] **Step 1: Install pdfjs-dist and copy its assets.** Run `npm install pdfjs-dist@5.7.284 --save-exact`.

`scripts/copy-pdfjs-assets.mjs`:

```js
// Copies pdf.js runtime assets (character maps, standard fonts, wasm decoders) into js/pdfjs/.
// The Nextcloud page serves them as static files; pdf.js loads them from PDFJS_ASSET_URLS.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const SOURCE = resolve('node_modules', 'pdfjs-dist')
const TARGET = resolve('js', 'pdfjs')
const FOLDERS = ['cmaps', 'standard_fonts', 'wasm', 'iccs']

rmSync(TARGET, { recursive: true, force: true })
mkdirSync(TARGET, { recursive: true })
for (const folder of FOLDERS) {
	const from = resolve(SOURCE, folder)
	if (existsSync(from)) {
		cpSync(from, resolve(TARGET, folder), { recursive: true })
	}
}
```

- [ ] **Step 2: Write the failing `pdf-document.spec.ts`.** Mock `./pdf-loader.ts` with a fake `getDocument` returning 2 pages: one 595×842 with rotation 0, one with rotation 90 whose viewport is 842×595.
  - The opened PDF reports `pages` `[{width: 595, height: 842, rotation: 0}, {width: 842, height: 595, rotation: 90}]`.
  - `getDocumentSource` is called once for two consumers of the same key.
  - Removing the query calls `destroy()`.

- [ ] **Step 3: Write the failing `PdfPageCanvas.spec.ts`.** Stub IntersectionObserver as immediately visible and `HTMLCanvasElement.getContext`.
  - The canvas CSS width is `595 * scale` px.
  - `page.render` is called with a viewport of `scale * devicePixelRatio`.
  - A scale change cancels the previous render task.

- [ ] **Step 4: Implement, then run the tests.** Expected: PASS.

- [ ] **Step 5: Check the CSP.** `PageController` already adds `worker-src 'self'`. Keep it. Add a PHP assertion in `PageControllerTest` that the policy contains `worker-src 'self'`, if one is not there yet. In the Task 19 browser pass, confirm that the console shows no CSP error for the worker or the wasm. If the wasm fetch is blocked, add `$policy->allowEvalWasm(true);` and note it.

- [ ] **Step 6: Build and check the chunks.** Run `npm run build`. Verify that `js/assinaturas-main.mjs` does not contain `pdfjs` (`grep -c GlobalWorkerOptions js/assinaturas-main.mjs` → 0), that a `dist/pdf.worker.min-*.mjs` exists, and that `js/pdfjs/cmaps` exists.

- [ ] **Step 7: Bump and commit.** Bump the version and run `occ upgrade`.

```bash
git add package.json package-lock.json scripts src lib tests js css dist appinfo
git commit -m "feat: render PDF pages with a lazily loaded pdf.js 5.7.284"
```

---

### Task 15: Placement geometry and auto-placement

Pure TypeScript. Every rule from the spec and the ZapSign findings lives here, fully unit-tested.

**Files:**
- Create: `src/placement/geometry.ts`, `src/placement/auto-placement.ts`, `src/placement/geometry.spec.ts`, `src/placement/auto-placement.spec.ts`

**Interfaces:**
- Consumes: `EnvelopePage`, `EnvelopeField`, `FieldInput` and `FieldType` from `src/api/types.ts`.
- Produces the code below, exactly.

- [ ] **Step 1: Write the failing `geometry.spec.ts`.**

```ts
import { describe, expect, it } from 'vitest'
import {
	clampBox, footprintWidth, fromField, moveBox, nudgeBox, overflowsStamp, overlapsFooter,
	resizeFromCorner, toFieldInput, ZAPSIGN_FOOTER_POINTS,
} from './geometry.ts'

const A4 = { width: 595, height: 842, rotation: 0 }
const box = { id: 'b1', signerId: 3, type: 'signature' as const, page: 0, x: 100, y: 600, width: 100, height: 40 }

describe('field conversion', () => {
	it('normalizes points to the 0..1 top-left space of the displayed page', () => {
		expect(toFieldInput(box, [A4])).toEqual({ signerId: 3, type: 'signature', page: 0, x: 100 / 595, y: 600 / 842, width: 100 / 595, height: 40 / 842 })
	})

	it('reads an API field back into points on its own page size', () => {
		const landscape = { width: 842, height: 595, rotation: 90 }
		const field = { id: 7, signerId: 3, type: 'initials' as const, page: 1, x: 0.5, y: 0.5, width: 0.1, height: 0.05 }
		expect(fromField(field, [A4, landscape])).toMatchObject({ page: 1, x: 421, y: 297.5, width: 84.2, height: 29.75 })
	})
})

describe('moving', () => {
	it('moves by a point delta', () => {
		expect(moveBox(box, 10, -20, A4)).toMatchObject({ x: 110, y: 580 })
	})

	it('keeps the box inside the page', () => {
		expect(moveBox(box, 10_000, 10_000, A4)).toMatchObject({ x: 495, y: 802 })
		expect(moveBox(box, -10_000, -10_000, A4)).toMatchObject({ x: 0, y: 0 })
	})

	it('nudges with the keyboard step', () => {
		expect(nudgeBox(box, 'ArrowRight', false, A4)).toMatchObject({ x: 104, width: 100 })
	})
})

describe('resizing', () => {
	it('keeps the aspect ratio from the bottom-right corner', () => {
		expect(resizeFromCorner(box, 'bottom-right', 50, A4)).toMatchObject({ x: 100, y: 600, width: 150, height: 60 })
	})

	it('anchors the opposite corner when resizing from the top-left', () => {
		expect(resizeFromCorner(box, 'top-left', 50, A4)).toMatchObject({ x: 50, y: 580, width: 150, height: 60 })
	})

	it('never goes below the minimum width of its type', () => {
		expect(resizeFromCorner(box, 'bottom-right', -1000, A4).width).toBe(60)
	})

	it('stops at the page edge', () => {
		expect(resizeFromCorner(box, 'bottom-right', 10_000, A4).width).toBe(495)
	})

	it('resizes with shift and the arrow keys', () => {
		expect(nudgeBox(box, 'ArrowRight', true, A4)).toMatchObject({ width: 104, height: 41.6 })
	})
})

describe('ZapSign constraints', () => {
	it('measures the stamp at 2.5 times the box width', () => {
		expect(footprintWidth(box)).toBe(250)
	})

	it('flags a stamp that would print past the right edge', () => {
		expect(overflowsStamp({ ...box, x: 400 }, A4)).toBe(true)
		expect(overflowsStamp({ ...box, x: 400 }, { ...A4, width: 842 })).toBe(false)
	})

	it('flags a box inside the ZapSign footer band', () => {
		expect(overlapsFooter({ ...box, y: A4.height - ZAPSIGN_FOOTER_POINTS - 10 }, A4)).toBe(true)
		expect(overlapsFooter(box, A4)).toBe(false)
	})

	it('clamps a box larger than the page', () => {
		expect(clampBox({ ...box, x: 0, width: 900, height: 360 }, A4)).toMatchObject({ width: 595, height: 238 })
	})
})
```

- [ ] **Step 2: Write `geometry.ts`.**

```ts
import type { EnvelopeField, EnvelopePage, FieldInput, FieldType } from '../api/types.ts'

/** A box in PDF points, top-left origin, on its page as displayed. */
export interface PlacedBox {
	id: string
	signerId: number
	type: FieldType
	page: number
	x: number
	y: number
	width: number
	height: number
}

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

/** ZapSign prints "Assinado digitalmente via ZapSign por … / Data …" to the right of the box (sandbox finding 9). */
export const STAMP_FOOTPRINT_FACTOR = 2.5
/** ZapSign's own footer line at the bottom of every page (sandbox finding 9). */
export const ZAPSIGN_FOOTER_POINTS = 36
export const PAGE_MARGIN_POINTS = 32
export const BOX_GAP_POINTS = 16
export const KEYBOARD_STEP_POINTS = 4
export const DEFAULT_SIZE: Record<FieldType, { width: number; height: number }> = {
	signature: { width: 100, height: 40 },
	initials: { width: 48, height: 24 },
}
export const MINIMUM_WIDTH: Record<FieldType, number> = { signature: 60, initials: 30 }
const EDGE_TOLERANCE_POINTS = 0.5

const ARROW_DELTAS: Record<ArrowKey, { x: number; y: number }> = {
	ArrowLeft: { x: -1, y: 0 },
	ArrowRight: { x: 1, y: 0 },
	ArrowUp: { x: 0, y: -1 },
	ArrowDown: { x: 0, y: 1 },
}

function pageOf(pages: EnvelopePage[], index: number): EnvelopePage {
	const page = pages[index]
	if (page === undefined) {
		throw new RangeError(`No page ${index}`)
	}
	return page
}

function between(value: number, minimum: number, maximum: number): number {
	return Math.min(Math.max(value, minimum), maximum)
}

export function toFieldInput(box: PlacedBox, pages: EnvelopePage[]): FieldInput {
	const page = pageOf(pages, box.page)
	return {
		signerId: box.signerId,
		type: box.type,
		page: box.page,
		x: box.x / page.width,
		y: box.y / page.height,
		width: box.width / page.width,
		height: box.height / page.height,
	}
}

export function fromField(field: EnvelopeField, pages: EnvelopePage[], id = `field-${field.id}`): PlacedBox {
	const page = pageOf(pages, field.page)
	return {
		id,
		signerId: field.signerId,
		type: field.type,
		page: field.page,
		x: field.x * page.width,
		y: field.y * page.height,
		width: field.width * page.width,
		height: field.height * page.height,
	}
}

export function clampBox<Box extends PlacedBox>(box: Box, page: EnvelopePage): Box {
	const ratio = box.height / box.width
	const width = Math.min(box.width, page.width, page.height / ratio)
	const height = width * ratio
	return {
		...box,
		width,
		height,
		x: between(box.x, 0, page.width - width),
		y: between(box.y, 0, page.height - height),
	}
}

export function moveBox<Box extends PlacedBox>(box: Box, deltaX: number, deltaY: number, page: EnvelopePage): Box {
	return clampBox({ ...box, x: box.x + deltaX, y: box.y + deltaY }, page)
}

export function resizeFromCorner<Box extends PlacedBox>(box: Box, corner: Corner, deltaWidth: number, page: EnvelopePage): Box {
	const ratio = box.height / box.width
	const growsLeft = corner === 'top-left' || corner === 'bottom-left'
	const growsUp = corner === 'top-left' || corner === 'top-right'
	const right = box.x + box.width
	const bottom = box.y + box.height
	const roomX = growsLeft ? right : page.width - box.x
	const roomY = growsUp ? bottom : page.height - box.y
	const width = between(box.width + deltaWidth, MINIMUM_WIDTH[box.type], Math.min(roomX, roomY / ratio))
	const height = width * ratio
	return {
		...box,
		width,
		height,
		x: growsLeft ? right - width : box.x,
		y: growsUp ? bottom - height : box.y,
	}
}

export function nudgeBox<Box extends PlacedBox>(box: Box, key: ArrowKey, resize: boolean, page: EnvelopePage): Box {
	const delta = ARROW_DELTAS[key]
	if (resize) {
		return resizeFromCorner(box, 'bottom-right', (delta.x - delta.y) * KEYBOARD_STEP_POINTS, page)
	}
	return moveBox(box, delta.x * KEYBOARD_STEP_POINTS, delta.y * KEYBOARD_STEP_POINTS, page)
}

export function footprintWidth(box: PlacedBox): number {
	return box.width * STAMP_FOOTPRINT_FACTOR
}

export function overflowsStamp(box: PlacedBox, page: EnvelopePage): boolean {
	return box.x + footprintWidth(box) > page.width + EDGE_TOLERANCE_POINTS
}

export function overlapsFooter(box: PlacedBox, page: EnvelopePage): boolean {
	return box.y + box.height > page.height - ZAPSIGN_FOOTER_POINTS + EDGE_TOLERANCE_POINTS
}
```
Run `npx vitest run src/placement/geometry.spec.ts`. Expected: PASS. Fix the spec's arithmetic only if a value was miscalculated; the rules stay.

- [ ] **Step 3: Write the failing `auto-placement.spec.ts`.**

```ts
import { describe, expect, it } from 'vitest'
import { autoPlace, withInitials } from './auto-placement.ts'
import { footprintWidth, overflowsStamp, overlapsFooter } from './geometry.ts'

const A4 = { width: 595, height: 842, rotation: 0 }
const LANDSCAPE = { width: 842, height: 595, rotation: 90 }
let sequence = 0
const createId = () => `box-${++sequence}`

describe('autoPlace', () => {
	it('puts one signature per signer on the last page', () => {
		const boxes = autoPlace([A4, A4, A4], [1, 2, 3], false, createId)
		expect(boxes.filter((box) => box.type === 'signature').map((box) => [box.signerId, box.page])).toEqual([[1, 2], [2, 2], [3, 2]])
	})

	it('wraps signatures into rows sized to the ZapSign stamp, two per row on A4', () => {
		const [first, second, third] = autoPlace([A4], [1, 2, 3], false, createId)
		expect(first?.y).toBe(second?.y)
		expect(third?.y).toBeGreaterThan(first?.y ?? 0)
		expect((second?.x ?? 0) - (first?.x ?? 0)).toBe(footprintWidth(first!) + 16)
	})

	it('fits more per row on a wider page', () => {
		const wide = { width: 900, height: 595, rotation: 0 }
		const boxes = autoPlace([wide], [1, 2, 3], false, createId)
		expect(new Set(boxes.map((box) => box.y)).size).toBe(1)
	})

	it('never overlaps the ZapSign footer and never lets a stamp run off the page', () => {
		for (const box of autoPlace([A4], [1, 2, 3, 4, 5], true, createId)) {
			expect(overlapsFooter(box, A4)).toBe(false)
			expect(overflowsStamp(box, A4)).toBe(false)
		}
	})

	it('spills signatures to the previous page when the last page is full', () => {
		const many = Array.from({ length: 40 }, (_, index) => index + 1)
		const pages = new Set(autoPlace([A4, A4], many, false, createId).map((box) => box.page))
		expect(pages).toEqual(new Set([0, 1]))
	})
})

describe('withInitials', () => {
	it('adds one initials box per signer at the footer of every page, above the ZapSign footer', () => {
		const boxes = withInitials([], [A4, LANDSCAPE], [1, 2], true, createId)
		expect(boxes.filter((box) => box.type === 'initials')).toHaveLength(4)
		for (const box of boxes) {
			const page = box.page === 0 ? A4 : LANDSCAPE
			expect(box.y + box.height).toBeLessThanOrEqual(page.height - 36)
			expect(box.y + box.height).toBeGreaterThan(page.height - 36 - 30)
		}
	})

	it('computes positions in absolute points so mixed page sizes line up', () => {
		const boxes = withInitials([], [A4, LANDSCAPE], [1], true, createId)
		expect(boxes.map((box) => box.width)).toEqual([48, 48])
	})

	it('removes every initials box and keeps signatures when turned off', () => {
		const signature = { id: 's', signerId: 1, type: 'signature' as const, page: 0, x: 32, y: 600, width: 100, height: 40 }
		const boxes = withInitials([signature, ...withInitials([], [A4], [1], true, createId)], [A4], [1], false, createId)
		expect(boxes).toEqual([signature])
	})
})
```

- [ ] **Step 4: Write `auto-placement.ts`.**

```ts
import type { EnvelopePage, FieldType } from '../api/types.ts'
import {
	BOX_GAP_POINTS, DEFAULT_SIZE, PAGE_MARGIN_POINTS, STAMP_FOOTPRINT_FACTOR, ZAPSIGN_FOOTER_POINTS,
} from './geometry.ts'
import type { PlacedBox } from './geometry.ts'

interface Slot {
	x: number
	y: number
}

function columnsFor(page: EnvelopePage, type: FieldType): number {
	const footprint = DEFAULT_SIZE[type].width * STAMP_FOOTPRINT_FACTOR
	return Math.max(1, Math.floor((page.width - 2 * PAGE_MARGIN_POINTS + BOX_GAP_POINTS) / (footprint + BOX_GAP_POINTS)))
}

function rowsFor(bottom: number, type: FieldType): number {
	const { height } = DEFAULT_SIZE[type]
	return Math.max(1, Math.floor((bottom - PAGE_MARGIN_POINTS + BOX_GAP_POINTS) / (height + BOX_GAP_POINTS)))
}

/** Grid slots bottom-aligned above `bottom`: rows fill left to right, and the last row sits lowest. */
function slots(page: EnvelopePage, type: FieldType, count: number, bottom: number): Slot[] {
	const { width, height } = DEFAULT_SIZE[type]
	const columns = columnsFor(page, type)
	const rows = Math.ceil(count / columns)
	const top = bottom - rows * height - (rows - 1) * BOX_GAP_POINTS
	return Array.from({ length: count }, (_, index) => ({
		x: PAGE_MARGIN_POINTS + (index % columns) * (width * STAMP_FOOTPRINT_FACTOR + BOX_GAP_POINTS),
		y: top + Math.floor(index / columns) * (height + BOX_GAP_POINTS),
	}))
}

function footerBottom(page: EnvelopePage): number {
	return page.height - ZAPSIGN_FOOTER_POINTS
}

function initialsTop(page: EnvelopePage, signerCount: number): number {
	const rows = Math.ceil(signerCount / columnsFor(page, 'initials'))
	const { height } = DEFAULT_SIZE.initials
	return footerBottom(page) - rows * height - (rows - 1) * BOX_GAP_POINTS
}

function box(createId: () => string, signerId: number, type: FieldType, page: number, slot: Slot): PlacedBox {
	return { id: createId(), signerId, type, page, ...slot, ...DEFAULT_SIZE[type] }
}

/** Initials at the footer of every page (above ZapSign's footer line), or none. */
export function withInitials(boxes: PlacedBox[], pages: EnvelopePage[], signerIds: number[], enabled: boolean, createId: () => string): PlacedBox[] {
	const signatures = boxes.filter((placed) => placed.type !== 'initials')
	if (!enabled || signerIds.length === 0) {
		return signatures
	}
	const initials = pages.flatMap((page, pageIndex) => slots(page, 'initials', signerIds.length, footerBottom(page))
		.map((slot, index) => box(createId, signerIds[index] ?? 0, 'initials', pageIndex, slot)))
	return [...signatures, ...initials]
}

/** Signatures on the last page (spilling backwards when full), plus initials when enabled. */
export function autoPlace(pages: EnvelopePage[], signerIds: number[], initialsEnabled: boolean, createId: () => string): PlacedBox[] {
	const placed: PlacedBox[] = []
	let remaining = [...signerIds]
	for (let pageIndex = pages.length - 1; pageIndex >= 0 && remaining.length > 0; pageIndex--) {
		const page = pages[pageIndex]
		if (page === undefined) {
			continue
		}
		const bottom = (initialsEnabled ? initialsTop(page, signerIds.length) : footerBottom(page)) - BOX_GAP_POINTS
		const capacity = columnsFor(page, 'signature') * rowsFor(bottom, 'signature')
		const here = remaining.slice(0, capacity)
		remaining = remaining.slice(capacity)
		slots(page, 'signature', here.length, bottom).forEach((slot, index) => {
			placed.push(box(createId, here[index] ?? 0, 'signature', pageIndex, slot))
		})
	}
	return withInitials(placed, pages, signerIds, initialsEnabled, createId)
}
```
Run `npx vitest run src/placement`. Expected: PASS.
- Signature columns are floor((pageWidth − 2·32 + 16) / (100·2.5 + 16)): A4 (595) and landscape A4 (842) give 2; a 900-point page gives 3.
- Initials columns use the 120-point initials footprint: A4 gives 4.

- [ ] **Step 5: Commit.**

```bash
git add src/placement
git commit -m "feat: compute box geometry and automatic placement around ZapSign's stamp and footer"
```

---

### Task 16: Placement editor (desktop)

**Artboard:** `Wizard-Placement.dc.html`.

**Files:**
- Create:
  - `src/placement/PlacementStep.vue`, `PlacementCanvas.vue`, `PlacementBox.vue`, `DocumentRail.vue`, `SignerLegend.vue`, `ZoomToolbar.vue`
  - `src/placement/placement-draft.ts`, `src/placement/pointer-drag.ts`
  - specs: `src/placement/placement-draft.spec.ts`, `src/placement/PlacementCanvas.spec.ts`, `src/placement/PlacementStep.spec.ts`
- Modify: `src/wizard/WizardView.vue` (lazy-load the placement step), `l10n/pt_BR.{json,js}`

**Interfaces:**
- Consumes: Task 15 geometry and auto-placement, Task 14 `usePdfDocument` and `PdfPageCanvas`, `replaceFields`, `QUERY_KEYS.draftSave`, `useStepRegistration`, the kit, signer colours.
- Produces:
  - `usePlacementDraft(envelope: Ref<EnvelopeDetail>, documentId: Ref<number>, pages: Ref<EnvelopePage[] | null>)`. It returns:
    - `boxes: Readonly<Ref<PlacedBox[]>>`
    - `initialsEnabled: Readonly<Ref<boolean>>`
    - `replaceBoxes(next: PlacedBox[]): void`
    - `setInitials(enabled: boolean): void`
    - `autoPlaceAgain(): void`
    - `flush(): Promise<boolean>`
  - It is initialised from the document's fields (`fromField`). When the document has **no** fields and the envelope has signers, it auto-places (signatures only; initials off) as soon as pages are known, and saves.
  - `initialsEnabled` starts true when the document has any initials field.
  - Every change schedules `replaceFields(uuid, documentId, pages, boxes.map(toFieldInput))` after 800 ms (one in flight at a time; the latest state wins). `flush` saves immediately.
  - Switching documents flushes the previous one first.
  - `ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const`; `fitWidthScale(containerWidth: number, page: EnvelopePage): number`.
  - `startPointerDrag(event: PointerEvent, scale: number, onMove: (deltaXPoints: number, deltaYPoints: number) => void, onEnd: () => void): void`. It captures the pointer and converts screen px to points (`/ scale`). The same code serves mouse, pen and touch.

- [ ] **Step 1: Write the failing `placement-draft.spec.ts`.** Mock `replaceFields`; use fake timers. Cases:
  - **Auto-placement:** a document with no fields and 3 signers gets 3 signature boxes and one save after 800 ms. That save carries `pages` and normalized fields.
  - **No auto-placement:** a document with fields does not auto-place.
  - **Debounce:** two quick edits make one save carrying the latest state.
  - **Initials:** `setInitials(true)` adds initials on every page; `false` removes them, and each is saved.
  - **Re-place:** `autoPlaceAgain` recomputes the signatures and keeps the initials setting.
  - **Flush:** `flush` saves immediately and resolves true; on an API error it resolves false and the toast shows `errorMessage`.

- [ ] **Step 2: Write the failing `PlacementCanvas.spec.ts`.** Stub `PdfPageCanvas`. Cases:
  - **Boxes:** each box is a `<button>`, absolutely positioned at `x * scale`, `y * scale`, with size `width * scale` × `height * scale`. Its `aria-label` is "Assinatura de Ana Lima, página 6 de 6. Setas movem, Shift+setas redimensionam, Delete remove.". Its colours come from the signer palette: dashed 1.5px border in `stroke`, `fill` background.
  - **Footprint:** a faint dashed extension shows the stamp, `footprintWidth(box) - width` wide, to the right of each signature box.
  - **Stamp warning:** when `overflowsStamp` is true, the box gets the warning style and the editor shows "A assinatura ultrapassa a margem direita; a ZapSign corta o texto do carimbo." in an `aria-live` region.
  - **Footer band:** a hatched band labelled "Rodapé da ZapSign" (aria-hidden decoration) is drawn `ZAPSIGN_FOOTER_POINTS * scale` tall at the bottom of the page.
  - **Keyboard:** ArrowRight on a focused box emits `update` with x + 4. Shift+ArrowRight emits a resized box. Delete emits `remove`. Escape clears the selection.
  - **Selection:** clicking a box selects it (`aria-pressed="true"`). It shows 4 corner handles (aria-hidden, `tabindex="-1"`) and the floating toolbar: `AvSelect` "Signatário" (reassigns `signerId`), "Duplicar" (`Copy` icon; a copy offset by 16 points, clamped), "Excluir" (`Trash2` icon).

- [ ] **Step 3: Write the failing `PlacementStep.spec.ts`.** Cases:
  - **Document rail:** one group per document (name and page count). The current document expands to page thumbnails ("Página 6", with a selected outline in `var(--av-brand)`). Each document has an `AvSwitch` "Rubrica em todas as páginas" bound to `setInitials` for that document.
  - **Zoom toolbar:** "Diminuir zoom", the percentage, "Aumentar zoom" and "Ajustar à largura", plus "Página 6 de 6" with previous and next page buttons.
  - **Right panel:** "Signatários" with each signer's avatar, name and "1 assinatura · 6 rubricas" (counts in the current document), under the caption "No documento atual".
  - **Adding:** "Adicionar assinatura" with an `AvSelect` of signers adds a default-size signature at the centre of the visible page, for the chosen signer.
  - **Info card:** "Posicionamos as assinaturas automaticamente na última página. Arraste, redimensione ou exclua à vontade."
  - **Re-place:** the secondary pill "Reposicionar automaticamente" asks for confirmation when boxes were edited, then calls `autoPlaceAgain`.
  - **Flush:** the step registers `flush`, which saves every touched document.

- [ ] **Step 4: Run them and see them fail, then implement.** Copy `Wizard-Placement.dc.html`:
  - **Columns:** the left rail 240px, the canvas area `var(--av-canvas-fill)`, the right panel 300px.
  - **Toolbars:** they float over the canvas.
  - **Page:** a white page with the soft float shadow.
  - **Boxes:** labels inside read "Assinatura" / "Rubrica" + first name, with a `PenLine` icon.
  - **Selected box:** a solid `var(--av-brand)` 2px outline, and 10px white square handles with a brand border.
  - **Canvas scrolling:** when the page is taller than the area, the area scrolls (the artboard shows the page scrolled to its bottom). On entering the step, scroll to the last page bottom, where the signatures are.
  - **Pointer:** dragging a box calls `startPointerDrag`, then `moveBox`, then `replaceBoxes`. Corner handles call `resizeFromCorner`, where `deltaWidth` is the horizontal pointer delta, negated for left corners.
  - **Touch:** set `touch-action: none` on boxes and handles only; the page area keeps native scrolling.

- [ ] **Step 5: Run the tests, build, bump and commit.**

```bash
git add src l10n js css appinfo
git commit -m "feat: place, move and resize signature and initials boxes on the PDF pages"
```

---

### Task 17: Placement editor (phone)

**Artboard:** `Phone-Placement.dc.html`.

**Files:**
- Create: `src/placement/PlacementSheet.vue`, `src/placement/DocumentSwitcher.vue`, `src/placement/pinch-zoom.ts`, `src/placement/pinch-zoom.spec.ts`, `src/placement/PlacementStepPhone.spec.ts`
- Modify: `src/placement/PlacementStep.vue` (switch layouts with `useIsPhone`), `src/placement/PlacementCanvas.vue` (handle size prop, pinch), `l10n/pt_BR.{json,js}`

**Interfaces:**
- Consumes: Task 16.
- Produces:
  - `PHONE_ZOOM = { minimum: 1, maximum: 3 } as const`, where 1 = fit to width.
  - `pinchScale(startScale: number, startDistance: number, distance: number): number`, clamped to `PHONE_ZOOM`.
  - `usePinchZoom(target: Ref<HTMLElement | null>, scale: Ref<number>)` tracks two active pointers on the canvas area (not on boxes). It updates `scale` and keeps the pinch midpoint stable by adjusting the scroll offset.
  - `PlacementCanvas` prop `handleSize: number`: 10 on desktop, 20 on phone.

- [ ] **Step 1: Write the failing `pinch-zoom.spec.ts`.** Cases:
  - a pinch doubling the distance from scale 1 gives 2;
  - clamping at 3 and 1;
  - a pinch that starts on a box does not zoom (the box drag wins).

- [ ] **Step 2: Write the failing `PlacementStepPhone.spec.ts`** (with `matchMedia` true). Cases:
  - **App bar:** back, "Posicionamento" with "Passo 3 de 4", and an overflow menu holding "Reposicionar automaticamente" and "Ajustar à largura".
  - **Document switcher:** a pill showing "Contrato de prestação… · pág. 6/6" that opens a sheet listing documents and pages.
  - **Hint:** the hint chip "Pinça para ampliar" shows until the first pinch or 4 s pass (`role="status"`).
  - **Bottom sheet:** signer chips (avatar + first name; the selected one is the dark chip), a "+" `AvIconButton` "Adicionar assinatura para {name}", the `AvSwitch` "Rubrica em todas as páginas", and the full-width primary "Continuar" 52px.
  - **Handles:** 20px handles.

- [ ] **Step 3: Run them and see them fail, then implement.** Copy `Phone-Placement.dc.html`:
  - the page fills the width at scale 1;
  - the sheet has a top radius of 28px, a grab handle (40×4, `var(--av-input-border)`) and the float shadow;
  - the sheet does not hide the page bottom: add canvas padding equal to the sheet height.
  - **Gesture rules:**
    - one finger on a box drags it;
    - one finger elsewhere scrolls natively;
    - two fingers pinch.

- [ ] **Step 4: Run the tests, build, bump and commit.**

```bash
git add src l10n js css appinfo
git commit -m "feat: make the placement editor work on phones with touch drag and pinch zoom"
```

---

### Task 18: Step 4 (Revisão e envio) and the send flow

**Artboard:** `Wizard-Review.dc.html`.

**Files:**
- Create: `src/wizard/ReviewStep.vue`, `src/wizard/review-summary.ts`, `src/wizard/review-summary.spec.ts`, `src/wizard/ReviewStep.spec.ts`
- Modify: `src/detail/EnvelopeBanners.vue` (the sending state), `l10n/pt_BR.{json,js}`

**Interfaces:**
- Consumes: `updateEnvelope`, `settingsFrom`, `sendEnvelope`, `QUERY_KEYS.envelope`, `useStepRegistration`, `appConfig().limits`.
- Produces:
  - `reviewSummary(envelope: EnvelopeDetail)` returns:
    - `documents` (name, page count, `requiresInitials`);
    - `groups` (signers by group, or one group when signing order is off);
    - `signatureCount`;
    - `initialsCount`.
  - `REMINDER_OPTIONS`: null ("Não lembrar") and 1, 2, 3, 5, 7 days ("A cada {n} dia(s)", plural).

- [ ] **Step 1: Write the failing `review-summary.spec.ts`.** The Detail fixture with doc 1 initials on all 6 pages for 3 signers gives "3 assinaturas · 18 rubricas", and `requiresInitials` is true for doc 1 only.

- [ ] **Step 2: Write the failing `ReviewStep.spec.ts`.**
  - **Summary cards:** "Documentos", "Signatários" and "Campos". Each has an "Editar" link to its step (`?step=documents` / `signers` / `placement`).
  - **Deadline:** the date field "Prazo para assinar" (`type="date"`, `min` = tomorrow) with the hint "Depois do prazo o envelope expira.". Clearing it sends `deadline: null`.
  - **Reminders:** the `AvSelect` "Lembretes automáticos" uses `REMINDER_OPTIONS` and saves `reminderDays`. **Deviation 4:** the spec requires the reminder interval and the artboard did not draw it. Place it under the deadline in the same field style.
  - **Message:** "Mensagem para os signatários (opcional)" `AvTextarea` with a counter "{n}/500". It saves after 600 ms.
  - **Cost card:** "Este envio consome 1 envelope do plano ZapSign."
  - **Send:** the bottom bar's primary button reads "Enviar para assinatura" with a `Send` icon. It flushes the settings, then calls `sendEnvelope`, then sets the cached detail's status to `sending` and invalidates the envelope. `EnvelopeView` then shows the detail in its sending state.
    - A 422 `no_signers` shows `errorMessage` and stays on the step.
    - A 409 `already_sending` invalidates and moves on.
  - **No double send:** while sending, the button is disabled and reads "Enviando…".

- [ ] **Step 3: Sending banner.** In `EnvelopeBanners.vue`, a `sending` envelope shows the info banner "Enviando para a ZapSign. Isso leva alguns segundos." with a spinner, and `finalizing` shows "Finalizando: salvando as cópias assinadas no Drive.". Write a test for both.

- [ ] **Step 4: Run them and see them fail, implement, then run them again.** Copy `Wizard-Review.dc.html`: Documentos and Signatários side by side in the left column, Campos as a one-row card beneath, the form in the right column.

- [ ] **Step 5: Run the tests, build, bump and commit.**

```bash
git add src l10n js css appinfo
git commit -m "feat: review and send an envelope, then follow it while ZapSign receives it"
```

---

### Task 19: Visual conformance pass and release (controller-run)

The controller runs this task itself, using the in-app browser. A subagent fixes each batch of differences.

- [ ] **Step 1: Prepare the preview.**
  1. Run `tests/env/serve.sh start` and `tests/env/php.sh apps/assinaturas/tests/env/seed-demo.php`.
  2. Sign in at `http://localhost:8088` with the preview user from `tests/env/preview-user.env`. These are test credentials on a local development host, created by this plan.
  3. Open the canvas artboards in a second tab for side-by-side comparison.

- [ ] **Step 2: Compare each screen against its artboard, at desktop and phone sizes.** For desktop, resize the window to 1440×900. For phone, use the `mobile` preset (375×812) and also check 390×844.

| Screen | URL | Artboard |
|---|---|---|
| Dashboard | `/apps/assinaturas/` | Main / Phone-Dashboard |
| Detail | `/apps/assinaturas/envelopes/<contract uuid>` | Detail / Phone-Detail |
| Wizard 1–4 | `/apps/assinaturas/envelopes/<draft uuid>?step=…` | Wizard-* / Phone-Placement |
| Sidebar | `/apps/files/?dir=/Contratos/2026` → open the contract → tab "Assinaturas" | Files-Sidebar |

For each screen, record every difference in a table: element, artboard value, actual value. That covers colours, sizes, radii, spacing, copy, icon and alignment. Allowed differences are only the deviations listed under "The mockups are the spec":

| # | Deviation |
|---|---|
| 1 | Nextcloud header above the phone app bar |
| 2 | Signature rows sized to the ZapSign stamp |
| 3 | Toasts, skeletons and dialogs the mockups don't show |
| 4 | Reminder interval field on the review step |
| 5 | Gender-neutral "Recebe o convite quando…" |

- [ ] **Step 3: Exercise the interactions in the browser.**
  - Drag, resize and keyboard-move boxes.
  - Touch-drag and pinch on the phone preset.
  - Reorder documents by drag.
  - Use every dialog, and check the focus trap and Esc.
  - Tab through each screen; focus must be visible everywhere.
  - Watch the console: no errors, and no CSP violations for the pdf.js worker or wasm.

- [ ] **Step 4: Fix and re-check.** Dispatch a fix subagent with the difference table, then repeat Step 2 for the changed screens until no unexplained difference remains. Save before/after screenshots under `.superpowers/sdd/plan-3b/visual/`, which is not committed.

- [ ] **Step 5: Final sweep.**
  - Drop `vue-material-design-icons` and `@mdi/svg` if nothing imports them.
  - Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, then `tests/env/php.sh occ upgrade`, then the full `tests/env/phpunit.sh`.
  - `git status` must be clean after the build.
  - Bump `info.xml` once for the batch.
  - Update `README.md` (screens, preview) and the roadmap in avuz-server `docs/superpowers/plans/2026-09-28-assinaturas-roadmap.md` (3b done).

- [ ] **Step 6: Final review and push.** Run the SDD final whole-branch review: diff from the branch base, excluding `package-lock.json`, `js/`, `css/` and `dist/`. Then push the branch and report to Patrick, with screenshots of each screen next to its artboard.
