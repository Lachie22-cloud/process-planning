-- 002_tenant_tables.sql: Resource configuration & core business tables
-- resources, batches, linked_fill_orders, audit_log, bulk_alerts,
-- resource_blocks, schedule_movements, notifications, substitution_rules,
-- schedule_rules, planning_data, admin_actions

-- ============================================================
-- RESOURCES (Equipment Definitions)
-- ============================================================
CREATE TABLE resources (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id             UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  resource_code       TEXT NOT NULL,                 -- e.g. "MIXER1", "DISP3"
  resource_type       TEXT NOT NULL,                 -- 'mixer', 'disperser', 'pot'
  display_name        TEXT,                          -- e.g. "Mixer 1"
  trunk_line          TEXT,                          -- e.g. "TK1", "TK2"
  group_name          TEXT,                          -- grouping for display
  min_capacity        NUMERIC,                      -- liters
  max_capacity        NUMERIC,                      -- liters
  max_batches_per_day INTEGER NOT NULL DEFAULT 1,   -- pots can have >1
  chemical_base       TEXT,                          -- 'solvent', 'water', null
  sort_order          INTEGER NOT NULL DEFAULT 0,   -- display ordering
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  config              JSONB NOT NULL DEFAULT '{}',  -- extra resource-specific settings
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_resources_site_code UNIQUE (site_id, resource_code)
);

-- ============================================================
-- BATCHES (Master Batch Records)
-- ============================================================
CREATE TABLE batches (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id               UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  sap_order             TEXT NOT NULL,
  material_code         TEXT,
  material_description  TEXT,
  bulk_code             TEXT,
  plan_date             DATE,
  plan_resource_id      UUID REFERENCES resources(id) ON DELETE SET NULL,
  batch_volume          NUMERIC,                    -- liters
  status                TEXT NOT NULL DEFAULT 'Planned'
    CHECK (status IN (
      'Planned', 'In Progress', 'Complete', 'Rework', 'NCB',
      'Excess Paint', 'Bulk Off', 'OFF', 'WOM', 'WOP',
      'On Test', 'Ready to Fill', 'Filling', 'Hold', 'Cancelled'
    )),
  sap_color_group       TEXT,
  pack_size             TEXT,
  rm_available          BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE = WOM
  packaging_available   BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE = WOP
  qc_observed_stage     TEXT,
  qc_observed_at        TIMESTAMPTZ,
  qc_observed_by        UUID REFERENCES site_users(id) ON DELETE SET NULL,
  job_location          TEXT,
  status_comment        TEXT,
  status_changed_at     TIMESTAMPTZ,
  status_changed_by     UUID REFERENCES site_users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_batches_site_sap_order UNIQUE (site_id, sap_order)
);

-- ============================================================
-- LINKED_FILL_ORDERS (Fill Order References)
-- ============================================================
CREATE TABLE linked_fill_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  site_id           UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE, -- denormalized for RLS
  fill_order        TEXT,
  fill_material     TEXT,
  fill_description  TEXT,
  pack_size         TEXT,
  quantity          NUMERIC,
  unit              TEXT,
  lid_type          TEXT                             -- 'red', 'blue', null
);

-- ============================================================
-- AUDIT_LOG (Change Tracking)
-- ============================================================
CREATE TABLE audit_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  batch_id          UUID REFERENCES batches(id) ON DELETE SET NULL,
  action            TEXT NOT NULL,
  details           JSONB,
  performed_by      UUID REFERENCES site_users(id) ON DELETE SET NULL,
  performed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- BULK_ALERTS (Product/Bulk Code Alerts)
-- ============================================================
CREATE TABLE bulk_alerts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  batch_id          UUID REFERENCES batches(id) ON DELETE SET NULL,
  bulk_code         TEXT,
  message           TEXT NOT NULL,
  start_date        DATE,
  end_date          DATE,
  created_by        UUID REFERENCES site_users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- RESOURCE_BLOCKS (Equipment Maintenance/Unavailability)
-- ============================================================
CREATE TABLE resource_blocks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  resource_id       UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  reason            TEXT,
  created_by        UUID REFERENCES site_users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SCHEDULE_MOVEMENTS (Batch Movement History)
