-- 017_update_rocklea_baselines.sql
-- Update Rocklea tenant role permissions to match the permission document.
-- Adds new permission codes (planning.export, planning.ai, alerts.write)
-- and corrects per-role mappings.

BEGIN;

-- ============================================================
-- 1) INSERT corrected role -> permission mappings
-- ============================================================
WITH role_permissions_map AS (
  SELECT *
  FROM (
    VALUES
      -- Admin: full access
      ('admin', 'batches.read'),
      ('admin', 'batches.write'),
      ('admin', 'batches.schedule'),
      ('admin', 'batches.status'),
      ('admin', 'resources.read'),
      ('admin', 'resources.write'),
      ('admin', 'rules.read'),
      ('admin', 'rules.write'),
      ('admin', 'planning.import'),
      ('admin', 'planning.coverage'),
      ('admin', 'planning.vet'),
      ('admin', 'planning.export'),
      ('admin', 'planning.ai'),
      ('admin', 'admin.users'),
      ('admin', 'admin.settings'),
      ('admin', 'alerts.read'),
      ('admin', 'alerts.write'),
      ('admin', 'alerts.acknowledge'),

      -- Planner: everything except rules.write, admin.users, admin.settings
      ('planner', 'batches.read'),
      ('planner', 'batches.write'),
      ('planner', 'batches.schedule'),
      ('planner', 'batches.status'),
      ('planner', 'resources.read'),
      ('planner', 'resources.write'),
      ('planner', 'rules.read'),
      ('planner', 'planning.import'),
      ('planner', 'planning.coverage'),
      ('planner', 'planning.vet'),
      ('planner', 'planning.export'),
      ('planner', 'planning.ai'),
      ('planner', 'alerts.read'),
      ('planner', 'alerts.acknowledge'),

      -- Operational Lead: view-only, full horizon, stats access
      ('operational_lead', 'batches.read'),
      ('operational_lead', 'resources.read'),
      ('operational_lead', 'rules.read'),
      ('operational_lead', 'planning.coverage'),
      ('operational_lead', 'alerts.read'),

      -- Production: current week batch ops + read-only elsewhere
      ('production', 'batches.read'),
      ('production', 'batches.status'),
      ('production', 'resources.read'),
      ('production', 'rules.read'),
      ('production', 'planning.coverage'),
      ('production', 'alerts.read'),

      -- QC/P&C: QC statuses + alert management
      ('qc_pc', 'batches.read'),
      ('qc_pc', 'batches.status'),
      ('qc_pc', 'alerts.read'),
      ('qc_pc', 'alerts.write'),
      ('qc_pc', 'alerts.acknowledge'),

      -- Viewer: read-only
      ('viewer', 'batches.read'),
      ('viewer', 'resources.read'),
      ('viewer', 'rules.read'),
      ('viewer', 'planning.coverage'),
      ('viewer', 'alerts.read')
  ) AS t(role_code, permission_code)
),
desired AS (
  SELECT tr.id AS tenant_role_id, p.id AS permission_id
  FROM role_permissions_map rpm
  JOIN tenant_roles tr
    ON tr.site_id = '00000000-0000-0000-0000-000000000001'
   AND tr.code = rpm.role_code
  JOIN permissions p
    ON p.code = rpm.permission_code
)
INSERT INTO tenant_role_permissions (tenant_role_id, permission_id)
SELECT tenant_role_id, permission_id
FROM desired
ON CONFLICT (tenant_role_id, permission_id) DO NOTHING;

-- ============================================================
-- 2) Remove stale permission links no longer in the baseline
-- ============================================================
WITH rocklea_seeded_roles AS (
  SELECT id, code
  FROM tenant_roles
  WHERE site_id = '00000000-0000-0000-0000-000000000001'
    AND code IN ('admin', 'planner', 'production', 'qc_pc', 'viewer', 'operational_lead')
),
role_permissions_map AS (
  SELECT *
  FROM (
    VALUES
      ('admin', 'batches.read'),
      ('admin', 'batches.write'),
      ('admin', 'batches.schedule'),
      ('admin', 'batches.status'),
      ('admin', 'resources.read'),
      ('admin', 'resources.write'),
      ('admin', 'rules.read'),
      ('admin', 'rules.write'),
      ('admin', 'planning.import'),
      ('admin', 'planning.coverage'),
      ('admin', 'planning.vet'),
      ('admin', 'planning.export'),
      ('admin', 'planning.ai'),
      ('admin', 'admin.users'),
      ('admin', 'admin.settings'),
      ('admin', 'alerts.read'),
      ('admin', 'alerts.write'),
      ('admin', 'alerts.acknowledge'),
      ('planner', 'batches.read'),
      ('planner', 'batches.write'),
      ('planner', 'batches.schedule'),
      ('planner', 'batches.status'),
      ('planner', 'resources.read'),
      ('planner', 'resources.write'),
      ('planner', 'rules.read'),
      ('planner', 'planning.import'),
      ('planner', 'planning.coverage'),
      ('planner', 'planning.vet'),
      ('planner', 'planning.export'),
      ('planner', 'planning.ai'),
      ('planner', 'alerts.read'),
      ('planner', 'alerts.acknowledge'),
      ('operational_lead', 'batches.read'),
      ('operational_lead', 'resources.read'),
      ('operational_lead', 'rules.read'),
      ('operational_lead', 'planning.coverage'),
      ('operational_lead', 'alerts.read'),
      ('production', 'batches.read'),
      ('production', 'batches.status'),
      ('production', 'resources.read'),
      ('production', 'rules.read'),
      ('production', 'planning.coverage'),
      ('production', 'alerts.read'),
      ('qc_pc', 'batches.read'),
      ('qc_pc', 'batches.status'),
      ('qc_pc', 'alerts.read'),
      ('qc_pc', 'alerts.write'),
      ('qc_pc', 'alerts.acknowledge'),
      ('viewer', 'batches.read'),
      ('viewer', 'resources.read'),
      ('viewer', 'rules.read'),
      ('viewer', 'planning.coverage'),
      ('viewer', 'alerts.read')
  ) AS t(role_code, permission_code)
),
desired AS (
  SELECT rsr.id AS tenant_role_id, p.id AS permission_id
  FROM role_permissions_map rpm
  JOIN rocklea_seeded_roles rsr
    ON rsr.code = rpm.role_code
  JOIN permissions p
    ON p.code = rpm.permission_code
)
DELETE FROM tenant_role_permissions trp
USING rocklea_seeded_roles rsr
WHERE trp.tenant_role_id = rsr.id
  AND NOT EXISTS (
    SELECT 1
    FROM desired d
    WHERE d.tenant_role_id = trp.tenant_role_id
      AND d.permission_id = trp.permission_id
  );

COMMIT;
