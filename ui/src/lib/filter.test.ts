import { describe, expect, it } from "vitest";
import { endOfLocalDay, addDays } from "./dates";
import { inboxFilter, projectFilter, searchFilter, tagFilter, todayFilter, upcomingFilter } from "./filter";

const NOW = new Date(2026, 2, 5, 10, 30).getTime();

describe("view filters", () => {
  it("inbox lists unfiled root tasks newest-first", () => {
    // A task filed under a project belongs to that project, not to the Inbox.
    expect(inboxFilter()).toMatchObject({ sort: "createddesc", root_only: true, unfiled: true });
  });

  it("today ends at the end of today so overdue tasks stay visible", () => {
    const f = todayFilter(NOW);
    expect(f.due_before).toBe(endOfLocalDay(NOW));
    expect(f.due_after).toBeUndefined();
    expect(f.sort).toBe("dueasc");
  });

  it("upcoming covers the seven days after today", () => {
    const f = upcomingFilter(NOW);
    expect(f.due_after).toBe(endOfLocalDay(NOW));
    expect(f.due_before).toBe(addDays(endOfLocalDay(NOW), 7));
  });

  it("project views use the manual order so drag-sort sticks", () => {
    expect(projectFilter("p1")).toMatchObject({ project_ids: ["p1"], sort: "manual" });
  });

  it("project display settings can swap in a computed order", () => {
    expect(projectFilter("p1", { sort: "dueasc" })).toMatchObject({ sort: "dueasc" });
  });

  it("tag views cut across projects, so they order by due date", () => {
    expect(tagFilter("t1")).toMatchObject({ tag_ids: ["t1"], sort: "dueasc" });
  });

  it("views honour the completed toggle", () => {
    expect(projectFilter("p1").include_completed).toBe(true);
    expect(projectFilter("p1", { includeCompleted: false }).include_completed).toBe(false);
  });

  it("search filter carries no text of its own", () => {
    expect(searchFilter().search_text).toBeUndefined();
  });
});
