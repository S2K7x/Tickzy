/** Thin client for the Tickzy REST API (docs/blueprint/api-spec.md). Same-origin via the dev proxy / reverse proxy. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: { path: string; issue: string }[];
  constructor(status: number, code: string, message: string, details: { path: string; issue: string }[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  workspaceId?: string | null;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.workspaceId) headers["tickzy-workspace"] = opts.workspaceId;
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      headers,
      credentials: "include",
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, "network_error", "Can't reach Tickzy. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? "internal", e?.message ?? `Request failed (${res.status})`, e?.details ?? []);
  }
  return data as T;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}
export interface WorkspaceMembership {
  workspace_id: string;
  name: string;
  slug: string;
  role: string;
}
export interface Session {
  user: SessionUser;
  workspaces: WorkspaceMembership[];
}
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  issue_prefix: string;
  region: string;
  created_at: string;
}
