import { describe, expect, it } from "vitest";
import type { ReminderHit } from "../api/client";
import { REMINDER_MAX_CARDS, dropReminder, mergeReminders, reminderKey } from "./reminders";

const hit = (task_id: string, occurrence_at: number): ReminderHit => ({
  task_id,
  title: `task ${task_id}`,
  occurrence_at,
  when: occurrence_at,
});

describe("reminderKey", () => {
  it("identifies a task occurrence, not just the task", () => {
    expect(reminderKey(hit("a", 1))).not.toBe(reminderKey(hit("a", 2)));
  });
});

describe("mergeReminders", () => {
  it("prepends new occurrences", () => {
    const cards = mergeReminders([], [hit("a", 1)]);
    expect(cards.map((c) => c.key)).toEqual(["a:1"]);
  });

  it("does not duplicate an occurrence that re-fires", () => {
    const first = mergeReminders([], [hit("a", 1)]);
    const again = mergeReminders(first, [hit("a", 1), hit("b", 2)]);
    expect(again.map((c) => c.key)).toEqual(["b:2", "a:1"]);
  });

  it("returns the same array when nothing is new", () => {
    const first = mergeReminders([], [hit("a", 1)]);
    expect(mergeReminders(first, [hit("a", 1)])).toBe(first);
  });

  it("caps the stack at the max, dropping the oldest", () => {
    const many = Array.from({ length: REMINDER_MAX_CARDS + 2 }, (_, i) => hit("t", i));
    const cards = mergeReminders([], many);
    expect(cards).toHaveLength(REMINDER_MAX_CARDS);
    expect(cards[0].key).toBe(`t:${REMINDER_MAX_CARDS + 1}`);
  });
});

describe("dropReminder", () => {
  it("removes only the matching card", () => {
    const cards = mergeReminders([], [hit("a", 1), hit("b", 2)]);
    expect(dropReminder(cards, "a:1").map((c) => c.key)).toEqual(["b:2"]);
  });
});
