# Deck glimpse card link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On "Todos os painéis", each card in a board's filtered glimpse links to that card on its board.

**Architecture:** One `router-link` per glimpse row in `BoardItem.vue`, targeting the existing `card` route; the board view's deep-link handling opens the side panel.

**Tech Stack:** Vue 2, vue-router 3, Vuex, jest + @vue/test-utils (Deck fork).

**Spec:** `docs/superpowers/specs/2026-11-25-deck-glimpse-card-link-design.md`

## Global Constraints

- Code: Deck fork worktree `~/work/avuz/deck-glimpse-link`, branch `feat/glimpse-card-link` (off `avuz/avuz` c19f016b9).
- Route: `{ name: 'card', params: { id: board.id, cardId: card.id } }` → `/board/<id>/card/<cardId>`.
- UI strings pt_BR in source (fork convention, e.g. `t('deck', 'Carregando…')`).
- Version 1.18.104 → 1.18.105 in `appinfo/info.xml` (JS cache-bust).
- HML (staging-1) first; prod only on Patrick's "go".

## Review Focus

- Ctrl/cmd-click or middle-click → opens the card in a new tab (needs a real `href`, pinned by the test asserting `href`).
- Keyboard: Tab reaches each card link, Enter opens it; focus is visible.
- Clicking a card link must not also toggle the glimpse or trigger the board row link (they are siblings, not nested; keep it that way).
- Card with no due date → row still links, no empty due cell.
- Long card title → wraps inside the row, the link still covers the row.

---

### Task 1: Glimpse rows link to their card

**Files:**
- Modify: `src/components/boards/BoardItem.vue:60-67` (template), `:241-271` (styles)
- Create: `src/components/boards/BoardItem.spec.js`

**Interfaces:**
- Consumes: store state `boardTagFilter`, `boardDueFilter`, `boardUserFilter`, `matchingCards[boardId]` (array of `{ id, title, listTitle, duedate }`), `boardSummaries`; action `loadMatchingCards`.
- Produces: method `cardRoute(card) → { name: 'card', params: { id: board.id, cardId: card.id } }` on BoardItem.

- [ ] **Step 1: Write the failing spec** `BoardItem.spec.js`

Mount with a real `VueRouter` (mode `abstract`) holding routes `/board/:id` (`board`) with child `card/:cardId` (`card`); stub `NcAvatar`/`NcButton` like `BoardFilterBar.spec.js` (NcButton emits click). Store: `boardTagFilter: ['x']`, `matchingCards: { 7: [{ id: 42, title: 'Contrato Ana', listTitle: 'A fazer', duedate: null }] }`, `boardSummaries: {}`. Board `{ id: 7, title: 'Jurídico', color: '0082c9', owner: { uid: 'u', displayname: 'U' }, acl: [] }`. Click the chevron, `await nextTick`.

```js
describe('BoardItem', () => {
	describe('glimpse of matching cards', () => {
		it('links each card to its board with the card open', async () => {
			const link = wrapper.find('.board-matching-cards a')
			expect(link.attributes('href')).toBe('/board/7/card/42')
			expect(link.text()).toContain('Contrato Ana')
			expect(link.text()).toContain('A fazer')
		})
		it('names the link by card and list', ...)        // aria-label === 'Contrato Ana — A fazer'
		it('opens the card on click without collapsing the glimpse', ...) // click link → router.currentRoute.name === 'card', params { id: '7', cardId: '42' }; '.board-matching-cards' still exists
	})
})
```

- [ ] **Step 2: Run it, expect FAIL** (no `a` in the glimpse)

Run: `cd ~/work/avuz/deck-glimpse-link && ln -sfn ../deck-fork/node_modules node_modules && npx jest src/components/boards/BoardItem.spec.js`

- [ ] **Step 3: Implement**

Inside each `<li>`, a `<router-link :to="cardRoute(card)" :aria-label="…" class="board-matching-card">` wrapping the three spans. Styles: link `display: flex; gap: 12px; color: inherit; padding: 4px 8px; border-radius: var(--border-radius)`, `&:hover, &:focus-visible { background-color: var(--color-background-hover) }`, `&:focus-visible { outline: 2px solid var(--color-primary-element) }`; title `overflow-wrap: anywhere`.

- [ ] **Step 4: Run spec + full jest, expect PASS**

Run: `npx jest` — all suites green.

- [ ] **Step 5: Lint**

Run: `npx eslint src/components/boards/BoardItem.vue src/components/boards/BoardItem.spec.js` — no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/BoardItem.vue src/components/boards/BoardItem.spec.js
git commit -m "feat(deck): open a card from the All boards filter glimpse"
```

### Task 2: Build, version, ship to HML

**Files:**
- Modify: `appinfo/info.xml` (1.18.105), `js/` (built bundle, committed)
- avuz-server: `apps/deck` submodule pointer

- [ ] **Step 1:** Bump version to 1.18.105; `npm run build` (fork's committed `js/` must match source); commit `js/` + `info.xml`.
- [ ] **Step 2:** Push branch, open PR on avuz-conecta/deck, merge into `avuz` after review.
- [ ] **Step 3:** avuz-server branch: bump `apps/deck` to the merge commit; build `KEEP_DOCKER=1 ./scripts/build-push.sh latest staging 1`; deploy `./scripts/deploy.sh -y avuz-conecta` from the golden checkout.
- [ ] **Step 4: Verify on HML in the browser:** "Todos os painéis" → tag filter → chevron → click a card → URL `/apps/deck/board/<id>/card/<cardId>`, side panel shows that card; ctrl-click opens a new tab; Tab + Enter works. Deck version 1.18.105 in `occ app:list`.
