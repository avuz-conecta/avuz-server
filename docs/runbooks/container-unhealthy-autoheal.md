# Runbook — container unhealthy (autoheal + health log)

The app container answers nothing but keeps running and logging. Docker marks it
`unhealthy`; a manual `docker restart` fixes it. This is now automated, and the
reason is recorded before the restart wipes it.

## How it works

| Piece | Where | Job |
|---|---|---|
| `HEALTHCHECK` | `Dockerfile` | runs `docker/healthcheck.sh` every 30s, 3 retries, 300s start-period |
| Probe + dump | `docker/healthcheck.sh` | `GET /status.php`; on failure appends a diagnostic block to the health log |
| Boot marker | `docker/entrypoint.sh` | writes a `BOOT` line at every container start |
| Opt-in label | `Dockerfile` → `LABEL autoheal=true` | baked into the image, so every container inherits it — no per-stack edit |
| Restarter | standalone `autoheal` stack (`portainer-autoheal-stack.yml`), **one per host** | restarts any container labelled `autoheal=true` once Docker flags it unhealthy |

**Topology:** the label rides in the image; the restarter is one stack per Docker host.
autoheal watches its host's socket and heals every labelled container on that host,
across all stacks. So: rebuild the image once (label + probe baked in), deploy one
`autoheal` stack on each host, and every client stack is covered with no per-stack
config. A host without an autoheal stack leaves its containers unhealed — the socket
is local, coverage never crosses hosts.

**Docker never restarts an unhealthy container on its own.** `restart: unless-stopped`
only fires when the process exits. That's why the incident sat there until a human
restarted it. The autoheal sidecar closes that gap.

Health log: `/var/www/html/data/avuz-health.log` (inside the data volume, so it
survives the restart). Rotates at 1MB to `avuz-health.log.1`. The failure counter
lives in `/tmp` on purpose — it resets each boot, so `consecutive_failures` always
means "since this boot".

## Read the log

```bash
docker exec <nc-container> tail -n 60 /var/www/html/data/avuz-health.log
```

Blocks look like this. **The diagnostic block directly above a `BOOT` line is why
that restart happened.**

```
[2026-07-23T14:02:11Z] UNHEALTHY consecutive_failures=3
  probe      : http://localhost/status.php curl_exit=28 http=000
  response   : <empty>
  processes  : nginx=2 php-fpm=51 redis-server=1 crond=1
  php-fpm    : busy_or_idle=50 max_children=50
  redis      : PONG
  database   : /var/run/postgresql:5432 - accepting connections
  disk       : root=61% data=61% inodes=3%
  load       : 24.10 19.88 12.02
  memory     : used=7100M free=210M total=7800M
  maintenance: 0
  nc-log     : {"reqId":"...","message":"Could not obtain lock ..."}

[2026-07-23T14:02:26Z] BOOT container started (config 33.0.0-14, host a1b2c3)
```

## Read the diagnosis off the block

| Signature | Cause | Fix |
|---|---|---|
| `busy_or_idle` == `max_children`, high load | php-fpm pool exhausted — every worker stuck (slow S3, slow DB, a hung external call) | find the blocking dependency; raise `pm.max_children` only after |
| `redis` not `PONG` | Redis down → sessions + file locking dead | check `supervisorctl status redis`; see [file locking on S3] notes |
| `database` not "accepting connections" | Postgres down / network partition | check the DB stack first, not the app |
| `disk` at 100% or inodes 100% | ENOSPC — NC fails to write, stays up | free space; see the disk-full FileSequence incident |
| `maintenance: 1` | stuck in maintenance mode after a failed upgrade | `occ maintenance:mode --off` after checking the upgrade actually finished |
| `curl_exit=28`, everything else healthy | request timeout, not a crash — usually the pool case above | |
| `http=500` + `nc-log` exception | application error | read the `nc-log` lines |

## Verify autoheal is running

```bash
docker ps --filter "name=autoheal" --format "{{.Names}} {{.Status}}"
```

```bash
docker inspect --format '{{.State.Health.Status}} {{len .State.Health.Log}}' <nc-container>
```

## Deliberately test it (staging only)

Break the probe from inside the container, wait ~90s, watch it come back:

```bash
docker exec <nc-container> supervisorctl stop nginx
```

Expected: 3 failed probes → `unhealthy` → autoheal restarts within ~15s → new `BOOT`
line in the health log, with the diagnostic block above it showing `nginx=0`.

## Tuning knobs

- `AUTOHEAL_START_PERIOD=330` must stay **>= the image's 300s `--start-period`**.
  Lower it and a slow boot (big `occ upgrade`) gets restarted mid-upgrade — that is
  how you corrupt an instance, so raise both together or neither.
- `AUTOHEAL_DEFAULT_STOP_TIMEOUT=60` gives supervisord time to drain. Shorter means
  SIGKILL mid-request: half-written chunk uploads and stale Redis file locks.
- One autoheal per **host** is enough — the label match is host-wide, not stack-scoped.

## Adding a new host

1. Deploy `portainer-autoheal-stack.yml` as its own stack on that host.
2. Make sure the NC containers there run an image built with `LABEL autoheal=true`
   (any current build). Nothing else — no per-stack label, no sidecar.

## Security note

autoheal mounts `/var/run/docker.sock` read-write. That is root-equivalent control of
the host daemon. Keep the image pinned, publish no ports on it, and put nothing else
in that container.

## What autoheal does NOT do

It hides the symptom. A container that keeps getting restarted is still broken — read
the health log and fix the cause. If you see repeated `UNHEALTHY`/`BOOT` pairs, treat
it as an open incident, not a solved one.
