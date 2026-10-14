//! Shared measures for a view's content column and its task rows (DESIGN §7.1 / §8.3).
//!
//! They live together because the two are coupled: the column is centred on the
//! *list*, so it has to know how much of a row's left edge is reserved for the
//! handle/caret gutters before the titles start.

/**
 * Cap on the width of a view's content column.
 *
 * The header and the list it titles share it, so a title, a hairline and a task
 * row all sit on the same measure, and the row rules are only as wide as the
 * list rather than stretching across the whole window. The column is centred in
 * whatever space the rail leaves.
 */
export const CONTENT_MAX_WIDTH = 760;

/** Row geometry (DESIGN §8.3): the row's own left padding, the per-level indent
 *  step, and the two leading button gutters — a 16px slot plus its 8px gap,
 *  twice — which stay reserved whether or not they hold a drag handle or a
 *  subtask caret. */
export const ROW_PADDING_LEFT = 12;
export const ROW_INDENT_STEP = 20;
export const ROW_GUTTERS = 48;

/** Left padding of a row at `depth`. */
export const rowPaddingLeft = (depth: number) => ROW_PADDING_LEFT + depth * ROW_INDENT_STEP;

/** Where the hairline above a row at `depth` starts: at the checkbox column,
 *  past the gutters, so it never runs under the floating handle or the caret. */
export const rowRuleInset = (depth: number) => rowPaddingLeft(depth) + ROW_GUTTERS;

/**
 * Left inset of the list's first rule — the row's own padding plus both reserved
 * gutters, i.e. where the checkbox column and every title line up.
 *
 * The content column is centred on the *list* rather than on itself, so this
 * strip hangs to the left of centre instead of pushing the tasks off it: the
 * handle and the caret are chrome, and the tasks are what the eye centres.
 */
export const LIST_LEFT_INSET = rowRuleInset(0);
