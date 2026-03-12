-- 004_functions.sql: RPC functions (stored procedures)
-- get_schedule_week, get_resource_view, update_batch_status, move_batch,
-- get_statistics, get_audit_history, check_resource_availability,
-- import_batches, get_unread_notification_count, upsert_site_user

-- ============================================================
-- GET_SCHEDULE_WEEK
-- Returns batches + fill orders + alerts for a given week
-- ============================================================
CREATE OR REPLACE FUNCTION get_schedule_week(
  p_site_id UUID,
  p_week_ending DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_site_id UUID;
  v_week_start DATE;
  v_result JSONB;
BEGIN
  v_user_site_id := auth.user_site_id();
  IF NOT auth.is_super_admin() AND p_site_id IS DISTINCT FROM v_user_site_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Access denied for site');
  END IF;

  -- Calculate week start (7 days before week ending)
  v_week_start := p_week_ending - INTERVAL '6 days';

  SELECT jsonb_build_object(
    'batches', COALESCE((
      SELECT jsonb_agg(row_to_json(b.*)::jsonb)
      FROM batches b
      WHERE b.site_id = p_site_id
        AND b.plan_date >= v_week_start
        AND b.plan_date <= p_week_ending
    ), '[]'::jsonb),
    'fill_orders', COALESCE((
      SELECT jsonb_agg(row_to_json(f.*)::jsonb)
      FROM linked_fill_orders f
      WHERE f.site_id = p_site_id
        AND f.batch_id IN (
          SELECT id FROM batches
          WHERE site_id = p_site_id
            AND plan_date >= v_week_start
            AND plan_date <= p_week_ending
        )
    ), '[]'::jsonb),
    'alerts', COALESCE((
      SELECT jsonb_agg(row_to_json(a.*)::jsonb)
      FROM bulk_alerts a
      WHERE a.site_id = p_site_id
        AND (a.start_date IS NULL OR a.start_date <= p_week_ending)
        AND (a.end_date IS NULL OR a.end_date >= v_week_start)
    ), '[]'::jsonb),
    'week_start', v_week_start,
    'week_ending', p_week_ending
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================
-- GET_RESOURCE_VIEW
-- Returns batches grouped by resource with blocks for a week
-- ============================================================
CREATE OR REPLACE FUNCTION get_resource_view(
  p_site_id UUID,
  p_week_ending DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_site_id UUID;
  v_week_start DATE;
  v_result JSONB;
BEGIN
  v_user_site_id := auth.user_site_id();
  IF NOT auth.is_super_admin() AND p_site_id IS DISTINCT FROM v_user_site_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Access denied for site');
  END IF;

  v_week_start := p_week_ending - INTERVAL '6 days';

  SELECT jsonb_build_object(
    'resources', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'resource', row_to_json(r.*)::jsonb,
          'batches', COALESCE((
            SELECT jsonb_agg(row_to_json(b.*)::jsonb)
            FROM batches b
            WHERE b.plan_resource_id = r.id
              AND b.site_id = p_site_id
              AND b.plan_date >= v_week_start
              AND b.plan_date <= p_week_ending
          ), '[]'::jsonb),
          'blocks', COALESCE((
            SELECT jsonb_agg(row_to_json(rb.*)::jsonb)
            FROM resource_blocks rb
            WHERE rb.resource_id = r.id
              AND rb.site_id = p_site_id
              AND rb.start_date <= p_week_ending
              AND rb.end_date >= v_week_start
          ), '[]'::jsonb)
        )
        ORDER BY r.sort_order, r.resource_code
      )
      FROM resources r
      WHERE r.site_id = p_site_id
        AND r.active = TRUE
    ), '[]'::jsonb),
    'week_start', v_week_start,
    'week_ending', p_week_ending
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================
-- UPDATE_BATCH_STATUS
-- Status change with audit trail and validation
-- ============================================================
CREATE OR REPLACE FUNCTION update_batch_status(
  p_batch_id UUID,
  p_status TEXT,
  p_comment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_batch batches%ROWTYPE;
  v_old_status TEXT;
  v_user_id UUID;
  v_user_site_id UUID;
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

  v_old_status := v_batch.status;

  -- Validate status transition
  IF p_status NOT IN (
    'Planned', 'In Progress', 'Complete', 'Rework', 'NCB',
    'Excess Paint', 'Bulk Off', 'OFF', 'WOM', 'WOP',
    'On Test', 'Ready to Fill', 'Filling', 'Hold', 'Cancelled'
  ) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Invalid status: ' || p_status);
  END IF;

  -- Update the batch
  UPDATE batches SET
    status = p_status,
    status_comment = COALESCE(p_comment, status_comment),
    status_changed_at = NOW(),
    status_changed_by = v_user_id,
    updated_at = NOW()
  WHERE id = p_batch_id;

  -- Create audit log entry
  INSERT INTO audit_log (site_id, batch_id, action, details, performed_by)
  VALUES (
    v_batch.site_id,
    p_batch_id,
    'status_change',
    jsonb_build_object(
      'old_status', v_old_status,
      'new_status', p_status,
      'comment', p_comment
    ),
    v_user_id
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'batch_id', p_batch_id,
    'old_status', v_old_status,
    'new_status', p_status
  );
END;
$$;

-- ============================================================
-- MOVE_BATCH
-- Move batch to different resource/date with movement tracking
-- ============================================================
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

  -- Update the batch
  UPDATE batches SET
    plan_resource_id = p_resource_id,
    plan_date = p_date,
    updated_at = NOW()
  WHERE id = p_batch_id;

  -- Record the movement
  INSERT INTO schedule_movements (
    site_id, batch_id, from_resource_id, to_resource_id,
    from_date, to_date, direction, reason, moved_by
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
    v_user_id
  );

  -- Create audit log entry
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
    'to_date', p_date
  );
