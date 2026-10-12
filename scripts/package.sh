#!/usr/bin/env bash
# Build OmniTODO desktop installers (design §15 / §16 P6).
#
#   scripts/package.sh [bundles]
#
# `bundles` is a comma-separated Tauri bundle target list; the default covers
# every format the host platform can produce. Needs the platform's native
# WebView build deps (see docs/packaging.md); for a headless Linux box without
# root access use scripts/package-linux-docker.sh instead.
set -euo pipefail

bundles="${1:-deb,appimage,rpm}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

echo "==> 1/4 frontend (ui/dist)"
npm --prefix ui ci --no-audit --no-fund || npm --prefix ui install --no-audit --no-fund
npm --prefix ui run build

echo "==> 2/4 tauri CLI"
npm --prefix omnitodo-desktop install --no-audit --no-fund

echo "==> 3/4 MCP sidecar (binaries/omnitodo-mcp-<triple>)"
node scripts/build-sidecar.mjs

echo "==> 4/4 tauri bundle: $bundles"
(cd omnitodo-desktop && npx tauri build --bundles "$bundles")

target="${CARGO_TARGET_DIR:-omnitodo-desktop/target}"
echo
echo "artifacts:"
find "$target/release/bundle" -maxdepth 2 -type f \
  \( -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' -o -name '*.dmg' -o -name '*.msi' -o -name '*.exe' \) \
  -printf '  %p\n' 2>/dev/null | sort
