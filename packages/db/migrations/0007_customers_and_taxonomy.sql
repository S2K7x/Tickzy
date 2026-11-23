-- 0007 customers and issue taxonomy (T-201, M2): accounts, account_domains, contacts, contact_identities,
-- teams, team_members, statuses, labels, custom_field_defs.
-- Every cross-table reference is a COMPOSITE foreign key (workspace_id, id): FK checks bypass RLS, so a plain FK
-- would let a row in one workspace point at another workspace's record.

-- Helper: the tenant-isolation policy + forced RLS + runtime grants for a table.
CREATE OR REPLACE FUNCTION pg_temp.tenant_table(t text, grants text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id())', t);
  EXECUTE format('GRANT %s ON %I TO tickzy_app', grants, t);
END $$;

-- Composite-FK targets on existing tables.
ALTER TABLE memberships ADD CONSTRAINT memberships_ws_id_uniq UNIQUE (workspace_id, id);

-- Customers ---------------------------------------------------------------------------------------
CREATE TABLE accounts (
  id               text PRIMARY KEY CHECK (id LIKE 'acc\_%'),
  workspace_id     text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  tier             text CHECK (tier IS NULL OR length(tier) BETWEEN 1 AND 40),
  owner_membership_id text,
  external_ids     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(external_ids) = 'object'),
  custom           jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custom) = 'object'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, owner_membership_id) REFERENCES memberships (workspace_id, id) ON DELETE SET NULL (owner_membership_id)
);
CREATE INDEX accounts_ws_name_idx ON accounts (workspace_id, lower(name)) WHERE deleted_at IS NULL;

-- One account per domain per workspace (FR-4.2 auto-mapping by email domain).
CREATE TABLE account_domains (
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  domain        citext NOT NULL CHECK (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  account_id    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, domain),
  FOREIGN KEY (workspace_id, account_id) REFERENCES accounts (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX account_domains_account_idx ON account_domains (workspace_id, account_id);

CREATE TABLE contacts (
  id               text PRIMARY KEY CHECK (id LIKE 'con\_%'),
  workspace_id     text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id       text,
  name             text NOT NULL DEFAULT '' CHECK (length(name) <= 200),
  role_in_account  text CHECK (role_in_account IS NULL OR length(role_in_account) <= 80),
  custom           jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custom) = 'object'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, account_id) REFERENCES accounts (workspace_id, id) ON DELETE SET NULL (account_id)
);
CREATE INDEX contacts_ws_account_idx ON contacts (workspace_id, account_id) WHERE deleted_at IS NULL;

