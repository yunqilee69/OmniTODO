// Canonical TanStack Query keys (design §13.3).
export const qk = {
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  /** Every single-project query (`project_update` moves the header's stats). */
  projectAll: ["project"] as const,
  tasks: (filter: unknown) => ["tasks", filter] as const,
  tasksAll: ["tasks"] as const,
  task: (id: string) => ["task", id] as const,
  taskAll: ["task"] as const,
  /** An expanded branch in the list and the drawer's checklist share the key. */
  subtasks: (parentId: string) => ["subtasks", parentId] as const,
  subtasksAll: ["subtasks"] as const,
  tags: ["tags"] as const,
  searchAll: ["search"] as const,
  search: (q: string, filter: unknown) => ["search", q, filter] as const,
  reportAll: ["report"] as const,
  report: (query: unknown) => ["report", query] as const,
  mcp: (key: string) => ["mcp", key] as const,
  /** Every MCP query: the status, the config snippets and the args line all
   *  derive from the same server state, so a token change moves all of them. */
  mcpAll: ["mcp"] as const,
};
