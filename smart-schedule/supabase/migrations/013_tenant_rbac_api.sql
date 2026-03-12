-- 013_tenant_rbac_api.sql
-- Tenant role CRUD + user assignment RPC API for admin surfaces.

-- ============================================================
-- HELPER: tenant-admin gate (site-scoped)
-- ============================================================
CREATE OR REPLACE FUNCTION auth.is_tenant_admin(p_site_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF auth.is_super_admin() THEN
    RETURN TRUE;
  END IF;

  v_user_id := auth.current_user_id();

  IF v_user_id IS NULL OR p_site_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM tenant_user_roles tur
    JOIN tenant_roles tr
      ON tr.id = tur.tenant_role_id
    WHERE tur.site_id = p_site_id
      AND tur.user_id = v_user_id
      AND tur.active = TRUE
      AND (tur.expires_at IS NULL OR tur.expires_at > NOW())
      AND tr.site_id = p_site_id
      AND tr.active = TRUE
      AND tr.code = 'admin'
  );
END;
$$;

-- ============================================================
-- HELPER: evaluate policy condition payload against effective context
-- Supports roleCodesAny, roleCodesAll, userIds, siteIds
-- ============================================================
CREATE OR REPLACE FUNCTION auth.rbac_policy_matches(
  p_conditions JSONB,
  p_user_id UUID,
  p_site_id UUID,
  p_role_codes TEXT[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_role_codes_any TEXT[];
  v_role_codes_all TEXT[];
  v_user_ids TEXT[];
  v_site_ids TEXT[];
BEGIN
  IF p_conditions IS NULL OR p_conditions = '{}'::jsonb THEN
    RETURN TRUE;
  END IF;

  IF p_conditions ? 'roleCodesAny' THEN
    SELECT COALESCE(array_agg(value), ARRAY[]::TEXT[])
    INTO v_role_codes_any
    FROM jsonb_array_elements_text(p_conditions -> 'roleCodesAny') AS value;

    IF cardinality(v_role_codes_any) > 0 AND NOT (v_role_codes_any && COALESCE(p_role_codes, ARRAY[]::TEXT[])) THEN
      RETURN FALSE;
    END IF;
  END IF;

  IF p_conditions ? 'roleCodesAll' THEN
    SELECT COALESCE(array_agg(value), ARRAY[]::TEXT[])
    INTO v_role_codes_all
    FROM jsonb_array_elements_text(p_conditions -> 'roleCodesAll') AS value;

    IF cardinality(v_role_codes_all) > 0 AND NOT (v_role_codes_all <@ COALESCE(p_role_codes, ARRAY[]::TEXT[])) THEN
      RETURN FALSE;
    END IF;
  END IF;

  IF p_conditions ? 'userIds' THEN
    SELECT COALESCE(array_agg(value), ARRAY[]::TEXT[])
    INTO v_user_ids
    FROM jsonb_array_elements_text(p_conditions -> 'userIds') AS value;

    IF cardinality(v_user_ids) > 0 AND NOT (p_user_id::TEXT = ANY(v_user_ids)) THEN
      RETURN FALSE;
    END IF;
  END IF;

  IF p_conditions ? 'siteIds' THEN
    SELECT COALESCE(array_agg(value), ARRAY[]::TEXT[])
    INTO v_site_ids
    FROM jsonb_array_elements_text(p_conditions -> 'siteIds') AS value;

    IF cardinality(v_site_ids) > 0 AND NOT (p_site_id::TEXT = ANY(v_site_ids)) THEN
      RETURN FALSE;
    END IF;
  END IF;

  RETURN TRUE;
END;
$$;

-- ============================================================
-- listTenantRoles -> list_tenant_roles
-- ============================================================
CREATE OR REPLACE FUNCTION list_tenant_roles(p_site_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_site_id UUID;
  v_roles JSONB;
BEGIN
  v_user_site_id := auth.user_site_id();

  IF p_site_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'site_id is required');
  END IF;

  IF NOT auth.is_super_admin() AND p_site_id IS DISTINCT FROM v_user_site_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Access denied for site');
  END IF;

  IF NOT auth.is_tenant_admin(p_site_id) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Tenant admin role required');
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', tr.id,
        'site_id', tr.site_id,
        'code', tr.code,
        'name', tr.name,
        'description', tr.description,
        'is_system', tr.is_system,
        'active', tr.active,
        'created_at', tr.created_at,
        'updated_at', tr.updated_at,
        'permissions', COALESCE(
          (
            SELECT jsonb_agg(p.code ORDER BY p.code)
            FROM tenant_role_permissions trp
            JOIN permissions p
              ON p.id = trp.permission_id
            WHERE trp.tenant_role_id = tr.id
          ),
          '[]'::jsonb
        )
      )
      ORDER BY tr.name
    ),
    '[]'::jsonb
  )
  INTO v_roles
  FROM tenant_roles tr
  WHERE tr.site_id = p_site_id;

  RETURN jsonb_build_object('success', TRUE, 'roles', v_roles);
