-- 070_add_planning_health_check_permission.sql
-- Register planning.health_check in the global permissions catalog.
-- This permission exists in TypeScript code but was never seeded to the DB,
-- causing "Unknown permission codes" when saving RBAC changes via the UI.

-- 1. Register the permission
INSERT INTO permissions (code, description)
VALUES ('planning.health_check', 'View schedule health check and run analysis')
ON CONFLICT (code) DO NOTHING;

-- 2. Grant to admin and planner roles
INSERT INTO tenant_role_permissions (tenant_role_id, permission_id)
SELECT tr.id, p.id
FROM tenant_roles tr, permissions p
WHERE p.code = 'planning.health_check'
  AND tr.code IN ('admin', 'planner')
ON CONFLICT (tenant_role_id, permission_id) DO NOTHING;
