import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { qk } from "../api/queryKeys";
import TaskList from "../components/TaskList";
import { tagFilter } from "../lib/filter";
import { useUiStore } from "../stores/ui";

/** Tag view: a cross-project cut of every task carrying the tag (§13.1). */
export default function TagView() {
  const { id = "" } = useParams();
  const selectTask = useUiStore((s) => s.selectTask);
  const { data: tags } = useQuery({ queryKey: qk.tags, queryFn: () => api.tagList() });
  const tag = tags?.find((t) => t.id === id);
  const filter = useMemo(() => tagFilter(id), [id]);

  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold">
        #{tag?.name ?? "标签"}
        {tag && <span className="ml-2 text-sm font-normal text-neutral-500">{tag.count} 项</span>}
      </h1>
      <TaskList filter={filter} onOpenTask={selectTask} emptyHint="这个标签下没有任务" />
    </section>
  );
}
