//! Time helpers shared by the list, detail panel and calendar.
//!
//! Two storage conventions matter (design §5.1):
//! - instants are Unix milliseconds UTC;
//! - an **all-day** task stores its civil date as UTC midnight, with no timezone
//!   conversion, so the date must be read back through the UTC fields — going
//!   through local ones would shift it across midnight in some zones.

export const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");

/** Local start of the day containing `ms`. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local end of that day (exclusive bound for "today" filters).
 *  Uses the next local midnight, so it stays correct across DST shifts. */
export function endOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** A civil date (UTC midnight) for today's **local** calendar date. */
export function todayCivil(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Civil date of an all-day instant, idempotent for values stored this way. */
export function civilDate(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * A local calendar date expressed as a civil date (UTC midnight).
 *
 * Calendar cells and task grouping both key on this, so an all-day task (stored
 * as UTC midnight) and a timed task on the same local day land in one bucket.
 */
export function civilOfDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Bucket key for calendar grouping: civil date for all-day, local date else. */
export function dayKey(ms: number, allDay: boolean): number {
  return allDay ? civilDate(ms) : civilOfDay(ms);
}

// -- <input> round-trips ----------------------------------------------------

/** `yyyy-mm-dd` for a date input; uses UTC fields for all-day tasks. */
export function toDateInput(ms: number, allDay = false): string {
  const d = new Date(ms);
  return allDay
    ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse `yyyy-mm-dd`. `civil` yields UTC midnight (all-day storage). */
export function fromDateInput(value: string, civil = true): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const civilMs = Date.UTC(y, mo - 1, d);
  const back = new Date(civilMs);
  // Date rolls overflow over silently (2026-02-31 -> Mar 3); reject instead.
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== mo - 1 ||
    back.getUTCDate() !== d
  ) {
    return null;
  }
  return civil ? civilMs : new Date(y, mo - 1, d).getTime();
}

/** `yyyy-mm-ddThh:mm` for a `datetime-local` input (always local time). */
export function toDateTimeInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function fromDateTimeInput(value: string): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

// -- display ----------------------------------------------------------------

function timeLabel(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Human due label: 今天/明天/昨天 for the surrounding week, `7 天后` within it,
 * otherwise `3月5日`; timed tasks append ` HH:MM`.
 */
export function formatDue(ms: number, allDay: boolean, now = Date.now()): string {
  const base = allDay ? civilDate(ms) : startOfLocalDay(ms);
  const today = allDay ? todayCivil(now) : startOfLocalDay(now);
  const days = Math.round((base - today) / DAY_MS);

  let label: string;
  if (days === 0) label = "今天";
  else if (days === 1) label = "明天";
  else if (days === -1) label = "昨天";
  else if (days > 1 && days < 7) label = `${days} 天后`;
  else if (days < -1 && days > -7) label = `${-days} 天前`;
  else {
    const d = new Date(ms);
    label = allDay
      ? `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
      : `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return allDay ? label : `${label} ${timeLabel(ms)}`;
}

/** Is an all-day instant the same civil date as today? */
export function isToday(ms: number, allDay: boolean, now = Date.now()): boolean {
  return allDay ? civilDate(ms) === todayCivil(now) : startOfLocalDay(ms) === startOfLocalDay(now);
}

/** True when a task is past due: due before now and not finished. */
export function isOverdue(
  dueAt: number | null,
  status: string,
  allDay: boolean,
  now = Date.now(),
): boolean {
  if (dueAt === null || status === "done" || status === "cancelled") return false;
  // An all-day task is only overdue once its day has ended.
  return allDay ? dueAt + DAY_MS <= todayCivil(now) : dueAt < now;
}

/** Month grid (6 weeks) covering the month of `ms`, starting on `weekStartsOn`. */
export function monthGrid(ms: number, weekStartsOn = 1): { from: number; to: number; days: number[] } {
  const d = new Date(ms);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  first.setHours(0, 0, 0, 0);
  const offset = (first.getDay() - weekStartsOn + 7) % 7;
  const from = addDays(first.getTime(), -offset);
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  return { from, to: addDays(from, 42), days };
}

/** Inclusive local day window containing `ms`. */
export function dayWindow(ms: number): { from: number; to: number } {
  return { from: startOfLocalDay(ms), to: endOfLocalDay(ms) };
}

/** Week window (7 local days) containing `ms`. */
export function weekWindow(ms: number, weekStartsOn = 1): { from: number; to: number } {
  const d = new Date(ms);
  d.setDate(d.getDate() - ((d.getDay() - weekStartsOn + 7) % 7));
  d.setHours(0, 0, 0, 0);
  const from = d.getTime();
  return { from, to: addDays(from, 7) };
}
