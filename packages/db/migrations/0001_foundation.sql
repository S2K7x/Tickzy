-- 0001 foundation: roles, identity, workspaces, memberships, counters, audit log, outbox.
-- Tenancy model: ADR-005 (shared schema + RLS keyed on app.workspace_id).

-- Runtime role. Never BYPASSRLS. Password is set outside migrations (secret manager / dev script).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tickzy_app') THEN
    CREATE ROLE tickzy_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS citext;

-- Helpers: the current tenant and principal, set per transaction by withWorkspace().
CREATE OR REPLACE FUNCTION app_workspace_id() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.workspace_id', true), '') $$;
CREATE OR REPLACE FUNCTION app_user_id() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '') $$;

CREATE TABLE users (
  id          text PRIMARY KEY CHECK (id LIKE 'usr\_%'),
  email       citext NOT NULL UNIQUE,
  name        text NOT NULL DEFAULT '',
  avatar_url  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id            text PRIMARY KEY CHECK (id LIKE 'ws\_%'),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  issue_prefix  text NOT NULL CHECK (issue_prefix ~ '^[A-Z]{2,5}$'),
  region        text NOT NULL DEFAULT 'us' CHECK (region IN ('us', 'eu')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id            text PRIMARY KEY CHECK (id LIKE 'mem\_%'),
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('admin', 'agent', 'collaborator', 'viewer')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE workspace_counters (
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  value         bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, name)
);

CREATE TABLE audit_log (
  id            text PRIMARY KEY CHECK (id LIKE 'aud\_%'),
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_type    text NOT NULL CHECK (actor_type IN ('user', 'api_token', 'system', 'ai')),
  actor_id      text,
  action        text NOT NULL,
  target_type   text,
  target_id     text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip            inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_ws_created_idx ON audit_log (workspace_id, created_at DESC);

-- Transactional outbox (architecture §1 principle 5).
CREATE TABLE outbox (
  id            bigserial PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type          text NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz
);
CREATE INDEX outbox_unpublished_idx ON outbox (id) WHERE published_at IS NULL;

-- Row-level security ------------------------------------------------------
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspaces
  USING (id = app_workspace_id()) WITH CHECK (id = app_workspace_id());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['memberships', 'workspace_counters', 'audit_log', 'outbox'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id())',
      t);
  END LOOP;
END $$;

-- Users are global identities: visible to themselves and to members of the current workspace.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY self_or_coworker_read ON users FOR SELECT USING (
  id = app_user_id()
  OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.workspace_id = app_workspace_id())
);
CREATE POLICY self_write ON users FOR UPDATE USING (id = app_user_id()) WITH CHECK (id = app_user_id());
-- User creation happens through the system path (sign-up), never as a tenant-scoped app query.

-- Narrow, audited cross-tenant entry points (SECURITY DEFINER, fixed search_path) ----------
-- The caller's own memberships across workspaces (needed to pick a workspace after sign-in).
CREATE OR REPLACE FUNCTION my_memberships()
  RETURNS TABLE (workspace_id text, workspace_name text, workspace_slug text, role text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT m.workspace_id, w.name, w.slug, m.role
    FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.user_id = app_user_id() AND m.status = 'active'
    ORDER BY w.name
  $$;

-- Sign-up / sign-in: find or create a user by email. Returns the user id.
CREATE OR REPLACE FUNCTION upsert_user(p_id text, p_email text, p_name text)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  DECLARE v_id text;
  BEGIN
    INSERT INTO users (id, email, name) VALUES (p_id, p_email, coalesce(p_name, ''))
      ON CONFLICT (email) DO UPDATE SET updated_at = now()
      RETURNING id INTO v_id;
    RETURN v_id;
  END $$;

REVOKE ALL ON FUNCTION my_memberships(), upsert_user(text, text, text) FROM PUBLIC;

-- Grants -------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO tickzy_app;
GRANT SELECT, UPDATE ON users TO tickzy_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON workspaces, memberships, workspace_counters TO tickzy_app;
GRANT SELECT, INSERT ON audit_log TO tickzy_app;          -- append-only for the app
GRANT SELECT, INSERT, UPDATE ON outbox TO tickzy_app;
GRANT USAGE, SELECT ON SEQUENCE outbox_id_seq TO tickzy_app;
GRANT EXECUTE ON FUNCTION app_workspace_id(), app_user_id(), my_memberships(), upsert_user(text, text, text) TO tickzy_app;
