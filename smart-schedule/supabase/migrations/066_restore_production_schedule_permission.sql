-- 066_restore_production_schedule_permission.sql
-- Restore batches.schedule to the production role.
--
-- Root cause: migration 017 corrected role baselines but omitted
-- batches.schedule from the production permission list, and its DELETE
-- block removed it from tenant_role_permissions. Without this permission,
-- RBAC v2 production users have canSchedule=false in the frontend, so
-- batch drag-and-drop and the Move button are both disabled. This prevents
-- production users from making any batch moves, including cross-resource
-- substitution moves they are entitled to perform.
--
-- Legacy 'member' users were unaffected because auth.has_permission()
-- falls back to the JWT app_role claim when no tenant_user_roles exist,
-- and the legacy member set includes batches.schedule. Pure RBAC v2
-- production users have no such fallback, so they were silently blocked.

INSERT INTO tenant_role_permissions (tenant_role_id, permission_id)
SELECT tr.id, p.id
FROM tenant_roles tr, permissions p
WHERE tr.site_id = '00000000-0000-0000-0000-000000000001'
  AND tr.code = 'production'
  AND tr.active = TRUE
  AND p.code = 'batches.schedule'
ON CONFLICT (tenant_role_id, permission_id) DO NOTHING;
