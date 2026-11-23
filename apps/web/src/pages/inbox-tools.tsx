import { PRIORITIES, STATUS_CATEGORIES, type Priority, type StatusCategory } from "@tickzy/shared/lifecycle";
import { CHANNEL_LABEL, CHANNELS, PRIORITY_LABEL, STATUS_LABEL, useBulkUpdate, type BulkChanges, type Issue } from "../lib/issues.ts";
import { useLabels, useTeams } from "../lib/taxonomy.ts";
import { assignable, useMembers } from "../lib/members.ts";
import { useAccount, useAccounts } from "../lib/accounts.ts";
import { btn } from "../components/ui.ts";
import { errorMessage } from "../lib/api.ts";

/** Queue filters held in the URL (T-209b). Lists are comma-separated. */
export interface QueueFilters { priority?: string | undefined; channel?: string | undefined; team?: string | undefined; label?: string | undefined; account?: string | undefined }
export const FILTER_KEYS = ["priority", "channel", "team", "label", "account"] as const;
export const activeFilterCount = (f: QueueFilters) => FILTER_KEYS.filter((k) => f[k]).length;

const list = (csv: string | undefined) => (csv ? csv.split(",").filter(Boolean) : []);
const toggle = (csv: string | undefined, value: string) => {
  const s = new Set(list(csv));
  if (s.has(value)) s.delete(value); else s.add(value);
  return s.size ? [...s].join(",") : undefined;
};
const field = "h-9 w-full rounded-lg border border-line bg-surface-2 px-2 text-[13px] text-fg";
const legend = "mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted";

