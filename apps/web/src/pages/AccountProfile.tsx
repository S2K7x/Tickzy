import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useCurrentWorkspace, useSession } from "../lib/session.ts";
import { roleCan, useAccount, useAccountMutations, useContacts } from "../lib/accounts.ts";
import { useMembers } from "../lib/members.ts";
import { relativeTime, useIssueList, type ViewId } from "../lib/issues.ts";
import { Avatar, ChannelBadge, PriorityDot, StatusChip } from "../components/issue-ui.tsx";
import { Modal } from "../components/Modal.tsx";
import { btn, card, input, segmented } from "../components/ui.ts";
import { AccountDialog } from "./Accounts.tsx";
import { errorMessage } from "../lib/api.ts";

type Tab = "issues" | "contacts";

/**
 * Account profile (ux-spec S4, T-210): header, the account's issues (open / resolved) and its contacts. Health signals,
 * SLA performance and channel mappings need the SLA engine and channels (M3–M4); the page says so rather than faking them.
 */
export function AccountProfile() {
  const { accountId } = useParams({ strict: false }) as { accountId: string };
  const search = useSearch({ strict: false }) as { tab?: Tab };
  const tab: Tab = search.tab === "contacts" ? "contacts" : "issues";
  const navigate = useNavigate();
  const session = useSession();
  const { current } = useCurrentWorkspace(session.data);
  const ws = current?.workspace_id ?? null;
  const canWrite = roleCan(current?.role, "accounts:write");
  const account = useAccount(ws, accountId);
  const members = useMembers(ws);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const a = account.data;
  const owner = a?.owner_membership_id ? members.data?.data.find((m) => m.id === a.owner_membership_id) : undefined;

  if (account.isError) {
    return (
      <section className="flex flex-col gap-3">
        <Link to="/accounts" className="text-sm font-semibold text-accent-fg">← Accounts</Link>
        <h1 className="m-0 text-2xl font-semibold">Account not found</h1>
        <p role="alert" className="m-0 text-sm text-muted">{errorMessage(account.error)}</p>
      </section>
    );
  }
  if (!a) return <p role="status" className="m-0 text-sm text-muted">Loading account…</p>;

  return (
    <section className="flex flex-col gap-5">
      <Link to="/accounts" className="self-start text-sm font-semibold text-accent-fg no-underline">← Accounts</Link>
      <header className={`${card} flex flex-col gap-4 p-5 md:flex-row md:items-start`}>
        <Avatar name={a.name} size={56} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="m-0 text-2xl font-semibold tracking-tight">{a.name}</h1>
            {a.tier && <span className="rounded-full border border-line px-2 py-0.5 text-[12px]">{a.tier}</span>}
          </div>
          <p className="m-0 text-[13px] text-muted">{a.domains.length ? a.domains.join(" · ") : "No email domains — contacts are only linked by hand."}</p>
          <dl className="m-0 mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
            <div><dt className="text-muted">Open issues</dt><dd className="m-0 text-lg font-semibold tabular-nums">{a.open_issue_count}</dd></div>
            <div><dt className="text-muted">Contacts</dt><dd className="m-0 text-lg font-semibold tabular-nums">{a.contact_count}</dd></div>
            <div><dt className="text-muted">Last activity</dt><dd className="m-0 text-lg font-semibold">{a.last_activity_at ? relativeTime(a.last_activity_at) : "—"}</dd></div>
            <div><dt className="text-muted">Owner</dt><dd className="m-0 truncate text-[14px] font-semibold leading-7">{owner ? owner.name || owner.email : "—"}</dd></div>
          </dl>
        </div>
        <div className="flex flex-wrap gap-2 md:flex-col md:items-stretch">
          <Link to="/inbox" search={{ account: a.id } as never} className={`${btn.secondary} ${btn.md} no-underline`}>Open in inbox</Link>
          {canWrite && <button type="button" onClick={() => setEditing(true)} className={`${btn.secondary} ${btn.md}`}>Edit</button>}
          {canWrite && <button type="button" onClick={() => setDeleting(true)} className={`${btn.danger} ${btn.md}`}>Delete</button>}
        </div>
      </header>

      <nav aria-label="Account sections" className={`${segmented.bar} self-start`}>
        {(["issues", "contacts"] as const).map((t) => (
          <Link key={t} to="/accounts/$accountId" params={{ accountId: a.id }} search={(t === "issues" ? {} : { tab: t }) as never}
            aria-current={tab === t ? "page" : undefined} className={`${segmented.item} ${tab === t ? segmented.active : ""}`}>
            {t === "issues" ? "Issues" : "Contacts"}<span className={segmented.count}>{t === "issues" ? a.open_issue_count : a.contact_count}</span>
          </Link>
        ))}
      </nav>
      {tab === "issues" ? <AccountIssues ws={ws} accountId={a.id} /> : <AccountContacts ws={ws} accountId={a.id} canWrite={canWrite} />}
      <p className="m-0 text-[12px] text-muted">Health signals, SLA performance and Slack/email channel mappings arrive with channels (M3) and SLAs (M4).</p>

      {editing && <AccountDialog ws={ws} account={a} onClose={() => setEditing(false)} />}
      {deleting && <DeleteAccount ws={ws} id={a.id} name={a.name} onClose={() => setDeleting(false)} onDeleted={() => void navigate({ to: "/accounts" })} />}
    </section>
  );
}

