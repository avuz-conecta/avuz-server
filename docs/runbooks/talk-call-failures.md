# Runbook — Talk call failures (alone-in-room, join-loop, ~15 ceiling)

Incident response for Nextcloud Talk / HPB call problems. Follow the triage first,
then jump to the matching playbook. Every step has an exact command — no guessing
mid-incident.

## Environment facts (so you don't re-derive them)

- **HPB host:** `avuzcloud` = `meet.avuz.app`, IP `186.226.61.133`. **OpenVZ** (shared
  kernel — you do NOT control sysctl/UDP buffers/clock; that's the root of the ceiling).
- HPB services (systemd, NOT Docker): `janus`, `coturn`, `nats-server`,
  `nextcloud-spreed-signaling` (single process).
- Signaling config: `/etc/nextcloud-spreed-signaling/server.conf`.
- Cloudflare on `meet.avuz.app` is **grey/DNS-only** (correct — keep it that way).
- **Nextcloud app host:** separate **Docker** host (e.g. `conectahml2.avuz.app`,
  `app3.avuz.app` — one per tenant). Run `occ` inside the NC container:
  `docker exec -u www-data <nc-container> php occ ...`
- **DB engine: PostgreSQL** (not MySQL). Open a shell:
  `docker exec -it <db-container> psql -U <pguser> nextcloud`
- Talk DB tables: `oc_talk_rooms`, `oc_talk_attendees`, `oc_talk_sessions`.
- Mobile join-loop is **already fixed** by the spreed stagger overlay (verify below).

---

## TRIAGE — pick the symptom

| Symptom | Go to |
|---|---|
| One user "alone in room", others see each other; reload doesn't fix it | **P1** |
| Mobile user loops: join → freeze → "waiting" → auto-refresh → never joins | **P2** |
| Calls fall apart / new joiners can't connect around **14–16 people** | **P3** |
| "Sua conexão está ocupada..." warning (outbound quality) | **P4** |

---

## P1 — "Alone in room" (wedged room state / orphaned sessions)

**Meaning:** the ROOM's session state is wedged in Nextcloud (orphaned session left by
a client that crashed mid-join under load). Reload gives the user a fresh client but
they rejoin the *same* wedged room → still alone. A brand-new room has clean state.

### Step 0 — read the alone user's browser console (fastest triage)
On the **alone participant's** device, open DevTools (desktop Chrome; on iPhone, connect
it to a Mac → Safari → Develop menu). This splits the root cause in ~30 seconds.

**Console** — which signaling, and what error?
- Look for a live `wss://meet.avuz.app/...` connection vs a message about **internal
  signaling** / no external WS.
- Grep the log for: `no_such_room`, `no_such_session`, `session to resume does not exist`,
  `Backend does not match`, `Reconnecting socket`.

**Network tab** — open the `signaling/settings` OCS response:
- Lists your **external** HPB server → client is correctly pointed at HPB.
- **Empty** / internal → NC served this client internal signaling (#2).

**Interpret → route:**
| Console shows | Root | Go to |
|---|---|---|
| External WS connected, but roster empty + `no_such_room` / resume errors | **#4 wedged room** | Step 1 |
| Fell back to **internal** signaling / `signaling/settings` empty | #2 NC settings | Step 0b |
| WS keeps dropping + reconnecting to external | #1 WS drop | P2 checks + Step 4 |

**Step 0b (if #2):** the client got internal signaling from a stale NC. Restart php-fpm on
that tenant's NC container (`docker exec <nc> ...` / recreate), have the user hard-reload.
If `signaling/settings` then lists the external server → fixed.

If you can't get a console (client won't cooperate, no cable) → skip to Step 1; it's the
safe default and its result also tells you if it was #4.

### Step 1 — instant recovery (try before anything else)
Moderator in the call → **"End call for everyone"** → wait ~10s → start the call again,
everyone rejoins the **same** room.
- Works → **confirmed wedged call-state (#4).** Done. (Beats making a new room.)
- Still alone → go to Step 2.

### Step 2 — find the orphan (NC app host)
```bash
# any calls stuck active?
docker exec -u www-data <nc-container> php occ talk:active-calls

# read the room (token = the part after /call/ in the link)
docker exec -u www-data <nc-container> php occ talk:room:list   # or query DB below
```
DB inspect (read-only, **PostgreSQL**) — find stale sessions holding the roster:
```sql
SELECT id, token, name, active_since FROM oc_talk_rooms WHERE token = 'XXXX';

SELECT s.session_id, s.in_call, s.last_ping
  FROM oc_talk_sessions s
  JOIN oc_talk_attendees a ON a.id = s.attendee_id
 WHERE a.room_id = <id_from_above>
   AND s.last_ping < extract(epoch from now())::int - 60;   -- rows here = orphans
```
Also check the room's participant list in the UI for a **phantom participant** (shown
in-call but not really there) = the orphan.

### Step 3 — clear the wedge (surgical — BACK UP FIRST)
Only if Step 1 failed and Step 2 shows orphaned rows.
```bash
# snapshot the table before touching it (PostgreSQL)
docker exec <db-container> pg_dump -U <pguser> -t oc_talk_sessions nextcloud > /tmp/talk_sessions_backup.sql
```
Delete only the orphaned session rows (old `last_ping`) for that room — **PostgreSQL uses
`DELETE ... USING`, not MySQL's multi-table `DELETE s FROM`:**
```sql
DELETE FROM oc_talk_sessions s
 USING oc_talk_attendees a
 WHERE a.id = s.attendee_id
   AND a.room_id = <id>
   AND s.last_ping < extract(epoch from now())::int - 60;
```
Then have users rejoin. Scope strictly — never delete rows with a recent `last_ping`
(those are live participants).

### Step 4 — if it recurs constantly
Root cause of the orphans = sessions crashing mid-join = **instability under load =
OpenVZ**. The cleanup above is the firefight; the durable fix is the **KVM migration**
(see P3). KVM lowers how often sessions orphan.

---

## P2 — Mobile join-loop

**Should already be fixed** by the spreed stagger overlay. Verify the running image
carries it:
```bash
docker exec <nc-container> grep -o 'Hh=[0-9]*' /var/www/html/apps/spreed/js/talk-main.js
# → Hh=200  = patched.   empty = image was built WITHOUT the overlay → rebuild.
```
In the mobile browser console during a join, you should see `Request offer from` lines
**spread over seconds**, and **no** `Reconnecting socket ... closed unexpected` loop.

If the loop is back **and** `Hh=200` is present → it's a stale cached bundle (hard-reload
the client), not a bad build. If `Hh` is empty → the deploy shipped a pre-patch image;
rebuild from a branch that has `docker/overlays/spreed/`.

