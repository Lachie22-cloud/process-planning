-- 064_restrict_planning_tab_to_planner_and_admin.sql
-- Remove planning.coverage from operational_lead, production, qc_pc and viewer
-- so that only the planner and admin roles can see the Planning tab.

DELETE FROM tenant_role_permissions
WHERE permission_id = (SELECT id FROM permissions WHERE code = 'planning.coverage')
  AND tenant_role_id IN (
    SELECT id FROM tenant_roles
    WHERE code IN ('operational_lead', 'production', 'qc_pc', 'viewer')
  );
