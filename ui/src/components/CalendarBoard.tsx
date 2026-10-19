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
import { api, type CalendarItemDto, type Id, type TaskPatch } from "../api/client";
import { qk } from "../api/queryKeys";
import { useProjectIndex } from "../hooks/useProjectIndex";
import { groupByDay, quickAddSeedForDay, reschedulePatch } from "../lib/calendar";
import { addDays, dayKey, formatDue, monthGrid, weekWindow } from "../lib/dates";
import { withAlpha } from "../lib/projectColors";
import { useUiStore } from "../stores/ui";
import SidebarToggle from "./SidebarToggle";

type Mode = "month" | "week";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

/** What a drag carries: enough for `reschedulePatch`, plus the overlay label. */
interface DragData {
  task_id: string;
  title: string;
  start_at: number | null;
  due_at: number | null;
  all_day: boolean;
  /** The project's colour, so the block being dragged looks like the one it
   *  left behind. Carried for the overlay only — `reschedulePatch` ignores it. */
  projectColor: string | null;
}

/** Prefer the cell under the pointer; overlap is the fallback (keyboard drags). */
const cellCollision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length ? within : rectIntersection(args);
};

const dropId = (day: number) => `day:${day}`;

/** One day cell: the drop target, framed in dashes while a drag hovers it, and
 *  the click target that starts a new task on that day. */
