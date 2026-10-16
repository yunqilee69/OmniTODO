#!/usr/bin/env bash
# Build the Linux installers (deb / AppImage / rpm) without touching the host
# system: the Rust toolchain and the WebKitGTK build deps live in a throwaway
# container. Only Docker is required on the host.
#
#   scripts/package-linux-docker.sh [bundles]     # default: deb,appimage
#
# Artifacts are copied to ./artifacts/. This is the path used to verify the
# Linux packaging on a headless machine (see docs/packaging.md).
set -euo pipefail

bundles="${1:-deb,appimage}"
image="${IMAGE:-rust:1-trixie}"
name="${CONTAINER:-omnitodo-package}"
registry="${NPM_REGISTRY:-https://registry.npmmirror.com}"
# Node comes from the official tarball rather than apt: Debian trixie's npm (9.x)
# cannot resolve the current @tauri-apps/cli metadata at all — it dies with
# `ERR_INVALID_ARG_TYPE: The "path" argument must be of type string. Received
# null` before fetching anything, and the same install succeeds on npm 10.
node_version="${NODE_VERSION:-22.20.0}"
node_mirror="${NODE_MIRROR:-https://nodejs.org/dist}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
uid="$(id -u)"
gid="$(id -g)"

cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# The AppImage bundler downloads AppRun / linuxdeploy from GitHub release assets,
# which are unreachable from some networks. Forward any proxy the host already
# uses so the download succeeds (attohttpc honours these env vars).
proxy_args=()
for v in HTTP_PROXY HTTPS_PROXY http_proxy https_proxy NO_PROXY no_proxy; do
  [ -n "${!v:-}" ] && proxy_args+=(-e "$v=${!v}")
done

echo "==> starting build container ($image)"
docker rm -f "$name" >/dev/null 2>&1 || true
# `label=disable` is for SELinux hosts (Fedora/RHEL): the repo carries
# `user_home_t`, so a plain bind mount gives the container nothing at all — even
# `ls /work` is denied. What that looks like from inside is misleading: npm only
# reports `EACCES: permission denied, open '.../package-lock.json'`, then Arborist's
# shrinkwrap save crashes with an `ERR_INVALID_ARG_TYPE ... Received null` that has
# nothing to do with npm versions. The alternative is mounting `:z`, which relabels
# the entire working tree to `container_file_t` on the host (revert with
# `restorecon -R -F .`); disabling label separation for this throwaway container has
# no host side effects and is a no-op where SELinux is off.
docker run -d --name "$name" \
  --security-opt label=disable \
  -v "$root:/work" \
  -v omnitodo-build-target:/build-target \
  -v "$HOME/.cargo/config.toml:/usr/local/cargo/config.toml:ro" \
  "${proxy_args[@]}" \
  -e CARGO_TARGET_DIR=/build-target \
  -w /work "$image" sleep infinity >/dev/null

echo "==> installing Linux GUI build deps (WebKitGTK, GTK3, appindicator)"
docker exec "$name" bash -c '
  export DEBIAN_FRONTEND=noninteractive
  cat > /etc/apt/sources.list.d/debian.sources <<EOF
Types: deb
URIs: https://mirrors.aliyun.com/debian
Suites: trixie trixie-updates
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.pgp

Types: deb
URIs: https://mirrors.aliyun.com/debian-security
Suites: trixie-security
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.pgp
EOF
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends \
    build-essential pkg-config file curl wget unzip git ca-certificates libssl-dev \
    libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev \
    librsvg2-dev libayatana-appindicator3-dev patchelf'

echo "==> installing Node $node_version (official tarball)"
docker exec "$name" bash -c "
  set -e
  curl -fsSL -o /tmp/node.tar.xz '$node_mirror/v$node_version/node-v$node_version-linux-x64.tar.xz'
  mkdir -p /opt/node
  tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1
  rm -f /tmp/node.tar.xz
  for bin in node npm npx; do ln -sf /opt/node/bin/\$bin /usr/local/bin/\$bin; done
  node --version; npm --version"

# The Tauri CLI is a Node package wrapping a prebuilt native addon, so no Rust
# compilation of the CLI itself is needed inside the container.
echo "==> installing @tauri-apps/cli"
docker exec -w /work/omnitodo-desktop "$name" bash -c \
  "npm install --no-audit --no-fund --registry=$registry"

echo "==> frontend (ui/dist)"
docker exec -w /work/ui "$name" bash -c \
  "npm ci --no-audit --no-fund --registry=$registry || npm install --no-audit --no-fund --registry=$registry; npm run build"

echo "==> MCP sidecar"
docker exec -w /work "$name" bash -c '
  export PATH=/usr/local/cargo/bin:$PATH
  cargo build --release -p omnitodo-mcp
  triple=$(rustc -vV | sed -n "s/^host: //p")
  mkdir -p omnitodo-desktop/binaries
  cp "${CARGO_TARGET_DIR:-target}/release/omnitodo-mcp" \
     "omnitodo-desktop/binaries/omnitodo-mcp-$triple"
  echo "sidecar: omnitodo-desktop/binaries/omnitodo-mcp-$triple"'

echo "==> tauri bundle: $bundles"
docker exec -w /work/omnitodo-desktop "$name" bash -c "
  export PATH=/usr/local/cargo/bin:\$PATH
  node node_modules/@tauri-apps/cli/tauri.js build --bundles $bundles \
    --config '{\"build\":{\"beforeBuildCommand\":\"\"}}'"

echo "==> collecting artifacts"
mkdir -p "$root/artifacts"
docker exec "$name" bash -c "cd /build-target/release/bundle && \
  find . -maxdepth 2 -type f \( -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' \) \
       -exec cp {} /work/artifacts/ \;"
# Files created inside the container are root-owned; hand them back.
docker exec "$name" bash -c "chown -R $uid:$gid /work/artifacts /work/omnitodo-desktop/binaries \
  /work/omnitodo-desktop/gen /work/ui/dist /work/ui/node_modules 2>/dev/null || true"
ls -la "$root/artifacts"
