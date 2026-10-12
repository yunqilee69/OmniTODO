#!/usr/bin/env bash
# Verify deep links actually reach the app and focus the right task
# (design §9: “点击通知经 deep-link `omnitodo://task/<id>` 聚焦到该任务”,
# §11: MCP resource URIs `omnitodo://task/{id}` / `omnitodo://projects`).
#
# The scheme is registered by the installed package
# (`x-scheme-handler/omnitodo` in OmniTODO.desktop), so this can be driven
# end-to-end on a virtual display: launch the app, invoke the URL through the
# desktop's own handler, and check the detail panel opened for that task.
#
#   scripts/smoke-deeplink-xvfb.sh --bin /usr/bin/omnitodo-desktop \
#                                  --cli /build-target/release/omnitodo
#
# Needs: xvfb, xauth, dbus-x11, xdotool, xdg-utils (xdg-open), imagemagick,
# fonts-noto-cjk, and the app installed so the scheme handler is registered.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin="${OMNITODO_BIN:-/usr/bin/omnitodo-desktop}"
cli="${OMNITODO_CLI:-$root/target/release/omnitodo}"
out="${OMNITODO_OUT:-$root/artifacts/smoke-deeplink}"
geometry="1440x900x24"

while [ $# -gt 0 ]; do
  case "$1" in
    --bin) bin="$2"; shift 2 ;;
    --cli) cli="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --geometry) geometry="$2"; shift 2 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

for tool in Xvfb xdotool import xauth xdg-open; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 3; }
done
[ -x "$bin" ] || { echo "app binary not found: $bin" >&2; exit 3; }
[ -x "$cli" ] || { echo "cli binary not found: $cli" >&2; exit 3; }

desktop="/usr/share/applications/OmniTODO.desktop"
[ -f "$desktop" ] || { echo "the omnitodo:// scheme is not registered (install the deb first)" >&2; exit 3; }
grep -q "x-scheme-handler/omnitodo" "$desktop" || {
  echo "$desktop has no x-scheme-handler/omnitodo" >&2; exit 3; }

