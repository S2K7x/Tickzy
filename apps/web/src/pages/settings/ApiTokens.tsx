import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type ApiToken } from "../../lib/api.ts";
import { useCurrentWorkspace, useSession } from "../../lib/session.ts";
import { SCOPE_GROUPS, ALL_SCOPES, scopeLabel } from "../../lib/scopes.ts";
import { inputClass } from "../AuthLayout.tsx";

const card = "rounded-2xl border border-line bg-surface";
const smallButton = "inline-flex h-9 items-center justify-center rounded-[10px] border border-line bg-surface px-3 text-[13px] font-semibold text-fg hover:bg-surface-2 disabled:opacity-60";
const EXPIRY = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never" },
];
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString();

/** Settings › API tokens (FR-1.6, T-103). Admin only; the secret is shown once. */
export function ApiTokens() {
  const session = useSession();
  const { current } = useCurrentWorkspace(session.data);
  const wsId = current?.workspace_id ?? null;
  const isAdmin = current?.role === "admin";
  const qc = useQueryClient();
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const tokens = useQuery({
    queryKey: ["api-tokens", wsId],
    queryFn: () => api<{ data: ApiToken[] }>("/v1/api-tokens", { workspaceId: wsId }),
    enabled: !!wsId && isAdmin,
  });

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="m-0 text-lg font-semibold">API tokens</h2>
        <p className="m-0 text-sm text-muted">Only admins can create and manage API tokens.</p>
      </div>
    );
  }

  async function revoke(t: ApiToken) {
    setActionError(null);
    setNotice(null);
    try {
      await api(`/v1/api-tokens/${t.id}`, { method: "DELETE", workspaceId: wsId });
      setNotice(`Token “${t.name}” revoked. Requests using it now fail.`);
      await qc.invalidateQueries({ queryKey: ["api-tokens", wsId] });
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-lg font-semibold">API tokens</h2>
        <p className="m-0 text-sm text-muted">
          Tokens belong to the workspace and keep working if the person who created them leaves. Send them as <code className="text-fg">Authorization: Bearer tkz_live_…</code>.
        </p>
      </div>

      {created ? (
        <CreatedToken name={created.name} token={created.token} onDone={() => setCreated(null)} />
      ) : (
        <CreateTokenForm workspaceId={wsId!} onCreated={async (name, token) => {
          setNotice(null);
          setCreated({ name, token });
          await qc.invalidateQueries({ queryKey: ["api-tokens", wsId] });
        }} />
      )}

      <div aria-live="polite" className="empty:hidden">
        {notice && <p role="status" className="m-0 text-sm text-success">{notice}</p>}
        {actionError && <p role="alert" className="m-0 text-sm text-danger">{actionError}</p>}
      </div>

      <section aria-labelledby="tokens-heading" className={card}>
        <h3 id="tokens-heading" className="m-0 border-b border-line px-5 py-3 text-[15px] font-semibold">Active tokens</h3>
        {tokens.isPending && <p role="status" className="m-0 px-5 py-4 text-sm text-muted">Loading tokens…</p>}
        {tokens.isError && <p role="alert" className="m-0 px-5 py-4 text-sm text-danger">{(tokens.error as Error).message}</p>}
        {tokens.data?.data.length === 0 && <p className="m-0 px-5 py-4 text-sm text-muted">No API tokens yet.</p>}
        <ul className="m-0 list-none p-0">
          {tokens.data?.data.map((t) => <TokenRow key={t.id} token={t} onRevoke={() => void revoke(t)} />)}
        </ul>
      </section>
    </div>
  );
}

function TokenRow({ token: t, onRevoke }: { token: ApiToken; onRevoke: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold">{t.name}</span>
        <span className="truncate font-mono text-[12px] text-muted">{t.prefix}…</span>
        <span className="text-[13px] text-muted">
          {t.last_used_at ? `Last used ${fmtDate(t.last_used_at)}` : "Never used"} · {t.expires_at ? `Expires ${fmtDate(t.expires_at)}` : "No expiry"}
        </span>
        <span className="text-[13px] text-muted" title={t.scopes.map(scopeLabel).join(", ")}>
          {t.scopes.length === ALL_SCOPES.length ? "All scopes" : t.scopes.map(scopeLabel).join(" · ")}
        </span>
      </div>
      {confirming ? (
        <div className="flex gap-2">
          <button type="button" className={`${smallButton} !border-danger !text-danger`} onClick={() => { setConfirming(false); onRevoke(); }}>Confirm revoke</button>
          <button type="button" className={smallButton} onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      ) : (
        <button type="button" className={smallButton} aria-label={`Revoke token ${t.name}`} onClick={() => setConfirming(true)}>Revoke</button>
      )}
    </li>
  );
}

function CreatedToken({ name, token, onDone }: { name: string; token: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <section aria-labelledby="created-heading" className={`${card} flex flex-col gap-3 border-accent p-5`}>
      <h3 id="created-heading" className="m-0 text-[15px] font-semibold">Token “{name}” created</h3>
      <p role="status" className="m-0 text-sm text-muted">Copy it now. For your security it will not be shown again.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="new-token" className="sr-only">New API token</label>
        <input id="new-token" readOnly value={token} className={`${inputClass} font-mono text-[13px]`} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className={`${smallButton} h-11`} onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <button type="button" className="self-start text-sm font-semibold text-accent-fg" onClick={onDone}>I've stored it safely</button>
    </section>
  );
}

function CreateTokenForm({ workspaceId, onCreated }: { workspaceId: string; onCreated: (name: string, token: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("90");
  const [scopes, setScopes] = useState<Set<string>>(new Set(["issues:read"]));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => setScopes((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<ApiToken & { token: string }>("/v1/api-tokens", {
        method: "POST",
        workspaceId,
        body: { name: name.trim(), scopes: [...scopes], expires_in_days: expiry === "never" ? null : Number(expiry) },
      });
      setName("");
      await onCreated(res.name, res.token);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "validation_failed" ? "Give the token a name and at least one scope." : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className={`${card} flex flex-col gap-4 p-5`} aria-labelledby="create-token-heading">
      <h3 id="create-token-heading" className="m-0 text-[15px] font-semibold">Create a token</h3>
      <div className="flex flex-col gap-3 md:flex-row">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="token-name" className="text-sm font-medium">Name</label>
          <input id="token-name" className={inputClass} value={name} maxLength={80} placeholder="e.g. CRM sync" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5 md:w-44">
          <label htmlFor="token-expiry" className="text-sm font-medium">Expires after</label>
          <select id="token-expiry" className={inputClass} value={expiry} onChange={(e) => setExpiry(e.target.value)}>
            {EXPIRY.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {SCOPE_GROUPS.map((g) => (
          <fieldset key={g.label} className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1 p-0 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{g.label}</legend>
            {g.scopes.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={scopes.has(s.id)} onChange={() => toggle(s.id)} />
                {s.label}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <p className="m-0 text-[13px] text-muted">
        Tokens can never create other tokens. Issue, account and knowledge APIs arrive with M2–M5; those scopes apply as they ship.
      </p>
      {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
      <button type="submit" disabled={busy || name.trim() === "" || scopes.size === 0}
        className="inline-flex h-11 items-center justify-center self-start rounded-[10px] bg-primary px-5 text-sm font-semibold text-primary-fg hover:opacity-90 disabled:opacity-50">
        {busy ? "Creating…" : "Create token"}
      </button>
    </form>
  );
}
