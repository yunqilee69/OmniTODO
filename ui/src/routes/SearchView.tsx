import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { qk } from "../api/queryKeys";
import TaskList from "../components/TaskList";
import { searchFilter } from "../lib/filter";
import { useUiStore } from "../stores/ui";

/** Full-text search with highlighted matches (design §13.1). */
export default function SearchView() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const [text, setText] = useState(query);
  const [committed, setCommitted] = useState(query);
  const selectTask = useUiStore((s) => s.selectTask);
  const filter = useMemo(() => searchFilter(), []);

  // Keep the URL and the debounced query in step with the box.
  useEffect(() => {
    const t = setTimeout(() => {
      setCommitted(text);
      setParams(text.trim() ? { q: text } : {}, { replace: true });
    }, 200);
    return () => clearTimeout(t);
  }, [text, setParams]);

  const term = committed.trim();

  return (
    <section>
      <h1 className="mb-3 text-xl font-semibold">搜索</h1>
      <input
        autoFocus
        className="mb-3 w-full rounded border border-neutral-300 px-3 py-2"
        placeholder="搜索标题、描述与标签…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {term ? (
        <TaskList
          filter={filter}
          highlight={term}
          enabled
          query={{ key: qk.search(term, filter), fn: () => api.search(term, filter) }}
          onOpenTask={selectTask}
          emptyHint={`没有匹配「${term}」的任务`}
        />
      ) : (
        <p className="text-sm text-neutral-400">
          输入关键词开始搜索；中文支持任意子串（少于 3 个字符时走 LIKE 回退）。
        </p>
      )}
    </section>
  );
}
