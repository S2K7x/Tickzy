-- 0013 SECURITY DEFINER functions under FORCE ROW LEVEL SECURITY on a managed (non-superuser) database (ADR-031).
--
-- Bug found 2026-11-26: the cross-tenant entry points of the ADR-022 registry (auth_*, api_token_*, invitation_*,
-- my_memberships, upsert_user, claim_outbox, auth_oauth_sign_in) run as their owner, the migration role. FORCE RLS
-- applies to table owners too, and these functions run before any app.workspace_id is set — so with an owner that
-- is not a superuser (the normal case on managed Postgres) they saw NO rows: API tokens, sessions, magic links and
-- invitations would all fail in production. Locally and in CI the owner is a superuser, which bypasses RLS, so tests
-- could not see it.
--
-- Fix: every RLS table gets a policy that admits exactly the migration/owner role. This grants the owner nothing it
-- does not already have (as table owner it may disable RLS at will); the runtime role tickzy_app is not a member of
-- the owner role, so tenant isolation for the application is unchanged (asserted by a test). New RLS tables must add
-- the same policy (database.md conventions; a migration test fails otherwise).
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    EXECUTE format('CREATE POLICY definer_owner_access ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', t, current_user);
  END LOOP;
END $$;