END;
$$;

-- ============================================================
-- GET_STATISTICS
-- Aggregated KPIs for a given week
-- ============================================================
CREATE OR REPLACE FUNCTION get_statistics(
  p_site_id UUID,
  p_week_ending DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_site_id UUID;
  v_week_start DATE;
  v_result JSONB;
BEGIN
  v_user_site_id := auth.user_site_id();
  IF NOT auth.is_super_admin() AND p_site_id IS DISTINCT FROM v_user_site_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Access denied for site');
  END IF;

  v_week_start := p_week_ending - INTERVAL '6 days';

  SELECT jsonb_build_object(
    'total_batches', COUNT(*),
    'planned', COUNT(*) FILTER (WHERE status = 'Planned'),
    'in_progress', COUNT(*) FILTER (WHERE status = 'In Progress'),
    'complete', COUNT(*) FILTER (WHERE status = 'Complete'),
    'on_hold', COUNT(*) FILTER (WHERE status = 'Hold'),
    'cancelled', COUNT(*) FILTER (WHERE status = 'Cancelled'),
    'wom', COUNT(*) FILTER (WHERE status = 'WOM' OR rm_available = FALSE),
    'wop', COUNT(*) FILTER (WHERE status = 'WOP' OR packaging_available = FALSE),
    'rework', COUNT(*) FILTER (WHERE status = 'Rework'),
    'ncb', COUNT(*) FILTER (WHERE status = 'NCB'),
    'total_volume', COALESCE(SUM(batch_volume), 0),
    'completed_volume', COALESCE(SUM(batch_volume) FILTER (WHERE status = 'Complete'), 0),
    'by_resource_type', COALESCE((
      SELECT jsonb_object_agg(
        COALESCE(r.resource_type, 'unassigned'),
        cnt
      )
      FROM (
        SELECT r.resource_type, COUNT(*) as cnt
        FROM batches b
        LEFT JOIN resources r ON r.id = b.plan_resource_id
        WHERE b.site_id = p_site_id
          AND b.plan_date >= v_week_start
          AND b.plan_date <= p_week_ending
        GROUP BY r.resource_type
      ) sub
      LEFT JOIN resources r ON FALSE  -- just for the alias
    ), '{}'::jsonb),
    'week_start', v_week_start,
    'week_ending', p_week_ending
  ) INTO v_result
  FROM batches
  WHERE site_id = p_site_id
    AND plan_date >= v_week_start
    AND plan_date <= p_week_ending;

  RETURN v_result;
END;
$$;

-- ============================================================
-- GET_AUDIT_HISTORY
-- Full audit trail for a specific batch
-- ============================================================
CREATE OR REPLACE FUNCTION get_audit_history(
  p_batch_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_site_id UUID;
  v_batch_site_id UUID;
  v_result JSONB;
BEGIN
  v_user_site_id := auth.user_site_id();
  SELECT site_id INTO v_batch_site_id
  FROM batches
  WHERE id = p_batch_id;

  IF v_batch_site_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  IF NOT auth.is_super_admin() AND v_batch_site_id IS DISTINCT FROM v_user_site_id THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'action', a.action,
        'details', a.details,
        'performed_by', a.performed_by,
        'performed_by_name', u.display_name,
        'performed_by_email', u.email,
        'performed_at', a.performed_at
      )
      ORDER BY a.performed_at DESC
    ),
    '[]'::jsonb
  ) INTO v_result
  FROM audit_log a
  LEFT JOIN site_users u ON u.id = a.performed_by
  WHERE a.batch_id = p_batch_id;

  RETURN v_result;
