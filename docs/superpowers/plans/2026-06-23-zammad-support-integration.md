# Zammad Support Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each Avuz Conecta tenant in-Nextcloud support — a floating live chat and a "Suporte" portal entry — backed by one self-hosted Zammad that also handles tickets and per-org billable time.

**Architecture:** One shared Zammad stack (its own Docker stack, own domain) serves all tenants as Zammad Organizations. Each NC instance is tagged with its org via env. The `avuz_theme` app injects the native Zammad chat widget (low-trust, conversation-only) and a "Suporte" nav entry to the authenticated Zammad portal (the real org-scoped security boundary). Config flows env → `occ config:app:set` (entrypoint) → `IAppConfig` (PHP) → `IInitialState` → JS, because PHP-FPM strips Docker env at request time.

**Tech Stack:** Zammad (Ruby/Rails + PostgreSQL + Elasticsearch + Redis), Docker/Portainer, Nginx Proxy Manager, Nextcloud app (PHP, `IBootstrap`/`IAppConfig`/`IInitialState`/`INavigationManager`), vanilla JS, bash entrypoint.

## Global Constraints

- One Zammad stack serves all tenants; tenants = Zammad **Organizations**. (spec: Architecture)
- Chat widget = low-trust, conversation-only; agents verify identity. Portal = authenticated, org-scoped = the real boundary. No forgeable path from chat to another org's tickets. (spec: Security model)
- One NC image, env-gated profiles: `ZAMMAD_CHAT_ENABLED=true` (Full) / `false` (Slim). Menu icon present in both. (spec: Delivery profiles)
- PHP must **not** `getenv()` at request time (PHP-FPM `clear_env=yes`). Entrypoint writes `occ config:app:set avuz_theme zammad_*`; PHP reads via `IAppConfig`. (entrypoint.sh:118 pattern)
- Do not automate the `external` app (no occ command, DB-seeded). Use an `avuz_theme` nav entry instead. (decision)
- Avuz palette primary `#2bb5e3`. (spec/CLAUDE.md)
- SSO is Phase B, out of scope. (spec)
- Naming: files kebab-case, PHP classes PascalCase, constants SNAKE_CAPS, JS camelCase. Named exports. Early return. (user CLAUDE.md)

---

## Phase 0 — Zammad backend (infra prerequisite)

### Task 0.1: Deploy the Zammad stack on staging

**Files:**
- Create: `portainer-zammad-stack.yml`

**Interfaces:**
- Produces: a reachable Zammad at `https://support.avuz.com.br` (the `ZAMMAD_URL` later tasks consume).

- [ ] **Step 1: Write the Portainer stack file**

Create `portainer-zammad-stack.yml` using the upstream `zammad/zammad` compose as the base (Zammad ships an official `docker-compose`). Pin the image tag, set distinct volume names so it coexists with other stacks (same convention as `portainer-stack-s3.yml`).

```yaml
# portainer-zammad-stack.yml
# Source: https://github.com/zammad/zammad-docker-compose (pinned)
# Services: zammad-init, zammad-railsserver, zammad-websocket, zammad-scheduler,
#           zammad-nginx, postgresql, elasticsearch, redis, memcached
# Key points:
#   - IMAGE_REPO/VERSION pinned (no :latest)
#   - volumes prefixed zammad_ to avoid collision on the shared host
#   - elasticsearch: ES_JAVA_OPTS=-Xms1g -Xmx1g (host needs ~2GB free)
#   - zammad-nginx published on an internal port; TLS terminated at Nginx Proxy Manager
# (Copy the pinned upstream compose here and apply the three edits above.)
```

- [ ] **Step 2: Deploy via Portainer and add the NPM proxy host**

Deploy the stack in Portainer. In Nginx Proxy Manager add a proxy host `support.avuz.com.br` → `zammad-nginx:8080`, with a Let's Encrypt cert. Mirror the websocket settings NPM needs for Zammad chat (`Upgrade`/`Connection` headers; "Websockets Support" toggle ON).

- [ ] **Step 3: Verify Zammad is up**

Run: `curl -sSI https://support.avuz.com.br/ | head -1`
Expected: `HTTP/2 200` (or a redirect to `/#login`). Open the URL, complete the first-run admin wizard, confirm login.

