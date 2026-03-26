-- 044_batch_shortage_required_qty.sql: Add required_qty to batch_material_shortages
-- Stores the per-batch requirement quantity so the UI can show batch-specific
-- Required and Short values instead of only site-wide aggregates.

ALTER TABLE batch_material_shortages
  ADD COLUMN IF NOT EXISTS required_qty NUMERIC NOT NULL DEFAULT 0;
