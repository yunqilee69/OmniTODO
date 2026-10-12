import { useDroppable } from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink } from "react-router-dom";
import { api, type ProjectDto, type TagDto } from "../api/client";
import { qk } from "../api/queryKeys";
import { projectDropId } from "./DndProvider";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded px-2 py-1 text-sm ${
    isActive ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"
  }`;

/** Projects with open counts; each row is a drop target for cross-project drag
 *  (design §13.1/§13.2). */
export default function ProjectSidebar() {
  const qc = useQueryClient();
  const { data: projects } = useQuery({ queryKey: qk.projects, queryFn: () => api.projectList() });
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: (n: string) => api.projectCreate(n),
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: qk.projects });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.projectDelete(id),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.projects });
      qc.invalidateQueries({ queryKey: qk.tasksAll });
    },
  });

  return (
    <div className="mt-4">
      <div className="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
        项目
      </div>
      <ul className="space-y-0.5">
        {(projects ?? []).map((p) => (
          <ProjectItem key={p.id} project={p} onDelete={() => remove.mutate(p.id)} />
        ))}
        {(projects ?? []).length === 0 && (
          <li className="px-2 py-1 text-xs text-neutral-400">还没有项目</li>
        )}
      </ul>
      <input
        className="mt-1 w-full rounded border border-neutral-200 px-2 py-1 text-xs"
        placeholder="新建项目，回车确认"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) create.mutate(name.trim());
        }}
      />
    </div>
  );
}

function ProjectItem({ project, onDelete }: { project: ProjectDto; onDelete: () => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: projectDropId(project.id) });
  const open = project.stats?.open ?? 0;

  return (
    <li
      ref={setNodeRef}
      className={`group flex items-center rounded ${
        isOver ? "ring-2 ring-blue-400 ring-offset-1" : ""
      }`}
    >
      <NavLink to={`/project/${project.id}`} className={`${linkClass} min-w-0 flex-1`}>
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: project.color ?? "#a3a3a3" }}
        />
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        {open > 0 && <span className="shrink-0 text-xs opacity-60">{open}</span>}
      </NavLink>
      <button
        type="button"
        className="px-1 text-xs text-transparent group-hover:text-neutral-400 hover:!text-red-600"
        onClick={onDelete}
        aria-label={`删除项目 ${project.name}`}
        title="删除项目（连同其任务）"
      >
        ✕
      </button>
    </li>
  );
}

/** Tags with counts, linking to the tag view (design §13.1). */
export function TagSidebar() {
  const { data: tags } = useQuery({ queryKey: qk.tags, queryFn: () => api.tagList() });
  if (!tags || tags.length === 0) return null;
  return (
    <div className="mt-4">
      <div className="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
        标签
      </div>
      <ul className="space-y-0.5">
        {tags.map((t: TagDto) => (
          <li key={t.id}>
            <NavLink to={`/tag/${t.id}`} className={linkClass}>
              <span className="min-w-0 flex-1 truncate">#{t.name}</span>
              {t.count > 0 && <span className="shrink-0 text-xs opacity-60">{t.count}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
