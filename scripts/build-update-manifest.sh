#!/usr/bin/env bash
# M8-B: build the update manifest for Tauri auto-updater.
# Usage: scripts/build-update-manifest.sh 0.2.0 dist/release/0.2.0/lumo-jarvis_0.2.0_x64-setup.exe

set -euo pipefail
if [[ $# -lt 2 ]]; then
  echo "usage: $0 <version> <path-to-installer>" >&2
  exit 1
fi
VERSION="$1"
INSTALLER="$2"

# Tauri reads JSON like:
# { "version": "0.2.0", "platforms": { "windows-x86_64": { "signature": "...", "url": "..." } } }
# Signing is left to the CI; here we just generate the manifest with
# placeholders so the wiring can be verified end-to-end.

PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
TARGET="${PLATFORM}-${ARCH}"

OUT_DIR="$(dirname "$INSTALLER")/update"
mkdir -p "$OUT_DIR"

cat > "$OUT_DIR/${VERSION}.json" <<EOF
{
  "version": "${VERSION}",
  "platforms": {
    "${TARGET}": {
      "url": "https://github.com/lumoryxr/lumo-jarvis/releases/download/v${VERSION}/$(basename "$INSTALLER")",
      "signature": "<minisign signature goes here>",
      "version": "${VERSION}"
    }
  }
}
EOF
echo "wrote $OUT_DIR/${VERSION}.json"
cat "$OUT_DIR/${VERSION}.json"
