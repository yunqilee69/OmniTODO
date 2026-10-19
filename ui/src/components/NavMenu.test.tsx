import { DndContext, useDndContext, type DroppableContainers } from "@dnd-kit/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_COLORS } from "../lib/projectColors";
import { useUiStore } from "../stores/ui";
import NavMenu from "./NavMenu";

// Hoisted so the module factory can reach them (vitest runs the factory first).
const { projectList, tagList, projectCreate, projectUpdate } = vi.hoisted(() => ({
  projectList: vi.fn(),
  tagList: vi.fn(),
  projectCreate: vi.fn(),
  projectUpdate: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: {
    projectList: () => projectList(),
    tagList: () => tagList(),
    projectCreate: (name: string, color?: string) => projectCreate(name, color),
    projectUpdate: (id: string, patch: unknown) => projectUpdate(id, patch),
  },
}));

/** Hands the test dnd-kit's live droppable registry.
 *
 *  A collapsed rail clips its contents but the rows inside keep real rectangles,
 *  and the app-level drop picks the nearest centre rather than whatever sits
 *  under the pointer — so "is this project still a drop target" is exactly this
 *  container's `disabled` flag, not whether it is on screen. */
let registry: DroppableContainers | null = null;
function RegistryProbe() {
  useUiStore((s) => s.sidebarCollapsed);
  registry = useDndContext().droppableContainers;
  return null;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AntApp>
        <MemoryRouter>
          <DndContext>
            <NavMenu />
            <RegistryProbe />
          </DndContext>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  registry = null;
  useUiStore.setState({ sidebarCollapsed: false });
  projectList.mockResolvedValue([
    { id: "p1", name: "示例项目", color: PROJECT_COLORS[0], stats: { open: 2, completed: 0 } },
  ]);
  tagList.mockResolvedValue([]);
  projectCreate.mockResolvedValue({ id: "p2" });
  projectUpdate.mockResolvedValue({ id: "p1" });
});

describe("NavMenu drop targets", () => {
  it("takes project rows out of the drop set while the rail is hidden", async () => {
    mount();
    await waitFor(() => expect(registry?.get("project:p1")).toBeTruthy());
    expect(registry!.get("project:p1")!.disabled).toBe(false);

    await act(async () => {
      useUiStore.setState({ sidebarCollapsed: true });
    });
    await waitFor(() => expect(registry!.get("project:p1")!.disabled).toBe(true));

    await act(async () => {
      useUiStore.setState({ sidebarCollapsed: false });
    });
    await waitFor(() => expect(registry!.get("project:p1")!.disabled).toBe(false));
  });
});

/** The project colour is what the calendar and the cross-project lists read to
 *  tell two projects apart, so it has to survive both write paths. */
describe("NavMenu project colour", () => {
  it("creates a project on a colour nothing else has taken", async () => {
    mount();
    await screen.findByText("示例项目");
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));

    const field = screen.getByPlaceholderText("项目名，回车确认");
    fireEvent.change(field, { target: { value: "露营装备清单" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() =>
      expect(projectCreate).toHaveBeenCalledWith("露营装备清单", PROJECT_COLORS[1]),
    );
  });

  it("writes the colour chosen in the edit dialog", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "项目操作：示例项目" }));
    fireEvent.click(await screen.findByText("编辑"));

    const dialog = await screen.findByRole("dialog");
    // The palette opens behind the current colour's swatch; a radio group, so
    // the checked entry is the colour the project is drawn in right now.
    fireEvent.click(within(dialog).getByRole("button", { name: "项目颜色" }));
    expect(
      await screen.findByRole("radio", { name: `颜色 ${PROJECT_COLORS[0]}` }),
    ).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: `颜色 ${PROJECT_COLORS[4]}` }));
    // antd's two-character CJK buttons carry a rendered space, so match loosely.
    fireEvent.click(within(dialog).getByRole("button", { name: /保\s*存/ }));

    await waitFor(() =>
      expect(projectUpdate).toHaveBeenCalledWith("p1", {
        name: "示例项目",
        color: PROJECT_COLORS[4],
      }),
    );
  });
});
