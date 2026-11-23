import { render } from "@testing-library/react";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import { createAppRouter, testHistory } from "./router.tsx";
import type { Session } from "./lib/api.ts";

export const SIGNED_IN: Session = {
  user: { id: "usr_01JD0000000000000000000000", email: "maya@acme.test", name: "Maya Chen" },
  workspaces: [{ workspace_id: "ws_01JD0000000000000000000000", name: "Acme Cloud", slug: "acme", role: "admin" }],
};

type Handler = (url: string, init: RequestInit) => { status: number; body?: unknown };

/** Installs a fetch mock routing "METHOD /path" → handler; records calls. */
export function mockApi(routes: Record<string, Handler | { status: number; body?: unknown }>) {
  const calls: { method: string; url: string; body: unknown; headers: Record<string, string> }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: (init.headers ?? {}) as Record<string, string> });
    const route = routes[`${method} ${url}`];
    const r = typeof route === "function" ? route(url, init) : route ?? { status: 404, body: { error: { code: "not_found", message: "not mocked", request_id: "req_x" } } };
    return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), { status: r.status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

export async function renderAt(path: string) {
  const router = createAppRouter(testHistory(path));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient, ...utils };
}
