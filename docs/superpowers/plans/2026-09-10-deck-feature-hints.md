# Deck in-app feature hints — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A contextual coach-mark system in Deck: a dismissible popover anchored (via a `v-feature-hint` directive) to a real control, shown once per user per revision, with admin-editable copy/link/enable/republish.

**Architecture:** Frontend = a hint registry (defaults) + a Vuex engine (eligibility: on-screen ∧ unseen ∧ enabled, one-at-a-time by priority) + a `v-feature-hint` directive (attaches a controlled `NcPopover` to the element by ref, no DOM restructuring). Backend = per-user "seen" through Deck's existing `ConfigService` whitelist, admin overrides in appconfig via a new service + admin OCS controller + a Deck admin settings section.

**Tech Stack:** Nextcloud Deck fork (PHP 8 AppFramework, PHPUnit) at `apps/deck`; Vue 2.7 + Vuex + `@nextcloud/vue` (`NcPopover`); build workspace `/Users/patrickrezende/work/avuz/deck-fork`.

## Global Constraints

- All code + tests in the deck fork checkout `/Users/patrickrezende/work/avuz/deck-fork` (branch `avuz` — actually work on whatever branch the worktree tracks; commit there, push, then bump the submodule).
- Backend PHPUnit runs via `~/deck-test.sh --filter <Name> tests/unit/...` (harness: bind-mounts the fork into a NC-bootstrapped container; the harness DB may need a column/appvalue seeded for DB-backed tests). Lint with `php -l`. Frontend jest runs locally: `./node_modules/.bin/jest <path>`.
- Anchor to **persistent, visible controls**; for menu-buried features hint the **opener**. NEVER wrap a control in a DOM-restructuring component (breaks `NcActions`) — the directive attaches by ref.
- Per-user "seen" is a map `{id: revision}` stored JSON-encoded under user config key `featureHintsSeen` (add a case to `ConfigService`'s whitelist — it rejects unknown keys).
- Admin overrides are instance-global JSON in appconfig key `featureHints` = `{id: {enabled, text, link, revision}}`. Effective hint = registry default ⊕ override.
- A hint is eligible iff `enabled !== false` ∧ registered(on-screen) ∧ `(seen[id] ?? -1) < effectiveRevision`. `activeId` = eligible hint with lowest `priority`. Only `activeId` shows.
- `markSeen` sets local seen FIRST (closes popover), then persists via the existing `setConfig` action; a persist failure must not re-open the hint that session.
- Admin PUT/GET is admin-only (403 otherwise). Default copy ships pt_BR.
- Ship via `scripts/deploy-deck.sh` with an `appinfo/info.xml` version bump (frontend → `?v=` must move).

---

## File structure

Backend (`apps/deck/`):
- `lib/Service/ConfigService.php` — add `featureHintsSeen` case (per-user seen).
- `lib/Service/FeatureHintService.php` — admin overrides in appconfig (get merged / set one).
- `lib/Controller/FeatureHintController.php` — admin OCS (GET list, PUT one).
- `lib/Controller/PageController.php` — provide `featureHints` initial state.
- `lib/Settings/FeatureHintsAdmin.php` + `lib/Settings/AdminSection.php` — admin settings section; `appinfo/info.xml` `<settings>` + version.
- `appinfo/routes.php` — the two OCS routes.

Frontend (`apps/deck/src/`):
- `featureHints.js` — registry (defaults).
- `store/featureHints.js` — Vuex engine module.
- `directives/featureHint.js` — `v-feature-hint` directive.
- `components/hints/FeatureHintPopover.vue` — the popover body (text + CTA + dismiss) the directive mounts.
- `views/FeatureHintsAdminSettings.vue` + its entry — admin panel.
- usage edits: assignee-filter control, folder opener, sharing tab.
- l10n defaults (fork + `themes/avuz/apps/deck/l10n/pt_BR.json`).

---

## Task 1: Per-user "seen" persistence in ConfigService

**Files:**
- Modify: `apps/deck/lib/Service/ConfigService.php`
- Test: `apps/deck/tests/unit/Service/ConfigServiceTest.php`

**Interfaces:**
- Produces: config key `featureHintsSeen` — `get('featureHintsSeen')` returns `array<string,int>`; `set('featureHintsSeen', array)` persists JSON; `getAll()` includes `featureHintsSeen`.

- [ ] **Step 1: Write the failing test**

```php
// ConfigServiceTest.php — the fork's ConfigServiceTest mocks IConfig; mirror its setUp.
public function testSetAndGetFeatureHintsSeenRoundTripsJson(): void {
	$this->userSession->method('getUser')->willReturn($this->user); // 'admin', per existing setUp
	$this->config->expects(self::once())->method('setUserValue')
		->with('admin', 'deck', 'featureHintsSeen', json_encode(['board-scoped-share' => 2]));
	$result = $this->service->set('featureHintsSeen', ['board-scoped-share' => 2]);
	self::assertSame(['board-scoped-share' => 2], $result);
}

public function testGetFeatureHintsSeenDecodesJsonDefaultEmpty(): void {
	$this->userSession->method('getUser')->willReturn($this->user);
	$this->config->method('getUserValue')
		->with('admin', 'deck', 'featureHintsSeen', '{}')
		->willReturn('{"folder-create-board":1}');
	self::assertSame(['folder-create-board' => 1], $this->service->get('featureHintsSeen'));
}
```
(Match the existing test file's constructor for `ConfigService` and its `$this->config`/`$this->user` mocks.)

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/patrickrezende/work/avuz/deck-fork
~/deck-test.sh --filter FeatureHintsSeen tests/unit/Service/ConfigServiceTest.php
```
Expected: FAIL (`get`/`set` return false for the unknown scope).

- [ ] **Step 3: Add the whitelist cases**

In `ConfigService::get()`, add before the closing `}` of the switch:
```php
			case 'featureHintsSeen':
				if ($this->getUserId() === null) {
					return [];
				}
				return json_decode((string)$this->config->getUserValue($this->getUserId(), Application::APP_ID, 'featureHintsSeen', '{}'), true) ?: [];
```
In `ConfigService::set()`, add a case before `case 'board':`:
```php
			case 'featureHintsSeen':
				if (!is_array($value)) {
					throw new BadRequestException('featureHintsSeen must be a map of hint id to revision');
				}
				$this->config->setUserValue($userId, Application::APP_ID, 'featureHintsSeen', json_encode($value));
				$result = $value;
				break;
```
In `getAll()`, add to the `$data` array:
```php
			'featureHintsSeen' => $this->get('featureHintsSeen'),
```

- [ ] **Step 4: Run to verify pass + lint**

```bash
~/deck-test.sh --filter FeatureHintsSeen tests/unit/Service/ConfigServiceTest.php
php -l lib/Service/ConfigService.php
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/Service/ConfigService.php tests/unit/Service/ConfigServiceTest.php
git commit -m "feat(config): persist per-user featureHintsSeen map"
```

---

## Task 2: Admin-override service (appconfig)

**Files:**
- Create: `apps/deck/lib/Service/FeatureHintService.php`
- Test: `apps/deck/tests/unit/Service/FeatureHintServiceTest.php`

**Interfaces:**
- Consumes: `OCP\IConfig` (`getAppValue`/`setAppValue` on `Application::APP_ID`).
- Produces:
  - `getOverrides(): array` → decoded `{id: {enabled?, text?, link?, revision?}}` (empty array if unset).
  - `setOverride(string $id, array $patch): array` → merges `$patch` into that id's entry, persists, returns the full overrides map.

- [ ] **Step 1: Write the failing test**

```php
// FeatureHintServiceTest.php — mock IConfig
public function testGetOverridesDecodesAppValue(): void {
	$this->config->method('getAppValue')->with('deck', 'featureHints', '{}')
		->willReturn('{"a":{"enabled":false}}');
	self::assertSame(['a' => ['enabled' => false]], $this->service->getOverrides());
}

public function testSetOverrideMergesAndPersists(): void {
	$this->config->method('getAppValue')->with('deck', 'featureHints', '{}')
		->willReturn('{"a":{"revision":1}}');
	$this->config->expects(self::once())->method('setAppValue')
		->with('deck', 'featureHints', json_encode(['a' => ['revision' => 1, 'text' => 'oi']]));
	$out = $this->service->setOverride('a', ['text' => 'oi']);
	self::assertSame(['a' => ['revision' => 1, 'text' => 'oi']], $out);
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
~/deck-test.sh --filter FeatureHintServiceTest tests/unit/Service/FeatureHintServiceTest.php
```
Expected: FAIL (class missing).

- [ ] **Step 3: Implement**

```php
<?php
declare(strict_types=1);
/** SPDX-FileCopyrightText: 2026 Avuz / SPDX-License-Identifier: AGPL-3.0-or-later */
namespace OCA\Deck\Service;

use OCA\Deck\AppInfo\Application;
use OCP\IConfig;

class FeatureHintService {
	public function __construct(private IConfig $config) {
	}

	/** @return array<string, array{enabled?: bool, text?: string, link?: string, revision?: int}> */
	public function getOverrides(): array {
		return json_decode($this->config->getAppValue(Application::APP_ID, 'featureHints', '{}'), true) ?: [];
	}

	/** @return array<string, array> the full overrides map after the merge */
	public function setOverride(string $id, array $patch): array {
		$all = $this->getOverrides();
		$all[$id] = array_merge($all[$id] ?? [], $patch);
		$this->config->setAppValue(Application::APP_ID, 'featureHints', json_encode($all));
		return $all;
	}
}
```

- [ ] **Step 4: Run + lint**

```bash
~/deck-test.sh --filter FeatureHintServiceTest tests/unit/Service/FeatureHintServiceTest.php
php -l lib/Service/FeatureHintService.php
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/Service/FeatureHintService.php tests/unit/Service/FeatureHintServiceTest.php
git commit -m "feat(hints): appconfig-backed admin overrides service"
```

---

## Task 3: Admin OCS controller + routes

**Files:**
- Create: `apps/deck/lib/Controller/FeatureHintController.php`
- Modify: `apps/deck/appinfo/routes.php`
- Test: `apps/deck/tests/unit/Controller/FeatureHintControllerTest.php`

**Interfaces:**
- Consumes: `FeatureHintService::getOverrides()`, `setOverride()` (Task 2).
- Produces: OCS `GET /api/v{apiVersion}/feature-hints` (admin) → overrides; `PUT /api/v{apiVersion}/feature-hints/{id}` (admin) → merged map.

- [ ] **Step 1: Write the failing test**

```php
public function testUpdateRejectsNonAdmin(): void {
	$this->groupManager->method('isAdmin')->with('bob')->willReturn(false);
	$this->userSession->method('getUser')->willReturn($this->userMock('bob'));
	$this->expectException(\OCP\AppFramework\OCS\OCSForbiddenException::class);
	$this->controller->update('a', true, 'oi', null, null);
}

public function testUpdateAdminPersists(): void {
	$this->groupManager->method('isAdmin')->with('admin')->willReturn(true);
	$this->userSession->method('getUser')->willReturn($this->userMock('admin'));
	$this->service->expects(self::once())->method('setOverride')
		->with('a', ['enabled' => true, 'text' => 'oi'])->willReturn(['a' => ['enabled' => true, 'text' => 'oi']]);
	$res = $this->controller->update('a', true, 'oi', null, null);
	self::assertSame(['a' => ['enabled' => true, 'text' => 'oi']], $res->getData());
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
~/deck-test.sh --filter FeatureHintControllerTest tests/unit/Controller/FeatureHintControllerTest.php
```
Expected: FAIL.

- [ ] **Step 3: Implement the controller**

```php
<?php
declare(strict_types=1);
/** SPDX-FileCopyrightText: 2026 Avuz / SPDX-License-Identifier: AGPL-3.0-or-later */
namespace OCA\Deck\Controller;

use OCA\Deck\Service\FeatureHintService;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCS\OCSForbiddenException;
use OCP\AppFramework\OCSController;
use OCP\IGroupManager;
use OCP\IRequest;
use OCP\IUserSession;

class FeatureHintController extends OCSController {
	public function __construct(
		$AppName,
		IRequest $request,
		private FeatureHintService $service,
		private IUserSession $userSession,
		private IGroupManager $groupManager,
	) {
		parent::__construct($AppName, $request);
	}

	private function assertAdmin(): void {
		$user = $this->userSession->getUser();
		if ($user === null || !$this->groupManager->isAdmin($user->getUID())) {
			throw new OCSForbiddenException('Admin only');
		}
	}

	#[NoCSRFRequired]
	public function index(): DataResponse {
		$this->assertAdmin();
		return new DataResponse($this->service->getOverrides());
	}

	public function update(string $id, ?bool $enabled = null, ?string $text = null, ?string $link = null, ?int $revision = null): DataResponse {
		$this->assertAdmin();
		$patch = [];
		if ($enabled !== null) { $patch['enabled'] = $enabled; }
		if ($text !== null) { $patch['text'] = $text; }
		if ($link !== null) { $patch['link'] = $link; }
		if ($revision !== null) { $patch['revision'] = $revision; }
		return new DataResponse($this->service->setOverride($id, $patch));
	}
}
```

- [ ] **Step 4: Add routes**

In `appinfo/routes.php`, in the `'ocs'` array beside the `Config#` routes:
```php
		['name' => 'FeatureHint#index', 'url' => '/api/v{apiVersion}/feature-hints', 'verb' => 'GET'],
		['name' => 'FeatureHint#update', 'url' => '/api/v{apiVersion}/feature-hints/{id}', 'verb' => 'PUT'],
```

- [ ] **Step 5: Run + lint + commit**

```bash
~/deck-test.sh --filter FeatureHintControllerTest tests/unit/Controller/FeatureHintControllerTest.php
php -l lib/Controller/FeatureHintController.php appinfo/routes.php
git add lib/Controller/FeatureHintController.php appinfo/routes.php tests/unit/Controller/FeatureHintControllerTest.php
git commit -m "feat(hints): admin OCS controller (list + update override)"
```

---

## Task 4: Deliver overrides to the frontend via initial state

**Files:**
- Modify: `apps/deck/lib/Controller/PageController.php`
- Test: (covered by the frontend store hydration test in Task 6; no new backend test — this is one wiring line)

**Interfaces:**
- Consumes: `FeatureHintService::getOverrides()`.
- Produces: `loadState('deck', 'featureHints')` on the frontend = the overrides map.

- [ ] **Step 1: Inject + provide**

Add `private FeatureHintService $featureHintService,` to `PageController`'s constructor (import it). After the existing `provideInitialState('config', ...)` line:
```php
		$this->initialState->provideInitialState('featureHints', $this->featureHintService->getOverrides());
```

- [ ] **Step 2: Lint + commit**

```bash
php -l lib/Controller/PageController.php
git add lib/Controller/PageController.php
git commit -m "feat(hints): provide featureHints overrides in initial state"
```

---

## Task 5: Hint registry (frontend defaults)

**Files:**
- Create: `apps/deck/src/featureHints.js`
- Test: `apps/deck/src/featureHints.spec.js`

**Interfaces:**
- Produces: `FEATURE_HINTS` — `Array<{ id: string, revision: number, priority: number, defaultText: string, defaultLink: string, defaultCta: string }>`; and `hintById(id)`.

- [ ] **Step 1: Write the failing test**

```js
import { FEATURE_HINTS, hintById } from './featureHints.js'
describe('featureHints registry', () => {
	it('has unique ids and required fields', () => {
		const ids = FEATURE_HINTS.map(h => h.id)
		expect(new Set(ids).size).toBe(ids.length)
		FEATURE_HINTS.forEach(h => {
			expect(typeof h.id).toBe('string')
			expect(typeof h.revision).toBe('number')
			expect(typeof h.priority).toBe('number')
			expect(typeof h.defaultText).toBe('string')
		})
	})
	it('hintById returns the entry or undefined', () => {
		expect(hintById(FEATURE_HINTS[0].id).id).toBe(FEATURE_HINTS[0].id)
		expect(hintById('nope')).toBeUndefined()
	})
})
```

- [ ] **Step 2: Run (fails), implement, run (pass)**

```bash
./node_modules/.bin/jest src/featureHints.spec.js
```
Implement:
```js
import { translate as t } from '@nextcloud/l10n'

export const FEATURE_HINTS = [
	{ id: 'assignee-filter', revision: 1, priority: 10,
		defaultText: t('deck', 'Filtre o painel por usuário atribuído para ver só os cards dele.'),
		defaultLink: '', defaultCta: t('deck', 'Saiba mais') },
	{ id: 'folder-create-board', revision: 1, priority: 20,
		defaultText: t('deck', 'Agora você pode criar um painel já dentro de uma pasta.'),
		defaultLink: '', defaultCta: t('deck', 'Saiba mais') },
	{ id: 'board-scoped-share', revision: 1, priority: 30,
		defaultText: t('deck', 'Ao compartilhar, você pode liberar só os cards atribuídos ao usuário.'),
		defaultLink: '', defaultCta: t('deck', 'Saiba mais') },
]

export function hintById(id) {
	return FEATURE_HINTS.find(h => h.id === id)
}
```
Re-run: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/featureHints.js src/featureHints.spec.js
git commit -m "feat(hints): feature-hint registry with pt_BR defaults"
```

---

## Task 6: Eligibility engine (Vuex module)

**Files:**
- Create: `apps/deck/src/store/featureHints.js`
- Modify: `apps/deck/src/store/main.js` (register the module)
- Test: `apps/deck/src/store/featureHints.spec.js`

**Interfaces:**
- Consumes: `FEATURE_HINTS`, `hintById` (Task 5); the root `setConfig` action (Task 1 path) for persistence; `loadState('deck','config')` (seen) + `loadState('deck','featureHints')` (overrides).
- Produces: namespaced module `featureHints` with state `{ registered:[], seen:{}, overrides:{} }`, getters `effectiveHint(id)`, `activeId`, actions `hydrate()`, `register(id)`, `unregister(id)`, `markSeen(id)`.

- [ ] **Step 1: Write the failing tests**

```js
import { createStore } from './featureHints.js' // exports a factory for testing
describe('featureHints engine', () => {
	it('effectiveHint merges override over default', () => {
		const s = createStore({ overrides: { 'assignee-filter': { text: 'X', revision: 2 } } })
		const eff = s.getters['featureHints/effectiveHint']('assignee-filter')
		expect(eff.text).toBe('X'); expect(eff.revision).toBe(2)
	})
	it('activeId is the lowest-priority eligible registered unseen hint', () => {
		const s = createStore({ seen: {} })
		s.commit('featureHints/REGISTER', 'folder-create-board') // priority 20
		s.commit('featureHints/REGISTER', 'assignee-filter')     // priority 10
		expect(s.getters['featureHints/activeId']).toBe('assignee-filter')
	})
	it('a seen hint at the current revision is not active', () => {
		const s = createStore({ seen: { 'assignee-filter': 1 } })
		s.commit('featureHints/REGISTER', 'assignee-filter')
		expect(s.getters['featureHints/activeId']).toBeUndefined()
	})
	it('bumped revision re-activates a previously seen hint', () => {
		const s = createStore({ seen: { 'assignee-filter': 1 }, overrides: { 'assignee-filter': { revision: 2 } } })
		s.commit('featureHints/REGISTER', 'assignee-filter')
		expect(s.getters['featureHints/activeId']).toBe('assignee-filter')
	})
	it('disabled hint is never active', () => {
		const s = createStore({ overrides: { 'assignee-filter': { enabled: false } } })
		s.commit('featureHints/REGISTER', 'assignee-filter')
		expect(s.getters['featureHints/activeId']).toBeUndefined()
	})
	it('markSeen sets seen to effective revision and clears active', async () => {
		const dispatched = []
		const s = createStore({ seen: {}, rootDispatch: (a, p) => dispatched.push([a, p]) })
		s.commit('featureHints/REGISTER', 'assignee-filter')
		await s.dispatch('featureHints/markSeen', 'assignee-filter')
		expect(s.state.featureHints.seen['assignee-filter']).toBe(1)
		expect(s.getters['featureHints/activeId']).toBeUndefined()
		expect(dispatched).toContainEqual(['setConfig', { featureHintsSeen: { 'assignee-filter': 1 } }])
	})
})
```

- [ ] **Step 2: Run (fails), implement**

Module (namespaced). `createStore` is a test helper the module file exports that builds a tiny Vuex store wrapping the module with seeded state + a stubbed root `setConfig`.

```js
import Vue from 'vue'
import { FEATURE_HINTS, hintById } from '../featureHints.js'

export default {
	namespaced: true,
	state: () => ({ registered: [], seen: {}, overrides: {} }),
	mutations: {
		HYDRATE(state, { seen, overrides }) { state.seen = seen || {}; state.overrides = overrides || {} },
		REGISTER(state, id) { if (!state.registered.includes(id)) { state.registered.push(id) } },
		UNREGISTER(state, id) { state.registered = state.registered.filter(x => x !== id) },
		SET_SEEN(state, { id, revision }) { Vue.set(state.seen, id, revision) },
	},
	getters: {
		effectiveHint: state => id => {
			const base = hintById(id)
			if (!base) { return null }
			const o = state.overrides[id] || {}
			return {
				id,
				text: o.text ?? base.defaultText,
				link: o.link ?? base.defaultLink,
				cta: base.defaultCta,
				revision: o.revision ?? base.revision,
				enabled: o.enabled ?? true,
				priority: base.priority,
			}
		},
		activeId: (state, getters) => {
			const eligible = state.registered
				.map(id => getters.effectiveHint(id))
				.filter(h => h && h.enabled !== false && (state.seen[h.id] ?? -1) < h.revision)
				.sort((a, b) => a.priority - b.priority)
			return eligible.length ? eligible[0].id : undefined
		},
	},
	actions: {
		hydrate({ commit }, { seen, overrides }) { commit('HYDRATE', { seen, overrides }) },
		register({ commit }, id) { commit('REGISTER', id) },
		unregister({ commit }, id) { commit('UNREGISTER', id) },
		async markSeen({ commit, state, getters, dispatch }, id) {
			const revision = getters.effectiveHint(id)?.revision ?? 1
			commit('SET_SEEN', { id, revision }) // local first — closes the popover, never loops
			const featureHintsSeen = { ...state.seen }
			try {
				await dispatch('setConfig', { featureHintsSeen }, { root: true })
			} catch (e) {
				console.error('feature hint seen persist failed', e) // stays closed locally
			}
		},
	},
}
```

Register in `src/store/main.js`: import the module and add it under `modules: { featureHints }` in the store options (follow the existing modules registration; if none, add a `modules` key). Also, on app boot (the store's init or `App.vue` created hook), dispatch `featureHints/hydrate` with `loadState('deck','config').featureHintsSeen` and `loadState('deck','featureHints')` — add that in Task 8.

Add the `createStore` test factory export at the bottom of the module file (guarded so it isn't shipped logic — a named export used only by the spec).

- [ ] **Step 3: Run (pass) + commit**

```bash
./node_modules/.bin/jest src/store/featureHints.spec.js
git add src/store/featureHints.js src/store/main.js src/store/featureHints.spec.js
git commit -m "feat(hints): eligibility engine (one-at-a-time, revisioned, persisted)"
```

---

## Task 7: `v-feature-hint` directive + popover body

**Files:**
- Create: `apps/deck/src/directives/featureHint.js`
- Create: `apps/deck/src/components/hints/FeatureHintPopover.vue`
- Modify: register the directive globally (`src/main.js` / the app entry `Vue.directive('feature-hint', …)`)
- Test: `apps/deck/src/components/hints/FeatureHintPopover.spec.js`

**Interfaces:**
- Consumes: engine module (`register`/`unregister`/`activeId`/`effectiveHint`/`markSeen`), `NcPopover`.
- Produces: `v-feature-hint="'<id>'"` on any element → registers on insert (with an IntersectionObserver gating "on screen"), shows a controlled `NcPopover` anchored to the element when `activeId === id`, dismiss/CTA → `markSeen`.

- [ ] **Step 1: Test the popover body (jest)**

```js
// FeatureHintPopover.spec.js — mount with an effective hint; assert text/CTA + events
import { shallowMount } from '@vue/test-utils'
import FeatureHintPopover from './FeatureHintPopover.vue'
it('renders text and CTA and emits dismiss', async () => {
	const wrapper = shallowMount(FeatureHintPopover, { propsData: { hint: { id: 'a', text: 'Olá', link: 'https://x', cta: 'Saiba mais' } } })
	expect(wrapper.text()).toContain('Olá')
	await wrapper.find('[data-cy-hint-dismiss]').trigger('click')
	expect(wrapper.emitted('dismiss')).toBeTruthy()
})
it('CTA opens the link and emits dismiss', async () => {
	const open = jest.spyOn(window, 'open').mockImplementation(() => {})
	const wrapper = shallowMount(FeatureHintPopover, { propsData: { hint: { id: 'a', text: 'x', link: 'https://x', cta: 'Saiba mais' } } })
	await wrapper.find('[data-cy-hint-cta]').trigger('click')
	expect(open).toHaveBeenCalledWith('https://x', '_blank', 'noopener,noreferrer')
	expect(wrapper.emitted('dismiss')).toBeTruthy()
})
```

- [ ] **Step 2: Run (fails), implement the popover body**

```html
<!-- FeatureHintPopover.vue -->
<template>
	<div class="feature-hint">
		<p class="feature-hint__text">{{ hint.text }}</p>
		<div class="feature-hint__actions">
			<NcButton v-if="hint.link" type="tertiary" data-cy-hint-cta @click="cta">{{ hint.cta }}</NcButton>
			<NcButton type="primary" data-cy-hint-dismiss @click="$emit('dismiss')">{{ t('deck', 'Entendi') }}</NcButton>
		</div>
	</div>
</template>
<script>
import { NcButton } from '@nextcloud/vue'
import { translate as t } from '@nextcloud/l10n'
export default {
	name: 'FeatureHintPopover',
	components: { NcButton },
	props: { hint: { type: Object, required: true } },
	methods: {
		t,
		cta() { window.open(this.hint.link, '_blank', 'noopener,noreferrer'); this.$emit('dismiss') },
	},
}
</script>
```

- [ ] **Step 3: Implement the directive**

```js
// directives/featureHint.js
import Vue from 'vue'
import NcPopover from '@nextcloud/vue/dist/Components/NcPopover.js'
import FeatureHintPopover from '../components/hints/FeatureHintPopover.vue'
import store from '../store/main.js'

// Attaches a controlled NcPopover to `el` by ref (no DOM restructuring), driven by the engine.
export default {
	inserted(el, binding) {
		const id = binding.value
		let popoverInstance = null
		let unwatch = null

		const observer = new IntersectionObserver(([entry]) => {
			if (entry.isIntersecting) { store.dispatch('featureHints/register', id) }
			else { store.dispatch('featureHints/unregister', id) }
		}, { threshold: 0.5 })
		observer.observe(el)

		const render = (active) => {
			if (active && !popoverInstance) {
				const hint = store.getters['featureHints/effectiveHint'](id)
				popoverInstance = new Vue({
					store,
					render: h => h(NcPopover, {
						props: { shown: true, placement: 'bottom' },
						// anchor: NcPopover's trigger slot is the referenced element's bounding box via a virtual element
					}, [
						h('template', { slot: 'default' }, [
							h(FeatureHintPopover, { props: { hint }, on: { dismiss: () => store.dispatch('featureHints/markSeen', id) } }),
						]),
					]),
				})
				// Anchor to `el`: mount the popover next to el and set its virtual reference to el's rect.
				const holder = document.createElement('div')
				el.parentElement.appendChild(holder)
				popoverInstance.$mount(holder)
				popoverInstance.$el.__anchor = el
			} else if (!active && popoverInstance) {
				popoverInstance.$destroy(); popoverInstance.$el.remove(); popoverInstance = null
			}
		}

		unwatch = store.watch(
			(state, getters) => getters['featureHints/activeId'] === id,
			(active) => render(active),
			{ immediate: true },
		)

		el.__featureHintCleanup = () => { observer.disconnect(); unwatch && unwatch(); if (popoverInstance) { popoverInstance.$destroy(); popoverInstance = null } store.dispatch('featureHints/unregister', id) }
	},
	unbind(el) {
		if (el.__featureHintCleanup) { el.__featureHintCleanup() }
	},
}
```

Register globally in the app entry (`src/main.js`): `import featureHint from './directives/featureHint.js'; Vue.directive('feature-hint', featureHint)`.

Note for the implementer: `NcPopover` anchoring to an arbitrary existing element uses its `boundary`/virtual-reference support; if the exact anchor API differs in the installed `@nextcloud/vue` version, anchor by positioning the mounted popover holder over `el`'s `getBoundingClientRect()` (a small `position:absolute` holder at el's rect) rather than restructuring `el`. The behavioral contract (shows when active, dismiss → markSeen) is what the tests assert; the anchor mechanics are verified on staging.

- [ ] **Step 4: Run popover-body test (pass) + lint the JS (build)**

```bash
./node_modules/.bin/jest src/components/hints/FeatureHintPopover.spec.js
npm run build   # ensures the directive + module compile
```
Expected: jest PASS; webpack compiles.

- [ ] **Step 5: Commit**

```bash
git add src/directives/featureHint.js src/components/hints/FeatureHintPopover.vue src/main.js src/components/hints/FeatureHintPopover.spec.js
git commit -m "feat(hints): v-feature-hint directive + popover body"
```

---

## Task 8: Hydrate the engine on boot

**Files:**
- Modify: the app root (`src/App.vue` `created()` or the store bootstrap) to dispatch `featureHints/hydrate`.
- Test: covered by the engine spec (Task 6) hydrate path; add one integration-ish assertion if the root has a spec, else rely on staging.

**Interfaces:**
- Consumes: `loadState('deck','config').featureHintsSeen`, `loadState('deck','featureHints')`, engine `hydrate`.

- [ ] **Step 1: Dispatch hydrate**

In the app root `created()` (where other initial dispatches happen):
```js
import { loadState } from '@nextcloud/initial-state'
// …
this.$store.dispatch('featureHints/hydrate', {
	seen: (loadState('deck', 'config', {}).featureHintsSeen) || {},
	overrides: loadState('deck', 'featureHints', {}),
})
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/App.vue
git commit -m "feat(hints): hydrate seen + overrides from initial state on boot"
```

---

## Task 9: Admin settings section + panel

**Files:**
- Create: `apps/deck/lib/Settings/AdminSection.php`, `apps/deck/lib/Settings/FeatureHintsAdmin.php`
- Modify: `apps/deck/appinfo/info.xml` (register `<settings>`)
- Create: `apps/deck/src/views/FeatureHintsAdminSettings.vue` + entry `src/featureHintsAdmin.js` + a webpack entry
- Test: `apps/deck/src/views/FeatureHintsAdminSettings.spec.js`

**Interfaces:**
- Consumes: `FeatureHintService` (Task 2), `FEATURE_HINTS` (Task 5), the OCS routes (Task 3).
- Produces: an admin settings page listing hints with editable text/link/enabled + Republicar.

- [ ] **Step 1: Backend settings classes**

`AdminSection.php` implements `OCP\Settings\IIconSection` (id `deck`, name "Deck", priority ~75, an icon). `FeatureHintsAdmin.php` implements `OCP\Settings\ISettings`: `getSection()` → 'deck', `getPriority()` → 50, `getForm()` → a `TemplateResponse('deck', 'settings-feature-hints')` (or render an empty div the Vue entry mounts). Register both in `info.xml`:
```xml
	<settings>
		<admin>OCA\Deck\Settings\FeatureHintsAdmin</admin>
		<admin-section>OCA\Deck\Settings\AdminSection</admin-section>
	</settings>
```
(If `info.xml` already has a `<settings>` block, extend it.)

- [ ] **Step 2: Failing jest for the panel**

```js
// FeatureHintsAdminSettings.spec.js
it('renders a row per registered hint and saves an edit', async () => {
	const put = jest.fn().mockResolvedValue({ data: { ocs: { data: {} } } })
	const wrapper = mountPanel({ axiosPut: put }) // helper injects a mocked axios + FEATURE_HINTS
	expect(wrapper.findAll('[data-cy-hint-row]').length).toBe(FEATURE_HINTS.length)
	await wrapper.find('[data-cy-hint-row] [data-cy-hint-text]').setValue('novo texto')
	await wrapper.find('[data-cy-hint-row] [data-cy-hint-save]').trigger('click')
	expect(put).toHaveBeenCalledWith(expect.stringContaining('/feature-hints/'), expect.objectContaining({ text: 'novo texto' }))
})
```

- [ ] **Step 3: Implement the panel**

`FeatureHintsAdminSettings.vue`: loads `loadState('deck','featureHints')` overrides, renders `FEATURE_HINTS` merged with overrides in a table; each row: `NcTextField` (text), `NcTextField` (link), `NcCheckboxRadioSwitch` (enabled), a **Salvar** button (`axios.put(generateOcsUrl('apps/deck/api/v1.0/feature-hints/'+id), { text, link, enabled })`), and a **Republicar** button (`put({ revision: (current+1) })`). Data-cy attributes per the test.

- [ ] **Step 4: Wire the webpack entry** so `settings-feature-hints` template mounts the Vue (mirror how Deck builds its other entries in `webpack.js`).

- [ ] **Step 5: Run + build + commit**

```bash
./node_modules/.bin/jest src/views/FeatureHintsAdminSettings.spec.js
php -l lib/Settings/AdminSection.php lib/Settings/FeatureHintsAdmin.php
npm run build
git add lib/Settings src/views/FeatureHintsAdminSettings.vue src/featureHintsAdmin.js appinfo/info.xml webpack.js src/views/FeatureHintsAdminSettings.spec.js
git commit -m "feat(hints): admin settings panel (edit copy/link/enabled + republicar)"
```

---

## Task 10: First real anchors + l10n + deploy

**Files:**
- Modify: `apps/deck/src/components/Controls.vue` (assignee-filter icon), `apps/deck/src/components/navigation/AppNavigationFolder.vue` (folder opener — the `...` NcActions or the row), `apps/deck/src/components/board/SharingTabSidebar.vue` (the Sharing tab / share toggle — only if the board-scoped-share branch is merged into this branch; otherwise skip that anchor and note it)
- Modify: `themes/avuz/apps/deck/l10n/pt_BR.json` (repo) — the hint strings + "Entendi"
- Modify: `apps/deck/appinfo/info.xml` (version bump)

**Interfaces:** consumes the directive (Task 7) + registry ids (Task 5).

- [ ] **Step 1: Place anchors** — add `v-feature-hint="'assignee-filter'"` to the filter/funnel button in `Controls.vue`; `v-feature-hint="'folder-create-board'"` to the folder-row three-dots opener in `AppNavigationFolder.vue`. Only add `'board-scoped-share'` to the Sharing tab if that feature exists in this branch.

- [ ] **Step 2: l10n** — add pt_BR for each `defaultText`, the `Saiba mais` CTA, and `Entendi` to `themes/avuz/apps/deck/l10n/pt_BR.json` (repo, committed in avuz-server) and the fork l10n source.

- [ ] **Step 3: Build + full test sweep**

```bash
cd /Users/patrickrezende/work/avuz/deck-fork
npm run build
./node_modules/.bin/jest
find lib -name '*.php' -print0 | xargs -0 -n1 php -l >/dev/null && echo "php lint clean"
```

- [ ] **Step 4: Deploy (PREP, gated prod later)**

```bash
cd <avuz-server worktree for this branch>
scripts/deploy-deck.sh "feat(deck): in-app feature hints (contextual coach-marks)"
```
Then staging verify: open Deck as a fresh user → the assignee-filter hint pops on the funnel icon; dismiss → gone; admin panel edits copy + Republicar re-shows.

---

## Self-review

**Spec coverage:** registry (T5) ✓; directive anchor, no wrapper (T7) ✓; engine one-at-a-time/revision/enabled (T6) ✓; per-user seen via ConfigService (T1) ✓; admin overrides appconfig (T2) + OCS admin-only (T3) + initial state (T4) + admin panel (T9) ✓; markSeen fail-closed (T6) ✓; anchor persistent/opener, first usage (T10) ✓; version bump/deploy (T10) ✓. Non-goals (cross-app, tours, jump-to-tab) excluded.

**Placeholder scan:** T7 flags that the exact NcPopover anchor API is version-dependent and gives a concrete fallback (position a holder over `el.getBoundingClientRect()`) — the behavioral contract is fully specified + tested; the anchor mechanics are a staging-verified detail, not a placeholder. T9 leaves the webpack-entry wiring to "mirror the existing entries" because it must match `webpack.js`'s current shape at implementation. No TODO/empty-test placeholders.

**Type consistency:** `featureHintsSeen` (map id→revision) used identically across T1/T6/T8; `getOverrides`/`setOverride` (T2) consumed by T3/T4; `effectiveHint` shape `{id,text,link,cta,revision,enabled,priority}` consistent T6/T7/T9; hint ids (`assignee-filter`,`folder-create-board`,`board-scoped-share`) consistent T5/T10.
