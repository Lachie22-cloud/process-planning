-- 053_fix_has_permission_legacy_fallback.sql
-- Fix: auth.has_permission() returns FALSE for users without tenant_user_roles
-- assignments, blocking all data access (batches, resources, etc.).
--
-- Root cause: migration 012 rewrote RLS policies to use auth.has_permission(),
-- which only checks tenant_user_roles. Users without tenant role assignments
-- (i.e. everyone using legacy site_users.role) get blocked.
--
-- Migration 034 already injects resolved permissions (including legacy fallback)
-- into the JWT at app_metadata.permissions. This fix makes auth.has_permission()
-- check the JWT permissions first, then fall back to the DB query. This is both
-- correct and more efficient (avoids 3-table join on every row check).

CREATE OR REPLACE FUNCTION auth.has_permission(permission_code TEXT, p_site_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_claims JSONB;
  v_jwt_site_id UUID;
  v_jwt_permissions JSONB;
  v_user_id UUID;
  v_allowed BOOLEAN;
  v_app_role TEXT;
BEGIN
  IF auth.is_super_admin() THEN
    RETURN TRUE;
  END IF;

  v_claims := COALESCE(
    current_setting('request.jwt.claims', TRUE)::jsonb,
    '{}'::jsonb
  );

  -- Fast path: check JWT-embedded permissions (set by custom_access_token_hook)
  v_jwt_site_id := (v_claims ->> 'site_id')::uuid;
  IF v_jwt_site_id IS NOT NULL AND v_jwt_site_id = p_site_id THEN
    v_jwt_permissions := v_claims #> '{app_metadata,permissions}';
    IF v_jwt_permissions IS NOT NULL AND jsonb_typeof(v_jwt_permissions) = 'array' THEN
      -- Check deny policies first (these override JWT permissions)
      SELECT EXISTS (
        SELECT 1
        FROM tenant_permission_policies tpp
        JOIN permissions p ON p.id = tpp.permission_id
        WHERE tpp.site_id = p_site_id
          AND p.code = permission_code
          AND tpp.active = TRUE
          AND tpp.effect = 'deny'
          AND COALESCE(tpp.conditions, '{}'::jsonb) = '{}'::jsonb
      )
      INTO v_allowed;

      IF v_allowed THEN
        RETURN FALSE;
      END IF;

      -- Permission is in the JWT array
      RETURN v_jwt_permissions ? permission_code;
    END IF;
  END IF;

  -- Slow path: fall back to DB queries (JWT may not have permissions yet)
  v_user_id := auth.current_user_id();
  IF v_user_id IS NULL OR p_site_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 1. Check site-wide deny policies
  SELECT EXISTS (
    SELECT 1
    FROM tenant_permission_policies tpp
    JOIN permissions p ON p.id = tpp.permission_id
    WHERE tpp.site_id = p_site_id
      AND p.code = permission_code
      AND tpp.active = TRUE
      AND tpp.effect = 'deny'
      AND COALESCE(tpp.conditions, '{}'::jsonb) = '{}'::jsonb
  )
  INTO v_allowed;

  IF v_allowed THEN
    RETURN FALSE;
  END IF;

  -- 2. Check site-wide allow policies
  SELECT EXISTS (
    SELECT 1
    FROM tenant_permission_policies tpp
    JOIN permissions p ON p.id = tpp.permission_id
    WHERE tpp.site_id = p_site_id
      AND p.code = permission_code
      AND tpp.active = TRUE
      AND tpp.effect = 'allow'
      AND COALESCE(tpp.conditions, '{}'::jsonb) = '{}'::jsonb
  )
  INTO v_allowed;

  IF v_allowed THEN
    RETURN TRUE;
  END IF;

  -- 3. Check tenant user roles (RBAC v2)
  SELECT EXISTS (
    SELECT 1
    FROM tenant_user_roles tur
    JOIN tenant_roles tr ON tr.id = tur.tenant_role_id
    JOIN tenant_role_permissions trp ON trp.tenant_role_id = tr.id
    JOIN permissions p ON p.id = trp.permission_id
    WHERE tur.user_id = v_user_id
      AND tur.site_id = p_site_id
      AND tur.active = TRUE
      AND (tur.expires_at IS NULL OR tur.expires_at > NOW())
      AND tr.site_id = p_site_id
      AND tr.active = TRUE
      AND p.code = permission_code
  )
  INTO v_allowed;

  IF v_allowed THEN
    RETURN TRUE;
  END IF;

  -- 4. Legacy fallback: derive permissions from JWT app_role claim
  --    when user has no tenant_user_roles entries
  v_app_role := v_claims ->> 'app_role';
  IF v_jwt_site_id = p_site_id AND v_app_role IS NOT NULL THEN
    IF v_app_role = 'site_admin' THEN
      RETURN TRUE;
    END IF;

    IF v_app_role = 'member' THEN
      RETURN permission_code IN (
        'batches.read', 'batches.schedule', 'batches.status',
        'resources.read', 'rules.read',
        'planning.coverage', 'planning.ai',
        'alerts.read', 'alerts.acknowledge'
      );
    END IF;
  END IF;

  RETURN FALSE;
END;
$$;
