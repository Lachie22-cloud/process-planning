-- 012_rbac_enforcement_rls.sql
-- Enforce permission-code RBAC at DB boundary for sensitive tables.

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

ALTER TABLE tenant_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_permission_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE rbac_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_roles_select ON tenant_roles;
DROP POLICY IF EXISTS tenant_roles_insert ON tenant_roles;
DROP POLICY IF EXISTS tenant_roles_update ON tenant_roles;
DROP POLICY IF EXISTS tenant_roles_delete ON tenant_roles;

CREATE POLICY tenant_roles_select ON tenant_roles FOR SELECT
  USING (auth.has_permission('admin.users', site_id));

CREATE POLICY tenant_roles_insert ON tenant_roles FOR INSERT
  WITH CHECK (auth.has_permission('admin.users', site_id));

CREATE POLICY tenant_roles_update ON tenant_roles FOR UPDATE
  USING (auth.has_permission('admin.users', site_id))
  WITH CHECK (auth.has_permission('admin.users', site_id));

CREATE POLICY tenant_roles_delete ON tenant_roles FOR DELETE
  USING (auth.has_permission('admin.users', site_id));

DROP POLICY IF EXISTS tenant_role_permissions_select ON tenant_role_permissions;
DROP POLICY IF EXISTS tenant_role_permissions_insert ON tenant_role_permissions;
DROP POLICY IF EXISTS tenant_role_permissions_update ON tenant_role_permissions;
DROP POLICY IF EXISTS tenant_role_permissions_delete ON tenant_role_permissions;

CREATE POLICY tenant_role_permissions_select ON tenant_role_permissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tenant_roles tr
      WHERE tr.id = tenant_role_permissions.tenant_role_id
        AND auth.has_permission('admin.users', tr.site_id)
    )
  );

CREATE POLICY tenant_role_permissions_insert ON tenant_role_permissions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tenant_roles tr
      WHERE tr.id = tenant_role_permissions.tenant_role_id
        AND auth.has_permission('admin.users', tr.site_id)
    )
  );

CREATE POLICY tenant_role_permissions_update ON tenant_role_permissions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM tenant_roles tr
      WHERE tr.id = tenant_role_permissions.tenant_role_id
        AND auth.has_permission('admin.users', tr.site_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tenant_roles tr
      WHERE tr.id = tenant_role_permissions.tenant_role_id
        AND auth.has_permission('admin.users', tr.site_id)
    )
  );

CREATE POLICY tenant_role_permissions_delete ON tenant_role_permissions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM tenant_roles tr
      WHERE tr.id = tenant_role_permissions.tenant_role_id
        AND auth.has_permission('admin.users', tr.site_id)
    )
  );

DROP POLICY IF EXISTS tenant_user_roles_select ON tenant_user_roles;
DROP POLICY IF EXISTS tenant_user_roles_insert ON tenant_user_roles;
DROP POLICY IF EXISTS tenant_user_roles_update ON tenant_user_roles;
DROP POLICY IF EXISTS tenant_user_roles_delete ON tenant_user_roles;

CREATE POLICY tenant_user_roles_select ON tenant_user_roles FOR SELECT
  USING (
    auth.current_user_id() = user_id
    OR auth.has_permission('admin.users', site_id)
  );

CREATE POLICY tenant_user_roles_insert ON tenant_user_roles FOR INSERT
  WITH CHECK (auth.has_permission('admin.users', site_id));

CREATE POLICY tenant_user_roles_update ON tenant_user_roles FOR UPDATE
  USING (auth.has_permission('admin.users', site_id))
  WITH CHECK (auth.has_permission('admin.users', site_id));

CREATE POLICY tenant_user_roles_delete ON tenant_user_roles FOR DELETE
  USING (auth.has_permission('admin.users', site_id));

DROP POLICY IF EXISTS tenant_permission_policies_select ON tenant_permission_policies;
DROP POLICY IF EXISTS tenant_permission_policies_insert ON tenant_permission_policies;
DROP POLICY IF EXISTS tenant_permission_policies_update ON tenant_permission_policies;
DROP POLICY IF EXISTS tenant_permission_policies_delete ON tenant_permission_policies;

CREATE POLICY tenant_permission_policies_select ON tenant_permission_policies FOR SELECT
  USING (auth.has_permission('admin.settings', site_id));

CREATE POLICY tenant_permission_policies_insert ON tenant_permission_policies FOR INSERT
  WITH CHECK (auth.has_permission('admin.settings', site_id));

