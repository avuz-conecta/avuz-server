# Talk HPB — troubleshooting & ops runbook

Standalone Nextcloud Talk High-Performance Backend (signaling → Janus → coTURN).
Agent-facing: when someone reports a call problem, follow the decision tree and
hand them the matching command block.

## Fleet

| Host | IP | Spec | Role |
|------|----|------|------|
| **meet04.avuz.app** | 187.0.5.165 | bare metal, Xeon E5-2650, 32c/188GB, AES-NI | current — serves app3 (vidalar/digrepal cutover pending) |
| meet03.avuz.app | 186.226.61.70 | KVM, 2c/7GB, **no AES-NI** | under-provisioned, being retired |
| meet.avuz.app (avuzcloud) | — | OpenVZ | legacy, deprecated |

Stack is systemd (NOT Docker): `nextcloud-spreed-signaling`, `nats-server`,
`janus` (compiled, config in `/usr/etc/janus/`), `coturn`, `nginx` frontend.
No SSH via Portainer — operate directly on the host.

## First move on ANY complaint: is it the server?

Run the health snapshot on the HPB:
```bash
bash scripts/hpb-health.sh    # or /root/hpb-health.sh on the box
```
- **SERVER HEALTHY** → server ruled out, go to *client triage* below.
- **SERVER ISSUE** → fix what's red (see *common failures*), don't blame the client.

For a past call, use the black-box recorder instead of live check:
```bash
grep '^14:' /var/log/hpb/metrics-$(date +%F).csv   # the 2pm window
cat /var/log/hpb/health.log                          # PASS/FAIL history
```
Server was fine if that window shows low `load1` (< ~19 on 32 cores) and
`UdpRcvErrD = 0`.

## Client-side triage (server already green)

Have the affected person open `chrome://webrtc-internals` → filter `inbound-rtp`,
expand a couple of video entries. Compare to baselines:

| Symptom | Cause | Verdict |
|---|---|---|
| `framesDropped` climbing **+ their CPU high** | their hardware/browser can't decode | "your computer" |
| `packetsLost` high / RTT ≫ 45ms / `freezeCount` rising | their internet | "your connection" |
| One remote peer looks bad **to everyone** | that peer's uplink | "person X's connection" |
| `framesReceived/s` low but `framesDropped` ~0, CPU low | the *sender* is throttled (bad uplink/old device) | that sender's side |
| Everyone else fine | them | client-side |

**Proven baselines (2026-07-29):** idle load ≈ 0; **15 users → load ≈ 3–5**,
cpu_id > 88%, UDP drops 0, RTT ≈ 45ms, per-stream 240p base layer. Software VP8
decode (libvpx) coped with 15 streams at ~0 dropped frames.

## Load test (validate before trusting a box)

Harness: `talk-load-test/` (Playwright headless-Chrome guests, real A/V).
**Route matters:** bots go through whatever HPB the NC instance points at — test
on an instance pointed at the target HPB. **Never launch against a live link
without the operator creating the room + saying go.**

Start server sampler first, then bots. **Spread bots across machines** (10+ per
box makes them bad publishers → invalid test — the "ceiling" becomes the test rig).
```bash
# machine A (bots 01..10)
GUESTS=10 NAME_OFFSET=0 NAME_TOTAL=15 HOLD_SECONDS=180 STAGGER_MS=2500 \
  TALK_URL="https://<nc>/call/XXXX" node run.mjs
# machine B (bots 11..15)
GUESTS=5 NAME_OFFSET=10 NAME_TOTAL=15 HOLD_SECONDS=180 STAGGER_MS=2500 \
  TALK_URL="https://<nc>/call/XXXX" node run.mjs
```
Read report `remote` (≈ N-1 when healthy, uniform) + the sampler CSV (load/janus%/
UDP drops). Bot errors `no_such_session`/`client_not_found`/`ice:NO` usually = the
bot machine saturated, not the HPB — cross-check the CSV (idle = server fine).

## Common failures & fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Join → drop → rejoin loop (esp. after a migration) | Janus `nat_1_1_mapping` / coTURN `external-ip` stale or unset | set to the host's real public IP, `systemctl restart janus coturn` |
| UI "Running version: unknown" / missing features | signaling built from tarball or too old | build from git tag ≥ 2.1.1 (Talk needs join-features/chat-relay), `--version` must show a real version |
| TLS errors after ~90 days | cert renewed but nginx/coturn never reloaded | add `renewal-hooks/deploy/reload-nginx.sh`; coturn via `post/coturn-permissions.sh` |
| "some users can't connect at all" (corporate net) | TURN only on 3478/5349, firewall allows 443 only | TURN over 443 (2nd IP, 443/udp, or nginx `stream` SNI mux) |
| Everyone freezes at once, load high, cpu_id low | genuine server saturation (under-provisioned box) | scale cores / add Janus instance — verify with sampler |
| `Fail to create file sequence directory` / crash loop | host disk 100% full | free space; recorder self-prunes at 14d |
| Alone-in-room / wedged session | orphaned NC Talk session | End-call-for-everyone or DB cleanup — see talk-call-failures runbook |

## "Fully tuned" checklist (what a good HPB has)