END;
$$;

-- ============================================================
-- updateTenantRolePermissions -> update_tenant_role_permissions
-- ============================================================
CREATE OR REPLACE FUNCTION update_tenant_role_permissions(
  p_site_id UUID,
  p_tenant_role_id UUID,
  p_permission_codes TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actor_user_id UUID;
  v_user_site_id UUID;
  v_role tenant_roles%ROWTYPE;
  v_new_permission_codes TEXT[];
  v_resolved_permission_codes TEXT[];
  v_unknown_permission_codes TEXT[];
  v_old_permission_codes TEXT[];
BEGIN
  v_actor_user_id := auth.current_user_id();
  v_user_site_id := auth.user_site_id();

  IF p_site_id IS NULL OR p_tenant_role_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'site_id and tenant_role_id are required');
  END IF;

  IF NOT auth.is_super_admin() AND p_site_id IS DISTINCT FROM v_user_site_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Access denied for site');
  END IF;

  IF NOT auth.is_tenant_admin(p_site_id) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Tenant admin role required');
  END IF;

  SELECT *
  INTO v_role
  FROM tenant_roles
  WHERE id = p_tenant_role_id
    AND site_id = p_site_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Tenant role not found');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT normalized_code), ARRAY[]::TEXT[])
  INTO v_new_permission_codes
  FROM (
    SELECT NULLIF(BTRIM(value), '') AS normalized_code
    FROM unnest(COALESCE(p_permission_codes, ARRAY[]::TEXT[])) AS value
  ) cleaned
  WHERE normalized_code IS NOT NULL;

  SELECT COALESCE(array_agg(p.code ORDER BY p.code), ARRAY[]::TEXT[])
  INTO v_resolved_permission_codes
  FROM permissions p
  WHERE p.code = ANY(v_new_permission_codes);

  SELECT COALESCE(array_agg(code ORDER BY code), ARRAY[]::TEXT[])
  INTO v_unknown_permission_codes
  FROM (
    SELECT code
    FROM unnest(v_new_permission_codes) AS code
    EXCEPT
    SELECT code
    FROM unnest(v_resolved_permission_codes) AS code
  ) unknown;

  IF cardinality(v_unknown_permission_codes) > 0 THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Unknown permission codes',
      'unknown_permission_codes', to_jsonb(v_unknown_permission_codes)
    );
  END IF;

  SELECT COALESCE(array_agg(p.code ORDER BY p.code), ARRAY[]::TEXT[])
  INTO v_old_permission_codes
  FROM tenant_role_permissions trp
  JOIN permissions p
    ON p.id = trp.permission_id
  WHERE trp.tenant_role_id = p_tenant_role_id;

  DELETE FROM tenant_role_permissions trp
  USING permissions p
  WHERE trp.tenant_role_id = p_tenant_role_id
    AND p.id = trp.permission_id
    AND NOT (p.code = ANY(v_resolved_permission_codes));

  INSERT INTO tenant_role_permissions (tenant_role_id, permission_id, granted_by)
  SELECT p_tenant_role_id, p.id, v_actor_user_id
  FROM permissions p
  WHERE p.code = ANY(v_resolved_permission_codes)
  ON CONFLICT (tenant_role_id, permission_id) DO NOTHING;

  INSERT INTO rbac_audit_log (
    site_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    tenant_role_id,
    metadata
  )
  VALUES (
    p_site_id,
    v_actor_user_id,
    'update_tenant_role_permissions',
    'tenant_role',
    p_tenant_role_id,
    p_tenant_role_id,
    jsonb_build_object(
      'role_code', v_role.code,
      'previous_permission_codes', to_jsonb(v_old_permission_codes),
      'new_permission_codes', to_jsonb(v_resolved_permission_codes)
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'tenant_role_id', p_tenant_role_id,
    'permission_codes', to_jsonb(v_resolved_permission_codes)
  );
END;
$$;

-- ============================================================
-- assignUserRoles -> assign_user_roles
-- Replaces active role set for the user at site scope.
-- ============================================================
CREATE OR REPLACE FUNCTION assign_user_roles(
  p_site_id UUID,
  p_user_id UUID,
  p_role_codes TEXT[],
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actor_user_id UUID;
  v_user_site_id UUID;
  v_target_user site_users%ROWTYPE;
  v_new_role_codes TEXT[];
  v_resolved_role_codes TEXT[];
  v_unknown_role_codes TEXT[];
  v_old_role_codes TEXT[];
BEGIN
  v_actor_user_id := auth.current_user_id();
  v_user_site_id := auth.user_site_id();

  IF p_site_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'site_id and user_id are required');
  END IF;

  IF NOT auth.is_super_admin() AND p_site_id IS DISTINCT FROM v_user_site_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Access denied for site');
  END IF;

  IF NOT auth.is_tenant_admin(p_site_id) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Tenant admin role required');
  END IF;

  SELECT *
  INTO v_target_user
  FROM site_users
  WHERE id = p_user_id
    AND site_id = p_site_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Target user not found at site');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT normalized_code), ARRAY[]::TEXT[])
  INTO v_new_role_codes
  FROM (
    SELECT NULLIF(BTRIM(value), '') AS normalized_code
    FROM unnest(COALESCE(p_role_codes, ARRAY[]::TEXT[])) AS value
  ) cleaned
  WHERE normalized_code IS NOT NULL;

  SELECT COALESCE(array_agg(tr.code ORDER BY tr.code), ARRAY[]::TEXT[])
  INTO v_resolved_role_codes
  FROM tenant_roles tr
  WHERE tr.site_id = p_site_id
    AND tr.active = TRUE
    AND tr.code = ANY(v_new_role_codes);

  SELECT COALESCE(array_agg(code ORDER BY code), ARRAY[]::TEXT[])
  INTO v_unknown_role_codes
  FROM (
    SELECT code
    FROM unnest(v_new_role_codes) AS code
    EXCEPT
    SELECT code
    FROM unnest(v_resolved_role_codes) AS code
  ) unknown;

  IF cardinality(v_unknown_role_codes) > 0 THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Unknown or inactive tenant role codes',
      'unknown_role_codes', to_jsonb(v_unknown_role_codes)
    );
  END IF;

  SELECT COALESCE(array_agg(tr.code ORDER BY tr.code), ARRAY[]::TEXT[])
  INTO v_old_role_codes
  FROM tenant_user_roles tur
  JOIN tenant_roles tr
    ON tr.id = tur.tenant_role_id
  WHERE tur.site_id = p_site_id
    AND tur.user_id = p_user_id
    AND tur.active = TRUE
    AND (tur.expires_at IS NULL OR tur.expires_at > NOW());

  UPDATE tenant_user_roles tur
  SET
    active = FALSE
  WHERE tur.site_id = p_site_id
    AND tur.user_id = p_user_id
    AND tur.active = TRUE
    AND EXISTS (
      SELECT 1
      FROM tenant_roles tr
      WHERE tr.id = tur.tenant_role_id
        AND tr.site_id = p_site_id
        AND NOT (tr.code = ANY(v_resolved_role_codes))
    );

  INSERT INTO tenant_user_roles (
    site_id,
    user_id,
    tenant_role_id,
    assigned_by,
    active,
    expires_at
  )
  SELECT
    p_site_id,
    p_user_id,
    tr.id,
    v_actor_user_id,
    TRUE,
    p_expires_at
  FROM tenant_roles tr
  WHERE tr.site_id = p_site_id
    AND tr.code = ANY(v_resolved_role_codes)
  ON CONFLICT (site_id, user_id, tenant_role_id)
  DO UPDATE SET
    assigned_by = EXCLUDED.assigned_by,
    active = TRUE,
    expires_at = EXCLUDED.expires_at;

  INSERT INTO rbac_audit_log (
    site_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  VALUES (
    p_site_id,
    v_actor_user_id,
    'assign_user_roles',
    'site_user',
    p_user_id,
    jsonb_build_object(
      'previous_role_codes', to_jsonb(v_old_role_codes),
      'new_role_codes', to_jsonb(v_resolved_role_codes),
      'expires_at', p_expires_at
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'user_id', p_user_id,
    'role_codes', to_jsonb(v_resolved_role_codes),
    'expires_at', p_expires_at
  );
END;
$$;

-- ============================================================
-- getEffectivePermissionsForUser -> get_effective_permissions_for_user
-- ============================================================
CREATE OR REPLACE FUNCTION get_effective_permissions_for_user(
  p_site_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actor_user_id UUID;
  v_user_site_id UUID;
  v_role_codes TEXT[];
  v_permission_codes TEXT[];
  v_policy RECORD;
BEGIN
  v_actor_user_id := auth.current_user_id();
  v_user_site_id := auth.user_site_id();

  IF p_site_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'site_id and user_id are required');
  END IF;

  IF NOT auth.is_super_admin() AND p_site_id IS DISTINCT FROM v_user_site_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Access denied for site');
  END IF;

  IF NOT auth.is_tenant_admin(p_site_id) AND p_user_id IS DISTINCT FROM v_actor_user_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Tenant admin role required to inspect other users');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT tr.code ORDER BY tr.code), ARRAY[]::TEXT[])
  INTO v_role_codes
  FROM tenant_user_roles tur
  JOIN tenant_roles tr
    ON tr.id = tur.tenant_role_id
  WHERE tur.site_id = p_site_id
    AND tur.user_id = p_user_id
    AND tur.active = TRUE
    AND (tur.expires_at IS NULL OR tur.expires_at > NOW())
    AND tr.site_id = p_site_id
    AND tr.active = TRUE;

  SELECT COALESCE(array_agg(DISTINCT p.code ORDER BY p.code), ARRAY[]::TEXT[])
  INTO v_permission_codes
  FROM tenant_user_roles tur
  JOIN tenant_roles tr
    ON tr.id = tur.tenant_role_id
  JOIN tenant_role_permissions trp
    ON trp.tenant_role_id = tr.id
  JOIN permissions p
    ON p.id = trp.permission_id
  WHERE tur.site_id = p_site_id
    AND tur.user_id = p_user_id
    AND tur.active = TRUE
    AND (tur.expires_at IS NULL OR tur.expires_at > NOW())
    AND tr.site_id = p_site_id
    AND tr.active = TRUE;

  FOR v_policy IN
    SELECT
      p.code AS permission_code,
      tpp.effect,
      tpp.priority,
      tpp.conditions
    FROM tenant_permission_policies tpp
    JOIN permissions p
      ON p.id = tpp.permission_id
    WHERE tpp.site_id = p_site_id
      AND tpp.active = TRUE
    ORDER BY tpp.priority ASC
  LOOP
    IF NOT auth.rbac_policy_matches(
      v_policy.conditions,
      p_user_id,
      p_site_id,
      v_role_codes
    ) THEN
      CONTINUE;
    END IF;

    IF v_policy.effect = 'deny' THEN
      v_permission_codes := array_remove(v_permission_codes, v_policy.permission_code);
    ELSE
      IF NOT (v_policy.permission_code = ANY(v_permission_codes)) THEN
        v_permission_codes := array_append(v_permission_codes, v_policy.permission_code);
      END IF;
    END IF;
  END LOOP;

  SELECT COALESCE(array_agg(code ORDER BY code), ARRAY[]::TEXT[])
  INTO v_permission_codes
  FROM unnest(COALESCE(v_permission_codes, ARRAY[]::TEXT[])) AS code;

  RETURN jsonb_build_object(
    'success', TRUE,
    'user_id', p_user_id,
    'site_id', p_site_id,
    'role_codes', to_jsonb(v_role_codes),
    'permissions', to_jsonb(v_permission_codes),
    'fetched_at', NOW()
  );
END;
$$;
