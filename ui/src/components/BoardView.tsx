import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Checkbox, Dropdown, Input, Tooltip, Typography, type InputRef, type MenuProps } from "antd";
import {
  AlertOutlined,
  BranchesOutlined,
  CalendarOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  HolderOutlined,
  MoreOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useRef, useState, type CSSProperties, type FocusEvent } from "react";
import { api, type SectionDto, type TaskDto } from "../api/client";
import { qk } from "../api/queryKeys";
import { useTaskMutations } from "../hooks/useTaskMutations";
import type { useProjectSections } from "../hooks/useProjectSections";
import { formatDue, isOverdue } from "../lib/dates";
import { projectFilter } from "../lib/filter";
import { resolveDropBand, type DropBand } from "../lib/nestDrop";
import { PRIORITY_RING } from "../lib/priority";
import { groupBySection, NO_SECTION, planCardDrop, planColumnReorder } from "../lib/sections";

/** Todoist's column width (`--section-board-width: 286px`): narrow enough that a
 *  card reads as a card and not a page, wide enough for a title and a date. */
const COLUMN_WIDTH = 286;

/** What a drag carries. */
type DragData =
  | { kind: "card"; taskId: string }
  | { kind: "column"; sectionId: string; name: string };

/** What a drop target carries. A card is dropped on a card or on a column's
 *  body; a column drag only ever resolves to another column's sortable node,
 *  whose data is {@link DragData}. */
type DropData = { kind: "card"; sectionId: string | null };

/** The card drop target: a column's body, which spans its full height. */
export const columnDropId = (key: string) => `column:${key}`;
/** The column's sortable id — the whole column, dragged by its grip. */
export const columnDragId = (sectionId: string) => `section:${sectionId}`;

/**
 * The section a column-shaped drop id names.
 *
 * A column is registered twice: the sortable node (`section:<id>`) and the card
 * body inside it (`column:<key>`). Only the former has `kind: "column"`, so a
 * column drag always resolves to it — the body belongs to the card namespace and
 * is filtered out before the collision ever sees it.
 */
export const sectionOfColumnId = (id: string) =>
  id.startsWith("section:") ? id.slice("section:".length) : null;

const kindOf = (data: unknown): string | undefined =>
  (data as { kind?: string } | undefined)?.kind;

/**
 * Pick the drop target for the kind being dragged.
 *
 * The two drags share one context but never see each other: a card is only ever
 * dropped on a card or on a column body, a column only on another column's
 * header. Filtering by kind is what stops a card from being dropped "onto" a
 * header (which would read as a section reorder) and a column from landing
 * inside a card list.
 *
 * Among the candidates under the pointer the smallest wins, so a card beats the
 * column body it sits in — the pointer is over both, and the card is the more
 * specific answer. The body is only reached in the gaps between cards, which is
 * exactly where "append here" is meant.
 */
const boardCollision: CollisionDetection = (args) => {
  const kind = kindOf(args.active.data.current);
  const kindFor = (id: UniqueIdentifier) =>
    kindOf(args.droppableContainers.find((c) => c.id === id)?.data.current);
  const area = (id: UniqueIdentifier) => {
    const r = args.droppableRects.get(id);
    return r ? r.width * r.height : Number.POSITIVE_INFINITY;
  };
  const keep = (hits: ReturnType<CollisionDetection>) =>
    hits.filter((h) => h.id !== args.active.id && kindFor(h.id) === kind);

  const within = keep(pointerWithin(args));
  const hits = within.length > 0 ? within : keep(rectIntersection(args));
  return [...hits].sort((a, b) => area(a.id) - area(b.id));
};

/** Which half of the hovered rect the pointer is in. */
function bandIn(event: DragMoveEvent | DragEndEvent): DropBand {
  const rect = event.over?.rect;
  const start = event.activatorEvent;
  if (!rect || !(start instanceof MouseEvent)) return "after";
  return resolveDropBand(start.clientY + event.delta.y - rect.top, rect.height);
}

/**
 * Board view (design §5.9 / §13.1): one column per section, the "no section"
 * column first, an "add section" column last — Todoist's column list, which is
 * `[uncategorized, ...sections, add-section]`.
 *
 * Cards are top-level tasks only. A subtask is never a card: its place is its
 * parent's row, so the board reads the same root-only list the list view does
 * and puts a branch's progress on the card instead of its children.
 *
 * The board owns a `DndContext` nested inside the app-wide one, the way the
 * calendar does. A drop here means something different from a drop in a list —
 * it picks a column as well as a position — and the app-wide resolver works off
 * the visible task rows, which on a board are scattered across columns.
 */
