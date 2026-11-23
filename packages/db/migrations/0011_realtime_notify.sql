-- 0011 realtime fan-out (T-208, architecture §6 realtime): every outbox event is announced on NOTIFY `tz_events`
-- with ids only (≤ 8 KB; never content). Notifications are delivered at commit, so subscribers never see rolled-back
-- changes. Each API node LISTENs and forwards to its WebSocket subscribers, which refetch through the API (RLS).
CREATE OR REPLACE FUNCTION outbox_realtime_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('tz_events', json_build_object(
    'w', NEW.workspace_id, 't', NEW.type,
    'i', NEW.payload ->> 'issue_id', 'm', NEW.payload ->> 'message_id')::text);
  RETURN NULL;
END $$;
CREATE TRIGGER outbox_realtime_notify AFTER INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION outbox_realtime_notify();
