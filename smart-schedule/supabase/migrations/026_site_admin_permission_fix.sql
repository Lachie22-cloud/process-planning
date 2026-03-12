-- 026_site_admin_permission_fix.sql
-- Fix auth.has_permission() to honour the site_admin app_role from the JWT.
--
-- Root cause: migration 012 replaced the original RLS policies (which used
-- auth.is_admin()) with auth.has_permission() checks.  The has_permission()
-- function only short-circuits for super_admin; it does NOT check app_role =
-- 'site_admin', so site-admin users get no data access even on their own site
-- unless they also have a tenant_user_roles entry.
--
-- Fix: add an early-return for site_admin that mirrors the super_admin bypass,
-- scoped to the user's own site.

CREATE OR REPLACE FUNCTION auth.has_permission(permission_code TEXT, p_site_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_allowed BOOLEAN;
BEGIN
  -- Super-admin bypasses all permission checks.
  IF auth.is_super_admin() THEN
    RETURN TRUE;
  END IF;

  -- Site-admin has full access to every permission on their own site.
  -- This restores the original behaviour that the 003 RLS policies had
  -- (auth.is_admin() + site_id = auth.user_site_id()) before 012 replaced them.
  IF p_site_id IS NOT NULL
     AND p_site_id = auth.user_site_id()
     AND (current_setting('request.jwt.claims', TRUE)::jsonb ->> 'app_role') = 'site_admin'
  THEN
    RETURN TRUE;
  END IF;

  v_user_id := auth.current_user_id();
  IF v_user_id IS NULL OR p_site_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Unconditional deny policy wins over everything else.
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

  -- Unconditional allow policy.
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

  -- Role-based permission via tenant_user_roles.
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

  RETURN COALESCE(v_allowed, FALSE);
END;
$$;
