import { describe, expect, it } from "vitest";
import {
  addDays,
  civilDate,
  endOfLocalDay,
  formatDue,
  fromDateInput,
  fromDateTimeInput,
  isOverdue,
  isToday,
  monthGrid,
  startOfLocalDay,
  toDateInput,
  toDateTimeInput,
  todayCivil,
  weekWindow,
} from "./dates";

// A fixed local moment: 2026-03-05 10:30 local.
const NOW = new Date(2026, 2, 5, 10, 30, 0, 0).getTime();

describe("day windows", () => {
  it("brackets a local day", () => {
    expect(startOfLocalDay(NOW)).toBe(new Date(2026, 2, 5).getTime());
    expect(endOfLocalDay(NOW)).toBe(new Date(2026, 2, 6).getTime());
  });

  it("crosses month boundaries", () => {
    const end = new Date(2026, 2, 31, 12).getTime();
    expect(addDays(end, 1)).toBe(new Date(2026, 3, 1, 12).getTime());
  });
});

describe("all-day civil dates (design §5.1)", () => {
  it("round-trips through a date input without timezone drift", () => {
    const civil = fromDateInput("2026-03-05");
    expect(civil).toBe(Date.UTC(2026, 2, 5));
    expect(new Date(civil!).getUTCHours()).toBe(0);
    expect(toDateInput(civil!, true)).toBe("2026-03-05");
  });

  it("rejects malformed and impossible dates", () => {
    expect(fromDateInput("2026-3-5")).toBeNull();
    expect(fromDateInput("not a date")).toBeNull();
    expect(fromDateInput("2026-13-01")).toBeNull();
    expect(fromDateInput("2026-02-31")).toBeNull();
  });

  it("civilDate is idempotent for stored all-day instants", () => {
    const civil = fromDateInput("2026-03-05")!;
    expect(civilDate(civil)).toBe(civil);
  });
});

describe("timed round-trips", () => {
  it("round-trips a datetime-local value", () => {
    const ms = new Date(2026, 2, 5, 18, 45).getTime();
    expect(toDateTimeInput(ms)).toBe("2026-03-05T18:45");
    expect(fromDateTimeInput("2026-03-05T18:45")).toBe(ms);
  });

  it("returns null for empty or invalid input", () => {
    expect(fromDateTimeInput("")).toBeNull();
    expect(fromDateTimeInput("nope")).toBeNull();
  });
});

describe("formatDue", () => {
  it("labels the surrounding week relatively", () => {
    // Timed tasks are local instants; all-day tasks are civil dates (§5.1).
    expect(formatDue(new Date(2026, 2, 5, 18).getTime(), false, NOW)).toBe("今天 18:00");
    expect(formatDue(fromDateInput("2026-03-06")!, true, NOW)).toBe("明天");
    expect(formatDue(fromDateInput("2026-03-04")!, true, NOW)).toBe("昨天");
    expect(formatDue(fromDateInput("2026-03-08")!, true, NOW)).toBe("3 天后");
  });

  it("falls back to a month/day label beyond a week", () => {
    expect(formatDue(fromDateInput("2026-03-20")!, true, NOW)).toBe("3月20日");
    expect(formatDue(fromDateInput("2026-02-20")!, true, NOW)).toBe("2月20日");
  });

  it("labels an all-day task by its UTC civil date, not local fields", () => {
    const civil = fromDateInput("2026-03-06")!; // tomorrow, stored as UTC midnight
    expect(formatDue(civil, true, NOW)).toBe("明天");
    // Reading that instant through local fields would land on a different
    // calendar date in UTC+8 — the reason storage uses UTC midnights (§5.1).
    expect(formatDue(civil, true, Date.UTC(2026, 2, 5, 10, 30))).toBe("明天");
  });
});

describe("isToday / isOverdue", () => {
  it("matches an all-day task whose civil date is today", () => {
    expect(isToday(todayCivil(NOW), true, NOW)).toBe(true);
    expect(isToday(fromDateInput("2026-03-06")!, true, NOW)).toBe(false);
  });

  it("treats an all-day task as overdue only after its day ends", () => {
    const today = todayCivil(NOW);
    expect(isOverdue(today, "todo", true, NOW)).toBe(false);
    expect(isOverdue(fromDateInput("2026-03-04")!, "todo", true, NOW)).toBe(true);
    expect(isOverdue(fromDateInput("2026-03-04")!, "done", true, NOW)).toBe(false);
  });

  it("treats a timed task as overdue the moment it passes", () => {
    expect(isOverdue(NOW - 1000, "todo", false, NOW)).toBe(true);
    expect(isOverdue(null, "todo", false, NOW)).toBe(false);
  });
});

describe("calendar windows", () => {
  it("builds a six-week grid aligned to the week start", () => {
    const grid = monthGrid(NOW, 1); // Monday start
    expect(grid.days).toHaveLength(42);
    expect(new Date(grid.days[0]).getDay()).toBe(1);
    expect(grid.from).toBeLessThanOrEqual(new Date(2026, 2, 1).getTime());
    expect(grid.to).toBeGreaterThan(new Date(2026, 2, 31).getTime());
  });

  it("builds a week window from the week start", () => {
    const { from, to } = weekWindow(NOW, 1);
    expect(new Date(from).getDay()).toBe(1);
    expect(to - from).toBe(7 * 86_400_000);
  });
});