function AccountIssues({ ws, accountId }: { ws: string | null; accountId: string }) {
  const [view, setView] = useState<ViewId>("open");
  const list = useIssueList(ws, view, "updated", { account: accountId });
  const issues = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className={`${card} overflow-hidden`}>
      <div role="radiogroup" aria-label="Which issues" className={`${segmented.bar} m-3`}>
        {([["open", "Open"], ["done", "Resolved & closed"]] as const).map(([v, label]) => (
          <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)} className={`${segmented.item} ${view === v ? segmented.active : ""}`}>{label}</button>
        ))}
      </div>
      {list.isPending && <p role="status" className="m-0 px-5 pb-4 text-sm text-muted">Loading issues…</p>}
      {list.isError && <p role="alert" className="m-0 px-5 pb-4 text-sm text-danger">{errorMessage(list.error)}</p>}
      {list.isSuccess && issues.length === 0 && <p className="m-0 px-5 pb-5 text-sm text-muted">{view === "open" ? "No open issues for this account." : "Nothing resolved yet."}</p>}
      <ul aria-label="Account issues" className="m-0 list-none border-t border-line p-0 empty:hidden">
        {issues.map((i) => (
          <li key={i.id} className="border-b border-line last:border-0">
            <Link to="/inbox" search={{ issue: i.key } as never} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-fg no-underline hover:bg-surface-2/60">
              <PriorityDot priority={i.priority} />
              <span className="text-[12px] text-muted">{i.key}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{i.title}</span>
              <StatusChip status={i.status} />
              <ChannelBadge channel={i.channel} />
              <span className="w-10 text-right text-[12px] text-muted">{relativeTime(i.updated_at)}</span>
            </Link>
          </li>
        ))}
      </ul>
      {list.hasNextPage && (
        <div className="border-t border-line p-3">
          <button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className={`${btn.secondary} ${btn.md} w-full`}>{list.isFetchingNextPage ? "Loading…" : "Load more"}</button>
        </div>
      )}
    </div>
  );
}