- [ ] **Step 4: Commit**

```bash
git add portainer-zammad-stack.yml
git commit -m "feat: Zammad backend Portainer stack for support integration"
```

### Task 0.2: Configure Zammad — org, chat widget, time accounting

**Files:** none (Zammad admin UI / config captured in the runbook doc below)

**Interfaces:**
- Produces: a numeric **chat widget id** (the `ZAMMAD_CHAT_ID` later tasks consume) and one test Organization.

- [ ] **Step 1: Create a test Organization**

Admin → Manage → Organizations → create `Consulttagro` (the first real tenant doubles as the test org).

- [ ] **Step 2: Enable the live chat channel and create a widget**

Admin → Channels → Chat → enable, create a chat topic, copy the generated widget snippet. Note its `chatId` (integer) — this is `ZAMMAD_CHAT_ID`.

- [ ] **Step 3: Enable time accounting**

Admin → System → Time Accounting → enable. Confirm the per-organization CSV export screen exists (Reporting/Time Accounting). This replaces the Milldesk billing workflow.

- [ ] **Step 4: Record values in a runbook**

Create `docs/zammad-deployment.md` capturing: stack file, NPM host, `ZAMMAD_URL`, where to find `ZAMMAD_CHAT_ID`, how to add a new tenant Organization, and the per-org time-export path. (Mirrors the style of `docs/s3-deployment.md`.)

- [ ] **Step 5: Commit**

```bash
git add docs/zammad-deployment.md
git commit -m "docs: Zammad deployment + per-tenant onboarding runbook"
```

---

## Phase 1 — NC integration (this repo's code)

### Task 1.1: Read Zammad config in `avuz_theme` and expose it to JS

**Files:**
- Modify: `apps/avuz_theme/lib/AppInfo/Application.php`
- Create: `apps/avuz_theme/lib/Service/ZammadConfig.php`

**Interfaces:**
- Consumes: NC app config keys `avuz_theme.zammad_url`, `avuz_theme.zammad_chat_id`, `avuz_theme.zammad_org`, `avuz_theme.zammad_portal_url`, `avuz_theme.zammad_chat_enabled` (written by entrypoint in Task 1.4).
- Produces: `OCA\AvuzTheme\Service\ZammadConfig` with:
  - `isChatEnabled(): bool` — true only if `zammad_chat_enabled === '1'` AND `zammad_url` AND `zammad_chat_id` are non-empty.
  - `portalUrl(): string` — `zammad_portal_url`, or `''` if unset.
  - `initialState(): array{url: string, chatId: int, org: string, userName: string, userEmail: string}` — values for the JS widget, with the logged-in user's display name/email filled from `IUserSession` (prefill convenience, not a security control).

- [ ] **Step 1: Write `ZammadConfig`**

```php
<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Service;

use OCP\IAppConfig;
use OCP\IUserSession;
use OCP\IUser;

class ZammadConfig {
	private const APP_ID = 'avuz_theme';

	public function __construct(
		private IAppConfig $appConfig,
		private IUserSession $userSession,
	) {
	}

	public function isChatEnabled(): bool {
		if ($this->get('zammad_chat_enabled') !== '1') {
			return false;
		}
		return $this->get('zammad_url') !== '' && $this->get('zammad_chat_id') !== '';
	}

	public function portalUrl(): string {
		return $this->get('zammad_portal_url');
	}

	/**
	 * @return array{url: string, chatId: int, org: string, userName: string, userEmail: string}
	 */
	public function initialState(): array {
		$user = $this->userSession->getUser();
		return [
			'url' => $this->get('zammad_url'),
			'chatId' => (int)$this->get('zammad_chat_id'),
			'org' => $this->get('zammad_org'),
			'userName' => $user instanceof IUser ? $user->getDisplayName() : '',
			'userEmail' => $user instanceof IUser ? (string)$user->getEMailAddress() : '',
		];
	}

	private function get(string $key): string {
		return $this->appConfig->getValueString(self::APP_ID, $key, '');
	}
}
```

- [ ] **Step 2: Wire injection in `Application::boot()`**