- [ ] Hardware: ≥4 cores + **AES-NI** (host-passthrough on VMs), ≥8GB
- [ ] signaling 2.1.x from git; welcome 200 with real version
- [ ] Janus: `full_trickle=true`, `nat_1_1_mapping="<public-ip>"`, `rtp_port_range` set + firewalled
- [ ] coTURN: `static-auth-secret` == signaling `[turn] secret`; realm; relay port range
- [ ] UDP buffers tuned + persisted (`/etc/sysctl.d/99-nextcloud-hpb.conf`, rmem/wmem ≥ 16MB)
- [ ] fd limits: janus 65536, signaling high
- [ ] firewall: 443/tcp, 3478+5349 tcp+udp, Janus RTP range/udp, coTURN relay range/udp
- [ ] all services `Restart=on-failure`; cert `certbot.timer` enabled **with reload hooks**
- [ ] black-box recorder (`hpb-monitor`) + health timer running
- [ ] hardening: coTURN `denied-peer-ip` for RFC1918/link-local — **WARNING: this reds the NC-admin
  TURN "test" button** (the test relays to the admin browser's own private LAN candidate, which the block
  denies). Real HPB calls are unaffected (they relay to Janus's public IP). On a dedicated bare-metal HPB
  the SSRF value is marginal (no cloud metadata, coturn already denies loopback, only localhost services)
  — often not worth breaking the operational test. If a green NC test matters, skip it or keep only the
  `169.254`/`127` denies.
- optional: TURN-over-443 for restrictive clients; governor `performance` only if latency glitches seen (costs idle watts, marginal gain — default `schedutil` is fine)

## Install the monitoring (one-time per host)

```bash
install -m755 scripts/hpb-health.sh /root/hpb-health.sh
install -m755 scripts/hpb-monitor.sh /usr/local/bin/hpb-monitor.sh
# recorder
cat > /etc/systemd/system/hpb-monitor.service <<'S'
[Unit]
Description=HPB black-box metrics recorder
After=network.target
[Service]
ExecStart=/usr/local/bin/hpb-monitor.sh
Restart=always
Nice=10
[Install]
WantedBy=multi-user.target
S
# 15-min health line
cat > /etc/systemd/system/hpb-health.service <<'S'
[Unit]
Description=HPB periodic health check
[Service]
Type=oneshot
ExecStart=/bin/bash -c '/root/hpb-health.sh >> /var/log/hpb/health.log 2>&1'
S
cat > /etc/systemd/system/hpb-health.timer <<'S'
[Unit]
Description=Run HPB health every 15 min
[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
[Install]
WantedBy=timers.target
S
systemctl daemon-reload
systemctl enable --now hpb-monitor hpb-health.timer
```

## TURN over 443 (restrictive-network clients)

Clients behind firewalls that allow only 443 outbound can't reach TURN on
3478/5349. Fix without a 2nd IP: **nginx `stream` SNI multiplexing** — nginx on
443 peeks the TLS SNI and routes TURN traffic to coturn, web traffic to the
signaling vhost. Requires a **dedicated TURN hostname** (nginx can't tell TURN
from web on 443 without a distinct SNI). Configured on meet04 as `turn04.avuz.app`.

Setup (already applied to meet04):
1. DNS: `turn04.avuz.app` A → HPB IP, **grey-cloud (never CF-proxied)**.
2. Cert: `certbot certonly --webroot -w /var/www/html -d turn04.avuz.app`.
3. `apt install libnginx-mod-stream` (dynamic module on Ubuntu).
4. Move the web vhost off public 443 → `listen 127.0.0.1:8443 ssl;`.
5. Add at the top level of `nginx.conf` (outside `http{}`):
   ```nginx
   stream {
       map $ssl_preread_server_name $hpb_upstream {
           turn04.avuz.app  127.0.0.1:5349;   # coturn TLS
           default          127.0.0.1:8443;   # signaling/web vhost
       }
       server { listen 443; listen [::]:443; proxy_pass $hpb_upstream; ssl_preread on; }
   }
   ```
6. coturn `cert=`/`pkey=` → the `turn04` cert (coturn presents ONE cert, so ALL
   its TLS URLs must use `turn04`); reapply ssl-cert group perms.
7. signaling `[turn] servers` → all three on `turn04`:
   `turn:turn04...:3478,turns:turn04...:5349,turns:turn04...:443?transport=tcp`
8. `nginx -t` → `systemctl reload nginx; systemctl restart coturn nextcloud-spreed-signaling`.

Verify (server-side, no restricted network needed):
```bash
# SNI routing + correct cert per backend
for sni in turn04.avuz.app meet04.avuz.app; do
  echo -n "$sni → "; echo | openssl s_client -connect <hpb>:443 -servername $sni 2>/dev/null | openssl x509 -noout -subject; done
# expect: turn04 SNI → CN=turn04 (coturn); meet04 SNI → CN=meet04 (nginx)
```
Then the real proof: from a 443-only network, a call's `chrome://webrtc-internals`
active candidate-pair should be `relay` via `turn04...:443`.

Gotchas: welcome endpoint 404s on `HEAD` (`curl -sI`) — use GET. Web vhost logs
show `127.0.0.1` (stream-proxied); fine for an HPB (no CF in front). coturn
doesn't speak proxy_protocol, so don't enable it on the stream. `5349` TLS URL
MUST also use `turn04` or it presents the `turn04` cert against a `meet04` SNI →
mismatch.

## Cutover (point an NC instance at a new HPB)

Per NC (app3, vidalar, digrepal): Talk admin → High-performance backend → URL
`https://<hpb>/standalone-signaling/` + the shared secret matching that instance's
`backendN` in the HPB's `server.conf`. Hit Test (green). Keep the old HPB running
as rollback until the new one is proven under real calls.
