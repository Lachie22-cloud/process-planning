-- 033_grant_planning_ai_to_all_roles.sql
-- Grant planning.ai permission to all tenant roles so every user
-- can trigger AI analysis scans.

INSERT INTO tenant_role_permissions (tenant_role_id, permission_id)
SELECT tr.id, p.id
FROM tenant_roles tr, permissions p
WHERE p.code = 'planning.ai'
ON CONFLICT (tenant_role_id, permission_id) DO NOTHING;
