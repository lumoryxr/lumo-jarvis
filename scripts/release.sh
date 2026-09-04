#!/usr/bin/env bash
# M7-G: build a signed installer.
# Usage: scripts/release.sh 0.2.0

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <version>" >&2
  exit 1
fi
VERSION="$1"

echo "bumping version to $VERSION"
sed -i.bak "s/^version = \".*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" package.json
sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json
rm -f src-tauri/Cargo.toml.bak package.json.bak src-tauri/tauri.conf.json.bak

echo "running cargo tauri build"
cd src-tauri && cargo tauri build
cd ..

OUT="dist/release/$VERSION"
mkdir -p "$OUT"
find src-tauri/target/release/bundle -type f \( -name "*.msi" -o -name "*.exe" -o -name "*.dmg" -o -name "*.deb" -o -name "*.appimage" -o -name "*.AppImage" \) -exec cp {} "$OUT/" \;
echo "artifacts in $OUT"
ls -la "$OUT"
