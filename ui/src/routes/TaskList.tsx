import { useMemo } from "react";
import TaskList from "../components/TaskList";
import { inboxFilter, todayFilter, upcomingFilter } from "../lib/filter";
import { useUiStore } from "../stores/ui";

export type ListVariant = "inbox" | "today" | "upcoming";

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
    <section>
      <h1 className="mb-4 text-xl font-semibold">{title}</h1>
      <TaskList filter={filter} onOpenTask={selectTask} />
    </section>
  );
}
