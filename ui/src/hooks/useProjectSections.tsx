import { App as AntApp } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type SectionDto } from "../api/client";
import { qk } from "../api/queryKeys";
import { SectionDeleteBody, SectionNameBody, type Choice } from "../components/SectionDialogs";
import { useSetting } from "./useSetting";

/** Collapsed section ids, keyed by project: `{ [projectId]: [sectionId, …] }`. */
const COLLAPSED_KEY = "ui.sections.collapsed";

/**
 * A project's sections and every write that changes them (design §5.9).
 *
 * The list view and the board need the same six things — the sections, the
 * collapsed set, and create / rename / delete / reorder — so they share one hook
 * rather than each holding half of it. The three prompts live here too: both
 * views offer the same dialogs from different chrome, and a rename that asked
 * for a name in one place and renamed inline in the other would be two behaviours
 * for one verb.
 *
 * Collapse state is the one piece that is purely a view preference, and it rides
 * the `settings` KV the way the project's sort order does. Todoist stores
 * `is_collapsed` on the section entity; that would mean a column, a DTO field and
 * a sync path to carry a fold between devices, which is more than the fold is
 * worth.
 *
 * Every write invalidates the task lists as well as the sections: a section's
 * badge is a task count, and deleting one moves its tasks.
 */
export function useProjectSections(projectId: string) {
  const qc = useQueryClient();
  const { modal } = AntApp.useApp();
  const { value: collapsedMap, set: setCollapsedMap } = useSetting<Record<string, string[]>>(
    COLLAPSED_KEY,
    {},
  );

  const { data: sections } = useQuery({
    queryKey: qk.sections(projectId),
    queryFn: () => api.sectionList(projectId),
    enabled: Boolean(projectId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.sectionsAll });
    qc.invalidateQueries({ queryKey: qk.tasksAll });
    qc.invalidateQueries({ queryKey: qk.reportAll });
  };

  const create = useMutation({
    mutationFn: (name: string) => api.sectionCreate({ project_id: projectId, name }),
    onSettled: invalidate,
  });

  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) => api.sectionUpdate(v.id, { name: v.name }),
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: (v: { id: string; deleteTasks: boolean }) =>
      api.sectionDelete(v.id, v.deleteTasks),
    onSettled: invalidate,
  });

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.sectionReorder(ids),
    onSettled: invalidate,
  });

  const list = sections ?? [];
  const collapsed = new Set(collapsedMap[projectId] ?? []);

  const toggleCollapse = (sectionId: string) => {
    const next = new Set(collapsed);
    if (!next.delete(sectionId)) next.add(sectionId);
    setCollapsedMap({ ...collapsedMap, [projectId]: [...next] });
  };

  /** Step a section one place through the order — the list view's menu items.
   *  A move off either end is a no-op rather than a wrap-around. */
  const move = (section: SectionDto, delta: -1 | 1) => {
    const ids = list.map((s) => s.id);
    const from = ids.indexOf(section.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    next.splice(to, 0, ...next.splice(from, 1));
    reorder.mutate(next);
  };

  const promptCreate = () => {
    const choice: Choice<string> = { value: "" };
    modal.confirm({
      title: "新建板块",
      content: <SectionNameBody choice={choice} sections={list} />,
      okText: "创建",
      cancelText: "取消",
      // Rejecting keeps the dialog open on an empty or duplicate name, so the
      // mistake is corrected where it was made.
      onOk: () => {
        const name = choice.value.trim();
        if (!name || list.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
          return Promise.reject(new Error("invalid section name"));
        }
        return create.mutateAsync(name);
      },
    });
  };

  const promptRename = (section: SectionDto) => {
    const choice: Choice<string> = { value: section.name };
    modal.confirm({
      title: "重命名板块",
      content: <SectionNameBody choice={choice} sections={list} exceptId={section.id} />,
      okText: "保存",
      cancelText: "取消",
      onOk: () => {
        const name = choice.value.trim();
        if (!name) return Promise.reject(new Error("empty section name"));
        if (name === section.name) return Promise.resolve();
        return rename.mutateAsync({ id: section.id, name });
      },
    });
  };

  const promptDelete = (section: SectionDto, count: number) => {
    const choice: Choice<boolean> = { value: false };
    modal.confirm({
      title: `删除板块「${section.name}」？`,
      content: <SectionDeleteBody name={section.name} count={count} choice={choice} />,
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: () => remove.mutateAsync({ id: section.id, deleteTasks: choice.value }),
    });
  };

  return {
    sections: list,
    collapsed,
    toggleCollapse,
    move,
    create,
    rename,
    remove,
    reorder,
    promptCreate,
    promptRename,
    promptDelete,
  };
}
