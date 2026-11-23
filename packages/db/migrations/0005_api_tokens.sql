-- 0005 API tokens (T-103, FR-1.6, ADR-022). Workspace-owned, scoped, hashed at rest, shown once.

CREATE TABLE api_tokens (
  id            text PRIMARY KEY CHECK (id LIKE 'tok\_%'),
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  token_id      text NOT NULL UNIQUE,              -- public half; the UI shows its first characters as the prefix
  secret_hash   bytea NOT NULL,                    -- SHA-256 of the secret half
  scopes        text[] NOT NULL CHECK (cardinality(scopes) > 0 AND NOT ('developers:manage' = ANY (scopes))),
  created_by    text REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
CREATE INDEX api_tokens_ws_created_idx ON api_tokens (workspace_id, created_at DESC);

ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api_tokens
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
GRANT SELECT, INSERT ON api_tokens TO tickzy_app;
GRANT UPDATE (revoked_at, name) ON api_tokens TO tickzy_app;   -- hash, scopes and workspace are immutable

-- Bearer authentication happens before any tenant is known, so lookup is a narrow cross-tenant entry point.
-- Returns the usable token (not revoked, not expired) for the app to compare the hash in constant time.
CREATE OR REPLACE FUNCTION api_token_lookup(p_token_id text)
  RETURNS TABLE (id text, workspace_id text, secret_hash bytea, scopes text[])
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT t.id, t.workspace_id, t.secret_hash, t.scopes FROM api_tokens t
    WHERE t.token_id = p_token_id AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())
  $$;

-- Called after the hash matched. Throttled to one write per minute per token.
CREATE OR REPLACE FUNCTION api_token_touch(p_id text)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE api_tokens SET last_used_at = now()
    WHERE id = p_id AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')
  $$;

REVOKE ALL ON FUNCTION api_token_lookup(text), api_token_touch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_token_lookup(text), api_token_touch(text) TO tickzy_app;
