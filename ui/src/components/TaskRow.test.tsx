import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskDto } from "../api/client";
import { todayCivil } from "../lib/dates";
import TaskRow from "./TaskRow";

function task(over: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "t1",
    project_id: null,
    parent_id: null,
    series_id: null,
    occurrence_at: null,
    title: "写周报",
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

const DAY = 86_400_000;

describe("TaskRow subtask roll-up", () => {
  it("shows nothing on a leaf task", () => {
    const { container } = render(<TaskRow task={task()} />);
    expect(screen.queryByLabelText(/子任务完成/)).not.toBeInTheDocument();
    expect(container.querySelector(".anticon-branches")).not.toBeInTheDocument();
  });

  it("counts the whole subtree, not just the direct child", () => {
    render(<TaskRow task={task({ subtask_done: 2, subtask_total: 3 })} />);
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getByLabelText("子任务完成 2 / 3")).toBeInTheDocument();
  });

  it("says 0/1 for an untouched branch", () => {
    render(<TaskRow task={task({ subtask_done: 0, subtask_total: 1 })} />);
    expect(screen.getByText("0/1")).toBeInTheDocument();
  });
});

describe("TaskRow priority channel", () => {
  it("colours the checkbox ring and repeats the value for screen readers", () => {
    const { container } = render(<TaskRow task={task({ priority: "urgent" })} />);
    const row = container.querySelector(".task-row") as HTMLElement;
    expect(row.style.getPropertyValue("--checkbox-ring")).toBe("var(--prio-urgent)");
    expect(screen.getByText("优先级：紧急")).toBeInTheDocument();
  });

  it("falls back to the neutral ring when no priority is set", () => {
    const { container } = render(<TaskRow task={task()} />);
    const row = container.querySelector(".task-row") as HTMLElement;
    expect(row.style.getPropertyValue("--checkbox-ring")).toBe("var(--border-strong)");
    expect(screen.getByText("优先级：无")).toBeInTheDocument();
  });

  it("moves priority off the row: no inline control, it is named on ⋯", () => {
    render(<TaskRow task={task({ priority: "high" })} onPatch={vi.fn()} />);
    // The row's only priority affordance is the ring; the ⋯ trigger names the
    // value so the setting is reachable (and announced) without the inline dot.
    expect(screen.getByRole("button", { name: "更多操作：写周报（优先级：高）" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^优先级：/ })).not.toBeInTheDocument();
  });
});

describe("TaskRow leading gutters", () => {
  // Both gutters are always reserved, so the checkbox stays on one left edge;
  // which of the two holds the (hover-revealed) drag handle depends on whether
  // the row also shows its (always-visible) subtask caret.
  const gutters = (container: HTMLElement) =>
    (container.querySelector(".task-row") as HTMLElement).querySelectorAll(":scope > span");

  it("puts the handle beside the checkbox when the row has no branch", () => {
    const { container } = render(<TaskRow task={task()} handle={<span data-testid="handle" />} />);
    const [leading, beside] = gutters(container);
    expect(leading.querySelector('[data-testid="handle"]')).not.toBeInTheDocument();
    expect(beside.querySelector('[data-testid="handle"]')).toBeInTheDocument();
    expect(container.querySelector(".anticon-caret-right")).not.toBeInTheDocument();
  });

  it("moves the handle one slot left when a caret takes its place", () => {
    const { container } = render(
      <TaskRow
        task={task({ has_subtasks: true })}
        handle={<span data-testid="handle" />}
        onToggleExpand={vi.fn()}
      />,
    );
    const [leading, beside] = gutters(container);
    expect(leading.querySelector('[data-testid="handle"]')).toBeInTheDocument();
    expect(beside.querySelector(".anticon-caret-right")).toBeInTheDocument();
    expect(beside.querySelector('[data-testid="handle"]')).not.toBeInTheDocument();
  });
});

describe("TaskRow due date", () => {
  // An all-day due date is a civil date (UTC midnight), so the fixtures have to
  // be built the same way the app stores them.
  it("sits in the row's meta line, flagged when late", () => {
    const { container } = render(
      <TaskRow task={task({ due_at: todayCivil() - DAY, all_day: true })} />,
    );
    expect(screen.getByDisplayValue("昨天")).toBeInTheDocument();
    expect(container.querySelector(".anticon-alert")).toBeInTheDocument();
  });

  it("leaves a future date unflagged", () => {
    const { container } = render(
      <TaskRow task={task({ due_at: todayCivil() + DAY, all_day: true })} />,
    );
    expect(screen.getByDisplayValue("明天")).toBeInTheDocument();
    expect(container.querySelector(".anticon-alert")).not.toBeInTheDocument();
  });

  it("offers ＋日期 only on hover when there is no date", () => {
    render(<TaskRow task={task()} />);
    expect(screen.getByPlaceholderText("＋日期")).toBeInTheDocument();
  });
});
