#!/usr/bin/env bash
# Cross-build the Windows installer on Linux (design §15 / §16 P6).
#
# Tauri can cross-compile to `x86_64-pc-windows-msvc` with cargo-xwin: the MSVC
# CRT/SDK are fetched from Microsoft into ~/.xwin-cache, clang-cl compiles the C
# parts (the bundled SQLite), lld-link links, and `makensis` produces the NSIS
# installer. This is how the Windows artifact in `artifacts/` was produced
# without a Windows machine.
#
# Caveats, up front:
#   - the installer is **unsigned** (signing needs a Windows host, or a custom
#     `bundle.windows.sign_command`);
#   - `--bundles msi` still requires WiX, which only runs on Windows — use NSIS;
#   - the result cannot be smoke-tested here; run it on Windows before shipping.
#
# Prerequisites (Debian/Ubuntu):
#   apt-get install -y llvm clang lld nsis
#   rustup target add x86_64-pc-windows-msvc
#   cargo install cargo-xwin --locked
#
#   scripts/package-windows-cross.sh [bundles]      # default: nsis
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bundles="${1:-nsis}"
target="x86_64-pc-windows-msvc"
cli="$root/omnitodo-desktop/node_modules/@tauri-apps/cli/tauri.js"

case ",$bundles," in
  *",msi,"*)
    # Verified, not assumed: WiX 5 installs and runs on Linux (`wix --version`
    # works) but every build fails with `WIX0389: The Directory/@Name
    # attribute's value ... is not a relative path`, whatever the value is —
    # its path validation is broken off Windows. NSIS has no such problem.
    # See the "为什么 MSI 不能在 Linux 上交叉构建" section in docs/packaging.md.
    echo "error: MSI cannot be cross-built from Linux — WiX's path validation fails" >&2
    echo "       off Windows (WIX0389). Build it on a Windows host instead;" >&2
    echo "       use 'nsis' here. Details: docs/packaging.md" >&2
    exit 2
    ;;
esac

for tool in makensis lld-link llvm-rc; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool (apt-get install llvm clang lld nsis)" >&2; exit 3; }
done
command -v cargo-xwin >/dev/null || { echo "missing cargo-xwin (cargo install cargo-xwin --locked)" >&2; exit 3; }
rustc --print target-libdir --target "$target" >/dev/null 2>&1 || {
  echo "missing target std (rustup target add $target)" >&2; exit 3; }
[ -f "$cli" ] || { echo "missing Tauri CLI (npm install in omnitodo-desktop/)" >&2; exit 3; }
[ -d "$root/ui/dist" ] || { echo "missing ui/dist (run 'npm run build' in ui/)" >&2; exit 3; }

# cargo-xwin drives the `cc` crate through clang-cl; Debian ships clang without
# that name, and clang-cl is just clang in CL mode.
if ! command -v clang-cl >/dev/null; then
  clang_bin="$(command -v clang-19 || command -v clang || true)"
  [ -n "$clang_bin" ] || { echo "missing clang" >&2; exit 3; }
  echo "==> linking clang-cl -> $clang_bin"
  ln -sf "$clang_bin" /usr/local/bin/clang-cl
fi

echo "==> cross-compiling the omnitodo-mcp sidecar ($target)"
cargo xwin build -p omnitodo-mcp --release --target "$target"
mcp="$CARGO_TARGET_DIR/${target}/release/omnitodo-mcp.exe"
[ -f "$mcp" ] || mcp="$root/target/${target}/release/omnitodo-mcp.exe"
mkdir -p "$root/omnitodo-desktop/binaries"
cp "$mcp" "$root/omnitodo-desktop/binaries/omnitodo-mcp-${target}.exe"

echo "==> bundling $bundles"
# The frontend was built above; skipping beforeBuildCommand keeps npm out of it.
(cd "$root/omnitodo-desktop" && node node_modules/@tauri-apps/cli/tauri.js build \
  --runner cargo-xwin --target "$target" --bundles "$bundles" \
  --config '{"build":{"beforeBuildCommand":""}}')

bundle_root="${CARGO_TARGET_DIR:-$root/omnitodo-desktop/target}/${target}/release/bundle"
echo "==> collecting artifacts"
mkdir -p "$root/artifacts"
found=0
for f in "$bundle_root"/nsis/*.exe "$bundle_root"/msi/*.msi; do
  [ -f "$f" ] || continue
  cp "$f" "$root/artifacts/"
  echo "    artifacts/$(basename "$f")"
  found=1
done
[ "$found" = 1 ] || { echo "error: no installer produced under $bundle_root" >&2; exit 4; }
