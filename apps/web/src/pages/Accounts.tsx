import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useCurrentWorkspace, useSession } from "../lib/session.ts";
import { parseDomains, roleCan, useAccountMutations, useAccounts, type Account } from "../lib/accounts.ts";
import { assignable, useMembers } from "../lib/members.ts";
import { relativeTime } from "../lib/issues.ts";
import { Avatar } from "../components/issue-ui.tsx";
import { Modal } from "../components/Modal.tsx";
import { btn, card, input } from "../components/ui.ts";
import { errorMessage } from "../lib/api.ts";

/** Accounts list (ux-spec S4, T-210): the companies you support, with their open issues, contacts and last activity. */
export function Accounts() {
  const search = useSearch({ strict: false }) as { q?: string };
  const navigate = useNavigate();
  const session = useSession();
  const { current } = useCurrentWorkspace(session.data);
  const ws = current?.workspace_id ?? null;
  const canWrite = roleCan(current?.role, "accounts:write");
  const [text, setText] = useState(search.q ?? "");
  const q = (search.q ?? "").trim();
  // Debounced search → URL (?q=), so results are shareable and survive reloads.
  useEffect(() => {
    const t = setTimeout(() => { if (text.trim() !== q) void navigate({ to: "/accounts", search: (text.trim() ? { q: text.trim() } : {}) as never, replace: true }); }, 250);
    return () => clearTimeout(t);
  }, [text, q, navigate]);
  const list = useAccounts(ws, q);
  const members = useMembers(ws);
  const accounts = list.data?.pages.flatMap((p) => p.data) ?? [];
  const [creating, setCreating] = useState(false);
  const ownerName = (id: string | null) => {
    const m = id ? members.data?.data.find((x) => x.id === id) : undefined;
    return m ? m.name || m.email : null;
  };

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">Accounts</h1>
          <p className="m-0 mt-1 text-sm text-muted">Companies you support. Contacts join an account automatically when their email domain matches.</p>
        </div>
        {canWrite && <button type="button" onClick={() => setCreating(true)} className={`${btn.primary} ${btn.md}`}>New account</button>}
      </div>

      <div role="search" aria-label="Accounts" className="max-w-md">
        <label htmlFor="accounts-q" className="sr-only">Search accounts by name or domain</label>
        <input id="accounts-q" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by name or domain…" className={input} />
      </div>

      <div className={`${card} overflow-hidden`}>
        {list.isPending && <p role="status" className="m-0 px-5 py-4 text-sm text-muted">Loading accounts…</p>}
        {list.isError && <p role="alert" className="m-0 px-5 py-4 text-sm text-danger">{errorMessage(list.error)}</p>}
        {list.isSuccess && accounts.length === 0 && (
          <div className="px-6 py-10 text-center">
            <p className="m-0 text-sm font-semibold">{q ? `No accounts match “${q}”` : "No accounts yet"}</p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">
              {q ? "Try part of the name or the start of a domain (acme.com)." : "Create an account with its email domains; existing and future contacts from those domains are linked to it."}
            </p>
            {!q && canWrite && <button type="button" onClick={() => setCreating(true)} className={`${btn.secondary} ${btn.md} mt-4`}>New account</button>}
          </div>
        )}
        {accounts.length > 0 && (
          <>
            {/* ≥768px: table */}
            <table className="hidden w-full border-collapse text-left text-[14px] md:table">
              <thead className="bg-surface-2 text-[12px] text-muted">
                <tr>{["Account", "Tier", "Owner", "Open issues", "Contacts", "Last activity"].map((h, i) => (
                  <th key={h} scope="col" className={`whitespace-nowrap border-b border-line px-4 py-2.5 font-medium first:pl-5 last:pr-5 ${i >= 3 ? "text-right" : ""} ${i === 2 ? "hidden lg:table-cell" : ""}`}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                    <td className="px-4 py-3 pl-5">
                      <Link to="/accounts/$accountId" params={{ accountId: a.id }} className="flex items-center gap-3 text-fg no-underline">
                        <Avatar name={a.name} size={32} />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-semibold">{a.name}</span>
                          <span className="truncate text-[12px] text-muted">{a.domains.join(", ") || "No domains"}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">{a.tier ? <span className="rounded-full border border-line px-2 py-0.5 text-[12px]">{a.tier}</span> : <span className="text-muted">—</span>}</td>
                    <td className="hidden px-4 py-3 text-[13px] lg:table-cell">{ownerName(a.owner_membership_id) ?? <span className="text-muted">—</span>}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{a.open_issue_count}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{a.contact_count}</td>
                    <td className="px-4 py-3 pr-5 text-right text-[13px] text-muted">{a.last_activity_at ? relativeTime(a.last_activity_at) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* <768px: cards */}
            <ul className="m-0 list-none p-0 md:hidden">
              {accounts.map((a) => (
                <li key={a.id} className="border-b border-line last:border-0">
                  <Link to="/accounts/$accountId" params={{ accountId: a.id }} className="flex items-center gap-3 px-4 py-3 text-fg no-underline">
                    <Avatar name={a.name} size={36} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-2"><span className="truncate font-semibold">{a.name}</span>{a.tier && <span className="shrink-0 rounded-full border border-line px-1.5 text-[11px]">{a.tier}</span>}</span>
                      <span className="truncate text-[12px] text-muted">{a.open_issue_count} open · {a.contact_count} contacts{a.last_activity_at ? ` · ${relativeTime(a.last_activity_at)}` : ""}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        {list.hasNextPage && (
          <div className="border-t border-line p-3">
            <button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className={`${btn.secondary} ${btn.md} w-full`}>
              {list.isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
      {creating && <AccountDialog ws={ws} onClose={() => setCreating(false)} onSaved={(a) => void navigate({ to: "/accounts/$accountId", params: { accountId: a.id } })} />}
    </section>
  );
}

/** Create or edit an account: name, email domains, tier, owner. Validation messages come from the API (422/409). */
export function AccountDialog({ ws, account, onClose, onSaved }: { ws: string | null; account?: Account; onClose: () => void; onSaved?: (a: Account) => void }) {
  const { create, update } = useAccountMutations(ws);
  const members = useMembers(ws);
  const [name, setName] = useState(account?.name ?? "");
  const [domains, setDomains] = useState(account?.domains.join(", ") ?? "");
  const [tier, setTier] = useState(account?.tier ?? "");
  const [owner, setOwner] = useState(account?.owner_membership_id ?? "");
  const first = useRef<HTMLInputElement>(null);
  const m = account ? update : create;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const body = { name: name.trim(), domains: parseDomains(domains), tier: tier.trim() || null, owner_membership_id: owner || null };
    const saved = await (account ? update.mutateAsync({ id: account.id, ...body }) : create.mutateAsync(body)).catch(() => null);
    if (!saved) return;
    onClose();
    onSaved?.(saved);
  }
  const field = "flex flex-col gap-1.5 text-sm font-medium";
  return (
    <Modal title={account ? `Edit ${account.name}` : "New account"} titleId="account-dialog-title" onClose={onClose} onSubmit={submit} initialFocus={first}>
      <label className={field}>Name
        <input ref={first} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} className={input} required />
      </label>
      <label className={field}>Email domains
        <input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="acme.com, acme.io" className={input} aria-describedby="account-domains-help" />
        <span id="account-domains-help" className="text-[12px] font-normal text-muted">Contacts with these email domains join this account. Public providers (gmail.com…) are refused.</span>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={field}>Tier
          <input value={tier} maxLength={40} onChange={(e) => setTier(e.target.value)} placeholder="Enterprise" className={input} />
        </label>
        <label className={field}>Owner
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className={input}>
            <option value="">No owner</option>
            {assignable(members.data?.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name || x.email}</option>)}
          </select>
        </label>
      </div>
      {m.isError && <p role="alert" className="m-0 text-sm text-danger">{errorMessage(m.error)}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={`${btn.secondary} ${btn.md}`}>Cancel</button>
        <button type="submit" disabled={!name.trim() || m.isPending} className={`${btn.primary} ${btn.md}`}>{m.isPending ? "Saving…" : account ? "Save" : "Create account"}</button>
      </div>
    </Modal>
  );
}
