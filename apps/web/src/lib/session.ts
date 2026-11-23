import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
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

// The chosen workspace is shared by every component (shell, pages) and persisted per browser.
const listeners = new Set<() => void>();
let memoryWorkspace: string | null = null;

function readStoredWorkspace(): string | null {
  try {
    return localStorage.getItem(WORKSPACE_KEY);
  } catch {
    return memoryWorkspace;
  }
}

/** Remember the workspace to open (after onboarding, accepting an invite or switching). */
export function rememberWorkspace(id: string): void {
  try {
    localStorage.setItem(WORKSPACE_KEY, id);
  } catch {
    memoryWorkspace = id; // storage blocked: keep it for this page load
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current workspace: the remembered one if the user still belongs to it, otherwise the first. */
export function useCurrentWorkspace(session: Session | null | undefined) {
  const stored = useSyncExternalStore(subscribe, readStoredWorkspace, () => null);
  const workspaces = session?.workspaces ?? [];
  const current = workspaces.find((w) => w.workspace_id === stored) ?? workspaces[0] ?? null;
  return { current, workspaces, select: rememberWorkspace };
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