CREATE POLICY tenant_permission_policies_update ON tenant_permission_policies FOR UPDATE
  USING (auth.has_permission('admin.settings', site_id))
  WITH CHECK (auth.has_permission('admin.settings', site_id));

CREATE POLICY tenant_permission_policies_delete ON tenant_permission_policies FOR DELETE
  USING (auth.has_permission('admin.settings', site_id));

DROP POLICY IF EXISTS rbac_audit_log_select ON rbac_audit_log;
DROP POLICY IF EXISTS rbac_audit_log_insert ON rbac_audit_log;
DROP POLICY IF EXISTS rbac_audit_log_update ON rbac_audit_log;
DROP POLICY IF EXISTS rbac_audit_log_delete ON rbac_audit_log;

CREATE POLICY rbac_audit_log_select ON rbac_audit_log FOR SELECT
  USING (auth.has_permission('admin.users', site_id));

CREATE POLICY rbac_audit_log_insert ON rbac_audit_log FOR INSERT
  WITH CHECK (auth.has_permission('admin.users', site_id));

-- Sensitive table rewrites using permission-code checks.
DROP POLICY IF EXISTS resources_select ON resources;
DROP POLICY IF EXISTS resources_insert ON resources;
DROP POLICY IF EXISTS resources_update ON resources;
DROP POLICY IF EXISTS resources_delete ON resources;

CREATE POLICY resources_select ON resources FOR SELECT
  USING (auth.has_permission('resources.read', site_id));

CREATE POLICY resources_insert ON resources FOR INSERT
  WITH CHECK (auth.has_permission('resources.write', site_id));

CREATE POLICY resources_update ON resources FOR UPDATE
  USING (auth.has_permission('resources.write', site_id))
  WITH CHECK (auth.has_permission('resources.write', site_id));

CREATE POLICY resources_delete ON resources FOR DELETE
  USING (auth.has_permission('resources.write', site_id));

DROP POLICY IF EXISTS batches_select ON batches;
DROP POLICY IF EXISTS batches_insert ON batches;
DROP POLICY IF EXISTS batches_update ON batches;
DROP POLICY IF EXISTS batches_delete ON batches;

CREATE POLICY batches_select ON batches FOR SELECT
  USING (auth.has_permission('batches.read', site_id));

CREATE POLICY batches_insert ON batches FOR INSERT
  WITH CHECK (
    auth.has_permission('batches.write', site_id)
    OR auth.has_permission('batches.schedule', site_id)
    OR auth.has_permission('batches.status', site_id)
  );

CREATE POLICY batches_update ON batches FOR UPDATE
  USING (
    auth.has_permission('batches.write', site_id)
    OR auth.has_permission('batches.schedule', site_id)
    OR auth.has_permission('batches.status', site_id)
  )
  WITH CHECK (
    auth.has_permission('batches.write', site_id)
    OR auth.has_permission('batches.schedule', site_id)
    OR auth.has_permission('batches.status', site_id)
  );

CREATE POLICY batches_delete ON batches FOR DELETE
  USING (auth.has_permission('batches.write', site_id));

DROP POLICY IF EXISTS substitution_rules_select ON substitution_rules;
DROP POLICY IF EXISTS substitution_rules_insert ON substitution_rules;
DROP POLICY IF EXISTS substitution_rules_update ON substitution_rules;
DROP POLICY IF EXISTS substitution_rules_delete ON substitution_rules;

CREATE POLICY substitution_rules_select ON substitution_rules FOR SELECT
  USING (auth.has_permission('rules.read', site_id));

CREATE POLICY substitution_rules_insert ON substitution_rules FOR INSERT
  WITH CHECK (auth.has_permission('rules.write', site_id));

CREATE POLICY substitution_rules_update ON substitution_rules FOR UPDATE
  USING (auth.has_permission('rules.write', site_id))
  WITH CHECK (auth.has_permission('rules.write', site_id));

CREATE POLICY substitution_rules_delete ON substitution_rules FOR DELETE
  USING (auth.has_permission('rules.write', site_id));

DROP POLICY IF EXISTS schedule_rules_select ON schedule_rules;
DROP POLICY IF EXISTS schedule_rules_insert ON schedule_rules;
DROP POLICY IF EXISTS schedule_rules_update ON schedule_rules;
DROP POLICY IF EXISTS schedule_rules_delete ON schedule_rules;

CREATE POLICY schedule_rules_select ON schedule_rules FOR SELECT
  USING (auth.has_permission('rules.read', site_id));

