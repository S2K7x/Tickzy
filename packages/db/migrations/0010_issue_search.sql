-- 0010 search (T-207, FR-3.8; ADR-028).
-- 'simple' configuration: no stemming, language-neutral (support text is mixed-language and full of product terms);
-- the API uses websearch_to_tsquery so users get "phrases" and -negation.
ALTER TABLE issues ADD COLUMN search tsvector GENERATED ALWAYS AS (to_tsvector('simple', title)) STORED;
CREATE INDEX issues_search_idx ON issues USING gin (search);
-- `from:` filters messages by author (text equality is leakproof, so this index works under RLS).
CREATE INDEX messages_ws_author_idx ON messages (workspace_id, author_type, author_id);

-- Under row-level security PostgreSQL cannot use the full-text index: `@@` (ts_match_vq) is not LEAKPROOF, so it is
-- evaluated after the policy, i.e. as a filter over every message of the workspace (measured: 1.3 ms with the index
-- vs 47 ms at 100k messages, linear). The full-text part therefore runs in two narrow SECURITY DEFINER functions owned
-- by `tickzy_system` (BYPASSRLS, NOLOGIN, planned in database.md), which filter on the caller's workspace explicitly
-- and return only ids and ranks; the API loads the rows under RLS as usual.
CREATE OR REPLACE FUNCTION search_message_hits(p_query text, p_internal_only boolean, p_contacts text[], p_users text[], p_limit int)
  RETURNS TABLE (issue_id text, message_id text, rank real)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    WITH q AS (SELECT websearch_to_tsquery('simple', p_query) AS q),
    hits AS (
      SELECT m.issue_id, m.id, ts_rank(m.search, q.q) AS rank, m.created_at
      FROM messages m, q
      WHERE m.workspace_id = app_workspace_id()            -- explicit tenant filter (no RLS here)
        AND m.search @@ q.q
        AND m.issue_id IS NOT NULL AND m.deleted_at IS NULL
        AND (NOT p_internal_only OR m.visibility = 'internal')
        AND (p_contacts IS NULL AND p_users IS NULL
             OR (m.author_type = 'contact' AND m.author_id = ANY (p_contacts))
             OR (m.author_type = 'member' AND m.author_id = ANY (p_users)))
    )
    SELECT DISTINCT ON (h.issue_id) h.issue_id, h.id, h.rank FROM hits h
    ORDER BY h.issue_id, h.rank DESC, h.created_at DESC
    LIMIT greatest(1, least(p_limit, 5000))
  $$;

CREATE OR REPLACE FUNCTION search_issue_title_hits(p_query text, p_limit int)
  RETURNS TABLE (issue_id text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT i.id FROM issues i
    WHERE i.workspace_id = app_workspace_id() AND i.search @@ websearch_to_tsquery('simple', p_query)
    LIMIT greatest(1, least(p_limit, 5000))
  $$;

REVOKE ALL ON FUNCTION search_message_hits(text, boolean, text[], text[], int), search_issue_title_hits(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_message_hits(text, boolean, text[], text[], int), search_issue_title_hits(text, int) TO tickzy_app;

-- Hand the functions to tickzy_system when this database role is allowed to create a BYPASSRLS role. Otherwise they
-- stay owned by the migration role: still correct (RLS applies), but without the index — the server logs a warning.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tickzy_system') THEN
    BEGIN
      CREATE ROLE tickzy_system NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'tickzy_system not created (needs BYPASSRLS); search runs without its full-text index';
      RETURN;
    END;
  END IF;
  IF NOT pg_has_role(current_user, 'tickzy_system', 'SET') THEN
    BEGIN
      EXECUTE format('GRANT tickzy_system TO %I', current_user);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'cannot act as tickzy_system; search runs without its full-text index';
      RETURN;
    END;
  END IF;
  GRANT USAGE ON SCHEMA public TO tickzy_system;
  GRANT SELECT ON messages, issues TO tickzy_system;
  GRANT EXECUTE ON FUNCTION app_workspace_id() TO tickzy_system;
  ALTER FUNCTION search_message_hits(text, boolean, text[], text[], int) OWNER TO tickzy_system;
  ALTER FUNCTION search_issue_title_hits(text, int) OWNER TO tickzy_system;
END $$;

-- Lets the app report whether search runs with its index (owner bypasses RLS).
CREATE OR REPLACE FUNCTION search_index_available() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT r.rolbypassrls FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.proname = 'search_message_hits'), false)
$$;
GRANT EXECUTE ON FUNCTION search_index_available() TO tickzy_app;
