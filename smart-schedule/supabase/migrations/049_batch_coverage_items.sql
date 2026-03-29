-- 049_batch_coverage_items.sql: Per-plant ZP40 coverage items for batch detail view
-- Stores individual FG material coverage rows from ZP40, keyed by batch + material + plant.
-- Enables the Coverage Profile to show per-plant breakdown instead of aggregated values.

CREATE TABLE IF NOT EXISTS batch_coverage_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  batch_id          UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  planning_material TEXT NOT NULL,
  material          TEXT,
  description       TEXT,
  plant             TEXT,
  available_stock   NUMERIC NOT NULL DEFAULT 0,
  stock_cover       NUMERIC NOT NULL DEFAULT 0,
  safety_stock      NUMERIC NOT NULL DEFAULT 0,
  forecast_m0       NUMERIC NOT NULL DEFAULT 0,
  po_date           DATE,
  po_quantity       NUMERIC NOT NULL DEFAULT 0,
  level             TEXT NOT NULL DEFAULT 'Good'
    CHECK (level IN ('Stock Out', 'Critical', 'Low', 'Good')),
  next_po_order     TEXT,           -- fill order number from ZP40 NextPO column (for OOS linking)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup by batch
CREATE INDEX IF NOT EXISTS idx_batch_coverage_items_batch
  ON batch_coverage_items(batch_id);

-- Fast site-scoped cleanup during import
CREATE INDEX IF NOT EXISTS idx_batch_coverage_items_site
  ON batch_coverage_items(site_id);

-- Enable RLS
ALTER TABLE batch_coverage_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY batch_coverage_items_select ON batch_coverage_items FOR SELECT
  USING (auth.has_permission('batches.read', site_id));

CREATE POLICY batch_coverage_items_insert ON batch_coverage_items FOR INSERT
  WITH CHECK (
    auth.has_permission('batches.write', site_id)
    OR auth.has_permission('batches.schedule', site_id)
  );

CREATE POLICY batch_coverage_items_delete ON batch_coverage_items FOR DELETE
  USING (auth.has_permission('batches.write', site_id));
