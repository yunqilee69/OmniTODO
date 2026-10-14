import { useMemo } from "react";
import PageContent from "../components/PageContent";
import PageHeader from "../components/PageHeader";
import TaskList from "../components/TaskList";
import { inboxFilter, todayFilter, upcomingFilter } from "../lib/filter";
import { useUiStore } from "../stores/ui";

export type ListVariant = "inbox" | "today" | "upcoming";

const EMPTY_HINT: Record<ListVariant, string> = {
  inbox: "收件箱是空的，记一件要做的事。",
  today: "今天没有到期的任务。",
  upcoming: "接下来几天没有安排。",
};

/** Inbox / Today / Upcoming — the three default filters (design §13.1). */
export default function TaskListView({ title, variant }: { title: string; variant: ListVariant }) {
  const selectTask = useUiStore((s) => s.selectTask);
  const filter = useMemo(
    () =>
      variant === "today"
        ? todayFilter()
        : variant === "upcoming"
          ? upcomingFilter()
          : inboxFilter(),
    [variant],
  );

  return (
    <section className="flex h-full min-h-0 flex-col">
      <PageHeader title={title} />
      <PageContent taskList>
        <TaskList filter={filter} onOpenTask={selectTask} emptyHint={EMPTY_HINT[variant]} />
      </PageContent>
    </section>
  );
}
