-- 054_fix_has_permission_simple_fallback.sql
-- Simpler, more robust fix for auth.has_permission().
--
-- Problem: migration 012 rewrote RLS SELECT policies to use auth.has_permission()
-- which only checks tenant_user_roles. No users have tenant role assignments, so
-- all data queries return empty for non-super_admin users.
--
-- Fix: check JWT app_role + site_id FIRST (fast, no table lookup, always works).
-- Only fall through to tenant_user_roles for users who actually have assignments.

CREATE OR REPLACE FUNCTION auth.has_permission(permission_code TEXT, p_site_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_claims    JSONB;
  v_app_role  TEXT;
  v_site_id   UUID;
  v_user_id   UUID;
  v_found     BOOLEAN;
BEGIN
  -- Parse JWT claims once
  BEGIN
    v_claims := current_setting('request.jwt.claims', TRUE)::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_claims := '{}'::jsonb;
  END;

  v_app_role := v_claims ->> 'app_role';
  v_site_id  := (v_claims ->> 'site_id')::uuid;

  -- ── 1. Super-admin bypass ──
  IF v_app_role = 'super_admin' THEN
    RETURN TRUE;
  END IF;

  -- ── 2. Site-scoped legacy role check (works for ALL existing users) ──
  IF v_site_id IS NOT NULL AND v_site_id = p_site_id AND v_app_role IS NOT NULL THEN
    -- site_admin gets all permissions within their site
    IF v_app_role = 'site_admin' THEN
      RETURN TRUE;
    END IF;

    -- member gets base read/operational permissions
    IF v_app_role = 'member' THEN
      RETURN permission_code IN (
        'batches.read', 'batches.schedule', 'batches.status',
        'resources.read', 'rules.read',
        'planning.coverage', 'planning.ai',
        'alerts.read', 'alerts.acknowledge'
      );
    END IF;
  END IF;

  -- ── 3. Tenant RBAC check (for users with explicit role assignments) ──
  v_user_id := (v_claims ->> 'user_id')::uuid;
  IF v_user_id IS NULL OR p_site_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Check deny policies
  SELECT EXISTS (
    SELECT 1
    FROM tenant_permission_policies tpp
    JOIN permissions p ON p.id = tpp.permission_id
    WHERE tpp.site_id = p_site_id
      AND p.code = permission_code
      AND tpp.active = TRUE
      AND tpp.effect = 'deny'
      AND COALESCE(tpp.conditions, '{}'::jsonb) = '{}'::jsonb
  ) INTO v_found;

  IF v_found THEN
    RETURN FALSE;
  END IF;

  -- Check allow policies
  SELECT EXISTS (
    SELECT 1
    FROM tenant_permission_policies tpp
    JOIN permissions p ON p.id = tpp.permission_id
    WHERE tpp.site_id = p_site_id
      AND p.code = permission_code
      AND tpp.active = TRUE
      AND tpp.effect = 'allow'
      AND COALESCE(tpp.conditions, '{}'::jsonb) = '{}'::jsonb
  ) INTO v_found;

  IF v_found THEN
    RETURN TRUE;
  END IF;

  -- Check tenant user roles
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
  ) INTO v_found;

  RETURN COALESCE(v_found, FALSE);
END;
$$;
