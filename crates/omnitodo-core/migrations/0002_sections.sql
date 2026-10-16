-- 板块（design §5.9）：项目内的一段，看板视图的列就是它。
--
-- 板块是**项目内的扁平列表**，不嵌套——嵌套已经由子任务承担了，再让板块也能套板块
-- 会让「一个任务在哪一列」变成两套层级相乘。所以板块只有 project_id + sort_order。
--
-- 任务通过 `tasks.section_id` 指向板块，可空：空＝「无板块」，也就是看板里最后那一列、
-- 列表里没有标题的那一段。只有顶层任务（parent_id IS NULL）才有意义——子任务跟着父任务
-- 走，它的「位置」由父任务所在的那一行决定（见 service/task.rs 的 reparent 清空逻辑）。

CREATE TABLE sections (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  version    INTEGER NOT NULL DEFAULT 1,
  device_id  TEXT
);
CREATE INDEX idx_sections_project ON sections(project_id, deleted_at);

-- 同一项目内不重名（软删除的不算），和 tags 的规则一致。
CREATE UNIQUE INDEX uq_sections_name ON sections(project_id, name COLLATE NOCASE)
  WHERE deleted_at IS NULL;

-- 任务归属的板块。ON DELETE SET NULL 只在硬删除时生效（软删除走应用层），
-- 所以 service 层删板块时必须自己把它的任务清回「无板块」。
ALTER TABLE tasks ADD COLUMN section_id TEXT REFERENCES sections(id) ON DELETE SET NULL;
CREATE INDEX idx_tasks_section ON tasks(section_id);
