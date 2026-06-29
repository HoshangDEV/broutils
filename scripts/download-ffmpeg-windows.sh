#!/usr/bin/env bash
set -e

OUT="src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe"

if [ -f "$OUT" ]; then
  echo "Already exists: $OUT"
  exit 0
fi

echo "Downloading ffmpeg Windows binary..."
curl -L --progress-bar -o /tmp/ffmpeg-win64.zip \
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
unzip -j /tmp/ffmpeg-win64.zip "*/bin/ffmpeg.exe" -d src-tauri/binaries/
mv src-tauri/binaries/ffmpeg.exe "$OUT"
rm /tmp/ffmpeg-win64.zip
echo "Done: $OUT"
