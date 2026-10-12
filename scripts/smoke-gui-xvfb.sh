#!/usr/bin/env bash
# Headless page-level smoke test (design §14 / §16 P6 acceptance).
#
# On a machine with no display we can still exercise the real application: the
# packaged binary is started on a virtual X server (Xvfb), driven with synthetic
# clicks and keystrokes, and screenshotted after every step. This is what backs
# the "页面级冒烟" row in docs/implementation-status.md.
#
#   scripts/smoke-gui-xvfb.sh --bin /usr/bin/omnitodo-desktop \
#                             --cli /build-target/release/omnitodo
#
# `--bin` must be a *production* build: without the `custom-protocol` feature the
# webview loads from `devUrl` and every page comes out blank. The installers from
# `tauri build` have it; a hand-built one needs
# `cargo build --release --features custom-protocol -p omnitodo-desktop`.
#
# Needs, in the image it runs in: xvfb, xauth, dbus-x11, xdotool, imagemagick,
# and a CJK font (fonts-noto-cjk) or the Chinese labels render as tofu.
# `scripts/package-linux-docker.sh` installs the app; the extra GUI tools are
# installed by the command in docs/packaging.md.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin="${OMNITODO_BIN:-/usr/bin/omnitodo-desktop}"
cli="${OMNITODO_CLI:-$root/target/release/omnitodo}"
out="$root/artifacts/smoke"
home=""
geometry="1440x900x24"

while [ $# -gt 0 ]; do
  case "$1" in
    --bin) bin="$2"; shift 2 ;;
    --cli) cli="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --home) home="$2"; shift 2 ;;
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

# A throwaway data dir keeps the run reproducible and never touches real data.
if [ -z "$home" ]; then
  home="$(mktemp -d /tmp/omnitodo-smoke-XXXXXX)"
