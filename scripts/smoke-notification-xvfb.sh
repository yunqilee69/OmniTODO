#!/usr/bin/env bash
# Verify the reminder actually pops a **system notification** (design §16 P3:
# “到点弹通知”).
#
# The page-level smoke (`scripts/smoke-gui-xvfb.sh`) can only see the in-app
# reminder card, because a bare Xvfb has no notification daemon — `show()` has
# nowhere to go. This script closes that gap: it runs a real notification daemon
# (dunst) on the virtual display, seeds a task whose reminder is already due, and
# then checks two things a daemon-mediated notification has to get right:
#
#   1. a notification actually reaches the bus while the app is up;
#   2. the rendered bubble appears on screen (pixel proof, not just a log line).
#
# Needs, in the image: dunst, libnotify-bin, dbus-x11, xvfb, xauth, xdotool,
# imagemagick, fonts-noto-cjk.
#
#   scripts/smoke-notification-xvfb.sh --bin /usr/bin/omnitodo-desktop \
#                                      --cli /build-target/release/omnitodo
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin="${OMNITODO_BIN:-/usr/bin/omnitodo-desktop}"
cli="${OMNITODO_CLI:-$root/target/release/omnitodo}"
out="${OMNITODO_OUT:-$root/artifacts/smoke-notification}"
geometry="1440x900x24"

while [ $# -gt 0 ]; do
  case "$1" in
    --bin) bin="$2"; shift 2 ;;
    --cli) cli="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --geometry) geometry="$2"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

for tool in dunst notify-send Xvfb xdotool import xauth dbus-run-session; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 3; }
done
[ -x "$bin" ] || { echo "app binary not found: $bin" >&2; exit 3; }
[ -x "$cli" ] || { echo "cli binary not found: $cli" >&2; exit 3; }

