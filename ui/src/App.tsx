import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { App as AntApp, Button, ConfigProvider, Input, Layout, Tooltip } from "antd";
import {
  MoonOutlined,
  SearchOutlined,
  SunOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import zhCN from "antd/locale/zh_CN";
import { Route, Routes, useNavigate } from "react-router-dom";
import { api } from "./api/client";
import { TaskDndProvider } from "./components/DndProvider";
import NavMenu from "./components/NavMenu";
import ReminderToasts from "./components/ReminderToasts";
import TaskDetail from "./components/TaskDetail";
import { applyTheme, isTheme, persistTheme, subscribeSystemTheme, useResolvedTheme } from "./lib/theme";
import Calendar from "./routes/Calendar";
import ProjectView from "./routes/ProjectView";
import QuickAdd from "./routes/QuickAdd";
import SearchView from "./routes/SearchView";
import Settings from "./routes/Settings";
import TagView from "./routes/TagView";
import TaskListView from "./routes/TaskList";
import { buildAntdTheme } from "./theme/antd";
import { useUiStore } from "./stores/ui";

/** App shell (design §13): one `DndContext` wraps the sidebar and the main pane
 *  so a task can be dragged from a list onto a project. antd's `ConfigProvider`
 *  carries the DESIGN.md token palette; the detail panel is a right-hand Drawer. */
export default function App() {
  const resolved = useResolvedTheme();
  const selectedTaskId = useUiStore((s) => s.selectedTaskId);
  const selectTask = useUiStore((s) => s.selectTask);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const navigate = useNavigate();
  const [term, setTerm] = useState("");

  const submitSearch = (value: string) => {
    const q = value.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  };

  // Keep the custom CSS variables (grain, priority stripes) in step too.
  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    if (theme !== "system") return;
    return subscribeSystemTheme(() => applyTheme("system"));
  }, [theme]);
  // Restore the persisted choice once at startup.
  useEffect(() => {
    let alive = true;
    api
      .settingsGet("ui.theme")
      .then((v) => {
        if (alive && isTheme(v)) setTheme(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [setTheme]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    void persistTheme(next);
  };

  // The global shortcut (Ctrl+Shift+Space) and the tray's quick-add item emit
  // this; the app has one window, so "唤起快捷添加窗" means jumping to the
  // quick-add route (design §12).
  useEffect(() => {
    let un: (() => void) | undefined;
    let disposed = false;
    listen("quickadd:open", () => navigate("/quickadd"))
      .then((u) => {
        if (disposed) u();
        else un = u;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      un?.();
    };
  }, [navigate]);

  // `omnitodo://task/<id>` — clicking a reminder notification, or an MCP client
  // following the resource URI, focuses that task (design §9 / §11).
  useEffect(() => {
    let un: (() => void) | undefined;
    let disposed = false;
    listen<string>("deeplink:focus-task", (e) => {
      const id = typeof e.payload === "string" ? e.payload : "";
      if (id) selectTask(id);
    })
      .then((u) => {
        if (disposed) u();
        else un = u;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      un?.();
    };
  }, [selectTask]);

  return (
    <ConfigProvider theme={buildAntdTheme(resolved)} locale={zhCN} componentSize="middle">
      <AntApp>
        <TaskDndProvider>
          <Layout className="app-grain h-screen">
            <Layout.Sider
              theme="light"
              width={264}
              style={{ borderInlineEnd: "1px solid var(--border-hairline)" }}
            >
              <div className="flex h-full flex-col gap-3 px-3 pb-3 pt-4">
                <div className="flex items-center gap-2 px-1">
                  <span className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-[var(--accent)] text-white">
                    <ThunderboltOutlined />
                  </span>
                  <span className="font-display text-[17px] font-semibold tracking-tight">
                    OmniTODO
                  </span>
                </div>
                <Input
                  prefix={<SearchOutlined />}
                  placeholder="搜索…（回车）"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  onPressEnter={() => submitSearch(term)}
                  allowClear
                />
                <NavMenu />
                <div className="flex items-center justify-between px-1 pt-1">
                  <span className="text-micro opacity-60">本地优先</span>
                  <Tooltip title="切换明暗主题">
                    <Button
                      type="text"
                      size="small"
                      aria-label="切换明暗主题"
                      icon={resolved === "dark" ? <SunOutlined /> : <MoonOutlined />}
                      onClick={toggleTheme}
                    />
                  </Tooltip>
                </div>
              </div>
            </Layout.Sider>

            <Layout>
              <Layout.Content className="overflow-hidden">
                <Routes>
                  <Route path="/" element={<TaskListView title="收件箱" variant="inbox" />} />
                  <Route path="/today" element={<TaskListView title="今天" variant="today" />} />
                  <Route
                    path="/upcoming"
                    element={<TaskListView title="即将到来" variant="upcoming" />}
                  />
                  <Route path="/calendar" element={<Calendar />} />
                  <Route path="/quickadd" element={<QuickAdd />} />
                  <Route path="/search" element={<SearchView />} />
                  <Route path="/project/:id" element={<ProjectView />} />
                  <Route path="/tag/:id" element={<TagView />} />
                  <Route path="/settings" element={<Settings />} />
                </Routes>
              </Layout.Content>
            </Layout>

            <TaskDetail
              taskId={selectedTaskId}
              onClose={() => selectTask(null)}
              onOpenTask={selectTask}
            />
          </Layout>
          <ReminderToasts />
        </TaskDndProvider>
      </AntApp>
    </ConfigProvider>
  );
}
