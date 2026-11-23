import { useMutation, useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import type { Priority, StatusCategory } from "@tickzy/shared/lifecycle";
import { api } from "./api.ts";
import { pollUnlessLive } from "./realtime.ts";

/** Issues API client (api-spec §1, T-204/T-205). */
export interface Issue {
  id: string; key: string; number: number; title: string;
  status: { category: StatusCategory; id: string; name: string };
  priority: Priority;
  assignee: { membership_id: string; user_id: string; name: string; email: string } | null;
  team_id: string | null;
  account: { id: string; name: string; tier: string | null } | null;
  requester: { id: string; name: string } | null;
  channel: "slack" | "email" | "widget" | "api" | "ui";
  product_area: string | null;
  labels: { id: string; name: string; color: string }[];
  fields: Record<string, unknown>;
  first_response_at: string | null; resolved_at: string | null;
  created_at: string; updated_at: string; version: number;
}
export interface TimelineMessage {
  kind: "message"; id: string; created_at: string;
  message: { id: string; visibility: "public" | "internal"; direction: "in" | "out"; author: { type: string; id: string | null; name: string | null }; body: { text: string }; source: string; delivery_state: string | null };
}
export interface TimelineEvent {
  kind: "event"; id: string; created_at: string;
  event: { type: string; actor: { type: string; id: string | null }; data: Record<string, unknown> };
}
export type TimelineItem = TimelineMessage | TimelineEvent;

/** Inbox views (ux-spec S2). Counts arrive with T-209b. */
export const VIEWS = [
  { id: "open", label: "All open", query: "status=triage,waiting_on_us,waiting_on_customer,blocked" },
  { id: "on-us", label: "Waiting on us", query: "status=triage,waiting_on_us" },
  { id: "on-customer", label: "Waiting on customer", query: "status=waiting_on_customer" },
  { id: "mine", label: "Mine", query: "assignee=me&status=triage,waiting_on_us,waiting_on_customer,blocked" },
  { id: "unassigned", label: "Unassigned", query: "assignee=none&status=triage,waiting_on_us,waiting_on_customer,blocked" },
  { id: "done", label: "Resolved", query: "status=resolved,closed" },
] as const;
export type ViewId = (typeof VIEWS)[number]["id"];
export const SORTS = [
  { id: "updated", label: "Recently updated" },
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "priority", label: "Priority" },
] as const;
export type SortId = (typeof SORTS)[number]["id"];

export const STATUS_LABEL: Record<StatusCategory, string> = {
  triage: "Triage", waiting_on_us: "Waiting on us", waiting_on_customer: "Waiting on customer", blocked: "Blocked",
  resolved: "Resolved", closed: "Closed", ignored: "Ignored",
};
export const PRIORITY_LABEL: Record<Priority, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };

const issuesKey = (ws: string | null) => ["issues", ws] as const;
const REFRESH_MS = 15_000; // polling fallback while the realtime socket is down (T-208)

export const CHANNEL_LABEL: Record<Issue["channel"], string> = { slack: "Slack", email: "Email", widget: "Chat", api: "API", ui: "Web" };
export const CHANNELS = Object.keys(CHANNEL_LABEL) as Issue["channel"][];

/** Filters on top of a view (T-209b). Lists are comma-separated, as in the URL and the API. */
export interface ListFilters {
  q?: string | undefined; priority?: string | undefined; channel?: string | undefined; team?: string | undefined; label?: string | undefined;
  account?: string | undefined;
}
const FILTER_KEYS = ["priority", "channel", "team", "label", "account"] as const;

/** Query string for a view plus filters and text search. */
export function listQuery(view: ViewId, sort: SortId, extra: ListFilters = {}): string {
  const q = VIEWS.find((v) => v.id === view)!.query;
  const filters = FILTER_KEYS.map((k) => (extra[k] ? `&${k}=${encodeURIComponent(extra[k])}` : "")).join("");
  return `${q}&sort=${sort}${filters}${extra.q ? `&q=${encodeURIComponent(extra.q)}` : ""}`;
}

