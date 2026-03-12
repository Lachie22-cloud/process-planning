-- 003_rls_policies.sql: Row-Level Security policies + helper functions
-- Helper functions: auth.user_site_id(), auth.is_super_admin(), auth.is_admin()
-- RLS policies for all tenant-scoped tables

-- ============================================================
-- CREATE auth SCHEMA (if not exists)
-- ============================================================
CREATE SCHEMA IF NOT EXISTS auth;

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Extract current user's site_id from JWT claims
CREATE OR REPLACE FUNCTION auth.user_site_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT (current_setting('request.jwt.claims', TRUE)::jsonb ->> 'site_id')::uuid;
$$;

-- Check if current user is super_admin
CREATE OR REPLACE FUNCTION auth.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', TRUE)::jsonb ->> 'role') = 'super_admin',
    FALSE
  );
$$;

-- Check if current user is site_admin or super_admin
CREATE OR REPLACE FUNCTION auth.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', TRUE)::jsonb ->> 'role') IN ('super_admin', 'site_admin'),
    FALSE
  );
$$;

-- Get current user's id from JWT claims
CREATE OR REPLACE FUNCTION auth.current_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', TRUE)::jsonb ->> 'user_id', ''),
    NULLIF(current_setting('request.jwt.claims', TRUE)::jsonb ->> 'sub', '')
  )::uuid;
$$;

-- ============================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_site_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE linked_fill_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE substitution_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SITES POLICIES
-- ============================================================
-- Super admin sees all; others see only their site
CREATE POLICY sites_select ON sites FOR SELECT
  USING (auth.is_super_admin() OR id = auth.user_site_id());

-- Only super admin can insert/update/delete sites
CREATE POLICY sites_insert ON sites FOR INSERT
  WITH CHECK (auth.is_super_admin());

CREATE POLICY sites_update ON sites FOR UPDATE
  USING (auth.is_super_admin());

CREATE POLICY sites_delete ON sites FOR DELETE
  USING (auth.is_super_admin());

-- ============================================================
-- SITE_USERS POLICIES
-- ============================================================
-- Users can always see their own record; admins see all at their site
CREATE POLICY site_users_select ON site_users FOR SELECT
  USING (
    id = auth.current_user_id()
    OR (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

-- site_admin can insert for their site; super_admin for any
CREATE POLICY site_users_insert ON site_users FOR INSERT
  WITH CHECK (
    (
      site_id = auth.user_site_id()
      AND auth.is_admin()
      AND role IN ('member', 'site_admin')
    )
    OR (
      auth.is_super_admin()
      AND role IN ('member', 'site_admin', 'super_admin')
    )
  );

-- site_admin can update within their site; super_admin for any
CREATE POLICY site_users_update ON site_users FOR UPDATE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  )
  WITH CHECK (
    (
      site_id = auth.user_site_id()
      AND auth.is_admin()
      AND role IN ('member', 'site_admin')
    )
    OR (
      auth.is_super_admin()
      AND role IN ('member', 'site_admin', 'super_admin')
    )
  );

-- site_admin can delete within their site; super_admin for any
CREATE POLICY site_users_delete ON site_users FOR DELETE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

-- ============================================================
-- ROLES POLICIES (read-only for most users)
-- ============================================================
CREATE POLICY roles_select ON roles FOR SELECT
  USING (TRUE);  -- all authenticated users can read role definitions

CREATE POLICY roles_modify ON roles FOR ALL
  USING (auth.is_super_admin());

-- ============================================================
-- PERMISSIONS POLICIES (read-only for most users)
-- ============================================================
CREATE POLICY permissions_select ON permissions FOR SELECT
  USING (TRUE);

CREATE POLICY permissions_modify ON permissions FOR ALL
  USING (auth.is_super_admin());

-- ============================================================
-- ROLE_PERMISSIONS POLICIES
-- ============================================================
CREATE POLICY role_permissions_select ON role_permissions FOR SELECT
  USING (TRUE);

CREATE POLICY role_permissions_modify ON role_permissions FOR ALL
  USING (auth.is_super_admin());

-- ============================================================
-- USER_SITE_ROLES POLICIES
-- ============================================================
CREATE POLICY user_site_roles_select ON user_site_roles FOR SELECT
  USING (
    site_id = auth.user_site_id()
    OR auth.is_super_admin()
  );

CREATE POLICY user_site_roles_insert ON user_site_roles FOR INSERT
  WITH CHECK (
    (
      site_id = auth.user_site_id()
      AND auth.is_admin()
      AND role_id IN (SELECT id FROM roles WHERE code IN ('member', 'site_admin'))
    )
    OR (
      auth.is_super_admin()
      AND role_id IN (SELECT id FROM roles WHERE code IN ('member', 'site_admin', 'super_admin'))
    )
  );

CREATE POLICY user_site_roles_update ON user_site_roles FOR UPDATE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  )
  WITH CHECK (
    (
      site_id = auth.user_site_id()
      AND auth.is_admin()
      AND role_id IN (SELECT id FROM roles WHERE code IN ('member', 'site_admin'))
    )
    OR (
      auth.is_super_admin()
      AND role_id IN (SELECT id FROM roles WHERE code IN ('member', 'site_admin', 'super_admin'))
    )
  );

