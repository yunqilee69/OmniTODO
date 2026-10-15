import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TaskComposer from "./TaskComposer";

// Hoisted so the module factory can reach them (vitest runs the factory before
// this file's own tops).
const { createTask, addSubtask } = vi.hoisted(() => ({
  createTask: vi.fn().mockResolvedValue({ id: "new-task" }),
  addSubtask: vi.fn().mockResolvedValue({ id: "new-subtask" }),
}));

vi.mock("../api/client", () => ({
  api: {
    taskCreate: (input: unknown) => createTask(input),
    taskAddSubtask: (parentId: string, input: unknown) => addSubtask(parentId, input),
  },
}));

function mount(props: Partial<ComponentProps<typeof TaskComposer>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ul>
        <TaskComposer projectId="p1" {...props} />
      </ul>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  createTask.mockClear();
  addSubtask.mockClear();
});

describe("TaskComposer", () => {
  it("opens a full input box from the quiet add-task line", () => {
    mount();
    // Closed: one affordance, no fields to type into.
    expect(screen.getByRole("button", { name: /添加任务/ })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("任务名称")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /添加任务/ }));

    // Open: a real box with both fields and a way back out.
    expect(screen.getByPlaceholderText("任务名称")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("描述")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起添加框" })).toBeInTheDocument();
  });

  it("closes again on the × button", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /添加任务/ }));
    fireEvent.click(screen.getByRole("button", { name: "收起添加框" }));
    expect(screen.queryByPlaceholderText("任务名称")).not.toBeInTheDocument();
  });

  it("files a new task into the composer's project", async () => {
    mount({ projectId: "p9" });
    fireEvent.click(screen.getByRole("button", { name: /添加任务/ }));
    const title = screen.getByPlaceholderText("任务名称");
    fireEvent.change(title, { target: { value: "写周报" } });
    fireEvent.keyDown(title, { key: "Enter" });

    await waitFor(() =>
      expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ title: "写周报", project_id: "p9" })),
    );
    expect(addSubtask).not.toHaveBeenCalled();
  });

  it("files a new subtask under its parent and stays open for the next one", async () => {
    mount({ parentId: "t1", noun: "子任务" });
    // The same box, renamed — the checklist adds children, not tasks.
    fireEvent.click(screen.getByRole("button", { name: /添加子任务/ }));
    const title = screen.getByPlaceholderText("子任务名称");
    fireEvent.change(title, { target: { value: "写评测" } });
    fireEvent.keyDown(title, { key: "Enter" });

    await waitFor(() => expect(addSubtask).toHaveBeenCalledWith("t1", expect.objectContaining({ title: "写评测" })));
    expect(createTask).not.toHaveBeenCalled();
    // Cleared and still open: a run of subtasks gets typed without reopening.
    await waitFor(() => expect(screen.getByPlaceholderText("子任务名称")).toHaveValue(""));
  });

  it("opens straight into the box when the caller owns the affordance", async () => {
    const onClose = vi.fn();
    mount({ parentId: "t1", noun: "子任务", showTrigger: false, onClose });

    // The detail panel's section-header "＋" is the entrance, so no add row here.
    expect(screen.queryByRole("button", { name: /添加子任务/ })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("子任务名称")).toBeInTheDocument();

    // Collapsing is reported back so the caller can unmount the box.
    fireEvent.click(screen.getByRole("button", { name: "收起添加框" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
