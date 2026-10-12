-- OmniTODO initial schema (design v1.3)
-- Times are Unix milliseconds (UTC, INTEGER) except all_day tasks, which store
-- the civil date as UTC midnight and are never timezone-shifted.

-- 项目
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  color       TEXT,
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  version     INTEGER NOT NULL DEFAULT 1,
  device_id   TEXT
);
CREATE INDEX idx_projects_active ON projects(is_archived, deleted_at);

-- 任务（含子任务与重复系列）
CREATE TABLE tasks (
  id                TEXT PRIMARY KEY,
  project_id        TEXT REFERENCES projects(id) ON DELETE SET NULL,
  parent_id         TEXT REFERENCES tasks(id)   ON DELETE CASCADE,
  series_id         TEXT,
  occurrence_at     INTEGER,
  title             TEXT NOT NULL,
  description       TEXT,
  priority          INTEGER NOT NULL DEFAULT 0,
  status            TEXT    NOT NULL DEFAULT 'todo',
  completed_at      INTEGER,
  start_at          INTEGER,
  due_at            INTEGER,
  all_day           INTEGER NOT NULL DEFAULT 0,
  timezone          TEXT,
  remind_enabled    INTEGER NOT NULL DEFAULT 0,
  remind_at         INTEGER,
  remind_offset_min INTEGER,
  recurrence_rule   TEXT,
  recurrence_until  INTEGER,
  tags_text         TEXT NOT NULL DEFAULT '',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  deleted_at        INTEGER,
  version           INTEGER NOT NULL DEFAULT 1,
  device_id         TEXT
);
CREATE INDEX idx_tasks_project ON tasks(project_id, status, deleted_at);
CREATE INDEX idx_tasks_parent  ON tasks(parent_id);
CREATE INDEX idx_tasks_series  ON tasks(series_id);
-- 同一系列的同一期只能物化一次（幂等，见设计 §5.5）
CREATE UNIQUE INDEX uq_tasks_series_occ ON tasks(series_id, occurrence_at)
  WHERE series_id IS NOT NULL AND occurrence_at IS NOT NULL;
CREATE INDEX idx_tasks_due     ON tasks(due_at)  WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_start   ON tasks(start_at) WHERE deleted_at IS NULL;

-- 标签
CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL COLLATE NOCASE,
  color      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  version    INTEGER NOT NULL DEFAULT 1,
  device_id  TEXT
);
CREATE UNIQUE INDEX uq_tags_name ON tags(name COLLATE NOCASE) WHERE deleted_at IS NULL;

-- 任务-标签
CREATE TABLE task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);
CREATE INDEX idx_task_tags_tag ON task_tags(tag_id);

-- 附件（blob=二进制存库内；managed=托管文件存 .omnitodo/attachments/）
CREATE TABLE attachments (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_name    TEXT NOT NULL,
  storage_kind TEXT NOT NULL DEFAULT 'blob',
  rel_path     TEXT,
  data         BLOB,
  mime_type    TEXT,
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  sha256       TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  version      INTEGER NOT NULL DEFAULT 1,
  device_id    TEXT
);
CREATE INDEX idx_attachments_task ON attachments(task_id);
CREATE INDEX idx_attachments_sha  ON attachments(sha256);

-- 提醒触发记录（幂等去重）
CREATE TABLE reminder_fires (
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  occurrence_at INTEGER NOT NULL,
  fired_at      INTEGER NOT NULL,
  PRIMARY KEY (task_id, occurrence_at)
);

-- 完成历史（报告用）
CREATE TABLE task_completions (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  series_id    TEXT,
  completed_at INTEGER NOT NULL,
  due_at       INTEGER,
  was_on_time  INTEGER
);
CREATE INDEX idx_completions_time ON task_completions(completed_at);
CREATE UNIQUE INDEX uq_completions_task ON task_completions(task_id);

-- MCP 审计
CREATE TABLE mcp_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  transport   TEXT NOT NULL,
  tool        TEXT NOT NULL,
  args        TEXT,
  ok          INTEGER NOT NULL,
  error       TEXT,
  duration_ms INTEGER
);

-- 应用设置（KV）
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 变更日志：为将来同步预留，v1 写入但暂不消费；保留窗口 30 天
CREATE TABLE op_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  op          TEXT NOT NULL,
  payload     TEXT,
  ts          INTEGER NOT NULL,
  device_id   TEXT
);

-- 业务 schema 版本冗余
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- 全文搜索（trigram 对中文子串友好；最小匹配 3 字符）
CREATE VIRTUAL TABLE tasks_fts USING fts5(
  task_id UNINDEXED,
  title, description, tags_text,
  tokenize='trigram'
);