Add the chat script + initial state when chat is enabled. Insert after the existing `center-header` script injection (Application.php:57).

```php
// in boot(), after Util::addScript(self::APP_ID, 'center-header');
/** @var \OCA\AvuzTheme\Service\ZammadConfig $zammad */
$zammad = $context->getAppContainer()->get(\OCA\AvuzTheme\Service\ZammadConfig::class);
if ($zammad->isChatEnabled()) {
	/** @var \OCP\AppFramework\Services\IInitialState $initialState */
	$initialState = $context->getAppContainer()->get(\OCP\AppFramework\Services\IInitialState::class);
	$initialState->provideInitialState('zammad', $zammad->initialState());
	Util::addScript(self::APP_ID, 'zammad-chat');
}
```

- [ ] **Step 3: Build the image and verify the script loads when enabled**

Run:
```bash
./scripts/build-base.sh latest local && ./scripts/build-push.sh latest local
# run the container with chat envs set (Task 1.4 adds env handling; for now set app config by hand):
docker exec <container> php occ config:app:set avuz_theme zammad_chat_enabled --value=1
docker exec <container> php occ config:app:set avuz_theme zammad_url --value=https://support.avuz.com.br
docker exec <container> php occ config:app:set avuz_theme zammad_chat_id --value=1
```
Then load any logged-in NC page, View Source.
Expected: `zammad-chat.js` appears in the page's script tags, and an `initial-state` element `avuz_theme-zammad` is present.

- [ ] **Step 4: Verify it is absent when disabled**

Run: `docker exec <container> php occ config:app:set avuz_theme zammad_chat_enabled --value=0`
Reload the page, View Source.
Expected: no `zammad-chat.js`, no `avuz_theme-zammad` initial state.

- [ ] **Step 5: Commit**

```bash
git add apps/avuz_theme/lib/Service/ZammadConfig.php apps/avuz_theme/lib/AppInfo/Application.php
git commit -m "feat: avuz_theme reads Zammad config and injects chat when enabled"
```

### Task 1.2: Floating Zammad chat widget (JS)

**Files:**
- Create: `apps/avuz_theme/js/zammad-chat.js`

**Interfaces:**
- Consumes: initial state `avuz_theme-zammad` = `{url, chatId, org, userName, userEmail}` from Task 1.1.
- Produces: a floating chat button on every page, styled to `#2bb5e3`, that opens the native Zammad chat.

- [ ] **Step 1: Write `zammad-chat.js`**

Loads Zammad's no-jQuery chat build from the Zammad host (avoids depending on a global jQuery in NC), then initializes it. The exact init options come from the snippet Zammad generated in Task 0.2 Step 2 — keep `chatId`, `host`, `background` in sync with it.

```js
(function () {
	'use strict';

	const state = OCP.InitialState.loadState('avuz_theme', 'zammad');
	if (!state || !state.url || !state.chatId) {
		return; // guarded: misconfig must not throw
	}

	const host = state.url.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';

	const script = document.createElement('script');
	script.src = state.url.replace(/\/$/, '') + '/assets/chat/chat-no-jquery.min.js';
	script.onload = function () {
		new window.ZammadChat({
			background: '#2bb5e3',
			fontSize: '12px',
			chatId: state.chatId,
			host: host,
			title: 'Suporte Avuz',
			show: true,
			prefilledName: state.userName,
			prefilledEmail: state.userEmail,
		});
	};
	document.body.appendChild(script);
})();
```

- [ ] **Step 2: Rebuild and verify the widget renders**

Run: `./scripts/build-push.sh latest local` then, with chat enabled (Task 1.1 Step 3 config), open a logged-in NC page.
Expected: the Zammad chat launcher appears bottom-right in `#2bb5e3`; clicking opens the chat; the name/email are prefilled.

- [ ] **Step 3: Verify the safe-fail path**

Run: set `zammad_url` to empty (`php occ config:app:set avuz_theme zammad_url --value=""`) but leave the script injected (`zammad_chat_enabled=1`, `zammad_chat_id=1`). Reload.
Expected: no chat widget, no console error (the `loadState` guard returns early). Note: with the Task 1.1 `isChatEnabled()` gate this combination won't occur in production, but the JS guard must still hold.

