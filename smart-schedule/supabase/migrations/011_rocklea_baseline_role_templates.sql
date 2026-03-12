-- 011_rocklea_baseline_role_templates.sql
-- Seed Rocklea tenant role templates and baseline tenant_role_permissions
-- using the current hardcoded ROLE_PERMISSIONS capabilities.

BEGIN;

-- ============================================================
-- 1) ROCKLEA TENANT ROLE TEMPLATES
-- ============================================================
INSERT INTO tenant_roles (site_id, code, name, description, is_system, active)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'admin', 'Admin', 'Rocklea tenant admin baseline role', TRUE, TRUE),
  ('00000000-0000-0000-0000-000000000001', 'planner', 'Planner', 'Rocklea planning baseline role', TRUE, TRUE),
  ('00000000-0000-0000-0000-000000000001', 'production', 'Production', 'Rocklea production baseline role', TRUE, TRUE),
  ('00000000-0000-0000-0000-000000000001', 'qc_pc', 'QC/P&C', 'Rocklea combined QC and P&C baseline role', TRUE, TRUE),
  ('00000000-0000-0000-0000-000000000001', 'viewer', 'Viewer', 'Rocklea read-mostly baseline role', TRUE, TRUE),
  ('00000000-0000-0000-0000-000000000001', 'operational_lead', 'Operational Lead', 'Rocklea operations leadership baseline role', TRUE, TRUE)
ON CONFLICT (site_id, code)
DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_system = TRUE,
  active = TRUE,
  updated_at = NOW();

-- ============================================================
-- 2) ROCKLEA BASELINE ROLE -> PERMISSION MAPPING
-- Mirrors current hardcoded frontend ROLE_PERMISSIONS sets:
-- - site_admin set => admin/planner/operational_lead
-- - member set     => production/qc_pc/viewer
-- ============================================================
WITH role_permissions_map AS (
  SELECT *
  FROM (
    VALUES
      -- Admin (site_admin baseline)
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
      ('admin', 'admin.users'),
      ('admin', 'admin.settings'),
      ('admin', 'alerts.read'),
      ('admin', 'alerts.acknowledge'),

      -- Planner (site_admin baseline)
      ('planner', 'batches.read'),
      ('planner', 'batches.write'),
      ('planner', 'batches.schedule'),
      ('planner', 'batches.status'),
      ('planner', 'resources.read'),
      ('planner', 'resources.write'),
      ('planner', 'rules.read'),
      ('planner', 'rules.write'),
      ('planner', 'planning.import'),
      ('planner', 'planning.coverage'),
      ('planner', 'planning.vet'),
      ('planner', 'admin.users'),
      ('planner', 'admin.settings'),
      ('planner', 'alerts.read'),
      ('planner', 'alerts.acknowledge'),

      -- Operational Lead (site_admin baseline)
      ('operational_lead', 'batches.read'),
      ('operational_lead', 'batches.write'),
      ('operational_lead', 'batches.schedule'),
      ('operational_lead', 'batches.status'),
      ('operational_lead', 'resources.read'),
      ('operational_lead', 'resources.write'),
      ('operational_lead', 'rules.read'),
      ('operational_lead', 'rules.write'),
      ('operational_lead', 'planning.import'),
      ('operational_lead', 'planning.coverage'),
      ('operational_lead', 'planning.vet'),
      ('operational_lead', 'admin.users'),
      ('operational_lead', 'admin.settings'),
      ('operational_lead', 'alerts.read'),
      ('operational_lead', 'alerts.acknowledge'),

      -- Production (member baseline)
      ('production', 'batches.read'),
      ('production', 'batches.status'),
      ('production', 'resources.read'),
      ('production', 'rules.read'),
      ('production', 'planning.coverage'),
      ('production', 'alerts.read'),
      ('production', 'alerts.acknowledge'),

      -- QC/P&C (member baseline)
      ('qc_pc', 'batches.read'),
      ('qc_pc', 'batches.status'),
      ('qc_pc', 'resources.read'),
      ('qc_pc', 'rules.read'),
      ('qc_pc', 'planning.coverage'),
      ('qc_pc', 'alerts.read'),
      ('qc_pc', 'alerts.acknowledge'),

      -- Viewer (member baseline)
      ('viewer', 'batches.read'),
      ('viewer', 'batches.status'),
      ('viewer', 'resources.read'),
      ('viewer', 'rules.read'),
      ('viewer', 'planning.coverage'),
      ('viewer', 'alerts.read'),
      ('viewer', 'alerts.acknowledge')
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

-- Keep seeded baseline exact on reruns by removing stale permission links
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
      ('admin', 'admin.users'),
      ('admin', 'admin.settings'),
      ('admin', 'alerts.read'),
      ('admin', 'alerts.acknowledge'),
      ('planner', 'batches.read'),
      ('planner', 'batches.write'),
      ('planner', 'batches.schedule'),
      ('planner', 'batches.status'),
      ('planner', 'resources.read'),
      ('planner', 'resources.write'),
      ('planner', 'rules.read'),
      ('planner', 'rules.write'),
      ('planner', 'planning.import'),
      ('planner', 'planning.coverage'),
      ('planner', 'planning.vet'),
      ('planner', 'admin.users'),
      ('planner', 'admin.settings'),
      ('planner', 'alerts.read'),
      ('planner', 'alerts.acknowledge'),
      ('operational_lead', 'batches.read'),
      ('operational_lead', 'batches.write'),
      ('operational_lead', 'batches.schedule'),
      ('operational_lead', 'batches.status'),
      ('operational_lead', 'resources.read'),
      ('operational_lead', 'resources.write'),
      ('operational_lead', 'rules.read'),
      ('operational_lead', 'rules.write'),
      ('operational_lead', 'planning.import'),
      ('operational_lead', 'planning.coverage'),
      ('operational_lead', 'planning.vet'),
      ('operational_lead', 'admin.users'),
      ('operational_lead', 'admin.settings'),
      ('operational_lead', 'alerts.read'),
      ('operational_lead', 'alerts.acknowledge'),
      ('production', 'batches.read'),
      ('production', 'batches.status'),
      ('production', 'resources.read'),
      ('production', 'rules.read'),
      ('production', 'planning.coverage'),
      ('production', 'alerts.read'),
      ('production', 'alerts.acknowledge'),
      ('qc_pc', 'batches.read'),
      ('qc_pc', 'batches.status'),
      ('qc_pc', 'resources.read'),
      ('qc_pc', 'rules.read'),
      ('qc_pc', 'planning.coverage'),
      ('qc_pc', 'alerts.read'),
      ('qc_pc', 'alerts.acknowledge'),
      ('viewer', 'batches.read'),
      ('viewer', 'batches.status'),
      ('viewer', 'resources.read'),
      ('viewer', 'rules.read'),
      ('viewer', 'planning.coverage'),
      ('viewer', 'alerts.read'),
      ('viewer', 'alerts.acknowledge')
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