CREATE POLICY user_site_roles_delete ON user_site_roles FOR DELETE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

-- ============================================================
-- TENANT-SCOPED TABLE POLICIES
-- Same pattern: SELECT by site or super_admin,
-- INSERT/UPDATE by site members, DELETE by admin
-- ============================================================

-- --- RESOURCES ---
CREATE POLICY resources_select ON resources FOR SELECT
  USING (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY resources_insert ON resources FOR INSERT
  WITH CHECK (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

CREATE POLICY resources_update ON resources FOR UPDATE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

CREATE POLICY resources_delete ON resources FOR DELETE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

-- --- BATCHES ---
CREATE POLICY batches_select ON batches FOR SELECT
  USING (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY batches_insert ON batches FOR INSERT
  WITH CHECK (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY batches_update ON batches FOR UPDATE
  USING (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY batches_delete ON batches FOR DELETE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

-- --- LINKED_FILL_ORDERS ---
CREATE POLICY linked_fill_orders_select ON linked_fill_orders FOR SELECT
  USING (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY linked_fill_orders_insert ON linked_fill_orders FOR INSERT
  WITH CHECK (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY linked_fill_orders_update ON linked_fill_orders FOR UPDATE
  USING (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY linked_fill_orders_delete ON linked_fill_orders FOR DELETE
  USING (site_id = auth.user_site_id() OR auth.is_super_admin());

-- --- AUDIT_LOG ---
CREATE POLICY audit_log_select ON audit_log FOR SELECT
  USING (site_id = auth.user_site_id() OR auth.is_super_admin());

-- Audit log insert is done by SECURITY DEFINER functions, not directly
CREATE POLICY audit_log_insert ON audit_log FOR INSERT
  WITH CHECK (site_id = auth.user_site_id() OR auth.is_super_admin());

-- No update/delete on audit_log (immutable)

-- --- BULK_ALERTS ---
CREATE POLICY bulk_alerts_select ON bulk_alerts FOR SELECT
  USING (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY bulk_alerts_insert ON bulk_alerts FOR INSERT
  WITH CHECK (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY bulk_alerts_update ON bulk_alerts FOR UPDATE
  USING (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY bulk_alerts_delete ON bulk_alerts FOR DELETE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

-- --- RESOURCE_BLOCKS ---
CREATE POLICY resource_blocks_select ON resource_blocks FOR SELECT
  USING (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY resource_blocks_insert ON resource_blocks FOR INSERT
  WITH CHECK (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

CREATE POLICY resource_blocks_update ON resource_blocks FOR UPDATE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

CREATE POLICY resource_blocks_delete ON resource_blocks FOR DELETE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

-- --- SCHEDULE_MOVEMENTS ---
CREATE POLICY schedule_movements_select ON schedule_movements FOR SELECT
  USING (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY schedule_movements_insert ON schedule_movements FOR INSERT
  WITH CHECK (site_id = auth.user_site_id() OR auth.is_super_admin());

-- No update/delete on schedule_movements (immutable history)

-- --- NOTIFICATIONS ---
CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (
    (site_id = auth.user_site_id() AND (user_id = auth.current_user_id() OR auth.is_admin()))
    OR auth.is_super_admin()
  );

CREATE POLICY notifications_insert ON notifications FOR INSERT
  WITH CHECK (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY notifications_update ON notifications FOR UPDATE
  USING (
    (site_id = auth.user_site_id() AND user_id = auth.current_user_id())
    OR auth.is_super_admin()
  );

CREATE POLICY notifications_delete ON notifications FOR DELETE
  USING (
    (site_id = auth.user_site_id() AND user_id = auth.current_user_id())
    OR auth.is_super_admin()
  );

-- --- SUBSTITUTION_RULES ---
CREATE POLICY substitution_rules_select ON substitution_rules FOR SELECT
  USING (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY substitution_rules_insert ON substitution_rules FOR INSERT
  WITH CHECK (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

CREATE POLICY substitution_rules_update ON substitution_rules FOR UPDATE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

CREATE POLICY substitution_rules_delete ON substitution_rules FOR DELETE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

-- --- SCHEDULE_RULES ---
CREATE POLICY schedule_rules_select ON schedule_rules FOR SELECT
  USING (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY schedule_rules_insert ON schedule_rules FOR INSERT
  WITH CHECK (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

CREATE POLICY schedule_rules_update ON schedule_rules FOR UPDATE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

CREATE POLICY schedule_rules_delete ON schedule_rules FOR DELETE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

-- --- PLANNING_DATA ---
CREATE POLICY planning_data_select ON planning_data FOR SELECT
  USING (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY planning_data_insert ON planning_data FOR INSERT
  WITH CHECK (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY planning_data_update ON planning_data FOR UPDATE
  USING (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY planning_data_delete ON planning_data FOR DELETE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

-- --- ADMIN_ACTIONS ---
CREATE POLICY admin_actions_select ON admin_actions FOR SELECT
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

CREATE POLICY admin_actions_insert ON admin_actions FOR INSERT
  WITH CHECK (auth.is_admin() OR auth.is_super_admin());
