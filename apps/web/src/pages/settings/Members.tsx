import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Invitation, type Member, type Role } from "../../lib/api.ts";
import { useCurrentWorkspace, useSession } from "../../lib/session.ts";
import { ROLE_INFO, ROLE_ORDER } from "../../lib/roles.ts";
import { inputClass } from "../AuthLayout.tsx";

const card = "rounded-2xl border border-line bg-surface";
const smallButton = "inline-flex h-9 items-center justify-center rounded-[10px] border border-line bg-surface px-3 text-[13px] font-semibold text-fg hover:bg-surface-2 disabled:opacity-60";
const selectClass = "h-9 rounded-[10px] border border-line bg-surface-2 px-2 text-[13px] text-fg";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Try again.";
}

function RoleBadge({ role }: { role: Role }) {
  const info = ROLE_INFO[role];
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">
      {info.label}
      {info.free && <span className="text-accent-fg">· free</span>}
    </span>
  );
}

/** Settings › Members & roles (FR-1.3, T-102). Admins manage; everyone else can see who is in the workspace. */
export function Members() {
  const session = useSession();
  const { current } = useCurrentWorkspace(session.data);
  const wsId = current?.workspace_id ?? null;
  const canManage = current?.role === "admin";
  const me = session.data?.user.id;
  const qc = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const members = useQuery({
    queryKey: ["members", wsId],
    queryFn: () => api<{ data: Member[] }>("/v1/members", { workspaceId: wsId }),
    enabled: !!wsId,
  });
  const invitations = useQuery({
    queryKey: ["invitations", wsId],
    queryFn: () => api<{ data: Invitation[] }>("/v1/invitations", { workspaceId: wsId }),
    enabled: !!wsId && canManage,
  });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["members", wsId] }), qc.invalidateQueries({ queryKey: ["invitations", wsId] })]);

  const act = useMutation({
    mutationFn: async (a: { path: string; method: "PATCH" | "DELETE" | "POST"; body?: unknown; done: string }) => {
      await api(a.path, { method: a.method, body: a.body, workspaceId: wsId });
      return a.done;
    },
    onMutate: () => { setActionError(null); setNotice(null); },
    onSuccess: async (done) => { setNotice(done); await refresh(); },
    onError: (err) => setActionError(errorMessage(err)),
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-lg font-semibold">Members & roles</h2>
        <p className="m-0 text-sm text-muted">Admins and agents are paid seats. Collaborators and viewers are free.</p>
      </div>

      {canManage && <InviteForm workspaceId={wsId!} onInvited={async (email) => { setActionError(null); setNotice(`Invitation sent to ${email}.`); await refresh(); }} />}

      <div aria-live="polite" className="empty:hidden">
        {notice && <p role="status" className="m-0 text-sm text-success">{notice}</p>}
        {actionError && <p role="alert" className="m-0 text-sm text-danger">{actionError}</p>}
      </div>

      <section aria-labelledby="members-heading" className={card}>
        <h3 id="members-heading" className="m-0 border-b border-line px-5 py-3 text-[15px] font-semibold">
          Members{members.data ? ` (${members.data.data.length})` : ""}
        </h3>
        {members.isPending && <p role="status" className="m-0 px-5 py-4 text-sm text-muted">Loading members…</p>}
        {members.isError && <p role="alert" className="m-0 px-5 py-4 text-sm text-danger">{errorMessage(members.error)}</p>}
        <ul className="m-0 list-none p-0">
          {members.data?.data.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3 last:border-b-0">
              <div className="flex min-w-0 flex-1 basis-48 flex-col">
                <span className="truncate text-sm font-semibold">
                  {m.name || m.email}
                  {m.user_id === me && <span className="font-normal text-muted"> (you)</span>}
                </span>
                {m.name && <span className="truncate text-[13px] text-muted">{m.email}</span>}
              </div>
              {m.status === "deactivated" && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">Deactivated</span>}
              {canManage ? (
                <MemberActions member={m} busy={act.isPending} onAction={(a) => act.mutate(a)} />
              ) : (
                <RoleBadge role={m.role} />
              )}
            </li>
          ))}
        </ul>
      </section>

      {canManage && (
        <section aria-labelledby="invites-heading" className={card}>
          <h3 id="invites-heading" className="m-0 border-b border-line px-5 py-3 text-[15px] font-semibold">Pending invitations</h3>
          {invitations.isPending && <p role="status" className="m-0 px-5 py-4 text-sm text-muted">Loading invitations…</p>}
          {invitations.isError && <p role="alert" className="m-0 px-5 py-4 text-sm text-danger">{errorMessage(invitations.error)}</p>}
          {invitations.data?.data.length === 0 && <p className="m-0 px-5 py-4 text-sm text-muted">No pending invitations.</p>}
          <ul className="m-0 list-none p-0">
            {invitations.data?.data.map((i) => {
              const expired = Date.parse(i.expires_at) <= Date.now();
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3 last:border-b-0">
                  <div className="flex min-w-0 flex-1 basis-48 flex-col">
                    <span className="truncate text-sm font-semibold">{i.email}</span>
                    <span className="text-[13px] text-muted">
                      {expired ? "Expired" : `Expires ${new Date(i.expires_at).toLocaleDateString()}`}
                    </span>
                  </div>
                  <RoleBadge role={i.role} />
                  <button type="button" className={smallButton} disabled={act.isPending} aria-label={`Resend invitation to ${i.email}`}
                    onClick={() => act.mutate({ path: "/v1/invitations", method: "POST", body: { email: i.email, role: i.role }, done: `New invitation link sent to ${i.email}.` })}>
                    Resend
                  </button>
                  <button type="button" className={smallButton} disabled={act.isPending} aria-label={`Revoke invitation to ${i.email}`}
                    onClick={() => act.mutate({ path: `/v1/invitations/${i.id}`, method: "DELETE", done: `Invitation to ${i.email} revoked.` })}>
                    Revoke
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

type Action = { path: string; method: "PATCH" | "DELETE"; body?: unknown; done: string };

function MemberActions({ member: m, busy, onAction }: { member: Member; busy: boolean; onAction: (a: Action) => void }) {
  const [confirming, setConfirming] = useState(false);
  const who = m.name || m.email;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label={`Role for ${who}`}
        className={selectClass}
        value={m.role}
        disabled={busy}
        onChange={(e) => onAction({ path: `/v1/members/${m.id}`, method: "PATCH", body: { role: e.target.value }, done: `${who} is now ${ROLE_INFO[e.target.value as Role].label.toLowerCase()}.` })}
      >
        {ROLE_ORDER.map((r) => (
          <option key={r} value={r}>{ROLE_INFO[r].label}{ROLE_INFO[r].free ? " (free)" : ""}</option>
        ))}
      </select>
      <button type="button" className={smallButton} disabled={busy}
        onClick={() => onAction({ path: `/v1/members/${m.id}`, method: "PATCH", body: { status: m.status === "active" ? "deactivated" : "active" }, done: `${who} ${m.status === "active" ? "deactivated" : "reactivated"}.` })}>
        {m.status === "active" ? "Deactivate" : "Reactivate"}
      </button>
      {confirming ? (
        <>
          <button type="button" className={`${smallButton} !border-danger !text-danger`} disabled={busy}
            onClick={() => { setConfirming(false); onAction({ path: `/v1/members/${m.id}`, method: "DELETE", done: `${who} removed from the workspace.` }); }}>
            Confirm remove
          </button>
          <button type="button" className={smallButton} onClick={() => setConfirming(false)}>Cancel</button>
        </>
      ) : (
        <button type="button" className={smallButton} disabled={busy} aria-label={`Remove ${who}`} onClick={() => setConfirming(true)}>Remove</button>
      )}
    </div>
  );
}

function InviteForm({ workspaceId, onInvited }: { workspaceId: string; onInvited: (email: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const inv = await api<Invitation>("/v1/invitations", { method: "POST", body: { email: email.trim(), role }, workspaceId });
      setEmail("");
      await onInvited(inv.email);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "validation_failed" ? "Enter a valid email address." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className={`${card} flex flex-col gap-3 p-5`} aria-labelledby="invite-heading">
      <h3 id="invite-heading" className="m-0 text-[15px] font-semibold">Invite people</h3>
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="invite-email" className="text-sm font-medium">Email address</label>
          <input id="invite-email" className={inputClass} type="email" name="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)}
            {...(error ? { "aria-invalid": true, "aria-describedby": "invite-error" } : {})} />
        </div>
        <div className="flex flex-col gap-1.5 md:w-48">
          <label htmlFor="invite-role" className="text-sm font-medium">Role</label>
          <select id="invite-role" className={`${inputClass} h-11`} name="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLE_ORDER.map((r) => (
              <option key={r} value={r}>{ROLE_INFO[r].label}{ROLE_INFO[r].free ? " (free)" : ""}</option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={busy || email.trim() === ""}
          className="inline-flex h-11 items-center justify-center rounded-[10px] bg-accent px-5 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? "Sending…" : "Send invite"}
        </button>
      </div>
      <p className="m-0 text-[13px] text-muted">{ROLE_INFO[role].description} The link expires in 7 days.</p>
      {error && <p id="invite-error" role="alert" className="m-0 text-sm text-danger">{error}</p>}
    </form>
  );
}
