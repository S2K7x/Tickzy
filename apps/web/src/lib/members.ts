import { useQuery } from "@tanstack/react-query";
import { api, type Member } from "./api.ts";

/** Members of the current workspace (shared by Settings › Members and the inbox assignee picker). */
export function useMembers(workspaceId: string | null) {
  return useQuery({
    queryKey: ["members", workspaceId],
    queryFn: () => api<{ data: Member[] }>("/v1/members", { workspaceId }),
    enabled: !!workspaceId,
  });
}

/** Members who can be assigned issues: active admins and agents (server rule, T-204). */
export const assignable = (members: Member[]) => members.filter((m) => m.status === "active" && (m.role === "admin" || m.role === "agent"));
