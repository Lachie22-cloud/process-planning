-- 056_revert_rls_changes.sql
-- Revert all changes made by migrations 053, 054, 055.
-- Restores auth.has_permission() to its original form (from 012).
-- Restores all RLS SELECT policies to their original form (from 012 + 014).

-- ── Restore original auth.has_permission (from 012) ──
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
  IF auth.is_super_admin() THEN
    RETURN TRUE;
  END IF;

  v_user_id := auth.current_user_id();
  IF v_user_id IS NULL OR p_site_id IS NULL THEN
    RETURN FALSE;
  END IF;

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

-- ── Restore RLS SELECT policies from 012 ──
DROP POLICY IF EXISTS batches_select ON batches;
CREATE POLICY batches_select ON batches FOR SELECT
  USING (auth.has_permission('batches.read', site_id));

DROP POLICY IF EXISTS resources_select ON resources;
CREATE POLICY resources_select ON resources FOR SELECT
  USING (auth.has_permission('resources.read', site_id));

DROP POLICY IF EXISTS substitution_rules_select ON substitution_rules;
CREATE POLICY substitution_rules_select ON substitution_rules FOR SELECT
  USING (auth.has_permission('rules.read', site_id));

DROP POLICY IF EXISTS schedule_rules_select ON schedule_rules;
CREATE POLICY schedule_rules_select ON schedule_rules FOR SELECT
  USING (auth.has_permission('rules.read', site_id));

DROP POLICY IF EXISTS resource_blocks_select ON resource_blocks;
CREATE POLICY resource_blocks_select ON resource_blocks FOR SELECT
  USING (auth.has_permission('resources.read', site_id));

DROP POLICY IF EXISTS bulk_alerts_select ON bulk_alerts;
CREATE POLICY bulk_alerts_select ON bulk_alerts FOR SELECT
  USING (auth.has_permission('alerts.read', site_id));

DROP POLICY IF EXISTS planning_data_select ON planning_data;
CREATE POLICY planning_data_select ON planning_data FOR SELECT
  USING (
    auth.has_permission('planning.coverage', site_id)
    OR auth.has_permission('planning.import', site_id)
  );

-- ── Restore site_users SELECT from 014 (with bootstrap fallback) ──
DROP POLICY IF EXISTS site_users_select ON site_users;
CREATE POLICY site_users_select ON site_users FOR SELECT
  USING (
    id = auth.current_user_id()
    OR auth.has_permission('admin.users', site_id)
    OR external_id = COALESCE(
      NULLIF(current_setting('request.jwt.claims', TRUE)::jsonb ->> 'sub', ''),
      NULLIF(current_setting('request.jwt.claims', TRUE)::jsonb ->> 'user_id', '')
    )
    OR (
      external_id LIKE 'pending:%'
      AND lower(email) = lower(COALESCE(
        NULLIF(current_setting('request.jwt.claims', TRUE)::jsonb ->> 'email', ''),
        ''
      ))
    )
  );

-- ── Restore tenant RBAC table policies from 012 ──
DROP POLICY IF EXISTS tenant_roles_select ON tenant_roles;
CREATE POLICY tenant_roles_select ON tenant_roles FOR SELECT
  USING (auth.has_permission('admin.users', site_id));

DROP POLICY IF EXISTS tenant_role_permissions_select ON tenant_role_permissions;
CREATE POLICY tenant_role_permissions_select ON tenant_role_permissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tenant_roles tr
      WHERE tr.id = tenant_role_permissions.tenant_role_id
        AND auth.has_permission('admin.users', tr.site_id)
    )
  );

DROP POLICY IF EXISTS tenant_user_roles_select ON tenant_user_roles;
CREATE POLICY tenant_user_roles_select ON tenant_user_roles FOR SELECT
  USING (
    auth.current_user_id() = user_id
    OR auth.has_permission('admin.users', site_id)
  );

DROP POLICY IF EXISTS tenant_permission_policies_select ON tenant_permission_policies;
CREATE POLICY tenant_permission_policies_select ON tenant_permission_policies FOR SELECT
  USING (auth.has_permission('admin.settings', site_id));

DROP POLICY IF EXISTS rbac_audit_log_select ON rbac_audit_log;
CREATE POLICY rbac_audit_log_select ON rbac_audit_log FOR SELECT
  USING (auth.has_permission('admin.users', site_id));
