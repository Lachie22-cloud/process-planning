-- 059_seed_schedule_permissions_to_roles.sql
-- Adds schedule.view_* permissions to existing tenant roles without modifying
-- any other permission assignments.
--
-- Mapping (matches frontend baseline):
--   admin, planner, qc_pc  → view_past, view_current, view_future
--   operational_lead, production, viewer → view_past, view_current

INSERT INTO tenant_role_permissions (tenant_role_id, permission_id)
SELECT tr.id, p.id
FROM tenant_roles tr
CROSS JOIN permissions p
WHERE tr.active = TRUE
  AND (
    -- Roles that get all three schedule permissions
    (tr.code IN ('admin', 'planner', 'qc_pc')
     AND p.code IN ('schedule.view_past', 'schedule.view_current', 'schedule.view_future'))
    OR
    -- Roles that get past + current only
    (tr.code IN ('operational_lead', 'production', 'viewer')
     AND p.code IN ('schedule.view_past', 'schedule.view_current'))
  )
ON CONFLICT (tenant_role_id, permission_id) DO NOTHING;
