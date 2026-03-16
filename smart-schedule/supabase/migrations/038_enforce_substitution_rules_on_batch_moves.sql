-- 038_enforce_substitution_rules_on_batch_moves.sql
-- Reject batch reassignment to a different mixer unless an enabled
-- substitution rule explicitly allows the move.

CREATE OR REPLACE FUNCTION enforce_batch_substitution_rule()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_allowed BOOLEAN;
BEGIN
  -- New inserts and first-time assignments are allowed. This guard only applies
  -- when an already-assigned batch is moved to a different resource.
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW.plan_resource_id IS NULL
     OR OLD.plan_resource_id IS NULL
     OR NEW.plan_resource_id = OLD.plan_resource_id THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM substitution_rules sr
    WHERE sr.site_id = NEW.site_id
      AND sr.enabled = TRUE
      AND (sr.source_resource_id IS NULL OR sr.source_resource_id = OLD.plan_resource_id)
      AND (sr.target_resource_id IS NULL OR sr.target_resource_id = NEW.plan_resource_id)
      AND (
        sr.conditions IS NULL
        OR (
          (
            NOT (sr.conditions ? 'maxVolume')
            OR NEW.batch_volume IS NULL
            OR NEW.batch_volume <= (sr.conditions->>'maxVolume')::NUMERIC
          )
          AND (
            NOT (sr.conditions ? 'minVolume')
            OR NEW.batch_volume IS NULL
            OR NEW.batch_volume >= (sr.conditions->>'minVolume')::NUMERIC
          )
          AND (
            NOT (sr.conditions ? 'colorGroups')
            OR jsonb_array_length(sr.conditions->'colorGroups') = 0
            OR NEW.sap_color_group IS NULL
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(sr.conditions->'colorGroups') AS allowed_group(value)
              WHERE allowed_group.value = NEW.sap_color_group
            )
          )
        )
      )
  )
  INTO v_allowed;

  IF NOT v_allowed THEN
    RAISE EXCEPTION
      USING
        ERRCODE = '23514',
        MESSAGE = 'No substitution rule allows this mixer change';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_batch_substitution_rule_on_batches ON batches;

CREATE TRIGGER enforce_batch_substitution_rule_on_batches
  BEFORE INSERT OR UPDATE OF plan_resource_id, batch_volume, sap_color_group ON batches
  FOR EACH ROW
  EXECUTE FUNCTION enforce_batch_substitution_rule();
