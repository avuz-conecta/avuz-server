# Talk 23.0.14 + Presenter Keeps the Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the local user shares their screen in a Talk call, the participant strip stays open; viewers keep today's layout; stopping the share restores the pre-share layout.

**Architecture:** A third source patch on Talk v23.0.6 (next to `webrtc-stagger.patch` and `no-waiting-sound.patch`) changes the Pinia call view store's presentation start/stop and the one `CallView.vue` call site for the local share. The full rebuilt bundle replaces `docker/overlays/spreed/js` + `css`, as today.

**Tech Stack:** Talk (spreed) v23.0.6 source, Vue 2 + Pinia, TypeScript store, vitest, rspack build (node ^24, npm ^11).

**Spec:** `docs/superpowers/specs/2026-11-19-talk-presenter-keeps-strip-design.md` and `docs/superpowers/specs/2026-11-19-talk-23-0-14-alignment-design.md`

## Global Constraints

- Base: spreed tag `v23.0.14` for both the server code (release tarball, sha256 `b21f29678f086eb6a3eb4e6dd36f176fe2c397e2cf2ce0bdcae415a0bce8a5c7`) and the bundle source, with `webrtc-stagger.patch` and `no-waiting-sound.patch` applied first (both apply cleanly on v23.0.14).
- Viewers of a remote share: unchanged behavior (`isGrid: false`, `isStripeOpen: false`).
- Every existing test in `src/stores/__tests__/callView.spec.js` keeps passing unchanged.
- Overlay ships the full bundle: all `js/*.js` except `vision_wasm*` and no `.map`; `css/*.css`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A remote share is already running when I start mine (`presentationStarted` already true): my strip must still open. Test in Task 1.
2. I close the strip during my share and reopen it with ^ (the chevron calls `setCallViewMode({ isStripeOpen, clearLast: false })`, which overwrites `lastIsStripeOpen`): on stop, the pre-share layout must still come back. Test in Task 1.
3. I was in grid view before sharing: on stop, grid comes back. Test in Task 1.
4. I switch to grid during my share: on stop, grid stays (not overridden). Test in Task 1.
5. A viewer of my share sees the strip closed, as today. Checked in Task 3 (browser).

---

### Task 0: Server code to 23.0.14

**Files:**
- Replace: `apps/spreed/` (gitignored) with the extracted 23.0.14 tarball
- Modify: `docker/overlays/spreed/lib/Capabilities.php` (23.0.14 file + `'recording-chunked-v1',` in the same features list as before)
- Modify: `docker/overlays/spreed/lib/Controller/RecordingController.php` (our 23.0.1 diff re-applied on the 23.0.14 file; keep the `AVUZ-CHUNKED-UPLOAD-V2` line)
- Modify: `Dockerfile` (guard `ARG AVUZ_SPREED_VERSION=23.0.14`, fail if `apps/spreed/appinfo/info.xml` differs, before the overlay copy)
- Modify: `scripts/verify-mediapipe.sh` (23.0.14 hashes)

- [ ] **Step 1:** `diff -u` our overlay files against their v23.0.1 originals, apply that diff to the v23.0.14 originals (`patch`), resolve conflicts by hand; no route or method name may collide with upstream's 23.0.7+ recording endpoints.
- [ ] **Step 2:** `php -l` both files; `php docker/overlays/spreed/tests/chunked-upload-test.php` passes; `php` a small script that `require`s nothing but greps that every `use` in the overlay files resolves to a class present in the 23.0.14 tree.
- [ ] **Step 3:** swap `apps/spreed` for the tarball (keep a copy of the old dir in the scratchpad), run `sh scripts/verify-mediapipe.sh apps/spreed/js` after updating the hashes: PASS.
- [ ] **Step 4:** commit `fix(spreed): server code to Talk 23.0.14, patches rebased`.

### Task 1: Store + CallView source patch

**Files:**
- Work tree: `<scratch>/spreed-src` (clone of `nextcloud/spreed` at `v23.0.14`)
- Modify: `src/stores/callView.ts` (state, `startPresentation`, `stopPresentation`)
- Modify: `src/components/CallView/CallView.vue` (watcher `showLocalScreen`)
- Test: `src/stores/__tests__/callView.spec.js`
- Create: `docker/overlays/spreed/presenter-keeps-strip.patch` (in avuz-server)

**Interfaces:**
- Produces: `startPresentation(token: string, { isLocal = false }: { isLocal?: boolean } = {}): void`
- Produces state: `modeBeforePresentation: CallViewMode | null` and `presentationStartMode: CallViewMode | null`, with `type CallViewMode = { isGrid: boolean, isStripeOpen: boolean }`. `presentationStartMode` is the bundle sentinel (Task 2): a Pinia state key survives minification.
- `stopPresentation(token: string): void` signature unchanged.

