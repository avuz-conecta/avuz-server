# Assinaturas Plan 3a: Frontend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the frontend groundwork that every screen needs, and that doesn't depend on open design decisions:
- the build toolchain;
- the app page and its navigation entry;
- a typed API client with query keys;
- the app shell (navigation, sandbox banner, error boundary);
- the Files app action "Enviar para assinatura";
- the read-only admin settings page.

The dashboard, wizard, placement editor and detail view come in **Plan 3b**, after Patrick answers the design questions listed at the end of this plan.

**Architecture:**
- Vue 3.5, `@nextcloud/vue` 9, TypeScript, Vite 7 via `@nextcloud/vite-config` 2.5.
- Server state lives in TanStack Vue Query, so components never fetch in watchers or `onMounted`. Query keys come from one factory.
- One Vite build emits three entries:
  - `main` (the app page);
  - `files-init` (the Files action);
  - `admin-settings`.
- Built `js/` and `css/` are **committed**. The Avuz Dockerfile builds only core, the same reason the deck and integration_openai forks commit theirs.

**Tech stack:**

| Area | Choice |
|---|---|
| Runtime | Node 24 / npm 11 |
| UI | `vue` ^3.5, `@nextcloud/vue` ^9.9, `vue-router` ^4, `@tanstack/vue-query` ^5 |
| Nextcloud libraries | `@nextcloud/axios` ^2.6, `@nextcloud/router` ^3.1, `@nextcloud/l10n` ^3.4, `@nextcloud/initial-state` ^3, `@nextcloud/files` ^4.1, `@nextcloud/dialogs` ^7 |
| Tests | Vitest ^4 + `@vue/test-utils` ^2.4 + happy-dom; PHPUnit 9.6 in the Docker harness for backend parts |

**Research:** `~/work/avuz/assinaturas/.superpowers/sdd/frontend-research.md` (2026-10-01) is the evidence behind each version and API choice.

**Spec:** [`../specs/2026-09-28-assinaturas-zapsign-design.md`](../specs/2026-09-28-assinaturas-zapsign-design.md), §7. **API contract:** `docs/api.md` in the app repo.

## Global Constraints

Plan 1, 2a and 2b constraints still apply. They include:
- never log or return tokens or sign URLs, except through the one sign-link route;
- commits carry no AI attribution;
- never let tests reach the real ZapSign;
- never run `tests/env/reset.sh`, because it wipes the sandbox token.

Additional rules for the frontend:

