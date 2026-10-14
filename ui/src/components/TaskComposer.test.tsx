import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TaskComposer from "./TaskComposer";

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ul>
        <TaskComposer projectId="p1" />
      </ul>
    </QueryClientProvider>,
  );
}

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
});
