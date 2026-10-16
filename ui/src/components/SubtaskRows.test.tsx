import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskDto } from "../api/client";
import SubtaskRows from "./SubtaskRows";

const { listSubtasks } = vi.hoisted(() => ({ listSubtasks: vi.fn() }));

// Only the one command this component reads is stubbed; everything else stays
// real, so the module's other imports (`useTaskMutations`) keep working.
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { ...actual.api, taskListSubtasks: (id: string) => listSubtasks(id) } };
});

function task(over: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "s1",
    project_id: null,
    parent_id: "p",
    series_id: null,
    occurrence_at: null,
    title: "写提纲",
    description: null,
    priority: "none",
    status: "todo",
    completed_at: null,
    start_at: null,
    due_at: null,
    all_day: false,
    timezone: null,
    remind_enabled: false,
    remind_at: null,
    remind_offset_min: null,
    recurrence_rule: null,
    recurrence_until: null,
    tag_ids: [],
    tags: [],
    has_attachments: false,
    has_subtasks: false,
    subtask_done: 0,
    subtask_total: 0,
    sort_order: 0,
    created_at: 0,
    updated_at: 0,
    version: 1,
    ...over,
  };
}

function mount(rows: TaskDto[]) {
  listSubtasks.mockResolvedValue(rows);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ul>
        <SubtaskRows parentId="p" />
      </ul>
    </QueryClientProvider>,
  );
}

beforeEach(() => listSubtasks.mockClear());

describe("SubtaskRows", () => {
  it("renders a row per child", async () => {
    mount([task({ id: "s1", title: "写提纲" }), task({ id: "s2", title: "查资料" })]);
    expect(await screen.findByText("写提纲")).toBeInTheDocument();
    expect(screen.getByText("查资料")).toBeInTheDocument();
  });

  // The reported bug. Deleting the last subtask left the parent in the list's
  // expanded set, and the branch then rendered a "没有子任务" line — a stray row
  // sitting in the list behind the delete, with nothing to expand or collapse.
  it("renders nothing at all for an empty branch", async () => {
    const { container } = mount([]);
    // The loading skeleton is an `<li>` too, so this waits for the query to
    // settle *and* for the branch to come back empty.
    await waitFor(() => expect(container.querySelector("li")).toBeNull());
    expect(listSubtasks).toHaveBeenCalledWith("p");
    expect(screen.queryByText("没有子任务")).not.toBeInTheDocument();
  });
});
