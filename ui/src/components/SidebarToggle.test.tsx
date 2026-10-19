import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "../stores/ui";
import SidebarToggle from "./SidebarToggle";

/** The rail's two halves are one control: whichever direction is not available
 *  is not in the DOM, so a tab stop always lands on something visible. */
describe("SidebarToggle", () => {
  beforeEach(() => {
    useUiStore.setState({ sidebarCollapsed: false });
    localStorage.clear();
  });

  it("offers only the direction that leads somewhere", () => {
    const { rerender } = render(
      <>
        <SidebarToggle variant="collapse" />
        <SidebarToggle variant="expand" />
      </>,
    );
    expect(screen.getByRole("button", { name: "收起侧边栏" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "展开侧边栏" })).not.toBeInTheDocument();

    act(() => useUiStore.setState({ sidebarCollapsed: true }));
    rerender(
      <>
        <SidebarToggle variant="collapse" />
        <SidebarToggle variant="expand" />
      </>,
    );    expect(screen.getByRole("button", { name: "展开侧边栏" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "收起侧边栏" })).not.toBeInTheDocument();
  });

  it("toggles the rail and remembers the choice", () => {
    render(<SidebarToggle variant="collapse" />);
    fireEvent.click(screen.getByRole("button", { name: "收起侧边栏" }));
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    expect(localStorage.getItem("omnitodo.sidebar.collapsed")).toBe("1");

    render(<SidebarToggle variant="expand" />);
    fireEvent.click(screen.getByRole("button", { name: "展开侧边栏" }));
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
    expect(localStorage.getItem("omnitodo.sidebar.collapsed")).toBe("0");
  });
});
