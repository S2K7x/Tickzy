-- 0006 external sign-in identities (T-101b, ADR-024): Google and Microsoft via OpenID Connect.
-- Global (not tenant) data, like sessions: RLS forced and no grants; reachable only through auth_oauth_sign_in().

CREATE TABLE user_identities (
  id              text PRIMARY KEY CHECK (id LIKE 'idn\_%'),
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  subject         text NOT NULL,      -- immutable provider key: Google `sub`; Microsoft `tid:oid` (never the email)
  email_at_link   citext NOT NULL,    -- informational: the verified email that created the link
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);
CREATE INDEX user_identities_user_idx ON user_identities (user_id);
ALTER TABLE user_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_identities FORCE ROW LEVEL SECURITY;

-- Resolve an OIDC sign-in to a user id.
--  1. A known (provider, subject) always maps to its linked user — email changes at the provider never re-key it.
--  2. Otherwise the email may be used to find or create the user ONLY if the caller verified the provider vouches
--     for it (p_email_trusted); else raise 'email_unverified' (prevents nOAuth-style takeover by mutable email).
CREATE OR REPLACE FUNCTION auth_oauth_sign_in(
  p_provider text, p_subject text, p_email text, p_email_trusted boolean, p_name text, p_new_user_id text, p_identity_id text)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  DECLARE v_user text;
  BEGIN
    UPDATE user_identities SET last_used_at = now()
      WHERE provider = p_provider AND subject = p_subject RETURNING user_id INTO v_user;
    IF v_user IS NOT NULL THEN RETURN v_user; END IF;

    IF NOT coalesce(p_email_trusted, false) OR p_email IS NULL OR p_email = '' THEN
      RAISE EXCEPTION 'email_unverified' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO users (id, email, name) VALUES (p_new_user_id, lower(p_email), coalesce(p_name, ''))
      ON CONFLICT (email) DO UPDATE SET name = CASE WHEN users.name = '' THEN EXCLUDED.name ELSE users.name END,
                                        updated_at = now()
      RETURNING id INTO v_user;
    INSERT INTO user_identities (id, user_id, provider, subject, email_at_link)
      VALUES (p_identity_id, v_user, p_provider, p_subject, lower(p_email))
      ON CONFLICT (provider, subject) DO NOTHING;   -- concurrent first sign-ins: both resolve to the same user
    RETURN v_user;
  END $$;

REVOKE ALL ON FUNCTION auth_oauth_sign_in(text, text, text, boolean, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_oauth_sign_in(text, text, text, boolean, text, text, text) TO tickzy_app;
