#!/usr/bin/env bash
# Run every headless check for the OmniTODO workspace.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.cargo/bin:$PATH"

echo "== cargo test (core + cli + mcp) =="
cargo test --workspace

echo "== cargo clippy =="
cargo clippy --workspace --all-targets -- -D warnings

# omnitodo-desktop is its own workspace (excluded from the root one), so it gets
# linted separately. It needs the Tauri system libraries to link, which a bare
# host usually lacks — skip with a note instead of failing the whole run.
if pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  echo "== cargo clippy (omnitodo-desktop) =="
  cargo clippy --manifest-path omnitodo-desktop/Cargo.toml --all-targets -- -D warnings
else
  echo "== cargo clippy (omnitodo-desktop) =="
  echo "skip (webkit2gtk-4.1 dev libs missing; covered by scripts/package-linux-docker.sh)"
fi

echo "== ui: unit tests + typecheck + build =="
if [ -d ui/node_modules ]; then
  (cd ui && npm test && npm run build)
else
  echo "skip (run 'npm install' in ui/ first)"
fi

echo "ALL CHECKS PASSED"
