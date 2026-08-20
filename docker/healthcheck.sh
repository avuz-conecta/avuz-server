#!/bin/bash
# Docker HEALTHCHECK probe. Exit 0 = healthy, 1 = unhealthy.
#
# Docker itself never restarts an unhealthy container — it only flips a flag.
# The autoheal sidecar in portainer-stack.yml watches that flag and restarts us.
# By then the evidence is gone, so every failed probe dumps a diagnostic snapshot
# to data/avuz-health.log first. Entrypoint writes a BOOT marker on the way up:
# the block right before a BOOT line is why that restart happened.

source "$(cd "$(dirname "$0")" && pwd)/lib-health.sh"

PROBE_URL="${AVUZ_HEALTH_URL:-http://localhost/status.php}"
PROBE_TIMEOUT="${AVUZ_HEALTH_TIMEOUT:-8}"

body="$(curl -sS --max-time "$PROBE_TIMEOUT" -w '\n%{http_code}' "$PROBE_URL" 2>&1)"
curl_status=$?
http_code="$(printf '%s' "$body" | tail -n1)"
payload="$(printf '%s' "$body" | sed '$d' | head -c 300 | tr '\n' ' ')"

if [ "$curl_status" -eq 0 ] && [ "$http_code" = "200" ]; then
    avuz_health_reset_failures "$AVUZ_HEALTH_STATE"
    exit 0
fi

failures="$(avuz_health_bump_failures "$AVUZ_HEALTH_STATE")"
avuz_health_rotate "$AVUZ_HEALTH_LOG" "$AVUZ_HEALTH_LOG_MAX_BYTES"

# busybox pgrep has no -c, hence the wc.
probe_processes() {
    for proc in nginx php-fpm redis-server crond; do
        printf '%s=%s ' "$proc" "$(pgrep -f "$proc" 2>/dev/null | wc -l | tr -d ' ')"
    done
}

probe_redis() {
    command -v redis-cli >/dev/null 2>&1 || { echo "redis-cli unavailable"; return 0; }
    local host="${REDIS_HOST:-127.0.0.1}"
    [ -z "$host" ] && host=127.0.0.1
    redis-cli -h "$host" -p "${REDIS_PORT:-6379}" ping 2>&1 | head -c 60
}

# pg_isready ships with the base image's postgresql-client.
probe_database() {
    local host="${POSTGRES_HOST:-}" port="${POSTGRES_PORT:-5432}"
    [ -z "$host" ] && { echo "POSTGRES_HOST unset"; return 0; }
    pg_isready -h "$host" -p "$port" -t 3 2>&1 | head -c 120 || true
}

# -P (POSIX) keeps each mount on one line — a long device name otherwise wraps
# and awk 'NR==2' grabs the device row instead of the numbers.
probe_disk() {
    printf 'root=%s data=%s inodes=%s' \
        "$(df -Ph / | awk 'NR==2 {print $5}')" \
        "$(df -Ph /var/www/html/data | awk 'NR==2 {print $5}')" \
        "$(df -Pi /var/www/html/data | awk 'NR==2 {print $5}')"
}

probe_fpm_children() {
    local children max
    children="$(pgrep -f 'php-fpm: pool' 2>/dev/null | wc -l | tr -d ' ')"
    max="$(grep -hrs '^pm.max_children' /usr/local/etc/php-fpm.d/ /etc/php*/php-fpm.d/ 2>/dev/null \
        | tail -n1 | awk -F= '{gsub(/ /,"",$2); print $2}')"
    printf 'busy_or_idle=%s max_children=%s' "$children" "${max:-unknown}"
}

{
    avuz_health_append "$AVUZ_HEALTH_LOG" ""
    avuz_health_append "$AVUZ_HEALTH_LOG" "[$(avuz_health_timestamp)] UNHEALTHY consecutive_failures=$failures"
    avuz_health_append "$AVUZ_HEALTH_LOG" "  probe      : $PROBE_URL curl_exit=$curl_status http=$http_code"
    avuz_health_append "$AVUZ_HEALTH_LOG" "  response   : ${payload:-<empty>}"
    avuz_health_append "$AVUZ_HEALTH_LOG" "  processes  : $(probe_processes)"
    avuz_health_append "$AVUZ_HEALTH_LOG" "  php-fpm    : $(probe_fpm_children)"
    avuz_health_append "$AVUZ_HEALTH_LOG" "  redis      : $(probe_redis)"
    avuz_health_append "$AVUZ_HEALTH_LOG" "  database   : $(probe_database)"
    avuz_health_append "$AVUZ_HEALTH_LOG" "  disk       : $(probe_disk)"
    avuz_health_append "$AVUZ_HEALTH_LOG" "  load       : $(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"
    avuz_health_append "$AVUZ_HEALTH_LOG" "  memory     : $(free -m 2>/dev/null | awk 'NR==2 {print "used="$3"M free="$4"M total="$2"M"}')"
    avuz_health_append "$AVUZ_HEALTH_LOG" "  maintenance: $(grep -c "'maintenance' => true" /var/www/html/config/config.php 2>/dev/null)"
    while IFS= read -r line; do
        avuz_health_append "$AVUZ_HEALTH_LOG" "  nc-log     : $(printf '%s' "$line" | head -c 400)"
    done < <(tail -n 3 /var/www/html/data/nextcloud.log 2>/dev/null)
} 2>/dev/null

exit 1
