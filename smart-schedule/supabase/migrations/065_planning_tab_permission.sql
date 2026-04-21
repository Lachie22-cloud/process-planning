-- 065_planning_tab_permission.sql
-- Introduce planning.tab as a dedicated permission for Planning tab access.
-- Only admin and planner roles receive it; all other roles keep planning.coverage
-- for fine-grained component-level use without gaining tab access.
-- Also restores planning.coverage to operational_lead, production, qc_pc and
-- viewer that was removed by migration 064.

-- 1. Register the new permission
INSERT INTO permissions (code, description)
VALUES ('planning.tab', 'Access the Planning tab')
ON CONFLICT (code) DO NOTHING;

-- 2. Grant planning.tab to admin and planner only
INSERT INTO tenant_role_permissions (tenant_role_id, permission_id)
SELECT tr.id, p.id
FROM tenant_roles tr, permissions p
WHERE p.code = 'planning.tab'
  AND tr.code IN ('admin', 'planner')
ON CONFLICT (tenant_role_id, permission_id) DO NOTHING;

-- 3. Restore planning.coverage to roles that 064 removed it from
INSERT INTO tenant_role_permissions (tenant_role_id, permission_id)
SELECT tr.id, p.id
FROM tenant_roles tr, permissions p
WHERE p.code = 'planning.coverage'
  AND tr.code IN ('operational_lead', 'production', 'qc_pc', 'viewer')
ON CONFLICT (tenant_role_id, permission_id) DO NOTHING;
