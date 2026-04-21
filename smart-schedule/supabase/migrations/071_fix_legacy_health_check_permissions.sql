-- 071_fix_legacy_health_check_permissions.sql
--
-- Root cause: migration 060 added schedule.view_* to the legacy role fallback
-- arrays inside get_effective_permissions_for_user, but in doing so accidentally
-- dropped 'planning.tab' and 'planning.health_check' that migration 052 had
-- correctly added.
--
-- As a result, users whose effective permissions are resolved via the legacy
-- site_users.role path (i.e. users with no tenant_user_roles entries who fall
-- back to 'site_admin' or 'super_admin') never receive planning.health_check,
-- so the Schedule Health Bar and the AI health scan trigger remain invisible
-- even though the RBAC admin panel shows the permission as enabled for the
-- admin and planner tenant roles.
--
-- Separately, the custom_access_token_hook last updated by migration 052 is
-- missing schedule.view_past / schedule.view_current / schedule.view_future
-- from its legacy arrays (those were only added to get_effective_permissions…
-- in migration 060, not to the hook). This migration fixes both functions so
-- that every code path includes the full, consistent permission set.
--
-- Fixes:
--   1. Re-issue get_effective_permissions_for_user with complete legacy arrays.
--   2. Re-issue custom_access_token_hook with complete legacy arrays.

-- ============================================================
-- 1. Fix get_effective_permissions_for_user
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

    -- Complete legacy permission sets — must stay in sync with ROLE_PERMISSIONS
    -- in src/hooks/use-permissions.ts and rbac.ts.
    v_legacy_permissions := CASE v_legacy_role
      WHEN 'super_admin' THEN ARRAY[
        'batches.read', 'batches.write', 'batches.schedule', 'batches.status',
        'resources.read', 'resources.write',
        'rules.read', 'rules.write',
        'planning.tab', 'planning.import', 'planning.coverage',
        'planning.vet', 'planning.export', 'planning.ai', 'planning.health_check',
        'schedule.view_past', 'schedule.view_current', 'schedule.view_future',
        'admin.users', 'admin.settings', 'admin.sites',
        'alerts.read', 'alerts.acknowledge', 'alerts.write'
      ]
      WHEN 'site_admin' THEN ARRAY[
        'batches.read', 'batches.write', 'batches.schedule', 'batches.status',
        'resources.read', 'resources.write',
        'rules.read', 'rules.write',
        'planning.tab', 'planning.import', 'planning.coverage',
        'planning.vet', 'planning.export', 'planning.ai', 'planning.health_check',
        'schedule.view_past', 'schedule.view_current', 'schedule.view_future',
        'admin.users', 'admin.settings',
        'alerts.read', 'alerts.acknowledge', 'alerts.write'
      ]
      WHEN 'member' THEN ARRAY[
        'batches.read', 'batches.status',
        'resources.read',
        'rules.read',
        'planning.coverage', 'planning.ai',
        'schedule.view_past', 'schedule.view_current',
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
    'success',     TRUE,
    'user_id',     p_user_id,
    'site_id',     p_site_id,
    'role_codes',  to_jsonb(v_role_codes),
    'permissions', to_jsonb(v_permission_codes),
    'fetched_at',  NOW()
  );
END;
$$;

-- ============================================================
-- 2. Fix custom_access_token_hook — add schedule.view_* to legacy arrays
-- ============================================================
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims              JSONB;
  v_auth_sub            TEXT;
  v_auth_email          TEXT;
  v_site_user           RECORD;
  v_permissions         TEXT[];
  v_legacy_permissions  TEXT[];
  v_app_metadata        JSONB;
