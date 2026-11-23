import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { api, ApiError, type Session } from "./api.ts";

export const SESSION_KEY = ["session"] as const;
const WORKSPACE_KEY = "tickzy.workspace";

/** The signed-in session, or null when signed out (401). Other errors surface to the caller. */
export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async (): Promise<Session | null> => {
      try {
        return await api<Session>("/v1/auth/session");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

function readStoredWorkspace(): string | null {
  try {
    return localStorage.getItem(WORKSPACE_KEY);
  } catch {
    return null;
  }
}

/** Current workspace: the remembered one if the user still belongs to it, otherwise the first. */
export function useCurrentWorkspace(session: Session | null | undefined) {
  const [stored, setStored] = useState<string | null>(readStoredWorkspace);
  const workspaces = session?.workspaces ?? [];
  const current = workspaces.find((w) => w.workspace_id === stored) ?? workspaces[0] ?? null;
  const select = useCallback((id: string) => {
    setStored(id);
    try {
      localStorage.setItem(WORKSPACE_KEY, id);
    } catch {
      /* not persisted */
    }
  }, []);
  return { current, workspaces, select };
}

export function useSignOut() {
  const qc = useQueryClient();
  return useCallback(async () => {
    try {
      await api("/v1/auth/sign-out", { method: "POST" });
    } finally {
      qc.setQueryData(SESSION_KEY, null);
    }
  }, [qc]);
}