END;
$$;

-- ============================================================
-- CHECK_RESOURCE_AVAILABILITY
-- Checks blocks and capacity for a resource on a date
-- ============================================================
CREATE OR REPLACE FUNCTION check_resource_availability(
  p_resource_id UUID,
  p_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_resource resources%ROWTYPE;
  v_user_site_id UUID;
  v_blocked BOOLEAN;
  v_block_reason TEXT;
  v_current_count INTEGER;
BEGIN
  v_user_site_id := auth.user_site_id();

  -- Get resource
  SELECT * INTO v_resource FROM resources WHERE id = p_resource_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('available', FALSE, 'error', 'Resource not found');
  END IF;
  IF NOT auth.is_super_admin() AND v_resource.site_id IS DISTINCT FROM v_user_site_id THEN
    RETURN jsonb_build_object('available', FALSE, 'error', 'Access denied for resource');
  END IF;

  -- Check for blocks
  SELECT TRUE, rb.reason
  INTO v_blocked, v_block_reason
  FROM resource_blocks rb
  WHERE rb.resource_id = p_resource_id
    AND rb.start_date <= p_date
    AND rb.end_date >= p_date
  LIMIT 1;

  IF v_blocked THEN
    RETURN jsonb_build_object(
      'available', FALSE,
      'reason', 'blocked',
      'block_reason', v_block_reason
    );
  END IF;

  -- Check capacity (batch count for the day)
  SELECT COUNT(*) INTO v_current_count
  FROM batches
  WHERE plan_resource_id = p_resource_id
    AND plan_date = p_date
    AND status NOT IN ('Cancelled', 'OFF');

  RETURN jsonb_build_object(
    'available', v_current_count < v_resource.max_batches_per_day,
    'current_count', v_current_count,
    'max_batches_per_day', v_resource.max_batches_per_day,
    'remaining_slots', v_resource.max_batches_per_day - v_current_count,
    'resource_code', v_resource.resource_code,
    'resource_type', v_resource.resource_type
  );
END;
$$;

-- ============================================================
-- IMPORT_BATCHES
-- Bulk import batches (merge or replace mode)
-- ============================================================
CREATE OR REPLACE FUNCTION import_batches(
  p_site_id UUID,
  p_batches JSONB,
  p_mode TEXT DEFAULT 'merge'  -- 'merge' or 'replace'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_user_site_id UUID;
  v_batch JSONB;
  v_inserted INTEGER := 0;
  v_updated INTEGER := 0;
  v_skipped INTEGER := 0;
  v_existing_id UUID;
BEGIN
  v_user_id := auth.current_user_id();
  v_user_site_id := auth.user_site_id();

  IF NOT auth.is_super_admin() AND p_site_id IS DISTINCT FROM v_user_site_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Access denied for site');
  END IF;

  -- In replace mode, mark all existing planned batches for the site as cancelled
  IF p_mode = 'replace' THEN
    UPDATE batches
    SET status = 'Cancelled', updated_at = NOW()
    WHERE site_id = p_site_id
      AND status = 'Planned';
  END IF;

  -- Process each batch
  FOR v_batch IN SELECT * FROM jsonb_array_elements(p_batches)
  LOOP
    -- Check if batch already exists (by sap_order)
    SELECT id INTO v_existing_id
    FROM batches
    WHERE site_id = p_site_id
      AND sap_order = v_batch ->> 'sap_order';

    IF v_existing_id IS NOT NULL THEN
      IF p_mode = 'merge' THEN
        -- Update existing batch
        UPDATE batches SET
          material_code = COALESCE(v_batch ->> 'material_code', material_code),
          material_description = COALESCE(v_batch ->> 'material_description', material_description),
          bulk_code = COALESCE(v_batch ->> 'bulk_code', bulk_code),
          plan_date = COALESCE((v_batch ->> 'plan_date')::date, plan_date),
          batch_volume = COALESCE((v_batch ->> 'batch_volume')::numeric, batch_volume),
          sap_color_group = COALESCE(v_batch ->> 'sap_color_group', sap_color_group),
          pack_size = COALESCE(v_batch ->> 'pack_size', pack_size),
          updated_at = NOW()
        WHERE id = v_existing_id;
        v_updated := v_updated + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    ELSE
      -- Insert new batch
      INSERT INTO batches (
        site_id, sap_order, material_code, material_description,
        bulk_code, plan_date, batch_volume, sap_color_group, pack_size
      ) VALUES (
        p_site_id,
        v_batch ->> 'sap_order',
        v_batch ->> 'material_code',
        v_batch ->> 'material_description',
        v_batch ->> 'bulk_code',
        (v_batch ->> 'plan_date')::date,
        (v_batch ->> 'batch_volume')::numeric,
        v_batch ->> 'sap_color_group',
        v_batch ->> 'pack_size'
      );
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  -- Audit log entry
  INSERT INTO audit_log (site_id, action, details, performed_by)
  VALUES (
    p_site_id,
    'batch_import',
    jsonb_build_object(
      'mode', p_mode,
      'inserted', v_inserted,
      'updated', v_updated,
      'skipped', v_skipped,
      'total', jsonb_array_length(p_batches)
    ),
    v_user_id
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'total', jsonb_array_length(p_batches)
  );
END;
$$;

-- ============================================================
-- GET_UNREAD_NOTIFICATION_COUNT
-- Badge count for the current user
-- ============================================================
CREATE OR REPLACE FUNCTION get_unread_notification_count()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
  v_user_id UUID;
BEGIN
  v_user_id := auth.current_user_id();

  SELECT COUNT(*) INTO v_count
  FROM notifications
  WHERE user_id = v_user_id
    AND read = FALSE;

  RETURN v_count;
END;
$$;

-- ============================================================
-- UPSERT_SITE_USER
-- Admin adds or updates a user at a site
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_site_user(
  p_site_id UUID,
  p_email TEXT,
  p_role TEXT DEFAULT 'member'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_user_site_id UUID;
  v_existing site_users%ROWTYPE;
  v_role_id UUID;
  v_role TEXT;
  v_email TEXT;
BEGIN
  v_user_site_id := auth.user_site_id();
  v_role := lower(trim(p_role));
  v_email := lower(trim(p_email));

  IF v_role NOT IN ('member', 'site_admin', 'super_admin') THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Invalid role');
  END IF;

  IF v_role = 'super_admin' AND NOT auth.is_super_admin() THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Only super admins can assign super_admin role');
  END IF;

  IF NOT auth.is_super_admin() AND p_site_id IS DISTINCT FROM v_user_site_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Access denied for site');
  END IF;

  -- Check if user already exists at this site by email
  SELECT * INTO v_existing
  FROM site_users
  WHERE site_id = p_site_id
    AND lower(email) = v_email;

  IF v_existing.id IS NOT NULL THEN
    -- Update role if changed
    IF v_existing.role != v_role THEN
      UPDATE site_users SET
        role = v_role,
        active = TRUE,
        updated_at = NOW()
      WHERE id = v_existing.id;
    END IF;
    v_user_id := v_existing.id;
  ELSE
    -- Insert new user (external_id will be set on first login)
    INSERT INTO site_users (site_id, external_id, email, role)
    VALUES (p_site_id, 'pending:' || v_email, v_email, v_role)
    RETURNING id INTO v_user_id;
  END IF;

  -- Ensure corresponding user_site_roles entry
  SELECT id INTO v_role_id FROM roles WHERE code = v_role;
  IF v_role_id IS NOT NULL THEN
    INSERT INTO user_site_roles (user_id, site_id, role_id)
    VALUES (v_user_id, p_site_id, v_role_id)
    ON CONFLICT (user_id, site_id, role_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'user_id', v_user_id,
    'email', v_email,
    'role', v_role,
    'action', CASE WHEN v_existing.id IS NOT NULL THEN 'updated' ELSE 'created' END
  );
END;
$$;
