import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type ReminderHit } from "../api/client";
import { dropReminder, mergeReminders, type ReminderCard } from "../lib/reminders";
import { useUiStore } from "../stores/ui";

const SNOOZE_CHOICES = [
  { minutes: 10, label: "10 分钟" },
  { minutes: 60, label: "1 小时" },
  { minutes: 24 * 60, label: "明天" },
];

function timeLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return sameDay ? hhmm : `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm}`;
}

/** In-app reminder surface (design §9.1/§9.2, §16 P3).
 *
 *  The Rust tick already shows an OS notification; this panel is the fallback
 *  for platforms without a notification daemon and the place where a reminder
 *  can be snoozed (design §8.1 `reminder_snooze`) — an OS toast can't carry
 *  buttons. `reminder:fired` is one occurrence, `reminder:catch_up` is the
 *  aggregate of reminders missed while the app was closed. */
export default function ReminderToasts() {
  const [cards, setCards] = useState<ReminderCard[]>([]);
  const selectTask = useUiStore((s) => s.selectTask);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let disposed = false;
    const push = (hits: ReminderHit[]) => {
      setCards((prev) => mergeReminders(prev, hits));
    };
    listen<ReminderHit>("reminder:fired", (e) => push([e.payload])).then((un) => {
      if (disposed) un();
      else unlisteners.push(un);
    });
    listen<ReminderHit[]>("reminder:catch_up", (e) => push(e.payload ?? [])).then((un) => {
      if (disposed) un();
      else unlisteners.push(un);
    });
    // The Rust tick emits `reminder:catch_up` during setup, before this listener
    // exists, so the reliable path is to ask for the parked list on mount. The
    // key set makes the two paths idempotent if both land.
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
  }, []);

  if (cards.length === 0) return null;

  const dismiss = (key: string) => setCards((prev) => dropReminder(prev, key));

  const snooze = async (card: ReminderCard, minutes: number) => {
    try {
      await api.reminderSnooze(card.task_id, card.occurrence_at, minutes);
    } catch {
      // A task deleted from another window shouldn't wedge the panel.
    }
    dismiss(card.key);
  };

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {cards.map((card) => (
        <div
          key={card.key}
          className="pointer-events-auto rounded-lg border border-neutral-200 bg-white p-3 shadow-lg"
          role="alert"
        >
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium"
              title={card.title}
              onClick={() => {
                selectTask(card.task_id);
                dismiss(card.key);
              }}
            >
              {/* A dot rather than an emoji: 🔔 is tofu on installs without an
                  emoji font, which is the default on many Linux desktops. */}
              <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
              <span className="min-w-0 truncate">{card.title}</span>
            </button>
            <button
              type="button"
              className="shrink-0 text-neutral-400 hover:text-neutral-700"
              aria-label="关闭提醒"
              onClick={() => dismiss(card.key)}
            >
              ×
            </button>
          </div>
          <div className="mt-0.5 text-xs text-neutral-500">提醒时间 {timeLabel(card.when)}</div>
          <div className="mt-2 flex gap-1.5">
            {SNOOZE_CHOICES.map((c) => (
              <button
                key={c.minutes}
                type="button"
                className="rounded bg-neutral-100 px-2 py-0.5 text-xs hover:bg-neutral-200"
                onClick={() => void snooze(card, c.minutes)}
              >
                稍后 {c.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
