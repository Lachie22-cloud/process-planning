-- 047_batch_shortage_eta.sql: Add per-batch ETA to batch_material_shortages
-- Allows planners to set delivery ETAs per batch shortage rather than
-- applying a single ETA to all batches sharing the same material shortage.

ALTER TABLE batch_material_shortages
  ADD COLUMN IF NOT EXISTS eta DATE;
