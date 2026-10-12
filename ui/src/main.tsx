import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import App from "./App";
import { registerEventBridge } from "./api/events";
import "./i18n";
// antd v6 global reset, then our custom layer (fonts, tokens, grain).
import "antd/dist/reset.css";
// Self-hosted fonts (DESIGN.md §4.1) — bundled so the offline desktop build and
// the packaged webview render identically on every platform.
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource-variable/fraunces/wght.css";
import "./index.css";

// antd's DatePicker reads from dayjs; keep it in the app locale.
dayjs.locale("zh-cn");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false },
  },
});

// Rust -> React invalidation bridge (§8.2 / §4.5).
registerEventBridge(queryClient);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