export default function BoardView({
  projectId,
  includeCompleted,
  sections,
  onOpenTask,
}: {
  projectId: string;
  includeCompleted: boolean;
  sections: ReturnType<typeof useProjectSections>;
  onOpenTask: (id: string) => void;
}) {
  const qc = useQueryClient();
  const { modal } = AntApp.useApp();
  const { patch, toggle, remove } = useTaskMutations();
  const [active, setActive] = useState<DragData | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // A board is inherently a manual order: a column's cards are the project's
  // rank read top to bottom, so the list's display setting does not apply here.
  const filter = projectFilter(projectId, { sort: "manual", includeCompleted });
  const { data } = useQuery({
    queryKey: qk.tasks(filter),
    queryFn: () => api.taskList(filter),
    enabled: Boolean(projectId),
  });

  const tasks = data?.items ?? [];
  const groups = groupBySection(tasks, sections.sections, { keepEmpty: true });

  /** The group key a drop target belongs to — a column body, or the column that
   *  holds the hovered card. A card's drop id is the task's own id, since that is
   *  the id its sortable node is registered under. */
  const keyForDrop = (dropId: string): string | null => {
    if (dropId.startsWith("column:")) return dropId.slice("column:".length);
    const group = groups.find((g) => g.tasks.some((t) => t.id === dropId));
    return group ? (group.section?.id ?? NO_SECTION) : null;
  };

  /** The section a key names, or `null` for the unfiled column. */
  const sectionOfKey = (key: string | null) => (key === NO_SECTION ? null : key);

  /** Where a card lands among its new siblings, measured before the move. */
  const cardIndexAt = (taskId: string, band: DropBand): number | null => {
    const group = groups.find((g) => g.tasks.some((t) => t.id === taskId));
    if (!group) return null;
    const at = group.tasks.findIndex((t) => t.id === taskId);
    return band === "before" ? at : at + 1;
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.tasksAll });
    qc.invalidateQueries({ queryKey: qk.subtasksAll });
    qc.invalidateQueries({ queryKey: qk.sectionsAll });
    qc.invalidateQueries({ queryKey: qk.projectAll });
  };

  const onDragMove = (event: DragMoveEvent) => {
    setOverKey(event.over ? keyForDrop(String(event.over.id)) : null);
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const payload = event.active.data.current as DragData | undefined;
    const overId = event.over ? String(event.over.id) : null;
    const band = bandIn(event);
    setActive(null);
    setOverKey(null);
    if (!payload || !overId) return;

    if (payload.kind === "column") {
      const over = sectionOfColumnId(overId);
      // Only real sections move: the "no section" column is pinned first, so it
      // has no drag handle and never reaches here.
      if (!over || !sections.sections.some((s) => s.id === over)) return;
      const next = planColumnReorder({
        sectionIds: sections.sections.map((s) => s.id),
        activeId: payload.sectionId,
        overId: over,
        band,
      });
      if (next) sections.reorder.mutate(next);
      return;
    }

    const toKey = keyForDrop(overId);
    if (toKey === null) return;
    const plan = planCardDrop({
      groups,
      activeId: payload.taskId,
      toSectionId: sectionOfKey(toKey),
      // A drop on a column body appends; on a card it lands in that card's gap.
      toIndex: overId.startsWith("column:") ? null : cardIndexAt(overId, band),
    });
    if (!plan) return;

    // The column and the position are one gesture split into two commands, the
    // way Todoist splits it (`item_move`, then `item_reorder`): only
    // `task_update` can re-file a card, and only `task_reorder` can rank it.
    const from = groups.find((g) => g.tasks.some((t) => t.id === payload.taskId));
    const fromKey = from ? (from.section?.id ?? NO_SECTION) : null;
    if (toKey !== fromKey) {
      const sectionId = sectionOfKey(toKey);
      await patch.mutateAsync({
        id: payload.taskId,
        patch: sectionId ? { section_id: sectionId } : { clear_section_id: true },
      });
    }
    await api.taskReorder(plan.order);
    invalidate();
  };

  const confirmDelete = (task: TaskDto) => {
    modal.confirm({
      title: `删除任务「${task.title}」？`,
      content: "此操作不可撤销。",
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: () => remove.mutateAsync(task.id),
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DndContext
        id="board-dnd"
        sensors={sensors}
        collisionDetection={boardCollision}
        onDragStart={(e: DragStartEvent) =>
          setActive((e.active.data.current as DragData | undefined) ?? null)
        }
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActive(null);
          setOverKey(null);
        }}
      >
        <div className="flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto px-6 py-4">
          {groups.map((group) => {
            const key = group.section?.id ?? NO_SECTION;
            return (
              <BoardColumn
                key={key}
                groupKey={key}
                section={group.section}
                tasks={group.tasks}
                highlighted={overKey === key}
                projectId={projectId}
                sections={sections}
                onOpenTask={onOpenTask}
                onToggle={(t) => toggle.mutate(t)}
                onDelete={confirmDelete}
              />
            );
          })}
          {/* The add-section column is a column too: same width, same full
              height, same corner — dashed and unfilled, because it is a slot
              where a column will be, not a column. */}
          <div
            className="flex shrink-0 flex-col rounded-lg border border-dashed"
            style={{ width: COLUMN_WIDTH, borderColor: "var(--border-strong)" }}
          >
            <button
              type="button"
              onClick={sections.promptCreate}
              className="composer-trigger composer-trigger--board flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-body"
              style={{ color: "var(--text-secondary)" }}
            >
              <PlusOutlined style={{ fontSize: 13, color: "var(--accent)" }} aria-hidden="true" />
              添加板块
            </button>
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {active?.kind === "card" ? (
            <div
              className="rounded-md border px-3 py-2 shadow-lg"
              style={{
                width: COLUMN_WIDTH - 24,
                background: "var(--bg-surface)",
                borderColor: "var(--accent)",
              }}
            >
              {tasks.find((t) => t.id === active.taskId)?.title}
            </div>
          ) : active?.kind === "column" ? (
            <div
              className="rounded-lg border px-3 py-2 font-semibold shadow-lg"
              style={{
                width: COLUMN_WIDTH,
                background: "var(--bg-surface)",
                borderColor: "var(--accent)",
              }}
            >
              {active.name}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

/** One column: header, card list, footer. */
function BoardColumn({
  groupKey,
  section,
  tasks,
  highlighted,
  projectId,
  sections,
  onOpenTask,
  onToggle,
  onDelete,
}: {
  groupKey: string;
  section: SectionDto | null;
  tasks: TaskDto[];
  highlighted: boolean;
  projectId: string;
  sections: ReturnType<typeof useProjectSections>;
  onOpenTask: (id: string) => void;
  onToggle: (task: TaskDto) => void;
  onDelete: (task: TaskDto) => void;
}) {
  const { setNodeRef: setBodyRef, isOver } = useDroppable({
    id: columnDropId(groupKey),
    data: { kind: "card", sectionId: section?.id ?? null } satisfies DropData,
  });

  // The whole column is the sortable node, so dragging a column translates the
  // column and not just its header; the grip is the only thing that starts one,
  // which leaves the header's own buttons clickable.
  const {
    attributes,
    listeners,
    setNodeRef: setColumnRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: columnDragId(groupKey),
    // The "no section" column is pinned first, so it is not draggable — and, by
    // the same flag, not a column drop target either.
    disabled: section === null,
    data: {
      kind: "column",
      sectionId: section?.id ?? groupKey,
      name: section?.name ?? "无板块",
    } satisfies DragData,
  });

  const name = section?.name ?? "无板块";
  const menu: MenuProps = {
    items: [
      { key: "rename", icon: <EditOutlined />, label: "重命名板块" },
      { key: "delete", icon: <DeleteOutlined />, label: "删除板块", danger: true },
    ],
    onClick: ({ key }) => {
      if (!section) return;
      if (key === "rename") sections.promptRename(section);
      else if (key === "delete") sections.promptDelete(section, tasks.length);
    },
  };

  return (
    <section
      ref={setColumnRef}
      aria-label={name}
      style={
        {
          width: COLUMN_WIDTH,
          transform: CSS.Transform.toString(transform),
          transition: transition ?? undefined,
          background: "var(--bg-sunken)",
          borderColor: isOver ? "var(--accent)" : "var(--border-hairline)",
          opacity: isDragging ? 0.4 : undefined,
        } as CSSProperties
      }
      className="flex shrink-0 flex-col rounded-lg border"
    >
      <header className="flex items-center gap-1.5 px-2.5 py-2">
        <Typography.Text strong className="text-small truncate" title={name}>
          {name}
        </Typography.Text>
        <span className="tabular text-meta" style={{ color: "var(--text-tertiary)" }}>
          {tasks.length}
        </span>
        <span className="ml-auto flex items-center gap-0.5">
          {section && (
            <>
              <Tooltip title="拖动可调整板块顺序">
                <Button
                  type="text"
                  size="small"
                  aria-label={`拖动板块 ${name}`}
                  className="row-action cursor-grab active:cursor-grabbing"
                  style={{ padding: 0, width: 18, height: 18, minWidth: 18 }}
                  icon={<HolderOutlined />}
                  {...attributes}
                  {...listeners}
                />
              </Tooltip>
              <Dropdown menu={menu} trigger={["click"]}>
                <Button
                  type="text"
                  size="small"
                  aria-label={`板块操作：${name}`}
                  className="row-action"
                  style={{ padding: 0, width: 18, height: 18, minWidth: 18 }}
                  icon={<MoreOutlined />}
                />
              </Dropdown>
            </>
          )}
        </span>
      </header>

      {/* The body is the append target, and it spans the column's full height:
          the empty space under the last card is a place to drop, not a dead
          zone. An empty column keeps a 1px spacer so it stays measurable. */}
      <div
        ref={setBodyRef}
        className="min-h-0 flex-1 overflow-y-auto px-2"
        style={highlighted && !isOver ? { background: "var(--accent-soft)" } : undefined}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableBoardCard
              key={task.id}
              task={task}
              onOpen={onOpenTask}
              onToggle={onToggle}
              onDelete={onDelete}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 && <div style={{ minHeight: 1 }} />}
      </div>

      <footer className="px-2 pb-2">
        <ColumnComposer projectId={projectId} sectionId={section?.id} name={name} />
      </footer>
    </section>
  );
}

/** A card wired into the board's sortable context. */
function SortableBoardCard({
  task,
  onOpen,
  onToggle,
  onDelete,
}: {
  task: TaskDto;
  onOpen: (id: string) => void;
  onToggle: (task: TaskDto) => void;
  onDelete: (task: TaskDto) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { kind: "card", taskId: task.id } satisfies DragData,
  });

  const done = task.status === "done" || task.status === "cancelled";
  const dueAt = task.due_at ?? task.start_at;
  const overdue = isOverdue(dueAt, task.status, task.all_day);

  const menu: MenuProps = {
    items: [
      { key: "open", icon: <EditOutlined />, label: "打开详情" },
      { key: "delete", icon: <DeleteOutlined />, label: "删除", danger: true },
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (key === "open") onOpen(task.id);
      else if (key === "delete") onDelete(task);
    },
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="task-row group mb-1.5 rounded-md border p-2"
      style={
        {
          background: "var(--bg-surface)",
          borderColor: "var(--border-hairline)",
          transform: CSS.Transform.toString(transform),
          transition: transition ?? undefined,
          opacity: isDragging ? 0.4 : undefined,
          "--checkbox-ring": PRIORITY_RING[task.priority],
        } as CSSProperties
      }
    >
      {/* The card's own controls stop the pointer from reaching the drag
          listeners on the wrapper, so a click on the checkbox or the title is
          never also the start of a drag. */}
      <div className="flex items-start gap-1.5">
        <span
          className="flex h-[1.5em] shrink-0 items-center"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={done}
            onChange={() => onToggle(task)}
            aria-label={`完成 ${task.title}`}
          />
        </span>
        <button
          type="button"
          onClick={() => onOpen(task.id)}
          onPointerDown={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 cursor-grab text-left"
          aria-label={`打开任务详情：${task.title}`}
        >
          <Typography.Text
            delete={done}
            style={{
              display: "block",
              whiteSpace: "normal",
              color: done ? "var(--text-disabled)" : undefined,
            }}
          >
            {task.title}
          </Typography.Text>
        </button>
        <Dropdown menu={menu} trigger={["click"]}>
          <Button
            type="text"
            size="small"
            aria-label={`更多操作：${task.title}`}
            className="row-action"
            style={{ padding: 0, width: 18, height: 18, minWidth: 18 }}
            icon={<MoreOutlined />}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        </Dropdown>
      </div>

      {task.description && (
        <div
          className="mt-1 line-clamp-2 text-meta"
          style={{ color: "var(--text-tertiary)" }}
          title={task.description}
        >
          {task.description}
        </div>
      )}

      <CardMeta task={task} dueAt={dueAt} overdue={overdue} onOpen={() => onOpen(task.id)} />
    </div>
  );
}

/** The card's quiet bottom line: what is due, how much of the branch is ticked,
 *  and which tags it carries. Everything else is one click away in the modal. */
function CardMeta({
  task,
  dueAt,
  overdue,
  onOpen,
}: {
  task: TaskDto;
  dueAt: number | null;
  overdue: boolean;
  onOpen: () => void;
}) {
  if (dueAt == null && task.subtask_total === 0 && task.tags.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-meta leading-none">
      {dueAt != null && (
        <button
          type="button"
          onClick={onOpen}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex items-center gap-1"
          style={{ color: overdue ? "var(--state-overdue)" : "var(--text-tertiary)" }}
        >
          {overdue ? (
            <AlertOutlined style={{ fontSize: 11 }} />
          ) : (
            <CalendarOutlined style={{ fontSize: 11 }} />
          )}
          {formatDue(dueAt, task.all_day)}
        </button>
      )}
      {task.subtask_total > 0 && (
        <span
          className="flex items-center gap-1"
          style={{
            color:
              task.subtask_done >= task.subtask_total
                ? "var(--state-done)"
                : "var(--text-tertiary)",
          }}
          aria-label={`子任务完成 ${task.subtask_done} / ${task.subtask_total}`}
        >
          <BranchesOutlined style={{ fontSize: 11 }} aria-hidden="true" />
          <span className="tabular">
            {task.subtask_done}/{task.subtask_total}
          </span>
        </span>
      )}
      {task.tags.map((tag) => (
        <span key={tag} style={{ color: "var(--accent-ink)" }}>
          #{tag}
        </span>
      ))}
    </div>
  );
}

/**
 * The column footer's "add task", which files straight into that column.
 *
 * The same two states as the list's composer (design §8.18), so the board is not
 * a second dialect of "add a task": closed it is the quiet `＋ 添加任务` row, open
 * it is a real box the size and shape of a card. What is missing against the list
 * one is what a 286px column has no room for — the priority and date chips — so
 * it keeps the title and description, names the column the task will land in, and
 * stops there. Like the list, Enter files the task and the box stays open and
 * cleared for the next one; leaving it empty collapses it.
 */
function ColumnComposer({
  projectId,
  sectionId,
  name,
}: {
  projectId: string;
  sectionId?: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const titleRef = useRef<InputRef>(null);
  const { create } = useTaskMutations();

  // The unfiled column is a real destination but has no section behind it, so
  // its labels say where a task lands without pretending "无板块" is a name.
  const where = sectionId ? `板块「${name}」` : "无板块列";

  const reset = () => {
    setTitle("");
    setDescription("");
  };

  const submit = () => {
    const text = title.trim();
    if (!text) return;
    const desc = description.trim();
    create.mutate(
      {
        title: text,
        description: desc || undefined,
        project_id: projectId,
        section_id: sectionId ?? null,
      },
      {
        onSuccess: () => {
          reset();
          titleRef.current?.focus();
        },
      },
    );
  };

  const collapse = () => {
    setOpen(false);
    reset();
  };

  /** Leaving the box entirely with nothing typed closes it again; moving between
   *  the fields inside it must not. */
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (!title.trim() && !description.trim()) collapse();
  };

  const onKeyDown = (e: { key: string }) => {
    if (e.key === "Escape") collapse();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`在${where}中添加任务`}
        className="composer-trigger composer-trigger--board flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-body"
        style={{ color: "var(--text-secondary)" }}
      >
        <PlusOutlined style={{ fontSize: 13, color: "var(--accent)" }} aria-hidden="true" />
        添加任务
      </button>
    );
  }

  return (
    // The open box takes the card's measure — same padding, same radius, plus the
    // elevation a floating thing gets — so it reads as the card it is about to
    // become rather than as a form dropped into the column.
    <div
      className="composer-box rounded-md border px-2 pb-1.5 pt-2"
      style={{
        background: "var(--bg-surface)",
        borderColor: "var(--border-strong)",
        boxShadow: "var(--e1)",
      }}
      onBlur={onBlur}
    >
      <Input
        ref={titleRef}
        autoFocus
        variant="borderless"
        placeholder="任务名称"
        aria-label={`在${where}中添加任务`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onPressEnter={submit}
        onKeyDown={onKeyDown}
        style={{ paddingInline: 0, fontSize: 14 }}
      />
      <Input
        variant="borderless"
        placeholder="描述"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onPressEnter={submit}
        onKeyDown={onKeyDown}
        style={{ paddingInline: 0, fontSize: 12 }}
      />

      <div className="mt-1.5 flex items-center gap-1.5 border-t border-[var(--border-hairline)] pt-1.5">
        {sectionId && (
          <span
            className="truncate rounded px-1.5 py-0.5 text-meta"
            style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}
          >
            # {name}
          </span>
        )}
        <Button
          type="text"
          size="small"
          aria-label="收起添加框"
          style={{ marginInlineStart: "auto", padding: 0, width: 22, height: 22, minWidth: 22 }}
          icon={<CloseOutlined />}
          onClick={collapse}
        />
      </div>
    </div>
  );
}
