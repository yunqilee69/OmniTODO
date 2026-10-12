import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "antd";
import { api, type TaskPatch } from "../api/client";
import { useTaskMutations } from "../hooks/useTaskMutations";
import { placeSubtree } from "../lib/subtree";
import TaskRow from "./TaskRow";

/**
 * The branch revealed by a row's expand handle (design §13.2): the task's whole
 * subtree, indented by depth. Renders as `<li>`s beside the parent row so the
 * container stays one flat `<ul>` — dnd-kit and the virtualizer both require
 * real sibling rows.
 *
 * The rows are deliberately not expandable themselves: the subtree query
 * already returns every level, so a nested handle would only duplicate it.
 */
export default function SubtaskRows({
  parentId,
  highlight,
  onOpenTask,
}: {
  parentId: string;
  highlight?: string;
  onOpenTask?: (id: string) => void;
}) {
  const { toggle, patch } = useTaskMutations();
  const { data, isLoading, error } = useQuery({
    queryKey: ["subtasks", parentId],
    queryFn: () => api.taskListSubtasks(parentId),
  });

  if (isLoading) {
    return (
      <li className="py-1 pl-9 pr-3">
        <Skeleton active title={false} paragraph={{ rows: 1, width: "40%" }} />
      </li>
    );
  }
  if (error) {
    return <li className="py-1 pl-9 pr-3 text-xs opacity-60">子任务加载失败</li>;
  }

  const placed = placeSubtree(parentId, data ?? []);
  if (placed.length === 0) {
    return <li className="py-1 pl-9 pr-3 text-xs opacity-60">没有子任务</li>;
  }

  return (
    <>
      {placed.map(({ task, depth }) => (
        <TaskRow
          key={task.id}
          task={task}
          depth={depth}
          highlight={highlight}
          onOpen={onOpenTask}
          onToggle={(t) => toggle.mutate(t)}
          onPatch={(id: string, p: TaskPatch) => patch.mutate({ id, patch: p })}
        />
      ))}
    </>
  );
}
