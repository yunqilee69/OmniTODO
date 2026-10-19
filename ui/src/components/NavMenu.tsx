import { useDroppable } from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  App as AntApp,
  Button,
  Dropdown,
  Input,
  Menu,
  Modal,
  Tooltip,
  Typography,
  type MenuProps,
} from "antd";
import { useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, type ProjectDto } from "../api/client";
import { qk } from "../api/queryKeys";
import { nextProjectColor, PROJECT_COLORS } from "../lib/projectColors";
import { useUiStore } from "../stores/ui";
import { projectDropId } from "./DndProvider";
import ProjectColorPicker from "./ProjectColorPicker";
import {
  BulbOutlined,
  CalendarOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  FieldTimeOutlined,
  InboxOutlined,
  MoreOutlined,
  PlusOutlined,
  RightOutlined,
  TagOutlined,
} from "@ant-design/icons";

const QUICK_LINKS: MenuProps["items"] = [
  { key: "/", icon: <InboxOutlined />, label: "收件箱" },
  { key: "/today", icon: <BulbOutlined />, label: "今天" },
  { key: "/upcoming", icon: <FieldTimeOutlined />, label: "即将到来" },
  { key: "/calendar", icon: <CalendarOutlined />, label: "日历" },
];

/** Remembers whether the projects group is collapsed across restarts. */
const PROJECTS_COLLAPSED_KEY = "omnitodo.sidebar.projectsCollapsed";

/**
 * The right-hand actions column of the sidebar.
 *
 * Every row's trailing control — the project count, its "⋯" menu, the group's
 * "new" and collapse buttons — is centred inside this same width, so a number
 * and the icon that replaces it share one optical centre instead of sitting a
 * few pixels apart.
 */
const SLOT = 18;
const SLOT_BOX: CSSProperties = { width: SLOT, height: SLOT, minWidth: SLOT, padding: 0 };

/** A project row that is also a drag-drop target for moving tasks into it.
 *
 *  Its right-hand slot holds the open-task count, swapped for a "⋯" actions menu
 *  on hover or keyboard focus (or while that menu is open) — the row is narrow,
 *  so the two share one slot rather than sitting side by side.
 *
 *  Visibility is driven by that state with inline styles rather than by hiding it
 *  from the DOM, so the button stays mounted: an unmounted button is unreachable
 *  for keyboard users and for a scripted click that lands after the pointer left. */
