# Talk: presenter keeps the participant strip (Deck #503)

Status: approved by Patrick 2026-11-19. Small change.

## Why

Eco-ambiental presents in Talk calls from the browser. The moment they share
their screen, the participant strip closes: they see their screen and their
own camera bubble, nobody else. They want to watch people's reactions while
presenting. Today the only way is the ^ chevron or Grid view, every time.

## What changes

- When **I** start sharing my screen, the participant strip stays open: my
  screen big on the stage, the other participants in the strip under it, my
  camera in the presenter bubble (as today).
- People watching my share keep today's view: my screen big, strip closed,
  ^ opens it.
- If I close the strip during my share, it stays closed until I open it again.
- When I stop sharing, the call view goes back to what it was before the share
  (grid or speaker, strip open or closed), as today.

## Goals / non-goals

- Goal: the presenter sees the others without any click.
- Non-goal: changing the viewer's layout; a Meet-style "presenting" grid that
  hides the presenter's own screen; any setting or toggle.
- Anti-goal: breaking the restore after the share (a presenter who ends up in
  speaker view with the strip closed after stopping, or stuck in a layout they
  did not pick).

## Approaches

1. **Presenter keeps the strip open** (picked). One source change in Talk's
   call view store/CallView; viewers untouched.
2. Strip open for everyone during any share: the client asked only about the
   presenter, and viewers want the screen as big as possible.
3. Presenter gets a grid of participants instead of their own screen: the
   client wants to see the screen too.

## How it works today (spreed v23.0.6 source)

- `src/components/CallView/CallView.vue`, watcher `showLocalScreen`: on a local
  share it calls `callViewStore.startPresentation(token)`.
- `src/stores/callView.ts`, `startPresentation`: sets
  `isGrid: false, isStripeOpen: false` with `clearLast: false` (keeps the
  previous mode in `lastIsGrid` / `lastIsStripeOpen`).
- `stopPresentation` restores the previous mode only when
  `!isGrid && !isStripeOpen`, i.e. "the user did not change the layout during
  the presentation".
- Remote shares also go through `startPresentation` (`_switchScreenToId`).

## Design

- `startPresentation` learns whether the share is local; for a local share it
  opens the strip (`isStripeOpen: true`), for a remote share it keeps today's
  `false`.
- The restore in `stopPresentation` must still run for a presenter who left
  the strip as we opened it. The "did the user change the layout" check must
  compare against the mode the presentation started with, not against a
  hard-coded closed strip. Exact shape is the builder's call.
- Ship as a source patch `docker/overlays/spreed/presenter-keeps-strip.patch`
  next to the existing two, with a vitest spec in
  `src/stores/__tests__/callView.spec.js`; rebuild the full bundle with all
  three patches into `docker/overlays/spreed/js` + `css` (README recipe), and
  update the overlay README.

## Tests

- Store spec: local share opens the strip; remote share keeps it closed; stop
  after an untouched local share restores the previous mode (grid and speaker
  cases); a user who switched to grid or closed the strip during the share is
  not overridden on stop.
- HML (staging-1), real browsers, call with 3+ participants: presenter sees
  the strip on share without clicking; a viewer sees today's layout; closing
  the strip sticks; stopping restores the prior mode.

## Left to the builder

- Exact API change (`startPresentation(token, { isLocal })` or similar) and
  the restore check.
- Bundle verification greps for the README.
