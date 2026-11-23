import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { PRIORITIES, STATUS_CATEGORIES, canTransition } from "@tickzy/shared/lifecycle";
import { api } from "../lib/api.ts";
import { PRIORITY_LABEL, STATUS_LABEL, useIssue, useUpdateIssue, type Issue } from "../lib/issues.ts";
import { assignable, useMembers } from "../lib/members.ts";
import { useLabels } from "../lib/taxonomy.ts";
import { PriorityDot, StatusChip } from "./issue-ui.tsx";

/** Sub-pages of the palette; `a`/`s`/`p`/`l` in the inbox open the matching one for the open issue (ux-spec §2.5). */
export type PalettePage = "root" | "assign" | "status" | "priority" | "label";
const PAGE_TITLE: Record<Exclude<PalettePage, "root">, string> = { assign: "Assign to…", status: "Change status…", priority: "Set priority…", label: "Add label…" };

const NAV_TARGETS = [
  { to: "/", label: "Go to Overview" }, { to: "/inbox", label: "Go to Inbox" }, { to: "/mine", label: "Go to My issues" },
  { to: "/accounts", label: "Go to Accounts" }, { to: "/search", label: "Go to Search" }, { to: "/settings/members", label: "Go to Settings" },
] as const;

/** Debounced value (palette issue search hits the API at most every 150 ms). */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/**
 * ⌘K command palette (ADR-009: cmdk). Jump to issues by key or title, run actions on the open issue (assign, status,
 * priority, label, resolve), navigate, create. Every action goes through the same API as the rest of the UI.
 */
