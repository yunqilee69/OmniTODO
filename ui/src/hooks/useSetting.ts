import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

/**
 * Typed wrapper around `settings_get` / `settings_set` (design §13.1).
 *
 * Settings are the same rows the Rust side, the CLI and MCP read, so a value
 * changed here is what every other entry point sees. The value falls back to
 * `fallback` until the read lands, and writing invalidates the key so the query
 * reflects what was stored.
 */
export function useSetting<T>(key: string, fallback: T) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["settings", key],
    queryFn: async () => {
      const value = await api.settingsGet(key);
      return value == null ? fallback : (value as T);
    },
  });
  const set = useMutation({
    mutationFn: (value: T) => api.settingsSet(key, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", key] }),
  });
  return { value: query.data ?? fallback, set: set.mutate };
}
