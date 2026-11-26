-- 0014 channels & ingestion core (T-301, ADR-032; threat model §6.1).
-- channel_connections: a provider installation (one Slack workspace, the email domain set-up, a widget key).
-- channel_endpoints: where messages arrive (a Slack channel, a forwarding address, a widget).
-- inbound_events: every provider webhook, persisted BEFORE it is acknowledged, deduplicated by the provider's event id,
-- then processed asynchronously by the worker.
-- Tenant routing happens before any tenant is known, so it goes through two narrow SECURITY DEFINER functions
-- (added to the ADR-022 registry; they work on a non-superuser owner through the ADR-031 owner policy); everything
-- else is tenant-scoped with forced RLS and composite foreign keys.

CREATE TABLE channel_connections (
  id                  text PRIMARY KEY CHECK (id LIKE 'chc\_%'),
  workspace_id        text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('slack', 'email', 'widget')),
  -- Provider-side tenant id used for routing (Slack team id). NULL when routing is by endpoint (email, widget).
  external_tenant_id  text CHECK (external_tenant_id IS NULL OR length(external_tenant_id) BETWEEN 1 AND 200),
  -- Provider credentials, envelope-encrypted by the application (SEC-6); never readable as plain text here.
  credentials_enc     bytea,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'revoked')),
  settings            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
-- One active connection per provider tenant across ALL workspaces: otherwise routing would be ambiguous.
CREATE UNIQUE INDEX channel_connections_route_uniq ON channel_connections (kind, external_tenant_id)
  WHERE external_tenant_id IS NOT NULL AND status = 'active';

CREATE TABLE channel_endpoints (
  id                  text PRIMARY KEY CHECK (id LIKE 'che\_%'),
  workspace_id        text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id       text NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('slack_channel', 'email_address', 'widget')),
  -- Slack channel id, forwarding address (lower-case), widget key.
  external_id         text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 320),
  name                text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  endpoint_type       text NOT NULL DEFAULT 'customer' CHECK (endpoint_type IN ('customer', 'community', 'internal', 'triage')),
  default_account_id  text,
  ingestion_mode      text NOT NULL DEFAULT 'thread' CHECK (ingestion_mode IN ('thread', 'time', 'emoji', 'ai')),
  settings            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, connection_id) REFERENCES channel_connections (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, default_account_id) REFERENCES accounts (workspace_id, id)
);
-- A Slack channel is unique within its installation (shared channels keep one id across organisations, so not
-- globally); a forwarding address and a widget key are globally unique (they route mail / visitors to one workspace).
CREATE UNIQUE INDEX channel_endpoints_per_connection_uniq ON channel_endpoints (connection_id, external_id);
CREATE UNIQUE INDEX channel_endpoints_route_uniq ON channel_endpoints (kind, external_id)
  WHERE kind IN ('email_address', 'widget') AND status = 'active';

-- The foreign key 0008 deferred to this task.
ALTER TABLE conversations
  ADD CONSTRAINT conversations_endpoint_fk FOREIGN KEY (workspace_id, endpoint_id) REFERENCES channel_endpoints (workspace_id, id);

CREATE TABLE inbound_events (
  id                  text PRIMARY KEY CHECK (id LIKE 'ine\_%'),
  workspace_id        text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel             text NOT NULL CHECK (channel IN ('slack', 'email', 'widget')),
  connection_id       text,
  endpoint_id         text,
  provider_event_id   text NOT NULL CHECK (length(provider_event_id) BETWEEN 1 AND 300),
  payload             jsonb NOT NULL,
  status              text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  attempts            integer NOT NULL DEFAULT 0,
  last_error          text CHECK (last_error IS NULL OR length(last_error) <= 2000),
  received_at         timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, connection_id) REFERENCES channel_connections (workspace_id, id) ON DELETE SET NULL (connection_id),
  FOREIGN KEY (workspace_id, endpoint_id) REFERENCES channel_endpoints (workspace_id, id) ON DELETE SET NULL (endpoint_id)
);
-- Provider retries carry the same event id: the second copy is ignored (threat model §6.1 replay/dedupe).
CREATE UNIQUE INDEX inbound_events_dedupe_uniq ON inbound_events (workspace_id, channel, provider_event_id);
CREATE INDEX inbound_events_status_idx ON inbound_events (workspace_id, status, received_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['channel_connections', 'channel_endpoints', 'inbound_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id())', t);
    -- The routing functions below run as this (owner) role before any tenant is known (ADR-031).
    EXECUTE format('CREATE POLICY definer_owner_access ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', t, current_user);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON channel_connections, channel_endpoints TO tickzy_app;
-- Raw events are never deleted by the app path (retention job only) and their payload is immutable.
GRANT SELECT, INSERT ON inbound_events TO tickzy_app;
GRANT UPDATE (status, attempts, last_error, processed_at) ON inbound_events TO tickzy_app;

-- Tenant routing for webhooks (cross-tenant by nature; registry ADR-022). Each returns at most one row and only the
-- ids needed to continue inside that tenant — never credentials or settings.
CREATE OR REPLACE FUNCTION ingest_route_connection(p_kind text, p_external_tenant_id text)
  RETURNS TABLE (workspace_id text, connection_id text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT c.workspace_id, c.id FROM channel_connections c
    WHERE c.kind = p_kind AND c.external_tenant_id = p_external_tenant_id AND c.status = 'active'
    LIMIT 1
  $$;

CREATE OR REPLACE FUNCTION ingest_route_endpoint(p_kind text, p_external_id text)
  RETURNS TABLE (workspace_id text, connection_id text, endpoint_id text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT e.workspace_id, e.connection_id, e.id FROM channel_endpoints e
    JOIN channel_connections c ON c.workspace_id = e.workspace_id AND c.id = e.connection_id AND c.status = 'active'
    WHERE e.kind = p_kind AND e.external_id = p_external_id AND e.status = 'active'
      AND p_kind IN ('email_address', 'widget')
    LIMIT 1
  $$;

REVOKE ALL ON FUNCTION ingest_route_connection(text, text), ingest_route_endpoint(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ingest_route_connection(text, text), ingest_route_endpoint(text, text) TO tickzy_app;

-- Retention (threat model §6.1): raw provider payloads are kept for a limited time. The app role cannot delete
-- inbound events; the worker calls this narrow function, which only removes finished events older than the cut-off.
CREATE OR REPLACE FUNCTION purge_inbound_events(p_older_than interval)
  RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    WITH gone AS (
      DELETE FROM inbound_events
      WHERE status IN ('processed', 'ignored', 'failed') AND received_at < now() - greatest(p_older_than, interval '1 day')
      RETURNING 1
    )
    SELECT count(*)::int FROM gone
  $$;
REVOKE ALL ON FUNCTION purge_inbound_events(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_inbound_events(interval) TO tickzy_app;
