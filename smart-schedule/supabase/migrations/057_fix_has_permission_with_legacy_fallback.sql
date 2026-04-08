-- 057_fix_has_permission_with_legacy_fallback.sql
-- Fix auth.has_permission() to support users who have no tenant_user_roles.
--
-- The function currently only checks tenant_user_roles for permissions.
-- Users with legacy roles (site_admin, member) in site_users have no
-- tenant_user_roles entries, so INSERT/UPDATE/DELETE operations fail
-- with "violates row-level security policy".
--
-- This adds a fallback that checks the JWT app_role claim when no
-- tenant_user_roles exist for the user.

CREATE OR REPLACE FUNCTION auth.has_permission(permission_code TEXT, p_site_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_allowed BOOLEAN;
  v_has_tenant_roles BOOLEAN;
  v_app_role TEXT;
  v_jwt_site_id UUID;
BEGIN
  IF auth.is_super_admin() THEN
    RETURN TRUE;
  END IF;

  v_user_id := auth.current_user_id();
  IF v_user_id IS NULL OR p_site_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Check site-wide deny policies
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

  -- Check site-wide allow policies
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

  -- Check tenant user roles (RBAC v2)
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

  -- Legacy fallback: if user has NO tenant_user_roles, check JWT app_role.
  -- This supports all existing users who haven't been migrated to RBAC v2.
  SELECT EXISTS (
    SELECT 1
    FROM tenant_user_roles tur
    WHERE tur.user_id = v_user_id
      AND tur.site_id = p_site_id
      AND tur.active = TRUE
  )
  INTO v_has_tenant_roles;

  IF NOT v_has_tenant_roles THEN
    v_app_role := current_setting('request.jwt.claims', TRUE)::jsonb ->> 'app_role';
    v_jwt_site_id := (current_setting('request.jwt.claims', TRUE)::jsonb ->> 'site_id')::uuid;

    IF v_jwt_site_id = p_site_id THEN
      -- super_admin already handled above via auth.is_super_admin()
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
  END IF;

  RETURN FALSE;
END;
$$;
