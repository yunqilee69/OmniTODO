//! Sections: grouping tasks into a project's columns (design §5.9).
//!
//! Pure functions over the two lists the core returns — the project's sections
//! and its root tasks — kept apart from the components so the grouping and the
//! drop maths are testable without a DOM.
//!
//! Where this follows Todoist (its web bundle's `board_view` / section
//! components) and where it does not:
//!
//! - **Group order** matches: the "no section" group comes *first*, then the
//!   sections in their own order. Todoist builds its list as `[null, ...sections]`
//!   and its board as `[uncategorized, ...sections, add-section]`.
//! - **Ranking** does not. Todoist numbers tasks per
//!   `(project, section, parent)`, so `child_order` restarts inside every
//!   section. OmniTODO keeps one rank per `(project, parent)` — the column that
//!   `Sort::Manual` and drag-to-sort already read — and the board simply draws
//!   that one sequence column by column. Within a column the two agree; across
//!   columns there is no observable difference, because nothing renders a
//!   project's tasks as one flat run once sections exist.

import type { SectionDto, TaskDto } from "../api/client";
import type { VisibleRow } from "./nestDrop";

/** A column of the board, or a block of the list. */
export interface SectionGroup {
  /** The section, or `null` for the leading "no section" group. */
  section: SectionDto | null;
  tasks: TaskDto[];
}

/** Internal key for the "no section" group, which has no id of its own.
 *  Todoist uses the string `"null"` as its sentinel; a NUL keeps the two apart
 *  from any real id and cannot collide with a section named `null`. */
export const NO_SECTION = "\u0000none";

/** The column key a group is filed under. */
export const groupKey = (g: SectionGroup) => g.section?.id ?? NO_SECTION;

/** What a group is called: its name, or the label for the unfiled bucket. */
export const groupLabel = (g: SectionGroup) => g.section?.name ?? "无板块";

/**
 * Which section a task belongs to *as far as the current section list knows*.
 *
 * A task can outlive its section: deleting a section releases its tasks, but a
 * task can also point at a section that went down with its project, or at one
 * this device has not seen yet. Anything not in `sections` reads as "no section"
 * rather than as a column that does not exist.
 */
function knownSection(task: TaskDto, live: ReadonlySet<string>): string | null {
  const id = task.section_id;
  return id && live.has(id) ? id : null;
}

/**
 * Bucket a project's root tasks by section, the "no section" group first.
 *
 * `keepEmpty` decides whether groups with no tasks survive: the board wants them
 * (an empty column is a drop target, and the place a section is created from),
 * the list does not (an empty heading is just noise).
 *
 * The leading "no section" group is the one position that is not the user's to
 * set, which is why it is keyed by {@link NO_SECTION} rather than by an id.
 */
export function groupBySection(
  tasks: readonly TaskDto[],
  sections: readonly SectionDto[],
  opts: { keepEmpty?: boolean } = {},
): SectionGroup[] {
  const live = new Set(sections.map((s) => s.id));
  const bySection = new Map<string, TaskDto[]>();
  const unfiled: TaskDto[] = [];
  for (const t of tasks) {
    const id = knownSection(t, live);
    if (id === null) unfiled.push(t);
    else {
      const bucket = bySection.get(id);
      if (bucket) bucket.push(t);
      else bySection.set(id, [t]);
    }
  }

  const groups: SectionGroup[] = [];
  if (unfiled.length > 0 || opts.keepEmpty) groups.push({ section: null, tasks: unfiled });
  for (const section of sections) {
    const bucket = bySection.get(section.id) ?? [];
    if (bucket.length > 0 || opts.keepEmpty) groups.push({ section, tasks: bucket });
  }
  return groups;
}

/**
 * The project's root tasks in the order the board draws them: group by group,
 * each in the project's manual order.
 *
 * This is the list `task_reorder` is handed, and it is what keeps the board and
 * the list in step — both read `sort_order` as one rank, so a card dragged on
 * the board lands where the list would have put it too.
 */
export function flattenGroups(groups: readonly SectionGroup[]): string[] {
  return groups.flatMap((g) => g.tasks.map((t) => t.id));
}