export function useIssueList(ws: string | null, view: ViewId, sort: SortId, extra: ListFilters = {}) {
  const q = listQuery(view, sort, extra);
  return useInfiniteQuery({
    queryKey: [...issuesKey(ws), "list", q],
    queryFn: ({ pageParam }) => api<{ data: Issue[]; next_cursor: string | null }>(`/v1/issues?${q}&limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`, { workspaceId: ws }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: !!ws,
    refetchInterval: pollUnlessLive(REFRESH_MS),
  });
}

export interface IssueStats {
  counts: { open: number; waiting_on_us: number; waiting_on_customer: number; mine: number | null; unassigned: number; done: number };
  kpis: {
    new_today: number; new_yesterday: number; waiting_on_us: number; avg_wait_seconds: number | null; waiting_on_customer: number;
    resolved_7d: number; resolved_prev_7d: number; median_first_response_seconds_7d: number | null;
  };
  series: { day: string; created: number; resolved: number; first_responses: number; customer_messages: number; team_replies: number }[];
}
/** Real counts and 14-day series (GET /v1/issues/stats). */
export function useIssueStats(ws: string | null) {
  return useQuery({
    queryKey: [...issuesKey(ws), "stats"],
    queryFn: () => api<IssueStats>("/v1/issues/stats", { workspaceId: ws }),
    enabled: !!ws,
    refetchInterval: pollUnlessLive(30_000),
  });
}
/** Count shown on a view tab, from stats. */
export function viewCount(stats: IssueStats | undefined, view: ViewId): number | null {
  if (!stats) return null;
  const c = stats.counts;
  return ({ open: c.open, "on-us": c.waiting_on_us, "on-customer": c.waiting_on_customer, mine: c.mine, unassigned: c.unassigned, done: c.done } as Record<ViewId, number | null>)[view];
}

/** "42s", "5 min", "3.2 h", "1.8 days" — durations in KPI captions. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86400).toFixed(1)} days`;
}

export function useIssue(ws: string | null, ref: string | null) {
  return useQuery({
    queryKey: [...issuesKey(ws), "one", ref],
    queryFn: () => api<Issue>(`/v1/issues/${encodeURIComponent(ref!)}`, { workspaceId: ws }),
    enabled: !!ws && !!ref,
    refetchInterval: pollUnlessLive(REFRESH_MS),
  });
}

export function useTimeline(ws: string | null, ref: string | null) {
  return useQuery({
    queryKey: [...issuesKey(ws), "timeline", ref],
    queryFn: () => api<{ data: TimelineItem[]; truncated: boolean }>(`/v1/issues/${encodeURIComponent(ref!)}/timeline`, { workspaceId: ws }),
    enabled: !!ws && !!ref,
    refetchInterval: pollUnlessLive(REFRESH_MS),
  });
}

export interface IssuePatch {
  status?: StatusCategory; priority?: Priority; assignee_membership_id?: string | null; title?: string; team_id?: string | null; labels?: string[];
}

/**
 * Property changes (ux-spec §2.5): optimistic — the issue updates instantly and rolls back if the API refuses.
 */
export function useUpdateIssue(ws: string | null, ref: string) {
  const qc = useQueryClient();
  const key = [...issuesKey(ws), "one", ref];
  return useMutation({
    mutationFn: (patch: IssuePatch) => api<Issue>(`/v1/issues/${encodeURIComponent(ref)}`, { method: "PATCH", body: patch, workspaceId: ws }),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Issue>(key);
      if (previous) {
        qc.setQueryData<Issue>(key, {
          ...previous,
          ...(patch.priority ? { priority: patch.priority } : {}),
          ...(patch.title ? { title: patch.title } : {}),
          ...(patch.status ? { status: { ...previous.status, category: patch.status, name: STATUS_LABEL[patch.status] } } : {}),
          ...(patch.team_id !== undefined ? { team_id: patch.team_id } : {}),
          ...(patch.labels ? { labels: previous.labels.filter((l) => patch.labels!.includes(l.id)) } : {}),
        });
      }
      return { previous };
    },
    onError: (_e, _p, ctx) => { if (ctx?.previous) qc.setQueryData(key, ctx.previous); },
    onSettled: () => qc.invalidateQueries({ queryKey: issuesKey(ws) }),
  });
}

/** One change applied to many issues (POST /v1/issues/bulk, FR-3.10). Each issue succeeds or fails on its own. */
export interface BulkChanges {
  status?: StatusCategory; priority?: Priority; assignee_membership_id?: string | null; team_id?: string | null; add_labels?: string[]; remove_labels?: string[];
}
export type BulkResult = { ref: string; ok: true; issue: Issue } | { ref: string; ok: false; error: { code: string; message: string } };
export function useBulkUpdate(ws: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { issues: string[]; changes: BulkChanges }) => api<{ results: BulkResult[] }>("/v1/issues/bulk", { method: "POST", body: v, workspaceId: ws }),
    onSettled: () => qc.invalidateQueries({ queryKey: issuesKey(ws) }),
  });
}

export function usePostMessage(ws: string | null, ref: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (m: { body: string; visibility: "public" | "internal" }) => api(`/v1/issues/${encodeURIComponent(ref)}/messages`, { method: "POST", body: m, workspaceId: ws }),
    onSuccess: () => qc.invalidateQueries({ queryKey: issuesKey(ws) }),
  });
}

export function useCreateIssue(ws: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; priority: Priority }) => api<Issue>("/v1/issues", { method: "POST", body: input, workspaceId: ws }),
    onSuccess: () => qc.invalidateQueries({ queryKey: issuesKey(ws) }),
  });
}

/** Short relative time for lists ("now", "5m", "3h", "2d", then a date). */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const s = Math.max(0, (now.getTime() - Date.parse(iso)) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Human sentence for a timeline event — every automatic change says why (ux-spec §2.5). */
const REASONS: Record<string, string> = {
  team_replied: "the team replied", customer_replied: "the customer replied", reopened_by_customer: "the customer wrote again", manual: "",
};
export function describeEvent(e: TimelineEvent["event"], names: { member: (membershipId: string) => string | null }): string {
  const d = e.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (e.type) {
    case "issue.created": return "Issue created";
    case "issue.status_changed": {
      const to = STATUS_LABEL[d.to?.category as StatusCategory] ?? d.to?.category;
      const why = REASONS[d.reason] ?? d.reason;
      return why ? `Status → ${to} · automatically, because ${why}` : `Status → ${to}`;
    }
    case "issue.assigned": return d.to ? `Assigned to ${names.member(d.to) ?? "a teammate"}` : "Unassigned";
    case "issue.updated": {
      const parts = Object.entries(d.changes ?? {}).map(([k, v]) => {
        const c = v as { to: unknown };
        if (k === "priority") return `priority → ${PRIORITY_LABEL[c.to as Priority] ?? c.to}`;
        if (k === "title") return "title changed";
        return `${k.replace(/_/g, " ")} changed`;
      });
      return parts.length ? `Updated ${parts.join(", ")}` : "Updated";
    }
    case "issue.labels_changed": return "Labels changed";
    case "issue.followup_of": return `Follow-up to ${d.key}`;
    case "issue.followup_opened": return `Customer wrote again — follow-up ${d.key} opened`;
    default: return e.type;
  }
}
