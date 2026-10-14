import type { Priority } from "../api/client";

/** Rank order, quietest first (DESIGN §3.3). */
export const PRIORITIES: Priority[] = ["none", "low", "medium", "high", "urgent"];

export const PRIORITY_LABEL: Record<Priority, string> = {
  none: "无",
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};

/** Colour per priority (DESIGN §3.3): drives the priority dot in menus and the
 *  drawer. `none` has no hue of its own, so callers draw a hollow ring. */
export const PRIORITY_COLOR: Record<Priority, string> = {
  none: "transparent",
  low: "var(--prio-low)",
  medium: "var(--prio-medium)",
  high: "var(--prio-high)",
  urgent: "var(--prio-urgent)",
};

/** The row's priority channel: the checkbox ring's colour (DESIGN §3.3/§8.4).
 *  Unlike `PRIORITY_COLOR`, `none` resolves to the neutral ring rather than
 *  transparent — the ring is always drawn, only its hue carries the scale. */
export const PRIORITY_RING: Record<Priority, string> = {
  none: "var(--border-strong)",
  low: PRIORITY_COLOR.low,
  medium: PRIORITY_COLOR.medium,
  high: PRIORITY_COLOR.high,
  urgent: PRIORITY_COLOR.urgent,
};

/** `{ key, label }` items for an antd Dropdown / Select of priorities. */
export const PRIORITY_OPTIONS = PRIORITIES.map((p) => ({
  value: p,
  key: p,
  label: PRIORITY_LABEL[p],
}));
