#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/../lib-docker.sh"

fail=0
assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        echo "ok - $desc"
    else
        echo "NOT OK - $desc"; echo "  expected: [$expected]"; echo "  actual:   [$actual]"; fail=1
    fi
}

# ── buildx flags ──
assert_eq "pushes straight to the registry as a Docker v2 manifest, without attestations" \
    "-t registry.avuz.app/admin/avuzconecta:2026.10.18-abc1234 --provenance=false --sbom=false --output type=registry,oci-mediatypes=false" \
    "$(docker_build_flags true registry.avuz.app/admin/avuzconecta:2026.10.18-abc1234)"

assert_eq "tags every image name it is given" \
    "-t registry.avuz.app/admin/avuzconecta:2026.10.18-abc1234 -t registry.avuz.app/admin/avuzconecta:latest --provenance=false --sbom=false --output type=registry,oci-mediatypes=false" \
    "$(docker_build_flags true registry.avuz.app/admin/avuzconecta:2026.10.18-abc1234 registry.avuz.app/admin/avuzconecta:latest)"

assert_eq "tags a repeated name once (staging: version and latest are both :staging)" \
    "-t registry.avuz.app/admin/avuzconecta:staging --provenance=false --sbom=false --output type=registry,oci-mediatypes=false" \
    "$(docker_build_flags true registry.avuz.app/admin/avuzconecta:staging registry.avuz.app/admin/avuzconecta:staging)"

assert_eq "loads a local build into the local image store instead of pushing" \
    "-t avuzconecta:latest --load" \
    "$(docker_build_flags false avuzconecta:latest avuzconecta:latest)"

# ── --no-latest ──
assert_eq "keeps :latest by default" \
    "false|latest prod s3" \
    "$(parse_no_latest latest prod s3; echo "$SKIP_LATEST|${BUILD_ARGS[*]}")"

assert_eq "drops :latest and the flag itself when --no-latest is passed anywhere" \
    "true|2026.10.18-abc1234 prod" \
    "$(parse_no_latest 2026.10.18-abc1234 --no-latest prod; echo "$SKIP_LATEST|${BUILD_ARGS[*]}")"

exit $fail
