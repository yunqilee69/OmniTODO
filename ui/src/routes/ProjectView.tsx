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
import PageContent from "../components/PageContent";
import PageHeader from "../components/PageHeader";
import TaskComposer from "../components/TaskComposer";
import TaskList from "../components/TaskList";
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

/**
 * Project view: tasks in the user's manual order by default, drag-sortable
 * (§13.1). The header's gear opens the project's display settings — whether
 * completed tasks are listed, and which order the list uses.
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

  const { data: project } = useQuery({
    queryKey: qk.project(id),
    queryFn: () => api.projectGet(id),
    enabled: Boolean(id),
  });

  const filter = useMemo(
    () => projectFilter(id, { includeCompleted: showCompleted, sort }),
    [id, showCompleted, sort],
  );
  const stats = project?.stats;

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
          <Tooltip title="显示设置">
            <Button
              type="text"
              size="small"
              aria-label="项目显示设置"
              icon={<SettingOutlined />}
              onClick={() => setSettingsOpen(true)}
            />
          </Tooltip>
        }
      />
      <PageContent taskList>
        <TaskList
          filter={filter}
          // Dragging only means something in the manual order.
          sortable={sort === "manual"}
          onOpenTask={selectTask}
          emptyHint="这个项目还没有任务"
          footer={
            <TaskComposer
              projectId={id}
              projectName={project?.name}
              projectColor={project?.color}
            />
          }
        />
      </PageContent>

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
                关闭后列表只留未完成的，顶部计数仍统计全部。
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
              只有「手动」可以拖拽调整顺序。
            </Typography.Text>
          </Flex>
        </Flex>
      </Modal>
    </section>
  );
}