-- ============================================================
CREATE TABLE schedule_movements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  batch_id          UUID REFERENCES batches(id) ON DELETE SET NULL,
  from_resource_id  UUID REFERENCES resources(id) ON DELETE SET NULL,
  to_resource_id    UUID REFERENCES resources(id) ON DELETE SET NULL,
  from_date         DATE,
  to_date           DATE,
  direction         TEXT,                            -- 'pulled', 'pushed', 'moved'
  reason            TEXT,
  moved_by          UUID REFERENCES site_users(id) ON DELETE SET NULL,
  moved_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS (User Notifications)
-- ============================================================
CREATE TABLE notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES site_users(id) ON DELETE SET NULL,
  title             TEXT,
  message           TEXT,
  type              TEXT,                            -- 'warning', 'info', 'error'
  read              BOOLEAN NOT NULL DEFAULT FALSE,
  batch_id          UUID REFERENCES batches(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SUBSTITUTION_RULES (Resource Substitution Rules)
-- ============================================================
CREATE TABLE substitution_rules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id               UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  source_resource_id    UUID REFERENCES resources(id) ON DELETE SET NULL,
  target_resource_id    UUID REFERENCES resources(id) ON DELETE SET NULL,
  conditions            JSONB,                       -- { maxVolume, minVolume, colorGroups }
  enabled               BOOLEAN NOT NULL DEFAULT TRUE,
  created_by            UUID REFERENCES site_users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SCHEDULE_RULES (Configurable Schedule Rules)
-- ============================================================
CREATE TABLE schedule_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT,
  rule_type         TEXT,                            -- 'schedule', 'bulk'
  conditions        JSONB,
  actions           JSONB,
  rule_version      INTEGER NOT NULL DEFAULT 1,      -- schema version
  schema_id         TEXT NOT NULL DEFAULT 'schedule-rule/v1',  -- validation key
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by        UUID REFERENCES site_users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PLANNING_DATA (Import Data Cache)
-- ============================================================
CREATE TABLE planning_data (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  material_code     TEXT,
  data_type         TEXT,                            -- 'zp40', 'mb52', 'zw04'
  data              JSONB,
  imported_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_by       UUID REFERENCES site_users(id) ON DELETE SET NULL
);

-- ============================================================
-- ADMIN_ACTIONS (Audit of Admin Operations)
-- ============================================================
CREATE TABLE admin_actions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID REFERENCES sites(id) ON DELETE CASCADE, -- nullable for platform-level actions
  actor_user_id     UUID NOT NULL REFERENCES site_users(id) ON DELETE CASCADE,
  action            TEXT NOT NULL,                   -- e.g. 'user.promote_site_admin', 'rule.update'
  target_type       TEXT NOT NULL,                   -- 'user', 'rule', 'resource', 'site'
  target_id         UUID,
  metadata          JSONB NOT NULL DEFAULT '{}',     -- request context, before/after
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES for business tables
-- ============================================================
CREATE INDEX idx_resources_site_id_type
  ON resources(site_id, resource_type);

CREATE INDEX idx_batches_site_id_plan_date_resource
  ON batches(site_id, plan_date, plan_resource_id);

CREATE INDEX idx_batches_site_id_status
  ON batches(site_id, status);

CREATE INDEX idx_batches_site_id_bulk_code
  ON batches(site_id, bulk_code);

CREATE INDEX idx_batches_site_id_sap_order
  ON batches(site_id, sap_order);

CREATE INDEX idx_audit_log_site_id_batch_id_performed_at
  ON audit_log(site_id, batch_id, performed_at DESC);

CREATE INDEX idx_linked_fill_orders_batch_id
  ON linked_fill_orders(batch_id);

CREATE INDEX idx_notifications_site_id_user_id_read
  ON notifications(site_id, user_id, read, created_at DESC);

CREATE INDEX idx_resource_blocks_site_resource_dates
  ON resource_blocks(site_id, resource_id, start_date, end_date);

CREATE INDEX idx_bulk_alerts_site_bulk_dates
  ON bulk_alerts(site_id, bulk_code, start_date, end_date);
