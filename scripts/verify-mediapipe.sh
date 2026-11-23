#!/bin/sh
# Verify the vendored MediaPipe files that Talk's virtual background depends on.
#
# These files (apps/spreed/js/vision_wasm_internal.{js,wasm}, the nosimd pair,
# and selfie_segmenter.tflite) are UNTRACKED in git (.gitignore /apps*/*), so the
# image just picks up whatever sits on the build host's disk. When the JS loader
# glue and its .wasm drift out of sync (old glue + current wasm), MediaPipe's GPU
# delegate dies at init with:
#     MediaPipe Tasks initialization failed: TypeError:
#     Cannot read properties of undefined (reading 'clear')
# and virtual background silently stops working — fleet-wide, easy to miss.
#
# This asserts the glue/wasm/model are exactly the known-good matched set, so a
# drifted build FAILS LOUD instead of shipping broken.
#
# On an INTENTIONAL MediaPipe update: recompute the hashes here, e.g.
#     for f in apps/spreed/js/vision_wasm_internal.js \
#              apps/spreed/js/vision_wasm_internal.wasm \
#              apps/spreed/js/vision_wasm_nosimd_internal.js \
#              apps/spreed/js/vision_wasm_nosimd_internal.wasm \
#              apps/spreed/js/selfie_segmenter.tflite; do sha256sum "$f"; done
# and update the block below (keep the glue and its wasm from the SAME release).
set -eu
DIR="${1:-/var/www/html/apps/spreed/js}"
echo "Verifying MediaPipe vendored files in $DIR ..."
cd "$DIR"

# Pinned set: spreed v23.0.14 release tarball (glue + wasm from the same release).
if sha256sum -c <<'EOF'
b63d073deba0fc1185f6cf6f4ef8093de65dd3da98df6de95f25599ce7428a21  vision_wasm_internal.js
6a5c64584c2ab61c763b6e204afbdbc7ce1caf7f5216187322bca8df94f646bc  vision_wasm_internal.wasm
296201eae94710e78e15211402c5b2756ef7aa7195bac2034e3827ef326d0955  vision_wasm_nosimd_internal.js
8a3092d34c79d3f57e6ba8592105e8a90f6b07c27891ffecd14cca428bfd3e31  vision_wasm_nosimd_internal.wasm
191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b  selfie_segmenter.tflite
EOF
then
  echo "✓ MediaPipe vendored files verified (glue/wasm/model matched pair)"
else
  echo "" >&2
  echo "ERROR: MediaPipe vendored files in apps/spreed/js do not match the pinned" >&2
  echo "known-good set. This is the glue/wasm drift that silently breaks Talk virtual" >&2
  echo "background (MediaPipe init: Cannot read properties of undefined (reading 'clear'))." >&2
  echo "Fix: reseed apps/spreed/js from a known-good spreed release. If this IS an" >&2
  echo "intentional MediaPipe bump, update the hashes in scripts/verify-mediapipe.sh" >&2
  echo "(glue + its wasm must come from the same release)." >&2
  exit 1
fi
