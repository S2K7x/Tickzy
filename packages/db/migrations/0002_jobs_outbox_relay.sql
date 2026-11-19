-- 0002 job queue + outbox relay (T-009, ADR-007, ADR-020).

-- pg-boss keeps its own tables in this schema and runs its own internal migrations on start.
-- The schema holds queue metadata only (no tenant data), so the runtime role may own it.
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION tickzy_app;

-- Wake the relay as soon as events are committed (statement-level: one notify per insert statement).
CREATE OR REPLACE FUNCTION outbox_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('tz_outbox', '');
  RETURN NULL;
END $$;
CREATE TRIGGER outbox_notify AFTER INSERT ON outbox FOR EACH STATEMENT EXECUTE FUNCTION outbox_notify();

-- Cross-tenant relay entry point. Claims up to p_limit unpublished events (skipping rows locked by another
-- relay), marks them published and returns them. MUST be called inside the same transaction that enqueues the
-- resulting jobs, so a failed enqueue rolls the claim back (no event is ever lost).
CREATE OR REPLACE FUNCTION claim_outbox(p_limit int)
  RETURNS TABLE (id bigint, workspace_id text, type text, payload jsonb, created_at timestamptz)
  LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    WITH picked AS (
      SELECT o.id FROM outbox o
      WHERE o.published_at IS NULL
      ORDER BY o.id
      LIMIT greatest(1, least(p_limit, 500))
      FOR UPDATE SKIP LOCKED
    )
    UPDATE outbox o SET published_at = now()
    FROM picked WHERE o.id = picked.id
    RETURNING o.id, o.workspace_id, o.type, o.payload, o.created_at
  $$;

REVOKE ALL ON FUNCTION claim_outbox(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_outbox(int) TO tickzy_app;
