# Zammad Identity & Portal SSO — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give operators the chat visitor's identity, and give pilot (conecta-2) clients authenticated OIDC portal access — closing the two-way support loop.

**Architecture:** Two independent tracks. **Track A (code)** injects the logged-in NC user's identity into the chat as the first message (avuz_theme PHP initial state + `zammad-chat.js`). **Track B (config)** wires NC-`oidc`-as-IdP → Zammad generic OIDC (Authorization Code + PKCE, public client, no secret); most of it is already live from the spike, so the work is codifying it reproducibly, verifying customer-role provisioning, and documenting.

**Tech Stack:** Nextcloud app (PHP 8, `OCP\*`), vanilla JS (Zammad `chat-no-jquery` widget), Zammad 7.1 (rails settings), `occ` (NC CLI), Portainer API exec.

## Global Constraints

- **Branch/worktree:** `zammad-support` (this worktree). All commits land here.
- **Pilot scope:** **conecta-2 only** (`conectahml2.avuz.app` / stack 46 / `avuz-conecta-2-app-1`). Do NOT touch other tenants or the shared Zammad in ways that affect them.
- **avuz_theme version bump:** **1.1.2 → 1.1.3** in `apps/avuz_theme/appinfo/info.xml` (NC's global `?v=` asset hash — without it, browsers keep the old JS).
- **Chat identity is ADVISORY** (browser-sent, forgeable). Never treat as authenticated; the OIDC portal is the real identity boundary.
- **Chat identity line is PT:** `👤 {name} · {username} · {email}` (dedup rules in Task A2).
- **OIDC = PKCE public client, NO client secret.** Only the non-secret `client_id` is shared between NC and Zammad.
- **Invariants the OIDC safety rests on:** no public self-registration (admin-created users only); agents never provisioned as NC users; NC UID = original email. If any is false, stop — auto-link-by-email is unsafe.
- **Enabling/altering Zammad OIDC requires a railsserver restart** to mount the OmniAuth strategy.
- **Tooling (staging is autonomous):**
  - occ: `./scripts/portainer-exec.sh -u www-data avuz-conecta-2-app-1 php /var/www/html/occ <args>`
  - rails: `./scripts/portainer-exec.sh zammad-support-zammad-railsserver-1 bin/rails r '<ruby>'` (cold boot ~30–60s; run long ones with `run_in_background`)
  - Portainer container restart: `POST /api/endpoints/3/docker/containers/<id>/restart` via the `deploy.env` token.
- **Build/deploy flow (Track A only):** `KEEP_DOCKER=1 ./scripts/build-push.sh latest staging zammad` builds amd64 (~30min) and tries to push to `10.50.100.103:8080` (fails `unauthorized` — expected) → `docker tag … registry.avuz.app/admin/avuzconecta:staging-zammad && docker push …` → redeploy stack 46 via Portainer `PUT /api/stacks/46?endpointId=3` with `PullImage:true` → ~7min boot. Build from a temp branch off `zammad-support`, then restore the golden checkout to `avuz-customization` (the exec scripts don't exist on the feature branch).
- **Commits:** the worktree's `git status` errors on a submodule quirk — use `git add <explicit paths> && git commit`, which works. No Claude Code co-author line (per repo convention).
- **No test harness:** avuz_theme has no PHP/JS unit runner. Established pattern = operational verification (browser console, `curl`, rails). Pure JS logic (`buildIdentityLine`) is verified via a browser-console assertion; PHP/config via `curl`/rails/browser.

**Portainer dependency note:** Track B verification (Tasks B3–B4) and any rails/occ step need the Portainer/VPN link up. Track A code (Tasks A1–A3) is fully offline; only Task A4 (rebuild) needs the registry, and Task A5 (verify) needs a browser. If Portainer is down, do Track A code first.

---

## Track A — Chat identity injection (code, all tenants)

### Task A1: `buildIdentityLine` pure function + console test

**Files:**
- Modify: `apps/avuz_theme/js/zammad-chat.js`

**Interfaces:**
- Produces: `buildIdentityLine(state) -> string`, exposed as `window.__avuzBuildIdentityLine` for verification. `state` fields: `userName, userLogin, userEmail, org` (all strings, may be empty).

- [ ] **Step 1: Write the failing test** (paste in the browser console on any page after the change ships; for now it defines expected behavior):

```js
// EXPECTED behavior of window.__avuzBuildIdentityLine:
const f = window.__avuzBuildIdentityLine;
console.assert(f({userName:'Patrick Rezende', userLogin:'patrick@x.com', userEmail:'patrick@x.com', org:'Avuz Conecta'})
  === '👤 Patrick Rezende · patrick@x.com · Avuz Conecta', 'same login/email → one, + org');
console.assert(f({userName:'Ana', userLogin:'ana@x.com', userEmail:'ana.nova@x.com', org:''})
  === '👤 Ana · ana@x.com · ana.nova@x.com', 'login≠email → both');
console.assert(f({userName:'Bea', userLogin:'', userEmail:'bea@x.com', org:''})
  === '👤 Bea · bea@x.com', 'only email');
console.assert(f({userName:'Caio', userLogin:'', userEmail:'', org:'Org'})
  === '👤 Caio (sem e-mail cadastrado) · Org', 'no email → fallback + org');
console.log('buildIdentityLine tests done');
```

- [ ] **Step 2: Run it to verify it fails**

In the browser console (before implementing): `window.__avuzBuildIdentityLine` is `undefined` → the first line throws `TypeError`.
Expected: FAIL (`f is not a function`).

- [ ] **Step 3: Add the implementation** — insert this function inside the IIFE in `apps/avuz_theme/js/zammad-chat.js`, immediately after the `'use strict';` line (line 2) and before the `const state` line:

```js
	function buildIdentityLine(s) {
		const name = (s.userName || 'Usuário').trim();
		const login = (s.userLogin || '').trim();
		const email = (s.userEmail || '').trim();
		const org = (s.org || '').trim();
		const parts = [name];
		if (login && email) {
			if (login === email) {
				parts.push(email);
			} else {
				parts.push(login);
				parts.push(email);
			}
		} else if (login || email) {
			parts.push(login || email);
		}
		let line = (login || email)
			? '👤 ' + parts.join(' · ')
			: '👤 ' + name + ' (sem e-mail cadastrado)';
		if (org) {
			line += ' · ' + org;
		}
		return line;
	}
	window.__avuzBuildIdentityLine = buildIdentityLine;
```

- [ ] **Step 4: Verify (after this task's build reaches a page, or by pasting the function + tests into any console)**

Paste the function body + the Step 1 asserts into a browser console.
Expected: `buildIdentityLine tests done` with **no** `console.assert` failures.

- [ ] **Step 5: Commit**

```bash
cd .claude/worktrees/zammad-support
git add apps/avuz_theme/js/zammad-chat.js
git commit -m "feat(zammad): buildIdentityLine helper for chat identity (PT, dedup)"
```

---

### Task A2: Provide user identity in the initial state

**Files:**
- Modify: `apps/avuz_theme/lib/Service/ZammadConfig.php`
- Modify: `apps/avuz_theme/lib/AppInfo/Application.php`

**Interfaces:**
- Consumes: `IUser` of the logged-in user (from `IUserSession::getUser()`).
- Produces: initial state `zammad` now also carries `userName, userLogin, userEmail, org` (strings). Consumed by `zammad-chat.js` (Task A3).

- [ ] **Step 1: Change `initialState()` to accept the user** — in `ZammadConfig.php`, add `use OCP\IUser;` under the existing `use OCP\IAppConfig;` (line 7), then replace the `initialState()` method (lines 32–40):

```php
	/**
	 * @return array{url: string, chatId: int, userName: string, userLogin: string, userEmail: string, org: string}
	 */
	public function initialState(?IUser $user = null): array {
		return [
			'url' => $this->host(),
			'chatId' => (int)$this->get('zammad_chat_id'),
			'userName' => $user?->getDisplayName() ?? '',
			'userLogin' => $user?->getUID() ?? '',
			'userEmail' => $user?->getEmailAddress() ?? '',
			'org' => $this->get('zammad_org'),
		];
	}
```

- [ ] **Step 2: Pass the logged-in user in `bootZammad`** — in `Application.php`, replace the chat-enabled block:

```php
		$userSession = $container->get(IUserSession::class);
		$user = $userSession->getUser();
		if ($zammad->isChatEnabled() && $user !== null) {
			$initialState = $container->get(IInitialState::class);
			$initialState->provideInitialState('zammad', $zammad->initialState($user));
			Util::addScript(self::APP_ID, 'zammad-chat');
		}
```

- [ ] **Step 3: Lint-check the PHP** (syntax only; skip if no local `php` — the Docker build fails on syntax errors regardless):

```bash
cd /Users/patrickrezende/work/avuz/avuz-server/.claude/worktrees/zammad-support
command -v php >/dev/null && php -l apps/avuz_theme/lib/Service/ZammadConfig.php && php -l apps/avuz_theme/lib/AppInfo/Application.php || echo "no local php — will be caught at build"
```
Expected: `No syntax errors detected` for both files (or the skip message).

- [ ] **Step 4: Commit**

```bash
cd .claude/worktrees/zammad-support
git add apps/avuz_theme/lib/Service/ZammadConfig.php apps/avuz_theme/lib/AppInfo/Application.php
git commit -m "feat(zammad): add logged-in user identity to chat initial state"
```

> Full verification that the state reaches the browser happens in Task A5 (needs a deployed, logged-in page).

---

### Task A3: Send the identity line as the first chat message

**Files:**
- Modify: `apps/avuz_theme/js/zammad-chat.js`

**Interfaces:**
- Consumes: `buildIdentityLine(state)` (Task A1); `state.userName/userLogin/userEmail/org` (Task A2).
- Produces: on the user's first outgoing message, the widget sends the identity line as message #1, then the user's text.

- [ ] **Step 1: Keep the widget instance + wrap `sendMessage`** — in `zammad-chat.js`, replace the `script.onload` handler (currently lines 58–65) with:

```js
	script.onload = function () {
		const zammadChat = new window.ZammadChat({
			fontSize: '12px',
			chatId: state.chatId,
			cssAutoload: false,
			show: false,
		});

		// Send the identity line as the FIRST message (not on open — that would
		// queue ghost sessions from users who just peek). The widget's input is a
		// contenteditable <div> whose innerHTML the lib sends, so set the element's
		// text content (auto-escaped), NOT `.value` (which the lib never reads).
		// Wrap sendMessage so the first user message is preceded by one identity
		// line, once per session.
		let identitySent = false;
		const originalSend = zammadChat.sendMessage.bind(zammadChat);
		zammadChat.sendMessage = function () {
			if (!identitySent) {
				identitySent = true;
				const input = document.querySelector('.zammad-chat-input');
				if (input) {
					const pending = input.innerHTML;
					input.textContent = buildIdentityLine(state);
					originalSend();
					input.innerHTML = pending;
				}
			}
			return originalSend();
		};
	};
```

- [ ] **Step 2: Verify the wrap doesn't throw at load** (offline sanity): open the file, confirm `zammadChat.sendMessage` is referenced (the widget defines `sendMessage` on its prototype — grep the served lib):

```bash
curl -sS https://supporthml.avuz.app/assets/chat/chat-no-jquery.min.js | grep -c "sendMessage"
```
Expected: `>= 1` (confirms the method name the wrap depends on still exists).

- [ ] **Step 3: Commit**

```bash
cd .claude/worktrees/zammad-support
git add apps/avuz_theme/js/zammad-chat.js
git commit -m "feat(zammad): send identity line as first chat message"
```

> **Fallback (only if Task A5 shows the wrap isn't intercepting):** the widget's Enter handler calls `this.sendMessage()`, so the instance-property override should catch it. If it doesn't, intercept the textarea instead: on first `keydown` Enter (no shift) in `.zammad-chat-input`, send the identity line via `originalSend()` before letting the event proceed. Document whichever ships.

---

### Task A4: Version bump, build, push, redeploy

**Files:**
- Modify: `apps/avuz_theme/appinfo/info.xml` (version)

- [ ] **Step 1: Bump the version** — in `apps/avuz_theme/appinfo/info.xml`, change `<version>1.1.2</version>` to `<version>1.1.3</version>`.

- [ ] **Step 2: Commit the bump**

```bash
cd .claude/worktrees/zammad-support
git add apps/avuz_theme/appinfo/info.xml
git commit -m "chore(avuz_theme): bump 1.1.3 for chat-identity JS cache-bust"
```

- [ ] **Step 3: Build from a temp branch off the feature branch** (the exec/build scripts live on `avuz-customization`, not the feature branch, so build from the golden checkout):

```bash
cd /Users/patrickrezende/work/avuz/avuz-server
git stash push -m wip .superpowers/sdd/progress.md 2>/dev/null || true
git checkout -b build-zammad-a4 zammad-support
KEEP_DOCKER=1 ./scripts/build-push.sh latest staging zammad
```
Expected: build succeeds; the final push to `10.50.100.103:8080` fails with `unauthorized` (expected — the local image is built).

- [ ] **Step 4: Retag + push to the real registry**

```bash
docker tag 10.50.100.103:8080/admin/avuzconecta:staging-zammad registry.avuz.app/admin/avuzconecta:staging-zammad
docker push registry.avuz.app/admin/avuzconecta:staging-zammad
```
Expected: `staging-zammad: digest: sha256:… size: …`.

- [ ] **Step 5: Restore the golden checkout**

```bash
git checkout avuz-customization
git branch -D build-zammad-a4
git stash pop 2>/dev/null || true
```

- [ ] **Step 6: Redeploy stack 46 (pull + recreate)** — run this bash (uses `deploy.env`):

```bash
cd /Users/patrickrezende/work/avuz/avuz-server
set -a; . scripts/deploy.env; set +a
api(){ curl -fsS -k -H "X-API-Key: $PORTAINER_TOKEN" "$@"; }
BASE="${PORTAINER_URL%/}"
STACK=$(api "$BASE/api/stacks/46"); ENVJSON=$(echo "$STACK" | jq -c '.Env')
FILE=$(api "$BASE/api/stacks/46/file" | jq -r '.StackFileContent')
BODY=$(jq -n --arg f "$FILE" --argjson e "$ENVJSON" '{StackFileContent:$f,Env:$e,Prune:false,PullImage:true}')
api -X PUT -H 'Content-Type: application/json' "$BASE/api/stacks/46?endpointId=3" -d "$BODY" | jq -r '{Name,Status}'
```
Expected: `{"Name":"avuz-conecta-2","Status":1}` (the PUT may exceed a 2-min client timeout while pulling — that's fine, it completes server-side).

- [ ] **Step 7: Poll until healthy + serving the new JS**

```bash
cd /Users/patrickrezende/work/avuz/avuz-server
for i in $(seq 1 45); do
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 8 https://conectahml2.avuz.app/login)
  hit=$(curl -sS https://conectahml2.avuz.app/apps/avuz_theme/js/zammad-chat.js 2>/dev/null | grep -c "buildIdentityLine")
  echo "[$i] http=$code identityJS=$hit"; [ "$code" = 200 ] && [ "$hit" -ge 1 ] && { echo READY; break; }
  sleep 12
done
```
Expected: ends `READY` (http=200, `identityJS>=1`). Confirms v1.1.3 JS is served.

---

### Task A5: End-to-end chat identity verification

**Files:** none (verification only).

- [ ] **Step 1: Confirm the version + served markers**

```bash
cd /Users/patrickrezende/work/avuz/avuz-server
./scripts/portainer-exec.sh -u www-data avuz-conecta-2-app-1 php /var/www/html/occ config:app:get avuz_theme installed_version
curl -sS https://conectahml2.avuz.app/apps/avuz_theme/js/zammad-chat.js | grep -c -E "buildIdentityLine|__avuzBuildIdentityLine"
```
Expected: `1.1.3`; grep count `>= 2`.

- [ ] **Step 2: Browser check (logged-in NC session on conecta-2)** — in the console on a logged-in page:

```js
const s = OCP.InitialState.loadState('avuz_theme','zammad');
console.log(s.userName, s.userLogin, s.userEmail, s.org);   // all populated for the logged-in user
console.log(window.__avuzBuildIdentityLine(s));             // the exact line that will be sent
```
Expected: identity fields populated; the composed line looks right.

- [ ] **Step 3: Live chat check (agent online)** — with a Zammad agent available, open the chat, type a first message, send. In the Zammad agent view, confirm the conversation's **first message is the identity line**, followed by the user's text. Confirm opening-and-closing without typing creates **no** session (no ghost).

- [ ] **Step 4: Ticket-link check** — from that chat, create a ticket; confirm the customer auto-matches/creates by the email in the identity line.

- [ ] **Step 5: Record the result** in the plan (check the boxes) — no code change.

---

## Track B — Portal OIDC SSO (config, pilot conecta-2)

> Most of this is already applied live from the spike. These tasks make it reproducible, verify the customer path, and document it. All need the Portainer/VPN link up.

### Task B1: Codify the NC OIDC client (reproducible)

**Files:**
- Modify: `docs/zammad-deployment.md` (add the command; done in Task B5 — here just verify state).

- [ ] **Step 1: Confirm the public client exists**

```bash
cd /Users/patrickrezende/work/avuz/avuz-server
./scripts/portainer-exec.sh -u www-data avuz-conecta-2-app-1 php /var/www/html/occ oidc:list
```
Expected: one client `Zammad Support Pilot`, `type: public`, redirect `https://supporthml.avuz.app/auth/openid_connect/callback`, scopes `openid profile email`.

- [ ] **Step 2: Record the recreate command** (for docs / disaster recovery — do NOT run if the client already exists):

```bash
# occ oidc:create "Zammad Support Pilot" \
#   "https://supporthml.avuz.app/auth/openid_connect/callback" \
#   --type public --allowed_scopes "openid profile email"
```

- [ ] **Step 3: Verify authorize accepts the client**

```bash
CID=$(./scripts/portainer-exec.sh -u www-data avuz-conecta-2-app-1 php /var/www/html/occ oidc:list 2>/dev/null | grep -oE '"client_id": *"[^"]+"' | head -1 | grep -oE '[^"]+$')
curl -sS -o /dev/null -w "authorize http=%{http_code}\n" "https://conectahml2.avuz.app/apps/oidc/authorize?client_id=${CID}&redirect_uri=https%3A%2F%2Fsupporthml.avuz.app%2Fauth%2Fopenid_connect%2Fcallback&response_type=code&scope=openid%20profile%20email&state=verify"
```
Expected: `http=303` (→ NC login; not `invalid_client`).

*(No commit — verification only.)*

---

### Task B2: Codify the Zammad OIDC settings (idempotent) + default role

**Files:** none in repo (Zammad DB config); captured in docs (Task B5).

- [ ] **Step 1: Apply the idempotent OIDC config** (safe to re-run; `client_id` read from NC):

```bash
cd /Users/patrickrezende/work/avuz/avuz-server
CID=$(./scripts/portainer-exec.sh -u www-data avuz-conecta-2-app-1 php /var/www/html/occ oidc:list 2>/dev/null | grep -oE '"client_id": *"[^"]+"' | head -1 | grep -oE '[^"]+$')
./scripts/portainer-exec.sh zammad-support-zammad-railsserver-1 bin/rails r "
Setting.set('auth_openid_connect', true)
Setting.set('auth_openid_connect_credentials', {
  'display_name'=>'Avuz Conecta','identifier'=>'${CID}',
  'issuer'=>'https://conectahml2.avuz.app','uid_field'=>'sub',
  'scope'=>'openid profile email','pkce'=>true,
  'callback_url'=>'https://supporthml.avuz.app/auth/openid_connect/callback'})
Setting.set('auth_third_party_auto_link_at_inital_login', true)
puts 'OIDC configured'"
```
Expected: `OIDC configured`.

- [ ] **Step 2: Set the default signup role to Customer** (belt-and-suspenders; verify the current default first):

```bash
./scripts/portainer-exec.sh zammad-support-zammad-railsserver-1 bin/rails r "
puts 'default signup roles: ' + Role.where(default_at_signup: true).pluck(:name).inspect"
```
Expected: `["Customer"]`. If it lists `Agent`/`Admin`, fix:
```bash
# only if the above is wrong:
./scripts/portainer-exec.sh zammad-support-zammad-railsserver-1 bin/rails r "
Role.where(name: ['Agent','Admin']).update_all(default_at_signup: false)
Role.find_by(name:'Customer').update!(default_at_signup: true)
puts 'roles fixed'"
```

- [ ] **Step 3: Restart railsserver so OmniAuth mounts the strategy**

```bash
cd /Users/patrickrezende/work/avuz/avuz-server
set -a; . scripts/deploy.env; set +a
api(){ curl -fsS -k -H "X-API-Key: $PORTAINER_TOKEN" "$@"; }
BASE="${PORTAINER_URL%/}"
CID=$(api "$BASE/api/endpoints/3/docker/containers/json?all=1" | jq -r '.[]|select(.Names[]|test("zammad-support-zammad-railsserver-1"))|.Id')
api -X POST "$BASE/api/endpoints/3/docker/containers/$CID/restart?t=15" -o /dev/null -w "restart=%{http_code}\n"
```
Expected: `restart=204`.

- [ ] **Step 4: Verify the provider is registered** (POST, not GET — OmniAuth 2):

```bash
for i in $(seq 1 15); do
  m=$(curl -sS -X POST -o /dev/null -w "%{http_code}" --max-time 8 "https://supporthml.avuz.app/auth/openid_connect")
  echo "[$i] POST /auth/openid_connect http=$m"; [ "$m" = 302 ] && { echo REGISTERED; break; }; sleep 8
done
```
Expected: `http=302` (to `/auth/failure?...InvalidAuthenticityToken` — CSRF, which proves the strategy is mounted; a real browser carries the token). `404` = not mounted (restart didn't take).

*(No commit — config lives in the Zammad DB; documented in Task B5.)*

---

### Task B3: Verify customer-role provisioning + own-tickets-only

**Files:** none (verification). **Needs a throwaway non-avuz.cloud NC user on conecta-2.**

- [ ] **Step 1: Create a throwaway customer NC user** (or reuse an existing non-agent one). Use the bulk tool or `occ`:

```bash
cd /Users/patrickrezende/work/avuz/avuz-server
./scripts/portainer-exec.sh -u www-data avuz-conecta-2-app-1 sh -c 'OC_PASS="Teste-$(date +%s)!x" php /var/www/html/occ user:add --password-from-env --display-name "Cliente Teste" teste.suporte@example.com'
```
Expected: user created (`teste.suporte@example.com`). Note the password printed/echoed for the login step.

- [ ] **Step 2: Human login test** — in a browser: log into conecta-2 as `teste.suporte@example.com`, then go to `https://supporthml.avuz.app`, click **Avuz Conecta** → should land in the Zammad **customer** portal (no agent UI).

- [ ] **Step 3: Verify the Zammad user is a Customer, OIDC-linked**

```bash
./scripts/portainer-exec.sh zammad-support-zammad-railsserver-1 bin/rails r "
u = User.find_by(login: 'teste.suporte@example.com') || User.find_by(email: 'teste.suporte@example.com')
puts u.nil? ? 'NO USER' : (u.login + ' roles=' + u.roles.pluck(:name).inspect)
puts 'oidc auths: ' + Authorization.where(provider:'openid_connect').map(&:uid).inspect"
```
Expected: user exists, `roles=["Customer"]`, and an `openid_connect` authorization present.

- [ ] **Step 4: Verify dedupe** — create a ticket in Zammad with customer `teste.suporte@example.com` (simulating a chat→ticket), then confirm the SSO login above reused that same user (one user, not two):

```bash
./scripts/portainer-exec.sh zammad-support-zammad-railsserver-1 bin/rails r "
puts 'count for email: ' + User.where(email:'teste.suporte@example.com').count.to_s"
```
Expected: `count for email: 1`.

- [ ] **Step 5: Record results** (check boxes). If role ≠ Customer, revisit Task B2 Step 2.

---

### Task B4: Confirm no regressions on the shared surfaces

**Files:** none (verification).

- [ ] **Step 1: Outbound email still works** (from the earlier setup):

```bash
./scripts/portainer-exec.sh zammad-support-zammad-railsserver-1 bin/rails r "
ch = Channel.where(area:'Email::Notification').find_by(active:true)
puts 'active outbound adapter: ' + (ch.options.dig('outbound','adapter') rescue 'none')"
```
Expected: `smtp`.

- [ ] **Step 2: Chat still styled + gated** (from the earlier fixes):

```bash
curl -sS "https://conectahml2.avuz.app/login" | grep -c zammad-chat   # expect 0 (gated)
curl -sS -D - -o /dev/null "https://conectahml2.avuz.app/login" | grep -io "supporthml.avuz.app" | head -1  # CSP present
```
Expected: `0` for the first (launcher gated off login); the host string present in CSP.

---

### Task B5: Documentation

**Files:**
- Modify: `docs/zammad-deployment.md`

- [ ] **Step 1: Add an "Identity & Portal SSO" section** to `docs/zammad-deployment.md` covering:
  - **Chat identity:** what the operator sees (the `👤 name · username · email` first message), that it's **advisory** (browser-sent), gated to logged-in users, shipped in the image (`avuz_theme` ≥ 1.1.3).
  - **Portal OIDC (pilot conecta-2):** the `occ oidc:create … --type public` command (Task B1 Step 2), the idempotent Zammad rails config (Task B2 Step 1), the **default Customer role** setting, and the **railsserver-restart** requirement.
  - **PKCE / no secret:** only the non-secret `client_id` is shared; nothing to rotate.
  - **Invariants** the safety depends on (no self-registration; agents never NC users; UID=email).
  - **Multi-tenant caveat:** only conecta-2 is wired; a 2nd tenant needs the SSO broker — do NOT replicate the single-IdP config. Link `docs/superpowers/specs/2026-08-19-zammad-identity-portal-sso-design.md`.

- [ ] **Step 2: Commit**

```bash
cd .claude/worktrees/zammad-support
git add docs/zammad-deployment.md
git commit -m "docs(zammad): identity + portal OIDC SSO setup, invariants, multi-tenant caveat"
```

---

## Self-review notes

- **Spec coverage:** Track A (identity injection) → A1–A5; Track B (OIDC portal) → B1–B4; docs → B5; invariants → Global Constraints + B5; deferred items (orgs, broker, inbound, API token) → not built, noted. Covered.
- **Placeholders:** none — all code and commands are concrete. The Task A3 "fallback" is a labeled contingency with a described mechanism, not a TODO.
- **Type consistency:** `initialState(?IUser)` fields (`userName/userLogin/userEmail/org`) match `buildIdentityLine`'s `state` fields and the browser checks. `buildIdentityLine` name consistent across A1/A3/A5.
