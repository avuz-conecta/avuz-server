# Deck: open a card from the "Todos os painéis" glimpse (card #347)

## Intent

On "Todos os painéis", a filter (tags, due date, user) shows a chevron per
board. Opening it lists the matching cards (title, list, due date). Today
those rows are plain text: to reach a card the user opens the board and
hunts for it. Clicking a card in that list should open its board with that
card's side panel open.

## Goals

- Each matching card row is a link to `/board/<boardId>/card/<cardId>`
  (route `card`, params `id` and `cardId`).
- Normal link behavior: click opens in the same tab; ctrl/cmd-click and
  middle-click open a new tab; keyboard focus + Enter works.
- Visible hover/focus state, like the board row above it.

## Non-goals

- No change to which cards match (MatchingCardMapper already drops archived
  and deleted cards).
- No change to the board row, the filter bar or the glimpse's loading/empty
  states.

## Approaches

1. **`router-link` per row (picked).** One element, real `href`, so new-tab
   and keyboard work for free; the board view's existing deep-link handling
   opens the sidebar.
2. Click handler calling `$router.push`. Loses the `href`, so no new tab, no
   middle-click, worse a11y.
3. Open the card in a modal over "Todos os painéis". Needs the board's
   stacks/permissions loaded outside the board view; much bigger for no ask.

## Design

- In `src/components/boards/BoardItem.vue`, wrap each `<li>`'s content in
  `<router-link :to="{ name: 'card', params: { id: board.id, cardId: card.id } }">`.
- The link carries an `aria-label` with the card title and its list, and the
  row keeps title / list / due date as today.
- Styles: link fills the row, inherits text color, hover/focus background
  `--color-background-hover`, visible focus outline.
- Test: a jest spec mounts BoardItem with a filter active and one matching
  card, expands it, and checks the row links to `/board/7/card/42`.

## Left to the builder

Exact CSS spacing; the spec's router setup (real VueRouter with the `board`
and `card` routes, so the asserted `href` is the one users get).

## Ship

Deck fork (avuz-conecta/deck, branch `avuz`), version bump in
`appinfo/info.xml` (JS cache-bust), submodule bump in avuz-server, HML
(staging-1) first.