/** Filter panel (ux-spec S2 queue pane): priority and channel (any of), team, label. Applies immediately. */
export function FilterPanel({ ws, filters, onChange }: { ws: string | null; filters: QueueFilters; onChange: (f: QueueFilters) => void }) {
  const labels = useLabels(ws);
  const teams = useTeams(ws);
  const accounts = useAccounts(ws, "");
  const firstAccounts = accounts.data?.pages[0]?.data ?? [];
  const check = "h-4 w-4 accent-[var(--primary)]";
  return (
    <div id="queue-filters" role="group" aria-label="Filters" className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-3">
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className={legend}>Priority</legend>
        {PRIORITIES.map((p) => (
          <label key={p} className="flex items-center gap-2 py-0.5 text-[13px]">
            <input type="checkbox" className={check} checked={list(filters.priority).includes(p)} onChange={() => onChange({ ...filters, priority: toggle(filters.priority, p) })} />
            {PRIORITY_LABEL[p]}
          </label>
        ))}
      </fieldset>
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className={legend}>Channel</legend>
        {CHANNELS.map((c) => (
          <label key={c} className="flex items-center gap-2 py-0.5 text-[13px]">
            <input type="checkbox" className={check} checked={list(filters.channel).includes(c)} onChange={() => onChange({ ...filters, channel: toggle(filters.channel, c) })} />
            {CHANNEL_LABEL[c]}
          </label>
        ))}
      </fieldset>
      <label className="flex min-w-0 flex-col gap-1">
        <span className={legend}>Label</span>
        <select className={field} value={filters.label ?? ""} onChange={(e) => onChange({ ...filters, label: e.target.value || undefined })}>
          <option value="">Any label</option>
          {labels.data?.data.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      <label className="flex min-w-0 flex-col gap-1">
        <span className={legend}>Team</span>
        <select className={field} value={filters.team ?? ""} onChange={(e) => onChange({ ...filters, team: e.target.value || undefined })} disabled={!teams.data?.data.length}>
          <option value="">{teams.data?.data.length ? "Any team" : "No teams yet"}</option>
          {teams.data?.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="col-span-2 flex min-w-0 flex-col gap-1">
        <span className={legend}>Account</span>
        <select className={field} value={filters.account ?? ""} onChange={(e) => onChange({ ...filters, account: e.target.value || undefined })} disabled={!firstAccounts.length && !filters.account}>
          <option value="">{firstAccounts.length ? "Any account" : "No accounts yet"}</option>
          {filters.account && !firstAccounts.some((a) => a.id === filters.account) && <AccountOption ws={ws} id={filters.account} />}
          {firstAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {accounts.data?.pages[0]?.next_cursor && <span className="text-[11px] text-muted">First 50 accounts by name; open any account's page to filter by it.</span>}
      </label>
    </div>
  );
}

/** Option for an account outside the first page (e.g. opened from its profile). */
function AccountOption({ ws, id }: { ws: string | null; id: string }) {
  const a = useAccount(ws, id);
  return <option value={id}>{a.data?.name ?? "…"}</option>;
}

/** Active filters as removable chips. */
export function FilterChips({ ws, filters, onChange }: { ws: string | null; filters: QueueFilters; onChange: (f: QueueFilters) => void }) {
  const labels = useLabels(ws);
  const teams = useTeams(ws);
  const account = useAccount(ws, filters.account ?? "");
  const chips: { key: string; text: string; next: QueueFilters }[] = [
    ...list(filters.priority).map((p) => ({ key: `p-${p}`, text: `Priority: ${PRIORITY_LABEL[p as Priority] ?? p}`, next: { ...filters, priority: toggle(filters.priority, p) } })),
    ...list(filters.channel).map((c) => ({ key: `c-${c}`, text: `Channel: ${CHANNEL_LABEL[c as Issue["channel"]] ?? c}`, next: { ...filters, channel: toggle(filters.channel, c) } })),
    ...(filters.label ? [{ key: "l", text: `Label: ${labels.data?.data.find((l) => l.id === filters.label)?.name ?? "…"}`, next: { ...filters, label: undefined } }] : []),
    ...(filters.team ? [{ key: "t", text: `Team: ${teams.data?.data.find((t) => t.id === filters.team)?.name ?? "…"}`, next: { ...filters, team: undefined } }] : []),
    ...(filters.account ? [{ key: "a", text: `Account: ${account.data?.name ?? "…"}`, next: { ...filters, account: undefined } }] : []),
  ];
  if (!chips.length) return null;
  return (
    <ul aria-label="Active filters" className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
      {chips.map((c) => (
        <li key={c.key} className="flex items-center gap-1 rounded-full border border-line bg-surface py-0.5 pl-2.5 pr-1 text-[12px]">
          {c.text}
          <button type="button" aria-label={`Remove filter ${c.text}`} onClick={() => onChange(c.next)} className="grid h-5 w-5 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg">×</button>
        </li>
      ))}
      <li><button type="button" onClick={() => onChange({})} className="px-1 text-[12px] font-semibold text-accent-fg">Clear all</button></li>
    </ul>
  );
}

/**
 * Bulk bar (FR-3.10): shown while issues are selected. Each control applies at once to every selected issue; the outcome
 * says exactly which issues could not be changed and why (e.g. closed issues cannot be reopened). Failed issues stay
 * selected so they can be retried or inspected.
 */
export function BulkBar({ ws, selected, issues, onSelectAll, onClear, onDone }: {
  ws: string | null; selected: string[]; issues: Issue[]; onSelectAll: () => void; onClear: () => void;
  /** Called after each action with the ids that were not changed and a one-line summary for the live region. */
  onDone: (failedIds: string[], summary: { ok: number; failed: { key: string; message: string }[] }) => void;
}) {
  const bulk = useBulkUpdate(ws);
  const labels = useLabels(ws);
  const members = useMembers(ws);
  const keyOf = (id: string) => issues.find((i) => i.id === id)?.key ?? id;
  async function apply(changes: BulkChanges) {
    try {
      const { results } = await bulk.mutateAsync({ issues: selected, changes });
      const failed = results.filter((r) => !r.ok);
      onDone(failed.map((r) => r.ref), { ok: results.length - failed.length, failed: failed.map((r) => ({ key: keyOf(r.ref), message: r.ok ? "" : r.error.message })) });
    } catch { /* shown from bulk.error */ }
  }
  const pick = "h-8 min-w-0 rounded-lg border border-line bg-surface px-2 text-[12px] text-fg disabled:opacity-60";
  const n = selected.length;
  const busy = bulk.isPending;
  return (
    <div role="region" aria-label="Bulk actions" className="flex flex-col gap-2 border-b border-line bg-surface-2 px-4 py-2">
      <div className="flex items-center gap-2 text-[13px]">
        <span className="font-semibold">{n} selected</span>
        {n < issues.length && <button type="button" onClick={onSelectAll} className="font-semibold text-accent-fg">Select all {issues.length}</button>}
        <button type="button" onClick={onClear} className={`${btn.ghost} ${btn.sm} ml-auto`}>Clear</button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <select aria-label="Set status of selected issues" className={pick} value="" disabled={busy} onChange={(e) => void apply({ status: e.target.value as StatusCategory })}>
          <option value="">Status…</option>
          {STATUS_CATEGORIES.map((c) => <option key={c} value={c}>{STATUS_LABEL[c]}</option>)}
        </select>
        <select aria-label="Set priority of selected issues" className={pick} value="" disabled={busy} onChange={(e) => void apply({ priority: e.target.value as Priority })}>
          <option value="">Priority…</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
        <select aria-label="Assign selected issues" className={pick} value="" disabled={busy} onChange={(e) => void apply({ assignee_membership_id: e.target.value === "none" ? null : e.target.value })}>
          <option value="">Assign…</option>
          <option value="none">Unassigned</option>
          {assignable(members.data?.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
        </select>
        <select aria-label="Label selected issues" className={pick} value="" disabled={busy || !labels.data?.data.length}
          onChange={(e) => { const [op, id] = e.target.value.split(":"); void apply(op === "add" ? { add_labels: [id!] } : { remove_labels: [id!] }); }}>
          <option value="">{labels.data?.data.length ? "Labels…" : "No labels yet"}</option>
          {!!labels.data?.data.length && <optgroup label="Add">{labels.data.data.map((l) => <option key={l.id} value={`add:${l.id}`}>+ {l.name}</option>)}</optgroup>}
          {!!labels.data?.data.length && <optgroup label="Remove">{labels.data.data.map((l) => <option key={l.id} value={`rm:${l.id}`}>− {l.name}</option>)}</optgroup>}
        </select>
      </div>
      {busy && <p className="m-0 text-[12px] text-muted">Updating {n} issue{n === 1 ? "" : "s"}…</p>}
      {bulk.isError && <p role="alert" className="m-0 text-[12px] text-danger">Couldn't update: {errorMessage(bulk.error)}</p>}
    </div>
  );
}

/** "Updated 3 issues. 1 not changed: ACME-4 — Closed issues cannot be reopened…" */
export function BulkSummary({ summary }: { summary: { ok: number; failed: { key: string; message: string }[] } }) {
  return (
    <>
      {summary.ok > 0 && <span className="text-fg">Updated {summary.ok} issue{summary.ok === 1 ? "" : "s"}.</span>}
      {summary.failed.length > 0 && <span className="text-danger"> {summary.failed.length} not changed: {summary.failed.map((f) => `${f.key} — ${f.message}`).join("; ")}</span>}
    </>
  );
}