**TypeScript and code style** (from Patrick's coding guidelines)
- No `any`. Almost never use `as`; prefer type guards and narrowing. End-to-end types: API responses are typed once in `src/api/types.ts`, and the compiler infers the rest.
- Named exports only. No index/barrel files.
- `async`/`await`, not `.then()` chains. Early returns. Hash maps instead of `switch`.
- SNAKE_CAPS constants, camelCase functions, kebab-case file names for `.ts` files, PascalCase `.vue` components.
- No abbreviations. Descriptive names (`envelopes`, not `envelopeList`).
- No magic strings or numbers. Query keys come only from `src/api/query-keys.ts`.
- Components hold no module-level mutable state.
- No data fetching in `onMounted` or watchers. Use `useQuery` and `useMutation` (TanStack Vue Query).
- An error boundary component with a retry button wraps the routed content.

**Accessibility** (WCAG 2.0 AA)
- Use `@nextcloud/vue` components: `NcButton`, `NcTextField`, `NcSelect`, `NcDialog`, `NcEmptyContent`, `NcAppNavigation*`.
- Every control is labelled, and everything is keyboard-reachable.
- Status is never conveyed by colour alone: always icon plus text.
- No `Tooltip` directive (removed in v9). Use a native `title` or visible text.

**l10n**
- Source strings are English. Translate with `t('assinaturas', '…')` and `n(…)` from `@nextcloud/l10n`.
- Every new string is added to `l10n/pt_BR.json` and `l10n/pt_BR.js` in the same task.

**Build and deploy**
- `npm run build` (production) before committing.
- The built `js/` and `css/` (plus `dist/` assets, if any) are committed in the same commit as their sources.
- Every commit that changes built JS also bumps `appinfo/info.xml` `<version>` (patch), so browsers drop the cached bundle. In the local test env, apply the bump with `tests/env/php.sh occ upgrade`. If upgrade complains about stale bundled apps:
  1. disable `bruteforcesettings`, `files_downloadlimit`, `notifications` and `text`;
  2. run `occ upgrade`;
  3. run `occ maintenance:mode --off`;
  4. run `occ app:enable --force` for those four.

  Never use `reset.sh`.

**Tests**
- Vitest unit tests live in `src/**/*.spec.ts` and cover behaviour (rendered output, emitted calls), not implementation.
- Mock `@nextcloud/axios` with `vi.mock`.
- PHP tests use the existing harness.
- Test names use third-person verbs (`it('lists the envelopes …')`).

---

## File Structure

```
package.json, package-lock.json, vite.config.ts, tsconfig.json, eslint.config.js, .nvmrc (24)
src/
├── main.ts                       app page entry: createApp + router + vue-query + mount #assinaturas
├── files-init.ts                 Files app entry: registers the "Enviar para assinatura" action
├── admin-settings.ts             admin settings entry
├── app-config.ts                 typed accessor for the page's initial state
├── router.ts                     routes + history base
├── api/
│   ├── types.ts                  response/request types mirroring docs/api.md
│   ├── api-error.ts              ApiError (code, httpStatus, retryAfterSeconds) + toApiError()
│   ├── envelopes.ts              one function per envelope route
│   ├── admin.ts                  admin status + counters reset
│   └── query-keys.ts             QUERY_KEYS factory
├── files/send-for-signature-action.ts   IFileAction (pure; tested)
├── components/
│   ├── AppShell.vue              NcContent + navigation + banner + boundary + RouterView
│   ├── SandboxBanner.vue
│   └── ErrorBoundary.vue
├── views/ComingSoonView.vue      temporary target for routes Plan 3b builds
└── admin/AdminSettings.vue
lib/Controller/PageController.php           GET /, /envelopes/{uuid} → TemplateResponse 'main'
lib/Listener/LoadFilesActionListener.php    Files scripts for members only
lib/Navigation/NavigationRegistrar.php      nav entry only for members
lib/Settings/AdminSettings.php, lib/Settings/AdminSection.php
templates/main.php, templates/admin-settings.php
img/app.svg, img/app-dark.svg
```

---

### Task 1: Toolchain and typed initial state

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `.nvmrc`, `src/app-config.ts`, `src/app-config.spec.ts`, `src/main.ts`
- Modify: `.gitignore` (add `node_modules/`), `README.md` (a "Frontend" section with the commands below)

**Interfaces:**
- Produces:
  - `AppConfig`: environment `'sandbox' | 'production'`, `canUseApp`, `isAdmin`, and `limits` with `maxFiles`, `maxEnvelopeBytes`, `maxSigners`, `maxTitleLength`, `maxNameLength`, `maxMessageLength`, `minReminderDays`, `maxReminderDays`, `reminderCooldownSeconds`.
  - `appConfig(): AppConfig`, which reads the initial state key `config`.
  - `npm run build`, which emits `js/assinaturas-main.mjs` and `css/assinaturas-main.css`.
  - `npm test`, `npm run lint`, `npm run typecheck`.

- [ ] **Step 1: Write the toolchain files**

`package.json`:
```json
{
  "name": "assinaturas",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite --mode production build",
    "dev": "vite --mode development build",
    "watch": "vite --mode development build --watch",
    "lint": "eslint",
    "test": "vitest run",
    "typecheck": "vue-tsc --noEmit"
  },
  "browserslist": ["extends @nextcloud/browserslist-config"],
  "engines": { "node": "^24.0.0", "npm": "^11.3.0" },
  "dependencies": {
    "@mdi/svg": "^7.4.47",
    "@nextcloud/axios": "^2.6.0",
    "@nextcloud/dialogs": "^7.4.1",
    "@nextcloud/files": "^4.1.0",
    "@nextcloud/initial-state": "^3.0.0",
    "@nextcloud/l10n": "^3.4.1",
    "@nextcloud/router": "^3.1.0",
    "@nextcloud/sharing": "^0.4.0",
    "@nextcloud/vue": "^9.9.0",
    "@tanstack/vue-query": "^5",
    "vue": "^3.5.0",
    "vue-router": "^4.5.0"
  },
  "devDependencies": {
    "@nextcloud/browserslist-config": "^3.1.2",
    "@nextcloud/eslint-config": "^9.0.1",
    "@nextcloud/vite-config": "^2.5.4",
    "@vue/test-utils": "^2.4.6",
    "@vue/tsconfig": "^0.9.1",
    "happy-dom": "^20.3.1",
    "typescript": "^5.9.3",
    "vite": "^7.3.6",
    "vitest": "^4.1.10",
    "vue-tsc": "^3"
  }
}
```
Run `npm install` and commit `package-lock.json`.

If a range doesn't resolve, use the closest working version, keeping the same major, and record it. The exception is `@nextcloud/vue`: if 9.13 changes NC33 visuals, pin `~9.9` and note it.

`vite.config.ts`:
```ts
import { createAppConfig } from '@nextcloud/vite-config'
import { resolve } from 'node:path'

export default createAppConfig({
	main: resolve('src', 'main.ts'),
}, {
	createEmptyCSSEntryPoints: true,
	extractLicenseInformation: true,
	config: {
		test: { environment: 'happy-dom', include: ['src/**/*.spec.ts'] },
	},
})
```

`tsconfig.json`:
```json
{
  "extends": "@vue/tsconfig/tsconfig.dom.json",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "src/**/*.vue"]
}
```

`eslint.config.js`:
- Use the flat config that `@nextcloud/eslint-config` 9 exports. Read its README in `node_modules` for the exact export name.
- Add a rule forbidding `any`: `@typescript-eslint/no-explicit-any: 'error'`.
- Keep the config to the minimum the README shows.

`.nvmrc`: `24`.

- [ ] **Step 2: Write the failing test**

`src/app-config.spec.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadState = vi.fn()
vi.mock('@nextcloud/initial-state', () => ({ loadState }))

const { appConfig } = await import('./app-config.ts')

describe('appConfig', () => {
	beforeEach(() => loadState.mockReset())

	it('reads the page configuration from the initial state', () => {
		loadState.mockReturnValue({
			environment: 'sandbox',
			canUseApp: true,
			isAdmin: false,
			limits: { maxFiles: 20, maxEnvelopeBytes: 20000000, maxSigners: 20, maxTitleLength: 255, maxNameLength: 255, maxMessageLength: 500, minReminderDays: 1, maxReminderDays: 30, reminderCooldownSeconds: 1800 },
		})

		expect(appConfig().environment).toBe('sandbox')
		expect(loadState).toHaveBeenCalledWith('assinaturas', 'config', expect.anything())
	})

	it('falls back to a locked-down production configuration when the state is missing', () => {
		loadState.mockImplementation((_app: string, _key: string, fallback: unknown) => fallback)

		const config = appConfig()

		expect(config.environment).toBe('production')
		expect(config.canUseApp).toBe(false)
		expect(config.isAdmin).toBe(false)
	})
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/app-config.spec.ts`
Expected: FAIL. The `./app-config.ts` import does not resolve.

- [ ] **Step 4: Implement**

`src/app-config.ts`:
```ts
import { loadState } from '@nextcloud/initial-state'

export type Environment = 'sandbox' | 'production'

export interface EnvelopeLimits {
	maxFiles: number
	maxEnvelopeBytes: number
	maxSigners: number
	maxTitleLength: number
	maxNameLength: number
	maxMessageLength: number
	minReminderDays: number
	maxReminderDays: number
	reminderCooldownSeconds: number
}

export interface AppConfig {
	environment: Environment
	canUseApp: boolean
	isAdmin: boolean
	limits: EnvelopeLimits
}

export const APP_ID = 'assinaturas'
const CONFIG_STATE_KEY = 'config'

const LOCKED_DOWN: AppConfig = {
	environment: 'production',
	canUseApp: false,
	isAdmin: false,
	limits: { maxFiles: 0, maxEnvelopeBytes: 0, maxSigners: 0, maxTitleLength: 0, maxNameLength: 0, maxMessageLength: 0, minReminderDays: 1, maxReminderDays: 30, reminderCooldownSeconds: 1800 },
}

/** The page configuration the server rendered into the initial state. */
export function appConfig(): AppConfig {
	return loadState<AppConfig>(APP_ID, CONFIG_STATE_KEY, LOCKED_DOWN)
}
```

`src/main.ts` stays minimal until Task 4:
```ts
import { createApp, h } from 'vue'

createApp({ render: () => h('div') }).mount('#assinaturas')
```

- [ ] **Step 5: Run the checks and the build**

Run, in order:
1. `npx vitest run`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run build`

Expected:
- the tests pass;
- `typecheck` and `lint` are clean;
- the build emits `js/assinaturas-main.mjs` and `css/assinaturas-main.css`.

Also run `ls js css`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vite.config.ts tsconfig.json eslint.config.js .nvmrc .gitignore README.md src js css
git commit -m "build: add the Vue 3 + Vite frontend toolchain and typed page configuration"
```

---

### Task 2: App page, navigation entry and page configuration (backend)

**Files:**
- Create:
  - `lib/Api/ClientConfig.php`
  - `lib/Controller/PageController.php`
  - `templates/main.php`
  - `img/app.svg`, `img/app-dark.svg`
- Modify: `lib/AppInfo/Application.php` (navigation entry), `appinfo/info.xml` (version bump only; do NOT add `<navigations>`, because the entry is per user)
- Test:
  - `tests/Integration/Controller/PageControllerTest.php`
  - `tests/Integration/Api/ClientConfigTest.php`
  - `tests/Integration/AppInfo/NavigationTest.php`

**Interfaces:**
- Consumes: `AccessPolicy::canUseApp` / `canSeeAll`, `ZapSignSettings::environment()`, the `EnvelopeLimits` constants, and `SignerReminders::COOLDOWN_SECONDS`.
- Produces:
  - `ClientConfig::forUser(string $userId): array` with the exact shape of the TS `AppConfig`.
  - Page routes, each rendering `templates/main.php` with initial state `config` and a CSP that allows `worker-src 'self'` (for pdf.js in Plan 3b):
    - `GET /` (`assinaturas.page.index`)
    - `GET /envelopes/{uuid}` (`assinaturas.page.envelope`)
  - A navigation entry "Assinaturas", shown only to users who may use the app.

- [ ] **Step 1: Write the failing tests**

`tests/Integration/Api/ClientConfigTest.php`. Use the `TestUsers` trait and a member, a non-member and an admin.
- `forUser(member)` gives `canUseApp` true and `isAdmin` false.
- `forUser(nonMember)` gives `canUseApp` false.
- `forUser(admin)` gives `isAdmin` true and `canUseApp` true.
- Every case returns the limits `maxFiles = 20`, `maxEnvelopeBytes = 20000000` and `reminderCooldownSeconds = 1800`.
- `environment` equals `ZapSignSettings::environment()->value`.

`tests/Integration/Controller/PageControllerTest.php`. Log in as a member with `self::loginAsUser`, then `Server::get(PageController::class)->index()`:
- returns a `TemplateResponse` with template `main` and app `assinaturas`;
- its `getContentSecurityPolicy()` (an `ContentSecurityPolicy`), built into a policy string via `buildPolicy()`, contains `worker-src 'self'`;
- `envelope('some-uuid')` returns the same template.

To assert the initial state, use `Server::get(IInitialStateService::class)` (private `OC\InitialStateService`) only if needed, or check through a reflection-free route. If that isn't practical, test `ClientConfig` (above) and assert only that the controller calls `provideInitialState`. Note the choice under deviations.

`tests/Integration/AppInfo/NavigationTest.php`. As a member, `Server::get(INavigationManager::class)->getAll()` contains an entry with id `assinaturas`. As a non-member, it doesn't. NC caches navigation per request; if the closure result is cached, build a fresh `NavigationManager` or call the registrar directly, and document how.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `tests/env/phpunit.sh --filter 'ClientConfigTest|PageControllerTest|NavigationTest'`
Expected: ERRORs saying the class was not found.

- [ ] **Step 3: Implement**

`lib/Api/ClientConfig.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Api;

use OCA\Assinaturas\Access\AccessPolicy;
use OCA\Assinaturas\Action\SignerReminders;
use OCA\Assinaturas\Draft\EnvelopeLimits;
use OCA\Assinaturas\ZapSign\ZapSignSettings;

/** What the frontend needs to know before its first request: who you are to this app, and the limits to validate against. */
final class ClientConfig {
	public function __construct(
		private AccessPolicy $accessPolicy,
		private ZapSignSettings $settings,
	) {
	}

	/** @return array{environment: string, canUseApp: bool, isAdmin: bool, limits: array<string, int>} */
	public function forUser(string $userId): array {
		return [
			'environment' => $this->settings->environment()->value,
			'canUseApp' => $this->accessPolicy->canUseApp($userId),
			'isAdmin' => $this->accessPolicy->canSeeAll($userId),
			'limits' => [
				'maxFiles' => EnvelopeLimits::MAX_FILES,
				'maxEnvelopeBytes' => EnvelopeLimits::MAX_ENVELOPE_BYTES,
				'maxSigners' => EnvelopeLimits::MAX_SIGNERS,
				'maxTitleLength' => EnvelopeLimits::MAX_TITLE_LENGTH,
				'maxNameLength' => EnvelopeLimits::MAX_NAME_LENGTH,
				'maxMessageLength' => EnvelopeLimits::MAX_MESSAGE_LENGTH,
				'minReminderDays' => EnvelopeLimits::MIN_REMINDER_DAYS,
				'maxReminderDays' => EnvelopeLimits::MAX_REMINDER_DAYS,
				'reminderCooldownSeconds' => SignerReminders::COOLDOWN_SECONDS,
			],
		];
	}
}
```

`lib/Controller/PageController.php`:
```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Controller;

use OCA\Assinaturas\Access\EnvelopeAccess;
use OCA\Assinaturas\Api\ClientConfig;
use OCA\Assinaturas\AppInfo\Application;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\FrontpageRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\IRequest;

/** Serves the single-page app. The client router decides what to show; every route renders the same shell. */
final class PageController extends Controller {
	private const TEMPLATE = 'main';
	private const CONFIG_STATE_KEY = 'config';
	private const SELF_SOURCE = "'self'";

	public function __construct(
		IRequest $request,
		private IInitialState $initialState,
		private ClientConfig $clientConfig,
		private EnvelopeAccess $access,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[FrontpageRoute(verb: 'GET', url: '/')]
	public function index(): TemplateResponse {
		return $this->page();
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[FrontpageRoute(verb: 'GET', url: '/envelopes/{uuid}')]
	public function envelope(string $uuid): TemplateResponse {
		return $this->page();
	}

	private function page(): TemplateResponse {
		$this->initialState->provideInitialState(self::CONFIG_STATE_KEY, $this->clientConfig->forUser($this->access->currentUserId()));
		$response = new TemplateResponse(Application::APP_ID, self::TEMPLATE);
		$policy = new ContentSecurityPolicy();
		$policy->addAllowedWorkerSrcDomain(self::SELF_SOURCE);
		$response->setContentSecurityPolicy($policy);
		return $response;
	}
}
```
`envelope()` ignores `$uuid` on purpose: the client router reads it. Name the parameter `$_uuid` only if the linter requires it. Attribute routing binds by name, so keep `$uuid` and add `@SuppressWarnings` only if needed.

`templates/main.php`:
```php
<?php

declare(strict_types=1);

\OCP\Util::addScript('assinaturas', 'assinaturas-main');
\OCP\Util::addStyle('assinaturas', 'assinaturas-main');
?>
<div id="assinaturas"></div>
```

Navigation, in `lib/AppInfo/Application::boot()`:
```php
	public function boot(IBootContext $context): void {
		$context->injectFn(function (INavigationManager $navigation, IURLGenerator $urls, IUserSession $session, AccessPolicy $policy, IFactory $l10nFactory): void {
			$navigation->add(function () use ($urls, $session, $policy, $l10nFactory): array {
				$userId = $session->getUser()?->getUID() ?? '';
				if (!$policy->canUseApp($userId)) {
					return [];
				}
				return [
					'id' => self::APP_ID,
					'order' => 30,
					'href' => $urls->linkToRoute('assinaturas.page.index'),
					'icon' => $urls->imagePath(self::APP_ID, 'app.svg'),
					'name' => $l10nFactory->get(self::APP_ID)->t('Signatures'),
				];
			});
		});
	}
```

Before relying on `return []` to skip the entry, read NC 33 `lib/private/NavigationManager.php` (`add()` and `init()`/closure resolution, in the container at `/var/www/html`).
- If an empty array is not skipped, or errors, gate differently: register the closure only when a user session exists and can use the app (`IUserSession` is available in `boot()` for logged-in requests).
- Prove the chosen behaviour with `NavigationTest`.
- Put the order and icon in named constants.

`img/app.svg`: a 24×24 Lucide-style "signature" pen icon, using stroke `currentColor` to match the Avuz icon overrides:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 17-2.156-1.868A.5.5 0 0 0 18 15.5v.5a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1c0-2.545-3.991-3.97-8.5-4a1 1 0 0 0 0 5c4.153 0 4.745-11.295 5.708-13.5a2.5 2.5 0 1 1 3.31 3.284"/><path d="M3 21h18"/></svg>
```
`img/app-dark.svg`: the same paths with `stroke="#000"`. NC uses `app.svg` (white) on the header and `app-dark.svg` where a dark icon is needed.

Add `"Signatures": "Assinaturas"` to `l10n/pt_BR.json` and `.js` if it isn't there yet. Task 10 of Plan 2b added it.

Bump `appinfo/info.xml` to `0.3.1`, then apply it with `occ upgrade`, following the procedure in the Global Constraints.

- [ ] **Step 4: Run the tests and the full suite**

Run: `tests/env/phpunit.sh --filter 'ClientConfigTest|PageControllerTest|NavigationTest'`, then `tests/env/phpunit.sh`.
Expected: `OK`. The full suite stays green; it was 590 before this task.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: serve the app page with its configuration and a members-only navigation entry"
```

---

### Task 3: Typed API client and query keys

**Files:**
- Create: `src/api/types.ts`, `src/api/api-error.ts`, `src/api/envelopes.ts`, `src/api/admin.ts`, `src/api/query-keys.ts`
- Test: `src/api/api-error.spec.ts`, `src/api/envelopes.spec.ts`, `src/api/admin.spec.ts`

**Interfaces:**
- Consumes: `docs/api.md`, the source of truth for paths, bodies, shapes and codes. Read it fully before writing the types.
- Produces:
  - Types:
    - `EnvelopeStatus`, `SignerStatus`, `SaveStatus` and `FieldType` as string-literal unions;
    - `EnvelopeSummary`, `EnvelopeDetail`, `EnvelopeDocument`, `EnvelopePage`, `EnvelopeField`, `EnvelopeSigner`, `EnvelopeEvent`, `EnvelopeScope` (`'mine' | 'all'`);
    - `EnvelopeSettings` (the `PUT /envelopes/{uuid}` body), `SignerInput`, `FieldInput`;
    - `EmailCorrection = EnvelopeDetail & { invited: boolean; inviteAvailableInSeconds?: number }`;
    - `AdminStatus`, `ProviderHealthState`.
  - `ApiError extends Error`, with `code: string`, `httpStatus: number` and `retryAfterSeconds: number | null`.
  - `toApiError(error: unknown): ApiError`:
    - It never throws.
    - A non-HTTP failure becomes code `network_error`, status 0.
    - An HTTP failure without our JSON error body becomes code `http_<status>`.
  - Envelope functions, all `async`, each throwing `ApiError` on failure:
    - `listEnvelopes(scope)`, `getEnvelope(uuid)`, `createEnvelope(title, fileIds)`, `updateEnvelope(uuid, settings)`
    - `replaceSigners(uuid, signers)`, `replaceFields(uuid, documentId, pages, fields)`, `deleteDraft(uuid)`, `sendEnvelope(uuid)`
    - `cancelEnvelope(uuid, reason)`, `discardEnvelope(uuid)`, `reopenEnvelope(uuid)`, `extendDeadline(uuid, date)`
    - `remindSigner(uuid, signerId)`, `correctSignerEmail(uuid, signerId, email)`, `copySignLink(uuid, signerId): Promise<string>`
  - Download URL builders, which are plain links: `signedFileUrl(uuid, documentId)`, `originalFileUrl(uuid, documentId)`, `activityReportUrl(uuid)`.
  - Admin functions: `getAdminStatus(refresh)`, `resetCounters()`, `removeEnvelope(uuid)`.
  - `QUERY_KEYS`, a key factory:
    - `envelopes(scope)` → `['envelopes', scope]`
    - `envelope(uuid)` → `['envelope', uuid]`
    - `adminStatus()` → `['admin-status']`

    Each returns a readonly tuple, typed without `as`.

- [ ] **Step 1: Write the failing tests**

`src/api/api-error.spec.ts`:
```ts
import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'
import { ApiError, toApiError } from './api-error.ts'

function axiosFailure(status: number, data: unknown): AxiosError {
	const headers = new AxiosHeaders()
	return new AxiosError('failed', 'ERR_BAD_RESPONSE', undefined, undefined, { status, statusText: '', headers, config: { headers }, data })
}

describe('toApiError', () => {
	it('keeps our error code, status and wait', () => {
		const error = toApiError(axiosFailure(429, { error: 'reminder_cooldown', message: 'wait', retryAfterSeconds: 1200 }))

		expect(error).toBeInstanceOf(ApiError)
		expect(error.code).toBe('reminder_cooldown')
		expect(error.httpStatus).toBe(429)
		expect(error.retryAfterSeconds).toBe(1200)
	})

	it('names a failure without our body by its status', () => {
		expect(toApiError(axiosFailure(400, '')).code).toBe('http_400')
	})

	it('treats anything that is not an HTTP answer as a network error', () => {
		const error = toApiError(new Error('offline'))

		expect(error.code).toBe('network_error')
		expect(error.httpStatus).toBe(0)
	})
})
```
`axios` is a transitive dependency of `@nextcloud/axios`. If importing it directly breaks the lint rules on undeclared dependencies, add `axios` to `dependencies` at the version `@nextcloud/axios` uses.

`src/api/envelopes.spec.ts`. Mock `@nextcloud/axios` with a default export `{ get, post, put, delete }` of `vi.fn`s. Mock `@nextcloud/router`'s `generateUrl` as `(path: string) => '/index.php' + path`. Then assert, for each function, the method, URL, body and returned value:
- `listEnvelopes('all')` makes a GET to `/index.php/apps/assinaturas/api/v1/envelopes`, with `params: { scope: 'all' }`, and returns `response.data.envelopes`.
- `createEnvelope('Contrato', [12, 34])` makes a POST with body `{ title: 'Contrato', fileIds: [12, 34] }` and returns the detail.
- `correctSignerEmail('u', 3, 'a@b.c')` makes a PUT to `…/envelopes/u/signers/3/email`, with body `{ email: 'a@b.c' }`, and returns `invited` and `inviteAvailableInSeconds`.
- `copySignLink('u', 3)` makes a POST to `…/envelopes/u/signers/3/link` and returns `data.signUrl`.
- `extendDeadline('u', '2026-12-31')` makes a PUT to `…/envelopes/u/deadline` with body `{ deadline: '2026-12-31' }`.
- `sendEnvelope('u')` makes a POST to `…/envelopes/u/send`.
- `signedFileUrl('u', 7)` returns `/index.php/apps/assinaturas/api/v1/envelopes/u/documents/7/signed` and makes no request.
- When a mocked call rejects with an `AxiosError` carrying `{ error: 'not_cancellable', … }`, `cancelEnvelope` rejects with an `ApiError` whose code is `not_cancellable`.

`src/api/admin.spec.ts`:
- `getAdminStatus(true)` sends `params: { refresh: true }`.
- `resetCounters()` makes a POST to `…/admin/counters/reset`.
- `removeEnvelope('u')` makes a DELETE to `…/admin/envelopes/u`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/api`
Expected: FAIL, because the modules do not exist.

- [ ] **Step 3: Implement**

`src/api/api-error.ts`:
```ts
import { isAxiosError } from 'axios'

const NETWORK_ERROR = 'network_error'
const NO_STATUS = 0

interface ErrorBody {
	error: string
	message?: string
	retryAfterSeconds?: number
}

/** An API failure carrying only our own code: never ZapSign text. */
export class ApiError extends Error {
	constructor(
		readonly code: string,
		readonly httpStatus: number,
		readonly retryAfterSeconds: number | null,
		message: string,
	) {
		super(message)
		this.name = 'ApiError'
	}
}

function isErrorBody(data: unknown): data is ErrorBody {
	return typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
}

export function toApiError(error: unknown): ApiError {
	if (error instanceof ApiError) {
		return error
	}
	if (!isAxiosError(error) || error.response === undefined) {
		return new ApiError(NETWORK_ERROR, NO_STATUS, null, 'The server could not be reached')
	}
	const { status, data } = error.response
	if (!isErrorBody(data)) {
		return new ApiError(`http_${status}`, status, null, `Request failed with status ${status}`)
	}
	return new ApiError(data.error, status, data.retryAfterSeconds ?? null, data.message ?? data.error)
}
```

`src/api/types.ts`: one exported type or interface per JSON shape in `docs/api.md`, field names verbatim. Nullable fields are `T | null`. `AdminStatus.counters` is `Record<string, number>`. `ProviderHealthState` is `'ok' | 'plan_required' | 'access_denied' | 'unreachable' | 'not_configured'`.

`src/api/envelopes.ts`. Use this pattern for every function:
```ts
import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'
import { toApiError } from './api-error.ts'
import type { EnvelopeDetail, EnvelopeScope, EnvelopeSummary } from './types.ts'

const API_ROOT = '/apps/assinaturas/api/v1'

function envelopesUrl(path = ''): string {
	return generateUrl(`${API_ROOT}/envelopes${path}`)
}

/** Runs one API call and turns any failure into an ApiError carrying our code. */
async function calling<Result>(request: () => Promise<Result>): Promise<Result> {
	try {
		return await request()
	} catch (error) {
		throw toApiError(error)
	}
}

export async function listEnvelopes(scope: EnvelopeScope): Promise<EnvelopeSummary[]> {
	return calling(async () => (await axios.get<{ envelopes: EnvelopeSummary[] }>(envelopesUrl(), { params: { scope } })).data.envelopes)
}

export async function getEnvelope(uuid: string): Promise<EnvelopeDetail> {
	return calling(async () => (await axios.get<EnvelopeDetail>(envelopesUrl(`/${encodeURIComponent(uuid)}`))).data)
}

export function signedFileUrl(uuid: string, documentId: number): string {
	return envelopesUrl(`/${encodeURIComponent(uuid)}/documents/${documentId}/signed`)
}
```
Write the remaining functions the same way, one per route in `docs/api.md`. `calling` is the higher-order wrapper that handles errors. `src/api/admin.ts` follows the same pattern with `API_ROOT + '/admin'`.

`src/api/query-keys.ts`:
```ts
import type { EnvelopeScope } from './types.ts'

/** The only source of cache keys: components never spell a key by hand. */
export const QUERY_KEYS = {
	envelopes: (scope: EnvelopeScope): readonly ['envelopes', EnvelopeScope] => ['envelopes', scope],
	envelope: (uuid: string): readonly ['envelope', string] => ['envelope', uuid],
	adminStatus: (): readonly ['admin-status'] => ['admin-status'],
}
```

- [ ] **Step 4: Run the tests and checks**

Run: `npx vitest run`, `npm run typecheck`, `npm run lint`.
Expected: all green and clean. There is no build output change, since nothing imports these modules yet.

- [ ] **Step 5: Commit**

```bash
git add src && git commit -m "feat: add the typed API client, API errors and query keys"
```

---

### Task 4: App shell — router, vue-query, navigation, sandbox banner, error boundary, "Novo envelope"

**Files:**
- Create: `src/router.ts`, `src/components/AppShell.vue`, `src/components/SandboxBanner.vue`, `src/components/ErrorBoundary.vue`, `src/views/ComingSoonView.vue`, `src/new-envelope.ts`
- Modify: `src/main.ts`, `l10n/pt_BR.json`, `l10n/pt_BR.js`
- Test: `src/components/AppShell.spec.ts`, `src/components/ErrorBoundary.spec.ts`, `src/new-envelope.spec.ts`

**Interfaces:**
- Consumes: `appConfig()` (Task 1); `createEnvelope` and `QUERY_KEYS` (Task 3); `getFilePickerBuilder` from `@nextcloud/dialogs`.
- Produces:
  - **Routes.** Both use `ComingSoonView` until Plan 3b replaces them.
    - `dashboard`: path `/`.
    - `envelope`: path `/envelopes/:uuid`, with the `uuid` route param.
    - History base: `generateUrl('/apps/assinaturas/')`.
  - **`AppShell`.** Layout: `NcContent` > `NcAppNavigation` (the "Novo envelope" button + a "Envelopes" link) > `NcAppContent` (`SandboxBanner` + `ErrorBoundary` > `RouterView`).
    - When `canUseApp` is false, it renders an `NcEmptyContent` saying the user has no access instead of the router.
  - **`SandboxBanner`.** Shows `role="status"` text "SANDBOX — no legal validity" (pt_BR "SANDBOX — sem validade jurídica"), with an icon and text, whenever `environment === 'sandbox'`.
  - **`ErrorBoundary`.** Catches render and setup errors (`onErrorCaptured`, returns `false`). It shows an `NcEmptyContent` with the message, plus a "Try again" button. Retry resets the error and calls `queryClient.resetQueries()`.
  - **`startNewEnvelope(router)`** (`src/new-envelope.ts`):
    1. Opens the Nextcloud file picker: PDFs only (`application/pdf`), multi-select, at most `limits.maxFiles` files.
    2. Calls `createEnvelope(<first file name without .pdf>, fileIds)`.
    3. Navigates to `{ name: 'envelope', params: { uuid } }`.
    - On cancel it does nothing.
    - On an `ApiError` it shows `showError(t('assinaturas', 'Could not create the envelope'))`.

- [ ] **Step 1: Write the failing tests**

`src/components/AppShell.spec.ts`. Mount with `@vue/test-utils`, a memory-history router built from the same routes, and a `VueQueryPlugin`. Mock `../app-config.ts`.
- With `environment: 'sandbox'`, the text "SANDBOX" is present.
- With `'production'`, it is absent.
- With `canUseApp: false`, the no-access empty content is shown and the router view is not rendered.
- The "Novo envelope" button exists and is a real `<button>` with an accessible name.

`src/components/ErrorBoundary.spec.ts`. A child component whose `setup` throws on first render renders the error state with a "Try again" button. Clicking it, after making the child render normally, shows the child.

`src/new-envelope.spec.ts`. Mock `@nextcloud/dialogs`' `getFilePickerBuilder` to return a builder whose `build().pick()` resolves to two nodes, with ids 12 and 34 and the first named `Contrato.pdf`. Mock `createEnvelope`.
- `startNewEnvelope(router)` calls `createEnvelope('Contrato', [12, 34])` and `router.push({ name: 'envelope', params: { uuid: 'u-1' } })`.
- When `pick()` rejects (the user cancelled), neither is called.
- When `createEnvelope` rejects with an `ApiError`, `showError` is called and there is no navigation.
- Check the real `@nextcloud/dialogs` 7 FilePicker API in `node_modules` before writing the mock: `getFilePickerBuilder(title).setMimeTypeFilter([...]).allowDirectories(false).setMultiSelect(true).build().pick()` and its return type. Match it exactly.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components src/new-envelope.spec.ts`
Expected: FAIL, because the modules do not exist.

- [ ] **Step 3: Implement**

`src/main.ts`:
```ts
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createApp } from 'vue'
import AppShell from './components/AppShell.vue'
import { createAppRouter } from './router.ts'

const STALE_AFTER_MILLISECONDS = 30_000
const RETRIES = 1

const queryClient = new QueryClient({
	defaultOptions: { queries: { staleTime: STALE_AFTER_MILLISECONDS, retry: RETRIES } },
})

createApp(AppShell)
	.use(createAppRouter())
	.use(VueQueryPlugin, { queryClient })
	.mount('#assinaturas')
```
`AppShell` is a default import, the Vue SFC convention. It is the one place named exports don't apply.

`src/router.ts`:
```ts
import { generateUrl } from '@nextcloud/router'
import { createRouter, createWebHistory, type RouteRecordRaw, type Router } from 'vue-router'
import ComingSoonView from './views/ComingSoonView.vue'

export const ROUTE_NAMES = { dashboard: 'dashboard', envelope: 'envelope' } as const satisfies Record<string, string>

export const ROUTES: RouteRecordRaw[] = [
	{ path: '/', name: ROUTE_NAMES.dashboard, component: ComingSoonView },
	{ path: '/envelopes/:uuid', name: ROUTE_NAMES.envelope, component: ComingSoonView },
]

export function createAppRouter(): Router {
	return createRouter({ history: createWebHistory(generateUrl('/apps/assinaturas/')), routes: ROUTES })
}
```
`as const satisfies` is the accepted way to keep literal types without a cast. If the linter or Patrick's no-`as` rule is applied strictly, use an exported `enum RouteName` instead. Both are fine; record the choice.

`AppShell.vue`, `SandboxBanner.vue`, `ErrorBoundary.vue`, `ComingSoonView.vue`:
- `<script setup lang="ts">` with `@nextcloud/vue` 9 components (`NcContent`, `NcAppNavigation`, `NcAppNavigationNew` for "Novo envelope", `NcAppNavigationItem`, `NcAppContent`, `NcEmptyContent`, `NcButton`).
- Icons come from `vue-material-design-icons` or `@mdi/svg` raw imports; add `vue-material-design-icons` to the dependencies if used.
- No module-level mutable state, and all strings go through `t()`.
- `ComingSoonView` shows an `NcEmptyContent` titled "This screen is on its way" (pt_BR "Esta tela está a caminho"), plus the route's `uuid` when present, so the Files action can be checked end to end before Plan 3b.

`src/new-envelope.ts`: implement `startNewEnvelope` as specified. Put the PDF MIME type and the picker title in named constants.

Add every new source string to `l10n/pt_BR.json` and `l10n/pt_BR.js`.

- [ ] **Step 4: Run the checks, build and bump**

1. Run `npx vitest run`, `npm run typecheck`, `npm run lint` and `npm run build`.
2. Bump `appinfo/info.xml` by one patch version.
3. Apply it with `occ upgrade`, following the procedure in the Global Constraints.
4. Run `tests/env/phpunit.sh` to make sure the backend is still green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add the app shell with navigation, sandbox banner, error boundary and new-envelope flow"
```

---

### Task 5: Files app action "Enviar para assinatura"

**Files:**
- Create: `src/files/send-for-signature-action.ts`, `src/files-init.ts`, `lib/Listener/LoadFilesActionListener.php`
- Modify: `vite.config.ts` (add the `files-init` entry), `lib/AppInfo/Application.php` (register the listener), `l10n/pt_BR.*`
- Test: `src/files/send-for-signature-action.spec.ts`, `tests/Integration/Listener/LoadFilesActionListenerTest.php`

**Interfaces:**
- Consumes: `@nextcloud/files` ^4.1, specifically `IFileAction`, `registerFileAction`, `FileType` and `Permission`; `createEnvelope` from Task 3; `generateUrl`.
- Produces:
  - `SEND_FOR_SIGNATURE_ACTION: IFileAction`:
    - **id:** `assinaturas-send`.
    - **enabled:** every selected node is a readable file with MIME type `application/pdf`; there are 1 to `maxFiles` nodes; the view is not the trash bin; the page is not a public share.
    - **`exec` / `execBatch`:** create one draft from all the nodes, the first being the main document and the title the first file's name without `.pdf`, then navigate to `/apps/assinaturas/envelopes/<uuid>`. An `ApiError` shows a translated toast. They return `null` or `null[]`, so the Files app stays quiet.
  - `files-init.ts` registers the action.
  - `LoadFilesActionListener` adds the `assinaturas-files-init` init script to the Files app only for users who may use the app.

- [ ] **Step 1: Write the failing tests**

`src/files/send-for-signature-action.spec.ts`. Build nodes with the real `File` class from `@nextcloud/files` (v4 constructor: `{ id, source, owner, mime, permissions, root }`; check the v4 typings). Assert `enabled()` for:
- one PDF: true;
- three PDFs: true;
- a PDF plus a `.docx`: false;
- a folder: false;
- a PDF without read permission: false;
- the view id `trashbin`: false;
- `maxFiles + 1` PDFs: false;
- zero nodes: false.

Mock `createEnvelope`, `window.location.assign` and `@nextcloud/dialogs` `showError`. Then:
- `execBatch` with two PDFs calls `createEnvelope('Contrato', [id1, id2])` and `window.location.assign('/index.php/apps/assinaturas/envelopes/u-1')`, and returns `[null, null]`.
- When `createEnvelope` rejects, it shows an error and does not navigate.

`tests/Integration/Listener/LoadFilesActionListenerTest.php`. As a member, handling a new `LoadAdditionalScriptsEvent` adds `assinaturas/js/assinaturas-files-init` to the scripts. Use the NC 33 API that exposes the queued scripts: `\OCP\Util::getScripts()` returns the list. Verify it exists and use it. As a non-member, the script is not added. Reset the queued scripts between cases if NC keeps them static; check how core tests do that.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/files` and `tests/env/phpunit.sh --filter LoadFilesActionListenerTest`
Expected: FAIL / ERROR, because the code does not exist yet.

- [ ] **Step 3: Implement**

`src/files/send-for-signature-action.ts`. Base it on this, and verify the v4 types:
```ts
import type { IFileAction, INode } from '@nextcloud/files'
import { showError } from '@nextcloud/dialogs'
import { FileType, Permission } from '@nextcloud/files'
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { isPublicShare } from '@nextcloud/sharing/public'
import DrawSvg from '@mdi/svg/svg/draw.svg?raw'
import { appConfig } from '../app-config.ts'
import { createEnvelope } from '../api/envelopes.ts'

const ACTION_ID = 'assinaturas-send'
const ACTION_ORDER = 40
const PDF_MIME_TYPE = 'application/pdf'
const TRASH_VIEW_ID = 'trashbin'
const PDF_EXTENSION = /\.pdf$/i

function isSendablePdf(node: INode): boolean {
	return node.type === FileType.File && node.mime === PDF_MIME_TYPE && (node.permissions & Permission.READ) !== 0
}

async function sendForSignature(nodes: INode[]): Promise<void> {
	const [mainDocument] = nodes
	if (mainDocument === undefined) {
		return
	}
	try {
		const envelope = await createEnvelope(mainDocument.basename.replace(PDF_EXTENSION, ''), nodes.map((node) => Number(node.fileid)))
		window.location.assign(generateUrl(`/apps/assinaturas/envelopes/${encodeURIComponent(envelope.uuid)}`))
	} catch {
		showError(t('assinaturas', 'Could not create the envelope'))
	}
}

export const SEND_FOR_SIGNATURE_ACTION: IFileAction = {
	id: ACTION_ID,
	order: ACTION_ORDER,
	displayName: () => t('assinaturas', 'Send for signature'),
	iconSvgInline: () => DrawSvg,
	enabled: ({ nodes, view }) => !isPublicShare()
		&& view.id !== TRASH_VIEW_ID
		&& nodes.length > 0
		&& nodes.length <= appConfig().limits.maxFiles
		&& nodes.every(isSendablePdf),
	exec: async ({ nodes }) => {
		await sendForSignature(nodes)
		return null
	},
	execBatch: async ({ nodes }) => {
		await sendForSignature(nodes)
		return nodes.map(() => null)
	},
}
```
- `appConfig()` reads the app page's initial state, which the Files page does not have. So the listener must also provide the `config` initial state. Inject `IInitialState` from the app's container, or `IInitialStateService` for another app's page; check which NC 33 allows from a listener, and pick the one that works. The page's state key `config` must match.
- If `fileid` is typed `number | undefined` in v4, guard it. Skip nodes without an id rather than casting.
- pt_BR string: "Send for signature" → "Enviar para assinatura".

`src/files-init.ts`:
```ts
import { registerFileAction } from '@nextcloud/files'
import { SEND_FOR_SIGNATURE_ACTION } from './files/send-for-signature-action.ts'

registerFileAction(SEND_FOR_SIGNATURE_ACTION)
```

`vite.config.ts`: add `'files-init': resolve('src', 'files-init.ts')`.

`lib/Listener/LoadFilesActionListener.php`:
- On `OCA\Files\Event\LoadAdditionalScriptsEvent`, when `AccessPolicy::canUseApp(<current user>)` is true:
  - call `Util::addInitScript(Application::APP_ID, 'assinaturas-files-init')`;
  - call `Util::addStyle(Application::APP_ID, 'assinaturas-files-init')`;
  - provide the `config` initial state from `ClientConfig::forUser`.
- Register it in `Application::register()` with `$context->registerEventListener(LoadAdditionalScriptsEvent::class, LoadFilesActionListener::class)`.

- [ ] **Step 4: Run the checks, build, bump and the suites**

1. Run the vitest suite, typecheck, lint and build.
2. Confirm `js/assinaturas-files-init.mjs` exists.
3. Bump `info.xml` by one patch version and apply it with `occ upgrade`.
4. Run `tests/env/phpunit.sh` (full suite).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add the Files action that starts an envelope from selected PDFs"
```

---

### Task 6: Admin settings page (Administração → Assinaturas, read-only)

**Files:**
- Create: `lib/Settings/AdminSettings.php`, `lib/Settings/AdminSection.php`, `templates/admin-settings.php`, `src/admin-settings.ts`, `src/admin/AdminSettings.vue`
- Modify: `appinfo/info.xml` (`<settings>` block and a version bump), `vite.config.ts` (`admin-settings` entry), `l10n/pt_BR.*`
- Test: `src/admin/AdminSettings.spec.ts`, `tests/Integration/Settings/AdminSettingsTest.php`

**Interfaces:**
- Consumes: `getAdminStatus(refresh)`, `resetCounters()`, `QUERY_KEYS.adminStatus()` (Task 3), and the admin status shape from `docs/api.md` § Admin.
- Produces:
  - `AdminSection`, implementing `IIconSection`: id `assinaturas`, name "Signatures", priority 75, icon `img/app-dark.svg`.
  - `AdminSettings`, implementing `ISettings`: section `assinaturas`, priority 10. It renders `templates/admin-settings.php`, which loads `assinaturas-admin-settings`.
  - `AdminSettings.vue`, a read-only panel showing:
    - an environment badge, with the sandbox one labelled "SANDBOX — no legal validity";
    - the health state, as icon plus text, with a hint for each state taken from the `docs/api.md` table. `plan_required` and `access_denied` are styled as errors, but the text still says what is wrong;
    - the plan (name, credits, status) when present;
    - the registered webhooks, or "None registered" when empty;
    - this month's usage (sent, completed, closed but billed);
    - stale syncs, with a warning when above 0;
    - the counters table (name and count), or "No counters" when empty;
    - the static reminder that "block out-of-order signing" must stay on in ZapSign.
  - Buttons:
    - **"Check now"** calls `getAdminStatus(true)` and updates the query cache.
    - **"Reset counters"** runs the mutation with an `NcDialog` confirm, then invalidates `adminStatus`.

**Never call the real admin status from tests.** Mock `getAdminStatus` in the Vitest test. On the PHP side, assert only the section and form wiring.

- [ ] **Step 1: Write the failing tests**

`src/admin/AdminSettings.spec.ts`. Mount the component with the vue-query plugin and `../api/admin.ts` mocked.
- An `ok` status with a plan shows the plan name, "Sandbox", the usage numbers and the counters.
- An `access_denied` status shows its explanatory text. The test asserts the text, not only a CSS class.
- Empty `webhooks` shows "None registered".
- Clicking "Check now" calls `getAdminStatus(true)`.
- Confirming "Reset counters" calls `resetCounters()`.

`tests/Integration/Settings/AdminSettingsTest.php`:
- `Server::get(AdminSettings::class)->getSection()` is `assinaturas`;
- `getForm()` returns a `TemplateResponse` for template `admin-settings`;
- `Server::get(AdminSection::class)->getID()` is `assinaturas`, and its `getIcon()` ends with `app-dark.svg`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/admin` and `tests/env/phpunit.sh --filter AdminSettingsTest`
Expected: FAIL / ERROR, because the classes and component do not exist.

- [ ] **Step 3: Implement**

`appinfo/info.xml`: add, keeping every other element as it is:
```xml
    <settings>
        <admin>OCA\Assinaturas\Settings\AdminSettings</admin>
        <admin-section>OCA\Assinaturas\Settings\AdminSection</admin-section>
    </settings>
```
Follow the element order of the NC `info.xsd`: `settings` comes after `commands` and before `navigations`. Check the XSD in the image.

`lib/Settings/AdminSection.php`: implement `IIconSection` with `IURLGenerator` and `IL10N` (via `IFactory`). Put the id and priority in constants.

`lib/Settings/AdminSettings.php`: implement `ISettings` as follows.
- `getForm()` returns `new TemplateResponse(Application::APP_ID, 'admin-settings')`.
- `getSection()` returns `'assinaturas'`.
- `getPriority()` returns `10`.

If NC 33 requires `IDelegatedSettings` for admin delegation, implement it with `getName()` returning null and `getAuthorizedAppConfig()` returning `[]`.

`templates/admin-settings.php`: `Util::addScript('assinaturas', 'assinaturas-admin-settings'); Util::addStyle(...)` and `<div id="assinaturas-admin-settings"></div>`.

`src/admin-settings.ts`: mount `AdminSettings.vue` on `#assinaturas-admin-settings` with its own `QueryClient`, using the same defaults as `main.ts`. If both entries need it, extract the client factory to `src/query-client.ts`.

`src/admin/AdminSettings.vue`:
- Use `useQuery({ queryKey: QUERY_KEYS.adminStatus(), queryFn: () => getAdminStatus(false) })`.
- "Check now" uses `useMutation` with `getAdminStatus(true)`; on success it sets the query data.
- Use `NcSettingsSection`, `NcButton`, `NcDialog` and `NcNoteCard`. `NcNoteCard` with a type error, warning or success gives an accessible icon plus text.
- Keep the state-to-hint mapping in a hash map constant, keyed by the `ProviderHealthState` union, so the compiler checks it is complete.

Add the strings to pt_BR.

- [ ] **Step 4: Run the checks, build, bump and the suites**

Run, in order:
1. The vitest suite, typecheck, lint and build. The build must produce `js/assinaturas-admin-settings.mjs`.
2. Bump the version, then run `occ upgrade`.
3. Check that `tests/env/php.sh occ app:list | grep assinaturas` shows the new version.
4. `tests/env/phpunit.sh` (full suite).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add the read-only admin settings page with health, usage and counters"
```

---

## Open design questions for Patrick (before Plan 3b)

Plan 3b covers the dashboard, the wizard (documents → signers → placement → review), the placement editor and the detail view. These need answers first:

1. **Look and feel.** Should the app look like native Nextcloud (`@nextcloud/vue` defaults plus the Avuz theme colour), or does Avuz want its own visual identity inside the app (custom cards, illustrations, typography)? This decides how much custom CSS Plan 3b carries.
2. **Where the wizard lives.** Full-page steps inside the app (`/envelopes/:uuid` showing the wizard while the envelope is a draft) or a large modal over the dashboard? The Files action already opens `/envelopes/<uuid>`.
3. **The placement editor on mobile.** Desktop and tablet only, with mobile users told to use a larger screen? Or should it also work on phones (touch drag and resize, pinch zoom)? Mobile roughly doubles the editor's effort.
4. **Placement defaults.** Should the wizard place each signer's signature box automatically (for example at the bottom of the last page, staggered), so a user can send without placing anything? Or must the user always place them? The spec marks placement optional; if skipped, ZapSign asks signers to sign at the end with no box.
5. **Dashboard search and filters.** The spec lists filters (*Aguardando*, *Concluídos*, *Recusados / Expirados / Cancelados*, *Rascunhos*, *Com erro*) and search by title, file name or signer. The API today returns the 200 most recent envelopes and no server-side search. Is filtering those 200 in the browser enough for v1, or should 3b add server-side filters and search with paging?
6. **Signer input.** Free typing of name and email only, or autocomplete from Nextcloud contacts or users (`@nextcloud/vue` user picker or the Contacts API)?
7. **"Rubricar todas as páginas".** Initials on every page of every document for a signer, or per document? Is there a default position, such as bottom-right?
8. **Detail view and the Files sidebar.** Besides the app page, should a PDF that is in an envelope show its signing status in the Files sidebar (a tab)? That needs an extra web-component tab, not verified on NC 33 yet.
9. **Brand assets.** Is there a specific Avuz illustration or empty-state artwork to use, or should 3b stick to Nextcloud's icons?