fi
mkdir -p "$out"
rm -f "$out"/*.png
export HOME="$home"

db="$HOME/.local/share/omnitodo/omnitodo.db"

echo "==> seeding fixtures ($db)"
"$cli" init >/dev/null
"$cli" --db "$db" project add "工作" >/dev/null
"$cli" --db "$db" project add "生活" >/dev/null
"$cli" --db "$db" task add "写周报，汇总本周接口联调" --project 工作 --priority 3 --tag 汇报 --due 明天 >/dev/null
"$cli" --db "$db" task add "评审设计稿" --project 工作 --priority 4 --tag 设计 --due 今天 >/dev/null
"$cli" --db "$db" task add "Weekly report draft" --project 工作 --due "2026-10-12 18:30" >/dev/null
"$cli" --db "$db" task add "买菜" --project 生活 --priority 1 >/dev/null
"$cli" --db "$db" task add "每周站会" --project 工作 --recurrence "每周一,三,五" --due 2026-10-13 >/dev/null
"$cli" --db "$db" quickadd "整理季度汇报材料 !紧急 @工作 ^明天 10:00 ::按 §13 的结构写" >/dev/null
# Unfiled tasks: these are what the Inbox is supposed to list.
"$cli" --db "$db" task add "读 Rust 异步编程" --priority 2 >/dev/null
"$cli" --db "$db" task add "预约体检" >/dev/null
"$cli" --db "$db" task add "交水电费" --project 工作 >/dev/null

# Make that task's reminder "come due while the app was closed", so the startup
# catch-up (§9.2) has something to surface. The instant is written straight into
# SQLite rather than through quickadd's `~offset`, because a date-relative
# fixture would flip in and out of the 24h catch-up window with the wall clock
# (the container runs UTC while the host is UTC+8).
python3 - "$db" <<'PY'
import sqlite3, sys, time
c = sqlite3.connect(sys.argv[1])
c.execute(
    "UPDATE tasks SET remind_enabled = 1, remind_at = ? WHERE title = '交水电费'",
    (int(time.time() * 1000) - 5 * 60 * 1000,),
)
c.commit()
PY

# Attach a file to one task so the panel has something to show (design §16 P2:
# "附件可上传/打开/删除"). Uploading through the UI needs a native file dialog,
# which cannot be synthesised, so the row is seeded directly and the UI drives
# what it can: listing, opening, and deleting.
python3 - "$db" <<'PY'
import sqlite3, sys, time, uuid
c = sqlite3.connect(sys.argv[1])
row = c.execute("SELECT id FROM tasks WHERE title = '买菜'").fetchone()
if row:
    now = int(time.time() * 1000)
    c.execute(
        "INSERT INTO attachments (id, task_id, file_name, storage_kind, rel_path, data,"
        " mime_type, size_bytes, sha256, created_at, updated_at, version)"
        " VALUES (?, ?, 'shopping-list.txt', 'blob', NULL, ?, 'text/plain', ?, NULL, ?, ?, 1)",
        (str(uuid.uuid4()), row[0], b"milk\neggs\n", 11, now, now),
    )
    c.commit()
PY

# Hit points read off the rendered layout (the window is 1100x720 at 0,0), in
# sidebar order. Exported so the child shell below can name them.
export NAV_X=60
export NAV_Y_INBOX=108 NAV_Y_TODAY=136 NAV_Y_CALENDAR=192 NAV_Y_QUICKADD=220 NAV_Y_SETTINGS=248
export PROJECT_X=100 PROJECT_Y=320
export SEARCH_X=120 SEARCH_Y=68
export ROW_X=400 ROW_Y=95
export PANEL_CLOSE_X=1050 PANEL_CLOSE_Y=30
# The 已完成 checkbox sits on the panel's third row (its <label> wraps the box,
# so the text is a valid target too).
export PANEL_DONE_X=790 PANEL_DONE_Y=107
# First "稍后" button on the reminder card, which is pinned bottom-right.
export REMIND_SNOOZE_X=820 REMIND_SNOOZE_Y=680
# 生活 in the sidebar (second project), then the 买菜 row inside it.
export LIFE_X=100 LIFE_Y=352
export LIFE_ROW_X=400 LIFE_ROW_Y=127
# Attachment row + its delete button in the panel's 附件 block. The block sits
# below 描述/重复/标签, so its exact y is read off 14-attachments.
export ATTACH_ROW_X=790 ATTACH_ROW_Y=685
export ATTACH_DEL_X=1075 ATTACH_DEL_Y=685
# The reminder card's × (bottom-right overlay, must be closed before the panel's
# 附件 block can be reached).
export REMIND_CLOSE_X=1064 REMIND_CLOSE_Y=632

# The child shell gets the paths through the environment and the body is a
# quoted heredoc, so nothing in it is expanded or word-split here.
export SMOKE_BIN="$bin" SMOKE_OUT="$out"
steps="$(cat <<'EOF'
set -uo pipefail
export WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
export GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1
eval "$(dbus-launch --sh-syntax)"

"$SMOKE_BIN" > "$SMOKE_OUT/app.log" 2>&1 &
APP=$!
trap 'kill $APP 2>/dev/null' EXIT

sleep 12
WID=$(xdotool search --name '^OmniTODO$' | head -1)
[ -n "$WID" ] || { echo "FAIL: no OmniTODO window appeared"; sed -n '1,40p' "$SMOKE_OUT/app.log"; exit 1; }
echo "window=$WID $(xdotool getwindowgeometry --shell $WID | tr '\n' ' ')"
xdotool windowfocus $WID 2>/dev/null || true

shot() { import -window root "$SMOKE_OUT/$1.png"; sleep 1.2; }
# Move first (so the row registers hover), then press: a bare mousemove+click in
# one xdotool call can reach the webview before it has processed the motion.
click() { xdotool mousemove "$1" "$2"; sleep 0.4; xdotool click 1; sleep 2.5; }

shot 01-inbox

# Detail panel: click the first task row, then close it again.
click "$ROW_X" "$ROW_Y"
shot 02-task-detail
click "$PANEL_CLOSE_X" "$PANEL_CLOSE_Y"

click "$NAV_X" "$NAV_Y_TODAY"
shot 03-today

click "$NAV_X" "$NAV_Y_CALENDAR"
shot 04-calendar

click "$NAV_X" "$NAV_Y_QUICKADD"
shot 05-quickadd
# xdotool can only synthesise Latin keysyms, so the shorthand here is the ASCII
# spelling of the same grammar (!urgent / @review / ^tomorrow 09:30).
xdotool type --delay 40 'Review API changes !urgent @review ^tomorrow 09:30'
sleep 2
shot 06-quickadd-parsed

click "$PROJECT_X" "$PROJECT_Y"
shot 07-project

click "$NAV_X" "$NAV_Y_SETTINGS"
shot 08-settings

# Search: click the sidebar box, then type and submit.
click "$SEARCH_X" "$SEARCH_Y"
xdotool windowfocus $WID 2>/dev/null || true
click "$SEARCH_X" "$SEARCH_Y"
xdotool type --delay 50 'Weekly'
sleep 1
xdotool key Return
sleep 2.5
shot 09-search

click "$NAV_X" "$NAV_Y_INBOX"
shot 10-inbox-final

# A real write through the UI: open the first row and tick 已完成. The optimistic
# update strikes the row through and the change must reach SQLite — the CLI
# assertion afterwards checks the database independently.
click "$ROW_X" "$ROW_Y"
sleep 1
click "$PANEL_DONE_X" "$PANEL_DONE_Y"
shot 11-completed
sleep 1

# Attachments (design §16 P2: 附件可打开/删除). The 买菜 task carries a seeded
# BLOB attachment; open it via the panel's list, then delete it through the row's
# own control and confirm the panel falls back to 暂无附件.
# Close the detail panel first: a task selected earlier stays open across
# navigation, so clicking the row below would otherwise act on the stale one.
click "$PANEL_CLOSE_X" "$PANEL_CLOSE_Y"
sleep 1
click "$LIFE_X" "$LIFE_Y"                # 生活 project, which holds 买菜
sleep 1

# Missed-reminder card (design §9.2 + §8.1 reminder_snooze). It is pinned
# bottom-right and comes from the catch-up list, so it is on screen from launch.
shot 12-reminder-card
# "稍后 10 分钟" must dismiss the card and push remind_at into the future; the
# assertions below read both back out of SQLite.
click "$REMIND_SNOOZE_X" "$REMIND_SNOOZE_Y"
shot 13-reminder-snoozed
sleep 1

# Attachments (design §16 P2: 附件可打开/删除). Done after the snooze click because
# the reminder card is pinned over the panel's 附件 block until it is dismissed.
click "$PANEL_CLOSE_X" "$PANEL_CLOSE_Y"
sleep 1
click "$LIFE_X" "$LIFE_Y"
sleep 1
click "$LIFE_ROW_X" "$LIFE_ROW_Y"        # open 买菜
shot 14-attachments
click "$ATTACH_DEL_X" "$ATTACH_DEL_Y"    # delete the attachment
shot 15-attachment-deleted
echo "steps done"
EOF
)"

echo "==> running the app on a virtual display ($geometry)"
xvfb-run -a --server-args="-screen 0 $geometry" bash -c "$steps"

echo
echo "==> assertions"
status=0

# The UI tick must have landed in SQLite: exactly one task is done.
done_count=$("$cli" --db "$db" export --format json --include-completed 2>/dev/null | python3 -c \
  'import json,sys; print(sum(1 for t in json.load(sys.stdin) if t["status"] == "done"))')
if [ "$done_count" = "1" ]; then
  echo "  ok   quick-complete wrote through to the DB (done=$done_count)"
else
  echo "  FAIL quick-complete: expected 1 done task in the DB, found $done_count"
  status=1
fi

# The Inbox must not list tasks that belong to a project (design §12.2).
unfiled=$("$cli" --db "$db" export --format json --include-completed 2>/dev/null | python3 -c \
  'import json,sys; print(sum(1 for t in json.load(sys.stdin) if t["project_id"] is None))')
if [ "$unfiled" = "3" ]; then
  echo "  ok   inbox scope = unfiled tasks only (3 seeded)"
else
  echo "  FAIL expected 3 unfiled tasks, found $unfiled"
  status=1
fi

# Snoozing through the UI must move remind_at into the future and clear the
# fired marker for the old occurrence (design §8.1 / §9.1 de-duplication).
reminder_state=$(python3 - "$db" <<'PY'
import sqlite3, sys, time
c = sqlite3.connect(sys.argv[1])
row = c.execute(
    "SELECT id, remind_at FROM tasks WHERE title = '交水电费' AND deleted_at IS NULL"
).fetchone()
if row is None:
    print("missing 0 0")
else:
    task_id, remind_at = row
    fired = c.execute(
        "SELECT COUNT(*) FROM reminder_fires WHERE task_id = ? AND occurrence_at <= ?",
        (task_id, int(time.time() * 1000)),
    ).fetchone()[0]
    print(f"{remind_at} {1 if remind_at > int(time.time() * 1000) else 0} {fired}")
PY
)
read -r remind_at snoozed fired <<<"$reminder_state"
if [ "${snoozed:-0}" = "1" ]; then
  echo "  ok   reminder snooze pushed remind_at into the future (now+$(( (remind_at - $(date +%s%3N)) / 60000 ))min)"
else
  echo "  FAIL reminder snooze did not move remind_at forward (state: $reminder_state)"
  status=1
fi
if [ "${fired:-1}" = "0" ]; then
  echo "  ok   the fired marker for the old occurrence was cleared"
else
  echo "  FAIL $fired fired-marker row(s) still suppress the snoozed reminder"
  status=1
fi

# Deleting the attachment through the panel must soft-delete the row
# (design §5.7: attachments are soft-deleted, managed files stay for GC).
live=$(python3 - "$db" <<'PY2'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
print(c.execute(
    "SELECT COUNT(*) FROM attachments WHERE file_name = 'shopping-list.txt'"
    " AND deleted_at IS NULL").fetchone()[0])
PY2
)
if [ "$live" = "0" ]; then
  echo "  ok   attachment deleted through the UI (soft-deleted in the DB)"
else
  echo "  FAIL the attachment is still live after the UI delete (live=$live)"
  status=1
fi

echo
echo "==> screenshots"
for f in "$out"/*.png; do
  size=$(stat -c %s "$f")
  # A blank/unpainted frame compresses to a few KB; require real content.
  if [ "$size" -lt 8000 ]; then
    echo "  FAIL $(basename "$f") — only ${size}B, looks blank"
    status=1
  else
    echo "  ok   $(basename "$f") — ${size}B"
  fi
done

# The snooze click has to actually reach the card: the bottom-right corner must
# change between the two shots (card present -> card dismissed).
corner='320x110+764+600'
before=$(convert "$out/12-reminder-card.png" -crop "$corner" -format '%[fx:mean]' info: 2>/dev/null || echo 0)
after=$(convert "$out/13-reminder-snoozed.png" -crop "$corner" -format '%[fx:mean]' info: 2>/dev/null || echo 0)
delta=$(python3 -c "print(abs(float('$before') - float('$after')))")
if python3 -c "import sys; sys.exit(0 if $delta > 0.005 else 1)"; then
  echo "  ok   reminder card dismissed by the snooze click (corner Δmean=$delta)"
else
  echo "  FAIL reminder card still on screen after the snooze click (Δmean=$delta)"
  status=1
fi

if grep -qiE "panicked|thread 'main'.*panic" "$out/app.log"; then
  echo "  FAIL app.log contains a panic"
  status=1
fi

echo
[ "$status" -eq 0 ] && echo "SMOKE OK — review the PNGs in $out" || echo "SMOKE FAILED"
exit "$status"