- [ ] **Step 4: Commit**

```bash
git add apps/avuz_theme/js/zammad-chat.js
git commit -m "feat: floating Zammad chat widget injected via avuz_theme"
```

### Task 1.3: "Suporte" portal nav entry

**Files:**
- Modify: `apps/avuz_theme/lib/AppInfo/Application.php`
- Create: `apps/avuz_theme/img/support.svg`

**Interfaces:**
- Consumes: `ZammadConfig::portalUrl()` from Task 1.1.
- Produces: a top-bar app-menu entry "Suporte" → Zammad portal, present in both profiles whenever `zammad_portal_url` is set.

- [ ] **Step 1: Add a Lucide "life-buoy" icon**

Create `apps/avuz_theme/img/support.svg` (Lucide `life-buoy`, stroke-based, `currentColor` — matches the existing icon-override style in `themes/avuz/apps/*/img`).

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="4.93" y1="4.93" x2="9.17" y2="9.17"/><line x1="14.83" y1="14.83" x2="19.07" y2="19.07"/><line x1="14.83" y1="9.17" x2="19.07" y2="4.93"/><line x1="9.17" y1="14.83" x2="4.93" y2="19.07"/></svg>
```

- [ ] **Step 2: Register the nav entry in `boot()`**

Add after the chat-injection block from Task 1.1 Step 2.

```php
/** @var \OCA\AvuzTheme\Service\ZammadConfig $zammad */ // already fetched above; reuse it
$portalUrl = $zammad->portalUrl();
if ($portalUrl !== '') {
	/** @var \OCP\INavigationManager $nav */
	$nav = $context->getAppContainer()->get(\OCP\INavigationManager::class);
	/** @var \OCP\IURLGenerator $urlGenerator */
	$urlGenerator = $context->getAppContainer()->get(\OCP\IURLGenerator::class);
	$nav->add(static function () use ($portalUrl, $urlGenerator): array {
		return [
			'id' => 'avuz_support',
			'order' => 80,
			'href' => $portalUrl,
			'icon' => $urlGenerator->imagePath('avuz_theme', 'support.svg'),
			'name' => 'Suporte',
		];
	});
}
```

- [ ] **Step 3: Rebuild and verify the entry appears (both profiles)**

Run:
```bash
./scripts/build-push.sh latest local
docker exec <container> php occ config:app:set avuz_theme zammad_portal_url --value=https://support.avuz.com.br
```
Open NC. Expected: "Suporte" with the life-buoy icon in the app menu; clicking opens the Zammad portal. Set `zammad_chat_enabled=0` (Slim) and confirm "Suporte" still shows while the floating widget does not.

- [ ] **Step 4: Verify absence when portal URL unset**

Run: `php occ config:app:set avuz_theme zammad_portal_url --value=""`; reload.
Expected: no "Suporte" entry, no error.

- [ ] **Step 5: Commit**

```bash
git add apps/avuz_theme/lib/AppInfo/Application.php apps/avuz_theme/img/support.svg
git commit -m "feat: Suporte nav entry to Zammad portal (both profiles)"
```

### Task 1.4: Entrypoint env wiring

**Files:**
- Modify: `docker/entrypoint.sh` (the `run_avuz_configuration` occ block, near lines 226-252)

**Interfaces:**
- Consumes: env `ZAMMAD_URL`, `ZAMMAD_PORTAL_URL`, `ZAMMAD_ORG`, `ZAMMAD_CHAT_ID`, `ZAMMAD_CHAT_ENABLED`.
- Produces: the `avuz_theme.zammad_*` app config keys Task 1.1 reads.

- [ ] **Step 1: Add the Zammad config block**

Insert in `run_avuz_configuration`, after the theming block. Defaults keep both surfaces off unless env is provided (safe for tenants not yet onboarded).

```bash
    # ── Zammad support integration ──
    # PHP-FPM strips Docker env at request time, so persist into app config here.
    php occ config:app:set avuz_theme zammad_url          --value="${ZAMMAD_URL:-}"
    php occ config:app:set avuz_theme zammad_portal_url   --value="${ZAMMAD_PORTAL_URL:-${ZAMMAD_URL:-}}"
    php occ config:app:set avuz_theme zammad_org          --value="${ZAMMAD_ORG:-}"
    php occ config:app:set avuz_theme zammad_chat_id      --value="${ZAMMAD_CHAT_ID:-}"
    php occ config:app:set avuz_theme zammad_chat_enabled --value="${ZAMMAD_CHAT_ENABLED:-false}"
