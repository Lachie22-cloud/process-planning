-- 009_planning_vetting.sql: Add planning parity fields + vetting workflow
-- stock_cover, safety_stock, po_date, po_quantity, forecast, material_shortage
-- vetting_status, vetted_by, vetted_at, vetting_comment

-- ============================================================
-- PLANNING PARITY FIELDS on BATCHES
-- ============================================================
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS stock_cover       NUMERIC,          -- days of stock cover (from ZP40)
  ADD COLUMN IF NOT EXISTS safety_stock      NUMERIC,          -- safety stock level (from MB52)
  ADD COLUMN IF NOT EXISTS po_date           DATE,             -- next PO delivery date (from ZW04)
  ADD COLUMN IF NOT EXISTS po_quantity       NUMERIC,          -- PO quantity (from ZW04)
  ADD COLUMN IF NOT EXISTS forecast          NUMERIC,          -- forecast value M0 (from ZP40)
  ADD COLUMN IF NOT EXISTS material_shortage BOOLEAN NOT NULL DEFAULT FALSE;  -- derived: material short

-- ============================================================
-- VETTING WORKFLOW FIELDS on BATCHES
-- ============================================================
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS vetting_status  TEXT NOT NULL DEFAULT 'pending'
    CHECK (vetting_status IN ('pending', 'approved', 'rejected', 'not_required')),
  ADD COLUMN IF NOT EXISTS vetted_by       UUID REFERENCES site_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vetted_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vetting_comment TEXT;

-- Index for filtering by vetting status
CREATE INDEX IF NOT EXISTS idx_batches_site_id_vetting_status
  ON batches(site_id, vetting_status);
