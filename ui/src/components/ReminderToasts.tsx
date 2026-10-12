import { App as AntApp, Button, Space } from "antd";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { api, type ReminderHit } from "../api/client";
import { useUiStore } from "../stores/ui";

const SNOOZE_CHOICES = [
  { minutes: 10, label: "10 分钟" },
  { minutes: 60, label: "1 小时" },
  { minutes: 24 * 60, label: "明天" },
];

const reminderKey = (hit: ReminderHit) => `${hit.task_id}:${hit.occurrence_at}`;

function timeLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return sameDay ? hhmm : `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm}`;
}

/** In-app reminder surface (design §9.1/§9.2).
 *
 *  The Rust tick already shows an OS notification; this is the fallback for
 *  platforms without a notification daemon and the place a reminder can be
 *  snoozed (an OS toast can't carry buttons). Rendered through antd's
 *  `notification` so it follows the theme; `key` gives free de-duplication across
 *  the `reminder:fired` event and the on-mount `reminder_missed` drain. */
export default function ReminderToasts() {
  const { notification } = AntApp.useApp();
  const selectTask = useUiStore((s) => s.selectTask);

  useEffect(() => {
    const snooze = async (hit: ReminderHit, minutes: number) => {
      try {
        await api.reminderSnooze(hit.task_id, hit.occurrence_at, minutes);
      } catch {
        // A task deleted from another window shouldn't wedge the panel.
      }
      notification.destroy(reminderKey(hit));
    };

    const push = (hits: ReminderHit[]) => {
      for (const hit of hits) {
        notification.open({
          key: reminderKey(hit),
          title: (
            <span
              style={{ cursor: "pointer" }}
              onClick={() => {
                selectTask(hit.task_id);
                notification.destroy(reminderKey(hit));
              }}
            >
              {hit.title}
            </span>
          ),
          description: `提醒时间 ${timeLabel(hit.when)}`,
          duration: 0,
          placement: "bottomRight",
          actions: (
            <Space size={6} wrap>
              {SNOOZE_CHOICES.map((c) => (
                <Button key={c.minutes} size="small" onClick={() => void snooze(hit, c.minutes)}>
                  稍后 {c.label}
                </Button>
              ))}
            </Space>
          ),
        });
      }
    };

    const unlisteners: Array<() => void> = [];
    let disposed = false;
    listen<ReminderHit>("reminder:fired", (e) => push([e.payload])).then((un) => {
      if (disposed) un();
      else unlisteners.push(un);
    });
    listen<ReminderHit[]>("reminder:catch_up", (e) => push(e.payload ?? [])).then((un) => {
      if (disposed) un();
      else unlisteners.push(un);
    });
    // The Rust tick emits `reminder:catch_up` during setup, before this listener
    // exists, so the reliable path is to ask for the parked list on mount.
    api
      .reminderMissed()
      .then((hits) => {
        if (!disposed) push(hits);
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisteners.forEach((un) => un());
    };
  }, [notification, selectTask]);

  return null;
}
