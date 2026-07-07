#!/bin/bash
# Docker lifecycle helpers for the build scripts.
# macOS: auto-launch Docker Desktop for a build and, afterwards, ASK whether to
# quit it whenever Docker is running — even if this run didn't start it (so you
# can start Docker with build-base and stop it after build-push). The prompt
# defaults to KEEP, so a stray Enter never kills a Docker you were using.
# Linux: just require the daemon to be up (don't manage a server's Docker).
#
# Skip the prompt with either env var:
#   STOP_DOCKER_AFTER_BUILD=1  → quit Docker Desktop
#   KEEP_DOCKER=1              → leave it running
# With a TTY and neither set, cleanup_docker prompts (default: keep running).
# Non-interactive shells (CI/pipes) never prompt — they leave Docker running.

DOCKER_STARTED_BY_ME=0

ensure_docker() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi

  if [ "$(uname -s)" != "Darwin" ]; then
    echo "✗ Docker daemon is not running. Start it and retry." >&2
    exit 1
  fi

  echo "Docker not running — launching Docker Desktop..."
  open -a Docker
  DOCKER_STARTED_BY_ME=1

  printf "Waiting for Docker to be ready"
  local waited=0
  until docker info >/dev/null 2>&1; do
    waited=$((waited + 2))
    if [ "$waited" -gt 180 ]; then
      echo ""; echo "✗ Docker did not become ready within 180s." >&2
      exit 1
    fi
    printf "."
    sleep 2
  done
  echo " ready."
}

_stop_docker() {
  echo "Shutting down Docker Desktop (started by this build)..."
  # Prefer the official CLI (Docker Desktop 4.37+); fall back for older versions.
  docker desktop stop >/dev/null 2>&1 \
    || osascript -e 'quit app "Docker Desktop"' >/dev/null 2>&1 \
    || osascript -e 'quit app "Docker"' >/dev/null 2>&1 \
    || killall "Docker Desktop" >/dev/null 2>&1 \
    || killall Docker >/dev/null 2>&1 \
    || true
}

cleanup_docker() {
  [ "$(uname -s)" = "Darwin" ] || return 0
  # Nothing to stop if Docker isn't running.
  docker info >/dev/null 2>&1 || return 0

  if [ "$KEEP_DOCKER" = "1" ]; then
    echo "Leaving Docker Desktop running (KEEP_DOCKER=1)."
    return 0
  fi
  if [ "$STOP_DOCKER_AFTER_BUILD" = "1" ]; then
    _stop_docker
    return 0
  fi

  # No controlling terminal (CI/pipe) → don't hang on a prompt; leave it running.
  if [ ! -t 0 ] && [ ! -t 1 ]; then
    echo "Non-interactive shell — leaving Docker Desktop running."
    return 0
  fi

  local note="Docker Desktop is running."
  [ "$DOCKER_STARTED_BY_ME" = "1" ] && note="Docker Desktop was started for this build."
  printf "%s Stop it now? [y/N] " "$note"
  local answer=""
  read -r answer </dev/tty 2>/dev/null || answer=""
  case "$answer" in
    [yY] | [yY][eE][sS]) _stop_docker ;;
    *) echo "Leaving Docker Desktop running." ;;
  esac
}