home="$(mktemp -d /tmp/omnitodo-deeplink-XXXXXX)"
mkdir -p "$out"
rm -f "$out"/*.png "$out"/*.log
export HOME="$home"
db="$HOME/.local/share/omnitodo/omnitodo.db"

echo "==> seeding two tasks so the focused one is unambiguous ($db)"
"$cli" init >/dev/null
"$cli" --db "$db" task add "DeepLinkTargetTask" >/dev/null
"$cli" --db "$db" task add "SomeOtherTask" >/dev/null
target_id=$("$cli" --db "$db" export --format json | python3 -c \
  'import json,sys; print(next(t["id"] for t in json.load(sys.stdin) if t["title"]=="DeepLinkTargetTask"))')

export DL_BIN="$bin" DL_OUT="$out" DL_HOME="$home" DL_TARGET="$target_id"
steps="$(cat <<'EOF'
set -uo pipefail
export WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
export GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1
eval "$(dbus-launch --sh-syntax)"

"$DL_BIN" > "$DL_OUT/app.log" 2>&1 &
APP=$!
trap 'kill $APP 2>/dev/null; [ -n "${DBUS_SESSION_BUS_PID:-}" ] && kill $DBUS_SESSION_BUS_PID 2>/dev/null' EXIT
sleep 14

WID=$(xdotool search --name '^OmniTODO$' | head -1)
[ -n "$WID" ] || { echo "FAIL: no OmniTODO window appeared"; sed -n '1,40p' "$DL_OUT/app.log"; exit 1; }
xdotool windowfocus $WID 2>/dev/null || true
import -window root "$DL_OUT/01-before-deeplink.png"

# Hand the URL over exactly as a notification click or an MCP client would.
#
# On Windows and Linux the OS starts a new process with the URL as a CLI
# argument (the deep-link plugin documents this), and single-instance forwards
# it to the running window. Going through the installed .desktop's own Exec
# line keeps this faithful to what the shell does — xdg-open is avoided because
# it needs a populated xdg-mime database, which a bare container lacks.
# shellcheck disable=SC2046
"$DL_BIN" "omnitodo://task/$DL_TARGET" >/dev/null 2>&1 || true
sleep 6
import -window root "$DL_OUT/02-after-deeplink.png"
echo "steps done"
EOF
)"

echo "==> running the app on a virtual display ($geometry)"
xvfb-run -a --server-args="-screen 0 $geometry" bash -c "$steps"

echo
echo "==> assertions"
status=0

# 1. The URL reached the app: the detail panel opened and is a visible change.
#    The panel is a ~380px right-hand column of the 1100px window; comparing that
#    strip is far more sensitive than the whole frame, which is mostly white.
delta=$(python3 - "$out/01-before-deeplink.png" "$out/02-after-deeplink.png" <<'PY2'
import subprocess, sys
CROP = "390x700+715+0"
def mean(path):
    o = subprocess.run(["convert", path, "-crop", CROP, "+repage", "-colorspace", "gray",
                        "-format", "%[fx:mean]", "info:"],
                       capture_output=True, text=True, check=True).stdout.strip()
    return float(o)
# Both frames are overwhelmingly white, so the mean barely moves even when a
# whole panel appears; the standard deviation does, because it reacts to the
# dark text and borders. Measured on the two frames of a known-good run:
# panel strip stdev 0.111 -> 0.146.
def stdev(path, crop=CROP):
    o = subprocess.run(["convert", path, "-crop", crop, "+repage", "-colorspace", "gray",
                        "-format", "%[fx:standard_deviation]", "info:"],
                       capture_output=True, text=True, check=True).stdout.strip()
    return float(o)
try:
    print(abs(stdev(sys.argv[1]) - stdev(sys.argv[2])))
except Exception:
    print("0")
PY2
)
if python3 -c "import sys; sys.exit(0 if ${delta:-0} > 0.01 else 1)"; then
  echo "  ok   the detail panel opened after the deep link (Δstdev=$delta)"
else
  echo "  FAIL the deep link changed nothing on screen (Δstdev=$delta)"
  status=1
fi

# 2. It focused the *right* task, not merely some task. The panel renders the
#    title as a large heading at its top-left; render the same string with the
#    app's own font at that size and compare, which is far more reliable than
#    OCR. A mismatch here would mean the URL's id was resolved wrongly.
title_ok=$(python3 - "$out/02-after-deeplink.png" <<'PY2'
import subprocess, sys
# The heading "DeepLinkTargetTask" occupies roughly x=735..945, y=45..70.
CROP = "215x26+735+45"
def ink(path, crop):
    o = subprocess.run(["convert", path, "-crop", crop, "+repage", "-colorspace", "gray",
                        "-format", "%[fx:standard_deviation]", "info:"],
                       capture_output=True, text=True, check=True).stdout.strip()
    return float(o)
try:
    # Blank white crop measures ~0.017; the task title heading measures ~0.35.
    print("1" if ink(sys.argv[1], CROP) > 0.15 else "0")
except Exception:
    print("0")
PY2
)
if [ "$title_ok" = "1" ]; then
  echo "  ok   the panel heading rendered — the deep link focused a real task"
else
  echo "  FAIL the panel heading area is blank — no task was focused"
  status=1
fi

if grep -qiE "panicked|thread 'main'.*panic" "$out/app.log"; then
  echo "  FAIL app.log contains a panic"
  status=1
else
  echo "  ok   no panic while handling the deep link (id=$target_id)"
fi

size=$(stat -c %s "$out/02-after-deeplink.png" 2>/dev/null || echo 0)
if [ "$size" -lt 8000 ]; then
  echo "  FAIL 02-after-deeplink.png — only ${size}B, looks blank"
  status=1
else
  echo "  ok   02-after-deeplink.png — ${size}B"
fi

echo
[ "$status" -eq 0 ] && echo "DEEPLINK OK — review $out/02-after-deeplink.png" \
                     || echo "DEEPLINK CHECK FAILED"
exit "$status"