import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type DragEvent } from "react";
import { api, type TaskPatch } from "../api/client";
import { qk } from "../api/queryKeys";
import { groupByDay, reschedulePatch } from "../lib/calendar";
import { addDays, dayKey, formatDue, monthGrid, weekWindow } from "../lib/dates";
import { useUiStore } from "../stores/ui";

type Mode = "month" | "week";

const MIME = "application/x-omnitodo-calendar";
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

interface DragPayload {
  task_id: string;
  start_at: number | null;
  due_at: number | null;
  all_day: boolean;
}

/**
 * Month / week calendar (design §13.1).
 *
 * Materialised occurrences can be dragged onto another day, which patches the
 * underlying task's dates; virtual occurrences of a series stay read-only until
 * their time arrives (§5.5).
 */
export default function Calendar() {
  const [mode, setMode] = useState<Mode>("month");
  const [cursor, setCursor] = useState(() => Date.now());
  const selectTask = useUiStore((s) => s.selectTask);
  const qc = useQueryClient();

  const range = useMemo(() => {
    if (mode === "week") {
      const { from } = weekWindow(cursor, 1);
      return {
        from,
        to: addDays(from, 7),
        days: Array.from({ length: 7 }, (_, i) => addDays(from, i)),
      };
    }
    return monthGrid(cursor, 1);
  }, [mode, cursor]);

  const { data } = useQuery({
    queryKey: ["calendar", range.from, range.to],
    queryFn: () => api.calendar(range.from, range.to),
  });

  const byDay = useMemo(
    () =>
      groupByDay(data ?? [], (item) => {
        const ts = item.due_at ?? item.start_at;
        return ts == null ? null : dayKey(ts, item.all_day);
      }),
    [data],
  );

  const reschedule = useMutation({
    mutationFn: (v: { id: string; patch: TaskPatch }) => api.taskUpdate(v.id, v.patch),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: qk.tasksAll });
      qc.invalidateQueries({ queryKey: qk.reportAll });
    },
  });

  const onDrop = (event: DragEvent, day: number) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData(MIME);
    if (!raw) return;
    const payload = JSON.parse(raw) as DragPayload;
    const patch = reschedulePatch(payload, day);
    if (patch) reschedule.mutate({ id: payload.task_id, patch: patch as TaskPatch });
  };

  const shift = (dir: -1 | 1) => {
    const d = new Date(cursor);
    setCursor(
      mode === "week"
        ? addDays(cursor, dir * 7)
        : new Date(d.getFullYear(), d.getMonth() + dir, 1).getTime(),
    );
  };

  const title = useMemo(() => {
    const d = new Date(cursor);
    if (mode === "month") return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
    const first = new Date(range.days[0]);
    const last = new Date(range.days[6]);
    return `${first.getMonth() + 1}月${first.getDate()}日 – ${last.getMonth() + 1}月${last.getDate()}日`;
  }, [cursor, mode, range.days]);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{title}</h1>
        <button className="rounded border px-2 py-0.5 text-sm" onClick={() => shift(-1)}>
          ‹
        </button>
        <button className="rounded border px-2 py-0.5 text-sm" onClick={() => shift(1)}>
          ›
        </button>
        <button className="rounded border px-2 py-0.5 text-xs" onClick={() => setCursor(Date.now())}>
          今天
        </button>
        <div className="ml-auto flex overflow-hidden rounded border text-xs">
          {(["month", "week"] as Mode[]).map((m) => (
            <button
              key={m}
              className={`px-2 py-0.5 ${mode === m ? "bg-neutral-900 text-white" : "bg-white"}`}
              onClick={() => setMode(m)}
            >
              {m === "month" ? "月" : "周"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200 text-xs">
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-neutral-50 px-1 py-1 text-center text-neutral-500">
            {d}
          </div>
        ))}
        {range.days.map((day) => {
          const key = dayKey(day, false);
          const items = byDay.get(key) ?? [];
          const today = key === dayKey(Date.now(), false);
          return (
            <div
              key={key}
              className={`bg-white p-1 ${mode === "week" ? "min-h-48" : "min-h-20"}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, day)}
            >
              <div className={`mb-1 ${today ? "font-semibold text-blue-600" : "text-neutral-400"}`}>
                {new Date(day).getDate()}
              </div>
              <ul className="space-y-0.5">
                {items.map((it, i) => {
                  const draggable = !it.virtual_occurrence && Boolean(it.task_id);
                  return (
                    <li
                      key={`${it.task_id ?? it.series_id ?? "v"}-${i}`}
                      draggable={draggable}
                      onDragStart={(e) => {
                        if (!draggable || !it.task_id) return;
                        const payload: DragPayload = {
                          task_id: it.task_id,
                          start_at: it.start_at,
                          due_at: it.due_at,
                          all_day: it.all_day,
                        };
                        e.dataTransfer.setData(MIME, JSON.stringify(payload));
                      }}
                      onClick={() => it.task_id && selectTask(it.task_id)}
                      title={
                        it.virtual_occurrence
                          ? "重复期次（虚拟，只读）"
                          : "拖动可改期，点击打开详情"
                      }
                      className={
                        it.virtual_occurrence
                          ? "cursor-default truncate rounded border border-dashed border-neutral-300 px-1 text-neutral-500"
                          : "cursor-grab truncate rounded bg-blue-50 px-1 text-blue-800"
                      }
                    >
                      {!it.all_day && it.due_at != null && (
                        <span className="mr-1 text-[10px] opacity-70">
                          {formatDue(it.due_at, false).split(" ").pop()}
                        </span>
                      )}
                      {it.title}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-neutral-400">
        实心块为已物化期次，可拖动改期；虚线块是重复规则的未来期次，到点后自动落地。
      </p>
    </section>
  );
}
