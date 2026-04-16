-- Ensure disperser resource assignments travel with the batch during all move
-- operations (drag-drop, reschedule tool, AI drafts).  Previously only
-- plan_resource_id and plan_date were updated; disperser columns were left
-- out of the write path so they survived by accident rather than by contract.

-- 1. Add disperser columns to schedule_movements so movement history is complete.
ALTER TABLE schedule_movements
  ADD COLUMN IF NOT EXISTS disperser1_id UUID REFERENCES resources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disperser2_id UUID REFERENCES resources(id) ON DELETE SET NULL;

COMMENT ON COLUMN schedule_movements.disperser1_id IS 'Disperser 1 resource at time of move (carried with batch)';
COMMENT ON COLUMN schedule_movements.disperser2_id IS 'Disperser 2 resource at time of move (carried with batch)';

-- 2. Patch apply_ai_draft so schedule_change and resource_rebalance drafts
--    explicitly carry plan_disperser_id / plan_disperser2_id.
CREATE OR REPLACE FUNCTION public.apply_ai_draft(
  p_draft_id UUID,
  p_user_id  UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft       RECORD;
  v_payload     JSONB;
  v_change      JSONB;
  v_batch_id    UUID;
  v_resource_id UUID;
  v_source_id   UUID;
  v_target_id   UUID;
  v_conditions  JSONB;
  v_now         TIMESTAMPTZ := NOW();
BEGIN
  -- Step 1: Lock & validate draft
  SELECT * INTO v_draft
  FROM ai_drafts
  WHERE id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DRAFT_NOT_FOUND: %', p_draft_id;
  END IF;
  IF v_draft.status <> 'approved' THEN
    RAISE EXCEPTION 'DRAFT_NOT_APPROVED: current status is %', v_draft.status;
  END IF;

  v_payload := v_draft.payload;

  -- Step 2: Validate payload structure
  CASE v_draft.draft_type
    WHEN 'schedule_change' THEN
      IF v_payload->'changes' IS NULL OR jsonb_typeof(v_payload->'changes') <> 'array' THEN
        RAISE EXCEPTION 'PAYLOAD_INVALID: schedule_change requires a "changes" array';
      END IF;
      FOR v_change IN SELECT jsonb_array_elements(v_payload->'changes')
      LOOP
        IF v_change->>'batch_id' IS NULL THEN
          RAISE EXCEPTION 'PAYLOAD_INVALID: each change must include batch_id';
        END IF;
      END LOOP;

    WHEN 'rule_suggestion' THEN
      IF v_payload->'rules' IS NULL OR jsonb_typeof(v_payload->'rules') <> 'array' THEN
        RAISE EXCEPTION 'PAYLOAD_INVALID: rule_suggestion requires a "rules" array';
      END IF;

    WHEN 'resource_rebalance' THEN
      IF v_payload->'assignments' IS NULL OR jsonb_typeof(v_payload->'assignments') <> 'array' THEN
        RAISE EXCEPTION 'PAYLOAD_INVALID: resource_rebalance requires an "assignments" array';
      END IF;

    ELSE
      RAISE EXCEPTION 'PAYLOAD_INVALID: unknown draft_type %', v_draft.draft_type;
  END CASE;

  -- Step 3: Apply domain mutations based on draft_type
  CASE v_draft.draft_type
    WHEN 'schedule_change' THEN
      FOR v_change IN SELECT jsonb_array_elements(v_payload->'changes')
      LOOP
        v_batch_id := (v_change->>'batch_id')::UUID;
        -- Verify batch exists and belongs to the same site
        IF NOT EXISTS (
          SELECT 1 FROM batches WHERE id = v_batch_id AND site_id = v_draft.site_id
        ) THEN
          RAISE EXCEPTION 'DOMAIN_ERROR: batch % not found in site %', v_batch_id, v_draft.site_id;
        END IF;
        -- Apply optional mutations: plan_date, plan_resource_id, status, dispersers
        UPDATE batches SET
          plan_date = COALESCE((v_change->>'plan_date')::DATE, plan_date),
          plan_resource_id = COALESCE((v_change->>'plan_resource_id')::UUID, plan_resource_id),
          plan_disperser_id = COALESCE((v_change->>'plan_disperser_id')::UUID, plan_disperser_id),
          plan_disperser2_id = COALESCE((v_change->>'plan_disperser2_id')::UUID, plan_disperser2_id),
          status = COALESCE(v_change->>'status', status),
          updated_at = v_now
        WHERE id = v_batch_id AND site_id = v_draft.site_id;
      END LOOP;

    WHEN 'rule_suggestion' THEN
      FOR v_change IN SELECT jsonb_array_elements(v_payload->'rules')
      LOOP
        v_source_id := (v_change->>'source_resource_id')::UUID;
        v_target_id := (v_change->>'target_resource_id')::UUID;
        v_conditions := COALESCE(v_change->'conditions', '{}'::JSONB);
        IF NOT EXISTS (
          SELECT 1 FROM resources WHERE id = v_source_id AND site_id = v_draft.site_id
        ) THEN
          RAISE EXCEPTION 'DOMAIN_ERROR: source resource % not found in site %', v_source_id, v_draft.site_id;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM resources WHERE id = v_target_id AND site_id = v_draft.site_id
        ) THEN
          RAISE EXCEPTION 'DOMAIN_ERROR: target resource % not found in site %', v_target_id, v_draft.site_id;
        END IF;
        INSERT INTO substitution_rules (site_id, source_resource_id, target_resource_id, conditions, enabled, created_by)
        VALUES (v_draft.site_id, v_source_id, v_target_id, v_conditions, TRUE, p_user_id);
      END LOOP;

    WHEN 'resource_rebalance' THEN
      FOR v_change IN SELECT jsonb_array_elements(v_payload->'assignments')
      LOOP
        v_batch_id := (v_change->>'batch_id')::UUID;
        v_resource_id := (v_change->>'new_resource_id')::UUID;
        IF NOT EXISTS (
          SELECT 1 FROM batches WHERE id = v_batch_id AND site_id = v_draft.site_id
        ) THEN
          RAISE EXCEPTION 'DOMAIN_ERROR: batch % not found in site %', v_batch_id, v_draft.site_id;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM resources WHERE id = v_resource_id AND site_id = v_draft.site_id
        ) THEN
          RAISE EXCEPTION 'DOMAIN_ERROR: resource % not found in site %', v_resource_id, v_draft.site_id;
        END IF;
        -- Reassign batch — carry dispersers explicitly
        UPDATE batches SET
          plan_resource_id = v_resource_id,
          plan_disperser_id = COALESCE((v_change->>'plan_disperser_id')::UUID, plan_disperser_id),
          plan_disperser2_id = COALESCE((v_change->>'plan_disperser2_id')::UUID, plan_disperser2_id),
          updated_at = v_now
        WHERE id = v_batch_id AND site_id = v_draft.site_id;
      END LOOP;
  END CASE;

  -- Step 4: Mark draft as applied
  UPDATE ai_drafts SET
    status = 'applied',
    applied_by = p_user_id,
    applied_at = v_now,
    updated_at = v_now
  WHERE id = p_draft_id;

  RETURN jsonb_build_object(
    'id', p_draft_id,
    'status', 'applied',
    'appliedAt', v_now
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_ai_draft(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_ai_draft(UUID, UUID) TO service_role;

-- 3. Patch the move_batch RPC so it explicitly carries disperser assignments
--    and records them in schedule_movements + audit_log.
CREATE OR REPLACE FUNCTION move_batch(
  p_batch_id UUID,
  p_resource_id UUID,
  p_date DATE,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_batch batches%ROWTYPE;
  v_user_id UUID;
  v_user_site_id UUID;
  v_from_resource_id UUID;
  v_from_date DATE;
  v_target_resource_site_id UUID;
BEGIN
  v_user_id := auth.current_user_id();
  v_user_site_id := auth.user_site_id();

  -- Get current batch
  SELECT * INTO v_batch FROM batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Batch not found');
  END IF;
  IF NOT auth.is_super_admin() AND v_batch.site_id IS DISTINCT FROM v_user_site_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Access denied for batch');
  END IF;

  SELECT site_id INTO v_target_resource_site_id
  FROM resources
  WHERE id = p_resource_id;

  IF v_target_resource_site_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Target resource not found');
  END IF;

  IF v_target_resource_site_id IS DISTINCT FROM v_batch.site_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Target resource is outside batch site');
  END IF;

  IF NOT auth.is_super_admin() AND v_target_resource_site_id IS DISTINCT FROM v_user_site_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Access denied for target resource');
  END IF;

  v_from_resource_id := v_batch.plan_resource_id;
  v_from_date := v_batch.plan_date;

  -- Update the batch — explicitly carry disperser assignments with the move
  UPDATE batches SET
    plan_resource_id = p_resource_id,
    plan_date = p_date,
    plan_disperser_id = v_batch.plan_disperser_id,
    plan_disperser2_id = v_batch.plan_disperser2_id,
    updated_at = NOW()
  WHERE id = p_batch_id;

  -- Record the movement (now includes disperser IDs)
  INSERT INTO schedule_movements (
    site_id, batch_id, from_resource_id, to_resource_id,
    from_date, to_date, direction, reason, moved_by,
    disperser1_id, disperser2_id
  )
  VALUES (
    v_batch.site_id, p_batch_id, v_from_resource_id, p_resource_id,
    v_from_date, p_date,
    CASE
      WHEN v_from_resource_id = p_resource_id THEN 'pushed'
      WHEN v_from_date = p_date THEN 'moved'
      ELSE 'moved'
    END,
    p_reason,
    v_user_id,
    v_batch.plan_disperser_id,
    v_batch.plan_disperser2_id
  );

  -- Create audit log entry (includes dispersers)
  INSERT INTO audit_log (site_id, batch_id, action, details, performed_by)
  VALUES (
    v_batch.site_id,
    p_batch_id,
    'batch_moved',
    jsonb_build_object(
      'from_resource_id', v_from_resource_id,
      'to_resource_id', p_resource_id,
      'from_date', v_from_date,
      'to_date', p_date,
      'disperser1_id', v_batch.plan_disperser_id,
      'disperser2_id', v_batch.plan_disperser2_id,
      'reason', p_reason
    ),
    v_user_id
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'batch_id', p_batch_id,
    'from_resource_id', v_from_resource_id,
    'to_resource_id', p_resource_id,
    'from_date', v_from_date,
    'to_date', p_date,
    'disperser1_id', v_batch.plan_disperser_id,
    'disperser2_id', v_batch.plan_disperser2_id
  );
END;
$$;

-- 4. Patch the batch audit trigger so the batch_reassigned log entry includes
--    disperser resources alongside the mixer — gives full visibility in audit.
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

  -- Log resource/date changes (batch moves) — includes disperser assignments
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
        'disperser1_id', NEW.plan_disperser_id,
        'disperser2_id', NEW.plan_disperser2_id,
        'trigger', TRUE
      ),
      NEW.status_changed_by
    );
  END IF;

  RETURN NEW;
END;
$$;
