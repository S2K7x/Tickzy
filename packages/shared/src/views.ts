import type { StatusCategory } from "./lifecycle.ts";

/**
 * Inbox views (ux-spec S2, FR-3.7). System views are built in; saved views (T-211) store a system view as their base
 * plus filters, text search and sort — exactly the inbox URL state — so the web and the server (counts) share one
 * definition of what each view means.
 */
const OPEN: StatusCategory[] = ["triage", "waiting_on_us", "waiting_on_customer", "blocked"];
export const SYSTEM_VIEWS = [
  { id: "open", label: "All open", status: OPEN },
  { id: "on-us", label: "Waiting on us", status: ["triage", "waiting_on_us"] },
  { id: "on-customer", label: "Waiting on customer", status: ["waiting_on_customer"] },
  { id: "mine", label: "Mine", status: OPEN, assignee: "me" },
  { id: "unassigned", label: "Unassigned", status: OPEN, assignee: "none" },
  { id: "done", label: "Resolved", status: ["resolved", "closed"] },
] as const satisfies readonly { id: string; label: string; status: readonly StatusCategory[]; assignee?: "me" | "none" }[];
export type SystemViewId = (typeof SYSTEM_VIEWS)[number]["id"];
export const SYSTEM_VIEW_IDS = SYSTEM_VIEWS.map((v) => v.id) as [SystemViewId, ...SystemViewId[]];

export const VIEW_SORTS = ["updated", "newest", "oldest", "priority"] as const;
export type ViewSort = (typeof VIEW_SORTS)[number];

/** Filters a saved view keeps on top of its base view (comma-separated lists, as in the URL and the API). */
export interface ViewFilters {
  priority?: string | undefined; channel?: string | undefined; team?: string | undefined; label?: string | undefined; account?: string | undefined;
  q?: string | undefined;
}
export const VIEW_FILTER_KEYS = ["priority", "channel", "team", "label", "account", "q"] as const;

/** The issue-list query (GET /v1/issues parameters) a view stands for. */
export function viewListQuery(base: SystemViewId, filters: ViewFilters = {}): { status: StatusCategory[]; assignee?: "me" | "none" } & ViewFilters {
  const v = SYSTEM_VIEWS.find((x) => x.id === base) ?? SYSTEM_VIEWS[0];
  return { status: [...v.status], ...("assignee" in v ? { assignee: v.assignee } : {}), ...Object.fromEntries(VIEW_FILTER_KEYS.filter((k) => filters[k]).map((k) => [k, filters[k]])) };
}
