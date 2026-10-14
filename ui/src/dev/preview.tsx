//! Dev-only preview entry.
//!
//! Serves the real app against the stub IPC in `mockIpc.ts` so `vite` can show
//! the UI in a plain browser (no Rust backend). Reached only via
//! `dev-preview.html`; the production entry is `main.tsx`.
//!
//! The provider tree mirrors `main.tsx`, with one deliberate difference: the
//! router is in-memory, seeded at a fixed route. A `BrowserRouter` would have to
//! rewrite the address bar to a path like `/project/p-zhi`, and a reload there
//! gets the dev server's `index.html` fallback — i.e. the production entry with
//! no stub, which renders an empty shell. Keeping the URL at `dev-preview.html`
//! means a reload always re-serves this file.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dayjs from "dayjs";
import React from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "dayjs/locale/zh-cn";
import App from "../App";
import { registerEventBridge } from "../api/events";
import "../i18n";
import "antd/dist/reset.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource-variable/fraunces/wght.css";
import "../index.css";
import { installMockIpc } from "./mockIpc";

installMockIpc();

dayjs.locale("zh-cn");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false },
  },
});

registerEventBridge(queryClient);

/** Route the preview opens on; override with `?route=/project/p-zhi`. */
const initialRoute = new URLSearchParams(window.location.search).get("route") ?? "/project/p-zhi";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
