import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { TaskDndProvider } from "./components/DndProvider";
import ProjectSidebar, { TagSidebar } from "./components/ProjectSidebar";
import ReminderToasts from "./components/ReminderToasts";
import TaskDetail from "./components/TaskDetail";
import Calendar from "./routes/Calendar";
import ProjectView from "./routes/ProjectView";
import QuickAdd from "./routes/QuickAdd";
import SearchView from "./routes/SearchView";
import Settings from "./routes/Settings";
import TagView from "./routes/TagView";
import TaskListView from "./routes/TaskList";
import { useUiStore } from "./stores/ui";

const QUICK_LINKS = [
  { to: "/", label: "收件箱", end: true },
  { to: "/today", label: "今天" },
  { to: "/upcoming", label: "即将到来" },
  { to: "/calendar", label: "日历" },
  { to: "/quickadd", label: "快速添加" },
  { to: "/settings", label: "设置" },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded px-2 py-1 ${isActive ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"}`;

/** App shell (design §13): one `DndContext` wraps the sidebar and the main pane
 *  so a task can be dragged from a list onto a project; the detail panel is a
 *  sibling that opens when `selectedTaskId` is set. */
export default function App() {
  const selectedTaskId = useUiStore((s) => s.selectedTaskId);
  const selectTask = useUiStore((s) => s.selectTask);
  const navigate = useNavigate();
  const [term, setTerm] = useState("");

  const submitSearch = (value: string) => {
    const q = value.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  };

  // The global shortcut (Ctrl+Shift+Space) and the tray's quick-add item emit
  // this; the app has one window, so "唤起快捷添加窗" means jumping to the
  // quick-add route. Inert in a plain browser — the event source is the desktop
  // shell — hence the swallowed rejection.
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
  // following the resource URI, focuses that task (design §9 / §11). An empty
  // payload is the `omnitodo://projects` link, which just lands on the inbox.
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
    <TaskDndProvider>
      <div className="flex h-screen bg-neutral-50 text-neutral-900">
        <nav className="flex w-60 shrink-0 flex-col overflow-auto border-r border-neutral-200 bg-white p-3">
          <div className="mb-3 px-2 text-lg font-semibold">OmniTODO</div>
          <input
            className="mb-3 w-full rounded border border-neutral-200 px-2 py-1 text-sm"
            placeholder="搜索…（回车）"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitSearch(term);
            }}
          />
          <ul className="space-y-0.5 text-sm">
            {QUICK_LINKS.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className={linkClass}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <ProjectSidebar />
          <TagSidebar />
        </nav>

        <main className="min-w-0 flex-1 overflow-auto p-6">
          <Routes>
            <Route path="/" element={<TaskListView title="收件箱" variant="inbox" />} />
            <Route path="/today" element={<TaskListView title="今天" variant="today" />} />
            <Route path="/upcoming" element={<TaskListView title="即将到来" variant="upcoming" />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/quickadd" element={<QuickAdd />} />
            <Route path="/search" element={<SearchView />} />
            <Route path="/project/:id" element={<ProjectView />} />
            <Route path="/tag/:id" element={<TagView />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>

        {selectedTaskId && (
          <TaskDetail
            taskId={selectedTaskId}
            onClose={() => selectTask(null)}
            onOpenTask={selectTask}
          />
        )}
      </div>
      <ReminderToasts />
    </TaskDndProvider>
  );
}
