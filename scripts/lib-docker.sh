#!/bin/bash
# Docker lifecycle helpers for the build scripts.
# macOS: auto-launch the Docker runtime (OrbStack if installed, else Docker Desktop) for a build and, afterwards, ASK whether to
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

# Which Mac Docker runtime to manage: OrbStack if installed, else Docker Desktop.
# Override with DOCKER_RUNTIME=orbstack|desktop.
_docker_runtime() {
  if [ -n "$DOCKER_RUNTIME" ]; then echo "$DOCKER_RUNTIME"; return; fi
  if command -v orb >/dev/null 2>&1 || [ -d /Applications/OrbStack.app ]; then
    echo orbstack
  else
    echo desktop
  fi
}
_runtime_name() { [ "$(_docker_runtime)" = orbstack ] && echo OrbStack || echo "Docker Desktop"; }

ensure_docker() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi

  if [ "$(uname -s)" != "Darwin" ]; then
    echo "✗ Docker daemon is not running. Start it and retry." >&2
    exit 1
  fi

  echo "Docker not running — launching $(_runtime_name)..."
  if [ "$(_docker_runtime)" = orbstack ]; then
    orb start >/dev/null 2>&1 || open -a OrbStack
  else
    open -a Docker
  fi
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
  if [ "$(_docker_runtime)" = orbstack ]; then
    echo "Stopping OrbStack..."
    orb stop >/dev/null 2>&1 || osascript -e 'quit app "OrbStack"' >/dev/null 2>&1 || true
    return 0
  fi
  echo "Shutting down Docker Desktop..."
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
    echo "Leaving $(_runtime_name) running (KEEP_DOCKER=1)."
    return 0
  fi
  if [ "$STOP_DOCKER_AFTER_BUILD" = "1" ]; then
    _stop_docker
    return 0
  fi

  # No controlling terminal (CI/pipe) → don't hang on a prompt; leave it running.
  if [ ! -t 0 ] && [ ! -t 1 ]; then
    echo "Non-interactive shell — leaving $(_runtime_name) running."
    return 0
  fi

  local note="$(_runtime_name) is running."
  [ "$DOCKER_STARTED_BY_ME" = "1" ] && note="$(_runtime_name) was started for this build."
  printf "%s Stop it now? [y/N] " "$note"
  local answer=""
  read -r answer </dev/tty 2>/dev/null || answer=""
  case "$answer" in
    [yY] | [yY][eE][sS]) _stop_docker ;;
    *) echo "Leaving $(_runtime_name) running." ;;
  esac
}

# `docker buildx build` tag + output flags, space-separated, for: <push> <tag>...
# push=true sends the image straight to the registry as a Docker v2 manifest
# with no attestations. registry.avuz.app answers "manifest invalid" to the OCI
# index + attestation manifests that `--load` then `docker push` uploads when the
# runtime uses the containerd image store (OrbStack, recent Docker Desktop).
# push=false loads the image into the local store. Repeated tags appear once.
docker_build_flags() {
  local push="$1" tag flags=""
  shift
  for tag in "$@"; do
    case " $flags " in *" -t $tag "*) continue ;; esac
    flags="$flags -t $tag"
  done
  if [ "$push" = true ]; then
    flags="$flags --provenance=false --sbom=false --output type=registry,oci-mediatypes=false"
  else
    flags="$flags --load"
  fi
  printf '%s' "${flags# }"
}

# Strips --no-latest from the script arguments. Sets SKIP_LATEST (true|false)
# and BUILD_ARGS (the remaining arguments, in order).
parse_no_latest() {
  local arg
  SKIP_LATEST=false
  BUILD_ARGS=()
  for arg in "$@"; do
    if [ "$arg" = "--no-latest" ]; then
      SKIP_LATEST=true
    else
      BUILD_ARGS+=("$arg")
    fi
  done
}