export function CommandPalette({ ws, userId, issueRef, initialPage = "root", onClose, onNewIssue, onToggleTheme, onShortcuts }: {
  ws: string | null; userId: string; issueRef: string | null; initialPage?: PalettePage; onClose: () => void;
  onNewIssue: () => void; onToggleTheme: () => void; onShortcuts: () => void;
}) {
  const navigate = useNavigate();
  const [page, setPage] = useState<PalettePage>(issueRef ? initialPage : "root");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 150);
  const issue = useIssue(ws, issueRef);
  const update = useUpdateIssue(ws, issueRef ?? "");
  const members = useMembers(ws);
  const labels = useLabels(ws);
  const found = useQuery({
    queryKey: ["issues", ws, "palette", q],
    queryFn: () => api<{ data: Issue[] }>(`/v1/issues?q=${encodeURIComponent(q)}&limit=8`, { workspaceId: ws }),
    enabled: !!ws && page === "root" && q.length > 0,
    staleTime: 10_000,
  });
  const i = issue.data;
  // Results arrive after the debounce: move the highlight to the best issue match so Enter opens it
  // (otherwise cmdk keeps "Search everything", which rendered first).
  const [active, setActive] = useState("");
  const top = found.data?.data[0];
  useEffect(() => { if (top && q) setActive(`${top.key} ${top.title}`); }, [top, q]);
  const run = (fn: () => void) => () => { fn(); onClose(); };
  const go = (to: string, searchParams?: Record<string, string>) => run(() => void navigate({ to, ...(searchParams ? { search: searchParams as never } : {}) }));
  const sub = (p: PalettePage) => () => { setPage(p); setSearch(""); };
  const item = "flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] text-fg data-[selected=true]:bg-surface-2 aria-disabled:opacity-50";
  const group = "px-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-muted";
  const me = members.data?.data.find((m) => m.status === "active" && i && m.id !== i.assignee?.membership_id && m.user_id === userId);

  return (
    <Command.Dialog open onOpenChange={(o) => { if (!o) onClose(); }} label="Command palette" loop value={active} onValueChange={setActive}
      overlayClassName="fixed inset-0 z-40 bg-black/40"
      contentClassName="fixed left-1/2 top-[12vh] z-50 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-surface text-fg shadow-xl"
      onKeyDown={(e) => { if (e.key === "Backspace" && !search && page !== "root") { e.preventDefault(); setPage("root"); } }}>
      <div className="flex items-center gap-2 border-b border-line px-4">
        {page !== "root" && i && <span className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[12px] text-muted">{i.key} · {PAGE_TITLE[page]}</span>}
        <Command.Input value={search} onValueChange={setSearch} autoFocus
          placeholder={page === "root" ? (i ? `Search issues or run a command on ${i.key}…` : "Search issues or type a command…") : "Filter…"}
          className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-muted" />
      </div>
      <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto py-1">
        <Command.Empty className="px-4 py-6 text-center text-[13px] text-muted">{found.isFetching ? "Searching…" : "No results"}</Command.Empty>

        {page === "root" && (
          <>
            {q && !!found.data?.data.length && (
              <Command.Group heading="Issues" className={group}>
                {found.data.data.map((x) => (
                  <Command.Item key={x.id} value={`${x.key} ${x.title}`} onSelect={go("/inbox", { issue: x.key })} className={item}>
                    <PriorityDot priority={x.priority} /><span className="shrink-0 text-[12px] text-muted">{x.key}</span>
                    <span className="min-w-0 flex-1 truncate">{x.title}</span><StatusChip status={x.status} />
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {q && (
              <Command.Group heading="Search" className={group}>
                <Command.Item value={`search everything ${q}`} keywords={[q]} onSelect={go("/search", { q })} className={item}>Search everything for “{q}”</Command.Item>
              </Command.Group>
            )}
            {i && (
              <Command.Group heading={`Issue ${i.key}`} className={group}>
                {me && <Command.Item onSelect={run(() => update.mutate({ assignee_membership_id: me.id }))} className={item}>Assign to me</Command.Item>}
                <Command.Item onSelect={sub("assign")} className={item}>Assign to… <Kbd>a</Kbd></Command.Item>
                {i.status.category !== "closed" && <Command.Item onSelect={sub("status")} className={item}>Change status… <Kbd>s</Kbd></Command.Item>}
                <Command.Item onSelect={sub("priority")} className={item}>Set priority… <Kbd>p</Kbd></Command.Item>
                <Command.Item onSelect={sub("label")} className={item}>Add label… <Kbd>l</Kbd></Command.Item>
                {canTransition(i.status.category, "resolved") && <Command.Item onSelect={run(() => update.mutate({ status: "resolved" }))} className={item}>Resolve <Kbd>e</Kbd></Command.Item>}
              </Command.Group>
            )}
            <Command.Group heading="Create" className={group}>
              <Command.Item onSelect={run(onNewIssue)} className={item}>New issue <Kbd>c</Kbd></Command.Item>
            </Command.Group>
            <Command.Group heading="Navigate" className={group}>
              {NAV_TARGETS.map((n) => <Command.Item key={n.to} onSelect={go(n.to)} className={item}>{n.label}</Command.Item>)}
            </Command.Group>
            <Command.Group heading="Preferences" className={group}>
              <Command.Item onSelect={run(onToggleTheme)} className={item}>Toggle light / dark theme</Command.Item>
              <Command.Item onSelect={run(onShortcuts)} className={item}>Keyboard shortcuts <Kbd>?</Kbd></Command.Item>
            </Command.Group>
          </>
        )}

        {page === "assign" && i && (
          <Command.Group heading={PAGE_TITLE.assign} className={group}>
            <Command.Item value="unassigned" onSelect={run(() => update.mutate({ assignee_membership_id: null }))} className={item}>Unassigned{!i.assignee && <Current />}</Command.Item>
            {assignable(members.data?.data ?? []).map((m) => (
              <Command.Item key={m.id} value={`${m.name} ${m.email}`} onSelect={run(() => update.mutate({ assignee_membership_id: m.id }))} className={item}>
                {m.name || m.email}{i.assignee?.membership_id === m.id && <Current />}
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {page === "status" && i && (
          <Command.Group heading={PAGE_TITLE.status} className={group}>
            {STATUS_CATEGORIES.filter((c) => canTransition(i.status.category, c)).map((c) => (
              <Command.Item key={c} value={STATUS_LABEL[c]} onSelect={run(() => update.mutate({ status: c }))} className={item}>{STATUS_LABEL[c]}</Command.Item>
            ))}
          </Command.Group>
        )}
        {page === "priority" && i && (
          <Command.Group heading={PAGE_TITLE.priority} className={group}>
            {PRIORITIES.map((p) => (
              <Command.Item key={p} value={PRIORITY_LABEL[p]} onSelect={run(() => update.mutate({ priority: p }))} className={item}>
                <PriorityDot priority={p} />{PRIORITY_LABEL[p]}{i.priority === p && <Current />}
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {page === "label" && i && (
          <Command.Group heading={PAGE_TITLE.label} className={group}>
            {(labels.data?.data ?? []).filter((l) => !i.labels.some((x) => x.id === l.id)).map((l) => (
              <Command.Item key={l.id} value={l.name} onSelect={run(() => update.mutate({ labels: [...i.labels.map((x) => x.id), l.id] }))} className={item}>
                <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />{l.name}
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
      <p className="m-0 border-t border-line px-4 py-2 text-[11px] text-muted">
        <Kbd>↑</Kbd> <Kbd>↓</Kbd> move · <Kbd>↵</Kbd> run · {page !== "root" ? <><Kbd>⌫</Kbd> back · </> : null}<Kbd>Esc</Kbd> close
      </p>
    </Command.Dialog>
  );
}

const Kbd = ({ children }: { children: string }) => <kbd className="ml-auto rounded border border-line bg-surface-2 px-1.5 text-[11px] font-semibold text-muted first:ml-0">{children}</kbd>;
const Current = () => <span className="ml-auto text-[12px] text-muted">current</span>;
