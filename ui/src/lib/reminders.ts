// Pure helpers for the in-app reminder surface (design §9.1/§9.2). Kept out of
// the component so the de-duplication and cap rules are unit-testable without a
// Tauri event runtime.

import type { ReminderHit } from "../api/client";

/** A reminder occurrence as shown in the panel. */
export type ReminderCard = ReminderHit & { key: string };

/** Most recent occurrences kept on screen; older ones are dropped. */
export const REMINDER_MAX_CARDS = 5;

/** One key per task occurrence, so a re-fired event doesn't stack a duplicate. */
export function reminderKey(hit: ReminderHit): string {
  return `${hit.task_id}:${hit.occurrence_at}`;
}

function toCard(hit: ReminderHit): ReminderCard {
  return { ...hit, key: reminderKey(hit) };
}

/** Prepend `hits` to `prev`, dropping any occurrence already on screen, newest
 *  first and capped at `max`. Returns `prev` unchanged when nothing is new.
 *
 *  A batch is sorted by its reminder instant before the cap is applied: the
 *  catch-up payload arrives in database-row order, so without this the cap would
 *  keep an arbitrary five and could drop the most recent ones. */
export function mergeReminders(
  prev: ReminderCard[],
  hits: ReminderHit[],
  max = REMINDER_MAX_CARDS,
): ReminderCard[] {
  const seen = new Set(prev.map((c) => c.key));
  const fresh = hits.map(toCard).filter((c) => !seen.has(c.key));
  if (fresh.length === 0) return prev;
  fresh.sort((a, b) => b.when - a.when);
  return [...fresh, ...prev].slice(0, max);
}

/** Remove one card by key (dismiss / snooze). */
export function dropReminder(prev: ReminderCard[], key: string): ReminderCard[] {
  return prev.filter((c) => c.key !== key);
}
