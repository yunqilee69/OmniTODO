import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useUiStore, type Theme } from "../stores/ui";

/**
 * Theme application (DESIGN.md §10.1). The palette flips through the
 * `[data-theme]` attribute, so all this does is resolve "system" and stamp the
 * resolved value on <html>. `color-scheme` keeps native controls (date pickers,
 * scrollbars) in step.
 */
export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

/** Re-apply when the OS scheme changes (only meaningful for theme === "system"). */
export function subscribeSystemTheme(onChange: () => void): () => void {
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function isTheme(value: unknown): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

/** Persist the choice so it survives a restart (best-effort: no UI to block on). */
export async function persistTheme(theme: Theme): Promise<void> {
  try {
    await api.settingsSet("ui.theme", theme);
  } catch {
    /* not running inside Tauri, or settings unavailable — keep the session value */
  }
}

/**
 * Resolved light/dark for the antd `ConfigProvider` algorithm, reactive to the
 * OS scheme when the stored preference is "system".
 */
export function useResolvedTheme(): "light" | "dark" {
  const theme = useUiStore((s) => s.theme);
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolveTheme(theme));
  useEffect(() => {
    setResolved(resolveTheme(theme));
    if (theme !== "system") return;
    return subscribeSystemTheme(() => setResolved(resolveTheme("system")));
  }, [theme]);
  return resolved;
}
