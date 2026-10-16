import { create } from "zustand";
import type { TaskFilter } from "../api/client";

export type Theme = "system" | "light" | "dark";

/**
 * What the quick-add panel starts from when it is opened by a click rather than
 * by the shortcut: the calendar's day cell seeds the date and, inside a project,
 * the project the task belongs to. The text field is still what decides the
 * title. Fields the typed shorthand sets win over these.
 */
export interface QuickAddSeed {
  due_at: number | null;
  all_day: boolean;
  /** The project whose calendar opened the panel, when there is one. */
  project_id?: string | null;
}

interface UiState {
  filter: TaskFilter;
  selectedTaskId: string | null;
  theme: Theme;
  /** Whether the floating quick-add panel is showing. */
  quickAddOpen: boolean;
  quickAddSeed: QuickAddSeed | null;
  setFilter: (filter: TaskFilter) => void;
  selectTask: (id: string | null) => void;
  setTheme: (theme: Theme) => void;
  openQuickAdd: (seed?: QuickAddSeed | null) => void;
  closeQuickAdd: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  filter: { sort: "createddesc", limit: 200 },
  selectedTaskId: null,
  theme: "system",
  quickAddOpen: false,
  quickAddSeed: null,
  setFilter: (filter) => set({ filter }),
  selectTask: (id) => set({ selectedTaskId: id }),
  setTheme: (theme) => set({ theme }),
  openQuickAdd: (seed) => set({ quickAddOpen: true, quickAddSeed: seed ?? null }),
  closeQuickAdd: () => set({ quickAddOpen: false, quickAddSeed: null }),
}));
