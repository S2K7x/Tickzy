-- 0003 authentication core (T-101, ADR-021): sessions and magic-link tokens.
-- The runtime role has NO direct privileges on these tables; it uses the auth_* SECURITY DEFINER functions only.

CREATE TABLE sessions (
  id            text PRIMARY KEY,                     -- public half of the token (random, base32)
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret_hash   bytea NOT NULL,                       -- SHA-256 of the secret half
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  user_agent    text,
  ip            inet
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE login_tokens (
  id            text PRIMARY KEY,
  email         citext NOT NULL,
  secret_hash   bytea NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  ip            inet
);
CREATE INDEX login_tokens_email_created_idx ON login_tokens (email, created_at DESC);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE login_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_tokens FORCE ROW LEVEL SECURITY;
-- No policies and no grants: unreachable for tickzy_app except through the functions below.

-- Issue a magic-link token. Raises 'rate_limited' when the email already received p_max tokens in p_window.
CREATE OR REPLACE FUNCTION auth_issue_login_token(
  p_id text, p_email text, p_secret_hash bytea, p_expires_at timestamptz, p_ip inet, p_max int, p_window interval)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  BEGIN
    IF (SELECT count(*) FROM login_tokens WHERE email = p_email AND created_at > now() - p_window) >= p_max THEN
      RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO login_tokens (id, email, secret_hash, expires_at, ip) VALUES (p_id, p_email, p_secret_hash, p_expires_at, p_ip);
  END $$;

-- Atomically consume a magic-link token: returns the email when the token exists, matches, is unexpired and unused.
-- Secrets are 256-bit random values, so comparing their hashes in SQL leaks nothing useful through timing.
CREATE OR REPLACE FUNCTION auth_consume_login_token(p_id text, p_secret_hash bytea)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  DECLARE v_email text;
  BEGIN
    UPDATE login_tokens SET used_at = now()
      WHERE id = p_id AND secret_hash = p_secret_hash AND used_at IS NULL AND expires_at > now()
      RETURNING email INTO v_email;
    RETURN v_email;
  END $$;

CREATE OR REPLACE FUNCTION auth_create_session(
  p_id text, p_user_id text, p_secret_hash bytea, p_expires_at timestamptz, p_user_agent text, p_ip inet)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    INSERT INTO sessions (id, user_id, secret_hash, expires_at, user_agent, ip)
    VALUES (p_id, p_user_id, p_secret_hash, p_expires_at, left(p_user_agent, 512), p_ip)
  $$;

-- Returns the session row (incl. secret hash for constant-time comparison in the app); expired sessions are deleted.
CREATE OR REPLACE FUNCTION auth_get_session(p_id text)
  RETURNS TABLE (user_id text, secret_hash bytea, expires_at timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  BEGIN
    DELETE FROM sessions s WHERE s.id = p_id AND s.expires_at <= now();
    RETURN QUERY SELECT s.user_id, s.secret_hash, s.expires_at FROM sessions s WHERE s.id = p_id;
  END $$;

CREATE OR REPLACE FUNCTION auth_extend_session(p_id text, p_expires_at timestamptz)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE sessions SET expires_at = p_expires_at, last_used_at = now() WHERE id = p_id
  $$;

CREATE OR REPLACE FUNCTION auth_delete_session(p_id text)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    DELETE FROM sessions WHERE id = p_id
  $$;

-- Only the signed-in user can revoke their own sessions (app.user_id is set by the caller's session).
CREATE OR REPLACE FUNCTION auth_delete_my_sessions()
  RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    WITH d AS (DELETE FROM sessions WHERE user_id = app_user_id() RETURNING 1) SELECT count(*)::int FROM d
  $$;

-- Housekeeping (worker job): purge expired sessions and old login tokens.
CREATE OR REPLACE FUNCTION auth_purge_expired()
  RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    WITH s AS (DELETE FROM sessions WHERE expires_at <= now() RETURNING 1),
         t AS (DELETE FROM login_tokens WHERE created_at < now() - interval '1 day' RETURNING 1)
    SELECT ((SELECT count(*) FROM s) + (SELECT count(*) FROM t))::int
  $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'auth_issue_login_token(text,text,bytea,timestamptz,inet,int,interval)',
    'auth_consume_login_token(text,bytea)',
    'auth_create_session(text,text,bytea,timestamptz,text,inet)',
    'auth_get_session(text)',
    'auth_extend_session(text,timestamptz)',
    'auth_delete_session(text)',
    'auth_delete_my_sessions()',
    'auth_purge_expired()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO tickzy_app', f);
  END LOOP;
END $$;
