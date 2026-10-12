import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { qk } from "../api/queryKeys";
import TaskList from "../components/TaskList";
import { projectFilter } from "../lib/filter";
import { useUiStore } from "../stores/ui";

/** Project view: tasks in the user's manual order, drag-sortable (§13.1). */
export default function ProjectView() {
  const { id = "" } = useParams();
  const selectTask = useUiStore((s) => s.selectTask);

  const { data: project } = useQuery({
    queryKey: qk.project(id),
    queryFn: () => api.projectGet(id),
    enabled: Boolean(id),
  });

  const filter = useMemo(() => projectFilter(id), [id]);
  const stats = project?.stats;

  return (
    <section>
      <header className="mb-3">
        <h1 className="text-xl font-semibold">{project?.name ?? "项目"}</h1>
        {stats && (
          <p className="mt-0.5 text-xs text-neutral-500">
            未完成 {stats.open} · 已完成 {stats.completed}
            {stats.overdue > 0 && <span className="text-red-600"> · 逾期 {stats.overdue}</span>}
          </p>
        )}
      </header>
      <p className="mb-2 text-xs text-neutral-400">
        拖动 ⠿ 调整顺序；把任务拖到左侧其他项目即可移动。
      </p>
      <TaskList
        filter={filter}
        sortable
        onOpenTask={selectTask}
        emptyHint="这个项目还没有任务"
      />
    </section>
  );
}