home="$(mktemp -d /tmp/omnitodo-notify-XXXXXX)"
mkdir -p "$out"
rm -f "$out"/*.png "$out"/*.log
export HOME="$home"
db="$HOME/.omnitodo/omnitodo.db"

echo "==> seeding a task whose reminder is already due ($db)"
"$cli" init >/dev/null
"$cli" --db "$db" project add "工作" >/dev/null
"$cli" --db "$db" task add "交水电费" --project 工作 >/dev/null
# Absolute reminder instant ~30s in the past: inside the startup catch-up window
# (§9.2) but outside `due_now`'s 60s lookback, so the bubble comes from the
# catch-up path rather than the periodic tick — deterministic, no waiting.
python3 - "$db" <<'PY'
import sqlite3, sys, time
c = sqlite3.connect(sys.argv[1])
c.execute(
    "UPDATE tasks SET remind_enabled = 1, remind_at = ? WHERE title = '交水电费'",
    (int(time.time() * 1000) - 30_000,),
)
c.commit()
PY

# dunst needs a geometry that fits its bubbles; keep it small and pinned to the
# corner we screenshot. Written to a file so both the daemon and the monitor
# read the same settings.
dunst_rc="$home/dunstrc"
cat > "$dunst_rc" <<'EOF'
[global]
    monitor = 0
    follow = none
    width = 380
    origin = top-right
    offset = 8x
    notification_limit = 0
    show_indicators = no
    format = "<b>%s</b>%b"
    markup = full
[urgency_low]
    background = "#1f2937"
    foreground = "#f9fafb"
    timeout = 120
[urgency_normal]
    background = "#1f2937"
    foreground = "#f9fafb"
    timeout = 120
[urgency_critical]
    background = "#7f1d1d"
    foreground = "#f9fafb"
    timeout = 120
EOF
# dunst only reads -conf / XDG paths; it does not honour a DUNSTRC env var.

export NOTIFY_BIN="$bin" NOTIFY_OUT="$out" DUNST_RC="$dunst_rc"
steps="$(cat <<'EOF'
set -uo pipefail
export WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
export GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1
export NO_AT_BRIDGE=1 GSETTINGS_BACKEND=memory

# A D-Bus session is how the notification reaches dunst: the app's show()
# publishes on org.freedesktop.Notifications, and errors are deliberately
# swallowed on the Rust side, so without a bus the failure would be silent.
eval "$(dbus-launch --sh-syntax)"

# -print logs each delivered notification to stdout: the daemon's own
# record, which is stronger evidence than a pixel diff alone.
dunst -print -conf "$DUNST_RC" > "$NOTIFY_OUT/dunst.log" 2>&1 &
DUNST=$!
trap 'kill $DUNST "$APP" 2>/dev/null; [ -n "$DBUS_SESSION_BUS_PID" ] && kill $DBUS_SESSION_BUS_PID 2>/dev/null' EXIT
sleep 2

"$NOTIFY_BIN" > "$NOTIFY_OUT/app.log" 2>&1 &
APP=$!
sleep 14

WID=$(xdotool search --name '^OmniTODO$' | head -1)
[ -n "$WID" ] || { echo "FAIL: no OmniTODO window appeared"; sed -n '1,40p' "$NOTIFY_OUT/app.log"; exit 1; }
xdotool windowfocus $WID 2>/dev/null || true
sleep 6

import -window root "$NOTIFY_OUT/01-notification.png"

# Kill the daemon and re-shoot: the only difference between the two frames is the
# bubble, which is what makes the comparison below evidence of a drawn bubble.
kill $DUNST 2>/dev/null || true
sleep 2
import -window root "$NOTIFY_OUT/02-after-dunst-stopped.png"
echo "steps done"
EOF
)"

echo "==> running the app with a notification daemon on a virtual display ($geometry)"
xvfb-run -a --server-args="-screen 0 $geometry" bash -c "$steps"

echo
echo "==> assertions"
status=0

# 1. The notification reached the daemon, with the task title in it. `-print`
#    makes dunst log what it was asked to display, so this is delivery proof and
#    not merely "the app called show()".
if grep -q "交水电费" "$out/dunst.log" 2>/dev/null; then
  echo "  ok   the daemon received the reminder notification with its title"
  grep -m3 -A1 -i "summary" "$out/dunst.log" | sed 's/^/       /'
else
  echo "  FAIL no reminder notification reached the daemon"
  sed -n '1,20p' "$out/dunst.log" 2>/dev/null | sed 's/^/       /'
  status=1
fi

# 1b. Exactly one. A missed reminder is aggregated into a single notification
#     (§9.2), and the startup catch-up must also mark the occurrence fired — or
#     the first 60-second tick re-fires it and the user is told twice.
count=$(grep -c "body: '交水电费'" "$out/dunst.log" 2>/dev/null || echo 0)
if [ "$count" = "1" ]; then
  echo "  ok   exactly one notification for the occurrence (no duplicate toast)"
else
  echo "  FAIL expected 1 notification for the occurrence, saw $count"
  status=1
fi

# 2. Pixel proof: the daemon was stopped between the two frames, so the only
#    difference is the bubble itself. Comparing just the region dunst draws into
#    (top-right, per the dunstrc above) keeps the signal strong — a whole-screen
#    mean is dominated by the app window and the bubble is dark-on-dark.
if [ -f "$out/02-after-dunst-stopped.png" ]; then
  delta=$(python3 - "$out/01-notification.png" "$out/02-after-dunst-stopped.png" <<'PY'
import subprocess, sys
# Bubble origin: top-right, width 380 + 8px offset, generous height for wrapping.
CROP = "400x160+1040+0"
def region_mean(path):
    out = subprocess.run(
        ["convert", path, "-crop", CROP, "+repage", "-colorspace", "gray",
         "-format", "%[fx:mean]", "info:"],
        capture_output=True, text=True, check=True).stdout.strip()
    return float(out)
try:
    print(abs(region_mean(sys.argv[1]) - region_mean(sys.argv[2])))
except Exception:
    print("0")
PY
)
  if python3 -c "import sys; sys.exit(0 if ${delta:-0} > 0.01 else 1)"; then
    echo "  ok   the bubble region changes when the daemon stops (Δmean=$delta)"
  else
    echo "  FAIL bubble region unchanged with and without the daemon (Δmean=$delta)"
    status=1
  fi
else
  echo "  FAIL could not capture the after-stopped frame"
  status=1
fi

size=$(stat -c %s "$out/01-notification.png" 2>/dev/null || echo 0)
if [ "$size" -lt 8000 ]; then
  echo "  FAIL 01-notification.png — only ${size}B, looks blank"
  status=1
else
  echo "  ok   01-notification.png — ${size}B"
fi

if grep -qiE "panicked|thread 'main'.*panic" "$out/app.log"; then
  echo "  FAIL app.log contains a panic"
  status=1
fi

echo
[ "$status" -eq 0 ] && echo "NOTIFICATION OK — review $out/01-notification.png" \
                     || echo "NOTIFICATION CHECK FAILED"
exit "$status"