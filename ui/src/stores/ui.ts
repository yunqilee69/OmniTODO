import { create } from "zustand";
import type { TaskFilter } from "../api/client";

export type Theme = "system" | "light" | "dark";

interface UiState {
  filter: TaskFilter;
  selectedTaskId: string | null;
  theme: Theme;
  setFilter: (filter: TaskFilter) => void;
  selectTask: (id: string | null) => void;
  setTheme: (theme: Theme) => void;
}

export const useUiStore = create<UiState>((set) => ({
  filter: { sort: "createddesc", limit: 200 },
  selectedTaskId: null,
  theme: "system",
  setFilter: (filter) => set({ filter }),
  selectTask: (id) => set({ selectedTaskId: id }),
  setTheme: (theme) => set({ theme }),
}));
