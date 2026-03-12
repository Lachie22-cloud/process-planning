-- 006_triggers.sql: Updated_at auto-update + audit logging triggers

-- ============================================================
-- GENERIC updated_at TRIGGER FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Apply to batches
CREATE TRIGGER set_batches_updated_at
  BEFORE UPDATE ON batches
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

-- Apply to site_users
CREATE TRIGGER set_site_users_updated_at
  BEFORE UPDATE ON site_users
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

-- ============================================================
-- AUDIT LOG TRIGGER FOR BATCH STATUS CHANGES
-- Automatically logs status changes on the batches table
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_batch_status_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only log when status actually changes
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO audit_log (site_id, batch_id, action, details, performed_by)
    VALUES (
      NEW.site_id,
      NEW.id,
      'status_change',
      jsonb_build_object(
        'old_status', OLD.status,
        'new_status', NEW.status,
        'comment', NEW.status_comment,
        'trigger', TRUE
      ),
      NEW.status_changed_by
    );
  END IF;

  -- Log resource/date changes (batch moves)
  IF OLD.plan_resource_id IS DISTINCT FROM NEW.plan_resource_id
     OR OLD.plan_date IS DISTINCT FROM NEW.plan_date THEN
    INSERT INTO audit_log (site_id, batch_id, action, details, performed_by)
    VALUES (
      NEW.site_id,
      NEW.id,
      'batch_reassigned',
      jsonb_build_object(
        'old_resource_id', OLD.plan_resource_id,
        'new_resource_id', NEW.plan_resource_id,
        'old_date', OLD.plan_date,
        'new_date', NEW.plan_date,
        'trigger', TRUE
      ),
      NEW.status_changed_by
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER batch_status_audit
  AFTER UPDATE ON batches
  FOR EACH ROW
  EXECUTE FUNCTION trigger_batch_status_audit();
