-- 0015 email inbound (T-302a, ADR-033; threat model §6.3).
-- messages.meta: per-message channel facts the UI must show (automated mail, sender not verified, likely spam,
--   original subject, attachments not imported yet). Never used for authorisation.
-- conversations.reply_token: unguessable per-thread token placed in our Reply-To (support+<token>@…); a reply
--   carrying it is threaded to that conversation even when the sender cannot be verified (threat model TM-6).
ALTER TABLE messages ADD COLUMN meta jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(meta) = 'object' AND pg_column_size(meta) <= 8192);
ALTER TABLE conversations ADD COLUMN reply_token text
  CHECK (reply_token IS NULL OR reply_token ~ '^[a-z2-7]{26,64}$');
CREATE UNIQUE INDEX conversations_reply_token_uniq ON conversations (workspace_id, reply_token) WHERE reply_token IS NOT NULL;
