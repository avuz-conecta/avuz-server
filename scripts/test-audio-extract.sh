#!/usr/bin/env bash
# AVUZ-AUDIO-EXTRACT-V1 — regression test for the Whisper audio-extraction recipe.
# Usage: scripts/test-audio-extract.sh <input-media-file>
# Asserts: produces a non-empty mp3, <= 24MB, decodable by ffprobe.
# Uses GNU coreutils (mktemp --suffix, stat -c) — run in the Linux build/CI image.
set -euo pipefail

IN="${1:?usage: test-audio-extract.sh <input-media-file>}"
LIMIT=$((24 * 1024 * 1024))
OUT="$(mktemp --suffix=.mp3)"
trap 'rm -f "$OUT"' EXIT

extract() { # $1 = bitrate
    ffmpeg -nostdin -y -i "$IN" -vn -ac 1 -c:a libmp3lame -b:a "$1" "$OUT" >/dev/null 2>&1
}

extract 48k || { echo "FAIL: ffmpeg extraction at 48k failed"; exit 1; }
SIZE=$(stat -c %s "$OUT")
if [ "$SIZE" -gt "$LIMIT" ]; then
    echo "48k output ${SIZE}B > limit, retrying at 24k"
    extract 24k || { echo "FAIL: ffmpeg extraction at 24k failed"; exit 1; }
    SIZE=$(stat -c %s "$OUT")
fi

[ "$SIZE" -gt 0 ] || { echo "FAIL: empty output"; exit 1; }
[ "$SIZE" -le "$LIMIT" ] || { echo "FAIL: ${SIZE}B still exceeds ${LIMIT}B"; exit 1; }
ffprobe -v error -select_streams a:0 -show_entries stream=codec_name \
    -of default=nk=1:nw=1 "$OUT" | grep -q mp3 || { echo "FAIL: not a valid mp3 audio stream"; exit 1; }

echo "PASS: ${SIZE} bytes mp3 (limit ${LIMIT})"
