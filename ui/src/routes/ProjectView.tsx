import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Divider,
  Flex,
  Modal,
  Segmented,
  Space,
  Switch,
  Tooltip,
  Typography,
} from "antd";
import { SettingOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type Sort } from "../api/client";
import { qk } from "../api/queryKeys";
import BoardView from "../components/BoardView";
import CalendarBoard from "../components/CalendarBoard";
import PageContent from "../components/PageContent";
import PageHeader from "../components/PageHeader";
import TaskComposer from "../components/TaskComposer";
import TaskList, { type SectionGrouping } from "../components/TaskList";
import { useProjectSections } from "../hooks/useProjectSections";
import { useSetting } from "../hooks/useSetting";
import { projectFilter } from "../lib/filter";
import { useUiStore } from "../stores/ui";

/** Ordering choices offered by the project's display settings (§13.1). */
const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: "manual", label: "手动" },
  { value: "dueasc", label: "截止日期" },
  { value: "createddesc", label: "创建时间" },
  { value: "prioritydesc", label: "优先级" },
];

/** Which way a project's tasks are laid out (Todoist's `view_mode`). */
type ProjectViewMode = "list" | "board" | "calendar";

const VIEW_OPTIONS: { value: ProjectViewMode; label: string }[] = [
  { value: "list", label: "列表" },
  { value: "board", label: "看板" },
  { value: "calendar", label: "日历" },
];

/**
 * Project view: the same tasks as a list, a board or a calendar (design §13.1).
 *
 * The mode is a per-project setting, the way Todoist keeps `view_mode` on the
 * view options of a project rather than on the client — so a project opens the
 * way it was left, whichever device asks.
 *
 * The three modes share the project's tasks and its sections; what changes is the
 * shape. The list groups by section, the board makes each section a column, and
 * the calendar scopes the app's calendar to this project. Only the list has a
 * sort setting: a board's column order *is* the manual order, and a calendar's is
 * time.
 */
export default function ProjectView() {
  const { id = "" } = useParams();
  const selectTask = useUiStore((s) => s.selectTask);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { value: showCompleted, set: setShowCompleted } = useSetting<boolean>(
    "ui.project.show_completed",
    true,
  );
  const { value: sort, set: setSort } = useSetting<Sort>("ui.project.sort", "manual");
  const { value: mode, set: setMode } = useSetting<ProjectViewMode>("ui.project.view_mode", "list");

  const { data: project } = useQuery({
    queryKey: qk.project(id),
    queryFn: () => api.projectGet(id),
    enabled: Boolean(id),
  });

  const sections = useProjectSections(id);

  const filter = useMemo(
    () => projectFilter(id, { includeCompleted: showCompleted, sort }),
    [id, showCompleted, sort],
  );
  const stats = project?.stats;

  const grouping: SectionGrouping = {
    projectId: id,
    projectName: project?.name,
    projectColor: project?.color,
    sections: sections.sections,
    collapsed: sections.collapsed,
    onToggleCollapse: sections.toggleCollapse,
    onRename: (section, name) => sections.rename.mutate({ id: section.id, name }),
    // The count comes off the section itself: it is the core's live top-level
    // count, which is what the dialog is about to release or delete.
    onDelete: (section) => sections.promptDelete(section, section.task_count),
    onMove: sections.move,
    onAddSection: sections.promptCreate,
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={
          <Space size={8}>
            {project?.color && (
              <span
                className="inline-block size-2.5 rounded-full"
                style={{ background: project.color }}
              />
            )}
            {project?.name ?? "项目"}
          </Space>
        }
        meta={
          stats && (
            <Space size={6} split={<span style={{ opacity: 0.35 }}>·</span>}>
              <span>未完成 {stats.open}</span>
              <span>已完成 {stats.completed}</span>
              {stats.overdue > 0 && (
                <Typography.Text style={{ color: "var(--prio-urgent)" }}>
                  逾期 {stats.overdue}
                </Typography.Text>
              )}
            </Space>
          )
        }
        tools={
          <Space size={4}>
            <Segmented
              size="small"
              value={mode}
              onChange={(v) => setMode(v as ProjectViewMode)}
              options={VIEW_OPTIONS}
            />
            <Tooltip title="显示设置">
              <Button
                type="text"
                size="small"
                aria-label="项目显示设置"
                icon={<SettingOutlined />}
                onClick={() => setSettingsOpen(true)}
              />
            </Tooltip>
          </Space>
        }
      />

      {mode === "board" ? (
        <PageContent wide>
          <BoardView
            projectId={id}
            includeCompleted={showCompleted}
            sections={sections}
            onOpenTask={selectTask}
          />
        </PageContent>
      ) : mode === "calendar" ? (
        <PageContent wide>
          <CalendarBoard projectId={id} embedded />
        </PageContent>
      ) : (
        <PageContent taskList>
          <TaskList
            filter={filter}
            // Dragging only means something in the manual order.
            sortable={sort === "manual"}
            onOpenTask={selectTask}
            emptyHint="这个项目还没有任务"
            grouping={grouping}
            footer={
              <TaskComposer
                projectId={id}
                projectName={project?.name}
                projectColor={project?.color}
              />
            }
          />
        </PageContent>
      )}

      <Modal
        open={settingsOpen}
        title="显示设置"
        footer={null}
        onCancel={() => setSettingsOpen(false)}
      >
        <Flex vertical gap={16} style={{ paddingTop: 4 }}>
          <Flex align="flex-start" justify="space-between" gap={16}>
            <Flex vertical gap={2}>
              <Typography.Text>显示已完成的任务</Typography.Text>
              <Typography.Text type="secondary" className="text-[11px]">
                关闭后列表和看板只留未完成的，顶部计数仍统计全部。
              </Typography.Text>
            </Flex>
            <Switch checked={showCompleted} onChange={(v) => setShowCompleted(v)} />
          </Flex>

          <Divider style={{ margin: 0 }} />

          <Flex vertical gap={6}>
            <Typography.Text>排序方式</Typography.Text>
            <Segmented
              block
              value={sort}
              onChange={(v) => setSort(v as Sort)}
              options={SORT_OPTIONS}
            />
            <Typography.Text type="secondary" className="text-[11px]">
              只有「手动」可以拖拽调整顺序；看板始终按手动顺序排列每一列。
            </Typography.Text>
          </Flex>
        </Flex>
      </Modal>
    </section>
  );
}
