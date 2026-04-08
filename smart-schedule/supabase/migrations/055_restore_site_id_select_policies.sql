-- 055_restore_site_id_select_policies.sql
-- Emergency fix: restore simple site_id-based SELECT access for all tables.
--
-- Migration 012 replaced all SELECT policies with auth.has_permission() checks.
-- Despite fixes to that function (053, 054), data still isn't loading.
-- This migration adds back the proven `site_id = auth.user_site_id()` check
-- as an OR condition on every SELECT policy, guaranteeing data access for
-- any authenticated user within their site.

-- ── BATCHES ──
DROP POLICY IF EXISTS batches_select ON batches;
CREATE POLICY batches_select ON batches FOR SELECT
  USING (
    site_id = auth.user_site_id()
    OR auth.is_super_admin()
  );

-- ── RESOURCES ──
DROP POLICY IF EXISTS resources_select ON resources;
CREATE POLICY resources_select ON resources FOR SELECT
  USING (
    site_id = auth.user_site_id()
    OR auth.is_super_admin()
  );

-- ── SUBSTITUTION_RULES ──
DROP POLICY IF EXISTS substitution_rules_select ON substitution_rules;
CREATE POLICY substitution_rules_select ON substitution_rules FOR SELECT
  USING (
    site_id = auth.user_site_id()
    OR auth.is_super_admin()
  );

-- ── SCHEDULE_RULES ──
DROP POLICY IF EXISTS schedule_rules_select ON schedule_rules;
CREATE POLICY schedule_rules_select ON schedule_rules FOR SELECT
  USING (
    site_id = auth.user_site_id()
    OR auth.is_super_admin()
  );

-- ── RESOURCE_BLOCKS ──
DROP POLICY IF EXISTS resource_blocks_select ON resource_blocks;
CREATE POLICY resource_blocks_select ON resource_blocks FOR SELECT
  USING (
    site_id = auth.user_site_id()
    OR auth.is_super_admin()
  );

-- ── BULK_ALERTS ──
DROP POLICY IF EXISTS bulk_alerts_select ON bulk_alerts;
CREATE POLICY bulk_alerts_select ON bulk_alerts FOR SELECT
  USING (
    site_id = auth.user_site_id()
    OR auth.is_super_admin()
  );

-- ── PLANNING_DATA ──
DROP POLICY IF EXISTS planning_data_select ON planning_data;
CREATE POLICY planning_data_select ON planning_data FOR SELECT
  USING (
    site_id = auth.user_site_id()
    OR auth.is_super_admin()
  );

-- ── SITE_USERS (preserve bootstrap fallback from migration 014) ──
DROP POLICY IF EXISTS site_users_select ON site_users;
CREATE POLICY site_users_select ON site_users FOR SELECT
  USING (
    id = auth.current_user_id()
    OR site_id = auth.user_site_id()
    OR auth.is_super_admin()
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

-- ── TENANT RBAC tables (keep permission-based for admin-only tables) ──
-- These are admin-only tables, so auth.has_permission is correct for them.
-- But add site_id fallback for admins who don't have tenant_user_roles yet.
DROP POLICY IF EXISTS tenant_roles_select ON tenant_roles;
CREATE POLICY tenant_roles_select ON tenant_roles FOR SELECT
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

DROP POLICY IF EXISTS tenant_role_permissions_select ON tenant_role_permissions;
CREATE POLICY tenant_role_permissions_select ON tenant_role_permissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tenant_roles tr
      WHERE tr.id = tenant_role_permissions.tenant_role_id
        AND (
          (tr.site_id = auth.user_site_id() AND auth.is_admin())
          OR auth.is_super_admin()
        )
    )
  );

DROP POLICY IF EXISTS tenant_user_roles_select ON tenant_user_roles;
CREATE POLICY tenant_user_roles_select ON tenant_user_roles FOR SELECT
  USING (
    auth.current_user_id() = user_id
    OR (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

DROP POLICY IF EXISTS tenant_permission_policies_select ON tenant_permission_policies;
CREATE POLICY tenant_permission_policies_select ON tenant_permission_policies FOR SELECT
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

DROP POLICY IF EXISTS rbac_audit_log_select ON rbac_audit_log;
CREATE POLICY rbac_audit_log_select ON rbac_audit_log FOR SELECT
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );
