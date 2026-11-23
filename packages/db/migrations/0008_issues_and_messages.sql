-- 0008 issues, conversations, messages, timeline, attachments, issue labels (T-202, FR-3.1, FR-3.5).
-- Composite foreign keys throughout (ADR-025). Channel endpoints arrive with T-301: conversations.endpoint_id has
-- no FK yet and is NULL for API/UI-originated conversations.

CREATE OR REPLACE FUNCTION pg_temp.tenant_table(t text, grants text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id())', t);
  EXECUTE format('GRANT %s ON %I TO tickzy_app', grants, t);
END $$;

-- An issue's status must be one of the workspace's statuses AND belong to the issue's category.
ALTER TABLE statuses ADD CONSTRAINT statuses_ws_id_category_uniq UNIQUE (workspace_id, id, category);

CREATE TABLE conversations (
  id                   text PRIMARY KEY CHECK (id LIKE 'cnv\_%'),
  workspace_id         text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_kind         text NOT NULL CHECK (channel_kind IN ('slack', 'email', 'widget', 'api', 'ui')),
  endpoint_id          text,            -- channel_endpoints (T-301); NULL for api/ui
  external_thread_key  text,            -- Slack thread_ts / email root Message-ID
  last_message_at      timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX conversations_thread_uniq ON conversations (workspace_id, channel_kind, coalesce(endpoint_id, ''), external_thread_key)
  WHERE external_thread_key IS NOT NULL;

CREATE TABLE issues (
  id                        text PRIMARY KEY CHECK (id LIKE 'iss\_%'),
  workspace_id              text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  number                    int NOT NULL CHECK (number > 0),
  title                     text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  status_category           text NOT NULL CHECK (status_category IN ('triage', 'waiting_on_us', 'waiting_on_customer', 'blocked', 'resolved', 'closed', 'ignored')),
  status_id                 text NOT NULL,
  priority                  text NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
  assignee_membership_id    text,
  team_id                   text,
  account_id                text,
  requester_contact_id      text,
  channel_kind              text NOT NULL CHECK (channel_kind IN ('slack', 'email', 'widget', 'api', 'ui')),
  product_area              text CHECK (product_area IS NULL OR length(product_area) <= 80),
  custom                    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custom) = 'object'),
  first_response_at         timestamptz,
  resolved_at               timestamptz,
  closed_at                 timestamptz,
  last_customer_message_at  timestamptz,
  last_team_message_at      timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  version                   int NOT NULL DEFAULT 1,     -- optimistic concurrency for PATCH (T-204)
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, number),
  FOREIGN KEY (workspace_id, status_id, status_category) REFERENCES statuses (workspace_id, id, category),
  FOREIGN KEY (workspace_id, assignee_membership_id) REFERENCES memberships (workspace_id, id) ON DELETE SET NULL (assignee_membership_id),
  FOREIGN KEY (workspace_id, team_id) REFERENCES teams (workspace_id, id) ON DELETE SET NULL (team_id),
  FOREIGN KEY (workspace_id, account_id) REFERENCES accounts (workspace_id, id) ON DELETE SET NULL (account_id),
  FOREIGN KEY (workspace_id, requester_contact_id) REFERENCES contacts (workspace_id, id) ON DELETE SET NULL (requester_contact_id)
);
CREATE INDEX issues_ws_category_updated_idx ON issues (workspace_id, status_category, updated_at DESC, id DESC);
CREATE INDEX issues_ws_assignee_idx ON issues (workspace_id, assignee_membership_id) WHERE assignee_membership_id IS NOT NULL;
CREATE INDEX issues_ws_account_idx ON issues (workspace_id, account_id) WHERE account_id IS NOT NULL;

