# Talk HPB Load Test

Simulates N concurrent guests joining one Nextcloud Talk conversation, each
publishing real audio+video over WebRTC, to load-test the High Performance
Backend (signaling → Janus → coTURN) without rounding up real people.

## Setup

```bash
cd talk-load-test
npm install
npx playwright install chromium   # bundled browser, ~150MB, one time
```

## Run

```bash
# single peer, verify it joins (remote:0 expected — nobody else)
GUESTS=1 HOLD_SECONDS=20 TALK_URL="https://app3.avuz.app/call/XXXX" node run.mjs

# two peers, confirm they see each other (remote:1 each)
GUESTS=2 HOLD_SECONDS=30 STAGGER_MS=3000 TALK_URL="https://app3.avuz.app/call/XXXX" node run.mjs

# full load run
GUESTS=25 HOLD_SECONDS=300 TALK_URL="https://app3.avuz.app/call/XXXX" node run.mjs
```

## Config (env vars)

| Var            | Default    | Meaning                                        |
|----------------|------------|------------------------------------------------|
| `TALK_URL`     | (required) | Public conversation link                       |
| `GUESTS`       | `25`       | Fake guests this process spawns                |
| `HOLD_SECONDS` | `300`      | How long peers stay in the call                |
| `STAGGER_MS`   | `500`      | Delay between successive joins                 |
| `NAME_PREFIX`  | `LoadTest` | Guest display-name prefix                      |
| `NAME_OFFSET`  | `0`        | First guest number = offset+1 (sharding)       |
| `NAME_TOTAL`   | `GUESTS`   | Pad width / grand total across shards          |
| `HEADFUL`      | `0`        | `1` shows browser windows (debug)              |

## Sharding — split N across processes (avoid one-browser contention)

One Chromium with 25 contexts bottlenecks on its single network/GPU/main thread,
stalling WebSocket pings → dropped signaling sessions. Run **multiple processes**,
each its own Chromium, all joining the same room. Works on one box or many.

```bash
# Terminal A — guests 01..13
GUESTS=13 NAME_OFFSET=0  NAME_TOTAL=25 HOLD_SECONDS=60 STAGGER_MS=3000 \
  TALK_URL="https://app3.avuz.app/call/XXXX" node run.mjs

# Terminal B — guests 14..25
GUESTS=12 NAME_OFFSET=13 NAME_TOTAL=25 HOLD_SECONDS=60 STAGGER_MS=3000 \
  TALK_URL="https://app3.avuz.app/call/XXXX" node run.mjs
```

PowerShell: set each with `$env:VAR="..."` before `node run.mjs`. Start both within
a few seconds so they overlap in the call.

## Report

Per peer: `join` (reached in-call), `ice` (≥1 PeerConnection connected),
`remote` (inbound video streams seen mid-hold, ≈ GUESTS-1 when healthy),
`errors` (fatal console errors; known Talk noise is filtered).

## Machine plan

- **25-peer:** Windows i7-13650HX (20 threads, 32GB) — headroom.
- **Dev / ≤10 smoke:** M3 Pro.
- **Bottleneck:** CPU + RAM. Each peer decodes ~GUESTS-1 software video streams
  (no GPU in headless). Budget ~0.5–1GB/peer.
- **Scale-out:** run on two machines pointing at the same `TALK_URL`
  (e.g. 13 + 12) to exceed one box. Operator watches server-side metrics
  (Janus sessions, signaling, coTURN, `docker stats`) during the hold.

## Notes

- Spoofs a regular Chrome User-Agent; Talk rejects "HeadlessChrome" as
  unsupported and the warning toast blocks the join button.
- UI selectors live in the `SELECTOR` block at the top of `peer.mjs`
  (verified against app3.avuz.app, pt_BR). Edit there if the UI/locale drifts.
- Tests: `npm test` (pure logic only — config/naming/report).
```
