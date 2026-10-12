import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Page, type TaskDto, type TaskPatch } from "../api/client";
import { qk } from "../api/queryKeys";

/**
 * Task writes shared by the list, the detail panel and drag-and-drop.
 *
 * Completion is applied optimistically to every cached task list (the same task
 * can appear in several views), and rolled back on error — the interaction the
 * design calls out in §13.2. Everything else refetches.
 */
export function useTaskMutations() {
  const qc = useQueryClient();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: qk.tasksAll });
    qc.invalidateQueries({ queryKey: qk.taskAll });
    qc.invalidateQueries({ queryKey: qk.projects });
    qc.invalidateQueries({ queryKey: qk.reportAll });
    qc.invalidateQueries({ queryKey: qk.searchAll });
  };

  const toggle = useMutation({
    mutationFn: (task: TaskDto) =>
      task.status === "done" ? api.taskUncomplete(task.id) : api.taskComplete(task.id),
    onMutate: async (task) => {
      await qc.cancelQueries({ queryKey: qk.tasksAll });
      const prev = qc.getQueriesData<Page<TaskDto>>({ queryKey: qk.tasksAll });
      const next = task.status === "done" ? "todo" : "done";
      qc.setQueriesData<Page<TaskDto>>({ queryKey: qk.tasksAll }, (page) =>
        page
          ? {
              ...page,
              items: page.items.map((t) =>
                t.id === task.id ? { ...t, status: next as TaskDto["status"] } : t,
              ),
            }
          : page,
      );
      return { prev };
    },
    onError: (_e, _task, ctx) => {
      ctx?.prev.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: invalidateAll,
  });

  const patch = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) => api.taskUpdate(id, patch),
    onSettled: invalidateAll,
  });

  const create = useMutation({
    mutationFn: (input: Parameters<typeof api.taskCreate>[0]) => api.taskCreate(input),
    onSettled: invalidateAll,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.taskDelete(id),
    onSettled: invalidateAll,
  });

  const move = useMutation({
    mutationFn: (v: {
      id: string;
      projectId?: string | null;
      parentId?: string | null;
      sortOrder?: number;
    }) => api.taskMove(v.id, v.projectId, v.parentId, v.sortOrder),
    onSettled: invalidateAll,
  });

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.taskReorder(ids),
    onSettled: invalidateAll,
  });

  return { toggle, patch, create, remove, move, reorder, invalidateAll };
}
