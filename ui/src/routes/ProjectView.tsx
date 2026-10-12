import { useQuery } from "@tanstack/react-query";
import { Space, Typography } from "antd";
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { qk } from "../api/queryKeys";
import PageHeader from "../components/PageHeader";
import TaskList from "../components/TaskList";
import { projectFilter } from "../lib/filter";
import { useUiStore } from "../stores/ui";

/** Project view: tasks in the user's manual order, drag-sortable (§13.1). */
export default function ProjectView() {
  const { id = "" } = useParams();
  const selectTask = useUiStore((s) => s.selectTask);

  const { data: project } = useQuery({
    queryKey: qk.project(id),
    queryFn: () => api.projectGet(id),
    enabled: Boolean(id),
  });

  const filter = useMemo(() => projectFilter(id), [id]);
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
      />
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        <Typography.Text type="secondary" className="text-xs">
          拖动手柄调整顺序；把任务拖到左侧其他项目即可移动。
        </Typography.Text>
        <div className="mt-3">
          <TaskList
            filter={filter}
            sortable
            onOpenTask={selectTask}
            emptyHint="这个项目还没有任务"
          />
        </div>
      </div>
    </section>
  );
}