- [ ] **Step 1: Prepare the source tree**

```bash
cd <scratch>/spreed-src && git switch -c avuz-presenter-strip v23.0.14
git am <avuz-server>/docker/overlays/spreed/webrtc-stagger.patch <avuz-server>/docker/overlays/spreed/no-waiting-sound.patch
npm ci
npx vitest run src/stores/__tests__/callView.spec.js
```
Expected: all existing callView tests PASS.

- [ ] **Step 2: Write the failing tests** in a new `describe('local presentation (Avuz)')` inside `describe('call view mode and presentation')`:

```js
it('opens the strip when the local user starts presenting', () => {
	callViewStore.setCallViewMode({ token: TOKEN, isGrid: true, isStripeOpen: true })
	callViewStore.startPresentation(TOKEN, { isLocal: true })
	expect(callViewStore.isGrid).toBe(false)
	expect(callViewStore.isStripeOpen).toBe(true)
})

it('keeps the strip closed for a remote presentation', () => {
	callViewStore.setCallViewMode({ token: TOKEN, isGrid: true, isStripeOpen: true })
	callViewStore.startPresentation(TOKEN)
	expect(callViewStore.isStripeOpen).toBe(false)
})

it.each([
	[true, true],
	[false, false],
	[false, true],
])('restores grid=%s strip=%s after an untouched local presentation', (isGrid, isStripeOpen) => {
	callViewStore.setCallViewMode({ token: TOKEN, isGrid, isStripeOpen })
	callViewStore.startPresentation(TOKEN, { isLocal: true })
	callViewStore.stopPresentation(TOKEN)
	expect(callViewStore.isGrid).toBe(isGrid)
	expect(callViewStore.isStripeOpen).toBe(isStripeOpen)
})

it('opens the strip when the local share starts during a remote presentation', () => {
	callViewStore.setCallViewMode({ token: TOKEN, isGrid: true, isStripeOpen: true })
	callViewStore.startPresentation(TOKEN)
	callViewStore.startPresentation(TOKEN, { isLocal: true })
	expect(callViewStore.isStripeOpen).toBe(true)
	callViewStore.stopPresentation(TOKEN)
	expect(callViewStore.isGrid).toBe(true)
	expect(callViewStore.isStripeOpen).toBe(true)
})

it('restores the pre-share layout after the strip is closed and reopened during the share', () => {
	callViewStore.setCallViewMode({ token: TOKEN, isGrid: true, isStripeOpen: true })
	callViewStore.startPresentation(TOKEN, { isLocal: true })
	callViewStore.setCallViewMode({ token: TOKEN, isStripeOpen: false, clearLast: false })
	callViewStore.setCallViewMode({ token: TOKEN, isStripeOpen: true, clearLast: false })
	callViewStore.stopPresentation(TOKEN)
	expect(callViewStore.isGrid).toBe(true)
	expect(callViewStore.isStripeOpen).toBe(true)
})

it('keeps a strip the presenter closed after the share ends', () => {
	callViewStore.setCallViewMode({ token: TOKEN, isGrid: true, isStripeOpen: true })
	callViewStore.startPresentation(TOKEN, { isLocal: true })
	callViewStore.setCallViewMode({ token: TOKEN, isStripeOpen: false, clearLast: false })
	callViewStore.stopPresentation(TOKEN)
	expect(callViewStore.isGrid).toBe(false)
	expect(callViewStore.isStripeOpen).toBe(false)
})

it('keeps grid view the presenter picked during the share', () => {
	callViewStore.setCallViewMode({ token: TOKEN, isGrid: false, isStripeOpen: false })
	callViewStore.startPresentation(TOKEN, { isLocal: true })
	callViewStore.setCallViewMode({ token: TOKEN, isGrid: true })
	callViewStore.stopPresentation(TOKEN)
	expect(callViewStore.isGrid).toBe(true)
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/stores/__tests__/callView.spec.js`
Expected: the new local-presentation tests FAIL (strip stays closed); existing tests PASS.

- [ ] **Step 4: Implement in `src/stores/callView.ts`**

- `startPresentation(token, { isLocal = false } = {})`:
  - already started and not local → return (as today);
  - already started and local → set `isStripeOpen = true` directly (no `setCallViewMode`, so the remembered state is untouched), `presentationStartMode = { isGrid: this.isGrid, isStripeOpen: true }`;
  - otherwise → `modeBeforePresentation = { isGrid, isStripeOpen }` (current), then today's `setCallViewMode({ token, isGrid: false, isStripeOpen: isLocal, clearLast: false })`, `presentationStartMode = { isGrid: false, isStripeOpen: isLocal }`.
