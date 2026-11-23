import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { PRIORITIES, STATUS_CATEGORIES, canTransition, type Priority, type StatusCategory } from "@tickzy/shared/lifecycle";
import { useCurrentWorkspace, useSession } from "../lib/session.ts";
import { assignable, useMembers } from "../lib/members.ts";
import {
  describeEvent, PRIORITY_LABEL, relativeTime, SORTS, STATUS_LABEL, useIssue, useIssueList, usePostMessage, useTimeline, useUpdateIssue, VIEWS,
  type Issue, type SortId, type TimelineItem, type ViewId,
} from "../lib/issues.ts";
import { ChannelBadge, PriorityDot, StatusChip } from "../components/issue-ui.tsx";

export interface InboxSearch { view?: ViewId; sort?: SortId; issue?: string }

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** Inbox (ux-spec S2, T-209a): queue · conversation · details. URL holds view, sort and the open issue. */
export function Inbox({ defaultView = "open" }: { defaultView?: ViewId }) {
  const search = useSearch({ strict: false }) as InboxSearch;
  const navigate = useNavigate();
  const session = useSession();
  const { current } = useCurrentWorkspace(session.data);
  const ws = current?.workspace_id ?? null;
  const view = search.view ?? defaultView;
  const sort = search.sort ?? "updated";
  const selected = search.issue ?? null;
  const list = useIssueList(ws, view, sort);
  const issues = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const composerRef = useRef<ComposerHandle>(null);

  const go = (patch: Partial<InboxSearch>) => void navigate({ to: "/inbox", search: { view, sort, ...(selected ? { issue: selected } : {}), ...patch } as never });
  const open = (key: string | undefined) => go({ issue: key });

  // Keyboard (ux-spec §2.5): j/k move, r reply, n note, e resolve, Esc back.
  const resolveRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const idx = issues.findIndex((i) => i.key === selected);
      if (e.key === "j" || e.key === "k") {
        const next = issues[Math.min(issues.length - 1, Math.max(0, idx + (e.key === "j" ? 1 : -1)))] ?? issues[0];
        if (next) { e.preventDefault(); open(next.key); }
      } else if (selected && (e.key === "r" || e.key === "n")) {
        e.preventDefault();
        composerRef.current?.focus(e.key === "r" ? "public" : "internal");
      } else if (selected && e.key === "e") {
        e.preventDefault();
        resolveRef.current();
      } else if (e.key === "Escape" && selected) {
        open(undefined);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex flex-col gap-3 md:h-[calc(100dvh-64px)] md:flex-row md:gap-0">
      {/* One page heading in every layout (on phones the queue, and its title, is hidden while an issue is open). */}
      <h1 className="sr-only">Inbox</h1>
      <section aria-label="Issue queue" className={`${selected ? "hidden md:flex" : "flex"} min-h-0 flex-col border-line md:w-[340px] md:shrink-0 md:border-r xl:w-[380px]`}>
        <div className="flex flex-col gap-2 border-b border-line px-4 pb-3 pt-4">
          <div className="flex items-center justify-between gap-2">
            <span aria-hidden="true" className="text-xl font-semibold tracking-tight">Inbox</span>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <span>Sort</span>
              <select aria-label="Sort issues" value={sort} onChange={(e) => go({ sort: e.target.value as SortId })} className="h-8 rounded-lg border border-line bg-surface-2 px-2 text-xs text-fg">
                {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
          </div>
          <nav aria-label="Inbox views" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
            {VIEWS.map((v) => (
              <Link key={v.id} to="/inbox" search={{ view: v.id, sort } as never}
                aria-current={v.id === view ? "page" : undefined}
                className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] font-medium no-underline ${v.id === view ? "bg-accent-soft text-accent-fg" : "text-muted hover:bg-surface-2"}`}>
                {v.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.isPending && <p role="status" className="m-0 p-4 text-sm text-muted">Loading issues…</p>}
          {list.isError && <p role="alert" className="m-0 p-4 text-sm text-danger">{(list.error as Error).message}</p>}
          {list.isSuccess && issues.length === 0 && (
            <div className="p-6 text-center">
              <p className="m-0 text-sm font-semibold">Nothing here</p>
              <p className="m-0 mt-1 text-[13px] text-muted">No issues in “{VIEWS.find((v) => v.id === view)!.label}”. Channels (Slack, email) arrive in M3; until then create issues with “New issue” or the API.</p>
            </div>
          )}
          <ul className="m-0 list-none p-0">
            {issues.map((i) => <QueueRow key={i.id} issue={i} active={i.key === selected} />)}
          </ul>
          {list.hasNextPage && (
            <div className="p-3">
              <button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className="h-9 w-full rounded-lg border border-line bg-surface text-[13px] font-semibold text-fg disabled:opacity-60">
                {list.isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
        <p className="m-0 hidden border-t border-line px-4 py-2 text-[11px] text-muted md:block"><kbd>j</kbd>/<kbd>k</kbd> move · <kbd>r</kbd> reply · <kbd>n</kbd> note · <kbd>e</kbd> resolve · <kbd>Esc</kbd> close</p>
      </section>

      {selected ? (
        <IssueView key={selected} ws={ws} issueRef={selected} onBack={() => open(undefined)} composerRef={composerRef} resolveRef={resolveRef} />
      ) : (
        <div className="hidden flex-1 items-center justify-center p-8 text-center md:flex">
          <div>
            <p className="m-0 text-sm font-semibold">Select an issue</p>
            <p className="m-0 mt-1 text-[13px] text-muted">Press <kbd>j</kbd> to open the first one.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function QueueRow({ issue: i, active }: { issue: Issue; active: boolean }) {
  return (
    <li>
      <Link to="/inbox" search={((prev: InboxSearch) => ({ ...prev, issue: i.key })) as never}
        aria-current={active ? "true" : undefined}
        className={`flex flex-col gap-1 border-b border-line px-4 py-3 text-fg no-underline ${active ? "bg-accent-soft/60 shadow-[inset_3px_0_0_var(--accent)]" : "hover:bg-surface-2"}`}>
        <span className="flex items-center gap-2 text-[12px] text-muted">
          <PriorityDot priority={i.priority} />
          <span className="font-semibold text-fg">{i.account?.name ?? "No account"}</span>
          <span>{i.key}</span>
          <span className="ml-auto">{relativeTime(i.updated_at)}</span>
        </span>
        <span className="line-clamp-2 text-sm font-medium">{i.title}</span>
        <span className="flex items-center gap-1.5">
          <StatusChip status={i.status} />
          <ChannelBadge channel={i.channel} />
          {i.assignee && <span className="min-w-0 truncate text-[11px] text-muted">→ {i.assignee.name || i.assignee.email}</span>}
        </span>
      </Link>
    </li>
  );
}

export interface ComposerHandle { focus(mode: "public" | "internal"): void }

function IssueView({ ws, issueRef, onBack, composerRef, resolveRef }: {
  ws: string | null; issueRef: string; onBack: () => void;
  composerRef: React.RefObject<ComposerHandle | null>; resolveRef: React.RefObject<() => void>;
}) {
  const issue = useIssue(ws, issueRef);
  const timeline = useTimeline(ws, issueRef);
  const members = useMembers(ws);
  const update = useUpdateIssue(ws, issueRef);
  const memberName = (id: string) => {
    const m = members.data?.data.find((x) => x.id === id);
    return m ? m.name || m.email : null;
  };
  const i = issue.data;
  resolveRef.current = () => { if (i && canTransition(i.status.category, "resolved")) update.mutate({ status: "resolved" }); };

  if (issue.isError) {
    return (
      <section className="flex flex-1 flex-col gap-2 p-6">
        <button type="button" onClick={onBack} className="self-start text-sm font-semibold text-accent-fg md:hidden">← Back</button>
        <p role="alert" className="m-0 text-sm text-danger">{(issue.error as Error).message}</p>
      </section>
    );
  }
  if (!i) return <section className="flex-1 p-6"><p role="status" className="m-0 text-sm text-muted">Loading issue…</p></section>;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col xl:flex-row">
      <section aria-label="Conversation" className="flex min-h-[calc(100dvh-64px-96px)] min-w-0 flex-1 flex-col md:min-h-0">
        <header className="flex flex-col gap-1 border-b border-line px-4 py-3 md:px-6">
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <button type="button" onClick={onBack} className="mr-1 text-sm font-semibold text-accent-fg md:hidden" aria-label="Back to the queue">←</button>
            <span className="font-semibold">{i.key}</span><span>·</span><ChannelBadge channel={i.channel} />
            <span className="ml-auto flex gap-2">
              {canTransition(i.status.category, "resolved") && (
                <button type="button" onClick={() => update.mutate({ status: "resolved" })} title="Resolve (e)" className="h-8 rounded-lg bg-accent px-3 text-[12px] font-semibold text-white">Resolve</button>
              )}
            </span>
          </div>
          <h2 className="m-0 text-lg font-semibold leading-snug">{i.title}</h2>
        </header>
        <div className="xl:hidden"><Details issue={i} ws={ws} update={update} memberName={memberName} collapsible /></div>
        <ol aria-label="Timeline" className="m-0 flex min-h-0 flex-1 list-none flex-col gap-3 overflow-y-auto px-4 py-4 md:px-6">
          {timeline.isPending && <li role="status" className="text-sm text-muted">Loading conversation…</li>}
          {timeline.data?.data.map((item) => <TimelineRow key={`${item.kind}-${item.id}`} item={item} memberName={memberName} />)}
          {timeline.data?.truncated && <li className="text-xs text-muted">Older activity is not shown.</li>}
        </ol>
        <Composer ref={composerRef} ws={ws} issue={i} />
      </section>
      <aside aria-label="Issue details" className="hidden w-[300px] shrink-0 overflow-y-auto border-l border-line xl:block">
        <Details issue={i} ws={ws} update={update} memberName={memberName} />
      </aside>
    </div>
  );
}

function TimelineRow({ item, memberName }: { item: TimelineItem; memberName: (id: string) => string | null }) {
  if (item.kind === "event") {
    return (
      <li className="flex items-center gap-2 text-[12px] text-muted">
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
        <span>{describeEvent(item.event, { member: memberName })} · {relativeTime(item.created_at)}</span>
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
      </li>
    );
  }
  const m = item.message;
  const internal = m.visibility === "internal";
  const customer = m.direction === "in";
  return (
    <li className={`flex flex-col gap-1 ${customer ? "items-start" : "items-end"}`}>
      <span className="text-[12px] text-muted">
        <span className="font-semibold text-fg">{m.author.name ?? (customer ? "Customer" : "Team")}</span>
        {internal && <span className="ml-1.5 rounded bg-warn-soft px-1.5 py-px text-[11px] font-semibold text-warn">Internal note</span>}
        <span className="ml-1.5">{relativeTime(item.created_at)}</span>
        {m.delivery_state === "failed" && <span className="ml-1.5 font-semibold text-danger">Not delivered</span>}
      </span>
      <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${internal ? "border border-dashed border-warn bg-warn-soft text-fg" : customer ? "bg-surface-2 text-fg" : "bg-accent text-white"}`}>
        {m.body.text}
      </div>
    </li>
  );
}

function Details({ issue: i, ws, update, memberName, collapsible }: {
  issue: Issue; ws: string | null; update: ReturnType<typeof useUpdateIssue>; memberName: (id: string) => string | null; collapsible?: boolean;
}) {
  const members = useMembers(ws);
  const closed = i.status.category === "closed";
  const select = "h-9 w-full rounded-lg border border-line bg-surface-2 px-2 text-[13px] text-fg disabled:opacity-60";
  const body = (
    <div className="flex flex-col gap-4 p-4">
      {update.isError && <p role="alert" className="m-0 text-[13px] text-danger">Couldn't save: {(update.error as Error).message}</p>}
      <div className="flex flex-col gap-1 rounded-xl border border-line p-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Account</span>
        {i.account ? (
          <span className="text-sm font-semibold">{i.account.name}{i.account.tier && <span className="ml-1.5 text-xs font-normal text-muted">{i.account.tier}</span>}</span>
        ) : <span className="text-sm text-muted">No account</span>}
        {i.requester && <span className="text-[13px] text-muted">Requester: {i.requester.name || "Unnamed contact"}</span>}
      </div>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted">
          Status
          <select className={select} value={i.status.category} disabled={closed}
            onChange={(e) => update.mutate({ status: e.target.value as StatusCategory })}>
            {STATUS_CATEGORIES.filter((c) => c === i.status.category || canTransition(i.status.category, c)).map((c) => <option key={c} value={c}>{STATUS_LABEL[c]}</option>)}
          </select>
          {closed && <span className="font-normal">Closed issues can't be reopened; a customer follow-up opens a new issue.</span>}
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted">
          Priority
          <select className={select} value={i.priority} onChange={(e) => update.mutate({ priority: e.target.value as Priority })}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted">
          Assignee
          <select className={select} value={i.assignee?.membership_id ?? ""} onChange={(e) => update.mutate({ assignee_membership_id: e.target.value || null })}>
            <option value="">Unassigned</option>
            {assignable(members.data?.data ?? []).map((m) => <option key={m.id} value={m.id}>{memberName(m.id)}</option>)}
          </select>
        </label>
        {i.labels.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-muted">Labels</span>
            <span className="flex flex-wrap gap-1">{i.labels.map((l) => <span key={l.id} className="rounded-full border border-line px-2 py-0.5 text-[11px]"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: l.color }} />{l.name}</span>)}</span>
          </div>
        )}
      </div>
    </div>
  );
  if (!collapsible) return body;
  return (
    <details className="border-b border-line">
      <summary className="cursor-pointer px-4 py-2 text-[13px] font-semibold text-muted md:px-6">Details · {i.status.name} · {PRIORITY_LABEL[i.priority]}{i.assignee ? ` · ${i.assignee.name || i.assignee.email}` : ""}</summary>
      {body}
    </details>
  );
}

const Composer = ({ ref, ws, issue }: { ref: React.Ref<ComposerHandle>; ws: string | null; issue: Issue }) => {
  const [mode, setMode] = useState<"public" | "internal">("public");
  const [body, setBody] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const post = usePostMessage(ws, issue.key);
  useEffect(() => {
    const handle: ComposerHandle = { focus: (m) => { setMode(m); area.current?.focus(); } };
    if (typeof ref === "function") ref(handle);
    else if (ref) (ref as React.RefObject<ComposerHandle | null>).current = handle;
  }, [ref]);
  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!body.trim() || post.isPending) return;
    await post.mutateAsync({ body: body.trim(), visibility: mode }).then(() => setBody("")).catch(() => undefined);
  }
  const onKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
    if (e.key === "Escape") area.current?.blur();
  };
  const internal = mode === "internal";
  return (
    <form onSubmit={send} aria-label="Composer" className={`flex flex-col gap-2 border-t border-line p-3 md:px-6 ${internal ? "bg-warn-soft" : "bg-surface"}`}>
      <div role="radiogroup" aria-label="Message type" className="flex gap-1">
        {(["public", "internal"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
            className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold ${mode === m ? (m === "internal" ? "bg-warn text-white" : "bg-accent text-white") : "text-muted hover:bg-surface-2"}`}>
            {m === "public" ? "Reply" : "Internal note"}
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor="composer-body">{internal ? "Internal note" : "Reply to the customer"}</label>
      <textarea id="composer-body" ref={area} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={onKey} rows={3}
        placeholder={internal ? "Only your team sees internal notes" : "Write a reply…"}
        className="w-full resize-y rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
      {post.isError && <p role="alert" className="m-0 text-[13px] text-danger">{(post.error as Error).message}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-muted">{internal ? "Never sent to the customer." : issue.channel === "api" || issue.channel === "ui" ? "Visible to the customer through the API." : "Sent to the customer's conversation."} ⌘↵ to send</span>
        <button type="submit" disabled={!body.trim() || post.isPending} className={`h-9 shrink-0 whitespace-nowrap rounded-lg px-4 text-[13px] font-semibold text-white disabled:opacity-60 ${internal ? "bg-warn" : "bg-accent"}`}>
          {post.isPending ? "Sending…" : internal ? "Add note" : "Send"}
        </button>
      </div>
    </form>
  );
};
