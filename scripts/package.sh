#!/usr/bin/env bash
# Build OmniTODO desktop installers (design §15 / §16 P6).
#
#   scripts/package.sh [bundles]
#
# `bundles` is a comma-separated Tauri bundle target list; the default covers
# every format the host platform can produce. Needs the platform's native
# WebView build deps (see docs/packaging.md); for a headless Linux box without
# root access use scripts/package-linux-docker.sh instead.
#
# macOS `.dmg`: `bundle_dmg.sh` finishes by asking Finder (via AppleScript) to
# prettify the layout, which fails with an AppleEvent timeout (-1712) on a build
# host that has no Finder automation permission. Tauri skips that step when `CI`
# is set, so we export it by default and still produce a working `.dmg` (just
# without the custom icon arrangement). Set `OMNITODO_PRETTY_DMG=1` on a real
# desktop session to keep the Finder layout.
set -euo pipefail

os="$(uname -s)"
case "$os" in
  Linux*)  platform_bundles="deb,appimage,rpm" ;;
  Darwin*) platform_bundles="dmg,app" ;;
  MINGW*|MSYS*|CYGWIN*) platform_bundles="nsis,msi" ;;
  *)       platform_bundles="deb,appimage,rpm" ;;
esac
bundles="${1:-$platform_bundles}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

echo "==> 1/4 frontend (ui/dist)"
# `cd` into the package rather than `npm --prefix <dir>`: on native Windows
# (MSYS/Git Bash, npm 10) a leading `--prefix` makes `npm install` look for
# package.json in the repo root and fail with ENOENT.
(cd ui && npm ci --no-audit --no-fund) || (cd ui && npm install --no-audit --no-fund)
(cd ui && npm run build)

echo "==> 2/4 tauri CLI"
(cd omnitodo-desktop && npm install --no-audit --no-fund)

echo "==> 3/4 MCP sidecar (binaries/omnitodo-mcp-<triple>)"
node scripts/build-sidecar.mjs

echo "==> 4/4 tauri bundle: $bundles"
# See the header: keep the Finder-prettified .dmg only when asked for.
if [ "$os" = Darwin ] && [ -z "${OMNITODO_PRETTY_DMG:-}" ]; then
  export CI=true
fi
(cd omnitodo-desktop && npx tauri build --bundles "$bundles")

target="${CARGO_TARGET_DIR:-omnitodo-desktop/target}"
echo
echo "artifacts:"
find "$target/release/bundle" -maxdepth 2 -type f \
  \( -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' -o -name '*.dmg' -o -name '*.msi' -o -name '*.exe' \) \
  -print 2>/dev/null | sed 's/^/  /' | sort
