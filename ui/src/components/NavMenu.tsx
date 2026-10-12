import { useDroppable } from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Menu, Tooltip, type MenuProps } from "antd";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, type ProjectDto } from "../api/client";
import { qk } from "../api/queryKeys";
import { projectDropId } from "./DndProvider";
import {
  BulbOutlined,
  CalendarOutlined,
  FieldTimeOutlined,
  InboxOutlined,
  PlusOutlined,
  SettingOutlined,
  TagOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";

const QUICK_LINKS: MenuProps["items"] = [
  { key: "/", icon: <InboxOutlined />, label: "收件箱" },
  { key: "/today", icon: <BulbOutlined />, label: "今天" },
  { key: "/upcoming", icon: <FieldTimeOutlined />, label: "即将到来" },
  { key: "/calendar", icon: <CalendarOutlined />, label: "日历" },
  { key: "/quickadd", icon: <ThunderboltOutlined />, label: "快速添加" },
  { key: "/settings", icon: <SettingOutlined />, label: "设置" },
];

/** A project row that is also a drag-drop target for moving tasks into it. */
function ProjectLabel({ project, open }: { project: ProjectDto; open: number }) {
  const { isOver, setNodeRef } = useDroppable({ id: projectDropId(project.id) });
  return (
    <span
      ref={setNodeRef}
      className={`flex items-center gap-2 rounded-sm ${
        isOver ? "ring-2 ring-[var(--accent)] ring-offset-1" : ""
      }`}
    >
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ background: project.color ?? "var(--border-hairline)" }}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
      {open > 0 && <span className="tabular text-[11px] opacity-50">{open}</span>}
    </span>
  );
}

/** Sidebar navigation (design §13.1): quick links, projects (drop targets) and
 *  tags, rendered as one antd `Menu`. */
export default function NavMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);

  const { data: projects } = useQuery({ queryKey: qk.projects, queryFn: () => api.projectList() });
  const { data: tags } = useQuery({ queryKey: qk.tags, queryFn: () => api.tagList() });

  const create = useMutation({
    mutationFn: (n: string) => api.projectCreate(n),
    onSuccess: () => {
      setName("");
      setAdding(false);
      qc.invalidateQueries({ queryKey: qk.projects });
    },
  });

  const selectedKeys: string[] = [];
  if (location.pathname === "/") selectedKeys.push("/");
  else if (
    ["/today", "/upcoming", "/calendar", "/quickadd", "/settings"].includes(location.pathname)
  ) {
    selectedKeys.push(location.pathname);
  } else if (location.pathname.startsWith("/project/")) {
    selectedKeys.push(`p:${location.pathname.slice("/project/".length)}`);
  } else if (location.pathname.startsWith("/tag/")) {
    selectedKeys.push(`t:${location.pathname.slice("/tag/".length)}`);
  }

  const items: MenuProps["items"] = [...(QUICK_LINKS ?? [])];
  // Always rendered (even with no projects) so the "+" is reachable on a fresh install.
  items.push({
    type: "group",
    label: (
      <span className="flex items-center gap-1">
        <span>项目</span>
        {!adding && (
          <Tooltip title="新建项目">
            <Button
              type="text"
              size="small"
              aria-label="新建项目"
              className="ml-auto"
              icon={<PlusOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                setAdding(true);
              }}
            />
          </Tooltip>
        )}
      </span>
    ),
    children: [
      ...(projects ?? []).map((p) => ({
        key: `p:${p.id}`,
        label: <ProjectLabel project={p} open={p.stats?.open ?? 0} />,
      })),
      // The field is the last item so it sits at the bottom of the list it adds
      // to, where the new project will appear. The inline style strips the menu
      // item chrome (height, padding, hover fill) so it reads as a field rather
      // than a clickable row — inline beats antd's class rules.
      ...(adding
        ? [
            {
              key: "__new_project",
              style: {
                height: "auto",
                padding: 0,
                background: "transparent",
                lineHeight: "normal",
                cursor: "text",
              },
              label: (
                <div style={{ padding: "2px 12px" }}>
                  <Input
                    size="small"
                    autoFocus
                    prefix={<PlusOutlined />}
                    placeholder="项目名，回车确认"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onPressEnter={() => name.trim() && create.mutate(name.trim())}
                    onBlur={() => !name.trim() && setAdding(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setName("");
                        setAdding(false);
                      }
                    }}
                  />
                </div>
              ),
            },
          ]
        : []),
    ],
  });
  if ((tags ?? []).length > 0) {
    items.push({
      type: "group",
      label: "标签",
      children: (tags ?? []).map((t) => ({
        key: `t:${t.id}`,
        icon: <TagOutlined />,
        label: (
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{t.name}</span>
            {t.count > 0 && <span className="tabular text-[11px] opacity-60">{t.count}</span>}
          </span>
        ),
      })),
    });
  }

  const onSelect: MenuProps["onSelect"] = ({ key }) => {
    // The inline "new project" field is a menu item for layout only.
    if (key.startsWith("__")) return;
    if (key.startsWith("p:")) navigate(`/project/${key.slice(2)}`);
    else if (key.startsWith("t:")) navigate(`/tag/${key.slice(2)}`);
    else navigate(key);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Menu
        mode="inline"
        selectedKeys={selectedKeys}
        items={items}
        onSelect={onSelect}
        style={{ borderInlineEnd: "none", background: "transparent" }}
      />
    </div>
  );
}
