import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SystemViewId, ViewFilters, ViewSort } from "@tickzy/shared/views";
import { api } from "./api.ts";
import { pollUnlessLive } from "./realtime.ts";

/** Saved inbox views (T-211, FR-3.7): GET/POST/PATCH/DELETE /v1/views. */
export interface SavedView {
  id: string; name: string; shared: boolean; base: SystemViewId; filters: ViewFilters; sort: ViewSort; position: number;
  owner_user_id: string; owner_name: string | null; count: number; can_edit: boolean; created_at: string; updated_at: string;
}
export interface ViewState { base: SystemViewId; sort: ViewSort; filters: ViewFilters }

// Under the issues key: any issue change (mutation or realtime event) refreshes the counts too.
const viewsKey = (ws: string | null) => ["issues", ws, "views"] as const;

export function useSavedViews(ws: string | null) {
  return useQuery({
    queryKey: viewsKey(ws),
    queryFn: () => api<{ data: SavedView[] }>("/v1/views", { workspaceId: ws }),
    enabled: !!ws,
    refetchInterval: pollUnlessLive(30_000),
  });
}

export function useViewMutations(ws: string | null) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: viewsKey(ws) });
  return {
    create: useMutation({ mutationFn: (v: ViewState & { name: string; shared: boolean }) => api<SavedView>("/v1/views", { method: "POST", body: v, workspaceId: ws }), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, ...patch }: Partial<ViewState & { name: string; shared: boolean }> & { id: string }) => api<SavedView>(`/v1/views/${encodeURIComponent(id)}`, { method: "PATCH", body: patch, workspaceId: ws }),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/v1/views/${encodeURIComponent(id)}`, { method: "DELETE", workspaceId: ws }), onSuccess: done }),
  };
}

const FILTER_KEYS = ["priority", "channel", "team", "label", "account", "q"] as const;
/** Normalised filters: only non-empty values (so "" and missing compare equal). */
export const cleanFilters = (f: ViewFilters): ViewFilters => Object.fromEntries(FILTER_KEYS.filter((k) => f[k]?.trim()).map((k) => [k, f[k]!.trim()]));
/** Whether the inbox state is exactly what the saved view stores. */
export function sameState(a: ViewState, b: ViewState): boolean {
  const fa = cleanFilters(a.filters), fb = cleanFilters(b.filters);
  return a.base === b.base && a.sort === b.sort && FILTER_KEYS.every((k) => (fa[k] ?? "") === (fb[k] ?? ""));
}
