import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

/** Workspace labels and teams (GET /v1/labels, /v1/teams; POST /v1/labels). */
export interface Label { id: string; name: string; color: string; description: string | null; parent_id: string | null }
export interface Team { id: string; name: string }

export function useLabels(ws: string | null) {
  return useQuery({ queryKey: ["labels", ws], queryFn: () => api<{ data: Label[] }>("/v1/labels", { workspaceId: ws }), enabled: !!ws, staleTime: 60_000 });
}
export function useTeams(ws: string | null) {
  return useQuery({ queryKey: ["teams", ws], queryFn: () => api<{ data: Team[] }>("/v1/teams", { workspaceId: ws }), enabled: !!ws, staleTime: 60_000 });
}
export function useCreateLabel(ws: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api<Label>("/v1/labels", { method: "POST", body: { name }, workspaceId: ws }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["labels", ws] }),
  });
}
