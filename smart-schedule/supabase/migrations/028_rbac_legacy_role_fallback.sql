-- 028_rbac_legacy_role_fallback.sql
-- Fix get_effective_permissions_for_user and auth.is_tenant_admin to honour
-- the legacy site_users.role field when no tenant_user_roles rows exist.
--
-- Root cause: site_admin users (like Lachie Hodges) have their role stored in
-- site_users.role but may have no rows in tenant_user_roles. The RPC
-- get_effective_permissions_for_user only queries tenant_user_roles, returning
-- empty permissions. The frontend sees success + empty permissions and hides
-- all permission-gated sidebar items.

-- ============================================================
-- 1. Fix auth.is_tenant_admin to also check legacy site_users.role
-- ============================================================
CREATE OR REPLACE FUNCTION auth.is_tenant_admin(p_site_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_app_role TEXT;
BEGIN
  IF auth.is_super_admin() THEN
    RETURN TRUE;
  END IF;

  -- Check legacy app_role from JWT (site_admin on own site = tenant admin)
  v_app_role := current_setting('request.jwt.claims', TRUE)::jsonb ->> 'app_role';
  IF v_app_role = 'site_admin' AND p_site_id IS NOT NULL AND p_site_id = auth.user_site_id() THEN
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
-- 2. Fix get_effective_permissions_for_user to merge legacy role permissions
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
  v_legacy_role TEXT;
  v_legacy_permissions TEXT[];
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

  -- Collect tenant RBAC role codes
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

  -- Collect tenant RBAC permissions
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

  -- Legacy role fallback: merge permissions from site_users.role
  SELECT su.role INTO v_legacy_role
  FROM site_users su
  WHERE su.id = p_user_id
    AND su.site_id = p_site_id
    AND su.active = TRUE;

  IF v_legacy_role IS NOT NULL THEN
    -- Add legacy role code if not already present
    IF NOT (v_legacy_role = ANY(v_role_codes)) THEN
      v_role_codes := array_append(v_role_codes, v_legacy_role);
    END IF;

    -- Map legacy roles to permission codes
    v_legacy_permissions := CASE v_legacy_role
      WHEN 'super_admin' THEN ARRAY[
        'batches.read', 'batches.write', 'batches.schedule', 'batches.status',
        'resources.read', 'resources.write',
        'rules.read', 'rules.write',
        'planning.import', 'planning.coverage', 'planning.vet', 'planning.export', 'planning.ai',
        'admin.users', 'admin.settings', 'admin.sites',
        'alerts.read', 'alerts.acknowledge', 'alerts.write'
      ]
      WHEN 'site_admin' THEN ARRAY[
        'batches.read', 'batches.write', 'batches.schedule', 'batches.status',
        'resources.read', 'resources.write',
        'rules.read', 'rules.write',
        'planning.import', 'planning.coverage', 'planning.vet', 'planning.export', 'planning.ai',
        'admin.users', 'admin.settings',
        'alerts.read', 'alerts.acknowledge', 'alerts.write'
      ]
      WHEN 'member' THEN ARRAY[
        'batches.read', 'batches.status',
        'resources.read',
        'rules.read',
        'planning.coverage',
        'alerts.read', 'alerts.acknowledge'
      ]
      ELSE ARRAY[]::TEXT[]
    END;

    -- Merge legacy permissions into the permission set
    SELECT COALESCE(array_agg(DISTINCT code ORDER BY code), ARRAY[]::TEXT[])
    INTO v_permission_codes
    FROM (
      SELECT unnest(v_permission_codes) AS code
      UNION
      SELECT unnest(v_legacy_permissions) AS code
    ) combined;
  END IF;

  -- Apply guardrail policies
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

  -- Re-sort final permissions
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
