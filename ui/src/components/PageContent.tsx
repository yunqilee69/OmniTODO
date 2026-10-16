import type { ReactNode } from "react";
import { CONTENT_MAX_WIDTH, LIST_LEFT_INSET } from "../lib/layout";

/**
 * The scrollable body under a `PageHeader` (DESIGN §7.1).
 *
 * Every view's content lives in one centred, width-capped column so the list's
 * hairlines end where the tasks end instead of running the width of the window.
 *
 * `taskList` centres the column on the *rows* rather than on the column itself.
 * A task row reserves two gutters on its left — a drag handle and a subtask caret
 * — and the hairlines start after them, so a plainly centred column leaves the
 * whole list sitting half that strip to the right of centre. Offsetting the
 * column by half the strip puts the checkbox column and the titles back on the
 * axis, with the reserved gutters hanging just left of it. Views with no task
 * list (Settings) keep the plain centred column.
 */
export default function PageContent({
  children,
  taskList = false,
  wide = false,
}: {
  children: ReactNode;
  taskList?: boolean;
  /** Drop the width cap and the padding, and let the child fill the pane. The
   *  board and the calendar are the two views that are not a column of rows: the
   *  board scrolls sideways through 286px columns and the calendar needs seven of
   *  them, so a 760px measure would show two and a half days of a week. */
  wide?: boolean;
}) {
  const slack = `(100% - ${CONTENT_MAX_WIDTH}px) / 2`;
  // `max(0px, …)` keeps the shift from pushing the column off the left edge once
  // the pane is too narrow for the cap to bite (there the column is already full
  // width, and the room for the gutters is gone).
  const shift = LIST_LEFT_INSET / 2;
  if (wide) {
    return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>;
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
      <div
        className="w-full"
        style={
          taskList
            ? {
                maxWidth: CONTENT_MAX_WIDTH,
                marginInlineStart: `max(0px, calc(${slack} - ${shift}px))`,
                marginInlineEnd: `max(0px, calc(${slack} + ${shift}px))`,
              }
            : { maxWidth: CONTENT_MAX_WIDTH, marginInline: "auto" }
        }
      >
        {children}
      </div>
    </div>
  );
}
