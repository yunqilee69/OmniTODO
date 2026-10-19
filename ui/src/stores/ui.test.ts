import { describe, expect, it } from "vitest";
import { useUiStore } from "./ui";

describe("ui store", () => {
  it("updates filter and selection", () => {
    const { setFilter, selectTask } = useUiStore.getState();
    setFilter({ sort: "dueasc", limit: 10 });
    selectTask("abc");
    const s = useUiStore.getState();
    expect(s.filter.sort).toBe("dueasc");
    expect(s.filter.limit).toBe(10);
    expect(s.selectedTaskId).toBe("abc");
  });

  it("collapses the sidebar and persists it", () => {
    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    expect(localStorage.getItem("omnitodo.sidebar.collapsed")).toBe("1");

    useUiStore.getState().setSidebarCollapsed(false);
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
    expect(localStorage.getItem("omnitodo.sidebar.collapsed")).toBe("0");
  });
});
