-- 0004 invitations (T-102, FR-1.3).

CREATE TABLE invitations (
  id            text PRIMARY KEY CHECK (id LIKE 'inv\_%'),
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email         citext NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'agent', 'collaborator', 'viewer')),
  token_id      text NOT NULL UNIQUE,              -- public half of the invite token
  secret_hash   bytea NOT NULL,                    -- SHA-256 of the secret half
  invited_by    text REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  accepted_by   text REFERENCES users(id) ON DELETE SET NULL,
  revoked_at    timestamptz
);
-- At most one pending invitation per email per workspace.
CREATE UNIQUE INDEX invitations_pending_uniq ON invitations (workspace_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX invitations_ws_created_idx ON invitations (workspace_id, created_at DESC);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitations
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
GRANT SELECT, INSERT, UPDATE ON invitations TO tickzy_app;

-- Public preview of an invitation (the invite token is the capability). Never reveals the token hash.
CREATE OR REPLACE FUNCTION invitation_preview(p_token_id text, p_secret_hash bytea)
  RETURNS TABLE (workspace_name text, inviter_name text, email text, role text, status text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT w.name, coalesce(nullif(u.name, ''), u.email::text, ''), i.email::text, i.role,
      CASE WHEN i.revoked_at IS NOT NULL THEN 'revoked'
           WHEN i.accepted_at IS NOT NULL THEN 'accepted'
           WHEN i.expires_at <= now() THEN 'expired'
           ELSE 'pending' END
    FROM invitations i
    JOIN workspaces w ON w.id = i.workspace_id
    LEFT JOIN users u ON u.id = i.invited_by
    WHERE i.token_id = p_token_id AND i.secret_hash = p_secret_hash
  $$;

-- Accept an invitation as the signed-in user (app.user_id). Errors (raised as messages the API maps):
--   invitation_invalid  — unknown token, revoked, already accepted or expired
--   invitation_email_mismatch — signed in with a different email than the one invited
-- Creates (or re-activates) the membership, marks the invitation accepted, writes audit + outbox, returns workspace id.
CREATE OR REPLACE FUNCTION accept_invitation(p_token_id text, p_secret_hash bytea, p_audit_id text, p_membership_id text)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  DECLARE inv invitations%ROWTYPE; v_user users%ROWTYPE;
  BEGIN
    SELECT * INTO v_user FROM users WHERE id = app_user_id();
    IF NOT FOUND THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001'; END IF;
    SELECT * INTO inv FROM invitations WHERE token_id = p_token_id AND secret_hash = p_secret_hash FOR UPDATE;
    IF NOT FOUND OR inv.revoked_at IS NOT NULL OR inv.accepted_at IS NOT NULL OR inv.expires_at <= now() THEN
      RAISE EXCEPTION 'invitation_invalid' USING ERRCODE = 'P0001';
    END IF;
    IF lower(inv.email) <> lower(v_user.email) THEN
      RAISE EXCEPTION 'invitation_email_mismatch' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO memberships (id, workspace_id, user_id, role, status)
      VALUES (p_membership_id, inv.workspace_id, v_user.id, inv.role, 'active')
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active';
    UPDATE invitations SET accepted_at = now(), accepted_by = v_user.id WHERE id = inv.id;
    INSERT INTO audit_log (id, workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
      VALUES (p_audit_id, inv.workspace_id, 'user', v_user.id, 'invitation.accepted', 'invitation', inv.id,
              jsonb_build_object('role', inv.role));
    INSERT INTO outbox (workspace_id, type, payload)
      VALUES (inv.workspace_id, 'member.joined', jsonb_build_object('user_id', v_user.id, 'role', inv.role));
    RETURN inv.workspace_id;
  END $$;

REVOKE ALL ON FUNCTION invitation_preview(text, bytea), accept_invitation(text, bytea, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invitation_preview(text, bytea), accept_invitation(text, bytea, text, text) TO tickzy_app;
