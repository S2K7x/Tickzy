import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { PRIORITIES, canTransition } from "@tickzy/shared/lifecycle";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.ts";
import { useCurrentWorkspace, useSession } from "../lib/session.ts";
import { useMembers } from "../lib/members.ts";
import {
  formatDuration, PRIORITY_LABEL, relativeTime, useIssueList, useIssueStats, viewCount, VIEWS, type Issue, type IssueStats, type ViewId,
} from "../lib/issues.ts";
import { Avatar, ChannelBadge, PriorityDot, StatusChip } from "../components/issue-ui.tsx";
import { MiniChart } from "../components/MiniChart.tsx";
import { CheckCircleIcon, ClockIcon, FileIcon, FilterIcon, HourglassIcon, SearchIcon, ZapIcon } from "../components/icons.tsx";
import { btn, card, segmented } from "../components/ui.ts";
import { useShell } from "../components/AppShell.tsx";

/** Setup checklist for a workspace with no issues yet (ux-spec S1 empty state / S11). */
const STEPS: { title: string; detail: string; milestone: string; to?: "/settings/members" }[] = [
  { title: "Connect Slack", detail: "Pick your customer channels and a triage channel.", milestone: "M3" },
  { title: "Connect email", detail: "Forward your support address to Tickzy.", milestone: "M3" },
  { title: "Invite your team", detail: "Agents are paid seats; collaborators are free.", milestone: "M1", to: "/settings/members" },
  { title: "Set business hours and SLAs", detail: "Start from a template and preview it on recent issues.", milestone: "M4" },
];