- `stopPresentation`: restore `modeBeforePresentation` (via `setCallViewMode(..., clearLast: false)`) only when the current `isGrid` / `isStripeOpen` equal `presentationStartMode`; then null both fields.
- Update the JSDoc of both actions; mark the changed block with `// AVUZ-PRESENTER-STRIP (Deck #503)`.

- [ ] **Step 5: Wire the local share** in `CallView.vue`, watcher `showLocalScreen`: `this.callViewStore.startPresentation(this.token, { isLocal: true })`. The `callParticipantModelsWithScreen` watcher (remote shares) stays as is.

- [ ] **Step 6: Run tests and lint**

Run: `npx vitest run src/stores/__tests__/callView.spec.js && npx eslint src/stores/callView.ts src/components/CallView/CallView.vue src/stores/__tests__/callView.spec.js`
Expected: all tests PASS, eslint clean.

- [ ] **Step 7: Commit in the spreed tree and export the patch**

```bash
git commit -am "feat(call): presenter keeps the participant strip open (Avuz Deck #503)" # body + Co-Authored-By line
git format-patch -1 --stdout > <avuz-server>/docker/overlays/spreed/presenter-keeps-strip.patch
```

### Task 2: Rebuild the overlay bundle

**Files:**
- Modify: `docker/overlays/spreed/js/*.js`, `docker/overlays/spreed/css/*.css` (full replacement per README)
- Modify: `docker/overlays/spreed/js/README.md` (title, third patch, rebuild `git am` line, verify grep)
- Add: `docker/overlays/spreed/presenter-keeps-strip.patch` (from Task 1)

**Interfaces:**
- Consumes: the spreed tree from Task 1 (3 patches applied), sentinel key `presentationStartMode`.

- [ ] **Step 1: Build** — `npm run build` in the spreed tree. Expected: exit 0.
- [ ] **Step 2: Replace the overlay** — delete the old `docker/overlays/spreed/js/*.js` (keep `README.md`), copy back per README (skip `vision_wasm*`, no `.map`), copy `css/*.css`. Stale hashed chunks must not remain.
- [ ] **Step 3: Verify the bundle**

```bash
grep -c 'Playing waiting sound' docker/overlays/spreed/js/talk-main.js     # 0
grep -o 'Hh=[0-9]*' docker/overlays/spreed/js/talk-main.js                 # stagger constant present (name may change; find REQUEST_OFFER_STAGGER_MS value 200)
grep -l 'presentationStartMode' docker/overlays/spreed/js/*.js             # at least one file
ls docker/overlays/spreed/js | grep -c vision                              # 0
```
If the stagger grep name changed with the rebuild, find the 200 ms constant in the new bundle and update the README line.

- [ ] **Step 4: Update the README** — add the third patch to "What", "Files here", the rebuild `git am` list, and the `presentationStartMode` grep to "Verify the bundle".
- [ ] **Step 5: Commit** — `feat(spreed): presenter keeps the participant strip while sharing (Deck #503)`, staging the patch, `js/`, `css/`, README.

### Task 3: Ship to HML and check in real browsers

- [ ] **Step 1: Build `:staging-1`** — `KEEP_DOCKER=1 ./scripts/build-push.sh latest staging 1` from this worktree. Expected: `✓ Built and pushed` and a new digest.
- [ ] **Step 1b: Golden checkout** — replace `~/work/avuz/avuz-server/apps/spreed` with the 23.0.14 tarball (deploy.sh and future builds run from there).
- [ ] **Step 2: Deploy** — from the golden checkout: `./scripts/deploy.sh -y avuz-conecta`; confirm the container `.Image` changed and it is healthy.
- [ ] **Step 3: Browser check** on HML (verify-avuz-conecta skill, Playwright with fake media), a call with 3 participants (presenter + 2):
  - presenter starts a screen share → strip visible with the 2 others, screen on stage, own bubble shown;
  - each viewer → presenter's screen on stage, strip closed (today's layout);
  - presenter closes the strip → stays closed; reopens → open;
  - presenter stops → pre-share layout back (test once from speaker view, once from grid).
  Save one screenshot of the presenter view.
  Also: boot log shows the spreed reconcile and `occ config:app:get spreed installed_version` = 23.0.14; virtual background works; a recording over 100 MB lands in the owner's Drive.
- [ ] **Step 4: Report** — results + screenshot to Patrick; PR into `avuz-customization` only on his word.
