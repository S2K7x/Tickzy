import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type InvitationPreview } from "../lib/api.ts";
import { rememberWorkspace, SESSION_KEY, useSession, useSignOut } from "../lib/session.ts";
import { captureInviteToken, clearInviteToken } from "../lib/invite.ts";
import { ROLE_INFO } from "../lib/roles.ts";
import { AuthLayout, primaryButtonClass } from "./AuthLayout.tsx";

/** Landing page of an invitation email (FR-1.3, T-102). Works signed out (sign in first) and signed in. */
export function Invite() {
  const [token] = useState(captureInviteToken);
  const session = useSession();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = useQuery({
    queryKey: ["invitation-preview", token],
    queryFn: () => api<InvitationPreview>("/v1/invitations/preview", { method: "POST", body: { token } }),
    enabled: !!token,
    retry: false,
  });

  const status = preview.data?.status;
  useEffect(() => {
    if (preview.isError || (status && status !== "pending")) clearInviteToken();
  }, [preview.isError, status]);

  if (!token || preview.isError) {
    return (
      <AuthLayout title="This invitation didn't work" subtitle="The link is incomplete or no longer valid. Ask the person who invited you to send a new one.">
        <Link to="/" className="text-sm font-semibold text-accent-fg no-underline">Go to Tickzy</Link>
      </AuthLayout>
    );
  }
  if (preview.isPending) {
    return (
      <AuthLayout title="Opening your invitation…">
        <p role="status" className="m-0 text-sm text-muted">One moment.</p>
      </AuthLayout>
    );
  }
  const inv = preview.data;
  if (inv.status !== "pending") {
    const why = { accepted: "It has already been accepted.", expired: "It has expired.", revoked: "It was revoked." }[inv.status];
    return (
      <AuthLayout title="This invitation can't be used" subtitle={`${why} Ask ${inv.inviter_name} to send a new one.`}>
        <Link to="/" className="text-sm font-semibold text-accent-fg no-underline">Go to Tickzy</Link>
      </AuthLayout>
    );
  }

  const title = `Join ${inv.workspace_name}`;
  const subtitle = `${inv.inviter_name} invited ${inv.email} to join as ${ROLE_INFO[inv.role].label.toLowerCase()}.`;
  const user = session.data?.user;

  if (!user) {
    return (
      <AuthLayout title={title} subtitle={subtitle}>
        <p className="m-0 text-sm text-muted">Sign in with <strong className="text-fg">{inv.email}</strong> to accept. You'll come back here afterwards.</p>
        <Link to="/sign-in" search={{ email: inv.email }} className={`${primaryButtonClass} no-underline`}>Sign in to accept</Link>
      </AuthLayout>
    );
  }

  if (user.email.toLowerCase() !== inv.email.toLowerCase()) {
    return (
      <AuthLayout title={title} subtitle={subtitle}>
        <p role="alert" className="m-0 text-sm text-danger">You're signed in as {user.email}. This invitation is for {inv.email}.</p>
        <button type="button" className={primaryButtonClass} onClick={() => void signOut()}>
          Sign out and switch account
        </button>
      </AuthLayout>
    );
  }

  async function accept() {
    setError(null);
    setBusy(true);
    try {
      const { workspace_id } = await api<{ workspace_id: string }>("/v1/invitations/accept", { method: "POST", body: { token } });
      clearInviteToken();
      rememberWorkspace(workspace_id);
      await qc.invalidateQueries({ queryKey: SESSION_KEY });
      await navigate({ to: "/" });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={title} subtitle={subtitle}>
      {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
      <button type="button" className={primaryButtonClass} disabled={busy} onClick={() => void accept()}>
        {busy ? "Joining…" : `Accept and join ${inv.workspace_name}`}
      </button>
    </AuthLayout>
  );
}