```

Note: `ZAMMAD_CHAT_ENABLED` is the string `true`/`false` in env, but `ZammadConfig::isChatEnabled()` checks for `'1'`. Normalize in the next step.

- [ ] **Step 2: Normalize the boolean**

Replace the `zammad_chat_enabled` line with a normalization so `true`/`1`/`yes` → `1`, else `0`:

```bash
    case "${ZAMMAD_CHAT_ENABLED:-false}" in
        true|1|yes|TRUE|True) _zammad_chat='1' ;;
        *) _zammad_chat='0' ;;
    esac
    php occ config:app:set avuz_theme zammad_chat_enabled --value="$_zammad_chat"
```

- [ ] **Step 3: Rebuild and verify end-to-end with env**

Run: rebuild, then start the container with:
```bash
-e ZAMMAD_URL=https://support.avuz.com.br \
-e ZAMMAD_ORG=consulttagro \
-e ZAMMAD_CHAT_ID=1 \
-e ZAMMAD_CHAT_ENABLED=true
```
Expected: after boot, `php occ config:app:get avuz_theme zammad_chat_enabled` → `1`; a logged-in page shows the floating widget **and** the "Suporte" entry, no manual `occ` needed.

- [ ] **Step 4: Verify Slim profile via env**

Run: restart with `ZAMMAD_CHAT_ENABLED=false` (keep `ZAMMAD_URL`/`ZAMMAD_PORTAL_URL`).
Expected: "Suporte" entry present, floating widget absent.

- [ ] **Step 5: Commit**

```bash
git add docker/entrypoint.sh
git commit -m "feat: entrypoint wires ZAMMAD_* env into avuz_theme app config"
```

### Task 1.5: Document the integration

**Files:**
- Modify: `CLAUDE.md` (add a "Zammad support integration" subsection under Key Customizations)
- Modify: `docs/zammad-deployment.md` (add the NC-side env table)

**Interfaces:** none.

- [ ] **Step 1: Document envs + profiles**

Add to `docs/zammad-deployment.md`: the env table (`ZAMMAD_URL`, `ZAMMAD_PORTAL_URL`, `ZAMMAD_ORG`, `ZAMMAD_CHAT_ID`, `ZAMMAD_CHAT_ENABLED`), the Full vs Slim profile rows, and the trust-split security note (chat = conversation-only/agent-verified; portal = authenticated boundary).

- [ ] **Step 2: Cross-link in CLAUDE.md**

Add a short "Zammad support integration" subsection pointing to `docs/zammad-deployment.md` and the design spec.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/zammad-deployment.md
git commit -m "docs: Zammad NC-side env reference and profiles"
```

---

## Self-Review

**Spec coverage:**
- One Zammad, orgs → Task 0.1, 0.2. ✅
- Chat widget (native, theme-injected, `#2bb5e3`, conversation-only) → Task 1.2. ✅
- Suporte portal entry (both profiles) → Task 1.3. ✅
- Time accounting / per-org billing → Task 0.2 Step 3. ✅
- One image, env-gated profiles → Task 1.4. ✅
- PHP reads app config not env → Task 1.1 + 1.4. ✅
- Security trust-split documented → Task 1.5. ✅
- SSO Phase B excluded. ✅

**Open verification at execution time:**
- Confirm the exact `ZammadChat` no-jQuery init keys (`prefilledName`/`prefilledEmail`, `host`) against the snippet Zammad generates in Task 0.2 — adjust Task 1.2 Step 1 to match the running Zammad version.
- Confirm `INavigationManager->add()` renders an absolute external `href` in the app menu on the deployed NC version; if the version restricts external hrefs, fall back to the `external` app (manual one-time admin config) for the Suporte entry.