function ProjectLabel({
  project,
  open,
  onEdit,
  onDelete,
}: {
  project: ProjectDto;
  open: number;
  onEdit: (project: ProjectDto) => void;
  onDelete: (project: ProjectDto) => void;
}) {
  const railCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const { isOver, setNodeRef } = useDroppable({
    id: projectDropId(project.id),
    // A hidden rail still has layout: its rows keep real rectangles under the
    // clipped edge, and the app-level drop resolves by nearest centre, not by
    // the pointer. Left enabled, a task could be filed into a project the user
    // cannot see.
    disabled: railCollapsed,
  });
  const [reveal, setReveal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const shown = reveal || menuOpen;

  return (
    <span
      ref={setNodeRef}
      onMouseEnter={() => setReveal(true)}
      onMouseLeave={() => setReveal(false)}
      onFocus={() => setReveal(true)}
      onBlur={() => setReveal(false)}
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
      <span
        className="relative grid shrink-0 place-items-center"
        style={{ width: SLOT, height: SLOT }}
      >
        <span
          className="tabular text-[11px] leading-none opacity-50"
          style={{ visibility: shown ? "hidden" : "visible" }}
        >
          {open > 0 ? open : ""}
        </span>
        <Dropdown
          trigger={["click"]}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          menu={{
            items: [
              { key: "edit", icon: <EditOutlined />, label: "编辑" },
              { key: "delete", icon: <DeleteOutlined />, label: "删除", danger: true },
            ],
            onClick: ({ key, domEvent }) => {
              domEvent.stopPropagation();
              setMenuOpen(false);
              if (key === "edit") onEdit(project);
              else onDelete(project);
            },
          }}
        >
          <Button
            type="text"
            size="small"
            aria-label={`项目操作：${project.name}`}
            icon={<MoreOutlined />}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              minWidth: 0,
              padding: 0,
              opacity: shown ? 1 : 0,
              pointerEvents: shown ? "auto" : "none",
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </Dropdown>
      </span>
    </span>
  );
}

/** Sidebar navigation (design §13.1): quick links, projects (drop targets) and
 *  tags, rendered as one antd `Menu`. */
export default function NavMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { modal, message } = AntApp.useApp();
  const [name, setName] = useState("");
  const [newColor, setNewColor] = useState<string>(PROJECT_COLORS[0]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ProjectDto | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<string>(PROJECT_COLORS[0]);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(PROJECTS_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PROJECTS_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Private mode / storage disabled: the toggle still works this session.
      }
      return next;
    });
  };

  const { data: projects } = useQuery({ queryKey: qk.projects, queryFn: () => api.projectList() });
  const { data: tags } = useQuery({ queryKey: qk.tags, queryFn: () => api.tagList() });

  /** The colour a project about to be created should default to: the first
   *  palette entry no existing project has claimed. */
  const freeColor = () => nextProjectColor((projects ?? []).map((p) => p.color));

  const create = useMutation({
    mutationFn: (v: { name: string; color: string }) => api.projectCreate(v.name, v.color),
    onSuccess: () => {
      setName("");
      setAdding(false);
      qc.invalidateQueries({ queryKey: qk.projects });
    },
  });

  const rename = useMutation({
    mutationFn: (v: { id: string; name: string; color: string }) =>
      api.projectUpdate(v.id, { name: v.name, color: v.color }),
    onSuccess: () => {
      setEditing(null);
      qc.invalidateQueries({ queryKey: qk.projects });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.projectDelete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.projects });
      qc.invalidateQueries({ queryKey: qk.tasksAll });
      message.success("已删除项目");
    },
  });

  const startEdit = (project: ProjectDto) => {
    setEditing(project);
    setEditName(project.name);
    // A project with no colour yet starts on the one it would be given anyway,
    // so saving the dialog (which writes the colour) is a visible change and not
    // a silent one.
    setEditColor(project.color ?? freeColor());
  };

  /** Opens the inline "new project" field on a colour nothing else is using. */
  const startAdd = () => {
    setNewColor(freeColor());
    setAdding(true);
  };

  const saveEdit = () => {
    if (!editing || !editName.trim()) return;
    rename.mutate({ id: editing.id, name: editName.trim(), color: editColor });
  };

  /** Deleting a project takes its tasks with it (design §5.7), so confirm first. */
  const confirmDelete = (project: ProjectDto) => {
    modal.confirm({
      title: `删除项目「${project.name}」？`,
      content: "该项目下的任务会一并删除，此操作不可撤销。",
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        await remove.mutateAsync(project.id);
        // The view we are on no longer exists.
        if (location.pathname === `/project/${project.id}`) navigate("/");
      },
    });
  };

  const selectedKeys: string[] = [];
  if (location.pathname === "/") selectedKeys.push("/");
  else if (["/today", "/upcoming", "/calendar"].includes(location.pathname)) {
    selectedKeys.push(location.pathname);
  } else if (location.pathname.startsWith("/project/")) {
    selectedKeys.push(`p:${location.pathname.slice("/project/".length)}`);
  } else if (location.pathname.startsWith("/tag/")) {
    selectedKeys.push(`t:${location.pathname.slice("/tag/".length)}`);
  }

  const items: MenuProps["items"] = [...(QUICK_LINKS ?? [])];

  // The field is the last child so it sits at the bottom of the list it adds to,
  // where the new project will appear. The inline style strips the menu item
  // chrome (height, padding, hover fill) so it reads as a field rather than a
  // clickable row — inline beats antd's class rules.
  const projectChildren = [
    ...(projects ?? []).map((p) => ({
      key: `p:${p.id}`,
      label: (
        <ProjectLabel
          project={p}
          open={p.stats?.open ?? 0}
          onEdit={startEdit}
          onDelete={confirmDelete}
        />
      ),
    })),
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
                  onPressEnter={() =>
                    name.trim() && create.mutate({ name: name.trim(), color: newColor })
                  }
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
  ];

  // Always rendered (even with no projects) so the chevron and "+" stay reachable
  // on a fresh install; antd renders a `group` even when its children are empty,
  // which is what lets a collapsed group keep its header.
  items.push({
    type: "group",
    label: (
      <span className="flex items-center gap-1">
        <span>项目</span>
        <span className="ml-auto flex items-center gap-1">
          {!adding && (
            <Tooltip title="新建项目">
              <Button
                type="text"
                size="small"
                aria-label="新建项目"
                style={SLOT_BOX}
                icon={<PlusOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  // Adding a project implies wanting to see the list it lands in.
                  if (collapsed) toggleCollapsed();
                  startAdd();
                }}
              />
            </Tooltip>
          )}
          <Tooltip title={collapsed ? "展开项目" : "折叠项目"}>
            <Button
              type="text"
              size="small"
              aria-label={collapsed ? "展开项目" : "折叠项目"}
              aria-expanded={!collapsed}
              style={SLOT_BOX}
              icon={collapsed ? <RightOutlined /> : <DownOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                toggleCollapsed();
              }}
            />
          </Tooltip>
        </span>
      </span>
    ),
    children: collapsed ? [] : projectChildren,
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
            <span className="grid shrink-0 place-items-center" style={{ width: SLOT, height: SLOT }}>
              {t.count > 0 && (
                <span className="tabular text-[11px] leading-none opacity-60">{t.count}</span>
              )}
            </span>
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
      <Modal
        open={editing !== null}
        title="编辑项目"
        okText="保存"
        cancelText="取消"
        confirmLoading={rename.isPending}
        okButtonProps={{ disabled: !editName.trim() }}
        onOk={() => saveEdit()}
        onCancel={() => setEditing(null)}
      >
        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            value={editName}
            placeholder="项目名"
            onChange={(e) => setEditName(e.target.value)}
            onPressEnter={() => saveEdit()}
          />
          {/* The same swatch the project is drawn with everywhere else: the dot
              in the rail, the block on the calendar, the chip on a row in a view
              that spans projects. */}
          <div className="flex items-center gap-2">
            <Typography.Text type="secondary" className="text-xs">
              颜色
            </Typography.Text>
            <ProjectColorPicker value={editColor} onChange={setEditColor} />
            <Typography.Text type="secondary" className="text-xs">
              在日历、标签等跨项目视图里用它区分这个项目的任务
            </Typography.Text>
          </div>
        </div>
      </Modal>
    </div>
  );
}
