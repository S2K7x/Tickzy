-- 0012 saved views (T-211, FR-3.7): a named inbox view = a system view as base + filters + sort.
-- Personal views are visible only to their owner; shared views to every member of the workspace. Both rules are
-- enforced by row-level security (not only by the API), on top of tenant isolation.

CREATE TABLE saved_views (
  id            text PRIMARY KEY CHECK (id LIKE 'vw\_%'),
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared        boolean NOT NULL DEFAULT false,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  base          text NOT NULL CHECK (base IN ('open', 'on-us', 'on-customer', 'mine', 'unassigned', 'done')),
  filters       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filters) = 'object' AND pg_column_size(filters) <= 2048),
  sort          text NOT NULL DEFAULT 'updated' CHECK (sort IN ('updated', 'newest', 'oldest', 'priority')),
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
CREATE INDEX saved_views_ws_owner_idx ON saved_views (workspace_id, owner_user_id);
-- One name per owner for personal views, one name per workspace for shared views.
CREATE UNIQUE INDEX saved_views_personal_name_uniq ON saved_views (workspace_id, owner_user_id, lower(name)) WHERE NOT shared;
CREATE UNIQUE INDEX saved_views_shared_name_uniq ON saved_views (workspace_id, lower(name)) WHERE shared;

ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_views FORCE ROW LEVEL SECURITY;
-- Tenant isolation AND visibility: shared views, or the caller's own.
CREATE POLICY saved_views_visible ON saved_views
  USING (workspace_id = app_workspace_id() AND (shared OR owner_user_id = app_user_id()))
  WITH CHECK (workspace_id = app_workspace_id() AND (shared OR owner_user_id = app_user_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON saved_views TO tickzy_app;