function AccountContacts({ ws, accountId, canWrite }: { ws: string | null; accountId: string; canWrite: boolean }) {
  const contacts = useContacts(ws, accountId);
  const { addContact } = useAccountMutations(ws);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const all = contacts.data?.pages.flatMap((p) => p.data) ?? [];
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() && !email.trim()) return;
    const ok = await addContact.mutateAsync({ account_id: accountId, ...(name.trim() ? { name: name.trim() } : {}), ...(email.trim() ? { email: email.trim() } : {}), role_in_account: role.trim() || null }).catch(() => null);
    if (ok) { setName(""); setEmail(""); setRole(""); }
  }
  return (
    <div className={`${card} overflow-hidden`}>
      {contacts.isPending && <p role="status" className="m-0 px-5 py-4 text-sm text-muted">Loading contacts…</p>}
      {contacts.isError && <p role="alert" className="m-0 px-5 py-4 text-sm text-danger">{errorMessage(contacts.error)}</p>}
      {contacts.isSuccess && all.length === 0 && <p className="m-0 px-5 py-4 text-sm text-muted">No contacts yet. People who write in from this account's domains are added automatically.</p>}
      {all.length > 0 && (
        <ul aria-label="Contacts" className="m-0 list-none p-0">
          {all.map((c) => {
            const emails = c.identities.filter((x) => x.kind === "email").map((x) => x.external_key);
            const others = c.identities.filter((x) => x.kind !== "email");
            return (
              <li key={c.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0">
                <Avatar name={c.name || emails[0] || "?"} size={32} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{c.name || emails[0] || "Unnamed contact"}{c.role_in_account && <span className="ml-2 font-normal text-muted">{c.role_in_account}</span>}</span>
                  <span className="truncate text-[12px] text-muted">{[...emails, ...others.map((x) => `${x.kind}: ${x.external_key}`)].join(" · ") || "No identities"}</span>
                </span>
                <span className="shrink-0 text-[11px] text-muted" title={c.account_source === "auto" ? "Linked by email domain" : "Linked by hand"}>{c.account_source === "auto" ? "Auto-linked" : "Manual"}</span>
              </li>
            );
          })}
        </ul>
      )}
      {contacts.hasNextPage && (
        <div className="border-t border-line p-3">
          <button type="button" onClick={() => void contacts.fetchNextPage()} className={`${btn.secondary} ${btn.md} w-full`}>Load more</button>
        </div>
      )}
      {canWrite && (
        <form onSubmit={add} aria-label="Add contact" className="flex flex-col gap-2 border-t border-line bg-surface-2/50 p-4">
          <span className="text-[13px] font-semibold">Add contact</span>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_160px_auto]">
            <label className="sr-only" htmlFor="contact-name">Name</label>
            <input id="contact-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder="Name" className={input} />
            <label className="sr-only" htmlFor="contact-email">Email</label>
            <input id="contact-email" type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className={input} />
            <label className="sr-only" htmlFor="contact-role">Role</label>
            <input id="contact-role" value={role} maxLength={80} onChange={(e) => setRole(e.target.value)} placeholder="Role (optional)" className={input} />
            <button type="submit" disabled={addContact.isPending || (!name.trim() && !email.trim())} className={`${btn.primary} ${btn.lg}`}>Add</button>
          </div>
          {addContact.isError && <p role="alert" className="m-0 text-[13px] text-danger">{errorMessage(addContact.error)}</p>}
        </form>
      )}
    </div>
  );
}

function DeleteAccount({ ws, id, name, onClose, onDeleted }: { ws: string | null; id: string; name: string; onClose: () => void; onDeleted: () => void }) {
  const { remove } = useAccountMutations(ws);
  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (await remove.mutateAsync(id).then(() => true).catch(() => false)) { onClose(); onDeleted(); }
  }
  return (
    <Modal title={`Delete ${name}?`} titleId="delete-account-title" onClose={onClose} onSubmit={confirm}>
      <p className="m-0 text-sm text-muted">The account and its domains are removed. Its contacts stay, unlinked (they re-link automatically if another account claims their domain). Its issues stay, shown without an account. This is recorded in the audit log.</p>
      {remove.isError && <p role="alert" className="m-0 text-sm text-danger">{errorMessage(remove.error)}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={`${btn.secondary} ${btn.md}`}>Cancel</button>
        <button type="submit" disabled={remove.isPending} className={`${btn.dangerSolid} ${btn.md}`}>{remove.isPending ? "Deleting…" : "Delete account"}</button>
      </div>
    </Modal>
  );
}
