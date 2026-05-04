-- pg LISTEN/NOTIFY triggers for real-time event streaming.
-- Replaces the 2-second polling loop in the SSE events route.
--
-- Channel: pilot_events
-- Payload shape: {"type": "<event_type>", "workspace_id": "<uuid>", "id": "<row_id>", "status": "..."}

CREATE OR REPLACE FUNCTION pilot_notify_task_change() RETURNS TRIGGER AS $$
DECLARE
  payload JSONB;
BEGIN
  payload := jsonb_build_object(
    'type', 'task.' || TG_OP,
    'workspace_id', NEW.workspace_id,
    'id', NEW.id,
    'status', NEW.status,
    'updated_at', NEW.updated_at
  );
  PERFORM pg_notify('pilot_events', payload::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_notify_change ON tasks;
CREATE TRIGGER tasks_notify_change
  AFTER INSERT OR UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION pilot_notify_task_change();

-- Approvals notifier (pending → approved/rejected transitions matter for the UI)
CREATE OR REPLACE FUNCTION pilot_notify_approval_change() RETURNS TRIGGER AS $$
DECLARE
  payload JSONB;
BEGIN
  payload := jsonb_build_object(
    'type', 'approval.' || TG_OP,
    'workspace_id', NEW.workspace_id,
    'id', NEW.id,
    'status', NEW.status,
    'task_id', NEW.task_id
  );
  PERFORM pg_notify('pilot_events', payload::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS approvals_notify_change ON approvals;
CREATE TRIGGER approvals_notify_change
  AFTER INSERT OR UPDATE ON approvals
  FOR EACH ROW
  EXECUTE FUNCTION pilot_notify_approval_change();
