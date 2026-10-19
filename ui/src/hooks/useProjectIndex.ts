import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, type ProjectDto } from "../api/client";
import { qk } from "../api/queryKeys";

/** Look up projects by id while drawing rows that are not inside a project.
 *
 *  Inbox / Today / a tag / search all mix projects in one list, so a row has to
 *  say which project it came from and carry that project's colour. The rail
 *  already holds this query — the sidebar renders the same list — so a view that
 *  asks for it is reading a cache entry, not starting a second request.
 *
 *  Rows for a project that is not in the list (deleted between the task read and
 *  this one) simply find nothing and draw no chip. */
export function useProjectIndex(): ReadonlyMap<string, ProjectDto> {
  const { data } = useQuery({ queryKey: qk.projects, queryFn: () => api.projectList() });
  return useMemo(() => new Map((data ?? []).map((p) => [p.id, p])), [data]);
}
