-- 042_material_shortages.sql: Material shortages tracking with ETA and planner override
-- Tracks per-material shortage state derived from SOH vs BOM requirements,
-- with planner-controlled override and next-delivery ETA for AI rescheduling.

-- ============================================================
-- MATERIAL SHORTAGES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS material_shortages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  material_code   TEXT NOT NULL,
  material_desc   TEXT,
  material_type   TEXT NOT NULL DEFAULT 'RM'
    CHECK (material_type IN ('RM', 'PKG')),
  required_qty    NUMERIC NOT NULL DEFAULT 0,
  soh_qty         NUMERIC NOT NULL DEFAULT 0,
  short_qty       NUMERIC NOT NULL DEFAULT 0,
  uom             TEXT NOT NULL DEFAULT 'KG',
  eta             DATE,                              -- next delivery date (for AI rescheduling)
  planner_override BOOLEAN NOT NULL DEFAULT FALSE,   -- planner has manually cleared shortage
  override_by     UUID REFERENCES site_users(id) ON DELETE SET NULL,
  override_at     TIMESTAMPTZ,
  override_comment TEXT,                             -- mandatory comment when overriding
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One shortage record per site + material
  UNIQUE (site_id, material_code)
);

-- Index for fast site-scoped queries
CREATE INDEX IF NOT EXISTS idx_material_shortages_site
  ON material_shortages(site_id);

-- Index for finding materials that are actually short (not overridden)
CREATE INDEX IF NOT EXISTS idx_material_shortages_active
  ON material_shortages(site_id, planner_override) WHERE short_qty < 0;

-- ============================================================
-- LINK SHORTAGES TO BATCHES (many-to-many)
-- ============================================================
CREATE TABLE IF NOT EXISTS batch_material_shortages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  batch_id        UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  shortage_id     UUID NOT NULL REFERENCES material_shortages(id) ON DELETE CASCADE,
  short_qty       NUMERIC NOT NULL DEFAULT 0,         -- how much this batch is short
  planner_override BOOLEAN NOT NULL DEFAULT FALSE,    -- batch-level override
  override_by     UUID REFERENCES site_users(id) ON DELETE SET NULL,
  override_at     TIMESTAMPTZ,
  override_comment TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (batch_id, shortage_id)
);

CREATE INDEX IF NOT EXISTS idx_batch_material_shortages_batch
  ON batch_material_shortages(batch_id);

CREATE INDEX IF NOT EXISTS idx_batch_material_shortages_shortage
  ON batch_material_shortages(shortage_id);