-- The identity graph: how a contact is recognised on each channel. Emails are stored lowercased;
-- Slack keys are `team_id:user_id`.
CREATE TABLE contact_identities (
  id            text PRIMARY KEY CHECK (id LIKE 'cid\_%'),
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id    text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('email', 'slack', 'teams', 'widget')),
  external_key  text NOT NULL CHECK (length(external_key) BETWEEN 1 AND 320),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kind, external_key),
  CHECK (kind <> 'email' OR external_key = lower(external_key)),
  FOREIGN KEY (workspace_id, contact_id) REFERENCES contacts (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX contact_identities_contact_idx ON contact_identities (workspace_id, contact_id);

-- Teams -------------------------------------------------------------------------------------------
CREATE TABLE teams (
  id                   text PRIMARY KEY CHECK (id LIKE 'tm\_%'),
  workspace_id         text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                 text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  assignment_strategy  text NOT NULL DEFAULT 'manual' CHECK (assignment_strategy IN ('manual', 'round_robin')),
  round_robin_cursor   text,          -- membership id that received the last auto-assignment
  created_at           timestamptz NOT NULL DEFAULT now(),
  archived_at          timestamptz,
  UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX teams_ws_name_uniq ON teams (workspace_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE team_members (
  workspace_id   text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id        text NOT NULL,
  membership_id  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, membership_id),
  FOREIGN KEY (workspace_id, team_id) REFERENCES teams (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, membership_id) REFERENCES memberships (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX team_members_membership_idx ON team_members (workspace_id, membership_id);

-- Statuses (custom statuses inside the fixed categories of FR-3.1) --------------------------------
CREATE TABLE statuses (
  id            text PRIMARY KEY CHECK (id LIKE 'sts\_%'),
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category      text NOT NULL CHECK (category IN ('triage', 'waiting_on_us', 'waiting_on_customer', 'blocked', 'resolved', 'closed', 'ignored')),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  position      int NOT NULL DEFAULT 0,
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,
  UNIQUE (workspace_id, id),
  CHECK (NOT (is_default AND archived_at IS NOT NULL))
);
CREATE UNIQUE INDEX statuses_ws_name_uniq ON statuses (workspace_id, lower(name)) WHERE archived_at IS NULL;
-- Exactly one default per category is guaranteed by seeding + this partial unique index.
CREATE UNIQUE INDEX statuses_default_per_category ON statuses (workspace_id, category) WHERE is_default;

-- Labels (hierarchical; AI may only apply ai_enabled labels — FR-7.1) -------------------------------
CREATE TABLE labels (
  id            text PRIMARY KEY CHECK (id LIKE 'lbl\_%'),
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  color         text NOT NULL DEFAULT '#6b7280' CHECK (color ~ '^#[0-9a-f]{6}$'),
  description   text CHECK (description IS NULL OR length(description) <= 500),
  parent_id     text,
  ai_enabled    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,
  UNIQUE (workspace_id, id),
  CHECK (parent_id IS NULL OR parent_id <> id),
  FOREIGN KEY (workspace_id, parent_id) REFERENCES labels (workspace_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX labels_ws_name_uniq ON labels (workspace_id, coalesce(parent_id, ''), lower(name)) WHERE archived_at IS NULL;

-- Custom field definitions (values live in the entity's `custom` jsonb, validated by the API) ------
CREATE TABLE custom_field_defs (
  id            text PRIMARY KEY CHECK (id LIKE 'cfd\_%'),
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity        text NOT NULL CHECK (entity IN ('issue', 'account', 'contact')),
  key           text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label         text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  type          text NOT NULL CHECK (type IN ('text', 'number', 'boolean', 'date', 'select', 'multi_select', 'url')),
  options       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array'),
  required      boolean NOT NULL DEFAULT false,
  position      int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,
  UNIQUE (workspace_id, id),
  CHECK (type IN ('select', 'multi_select') OR options = '[]'::jsonb)
);
CREATE UNIQUE INDEX custom_field_defs_key_uniq ON custom_field_defs (workspace_id, entity, key);   -- keys are never reused

SELECT pg_temp.tenant_table('accounts', 'SELECT, INSERT, UPDATE');
SELECT pg_temp.tenant_table('account_domains', 'SELECT, INSERT, DELETE');
SELECT pg_temp.tenant_table('contacts', 'SELECT, INSERT, UPDATE');
SELECT pg_temp.tenant_table('contact_identities', 'SELECT, INSERT, DELETE');
SELECT pg_temp.tenant_table('teams', 'SELECT, INSERT, UPDATE');
SELECT pg_temp.tenant_table('team_members', 'SELECT, INSERT, DELETE');
SELECT pg_temp.tenant_table('statuses', 'SELECT, INSERT, UPDATE');
SELECT pg_temp.tenant_table('labels', 'SELECT, INSERT, UPDATE');
SELECT pg_temp.tenant_table('custom_field_defs', 'SELECT, INSERT, UPDATE');

-- ULID in SQL (ADR-018 format: 10 chars of millisecond time + 16 chars of randomness, Crockford base32), for rows
-- created by SQL such as seeded defaults. The random part takes the 80 fully random bits of a v4 UUID.
CREATE OR REPLACE FUNCTION gen_ulid() RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE
  enc constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  ts bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  b bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  r bytea := substring(b FROM 1 FOR 6) || substring(b FROM 11 FOR 4);   -- skip version/variant bytes 7 and 9
  result text := '';
  part text;
  v bigint;
BEGIN
  FOR i IN 1..10 LOOP
    result := substr(enc, (ts % 32)::int + 1, 1) || result;
    ts := ts / 32;
  END LOOP;
  FOR chunk IN 0..1 LOOP
    v := 0;
    FOR j IN 0..4 LOOP v := v * 256 + get_byte(r, chunk * 5 + j); END LOOP;
    part := '';
    FOR k IN 1..8 LOOP
      part := substr(enc, (v % 32)::int + 1, 1) || part;
      v := v / 32;
    END LOOP;
    result := result || part;
  END LOOP;
  RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION gen_ulid() TO tickzy_app;

-- Default statuses: the single source used at workspace creation (app) and by the backfill below.
-- SECURITY INVOKER: runs under the caller's tenant context and RLS.
CREATE OR REPLACE FUNCTION seed_workspace_defaults() RETURNS void LANGUAGE sql SET search_path = public AS $$
  INSERT INTO statuses (id, workspace_id, category, name, position, is_default)
  SELECT 'sts_' || gen_ulid(), app_workspace_id(), d.category, d.name, d.position, true
  FROM (VALUES ('triage', 'Triage', 0), ('waiting_on_us', 'Open', 1), ('waiting_on_customer', 'Waiting on customer', 2),
               ('blocked', 'Blocked', 3), ('resolved', 'Resolved', 4), ('closed', 'Closed', 5), ('ignored', 'Ignored', 6))
       AS d (category, name, position)
  WHERE app_workspace_id() IS NOT NULL
  ON CONFLICT DO NOTHING
$$;
REVOKE ALL ON FUNCTION seed_workspace_defaults() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION seed_workspace_defaults() TO tickzy_app;

-- Backfill existing workspaces (expand → migrate). RLS is forced even for the table owner, so lift FORCE for the
-- duration of this transaction only.
ALTER TABLE workspaces NO FORCE ROW LEVEL SECURITY;
ALTER TABLE statuses NO FORCE ROW LEVEL SECURITY;
DO $$
DECLARE w text;
BEGIN
  FOR w IN SELECT id FROM workspaces LOOP
    PERFORM set_config('app.workspace_id', w, true);
    PERFORM seed_workspace_defaults();
  END LOOP;
  PERFORM set_config('app.workspace_id', '', true);
END $$;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE statuses FORCE ROW LEVEL SECURITY;
