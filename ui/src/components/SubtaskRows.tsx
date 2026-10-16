import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "antd";
import { Fragment, useCallback, useState, type CSSProperties, type ReactNode } from "react";
import { api, type TaskDto, type TaskPatch } from "../api/client";
import { qk } from "../api/queryKeys";
import { useTaskMutations } from "../hooks/useTaskMutations";
import { rowRuleInset } from "../lib/layout";
import { subtreeChildren } from "../lib/subtree";
import SortableTaskRow from "./SortableTaskRow";
import TaskRow, { type TaskRowProps } from "./TaskRow";

/** Left offset of a depth-1 row's title: indent + both gutters + the checkbox
 *  column (DESIGN §8.3), so placeholder lines sit under the real titles. */
const SUBTASK_TEXT_INSET = rowRuleInset(1) + 24;

/** A placeholder stands in for a depth-1 row, so its hairline starts where its
 *  siblings' hairlines do. */
const PLACEHOLDER_STYLE: CSSProperties = {
  paddingLeft: SUBTASK_TEXT_INSET,
  "--rule-inset": `${rowRuleInset(1)}px`,
} as CSSProperties;

/** The branch's children are loaded right here, so a row's "has a branch" fact
 *  comes from the query rather than from the rolled-up flag — which may lag a
 *  just-added child behind, and would then hide it with no way to open it. */
const withBranch = (task: TaskDto, hasBranch: boolean): TaskDto =>
  task.has_subtasks === hasBranch ? task : { ...task, has_subtasks: hasBranch };

/**
 * The branch revealed by a row's expand handle (design §13.2): the task's whole
 * subtree, indented by depth. Renders as `<li>`s beside the parent row so the
 * container stays one flat `<ul>` — dnd-kit and the virtualizer both require
 * real sibling rows.
 *
 * A nested row is a task row like any other: it carries the drag handle when the
 * list is draggable, and its own caret when it has children of its own, so a
 * deeper branch collapses the same way the top level does instead of spilling
 * open permanently.
 */
export default function SubtaskRows({
  parentId,
  sortable = false,
  highlight,
  onOpenTask,
  onDelete,
}: {
  parentId: string;
  /** Rows are drag-sortable among their siblings (needs the app-level DndContext). */
  sortable?: boolean;
  highlight?: string;
  onOpenTask?: (id: string) => void;
  onDelete?: (task: TaskDto) => void;
}) {
  const { toggle, patch } = useTaskMutations();
  const { data, isLoading, error } = useQuery({
    queryKey: qk.subtasks(parentId),
    queryFn: () => api.taskListSubtasks(parentId),
  });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  if (isLoading) {
    return (
      <li className="py-1.5 pr-3" style={PLACEHOLDER_STYLE}>
        <Skeleton active title={false} paragraph={{ rows: 1, width: "40%" }} />
      </li>
    );
  }
  if (error) {
    return (
      <li className="py-1.5 pr-3 text-meta" style={{ ...PLACEHOLDER_STYLE, color: "var(--text-tertiary)" }}>
        子任务加载失败
      </li>
    );
  }

  const byParent = subtreeChildren(parentId, data ?? []);
  // No children means there is nothing to show. The usual cause is that the last
  // child was just deleted: the parent is only still in the list's expanded set
  // because it was expanded a moment ago, and a "没有子任务" line there would
  // leave a stray row sitting in the list behind the delete.
  if (!byParent.has(parentId)) return null;

  const rowProps = (task: TaskDto, depth: number, hasBranch: boolean): TaskRowProps => ({
    task: withBranch(task, hasBranch),
    depth,
    highlight,
    onOpen: onOpenTask,
    onToggle: (t: TaskDto) => toggle.mutate(t),
    onPatch: (id: string, p: TaskPatch) => patch.mutate({ id, patch: p }),
    onDelete,
    expanded: expanded.has(task.id),
    onToggleExpand: hasBranch ? toggleExpand : undefined,
  });

  /**
   * One row per child, its own branch immediately below it, depth-first — so the
   * rows come out in the order they should read, which is also the order the
   * flat `<ul>` needs them in.
   *
   * Each sibling group gets its own `SortableContext`: dragging is only
   * meaningful between rows that share a parent, and a row therefore sorts
   * against its siblings and not against the list around it. The provider draws
   * no element of its own, so the rows stay direct children of that one `<ul>`.
   */
  const renderLevel = (pid: string, depth: number): ReactNode => {
    const kids = byParent.get(pid) ?? [];
    if (kids.length === 0) return null;
    const rows: ReactNode[] = [];
    for (const task of kids) {
      const hasBranch = byParent.has(task.id);
      const props = rowProps(task, depth, hasBranch);
      rows.push(sortable ? <SortableTaskRow key={task.id} {...props} /> : <TaskRow key={task.id} {...props} />);
      if (hasBranch && expanded.has(task.id)) rows.push(renderLevel(task.id, depth + 1));
    }
    return sortable ? (
      <SortableContext key={pid} items={kids.map((k) => k.id)} strategy={verticalListSortingStrategy}>
        {rows}
      </SortableContext>
    ) : (
      <Fragment key={pid}>{rows}</Fragment>
    );
  };

  return <>{renderLevel(parentId, 1)}</>;
}