/**
 * Where a card lands: the new global order, or `null` when the drop changes
 * nothing.
 *
 * `toIndex` is the position inside the destination group, or `null` to append.
 * The card is taken out of its old group first, so an index measured against the
 * drawn column is a valid index into the group it is joining.
 */
export function planCardDrop(args: {
  groups: readonly SectionGroup[];
  activeId: string;
  /** Destination group: a section id, or `null` for "no section". */
  toSectionId: string | null;
  toIndex?: number | null;
}): { order: string[] } | null {
  const { groups, activeId, toSectionId, toIndex = null } = args;
  const destKey = toSectionId ?? NO_SECTION;
  const source = groups.find((g) => g.tasks.some((t) => t.id === activeId));
  // A card that is in no group is not on this board — there is nothing to plan.
  if (!source) return null;
  const sourceKey = source.section?.id ?? NO_SECTION;

  const rest = groups.map((g) => ({
    key: g.section?.id ?? NO_SECTION,
    ids: g.tasks.filter((t) => t.id !== activeId).map((t) => t.id),
  }));
  const dest = rest.find((g) => g.key === destKey);
  if (!dest) return null;

  // The requested index decides whether anything changed; the clamped one is
  // where the card actually goes. Clamping first would read a drop past the end
  // of a column as the gap the card already sits in.
  const requested = toIndex == null ? dest.ids.length : toIndex;
  const at = Math.max(0, Math.min(requested, dest.ids.length));
  // Landing in the gap the card just left is not a move: `wasAt` is its index
  // before removal, and either side of it maps back to the same position.
  const wasAt = sourceKey === destKey ? source.tasks.findIndex((t) => t.id === activeId) : -1;
  if (sourceKey === destKey && (requested === wasAt || requested === wasAt + 1)) return null;

  dest.ids.splice(at, 0, activeId);
  return { order: rest.flatMap((g) => g.ids) };
}

/**
 * The new section order after dragging a column, or `null` when nothing moves.
 *
 * Only real sections take part: the "no section" column is pinned first, so it is
 * never in the list this is given and can never be dropped among the others.
 */
export function planColumnReorder(args: {
  sectionIds: readonly string[];
  activeId: string;
  overId: string;
  band: "before" | "after";
}): string[] | null {
  const { sectionIds, activeId, overId, band } = args;
  if (activeId === overId) return null;
  const rest = sectionIds.filter((id) => id !== activeId);
  const overIndex = rest.indexOf(overId);
  if (overIndex < 0) return null;
  const at = band === "before" ? overIndex : overIndex + 1;
  if (at === sectionIds.indexOf(activeId)) return null;
  const next = [...rest];
  next.splice(at, 0, activeId);
  return next.join() === sectionIds.join() ? null : next;
}

/**
 * The section a top-level drop lands in: the one owned by the row the drop line
 * is attached to.
 *
 * The gap above and the gap below a row both belong to that row's group, which
 * is what makes the rule read the same at every boundary: dropping under the last
 * task of a section stays in that section, and dropping above the first task of
 * the next one joins the next one — the same two gaps the line is drawn in.
 *
 * A subtask row has no section of its own, so the walk goes up to the branch it
 * hangs off: dropping a task beside a nested row files it with that branch's
 * section rather than yanking it into "no section".
 */
export function sectionForSlot(rows: readonly VisibleRow[], overId: string): string | null {
  const byId = new Map(rows.map((r) => [r.id, r]));
  let cursor = byId.get(overId);
  const seen = new Set<string>();
  while (cursor && cursor.depth > 0 && cursor.parentId) {
    if (seen.has(cursor.parentId)) break;
    seen.add(cursor.parentId);
    cursor = byId.get(cursor.parentId);
  }
  return cursor?.sectionId ?? null;
}

/** Section names are unique per project, case-insensitively, so a new name is
 *  checked before it is written — the core refuses it anyway, but the UI can say
 *  why first. */
export function sectionNameTaken(
  name: string,
  sections: readonly SectionDto[],
  exceptId?: string,
): boolean {
  const needle = name.trim().toLocaleLowerCase();
  return sections.some((s) => s.id !== exceptId && s.name.trim().toLocaleLowerCase() === needle);
}
