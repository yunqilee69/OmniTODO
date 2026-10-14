#!/usr/bin/env bash
# Verify the global quick-add shortcut actually raises the quick-add panel
# (design §12: “全局快捷键唤起快捷添加窗”, §16 P2 托盘 + 快捷添加).
#
# `shortcut.rs` registers Ctrl+Shift+Space and emits `quickadd:open`; a bare
# Xvfb is enough to exercise the whole chain, because the shortcut is X-global
# (no WM needed) and xdotool can synthesise the keystroke. The evidence is a
# screenshot: the floating input box must appear over the content pane.
#
#   scripts/smoke-shortcut-xvfb.sh --bin /usr/bin/omnitodo-desktop \
#                                  --cli /build-target/release/omnitodo
#
# Needs: xvfb, xauth, dbus-x11, xdotool, imagemagick, fonts-noto-cjk.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin="${OMNITODO_BIN:-/usr/bin/omnitodo-desktop}"
cli="${OMNITODO_CLI:-$root/target/release/omnitodo}"
out="${OMNITODO_OUT:-$root/artifacts/smoke-shortcut}"
geometry="1440x900x24"

while [ $# -gt 0 ]; do
  case "$1" in
    --bin) bin="$2"; shift 2 ;;
    --cli) cli="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --geometry) geometry="$2"; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

for tool in Xvfb xdotool import xauth; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 3; }
done
[ -x "$bin" ] || { echo "app binary not found: $bin" >&2; exit 3; }
[ -x "$cli" ] || { echo "cli binary not found: $cli" >&2; exit 3; }

home="$(mktemp -d /tmp/omnitodo-shortcut-XXXXXX)"
mkdir -p "$out"
rm -f "$out"/*.png "$out"/*.log
export HOME="$home"
db="$HOME/.omnitodo/omnitodo.db"

echo "==> seeding one task ($db)"
"$cli" init >/dev/null
"$cli" --db "$db" project add "工作" >/dev/null

export SC_BIN="$bin" SC_OUT="$out"
steps="$(cat <<'EOF'
set -uo pipefail
export WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
export GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1
eval "$(dbus-launch --sh-syntax)"

"$SC_BIN" > "$SC_OUT/app.log" 2>&1 &
APP=$!
trap 'kill $APP 2>/dev/null; [ -n "${DBUS_SESSION_BUS_PID:-}" ] && kill $DBUS_SESSION_BUS_PID 2>/dev/null' EXIT
sleep 14

WID=$(xdotool search --name '^OmniTODO$' | head -1)
[ -n "$WID" ] || { echo "FAIL: no OmniTODO window appeared"; sed -n '1,40p' "$SC_OUT/app.log"; exit 1; }
xdotool windowfocus $WID 2>/dev/null || true
import -window root "$SC_OUT/01-before-shortcut.png"

# The registered accelerator is CmdOrCtrl+Shift+Space. Fire it twice with a
# pause: a single synthetic chord can occasionally race the shortcut daemon.
xdotool key --window $WID ctrl+shift+space
sleep 2
xdotool key ctrl+shift+space
sleep 2.5
import -window root "$SC_OUT/02-after-shortcut.png"
echo "steps done"
EOF
)"

echo "==> running the app on a virtual display ($geometry)"
xvfb-run -a --server-args="-screen 0 $geometry" bash -c "$steps"

echo
echo "==> assertions"
status=0

# The quick-add panel is a floating input box anchored below the sidebar's
# 添加任务 button, spilling into the content pane. Compare the two frames:
# pressing the shortcut must change that region, and the after-frame must
# contain the panel. Compare the overlap region rather than the whole frame:
# both frames are otherwise static, so a whole-screen mean barely moves.
delta=$(python3 - "$out/01-before-shortcut.png" "$out/02-after-shortcut.png" <<'PY'
import subprocess, sys
# Region covering the floating panel over the main pane: x>=240, y<200.
CROP = "860x200+240+0"
def mean(path):
    o = subprocess.run(["convert", path, "-crop", CROP, "+repage", "-colorspace", "gray",
                        "-format", "%[fx:mean]", "info:"],
                       capture_output=True, text=True, check=True).stdout.strip()
    return float(o)
try:
    print(abs(mean(sys.argv[1]) - mean(sys.argv[2])))
except Exception:
    print("0")
PY
)
if python3 -c "import sys; sys.exit(0 if ${delta:-0} > 0.002 else 1)"; then
  echo "  ok   the main pane changed after the shortcut (Δmean=$delta)"
else
  echo "  FAIL Ctrl+Shift+Space left the main pane unchanged (Δmean=$delta)"
  status=1
fi

size=$(stat -c %s "$out/02-after-shortcut.png" 2>/dev/null || echo 0)
if [ "$size" -lt 8000 ]; then
  echo "  FAIL 02-after-shortcut.png — only ${size}B, looks blank"
  status=1
else
  echo "  ok   02-after-shortcut.png — ${size}B"
fi

if grep -qiE "panicked|thread 'main'.*panic" "$out/app.log"; then
  echo "  FAIL app.log contains a panic"
  status=1
fi

echo
[ "$status" -eq 0 ] && echo "SHORTCUT OK — review $out/02-after-shortcut.png" \
                     || echo "SHORTCUT CHECK FAILED"
exit "$status"