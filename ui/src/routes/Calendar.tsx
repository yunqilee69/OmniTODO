import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Segmented, Tag, Tooltip, Typography } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { api, type CalendarItemDto, type TaskPatch } from "../api/client";
import { qk } from "../api/queryKeys";
import { groupByDay, reschedulePatch } from "../lib/calendar";
import { addDays, dayKey, formatDue, monthGrid, weekWindow } from "../lib/dates";
import { useUiStore } from "../stores/ui";

type Mode = "month" | "week";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

/** What a drag carries: enough for `reschedulePatch`, plus the overlay label. */
interface DragData {
  task_id: string;
  title: string;
  start_at: number | null;
  due_at: number | null;
  all_day: boolean;
}

/** Prefer the cell under the pointer; overlap is the fallback (keyboard drags). */
const cellCollision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length ? within : rectIntersection(args);
};

const dropId = (day: number) => `day:${day}`;

/** One day cell: the drop target, framed in dashes while a drag hovers it. */
function DayCell({
  day,
  isToday,
  tall,
  children,
}: {
  day: number;
  isToday: boolean;
  tall: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId(day), data: { day } });
  return (
    <div
      ref={setNodeRef}
      className={`bg-[var(--bg-surface)] p-1.5 ${tall ? "min-h-48" : "min-h-24"}`}
      style={
        isOver
          ? {
              background: "var(--accent-soft)",
              outline: "2px dashed var(--accent)",
              outlineOffset: -3,
            }
          : undefined
      }
    >
      <div className="mb-1 flex justify-end">
        <span
          className="tabular grid size-5 place-items-center rounded-full text-[11px]"
          style={
            isToday
              ? { background: "var(--accent)", color: "var(--text-on-accent, #fff)" }
              : { opacity: 0.6 }
          }
        >
          {new Date(day).getDate()}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}

/** A calendar item. Materialised occurrences are draggable; virtual ones read-only. */
function OccurrenceTag({
  item,
  dragId,
  onOpen,
}: {
  item: CalendarItemDto;
  dragId: string;
  onOpen: (id: string) => void;
}) {
  const draggable = !item.virtual_occurrence && Boolean(item.task_id);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    disabled: !draggable,
    data:
      draggable && item.task_id
        ? {
            task_id: item.task_id,
            title: item.title,
            start_at: item.start_at,
            due_at: item.due_at,
            all_day: item.all_day,
          }
        : undefined,
  });

  return (
    <li ref={setNodeRef} style={{ opacity: isDragging ? 0.35 : undefined }}>
      <Tooltip
        title={item.virtual_occurrence ? "重复期次（虚拟，只读）" : "拖动可改期，点击打开详情"}
      >
        <Tag
          {...(draggable ? { ...attributes, ...listeners } : {})}
          onClick={() => item.task_id && onOpen(item.task_id)}
          style={{
            display: "block",
            margin: 0,
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            cursor: draggable ? "grab" : "default",
            ...(item.virtual_occurrence
              ? {
                  background: "transparent",
                  border: "1px dashed var(--text-tertiary)",
                  color: "var(--text-tertiary)",
                }
              : {
                  background: "var(--accent-soft)",
                  color: "var(--accent-ink)",
                  border: "none",
                }),
          }}
        >
          {!item.all_day && item.due_at != null && (
            <span className="tabular mr-1 opacity-70">
              {formatDue(item.due_at, false).split(" ").pop()}
            </span>
          )}
          {item.title}
        </Tag>
      </Tooltip>
    </li>
  );
}

/**
 * Month / week calendar (design §13.1).
 *
 * The grid stays a plain CSS grid (antd's `Calendar` can't host cross-cell
 * drag-drop, which is how a materialised occurrence is rescheduled); antd
 * supplies the toolbar controls and the item tags. Dragging uses dnd-kit — the
 * app's one drag library — because the Tauri webview swallows in-page HTML5
 * drag events, and dnd-kit's pointer sensor works everywhere the task list does.
 */
export default function Calendar() {
  const [mode, setMode] = useState<Mode>("month");
  const [cursor, setCursor] = useState(() => Date.now());
  const [active, setActive] = useState<DragData | null>(null);
  /** A drag ends with a stray `click`; swallow it for a beat. */
  const suppressClickUntil = useRef(0);
  const selectTask = useUiStore((s) => s.selectTask);
  const qc = useQueryClient();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

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

  const openTask = (id: string) => {
    if (Date.now() < suppressClickUntil.current) return;
    selectTask(id);
  };

  const onDragStart = (event: DragStartEvent) => {
    suppressClickUntil.current = Number.POSITIVE_INFINITY;
    setActive((event.active.data.current as DragData | undefined) ?? null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    suppressClickUntil.current = Date.now() + 250;
    setActive(null);
    const payload = event.active.data.current as DragData | undefined;
    const day = event.over?.data.current?.day as number | undefined;
    if (!payload || day == null) return;
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

  const todayKey = dayKey(Date.now(), false);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border-hairline)] px-6 py-4">
        <Typography.Title level={5} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        <Button size="small" type="text" icon={<LeftOutlined />} onClick={() => shift(-1)} aria-label="上一页" />
        <Button size="small" type="text" icon={<RightOutlined />} onClick={() => shift(1)} aria-label="下一页" />
        <Button size="small" onClick={() => setCursor(Date.now())}>
          今天
        </Button>
        <Segmented
          size="small"
          style={{ marginInlineStart: "auto" }}
          value={mode}
          onChange={(v) => setMode(v as Mode)}
          options={[
            { label: "月", value: "month" },
            { label: "周", value: "week" },
          ]}
        />
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        <DndContext
          id="calendar-dnd"
          sensors={sensors}
          collisionDetection={cellCollision}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            suppressClickUntil.current = Date.now() + 250;
            setActive(null);
          }}
        >
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-[var(--border-hairline)] bg-[var(--border-hairline)]">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="bg-[var(--bg-sunken)] px-2 py-1.5 text-center text-micro opacity-70"
              >
                {d}
              </div>
            ))}
            {range.days.map((day) => {
              const key = dayKey(day, false);
              const items = byDay.get(key) ?? [];
              return (
                <DayCell key={key} day={day} isToday={key === todayKey} tall={mode === "week"}>
                  {items.map((it, i) => (
                    <OccurrenceTag
                      key={`${it.task_id ?? it.series_id ?? "v"}-${i}`}
                      item={it}
                      dragId={it.task_id ?? `v:${it.series_id}:${it.due_at}`}
                      onOpen={openTask}
                    />
                  ))}
                </DayCell>
              );
            })}
          </div>
          <DragOverlay>
            {active ? (
              <span
                className="cursor-grabbing rounded border px-1.5 py-0.5 text-[12px] shadow-lg"
                style={{
                  background: "var(--bg-surface)",
                  borderColor: "var(--accent)",
                  color: "var(--accent-ink)",
                }}
              >
                {active.title}
              </span>
            ) : null}
          </DragOverlay>
        </DndContext>
        <Typography.Text type="secondary" className="mt-3 block text-xs">
          实心块为已物化期次，可拖动改期；虚线块是重复规则的未来期次，到点后自动落地。
        </Typography.Text>
      </div>
    </section>
  );
}
