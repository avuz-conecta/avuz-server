#!/usr/bin/env bash
# AVUZ-AUDIO-CHUNK-V1 — regression test for the Whisper extract+segment recipe.
# Usage: scripts/test-audio-extract.sh <input-media-file>
# Asserts: 48k mono extraction (no 24k downgrade), then segmentation into parts
# that each stay <= 24MB and decode as mp3. A >66min input must yield >= 2 parts
# (proves chunking actually happens; a single 48k mp3 of that length exceeds the
# 25MB OpenAI cap and is why we segment). Mirrors OpenAiAPIService's ffmpeg calls.
# Uses GNU coreutils (stat -c, mktemp -d) — run in the Linux build/CI image.
set -euo pipefail

IN="${1:?usage: test-audio-extract.sh <input-media-file>}"
LIMIT=$((24 * 1024 * 1024))
SEGMENT_SECONDS=3600
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

MP3="$WORK/audio.mp3"
ffmpeg -nostdin -y -i "$IN" -vn -ac 1 -c:a libmp3lame -b:a 48k "$MP3" >/dev/null 2>&1 \
    || { echo "FAIL: ffmpeg 48k extraction failed"; exit 1; }
[ -s "$MP3" ] || { echo "FAIL: empty extraction"; exit 1; }

ffmpeg -nostdin -y -i "$MP3" -f segment -segment_time "$SEGMENT_SECONDS" -c copy \
    "$WORK/part_%03d.mp3" >/dev/null 2>&1 \
    || { echo "FAIL: ffmpeg segmentation failed"; exit 1; }

PARTS=("$WORK"/part_*.mp3)
[ -e "${PARTS[0]}" ] || { echo "FAIL: segmentation produced no parts"; exit 1; }

for part in "${PARTS[@]}"; do
    size=$(stat -c %s "$part")
    [ "$size" -gt 0 ]       || { echo "FAIL: empty part $(basename "$part")"; exit 1; }
    [ "$size" -le "$LIMIT" ] || { echo "FAIL: $(basename "$part") ${size}B > ${LIMIT}B cap"; exit 1; }
    ffprobe -v error -select_streams a:0 -show_entries stream=codec_name \
        -of default=nk=1:nw=1 "$part" | grep -q mp3 \
        || { echo "FAIL: $(basename "$part") is not a valid mp3 stream"; exit 1; }
done

# A long input must actually split; a short one legitimately stays single-part.
DURATION=$(ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "$MP3" | cut -d. -f1)
if [ "${DURATION:-0}" -gt $((SEGMENT_SECONDS + 60)) ] && [ "${#PARTS[@]}" -lt 2 ]; then
    echo "FAIL: ${DURATION}s input but only ${#PARTS[@]} part — chunking did not trigger"; exit 1
fi

echo "PASS: ${#PARTS[@]} part(s), each <= ${LIMIT}B, all valid mp3 (input ${DURATION:-?}s)"