function SetupChecklist() {
  return (
    <section aria-labelledby="setup-title" className={`${card} p-5`}>
      <h2 id="setup-title" className="m-0 text-[18px] font-medium">Set up your workspace</h2>
      <p className="m-0 mt-0.5 text-[13px] text-muted">Numbers appear above as soon as issues start flowing.</p>
      <ol className="m-0 mt-4 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 xl:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-xl border border-line p-4">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-[13px] font-semibold">{i + 1}</span>
            <div className="flex flex-col gap-1">
              <h3 className="m-0 text-[14px] font-semibold">{s.title}</h3>
              <p className="m-0 text-[13px] text-muted">{s.detail}</p>
              {s.to ? <Link to={s.to} className="text-[13px] font-semibold text-fg underline-offset-2 hover:underline">Invite people →</Link>
                : <span className="text-[12px] text-muted">Available in {s.milestone}</span>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Overview (ux-spec S1, design v2): KPI strip from real stats + "All issues" table. No placeholder numbers. */
export function Overview() {
  const session = useSession();
  const { current } = useCurrentWorkspace(session.data);
  const ws = current?.workspace_id ?? null;
  const stats = useIssueStats(ws);
  const { openNewIssue } = useShell();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-[32px] font-medium leading-tight tracking-tight">Overview</h1>
          <p className="m-0 mt-1 text-[14px] text-muted">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
        </div>
        <div className="flex gap-2">
          <Link to="/inbox" className={`${btn.secondary} ${btn.lg} no-underline`}>Open inbox</Link>
          <button type="button" onClick={openNewIssue} className={`${btn.primary} ${btn.lg}`}>+ New issue</button>
        </div>
      </div>
      <KpiStrip stats={stats.data} loading={stats.isPending} />
      {stats.data && stats.data.counts.open + stats.data.counts.done === 0 && <SetupChecklist />}
      <IssuesTable ws={ws} stats={stats.data} />
    </div>
  );
}

function Kpi({ icon, label, value, caption, chart }: { icon: ReactNode; label: string; value: ReactNode; caption: ReactNode; chart: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
      <span className="flex items-center gap-2 text-[13px] text-muted sm:text-[14px]">{icon}{label}</span>
      <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[28px] font-medium leading-none tracking-tight tabular-nums sm:text-[34px]">{value}</span>
        <span className="text-[12px] text-muted sm:text-[13px]">{caption}</span>
      </span>
      {chart}
    </div>
  );
}

function Delta({ now, before, goodWhenUp = true, suffix }: { now: number; before: number; goodWhenUp?: boolean; suffix: string }) {
  if (now === before) return <span>No change {suffix}</span>;
  const up = now > before;
  const good = up === goodWhenUp;
  const pct = before === 0 ? null : Math.round((Math.abs(now - before) / before) * 100);
  return (
    <span>
      <span className={`font-semibold ${good ? "text-success" : "text-danger"}`}>{up ? "↑" : "↓"} {pct === null ? Math.abs(now - before) : `${pct}%`}</span> {suffix}
    </span>
  );
}

function KpiStrip({ stats, loading }: { stats: IssueStats | undefined; loading: boolean }) {
  if (loading || !stats) {
    return <section aria-label="Key numbers" className={`${card} h-[154px] animate-pulse`}><span className="sr-only">Loading key numbers…</span></section>;
  }
  const k = stats.kpis;
  const s = (key: keyof IssueStats["series"][number]) => stats.series.map((d) => Number(d[key]));
  return (
    <section aria-label="Key numbers" className={`${card} grid grid-cols-2 lg:grid-cols-5 lg:divide-x lg:divide-line max-lg:[&>*]:border-b max-lg:[&>*]:border-line max-lg:[&>*:nth-child(odd)]:border-r max-lg:[&>*:last-child]:col-span-2 max-lg:[&>*:last-child]:border-b-0 max-lg:[&>*:last-child]:border-r-0`}>
      <Kpi icon={<FileIcon size={16} />} label="New issues" value={k.new_today}
        caption={<Delta now={k.new_today} before={k.new_yesterday} goodWhenUp={false} suffix="vs yesterday" />}
        chart={<MiniChart values={s("created")} color="var(--chart-1)" label="New issues per day" />} />
      <Kpi icon={<HourglassIcon size={16} />} label="Waiting on us" value={k.waiting_on_us}
        caption={<span><span className="font-semibold text-chart-2">{formatDuration(k.avg_wait_seconds)}</span> avg. wait</span>}
        chart={<MiniChart values={s("customer_messages")} color="var(--chart-2)" variant="bars" label="Customer messages per day" />} />
      <Kpi icon={<ClockIcon size={16} />} label="Waiting on customer" value={k.waiting_on_customer}
        caption="awaiting a reply"
        chart={<MiniChart values={s("team_replies")} color="var(--chart-3)" label="Team replies per day" />} />
      <Kpi icon={<CheckCircleIcon size={16} />} label="Resolved this week" value={k.resolved_7d}
        caption={<Delta now={k.resolved_7d} before={k.resolved_prev_7d} suffix="vs last week" />}
        chart={<MiniChart values={s("resolved")} color="var(--chart-4)" variant="bars" label="Issues resolved per day" />} />
      <Kpi icon={<ZapIcon size={16} />} label="First response" value={formatDuration(k.median_first_response_seconds_7d)}
        caption="median, 7 days"
        chart={<MiniChart values={s("first_responses")} color="var(--chart-5)" label="First responses per day" />} />
    </section>
  );
}

const TABLE_VIEWS: ViewId[] = ["open", "on-us", "on-customer", "unassigned", "done"];

/** Who raised the issue: the requester, or where it was created when there is none (never invented). */
function requesterOf(i: Issue): { name: string; avatar: string | null } {
  if (i.requester?.name) return { name: i.requester.name, avatar: i.requester.name };
  if (i.channel === "ui") return { name: "Created in Tickzy", avatar: null };
  if (i.channel === "api") return { name: "Created via API", avatar: null };
  return { name: "Unknown sender", avatar: null };
}
function RequesterAvatar({ issue }: { issue: Issue }) {
  const r = requesterOf(issue);
  return r.avatar ? <Avatar name={r.avatar} size={34} /> : <span aria-hidden="true" className="inline-flex h-[34px] w-[34px] shrink-0 rounded-full border border-dashed border-line bg-surface-2" />;
}

function IssuesTable({ ws, stats }: { ws: string | null; stats: IssueStats | undefined }) {
  const [view, setView] = useState<ViewId>("open");
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState("");
  const [page, setPage] = useState(0);
  const list = useIssueList(ws, view, "newest", { q: q.trim() || undefined, priority: priority || undefined });
  const pages = list.data?.pages ?? [];
  const rows = pages[page]?.data ?? [];
  const session = useSession();
  const members = useMembers(ws);
  const me = members.data?.data.find((m) => m.user_id === session.data?.user.id);
  const canWork = me ? me.role === "admin" || me.role === "agent" : false;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const reset = () => setPage(0);

  async function act(issue: Issue, body: Record<string, unknown>) {
    setError(null);
    try {
      await api(`/v1/issues/${issue.key}`, { method: "PATCH", body, workspaceId: ws });
      await qc.invalidateQueries({ queryKey: ["issues", ws] });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function next() {
    if (page + 1 < pages.length) setPage(page + 1);
    else if (list.hasNextPage) { await list.fetchNextPage(); setPage(page + 1); }
  }
  const total = viewCount(stats, view);
  const first = page * 50 + (rows.length ? 1 : 0);
  const open = (i: Issue) => void navigate({ to: "/inbox", search: { issue: i.key } as never });

  return (
    <section aria-labelledby="all-issues" className={`${card} overflow-hidden`}>
      <div className="flex flex-col gap-3 p-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h2 id="all-issues" className="m-0 text-[18px] font-medium">All issues</h2>
          <p className="m-0 mt-0.5 text-[13px] text-muted">{stats ? `${stats.counts.open} open · ${stats.kpis.new_today} new today` : " "}</p>
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <nav aria-label="Issue status" className={segmented.bar}>
            {TABLE_VIEWS.map((v) => {
              const n = viewCount(stats, v);
              return (
                <button key={v} type="button" aria-pressed={v === view} onClick={() => { setView(v); reset(); }}
                  className={`${segmented.item} ${v === view ? segmented.active : ""}`}>
                  {VIEWS.find((x) => x.id === v)!.label}{n !== null && <span className={segmented.count}>{n}</span>}
                </button>
              );
            })}
          </nav>
          <div className="flex gap-2">
            <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-muted md:w-56">
              <SearchIcon size={15} />
              <span className="sr-only">Search issues</span>
              <input type="search" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} placeholder="Search issues" className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-fg outline-none placeholder:text-muted" />
            </label>
            <label className={`${btn.secondary} ${btn.md} relative px-3`}>
              <FilterIcon size={15} />
              <span className="sr-only">Filter by priority</span>
              <select value={priority} onChange={(e) => { setPriority(e.target.value); reset(); }} className="appearance-none bg-transparent pr-1 text-[13px] font-semibold text-fg outline-none">
                <option value="">Filter</option>
                {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
              </select>
            </label>
          </div>
        </div>
      </div>
      {error && <p role="alert" className="m-0 px-5 pb-3 text-[13px] text-danger">{error}</p>}

      {/* ≥768px: table */}
      <div className="relative hidden overflow-x-auto md:block">
        {/* Fixed layout: columns share the width and truncate, so the actions never fall off the card.
            Channel and Received get their own columns on very wide screens, otherwise they sit under the title. */}
        <table className="w-full table-fixed border-collapse text-left text-[14px]">
          <colgroup>
            <col className="w-[20%] 2xl:w-[18%]" />
            <col className="w-[28%] 2xl:w-[24%]" />
            <col className="hidden w-[8%] 2xl:table-column" />
            <col className="hidden w-[9%] 2xl:table-column" />
            <col className="w-[14%] 2xl:w-[12%]" />
            <col className="w-[15%] 2xl:w-[11%]" />
            <col className="w-[23%] 2xl:w-[18%]" />
          </colgroup>
          <thead className="bg-surface-2 text-[12px] text-muted">
            <tr>{["Requester", "Issue", "Channel", "Received", "Assigned to", "Status", "Action"].map((h, i) => (
              <th key={h} scope="col" className={`whitespace-nowrap border-y border-line px-4 py-2.5 font-medium first:pl-5 last:pr-5 ${i === 6 ? "text-right" : ""} ${i === 2 || i === 3 ? "hidden 2xl:table-cell" : ""}`}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} className="border-b border-line last:border-b-0 hover:bg-surface-2/60">
                <td className="py-3 pl-5 pr-4">
                  <span className="flex items-center gap-3">
                    <RequesterAvatar issue={i} />
                    <span className="flex min-w-0 flex-col whitespace-nowrap leading-tight">
                      <span className={`truncate font-medium ${i.requester ? "" : "text-muted"}`} title={requesterOf(i).name}>{requesterOf(i).name}</span>
                      <span className="truncate text-[12px] text-muted">{i.account?.name ?? "No account"}</span>
                    </span>
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link to="/inbox" search={{ issue: i.key } as never} className="flex min-w-0 flex-col leading-tight text-fg no-underline hover:underline">
                    <span className="truncate font-medium">{i.title}</span>
                    <span className="flex items-center gap-1.5 truncate whitespace-nowrap text-[12px] text-muted">
                      <PriorityDot priority={i.priority} />{i.key} · {PRIORITY_LABEL[i.priority]}
                      <span className="2xl:hidden">· {relativeTime(i.created_at)}</span>
                    </span>
                  </Link>
                </td>
                <td className="hidden px-4 py-3 2xl:table-cell"><ChannelBadge channel={i.channel} /></td>
                <td className="hidden whitespace-nowrap px-4 py-3 text-muted 2xl:table-cell">{relativeTime(i.created_at)}</td>
                <td className="truncate whitespace-nowrap px-4 py-3" title={i.assignee?.email}>{i.assignee ? (i.assignee.name || i.assignee.email) : <span className="text-muted">Unassigned</span>}</td>
                <td className="whitespace-nowrap px-4 py-3"><StatusChip status={i.status} /></td>
                <td className="py-3 pl-4 pr-5"><RowActions issue={i} canWork={canWork} me={me?.id} onAct={act} onOpen={open} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* <768px: cards */}
      <ul className="m-0 flex list-none flex-col p-0 md:hidden">
        {rows.map((i) => (
          <li key={i.id} className="flex flex-col gap-2 border-t border-line px-4 py-3">
            <Link to="/inbox" search={{ issue: i.key } as never} className="flex items-start gap-3 text-fg no-underline">
              <RequesterAvatar issue={i} />
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate font-medium">{i.title}</span>
                <span className="text-[12px] text-muted">{i.key} · {i.account?.name ?? "No account"} · {relativeTime(i.created_at)}</span>
              </span>
              <StatusChip status={i.status} />
            </Link>
            <RowActions issue={i} canWork={canWork} me={me?.id} onAct={act} onOpen={open} />
          </li>
        ))}
      </ul>

      {list.isPending && <p role="status" className="m-0 px-5 py-6 text-sm text-muted">Loading issues…</p>}
      {list.isSuccess && rows.length === 0 && (
        <p className="m-0 border-t border-line px-5 py-8 text-center text-sm text-muted">No issues here. Create one with “New issue” — channels (Slack, email) arrive in M3.</p>
      )}
      <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[13px] text-muted">
        <span>{rows.length ? `Showing ${first}–${first + rows.length - 1}${total !== null ? ` of ${total}` : ""}` : " "}</span>
        <span className="flex gap-2">
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className={`${btn.secondary} ${btn.md}`}>Previous</button>
          <button type="button" disabled={!(page + 1 < pages.length || list.hasNextPage)} onClick={() => void next()} className={`${btn.secondary} ${btn.md}`}>Next</button>
        </span>
      </div>
    </section>
  );
}

function RowActions({ issue: i, canWork, me, onAct, onOpen }: { issue: Issue; canWork: boolean; me: string | undefined; onAct: (i: Issue, body: Record<string, unknown>) => void; onOpen: (i: Issue) => void }) {
  const resolvable = canTransition(i.status.category, "resolved") && i.status.category !== "resolved";
  return (
    <span className="flex justify-end gap-2">
      {canWork && me && !i.assignee && resolvable && (
        <button type="button" onClick={() => onAct(i, { assignee_membership_id: me })} className={`${btn.secondary} ${btn.md} px-3`}>
          {/* One text run (no flex gap inside); " to me" is visually hidden below 1280px but always in the accessible name. */}
          <span>Assign<span className="max-xl:sr-only"> to me</span><span className="sr-only">, {i.key}</span></span>
        </button>
      )}
      {canWork && resolvable ? (
        <button type="button" onClick={() => onAct(i, { status: "resolved" })} className={`${btn.primary} ${btn.md}`}><span>Resolve<span className="sr-only">, {i.key}</span></span></button>
      ) : (
        <button type="button" onClick={() => onOpen(i)} className={`${btn.secondary} ${btn.md}`}><span>Open<span className="sr-only">, {i.key}</span></span></button>
      )}
    </span>
  );
}
