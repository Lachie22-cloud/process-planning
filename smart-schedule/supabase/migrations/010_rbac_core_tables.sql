-- 010_rbac_core_tables.sql
-- RBAC core tables (tenant-scoped roles + policy + audit) and permission seed catalog

-- ============================================================
-- PERMISSIONS (global capability catalog)
-- Existing table in 001_schema.sql; keep idempotent for re-runs.
-- ============================================================
CREATE TABLE IF NOT EXISTS permissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_permissions_code
  ON permissions(code);

-- ============================================================
-- TENANT_ROLES
-- ============================================================
CREATE TABLE IF NOT EXISTS tenant_roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  is_system     BOOLEAN NOT NULL DEFAULT FALSE,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    UUID REFERENCES site_users(id) ON DELETE SET NULL,
  updated_by    UUID REFERENCES site_users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_tenant_roles_site_code UNIQUE (site_id, code)
);

CREATE INDEX IF NOT EXISTS idx_tenant_roles_site_active
  ON tenant_roles(site_id, active);
CREATE INDEX IF NOT EXISTS idx_tenant_roles_site_name
  ON tenant_roles(site_id, name);

-- ============================================================
-- TENANT_ROLE_PERMISSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS tenant_role_permissions (
  tenant_role_id  UUID NOT NULL REFERENCES tenant_roles(id) ON DELETE CASCADE,
  permission_id   UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_by      UUID REFERENCES site_users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (tenant_role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_role_permissions_permission_id
  ON tenant_role_permissions(permission_id);

-- ============================================================
-- TENANT_USER_ROLES
-- ============================================================
CREATE TABLE IF NOT EXISTS tenant_user_roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES site_users(id) ON DELETE CASCADE,
  tenant_role_id  UUID NOT NULL REFERENCES tenant_roles(id) ON DELETE CASCADE,
  assigned_by     UUID REFERENCES site_users(id) ON DELETE SET NULL,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_tenant_user_roles_user_site_role UNIQUE (site_id, user_id, tenant_role_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_user_roles_site_user_active
  ON tenant_user_roles(site_id, user_id, active);
CREATE INDEX IF NOT EXISTS idx_tenant_user_roles_role_active
  ON tenant_user_roles(tenant_role_id, active);
CREATE INDEX IF NOT EXISTS idx_tenant_user_roles_expires_at
  ON tenant_user_roles(expires_at)
  WHERE expires_at IS NOT NULL;

-- ============================================================
-- TENANT_PERMISSION_POLICIES
-- ============================================================
CREATE TABLE IF NOT EXISTS tenant_permission_policies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  permission_id   UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  policy_name     TEXT NOT NULL,
  effect          TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  priority        INTEGER NOT NULL DEFAULT 100,
  conditions      JSONB NOT NULL DEFAULT '{}',
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID REFERENCES site_users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES site_users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_permission_policies_site_permission_active
  ON tenant_permission_policies(site_id, permission_id, active, priority);
CREATE INDEX IF NOT EXISTS idx_tenant_permission_policies_site_effect_active
  ON tenant_permission_policies(site_id, effect, active);

-- ============================================================
-- RBAC_AUDIT_LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS rbac_audit_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  actor_user_id     UUID REFERENCES site_users(id) ON DELETE SET NULL,
  action            TEXT NOT NULL,
  target_type       TEXT NOT NULL,
  target_id         UUID,
  permission_id     UUID REFERENCES permissions(id) ON DELETE SET NULL,
  tenant_role_id    UUID REFERENCES tenant_roles(id) ON DELETE SET NULL,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rbac_audit_log_site_created_at
  ON rbac_audit_log(site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rbac_audit_log_actor_created_at
  ON rbac_audit_log(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rbac_audit_log_target
  ON rbac_audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_rbac_audit_log_action
  ON rbac_audit_log(action);

-- ============================================================
-- GLOBAL PERMISSION CATALOG SEED
-- Seed all capability codes from src/hooks/use-permissions.ts ROLE_PERMISSIONS map.
-- ============================================================
INSERT INTO permissions (code, description)
VALUES
  ('batches.read', 'View batch schedule'),
  ('batches.write', 'Edit batch details'),
  ('batches.schedule', 'Schedule/reschedule batches'),
  ('batches.status', 'Change batch status'),
  ('resources.read', 'View resources'),
  ('resources.write', 'Edit resource configuration'),
  ('rules.read', 'View scheduling rules'),
  ('rules.write', 'Edit scheduling rules'),
  ('planning.import', 'Import SAP data'),
  ('planning.coverage', 'View coverage analysis'),
  ('planning.vet', 'Approve or reject batch vetting'),
  ('admin.users', 'Manage site users'),
  ('admin.settings', 'Edit site settings'),
  ('admin.sites', 'Manage all sites (super admin)'),
  ('alerts.read', 'View alerts'),
  ('alerts.acknowledge', 'Acknowledge alerts')
ON CONFLICT (code)
DO UPDATE SET description = EXCLUDED.description;