CREATE POLICY schedule_rules_insert ON schedule_rules FOR INSERT
  WITH CHECK (auth.has_permission('rules.write', site_id));

CREATE POLICY schedule_rules_update ON schedule_rules FOR UPDATE
  USING (auth.has_permission('rules.write', site_id))
  WITH CHECK (auth.has_permission('rules.write', site_id));

CREATE POLICY schedule_rules_delete ON schedule_rules FOR DELETE
  USING (auth.has_permission('rules.write', site_id));

DROP POLICY IF EXISTS resource_blocks_select ON resource_blocks;
DROP POLICY IF EXISTS resource_blocks_insert ON resource_blocks;
DROP POLICY IF EXISTS resource_blocks_update ON resource_blocks;
DROP POLICY IF EXISTS resource_blocks_delete ON resource_blocks;

CREATE POLICY resource_blocks_select ON resource_blocks FOR SELECT
  USING (auth.has_permission('resources.read', site_id));

CREATE POLICY resource_blocks_insert ON resource_blocks FOR INSERT
  WITH CHECK (auth.has_permission('resources.write', site_id));

CREATE POLICY resource_blocks_update ON resource_blocks FOR UPDATE
  USING (auth.has_permission('resources.write', site_id))
  WITH CHECK (auth.has_permission('resources.write', site_id));

CREATE POLICY resource_blocks_delete ON resource_blocks FOR DELETE
  USING (auth.has_permission('resources.write', site_id));

DROP POLICY IF EXISTS bulk_alerts_select ON bulk_alerts;
DROP POLICY IF EXISTS bulk_alerts_insert ON bulk_alerts;
DROP POLICY IF EXISTS bulk_alerts_update ON bulk_alerts;
DROP POLICY IF EXISTS bulk_alerts_delete ON bulk_alerts;

CREATE POLICY bulk_alerts_select ON bulk_alerts FOR SELECT
  USING (auth.has_permission('alerts.read', site_id));

CREATE POLICY bulk_alerts_insert ON bulk_alerts FOR INSERT
  WITH CHECK (auth.has_permission('alerts.acknowledge', site_id));

CREATE POLICY bulk_alerts_update ON bulk_alerts FOR UPDATE
  USING (auth.has_permission('alerts.acknowledge', site_id))
  WITH CHECK (auth.has_permission('alerts.acknowledge', site_id));

CREATE POLICY bulk_alerts_delete ON bulk_alerts FOR DELETE
  USING (auth.has_permission('alerts.acknowledge', site_id));

DROP POLICY IF EXISTS planning_data_select ON planning_data;
DROP POLICY IF EXISTS planning_data_insert ON planning_data;
DROP POLICY IF EXISTS planning_data_update ON planning_data;
DROP POLICY IF EXISTS planning_data_delete ON planning_data;

CREATE POLICY planning_data_select ON planning_data FOR SELECT
  USING (
    auth.has_permission('planning.coverage', site_id)
    OR auth.has_permission('planning.import', site_id)
  );

CREATE POLICY planning_data_insert ON planning_data FOR INSERT
  WITH CHECK (auth.has_permission('planning.import', site_id));

CREATE POLICY planning_data_update ON planning_data FOR UPDATE
  USING (auth.has_permission('planning.import', site_id))
  WITH CHECK (auth.has_permission('planning.import', site_id));

CREATE POLICY planning_data_delete ON planning_data FOR DELETE
  USING (auth.has_permission('planning.import', site_id));

DROP POLICY IF EXISTS site_users_select ON site_users;
DROP POLICY IF EXISTS site_users_insert ON site_users;
DROP POLICY IF EXISTS site_users_update ON site_users;
DROP POLICY IF EXISTS site_users_delete ON site_users;

CREATE POLICY site_users_select ON site_users FOR SELECT
  USING (
    id = auth.current_user_id()
    OR auth.has_permission('admin.users', site_id)
  );

CREATE POLICY site_users_insert ON site_users FOR INSERT
  WITH CHECK (
    auth.has_permission('admin.users', site_id)
    AND role IN ('member', 'site_admin', 'super_admin')
  );

CREATE POLICY site_users_update ON site_users FOR UPDATE
  USING (auth.has_permission('admin.users', site_id))
  WITH CHECK (
    auth.has_permission('admin.users', site_id)
    AND role IN ('member', 'site_admin', 'super_admin')
  );

CREATE POLICY site_users_delete ON site_users FOR DELETE
  USING (auth.has_permission('admin.users', site_id));
