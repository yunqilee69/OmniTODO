import { describe, expect, it } from "vitest";
import { groupByDay, reschedulePatch } from "./calendar";
import { civilOfDay, dayKey, fromDateInput } from "./dates";

const MAR5 = new Date(2026, 2, 5, 12).getTime();
const MAR8 = new Date(2026, 2, 8, 12).getTime();

describe("reschedulePatch", () => {
  it("shifts a timed task by whole days, keeping the time of day", () => {
    const due = new Date(2026, 2, 5, 18, 30).getTime();
    const patch = reschedulePatch({ start_at: null, due_at: due, all_day: false }, MAR8);
    expect(patch).not.toBeNull();
    const moved = new Date(patch!.due_at!);
    expect([moved.getDate(), moved.getHours(), moved.getMinutes()]).toEqual([8, 18, 30]);
  });

  it("lands the due day on the drop target and keeps the start–due span", () => {
    // The calendar buckets by `due_at ?? start_at`, so dropping on Mar 8 must put
    // *due* on Mar 8 — the start follows to preserve the two-day span.
    const start = new Date(2026, 2, 5, 9).getTime();
    const due = new Date(2026, 2, 6, 17).getTime();
    const patch = reschedulePatch({ start_at: start, due_at: due, all_day: false }, MAR8)!;
    expect(new Date(patch.due_at!).getDate()).toBe(8);
    expect(new Date(patch.start_at!).getDate()).toBe(7);
  });

  it("sets the civil date for an all-day task, with no timezone drift", () => {
    const patch = reschedulePatch(
      { start_at: null, due_at: fromDateInput("2026-03-05"), all_day: true },
      MAR8,
    )!;
    expect(patch.due_at).toBe(fromDateInput("2026-03-08"));
    expect(new Date(patch.due_at!).getUTCHours()).toBe(0);
  });

  it("returns null for a no-op drop or an item with no dates", () => {
    const due = new Date(2026, 2, 5, 18).getTime();
    expect(reschedulePatch({ start_at: null, due_at: due, all_day: false }, MAR5)).toBeNull();
    expect(
      reschedulePatch({ start_at: null, due_at: fromDateInput("2026-03-05"), all_day: true }, MAR5),
    ).toBeNull();
    expect(reschedulePatch({ start_at: null, due_at: null, all_day: false }, MAR8)).toBeNull();
  });
});

describe("groupByDay / dayKey", () => {
  it("buckets an all-day and a timed item on the same local day together", () => {
    const allDay = fromDateInput("2026-03-05")!; // UTC midnight
    const timed = new Date(2026, 2, 5, 18).getTime();
    expect(dayKey(allDay, true)).toBe(dayKey(timed, false));
    expect(dayKey(allDay, true)).toBe(civilOfDay(MAR5));

    const grouped = groupByDay(
      [
        { id: "a", ts: allDay, allDay: true },
        { id: "b", ts: timed, allDay: false },
        { id: "c", ts: null, allDay: false },
      ],
      (item) => (item.ts == null ? null : dayKey(item.ts, item.allDay)),
    );
    expect(grouped.size).toBe(1);
    expect(grouped.get(civilOfDay(MAR5))!.map((i) => i.id)).toEqual(["a", "b"]);
  });
});