function DayCell({
  day,
  isToday,
  tall,
  children,
  onCreate,
}: {
  day: number;
  isToday: boolean;
  tall: boolean;
  children: ReactNode;
  onCreate: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId(day), data: { day } });
  return (
    <div
      ref={setNodeRef}
      // A click on the empty part of the cell starts a task on that day, the way
      // Todoist's calendar does. Clicking an item inside it opens the item
      // instead — those stop the event before it gets here.
      onClick={onCreate}
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

/** A calendar item. Materialised occurrences are draggable; virtual ones read-only.
 *
 *  When the calendar spans projects, each block is drawn in its project's colour
 *  — a solid bar on the leading edge plus a wash of the same hue behind it — so
 *  two projects' work can be told apart at a glance. A block whose task has no
 *  project (or whose project has no colour yet) keeps the accent styling, which
 *  is also what the single-project calendar shows. */
function OccurrenceTag({
  item,
  dragId,
  onOpen,
  projectColor,
  projectName,
}: {
  item: CalendarItemDto;
  dragId: string;
  onOpen: (id: string) => void;
  /** The project's colour, whenever the block should be drawn in one. */
  projectColor?: string | null;
  /** Named in the tooltip: only worth saying where the calendar spans projects. */
  projectName?: string;
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
            projectColor: projectColor ?? null,
          }
        : undefined,
  });
  const color = projectColor ?? null;

  return (
    <li ref={setNodeRef} style={{ opacity: isDragging ? 0.35 : undefined }}>
      <Tooltip
        title={
          item.virtual_occurrence
            ? "重复期次（虚拟，只读）"
            : `拖动可改期，点击打开详情${projectName ? ` · ${projectName}` : ""}`
        }
      >
        <Tag
          {...(draggable ? { ...attributes, ...listeners } : {})}
          onClick={(e) => {
            // The cell behind this tag would otherwise also start a new task.
            e.stopPropagation();
            if (item.task_id) onOpen(item.task_id);
          }}
          style={{
            display: "block",
            margin: 0,
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            cursor: draggable ? "grab" : "default",
            ...(item.virtual_occurrence
              ? {
                  background: color ? withAlpha(color, 0.08) : "transparent",
                  border: "1px dashed var(--text-tertiary)",
                  borderInlineStart: color ? `3px solid ${withAlpha(color, 0.55)}` : undefined,
                  color: "var(--text-tertiary)",
                }
              : {
                  background: color ? withAlpha(color, 0.16) : "var(--accent-soft)",
                  color: color ? "var(--text-primary)" : "var(--accent-ink)",
                  border: "none",
                  borderInlineStart: color ? `3px solid ${color}` : undefined,
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
 *
 * `projectId` narrows the window to one project, which is what the project view's
 * calendar mode asks for; the standalone `/calendar` route reads every project
 * and paints each block in its project's colour — the whole reason a project
 * carries one.
 *
 * Only open work is drawn: the core leaves finished tasks out of the window
 * (`Core::calendar`), so there is nothing here to dim or strike through.
 */
export default function CalendarBoard({
  projectId,
  embedded = false,
}: {
  projectId?: Id;
  /** Drop the outer page padding, so the grid fills a host view's content box. */
  embedded?: boolean;
}) {
  const projects = useProjectIndex();
  const [mode, setMode] = useState<Mode>("month");
  const [cursor, setCursor] = useState(() => Date.now());
  const [active, setActive] = useState<DragData | null>(null);
  /** A drag ends with a stray `click`; swallow it for a beat so it does not
   *  also open the quick-add box for the cell it landed on. */
  const suppressClickUntil = useRef(0);
  const selectTask = useUiStore((s) => s.selectTask);
  const openQuickAdd = useUiStore((s) => s.openQuickAdd);
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
    queryKey: ["calendar", range.from, range.to, projectId ?? null],
    queryFn: () => api.calendar(range.from, range.to, projectId ?? null),
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

  /**
   * Clicking empty space in a cell starts a task due that day, filed in the
   * project whose calendar this is.
   *
   * The seed comes from the cell's own bucket key, so the new task lands under
   * the cell it was created from rather than a neighbour (see
   * `quickAddSeedForDay`).
   */
  const createOn = (cellDay: number) => {
    if (Date.now() < suppressClickUntil.current) return;
    openQuickAdd({ ...quickAddSeedForDay(cellDay), project_id: projectId ?? null });
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
    <div className={`flex h-full min-h-0 flex-col ${embedded ? "" : "px-6 py-4"}`}>
      <header className="flex flex-wrap items-center gap-2 pb-3">
        {/* The standalone calendar carries its own header instead of a
            `PageHeader`, so the rail's expand button is repeated here; the
            embedded one is already under its project view's header. */}
        {!embedded && <SidebarToggle variant="expand" />}
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

      <div className="min-h-0 flex-1 overflow-auto">
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
                <DayCell
                  key={key}
                  day={day}
                  isToday={key === todayKey}
                  tall={mode === "week"}
                  onCreate={() => createOn(key)}
                >                  {items.map((it, i) => (
                    <OccurrenceTag
                      key={`${it.task_id ?? it.series_id ?? "v"}-${i}`}
                      item={it}
                      dragId={it.task_id ?? `v:${it.series_id}:${it.due_at}`}
                      onOpen={openTask}
                      projectColor={it.project_id ? projects.get(it.project_id)?.color : null}
                      projectName={
                        embedded ? undefined : projects.get(it.project_id ?? "")?.name
                      }
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
                  // Matches the block under the pointer, colour included: the
                  // overlay is the block, lifted off the grid.
                  background: active.projectColor
                    ? withAlpha(active.projectColor, 0.16)
                    : "var(--bg-surface)",
                  borderColor: active.projectColor ?? "var(--accent)",
                  borderInlineStart: active.projectColor
                    ? `3px solid ${active.projectColor}`
                    : undefined,
                  color: active.projectColor ? "var(--text-primary)" : "var(--accent-ink)",
                }}
              >
                {active.title}
              </span>
            ) : null}
          </DragOverlay>
        </DndContext>
        <Typography.Text type="secondary" className="mt-3 block text-xs">
          实心块为已物化期次，可拖动改期；虚线块是重复规则的未来期次，到点后自动落地。点击空白处可在该日新建任务。
        </Typography.Text>
      </div>
    </div>
  );
}