BEGIN
  v_auth_sub := COALESCE(
    NULLIF(event ->> 'user_id', ''),
    NULLIF(event #>> '{claims,sub}', '')
  );
  v_auth_email := lower(trim(COALESCE(
    NULLIF(event #>> '{claims,email}', ''),
    NULLIF(event ->> 'email', '')
  )));

  SELECT su.id, su.site_id, su.role AS app_role
  INTO v_site_user
  FROM site_users su
  WHERE su.active = TRUE
    AND (
      su.external_id = v_auth_sub
      OR (
        v_auth_email IS NOT NULL
        AND lower(su.email) = v_auth_email
        AND su.external_id LIKE 'pending:%'
      )
    )
  ORDER BY
    (su.external_id = v_auth_sub) DESC,
    CASE su.role
      WHEN 'super_admin' THEN 3
      WHEN 'site_admin'  THEN 2
      ELSE 1
    END DESC,
    su.updated_at DESC
  LIMIT 1;

  v_claims := COALESCE(event -> 'claims', '{}'::jsonb);

  IF FOUND THEN
    v_claims := jsonb_set(v_claims, '{site_id}',  to_jsonb(v_site_user.site_id::TEXT), TRUE);
    v_claims := jsonb_set(v_claims, '{user_id}',  to_jsonb(v_site_user.id::TEXT),      TRUE);
    v_claims := jsonb_set(v_claims, '{app_role}', to_jsonb(v_site_user.app_role),      TRUE);

    -- Collect permissions from tenant RBAC
    SELECT COALESCE(array_agg(DISTINCT p.code ORDER BY p.code), ARRAY[]::TEXT[])
    INTO v_permissions
    FROM tenant_user_roles tur
    JOIN tenant_roles tr ON tr.id = tur.tenant_role_id
    JOIN tenant_role_permissions trp ON trp.tenant_role_id = tr.id
    JOIN permissions p ON p.id = trp.permission_id
    WHERE tur.site_id = v_site_user.site_id
      AND tur.user_id = v_site_user.id
      AND tur.active = TRUE
      AND (tur.expires_at IS NULL OR tur.expires_at > NOW())
      AND tr.site_id = v_site_user.site_id
      AND tr.active = TRUE;

    -- Legacy role fallback: merge permissions from site_users.role
    IF v_site_user.app_role IS NOT NULL THEN
      v_legacy_permissions := CASE v_site_user.app_role
        WHEN 'super_admin' THEN ARRAY[
          'batches.read', 'batches.write', 'batches.schedule', 'batches.status',
          'resources.read', 'resources.write',
          'rules.read', 'rules.write',
          'planning.tab', 'planning.import', 'planning.coverage',
          'planning.vet', 'planning.export', 'planning.ai', 'planning.health_check',
          'schedule.view_past', 'schedule.view_current', 'schedule.view_future',
          'admin.users', 'admin.settings', 'admin.sites',
          'alerts.read', 'alerts.acknowledge', 'alerts.write'
        ]
        WHEN 'site_admin' THEN ARRAY[
          'batches.read', 'batches.write', 'batches.schedule', 'batches.status',
          'resources.read', 'resources.write',
          'rules.read', 'rules.write',
          'planning.tab', 'planning.import', 'planning.coverage',
          'planning.vet', 'planning.export', 'planning.ai', 'planning.health_check',
          'schedule.view_past', 'schedule.view_current', 'schedule.view_future',
          'admin.users', 'admin.settings',
          'alerts.read', 'alerts.acknowledge', 'alerts.write'
        ]
        WHEN 'member' THEN ARRAY[
          'batches.read', 'batches.status',
          'resources.read',
          'rules.read',
          'planning.coverage', 'planning.ai',
          'schedule.view_past', 'schedule.view_current',
          'alerts.read', 'alerts.acknowledge'
        ]
        ELSE ARRAY[]::TEXT[]
      END;

      SELECT COALESCE(array_agg(DISTINCT code ORDER BY code), ARRAY[]::TEXT[])
      INTO v_permissions
      FROM (
        SELECT unnest(v_permissions) AS code
        UNION
        SELECT unnest(v_legacy_permissions) AS code
      ) combined;
    END IF;

    v_app_metadata := COALESCE(v_claims -> 'app_metadata', '{}'::jsonb);
    v_app_metadata := jsonb_set(v_app_metadata, '{permissions}', to_jsonb(v_permissions), TRUE);
    IF v_site_user.app_role = 'super_admin' THEN
      v_app_metadata := jsonb_set(v_app_metadata, '{is_super_admin}', 'true'::jsonb, TRUE);
    END IF;
    v_claims := jsonb_set(v_claims, '{app_metadata}', v_app_metadata, TRUE);
  ELSE
    v_claims := v_claims - 'site_id' - 'user_id' - 'app_role';
  END IF;

  RETURN jsonb_set(event, '{claims}', v_claims, TRUE);
EXCEPTION WHEN OTHERS THEN
  RETURN event;
END;
$$;

REVOKE ALL ON FUNCTION public.custom_access_token_hook(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) TO supabase_auth_admin;