Tuning: raise `REQUEST_OFFER_STAGGER_MS` (200 → 300) in the spreed source, rebuild the
overlay (see `docker/overlays/spreed/js/README.md`), rebuild image.

---

## P3 — ~14–16 participant ceiling

**Root cause is proven infra, not software:** the HPB host is **OpenVZ**, so
`net.core.rmem_max`/`wmem_max` **don't exist** — Janus can't get the big UDP socket
buffers an SFU needs for many simultaneous streams. Around 15 video users the buffers
overflow, packets drop, the next joiner can't negotiate media. **Not fixable in place.**

### Mitigate NOW (buys headroom under the cap)
On the HPB host, lower the max stream bitrate in `/etc/nextcloud-spreed-signaling/server.conf`:
```ini
[mcu]
maxstreambitrate = 300000    # was 500000 — fewer bytes/packets = less buffer pressure
```
```bash
systemctl restart nextcloud-spreed-signaling
```
Also: cams-off for non-speakers (each publisher = +1 stream for everyone).

### Confirm it's the box, not the project (zero-risk A/B)
Sign up for **struktur's hosted HPB 30-day free trial** (contact via spreed.eu — it's a
sales trial, not an in-app button), point Talk at their signaling server for a week.
Ceiling + P1 "alone" vanish on their box → definitive proof it's your OpenVZ host.

### Durable fix — migrate HPB to KVM
OpenVZ is the wrong VM type for a media SFU (no kernel control: buffers, clock, modules).
Move the HPB stack to a **KVM** box (KVM VPS, or a KVM VM on your own Proxmox/ESXi):
1. Provision KVM VM, install janus + coturn + nats + nextcloud-spreed-signaling
   (or the `aio-talk` container for coherent versions).
2. Set the UDP buffers you couldn't set on OpenVZ:
   ```bash
   echo -e "net.core.rmem_max=16777216\nnet.core.wmem_max=16777216" > /etc/sysctl.d/99-janus.conf
   sysctl --system
   ```
3. Migrate `meet.avuz.app` → new IP: update DNS A record, Janus `nat_1_1_mapping`,
   coTURN `external-ip` (same procedure as the last IP migration). Open the media UDP
   ranges in the firewall (20000–40000 + 49152–65535).

KVM plausibly fixes the ceiling, "alone" (fewer orphans), and the clock all at once.

---

## P4 — "Sua conexão está ocupada" (outbound quality warning)

**Benign, advisory** — Talk read your `outbound-rtp` stats and your upload is throttled.
Not a disconnect; "Dispensar" dismisses it, call continues.
- Under a bot load-test on one wifi, or on mobile data → expected (constrained uplink).
- Confirm which: `chrome://webrtc-internals` → your `outbound-rtp (video)` →
  `qualityLimitationReason` = `bandwidth` (uplink) or `cpu` (device encode).
- Reduce for real users: lower `[mcu] maxstreambitrate` (see P3), cams-off for
  non-speakers. It's the same shared-uplink saturation story — not the server, not a bug.

---

## Quick health checks (HPB host)

```bash
# clock correct? (compare to true UTC — must be within seconds)
date -u; curl -sI https://cloudflare.com | grep -i '^date:'

# services up
systemctl status janus coturn nats-server nextcloud-spreed-signaling --no-pager

# watch signaling during a call (session drops / resume / room errors)
journalctl -u nextcloud-spreed-signaling -f | grep -iE 'client.go|closing|ping|timeout|resume|no_such'

# confirm OpenVZ (why you can't tune the kernel)
systemd-detect-virt; [ -e /proc/user_beancounters ] && echo OpenVZ
```

## What's RULED OUT (don't re-chase)
- **Cloudflare** — `meet.avuz.app` is grey/DNS-only; not in the signaling path.
- **Clock skew** — verified within 1s of true UTC (OpenVZ host keeps it correct despite
  `synchronized: no`).
- **Reverse-proxy WS timeout** — there is no NPM/nginx in front of `meet.avuz.app`.
- **Signaling version** — running v2.1.1 (current-ish), not the old "unknown" build.
- **Mobile join-loop** — fixed by the stagger overlay (P2 verifies).

Remaining real levers: **P1** orphaned-session cleanup (firefight) and **P3** KVM
migration (durable). Both trace back to the same root: **OpenVZ instability under load.**
