#!/usr/bin/env bash
# Runs the Forms PHPUnit suite inside a throwaway local Nextcloud 33.0.8 container (SQLite, no Avuz hosts).
# Usage: phpunit.sh [phpunit args]   e.g. --filter OptionsTest
# Install happens on a named volume WITHOUT the bind mount (the image entrypoint rsync --delete
# would wipe a mounted apps/forms); the port tree is mounted on the second start.
set -euo pipefail
PORT_TREE="${FORMS_PORT_TREE:-/Users/patrickrezende/work/avuz/forms-port}"
NAME=${FORMS_PORT_NAME:-forms-port-test}
VOLUME=${FORMS_PORT_VOLUME:-forms-port-test-html}
IMAGE=nextcloud:33.0.8
# release images ship no tests/; sparse clone: git clone --depth 1 --branch v33.0.8 --filter=blob:none --sparse https://github.com/nextcloud/server && git sparse-checkout set tests
SERVER_TESTS="${FORMS_PORT_SERVER_TESTS:-/Users/patrickrezende/work/avuz/forms-port-upstream/server-v33.0.8/tests}"

WAIT_SECONDS=${FORMS_PORT_WAIT_SECONDS:-300}
MARKER=/var/www/html/.forms-port-installed

wait_for_install() {
  local container=$1 waited=0
  until docker exec -u www-data "$container" php occ status 2>/dev/null | grep -q 'installed: true'; do
    sleep 3; waited=$((waited + 3))
    if [ "$waited" -ge "$WAIT_SECONDS" ]; then echo "install timed out after ${WAIT_SECONDS}s" >&2; return 1; fi
  done
}

volume_installed() {
  docker volume ls -q | grep -qx "$VOLUME" &&
    docker run --rm --entrypoint test -v "$VOLUME":/var/www/html "$IMAGE" -f "$MARKER"
}

install_volume() {
  docker rm -f "$NAME-install" >/dev/null 2>&1 || true
  docker volume rm -f "$VOLUME" >/dev/null
  trap 'docker rm -f "$NAME-install" >/dev/null 2>&1 || true' EXIT INT TERM
  docker run -d --name "$NAME-install" -v "$VOLUME":/var/www/html \
    -e SQLITE_DATABASE=nextcloud -e NEXTCLOUD_ADMIN_USER=throwaway \
    -e NEXTCLOUD_ADMIN_PASSWORD="$(openssl rand -hex 16)" "$IMAGE" >/dev/null
  wait_for_install "$NAME-install"
  docker exec "$NAME-install" touch "$MARKER"
  docker rm -f "$NAME-install" >/dev/null
  trap - EXIT INT TERM
}

if ! volume_installed; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  install_volume
fi
volume_installed || { echo "volume not installed; refusing to bind-mount the port tree" >&2; exit 1; }

if ! docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  docker run -d --name "$NAME" -v "$VOLUME":/var/www/html \
    -v "$PORT_TREE":/var/www/html/apps/forms "$IMAGE" >/dev/null
  wait_for_install "$NAME"
  docker cp "$SERVER_TESTS" "$NAME":/var/www/html/tests
  docker exec "$NAME" chown -R www-data:www-data /var/www/html/tests
  docker exec -u www-data "$NAME" php occ app:enable forms
else
  docker start "$NAME" >/dev/null
fi
docker exec -u www-data -w /var/www/html/apps/forms "$NAME" vendor/bin/phpunit -c tests/phpunit.xml "$@"