CREATE TABLE issue_labels (
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  issue_id      text NOT NULL,
  label_id      text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, label_id),
  FOREIGN KEY (workspace_id, issue_id) REFERENCES issues (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, label_id) REFERENCES labels (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX issue_labels_label_idx ON issue_labels (workspace_id, label_id);

CREATE TABLE messages (
  id               text PRIMARY KEY CHECK (id LIKE 'msg\_%'),
  workspace_id     text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id  text NOT NULL,
  issue_id         text,
  direction        text NOT NULL CHECK (direction IN ('in', 'out')),
  visibility       text NOT NULL CHECK (visibility IN ('public', 'internal')),
  author_type      text NOT NULL CHECK (author_type IN ('contact', 'member', 'ai', 'system')),
  author_id        text,
  body_text        text NOT NULL DEFAULT '' CHECK (length(body_text) <= 100000),
  body_ast         jsonb,
  source           text NOT NULL CHECK (source IN ('slack', 'email', 'widget', 'api', 'ui')),
  external_id      text,               -- provider message id (Slack ts, email Message-ID): inbound dedupe
  delivery_state   text CHECK (delivery_state IN ('pending', 'sent', 'failed', 'received')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  edited_at        timestamptz,
  deleted_at       timestamptz,
  search           tsvector GENERATED ALWAYS AS (to_tsvector('simple', body_text)) STORED,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversations (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, issue_id) REFERENCES issues (workspace_id, id) ON DELETE SET NULL (issue_id),
  -- Customers write inbound public messages; the team writes outbound ones.
  CHECK ((direction = 'in') = (author_type = 'contact')),
  CHECK (direction = 'out' OR (visibility = 'public' AND delivery_state = 'received')),
  -- FR-3.5: internal notes are never delivered — they can never enter the delivery pipeline.
  CHECK (visibility = 'public' OR delivery_state IS NULL)
);
CREATE INDEX messages_ws_issue_created_idx ON messages (workspace_id, issue_id, created_at);
CREATE INDEX messages_ws_conversation_created_idx ON messages (workspace_id, conversation_id, created_at);
CREATE UNIQUE INDEX messages_external_uniq ON messages (workspace_id, source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX messages_search_idx ON messages USING gin (search);
CREATE INDEX messages_pending_delivery_idx ON messages (workspace_id, created_at) WHERE delivery_state = 'pending';

CREATE TABLE attachments (
  id            text PRIMARY KEY CHECK (id LIKE 'att\_%'),
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  message_id    text NOT NULL,
  object_key    text NOT NULL,
  filename      text NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  mime          text NOT NULL,
  size          bigint NOT NULL CHECK (size >= 0),
  scan_state    text NOT NULL DEFAULT 'pending' CHECK (scan_state IN ('pending', 'clean', 'infected', 'error')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, message_id) REFERENCES messages (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX attachments_message_idx ON attachments (workspace_id, message_id);

-- Timeline: append-only (no UPDATE/DELETE grant), like audit_log.
CREATE TABLE issue_events (
  id            bigserial PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  issue_id      text NOT NULL,
  type          text NOT NULL CHECK (type ~ '^[a-z_]+(\.[a-z_]+)*$'),
  actor_type    text NOT NULL CHECK (actor_type IN ('user', 'api_token', 'system', 'ai', 'contact')),
  actor_id      text,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, issue_id) REFERENCES issues (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX issue_events_issue_idx ON issue_events (workspace_id, issue_id, id);

SELECT pg_temp.tenant_table('conversations', 'SELECT, INSERT, UPDATE');
SELECT pg_temp.tenant_table('issues', 'SELECT, INSERT, UPDATE');
SELECT pg_temp.tenant_table('issue_labels', 'SELECT, INSERT, DELETE');
SELECT pg_temp.tenant_table('messages', 'SELECT, INSERT, UPDATE');
SELECT pg_temp.tenant_table('attachments', 'SELECT, INSERT, UPDATE');
SELECT pg_temp.tenant_table('issue_events', 'SELECT, INSERT');
GRANT USAGE, SELECT ON SEQUENCE issue_events_id_seq TO tickzy_app;

-- Next issue number for the current workspace. The counter row lock serialises concurrent creations and is
-- released with the transaction, so numbers are unique and gap-free (a rolled-back creation rolls back its number).
CREATE OR REPLACE FUNCTION next_issue_number() RETURNS int LANGUAGE sql SET search_path = public AS $$
  UPDATE workspace_counters SET value = value + 1
  WHERE workspace_id = app_workspace_id() AND name = 'issue'
  RETURNING value::int
$$;
REVOKE ALL ON FUNCTION next_issue_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION next_issue_number() TO tickzy_app;
