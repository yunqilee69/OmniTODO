import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { qk } from "../api/queryKeys";
import PageContent from "../components/PageContent";
import PageHeader from "../components/PageHeader";
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
    <section className="flex h-full min-h-0 flex-col">
      <PageHeader title={`#${tag?.name ?? "标签"}`} meta={tag ? `${tag.count} 项` : undefined} />
      <PageContent taskList>
        <TaskList filter={filter} onOpenTask={selectTask} emptyHint="这个标签下没有任务" />
      </PageContent>
    </section>
  );
}
